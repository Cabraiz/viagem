/**
 * The flight of the arsenal's shots that had none on screen (BUG-20261023-ORQ-armas-sem-projetil, usuário 23/10: "a
 * shotgun e outras armas são explosivos, nem aparece o projétil indo"). Pure rules: render/arsenal-fx.ts and
 * render/layers.ts draw them, node tests run them.
 *  - The shotgun's cone hits at once in the sim (sim/weapons/system.ts fireCone): its pellets are drawn flying in a fan
 *    from the barrel out to the cone's reach, quick, after the muzzle flash.
 *  - A thrown zone (rules/thrown.ts) flies THROW_MS from the hero to its spot in the sim: drawn on an arc, and its burst
 *    (FIRE_LOOK blast) plays when it lands.
 */
import {THROW_MS} from '../../rules/index.ts';

/** A weapon whose cone is drawn as pellets: how many, how far (u, the sim's cone reach), how long (ms), the fan (rad). */
export interface PelletLook {count:number;reach:number;ms:number;half:number}
/** The Espalha-Chumbo (sim/weapons/arsenal.ts: area 4 u, coneHalfAngle .45 at every rarity). */
export const PELLETS:Readonly<Record<string,PelletLook>>={escopeta:{count:7,reach:4,ms:190,half:.45}};
/** Where the pellets leave from (u along the aim): the barrel, like the muzzle flash (arsenal-fx.ts). */
export const PELLET_START=.45;

/**
 * The n pellets' angle offsets across ±half (radians) and how far each goes (fraction of the reach): evenly spread with a
 * fixed jitter from `seed`, so two shots never draw the same grid. Writes into `out` (reused).
 */
export function pelletSpread(n:number,half:number,seed:number,out:{angle:number;reach:number}[]=[]){
  out.length=0;
  for(let i=0;i<n;i++){
    const r1=hash(seed,i*2),r2=hash(seed,i*2+1),even=n>1?-half+2*half*i/(n-1):0;
    out.push({angle:Math.max(-half,Math.min(half,even+(r1-.5)*half/Math.max(1,n-1))),reach:.8+.2*r2});
  }
  return out;
}
/** Distance (u) of a pellet `u` (0..1) through its flight: fast out of the barrel, slowing at the end. */
export const pelletDistance=(u:number,reach:number)=>PELLET_START+(Math.max(PELLET_START,reach)-PELLET_START)*(1-(1-clamp01(u))**2);
/** A pellet's opacity: whole most of the way, fading over the last third. */
export const pelletAlpha=(u:number)=>u<2/3?1:Math.max(0,1-(clamp01(u)-2/3)*3);

/**
 * A thrown weapon's look in flight: `arc` the height of its arc at mid flight (CSS px at body 1), `landed` whether its
 * piece stays on the ground under the burst once it lands (the rocket is gone in its own explosion).
 */
export interface ThrownLook {arc:number;landed:boolean}
export const THROWN:Readonly<Record<string,ThrownLook>>={
  rojao:{arc:40,landed:false},
  'tijolo-baiano':{arc:110,landed:true},
  traque:{arc:80,landed:true},
};
export const thrownLook=(hostile:boolean,source:string):ThrownLook|undefined=>hostile?undefined:THROWN[source];
/** Height (CSS px at body 1) of a thrown shot `ageMs` into its flight: a parabola, 0 at both ends. */
export function throwLift(ageMs:number,arc:number){
  const u=clamp01(ageMs/THROW_MS);
  return arc*4*u*(1-u);
}
/** The arc's vertical speed at `ageMs` (CSS px per unit of flight), for pointing the rocket along its path. */
export const throwLiftSlope=(ageMs:number,arc:number)=>arc*4*(1-2*clamp01(ageMs/THROW_MS));

const clamp01=(x:number)=>Math.max(0,Math.min(1,Number.isFinite(x)?x:0));
/** Deterministic 0..1 from (seed, i). */
function hash(seed:number,i:number){
  let h=(Math.imul(seed|0,0x9e3779b1)^Math.imul(i+1,0x85ebca6b))>>>0;
  h=Math.imul(h^(h>>>15),0x2c1b3c6d)>>>0;h=(h^(h>>>12))>>>0;
  return h/0x100000000;
}
