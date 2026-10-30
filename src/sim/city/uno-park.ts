/**
 * Where the Uno parks in the city and where the team spawns beside it (NEW-20261030-ORQ-uno-estaciona-fora-da-boca, ORQ's
 * (A)): the nearest spot to the plaza point where the car's body, the six spawn slots and a verde start crate for each
 * of them (crates.ts placeNear: CRATE_BODY_RADIUS, within NEAR_START_REACH u) all stay off every street mouth's free
 * strip (maps/city/entradas.ts bocaFaixa). Computed, never fixed, so it follows the mouths when they change. The first
 * try (only the car and the slots off the strips) left no crate room within 3 u: the crates went 6-7 u out and the
 * first wave caught the bots there (14 downs on seeds 1-6, 0 before).
 * stonewards/wall.ts placeWall asks it for the car; city/uno-start.ts cityUnoStart for the start.
 */
import {RADIUS,naFaixa,type CityTerrain,type Point} from '../../maps/index.ts';
import {CAR_RADIUS,carGap} from '../../contract/index.ts';
import {CRATE_BODY_RADIUS} from '../../rules/index.ts';
import {NEAR_START_ANGLES,NEAR_START_RADII,NEAR_START_SPACING,crateInMouth} from '../crates.ts';
import {START_SLOT_SPREAD} from './tutorial.ts';

/** No spawn slot nearer the car's centre than this (u): its half length (1.32 u) + a hero (.22) + a step of air. */
export const UNO_START_CLEAR=2;
/** The rings searched around the car (u): [first, last, step]. */
export const UNO_START_RING:readonly [number,number,number]=[2.2,8,.25];
/** Open ground the car's centre needs around it (u): its disc + the pushers' room, so it can roll off the spot. */
export const UNO_PARK_ROOM=CAR_RADIUS+.25;
/** The car's search around the plaza point (u): rings `step` apart out to `last`. */
export const UNO_PARK_RING:readonly [number,number]=[16,.25];

/** The six spawn slots of a start (same layout as multiplayer/simulation.ts spawnSlot). */
export const startSlots=(at:Point):Point[]=>Array.from({length:6},(_,i)=>({x:at.x+(i%3-1)*START_SLOT_SPREAD,y:at.y+Math.floor(i/3)*START_SLOT_SPREAD}));

/**
 * The start beside a car at `car`: the first point on rings around it (UNO_START_RING, from the nearest, each ring from
 * the south, the side the camera looks from) where all six slots stand on open ground for a hero, clear of the car's
 * body (UNO_START_CLEAR from its centre) and off every strip. Undefined when no ring fits.
 */
export function startBeside(city:CityTerrain,car:Point):Point|undefined{
  const fits=(at:Point)=>startSlots(at).every(s=>Math.hypot(s.x-car.x,s.y-car.y)>=UNO_START_CLEAR&&city.clearDisc(s.x,s.y,RADIUS)
    &&!naFaixa(city.asset,{x:s.x-RADIUS,y:s.y-RADIUS,w:2*RADIUS,h:2*RADIUS},.01));
  const [first,last,step]=UNO_START_RING;
  for(let r=first;r<=last+1e-9;r+=step){
    const steps=Math.max(8,Math.round(r*8));
    for(let i=0;i<steps;i++){
      // South first, then alternating either side of it.
      const k=i%2?(i+1)/2:-i/2,a=Math.PI/2+k*2*Math.PI/steps;
      const at={x:Math.round((car.x+Math.cos(a)*r)*100)/100,y:Math.round((car.y+Math.sin(a)*r)*100)/100};
      if(fits(at))return at;
    }
  }
  return undefined;
}

/**
 * Whether each of the six slots gets a verde start crate (crates.ts placeNear's rule, greedily): open ground for its
 * body, off every strip (crateInMouth), within NEAR_START_REACH u (NEAR_START_RADII), CRATE_BODY_RADIUS clear of the car,
 * NEAR_START_SPACING from the others and off every hero; in its orders too.
 */
export function crateRoom(city:CityTerrain,car:Point,slots:readonly Point[]):boolean{
  const place={x:car.x,y:car.y,heading:0},n=slots.length;
  const fits=(c:Point,near:readonly Point[])=>city.clearDisc(c.x,c.y,RADIUS)&&!crateInMouth(city,c.x,c.y)&&carGap(place,c)>=CRATE_BODY_RADIUS
    &&near.every(o=>Math.hypot(o.x-c.x,o.y-c.y)>=NEAR_START_SPACING)&&slots.every(o=>Math.hypot(o.x-c.x,o.y-c.y)>=CRATE_BODY_RADIUS+RADIUS);
  const plan=(order:readonly number[])=>{
    const near:Point[]=[];
    return order.every(i=>{
      for(const r of NEAR_START_RADII)for(let k=0;k<NEAR_START_ANGLES;k++){
        const a=k*2*Math.PI/NEAR_START_ANGLES,c={x:slots[i].x+Math.cos(a)*r,y:slots[i].y+Math.sin(a)*r};
        if(fits(c,near)){near.push(c);return true;}
      }
      return false;
    });
  };
  // placeNear's orders: the list, then each rotation of it both ways (the block's last ones get boxed in by the others).
  for(let k=0;k<2*n;k++)if(plan(slots.map((_,i)=>k<n?(i+k)%n:(2*n-1-k+n-i)%n)))return true;
  return false;
}

const memo=new WeakMap<object,{car:Point;start:Point}|undefined>();
/**
 * The car's spot and the start: the nearest point to the plaza (UNO_PARK_RING) where the car has room to roll (UNO_PARK_ROOM)
 * and `carFits` (placeWall's: open ground, no obstacle, its body off the strips) holds, a start fits beside it and its slots get their crates. Once per asset;
 * undefined when nothing within the search does (the caller falls back to the car alone).
 */
export function cityUnoPark(city:CityTerrain,carFits:(p:Point)=>boolean):{car:Point;start:Point}|undefined{
  if(memo.has(city.asset))return memo.get(city.asset);
  const praca=city.asset.points.praca,[last,step]=UNO_PARK_RING;
  let found:{car:Point;start:Point}|undefined;
  search:for(let r=0;r<=last+1e-9;r+=step){
    const steps=r?Math.max(8,Math.round(r*16)):1;
    for(let i=0;i<steps;i++){
      // The plaza point itself as it is (the car's spot before this card); the rings rounded to the hundredth.
      const a=i/steps*Math.PI*2,p=!r?{x:praca.x,y:praca.y}:{x:Math.round((praca.x+Math.cos(a)*r)*100)/100,y:Math.round((praca.y+Math.sin(a)*r)*100)/100};
      if(!city.clearDisc(p.x,p.y,UNO_PARK_ROOM)||!carFits(p))continue;
      const start=startBeside(city,p);
      if(start&&crateRoom(city,p,startSlots(start))){found={car:p,start};break search;}
    }
  }
  memo.set(city.asset,found);
  return found;
}
