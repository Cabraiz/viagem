/**
 * World-space outline of a telegraph, with exactly the server's hit semantics (src/game/sim/telegraphs.ts, D-015):
 * line width = full thickness in world units, cone width = FULL aperture in radians. Pure module, tested against telegraphHits.
 */
import {DEFAULT_CONE_ANGLE,DEFAULT_LINE_WIDTH} from '../sim/telegraphs.ts';

export interface Pt {x:number;y:number}
export interface TelegraphShape {shape:'circle'|'line'|'cone';x:number;y:number;radius:number;dx:number;dy:number;width?:number}

const TAU=Math.PI*2;
export const CIRCLE_SEGMENTS=32,LINE_SEGMENTS=8,CONE_SEGMENTS=24;
/** Points an outline can need; callers size their scratch arrays with this. */
export const OUTLINE_MAX_POINTS=Math.max(CIRCLE_SEGMENTS,2*(LINE_SEGMENTS+1),CONE_SEGMENTS+2);

export const lineWidthOf=(t:TelegraphShape)=>t.width??DEFAULT_LINE_WIDTH;
export const coneApertureOf=(t:TelegraphShape)=>Math.min(TAU,t.width??DEFAULT_CONE_ANGLE);

/**
 * Writes the outline grown by k (0..1, for the fill-up animation) into out via put(i,x,y); returns the point count.
 * (dx,dy) must be a unit vector.
 */
export function telegraphOutline(t:TelegraphShape,k:number,put:(i:number,x:number,y:number)=>void):number{
  if(t.shape==='circle'){
    const r=t.radius*k;
    for(let i=0;i<CIRCLE_SEGMENTS;i++){const a=i/CIRCLE_SEGMENTS*TAU;put(i,t.x+Math.cos(a)*r,t.y+Math.sin(a)*r);}
    return CIRCLE_SEGMENTS;
  }
  if(t.shape==='line'){
    const half=lineWidthOf(t)/2,length=t.radius*k,nx=-t.dy*half,ny=t.dx*half;
    for(let i=0;i<=LINE_SEGMENTS;i++){const d=length*i/LINE_SEGMENTS;put(i,t.x+t.dx*d+nx,t.y+t.dy*d+ny);}
    for(let i=0;i<=LINE_SEGMENTS;i++){const d=length*(LINE_SEGMENTS-i)/LINE_SEGMENTS;put(LINE_SEGMENTS+1+i,t.x+t.dx*d-nx,t.y+t.dy*d-ny);}
    return 2*(LINE_SEGMENTS+1);
  }
  const half=coneApertureOf(t)/2,facing=Math.atan2(t.dy,t.dx),r=t.radius*k;
  put(0,t.x,t.y);
  for(let i=0;i<=CONE_SEGMENTS;i++){const a=facing-half+2*half*i/CONE_SEGMENTS;put(1+i,t.x+Math.cos(a)*r,t.y+Math.sin(a)*r);}
  return CONE_SEGMENTS+2;
}
