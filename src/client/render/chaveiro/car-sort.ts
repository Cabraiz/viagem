/**
 * Card BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima (user, 24/10: "uma pessoa meio que flutua no Uno"): the Uno draws at
 * ONE depth, its centre's, but it is 2.6 u long: a figure behind its rear half on the screen still sorted in front of it
 * and was drawn over the lataria. Near the car a figure is sorted against the car's footprint instead (the box of the
 * contract's CAR_HALF_LENGTH × CAR_HALF_WIDTH at the drawn heading): in front of the box's nearest point toward the
 * viewer it draws over the car, else under it. Farther than CAR_SORT_REACH from the box the plain depth stays (it
 * cannot overlap the car on the screen the wrong way). Pure (no Phaser): the scene and the horde read it.
 */
import {CAR_HALF_LENGTH,CAR_HALF_WIDTH} from '../../../contract/index.ts';
import type {Point} from '../../../maps/index.ts';
import {viewDepth} from '../../projection.ts';

/** Figures up to this far (u) from the car's box are sorted against it. */
export const CAR_SORT_REACH=2.5;
/** How far (depth units) a sorted figure stays from the car's own depth. */
export const CAR_SORT_GAP=.02;

/** The car as drawn this frame: its centre, heading, own depth, and the world direction toward the viewer (unit). */
export interface CarSort {x:number;y:number;heading:number;depth:number;toward:Point}

/** The world direction (unit) along which the draw depth grows for camera `view`. */
export function towardViewer(view:number):Point{
  const o=viewDepth({x:0,y:0},view),x=viewDepth({x:1,y:0},view)-o,y=viewDepth({x:0,y:1},view)-o,d=Math.hypot(x,y);
  return {x:x/d,y:y/d};
}

/**
 * Whether a figure standing at `p` is in front of the car (drawn over it): from the box's nearest point to it (its
 * centre when inside), it lies toward the viewer. Undefined when it is farther than CAR_SORT_REACH from the box.
 */
export function inFrontOfCar(p:Point,car:CarSort):boolean|undefined{
  const c=Math.cos(car.heading),s=Math.sin(car.heading),rx=p.x-car.x,ry=p.y-car.y;
  const l=rx*c+ry*s,w=-rx*s+ry*c;
  const cl=Math.max(-CAR_HALF_LENGTH,Math.min(CAR_HALF_LENGTH,l)),cw=Math.max(-CAR_HALF_WIDTH,Math.min(CAR_HALF_WIDTH,w));
  const dl=l-cl,dw=w-cw,gap=Math.hypot(dl,dw);
  if(gap>CAR_SORT_REACH)return undefined;
  // Outside: off the nearest point; inside (a body pressed into it for a frame): off the centre.
  const nx=gap>1e-9?dl*c-dw*s:rx,ny=gap>1e-9?dl*s+dw*c:ry;
  return nx*car.toward.x+ny*car.toward.y>0;
}

/** The draw depth of a figure at `p` whose plain depth is `depth`, kept on its side of the car (inFrontOfCar). */
export function carSortDepth(p:Point,depth:number,car:CarSort|undefined):number{
  if(!car)return depth;
  const front=inFrontOfCar(p,car);
  if(front===undefined)return depth;
  return front?Math.max(depth,car.depth+CAR_SORT_GAP):Math.min(depth,car.depth-CAR_SORT_GAP);
}
