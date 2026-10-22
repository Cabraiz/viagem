/**
 * Card empurrar-uno: a hero pushing the Uno (ObjectiveView.car.movers, not on the rope) is drawn with its palms on the
 * car's body. The room only keeps the pusher within CAR_PUSH_REACH of the car's 1 u disc, so the drawing moves the hero
 * along its push to where its hands meet the car's footprint (CAR_HALF at the heading the renderer draws), eased so it
 * never jumps. Drawing only: the room, the prediction and the camera keep the real position. Pure (no Phaser).
 */
import type {Point} from '../../../maps/world.ts';
import {CAR_HALF} from './figures.ts';

/** World u from a pusher's feet to its palms (the push16 art: the palms ~0.4 of the figure's height ahead of the body). */
export const PUSH_REACH=.5;
/** The drawing never moves a pusher farther than this (u) from where the room has it. */
export const PUSH_SHIFT_MAX=1.5;
/** How fast the drawn shift follows its target (1/s): ~90 % in a quarter second. */
export const PUSH_EASE=9;

export interface CarPose {x:number;y:number;heading:number}

/** Where along the ray from `p` (local, unit `d`) it meets the box of half sizes (l, w); undefined when it misses. */
function rayBox(px:number,py:number,dx:number,dy:number,l:number,w:number):number|undefined{
  let t0=-Infinity,t1=Infinity;
  for(const [p,d,half] of [[px,dx,l],[py,dy,w]]){
    if(Math.abs(d)<1e-9){if(Math.abs(p)>half)return undefined;continue;}
    let a=(-half-p)/d,b=(half-p)/d;if(a>b)[a,b]=[b,a];
    t0=Math.max(t0,a);t1=Math.min(t1,b);
  }
  return t0<=t1&&t1>=0?t0:undefined;
}

/**
 * The push of a hero at `hero` on the car at `car`: the direction it faces (unit, world) and the shift (world u) that
 * puts its palms `reach` ahead of it on the car's footprint. `along` (optional): the way the hero is walking (its stick);
 * used when its ray meets the car, else the hero faces the car's centre. Undefined when the hero stands on the centre.
 */
export function pushContact(hero:Point,car:CarPose,along?:Point,reach=PUSH_REACH):{dir:Point;shift:Point}|undefined{
  const c=Math.cos(car.heading),s=Math.sin(car.heading),rx=hero.x-car.x,ry=hero.y-car.y;
  const lx=rx*c+ry*s,ly=-rx*s+ry*c;
  const meets=(d:Point)=>rayBox(lx,ly,d.x*c+d.y*s,-d.x*s+d.y*c,CAR_HALF.l,CAR_HALF.w);
  const toCentre=Math.hypot(rx,ry);
  if(toCentre<1e-6)return undefined;
  const len=along?Math.hypot(along.x,along.y):0;
  let dir=len>1e-6?{x:along!.x/len,y:along!.y/len}:undefined,t=dir&&meets(dir);
  if(t===undefined){dir={x:-rx/toCentre,y:-ry/toCentre};t=meets(dir)??toCentre;}
  const k=Math.max(-PUSH_SHIFT_MAX,Math.min(PUSH_SHIFT_MAX,t-reach));
  return {dir:dir!,shift:{x:dir!.x*k,y:dir!.y*k}};
}

/** The drawn shift of each pusher, eased toward its target (zero once it lets go); one per scene. */
export class PushShifts {
  private shifts=new Map<string,Point>();
  /** This frame's shift of `id` (`target` undefined: not pushing, it eases back to none). */
  step(id:string,target:Point|undefined,dtMs:number):Point{
    const now=this.shifts.get(id)??{x:0,y:0},to=target??{x:0,y:0},k=1-Math.exp(-PUSH_EASE*Math.max(0,Math.min(.1,dtMs/1000)));
    const next={x:now.x+(to.x-now.x)*k,y:now.y+(to.y-now.y)*k};
    if(!target&&Math.hypot(next.x,next.y)<1e-3){this.shifts.delete(id);return {x:0,y:0};}
    this.shifts.set(id,next);return next;
  }
  forget(id:string){this.shifts.delete(id);}
}
