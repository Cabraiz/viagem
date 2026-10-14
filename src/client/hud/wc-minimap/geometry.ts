/**
 * Warcraft-3-style minimap (card NEW-20261013-ORQ-minimapa-wc3): the geometry, pure.
 *
 * Orientation: the minimap uses the SCREEN's axes, so "up on the minimap = up on the screen" in every camera view. A
 * world point goes through the camera's view rotation and the isometric direction without its 2:1 squash (projection.ts:
 * screen x ∝ q.x − q.y, screen y ∝ (q.x + q.y)/2): sx = (q.x − q.y)/√2, sy = (q.x + q.y)/√2. That keeps world distances
 * (a rotation, no shear), the square city shows as a diamond filling the square frame (the corners are "outside"), and
 * the camera's view — a screen rectangle — is an axis-aligned rectangle on the minimap whose size follows the zoom.
 */
import {rotateVector} from '../../projection.ts';

export interface Pt {x:number;y:number}
/** `side`: the drawing's side in px; `center`: the world point at its middle; `span`: world units across the side. */
export interface MiniFrame {readonly side:number;readonly view:number;readonly center:Pt;readonly span:number}

/**
 * The city: the square map (side `size`, or its `playable` part when given: the ring outside the wall is not worth the
 * room) as a diamond touching the frame's sides, plus a 2% margin.
 */
export function cityFrame(size:{w:number;h:number},side:number,view:number,playable?:{x:number;y:number;w:number;h:number}):MiniFrame{
  const r=playable??{x:0,y:0,w:size.w,h:size.h},s=Math.max(r.w,r.h);
  return {side,view,center:{x:r.x+r.w/2,y:r.y+r.h/2},span:s*Math.SQRT2*1.02};
}
/** The endless map (no edge): a window `span` world units across, centred on `center` (the hero). */
export function windowFrame(center:Pt,side:number,view:number,span:number):MiniFrame{return {side,view,center:{x:center.x,y:center.y},span};}

/** World → minimap px (y down, 0..side). `out` is reused when given (no allocation per dot). */
export function toMini(p:Pt,f:MiniFrame,out:Pt={x:0,y:0}):Pt{
  const q=rotateVector({x:p.x-f.center.x,y:p.y-f.center.y},f.view),k=f.side/f.span;
  out.x=f.side/2+(q.x-q.y)/Math.SQRT2*k;out.y=f.side/2+(q.x+q.y)/Math.SQRT2*k;
  return out;
}
/** Minimap px → world (the inverse of toMini): a click or a ping on the minimap. */
export function fromMini(m:Pt,f:MiniFrame):Pt{
  const k=f.side/f.span,sx=(m.x-f.side/2)/k,sy=(m.y-f.side/2)/k;
  const q={x:(sx+sy)/Math.SQRT2,y:(sy-sx)/Math.SQRT2},d=rotateVector(q,-f.view);
  return {x:f.center.x+d.x,y:f.center.y+d.y};
}
/** Whether a minimap point is inside the drawing (with `pad` px to spare). */
export const insideMini=(m:Pt,f:MiniFrame,pad=0)=>m.x>=pad&&m.y>=pad&&m.x<=f.side-pad&&m.y<=f.side-pad;

/**
 * The canvas transform (a, b, c, d, e, f of setTransform) that draws an image whose pixel (u, v) is the world point
 * (origin.x + u·unit, origin.y + v·unit) at its place on the minimap: the terrain is one image, drawn with one call.
 */
export function imageTransform(f:MiniFrame,origin:Pt,unit:number):[number,number,number,number,number,number]{
  const o=toMini(origin,f),ex=toMini({x:origin.x+unit,y:origin.y},f),ey=toMini({x:origin.x,y:origin.y+unit},f);
  return [ex.x-o.x,ex.y-o.y,ey.x-o.x,ey.y-o.y,o.x,o.y];
}

/**
 * The camera's view on the minimap: the world corners of the viewport (wiring.ts screenCorners: top-left, top-right,
 * bottom-right, bottom-left) taken to the minimap. On flat ground it is an axis-aligned rectangle (see the header).
 */
export function cameraQuad(corners:readonly Pt[],f:MiniFrame):Pt[]{return corners.map(c=>toMini(c,f));}
