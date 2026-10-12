/**
 * City asset as the renderer reads it (Cidade Nevada, D-026).
 * Mirrors the importer output (card cidade-01, `public/maps/cidade-nevada.json`); when the maps sector
 * publishes its own type, this file re-exports it and keeps only the render-side validation.
 * Grid: `width × height` cells of `cell` world units, row-major from the north-west corner at `origin`.
 * World x grows east, world y grows south (same axes as the island).
 */

/** One letter per cell. Unknown letters render as plain snow. */
export const GROUND_KINDS={
  s:'snow',      // fresh snow (default)
  p:'packed',    // trodden snow: streets and avenues
  i:'ice',       // slippery ice sheets
  w:'water',     // fountain and lake water
  r:'rubble',    // broken ground around ruins
  c:'cobble',    // plaza stones
} as const;
export type GroundLetter=keyof typeof GROUND_KINDS;
export type GroundKind=typeof GROUND_KINDS[GroundLetter];

export type BlockKind='building'|'wall'|'cliff'|'rubble';
/** Solid box on the grid. x/y/w/h in cells; `height` in world units above the ground under it. */
export interface CityBlock {id:string;kind:BlockKind;x:number;y:number;w:number;h:number;height:number;
  /** Ruined roofs are drawn broken (snow piles, holes). */
  ruined?:boolean}

export type PropKind='rubble'|'car'|'lamp'|'pine'|'crate'|'barrel'|'debris'|'bench';
/** Small decoration at a world position; `r` is its footprint radius in world units. */
export interface CityProp {id:string;kind:PropKind;x:number;y:number;r:number}

export type CityPointName='spawnN'|'spawnS'|'spawnL'|'spawnO'|'praca'|'inicio'|'bocaN'|'bocaS'|'bocaL'|'bocaO';
export interface CityAsset {
  version:1;
  name:string;
  /** World units per cell (D-026: 0.88). */
  cell:number;
  width:number;
  height:number;
  /** World position of the north-west corner of cell (0,0). */
  origin:{x:number;y:number};
  /** Ground height per cell in world units, row-major, length width*height. */
  heights:number[];
  /** Ground letter per cell (GROUND_KINDS), row-major, length width*height. */
  ground:string;
  blocks:CityBlock[];
  props:CityProp[];
  points:Partial<Record<CityPointName,{x:number;y:number}>>;
}

const BLOCK_KINDS:readonly BlockKind[]=['building','wall','cliff','rubble'];
const PROP_KINDS:readonly PropKind[]=['rubble','car','lamp','pine','crate','barrel','debris','bench'];
const finite=(...n:unknown[])=>n.every(v=>typeof v==='number'&&Number.isFinite(v));

/**
 * Checks an unknown JSON value against the shape the renderer needs. Throws with a short reason
 * instead of rendering garbage; blocks are clipped to the grid and props outside it are dropped.
 */
export function parseCityAsset(raw:unknown):CityAsset{
  const a=raw as CityAsset;
  if(!a||typeof a!=='object')throw new Error('city asset: not an object');
  if(a.version!==1)throw new Error(`city asset: unsupported version ${String(a.version)}`);
  if(!finite(a.cell,a.width,a.height)||!(a.cell>0)||!Number.isInteger(a.width)||!Number.isInteger(a.height)||a.width<1||a.height<1)
    throw new Error('city asset: bad grid size');
  if(!a.origin||!finite(a.origin.x,a.origin.y))throw new Error('city asset: bad origin');
  const cells=a.width*a.height;
  if(!Array.isArray(a.heights)||a.heights.length!==cells||!a.heights.every(h=>finite(h)))throw new Error('city asset: heights must have width*height numbers');
  if(typeof a.ground!=='string'||a.ground.length!==cells)throw new Error('city asset: ground must have width*height letters');
  const blocks:CityBlock[]=[];
  for(const b of Array.isArray(a.blocks)?a.blocks:[]){
    if(!b||typeof b.id!=='string'||!BLOCK_KINDS.includes(b.kind)||!finite(b.x,b.y,b.w,b.h,b.height))continue;
    const x0=Math.max(0,Math.floor(b.x)),y0=Math.max(0,Math.floor(b.y));
    const x1=Math.min(a.width,Math.floor(b.x+b.w)),y1=Math.min(a.height,Math.floor(b.y+b.h));
    if(x1<=x0||y1<=y0||!(b.height>0))continue;
    blocks.push({id:b.id,kind:b.kind,x:x0,y:y0,w:x1-x0,h:y1-y0,height:b.height,...(b.ruined?{ruined:true}:{})});
  }
  const maxX=a.origin.x+a.width*a.cell,maxY=a.origin.y+a.height*a.cell;
  const props:CityProp[]=[];
  for(const p of Array.isArray(a.props)?a.props:[]){
    if(!p||typeof p.id!=='string'||!PROP_KINDS.includes(p.kind)||!finite(p.x,p.y,p.r))continue;
    if(p.x<a.origin.x||p.y<a.origin.y||p.x>=maxX||p.y>=maxY||!(p.r>0))continue;
    props.push({id:p.id,kind:p.kind,x:p.x,y:p.y,r:p.r});
  }
  const ids=new Set<string>();
  for(const item of [...blocks,...props]){if(ids.has(item.id))throw new Error(`city asset: duplicate id ${item.id}`);ids.add(item.id);}
  return {version:1,name:String(a.name??'cidade'),cell:a.cell,width:a.width,height:a.height,origin:{x:a.origin.x,y:a.origin.y},
    heights:a.heights,ground:a.ground,blocks,props,points:{...(a.points??{})}};
}

/** Ground kind of a cell (snow outside the grid or for unknown letters). */
export function groundAt(asset:CityAsset,cx:number,cy:number):GroundKind{
  if(cx<0||cy<0||cx>=asset.width||cy>=asset.height)return 'snow';
  const letter=asset.ground[cy*asset.width+cx] as GroundLetter;
  return GROUND_KINDS[letter]??'snow';
}
/** Ground height of a cell (0 outside the grid). */
export function heightAt(asset:CityAsset,cx:number,cy:number){
  if(cx<0||cy<0||cx>=asset.width||cy>=asset.height)return 0;
  return asset.heights[cy*asset.width+cx];
}
/** Cell that contains a world point (may be outside the grid). */
export function cellOf(asset:CityAsset,x:number,y:number){
  return {cx:Math.floor((x-asset.origin.x)/asset.cell),cy:Math.floor((y-asset.origin.y)/asset.cell)};
}
