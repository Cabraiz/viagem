import type {TerrainField} from '../maps/index.ts';
import {CityTerrain,elevation,type Point} from '../maps/index.ts';

export const normalizeView=(view:number)=>((view%4)+4)%4;
export function rotateVector(p:Point,view:number):Point{
  switch(normalizeView(view)){
    case 1:return {x:-p.y,y:p.x};
    case 2:return {x:-p.x,y:-p.y};
    case 3:return {x:p.y,y:-p.x};
    default:return {...p};
  }
}
export function viewPoint(p:Point,view:number):Point{
  const q=rotateVector({x:p.x-12,y:p.y-12},view);return {x:q.x+12,y:q.y+12};
}
export function projectView(p:Point,view=0,terrain?:TerrainField):Point{
  const q=viewPoint(p,view);return {x:(q.x-q.y)*42,y:(q.x+q.y)*21-elevation(p.x,p.y,terrain)};
}
export function unprojectView(p:Point,view=0,terrain?:TerrainField):Point{
  if(terrain){
    // Same orthographic ray and bisection as the cached terrain shader.
    const at=(height:number)=>viewPoint({x:(p.y+height)/42+p.x/84,y:(p.y+height)/42-p.x/84},-view);
    // The city's relief reaches ~185 px (CityTerrain, 21 px per unit over ~8.8 u): search higher there, or a tap on a
    // hill lands on the wrong spot. 18 steps over 256 px still resolve ~0.001 px.
    let lo=0,hi=terrain instanceof CityTerrain?256:128;
    for(let i=0;i<18;i++){const z=(lo+hi)/2,q=at(z);if(z>terrain.height(q.x,q.y))hi=z;else lo=z;}
    return at((lo+hi)/2);
  }
  const difference=p.x/42;let sum=p.y/21;
  for(let i=0;i<32;i++){
    const world=viewPoint({x:(sum+difference)/2,y:(sum-difference)/2},-view);
    sum=(p.y+elevation(world.x,world.y,terrain))/21;
  }
  return viewPoint({x:(sum+difference)/2,y:(sum-difference)/2},-view);
}
/**
 * Draw order along the view (bigger is in front). `origin` re-bases it for the endless world (D-019): depths are
 * taken relative to that point as if it stood at the island centre, so they stay in the island's range (~0..4 800)
 * wherever the hero walks, under the fixed HUD-in-world layers (95 000+) and above the ground (-9 970).
 * The island keeps the default origin (12,12), where this is exactly (q.x + q.y) × 100.
 */
export function viewDepth(p:Point,view=0,origin?:Point){
  const q=viewPoint(p,view);
  if(!origin)return (q.x+q.y)*100;
  const o=viewPoint(origin,view);return (q.x+q.y-o.x-o.y+24)*100;
}
export function screenDirection(x:number,y:number,view=0){return rotateVector({x:x/2+y,y:y-x/2},-view);}

/**
 * UX-camera-segue 4: the view turns (↶ ↷, 90°) only outside a wave. The joystick is screen relative, so a turn in
 * the middle of the horde would flip where "up" goes under the thumb. Allowed in the lobby, the countdown, the
 * intermission between rounds ('prepare'), the result, and in solo exploration (no run).
 */
export function rotationLocked(runPhase?:string,roundPhase?:string){
  return runPhase==='combat'&&roundPhase!=='prepare';
}
