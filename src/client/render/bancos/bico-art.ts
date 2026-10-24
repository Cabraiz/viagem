/**
 * The bicos' shop fronts (card NEW-20261024-ORQ-bancos-viram-bicos, etapa 2): pixel art that replaces the ATM kiosk
 * (scripts/import-bicos.mjs writes the group `bicos`, one piece per shop, `bico-<slug>`):
 * - files.sheet: one view (the shop front always faces down-left on the screen, whatever the camera's turn), drawn
 *   with nearest-neighbour filtering at BICO_PX game px per art pixel;
 * - anchor: the foot of the door's middle; meta.porta [x,y,w,h]: the door on the front (bottom-left corner, width along
 *   the front, which drops 1 px per 2 px right, height), lit while a hero works inside.
 * The building stands BICO_BACK units behind the bank's point, so the interaction rings stay on the snow in front of
 * the door. Pure, so it is tested; the renderer (renderer.ts) draws it.
 */
import type {ArtIndex} from '../../art/manifest.ts';
import {groupFileUrl} from '../../art/manifest.ts';
import type {BankName} from '../../../contract/index.ts';

export const BICO_IDS=['24-7','call-center','aura-67','compro-ouro','colchoes','curso'] as const;
export type BicoId=typeof BICO_IDS[number];
/** Until the sim names each bank's bico (etapa 3), each bank keeps one shop. */
export const BICO_OF_BANK:Readonly<Record<BankName,BicoId>>={posto:'24-7','pao-duro':'call-center',juros:'compro-ouro'};
/** Game px per art pixel: the 24/7 comes out ~255 px wide, a lot of about 4×3 cells. */
export const BICO_PX=1.1;
/** Units from the bank's point (the rings' middle) back to the door's foot, along the front's normal. */
export const BICO_BACK=1.6;
/** Units from the door's foot back to the building's middle: its depth, so a hero in front draws over it. */
export const BICO_DEPTH_BACK=1.2;
export const bicoTextureKey=(id:string)=>`art:bicos:${id}`;

export interface BicoArt {
  id:string;key:string;url:string;cell:[number,number];anchor:[number,number];
  /** The door: bottom-left x,y, width along the front, height (art px). */
  porta:[number,number,number,number];
}

const isNums=(v:unknown,n:number):v is number[]=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x));

/** The shop's art when the manifest has it (any group, first wins), else undefined (the renderer keeps the kiosk). */
export function bicoArt(index:ArtIndex,id:string):BicoArt|undefined{
  const name=`bico-${id}`;
  for(const group of Object.values(index.groups)){
    const piece=group.pieces[name],f=piece?.files.sheet;
    if(!f||typeof f.file!=='string'||!isNums(f.cell,2)||!isNums(f.anchor,2))continue;
    const porta=piece.meta?.porta;
    if(!isNums(porta,4))continue;
    return {id,key:bicoTextureKey(id),url:groupFileUrl(group,f.file),cell:[f.cell[0],f.cell[1]],anchor:[f.anchor[0],f.anchor[1]],porta:[porta[0],porta[1],porta[2],porta[3]]};
  }
  return undefined;
}

/**
 * A world offset of `s` units along the screen's down-left (the shop front's normal) for the camera's turn: the
 * projector's rotated +y (render/projector.ts rotate), turned back to the world.
 */
export function frontNormal(view:number,s:number):{x:number;y:number}{
  switch(((view%4)+4)%4){
    case 1:return {x:s,y:0};
    case 2:return {x:0,y:-s};
    case 3:return {x:-s,y:0};
    default:return {x:0,y:s};
  }
}

/** Where the door's foot and the building's middle stand (world units) for a bank at (x,y). */
export function bicoSpots(x:number,y:number,view:number):{door:{x:number;y:number};middle:{x:number;y:number}}{
  const d=frontNormal(view,-BICO_BACK),m=frontNormal(view,-(BICO_BACK+BICO_DEPTH_BACK));
  return {door:{x:x+d.x,y:y+d.y},middle:{x:x+m.x,y:y+m.y}};
}

/** The door's 4 corners relative to the anchor, in game px (bottom-left, bottom-right, top-right, top-left). */
export function doorQuad(art:Pick<BicoArt,'cell'|'anchor'|'porta'>,px=BICO_PX):{x:number;y:number}[]{
  const [x,y,w,h]=art.porta,ax=art.anchor[0]*art.cell[0],ay=art.anchor[1]*art.cell[1];
  return [[x,y],[x+w,y+w/2],[x+w,y+w/2-h],[x,y-h]].map(([u,v])=>({x:(u-ax)*px,y:(v-ay)*px}));
}
