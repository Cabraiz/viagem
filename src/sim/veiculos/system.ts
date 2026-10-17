/**
 * Veículos (card NEW-20261014-ORQ-bancos-e-veiculos, part 2, slice 1: patinete, carrinho, crossfiteiro; proposal
 * viagem-board/claims/NEW-20261014-ORQ-bancos-e-veiculos/proposta-veiculos.md). City only, both city modes; the island
 * and the endless world have none (no system, nothing in the state: their digests do not move). Numbers: rules/
 * veiculos.ts VEICULO; the speeds and the cart's turn (shared with the prediction): contract vehicles.ts.
 *
 * - Parked: a vehicle is a 'vehicle' pickup (resource = its VehicleKind, expiresTick = spawn + lifeS); the pickups
 *   system skips them (progression.ts), this one takes and expires them.
 * - Spawn: the first at run start + firstS, then one every everyS while fewer than vehicleCap(players) are parked: a
 *   standing hero drawn, a point VEICULO.near..far from it, `clear` for a hero-size disc and ≥ clearHero from every
 *   hero; VEICULO.tries points, else the next attempt retryS later. Kind drawn with equal weights. Each spawn draws on
 *   its own stream (seed, 'veiculos', its number), so no other draw shifts it.
 * - Take: the nearest standing hero within takeR, not riding and not moving the car (`busy`), ties by id: ride =
 *   kind, rideUntil = now + seconds[kind] (the scooter: a battery drawn in batteryS; the crossfiteiro: + the burpee,
 *   BURPEE_TICKS); event vehicle 'pegou'.
 * - Ride: the crossfiteiro heals healHp every healEvery seconds of the carry (not in the burpee). It ends at rideUntil
 *   (event 'acabou'), or early on a fall or on moving the car (event 'largou').
 * State (JSON-safe, RunSystemsState.veiculos): next (tick of the next attempt, 0 before the first step), spawned
 * (count, the stream's index), taken (rides started).
 */
import type {Point} from '../../maps/index.ts';
import {BURPEE_TICKS,Rng,VEHICLE_KINDS,isVehicleKind,ticks,type PickupState,type SimPlayer,type VehicleKind} from '../../contract/index.ts';
import {VEICULO,vehicleCap} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';

export interface VehiclesState {next:number;spawned:number;taken:number}
export interface VehiclesOptions {
  seed:number;
  /** Whether a hero-size disc of radius r at (x, y) is clear (the city terrain's clearDisc). */
  clear:(x:number,y:number,r:number)=>boolean;
  /** Whether this player moves the chaveiro's car or holds its rope (a ride ends then). */
  busy?:(playerId:string)=>boolean;
}
export interface VehiclesSystem {
  readonly state:VehiclesState;
  step(ctx:SimContext):void;
}

export const VEHICLE_ID_PREFIX='veiculo';
/** A spawned vehicle stands on a disc this clear (u), like a bank's spot. */
export const VEHICLE_CLEAR=1.5;
const FIRST=ticks(VEICULO.firstS),EVERY=ticks(VEICULO.everyS),LIFE=ticks(VEICULO.lifeS),RETRY=ticks(VEICULO.retryS),HEAL=ticks(VEICULO.healEvery);

export const createVehiclesState=():VehiclesState=>({next:0,spawned:0,taken:0});
export const isVehicle=(k:PickupState)=>k.kind==='vehicle'&&isVehicleKind(k.resource);

/** The ride's length in ticks for a vehicle of `kind` taken from spawn `rng` (the scooter's battery is drawn). */
export function rideTicks(kind:VehicleKind,rng:Rng):number{
  if(kind==='patinete')return ticks(rng.range(VEICULO.batteryS[0],VEICULO.batteryS[1]));
  return ticks(VEICULO.seconds[kind])+(kind==='crossfiteiro'?BURPEE_TICKS:0);
}

export function createVehicles(options:VehiclesOptions,restore?:VehiclesState):VehiclesSystem{
  const state=restore??createVehiclesState();
  const streamOf=(n:number)=>new Rng(options.seed>>>0).fork('veiculos').fork(String(n));

  function endRide(ctx:SimContext,p:SimPlayer,what:'acabou'|'largou'){
    const kind=p.ride!;
    delete p.ride;delete p.rideUntil;
    ctx.emit({type:'vehicle',player:p.id,kind,what});
  }
  function stepRides(ctx:SimContext){
    for(const p of ctx.players.values()){
      if(p.ride===undefined)continue;
      if(!isVehicleKind(p.ride)||p.rideUntil===undefined){delete p.ride;delete p.rideUntil;continue;}
      if(ctx.tick>=p.rideUntil){endRide(ctx,p,'acabou');continue;}
      if(p.downed||p.eliminated||!(p.hp>0)||options.busy?.(p.id)){endRide(ctx,p,'largou');continue;}
      if(p.ride==='crossfiteiro'){
        // The carry's ticks so far (the ride is a fixed length: the burpee is its last BURPEE_TICKS).
        const left=p.rideUntil-ctx.tick,carry=ticks(VEICULO.seconds.crossfiteiro),done=carry+BURPEE_TICKS-left;
        if(left>BURPEE_TICKS&&done>0&&done%HEAL===0)p.hp=Math.min(p.stats.maxHp,p.hp+VEICULO.healHp);
      }
    }
  }
  function stepParked(ctx:SimContext){
    for(const k of [...ctx.pickups.values()]){
      if(k.kind!=='vehicle')continue;
      if(!isVehicle(k)||k.expiresTick!==undefined&&ctx.tick>=k.expiresTick){ctx.pickups.delete(k.id);continue;}
      let taker:SimPlayer|undefined,best=Infinity;
      for(const p of ctx.players.values()){
        if(!isStanding(p)||p.ride!==undefined||options.busy?.(p.id))continue;
        const d=Math.hypot(p.x-k.x,p.y-k.y);
        if(d<=VEICULO.takeR&&(d<best||d===best&&taker!==undefined&&p.id<taker.id)){taker=p;best=d;}
      }
      if(!taker)continue;
      const kind=k.resource as VehicleKind;
      ctx.pickups.delete(k.id);
      taker.ride=kind;taker.rideUntil=ctx.tick+rideTicks(kind,streamOf(k.value).fork('ride'));
      state.taken++;
      ctx.emit({type:'vehicle',player:taker.id,kind,what:'pegou',pickup:k.id});
    }
  }
  function spawn(ctx:SimContext){
    const heroes=[...ctx.players.values()].filter(isStanding);
    if(!heroes.length)return false;
    let parked=0;for(const k of ctx.pickups.values())if(k.kind==='vehicle')parked++;
    const seated=[...ctx.players.values()].filter(p=>!p.spectator).length;
    if(parked>=vehicleCap(seated))return true;
    const rng=streamOf(state.spawned),hero=rng.pick(heroes);
    let at:Point|undefined;
    for(let i=0;i<VEICULO.tries&&!at;i++){
      const a=rng.range(0,Math.PI*2),r=rng.range(VEICULO.near,VEICULO.far);
      const q={x:hero.x+Math.cos(a)*r,y:hero.y+Math.sin(a)*r};
      if(!options.clear(q.x,q.y,VEHICLE_CLEAR))continue;
      if(heroes.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<VEICULO.clearHero))continue;
      at=q;
    }
    if(!at)return false;
    const kind=rng.pick(VEHICLE_KINDS);
    // value: the spawn's number (its stream: the ride drawn at the take comes from it).
    const k:PickupState={id:ctx.nextId(VEHICLE_ID_PREFIX),kind:'vehicle',resource:kind,value:state.spawned,x:at.x,y:at.y,
      spawnTick:ctx.tick,expiresTick:ctx.tick+LIFE};
    ctx.pickups.set(k.id,k);
    state.spawned++;
    return true;
  }
  return {state,step(ctx){
    if(state.next===0)state.next=ctx.tick+FIRST;
    stepRides(ctx);
    stepParked(ctx);
    if(ctx.tick>=state.next)state.next=ctx.tick+(spawn(ctx)?EVERY:RETRY);
  }};
}
