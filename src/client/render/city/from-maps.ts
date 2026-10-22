/**
 * Adapter from the official city asset (D-027, decoded by the maps sector) to the city render's own asset
 * (asset.ts). Pure and deterministic: no randomness, every per-object choice is seeded by an FNV-1a hash of the
 * object's id, and every pass over the map is O(cells) (plus O(rects) and O(props)).
 *
 * The maps asset is imported through the maps sector's door only (src/maps/index.ts), which exports the decoded
 * CityAsset type and the terrain's height scale.
 */
import type {CityAsset as MapsCityAsset,CityBlock as MapsCityBlock} from '../../../maps/index.ts';
import {CITY_HEIGHT_PX_PER_UNIT,cityRelief} from '../../../maps/index.ts';
import {CITY_MAP_SCALE} from '../../../rules/index.ts';
import type {BlockKind,CityAsset,CityBlock,CityPointName,CityProp,PropKind} from './asset.ts';
import {HEIGHT_PX} from './projection.ts';

// ---- rule constants ----

/**
 * Render height units per terrain unit. Actors stand at CityTerrain.height = (heightAt - minHeight) * 21 px and the
 * render draws z * HEIGHT_PX (42) px, so a corner of terrain height h is drawn at z = (h - minHeight) * 21 / 42.
 */
export const HEIGHT_SCALE=CITY_HEIGHT_PX_PER_UNIT/HEIGHT_PX;
/** Samples per cell side in D-027 (4 × 4 = 16 per cell). */
const SAMPLES=4;
/** A cell draws water when at least this many of its 16 samples are water (a fountain rim still reads as water). */
export const WATER_MIN_SAMPLES=2;
/** A cell counts as walkable when at least half of its 16 samples are walkable. */
export const WALKABLE_MIN_SAMPLES=8;
/** Cobble plaza: the box spanned by the four plaza mouths (points.bocas), grown by this many cells per side. */
export const PLAZA_PAD_CELLS=1;
/** Cobble plaza fallback: also every cell centre within this radius (cells) of points.praca. */
export const PLAZA_RADIUS_CELLS=3;
/** Avenues (packed snow): cells whose centre is within this distance (cells) of a mouth → spawn segment. */
export const AVENUE_HALF_WIDTH_CELLS=2;
/** Ring road (packed snow): cells 1..RING_BAND_CELLS cells (Chebyshev) away from the map's 'edge' blocks. */
export const RING_BAND_CELLS=4;
/** Block heights grow with the map (NEW-20261013-ORQ-cidade-escala-1-7): the .w3x-scale value × CITY_MAP_SCALE, to 0.01. */
const mapHeight=(v:number)=>Math.round(v*CITY_MAP_SCALE*100)/100;
/** Building height in render units, seeded by block id inside [min, max] and rounded to 0.01 (2.2–3.8 × 1.7 = 3.74–6.46). */
export const BUILDING_HEIGHT_MIN=mapHeight(2.2),BUILDING_HEIGHT_MAX=mapHeight(3.8);
/** Share of buildings drawn as ruins (seeded by block id): the city is in ruins. */
export const RUINED_PERCENT=60;
/** Fixed heights (render units) of the other block kinds, × CITY_MAP_SCALE like the buildings (1.6 → 2.72, 0.3 → 0.51). */
export const WALL_HEIGHT=mapHeight(1.6),EDGE_HEIGHT=mapHeight(1.6),RUBBLE_HEIGHT=mapHeight(0.3);
/**
 * Cliffs are terrain steps whose relief already lives in the height grid: a low lip, not a second step (kept as is:
 * the step itself grew with the asset's heights).
 */
export const CLIFF_LIP_HEIGHT=0.35;
/** Prop footprint radius clamp (world units); the render drops r <= 0. Props keep their absolute size (not × the map scale). */
export const PROP_R_MIN=0.1,PROP_R_MAX=0.8;
/**
 * Props closer than PROP_STACK (world units) to one already kept, whatever the kind, are one doodad stacked several
 * times in the .w3x (a stacked `prop` hashes to a different kind per copy: lamp, barrel, crate…). A distance between
 * the asset's prop positions, so 0.5 u of the .w3x × CITY_MAP_SCALE (the same props survive on the 1.7× map).
 */
export const PROP_STACK=0.5*CITY_MAP_SCALE;
/**
 * Same-kind props closer than this are dropped too: a lamp per street spot (2.5 u of the .w3x × CITY_MAP_SCALE: street
 * lamps stand farther apart; the .w3x clusters them 1–2 u apart); the rest only by PROP_STACK.
 */
export const PROP_DEDUP:Readonly<Record<PropKind,number>>={lamp:2.5*CITY_MAP_SCALE,pine:PROP_STACK,car:PROP_STACK,rubble:PROP_STACK,crate:PROP_STACK,barrel:PROP_STACK,bench:PROP_STACK,debris:PROP_STACK};

/** maps prop kind → render prop kind(s); several = chosen per prop by hash; null = not drawn as a prop. */
const PROP_KINDS:Readonly<Record<string,readonly PropKind[]|null>>={
  tree:['pine'],rock:['rubble'],wreck:['car'],ruin:['debris'],
  prop:['crate','barrel','bench','lamp'],
  // The fountain is drawn by its water cells; doors are openings in buildings, not decorations.
  fountain:null,door:null,
};
/** Unknown maps prop kinds render as debris. */
const UNKNOWN_PROP:PropKind='debris';

/** D-027 block kind → render block kind ('edge', the map boundary, draws as a wall). */
const BLOCK_KIND:Readonly<Record<MapsCityBlock['kind'],BlockKind>>={building:'building',wall:'wall',cliff:'cliff',rubble:'rubble',edge:'wall'};

/** FNV-1a of `${id}:${salt}`: the same decision on every client, run and view. */
function hash(id:string,salt:string):number{
  const s=`${id}:${salt}`;
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}
  return h>>>0;
}

/**
 * World length → whole cell edge. Snapped to 1e-6 cell first so a shared edge written as x+w in one rect and as x
 * in the next rounds the same way; then half-up rounding: a cell belongs to a rect when its centre is inside it.
 */
const cellEdge=(v:number,cell:number)=>Math.round(Math.round(v/cell*1e6)/1e6);

/** Squared distance from (px,py) to the segment a→b. */
function segDist2(px:number,py:number,ax:number,ay:number,bx:number,by:number){
  const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
  let t=len2>0?((px-ax)*dx+(py-ay)*dy)/len2:0;
  if(t<0)t=0;else if(t>1)t=1;
  const ex=ax+dx*t-px,ey=ay+dy*t-py;
  return ex*ex+ey*ey;
}

/** Cover codes of a cell (which block draws over it). */
const COVER_NONE=0,COVER_PLAIN=1,COVER_RUBBLE=2,COVER_EDGE=3;

/**
 * Converts a decoded D-027 city asset into the render's asset. `terrainMinHeight` is the lowest corner height the
 * terrain uses as its zero (CityTerrain computes it as the minimum over all corners, which is also the default here).
 *
 * Rules:
 * 1. Grid: same cells (width × height), cell = unitsPerCell (1.496 since cidade-escala-1-7), origin (0,0): D-027 puts the origin at the NW
 *    corner of the cell grid with x east and y south, and actors/terrain use those world units directly, which is
 *    exactly what the render projects.
 * 2. Heights: corners = (corner height - minHeight) * HEIGHT_SCALE for every grid corner, so the ground is drawn at
 *    the pixel height actors stand on; `heights` (per cell) = mean of the cell's 4 corners.
 * 3. Ground letters, in priority order: 'w' water cells (≥ WATER_MIN_SAMPLES water samples); cells under a render
 *    block → 'r' under a ruined building or a rubble block, else 's' (hidden by the block); unwalkable cells → 'r'
 *    rubble ground; the plaza → 'c' cobble (box of the four mouths grown by PLAZA_PAD_CELLS, plus a disc of
 *    PLAZA_RADIUS_CELLS around the praça); streets → 'p' packed snow (the cross avenues: within
 *    AVENUE_HALF_WIDTH_CELLS of each mouth → spawn segment, and the ring road: within RING_BAND_CELLS of an 'edge'
 *    block); everything else 's' fresh snow.
 * 4. Blocks: each rect of a block becomes one render block rounded to whole cells (a cell is in when its centre is
 *    in the rect), clipped to the grid, empty ones dropped; id `${block.id}#r${rectIndex}`, group = block.id so a
 *    multi-rect building fades as one. Height by kind (render units): building seeded in
 *    [BUILDING_HEIGHT_MIN, BUILDING_HEIGHT_MAX]; wall WALL_HEIGHT; edge → 'wall' EDGE_HEIGHT; cliff CLIFF_LIP_HEIGHT;
 *    rubble RUBBLE_HEIGHT. `ruined` on ~RUINED_PERCENT% of buildings, seeded by block id (shared by all its rects).
 * 5. Props: kinds mapped by PROP_KINDS ('prop' picks crate/barrel/bench/lamp by hash of the prop id; fountain and
 *    door are dropped; unknown kinds → debris); r clamped to [PROP_R_MIN, PROP_R_MAX]; id `p${sourceIndex}`; props
 *    whose cell is under a render block are dropped; one per spot: a prop closer than PROP_STACK to one already kept,
 *    or closer than PROP_DEDUP to one of its kind, is dropped too.
 * 6. Points: inicio, praca, spawnN/S/L/O and bocas N/S/L/O as bocaN/bocaS/bocaL/bocaO.
 * 7. Decor (the new scenery): copied as is, omitted when empty.
 * The result is already in parseCityAsset's normal form (parsing it returns an equal value).
 */
export function cityRenderAsset(asset:MapsCityAsset,terrainMinHeight?:number):CityAsset{
  const W=asset.cells.w,H=asset.cells.h,cell=asset.unitsPerCell,cells=W*H;

  // 1–2. Heights at corners, in render units, matching CityTerrain's pixel height.
  const hw=W+1,hh=H+1,hc=asset.heightsCenti,relief=cityRelief(asset);
  let min=terrainMinHeight;
  if(min===undefined||!Number.isFinite(min)){
    let m=Infinity;
    for(let i=0;i<hc.length;i++)if(hc[i]<m)m=hc[i];
    min=Number.isFinite(m)?m/100:0;
  }
  const corners:number[]=new Array(hw*hh);
  // The relief (maps/city/relief.ts: ramps, snow undulation), the surface CityTerrain.bed puts actors on.
  for(let i=0;i<hw*hh;i++)corners[i]=(relief[i]-min)*HEIGHT_SCALE;
  const heights:number[]=new Array(cells);
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){
    const i=cy*hw+cx;
    heights[cy*W+cx]=(corners[i]+corners[i+1]+corners[i+hw]+corners[i+hw+1])/4;
  }

  // 4. Blocks, plus which cells they cover.
  const cover=new Uint8Array(cells);
  const blocks:CityBlock[]=[];
  for(const b of asset.blocks){
    const kind=BLOCK_KIND[b.kind];
    let height:number,ruined=false;
    if(b.kind==='building'){
      const u=hash(b.id,'height')/0x100000000;
      height=Math.round((BUILDING_HEIGHT_MIN+(BUILDING_HEIGHT_MAX-BUILDING_HEIGHT_MIN)*u)*100)/100;
      ruined=hash(b.id,'ruined')%100<RUINED_PERCENT;
    }else height=b.kind==='wall'?WALL_HEIGHT:b.kind==='edge'?EDGE_HEIGHT:b.kind==='cliff'?CLIFF_LIP_HEIGHT:RUBBLE_HEIGHT;
    const code=b.kind==='edge'?COVER_EDGE:b.kind==='rubble'||ruined?COVER_RUBBLE:COVER_PLAIN;
    for(let r=0;r<b.rects.length;r++){
      const [x,y,w,h]=b.rects[r];
      const x0=Math.max(0,cellEdge(x,cell)),y0=Math.max(0,cellEdge(y,cell));
      const x1=Math.min(W,cellEdge(x+w,cell)),y1=Math.min(H,cellEdge(y+h,cell));
      if(x1<=x0||y1<=y0)continue;
      blocks.push({id:`${b.id}#r${r}`,kind,x:x0,y:y0,w:x1-x0,h:y1-y0,height,...(ruined?{ruined:true}:{}),group:b.id});
      for(let cy=y0;cy<y1;cy++)for(let cx=x0;cx<x1;cx++){
        const i=cy*W+cx;
        // Edge wins (it seeds the ring road), then rubble-looking cover, then plain.
        if(code>cover[i])cover[i]=code;
      }
    }
  }

  // 3. Ground letters. Sample counts per cell straight from the packed bitsets (LSB-first, row-major).
  const walkCount=new Uint8Array(cells),waterCount=new Uint8Array(cells);
  const sw=asset.samples.w,sh=asset.samples.h,wb=asset.walkableBits,wa=asset.waterBits;
  for(let sy=0;sy<sh;sy++){
    const row=((sy/SAMPLES)|0)*W,base=sy*sw;
    for(let sx=0;sx<sw;sx++){
      const i=base+sx,c=row+((sx/SAMPLES)|0);
      walkCount[c]+=wb[i>>3]>>(i&7)&1;
      if(wa)waterCount[c]+=wa[i>>3]>>(i&7)&1;
    }
  }

  // Ring road: Chebyshev distance (cells) to the nearest 'edge' cell, two-pass chamfer, O(cells).
  const FAR=0xffff,dist=new Uint16Array(cells);
  for(let i=0;i<cells;i++)dist[i]=cover[i]===COVER_EDGE?0:FAR;
  const relax=(i:number,j:number)=>{if(dist[j]+1<dist[i])dist[i]=dist[j]+1;};
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){
    const i=cy*W+cx;
    if(cx>0)relax(i,i-1);
    if(cy>0){relax(i,i-W);if(cx>0)relax(i,i-W-1);if(cx<W-1)relax(i,i-W+1);}
  }
  for(let cy=H-1;cy>=0;cy--)for(let cx=W-1;cx>=0;cx--){
    const i=cy*W+cx;
    if(cx<W-1)relax(i,i+1);
    if(cy<H-1){relax(i,i+W);if(cx<W-1)relax(i,i+W+1);if(cx>0)relax(i,i+W-1);}
  }

  // Plaza box and avenue segments, in cell coordinates.
  const p=asset.points,c=(v:number)=>v/cell;
  const mouths=[p.bocas.N,p.bocas.S,p.bocas.L,p.bocas.O];
  const px0=Math.min(...mouths.map(m=>c(m.x)))-PLAZA_PAD_CELLS,px1=Math.max(...mouths.map(m=>c(m.x)))+PLAZA_PAD_CELLS;
  const py0=Math.min(...mouths.map(m=>c(m.y)))-PLAZA_PAD_CELLS,py1=Math.max(...mouths.map(m=>c(m.y)))+PLAZA_PAD_CELLS;
  const pcx=c(p.praca.x),pcy=c(p.praca.y),plazaR2=PLAZA_RADIUS_CELLS*PLAZA_RADIUS_CELLS;
  const avenues=[[p.bocas.N,p.spawnN],[p.bocas.S,p.spawnS],[p.bocas.L,p.spawnL],[p.bocas.O,p.spawnO]]
    .map(([a,b])=>[c(a.x),c(a.y),c(b.x),c(b.y)] as const);
  const aveR2=AVENUE_HALF_WIDTH_CELLS*AVENUE_HALF_WIDTH_CELLS;

  let ground='';
  for(let cy=0;cy<H;cy++){
    let line='';
    for(let cx=0;cx<W;cx++){
      const i=cy*W+cx,x=cx+.5,y=cy+.5;
      let g='s';
      if(waterCount[i]>=WATER_MIN_SAMPLES)g='w';
      else if(cover[i]!==COVER_NONE)g=cover[i]===COVER_RUBBLE?'r':'s';
      else if(walkCount[i]<WALKABLE_MIN_SAMPLES)g='r';
      else if((x>=px0&&x<=px1&&y>=py0&&y<=py1)||(x-pcx)**2+(y-pcy)**2<=plazaR2)g='c';
      else if(dist[i]<=RING_BAND_CELLS)g='p';
      else for(const [ax,ay,bx,by] of avenues)if(segDist2(x,y,ax,ay,bx,by)<=aveR2){g='p';break;}
      line+=g;
    }
    ground+=line;
  }

  // 5. Props.
  const props:CityProp[]=[];
  for(let i=0;i<asset.props.length;i++){
    const q=asset.props[i],id=`p${i}`;
    const options=Object.prototype.hasOwnProperty.call(PROP_KINDS,q.kind)?PROP_KINDS[q.kind]:[UNKNOWN_PROP];
    if(!options)continue;
    const cx=Math.floor(q.x/cell),cy=Math.floor(q.y/cell);
    if(cx<0||cy<0||cx>=W||cy>=H||cover[cy*W+cx]!==COVER_NONE)continue;
    const kind=options.length===1?options[0]:options[hash(id,'kind')%options.length];
    // One prop per spot (proporcoes-postes-predios): the .w3x stacks doodads (5 lamps within 1 u by the start); a
    // prop closer than PROP_STACK to one already kept, or of the same kind closer than PROP_DEDUP, is dropped (the first
    // eligible one in source order stays).
    const near=PROP_DEDUP[kind];
    if(props.some(o=>{const d=Math.hypot(o.x-q.x,o.y-q.y);return d<PROP_STACK||(o.kind===kind&&d<near);}))continue;
    props.push({id,kind,x:q.x,y:q.y,r:Math.min(PROP_R_MAX,Math.max(PROP_R_MIN,q.r))});
  }

  // 6. Points.
  const pt=(v:{x:number;y:number})=>({x:v.x,y:v.y});
  const points:Record<CityPointName,{x:number;y:number}>={
    inicio:pt(p.inicio),praca:pt(p.praca),spawnN:pt(p.spawnN),spawnS:pt(p.spawnS),spawnL:pt(p.spawnL),spawnO:pt(p.spawnO),
    bocaN:pt(p.bocas.N),bocaS:pt(p.bocas.S),bocaL:pt(p.bocas.L),bocaO:pt(p.bocas.O),
  };

  // 7. Scenery (cenario-no-mapa): as placed by the maps sector, already on the cell grid.
  const decor=asset.decor.map(q=>({id:q.id,c:q.c,r:q.r,w:q.w,h:q.h,rot:q.rot,...(q.links!==undefined?{links:q.links}:{}),...(q.cover?{cover:true}:{})}));

  return {version:1,name:asset.name,cell,width:W,height:H,origin:{x:0,y:0},heights,corners,ground,blocks,props,...(decor.length?{decor}:{}),points};
}
