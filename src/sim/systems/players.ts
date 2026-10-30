/**
 * Player step of the horde run (VGM-042): movement and facing from the input queue, tap target, class skill and regen.
 * Weapons fire on their own (weapons system); damage, falls and revives go through core/revive. D-051 manual combat
 * (ManualCombat): who holds the attack this tick is noted for the weapons system and the class skill is ignored.
 */
import {bodyBlock,capStep,carBlock,floorOf,floorOn,HERO_GAP,heroBlock,heroSpot,heroesApart,isDown,moveStep,onFloor,setFloor,slipping,walkable,type CarPlace,type Point,type Shove} from '../../maps/index.ts';
import type {TerrainField} from '../../maps/index.ts';
import {SIM_HZ,SYSTEM_ORDER} from '../../contract/index.ts';
import type {PlayerInput,SimPlayer} from '../../contract/index.ts';
import type {SimSystem} from '../context.ts';
import {castSkill} from '../skills.ts';
import {bodiesNear,enemyHeroShare,enemyShove,markPush,standingHero} from '../bodies.ts';
import type {EnemyState} from '../../contract/index.ts';

/** 'players' runs before the contract systems, so enemies react to this tick's positions. */
/**
 * Systems of a horde run: the players' moves first, then SYSTEM_ORDER with the zueira events (VGM-053B) right after
 * the director (the round it just moved) and before the pickups (the boletos and coxinhas it drops are live this tick).
 */
export const RUN_ORDER=['players',SYSTEM_ORDER[0],'zueira',...SYSTEM_ORDER.slice(1)] as const;

/** Protocol 3 input (src/contract/types.ts). */
export type {PlayerInput};
/** Protocol 3 wire fields kept on the server player. */
export type RunPlayer=SimPlayer&{ack:number;score:number;attackTick?:number;skillTick?:number;skillReadyTick?:number};

export const DEFAULT_FACING:Readonly<Point>=Object.freeze({x:0,y:1});
const STEP=1/SIM_HZ;

/**
 * Same movement as shared.simulate (client prediction), plus facing. `tick` (the step's server tick) applies the D-036
 * effects: slowed walking, or the slide while slipping (the stick and facing are ignored then); omitted, plain walking.
 * A slide needs a step, like walking: a player standing still (no step this tick) does not slide (D-036 decision: the
 * phone replays exactly the steps the room takes, and the stand-still balance of the rounds is unchanged).
 * `walkScale`: the walk's share (card bots-20-mais-lentos: BOT_WALK_MULT for a room bot), 1 for a person.
 */
export function movePlayer(p:SimPlayer,input:PlayerInput,terrain:TerrainField,tick?:number,walkScale=1){
  const effects=tick===undefined?undefined:p,slide=slipping(effects,tick??0);
  if(isDown(effects,tick??0))return;
  const q=moveStep(p,{x:input.x,y:input.y},tick??0,effects,terrain,walkScale);
  p.x=q.x;p.y=q.y;setFloor(p,floorOf(q));
  if(slide)return;
  const length=Math.hypot(input.x,input.y);
  if(Number.isFinite(length)&&length>=.01)p.facing={x:input.x/length,y:input.y/length};
}

/**
 * D-051 manual combat: the players who hold the attack on this tick (PlayerInput.attack of the step taken), read by
 * the weapons system later in the same tick. Transient: rebuilt every tick from the inputs (which are in the replay
 * hash), never part of the state.
 */
export interface ManualCombat {attacking:Set<string>}

/**
 * One input per player per tick, like the prototype, so client prediction and the server stay in step. `autopilot`:
 * an offline player the room plays meanwhile (3g-rede-sem-teleporte): it walks on the room's inputs, whose seq is not
 * the person's (their ack stays where their own inputs left it). `stepCap` (D-052, the chaveiro's car): the most a player
 * may walk this tick (u), undefined for free; the step is cut along its own line (kept in place if that point is not walkable).
 * `car` (card uno-bloqueio-corpo): the chaveiro's car, whose body every standing hero stays out of (maps carBlock, as the
 * phone's replay), walking or not (the car rolled onto a hero standing still: out to its edge on this tick).
 * `bodies` (card heroi-empurra-inimigos): every step a hero takes pushes the solid enemies it walks into and stops at
 * their edge (maps bodyBlock, as the phone's replay), before the car's block; a function is also told whose step a
 * body changed. `walkScale` (card bots-20-mais-lentos): a player's share of the walk (the room bots' BOT_WALK_MULT),
 * absent 1; not while `stepCap` holds the player (the car's pace).
 * With `bodies` the heroes on their feet are soft to each other too (card colisao-entre-herois, maps bodies.ts, as the
 * phone's replay): every step leans on where the others stood when the tick began, at most HERO_SOFT (heroBlock, after
 * the enemies' push and before the car's block), and once every hero stepped the overlapping pairs are pushed apart a
 * part per tick (heroesApart), off
 * walls and the car. Solid: standingHero (sim/bodies.ts); the downed are not (the rescuer walks up to them, enemies
 * walk over them), a hero thrown by the chefão is (the phone does not see the others' throws). The function form of
 * `bodies` is told these changes too (the frame goes live: the replay's copies are the frame's, not the past ticks').
 */
export function playersSystem(takeInput:(playerId:string)=>PlayerInput|undefined,autopilot?:(playerId:string)=>boolean,manual?:ManualCombat,
  stepCap?:(playerId:string)=>number|undefined,car?:()=>CarPlace|undefined,bodies?:boolean|((playerId:string)=>void),
  walkScale?:(playerId:string)=>number):SimSystem{
  const near:EnemyState[]=[];
  const standing:RunPlayer[]=[],stood:{x:number;y:number;andar?:1}[]=[],others:{x:number;y:number;andar?:1}[]=[];
  const told=typeof bodies==='function'?bodies:undefined;
  // colisao-entre-herois (the animation's state): who walks where this tick, for the "empurrando"/"empurrado" marks.
  const walks=new Map<RunPlayer,Point>();
  let pusher:RunPlayer|undefined;
  return {id:'players',step(ctx){
    const moveEnemy=bodies?enemyShove(ctx.terrain):undefined;
    // A mendigo the step really moved is "empurrado" and the walker "empurrando", along the move (the shove share).
    const shove:Shove|undefined=moveEnemy&&((b,dx,dy)=>{
      const x=b.x,y=b.y;moveEnemy(b,dx,dy);
      const mx=b.x-x,my=b.y-y,m=Math.hypot(mx,my);
      if(m>1e-6&&pusher){markPush(b as EnemyState,'pushed',mx/m,my/m,ctx.tick);markPush(pusher,'pushing',mx/m,my/m,ctx.tick);}
    });
    walks.clear();
    manual?.attacking.clear();
    const body=car?.();
    standing.length=0;
    if(bodies)for(const player of ctx.players.values())if(standingHero(player,autopilot))standing.push(player as RunPlayer);
    if(standing.length>1)standing.forEach((h,i)=>{const s=stood[i]??(stood[i]={x:0,y:0});s.x=h.x;s.y=h.y;if(h.andar===1)s.andar=1;else delete s.andar;});
    stood.length=standing.length;
    for(const player of ctx.players.values()){
      const p=player as RunPlayer;
      // D-036: an effect that is over goes away (views and the owner's confirmed check only see live ones).
      if(p.slowUntil!==undefined&&ctx.tick>=p.slowUntil)delete p.slowUntil;
      if(p.slipUntil!==undefined&&ctx.tick>=p.slipUntil){delete p.slipUntil;delete p.slip;}
      // D-047 Dona Cida's sweets: an expired one goes away too.
      if(p.fastUntil!==undefined&&ctx.tick>=p.fastUntil)delete p.fastUntil;
      if(p.mightUntil!==undefined&&ctx.tick>=p.mightUntil)delete p.mightUntil;
      if(p.guardUntil!==undefined&&ctx.tick>=p.guardUntil)delete p.guardUntil;
      // boss-fim-onda-1, the Tank's punch: the throw carries the body (walls and water stop it), then the fall ends.
      if(p.knock&&ctx.tick<(p.knockUntil??-Infinity)&&!p.downed){
        const q={x:p.x+p.knock.x,y:p.y+p.knock.y};
        const floor=floorOf(p);
        if(walkable(q,onFloor(ctx.terrain,floor))){p.x=q.x;p.y=q.y;setFloor(p,floorOn(ctx.terrain,q.x,q.y,floor));}else{delete p.knock;delete p.knockUntil;}
      }else if(p.knock||p.knockUntil!==undefined){delete p.knock;delete p.knockUntil;}
      if(p.downUntil!==undefined&&ctx.tick>=p.downUntil)delete p.downUntil;
      if(p.pushing&&ctx.tick>=p.pushing.until)delete p.pushing;
      if(p.pushed&&ctx.tick>=p.pushed.until)delete p.pushed;
      const down=isDown(p,ctx.tick);
      const auto=!p.online&&!!autopilot?.(p.id);
      if((!p.online&&!auto)||p.spectator)continue;
      const input=takeInput(p.id);
      if(input&&!auto)p.ack=input.seq;
      if(p.downed||p.eliminated||!(p.hp>0))continue;
      if(input){
        const from={x:p.x,y:p.y,...(p.andar===1?{andar:1 as const}:{})};
        // bots-20-mais-lentos: a bot moving the car walks at the car's pace (its cap, carSpeed), not BOT_WALK_MULT's: the
        // crew's speed is the car's table (empurrar-uno), and carSpeed(3) is more than a bot's 0.8 walk.
        const cap=stepCap?.(p.id);
        movePlayer(p,input,ctx.terrain,ctx.tick,cap===undefined?walkScale?.(p.id)??1:1);
        // D-052: the same cut as the phone's replay (maps/prediction capStep).
        let q=capStep(from,p,cap,ctx.terrain);
        const il=Math.hypot(input.x,input.y);
        if(il>1e-6)walks.set(p,{x:input.x/il,y:input.y/il});
        pusher=p;
        if(shove){const free=q;q=bodyBlock(from,q,bodiesNear(ctx,q.x,q.y,near),ctx.terrain,shove,enemyHeroShare);if(q!==free)told?.(p.id);}
        if(standing.length>1){
          others.length=0;standing.forEach((h,i)=>{if(h!==p)others.push(stood[i]!);});
          const free=q;q=heroBlock(from,q,others,ctx.terrain);if(q!==free)told?.(p.id);
        }
        q=carBlock(from,q,body,ctx.terrain);p.x=q.x;p.y=q.y;setFloor(p,floorOf(q));
        if(input.target)p.target=input.target;else delete p.target;
        // The mouse's aim while attacking (cone-ataque-melee): the melee swing goes there (weapons/system.ts fireCone).
        if(input.aim)p.aim=input.aim;else delete p.aim;
        // D-051: the attack held (or the press the input track kept) fires the equipped weapon this tick.
        if(manual&&input.attack&&!down)manual.attacking.add(p.id);
        // BUG-20261023-ORQ-tiro-na-direcao-mobile: attacking with an aim (the phone's aim stick, the mouse) turns the hero
        // to it, so a later tap without one fires where the body last looked.
        const al=input.aim?Math.hypot(input.aim.x,input.aim.y):0;
        if(manual&&input.attack&&input.aim&&al>1e-6)p.facing={x:input.aim.x/al,y:input.aim.y/al};
      }
      else if(body){const q=carBlock(p,p,body,ctx.terrain);p.x=q.x;p.y=q.y;}
      if(!auto&&p.stats.regen>0&&p.hp<p.stats.maxHp)p.hp=Math.min(p.stats.maxHp,p.hp+p.stats.regen*STEP);
      // D-051: no class skill in the manual combat (the classes stay as looks and stats).
      if(input?.skill&&!manual){
        const cast=castSkill(ctx,p);
        if(cast){
          p.skillTick=ctx.tick;p.skillReadyTick=cast.readyTick;
          // What the client needs besides the cooldown (E7-skill-hud-wiring): the line, the dice and where the caster landed.
          ctx.emit({type:'skill',player:p.id,skill:cast.classId,line:cast.line,...(cast.outcome?{outcome:cast.outcome}:{}),
            ...(cast.movedTo?{x:cast.movedTo.x,y:cast.movedTo.y}:{})});
        }
      }
    }
    // Card colisao-entre-herois: once every hero stepped, the overlapping pairs come apart a part per tick.
    if(standing.length>1){
      heroesApart(standing,ctx.terrain,heroSpot(ctx.terrain,body),told&&(i=>told(standing[i]!.id)),stood);
      markHeroPushes(standing,walks,ctx.tick);
    }
  }};
}

/**
 * Card colisao-entre-herois (the animation's state, E1's anim-ser-empurrado): 2 standing heroes touching, one walking
 * into the other (its stick within 60° of the other), mark the walker "empurrando" and the other "empurrado", along the
 * line from the walker to the other; 2 walking into each other both push and neither is pushed (a head-on stand-off).
 */
function markHeroPushes(standing:readonly RunPlayer[],walks:ReadonlyMap<RunPlayer,Point>,tick:number){
  for(let i=0;i<standing.length;i++)for(let j=i+1;j<standing.length;j++){
    const a=standing[i]!,b=standing[j]!,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    if(d>HERO_GAP+PUSH_TOUCH||d<1e-9||(a.andar===1)!==(b.andar===1))continue;
    const ux=dx/d,uy=dy/d,wa=walks.get(a),wb=walks.get(b);
    const aPush=!!wa&&wa.x*ux+wa.y*uy>.5,bPush=!!wb&&-(wb.x*ux+wb.y*uy)>.5;
    if(aPush){markPush(a,'pushing',ux,uy,tick);if(!bPush)markPush(b,'pushed',ux,uy,tick);}
    if(bPush){markPush(b,'pushing',-ux,-uy,tick);if(!aPush)markPush(a,'pushed',-ux,-uy,tick);}
  }
}
/** How far past touching (u) 2 heroes still count as in contact for the marks (heroesApart leaves them at HERO_GAP). */
const PUSH_TOUCH=.02;
