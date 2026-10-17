/**
 * The banks' imported art (card NEW-20261016-ORQ-bancos-arte-render), pure so it is tested. E8's importer (group
 * `cenario`, kind decor, scripts/art-v2/adaptar/decor.mjs) writes one piece per bank, `juros`, `pao-duro`, `posto`:
 * - files.sheet: the machine, one cell per view (4 rows: views 0/90/180/270), anchor [.5,.85], already at the world's
 *   scale (drawn at 1/ART_SCALE like the city's sheets);
 * - files['anim-tela-apagada|azul|verde|vermelha'] (1 frame) and files['anim-sacando'] (the note leaving the slot,
 *   frames at meta.fps.sacando, looping): layers of 4 view rows × frames, at the machine's px;
 * - meta.tela {view:[x,y]}: the top-left corner of the layers in the machine's cell.
 * A bank with any of these missing → undefined: the renderer keeps the provisional figure (figures.ts). Looked up in
 * every group (first one wins), so the renderer does not depend on the group's name.
 */
import type {ArtFile,ArtIndex,ArtMeta} from '../../art/manifest.ts';
import {groupFileUrl} from '../../art/manifest.ts';
import type {BankName} from '../../../contract/index.ts';
import type {ScreenLook} from './rules.ts';

export const BANK_NAMES:readonly BankName[]=['juros','pao-duro','posto'];
/** The screen look (rules.screenOf) → the art's layer. */
const TELA:Readonly<Record<ScreenLook,string>>={azul:'anim-tela-azul',verde:'anim-tela-verde',vermelho:'anim-tela-vermelha',apagado:'anim-tela-apagada'};
const LOOKS=Object.keys(TELA) as ScreenLook[];
export const SACANDO='anim-sacando';
/** The files a bank's art needs. */
export const BANK_FILES:readonly string[]=['sheet',...LOOKS.map(l=>TELA[l]),SACANDO];
export const bankTextureKey=(name:string,file:string)=>`art:bancos:${name}:${file}`;

export interface BankSheet {key:string;url:string;cell:[number,number];frames:number;views:number}
export interface BankArt {
  body:BankSheet;
  tela:Readonly<Record<ScreenLook,BankSheet>>;
  sacando:BankSheet&{fps:number};
  /** The foot (fraction of the machine's cell). */
  anchor:[number,number];
  /** Per view (0..3): the layers' top-left corner in the machine's cell px. */
  telaAt:readonly [number,number][];
}

const VIEWS=4;
const isPair=(v:unknown):v is [number,number]=>Array.isArray(v)&&v.length===2&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
const validFile=(f:ArtFile|undefined):f is ArtFile&{file:string}=>!!f&&typeof f.file==='string'&&isPair(f.cell)&&f.cell[0]>0&&f.cell[1]>0;
const sheetOf=(name:string,fileName:string,url:string,f:ArtFile):BankSheet=>
  ({key:bankTextureKey(name,fileName),url,cell:[f.cell[0],f.cell[1]],frames:Math.max(1,f.frames??1),views:Math.max(1,f.views??VIEWS)});

/** meta.tela as 4 corners by view index (0..3); a missing view takes view 0's. */
function telaCorners(meta:ArtMeta|undefined):[number,number][]|undefined{
  const t=meta?.tela;if(!t||typeof t!=='object')return undefined;
  const by=t as Record<string,unknown>,first=by['0'];
  if(!isPair(first))return undefined;
  return [0,90,180,270].map(deg=>{const v=by[String(deg)];return isPair(v)?[v[0],v[1]]:[first[0],first[1]];});
}
/** The cash animation's fps: the file's, else meta.fps.sacando (or a number), else 10. */
function fpsOf(file:ArtFile,meta:ArtMeta|undefined):number{
  const fps=meta?.fps;
  const n=typeof file.fps==='number'?file.fps:typeof fps==='number'?fps:fps&&typeof fps==='object'?(fps as Record<string,unknown>).sacando:undefined;
  return typeof n==='number'&&n>0?n:10;
}

/** A bank's art when its piece has the machine, the 4 screens, the cash animation and meta.tela; else undefined. */
export function bankArt(index:ArtIndex,name:BankName):BankArt|undefined{
  for(const group of Object.values(index.groups)){
    const piece=group.pieces[name];if(!piece)continue;
    const telaAt=telaCorners(piece.meta);if(!telaAt)return undefined;
    const sheets:Record<string,BankSheet>={};
    for(const f of BANK_FILES){
      const file=piece.files[f];if(!validFile(file))return undefined;
      sheets[f]=sheetOf(name,f,groupFileUrl(group,file.file),file);
    }
    const body=piece.files.sheet,anchor=isPair(body.anchor)?body.anchor:[.5,.85];
    return {
      body:sheets.sheet,
      tela:Object.fromEntries(LOOKS.map(l=>[l,sheets[TELA[l]]])) as Record<ScreenLook,BankSheet>,
      sacando:{...sheets[SACANDO],fps:fpsOf(piece.files[SACANDO],piece.meta)},
      anchor:[anchor[0],anchor[1]],telaAt,
    };
  }
  return undefined;
}
/** Every sheet the banks with complete art need (no repeats). */
export function bankSheets(index:ArtIndex):BankSheet[]{
  const out:BankSheet[]=[];
  for(const name of BANK_NAMES){
    const art=bankArt(index,name);if(!art)continue;
    out.push(art.body,...LOOKS.map(l=>art.tela[l]),art.sacando);
  }
  return out;
}

/** The frame of a sheet in camera view `view` (0..3; a 1-view sheet is the same in all), animation frame f: view×frames+f. */
export function sheetFrame(sheet:Pick<BankSheet,'frames'|'views'>,view:number,f=0):number{
  const v=sheet.views>1?((view%sheet.views)+sheet.views)%sheet.views:0;
  return v*sheet.frames+Math.max(0,Math.min(sheet.frames-1,f));
}
/** The withdrawal's frame at `now` (ms, looping); with reduced motion a still with the note in the slot. */
export function sacandoFrame(sheet:Pick<BankSheet&{fps:number},'frames'|'fps'>,now:number,reduced:boolean):number{
  if(reduced)return Math.min(2,sheet.frames-1);
  return Math.floor(now/1000*sheet.fps)%sheet.frames;
}
/** Where the layers' top-left corner is relative to the machine's foot (anchor × cell), in the machine's px. */
export function telaOffset(art:Pick<BankArt,'body'|'anchor'|'telaAt'>,view:number):{x:number;y:number}{
  const v=((view%4)+4)%4,[cx,cy]=art.telaAt[v]??art.telaAt[0];
  return {x:cx-art.anchor[0]*art.body.cell[0],y:cy-art.anchor[1]*art.body.cell[1]};
}
