/**
 * D-052 slice 1, sim-carro (card NEW-20261016-ORQ-carro-e-fortificacao-livre, approved proposal; the contract is
 * src/contract/objective.ts): the chaveiro's car moves. Stepped by the ChaveiroSystem (system.ts) before the moto rides.
 *
 * - Push: a standing hero within CAR_PUSH_REACH of the body (CAR_RADIUS) whose stick points at the car (cos ≥
 *   CAR_PUSH_DOT, at least PUSH_MIN_INPUT long). No command: lean on it and walk. A helper (a room bot, a player on the
 *   room's autopilot) only helps: it counts while a person moves the car (a bot walking home never drags it away).
 * - Pull: the rope ({t:'puxar'}, pull()) is hooked within CAR_PULL_REACH of the body, one hero at a time; it pulls
 *   while taut (the hero CAR_ROPE or more from the body) and drops when the hero takes a hit, falls, leaves, or gets
 *   ROPE_SLACK past its length.
 * - The car goes the way the movers point (the sum of their unit pushes and taut ropes) at carSpeed(movers); it slides
 *   along one axis when the straight step is blocked. Its body keeps to the hero mask (the city's walkable bitset),
 *   off the standing structures (barricades, tower defenses: what besiegers hit) and CAR_NEST_KEEP_OUT from every living
 *   nest; a step that only gets out of an overlap is allowed. It never hurts: enemies it overlaps are shoved to its
 *   edge (the boss stands its ground).
 * - Who moves it walks at the car's speed (moverCap: the players system clamps their step, players.ts) and does not
 *   attack (busy: the weapons system skips them); the rope holder never attacks, taut or not.
 * Everything kept is on the ChaveiroState's car (JSON-safe): movers, rope and the rope holder's hp at the last step.
 */
import {CAR_NEST_KEEP_OUT,CAR_PULL_REACH,CAR_PUSH_DOT,CAR_PUSH_REACH,CAR_RADIUS,CAR_ROPE,SIM_HZ,carSpeed,
  type EnemyState,type PullResult,type SimPlayer} from '../../contract/index.ts';
import {maskSurface,walkable,type Point} from '../../maps/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';

/** The rope slips off this far (u) past its length (a blocked car, a hero faster for a tick). */
export const ROPE_SLACK=1;
/** A stick shorter than this does not push. */
export const PUSH_MIN_INPUT=.3;

/** The car's part of ChaveiroState (only the fields this module reads and writes). */
export interface CarBody {x:number;y:number;movers?:string[];rope?:string;ropeHp?:number}
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

const gapTo=(car:Point,p:Point)=>Math.hypot(p.x-car.x,p.y-car.y)-CAR_RADIUS;
const scratch:EnemyState[]=[];

function dropRope(car:CarBody){delete car.rope;delete car.ropeHp;}

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

/** Enemies under the body go to its edge (no damage); the boss is not moved. */
function shove(ctx:SimContext,car:Point,ux:number,uy:number){
  const mask=maskSurface(ctx.terrain);
  ctx.enemyIndex.query(car.x,car.y,CAR_RADIUS+2,scratch);
  for(const e of scratch){
    if(!(e.hp>0)||!ctx.enemies.has(e.id)||e.boss)continue;
    const keep=CAR_RADIUS+e.radius,d=Math.hypot(e.x-car.x,e.y-car.y);
    if(d>=keep)continue;
    const nx=d>1e-6?(e.x-car.x)/d:ux,ny=d>1e-6?(e.y-car.y)/d:uy;
    const x=car.x+nx*keep,y=car.y+ny*keep;
    if(mask&&!mask.clearDisc(x,y,e.radius))continue;
    e.x=x;e.y=y;
  }
}

/**
 * One tick of the car: who moves it now (car.movers), and the step they give it. `locked` (the chaveiro is opening it):
 * nobody moves it, the rope stays hooked. Returns whether it moved.
 */
export function stepCar(ctx:SimContext,car:CarBody,world:CarWorld,locked=false):boolean{
  // The rope first: it drops on a fall, a hit, a leave, or too far.
  if(car.rope!==undefined){
    const holder=ctx.players.get(car.rope);
    if(!holder||!isStanding(holder)||holder.hp<(car.ropeHp??holder.hp)||gapTo(car,holder)>CAR_ROPE+ROPE_SLACK)dropRope(car);
    else car.ropeHp=holder.hp;
  }
  const movers:string[]=[];let dx=0,dy=0,hx=0,hy=0,people=0;const helpers:string[]=[];
  if(!locked)for(const p of ctx.players.values()){
    if(!isStanding(p))continue;
    const d=Math.hypot(p.x-car.x,p.y-car.y);
    if(p.id===car.rope){
      // Taut: it pulls toward the holder.
      if(d-CAR_RADIUS>=CAR_ROPE&&d>1e-6){movers.push(p.id);people++;dx+=(p.x-car.x)/d;dy+=(p.y-car.y)/d;}
      continue;
    }
    const input=world.input(p.id),len=input?Math.hypot(input.x,input.y):0;
    if(!(len>=PUSH_MIN_INPUT)||d-CAR_RADIUS>CAR_PUSH_REACH||d<1e-6)continue;
    const ix=input!.x/len,iy=input!.y/len;
    if(ix*(car.x-p.x)/d+iy*(car.y-p.y)/d<CAR_PUSH_DOT)continue;
    if(world.helper?.(p.id)){helpers.push(p.id);hx+=ix;hy+=iy;}else{movers.push(p.id);people++;dx+=ix;dy+=iy;}
  }
  if(people){movers.push(...helpers);dx+=hx;dy+=hy;}
  const pull=Math.hypot(dx,dy);
  if(!movers.length||pull<1e-6){delete car.movers;return false;}
  car.movers=movers;
  const step=carSpeed(movers.length)/SIM_HZ,ux=dx/pull,uy=dy/pull,from={x:car.x,y:car.y};
  for(const [sx,sy] of [[ux,uy],[ux,0],[0,uy]]){
    if(Math.abs(sx)+Math.abs(sy)<1e-6)continue;
    const to={x:car.x+sx*step,y:car.y+sy*step};
    if(!fits(ctx,world,from,to))continue;
    car.x=to.x;car.y=to.y;
    shove(ctx,car,ux,uy);
    return true;
  }
  return false;
}

/** {t:'puxar'} past the room's checks (phase, round, pause) and the duplicate: hook (`on`) or drop the rope. */
export function pullCar(car:CarBody,player:SimPlayer|undefined,on:boolean):PullResult{
  if(!player||!isStanding(player))return {ok:false,reason:'fase'};
  if(!on){if(car.rope===player.id)dropRope(car);return {ok:true};}
  if(car.rope===player.id)return {ok:true};
  if(car.rope!==undefined)return {ok:false,reason:'ocupado'};
  if(gapTo(car,player)>CAR_PULL_REACH)return {ok:false,reason:'longe'};
  car.rope=player.id;car.ropeHp=player.hp;
  return {ok:true};
}

/** The step (u per tick) a mover may walk now: the car's speed while they move it, else undefined (free). */
export function moverCap(car:CarBody,id:string):number|undefined{
  return car.movers?.includes(id)?carSpeed(car.movers.length)/SIM_HZ:undefined;
}

/** Hands busy: the movers and the rope holder do not attack. */
export const carBusy=(car:CarBody,id:string)=>car.rope===id||!!car.movers?.includes(id);
