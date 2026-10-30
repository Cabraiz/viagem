import {spriteCatalog,type FigureBox} from './sprite-catalog.ts';
import {spriteUrl} from './art-urls.ts';
import {artPiece,artUrl,type ArtFile} from '../art/manifest.ts';
import {movementArtLevel} from './movement128.ts';

/** A class's 4-direction atlas (docs/sprite-directions.md): where it is served and its measured standing height. */
/** `cell`: the atlas's cell px (192 when absent; the phone levels' copy is PHONE_DIR4_CELL), `height` and `figure` stay in 192 px units. */
export interface DirectionalSheet {url:string;height:number;figure?:FigureBox;cell?:number;cardinals?:{url:string;figure?:FigureBox}}
export const PHONE_DIR4_CELL=128;

/**
 * The classes with a 4-direction batch: the imported ones (`dir4` in the generated catalog, the atlas next to the
 * approved single sheet as `<id>.dir4.webp`) plus, on the dev server only, the lab test batch.
 */
export const directionalSheets=new Map<string,DirectionalSheet>(
  Object.entries(spriteCatalog).flatMap(([id,c])=>c.dir4?[[id,{url:spriteUrl(id,true),height:c.dir4.height,figure:c.dir4.figure}] as const]:[]),
);
/**
 * Lab flag `?lab=sprites4` (dev server only; Vite folds import.meta.env.DEV to false in builds and drops this block):
 * the TEST batch derived from the approved cidadao-comum sheet, back drawings marked "COSTAS", served straight from
 * the test fixture. It never enters the production catalog nor the build.
 */
export const LAB_SHEETS:Record<string,DirectionalSheet>={'cidadao-comum':{url:'/tests/fixtures/sprites-4dir/cidadao-comum.dir4.webp',height:128,figure:{left:25,top:41,right:167,bottom:170}}};
const LAB=typeof location!=='undefined'&&import.meta.env.DEV&&new URLSearchParams(location.search).get('lab')==='sprites4';
if(LAB)for(const [id,sheet] of Object.entries(LAB_SHEETS))directionalSheets.set(id,sheet);

const CELL=192;
const isFigure=(v:unknown):v is FigureBox=>{
  if(!v||typeof v!=='object')return false;
  const b=v as Record<string,unknown>,n=[b.left,b.top,b.right,b.bottom];
  return n.every(x=>Number.isInteger(x)&&(x as number)>=0&&(x as number)<=CELL)&&(b.left as number)<(b.right as number)&&(b.top as number)<(b.bottom as number);
};
/**
 * The art v2 hero atlas (group `personagens`, file `dir4`: the 4 diagonals of the 8-direction delivery, same layout as
 * today's `<id>.dir4.webp`), when the index lists it with the standing height the importer measured
 * (scripts/art-v2/convert.mjs: first idle cell of front-right, alpha > 20) — so the hero keeps its 96 world px figure
 * (D-030). An entry without a usable height, another grid or a paged sheet is ignored (today's art stays).
 * A matching `dir4c` enables all eight directions. Downed remains a separate unused animation.
 */
export function importedSheet(id:string):DirectionalSheet|undefined{
  const file=artPiece('personagens',id)?.files.dir4;
  if(!file||!validPage(file))return undefined;
  const height=file.height;
  if(typeof height!=='number'||!Number.isFinite(height)||height<8||height>CELL)return undefined;
  // The game downloads the lossy copy (scripts/art-lite.mjs, ~460 KB instead of ~960 KB), as for today's sheets.
  // Normal and Leve (card q3-niveis-qualidade): the 128 px cell copy, dir4 and dir4c alike.
  const phone=movementArtLevel()!=='alta',lite=phone?'/art/lite/sprites-celular/':'/art/lite/sprites/';
  const url=artUrl('personagens',file.file)?.replace('/art/sprites/',lite);
  if(!url)return undefined;
  const card=artPiece('personagens',id)?.files.dir4c;
  const cardinalUrl=card&&validPage(card)?artUrl('personagens',card.file!):undefined;
  return {url,height,...(phone?{cell:PHONE_DIR4_CELL}:{}),...(isFigure(file.figure)?{figure:file.figure}:{}),
    ...(cardinalUrl?{cardinals:{url:cardinalUrl.replace('/art/sprites/',lite),
      ...(isFigure(card?.figure)?{figure:card.figure}:{})}}:{})};
}
function validPage(file:ArtFile):file is ArtFile&{file:string}{
  return !!file.file&&file.cell[0]===CELL&&file.cell[1]===CELL&&
    (file.pages?file.pages.length===1&&file.pages[0].columns===6&&file.pages[0].rows===12&&file.pages[0].firstFrame===0&&file.pages[0].frameCount===72:
      file.frames===6&&file.directions===4);
}
/** The 4-direction atlas a class draws with: the lab batch (dev flag), else the imported v2 one, else the catalog's. */
export const directionalSheet=(id:string):DirectionalSheet|undefined=>(LAB?LAB_SHEETS[id]:undefined)??importedSheet(id)??directionalSheets.get(id);

/** Texture key of a class's sheet: the 4-direction atlas when the class has one, the approved single sheet otherwise. */
export const sheetKey=(id:string)=>directionalSheet(id)?`sprite:${id}:dir4`:`sprite:${id}`;
