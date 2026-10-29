/**
 * NEW-20261029-ORQ-cidade-decor-alto-e-grafite (colocação): a graffito painted on a wall's face, the pure half. The map
 * puts it on the wall piece's own rect (scripts/altos-grafites-cidade.ts), `rot` the face (maps/city-decor.ts FACE_ROT:
 * S 0, E 90, N 180, W 270). The city layer draws the quad this returns as a Mesh just above the wall's image. No Phaser.
 *
 * E1's note (evidence/cidade-decor-alto-arte/NOTA-E7-grafites.md): one view, never mirrored (the face turned away is not
 * drawn, and the image reads left to right on the screen); 0.6–0.9 of the wall's length, its centre at ~55 % of the wall's
 * height; the projection gives the vertical shear; a face in the shade is 10–25 % darker.
 */
import {SUN_VIEW} from '../light.ts';
import {depth,project,rotate,type Pt} from './projection.ts';

/** World normal of each face rot (FACE_ROT: S 0, E 90, N 180, W 270). */
const NORMAL:Readonly<Record<number,readonly [number,number]>>={0:[0,1],90:[1,0],180:[0,-1],270:[-1,0]};
/** How far (cells) in front of the wall's line the paint sits: the wall art's half thickness, over it. */
export const GRAFITE_OFFSET=.14;
/** Length on the wall (fraction of a cell) and the centre's height (fraction of the wall's). */
export const GRAFITE_SPAN=[.6,.9] as const,GRAFITE_MID=.55;
/** Never taller than this fraction of the wall (a wide graffito on a low wall shrinks). */
const MAX_TALL=.8;
/** Darkening of a face in full shade (the lit side keeps its colour). */
export const GRAFITE_SHADE=[.1,.25] as const;

export interface GrafiteEntry {readonly c:number;readonly r:number;readonly w:number;readonly h:number;readonly rot:number}
export interface GrafiteQuad {
  /** Screen corners (projected px): top-left, top-right, bottom-right, bottom-left of the image as seen. */
  readonly corners:readonly [Pt,Pt,Pt,Pt];
  /** Brightness multiplier of the paint (1 lit, down to 0.75 in the shade). */
  readonly light:number;
  /** Depth key of the wall's centre (projection.ts depth): the layer draws the paint just above it. */
  readonly depth:number;
}

/** A stable 0..1 per entry (the graffito's size on its wall). */
const hash01=(e:GrafiteEntry)=>{let h=Math.imul(e.c*73856093^e.r*19349663^e.rot*83492791,0x9e3779b1)>>>0;h^=h>>>15;return (h>>>0)%1000/1000;};

/**
 * The quad of a graffito in `view`, or undefined when its face looks away from the camera. `cell`/`origin`: the city's
 * (world units); `base`: ground height under the wall; `wall`: the wall art's height (world units); `aspect`: the
 * image's height over its width.
 */
export function grafiteQuad(e:GrafiteEntry,view:number,cell:number,origin:Pt,base:number,wall:number,aspect:number,pivot?:Pt):GrafiteQuad|undefined{
  const n=NORMAL[((Math.round(e.rot/90)%4+4)%4)*90],nv=rotate(n[0],n[1],view);
  // Nearer the viewer is +qx+qy (projection.ts depth): a face whose normal points there is seen.
  if(nv.x+nv.y<=0)return undefined;
  const cx=origin.x+(e.c+e.w/2+n[0]*GRAFITE_OFFSET)*cell,cy=origin.y+(e.r+e.h/2+n[1]*GRAFITE_OFFSET)*cell;
  let W=cell*(GRAFITE_SPAN[0]+(GRAFITE_SPAN[1]-GRAFITE_SPAN[0])*hash01(e)),H=W*aspect;
  if(H>wall*MAX_TALL){W*=wall*MAX_TALL/H;H=wall*MAX_TALL;}
  // Along the wall, the way that reads left to right on the screen.
  let t:[number,number]=[-n[1],n[0]];
  if(project(t[0],t[1],0,view,{x:0,y:0}).x<0)t=[-t[0],-t[1]];
  const zc=base+wall*GRAFITE_MID,at=(s:number,v:number)=>project(cx+t[0]*(s-.5)*W,cy+t[1]*(s-.5)*W,zc+(.5-v)*H,view,pivot);
  // The sun is behind the camera's two faces (light.ts: upper left); as palette.ts wallLight/wallDark, the face nearer
  // it (+qy) keeps its colour and the other (+qx) darkens by how much less of it it gets.
  const s=[SUN_VIEW[0],SUN_VIEW[1]],k=(Math.max(s[0],s[1])-(nv.x*s[0]+nv.y*s[1]))/Math.hypot(s[0],s[1]);
  const light=k<1e-9?1:1-(GRAFITE_SHADE[0]+(GRAFITE_SHADE[1]-GRAFITE_SHADE[0])*Math.min(1,k));
  return {corners:[at(0,0),at(1,0),at(1,1),at(0,1)],light,depth:depth(origin.x+(e.c+e.w/2)*cell,origin.y+(e.r+e.h/2)*cell,view,pivot)};
}
