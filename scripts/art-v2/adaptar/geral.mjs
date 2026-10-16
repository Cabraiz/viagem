/**
 * Delivery adapter for the "flat" groups (NEW-20261012-ORQ-adaptar-entrega-codex): ground (cenario/chao/<map>/),
 * efeitos/, itens/, projeteis/ and ui/. Contract: scripts/art-v2/adaptar-entrega.mjs.
 *
 * The delivery already ships one PNG per piece in the right layout; what breaks the importer is the sidecar and the
 * names. For every `<name>.png` (+ `<name>.meta.json`) this adapter:
 *  - copies the PNG bytes unchanged (deterministic, no re-encoding) under the spec's id (RENAMES below; the map folder
 *    `cidade` is the game's map id `cidade-nevada`);
 *  - writes `<id>.json` with only the importer's sidecar keys, derived from the meta: `cell` (from `cell`, or from
 *    rawColumns/rawRows), `nineSlice` → `slice`, terrain → `seamless` (+ `wrap`), transition masks → `mask`, telegraph
 *    patterns → `seamless` + `transparent` (+ `wrap:"x"` for a horizontal strip), `fps`, `anchor`. `frames` is left out
 *    on 1-row strips (the importer derives it from the width, which keeps the inventory's frame-range check alive);
 *  - measures every ground texture against D-038 (fine detail must be visible; the old "amplitude ≤ 0.08" rule only
 *    applies after a strong blur). A flat tile is NOT altered: it is adapted and gets an "ask back" note.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {GROUPS as SPEC} from '../spec.mjs';

export const GROUPS={chao:'cenario/chao',efeitos:'efeitos',itens:'itens',projeteis:'projeteis',ui:'ui'};
/** Delivery map folder → game map id (src/client/hud/city/map-selector.ts). */
export const MAPS=Object.freeze({cidade:'cidade-nevada',infinito:'infinito'});
/** Delivery stem → spec id, per group (ground: per map, material only; the `-<n>` variation is kept). */
export const RENAMES=Object.freeze({
  'chao/cidade-nevada':{agua:'agua-rasa',asfalto:'asfalto-rachado',lama:'lama-gelo',neve:'neve-fofa',sarjeta:'vala-sarjeta'},
  'chao/infinito':{agua:'agua-rasa',espuma:'espuma-borda',rocha:'rocha-nua',terra:'terra-batida'},
  efeitos:{
    'anel-destino':'marcador-destino','anel-voce':'heroi-voce','carimbo-onda':'carimbo-chefe',explosao:'morte-explosao',
    'fogo-no-chao':'fogo-chao','olhos-apagao':'olhos-escuro','perigo-borda':'telegraph-borda','perigo-hachura':'telegraph-enchimento',
    resgate:'caido-resgate','respingo-verde':'morte-gosma-1','respingo-roxo':'morte-gosma-2','respingo-vermelho':'morte-gosma-3',
    'vida-normal-moldura':'barra-vida-moldura','vida-normal-preenchimento':'barra-vida-preenchimento',
    'vida-elite-moldura':'barra-vida-moldura-elite','vida-elite-preenchimento':'barra-vida-preenchimento-elite',
  },
  itens:{'gema-xp-pequena':'gema-pequena','gema-xp-media':'gema-media','gema-xp-grande':'gema-grande',coco:'recurso-coco',pedra:'recurso-pedra'},
  projeteis:{'boleto-agiota':'boleto-juros',molotov:'garrafa-molotov','poca-pombo':'coco-pombo-poca'},
  // Minimap marks (inventário §9: você, aliado, caído, spawn, barricada); coco/pedra stay the Stonewards icons.
  ui:{voce:'marca-voce',aliado:'marca-aliado',caido:'marca-caido',spawn:'marca-spawn',barricada:'marca-barricada'},
});
/**
 * D-038 (board DECISOES.md): ground is rich in small detail; 0.08 is the limit of LARGE-scale variation only (after a
 * blur of radius ≈ 1/8 of the tile). Fine detail = p2..p98 spread of relative luminance at full resolution; below
 * FLAT_DETAIL the material reads as a flat colour (the delivery clamped the whole tile, pixel by pixel, to ≤ 0.08).
 */
export const FLAT_DETAIL=.1,LARGE_SCALE_MAX=.08;

const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const isPair=v=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isInteger(n)&&n>0);
const round=(v,d=3)=>Math.round(v*10**d)/10**d;
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{return undefined;}};
const pngs=dir=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&/\.png$/i.test(e.name)).map(e=>e.name.slice(0,-4)).sort():[];
const dirs=dir=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort():[];

/** Spec id of a delivery stem: whole-stem rename first, then `<material>-<n>` with the material renamed. */
export function renameStem(table,stem){
  if(table?.[stem])return table[stem];
  const m=/^(.*)-(\d+)$/.exec(stem);
  if(m&&table?.[m[1]])return `${table[m[1]]}-${m[2]}`;
  return stem;
}

/** Cell of one frame: the meta's `cell`, else the image split by rawColumns × rawRows, else undefined. */
function cellOf(meta,w,h){
  if(isPair(meta?.cell))return meta.cell;
  const c=meta?.rawColumns,r=meta?.rawRows;
  if(Number.isInteger(c)&&Number.isInteger(r)&&c>0&&r>0&&w%c===0&&h%r===0)return [w/c,h/r];
}
const hasTranslucency=data=>{for(let i=3;i<data.length;i+=4)if(data[i]!==255)return true;return false;};

/**
 * Importer sidecar for one piece (only SIDECAR_KEYS of scripts/art-v2/validate.mjs). `group`: importer group;
 * `stem`: the spec id's file stem; `img`: {width,height,alpha:boolean (some pixel not opaque)}.
 * Returns {sidecar, notes}.
 */
export function sidecarFor(group,stem,meta,img){
  const notes=[],sc={};
  const {width:w,height:h}=img;
  const cell=cellOf(meta,w,h)??[w,h];
  if(group==='ui'){
    sc.kind='icon';
    if(w===h&&w!==128)sc.size=w;
    return {sidecar:sc,notes};
  }
  const nine=meta?.nineSlice??meta?.slice;
  if(Array.isArray(nine)&&nine.length===4){
    Object.assign(sc,{kind:'nineslice',cell,slice:nine.map(Number)});
    return {sidecar:sc,notes};
  }
  if(group==='chao'&&/^trans-/.test(stem)){Object.assign(sc,{kind:'seamless',mask:true,cell});return {sidecar:sc,notes};}
  const frames=Math.round(w/cell[0])*Math.round(h/cell[1]);
  const pattern=meta?.type==='pattern'||(group==='chao'&&frames===1&&w===h);
  if(pattern){
    sc.kind='seamless';sc.cell=cell;
    sc.wrap=cell[1]*4<=cell[0]?'x':cell[0]*4<=cell[1]?'y':'xy';
    if(img.alpha)sc.transparent=true;
    return {sidecar:sc,notes};
  }
  // A 9-slice or seamless piece of the spec's table (health bars, speech balloon, telegraph textures) whose meta says
  // nothing about it (no nineSlice, not a pattern): leave `kind` out, so the table's kind, cell, wrap and transparency
  // apply (validate.mjs withExpected).
  // Writing 'frames' here refused them under the frames' 2 px padding rule, which a 9-slice or a tile must not follow.
  const tableKind=SPEC[group]?.expected?.[stem]?.kind;
  if(tableKind==='nineslice'||tableKind==='seamless')return {sidecar:{cell},notes:[`${tableKind} da tabela do spec`]};
  sc.kind='frames';sc.cell=cell;
  if(h!==cell[1]){
    // A multi-row grid is not a 'frames' strip: say it, the importer will refuse it with the size message.
    notes.push(`grid ${w/cell[0]}×${h/cell[1]} of ${cell[0]}×${cell[1]}: not a 1-row strip`);
    if(Number.isInteger(meta?.frames))sc.frames=meta.frames;
  }
  if(typeof meta?.fps==='number'&&meta.fps>0)sc.fps=meta.fps;
  if(Array.isArray(meta?.anchor)&&meta.anchor.length===2&&meta.anchor.every(n=>typeof n==='number'&&n>=0&&n<=1))sc.anchor=meta.anchor;
  return {sidecar:sc,notes};
}

/** D-038 measures of an opaque ground texture: fine detail (p2..p98 of relative luminance) and large-scale range. */
export async function groundAmplitude(file){
  const lin=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  const lum=async img=>{
    const {data,info}=await img.removeAlpha().raw().toBuffer({resolveWithObject:true});
    const n=info.width*info.height,Y=new Float64Array(n);
    for(let i=0;i<n;i++)Y[i]=.2126*lin(data[i*3])+.7152*lin(data[i*3+1])+.0722*lin(data[i*3+2]);
    return {Y,info};
  };
  const {Y,info}=await lum(sharp(file));
  const sorted=Float64Array.from(Y).sort(),at=p=>sorted[Math.floor(p*(sorted.length-1))];
  const mean=Y.reduce((a,b)=>a+b,0)/Y.length;
  // Large scale: blur with radius ≈ 1/8 of the tile (Gaussian sigma = radius / 2).
  const sigma=Math.max(.3,Math.min(info.width,info.height)/16);
  const {Y:B}=await lum(sharp(file).blur(sigma));
  let lo=Infinity,hi=-Infinity;for(const v of B){if(v<lo)lo=v;if(v>hi)hi=v;}
  return {detail:round(at(.98)-at(.02)),largeScale:round(hi-lo),mean:round(mean)};
}

const writeJson=(file,data)=>fs.writeFileSync(file,JSON.stringify(data)+'\n');

/** One delivery folder → one output folder. `table`: RENAMES entry; `prefix`: spec id prefix (ground map). */
async function adaptFolder({group,srcDir,outDir,table,prefix='',origin}){
  const records=[];
  for(const stem of pngs(srcDir)){
    const from=`${origin}/${stem}`,target=renameStem(table,stem),id=prefix+target;
    const notes=[];
    if(target!==stem)notes.push(`renamed from ${from}`);
    const png=path.join(srcDir,`${stem}.png`),metaFile=path.join(srcDir,`${stem}.meta.json`);
    const meta=fs.existsSync(metaFile)?readJson(metaFile):undefined;
    if(fs.existsSync(metaFile)&&!isObject(meta))notes.push(`${stem}.meta.json unreadable: ignored`);
    let info;
    try{const {data,info:i}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});info={width:i.width,height:i.height,alpha:hasTranslucency(data)};}
    catch{records.push({group,id,action:'refused',refused:`${from}.png is not a readable PNG`});continue;}
    const {sidecar,notes:more}=sidecarFor(group,target,meta,info);
    notes.push(...more);
    if(group==='chao'&&sidecar.kind==='seamless'&&!sidecar.mask){
      const a=await groundAmplitude(png);
      const flat=a.detail<FLAT_DETAIL;
      notes.push(`${flat?'ask back: ':''}D-038 fine detail ${a.detail} (p2..p98 luminance; flat below ${FLAT_DETAIL}), large-scale ${a.largeScale} (limit ${LARGE_SCALE_MAX}), mean ${a.mean}`);
    }
    fs.mkdirSync(outDir,{recursive:true});
    fs.copyFileSync(png,path.join(outDir,`${target}.png`));
    writeJson(path.join(outDir,`${target}.json`),sidecar);
    records.push({group,id,action:target!==stem?'renamed+sidecar':'sidecar',notes});
  }
  return records;
}

export async function adapt({src,out,log=()=>{}}){
  const records=[];
  for(const rel of Object.values(GROUPS))fs.rmSync(path.join(out,rel),{recursive:true,force:true});
  for(const map of dirs(path.join(src,GROUPS.chao))){
    const mapId=MAPS[map]??map;
    records.push(...await adaptFolder({group:'chao',srcDir:path.join(src,GROUPS.chao,map),outDir:path.join(out,GROUPS.chao,mapId),
      table:RENAMES[`chao/${mapId}`],prefix:`${mapId}/`,origin:`${GROUPS.chao}/${map}`}));
  }
  for(const group of ['efeitos','itens','projeteis','ui'])
    records.push(...await adaptFolder({group,srcDir:path.join(src,GROUPS[group]),outDir:path.join(out,GROUPS[group]),table:RENAMES[group],origin:GROUPS[group]}));
  const flat=records.filter(r=>r.notes?.some(n=>n.startsWith('ask back')));
  log(`geral: ${records.length} peças (${records.filter(r=>r.refused).length} recusadas; ${flat.length} chãos lisos pela D-038).`);
  return records;
}
