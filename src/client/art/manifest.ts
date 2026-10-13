/**
 * Imported art v2 (NEW-20261012-ORQ-importar-arte-b-ligacao): which pieces the importer (scripts/import-art-v2.mjs)
 * delivered, so every renderer can use the sprite when it exists and today's procedural art when it does not.
 * One file, `/art/manifest.json` (written by the importer; the repo ships an empty one so a fresh build makes no 404),
 * holds every group's manifest: {version:2, groups:{[group]:{output, pieces:{[id]:ArtPiece}}}}.
 * Pure (no Phaser, no DOM): renderers ask `artPiece(group,id)` / `artUrl(group,file)`; loading is `loadArtManifest`.
 */
export interface ArtPage {file:string;columns:number;rows:number;firstFrame:number;frameCount:number}
export interface ArtFile {
  /** Single-page sheet, relative to the group's output folder. */
  file?:string;
  /** Sheets over 4096 px are split in pages (frames in order, direction-major for 8-direction sheets). */
  pages?:ArtPage[];
  cell:[number,number];
  frames?:number;directions?:number;views?:number;rows?:string[]|number;
  anchor?:[number,number];fps?:Record<string,number>|number;slice?:[number,number,number,number];
  wrap?:'x'|'y'|'xy';transparent?:boolean;mask?:boolean;
  /**
   * Hero atlases (`personagens` dir4): standing height of the first idle cell of front-right and the box of the drawn
   * figure over every cell (alpha > 20, cell px), measured by the importer; unchecked here (sprite-sheets.ts checks).
   */
  height?:number;figure?:{left:number;top:number;right:number;bottom:number};
}
/**
 * Render hints the importer copies from the P0 table or the sidecar (scripts/art-v2/spec.mjs), e.g.
 * chao {ground:'snow'|'packed'|…} or {mask:true,between:[a,b]}; predios {footprint:[a,b],ruin?,framesPerView?};
 * props {prop:'poste'}; base {states:[…]}.
 */
export type ArtMeta=Record<string,unknown>;
export interface ArtPiece {kind:string;files:Record<string,ArtFile>;meta?:ArtMeta}
export interface ArtGroup {output:string;pieces:Record<string,ArtPiece>}
export interface ArtIndex {version:number;groups:Record<string,ArtGroup>}

/** Group keys as the importer names them (scripts/art-v2/spec.mjs GROUPS). */
export type ArtGroupId='inimigos'|'personagens'|'chao'|'predios'|'base'|'props'|'itens'|'projeteis'|'efeitos'|'ui'|'rostos';

const EMPTY:ArtIndex={version:2,groups:{}};
let index:ArtIndex=EMPTY;

/** Ids and keys come from file names: plain kebab-case (with `/` for nested ids); never `__proto__` and friends. */
const SAFE_KEY=/^[a-z0-9][a-z0-9/_.:-]*$/;
/** A file path inside a group's output folder: no scheme, no `..`, no leading slash. */
const SAFE_FILE=/^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]*\.webp$/;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safeEntries=(v:Record<string,unknown>)=>Object.keys(v).filter(k=>SAFE_KEY.test(k)&&k!=='__proto__'&&k!=='constructor'&&k!=='prototype').map(k=>[k,v[k]] as const);
const isCell=(v:unknown)=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isInteger(n)&&n>0&&n<=4096);

function parseFile(value:unknown):ArtFile|undefined{
  if(!isObject(value)||!isCell(value.cell))return undefined;
  const file=value as unknown as ArtFile;
  if(file.file!==undefined&&(typeof file.file!=='string'||!SAFE_FILE.test(file.file)))return undefined;
  if(file.pages!==undefined){
    if(!Array.isArray(file.pages)||!file.pages.length)return undefined;
    for(const p of file.pages)if(!isObject(p)||typeof p.file!=='string'||!SAFE_FILE.test(p.file)||
      ![p.columns,p.rows,p.firstFrame,p.frameCount].every(n=>Number.isInteger(n)&&(n as number)>=0))return undefined;
  }
  if(file.file===undefined&&file.pages===undefined)return undefined;
  return file;
}
function parsePiece(value:unknown):ArtPiece|undefined{
  if(!isObject(value)||typeof value.kind!=='string'||!isObject(value.files))return undefined;
  const files:Record<string,ArtFile>=Object.create(null);
  for(const [key,f] of safeEntries(value.files)){const file=parseFile(f);if(file)files[key]=file;}
  if(!Object.keys(files).length)return undefined;
  return {kind:value.kind,files,...(isObject(value.meta)?{meta:value.meta}:{})};
}

/**
 * Validates the index defensively (it is a public file the client trusts for URLs): unknown or malformed groups,
 * pieces and files are dropped one by one, so a bad entry only keeps that piece procedural; never throws.
 */
export function parseArtIndex(value:unknown):ArtIndex{
  if(!isObject(value)||value.version!==2||!isObject(value.groups))return EMPTY;
  const groups:Record<string,ArtGroup>=Object.create(null);
  for(const [id,g] of safeEntries(value.groups)){
    if(!isObject(g)||typeof g.output!=='string'||!/^public\/art\/[a-z0-9/_-]+$/.test(g.output)||g.output.includes('..')||!isObject(g.pieces))continue;
    const pieces:Record<string,ArtPiece>=Object.create(null);
    for(const [pid,p] of safeEntries(g.pieces)){const piece=parsePiece(p);if(piece)pieces[pid]=piece;}
    groups[id]={output:g.output,pieces};
  }
  return {version:2,groups};
}

/** Replaces the current index (tests, or the loader). */
export function setArtIndex(next:ArtIndex){index=next;}

/** Fetches `/art/manifest.json` once at boot; any failure keeps the procedural art. */
export async function loadArtManifest(fetcher:(url:string)=>Promise<{ok:boolean;json():Promise<unknown>}>=url=>fetch(url,{cache:'no-cache'})){
  try{const r=await fetcher('/art/manifest.json');setArtIndex(r.ok?parseArtIndex(await r.json()):EMPTY);}
  catch{setArtIndex(EMPTY);}
  return index;
}

export const artPiece=(group:ArtGroupId,id:string):ArtPiece|undefined=>index.groups[group]?.pieces[id];
export const hasArt=(group:ArtGroupId,id:string)=>!!artPiece(group,id);
/** Public URL of a file of a group (`public/art/x` is served at `/art/x`). */
export const artUrl=(group:ArtGroupId,file:string)=>{
  const out=index.groups[group]?.output;
  return out?`/${out.replace(/^public\//,'')}/${file}`:undefined;
};
/** Every page of a file (a single-page sheet as one page), for loaders. */
export function artPages(file:ArtFile):ArtPage[]{
  if(file.pages?.length)return file.pages;
  if(!file.file)return [];
  const frames=(file.frames??1)*(file.directions??1);
  return [{file:file.file,columns:file.frames??1,rows:file.directions??1,firstFrame:0,frameCount:frames}];
}
