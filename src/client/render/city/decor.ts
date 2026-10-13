/**
 * Deterministic decoration of the city layer (card cidade-03a; art bible design/cidade-nevada-arte.md §8 items
 * 2, 3, 4, 5 and 7): ground detail per cell, cast shadows, snow icing, windows, plaster, icicles and ruin rubble.
 * Pure logic (no Phaser): every function returns screen-space primitives in the pixel space of project().
 * Every feature is anchored to the world (a cell, or a block's world wall cell) and seeded by a stable string, so
 * it is the same set of features in every frame, view and client; a view only changes how it is projected and
 * whether a wall faces the camera. Colours come only from palette.ts.
 */
import type {CityAsset} from './asset.ts';
import {groundAt} from './asset.ts';
import type {BlockPiece,CityChunk} from './chunks.ts';
import {RUIN_FLOOR,groundQuads,viewSide} from './faces.ts';
import {CITY_PALETTE,MATERIALS,OUTLINE_PX,SHADOW} from './palette.ts';
import type {Pt} from './projection.ts';
import {HEIGHT_PX,TILE_X,TILE_Y,VIEW_PIVOT,normalizeView,project,viewPoint} from './projection.ts';

/** Where the layer draws a primitive: groundDecor → 'ground', pieceShadow → 'shadow' (ground, below blocks), pieceDecor → 'piece' (right after the piece's faces). */
export type DecorLayer='ground'|'shadow'|'piece';
export interface DecorPrim {shape:'poly'|'circle'|'line';color:number;alpha:number;points?:Pt[];cx?:number;cy?:number;r?:number;width?:number;
  /** Slow shimmer allowed (fountain glint only); the layer skips the animation under prefers-reduced-motion. */ shimmer?:boolean}

/** Detail specks per cell (inclusive count ranges) and their screen radius in px. */
export const SPECKS=Object.freeze({snow:[3,6],packed:[2,4],rubble:[1,2],px:[1,1.8]} as const);
/** Street ruts: chance a lane (row or column) has a pair, chance a cell breaks it, line width in px. */
export const TRACK=Object.freeze({lane:0.6,gap:0.12,width:1.6,alpha:0.85});
/** Fountain: a glint on a water cell with this chance, at most this many per chunk (picked in world order). */
export const GLINT=Object.freeze({chance:0.4,perChunk:4});
/** Icing (bible §3: "desce 3–5 px pela parede em ondas largas"): hang depth in px and broad waves per wall cell. */
export const ICING_PX=Object.freeze({min:3,max:5,wavesPerCell:2});
/** Cast shadow length on the ground per world unit of height, toward screen right-down (+qx: same screen direction in every view). */
export const SHADOW_LENGTH=0.5;
/** Length and opacity of the cast shadows (the lighting card passes the sun's: render/light.ts). */
export interface ShadowLook {readonly length:number;readonly color:number;readonly alpha:number}
export const FLAT_SHADOW:ShadowLook=Object.freeze({length:SHADOW_LENGTH,color:SHADOW.color,alpha:SHADOW.alpha});
/** Ruin rubble on the bite floor (bible §4.4: ≤ 0.3 u). */
export const BITE_RUBBLE_MAX_HEIGHT=0.28;

const C=CITY_PALETTE;
type WallFace='wallLight'|'wallDark';
const ICING:Record<WallFace,number>={wallLight:MATERIALS['neve-tampa'].clara,wallDark:MATERIALS['neve-tampa'].escura};
const GLASS:Record<WallFace,number>={wallLight:MATERIALS.vidro.clara,wallDark:MATERIALS.vidro.escura};
const BRICK:Record<WallFace,number>={wallLight:C['parede-clara'],wallDark:C['parede-escura']};
const RUBBLE:Record<WallFace|'cap',number>={cap:C.tampa,wallLight:C['entulho-clara'],wallDark:C['entulho-escura']};

/** FNV-1a 32-bit hash of a key. */
export function hashKey(key:string):number{
  let h=0x811c9dc5;
  for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,0x01000193);}
  return h>>>0;
}
/** mulberry32 stream seeded by hashKey(key): values in [0,1), the same sequence for the same key everywhere. */
export function seeded(key:string):()=>number{
  let a=hashKey(key);
  return ()=>{a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
}

const lerp=(a:Pt,b:Pt,t:number):Pt=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const poly=(color:number,points:Pt[],alpha=1):DecorPrim=>({shape:'poly',color,alpha,points});
const line=(color:number,points:Pt[],width:number,alpha=1):DecorPrim=>({shape:'line',color,alpha,points,width});
const between=(r:()=>number,lo:number,hi:number)=>lo+r()*(hi-lo);
const count=(r:()=>number,[lo,hi]:readonly [number,number])=>lo+Math.floor(r()*(hi-lo+1));

/** Convex hull (Andrew's monotone chain), counter-clockwise on screen. */
function hull(points:Pt[]):Pt[]{
  const p=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(p.length<3)return p;
  const cross=(o:Pt,a:Pt,b:Pt)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo:Pt[]=[],hi:Pt[]=[];
  for(const q of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(let i=p.length-1;i>=0;i--){const q=p[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}
  return [...lo.slice(0,-1),...hi.slice(0,-1)];
}

// ---------------------------------------------------------------------------------------------------------------
// Ground. A cell's features live in its local (u,v) ∈ [0,1]² (u east, v south); the screen point is the bilinear
// blend of the projected quad corners (NW, NE, SE, SW), which is exact for a planar cell and stays inside the quad.

type At=(u:number,v:number)=>Pt;
type Edge='n'|'s'|'e'|'w';
const NEIGHBOUR:Record<Edge,[number,number]>={n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]};
/** (u,v) of a point at s ∈ [0,1] along a cell edge, d inward from it. */
const onEdge=(edge:Edge,s:number,d:number):[number,number]=>edge==='n'?[s,d]:edge==='s'?[s,1-d]:edge==='w'?[d,s]:[1-d,s];
/** The edges met at the s = 0 and s = 1 ends of an edge. */
const ENDS:Record<Edge,[Edge,Edge]>={n:['w','e'],s:['w','e'],w:['n','s'],e:['n','s']};

function specks(out:DecorPrim[],at:At,r:()=>number,range:readonly [number,number],color:number){
  const n=count(r,range);
  for(let i=0;i<n;i++){const p=at(between(r,0.14,0.86),between(r,0.14,0.86));out.push({shape:'circle',color,alpha:1,cx:p.x,cy:p.y,r:between(r,SPECKS.px[0],SPECKS.px[1])});}
}

/** Ruts on packed snow along the street: the axis is the longer packed run through the cell (both on ties, e.g. crossings). */
function tracks(out:DecorPrim[],asset:CityAsset,cx:number,cy:number,at:At){
  const run=(dx:number,dy:number)=>{let n=0;while(n<4&&groundAt(asset,cx+dx*(n+1),cy+dy*(n+1))==='packed')n++;return n;};
  const rx=run(1,0)+run(-1,0),ry=run(0,1)+run(0,-1);
  for(const axis of ['x','y'] as const){
    if(axis==='x'?!(rx>0&&rx>=ry):!(ry>0&&ry>=rx))continue;
    // A lane is a world row (x axis) or column (y axis): its ruts keep their offset along the whole street and
    // meet the neighbour cell's ruts exactly at the shared edge (wobble seeded by the edge, not the cell).
    const lane=axis==='x'?cy:cx,along=axis==='x'?cx:cy,lr=seeded(`track|${axis}|${lane}`);
    if(lr()>=TRACK.lane||seeded(`track|${axis}|${cx},${cy}`)()<TRACK.gap)continue;
    const mid=between(lr,0.3,0.7),half=between(lr,0.08,0.12);
    const wob=(b:number)=>(seeded(`track|${axis}|${lane}|${b}`)()-0.5)*0.08,w0=wob(along),w1=wob(along+1);
    const mr=seeded(`track|${axis}|${cx},${cy}|mid`);
    for(const off of [-half,half]){
      const l=[mid+off+w0,mid+off+(w0+w1)/2+(mr()-0.5)*0.05,mid+off+w1],s=[0,0.5,1];
      out.push(line(C['neve-pisada-detalhe'],s.map((a,i)=>axis==='x'?at(a,l[i]):at(l[i],a)),TRACK.width,TRACK.alpha));
    }
  }
}

/** Cobble joints: three courses per cell along world x, staggered by global course parity; some joints hold snow. */
function cobble(out:DecorPrim[],cy:number,at:At,r:()=>number){
  for(let k=0;k<3;k++){
    const v0=k/3,v1=(k+1)/3;
    out.push(line(C['calcada-junta'],[at(0,v0),at(1,v0)],1));
    const off=(cy*3+k)%2?0.25:0;
    for(const u of [off,off+0.5]){
      const uu=u>0?u+(r()-0.5)*0.1:0,snow=r()<0.2;
      out.push(line(snow?C.neve:C['calcada-junta'],[at(uu,v0),at(uu,v1)],1));
    }
  }
}

function ice(out:DecorPrim[],at:At,r:()=>number){
  let u=between(r,0.25,0.75),v=between(r,0.25,0.75);const crack=[at(u,v)];
  for(let i=0;i<2;i++){const a=r()*Math.PI*2,d=between(r,0.12,0.22);u=Math.min(0.88,Math.max(0.12,u+Math.cos(a)*d));v=Math.min(0.88,Math.max(0.12,v+Math.sin(a)*d));crack.push(at(u,v));}
  out.push(line(C['gelo-detalhe'],crack,1));
  const n=count(r,[1,2]);
  for(let i=0;i<n;i++){
    const gu=between(r,0.2,0.8),gv=between(r,0.2,0.8),s=between(r,0.04,0.07);
    out.push(poly(C['gelo-brilho'],[at(gu-s,gv),at(gu,gv-s),at(gu+s,gv),at(gu,gv+s)]));
  }
}

function rubbleGround(out:DecorPrim[],at:At,r:()=>number){
  const n=count(r,[3,5]);
  for(let i=0;i<n;i++){
    const u=between(r,0.2,0.8),v=between(r,0.2,0.8),rad=between(r,0.05,0.09),rot=r()*Math.PI*2,pts:Pt[]=[];
    for(let k=0;k<5;k++){const a=rot+k*Math.PI*2/5,d=rad*between(r,0.7,1);pts.push(at(u+Math.cos(a)*d,v+Math.sin(a)*d));}
    out.push(poly(C['entulho-chao-detalhe'],pts));
    if(r()<0.4){const p=at(u,v-rad*0.3);out.push({shape:'circle',color:C.neve,alpha:1,cx:p.x,cy:p.y,r:1});}
  }
  specks(out,at,r,SPECKS.rubble,C['entulho-chao-detalhe']);
}

/** Fountain water (bible §8.7): shallow tone, ice rim and foam ring on edges that touch non-water; glint picked per chunk. */
function water(out:DecorPrim[],asset:CityAsset,cx:number,cy:number,at:At,glint:boolean){
  const rim=(e:Edge)=>groundAt(asset,cx+NEIGHBOUR[e][0],cy+NEIGHBOUR[e][1])!=='water';
  const edges=(['n','e','s','w'] as const).filter(rim),band=(e:Edge,d0:number,d1:number)=>[onEdge(e,0,d0),onEdge(e,1,d0),onEdge(e,1,d1),onEdge(e,0,d1)].map(([u,v])=>at(u,v));
  for(const e of edges)out.push(poly(C['agua-raso'],band(e,0,0.36)));
  for(const e of edges)out.push(poly(C.gelo,band(e,0,0.13)));
  for(const e of edges){
    // Trim the ring where it meets the ring of the perpendicular rim edge, so the corners join.
    const [a,b]=ENDS[e],s0=rim(a)?0.24:0,s1=rim(b)?0.76:1;
    out.push(line(C['gelo-brilho'],[onEdge(e,s0?0.05:0,0.05),onEdge(e,s1<1?0.95:1,0.05)].map(([u,v])=>at(u,v)),1));
    out.push(line(C['agua-espuma'],[onEdge(e,s0,0.24),onEdge(e,s1,0.24)].map(([u,v])=>at(u,v)),2,0.9));
  }
  if(glint){
    const r=seeded(`glint|${cx},${cy}|at`),u=between(r,0.35,0.65),v=between(r,0.35,0.65),s=0.06;
    out.push({...poly(C['gelo-brilho'],[at(u-s,v),at(u,v-s*0.6),at(u+s,v),at(u,v+s*0.6)],0.9),shimmer:true});
  }
}

/**
 * Ground decoration of a chunk, cell by cell in the back-to-front order of groundQuads. Every primitive stays inside
 * its cell's quad; street ruts end exactly on the cell edge where the next packed cell's ruts start.
 */
export function groundDecor(chunk:CityChunk,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):DecorPrim[]{
  const v=normalizeView(view),out:DecorPrim[]=[],glints=new Set<string>();
  // Glints are chosen in world row-major order, so the cap picks the same cells in every view.
  for(let cy=chunk.y0;cy<chunk.y1&&glints.size<GLINT.perChunk;cy++)for(let cx=chunk.x0;cx<chunk.x1&&glints.size<GLINT.perChunk;cx++)
    if(groundAt(asset,cx,cy)==='water'&&seeded(`glint|${cx},${cy}`)()<GLINT.chance)glints.add(`${cx},${cy}`);
  for(const q of groundQuads(chunk,asset,v,pivot)){
    const [nw,ne,se,sw]=q.points,at:At=(u,w)=>lerp(lerp(nw,ne,u),lerp(sw,se,u),w),r=seeded(`${q.kind}|${q.cx},${q.cy}`);
    switch(q.kind){
      case 'snow':specks(out,at,r,SPECKS.snow,C['neve-detalhe']);break;
      case 'packed':tracks(out,asset,q.cx,q.cy,at);specks(out,at,r,SPECKS.packed,C['neve-pisada-detalhe']);break;
      case 'cobble':cobble(out,q.cy,at,r);break;
      case 'ice':ice(out,at,r);break;
      case 'rubble':rubbleGround(out,at,r);break;
      case 'water':water(out,asset,q.cx,q.cy,at,glints.has(`${q.cx},${q.cy}`));break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Shadow.

/**
 * Hard cast shadow of a piece (bible §2.3/§3: Breu at 22%, toward screen right-down, length ∝ height, the same screen
 * direction in every view), on the ground plane z = base. The offset is +qx in view space (screen (42, 21)·L), so the
 * shadow is the footprint stretched along +qx: the hull of the footprint and the footprint moved by the offset. A
 * piece whose +qx side is a seam returns only its footprint (hidden under the block): the block's pieces then tile
 * the block's shadow exactly, with no overlapping 22% layers.
 */
/**
 * Cast shadows of `pieces` clipped to the world cell rect [x0,x1)×[y0,y1), as disjoint polygons: overlapping
 * shadows must not stack (two 22% layers would break the contrast rule). Each piece's shadow is a view-space
 * rect (its footprint stretched by SHADOW_LENGTH·height along +qx, screen right-down); rects of the same base
 * height are merged by coordinate compression and split into disjoint strips. Pass the pieces of the chunk and
 * of its neighbours so shadows crossing a chunk border are drawn once, by the chunk they land on.
 */
export function shadowUnion(pieces:readonly BlockPiece[],asset:CityAsset,region:{x0:number;y0:number;x1:number;y1:number},view:number,pivot:Pt=VIEW_PIVOT,look:ShadowLook=FLAT_SHADOW):DecorPrim[]{
  const v=normalizeView(view),{cell,origin}=asset,out:DecorPrim[]=[];
  const q=(cx:number,cy:number)=>viewPoint(origin.x+cx*cell,origin.y+cy*cell,v,pivot);
  const ra=q(region.x0,region.y0),rb=q(region.x1,region.y1);
  const clip={x0:Math.min(ra.x,rb.x),x1:Math.max(ra.x,rb.x),y0:Math.min(ra.y,rb.y),y1:Math.max(ra.y,rb.y)};
  const byBase=new Map<number,{x0:number;x1:number;y0:number;y1:number}[]>();
  for(const p of pieces){
    const a=q(p.x,p.y),b=q(p.x+p.w,p.y+p.h);
    const seam=(['n','s','e','w'] as const).some(s=>p.seams[s]&&viewSide(s,v)==='+x');
    const L=seam?0:look.length*p.height;
    const r={x0:Math.max(clip.x0,Math.min(a.x,b.x)),x1:Math.min(clip.x1,Math.max(a.x,b.x)+L),y0:Math.max(clip.y0,Math.min(a.y,b.y)),y1:Math.min(clip.y1,Math.max(a.y,b.y))};
    if(!(r.x1>r.x0&&r.y1>r.y0))continue;
    const list=byBase.get(p.base);if(list)list.push(r);else byBase.set(p.base,[r]);
  }
  const toScreen=(qx:number,qy:number,z:number):Pt=>({x:(qx-qy)*TILE_X,y:(qx+qy)*TILE_Y-z*HEIGHT_PX});
  for(const base of [...byBase.keys()].sort((a,b)=>a-b)){
    const rects=byBase.get(base)!;
    const xs=[...new Set(rects.flatMap(r=>[r.x0,r.x1]))].sort((a,b)=>a-b),ys=[...new Set(rects.flatMap(r=>[r.y0,r.y1]))].sort((a,b)=>a-b);
    for(let j=0;j+1<ys.length;j++){
      // Strip [ys[j],ys[j+1]): merge covered x-intervals into runs.
      let run=-1;
      for(let i=0;i+1<xs.length;i++){
        const mx=(xs[i]+xs[i+1])/2,my=(ys[j]+ys[j+1])/2;
        const covered=rects.some(r=>mx>r.x0&&mx<r.x1&&my>r.y0&&my<r.y1);
        if(covered&&run<0)run=i;
        if((!covered||i+2===xs.length)&&run>=0){
          const end=covered?xs[i+1]:xs[i];
          out.push(poly(look.color,[toScreen(xs[run],ys[j],base),toScreen(end,ys[j],base),toScreen(end,ys[j+1],base),toScreen(xs[run],ys[j+1],base)],look.alpha));
          run=-1;
        }
      }
    }
  }
  return out;
}

export function pieceShadow(piece:BlockPiece,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT,look:ShadowLook=FLAT_SHADOW):DecorPrim{
  const v=normalizeView(view),{cell,origin}=asset,x0=origin.x+piece.x*cell,y0=origin.y+piece.y*cell,x1=x0+piece.w*cell,y1=y0+piece.h*cell;
  const foot=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>project(x,y,piece.base,v,pivot));
  const seam=(['n','s','e','w'] as const).some(s=>piece.seams[s]&&viewSide(s,v)==='+x');
  const L=seam?0:look.length*piece.height;
  return poly(look.color,hull([...foot,...foot.map(p=>({x:p.x+L*TILE_X,y:p.y+L*TILE_Y}))]),look.alpha);
}

// ---------------------------------------------------------------------------------------------------------------
// Piece decoration. A wall is a world side of the piece; `a` runs along it in absolute cells (x for n/s, y for w/e)
// and z is world height. Features are seeded by `${blockId}:${side}:${x},${y}` of the wall cell, so a window on the
// world-east wall stays there when the view turns and is simply absent while that wall faces away.

type Side='n'|'s'|'e'|'w';
interface Wall {side:Side;face:WallFace;a0:number;a1:number;base:number;top:(a:number)=>number;
  /** Along-position where the top steps down to the bite floor, if any. */ step?:number;at:(a:number,z:number)=>Pt;key:(i:number)=>string}

/** Bite (ruin) side in cells of a piece, 0 when none. */
const biteOf=(p:BlockPiece)=>p.kind==='building'&&p.bite!==undefined&&p.bite>0?Math.min(p.bite,p.w,p.h):0;

/** The piece's walls that face the camera in this view (screen left-down = light, right-down = dark), seams excluded. */
function visibleWalls(piece:BlockPiece,asset:CityAsset,v:number,pivot:Pt):Wall[]{
  const {cell,origin}=asset,X=(i:number)=>origin.x+i*cell,Y=(j:number)=>origin.y+j*cell;
  const z1=piece.base+piece.height,zb=piece.base+RUIN_FLOOR*piece.height,b=biteOf(piece),out:Wall[]=[];
  for(const side of ['n','e','s','w'] as const){
    const q=viewSide(side,v);
    if(piece.seams[side]||(q!=='+x'&&q!=='+y'))continue;
    const alongX=side==='n'||side==='s';
    const fixed=side==='n'?piece.y:side==='s'?piece.y+piece.h:side==='w'?piece.x:piece.x+piece.w;
    const a0=alongX?piece.x:piece.y,a1=alongX?piece.x+piece.w:piece.y+piece.h;
    // The bite sits at the world north-east corner: it lowers the end of the north wall and the start of the east wall.
    const top=(a:number)=>b>0&&((side==='n'&&a>=a1-b)||(side==='e'&&a<=a0+b))?zb:z1;
    const step=b>0&&side==='n'?a1-b:b>0&&side==='e'?a0+b:undefined;
    out.push({side,face:q==='+y'?'wallLight':'wallDark',a0,a1,base:piece.base,top,...(step!==undefined?{step}:{}),
      at:(a,z)=>alongX?project(X(a),Y(fixed),z,v,pivot):project(X(fixed),Y(a),z,v,pivot),
      key:i=>`${piece.blockId}:${side}:${alongX?i:fixed-(side==='e'?1:0)},${alongX?fixed-(side==='s'?1:0):i}`});
  }
  return out;
}

/** Lowest wall top over [a, b] (the bite step is the only change). */
const minTop=(w:Wall,a:number,b:number)=>Math.min(w.top(a),w.top(b),w.top((a+b)/2));

/** Scalloped snow overhang under the cap edge: one polygon + Breu line per run of equal wall top. */
function icing(out:DecorPrim[],w:Wall){
  const steps=ICING_PX.wavesPerCell*4;
  const runs:[number,number][]=w.step!==undefined&&w.step>w.a0+1e-9&&w.step<w.a1-1e-9?[[w.a0,w.step],[w.step,w.a1]]:[[w.a0,w.a1]];
  const amp=(a:number)=>{
    const cellI=Math.min(Math.floor(a),Math.ceil(w.a1)-1),j=Math.min(ICING_PX.wavesPerCell-1,Math.floor((a-cellI)*ICING_PX.wavesPerCell));
    const t=(a-cellI)*ICING_PX.wavesPerCell-j,r=seeded(`${w.key(cellI)}|icing|${j}`);
    return (ICING_PX.min+between(r,ICING_PX.max-ICING_PX.min-1,ICING_PX.max-ICING_PX.min)*Math.sin(Math.PI*t));
  };
  for(const [s,e] of runs){
    if(e-s<1e-6)continue;
    const top=w.top((s+e)/2),cap=Math.min(1,(top-w.base)*HEIGHT_PX*0.5/ICING_PX.max),bottom:Pt[]=[];
    const n=Math.max(2,Math.ceil((e-s)*steps));
    for(let k=0;k<=n;k++){const a=s+(e-s)*k/n;bottom.push(w.at(a,top-amp(a)*cap/HEIGHT_PX));}
    out.push(poly(ICING[w.face],[w.at(s,top),w.at(e,top),...[...bottom].reverse()]));
    out.push(line(C.breu,bottom,OUTLINE_PX.block));
  }
}

/** Windows, plaster and icicles of one wall cell (buildings only). */
function wallCell(out:DecorPrim[],w:Wall,i:number,ruined:boolean){
  const lo=Math.max(w.a0,i),hi=Math.min(w.a1,i+1),top=minTop(w,lo,hi),base=w.base,key=w.key(i);
  if(hi-lo<0.5)return;
  // Fallen plaster (bible §4.6): parede-detalhe patches with a few bricks drawn on them.
  const pr=seeded(`${key}|plaster`);
  if(pr()<(ruined?0.5:0.3)){
    const hw=between(pr,0.16,0.26),hh=between(pr,0.12,0.2),ca=(lo+hi)/2+(pr()-0.5)*0.2,zlo=base+0.2+hh,zhi=top-0.45-hh,cz=between(pr,zlo,zhi);
    const rot=pr()*Math.PI,pts:Pt[]=[],jit=Array.from({length:7},()=>between(pr,0.75,1));
    const bricks=count(pr,[2,3]),bs=Array.from({length:bricks},()=>[between(pr,-0.4,0.4),between(pr,-0.35,0.35)]);
    if(zhi>zlo){
      for(let k=0;k<7;k++){const a=rot+k*Math.PI*2/7;pts.push(w.at(ca+Math.cos(a)*hw*jit[k],cz+Math.sin(a)*hh*jit[k]));}
      out.push(poly(MATERIALS.tijolo.detalhe,pts));
      for(const [du,dz] of bs){
        const ba=ca+du*hw,bz=cz+dz*hh,bw=0.06,bh=0.028;
        out.push(poly(BRICK[w.face],[w.at(ba-bw,bz-bh),w.at(ba+bw,bz-bh),w.at(ba+bw,bz+bh),w.at(ba-bw,bz+bh)]));
      }
    }
  }
  // Windows (bible §4.5): dark glass holes with a snow sill; on ruins some are broken (Breu with a glass shard).
  const wr=seeded(`${key}|windows`),hw=0.17,hh=0.19,ca=(lo+hi)/2+(wr()-0.5)*0.1;
  for(let zc=base+0.6;zc+hh<=top-0.4;zc+=0.85){
    const present=wr()<(ruined?0.8:0.85),broken=ruined&&wr()<0.4;
    if(!present)continue;
    const z0=zc-hh,z1=zc+hh,rect=[w.at(ca-hw,z0),w.at(ca+hw,z0),w.at(ca+hw,z1),w.at(ca-hw,z1)];
    if(broken){
      out.push(poly(C.breu,rect));
      out.push(poly(MATERIALS.vidro.luz,[w.at(ca-hw,z1),w.at(ca-hw+between(wr,0.6,1.4)*hw,z1),w.at(ca-hw,z1-between(wr,0.5,1.2)*hh)]));
    }else out.push(poly(GLASS[w.face],rect));
    out.push(poly(C.tampa,[w.at(ca-hw-0.04,z0-0.05),w.at(ca+hw+0.04,z0-0.05),w.at(ca+hw+0.04,z0),w.at(ca-hw-0.04,z0)]));
  }
  // Icicles (bible §4.7): gelo-brilho with a Breu outline, hanging from the cap edge.
  const ir=seeded(`${key}|icicles`),n=ruined?count(ir,[1,3]):Math.floor(ir()*2.6);
  for(let k=0;k<n;k++){
    const a=lo+(hi-lo)*between(ir,0.12,0.88),half=0.045,len=between(ir,6,12)/HEIGHT_PX,t=minTop(w,a-half,a+half);
    const l=w.at(a-half,t),r=w.at(a+half,t),tip=w.at(a,t-len);
    out.push(poly(C['gelo-brilho'],[l,r,tip]));
    out.push(line(C.breu,[l,tip,r],1));
  }
}

/** Mini box (rubble chunk) in world space: cap + the walls that face the camera + a Breu silhouette. */
function rubbleBox(out:DecorPrim[],asset:CityAsset,v:number,pivot:Pt,x0:number,y0:number,x1:number,y1:number,z0:number,z1:number){
  const P=(x:number,y:number,z:number)=>project(x,y,z,v,pivot);
  const sides:Record<Side,[[number,number],[number,number]]>={n:[[x0,y0],[x1,y0]],e:[[x1,y0],[x1,y1]],s:[[x1,y1],[x0,y1]],w:[[x0,y1],[x0,y0]]};
  const all:Pt[]=[];
  for(const s of ['n','e','s','w'] as const){
    const q=viewSide(s,v);if(q!=='+x'&&q!=='+y')continue;
    const [[ax,ay],[bx,by]]=sides[s],pts=[P(ax,ay,z0),P(bx,by,z0),P(bx,by,z1),P(ax,ay,z1)];
    out.push(poly(RUBBLE[q==='+y'?'wallLight':'wallDark'],pts));all.push(...pts);
  }
  const cap=[P(x0,y0,z1),P(x1,y0,z1),P(x1,y1,z1),P(x0,y1,z1)];
  out.push(poly(RUBBLE.cap,cap));
  const h=hull([...all,...cap]);
  out.push(line(C.breu,[...h,h[0]],1));
}

/**
 * Decoration drawn right after a piece's faces: snow icing under the cap edge of every visible outer wall (all
 * kinds); on buildings also windows, plaster patches and icicles per wall cell; on the ruin's bite piece, rubble
 * chunks (≤ 0.3 u, snow on top) at the foot of the bite, shown when the bite opens toward the camera (both its
 * world sides face the camera; otherwise the roof hides most of the floor). Nothing on seams or other bite faces.
 */
export function pieceDecor(piece:BlockPiece,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):DecorPrim[]{
  const v=normalizeView(view),out:DecorPrim[]=[],building=piece.kind==='building',ruined=!!piece.ruined;
  const b=biteOf(piece);
  if(b>0){
    const front=(s:Side)=>{const q=viewSide(s,v);return q==='+x'||q==='+y';};
    // A whole-cell bite lowers the column (chunks.ts): its floor is open to the camera in every view. A partial bite
    // only shows its floor when both bite sides face the camera (the roof hides it otherwise).
    const whole=b>=Math.min(piece.w,piece.h)-1e-9;
    if(whole||(front('n')&&front('e'))){
      const {cell,origin}=asset,zb=piece.base+RUIN_FLOOR*piece.height,r=seeded(`${piece.blockId}:bite`);
      // Inner corner of the bite (where the remaining roof's walls meet), in cells.
      const ix=piece.x+piece.w-b,iy=piece.y+b,n=count(r,[2,3]),boxes:{q:number;box:number[]}[]=[];
      for(let k=0;k<n;k++){
        const cx=ix+b*between(r,0.22,0.5),cy=iy-b*between(r,0.22,0.5),hx=b*between(r,0.08,0.15),hy=b*between(r,0.08,0.15);
        const hz=between(r,0.1,BITE_RUBBLE_MAX_HEIGHT),X=(c:number)=>origin.x+c*cell,Y=(c:number)=>origin.y+c*cell;
        const c=viewPoint(X(cx),Y(cy),v,pivot);
        boxes.push({q:c.x+c.y,box:[X(cx-hx),Y(cy-hy),X(cx+hx),Y(cy+hy),zb,zb+hz]});
      }
      boxes.sort((p,q)=>p.q-q.q);
      for(const {box:[x0,y0,x1,y1,z0,z1]} of boxes)rubbleBox(out,asset,v,pivot,x0,y0,x1,y1,z0,z1);
    }
  }
  for(const w of visibleWalls(piece,asset,v,pivot)){
    if(building)for(let i=Math.floor(w.a0);i<Math.ceil(w.a1);i++)wallCell(out,w,i,ruined);
    icing(out,w);
  }
  return out;
}
