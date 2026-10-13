/**
 * Screen-space geometry of the city layer (card cidade-03a): block pieces as boxes (visible walls + cap,
 * ruined roofs with a bite) and ground cells as quads with smooth corner heights, for any of the 4 views.
 * Work happens in view space q (projection.viewPoint), where every piece is an axis-aligned box and the
 * camera always sees the +qx face (screen right-down, dark), the +qy face (screen left-down, lit) and the top.
 */
import type {CityAsset,GroundKind} from './asset.ts';
import {groundAt,heightAt} from './asset.ts';
import {RUIN_FLOOR,type BlockPiece,type CityChunk} from './chunks.ts';
import type {Pt} from './projection.ts';
import {DEPTH_SCALE,HEIGHT_PX,TILE_X,TILE_Y,VIEW_PIVOT,normalizeView,project,rotate,viewPoint} from './projection.ts';

export type FaceKind='cap'|'wallLight'|'wallDark';
export interface Face {kind:FaceKind;points:Pt[]}
/** Faces back-to-front (walls first, top cap last), outline polylines, and the piece's draw-order key. */
export interface PieceGeometry {faces:Face[];outline:Pt[][];depthKey:number}

/** Ruined roof: the bite's floor sits at this fraction of the piece height. */
export {RUIN_FLOOR};
/** Ground shade per unit of screen-space slope (clamped to [-1,1]). */
export const SHADE_GAIN=4;

type Q=[number,number,number];
type QSide='+x'|'-x'|'+y'|'-y';
type Side='n'|'s'|'e'|'w';
const NORMALS:Record<Side,[number,number]>={n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]};

/** View-space side faced by a world side in a view. */
export function viewSide(side:Side,view:number):QSide{
  const [x,y]=NORMALS[side],r=rotate(x,y,view);
  return r.x>0.5?'+x':r.x<-0.5?'-x':r.y>0.5?'+y':'-y';
}

const toScreen=(q:Q):Pt=>({x:(q[0]-q[1])*TILE_X,y:(q[0]+q[1])*TILE_Y-q[2]*HEIGHT_PX});
const rectQ=(x0:number,y0:number,x1:number,y1:number,z:number):Q[]=>[[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]];

/**
 * Wall polygon on a plane of constant q (axis 0 = constant qx, runs along qy; axis 1 = constant qy, runs
 * along qx) from a0 to a1, z0 up to z1, lowered to zb over [s0,s1] when a roof bite touches it.
 */
function wallQ(axis:0|1,at:number,a0:number,a1:number,z0:number,z1:number,step:[number,number]|null,zb:number):Q[]{
  const p=(a:number,z:number):Q=>axis===0?[at,a,z]:[a,at,z];
  const top:Q[]=!step?[p(a1,z1),p(a0,z1)]
    :step[1]>=a1?[p(a1,zb),p(step[0],zb),p(step[0],z1),p(a0,z1)]
    :[p(a1,z1),p(step[1],z1),p(step[1],zb),p(a0,zb)];
  return [p(a0,z0),p(a1,z0),...top];
}

/**
 * Faces and outline of a piece in a view. Seam sides (internal edges of a split block) get no wall and no
 * outline. A ruined building loses a square bite at its world north-east roof corner, floored at
 * RUIN_FLOOR of its height, showing the bite's inner walls that face the camera.
 */
export function pieceGeometry(piece:BlockPiece,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):PieceGeometry{
  const v=normalizeView(view),{cell,origin}=asset;
  const a=viewPoint(origin.x+piece.x*cell,origin.y+piece.y*cell,v,pivot),b=viewPoint(origin.x+(piece.x+piece.w)*cell,origin.y+(piece.y+piece.h)*cell,v,pivot);
  const qx0=Math.min(a.x,b.x),qx1=Math.max(a.x,b.x),qy0=Math.min(a.y,b.y),qy1=Math.max(a.y,b.y);
  const zb=piece.base+RUIN_FLOOR*piece.height;
  // A bite covering the whole column (unit pieces, bite >= 1 cell) lowers the column to the bite floor; its
  // neighbours close the hole with their (dark) step walls, as chunks.ts computes the drops from that floor.
  const whole=piece.kind==='building'&&(piece.bite??0)>=Math.min(piece.w,piece.h)-1e-9;
  const z0=piece.base,z1=whole?zb:piece.base+piece.height;
  const seams=new Set<QSide>();
  for(const s of ['n','s','e','w'] as const)if(piece.seams[s])seams.add(viewSide(s,v));
  const faces:{kind:FaceKind;q:Q[]}[]=[];
  // Roof bite (ruined buildings only).
  // Bite side in cells (chunks.ts ruinBite: a third of the block's shortest edge, at most 1 cell), on one piece only.
  const bs=!whole&&piece.kind==='building'&&piece.bite!==undefined&&piece.bite>0?Math.min(piece.bite,Math.min(piece.w,piece.h)):0;
  let bite:{x0:number;x1:number;y0:number;y1:number;sx:QSide;sy:QSide}|null=null;
  if(bs>0){
    const n=viewSide('n',v),e=viewSide('e',v),sx=n[1]==='x'?n:e,sy=n[1]==='y'?n:e,d=bs*cell;
    bite={x0:sx==='+x'?qx1-d:qx0,x1:sx==='+x'?qx1:qx0+d,y0:sy==='+y'?qy1-d:qy0,y1:sy==='+y'?qy1:qy0+d,sx,sy};
    faces.push({kind:'cap',q:rectQ(bite.x0,bite.y0,bite.x1,bite.y1,zb)});
    // Inner walls: the remaining roof faces into the bite; only +qx / +qy normals face the camera.
    // Both are dark whatever their screen side (art bible §8.4: inner faces of a ruin are dark).
    if(sx==='+x')faces.push({kind:'wallDark',q:wallQ(0,bite.x0,bite.y0,bite.y1,zb,z1,null,zb)});
    if(sy==='+y')faces.push({kind:'wallDark',q:wallQ(1,bite.y0,bite.x0,bite.x1,zb,z1,null,zb)});
  }
  if(!seams.has('+y'))faces.push({kind:'wallLight',q:wallQ(1,qy1,qx0,qx1,z0,z1,bite&&bite.sy==='+y'?[bite.x0,bite.x1]:null,zb)});
  if(!seams.has('+x'))faces.push({kind:'wallDark',q:wallQ(0,qx1,qy0,qy1,z0,z1,bite&&bite.sx==='+x'?[bite.y0,bite.y1]:null,zb)});
  // Stepped ruin roof: on a camera-facing seam where the neighbour is lower, close the step with a wall from the
  // neighbour's top up to ours (outlined on its own: the seam rule would drop every edge of this face).
  const stepWalls:{kind:FaceKind;q:Q[]}[]=[];
  for(const s of ['n','s','e','w'] as const){
    const drop=piece.drops?.[s];
    if(!drop||!piece.seams[s])continue;
    const side=viewSide(s,v);
    // Exposed inside of a broken slab: dark whatever the screen side (art bible §4.3).
    if(side==='+y')stepWalls.push({kind:'wallDark',q:wallQ(1,qy1,qx0,qx1,z1-drop,z1,null,zb)});
    else if(side==='+x')stepWalls.push({kind:'wallDark',q:wallQ(0,qx1,qy0,qy1,z1-drop,z1,null,zb)});
  }
  faces.push(...stepWalls);
  let cap=rectQ(qx0,qy0,qx1,qy1,z1);
  if(bite){
    // Replace the bitten corner by the three corners of the notch, keeping the winding.
    const cx=bite.sx==='+x'?qx1:qx0,cy=bite.sy==='+y'?qy1:qy0,ix=bite.sx==='+x'?bite.x0:bite.x1,iy=bite.sy==='+y'?bite.y0:bite.y1;
    const i=cap.findIndex(p=>p[0]===cx&&p[1]===cy),prev=cap[(i+3)%4];
    const notch:Q[]=prev[0]===cx?[[cx,iy,z1],[ix,iy,z1],[ix,cy,z1]]:[[ix,cy,z1],[ix,iy,z1],[cx,iy,z1]];
    cap=[...cap.slice(0,i),...notch,...cap.slice(i+1)];
  }
  faces.push({kind:'cap',q:cap});
  // A seam where this piece stands taller than its neighbour is a visible step edge: keep its outline (the
  // camera-facing step wall is outlined on its own; an away-facing step still needs the cap edge).
  const lineSeams=new Set<QSide>();
  for(const s of ['n','s','e','w'] as const)if(piece.seams[s]&&!piece.drops?.[s])lineSeams.add(viewSide(s,v));
  const onSeam=(p:Q,r:Q)=>(lineSeams.has('+x')&&p[0]===qx1&&r[0]===qx1)||(lineSeams.has('-x')&&p[0]===qx0&&r[0]===qx0)
    ||(lineSeams.has('+y')&&p[1]===qy1&&r[1]===qy1)||(lineSeams.has('-y')&&p[1]===qy0&&r[1]===qy0);
  const outline:Pt[][]=[];
  for(const f of faces){
    if(stepWalls.includes(f)){const pts=f.q.map(toScreen);outline.push([...pts,pts[0]]);continue;}
    const n=f.q.length,cut=f.q.findIndex((p,i)=>onSeam(p,f.q[(i+1)%n]));
    if(cut<0){const pts=f.q.map(toScreen);outline.push([...pts,pts[0]]);continue;}
    let line:Pt[]=[];
    for(let k=1;k<=n;k++){
      const i=(cut+k)%n,j=(i+1)%n;
      if(!line.length)line.push(toScreen(f.q[i]));
      if(onSeam(f.q[i],f.q[j])){if(line.length>1)outline.push(line);line=[];}
      else line.push(toScreen(f.q[j]));
    }
    if(line.length>1)outline.push(line);
  }
  // Sort key = the column's centre. For unit columns this orders columns among themselves and against point
  // actors at depth(feet) correctly, including actors beside a wall (a front-corner key put an actor standing
  // in front of the +qx or +qy wall behind the column). Only contact within the actor radius at a corner remains.
  return {faces:faces.map(f=>({kind:f.kind,points:f.q.map(toScreen)})),outline,depthKey:(qx0+qx1+qy0+qy1)/2*DEPTH_SCALE};
}

export interface GroundQuad {cx:number;cy:number;kind:GroundKind;points:Pt[];shade:number}

/** Height of the grid vertex (i,j): the asset's exact corner height when given, else the mean of the up-to-4 cells. */
export function cornerHeight(asset:CityAsset,i:number,j:number){
  if(asset.corners&&i>=0&&j>=0&&i<=asset.width&&j<=asset.height)return asset.corners[j*(asset.width+1)+i];
  let sum=0,n=0;
  for(let y=j-1;y<=j;y++)for(let x=i-1;x<=i;x++)if(x>=0&&y>=0&&x<asset.width&&y<asset.height){sum+=heightAt(asset,x,y);n++;}
  return n?sum/n:0;
}

/**
 * One quad per chunk cell (points NW, NE, SE, SW in world order, projected), back-to-front for the view.
 * `shade` is the screen-space slope towards the light, which comes from the same side as the lit wall (the face with
 * normal +qy, screen left-down): positive when the cell descends toward +qy (faces the light), 0 on flat ground.
 */
export function groundQuads(chunk:CityChunk,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):GroundQuad[]{
  const v=normalizeView(view),{cell,origin}=asset,slopeToPx=HEIGHT_PX/Math.hypot(TILE_X,TILE_Y);
  const out:{q:GroundQuad;key:number}[]=[];
  for(let cy=chunk.y0;cy<chunk.y1;cy++)for(let cx=chunk.x0;cx<chunk.x1;cx++){
    const x0=origin.x+cx*cell,y0=origin.y+cy*cell,x1=x0+cell,y1=y0+cell;
    const nw=cornerHeight(asset,cx,cy),ne=cornerHeight(asset,cx+1,cy),se=cornerHeight(asset,cx+1,cy+1),sw=cornerHeight(asset,cx,cy+1);
    const g=rotate((ne+se-nw-sw)/(2*cell),(sw+se-nw-ne)/(2*cell),v);
    const shade=Math.max(-1,Math.min(1,-g.y*slopeToPx*SHADE_GAIN))||0;
    const r=rotate(cx,cy,v);
    out.push({key:r.x+r.y,q:{cx,cy,kind:groundAt(asset,cx,cy),shade,
      points:[project(x0,y0,nw,v,pivot),project(x1,y0,ne,v,pivot),project(x1,y1,se,v,pivot),project(x0,y1,sw,v,pivot)]}});
  }
  out.sort((a,b)=>a.key-b.key||a.q.cy-b.q.cy||a.q.cx-b.q.cx);
  return out.map(o=>o.q);
}
