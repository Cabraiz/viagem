/**
 * Cenário vivo (card NEW-20261016-ORQ-cenario-vivo-render), the pure half: what moves and glows on top of the new
 * scenery pieces that the city layer draws from the asset's `decor` list (E1, cenario-no-mapa). No Phaser, no DOM.
 *
 * The decor base image is E1's: CityLayer creates it and hands it to the live layer (live/layer.ts) with the art view
 * the frame shows. Everything here is placed relative to that image's art cell, so it follows whatever origin and scale
 * the base uses:
 * - place overlays (meta `anims`): `<id>-anim-<name>` loops, 1 row of frames per view, top-left at anims[name][view]
 *   (art px of the base cell), 8–10 fps (pedido 10 §2c);
 * - lit objects (`fogueira-tambor`, `luminaria-quebrada-pisca`): `<id>-anim` frames the size of the base cell;
 * - wires (meta `wires`, pedido 10 §5): 3 insulator tips per view on every `poste-concreto` / `poste-gato`; each pole
 *   is wired to its nearest neighbour on the same sidewalk (same row or column ±1, ≤ WIRE_MAX_CELLS), sagging
 *   catenaries, dark grey 2 px with snow on top;
 * - lights: a warm glow on the lamp head (LIGHT_HEADS, measured from the delivery) and a pool on the ground below;
 * - nests (D-051): `ninho-<tema>-<ativo|dormindo|destruido>`, the theme seeded by the nest id.
 * With reduced motion every loop stays on its first frame and every light is steady.
 */
import {hashId} from '../chunks.ts';

export type ArtView=0|90|180|270;
export const ART_VIEWS:readonly ArtView[]=[0,90,180,270];
/** A scenery piece as the city asset lists it (E1): top-left cell, footprint after rotation, art view at camera 0. */
export interface DecorEntry {id:string;c:number;r:number;w:number;h:number;rot:number;links?:number}
/** Art view a decor shows under camera view `view` (0..3): the piece's own rot plus the camera's quarter turns. */
export const artViewOf=(view:number,rot:number):ArtView=>((((Math.round(view)*90+Math.round(rot))%360)+360)%360) as ArtView;
export const viewIndex=(v:ArtView)=>v/90;

/** Where a base image draws its art cell: top-left corner on screen and game px per art px. */
export interface CellFrame {left:number;top:number;scale:number}
/** The base image's art cell frame from its position, origin and scale (Phaser Image fields), cell in art px. */
export const cellFrame=(img:{x:number;y:number;originX:number;originY:number;scaleX:number},cell:readonly [number,number]):CellFrame=>
  ({left:img.x-img.originX*cell[0]*img.scaleX,top:img.y-img.originY*cell[1]*img.scaleX,scale:img.scaleX});
/** Screen point of an art px of the base cell. */
export const cellPoint=(f:CellFrame,p:readonly [number,number])=>({x:f.left+p[0]*f.scale,y:f.top+p[1]*f.scale});

// ---- meta (copied by the importer from the delivery's <id>.meta.json) ----
export type ViewPoints<T>=Partial<Record<string,T>>;
export interface LiveMeta {
  cell?:[number,number];
  anims?:Record<string,ViewPoints<[number,number]>>;
  animCell?:[number,number];animFrames?:number;
  /** Views where a loop shows (E8: one list for every loop, or one per loop name); absent = every view with an offset. */
  animVisibleViews?:ArtView[]|Record<string,ArtView[]>;
  /** One fps for every loop, or one per loop name (both come in the delivery). */
  fps?:number|Record<string,number>;
  wires?:ViewPoints<[number,number][]>;
}
const isPair=(v:unknown):v is [number,number]=>Array.isArray(v)&&v.length===2&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
/** The live parts of a piece's meta, defensively (a public file): malformed parts are dropped. */
export function liveMeta(meta:Record<string,unknown>|undefined):LiveMeta{
  const out:LiveMeta={};
  if(!meta)return out;
  if(isPair(meta.cell))out.cell=meta.cell;
  if(isPair(meta.animCell))out.animCell=meta.animCell;
  if(typeof meta.animFrames==='number'&&meta.animFrames>0)out.animFrames=Math.floor(meta.animFrames);
  if(typeof meta.fps==='number'&&meta.fps>0)out.fps=meta.fps;
  else if(meta.fps&&typeof meta.fps==='object'&&!Array.isArray(meta.fps)){
    const f:Record<string,number>={};
    for(const [k,v] of Object.entries(meta.fps as Record<string,unknown>))if(/^[a-z0-9-]+$/.test(k)&&typeof v==='number'&&v>0)f[k]=v;
    if(Object.keys(f).length)out.fps=f;
  }
  const views=(v:unknown)=>Array.isArray(v)?v.filter((n):n is ArtView=>ART_VIEWS.includes(n as ArtView)):undefined;
  const vis=meta.animVisibleViews;
  if(Array.isArray(vis))out.animVisibleViews=views(vis);
  else if(vis&&typeof vis==='object'){
    const m:Record<string,ArtView[]>={};
    for(const [k,v] of Object.entries(vis as Record<string,unknown>)){const l=views(v);if(l&&/^[a-z0-9-]+$/.test(k))m[k]=l;}
    out.animVisibleViews=m;
  }
  const anims=meta.anims;
  if(anims&&typeof anims==='object'&&!Array.isArray(anims)){
    const a:LiveMeta['anims']={};
    for(const [name,views] of Object.entries(anims as Record<string,unknown>)){
      if(!/^[a-z0-9-]+$/.test(name)||!views||typeof views!=='object')continue;
      const pts:ViewPoints<[number,number]>={};
      for(const v of ART_VIEWS){const p=(views as Record<string,unknown>)[v];if(isPair(p))pts[v]=p;}
      if(Object.keys(pts).length)a[name]=pts;
    }
    if(Object.keys(a).length)out.anims=a;
  }
  const wires=meta.wires;
  if(wires&&typeof wires==='object'&&!Array.isArray(wires)){
    const w:ViewPoints<[number,number][]>={};
    for(const v of ART_VIEWS){const p=(wires as Record<string,unknown>)[v];if(Array.isArray(p)&&p.length&&p.every(isPair))w[v]=p as [number,number][];}
    if(Object.keys(w).length)out.wires=w;
  }
  return out;
}

// ---- loops ----
/**
 * Overlays that are a state, not an idle loop: the banks' `sacando` and `tela-<cor>` (E8: meta.anims.<sufixo> =
 * meta.tela). The bank render picks them; the live layer never plays them on its own.
 */
export const isIdleLoop=(name:string)=>name!=='sacando'&&!name.startsWith('tela');
/** Whether loop `name` shows in art view `view` (its offset exists and animVisibleViews, when given, lists the view). */
export function loopVisible(meta:LiveMeta,name:string,view:ArtView):boolean{
  if(!isIdleLoop(name)||!meta.anims?.[name]?.[view])return false;
  const vis=meta.animVisibleViews,list=Array.isArray(vis)?vis:vis?.[name];
  return !list||list.includes(view);
}
/** Overlay fps: the meta's, kept in 8–10 (card) — the delivery's 4 fps flicker of the broken lamp is its own look. */
export const LOOP_FPS={min:8,max:10,fallback:8};
export function loopFps(fps:LiveMeta['fps'],name?:string,flicker=false){
  const v=typeof fps==='number'?fps:name!==undefined?fps?.[name]:undefined;
  return flicker?(v??4):Math.min(LOOP_FPS.max,Math.max(LOOP_FPS.min,v??LOOP_FPS.fallback));
}
/**
 * Frame of a loop at `nowMs`: every piece starts at its own phase (seeded by its key) so a street of lamps does not
 * flap in step; reduced motion keeps frame 0 (the static look).
 */
export function loopFrame(nowMs:number,fps:number,frames:number,key:string,reduced:boolean):number{
  if(reduced||frames<=1)return 0;
  return (Math.floor(nowMs*fps/1000)+hashId(key))%frames;
}

// ---- wires ----
export const POLE_FAMILIES=['poste-concreto','poste-gato'] as const;
export const isPole=(id:string)=>POLE_FAMILIES.some(f=>id===f||id.startsWith(`${f}-`));
/** Longest span (cells) and how far off the sidewalk line (cells) a neighbour may be. */
export const WIRE_MAX_CELLS=6;
export const WIRE_SIDEWALK_SLACK=1;
/** Wire look (pedido 10 §5 `fio-casa`): dark grey 2 px, a 1 px snow line on top, sag 8% of the span. */
export const WIRE_LOOK=Object.freeze({color:0x2e2f36,width:2,snow:0xf4f7fb,snowWidth:1,snowAlpha:.85,sag:.08,minSag:4,segments:10});

/** Pole key (decor id + cell, unique in a map) and its cell centre. */
export const decorKey=(e:Pick<DecorEntry,'id'|'c'|'r'>)=>`${e.id}@${e.c},${e.r}`;
const centre=(e:DecorEntry)=>({x:e.c+e.w/2,y:e.r+e.h/2});
/**
 * Pairs of poles to wire: each pole to its nearest neighbour on the same sidewalk in each of the 4 grid directions
 * (ahead ≤ WIRE_MAX_CELLS, off the line ≤ slack), so a street of poles is one continuous line and a corner pole joins
 * both streets (nearest-only left a gap in every other span: 122 of the 760 poles of asset v3 had no wire). Each pair
 * once, in a fixed order (sorted keys) so every client draws the same lines. Poles are bucketed by cell.
 */
export function polePairs(entries:readonly DecorEntry[]):[string,string][]{
  const poles=entries.filter(e=>isPole(e.id)).map(e=>({key:decorKey(e),...centre(e)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const B=WIRE_MAX_CELLS,bucket=new Map<string,typeof poles>(),cellOf=(x:number,y:number)=>`${Math.floor(x/B)},${Math.floor(y/B)}`;
  for(const p of poles){const k=cellOf(p.x,p.y),l=bucket.get(k);if(l)l.push(p);else bucket.set(k,[p]);}
  const seen=new Set<string>(),out:[string,string][]=[];
  for(const p of poles){
    const near:typeof poles=[];
    const bx=Math.floor(p.x/B),by=Math.floor(p.y/B);
    for(let j=by-1;j<=by+1;j++)for(let i=bx-1;i<=bx+1;i++)near.push(...bucket.get(`${i},${j}`)??[]);
    for(const [ax,ay] of [[1,0],[-1,0],[0,1],[0,-1]]){
      let best:typeof p|undefined,bAlong=Infinity,bAcross=Infinity;
      for(const q of near){
        if(q===p)continue;
        const along=(q.x-p.x)*ax+(q.y-p.y)*ay,across=Math.abs((q.x-p.x)*ay-(q.y-p.y)*ax);
        if(along<=0||along>WIRE_MAX_CELLS||across>WIRE_SIDEWALK_SLACK)continue;
        if(along<bAlong||(along===bAlong&&(across<bAcross||(across===bAcross&&best&&q.key<best.key)))){best=q;bAlong=along;bAcross=across;}
      }
      if(!best)continue;
      const pair:[string,string]=p.key<best.key?[p.key,best.key]:[best.key,p.key],k=pair.join('|');
      if(!seen.has(k)){seen.add(k);out.push(pair);}
    }
  }
  // A pole still alone (a corner, the other side of a crossing: 2–4 cells off both axes) crosses to its nearest pole
  // within WIRE_MAX_CELLS in any direction, like the wires that cross Brazilian streets.
  const linked=new Set(out.flat());
  for(const p of poles){
    if(linked.has(p.key))continue;
    let best:typeof p|undefined,bd=Infinity;
    const bx=Math.floor(p.x/B),by=Math.floor(p.y/B);
    for(let j=by-1;j<=by+1;j++)for(let i=bx-1;i<=bx+1;i++)for(const q of bucket.get(`${i},${j}`)??[]){
      const d=Math.hypot(q.x-p.x,q.y-p.y);
      if(q!==p&&d<=WIRE_MAX_CELLS&&(d<bd||(d===bd&&best&&q.key<best.key))){best=q;bd=d;}
    }
    if(!best)continue;
    const pair:[string,string]=p.key<best.key?[p.key,best.key]:[best.key,p.key],k=pair.join('|');
    if(!seen.has(k)){seen.add(k);out.push(pair);linked.add(best.key);}
    linked.add(p.key);
  }
  return out;
}
export interface Pt {x:number;y:number}
/**
 * Insulator i of one pole to insulator i of the other, both ordered across the span (by their offset perpendicular to
 * a→b), so the three wires never cross whatever views the two poles show.
 */
export function matchInsulators(a:readonly Pt[],b:readonly Pt[]):[Pt,Pt][]{
  if(!a.length||!b.length)return [];
  const ca=mean(a),cb=mean(b),dx=cb.x-ca.x,dy=cb.y-ca.y,l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l;
  const across=(p:Pt,c:Pt)=>(p.x-c.x)*nx+(p.y-c.y)*ny;
  const sa=[...a].sort((p,q)=>across(p,ca)-across(q,ca)),sb=[...b].sort((p,q)=>across(p,cb)-across(q,cb));
  const n=Math.min(sa.length,sb.length),out:[Pt,Pt][]=[];
  for(let i=0;i<n;i++)out.push([sa[Math.round(i*(sa.length-1)/Math.max(1,n-1))],sb[Math.round(i*(sb.length-1)/Math.max(1,n-1))]]);
  return out;
}
const mean=(p:readonly Pt[])=>({x:p.reduce((s,q)=>s+q.x,0)/p.length,y:p.reduce((s,q)=>s+q.y,0)/p.length});
/** A sagging wire from a to b on screen: a parabola (a catenary this shallow is one), lowest in the middle. */
export function sagLine(a:Pt,b:Pt,look=WIRE_LOOK):Pt[]{
  const sag=Math.max(look.minSag,Math.hypot(b.x-a.x,b.y-a.y)*look.sag),n=look.segments,out:Pt[]=[];
  for(let i=0;i<=n;i++){const t=i/n;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t+4*sag*t*(1-t)});}
  return out;
}

// ---- lights ----
export type LightKind='fogueira'|'poste'|'pisca';
export const lightKind=(id:string):LightKind|undefined=>
  id.startsWith('fogueira-tambor')?'fogueira':id.startsWith('poste-aceso-amarelo')?'poste':id.startsWith('luminaria-quebrada-pisca')?'pisca':undefined;
/** Glow per kind: halo radius on the head and pool radius on the ground (art px of the base cell), colour, alpha. */
export const LIGHT_LOOK:Readonly<Record<LightKind,{color:number;halo:number;pool:number;alpha:number;poolAlpha:number}>>=Object.freeze({
  fogueira:{color:0xffa040,halo:70,pool:150,alpha:.55,poolAlpha:.42},
  poste:{color:0xffd27a,halo:90,pool:190,alpha:.5,poolAlpha:.38},
  pisca:{color:0xcfe6ff,halo:55,pool:110,alpha:.5,poolAlpha:.32},
});
/**
 * Lamp heads (art px of the base cell, per view), measured on the delivery (warm lit pixels' centre, 16/10/2026);
 * a piece missing here glows at its cell's upper third.
 */
export const LIGHT_HEADS:Readonly<Record<string,ViewPoints<[number,number]>>>=Object.freeze({
  'fogueira-tambor-1':{0:[128,126],90:[129,124],180:[128,123],270:[128,127]},
  'fogueira-tambor-2':{0:[125,116],90:[124,116],180:[122,118],270:[127,115]},
  'luminaria-quebrada-pisca-1':{0:[75,105],90:[170,108],180:[169,102],270:[76,101]},
  'luminaria-quebrada-pisca-2':{0:[171,95],90:[166,108],180:[81,110],270:[80,103]},
  'poste-aceso-amarelo-1':{0:[392,168],90:[362,256],180:[162,288],270:[133,197]},
  'poste-aceso-amarelo-2':{0:[410,183],90:[255,212],180:[98,184],270:[240,331]},
});
/**
 * Cell of each light kind as delivered (LIGHT_HEADS and LIGHT_LOOK are in its px). The importer may rescale the cell
 * (E8: anims and wires go with it); `lightScale` is the factor from the delivery to the imported cell.
 */
export const LIGHT_DELIVERY_CELL:Readonly<Record<LightKind,readonly [number,number]>>=Object.freeze({fogueira:[256,256],pisca:[256,256],poste:[512,768]});
export const lightScale=(kind:LightKind,cell:readonly [number,number])=>cell[0]/LIGHT_DELIVERY_CELL[kind][0];
export function lightHead(id:string,view:ArtView,cell:readonly [number,number]):[number,number]{
  const kind=lightKind(id),h=LIGHT_HEADS[id]?.[view];
  if(!kind||!h)return [cell[0]/2,cell[1]/3];
  const k=lightScale(kind,cell);
  return [h[0]*k,h[1]*k];
}
/**
 * Light intensity (0..1) at `nowMs`: the fire breathes (two slow sines), the broken lamp follows its 4-frame flicker
 * (off on frame 2, dim on 3), the yellow lamp is steady; reduced motion keeps every light steady at 1.
 */
export function lightLevel(kind:LightKind,nowMs:number,key:string,reduced:boolean,frame=0):number{
  if(reduced||kind==='poste')return 1;
  if(kind==='pisca')return frame===2?.1:frame===3?.6:1;
  const t=nowMs/1000+(hashId(key)%997)/97;
  return .85+.1*Math.sin(t*5.3)+.05*Math.sin(t*13.1);
}

// ---- nests ----
export const NEST_THEMES=['bichos','boteco','escritorio','festa'] as const;
export type NestTheme=typeof NEST_THEMES[number];
export type NestState='ativo'|'dormindo'|'destruido';
export const nestTheme=(nestId:string):NestTheme=>NEST_THEMES[hashId(nestId)%NEST_THEMES.length];
/** State of a nest: fallen at hp 0, asleep while its sleepers are (`awake` false), active otherwise. */
export const nestState=(n:{hp:number;awake?:boolean}):NestState=>n.hp<=0?'destruido':n.awake===false?'dormindo':'ativo';
export const nestArtId=(n:{id:string;hp:number;awake?:boolean})=>`ninho-${nestTheme(n.id)}-${nestState(n)}`;
/** Nest art drawn over its 3×3 cells; the size letter scales it (P 0.85, M 1, G 1.25) like the radius of D-051. */
export const NEST_SCALE:Readonly<Record<'P'|'M'|'G',number>>=Object.freeze({P:.85,M:1,G:1.25});

// ---- culling ----
export interface Rect {x:number;y:number;w:number;h:number}
/** Whether a screen rect touches the camera rect grown by `margin` px. */
export const onCamera=(r:Rect,cam:Rect,margin=64)=>
  r.x<cam.x+cam.w+margin&&cam.x-margin<r.x+r.w&&r.y<cam.y+cam.h+margin&&cam.y-margin<r.y+r.h;

// ---- decals ----
/** Ground decals (pedido 10 §2, `decal/`): 1 view, 256², seen from above; baked into the chunk's ground texture. */
export const DECAL_FAMILIES=['bueiro','faixa-pedestre','mancha-oleo','pegadas','poca-congelada','rachadura'] as const;
export const isDecal=(id:string)=>DECAL_FAMILIES.some(f=>id===f||(id.startsWith(`${f}-`)&&/^\d+$/.test(id.slice(f.length+1))));
/** A corner of a decal: cell-space point (the city grid) and its texture coordinate (0..1). */
export interface DecalCorner {cx:number;cy:number;u:number;v:number}
/**
 * The decal's footprint corners (nw, ne, se, sw of its cells) with the texture turned by `rot` (clockwise, in steps
 * of 90°: the image's top edge faces north at 0, east at 90…). The camera view needs nothing here: the corners are
 * world points, the projection turns them.
 */
export function decalCorners(e:Pick<DecorEntry,'c'|'r'|'w'|'h'|'rot'>):DecalCorner[]{
  const pts=[[e.c,e.r],[e.c+e.w,e.r],[e.c+e.w,e.r+e.h],[e.c,e.r+e.h]];
  const uv=[[0,0],[1,0],[1,1],[0,1]],k=((Math.round(e.rot/90)%4)+4)%4;
  return pts.map(([cx,cy],i)=>{const [u,v]=uv[(i-k+4)%4];return {cx,cy,u,v};});
}
