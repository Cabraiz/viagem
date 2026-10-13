/**
 * Face avatars of the imported art v2 (group `rostos`, board design/PACOTE-ROSTOS.md): one 256×256 transparent face per
 * class and expression, `public/art/rostos/<classe>-<expressão>.webp`, drawn to be cropped to a circle (nothing outside
 * the central 240 px circle: scripts/art-v2/spec.mjs FACE_CIRCLE).
 *
 * Fallbacks: a missing expression shows the class's `normal` face; a class without any usable face gets null/undefined,
 * and the caller keeps its own portrait crop. With an empty manifest nothing is requested and nothing is created.
 *
 * Textures: `queueFaceTextures` loads only the files that exist, under `faceKey(id,expr)`. A missing expression is NOT
 * aliased to the normal texture (a copy per alias would cost GPU memory for nothing): resolve the key to draw with
 * `resolveFaceKey(scene.textures,id,expr)`, which applies the same fallback as `faceUrl`.
 *
 * Pure: Phaser is a type-only import, so this module runs in node tests.
 */
import type Phaser from 'phaser';
import {classes} from '../../rules/index.ts';
import {artPages,artPiece,artUrl,type ArtPiece} from './manifest.ts';

/** Expressions, in the brief's order (spec.mjs FACE_EXPRESSIONS). */
export const FACE_EXPRESSIONS=['normal','ferido','caido','rindo','bravo'] as const;
export type FaceExpression=typeof FACE_EXPRESSIONS[number];
/** The art v2 group of the faces. */
export const FACE_GROUP='rostos';

/** Phaser texture key of a face: `rosto:<id>:<expr>`. */
export const faceKey=(id:string,expr:FaceExpression)=>`rosto:${id}:${expr}`;

/** URL of the face file of exactly this class and expression, or null when the manifest does not have it. */
function exactUrl(id:string,expr:FaceExpression):string|null{
  const piece:ArtPiece|undefined=artPiece(FACE_GROUP,`${id}-${expr}`);
  if(!piece)return null;
  const file=piece.files.sheet??Object.values(piece.files)[0];
  const page=file&&artPages(file)[0];
  return (page&&artUrl(FACE_GROUP,page.file))??null;
}

/** The expression actually shown for (id, expr): itself, else `normal`, else undefined (no face for the class). */
function shownExpression(id:string,expr:FaceExpression,has:(expr:FaceExpression)=>boolean):FaceExpression|undefined{
  if(has(expr))return expr;
  if(expr!=='normal'&&has('normal'))return 'normal';
  return undefined;
}

/**
 * URL of the imported face of class `id` with expression `expr` (default `normal`); falls back to the `normal` face
 * when that expression was not delivered; null when neither exists (the caller uses its own portrait crop).
 */
export function faceUrl(id:string,expr:FaceExpression='normal'):string|null{
  const shown=shownExpression(id,expr,e=>exactUrl(id,e)!==null);
  return shown?exactUrl(id,shown):null;
}

/** Every delivered face of the class catalog, as Phaser loads ({key,url}); empty with an empty manifest. */
export function faceLoads():{key:string;url:string}[]{
  const out:{key:string;url:string}[]=[];
  for(const {id} of classes)for(const expr of FACE_EXPRESSIONS){
    const url=exactUrl(id,expr);
    if(url)out.push({key:faceKey(id,expr),url});
  }
  return out;
}

/**
 * Queues every delivered face on `scene.load` (in preload; elsewhere the caller starts the loader) under `faceKey`,
 * skipping keys already in the texture manager. Returns how many files were queued (0 with an empty manifest).
 */
export function queueFaceTextures(scene:Phaser.Scene):number{
  let queued=0;
  for(const l of faceLoads()){
    if(scene.textures.exists(l.key))continue;
    scene.load.image(l.key,l.url);
    queued++;
  }
  return queued;
}

/**
 * The loaded texture key to draw for (id, expr): `faceKey(id,expr)` when loaded, else the class's `normal` face key
 * when loaded, else null (the caller keeps its portrait crop).
 */
export function resolveFaceKey(textures:{exists(key:string):boolean},id:string,expr:FaceExpression='normal'):string|null{
  const shown=shownExpression(id,expr,e=>textures.exists(faceKey(id,e)));
  return shown?faceKey(id,shown):null;
}
