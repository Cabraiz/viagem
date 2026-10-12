import {spriteCatalog,type FigureBox} from './sprite-catalog.ts';

/** A class's 4-direction atlas (docs/sprite-directions.md): where it is served and its measured standing height. */
export interface DirectionalSheet {url:string;height:number;figure?:FigureBox}

/**
 * The classes with a 4-direction batch: the imported ones (`dir4` in the generated catalog, the atlas next to the
 * approved single sheet as `<id>.dir4.webp`) plus, on the dev server only, the lab test batch.
 */
export const directionalSheets=new Map<string,DirectionalSheet>(
  Object.entries(spriteCatalog).flatMap(([id,c])=>c.dir4?[[id,{url:`/art/sprites/${id}.dir4.webp`,height:c.dir4.height,figure:c.dir4.figure}] as const]:[]),
);
/**
 * Lab flag `?lab=sprites4` (dev server only; Vite folds import.meta.env.DEV to false in builds and drops this block):
 * the TEST batch derived from the approved cidadao-comum sheet, back drawings marked "COSTAS", served straight from
 * the test fixture. It never enters the production catalog nor the build.
 */
export const LAB_SHEETS:Record<string,DirectionalSheet>={'cidadao-comum':{url:'/tests/fixtures/sprites-4dir/cidadao-comum.dir4.webp',height:128,figure:{left:25,top:41,right:167,bottom:170}}};
if(typeof location!=='undefined'&&import.meta.env.DEV&&new URLSearchParams(location.search).get('lab')==='sprites4')
  for(const [id,sheet] of Object.entries(LAB_SHEETS))directionalSheets.set(id,sheet);

/** Texture key of a class's sheet: the 4-direction atlas when the class has one, the approved single sheet otherwise. */
export const sheetKey=(id:string)=>directionalSheets.has(id)?`sprite:${id}:dir4`:`sprite:${id}`;
