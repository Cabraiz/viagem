import type {TerrainField} from './terrain/field.ts';
import {elevation,type Point} from './world.ts';

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
    let lo=0,hi=128;
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
export function viewDepth(p:Point,view=0){const q=viewPoint(p,view);return (q.x+q.y)*100;}
export function screenDirection(x:number,y:number,view=0){return rotateVector({x:x/2+y,y:y-x/2},-view);}
