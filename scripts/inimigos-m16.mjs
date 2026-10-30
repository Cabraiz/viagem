// Card NEW-20261029-ORQ-mendigo-andar-poses: the enemies drawn in M16 sheets (16 poses, one 4×4 page per direction) that
// live outside the sprite manifest, as manifest pieces for the supervision tools (scripts/proporcao.mjs and
// scripts/troca-de-perna.mjs). The mendigo (src/client/art/mendigo.ts MENDIGO_FILES, tests/tools/inimigos-m16.test.ts
// keeps the two in step): idle and walk in 192 px cells, pivot at the cell's centre, under public/art/enemies.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ENEMIES=path.join(ROOT,'public/art/enemies');
const DIRS=['S','SW','W','NW','N','NE','E','SE'],CELL=192;
const clip=(file,loop)=>({file,frames:16,cell:[CELL,CELL],pivotX:CELL/2,height:CELL,loop,pages:[{file,columns:4}]});
/** The mendigo as a manifest piece: idle16-<d> and walk16-<d>, `dir` the folder its files are read from. */
export const mendigoPiece=()=>({dir:ENEMIES,files:Object.fromEntries(DIRS.flatMap(d=>[
  [`idle16-${d}`,clip(`mendigo/idle-${d}.webp`,true)],[`walk16-${d}`,clip(`mendigo/walk-${d}.webp`,true)]]))});
/** `manifest` with the enemy pieces added (a copy). */
export const withEnemies=manifest=>({...manifest,pieces:{...manifest.pieces,mendigo:mendigoPiece()}});
