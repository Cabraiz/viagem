/**
 * Card NEW-20261023-ORQ-inicio-no-uno-caixas-120 (the user, 23/10: "todos deveriam iniciar no Uno"): in mode 'ninhos'
 * the whole team (bots too) spawns together beside the Uno, the car the run defends, instead of down the road from the
 * wreck (tutorial.ts cityRunStart, the rounds mode's walk to the plaza, which stays as it was).
 * The car stands where the stonewards place the wall (placeWall); the start beside it is city/uno-park.ts's: six spawn
 * slots (multiplayer/simulation.ts spawnSlot: three across, two rows, START_SLOT_SPREAD apart) on open ground, clear of
 * the car's body and off every street mouth's free strip, each with room for its verde start crate off them too
 * (NEW-20261030-ORQ-uno-estaciona-fora-da-boca). Once per asset; the car's spot itself when no ring fits.
 */
import type {CityTerrain,Point} from '../../maps/index.ts';
import {placeWall} from '../stonewards/wall.ts';
import {startBeside} from './uno-park.ts';

export {UNO_START_CLEAR,UNO_START_RING,startSlots} from './uno-park.ts';
const memo=new WeakMap<object,Point>();

export function cityUnoStart(city:CityTerrain):Point{
  const known=memo.get(city.asset);
  if(known)return {...known};
  const car=placeWall(city),start=startBeside(city,car)??{x:car.x,y:car.y};
  memo.set(city.asset,Object.freeze(start));
  return {...start};
}
