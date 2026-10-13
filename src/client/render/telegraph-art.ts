/**
 * Imported telegraph art (NEW-20261012-ORQ-importar-arte-c-completa item 4): the `efeitos` pieces
 * `telegraph-enchimento` (seamless 128×128 hatch, alpha allowed) and `telegraph-borda` (seamless 128×16 strip, wraps in
 * x, dashed border) drawn on EXACTLY the zone the server damages (D-015, src/rules/telegraph-geometry.ts): the renderer
 * feeds these helpers the very outline it fills today (telegraph-shape.ts telegraphOutline), never a scaled or
 * simplified one.
 *
 * Both are drawn as textured triangle strips (a Phaser Rope whose vertices and UVs the renderer writes itself): no mask,
 * no stencil, no render target, a fixed vertex count per telegraph (no allocation per frame). UVs past 1 tile because
 * a power-of-two texture gets REPEAT wrapping in Phaser's WebGL renderer; a texture that is not a power of two (or a
 * canvas renderer) keeps today's procedural drawing.
 *
 * Pure helpers (telegraphArtLoads, fillStrip, borderStrip, stripTriangles…) run in node tests; queueTelegraphArt only
 * touches the scene it is given and imports Phaser as a type, so this module loads without Phaser.
 */
import type Phaser from 'phaser';
import {artPages,artPiece,artUrl,type ArtFile} from '../art/manifest.ts';
import {OUTLINE_MAX_POINTS,type Pt} from './telegraph-shape.ts';

export const TELEGRAPH_FILL_ART='telegraph-enchimento',TELEGRAPH_BORDER_ART='telegraph-borda';
/** Texture keys of the two pieces (loaded as whole images: the frame is the full texture, so UV 0..1 = one tile). */
export const TELEGRAPH_FILL_KEY='art:telegraph:fill',TELEGRAPH_BORDER_KEY='art:telegraph:border';
/** Points of each strip Rope (2 vertices per point): enough for the fill fan (2n−3) and the closed border (2n+2). */
export const TELEGRAPH_STRIP_POINTS=OUTLINE_MAX_POINTS+1;
/** Floats of one strip's xy (and of its uv) arrays. */
export const TELEGRAPH_STRIP_FLOATS=TELEGRAPH_STRIP_POINTS*4;
/** Screen size of one fill texel, in CSS px: the 128 px hatch tile covers 128 CSS px at any zoom (today's hatch is in CSS px too). */
export const FILL_TEXEL_CSS=1;

const isPow2=(n:number)=>Number.isInteger(n)&&n>0&&(n&(n-1))===0;
/** WebGL repeats UVs past 1 only on power-of-two textures (WebGLRenderer.createTextureFromSource). */
export const repeatable=(w:number,h:number)=>isPow2(w)&&isPow2(h);

export interface TelegraphArtLoad {id:string;key:string;url:string;cell:[number,number]}
/** What to load from the current manifest (empty manifest → []); a piece whose cell cannot tile is left procedural. */
export function telegraphArtLoads():TelegraphArtLoad[]{
  const out:TelegraphArtLoad[]=[];
  for(const [id,key] of [[TELEGRAPH_FILL_ART,TELEGRAPH_FILL_KEY],[TELEGRAPH_BORDER_ART,TELEGRAPH_BORDER_KEY]] as const){
    const piece=artPiece('efeitos',id);if(!piece)continue;
    const file:ArtFile|undefined=piece.files.sheet??Object.values(piece.files)[0];
    const page=file&&artPages(file)[0],url=page&&artUrl('efeitos',page.file);
    if(!file||!url||!repeatable(file.cell[0],file.cell[1]))continue;
    out.push({id,key,url,cell:file.cell});
  }
  return out;
}
/**
 * Queues the imported telegraph textures that are not loaded yet and starts the loader if it is idle (the renderer is
 * built in create(), after preload). Nothing with an empty manifest; a failed load keeps today's drawing.
 */
export function queueTelegraphArt(scene:Phaser.Scene,start=true){
  const loader=scene.load;if(!loader)return;
  let queued=false;
  for(const l of telegraphArtLoads()){if(scene.textures.exists(l.key))continue;loader.image(l.key,l.url);queued=true;}
  // From preload (start=false) the scene's own loader run picks them up; later calls start it themselves.
  if(start&&queued&&!loader.isLoading())loader.start();
}

/**
 * Fill mesh of the closed polygon src[0..n) as a triangle strip p1,p0,p2,p0,p3,…,p0,p(n−1): the fan (p0,pi,pi+1),
 * with a degenerate triangle between two fan triangles. Exact for every telegraph outline: circle and line are convex
 * and the cone is star-shaped from p0 (its apex). UV = scene position / tile (tileW × tileH = scene px of one texture repeat),
 * so the hatch is anchored to the ground and does not swim when the zone pulses or the camera moves. The rest of the
 * arrays (up to `capacity` vertices) repeats the last vertex: zero-area triangles, so the Rope keeps a fixed size.
 * Returns the vertices written (0 when n < 3).
 */
export function fillStrip(src:readonly Pt[],n:number,tileW:number,tileH:number,xy:Float32Array,uv:Float32Array,capacity=xy.length>>1):number{
  if(n<3||!(tileW>0)||!(tileH>0)){pad(xy,uv,0,capacity);return 0;}
  let v=put(xy,uv,0,src[1],tileW,tileH);
  for(let i=2;i<n;i++){v=put(xy,uv,v,src[0],tileW,tileH);v=put(xy,uv,v,src[i],tileW,tileH);}
  pad(xy,uv,v,capacity);
  return v;
}
function put(xy:Float32Array,uv:Float32Array,v:number,p:Pt,tileW:number,tileH:number){
  const o=v*2;xy[o]=p.x;xy[o+1]=p.y;uv[o]=p.x/tileW;uv[o+1]=p.y/tileH;return v+1;
}

/**
 * Border band of the closed polygon `outer[0..n)` (the zone's real edge) around its inset centre line `mid[0..n)`
 * (telegraph-shape.ts insetPolygon by half the band, as today's strokes): the inner edge is outer reflected through
 * mid, so the band covers exactly today's stroke, inside the zone (D-015). Strip vertices alternate outer, inner for
 * points 0..n−1 and close on point 0 again: 2(n+1) vertices. V = 0 on the outer edge, 1 on the inner one. U runs
 * along the centre line in tiles of `thickness × aspect` (the strip's width/height, so the dashes keep their shape),
 * stretched to a whole number of tiles: the dashes go on across every corner and across the closing point.
 * Returns the vertices written (0 when n < 3 or the band is empty); pads like fillStrip.
 */
export function borderStrip(outer:readonly Pt[],mid:readonly Pt[],n:number,thickness:number,aspect:number,
  xy:Float32Array,uv:Float32Array,capacity=xy.length>>1):number{
  let length=0;
  for(let i=0;i<n;i++){const a=mid[i],b=mid[(i+1)%n];length+=Math.hypot(b.x-a.x,b.y-a.y);}
  if(n<3||!(thickness>0)||!(aspect>0)||!(length>0)){pad(xy,uv,0,capacity);return 0;}
  const tiles=Math.max(1,Math.round(length/(thickness*aspect))),per=tiles/length;
  let v=0,s=0;
  for(let k=0;k<=n;k++){
    const i=k%n,o=outer[i],m=mid[i];
    if(k>0){const a=mid[k-1];s+=Math.hypot(m.x-a.x,m.y-a.y);}
    const u=k===n?tiles:s*per;
    let w=v*2;xy[w]=o.x;xy[w+1]=o.y;uv[w]=u;uv[w+1]=0;v++;
    w=v*2;xy[w]=2*m.x-o.x;xy[w+1]=2*m.y-o.y;uv[w]=u;uv[w+1]=1;v++;
  }
  pad(xy,uv,v,capacity);
  return v;
}
/** Repeats vertex v−1 (or zeros) up to `capacity`: degenerate triangles that draw nothing. */
function pad(xy:Float32Array,uv:Float32Array,v:number,capacity:number){
  const last=Math.max(0,v-1)*2,x=v?xy[last]:0,y=v?xy[last+1]:0,u=v?uv[last]:0,w=v?uv[last+1]:0;
  for(let i=v;i<capacity;i++){const o=i*2;xy[o]=x;xy[o+1]=y;uv[o]=u;uv[o+1]=w;}
}

/** Triangles a triangle strip draws (for tests and checks): calls fn for each one with non-zero area. */
export function stripTriangles(xy:Float32Array,count:number,fn:(ax:number,ay:number,bx:number,by:number,cx:number,cy:number)=>void){
  for(let i=0;i+2<count;i++){
    const a=i*2,b=a+2,c=a+4;
    const area=(xy[b]-xy[a])*(xy[c+1]-xy[a+1])-(xy[b+1]-xy[a+1])*(xy[c]-xy[a]);
    if(Math.abs(area)>1e-9)fn(xy[a],xy[a+1],xy[b],xy[b+1],xy[c],xy[c+1]);
  }
}
