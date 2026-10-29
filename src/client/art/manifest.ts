/**
 * Imported art v2 (NEW-20261012-ORQ-importar-arte-b-ligacao): which pieces the importer (scripts/import-art-v2.mjs)
 * delivered, so every renderer can use the sprite when it exists and today's procedural art when it does not.
 * One file, `/art/manifest.json` (written by the importer; the repo ships an empty one so a fresh build makes no 404),
 * holds every group's manifest: {version:2, groups:{[group]:{output, pieces:{[id]:ArtPiece}}}}.
 * Pure (no Phaser, no DOM): renderers ask `artPiece(group,id)` / `artUrl(group,file)`; loading is `loadArtManifest`.
 */
import {trocarInimigos} from './teste-inimigo.ts';

export interface ArtPage {file:string;columns:number;rows:number;firstFrame:number;frameCount:number}
export interface ArtFile {
  /** Single-page sheet, relative to the group's output folder. */
  file?:string;
  /** Sheets over 4096 px are split in pages (frames in order, direction-major for 8-direction sheets). */
  pages?:ArtPage[];
  cell:[number,number];
  frames?:number;directions?:number;views?:number;rows?:string[]|number;
  anchor?:[number,number];fps?:Record<string,number>|number;slice?:[number,number,number,number];
  /** Menu dances (menu-dance.ts): false plays once; absent loops. */
  loop?:boolean;
  /** R06 movement sheets: the cycle length of the clip (walk 600 ms, attack 1000 ms). */
  durationMs?:number;revision?:number;movementHands?:string;
  /** M16 movement sheets: the column (96 px cell) the body stands on, the pivot of the mirrored E/NE/SE (movement16Plan). */
  pivotX?:number;
  /** M16 run: per pose the ground it covers (figure heights) and the planted foot's travel (96 px cell); movement128.ts RunPhase. */
  phase?:{d:number[];v:[number,number][]};
  wrap?:'x'|'y'|'xy';transparent?:boolean;mask?:boolean;
  /**
   * Hero atlases (`personagens` dir4): standing height of the first idle cell of front-right and the box of the drawn
   * figure over every cell (alpha > 20, cell px), measured by the importer; unchecked here (sprite-sheets.ts checks).
   */
  height?:number;figure?:{left:number;top:number;right:number;bottom:number};
  /**
   * Enemies (scripts/art-lite.mjs, inimigos-peso-download): the cell of the smaller lite copy the game loads. The
   * parsed index already has it as `cell` (parseArtIndex), and keeps it here: that copy has no approved file of its size to fall back to.
   */
  liteCell?:[number,number];
  /**
   * Enemies on the computer (scripts/art-lite.mjs enemies-pc, NEW-20261023-ORQ-inimigos-v5a-padrao): the cell of the
   * computer's copy, between liteCell and cell. Kept in the parsed index only when the screen draws it (parseArtIndex pc),
   * as the cell; horde-art liteEnemyUrl then asks for that copy.
   */
  pcCell?:[number,number];
  /** The chefão's AI-upscaled copy (hdFile): its pages live under public/art/hd/enemies/ (horde-art enemyFileUrl). */
  hd?:boolean;
}
/**
 * Render hints the importer copies from the P0 table or the sidecar (scripts/art-v2/spec.mjs), e.g.
 * chao {ground:'snow'|'packed'|…} or {mask:true,between:[a,b]}; predios {footprint:[a,b],ruin?,framesPerView?};
 * props {prop:'poste'}; base {states:[…]}; torres {footprint:[a,b],mount?:[x,y]}.
 */
export type ArtMeta=Record<string,unknown>;
export interface ArtPiece {kind:string;files:Record<string,ArtFile>;meta?:ArtMeta}
export interface ArtGroup {output:string;pieces:Record<string,ArtPiece>}
export interface ArtIndex {version:number;groups:Record<string,ArtGroup>}

/** Group keys as the importer names them (scripts/art-v2/spec.mjs GROUPS). */
export type ArtGroupId='inimigos'|'personagens'|'chao'|'predios'|'base'|'props'|'itens'|'projeteis'|'efeitos'|'ui'|'rostos'|'torres'|'menu';

const EMPTY:ArtIndex={version:2,groups:{}};
let index:ArtIndex=EMPTY;

/** Ids and keys come from file names: plain kebab-case (with `/` for nested ids); never `__proto__` and friends. */
const SAFE_KEY=/^[a-z0-9][a-z0-9/_.:-]*$/;
/** R06 (8 drawn directions) and M16 (5 drawn: S, SW, W, NW, N; E/NE/SE are mirrored, movement128.ts movement16Plan; push: empurrar-uno; pull: puxar-uno-corda). */
const MOVEMENT_KEY=/^((walk|attack)128-(S|SW|W|NW|N|NE|E|SE)|(walk|attack|idle|run|push|pull|hurt|build|work|downed)16-(S|SW|W|NW|N|NE|E|SE))$/;
/** A file path inside a group's output folder: no scheme, no `..`, no leading slash. */
const SAFE_FILE=/^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]*\.webp$/;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safeEntries=(v:Record<string,unknown>,movement=false)=>Object.keys(v).filter(k=>(SAFE_KEY.test(k)||(movement&&MOVEMENT_KEY.test(k)))&&k!=='__proto__'&&k!=='constructor'&&k!=='prototype').map(k=>[k,v[k]] as const);
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
  // A lite copy's cell (scripts/art-lite.mjs) is never larger than the file's; a malformed one is dropped.
  if(file.liteCell!==undefined&&!(isCell(file.liteCell)&&file.liteCell[0]<=file.cell[0]&&file.liteCell[1]<=file.cell[1])){const {liteCell:_,pcCell:__,...rest}=file;return rest;}
  // The computer's copy sits between the two (cell ≥ pcCell ≥ liteCell); without a lite copy, or malformed, it is dropped.
  if(file.pcCell!==undefined&&!(file.liteCell&&isCell(file.pcCell)&&file.pcCell[0]<=file.cell[0]&&file.pcCell[1]<=file.cell[1]&&
    file.pcCell[0]>=file.liteCell[0]&&file.pcCell[1]>=file.liteCell[1])){const {pcCell:_,...rest}=file;return rest;}
  return file;
}
/**
 * An enemy file as the client draws it: its lite copy's cell when that copy is smaller, the computer's copy's (pcCell)
 * on a computer that has one (parseFile already dropped a malformed one); the phone never keeps pcCell.
 */
function liteFile(file:ArtFile,pc:boolean):ArtFile{
  if(file.liteCell===undefined)return file;
  const {liteCell,pcCell,...rest}=file;
  return pc&&pcCell?{...rest,cell:[pcCell[0],pcCell[1]],liteCell,pcCell}:{...rest,cell:[liteCell[0],liteCell[1]],liteCell};
}
/**
 * Enemies drawn from their approved files, not the lite copies: the 1st wave's chefão (rules WAVE_BOSS_IDS; the user,
 * 24/10: "pixelagem para ficar hd" at 3×). ~30 MB to download but ~390 MB of GPU memory once decoded on a phone, so
 * none loads at the opening: art/chefao-art.ts loads the run's one before he comes and frees him once he falls. Kept here as plain
 * ids (this module imports nothing); tests/client/chefao-cena.test.ts checks it against the rules.
 */
export const HD_ENEMIES:ReadonlySet<string>=new Set(['o-grande-credor','dj-do-fim-do-mundo','mapinguari-do-shopping','boitata-de-sacolinha']);
/**
 * The chefão's files he spends the fight in, AI-upscaled (scripts/art-hd-chefao.mjs, the user 24/10: "Hd no PC, mas semi
 * hd no celular"): the computer's ×2 cell in pages ≤ 8192 px, the phone's semi-HD cell in pages ≤ 4096 px. The other
 * files keep the approved 384 sheet; the client scales each file by its own cell (horde-art pieceScale).
 */
export const HD_ANIMS:ReadonlySet<string>=new Set(['idle','walk','slam']);
export const HD_SCREENS={pc:{cell:768,maxSide:8192},celular:{cell:512,maxSide:4096}} as const;
/** Pages of the HD copy, as scripts/art-hd-chefao.mjs hdLayout writes them (tests/tools/art-hd-chefao.test.ts keeps both equal). */
export function hdLayout(id:string,anim:string,screen:keyof typeof HD_SCREENS,total:number):ArtPage[]{
  const {cell,maxSide}=HD_SCREENS[screen],fit=Math.floor(maxSide/cell),columns=Math.min(total,fit),perPage=columns*fit;
  const count=Math.ceil(total/perPage),pages:ArtPage[]=[];
  for(let i=0;i<count;i++){
    const firstFrame=i*perPage,frameCount=Math.min(perPage,total-firstFrame);
    pages.push({file:`${id}/${screen}/${anim}${count>1?`-p${i+1}`:''}.webp`,columns,rows:Math.ceil(frameCount/columns),firstFrame,frameCount});
  }
  return pages;
}
/** File `anim` of chefão `id` as the screen draws it: its HD copy for HD_ANIMS, else the approved file. */
function hdFile(id:string,anim:string,file:ArtFile,pc:boolean):ArtFile{
  if(!HD_ENEMIES.has(id)||!HD_ANIMS.has(anim)||!file.frames||!file.directions)return file;
  const screen=pc?'pc':'celular',cell=HD_SCREENS[screen].cell,{file:_,liteCell:__,pcCell:___,...rest}=file;
  return {...rest,cell:[cell,cell],pages:hdLayout(id,anim,screen,file.frames*file.directions),hd:true};
}
function parsePiece(value:unknown,lite=false,pc=false,id=''):ArtPiece|undefined{
  if(!isObject(value)||typeof value.kind!=='string'||!isObject(value.files))return undefined;
  const files:Record<string,ArtFile>=Object.create(null);
  for(const [key,f] of safeEntries(value.files,true)){const file=parseFile(f);if(file)files[key]=lite?liteFile(file,pc):hdFile(id,key,file,pc);}
  if(!Object.keys(files).length)return undefined;
  return {kind:value.kind,files,...(isObject(value.meta)?{meta:value.meta}:{})};
}

/**
 * The enemies are drawn from their lite copies only (horde-art liteEnemyUrl), so their files take `liteCell` as the cell;
 * on a computer (`pc`: the fine pointer of the fixed zoom, camera-zoom.ts startZoom) `pcCell` where the file has one.
 * Validates the index defensively (it is a public file the client trusts for URLs): unknown or malformed groups,
 * pieces and files are dropped one by one, so a bad entry only keeps that piece procedural; never throws.
 */
export function parseArtIndex(value:unknown,pc=false):ArtIndex{
  if(!isObject(value)||value.version!==2||!isObject(value.groups))return EMPTY;
  const groups:Record<string,ArtGroup>=Object.create(null);
  for(const [id,g] of safeEntries(value.groups)){
    if(!isObject(g)||typeof g.output!=='string'||!/^public\/art\/[a-z0-9/_-]+$/.test(g.output)||g.output.includes('..')||!isObject(g.pieces))continue;
    const pieces:Record<string,ArtPiece>=Object.create(null);
    for(const [pid,p] of safeEntries(g.pieces)){const piece=parsePiece(p,id==='inimigos'&&!HD_ENEMIES.has(pid),pc,id==='inimigos'?pid:'');if(piece)pieces[pid]=piece;}
    groups[id]={output:g.output,pieces};
  }
  return {version:2,groups};
}


/** Replaces the current index (tests, or the loader). */
/** Bumped at every index change: parts drawn before the index arrived (HUD faces) redraw when it moves. */
export let artIndexVersion=0;
export function setArtIndex(next:ArtIndex){index=next;artIndexVersion++;}

/** Fetches `/art/manifest.json` once at boot; any failure keeps the procedural art. `pc`: see parseArtIndex. */
export async function loadArtManifest(fetcher:(url:string)=>Promise<{ok:boolean;json():Promise<unknown>}>=url=>fetch(url,{cache:'no-cache'}),pc=false){
  try{const r=await fetcher('/art/manifest.json');setArtIndex(r.ok?parseArtIndex(await r.json(),pc):EMPTY);}
  catch{setArtIndex(EMPTY);}
  return index;
}

export const artPiece=(group:ArtGroupId,id:string):ArtPiece|undefined=>index.groups[group]?.pieces[id];
/** The current index (read-only use: pure planners enumerate a group's pieces from it). */
export const artIndex=():ArtIndex=>index;
/** Public URL of a file inside a group's output folder (`public/art/x` is served at `/art/x`). */
export const groupFileUrl=(group:ArtGroup,file:string)=>`/${group.output.replace(/^public\//,'')}/${file}`;
export const hasArt=(group:ArtGroupId,id:string)=>!!artPiece(group,id);
/** Public URL of a file of a group (`public/art/x` is served at `/art/x`). */
export const artUrl=(group:ArtGroupId,file:string)=>{
  const g=index.groups[group];
  return g?groupFileUrl(g,file):undefined;
};
/** Every page of a file (a single-page sheet as one page), for loaders. */
export function artPages(file:ArtFile):ArtPage[]{
  if(file.pages?.length)return file.pages;
  if(!file.file)return [];
  const frames=(file.frames??1)*(file.directions??1);
  return [{file:file.file,columns:file.frames??1,rows:file.directions??1,firstFrame:0,frameCount:frames}];
}
