/**
 * The new scenery on the city (NEW-20261016-ORQ-cenario-no-mapa), the pure half: where and how the city layer draws the
 * base image of one decor piece (the asset's `decor`, maps/city-decor.ts) from its `cenario` sheet (art-plan.ts
 * DecorSheet). No Phaser.
 *
 * - Art view: the piece's own rot plus the camera's quarter turns (live/rules.ts artViewOf); the sheet frame is that
 *   view (4 columns, 0/90/180/270).
 * - 'footprint' pieces put the front corner of their cells on the anchor, standing on the lowest ground under them (as
 *   the building lots, city-layer drawLot); the art's footprint a×b is the entry's before its rot (front along a:
 *   maps/city-decor.ts LUGARES). They sort by the centre of their cells, not that corner: a point object beside the
 *   piece (a pole along a 6×6 mountain's side) is in front of it exactly when its key passes the centre's on a square
 *   footprint, where the front corner's key is ~a cells deeper and drew the mountain over the pole beside it
 *   (montanha-sobre-poste). Actors still sort exactly against the piece's column (occlusion.ts actorDepth).
 * - 'wall' and 'prop' pieces stand at the centre of their cells, sorted by that point: a prop on the ground there, a wall
 *   on the lowest corner under its cells (wallBase).
 */
import {groundZ,heightAt,type CityAsset} from './asset.ts';
import {ART_CELL,texelOf,type DecorSheet} from './art-plan.ts';
import {artViewOf,decorKey,type ArtView,type DecorEntry} from './live/rules.ts';
import {buildingAnchor,frontCorner} from './materials.ts';
import {depth,project,type Pt} from './projection.ts';

export interface DecorSprite {
  /** Screen point (projected px) of the anchor, image origin (fractions of the frame), display scale. */
  x:number;y:number;originX:number;originY:number;scale:number;
  artView:ArtView;frame:number;
  /** Projection depth key (before the layer's depthOf). */
  depth:number;
  /** Ground height (render units) the piece stands on. */
  base:number;
}

/** The art footprint of an entry: its w×h before the rot (a along the front). */
export const decorFootprint=(e:Pick<DecorEntry,'w'|'h'|'rot'>):[number,number]=>(Math.round(e.rot/90)%2===0?[e.w,e.h]:[e.h,e.w]);

export function decorSprite(entry:DecorEntry,sheet:DecorSheet,view:number,asset:CityAsset,pivot:Pt):DecorSprite{
  const artView=artViewOf(view,entry.rot),frame=artView/90,{cell,origin}=asset;
  if(sheet.rule==='footprint'){
    const fc=frontCorner(view),[a,b]=decorFootprint(entry);
    const wx=origin.x+(entry.c+fc.i*entry.w)*cell,wy=origin.y+(entry.r+fc.j*entry.h)*cell;
    let base=Infinity;
    for(let j=entry.r;j<entry.r+entry.h;j++)for(let i=entry.c;i<entry.c+entry.w;i++)base=Math.min(base,heightAt(asset,i,j));
    const at=project(wx,wy,base,view,pivot),o=buildingAnchor(a,b,frame,sheet.frameWidth/texelOf(sheet),sheet.frameHeight/texelOf(sheet),ART_CELL);
    const key=depth(origin.x+(entry.c+entry.w/2)*cell,origin.y+(entry.r+entry.h/2)*cell,view,pivot);
    return {x:at.x,y:at.y,originX:o.originX,originY:sheet.originY,scale:sheet.scale,artView,frame,depth:key,base};
  }
  const wx=origin.x+(entry.c+entry.w/2)*cell,wy=origin.y+(entry.r+entry.h/2)*cell;
  const base=sheet.rule==='wall'?wallBase(asset,entry):groundZ(asset,wx,wy);
  const at=project(wx,wy,base,view,pivot);
  return {x:at.x,y:at.y,originX:.5,originY:sheet.originY,scale:sheet.scale,artView,frame,depth:depth(wx,wy,view,pivot),base};
}

/**
 * Ground a wall piece stands on: the lowest corner under its cells. Wall cells keep the raw terrace corners (maps/city/
 * relief.ts locks them), so the ground at each piece's centre jumps up and down along one straight run (a 0.3 corner
 * among 2.5 ones) and the pieces read as steps with gaps between them (cercas-nordeste-ligadas); the lowest corner is
 * the same for neighbours that share it, never floats a piece over the ground, only sinks it a little into a rise.
 */
export function wallBase(asset:CityAsset,e:Pick<DecorEntry,'c'|'r'|'w'|'h'>){
  let base=Infinity;
  if(!asset.corners){
    for(let j=e.r;j<e.r+e.h;j++)for(let i=e.c;i<e.c+e.w;i++)base=Math.min(base,heightAt(asset,i,j));
    return base;
  }
  const W=asset.width+1,cl=(v:number,m:number)=>Math.max(0,Math.min(m,v));
  for(let j=e.r;j<=e.r+e.h;j++)for(let i=e.c;i<=e.c+e.w;i++)base=Math.min(base,asset.corners[cl(j,asset.height)*W+cl(i,asset.width)]);
  return base;
}

/** Chunk key (`i,j`, chunks.ts) of the cell holding a decor's centre: the chunk that draws it. */
export function decorChunk(e:Pick<DecorEntry,'c'|'r'|'w'|'h'>,chunkSize:number){
  return `${Math.floor((e.c+Math.floor((e.w-1)/2))/chunkSize)},${Math.floor((e.r+Math.floor((e.h-1)/2))/chunkSize)}`;
}

/** Fade id of a decor piece (see-through, city-layer). */
export const decorFade=(e:DecorEntry)=>`d:${decorKey(e)}`;
/** World point of a decor's centre (its cell, for tests). */
export const decorCentre=(asset:CityAsset,e:DecorEntry)=>({x:asset.origin.x+(e.c+e.w/2)*asset.cell,y:asset.origin.y+(e.r+e.h/2)*asset.cell});

