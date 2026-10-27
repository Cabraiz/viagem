/**
 * D-052 slice 1, sim-carro (card NEW-20261016-ORQ-carro-e-fortificacao-livre, approved proposal; the contract is
 * src/contract/objective.ts): the chaveiro's car moves. Stepped by the ChaveiroSystem (system.ts) before the moto rides.
 *
 * - Push: a standing hero within CAR_PUSH_REACH of the body (its box, carGap) whose stick points at the car (cos ≥
 *   CAR_PUSH_DOT, at least PUSH_MIN_INPUT long). No command: lean on it and walk. A helper (a room bot, a player on the
 *   room's autopilot) only helps: it counts while a person moves the car (a bot walking home never drags it away).
 * - Pull (card puxar-uno-corda): the rope is tied to the front bumper (carNose) and its free end lies on the ground
 *   ahead (ropeTip), one hero at a time. A person takes it only by hand (torre-limite-rebocar-sem-arma, the user, 25/10:
 *   "a corda só pode ser ativada se eu chegar perto e clicar"): {t:'puxar'} (pull(), the HUD's "Rebocar") near the body
 *   or the end, also from a helper holding it, and keeps it until "Soltar". A helper (bot, autopilot) still takes it by
 *   gesture: standing within CAR_PULL_REACH of the end with its stick away from the bumper (cos >= CAR_PUSH_DOT), and
 *   lets it go after CAR_ROPE_LET_GO_S without pulling (the stick away from the bumper, cos >= CAR_ROPE_KEEP_DOT). It
 *   pulls while taut (the hero CAR_ROPE or more from the bumper) and drops when the holder takes a hit, falls, leaves or
 *   gets ROPE_SLACK past its length. A helper on the rope pulls only along with a person.
 * - The heading (the nose): a move with a taut rope turns it toward the move at CAR_ROPE_TURN rad/s at most; a push
 *   alone takes the push's axis (the car may roll backwards: it never turns more than 90 degrees for a push).
 * - The car goes the way the movers point (the sum of their unit pushes and taut ropes) at carSpeed(movers); it slides
 *   along one axis when the straight step is blocked. Its body keeps to the hero mask (the city's walkable bitset),
 *   off the standing structures (barricades, tower defenses: what besiegers hit) and CAR_NEST_KEEP_OUT from every living
 *   nest; a step that only gets out of an overlap is allowed. It never hurts: enemies it overlaps are shoved to its
 *   edge (the boss stands its ground).
 * - Who moves it walks at the car's speed (moverCap: the players system clamps their step, players.ts) and does not
 *   attack (busy: the weapons system skips them); the rope holder never attacks, taut or not.
 * Everything kept is on the ChaveiroState's car (JSON-safe): movers, rope and the rope holder's hp at the last step.
 */
import {CAR_HALF_LENGTH,CAR_HALF_WIDTH,CAR_NEST_KEEP_OUT,CAR_PULL_REACH,CAR_PUSH_DOT,CAR_PUSH_REACH,CAR_RADIUS,CAR_ROPE,CAR_ROPE_KEEP_DOT,
  CAR_ROPE_LET_GO_S,CAR_ROPE_TURN,SIM_HZ,carGap,carNose,carPushOut,carSpeed,ropeTip,ticks,type EnemyState,type PullResult,type SimPlayer} from '../../contract/index.ts';
import {RADIUS as PLAYER_RADIUS,maskSurface,walkable,type Point} from '../../maps/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';

/** The rope slips off this far (u) past its length (a blocked car, a hero faster for a tick). */
export const ROPE_SLACK=1;
/** A helper knocked off the rope (a hit) may take it again by gesture after this (s). */
export const ROPE_SHY_SECONDS=1;
/** A stick shorter than this does not push. */
export const PUSH_MIN_INPUT=.3;

/** The car's part of ChaveiroState (only the fields this module reads and writes). */
/**
 * heading: the nose (radians, absent = 0); ropeIdle: ticks the rope holder went without pulling away; ropeShy/ropeShyUntil:
 * who was knocked off it (a hit, a fall) and until which tick they may not take it again by gesture.
 */
export interface CarBody {x:number;y:number;movers?:string[];rope?:string;ropeHp?:number;heading?:number;ropeIdle?:number;ropeShy?:string;ropeShyUntil?:number}
export interface CarWorld {
  /** The stick of `id` on this tick (absent or zero: not walking). */
  input(id:string):{x:number;y:number}|undefined;
  /** Standing structures the body may not cross (radius: theirs). */
  blocks?():readonly {x:number;y:number;radius:number}[];
  /** Living nests (D-051): the car never comes within CAR_NEST_KEEP_OUT of one. */
  nests?():readonly Point[];
  /** A room bot or an autopiloted player: moves the car only along with a person. */
  helper?(id:string):boolean;
}

/** Card uno-bloqueio-corpo: from the body's box (contract carGap), not the old disc. */
const gapTo=(car:CarBody,p:Point)=>carGap(car,p);
const scratch:EnemyState[]=[];

function dropRope(car:CarBody){delete car.rope;delete car.ropeHp;delete car.ropeIdle;}

/** The unit stick of `id` when it is a real one (PUSH_MIN_INPUT or longer). */
function stick(world:CarWorld,id:string):Point|undefined{
  const input=world.input(id),len=input?Math.hypot(input.x,input.y):0;
  return len>=PUSH_MIN_INPUT?{x:input!.x/len,y:input!.y/len}:undefined;
}
/** cos between the stick and the line from the bumper to the hero (1: straight away from the car). */
function awayDot(s:Point,nose:Point,p:Point){
  const d=Math.hypot(p.x-nose.x,p.y-nose.y);
  return d>1e-6?(s.x*(p.x-nose.x)+s.y*(p.y-nose.y))/d:-1;
}
/** The signed smallest turn from `from` to `to` (radians, -pi..pi). */
const angleDiff=(to:number,from:number)=>((to-from)%(Math.PI*2)+Math.PI*3)%(Math.PI*2)-Math.PI;
/**
 * The rope by gesture, helpers only (a person taps "Rebocar": pullCar): a helper holder lets it go after
 * CAR_ROPE_LET_GO_S without pulling; with the rope free, a standing helper at its free end walking away from the bumper
 * takes it (the nearest; ties by id).
 */
function ropeGesture(ctx:SimContext,car:CarBody,world:CarWorld){
  const nose=carNose(car),helper=(id:string)=>!!world.helper?.(id);
  if(car.rope!==undefined&&helper(car.rope)){
    const holder=ctx.players.get(car.rope)!,s=stick(world,car.rope);
    if(s&&awayDot(s,nose,holder)>=CAR_ROPE_KEEP_DOT)car.ropeIdle=0;
    else if((car.ropeIdle=(car.ropeIdle??0)+1)>=ticks(CAR_ROPE_LET_GO_S))dropRope(car);
  }
  if(car.rope!==undefined)return;
  if(car.ropeShy!==undefined&&ctx.tick>=(car.ropeShyUntil??0)){delete car.ropeShy;delete car.ropeShyUntil;}
  const tip=ropeTip(car);let best:SimPlayer|undefined,bestD=Infinity;
  for(const p of ctx.players.values()){
    if(p.id===car.rope||p.id===car.ropeShy||!isStanding(p)||!helper(p.id))continue;
    const d=Math.hypot(p.x-tip.x,p.y-tip.y),s=stick(world,p.id);
    if(d>CAR_PULL_REACH||!s||awayDot(s,nose,p)<CAR_PUSH_DOT)continue;
    if(d<bestD||d===bestD&&best&&p.id<best.id){best=p;bestD=d;}
  }
  if(best){car.rope=best.id;car.ropeHp=best.hp;car.ropeIdle=0;}
}

/** Whether the body may stand at `to` coming from `from` (an overlap it does not deepen is allowed). */
function fits(ctx:SimContext,world:CarWorld,from:Point,to:Point){
  const mask=maskSurface(ctx.terrain);
  if(mask?!mask.clearDisc(to.x,to.y,CAR_RADIUS)&&mask.clearDisc(from.x,from.y,CAR_RADIUS):!walkable(to,ctx.terrain)&&walkable(from,ctx.terrain))return false;
  const deeper=(o:Point,keep:number)=>{
    const d=Math.hypot(to.x-o.x,to.y-o.y);
    return d<keep&&d<Math.hypot(from.x-o.x,from.y-o.y);
  };
  for(const b of world.blocks?.()??[])if(deeper(b,b.radius+CAR_RADIUS))return false;
  for(const n of world.nests?.()??[])if(deeper(n,CAR_NEST_KEEP_OUT))return false;
  return true;
}

/**
 * Enemies on the body go to its box's edge (no damage); the boss is not moved. Every tick, moving or not (card
 * uno-bloqueio-corpo: a crowd pressing on the car squeezed critters into its sides). The standing heroes too.
 */
function shove(ctx:SimContext,car:CarBody){
  const mask=maskSurface(ctx.terrain);
  ctx.enemyIndex.query(car.x,car.y,CAR_HALF_LENGTH+2,scratch);
  for(const e of scratch){
    if(!(e.hp>0)||!ctx.enemies.has(e.id)||e.boss)continue;
    const q=carPushOut(car,e,e.radius);
    if(q===e)continue;
    const to=!mask||mask.clearDisc(q.x,q.y,e.radius)?q:sideExit(car,e,e.radius,mask);
    if(to){e.x=to.x;e.y=to.y;}
  }
  // The heroes it rolled onto this tick too (the players system keeps them out of it from the next step: maps carBlock).
  for(const p of ctx.players.values()){
    if(!isStanding(p))continue;
    const q=carPushOut(car,p,PLAYER_RADIUS);
    if(q!==p&&walkable(q,ctx.terrain)){p.x=q.x;p.y=q.y;}
  }
}
/**
 * The nearest of the box's four sides (straight out across the body) where a disc of `radius` at `p` fits the mask:
 * against a wall the nearest way out may be shut (the street's kerb 0.5 u off the car's north side). Undefined: none.
 */
function sideExit(car:CarBody,p:Point,radius:number,mask:{clearDisc(x:number,y:number,r:number):boolean}):Point|undefined{
  const c=Math.cos(car.heading??0),s=Math.sin(car.heading??0),rx=p.x-car.x,ry=p.y-car.y,l=rx*c+ry*s,w=-rx*s+ry*c;
  const L=CAR_HALF_LENGTH+radius,W=CAR_HALF_WIDTH+radius;
  const exits=[[L,w],[-L,w],[l,W],[l,-W]].map(([el,ew])=>({el,ew,d:Math.hypot(el-l,ew-w)})).sort((a,b)=>a.d-b.d);
  for(const {el,ew} of exits){
    const x=car.x+el*c-ew*s,y=car.y+el*s+ew*c;
    if(mask.clearDisc(x,y,radius))return {x,y};
  }
  return undefined;
}

/**
 * One tick of the car: who moves it now (car.movers), and the step they give it, then the critters off its body.
 * `locked` (the chaveiro is opening it): nobody moves it, the rope stays hooked. Returns whether it moved.
 */
export function stepCar(ctx:SimContext,car:CarBody,world:CarWorld,locked=false):boolean{
  const moved=moveCar(ctx,car,world,locked);
  shove(ctx,car);
  return moved;
}

function moveCar(ctx:SimContext,car:CarBody,world:CarWorld,locked:boolean):boolean{
  // The rope first: it drops on a fall, a hit, a leave, or too far.
  if(car.rope!==undefined){
    const holder=ctx.players.get(car.rope),nose=carNose(car);
    const hit=!!holder&&holder.hp<(car.ropeHp??holder.hp);
    if(!holder||!isStanding(holder)||hit||Math.hypot(holder.x-nose.x,holder.y-nose.y)>CAR_ROPE+ROPE_SLACK){
      const id=car.rope;dropRope(car);
      if(hit){car.ropeShy=id;car.ropeShyUntil=ctx.tick+ticks(ROPE_SHY_SECONDS);}
    }else car.ropeHp=holder.hp;
  }
  if(!locked)ropeGesture(ctx,car,world);
  const movers:string[]=[];let dx=0,dy=0,hx=0,hy=0,people=0,roped=false;const helpers:string[]=[];
  const nose=carNose(car);
  if(!locked)for(const p of ctx.players.values()){
    if(!isStanding(p))continue;
    const helper=!!world.helper?.(p.id);
    if(p.id===car.rope){
      // Taut: it pulls from the bumper toward the holder.
      const d=Math.hypot(p.x-nose.x,p.y-nose.y);
      if(d>=CAR_ROPE&&d>1e-6){
        roped=true;
        const ux=(p.x-nose.x)/d,uy=(p.y-nose.y)/d;
        if(helper){helpers.push(p.id);hx+=ux;hy+=uy;}else{movers.push(p.id);people++;dx+=ux;dy+=uy;}
      }
      continue;
    }
    const d=Math.hypot(p.x-car.x,p.y-car.y),s=stick(world,p.id);
    if(!s||gapTo(car,p)>CAR_PUSH_REACH||d<1e-6)continue;
    if(s.x*(car.x-p.x)/d+s.y*(car.y-p.y)/d<CAR_PUSH_DOT)continue;
    if(helper){helpers.push(p.id);hx+=s.x;hy+=s.y;}else{movers.push(p.id);people++;dx+=s.x;dy+=s.y;}
  }
  if(people){movers.push(...helpers);dx+=hx;dy+=hy;}
  const pull=Math.hypot(dx,dy);
  if(!people||pull<1e-6){delete car.movers;return false;}
  car.movers=movers;
  const step=carSpeed(movers.length)/SIM_HZ,ux=dx/pull,uy=dy/pull,from={x:car.x,y:car.y};
  for(const [sx,sy] of [[ux,uy],[ux,0],[0,uy]]){
    if(Math.abs(sx)+Math.abs(sy)<1e-6)continue;
    const to={x:car.x+sx*step,y:car.y+sy*step};
    if(!fits(ctx,world,from,to))continue;
    car.x=to.x;car.y=to.y;
    turn(car,ux,uy,roped);
    return true;
  }
  return false;
}

/** The nose after a move the movers want along (dx, dy) (even when the body slid along one axis): toward it at CAR_ROPE_TURN with a taut rope; else along its axis (<= 90 degrees). */
function turn(car:CarBody,dx:number,dy:number,roped:boolean){
  const old=car.heading??0,a=Math.atan2(dy,dx);
  let h:number;
  if(roped){const d=angleDiff(a,old),max=CAR_ROPE_TURN/SIM_HZ;h=old+Math.max(-max,Math.min(max,d));}
  else h=Math.abs(angleDiff(a,old))<=Math.PI/2?a:Math.atan2(-dy,-dx);
  h=angleDiff(h,0);
  if(h===0)delete car.heading;else car.heading=h;
}

/**
 * {t:'puxar'} past the room's checks (phase, round, pause) and the duplicate: hook (`on`) or drop the rope. A person
 * (not a `helper`) takes it from a helper holding it.
 */
export function pullCar(car:CarBody,player:SimPlayer|undefined,on:boolean,helper?:(id:string)=>boolean):PullResult{
  if(!player||!isStanding(player))return {ok:false,reason:'fase'};
  if(!on){if(car.rope===player.id)dropRope(car);return {ok:true};}
  if(car.rope===player.id)return {ok:true};
  if(car.rope!==undefined&&!(helper?.(car.rope)&&!helper(player.id)))return {ok:false,reason:'ocupado'};
  const tip=ropeTip(car);
  if(gapTo(car,player)>CAR_PULL_REACH&&Math.hypot(player.x-tip.x,player.y-tip.y)>CAR_PULL_REACH)return {ok:false,reason:'longe'};
  car.rope=player.id;car.ropeHp=player.hp;car.ropeIdle=0;
  return {ok:true};
}

/** The step (u per tick) a mover may walk now: the car's speed while they move it, else undefined (free). */
export function moverCap(car:CarBody,id:string):number|undefined{
  return car.movers?.includes(id)?carSpeed(car.movers.length)/SIM_HZ:undefined;
}

/** Hands busy: the movers and the rope holder do not attack. */
export const carBusy=(car:CarBody,id:string)=>car.rope===id||!!car.movers?.includes(id);
