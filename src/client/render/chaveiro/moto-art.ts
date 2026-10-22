/**
 * The chaveiro's moto, painted (card NEW-20261022-ORQ-trocar-procedurais-por-arte): the base sheet `moto-chaveiro`
 * (scripts/import-moto-chaveiro.mjs) replaces the provisional boxes (figures.ts) of the moto with its riders and of the
 * chaveiro standing, once the sheet is loaded; while it is missing or loading the renderer keeps the boxes.
 * - Rows (states): 'sentados' (both on it: riding, stopped, dead), 'so-cida' (parked: he is away), 'tombo' (fallen),
 *   'em-pe-bolsa' (beside it with the bag), 'em-pe-ferramenta' (at the car's door with the tool).
 * - Columns: the screen direction the figure faces (heading turned by the camera view, projected): 0 down-right,
 *   1 down-left, 2 up-right, 3 up-left (motoColumn).
 * - Drawn at meta.escala world px per art px, like the boxes (the projection's own size, no actor scale).
 * Pure rules up top (tested in node); MotoArt only sets textures on images it is given.
 */
import type Phaser from 'phaser';
import {artPiece,hasArt} from '../../art/manifest.ts';
import {baseFile,baseFrame,type BaseFrameRef} from '../../art/base-art.ts';
import {viewTurn} from './iso.ts';
import type {MotoPose} from './figures.ts';

export const MOTO_ART='moto-chaveiro';
export type MotoArtState='sentados'|'so-cida'|'tombo'|'em-pe-bolsa'|'em-pe-ferramenta';
/** The sheet row of a moto pose (rules.ts motoPose). */
export const MOTO_POSE_STATE:Readonly<Record<MotoPose,MotoArtState>>={sitting:'sentados',parked:'so-cida',fallen:'tombo'};

/**
 * Sheet column of a figure facing world `heading` (radians) in camera `view`: the facing projected to the screen
 * (x right, y down: (dx − dy, dx + dy) / 2), then down/up × right/left. A facing straight across the screen goes down
 * (the front view reads better), straight up/down goes right.
 */
export function motoColumn(heading:number,view:number):0|1|2|3{
  const r=viewTurn(Math.cos(heading),Math.sin(heading),view),sx=r.x-r.y,sy=r.x+r.y;
  const down=sy>=-1e-9,right=sx>=-1e-9;
  return down?(right?0:1):(right?2:3);
}
/** World px per art px of the sheet (meta.escala), or undefined without the piece. */
export function motoArtScale():number|undefined{
  const e=artPiece('base',MOTO_ART)?.meta?.escala;
  return typeof e==='number'&&e>0?e:undefined;
}

const ref:BaseFrameRef={key:'',frame:0};
/**
 * Shows `state` facing `column` on `image` (texture, frame, origin at the ground point, scale) and returns true; false
 * (the image untouched) while the piece, the state or its texture is missing: the caller hides it and draws the boxes.
 */
export function applyMotoArt(image:Phaser.GameObjects.Image,state:MotoArtState,column:number):boolean{
  if(!hasArt('base',MOTO_ART))return false;
  const file=baseFile(MOTO_ART),scale=motoArtScale(),at=file&&baseFrame(MOTO_ART,state,column,0,ref);
  if(!file||!scale||!at||!image.scene.textures.exists(at.key))return false;
  if(image.texture.key!==at.key)image.setTexture(at.key,at.frame);else image.setFrame(at.frame);
  const anchor=file.anchor??[.5,.9];
  image.setOrigin(anchor[0],anchor[1]).setScale(scale);
  return true;
}
/** The image's screen box (its origin at the ground point), for the hero-cover test. */
export function imageBounds(image:Phaser.GameObjects.Image){
  const w=image.displayWidth,h=image.displayHeight,x0=-image.originX*w,y0=-image.originY*h;
  return {x0,y0,x1:x0+w,y1:y0+h};
}
