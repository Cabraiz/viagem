/**
 * Telegraph shapes (VGM-038): the hit test the server applies at fireTick and the defaults the renderer (VGM-039)
 * draws with. Shape conventions are documented in src/sim/telegraphs.ts.
 */
import type {Point,Telegraph} from '../contract/index.ts';

export const DEFAULT_LINE_WIDTH=1;
export const DEFAULT_CONE_ANGLE=Math.PI/3;
export type TelegraphShapeData=Pick<Telegraph,'shape'|'x'|'y'|'radius'|'dx'|'dy'|'width'>;

const TAU=Math.PI*2;
const finite=(...n:number[])=>n.every(Number.isFinite);

/** Pure geometry. padding = target body radius (players use world RADIUS). */
export function telegraphHits(t:TelegraphShapeData,p:Point,padding=0):boolean{
  const {x,y,radius}=t;
  if(!finite(x,y,radius,p.x,p.y,padding)||radius<0||padding<0)return false;
  const vx=p.x-x,vy=p.y-y,dist=Math.hypot(vx,vy);
  if(t.shape==='circle')return dist<=radius+padding;
  const dx=t.dx??NaN,dy=t.dy??NaN;
  if(!finite(dx,dy))return false;
  const len=Math.hypot(dx,dy);
  if(!(len>0))return false;
  const ux=dx/len,uy=dy/len;
  if(t.shape==='line'){
    const width=t.width??DEFAULT_LINE_WIDTH;
    if(!Number.isFinite(width)||width<0)return false;
    const along=vx*ux+vy*uy,across=Math.abs(vx*uy-vy*ux);
    return along>=-padding&&along<=radius+padding&&across<=width/2+padding;
  }
  if(t.shape==='cone'){
    const aperture=Math.min(TAU,t.width??DEFAULT_CONE_ANGLE);
    if(!(aperture>0))return false;
    if(dist>radius+padding)return false;
    if(dist<=padding)return true;
    const angle=Math.atan2(Math.abs(vx*uy-vy*ux),vx*ux+vy*uy);
    return angle<=aperture/2+Math.asin(Math.min(1,padding/dist));
  }
  return false;
}
