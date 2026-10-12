/**
 * What a bot does each decision: the protocol bots of VGM-045 (scripts/bots, a real CoopClient each) and the room's own
 * bots of D-025 (room-bots.ts, inside the Durable Object, no socket). Pure: a RunView in, a stick direction and the taps out, so the
 * choices are unit-tested (tests/tools/bots.test.ts) and the bots stay a fair stand-in for a phone:
 * - combat: weapons fire on their own (the room decides), so the bot only walks: away from what is close, after
 *   pickups, toward the critters near the wall, back home when it strays, to a fallen friend within reach, and out of
 *   any telegraph; it taps the skill when something is close and it is ready;
 * - intermission (Stonewards): walks to a gather node (its own, spread by bot index), comes back on the horn or when
 *   the time left is the walk back; the team's forger (first standing bot) spends the balance at the camp:
 *   repair when the wall is hurt, else a chinelo tower, else a gambiarra;
 * - offers: picks the default card after a human-ish reaction (longer in combat, where the offer is a chip);
 * - fallen: asks for help ("Me salva") every few seconds.
 */
import type {RunView,EnemyView,NodeView,StructureView,PlayerRunView} from '../contract/index.ts';
import {telegraphHits} from './telegraphs.ts';
import {RECIPES,CAMP_RADIUS,canPay,returnTicks,type RecipeId} from '../rules/index.ts';
import {MAX_TOWERS} from './stonewards/forge.ts';
import {walkable,type Point} from '../maps/index.ts';
import type {TerrainField} from '../maps/index.ts';

export const HZ=20;
/** Combat: how far from the wall the bot is happy to roam (units). Farther, home pulls harder. */
export const LEASH=6.5,BOSS_LEASH=9;
/** Critters closer than this push the bot away. */
export const DANGER=2.6;
/** Critters within this are worth walking toward (weapons need range), if they are near home. */
export const ENGAGE=9;
/** A fallen friend within this is worth the walk. */
export const RESCUE_REACH=14;
/** Ticks between two skill taps, two "Me salva", two forge taps, two picks of the same offer. */
export const CAST_GAP=HZ,SOS_GAP=4*HZ,FORGE_GAP=HZ,CHOOSE_RETRY=2*HZ;
/** Reaction before a pick (ticks): the offer chip in combat waits longer than the intermission panel. */
export const PICK_DELAY_COMBAT=3*HZ,PICK_DELAY_PREPARE=HZ;
/** Wall health share under which the forger repairs first (a scratch is left for later, towers first). */
export const REPAIR_BELOW=.95;
/** The forger taps the forge this close to the wall (well inside CAMP_RADIUS, which counts from the base). */
export const FORGE_REACH=Math.min(2.5,CAMP_RADIUS-1);
/** Critters this close to the wall are besieging it: the guards go for them first. */
export const SIEGE_REACH=4;
/** Bots with an even index guard the wall (shorter leash); the others roam. */
export const GUARD_LEASH=3.5;
/** A roamer walking with a person (room bots) stays this close to them. */
export const ESCORT_LEASH=3;

export interface BrainMemory {
  lastPos?:Point;lastMoveTick:number;unstickUntil:number;unstick?:Point;
  lastCastTick:number;lastSosTick:number;lastForgeTick:number;
  offerSeen?:{id:string;tick:number};lastChoose?:{id:string;tick:number};
  orbit:1|-1;
  /** Recipes the forge refused, by round index (Bot fills it from {t:'forged'}): not asked again this intermission. */
  refused:Partial<Record<RecipeId,number>>;
}
export const newMemory=(index=0):BrainMemory=>({lastMoveTick:0,unstickUntil:-1,lastCastTick:-1e9,lastSosTick:-1e9,lastForgeTick:-1e9,orbit:index%2?-1:1,refused:{}});

export interface BrainInput {
  view:RunView;selfId:string;
  /** Where the client predicts it is (CoopClient.predicted), like the scene's camera. */
  at:Point;
  /** Bot index in the room (spreads the gather nodes and the orbit). */
  index:number;
  terrain?:TerrainField;
  memory:BrainMemory;
  /**
   * Who spends the balance at the forge. Unset: the first standing player by id (the protocol bots, all bots). The
   * room bots (D-025) pass their own pick (a bot, never a person) or null when no bot may buy now.
   */
  forger?:string|null;
  /**
   * The person this bot walks with (room bots, D-025: the nearest standing person). In combat a roamer (odd index)
   * follows them once they leave the wall's leash; guards (even index) keep the wall. Unset: wall only (protocol bots).
   */
  escort?:Point;
}
export interface Decision {
  direction:Point;cast:boolean;sos:boolean;forge?:RecipeId;choose?:{offer:string;index:number};
  /** What the bot is up to (logs and tests). */
  mode:'idle'|'down'|'fight'|'rescue'|'home'|'gather'|'forge'|'dodge'|'unstick'|'escort';
}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const norm=(v:Point):Point=>{const l=Math.hypot(v.x,v.y);return l>1e-6?{x:v.x/l,y:v.y/l}:{x:0,y:0};};
const toward=(from:Point,to:Point,weight=1):Point=>{const n=norm({x:to.x-from.x,y:to.y-from.y});return {x:n.x*weight,y:n.y*weight};};
const standing=(p:PlayerRunView)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

export function wallOf(view:RunView):StructureView|undefined{return view.structures.find(s=>s.kind==='muralha');}
/** Home: the wall (the camp is around it); before the first frame with structures, where the run spawned us. */
export function homeOf(view:RunView,fallback:Point):Point{const w=wallOf(view);return w?{x:w.x,y:w.y}:fallback;}

/** The standing bot that spends the balance: the first standing player by id (every bot computes the same one). */
export function forgerId(view:RunView):string|undefined{
  return view.players.filter(standing).map(p=>p.id).sort()[0];
}

/**
 * What the forger buys with this balance, or nothing: repair a hurt wall, then towers up to the forge's cap, then
 * gambiarras. A recipe the forge refused this round (`refused`: recipe -> round index) is skipped.
 */
export function pickRecipe(view:RunView,refused:Partial<Record<RecipeId,number>>={}):RecipeId|undefined{
  const camp=view.camp;if(!camp||camp.wallDown)return undefined;
  const balance={coco:camp.coco,pedra:camp.pedra},wall=wallOf(view),round=view.round?.index??0;
  const ok=(id:RecipeId)=>refused[id]!==round&&canPay(balance,RECIPES[id].cost);
  if(wall&&wall.hp<wall.maxHp*REPAIR_BELOW&&ok('reparo'))return 'reparo';
  const towers=view.structures.filter(s=>s.kind!=='muralha'&&(s.untilTick===undefined||s.untilTick>view.tick)).length;
  if(towers<MAX_TOWERS&&ok('torre-chinelo'))return 'torre-chinelo';
  if(ok('gambiarra'))return 'gambiarra';
  if(wall&&wall.hp<wall.maxHp&&ok('reparo'))return 'reparo';
  return undefined;
}

/** The node this bot works: the nodes in sight with something left, nearest to home first, one per bot index. */
export function nodeFor(nodes:readonly NodeView[],home:Point,index:number):NodeView|undefined{
  const open=nodes.filter(n=>n.remaining>0).sort((a,b)=>dist(a,home)-dist(b,home)||a.id.localeCompare(b.id));
  if(!open.length)return undefined;
  return open[index%Math.min(open.length,6)];
}

/** The first of these directions (rotations of `want`) whose next ~meter is walkable; `want` itself when none is. */
export function clearPath(at:Point,want:Point,terrain?:TerrainField):Point{
  if(!terrain||Math.hypot(want.x,want.y)<1e-6)return want;
  for(const turn of [0,.5,-.5,1,-1,1.6,-1.6]){
    const c=Math.cos(turn),s=Math.sin(turn),d={x:want.x*c-want.y*s,y:want.x*s+want.y*c};
    if(walkable({x:at.x+d.x*.8,y:at.y+d.y*.8},terrain))return d;
  }
  return want;
}

export function decide(input:BrainInput):Decision{
  const {view,selfId,at,index,terrain,memory}=input,tick=view.tick;
  const me=view.players.find(p=>p.id===selfId);
  const decision:Decision={direction:{x:0,y:0},cast:false,sos:false,mode:'idle'};
  // Offers first: a fallen player can still pick (the panel stays).
  const offer=view.offers[0];
  if(offer){
    if(memory.offerSeen?.id!==offer.id)memory.offerSeen={id:offer.id,tick};
    const wait=view.round?.phase==='prepare'?PICK_DELAY_PREPARE:PICK_DELAY_COMBAT;
    const again=memory.lastChoose?.id===offer.id&&tick-memory.lastChoose.tick<CHOOSE_RETRY;
    if(tick-memory.offerSeen.tick>=wait+index*3&&!again){
      const pick=Math.max(0,Math.min(offer.choices.length-1,offer.defaultIndex));
      decision.choose={offer:offer.id,index:pick};memory.lastChoose={id:offer.id,tick};
    }
  }
  if(!me||me.spectator||me.eliminated)return decision;
  if(me.downed){
    decision.mode='down';
    if(tick-memory.lastSosTick>=SOS_GAP){decision.sos=true;memory.lastSosTick=tick;}
    return decision;
  }
  const home=homeOf(view,at),round=view.round,prepare=round?.phase==='prepare';
  let want:Point={x:0,y:0};
  // Telegraphs: step out of any area about to fire (the nearest safe direction of eight).
  const danger=view.telegraphs.filter(t=>telegraphHits(t,at,.4));
  if(danger.length){
    let best:Point|undefined,bestScore=-Infinity;
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,d={x:Math.cos(a),y:Math.sin(a)},p={x:at.x+d.x*1.6,y:at.y+d.y*1.6};
      if(terrain&&!walkable(p,terrain))continue;
      const hits=view.telegraphs.filter(t=>telegraphHits(t,p,.4)).length;
      const score=-hits*10-dist(p,home)*.05;
      if(score>bestScore){bestScore=score;best=d;}
    }
    if(best){decision.direction=best;decision.mode='dodge';return finish(decision,input);}
  }
  if(prepare&&round){
    const toHome=dist(at,home),left=round.phaseEndsTick-tick;
    const forger=(input.forger===undefined?forgerId(view):input.forger)===selfId,recipe=forger?pickRecipe(view,memory.refused):undefined;
    const goHome=view.camp?.hornEndsTick!==undefined||left<=returnTicks(toHome)+4*HZ||!view.nodes?.length;
    if(recipe){
      // The forge measures the camp from the base, the bot from the wall next to it: tap from close to the wall.
      if(toHome<FORGE_REACH){
        decision.mode='forge';
        if(tick-memory.lastForgeTick>=FORGE_GAP){decision.forge=recipe;memory.lastForgeTick=tick;}
      }else{decision.mode='forge';want=toward(at,home);}
    }else if(goHome){
      decision.mode='home';
      if(toHome>CAMP_RADIUS-2)want=toward(at,home);
    }else{
      const node=nodeFor(view.nodes??[],home,index);
      decision.mode='gather';
      if(node){
        // Stand just outside the node's edge, on our side of it (the room gathers within its radius + 0.9).
        const d=dist(at,node);
        if(d>.9)want=toward(at,node);
      }
    }
    // Leftover critters of the wave still bite: keep a little distance while gathering.
    want=add(want,repel(view.enemies,at,.8));
    decision.direction=norm(want);
    return finish(decision,input);
  }
  // Combat.
  const boss=view.enemies.some(e=>e.boss),guard=index%2===0;
  // Walk with the team (room bots): a roamer goes with the nearest person who left the wall's leash, guards stay home.
  const escorting=!guard&&!!input.escort&&dist(input.escort,home)>LEASH,anchor=escorting?input.escort!:home;
  const leash=escorting?ESCORT_LEASH:boss?BOSS_LEASH:guard?GUARD_LEASH:LEASH;
  const close=view.enemies.filter(e=>dist(e,at)<DANGER);
  // Skill: something close and it is ready (the room answers whether it went off).
  if(close.length&&(me.skillReadyTick??0)<=tick&&tick-memory.lastCastTick>=CAST_GAP){decision.cast=true;memory.lastCastTick=tick;}
  const fallen=view.players.filter(p=>p.id!==selfId&&p.downed&&!p.eliminated&&p.online!==undefined)
    .map(p=>({p,at:positionOf(p)})).filter(f=>f.at&&dist(f.at,at)<RESCUE_REACH).sort((a,b)=>dist(a.at!,at)-dist(b.at!,at))[0];
  const hpShare=me.maxHp>0?me.hp/me.maxHp:1;
  want=add(want,repel(view.enemies,at,hpShare<.4?2.2:1.4));
  // Hostile shots heading our way: sidestep.
  for(const s of view.projectiles){
    if(!s.hostile)continue;
    const rx=at.x-s.x,ry=at.y-s.y,d=Math.hypot(rx,ry),speed=Math.hypot(s.vx,s.vy);
    if(d>4||speed<1e-3)continue;
    const along=(rx*s.vx+ry*s.vy)/speed;
    if(along<=0)continue;
    const side=Math.sign(rx*s.vy-ry*s.vx)||1;
    want=add(want,{x:-s.vy/speed*side*1.2,y:s.vx/speed*side*1.2});
  }
  if(fallen?.at&&close.length<4){
    decision.mode='rescue';
    if(dist(fallen.at,at)>.7)want=add(want,toward(at,fallen.at,2.2));
  }else{
    decision.mode='fight';
    // Critters at the wall first (it falls for good), else one near home and not on top of us: weapons have range.
    const siege=nearest(view.enemies.filter(e=>dist(e,home)<SIEGE_REACH&&dist(e,at)<ENGAGE+4),at);
    const target=siege??nearest(view.enemies.filter(e=>dist(e,anchor)<leash+3&&dist(e,at)<ENGAGE),at);
    if(target&&dist(target,at)>DANGER+(siege?.2:.6))want=add(want,toward(at,target,siege?1.2:.7));
    // Pickups: hearts when hurt, everything else when nothing is close.
    const pickup=nearest(view.pickups.filter(p=>dist(p,at)<6&&(p.kind!=='heal'||hpShare<.8)&&dist(p,anchor)<leash+4),at);
    if(pickup&&close.length<2)want=add(want,toward(at,pickup,hpShare<.5&&pickup.kind==='heal'?1.6:.9));
    // Keep moving around the wall, or the person walked with (a still target gets surrounded).
    const r=dist(at,anchor);
    if(r>.5){const t={x:-(at.y-anchor.y)/r*memory.orbit,y:(at.x-anchor.x)/r*memory.orbit};want=add(want,{x:t.x*.35,y:t.y*.35});}
    else want=add(want,{x:.3*memory.orbit,y:0});
  }
  // Home pulls harder the farther out we are.
  const out=dist(at,anchor)-leash;
  if(out>0)want=add(want,toward(at,anchor,Math.min(3,.5+out*.6)));
  if(decision.mode==='fight'&&escorting)decision.mode='escort';
  else if(decision.mode==='fight'&&dist(at,home)>leash+2)decision.mode='home';
  decision.direction=norm(want);
  return finish(decision,input);
}

/** Players carry positions on the wire (PlayerWireView); the view type does not say so. */
function positionOf(p:PlayerRunView):Point|undefined{const q=p as PlayerRunView&Partial<Point>;return Number.isFinite(q.x)&&Number.isFinite(q.y)?{x:q.x!,y:q.y!}:undefined;}
function add(a:Point,b:Point):Point{return {x:a.x+b.x,y:a.y+b.y};}
function nearest<T extends Point>(list:readonly T[],at:Point):T|undefined{let best:T|undefined,d=Infinity;for(const e of list){const x=dist(e,at);if(x<d){d=x;best=e;}}return best;}
function repel(enemies:readonly EnemyView[],at:Point,weight:number):Point{
  let x=0,y=0;
  for(const e of enemies){
    const d=dist(e,at),reach=DANGER*(e.boss?1.8:e.elite?1.3:1);
    if(d>=reach)continue;
    const w=((reach-d)/reach)**2*weight*(e.boss?2:1),n=d>1e-6?{x:(at.x-e.x)/d,y:(at.y-e.y)/d}:{x:1,y:0};
    x+=n.x*w*3;y+=n.y*w*3;
  }
  return {x,y};
}

/** Walls of trees and rocks: steer around them, and shake loose when the bot has not moved for a while. */
function finish(decision:Decision,input:BrainInput):Decision{
  const {at,terrain,memory,view}=input,tick=view.tick;
  const moving=Math.hypot(decision.direction.x,decision.direction.y)>.15;
  if(!moving){decision.direction={x:0,y:0};memory.lastPos=at;memory.lastMoveTick=tick;return decision;}
  if(tick<memory.unstickUntil&&memory.unstick){decision.direction=memory.unstick;decision.mode='unstick';return decision;}
  if(!memory.lastPos||dist(memory.lastPos,at)>.4){memory.lastPos=at;memory.lastMoveTick=tick;}
  else if(tick-memory.lastMoveTick>1.5*HZ){
    // Stuck against something: a perpendicular for a moment, alternating sides.
    memory.orbit=memory.orbit===1?-1:1;
    memory.unstick=norm({x:-decision.direction.y*memory.orbit+decision.direction.x*.2,y:decision.direction.x*memory.orbit+decision.direction.y*.2});
    memory.unstickUntil=tick+.8*HZ;memory.lastMoveTick=tick;memory.lastPos=at;
    decision.direction=memory.unstick;decision.mode='unstick';return decision;
  }
  decision.direction=clearPath(at,decision.direction,terrain);
  return decision;
}
