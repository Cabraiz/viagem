/**
 * Provisional art of the chaveiro objective (card NEW-20261013-ORQ-chaveiro-render): figures built from boxes in world
 * units, drawn in the city's projection (42 px per unit across, 21 down, HEIGHT_PX up), so they turn with the camera
 * and keep their size next to the heroes (the hero is 1.245 u tall: 1 m ≈ 0.71 u). Light body + Breu contour (D-022);
 * the side faces are shaded by the scene's sun (upper left of the screen), the top is the base colour.
 * Pure geometry here (tested); the renderer only fills the polygons. The final art comes from the user's tool.
 */
import {HEIGHT_PX} from '../city/projection.ts';

/** A box in the figure's own frame: centre (x along the heading, y to its left), bottom z, size l × w × h (units). */
export interface Box {x:number;y:number;z:number;l:number;w:number;h:number;color:number;
  /** Turn of this box inside the figure (radians, added to the heading): a fallen part, a tilted tray. */
  turn?:number;
  /** Draw no Breu contour (smoke, glass reflections). */
  bare?:boolean;
  alpha?:number;
  /**
   * Stacking layer (default 0): lower layers draw first, then each layer back to front. A box resting on another
   * (the cabin on the body, a rider on the seat) sits a layer up; parts at the same level share one, so the painter's
   * order between them hides the far ones.
   */
  layer?:number}
/** A filled polygon in screen px relative to the figure's anchor, back to front. */
export interface Face {pts:{x:number;y:number}[];color:number;alpha:number;line:boolean}

/** 1 m in world units (the hero, 1.75 m, is 1.245 u tall). */
export const M=1.245/1.75;

/** Turns a world offset by the camera view (projector.ts rotate, without the island centre). */
export function viewTurn(dx:number,dy:number,view:number):{x:number;y:number}{
  switch(((view%4)+4)%4){
    case 1:return {x:-dy,y:dx};
    case 2:return {x:-dx,y:-dy};
    case 3:return {x:dy,y:-dx};
    default:return {x:dx,y:dy};
  }
}
/** Screen offset (px) of a world offset (dx, dy) at height z (units), for the camera view. */
export function isoOffset(dx:number,dy:number,z:number,view:number):{x:number;y:number}{
  const r=viewTurn(dx,dy,view);
  return {x:(r.x-r.y)*42,y:(r.x+r.y)*21-z*HEIGHT_PX};
}
/** Multiplies each channel of 0xRRGGBB by m (clamped). */
export function shade(color:number,m:number):number{
  const c=(v:number)=>Math.max(0,Math.min(255,Math.round(v*m)));
  return (c(color>>16&255)<<16)|(c(color>>8&255)<<8)|c(color&255);
}
/** Blends two 0xRRGGBB colours (t = share of b). */
export function mix(a:number,b:number,t:number):number{
  const ch=(s:number)=>Math.round((a>>s&255)*(1-t)+(b>>s&255)*t);
  return (ch(16)<<16)|(ch(8)<<8)|ch(0);
}

/**
 * The visible faces of `boxes` (a figure at heading `heading`, radians in the world plane) for the camera `view`,
 * back to front: the boxes by layer, then in painter's order (farther centre first in the view), each box's sides
 * that face the screen and then its top. A side facing the sun (the upper left of the screen) is lighter, one facing
 * away darker.
 */
export function boxFaces(boxes:readonly Box[],heading:number,view:number):Face[]{
  const sorted:{key:number;faces:Face[]}[]=[];
  for(const b of boxes){
    const faces:Face[]=[];
    const a=heading+(b.turn??0),ca=Math.cos(a),sa=Math.sin(a),ch=Math.cos(heading),sh=Math.sin(heading);
    // The box centre in the world frame (the figure's frame turned by the heading only).
    const cx=b.x*ch-b.y*sh,cy=b.x*sh+b.y*ch;
    const hl=b.l/2,hw=b.w/2;
    const corner=(u:number,v:number)=>({x:cx+u*ca-v*sa,y:cy+u*sa+v*ca});
    const base=[corner(hl,hw),corner(-hl,hw),corner(-hl,-hw),corner(hl,-hw)];
    const at=(p:{x:number;y:number},z:number)=>isoOffset(p.x,p.y,z,view);
    const r0=viewTurn(cx,cy,view);
    const alpha=b.alpha??1,line=!b.bare;
    // Sides: base[i] → base[i+1]; outward normal from the centre to the side's middle.
    for(let i=0;i<4;i++){
      const p=base[i],q=base[(i+1)%4],mx=(p.x+q.x)/2-cx,my=(p.y+q.y)/2-cy;
      const n=viewTurn(mx,my,view),len=Math.hypot(n.x,n.y)||1,nx=n.x/len,ny=n.y/len;
      if(nx+ny<=1e-6)continue; // faces away from the screen
      const sun=(ny-nx)/Math.SQRT2; // +1 toward the screen's lower left (lit), −1 toward the lower right (shade)
      faces.push({pts:[at(p,b.z),at(q,b.z),at(q,b.z+b.h),at(p,b.z+b.h)],color:shade(b.color,.8+.14*sun),alpha,line});
    }
    faces.push({pts:base.map(p=>at(p,b.z+b.h)),color:b.color,alpha,line});
    sorted.push({key:(b.layer??0)*1e4+r0.x+r0.y+b.z*.05,faces});
  }
  return sorted.sort((p,q)=>p.key-q.key).flatMap(s=>s.faces);
}
/** Screen bounds (px, relative to the anchor) of a set of faces. */
export function faceBounds(faces:readonly Face[]):{x0:number;y0:number;x1:number;y1:number}{
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const f of faces)for(const p of f.pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  return {x0,y0,x1,y1};
}
