/**
 * Round director (VGM-033): wave -> round-end -> intermission ('prepare') -> next wave, for ROUND_COUNT rounds.
 * Owns ctx.round. Enemy creation, the boss and offers come from other cards through injected callbacks,
 * so this module only depends on the shared contract, terrain and collision helpers.
 *
 * Where enemies appear depends on the world (spawn-em-volta):
 * - island: on the coastal band (coastalSpawnPoints), unchanged since VGM-033; timed-out hordes walk into the sea.
 * - endless: VS-style, on a ring just off the screen of an active player (offscreen.ts), each group going to the
 *   player with the fewest enemies around, so spread players each get a horde. Enemies that end up farther than
 *   RECYCLE_DISTANCE from every player are moved back onto a ring (same id and hp: no kill, no xp). Siege groups
 *   come from off screen around the base, on their way to it. Timed-out hordes flee off screen.
 */
import type {TerrainField} from '../terrain/field.ts';
import {SPEED,clearSegment,walkable,worldBase,worldSpawn,type Point} from '../world.ts';
import {MAX_ENEMIES} from './budget.ts';
import {RECYCLE_DISTANCE,RING_INNER,RING_OUTER,RING_SLACK,offscreenDistance,visibleFrom,type CameraHint} from './offscreen.ts';
import {SIEGE_FLAG} from './stonewards/wall.ts';
import {moveSafely} from './enemies/ai.ts';
import {Rng} from './rng.ts';
import {SIM_HZ,ticks,type EnemyState,type RoundState,type SimContext,type SimPlayer,type SimSystem} from './types.ts';
import {ELITE_SIZE,RETREAT_LINES,ROUND_COUNT,drawTheme,planRound,type RoundPlan,type RoundTheme,type SpawnGroup} from './waves.ts';

/** Builds an enemy of a catalog kind at a point with an hp multiplier (VGM-031). May insert it into ctx.enemies itself. */
export type CreateEnemy=(ctx:SimContext,kind:string,point:Point,scale:number)=>EnemyState|undefined;
/** Spawns the final boss (VGM-038). The point is a suggestion on the coast; return the boss or let it be found by `boss: true`. */
export type SpawnBoss=(ctx:SimContext,point:Point)=>EnemyState|undefined|void;
export interface RoundSummary {
  index:number;total:number;name:string;modifier?:string;spawned:number;retreated:number;timedOut:boolean;
  /** Endless world: enemies moved back next to a player this round (never counted as kills). */
  recycled?:number;
  /** End of the intermission that follows (offer deadline); absent after the final round. */
  intermissionEndsTick?:number;
}
export interface DirectorOptions {
  createEnemy:CreateEnemy;
  spawnBoss?:SpawnBoss;
  /** Fired exactly once when a round's horde is gone; wire to grantRoundOffers(ctx, round, summary.intermissionEndsTick) (D-008). */
  onRoundEnd?:(ctx:SimContext,round:RoundSummary)=>void;
  /** Fired when the intermission before `next` starts (not before round 1). */
  onIntermission?:(ctx:SimContext,next:{index:number;name:string;modifier?:string;endsTick:number})=>void;
  maxEnemies?:number;
  intermissionSeconds?:number;
  openingSeconds?:number;
  warningSeconds?:number;
  /** Minimum distance between a spawn point and any player in the world. */
  minPlayerDistance?:number;
  /** Longest a timed-out enemy keeps walking to the sea before it is removed. */
  retreatSeconds?:number;
  rounds?:number;
  /**
   * Share (0..1) of regular groups that besiege the base: flagged memory.siege and, in the endless world, spawned
   * off screen around the base. Default 0 (no structures until 046B, D-017); a plan may also flag groups itself.
   */
  siegeShare?:number;
  /** Endless world: the camera a client reported (042b/camera-segue). Without it every orientation and view counts. */
  cameraOf?:(ctx:SimContext,player:SimPlayer)=>CameraHint|undefined;
}

/**
 * side: angle the group must come from (single-side, alternating and surround modifiers); kept on re-warns.
 * Endless world: anchor is the player the group was sent to; retry marks a group that found no hidden spot yet.
 */
interface PendingSpawn {members:string[];elite?:boolean;boss?:boolean;siege?:boolean;anchor?:string;retry?:boolean;side?:number;x:number;y:number;atTick:number}
type SpawnRequest=Omit<PendingSpawn,'x'|'y'|'atTick'|'retry'>;
interface Retreat {id:string;x:number;y:number;untilTick:number}
/** JSON-safe director state, so a room checkpoint (VGM-047) can store and restore it. */
export interface DirectorState {
  stage:'idle'|'prepare'|'wave'|'done';
  rng:number;
  roundStart:number;
  theme?:RoundTheme;
  plan?:RoundPlan;
  nextGroup:number;
  pending:PendingSpawn[];
  tracked:string[];
  bossId?:string;
  retreating:Retreat[];
  spawned:number;
  retreated:number;
  timedOut:boolean;
  /** Active player count sampled once per second, newest last, at most 60 samples. */
  samples:number[];
  usedNames:string[];
  /** Copy of ctx.round after the last step; written back into a fresh context after a restore. */
  round:RoundState;
  /** Endless world: enemies of this round moved back next to a player (VS recycling). */
  recycled?:number;
  /** Endless world: members sent to each player this round (tie-break of the horde split). */
  served?:Record<string,number>;
}

export interface Director extends SimSystem {
  readonly state:DirectorState;
  /** Highest active player count of the last minute (1..6), used for budget and hp. */
  scalePlayers(ctx:SimContext):number;
}

const BAND_MAX=2.2;
const LINE_GAP=ticks(.3);
const SURROUND_SIDES=4;
/** Endless world: tries per ring pick (each one a bit farther out), recycling cadence and cap. */
const RING_TRIES=24,RING_STEP=RING_SLACK/RING_TRIES;
export const RECYCLE_EVERY=ticks(.5),RECYCLE_PER_STEP=20;
/** Free disc a spawn needs in the endless world: the boss radius, so no body starts inside a tree or rock. */
export const SPAWN_CLEARANCE=.9;
/** Free disc around the other members of a group (the biggest regular enemy, tio-pavê .48, rounded up). */
export const MEMBER_CLEARANCE=.5;
/**
 * Endless world: an enemy no one can see walks this much faster towards the nearest player, so a horde born on the
 * off-screen ring (21.6-35.9 u away, offscreen.ts) reaches the edge of the screen in a few seconds, as in VS,
 * instead of the ~21 s a gosma needs at 1.4 u/s. On screen it is back to its own pace. Never siege enemies; the boss
 * only while walking.
 */
export const CATCH_UP_SPEED=2.5;
/** Endless retreat: fleeing is faster and may take longer than walking into the island's sea. */
const FLEE_SPEED=4.5,FLEE_TIME_FACTOR=3;

export function activePlayers(ctx:SimContext){
  let n=0;for(const p of ctx.players.values())if(p.online&&!p.spectator&&!p.eliminated)n++;
  return n;
}
const blocking=(p:SimPlayer)=>!p.spectator&&!p.eliminated;

const candidateCache=new WeakMap<TerrainField,Point[]>();
/**
 * Coastal spawn candidates: half-unit grid nodes that are walkable, lie within BAND_MAX of the shoreline
 * and connect to the island interior (SPAWN) through clear segments. Cached per terrain field.
 * The endless world has no coast: it spawns around the players (see the module comment) and gets [].
 */
export function coastalSpawnPoints(terrain:TerrainField):Point[]{
  const cached=candidateCache.get(terrain);if(cached)return cached;
  if(terrain.chunks){const none:Point[]=[];candidateCache.set(terrain,none);return none;}
  const base=worldBase(terrain),spawn=worldSpawn(terrain),half=12,ox=base.x-half,oy=base.y-half;
  const step=.5,size=49,at=(id:number):Point=>({x:ox+(id%size)*step,y:oy+Math.floor(id/size)*step});
  const open=new Uint8Array(size*size);
  for(let id=0;id<open.length;id++)open[id]=walkable(at(id),terrain)?1:0;
  const start=Math.round((spawn.y-oy)/step)*size+Math.round((spawn.x-ox)/step);
  const seen=new Uint8Array(size*size),queue=[start];seen[start]=1;
  for(let head=0;head<queue.length;head++){
    const id=queue[head],x=id%size,y=Math.floor(id/size);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy,next=ny*size+nx;
      if((!dx&&!dy)||nx<0||ny<0||nx>=size||ny>=size||seen[next]||!open[next])continue;
      if(!clearSegment(at(id),at(next),terrain))continue;
      seen[next]=1;queue.push(next);
    }
  }
  const points=queue.map(at).filter(p=>terrain.coast(p.x,p.y)<=BAND_MAX);
  candidateCache.set(terrain,points);
  return points;
}

function nearestPlayer(ctx:SimContext,p:Point){
  let best=Infinity;
  for(const pl of ctx.players.values())if(blocking(pl))best=Math.min(best,Math.hypot(pl.x-p.x,pl.y-p.y));
  return best;
}

export function createDirector(options:DirectorOptions,restore?:DirectorState):Director{
  const maxEnemies=options.maxEnemies??MAX_ENEMIES;
  const intermission=ticks(options.intermissionSeconds??20),opening=ticks(options.openingSeconds??3);
  const warning=ticks(options.warningSeconds??1.5),minDistance=options.minPlayerDistance??4;
  const retreatTicks=ticks(options.retreatSeconds??3),total=Math.min(options.rounds??ROUND_COUNT,ROUND_COUNT);
  const state:DirectorState=restore?structuredClone(restore):{
    stage:'idle',rng:0,roundStart:0,nextGroup:0,pending:[],tracked:[],retreating:[],
    spawned:0,retreated:0,timedOut:false,samples:[],usedNames:[],round:{index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0},
  };
  const siegeShare=Math.max(0,Math.min(1,options.siegeShare??0));
  let rng:Rng|undefined=restore&&restore.stage!=='idle'?new Rng(restore.rng):undefined;
  let restored=!!restore;
  const random=()=>rng!;
  const save=()=>{state.rng=rng!.state;};

  const scalePlayers=(ctx:SimContext)=>Math.max(1,Math.min(6,Math.max(activePlayers(ctx),...state.samples)));

  function sample(ctx:SimContext){
    if(ctx.tick%SIM_HZ!==0)return;
    state.samples.push(activePlayers(ctx));
    if(state.samples.length>60)state.samples.shift();
  }

  function pickPoint(ctx:SimContext,side?:number):Point{
    const all=coastalSpawnPoints(ctx.terrain);
    if(!all.length)throw new Error('terrain has no coastal spawn point');
    const center=worldBase(ctx.terrain);
    const inSide=side===undefined?all:all.filter(p=>{
      const d=Math.atan2(p.y-center.y,p.x-center.x)-side;
      return Math.cos(d)>Math.cos(Math.PI/3);
    });
    const pool=inSide.length?inSide:all;
    const safe=pool.filter(p=>nearestPlayer(ctx,p)>=minDistance);
    if(safe.length)return random().pick(safe);
    const fallback=all.filter(p=>nearestPlayer(ctx,p)>=minDistance);
    if(fallback.length)return random().pick(fallback);
    // Players cover every coastal point: use the farthest one, never a point under a player.
    return all.reduce((a,b)=>nearestPlayer(ctx,b)>nearestPlayer(ctx,a)?b:a);
  }

  // ---------- Endless world (spawn-em-volta) ----------
  const endless=(ctx:SimContext)=>!!ctx.terrain.chunks;
  /** Players groups are sent to: online and standing; else online (all downed); else every body (all offline). */
  function anchorsOf(ctx:SimContext){
    const standing:SimPlayer[]=[],online:SimPlayer[]=[],bodies:SimPlayer[]=[];
    for(const p of ctx.players.values()){
      if(!blocking(p))continue;
      bodies.push(p);if(!p.online)continue;
      online.push(p);if(!p.downed)standing.push(p);
    }
    return standing.length?standing:online.length?online:bodies;
  }
  /** Off the screen of every player with a body (offline ones may reconnect any moment, D-011). */
  function hidden(ctx:SimContext,p:Point){
    for(const pl of ctx.players.values())if(blocking(pl)&&visibleFrom(pl,p,options.cameraOf?.(ctx,pl)))return false;
    return true;
  }
  /** Units a hero covers during the warning: a spot must stay hidden even if a player walks straight at it. */
  const lead=SPEED*warning/SIM_HZ;
  function hiddenAhead(ctx:SimContext,p:Point){
    for(const pl of ctx.players.values()){
      if(!blocking(pl))continue;
      const hint=options.cameraOf?.(ctx,pl),dx=pl.x-p.x,dy=pl.y-p.y,d=Math.hypot(dx,dy);
      if(visibleFrom(pl,p,hint))return false;
      if(d>lead&&visibleFrom(pl,{x:p.x+dx/d*lead,y:p.y+dy/d*lead},hint))return false;
    }
    return true;
  }
  const spawnable=(ctx:SimContext,p:Point)=>walkable(p,ctx.terrain)&&ctx.terrain.chunks!.clear(p.x,p.y,SPAWN_CLEARANCE);
  function nearestOf(list:readonly SimPlayer[],p:Point){
    let best:SimPlayer|undefined,d2=Infinity;
    for(const a of list){const dx=a.x-p.x,dy=a.y-p.y,d=dx*dx+dy*dy;if(d<d2){d2=d;best=a;}}
    return {player:best,d2};
  }
  /**
   * The anchor with the fewest enemies (alive and nearest to it, plus pending groups sent to it); ties go to the
   * one served least this round, then rng. A team that kills fast still splits the horde evenly.
   */
  function chooseAnchor(ctx:SimContext,anchors:readonly SimPlayer[]):SimPlayer{
    if(anchors.length===1)return anchors[0];
    const load=new Map(anchors.map(a=>[a.id,0]));
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);
      if(!e||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1)continue;
      const {player}=nearestOf(anchors,e);
      if(player)load.set(player.id,load.get(player.id)!+1);
    }
    for(const p of state.pending)if(p.anchor!==undefined&&load.has(p.anchor))load.set(p.anchor,load.get(p.anchor)!+p.members.length);
    let min=Infinity;for(const v of load.values())min=Math.min(min,v);
    const served=state.served??{};
    let tied=anchors.filter(a=>load.get(a.id)===min),least=Infinity;
    for(const a of tied)least=Math.min(least,served[a.id]??0);
    tied=tied.filter(a=>(served[a.id]??0)===least);
    return tied.length===1?tied[0]:random().pick(tied);
  }
  function serve(anchor:string|undefined,members:number){
    if(anchor===undefined)return;
    const served=state.served??={};served[anchor]=(served[anchor]??0)+members;
  }
  /** Point on the off-screen ring of `center` (optionally within ±60° of `side`), hidden from everyone. */
  function ringPoint(ctx:SimContext,center:Point,side?:number,hint?:CameraHint):Point|undefined{
    for(let attempt=0;attempt<RING_TRIES;attempt++){
      const a=side===undefined?random().range(0,Math.PI*2):side+random().range(-Math.PI/3,Math.PI/3);
      const ux=Math.cos(a),uy=Math.sin(a);
      const d=offscreenDistance(ux,uy,hint)+random().range(RING_INNER,RING_OUTER)+attempt*RING_STEP;
      const p={x:center.x+ux*d,y:center.y+uy*d};
      if(spawnable(ctx,p)&&hiddenAhead(ctx,p))return p;
    }
    return undefined;
  }
  /**
   * Endless spawn spot. Siege groups: around the base, off everyone's screen (no hint: the base has no camera).
   * Boss: around the player closest to the team's centre. Others: around the requested anchor if still valid,
   * else the least loaded one. Undefined when no hidden spot was found this time.
   */
  function locateEndless(ctx:SimContext,spawn:SpawnRequest):{point:Point;anchor?:string}|undefined{
    if(spawn.siege){const point=ringPoint(ctx,worldBase(ctx.terrain),spawn.side);return point&&{point};}
    const anchors=anchorsOf(ctx);
    if(!anchors.length){const point=ringPoint(ctx,worldBase(ctx.terrain),spawn.side);return point&&{point};}
    let anchor=spawn.anchor!==undefined?anchors.find(a=>a.id===spawn.anchor):undefined;
    if(!anchor&&spawn.boss){
      let cx=0,cy=0;for(const a of anchors){cx+=a.x;cy+=a.y;}
      anchor=nearestOf(anchors,{x:cx/anchors.length,y:cy/anchors.length}).player;
    }
    anchor??=chooseAnchor(ctx,anchors);
    const point=ringPoint(ctx,anchor,spawn.side,options.cameraOf?.(ctx,anchor));
    return point&&{point,anchor:anchor.id};
  }
  /** Hidden enemies close in faster (CATCH_UP_SPEED); see the constant. */
  function catchUp(ctx:SimContext){
    const anchors=anchorsOf(ctx).filter(p=>p.online&&!p.downed&&p.hp>0);
    if(!anchors.length)return;
    const step=CATCH_UP_SPEED/SIM_HZ;
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);
      if(!e||e.hp<=0||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1||ctx.tick<e.readyTick)continue;
      // The boss only while it walks (boss.ts ACT_IDLE = 0); its dash and sweep place it themselves.
      if(e.boss&&e.memory?.act!==0)continue;
      if(e.frozenUntil!==undefined&&ctx.tick<e.frozenUntil)continue;
      if(!hidden(ctx,e))continue;
      const {player,d2}=nearestOf(anchors,e);
      if(!player||d2<1)continue;
      const d=Math.sqrt(d2),x=e.x,y=e.y;
      moveSafely(e,(player.x-e.x)/d*step,(player.y-e.y)/d*step,ctx.terrain,e.radius);
      // The extra step never carries it onto a screen: the last stretch in is at its own pace.
      if(!hidden(ctx,e)){e.x=x;e.y=y;}
    }
  }
  /** VS recycling: enemies far from every player come back on a ring next to one, same id and hp, no kill. */
  function recycle(ctx:SimContext){
    if(ctx.tick%RECYCLE_EVERY!==0)return;
    const anchors=anchorsOf(ctx);if(!anchors.length)return;
    const far=RECYCLE_DISTANCE*RECYCLE_DISTANCE;
    let moved=0;
    for(const id of state.tracked){
      if(moved>=RECYCLE_PER_STEP)break;
      const e=ctx.enemies.get(id);
      // The boss keeps its own arena logic (VGM-038); siege enemies are supposed to be away from players.
      if(!e||e.boss||e.hp<=0||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1)continue;
      if(nearestOf(anchors,e).d2<=far)continue;
      const anchor=chooseAnchor(ctx,anchors),p=ringPoint(ctx,anchor,undefined,options.cameraOf?.(ctx,anchor));
      if(!p)continue;
      e.x=p.x;e.y=p.y;delete e.knock;
      if(e.memory&&e.memory.state!==undefined)e.memory.state=0; // back to walking: no charge across the map
      state.recycled=(state.recycled??0)+1;moved++;
    }
  }

  /** Side of the n-th group: the plan's side, flipped every other group when the modifier alternates. */
  function sideFor(index:number){
    const plan=state.plan;
    if(plan?.side===undefined)return undefined;
    return plan.alternate&&index%2?plan.side+Math.PI:plan.side;
  }

  /** Where a group goes: the coast on the island; endless, a hidden ring spot (undefined: try again in a second). */
  function locate(ctx:SimContext,spawn:SpawnRequest):{point:Point;anchor?:string}|undefined{
    return endless(ctx)?locateEndless(ctx,spawn):{point:pickPoint(ctx,spawn.side)};
  }
  /** Retry entry for a group with no hidden spot yet: no warning (nothing to show), counted as pending. */
  function retryLater(ctx:SimContext,spawn:SpawnRequest,delay:number){
    const at=spawn.anchor!==undefined?ctx.players.get(spawn.anchor):undefined,base=at??worldBase(ctx.terrain);
    state.pending.push({...spawn,retry:true,x:base.x,y:base.y,atTick:ctx.tick+SIM_HZ+delay});
  }

  function warn(ctx:SimContext,spawn:SpawnRequest,delay=0){
    const found=locate(ctx,spawn);
    if(!found){retryLater(ctx,spawn,delay);return;}
    const p=found.point;
    const entry:PendingSpawn={...spawn,...(found.anchor!==undefined?{anchor:found.anchor}:{}),x:p.x,y:p.y,atTick:ctx.tick+warning+delay};
    state.pending.push(entry);serve(found.anchor,spawn.members.length);
    ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:entry.atTick,count:spawn.members.length});
  }

  /** Regular groups flagged by the plan or picked by siegeShare (every 1/share-th group, no rng). */
  const isSiege=(group:SpawnGroup,index:number)=>!!group.siege||(siegeShare>0&&Math.floor((index+1)*siegeShare)>Math.floor(index*siegeShare));

  function dispatch(ctx:SimContext,group:SpawnGroup,index:number){
    const side=sideFor(index),special=!group.boss&&!group.elite,siege=special&&isSiege(group,index);
    const flag=siege?{siege:true}:{};
    if(special&&group.formation==='surround'&&group.members.length>1){
      // Surround: the group splits and arrives from evenly spaced sides at once (endless: around one player).
      const parts=Math.min(SURROUND_SIDES,group.members.length),base=side??random().range(0,Math.PI*2);
      const anchors=endless(ctx)&&!siege?anchorsOf(ctx):[];
      const anchor=anchors.length?{anchor:chooseAnchor(ctx,anchors).id}:{};
      for(let i=0;i<parts;i++)warn(ctx,{members:group.members.filter((_,j)=>j%parts===i),side:base+i*Math.PI*2/parts,...flag,...anchor});
      return;
    }
    if(special&&group.formation==='line'){
      // Single file: the same point, one enemy every LINE_GAP ticks.
      const found=locate(ctx,{members:group.members,side,...flag});
      if(!found){retryLater(ctx,{members:[...group.members],side,...flag},0);return;}
      const p=found.point,anchor=found.anchor!==undefined?{anchor:found.anchor}:{};
      serve(found.anchor,group.members.length);
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:ctx.tick+warning,count:group.members.length});
      group.members.forEach((kind,i)=>state.pending.push({members:[kind],side,...flag,...anchor,x:p.x,y:p.y,atTick:ctx.tick+warning+i*LINE_GAP}));
      return;
    }
    warn(ctx,{members:[...group.members],elite:group.elite,boss:group.boss,side,...flag});
  }

  function placeInGroup(ctx:SimContext,center:Point,i:number):Point{
    if(i===0)return center;
    for(let attempt=0;attempt<4;attempt++){
      const r=.45*Math.sqrt(i+attempt*.5),a=i*2.39996+attempt*1.3;
      const p={x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r};
      const ok=endless(ctx)?ctx.terrain.chunks!.clear(p.x,p.y,MEMBER_CLEARANCE)&&hidden(ctx,p):nearestPlayer(ctx,p)>=minDistance;
      if(walkable(p,ctx.terrain)&&clearSegment(center,p,ctx.terrain)&&ok)return p;
    }
    return center;
  }

  function spawnPending(ctx:SimContext,entry:PendingSpawn){
    const plan=state.plan!;
    const center={x:entry.x,y:entry.y};
    const request:SpawnRequest={members:entry.members,elite:entry.elite,boss:entry.boss,side:entry.side,
      ...(entry.siege?{siege:true}:{}),...(entry.anchor!==undefined?{anchor:entry.anchor}:{})};
    // Endless: no hidden spot was found earlier, or a player now sees the warned one. Island: a player walked onto it.
    // Either way, warn again somewhere else.
    if(entry.retry||(endless(ctx)?!hidden(ctx,center):nearestPlayer(ctx,center)<minDistance)){warn(ctx,request);return;}
    if(entry.boss){
      const before=new Set(ctx.enemies.keys());
      // Without VGM-038 the catalog's 'chefe' stands in, so the final round still has a boss to beat.
      const boss=options.spawnBoss?options.spawnBoss(ctx,center):options.createEnemy(ctx,'chefe',center,plan.eliteHp);
      if(boss){
        if(!ctx.enemies.has(boss.id))ctx.enemies.set(boss.id,boss);
        boss.boss=true;state.bossId=boss.id;
      }
      for(const e of ctx.enemies.values())if(!before.has(e.id)&&(e.boss||e.id===boss?.id)){state.tracked.push(e.id);state.bossId??=e.id;state.spawned++;}
      return;
    }
    const room=Math.max(0,maxEnemies-ctx.enemies.size),count=Math.min(entry.members.length,room);
    for(let i=0;i<count;i++){
      const p=placeInGroup(ctx,center,i);
      const enemy=options.createEnemy(ctx,entry.members[i],p,entry.elite?plan.eliteHp:plan.hp);
      if(!enemy)continue;
      if(!ctx.enemies.has(enemy.id))ctx.enemies.set(enemy.id,enemy);
      enemy.speed*=plan.speed;enemy.radius*=plan.size*(entry.elite?ELITE_SIZE:1);
      if(entry.elite)enemy.elite=true;
      enemy.memory={...enemy.memory,round:plan.index,...(entry.siege?{[SIEGE_FLAG]:1}:{})};
      state.tracked.push(enemy.id);state.spawned++;
    }
    // Enemy cap reached: the rest comes a second later, with a fresh warning.
    if(count<entry.members.length)warn(ctx,{...request,members:entry.members.slice(count)},SIM_HZ);
  }

  function startPrepare(ctx:SimContext,index:number,duration:number){
    state.stage='prepare';
    const theme=state.theme=drawTheme(index,random(),state.usedNames);
    state.usedNames.push(theme.name);if(theme.modifierId)state.usedNames.push(theme.modifierId);
    save();
    Object.assign(ctx.round,{index,total,phase:'prepare',phaseEndsTick:ctx.tick+duration,remaining:0});
    ctx.emit({type:'round',index,phase:'prepare',name:theme.name,modifier:theme.modifierLabel});
  }

  function startWave(ctx:SimContext){
    const index=ctx.round.index,theme=state.theme!;
    const plan=planRound(index,scalePlayers(ctx),theme,random());
    save();
    Object.assign(state,{stage:'wave',plan,roundStart:ctx.tick,nextGroup:0,pending:[],tracked:[],bossId:undefined,retreating:[],spawned:0,retreated:0,timedOut:false},
      endless(ctx)?{recycled:0,served:{}}:{});
    Object.assign(ctx.round,{phase:'wave',phaseEndsTick:ctx.tick+plan.durationTicks,remaining:plan.total});
    ctx.emit({type:'round',index,phase:'wave',name:theme.name,modifier:theme.modifierLabel});
  }

  /** Cancels what has not spawned and walks the survivors back into the sea (endless: off screen, away from the nearest player). */
  function beginRetreat(ctx:SimContext,timedOut:boolean){
    state.timedOut=timedOut;state.nextGroup=state.plan!.groups.length;state.pending=[];
    let barked=false;
    const isEndless=endless(ctx),anchors=isEndless?anchorsOf(ctx):[];
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);if(!e||state.retreating.some(r=>r.id===id))continue;
      let target:Point,until=ctx.tick+retreatTicks;
      const from=isEndless?nearestOf(anchors,e).player??worldBase(ctx.terrain):worldBase(ctx.terrain);
      const dx=e.x-from.x,dy=e.y-from.y,len=Math.hypot(dx,dy);
      if(isEndless){
        // Flee straight away from the nearest player to just past the edge of every screen.
        const ux=len>1e-6?dx/len:1,uy=len>1e-6?dy/len:0;
        const d=offscreenDistance(ux,uy)+RING_OUTER;
        target={x:from.x+ux*d,y:from.y+uy*d};until=ctx.tick+retreatTicks*FLEE_TIME_FACTOR;
      }else target={x:from.x+dx/(len||1)*14,y:from.y+dy/(len||1)*14};
      // Enemy AI (VGM-031) must leave enemies with memory.retreat alone; the director moves them.
      e.memory={...e.memory,retreat:1};e.damage=0;
      state.retreating.push({id,x:target.x,y:target.y,untilTick:until});
      if(!barked){barked=true;ctx.emit({type:'bark',enemy:id,line:random().pick(RETREAT_LINES)});save();}
    }
  }

  function moveRetreats(ctx:SimContext){
    const isEndless=endless(ctx);
    state.retreating=state.retreating.filter(r=>{
      const e=ctx.enemies.get(r.id);if(!e)return false;
      const speed=isEndless?Math.max(e.speed*2.5,FLEE_SPEED):Math.max(e.speed,1.5)*1.5;
      const step=speed/SIM_HZ,dx=r.x-e.x,dy=r.y-e.y,len=Math.hypot(dx,dy);
      if(len>step){e.x+=dx/len*step;e.y+=dy/len*step;}
      const gone=isEndless?hidden(ctx,e):ctx.terrain.coast(e.x,e.y)<-.3;
      if(ctx.tick>=r.untilTick||gone){ctx.enemies.delete(r.id);state.retreated++;return false;}
      return true;
    });
  }

  function endRound(ctx:SimContext){
    const plan=state.plan!,theme=state.theme!;
    ctx.round.remaining=0;
    ctx.emit({type:'round',index:plan.index,phase:'end',name:theme.name,modifier:theme.modifierLabel});
    const summary:RoundSummary={index:plan.index,total,name:theme.name,modifier:theme.modifierLabel,spawned:state.spawned,retreated:state.retreated,timedOut:state.timedOut,
      ...(state.recycled!==undefined?{recycled:state.recycled}:{})};
    if(plan.index>=total){state.stage='done';options.onRoundEnd?.(ctx,summary);return;}
    // Enter the intermission first, so the round-end offers see its deadline in ctx.round and the summary.
    startPrepare(ctx,plan.index+1,intermission);
    options.onRoundEnd?.(ctx,{...summary,intermissionEndsTick:ctx.round.phaseEndsTick});
    const next=state.theme!;
    options.onIntermission?.(ctx,{index:plan.index+1,name:next.name,modifier:next.modifierLabel,endsTick:ctx.round.phaseEndsTick});
  }

  function stepWave(ctx:SimContext){
    const plan=state.plan!,elapsed=ctx.tick-state.roundStart;
    while(state.nextGroup<plan.groups.length&&plan.groups[state.nextGroup].at<=elapsed){dispatch(ctx,plan.groups[state.nextGroup],state.nextGroup);state.nextGroup++;}
    const due=state.pending.filter(p=>p.atTick<=ctx.tick);
    state.pending=state.pending.filter(p=>p.atTick>ctx.tick);
    for(const entry of due)spawnPending(ctx,entry);
    if(endless(ctx)){recycle(ctx);catchUp(ctx);}
    save();
    const alive=()=>{state.tracked=state.tracked.filter(id=>ctx.enemies.has(id));};
    alive();
    if(!state.timedOut&&plan.retreat&&ctx.tick>=ctx.round.phaseEndsTick)beginRetreat(ctx,true);
    // The boss fell: escorts give up.
    if(plan.boss&&state.bossId&&!ctx.enemies.has(state.bossId)&&state.tracked.length>state.retreating.length)beginRetreat(ctx,false);
    if(state.retreating.length){moveRetreats(ctx);alive();}
    let queued=0;
    for(let i=state.nextGroup;i<plan.groups.length;i++)queued+=plan.groups[i].members.length;
    for(const p of state.pending)queued+=p.members.length;
    ctx.round.remaining=queued+state.tracked.length;
    if(!ctx.round.remaining)endRound(ctx);
  }

  return {
    id:'director',state,scalePlayers,
    step(ctx){
      if(restored){restored=false;Object.assign(ctx.round,state.round);}
      if(state.stage==='done')return;
      if(!rng){rng=ctx.rng.fork('director');save();}
      sample(ctx);
      if(state.stage==='idle')startPrepare(ctx,1,opening);
      else if(state.stage==='wave'||ctx.tick>=ctx.round.phaseEndsTick){
        if(state.stage==='prepare')startWave(ctx);
        stepWave(ctx);
      }
      state.round={...ctx.round};
    },
  };
}
