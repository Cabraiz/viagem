/**
 * The city's viaducts on screen (NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 3; plans/mapa-175-viaduto.md §4), in flat
 * palette colours until the Codex art (etapa 4): the deck's slab and its parapets, the ramp on its embankment, the
 * pillars, and the deck's shadow on the street. Same camera, no new zoom.
 *
 * Draw order: the deck and the ramp go cell by cell (~120 pieces), each at the depth of its front corner, so a body on
 * the street under a cell is drawn before it (covered) and one beside it in front after it. A body on the deck (floor 1)
 * is lifted by the surface's height (HEIGHT_PX a unit, like the blocks) and drawn just above the cells it stands on
 * (bodyDepth). While the local hero is under the deck, the strips around it go
 * see-through (UNDER_ALPHA within UNDER_RADIUS) so the hero and the fight stay readable.
 *
 * The geometry (viaductPieces) is pure and tested; ViaductLayer is the Phaser side.
 */
import type {CityViaduct} from '../../../maps/index.ts';
import {overDeck,onRamp,rampCells,rampRun,surfaceHeight} from '../../../maps/index.ts';
import {CITY_PALETTE} from './palette.ts';
import {HEIGHT_PX,VIEW_PIVOT,depth as depthKey,project,rotate,type Pt} from './projection.ts';
import {artViewOf} from './live/rules.ts';
import {UNO_CELL,UNO_FOOT,UNO_KEY,UNO_SCALE,UNO_URL,unoFootY,unoFrame} from '../chaveiro/uno-art.ts';

/** Slab thickness and parapet height (u), plan §4. */
export const DECK_SLAB=.6,PARAPET=.6;
/** Parapet thickness (u) and pillar side (u). */
export const PARAPET_WIDTH=.22,PILLAR_SIDE=.8;
/** The pier cap on each pillar, under the slab (etapa 5, option B): its side and height (u). */
export const CAP_SIDE=1.3,CAP_HEIGHT=.45;
/** While the local hero is under the deck, the strips within this radius (u) draw at this alpha (plan §4: ~35 %). */
export const UNDER_RADIUS=4,UNDER_ALPHA=.35;
/** Depth keys a body on a deck strip sits above the strip (under the next strip in front: a strip is ~300 keys deep). */
export const ON_STRIP=1;
/**
 * Scene depth a strip draws above its key. The city's block bands sort by the same cells' front corners, so a cliff or
 * wall cell by (or under) the deck tied a deck cell exactly, and the tie went to whichever was added last: a chunk
 * rebuilt when its art arrived drew its bands over the deck's back cells (prints of etapa 4, about one start in two).
 * Above the city's own offsets (outline +0.01, props +0.25), under a body on the strip (+ON_STRIP).
 */
export const DECK_OVER=.5;

/** A box of the viaduct in world units: its footprint and its top/bottom height at the footprint's 4 corners. */
export interface ViaductPiece {
  kind:'deck'|'ramp'|'pillar'|'cap'|'parapet'|'shadow'|'car';
  /** Which strip it belongs to (deck and ramp pieces and their parapets share their strip's index; a pillar and its cap theirs). */
  strip:number;
  x0:number;y0:number;x1:number;y1:number;
  /** Heights (u) at the corners (x0,y0), (x1,y0), (x1,y1), (x0,y1). */
  top:readonly [number,number,number,number];bottom:readonly [number,number,number,number];
}
const flat=(z:number)=>[z,z,z,z] as const;

/**
 * Every piece of viaduct `v` (cell `unit` u), one cell each so each sorts by its own front corner (a piece across the
 * deck's width sorted by its front corner covered what stood beside its back end): deck cells (slab DECK_SLAB thick under
 * the deck's height) and ramp cells (an embankment from the ground to the sloped surface), each with its parapet on the
 * viaduct's outer sides; the pillars (from the ground to the slab's underside); and the deck's shadow on the street.
 * `strip` numbers the pieces that draw together (a cell and its parapet; a pillar alone).
 */
export function viaductPieces(v:CityViaduct,unit:number):ViaductPiece[]{
  const out:ViaductPiece[]=[],h=v.height,along=v.ramp.up==='N'||v.ramp.up==='S';
  const [dc,dr,dw,dh]=v.deck,[rc,rr,rw,rh]=v.ramp.rect;
  let strip=0;
  const raise=(t:readonly number[])=>t.map(z=>z+PARAPET) as unknown as [number,number,number,number];
  /** The parapets of a cell on the viaduct's outer sides (c0/c1: the first and last column, or row, across it). */
  const parapets=(x0:number,y0:number,x1:number,y1:number,top:readonly [number,number,number,number],first:boolean,last:boolean)=>{
    if(along){
      if(first)out.push({kind:'parapet',strip,x0,y0,x1:x0+PARAPET_WIDTH,y1,top:raise([top[0],top[0],top[3],top[3]]),bottom:[top[0],top[0],top[3],top[3]]});
      if(last)out.push({kind:'parapet',strip,x0:x1-PARAPET_WIDTH,y0,x1,y1,top:raise([top[1],top[1],top[2],top[2]]),bottom:[top[1],top[1],top[2],top[2]]});
    }else{
      if(first)out.push({kind:'parapet',strip,x0,y0,x1,y1:y0+PARAPET_WIDTH,top:raise([top[0],top[1],top[1],top[0]]),bottom:[top[0],top[1],top[1],top[0]]});
      if(last)out.push({kind:'parapet',strip,x0,y0:y1-PARAPET_WIDTH,x1,y1,top:raise([top[3],top[2],top[2],top[3]]),bottom:[top[3],top[2],top[2],top[3]]});
    }
  };
  for(let r=dr;r<dr+dh;r++)for(let c=dc;c<dc+dw;c++,strip++){
    const x0=c*unit,y0=r*unit,x1=x0+unit,y1=y0+unit;
    out.push({kind:'deck',strip,x0,y0,x1,y1,top:flat(h),bottom:flat(h-DECK_SLAB)});
    parapets(x0,y0,x1,y1,flat(h),along?c===dc:r===dr,along?c===dc+dw-1:r===dr+dh-1);
  }
  // Ramp cells: the surface rises from the foot (0) to the top (h); an embankment down to the ground.
  const len=rampCells(v)*unit,zAt=(x:number,y:number)=>h*Math.max(0,Math.min(1,(rampRun(v,unit,Math.min(Math.max(x,rc*unit+1e-6),(rc+rw)*unit-1e-6),Math.min(Math.max(y,rr*unit+1e-6),(rr+rh)*unit-1e-6))??0)/len));
  for(let r=rr;r<rr+rh;r++)for(let c=rc;c<rc+rw;c++,strip++){
    const x0=c*unit,y0=r*unit,x1=x0+unit,y1=y0+unit;
    const top=[zAt(x0,y0),zAt(x1,y0),zAt(x1,y1),zAt(x0,y1)] as const;
    out.push({kind:'ramp',strip,x0,y0,x1,y1,top,bottom:flat(0)});
    parapets(x0,y0,x1,y1,top,along?c===rc:r===rr,along?c===rc+rw-1:r===rr+rh-1);
  }
  // Pillars, each its own strip with its cap on top.
  for(const [c,r] of v.pillars){
    const cx=(c+.5)*unit,cy=(r+.5)*unit,s=PILLAR_SIDE/2,k=CAP_SIDE/2,under=h-DECK_SLAB;
    out.push({kind:'pillar',strip,x0:cx-s,y0:cy-s,x1:cx+s,y1:cy+s,top:flat(under-CAP_HEIGHT),bottom:flat(0)});
    out.push({kind:'cap',strip:strip++,x0:cx-k,y0:cy-k,x1:cx+k,y1:cy+k,top:flat(under),bottom:flat(under-CAP_HEIGHT)});
  }
  // The deck's shadow on the street (a flat decal, drawn on the ground).
  out.push({kind:'shadow',strip:-1,x0:dc*unit,y0:dr*unit,x1:(dc+dw)*unit,y1:(dr+dh)*unit,top:flat(0),bottom:flat(0)});
  return out;
}

/** A car on a deck (u): the Uno where the run starts and the pile-up at the closed end (art of etapa 4; boxes until then). */
export interface DeckCar {x:number;y:number;w:number;h:number;tall:number;color:number}
/**
 * The deck's cars of viaduct `v`: the Uno at the run's start `start` when it is on the deck (2.4 × 1.3 u, along the deck),
 * and three cars piled across the deck's closed end (the end away from the ramp).
 */
export function deckCars(v:CityViaduct,unit:number,start?:Pt):DeckCar[]{
  const out:DeckCar[]=[],[dc,dr,dw,dh]=v.deck,along=v.ramp.up==='N'||v.ramp.up==='S';
  if(start&&overDeck(v,unit,start.x,start.y))out.push(along?{x:start.x+.9,y:start.y-1.4,w:1.3,h:2.4,tall:1.1,color:CAR_RED}:{x:start.x-1.4,y:start.y+.9,w:2.4,h:1.3,tall:1.1,color:CAR_RED});
  // The closed end: the deck's far end from the ramp (north for a ramp going up north: the deck's first row).
  const far=v.ramp.up==='N'?dr*unit+1.1:v.ramp.up==='S'?(dr+dh)*unit-1.1:v.ramp.up==='W'?dc*unit+1.1:(dc+dw)*unit-1.1;
  const span=(along?dw:dh)*unit,from=(along?dc:dr)*unit;
  for(let i=0;i<3;i++){
    const c=from+span*(i+.5)/3,tall=.9+.25*i,color=PILE[i];
    out.push(along?{x:c-1,y:far-.7,w:2,h:1.4,tall,color}:{x:far-.7,y:c-1,w:1.4,h:2,tall,color});
  }
  return out;
}
const CAR_RED=0xc0473a,PILE=[0x5b7fa8,0x8f8a7a,0xd6a23c] as const;

/**
 * The faces' art (etapa 4, scripts/import-viaduto.mjs; round 3 option C, picked by the user): one atlas with the deck's
 * road on the left (top-down, the road along v, both edges snow, the double yellow line in the middle; it tiles along
 * the road), the concrete wall of the ramp's embankment (tiles both ways), and (etapa 5, option B, old Brazilian
 * concrete: the user found the plain concrete flat) the barrier's New Jersey blocks and the slab's edge beam (bands
 * that tile along a side, one block a cell) and a pillar's face (its hazard stripes at the foot). Under WebGL each strip
 * draws its faces as one Mesh of it (as the city's painted ground, city-layer groundMesh); under Canvas, or until it
 * loads, the flat colours stay. The barrier's top (tb-tampa: snowy concrete seen from above, card viaduto-arte) also caps
 * a pillar.
 */
export const FACES_KEY='city:viaduct:faces',FACES_URL='/art/city/viaduto/faces.webp';
/** The atlas (px) and its regions: the road tile, the wall tile, the barrier band, the beam band, the pillar's face, the
 * barrier's top (4 segments down it, one a cell, as the barrier band's blocks). */
export const FACES_SIZE=[1152,768] as const,FACES_ROAD=[0,0,512,768] as const,FACES_CONCRETE=[512,0,512,512] as const,
  FACES_BARRIER=[512,512,512,128] as const,FACES_BEAM=[512,640,512,128] as const,FACES_PILLAR=[1024,0,128,512] as const,
  FACES_CAP=[1024,512,128,256] as const;
/** Cells of road one road tile covers along the road; cells one concrete tile (and one band: 4 blocks) covers along a side (and up). */
export const ROAD_TILE_CELLS=6,CONCRETE_TILE_CELLS=4;
/** Texels kept off each region's rim, so linear filtering never reads the region beside it. */
const FACES_INSET=2;
/** Texture coordinates (0..1 of the atlas) of point (s, t) (0..1) of region `r`. */
export function regionUv(r:readonly [number,number,number,number],s:number,t:number):[number,number]{
  const [x,y,w,h]=r,i=FACES_INSET;
  return [(x+i+s*(w-2*i))/FACES_SIZE[0],(y+i+t*(h-2*i))/FACES_SIZE[1]];
}
/**
 * The road tile's (s, t) at the 4 footprint corners of a deck or ramp cell of `v`: s across the viaduct (0 on its west,
 * or north, side, 1 on the other), t along it, ROAD_TILE_CELLS cells a tile from the deck's first row (or column).
 */
export function roadST(p:ViaductPiece,v:CityViaduct,unit:number):[number,number][]{
  const along=v.ramp.up==='N'||v.ramp.up==='S',[dc,dr,dw,dh]=v.deck;
  const a0=(along?dr:dc)*unit,c0=(along?dc:dr)*unit,width=(along?dw:dh)*unit,R=ROAD_TILE_CELLS;
  const k=((Math.floor(((along?p.y0:p.x0)-a0)/unit+1e-6)%R)+R)%R;
  return cornersOf(p).map(c=>{
    const across=((along?c.x:c.y)-c0)/width,len=((along?c.y:c.x)-(along?p.y0:p.x0))/unit;
    return [Math.min(1,Math.max(0,across)),(k+len)/R];
  });
}
/**
 * The concrete tile's (s, t) at a side's 4 corners (tops a, b, then bottoms b, a: the order the side is drawn): s along
 * the side from the tile's edge before it (cells line up with the tiles; a piece narrower than a cell that would cross
 * a tile's edge is shifted inside it), t down from the tile's top at CONCRETE_TILE_CELLS cells over the ground.
 */
export function concreteST(p:ViaductPiece,side:'n'|'e'|'s'|'w',unit:number):[number,number][]{
  const [a,b]=SIDE_CORNERS[side],cs=cornersOf(p),T=CONCRETE_TILE_CELLS*unit,ns=side==='n'||side==='s';
  const m=(c:Pt)=>ns?c.x:c.y,m0=Math.min(m(cs[a]),m(cs[b])),m1=Math.max(m(cs[a]),m(cs[b]));
  let s0=(m0-Math.floor(m0/T+1e-6)*T)/T;
  if(s0+(m1-m0)/T>1+1e-6)s0=1-(m1-m0)/T;
  const s=(c:Pt)=>s0+(m(c)-m0)/T,t=(z:number)=>Math.min(1,Math.max(0,1-z/T));
  return [[s(cs[a]),t(p.top[a])],[s(cs[b]),t(p.top[b])],[s(cs[b]),t(p.bottom[b])],[s(cs[a]),t(p.bottom[a])]];
}

/**
 * A band's (s, t) at a side's 4 corners (as concreteST): s along the side as the concrete tile's, t from the piece's own
 * top (0) to its bottom (1), so the band follows a sloped ramp. With `whole`, s runs across the face 0..1 (a pillar's face).
 */
export function bandST(p:ViaductPiece,side:'n'|'e'|'s'|'w',unit:number,whole=false):[number,number][]{
  const st=concreteST(p,side,unit);
  const s=whole?(st[0][0]<=st[1][0]?[0,1]:[1,0]):[st[0][0],st[1][0]];
  return [[s[0],0],[s[1],0],[s[1],1],[s[0],1]];
}

/**
 * The barrier top's (s, t) at the 4 footprint corners of a parapet or a pier cap: s across the piece (0..1), t along
 * its long side as the barrier band's s (CONCRETE_TILE_CELLS cells a tile, shifted inside one tile as concreteST). A
 * pier cap reads one segment, between its joints.
 */
export function capST(p:ViaductPiece,unit:number):[number,number][]{
  const cs=cornersOf(p),alongY=p.y1-p.y0>=p.x1-p.x0,T=CONCRETE_TILE_CELLS*unit;
  const across=(c:Pt)=>alongY?(c.x-p.x0)/(p.x1-p.x0):(c.y-p.y0)/(p.y1-p.y0),m=(c:Pt)=>alongY?c.y:c.x;
  if(p.kind==='cap')return cs.map(c=>{const a=alongY?(c.y-p.y0)/(p.y1-p.y0):(c.x-p.x0)/(p.x1-p.x0);return [across(c),.02+.21*a];});
  const m0=alongY?p.y0:p.x0,len=(alongY?p.y1:p.x1)-m0;
  let t0=(m0-Math.floor(m0/T+1e-6)*T)/T;
  if(t0+len/T>1+1e-6)t0=Math.max(0,1-len/T);
  return cs.map(c=>[across(c),t0+(m(c)-m0)/T]);
}

/**
 * The viaduct's pieces of art (etapa 4, the Brazilian viaduct the user asked for): `cenario` sheets (decor ids,
 * scripts/import-viaduto.mjs) drawn by this layer, not by the city's chunks (they stand on the deck, or by the ramp's
 * foot, where no chunk decor is). On the deck (floor 1): the pile-up at the closed end, the green gantry across the
 * deck near the ramp's top, the 60 sign and the speed camera by the parapets. On the street (floor 0, a ramp going up
 * north only, the map's): the toll plaza and the bus stop beside the ramp's foot, the stop sign by the crosswalk.
 * `rot`: the art view at camera view 0 (CityDecor.rot: 0 faces south).
 */
export interface ViaductProp {id:string;x:number;y:number;floor:0|1;rot:0|90|180|270;
  /** Times the sheet's scale (the gantry: its art is drawn narrower than the deck it spans). */
  scale?:number}
/** The gantry over its sheet scale, so its posts stand by the parapets (prints of etapa 4: it spanned ~70 % of the deck). */
export const GANTRY_SCALE=1.3;
export const VIADUCT_PROP_IDS=['carro-batido-1','carro-batido-2','portico-placa','placa-60','radar-lombada','pedagio','ponto-onibus','placa-pare'] as const;
export function viaductProps(v:CityViaduct,unit:number):ViaductProp[]{
  const out:ViaductProp[]=[],[dc,dr,dw,dh]=v.deck,along=v.ramp.up==='N'||v.ramp.up==='S';
  // The pile-up: deckCars' three spots at the closed end (a box each until the sheets are in).
  const pile=deckCars(v,unit).slice(-3),ids=['carro-batido-1','carro-batido-2','carro-batido-1'],rots=along?[90,0,270]:[0,90,180];
  pile.forEach((c,i)=>out.push({id:ids[i],x:c.x+c.w/2,y:c.y+c.h/2,floor:1,rot:rots[i] as ViaductProp['rot']}));
  if(v.ramp.up!=='N')return out;
  // Near the ramp's top, facing the drivers coming up it (south): the gantry across the deck, the 60 sign on the west
  // parapet, the speed camera on the east one further along.
  const top=(dr+dh)*unit,west=dc*unit,east=(dc+dw)*unit,mid=(west+east)/2;
  out.push({id:'portico-placa',x:mid,y:top-3*unit,floor:1,rot:0,scale:GANTRY_SCALE});
  out.push({id:'placa-60',x:west+.55,y:top-1.5*unit,floor:1,rot:0});
  out.push({id:'radar-lombada',x:east-.55,y:top-8*unit,floor:1,rot:0});
  // The street at the ramp's foot: the toll plaza west of the avenue, the bus stop east of the ramp facing it, the stop
  // sign on the west sidewalk at the crosswalk.
  const [rc,rr,rw,rh]=v.ramp.rect,foot=rr+rh;
  out.push({id:'pedagio',x:(rc-4.5)*unit,y:(foot-3)*unit,floor:0,rot:0});
  out.push({id:'ponto-onibus',x:(rc+rw+1)*unit,y:(foot-2)*unit,floor:0,rot:270});
  out.push({id:'placa-pare',x:(rc-2.5)*unit,y:(foot+.5)*unit,floor:0,rot:0});
  return out;
}
/**
 * The crosswalk across the avenue past the ramp's foot (a ramp going up north): the `faixa-pedestre` decal (top-down,
 * stripes along v) laid in tiles of CROSSWALK_TILE_CELLS cells, from the avenue's west lane to the ramp's east side. Each
 * tile reads only CROSSWALK_UV of the decal across (its stripes, not its margin), so the tiles join stripe to stripe.
 */
export const CROSSWALK_UV=[.12,.88] as const;
export const CROSSWALK_KEY='city:viaduct:faixa-pedestre',CROSSWALK_URL='/art/city/decor/faixa-pedestre/sheet.webp',CROSSWALK_TILE_CELLS=2;
export function crosswalkTiles(v:CityViaduct,unit:number):{x0:number;y0:number;x1:number;y1:number}[]{
  if(v.ramp.up!=='N')return [];
  const [rc,rr,rw,rh]=v.ramp.rect,T=CROSSWALK_TILE_CELLS,out=[];
  for(let c=rc-2;c<rc+rw;c+=T)out.push({x0:c*unit,y0:(rr+rh)*unit,x1:(c+T)*unit,y1:(rr+rh+T)*unit});
  return out;
}

/** The faces of a box seen from the camera at `view`: each outward side normal that points toward the viewer. */
export function frontSides(view:number):('n'|'e'|'s'|'w')[]{
  const sides:[('n'|'e'|'s'|'w'),number,number][]=[['n',0,-1],['e',1,0],['s',0,1],['w',-1,0]];
  // Depth grows with q.x + q.y (projection.ts): a side faces the camera when its rotated normal has a positive sum.
  return sides.filter(([,nx,ny])=>{const q=rotate(nx,ny,view);return q.x+q.y>0;}).map(([s])=>s);
}
/** Footprint corner order: (x0,y0), (x1,y0), (x1,y1), (x0,y1); the two corners of each side. */
const SIDE_CORNERS={n:[0,1],e:[1,2],s:[2,3],w:[3,0]} as const;
const cornersOf=(p:ViaductPiece):Pt[]=>[{x:p.x0,y:p.y0},{x:p.x1,y:p.y0},{x:p.x1,y:p.y1},{x:p.x0,y:p.y1}];
/** Depth key of the piece's front-most footprint corner at `view`. */
export function pieceKey(p:ViaductPiece,view:number,pivot:Pt=VIEW_PIVOT):number{
  let best=-Infinity;
  for(const c of cornersOf(p))best=Math.max(best,depthKey(c.x,c.y,view,pivot));
  return best;
}

/** A sheet of the viaduct's pieces as the city's art plan gives it (art-plan.ts DecorSheet: url, frame, scale, anchor). */
export interface ViaductSheet {key:string;url:string;frameWidth:number;frameHeight:number;scale:number;originY:number}
/** Drawing hooks from the scene: its depth space and the ground height under a point (px). */
export interface ViaductHooks {
  /** Maps a projection depth key to the scene's depth space (the city layer's depthOf). */
  depthOf:(key:number)=>number;
  /** The ground's screen lift at (x, y) in px (the relief: elevation), the same the actors stand on. */
  groundPx:(x:number,y:number)=>number;
  /** The sheet of a piece of art (VIADUCT_PROP_IDS) when the art plan has it; without one the piece is not drawn. */
  sheet?:(id:string)=>ViaductSheet|undefined;
  /**
   * The city's block rects (u, CityBlock.rects). A deck or ramp cell over one draws above it: the deck's north end
   * crosses the map's edge cliff, whose band sorts by its own front corner and, before its art streamed in (a low
   * procedural top), covered the deck's first rows at the start (prints of etapa 4).
   */
  blocks?:readonly (readonly [number,number,number,number])[];
}

/** A colour darkened to `k` of itself (the cars' sides). */
const shade=(c:number,k:number)=>(Math.round((c>>16&255)*k)<<16)|(Math.round((c>>8&255)*k)<<8)|Math.round((c&255)*k);
const TOP=CITY_PALETTE['neve-pisada'],SIDE_LIGHT=CITY_PALETTE['muro-clara'],SIDE_DARK=CITY_PALETTE['muro-escura'],
  CAP=CITY_PALETTE['muro-tampa'],BREU=CITY_PALETTE.breu;
/** Tints of the textured faces: the road on top, the concrete's lit and shaded sides. */
const TINT_TOP=0xffffff,TINT_LIGHT=0xd6d8e2,TINT_DARK=0x9a9eb0;
/** Depth (scene space) a strip's outlines sit above its textured faces. */
const OUTLINE_OVER=1e-3;
/** The Uno's heading on the deck (radians, world plane): broken down facing the closed end, north for a ramp going up north. */
const unoHeading=(v:CityViaduct)=>({N:-Math.PI/2,S:Math.PI/2,W:Math.PI,E:0} as const)[v.ramp.up];
/** A drawn piece of art: a ViaductProp (or the Uno) with its image once its sheet is in. */
interface PropArt {prop:ViaductProp;v:CityViaduct;sheet?:ViaductSheet;img?:Phaser.GameObjects.Image;key:number}

/**
 * The Phaser side: one Graphics per strip (and pillar), redrawn when the view turns, re-sorted every frame (the scene's
 * depth origin moves with the hero). With the faces' atlas in (WebGL), each strip's faces are a Mesh under its
 * Graphics, which then keeps only the outlines (and the cars' boxes until their sheets are in). The pieces of art (viaductProps, the Uno at
 * the start) are images over their strips; the deck's car boxes stay only until their sheets are in.
 * `bodyLift`/`bodyDepth` place a body of floor 1; `under` says the ground at (x, y) is under a deck (the hero there gets
 * its see-through copy, like behind a building).
 */
export class ViaductLayer {
  private readonly pieces:ViaductPiece[];
  private readonly strips:Phaser.GameObjects.Graphics[]=[];
  private meshes:(Phaser.GameObjects.Mesh|undefined)[]=[];
  private shadow?:Phaser.GameObjects.Graphics;
  private crosswalk?:Phaser.GameObjects.Mesh;
  private view=-1;
  /** Which art was in at the last draw (FACES, Uno, sheets): a change redraws. */
  private artState='';
  private readonly keys:number[]=[];
  /** Per strip, its main piece (the cell, the pillar or the car; not a parapet). */
  private bodyOf:ViaductPiece[]=[];
  private readonly props:PropArt[];
  private uno?:{x:number;y:number;v:CityViaduct;img?:Phaser.GameObjects.Image;key:number};
  private readonly scene:Phaser.Scene;
  private readonly viaducts:readonly CityViaduct[];
  private readonly unit:number;
  private readonly hooks:ViaductHooks;
  private readonly shadowDepth:number;
  /** `start`: the run's start (the Uno is drawn there when it is on a deck). */
  constructor(scene:Phaser.Scene,viaducts:readonly CityViaduct[],unit:number,hooks:ViaductHooks,shadowDepth:number,start?:Pt){
    this.scene=scene;this.viaducts=viaducts;this.unit=unit;this.hooks=hooks;this.shadowDepth=shadowDepth;
    this.pieces=viaducts.flatMap(v=>viaductPieces(v,unit));
    // The cars: each its own piece, drawn above every deck cell under it (draw). `art`: the image that replaces it.
    let next=1+Math.max(-1,...this.pieces.map(q=>q.strip));
    for(const v of viaducts){
      const cars=deckCars(v,unit,start),uno=cars.length===4;
      cars.forEach((c,i)=>this.pieces.push({kind:'car',strip:next++,x0:c.x,y0:c.y,x1:c.x+c.w,y1:c.y+c.h,top:flat(v.height+c.tall),bottom:flat(v.height),color:c.color,
        art:uno&&i===0?'uno':`pile${i-(uno?1:0)}`} as ViaductPiece&{color:number;art:string}));
      // The Uno where its box stood (beside the start, not on it: the hero spawns next to the car).
      if(uno)this.uno={x:cars[0].x+cars[0].w/2,y:cars[0].y+cars[0].h/2,v,key:-Infinity};
    }
    for(const p of this.pieces)if(p.kind!=='parapet'&&p.strip>=0)this.bodyOf[p.strip]=p;
    this.props=viaducts.flatMap(v=>viaductProps(v,unit).map(prop=>({prop,v,sheet:hooks.sheet?.(prop.id),key:-Infinity})));
    this.loadArt();
  }
  /** Queues the faces' atlas, the crosswalk, the Uno and the pieces' sheets not in yet (a stand-in scene has no loader). */
  private loadArt(){
    const load=this.scene.load,tex=this.scene.textures;
    if(!load||!tex)return;
    let queued=false;
    const image=(key:string,url:string)=>{if(!tex.exists(key)){load.image(key,url);queued=true;}};
    const sheet=(key:string,url:string,frameWidth:number,frameHeight:number)=>{if(!tex.exists(key)){load.spritesheet(key,url,{frameWidth,frameHeight});queued=true;}};
    if(this.webgl())image(FACES_KEY,FACES_URL);
    if(this.webgl()&&this.viaducts.some(v=>crosswalkTiles(v,this.unit).length))image(CROSSWALK_KEY,CROSSWALK_URL);
    if(this.uno)sheet(UNO_KEY,UNO_URL,UNO_CELL,UNO_CELL);
    const seen=new Set<string>();
    for(const {sheet:s} of this.props)if(s&&!seen.has(s.key)){seen.add(s.key);sheet(s.key,s.url,s.frameWidth,s.frameHeight);}
    if(queued&&!load.isLoading())load.start();
  }
  private webgl(){return !!(this.scene.renderer as {gl?:unknown}|undefined)?.gl;}
  private has(key:string){return !!this.scene.textures?.exists(key);}
  /** The faces' atlas is in and can be drawn (WebGL). */
  private textured(){return this.webgl()&&this.has(FACES_KEY)&&typeof this.scene.add.mesh==='function';}
  private state(){return [this.textured(),this.uno&&this.has(UNO_KEY),this.has(CROSSWALK_KEY),...this.props.map(a=>a.sheet&&this.has(a.sheet.key))].map(Number).join('');}
  /** Redraws the pieces for `view` (once per turn, or when art arrives), re-sorts them, and fades around a hero under a deck. */
  update(view:number,hero?:Pt&{andar?:number}){
    const state=this.state();
    if(view!==this.view||state!==this.artState){this.artState=state;this.draw(view);}
    const under=hero&&hero.andar!==1&&this.under(hero.x,hero.y);
    for(let i=0;i<this.strips.length;i++){
      const g=this.strips[i],d=this.hooks.depthOf(this.keys[i]),m=this.meshes[i];
      g.setDepth(d+DECK_OVER+OUTLINE_OVER);m?.setDepth(d+DECK_OVER);
      let alpha=1;
      if(under){
        const p=this.bodyOf[i];
        if(p&&p.kind!=='pillar'){
          const dx=Math.max(p.x0-hero.x,0,hero.x-p.x1),dy=Math.max(p.y0-hero.y,0,hero.y-p.y1);
          if(dx*dx+dy*dy<UNDER_RADIUS*UNDER_RADIUS)alpha=UNDER_ALPHA;
        }
      }
      if(g.alpha!==alpha){g.setAlpha(alpha);m?.setAlpha(alpha);}
    }
    for(const a of this.props)a.img?.setDepth(this.hooks.depthOf(a.key)+(a.prop.floor===1?ON_STRIP:0));
    if(this.uno?.img)this.uno.img.setDepth(this.hooks.depthOf(this.uno.key)+ON_STRIP);
  }
  /** Screen lift (px) of a body of floor `floor` standing at (x, y): the deck's surface height, 0 on the ground. */
  bodyLift(x:number,y:number,floor:number|undefined):number{
    return floor===1?surfaceHeight(this.viaducts,this.unit,x,y,1)*HEIGHT_PX:0;
  }
  /**
   * Draw depth of a body of floor 1 at (x, y): just above the strip under it; undefined when it is on no strip, or
   * before the first draw (no keys yet: the caller falls back to the city's depth, never a NaN in the display list).
   */
  bodyDepth(x:number,y:number):number|undefined{
    if(this.stripAt(x,y)===undefined)return undefined;
    const key=this.deckKey(x-this.unit,y-this.unit,x+this.unit,y+this.unit);
    return Number.isFinite(key)?this.hooks.depthOf(key)+ON_STRIP:undefined;
  }
  /** True when the ground at (x, y) is under a deck (or the ramp's foot, where its strips hang over). */
  under(x:number,y:number){return this.viaducts.some(v=>overDeck(v,this.unit,x,y));}
  destroy(){
    for(const g of this.strips)g.destroy();this.strips.length=0;
    for(const m of this.meshes)m?.destroy();this.meshes=[];
    this.shadow?.destroy();this.shadow=undefined;this.crosswalk?.destroy();this.crosswalk=undefined;
    for(const a of this.props){a.img?.destroy();a.img=undefined;}
    this.uno?.img?.destroy();if(this.uno)this.uno.img=undefined;
  }

  /**
   * The highest key of the deck and ramp cells overlapping the box (u): a body or a piece there draws above them all,
   * so the cells in front of those (lower on screen than its feet) never cover it.
   */
  private deckKey(x0:number,y0:number,x1:number,y1:number):number{
    let key=-Infinity;
    // Before the first draw the keys are not there (Math.max with undefined is NaN).
    for(const p of this.pieces)if((p.kind==='deck'||p.kind==='ramp')&&p.x0<x1&&p.x1>x0&&p.y0<y1&&p.y1>y0)key=Math.max(key,this.keys[p.strip]??-Infinity);
    return key;
  }
  /** The highest front-corner key of the city's blocks under piece `p` (their parts inside its footprint), or −∞. */
  private blockKeyUnder(p:ViaductPiece,view:number):number{
    let key=-Infinity;
    for(const [x,y,w,h] of this.hooks.blocks??[]){
      const x0=Math.max(x,p.x0),y0=Math.max(y,p.y0),x1=Math.min(x+w,p.x1),y1=Math.min(y+h,p.y1);
      if(x1-x0>1e-6&&y1-y0>1e-6)key=Math.max(key,pieceKey({...p,x0,y0,x1,y1},view));
    }
    return key;
  }
  /** The deck strip over a pillar (the one holding its centre). */
  private stripOver(p:ViaductPiece):number|undefined{
    const x=(p.x0+p.x1)/2,y=(p.y0+p.y1)/2;
    return this.pieces.find(q=>q.kind==='deck'&&x>=q.x0&&x<q.x1&&y>=q.y0&&y<q.y1)?.strip;
  }
  /** Depth key of strip `i` at `view`: its deck or ramp piece's front corner. */
  private stripKey(i:number,view:number):number{
    const q=this.pieces.find(r=>r.strip===i&&(r.kind==='deck'||r.kind==='ramp'));
    return q?pieceKey(q,view):Infinity;
  }
  private stripAt(x:number,y:number):number|undefined{
    for(const p of this.pieces)if((p.kind==='deck'||p.kind==='ramp')&&x>=p.x0&&x<p.x1&&y>=p.y0&&y<p.y1)return p.strip;
    for(const v of this.viaducts)if(overDeck(v,this.unit,x,y)||onRamp(v,this.unit,x,y)){
      // On the edge of a strip (float): the nearest one.
      let best:number|undefined,bd=Infinity;
      for(const p of this.pieces){if(p.kind!=='deck'&&p.kind!=='ramp')continue;const d=Math.hypot((p.x0+p.x1)/2-x,(p.y0+p.y1)/2-y);if(d<bd){bd=d;best=p.strip;}}
      return best;
    }
    return undefined;
  }
  /** The viaduct a piece belongs to (the one whose deck or ramp holds its centre, else the first). */
  private viaductOf(p:ViaductPiece):CityViaduct{
    const x=(p.x0+p.x1)/2,y=(p.y0+p.y1)/2;
    return this.viaducts.find(v=>overDeck(v,this.unit,x,y)||onRamp(v,this.unit,x,y))??this.viaducts[0];
  }
  private draw(view:number){
    this.view=view;
    const strips=1+Math.max(-1,...this.pieces.map(p=>p.strip));
    while(this.strips.length<strips)this.strips.push(this.scene.add.graphics());
    for(const g of this.strips)g.clear();
    for(const m of this.meshes)m?.destroy();this.meshes=[];
    this.shadow??=this.scene.add.graphics().setDepth(this.shadowDepth);
    this.shadow.clear();
    this.keys.length=0;
    for(let i=0;i<strips;i++)this.keys.push(-Infinity);
    const front=frontSides(view),textured=this.textured();
    const at=(c:Pt,z:number)=>{const q=project(c.x,c.y,z,view);return {x:q.x,y:q.y-this.hooks.groundPx(c.x,c.y)};};
    /** Per strip, the faces' mesh buffers (textured only). */
    const buf=new Map<number,{verts:number[];uvs:number[];idx:number[];colors:number[];alphas:number[]}>();
    const quad=(strip:number,pts:readonly Pt[],st:readonly [number,number][],region:readonly [number,number,number,number],tint:number)=>{
      let b=buf.get(strip);
      if(!b)buf.set(strip,b={verts:[],uvs:[],idx:[],colors:[],alphas:[]});
      const n=b.verts.length/2;
      // Mesh vertices are y-up (Phaser's mesh space): negate y to stay in screen px (as city-layer groundMesh).
      for(let k=0;k<4;k++){b.verts.push(pts[k].x,-pts[k].y);b.uvs.push(...regionUv(region,st[k][0],st[k][1]));b.colors.push(tint);b.alphas.push(1);}
      b.idx.push(n,n+1,n+2,n,n+2,n+3);
    };
    // A car box gives way to its image once the image's sheet is in.
    const artIn=(p:ViaductPiece)=>{
      const art=(p as ViaductPiece&{art?:string}).art;
      if(art==='uno')return this.has(UNO_KEY);
      const i=art?.startsWith('pile')?+art.slice(4):-1,s=this.props.filter(a=>a.prop.floor===1&&a.prop.id.startsWith('carro-batido'))[i]?.sheet;
      return !!s&&this.has(s.key);
    };
    // Pieces in back-to-front order inside a strip: the slab and the ramp first, then their parapets, then the cars (a
    // pillar, then its cap).
    const rank=(p:ViaductPiece)=>p.kind==='car'?2:p.kind==='parapet'||p.kind==='cap'?1:0;
    const order=[...this.pieces].sort((a,b)=>rank(a)-rank(b));
    for(const p of order){
      const corners=cornersOf(p);
      if(p.kind==='shadow'){
        this.shadow.fillStyle(BREU,.16).fillPoints(corners.map(c=>at(c,0)),true);
        continue;
      }
      const g=this.strips[p.strip];
      if(p.kind==='deck'||p.kind==='ramp')this.keys[p.strip]=Math.max(this.keys[p.strip],pieceKey(p,view),this.blockKeyUnder(p,view)+ON_STRIP);
      // A pillar stands under its strip: drawn just before it (its own front corner can be the strip's, which then put
      // it over the slab), and after the street behind it.
      else if(p.kind==='pillar'){const over=this.stripOver(p);this.keys[p.strip]=Math.min(pieceKey(p,view),over===undefined?Infinity:this.stripKey(over,view))-ON_STRIP;}
      // A car on the deck: above every cell under it (the cells were keyed first: the cars come last in `order`).
      else if(p.kind==='car'){
        this.keys[p.strip]=this.deckKey(p.x0,p.y0,p.x1,p.y1)+ON_STRIP;
        if(artIn(p))continue;
      }
      const tops=corners.map((c,k)=>at(c,p.top[k])),bottoms=corners.map((c,k)=>at(c,p.bottom[k]));
      const car=p.kind==='car'?(p as ViaductPiece&{color:number}).color:undefined;
      for(const side of front){
        const [a,b]=SIDE_CORNERS[side],dark=side==='e'||side==='s'?view%2===0:view%2===1,face=[tops[a],tops[b],bottoms[b],bottoms[a]];
        if(textured&&car===undefined){
          const tint=dark?TINT_DARK:TINT_LIGHT;
          if(p.kind==='ramp'){
            // The ramp's side: the beam along its top (DECK_SLAB, less at the foot), the embankment's wall under it.
            const z=(k:number)=>Math.max(0,p.top[k]-DECK_SLAB),mid=[at(corners[a],z(a)),at(corners[b],z(b))];
            const st=concreteST(p,side,this.unit),band=(k:number)=>Math.min(1,(p.top[k]-z(k))/DECK_SLAB);
            quad(p.strip,[tops[a],tops[b],mid[1],mid[0]],[[st[0][0],0],[st[1][0],0],[st[1][0],band(b)],[st[0][0],band(a)]],FACES_BEAM,tint);
            const wall=concreteST({...p,top:[z(0),z(1),z(2),z(3)]},side,this.unit);
            quad(p.strip,[mid[0],mid[1],bottoms[b],bottoms[a]],wall,FACES_CONCRETE,tint);
          }else if(p.kind==='pillar')quad(p.strip,face,bandST(p,side,this.unit,true),FACES_PILLAR,tint);
          else quad(p.strip,face,bandST(p,side,this.unit),p.kind==='parapet'?FACES_BARRIER:FACES_BEAM,tint);
          // Outlines: the pillar's and the cap's whole side; the slab's and the parapet's lower edge (the faces carry
          // their own detail).
          if(p.kind==='pillar'||p.kind==='cap')g.lineStyle(1.5,BREU,.55).strokePoints(face,true);
          else g.lineStyle(1.5,BREU,.55).lineBetween(bottoms[a].x,bottoms[a].y,bottoms[b].x,bottoms[b].y);
          continue;
        }
        g.fillStyle(car!==undefined?shade(car,dark?.62:.8):dark?SIDE_DARK:SIDE_LIGHT,1).fillPoints(face,true);
        g.lineStyle(1.5,BREU,.55).strokePoints(face,true);
      }
      if(textured&&(p.kind==='deck'||p.kind==='ramp')){
        quad(p.strip,tops,roadST(p,this.viaductOf(p),this.unit),FACES_ROAD,TINT_TOP);
        continue;
      }
      if(textured&&(p.kind==='parapet'||p.kind==='cap')){
        quad(p.strip,tops,capST(p,this.unit),FACES_CAP,TINT_TOP);
        g.lineStyle(1.5,BREU,.7).strokePoints(tops,true);
        continue;
      }
      g.fillStyle(car??(p.kind==='parapet'?CAP:TOP),1).fillPoints(tops,true);
      g.lineStyle(p.kind==='parapet'?1.5:2,BREU,.7).strokePoints(tops,true);
    }
    if(textured)for(const [strip,b] of buf)this.meshes[strip]=this.mesh(FACES_KEY,b);
    this.drawCrosswalk(view);
    this.placeArt(view,at);
  }
  /** A Mesh of `key` from the buffers (screen px), computed now (not on the update list, like city-layer groundMesh). */
  private mesh(key:string,b:{verts:number[];uvs:number[];idx:number[];colors:number[];alphas:number[]}):Phaser.GameObjects.Mesh{
    const m=this.scene.add.mesh(0,0,key);
    m.hideCCW=false;
    m.setOrtho(m.width,m.height);
    m.addVertices(b.verts,b.uvs,b.idx,false,undefined,b.colors,b.alphas);
    (m as unknown as {preUpdate(time:number,delta:number):void}).preUpdate(0,0);
    return m;
  }
  /** The crosswalk's tiles on the ground (under the deck's shadow), once its decal is in. */
  private drawCrosswalk(view:number){
    this.crosswalk?.destroy();this.crosswalk=undefined;
    if(!this.webgl()||!this.has(CROSSWALK_KEY)||typeof this.scene.add.mesh!=='function')return;
    const b={verts:[] as number[],uvs:[] as number[],idx:[] as number[],colors:[] as number[],alphas:[] as number[]};
    for(const v of this.viaducts)for(const t of crosswalkTiles(v,this.unit)){
      const n=b.verts.length/2,pts:Pt[]=[{x:t.x0,y:t.y0},{x:t.x1,y:t.y0},{x:t.x1,y:t.y1},{x:t.x0,y:t.y1}];
      pts.forEach((c,k)=>{const q=project(c.x,c.y,0,view);b.verts.push(q.x,-(q.y-this.hooks.groundPx(c.x,c.y)));b.uvs.push(CROSSWALK_UV[k===1||k===2?1:0],k>=2?1:0);b.colors.push(0xffffff);b.alphas.push(.9);});
      b.idx.push(n,n+1,n+2,n,n+2,n+3);
    }
    if(b.idx.length)this.crosswalk=this.mesh(CROSSWALK_KEY,b).setDepth(this.shadowDepth-1);
  }
  /** Places the pieces' images (and the Uno) for `view`, each keyed above the deck cells under it (floor 1). */
  private placeArt(view:number,at:(c:Pt,z:number)=>Pt){
    for(const a of this.props){
      const s=a.sheet;
      if(!s||!this.has(s.key))continue;
      const {x,y,floor,rot}=a.prop,frame=artViewOf(view,rot)/90,q=at({x,y},floor===1?a.v.height:0);
      a.img??=this.scene.add.image(0,0,s.key,frame).setOrigin(.5,s.originY).setScale(s.scale*(a.prop.scale??1));
      a.img.setFrame(frame).setPosition(q.x,q.y);
      // Floor 1: above the deck cells under its middle (a gantry: across the deck); the street: its own point.
      const hx=a.prop.id==='portico-placa'?(a.v.deck[2]*this.unit)/2:.6;
      a.key=floor===1?this.deckKey(x-hx,y-.3,x+hx,y+.3):depthKey(x,y,view);
    }
    const u=this.uno;
    if(u&&this.has(UNO_KEY)){
      const h=unoHeading(u.v),q=at(u,u.v.height);
      u.img??=this.scene.add.image(0,0,UNO_KEY,0).setOrigin(.5,UNO_FOOT).setScale(UNO_SCALE);
      u.img.setFrame(unoFrame(h,view)).setPosition(q.x,q.y+unoFootY(h,view));
      u.key=this.deckKey(u.x-1.2,u.y-1.2,u.x+1.2,u.y+1.2);
    }
  }
}
