/**
 * Card NEW-20261023-ORQ-inicio-no-uno-caixas-120 (the user, 23/10: "todos deveriam iniciar no Uno"): in mode 'ninhos'
 * the whole team (bots too) spawns together beside the Uno, the car the run defends, instead of down the road from the
 * wreck (tutorial.ts cityRunStart, the rounds mode's walk to the plaza, which stays as it was).
 * The car stands where the stonewards place the wall (placeWall: the plaza point, or the nearest spot that fits it).
 * The start is the first point on rings around it (UNO_START_RING, from the nearest, each ring from the south, the
 * side the camera looks from) where all six spawn slots (multiplayer/simulation.ts spawnSlot: three across, two rows,
 * START_SLOT_SPREAD apart) stand on open ground for a hero and clear of the car's body (UNO_START_CLEAR from its
 * centre). Once per asset; the car's spot itself when no ring fits.
 */
import {RADIUS,type CityTerrain,type Point} from '../../maps/index.ts';
import {placeWall} from '../stonewards/wall.ts';
import {START_SLOT_SPREAD} from './tutorial.ts';

/** No spawn slot nearer the car's centre than this (u): its half length (1.32 u) + a hero (.22) + a step of air. */
export const UNO_START_CLEAR=2;
/** The rings searched around the car (u): [first, last, step]. */
export const UNO_START_RING:readonly [number,number,number]=[2.2,8,.25];
const memo=new WeakMap<object,Point>();

/** The six spawn slots of a start (same layout as multiplayer/simulation.ts spawnSlot). */
export const startSlots=(at:Point):Point[]=>Array.from({length:6},(_,i)=>({x:at.x+(i%3-1)*START_SLOT_SPREAD,y:at.y+Math.floor(i/3)*START_SLOT_SPREAD}));

export function cityUnoStart(city:CityTerrain):Point{
  const known=memo.get(city.asset);
  if(known)return {...known};
  const car=placeWall(city);
  const fits=(at:Point)=>startSlots(at).every(s=>Math.hypot(s.x-car.x,s.y-car.y)>=UNO_START_CLEAR&&city.clearDisc(s.x,s.y,RADIUS));
  let start:Point={x:car.x,y:car.y};
  const [first,last,step]=UNO_START_RING;
  search:for(let r=first;r<=last+1e-9;r+=step){
    const steps=Math.max(8,Math.round(r*8));
    for(let i=0;i<steps;i++){
      // South first, then alternating either side of it.
      const k=i%2?(i+1)/2:-i/2,a=Math.PI/2+k*2*Math.PI/steps;
      const at={x:Math.round((car.x+Math.cos(a)*r)*100)/100,y:Math.round((car.y+Math.sin(a)*r)*100)/100};
      if(fits(at)){start=at;break search;}
    }
  }
  memo.set(city.asset,Object.freeze(start));
  return {...start};
}
