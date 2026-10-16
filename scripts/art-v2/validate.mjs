/**
 * Art v2 piece validation (NEW-20261012-ORQ-importador-arte-a). Pure checks over the PNGs of one piece, per format
 * (`kind`) of scripts/art-v2/spec.mjs. Every message is a pt-BR sentence for whoever draws the art: it names the file,
 * the direction/view/row/column when it applies, and says what to fix (docs/sprite-directions.md). ALL problems are
 * collected; `notes` carry what does not block (absent optional parts, assumed cell, paginated sheet). Nothing here
 * writes files. No raw library/parser message reaches the user: everything is pt-BR.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  GROUPS,DIRECTIONS,DIRECTION_NAMES,VIEW_NAMES,DIR4_FROM_DIR8,CARDINALS,LEFT,ANCHOR,ALPHA_THRESHOLD,PADDING,
  FOOT_Y_TOLERANCE,FOOT_X_TOLERANCE,AIRBORNE_ANIMS,LUNGE_ANIMS,SEAM_FACTOR,SEAM_SEGMENTS,SEAM_PERCENTILE,MAX_TEXTURE,
  KIND_NAMES,TOWER_ROWS,TOWER_WALL_ROWS,TOWER_ANIMS,TOWER_IDLE_FRAMES,REST_ANIMS,ELITE_VARIANTS,
} from './spec.mjs';
import {
  cellStats,raw,approvedPivotX,CELL,COLUMNS,ROWS,ROW_NAMES,PIVOT_Y,ROW_BASELINE_TOLERANCE,CELL_BASELINE_TOLERANCE,
  PIVOT_X_TOLERANCE,FACING_BASELINE_TOLERANCE,FACING_FOOT_TOLERANCE,FACING_HEIGHT_TOLERANCE,
} from '../sprite-atlas.mjs';

export const DIR8={width:CELL*COLUMNS,height:CELL*ROWS*DIRECTIONS.length};
export const DOWNED={width:CELL*COLUMNS,height:CELL*DIRECTIONS.length};
/** Keys a sidecar `<id>.json` may set. */
export const SIDECAR_KEYS=Object.freeze(['kind','cell','frames','views','rows','anchor','slice','fps','mask','size','wrap','transparent','opaque','meta']);
/** Keys an `expected` table entry (spec.mjs) lends to a piece delivered without them in a sidecar. */
const TABLE_KEYS=SIDECAR_KEYS.filter(k=>k!=='meta');
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/**
 * The piece's settings: the `expected` table entry of spec.mjs under the sidecar (sidecar wins key by key; `meta` is
 * merged, sidecar over table). The table's sizes only apply while the sidecar keeps the table's kind. A table
 * `frames:[min,max]` becomes `framesRange` (the frame count is derived from the image and must fall in it).
 */
function withExpected(spec,id,sc,label,problems){
  const exp=spec.expected?.[id];
  if(sc.invalid)return sc;
  if(sc.meta!==undefined&&!isObject(sc.meta)){problems.push(`${label}: meta ${json(sc.meta)} inválido; use um objeto, como {"ruin":true}.`);return {...sc,invalid:true};}
  if(!exp)return sc;
  const out={};
  // A sidecar without "kind" keeps the table's kind (e.g. a 9-slice frame whose sidecar only gives "slice").
  const kind=sc.kind??exp.kind??spec.kind;
  if(kind===(exp.kind??spec.kind)){for(const k of TABLE_KEYS)if(exp[k]!==undefined)out[k]=exp[k];if(sc.kind===undefined&&exp.kind!==undefined)out.kind=exp.kind;}
  for(const [k,v] of Object.entries(sc))if(k!=='meta')out[k]=v;
  if(Array.isArray(out.frames)&&sc.frames===undefined){out.framesRange=out.frames;delete out.frames;}
  const meta={...exp.meta,...sc.meta};
  if(Object.keys(meta).length)out.meta=meta;
  return out;
}
/** Accepted `wrap` values of a seamless piece: which pairs of opposite edges must continue each other. */
export const WRAPS=Object.freeze({xy:'nos dois sentidos',x:'só na horizontal',y:'só na vertical'});
/** Channel spread (max − min of R, G, B) still counted as gray in a transition mask. */
export const GRAY_TOLERANCE=2;
/** Lower bound of the inside step in the seam rule, so a flat colour does not fail on rounding noise. */
export const SEAM_MIN_STEP=1;
export const ID_PATTERN=/^[a-z0-9][a-z0-9-]*$/;

/** Path of `file` relative to the delivery root, with forward slashes (what the messages show). */
export const relName=(ctx,file)=>path.relative(ctx.input,file).split(path.sep).join('/');
const round=(v,d=1)=>Math.round(v*10**d)/10**d;
const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return NaN;return v.length%2?v[v.length>>1]:(v[v.length/2-1]+v[v.length/2])/2;};
const list=items=>items.length<2?String(items[0]??''):`${items.slice(0,-1).join(', ')} e ${items.at(-1)}`;
const json=v=>JSON.stringify(v);
const isPng=f=>/\.png$/i.test(f);
const samePair=(a,b)=>Array.isArray(a)&&a.length===2&&a.every((v,i)=>Math.abs(v-b[i])<1e-6);
const isPair=(v,positive=true)=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isInteger(n)&&(positive?n>0:n>=0));
const kindName=k=>KIND_NAMES[k]?`${KIND_NAMES[k]} ("${k}")`:`"${k}"`;
const percentile=(values,p)=>{const v=Float64Array.from(values).sort();return v.length?v[Math.min(v.length-1,Math.floor(p*(v.length-1)))]:NaN;};
const FORMAT_NAMES={jpeg:'JPEG',webp:'WebP',gif:'GIF',tiff:'TIFF',svg:'SVG',heif:'HEIF/AVIF',avif:'AVIF'};
/** The common ending of the "absent optional part" notes. */
const keeps=n=>`o jogo continua com a arte atual para ${n>1?'elas':'ela'}`;

/** Opaque box, foot row and foot centre (mean x of the 6 lowest drawn rows, like cellStats) of any cell. */
export function cellBox(data,width,x0,y0,w,h){
  let minX=w,minY=h,maxX=-1,maxY=-1,occupied=0,transparent=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const a=data[((y0+y)*width+x0+x)*4+3];
    if(a===0)transparent++;
    if(a>ALPHA_THRESHOLD){occupied++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  }
  let sum=0,count=0;
  if(maxY>=0)for(let y=Math.max(0,maxY-5);y<=maxY;y++)for(let x=0;x<w;x++)if(data[((y0+y)*width+x0+x)*4+3]>ALPHA_THRESHOLD){sum+=x;count++;}
  const nearEdge=occupied>0&&(minX<PADDING||minY<PADDING||maxX>w-1-PADDING||maxY>h-1-PADDING);
  return {occupied,transparent,minX,minY,maxX,maxY,height:maxY-minY+1,footX:count?sum/count:NaN,nearEdge};
}

/** Reads a PNG as RGBA; pushes a problem (and returns undefined) when it is unreadable or not a PNG. */
async function load(file,label,problems){
  let img;
  try{img=await raw(file);}
  catch{problems.push(`${label}: o arquivo não é um PNG válido ou está corrompido — exporte de novo.`);return;}
  if(img.meta.format!=='png'){problems.push(`${label}: o arquivo não é PNG (é ${FORMAT_NAMES[img.meta.format]??'outro formato'}, só com o nome .png). Exporte em PNG.`);return;}
  return img;
}
/** Transparent sheets: alpha channel present and some fully transparent background. False = stop checking cells. */
function checkTransparent(img,label,problems){
  if(!img.meta.hasAlpha){problems.push(`${label}: sem transparência (canal alfa). Salve o PNG com canal alfa, sem fundo branco nem xadrez pintado.`);return false;}
  for(let i=3;i<img.data.length;i+=4)if(img.data[i]===0)return true;
  problems.push(`${label}: nenhum pixel transparente: o fundo está pintado. Apague o fundo (alfa 0 em volta do desenho).`);
  return false;
}
function sizeProblem(label,img,w,h,layout,fix='Exporte a folha inteira nesse tamanho.'){
  return `${label}: tamanho ${img.width}×${img.height}, esperado ${w}×${h} (${layout}). ${fix}`;
}

/**
 * Cell checks over a grid: drawn, transparent background, PADDING margin and, with `anchor`, the foot rules (foot line
 * = lowest drawn row at anchor[1]×h ± FOOT_Y_TOLERANCE×h; foot centre at anchor[0]×w ± FOOT_X_TOLERANCE×w), each per
 * row (`footY(r)`, `footX(r)`). `character`: wording for enemies/player characters (feet, "boneco"); otherwise the
 * drawing and its base, pointing at the sidecar anchor (`anchorFile`).
 * Messages are grouped per row so a shifted row is one sentence listing its columns.
 */
function checkGrid(problems,label,img,{cw,ch,cols,rows,rowName=()=>'',colName=c=>`coluna ${c+1}`,anchor,footX=()=>true,footY=()=>true,allowEmpty=false,padding=true,hint='',character=false,anchorFile='o .json'}){
  const at=items=>{
    if(cols>1&&items.length===cols&&items.every(i=>i.v===items[0].v))return `todas as ${cols} colunas${items[0].v?`, ${items[0].v}`:''}`;
    return list(items.map(i=>typeof i==='number'?colName(i):`${colName(i.c)} (${i.v})`));
  };
  const stats=[];
  let drawn=0;
  for(let r=0;r<rows;r++){
    const row=rowName(r),where=row?`${label}, ${row}`:label;
    const empty=[],opaque=[],edge=[],fy=[],fx=[];
    stats.push([]);
    for(let c=0;c<cols;c++){
      const s=cellBox(img.data,img.width,c*cw,r*ch,cw,ch);stats[r].push(s);
      if(!s.occupied){if(!allowEmpty)empty.push(c);continue;}
      drawn++;
      if(!s.transparent)opaque.push(c);
      else if(padding&&s.nearEdge)edge.push(c);
      if(anchor){
        if(footY(r)&&Math.abs(s.maxY-anchor[1]*ch)>FOOT_Y_TOLERANCE*ch)fy.push({c,v:`y = ${s.maxY}`});
        if(footX(r)&&!(Math.abs(s.footX-anchor[0]*cw)<=FOOT_X_TOLERANCE*cw))fx.push({c,v:`x = ${Math.round(s.footX)}`});
      }
    }
    if(empty.length)problems.push(`${where}: célula vazia (${at(empty)}). Desenhe todas as células${character?' (no parado, pode repetir o desenho)':''}.${hint}`);
    if(opaque.length)problems.push(`${where}: célula sem fundo transparente (${at(opaque)}). Apague o fundo da célula.`);
    if(edge.length)problems.push(`${where}: desenho a menos de ${PADDING} px da borda da célula (${at(edge)}). Afaste o desenho${character?' (arma, cabelo, efeito)':''} da borda.${hint}`);
    if(!fy.length&&!fx.length)continue;
    const wantY=`esperado y = ${round(anchor[1]*ch)} ± ${round(FOOT_Y_TOLERANCE*ch)} (${anchor[1]} da altura da célula)`;
    const wantX=`esperado x = ${round(anchor[0]*cw)} ± ${round(FOOT_X_TOLERANCE*cw)} (${anchor[0]} da largura da célula)`;
    if(fy.length)problems.push(character
      ?`${where}: pés fora do chão (${at(fy)}), ${wantY}. Alinhe o ponto mais baixo do desenho com o chão; nada abaixo do pé (sombra, bolsa, capa).`
      :`${where}: base do desenho fora da linha de apoio (${at(fy)}), ${wantY}, pelo "anchor" de ${anchorFile}. Alinhe o ponto mais baixo do desenho com o anchor, ou corrija o anchor.`);
    if(fx.length)problems.push(character
      ?`${where}: pés fora do centro (${at(fx)}), ${wantX}. Centralize o boneco na célula.`
      :`${where}: base do desenho fora do ponto de apoio (${at(fx)}), ${wantX}, pelo "anchor" de ${anchorFile}. Ponha a base do desenho no x do anchor, ou corrija o anchor.`);
  }
  if(allowEmpty&&!drawn)problems.push(`${label}: a folha está vazia (nenhum pixel desenhado). Desenhe a camada ou não envie o arquivo.`);
  return stats;
}

/** Reads the sidecar `<id>.json` / `meta.json`. Returns {} when absent; pushes problems for bad JSON or unknown keys. */
async function readSidecar(file,label,problems,keys=SIDECAR_KEYS){
  if(!file)return {};
  let text,data;
  try{text=(await readFile(file,'utf8')).replace(/^\uFEFF/,'');}
  catch{problems.push(`${label}: não foi possível ler o arquivo. Salve o JSON de novo (texto UTF-8).`);return {invalid:true};}
  try{data=JSON.parse(text);}catch(e){problems.push(`${label}: ${jsonError(text,e)} Corrija o arquivo (aspas duplas nas chaves e nos textos, sem vírgula sobrando).`);return {invalid:true};}
  if(!data||typeof data!=='object'||Array.isArray(data)){problems.push(`${label}: o JSON precisa ser um objeto, como {"cell":[128,128]}.`);return {invalid:true};}
  const unknown=Object.keys(data).filter(k=>!keys.includes(k));
  if(unknown.length)problems.push(`${label}: chave desconhecida ${list(unknown.map(k=>`"${k}"`))}. Chaves aceitas: ${keys.join(', ')}.`);
  return data;
}
/** pt-BR sentence for a JSON.parse failure: the line when the engine says where, never its English message. */
function jsonError(text,e){
  const m=String(e?.message??'');
  if(!text.trim())return 'o JSON está vazio.';
  let line=Number(/\bline (\d+)/.exec(m)?.[1]);
  const pos=/\bposition (\d+)/.exec(m)?.[1];
  if(!line&&pos!==undefined)line=text.slice(0,Number(pos)).split('\n').length;
  if(line)return `o JSON tem um erro de sintaxe na linha ${line}.`;
  if(/end of (JSON|data)|Unexpected end/i.test(m))return 'o JSON termina antes da hora (falta fechar } ou ]).';
  return 'o JSON tem um erro de sintaxe.';
}
/** Optional boolean sidecar key; null (and a problem) when it is something else. */
function checkBool(value,key,label,problems){
  if(value===undefined||typeof value==='boolean')return value;
  problems.push(`${label}: ${key} ${json(value)} inválido; use true ou false.`);return null;
}
function checkAnchor(value,label,problems,{required=false,exact}={}){
  if(value===undefined){if(required)problems.push(`${label}: falta "anchor" ([x,y] do ponto onde a peça encosta no chão, em fração da célula, como [0.5,0.88]).`);return;}
  if(!(Array.isArray(value)&&value.length===2&&value.every(n=>typeof n==='number'&&n>=0&&n<=1))){problems.push(`${label}: anchor ${json(value)} inválido; use [x,y] entre 0 e 1, como [0.5,0.88].`);return;}
  if(exact&&!samePair(value,exact)){problems.push(`${label}: anchor ${json(value)}, esperado ${json(exact)} (pés no meio da largura, a ${exact[1]*100}% da altura).`);return;}
  return value;
}
function checkFps(value,label,problems,names){
  if(value===undefined)return;
  if(typeof value==='number'){if(!(value>0))problems.push(`${label}: fps ${json(value)} inválido; use quadros por segundo maior que 0.`);return value;}
  if(!value||typeof value!=='object'||Array.isArray(value)){problems.push(`${label}: fps ${json(value)} inválido; use {"<animação>": quadros por segundo}.`);return;}
  for(const [k,v] of Object.entries(value)){
    if(names&&!names.includes(k))problems.push(`${label}: fps cita "${k}", que não é uma animação desta peça (${list(names)}).`);
    else if(!(typeof v==='number'&&v>0))problems.push(`${label}: fps de "${k}" = ${json(v)} inválido; use quadros por segundo maior que 0.`);
  }
  return value;
}

// ---------------------------------------------------------------- one PNG per direction (enemies, towers)
/**
 * `<anim>-<DIR>.png` → {anim, dir}: `dir` is the DIRECTIONS name (any case in the file name) or undefined when the
 * suffix is no direction. undefined when the name is not `<one of anims>-<suffix>.png`.
 */
export function directionFile(name,anims){
  const m=/^(.+)-([a-z]+).png$/i.exec(name);
  if(!m||!anims.includes(m[1]))return;
  const dir=m[2].toUpperCase();
  return {anim:m[1],dir:DIRECTIONS.includes(dir)?dir:undefined};
}
/** Adds a per-direction file to `perDir` ({[anim]:{dirs:{[DIR]:file},unknown:[],twice:[]}}). */
function addDirection(perDir,{anim,dir},file){
  const p=perDir[anim]??={dirs:{},unknown:[],twice:[]};
  if(!dir)p.unknown.push(file);
  else if(p.dirs[dir])p.twice.push(file);
  else p.dirs[dir]=file;
}
/**
 * Assembles one animation delivered as one PNG per direction into its sheet: one row per direction, DIRECTIONS order
 * (S, SW, W, NW, N, NE, E, SE). Every direction must come exactly once, no other suffix, all images the same size.
 * `folder`: the piece folder as the messages show it. Returns the sheet as a PNG Buffer, or undefined (problems pushed).
 */
export async function assembleDirections(ctx,folder,anim,{dirs,unknown=[],twice=[]},problems){
  const before=problems.length,name=d=>`${anim}-${d}.png`;
  for(const f of unknown)problems.push(`${relName(ctx,f)}: direção desconhecida no nome. Use ${anim}-<direção>.png com uma das 8 direções ${DIRECTIONS.join(', ')}.`);
  for(const f of twice)problems.push(`${relName(ctx,f)}: direção repetida (já veio outro arquivo para ela). Envie uma imagem por direção.`);
  const missing=DIRECTIONS.filter(d=>!dirs[d]);
  if(missing.length)problems.push(`${folder}/${anim}-*.png: ${missing.length>1?'faltam as direções':'falta a direção'} ${list(missing.map(d=>`${d} (${DIRECTION_NAMES[d]})`))}. Entregue as 8 imagens ${name('S')} … ${name('SE')} (${DIRECTIONS.join(', ')}), ou a folha inteira ${anim}.png.`);
  if(problems.length>before)return;
  const images=[];
  for(const d of DIRECTIONS)images.push(await load(dirs[d],relName(ctx,dirs[d]),problems));
  if(problems.length>before)return;
  const [w,h]=[images[0].width,images[0].height];
  images.forEach((img,i)=>{
    if(img.width!==w||img.height!==h)problems.push(`${relName(ctx,dirs[DIRECTIONS[i]])}: tamanho ${img.width}×${img.height}, diferente de ${name('S')} (${w}×${h}). As 8 direções precisam ter o mesmo tamanho (uma linha de quadros cada).`);
  });
  if(problems.length>before)return;
  // Same width: the RGBA rows of the 8 images, one after the other, are the sheet's rows in DIRECTIONS order.
  return sharp(Buffer.concat(images.map(i=>i.data)),{raw:{width:w,height:h*DIRECTIONS.length,channels:4}}).png({compressionLevel:1}).toBuffer();
}
/** The sheet of `anim`: its file, or its per-direction images assembled; {source,label} or undefined (problems pushed). */
async function sheetSource(ctx,folder,anim,file,perDir,problems){
  if(file&&perDir){problems.push(`${folder}/${anim}: veio a folha ${anim}.png e também imagens por direção (${anim}-<direção>.png). Envie só uma das duas formas.`);return;}
  if(file)return {source:file,label:relName(ctx,file)};
  const source=await assembleDirections(ctx,folder,anim,perDir,problems);
  return source&&{source,label:`${folder}/${anim}-*.png (8 direções montadas)`};
}

// ---------------------------------------------------------------- animations (enemies, 8 directions)
/**
 * Partial delivery inside the piece: the animations that came are checked and approved; the absent ones are notes
 * (the game keeps its current art for them). Zero animations is a problem, unless the piece was approved in an earlier
 * run (`ctx.manifest.pieces[id]`) and only the elite layer comes now.
 */
async function validateAnimations(spec,id,files,ctx,r){
  const {problems,notes,sheets}=r;
  const piece=spec.pieces[id],anims=Object.keys(piece.anims),groupDir=path.join(ctx.input,spec.input);
  const rest=Object.keys(REST_ANIMS),all=[...anims,...rest],variants=ELITE_VARIANTS[id]??[];
  const pieceLabel=`${spec.input}/${id}`,eliteLabel=`${spec.input}/elite/${id}`;
  // `layers`: the elite layer ('elite') and its round variants ('elite/<variant>'), each {anim → file}.
  const base={},layers={elite:{}},perDir={};let meta;
  for(const v of variants)layers[`elite/${v}`]={};
  const layerName=(layer,anim)=>`${spec.input}/elite/${id}-${layer==='elite'?'':`${layer.slice(6)}-`}${anim}`;
  for(const f of files){
    const parts=path.relative(groupDir,f).split(path.sep),name=parts.at(-1),label=relName(ctx,f);
    if(parts.length===2&&parts[0]===id){
      if(name==='meta.json')meta=f;
      else if(rest.some(a=>name===`${a}.meta.json`))continue; // one-row sidecar: the cell and fps come from meta.json
      else if(isPng(name)&&all.includes(name.slice(0,-4)))base[name.slice(0,-4)]=f;
      else if(directionFile(name,anims))addDirection(perDir,directionFile(name,anims),f);
      else problems.push(`${label}: arquivo não esperado. Nesta pasta vão só meta.json e ${list(anims.map(a=>`${a}.png`))} (ou uma imagem por direção, <animação>-S.png … -SE.png), mais ${list(rest.map(a=>`${a}.png`))} (opcionais, só de frente).`);
    }else if(parts.length===2&&parts[0]==='elite'&&name.startsWith(`${id}-`)){
      const tail=name.slice(id.length+1);
      if(/\.meta\.json$/i.test(tail))continue; // per-layer sidecar: the layer has the base animation's grid
      const v=variants.find(x=>tail.startsWith(`${x}-`)),anim=isPng(tail)?tail.slice(v?v.length+1:0,-4):undefined;
      if(anim&&all.includes(anim))layers[v?`elite/${v}`:'elite'][anim]=f;
      else problems.push(`${label}: arquivo não esperado para ${id}. Use ${pieceLabel}/<animação>.png e ${spec.input}/elite/${id}-<animação>.png${variants.length?` (ou a variante ${list(variants.map(x=>`${id}-${x}-<animação>.png`))})`:''}.`);
    }
    else problems.push(`${label}: arquivo não esperado para ${id}. Use ${pieceLabel}/<animação>.png e ${spec.input}/elite/${id}-<animação>.png.`);
  }
  const sent=a=>base[a]||perDir[a];
  const present=anims.filter(sent),missing=anims.filter(a=>!sent(a)),restSent=rest.filter(sent);
  const elite=layers.elite,eliteSent=all.filter(a=>elite[a]);
  const layerSent=Object.values(layers).some(l=>Object.keys(l).length);
  const approvedBefore=ctx.manifest?.pieces?.[id];
  const eliteOnly=!meta&&!present.length&&!restSent.length&&layerSent;
  if(eliteOnly&&!approvedBefore){
    problems.push(`${eliteLabel}-*.png: camada elite sem a peça base (${pieceLabel}/). Entregue a pasta do inimigo junto com a camada.`);
    return;
  }
  const cell=[piece.cell,piece.cell],anchor=spec.anchor??ANCHOR;
  let fps;
  if(!eliteOnly){
    if(!meta)problems.push(`${pieceLabel}/meta.json: faltando. Crie com {"cell":${json(cell)},"anchor":${json(ANCHOR)},"fps":{"idle":6,…}}.`);
    else{
      const label=relName(ctx,meta),m=await readSidecar(meta,label,problems,['cell','anchor','fps']);
      if(!m.invalid){
        if(!samePair(m.cell,cell))problems.push(`${label}: cell ${json(m.cell)}, esperado ${json(cell)} para ${id}. Desenhe em células de ${piece.cell}×${piece.cell} px.`);
        if(m.anchor===undefined)problems.push(`${label}: falta "anchor": ${json(ANCHOR)}.`);
        else checkAnchor(m.anchor,label,problems,{exact:anchor});
        fps=checkFps(m.fps,label,problems,all);
      }
    }
    if(!present.length)problems.push(`${pieceLabel}/: nenhuma animação entregue. Envie pelo menos uma de ${list(anims.map(a=>`${a}.png`))} (${piece.cell} px por célula, 8 direções).`);
  }
  // `layer`: undefined for the base sheet, else 'elite' (key elite/<anim>) or 'elite/<variant>' (key elite/<variant>-<anim>).
  const check=async(file,anim,layer,label=relName(ctx,file))=>{
    const isRest=Object.hasOwn(REST_ANIMS,anim),frames=piece.anims[anim]??REST_ANIMS[anim],c=piece.cell,dirs=isRest?1:DIRECTIONS.length;
    const img=await load(file,label,problems);if(!img)return;
    if(img.width!==frames*c||img.height!==dirs*c){
      const got=img.height===dirs*c&&img.width%c===0?` A folha tem ${img.width/c} quadros.`:'';
      const rows=isRest?'Exporte a folha inteira nesse tamanho, uma linha só, de frente (S).':`Exporte a folha inteira nesse tamanho, uma linha por direção (${DIRECTIONS.join(', ')}).`;
      problems.push(sizeProblem(label,img,frames*c,dirs*c,`${frames} quadros × ${dirs} ${dirs>1?'direções':'direção'} de ${c} px`,`${rows}${got}`));return;
    }
    if(!checkTransparent(img,label,problems))return;
    // AIRBORNE and the rest rows: no foot rule; LUNGE: the foot line stays, the centre does not (spec.mjs).
    const grounded=!isRest&&!AIRBORNE_ANIMS.has(anim);
    checkGrid(problems,label,img,{cw:c,ch:c,cols:frames,rows:dirs,rowName:r=>`${DIRECTION_NAMES[DIRECTIONS[r]]} (linha ${r+1})`,
      anchor:layer?undefined:anchor,footY:()=>grounded,footX:()=>grounded&&!LUNGE_ANIMS.has(anim),
      allowEmpty:!!layer,character:true});
    const output=layer?`${layerName(layer,anim).slice(spec.input.length+1)}.webp`:`${id}/${anim}.webp`;
    sheets.push({key:layer?`${layer}${layer==='elite'?'/':'-'}${anim}`:anim,source:file,...(Buffer.isBuffer(file)?{label}:{}),output,
      cell:[c,c],frames:img.width/c,directions:dirs,anchor:[...anchor],...(fps?.[anim]?{fps:fps[anim]}:{})});
  };
  for(const anim of present){
    const s=await sheetSource(ctx,pieceLabel,anim,base[anim],perDir[anim],problems);
    if(s)await check(s.source,anim,undefined,s.label);
  }
  for(const anim of restSent)await check(base[anim],anim,undefined);
  if(present.length&&missing.length)
    notes.push(`${pieceLabel}: ${missing.length>1?'faltam as animações':'falta a animação'} ${list(missing)} — ${keeps(missing.length)}.`);
  // The elite layer goes over the base of the same animation: over an animation that did not come now it is only
  // accepted when that base was approved in an earlier run (already v2 in the manifest); otherwise it waits for it.
  const eliteBase=a=>sent(a)||approvedBefore?.files?.[a];
  for(const [layer,byAnim] of Object.entries(layers))for(const anim of all.filter(a=>byAnim[a])){
    if(eliteBase(anim))await check(byAnim[anim],anim,layer);
    else notes.push(`${layerName(layer,anim)}.png: ignorada por enquanto, porque ${pieceLabel}/${anim}.png não veio nem foi aprovada antes; envie as duas juntas.`);
  }
  if(!eliteOnly&&present.length){
    const noElite=present.filter(a=>!elite[a]);
    if(!eliteSent.length)notes.push(`${pieceLabel}: sem a camada elite (${eliteLabel}-<animação>.png) — o elite continua com a arte atual.`);
    else if(noElite.length)notes.push(`${eliteLabel}: ${noElite.length>1?'faltam as camadas elite de':'falta a camada elite de'} ${list(noElite)} — o elite continua com a arte atual ${noElite.length>1?'nelas':'nela'}.`);
  }
}

// ---------------------------------------------------------------- dir8 (player characters)
/** The sprite-atlas rules over 8 blocks (DIRECTIONS order), compared row by row against SE (today's front-right). */
function checkDir8(problems,label,img,pivotX){
  const {data,width}=img,norm=(d,x)=>LEFT.has(d)?CELL-1-x:x,mirror=x=>CELL-1-x;
  const lo=Math.min(pivotX,mirror(pivotX)),hi=Math.max(pivotX,mirror(pivotX));
  const centred=d=>d==='S'||d==='N';
  const at=items=>{
    if(items.length===COLUMNS&&items.every(i=>i.v===items[0].v))return `todas as ${COLUMNS} colunas${items[0].v?`, ${items[0].v}`:''}`;
    return list(items.map(i=>typeof i==='number'?`coluna ${i+1}`:`coluna ${i.c+1} (${i.v})`));
  };
  const blocks=DIRECTIONS.map((d,b)=>{
    const name=DIRECTION_NAMES[d];
    const rows=ROW_NAMES.map((row,r)=>{
      const line=b*ROWS+r,where=`${label}, ${name}, ${row} (linha ${line+1})`;
      const cells=Array.from({length:COLUMNS},(_,c)=>cellStats(data,width,line*COLUMNS+c));
      const empty=[],opaque=[],edge=[],low=[];
      cells.forEach((s,c)=>{
        if(!s.occupied){empty.push(c);return;}
        if(!s.transparent)opaque.push(c);
        else if(s.minX<PADDING||s.minY<PADDING||s.maxX>CELL-1-PADDING||s.maxY>CELL-1-PADDING)edge.push(c);
        if(Math.abs(s.maxY-PIVOT_Y)>CELL_BASELINE_TOLERANCE)low.push({c,v:`y = ${s.maxY}`});
      });
      if(empty.length)problems.push(`${where}: célula vazia (${at(empty)}). Desenhe todas as células (no parado, pode repetir o desenho).`);
      if(opaque.length)problems.push(`${where}: célula sem fundo transparente (${at(opaque)}). Apague o fundo da célula.`);
      if(edge.length)problems.push(`${where}: desenho a menos de ${PADDING} px da borda da célula (${at(edge)}). Afaste o desenho (arma, cabelo, efeito) da borda.`);
      if(low.length)problems.push(`${where}: pés fora da linha ${PIVOT_Y} ± ${CELL_BASELINE_TOLERANCE} (${at(low)}). Aquela célula subiu ou desceu demais: alinhe os pés.`);
      const drawn=cells.filter(s=>s.occupied);
      const baseline=median(drawn.map(s=>s.maxY)),footX=round(median(drawn.map(s=>norm(d,s.footX)))),height=median(drawn.map(s=>s.height));
      if(Math.abs(baseline-PIVOT_Y)>ROW_BASELINE_TOLERANCE[r])problems.push(`${where}: os pés ficam na linha ${baseline} (mediana das 6 células), esperado ${PIVOT_Y} ± ${ROW_BASELINE_TOLERANCE[r]}. A linha toda está fora do chão: mova o bloco.`);
      return {row,where,baseline,footX,height};
    });
    const stand=cellStats(data,width,b*ROWS*COLUMNS),where=`${label}, ${name}, parado (linha ${b*ROWS+1}, coluna 1)`;
    if(stand.occupied){
      if(centred(d)){
        if(!(stand.footX>=lo-PIVOT_X_TOLERANCE&&stand.footX<=hi+PIVOT_X_TOLERANCE))problems.push(`${where}: pés centrados em x = ${Math.round(stand.footX)}, esperado entre ${Math.round(lo)} e ${Math.round(hi)} ± ${PIVOT_X_TOLERANCE} (coluna da classe e sua espelhada). Mova o boneco para perto da coluna da classe.`);
      }else{
        const x=norm(d,stand.footX);
        if(!(Math.abs(x-pivotX)<=PIVOT_X_TOLERANCE))problems.push(`${where}: pés centrados em x = ${Math.round(stand.footX)}, esperado ${Math.round(norm(d,pivotX))} ± ${PIVOT_X_TOLERANCE}${LEFT.has(d)?' (coluna da classe espelhada: 191 − x)':' (coluna da classe)'}. Mova o boneco para a coluna da classe (tabela de docs/sprite-directions.md).`);
      }
    }
    return {d,rows};
  });
  const ref=blocks.find(b=>b.d==='SE'),refName=DIRECTION_NAMES.SE;
  for(const block of blocks)if(block!==ref)block.rows.forEach((row,r)=>{
    const want=ref.rows[r];
    if(Number.isFinite(row.baseline)&&Number.isFinite(want.baseline)&&Math.abs(row.baseline-want.baseline)>FACING_BASELINE_TOLERANCE[r])
      problems.push(`${row.where}: pés na linha ${row.baseline}, ${refName} na ${want.baseline} (pivô diferente entre direções, tolerância ${FACING_BASELINE_TOLERANCE[r]} px). Alinhe o chão desta direção com o ${refName}.`);
    if(centred(block.d)){
      if(Number.isFinite(row.footX)&&!(row.footX>=lo-FACING_FOOT_TOLERANCE&&row.footX<=hi+FACING_FOOT_TOLERANCE))
        problems.push(`${row.where}: pés centrados em ${row.footX} (mediana das 6 células), esperado entre ${Math.round(lo)} e ${Math.round(hi)} ± ${FACING_FOOT_TOLERANCE} (pivô diferente entre direções). Mova o boneco para perto da coluna da classe.`);
    }else if(Number.isFinite(row.footX)&&Number.isFinite(want.footX)&&!(Math.abs(row.footX-want.footX)<=FACING_FOOT_TOLERANCE))
      problems.push(`${row.where}: pés centrados em ${row.footX}${LEFT.has(block.d)?' (espelhado)':''}, ${refName} em ${want.footX} (pivô diferente entre direções, tolerância ${FACING_FOOT_TOLERANCE} px). Esta direção pisa em outro ponto que o ${refName}.`);
    if(Number.isFinite(row.height)&&Number.isFinite(want.height)&&Math.abs(row.height-want.height)>want.height*FACING_HEIGHT_TOLERANCE)
      problems.push(`${row.where}: altura ${row.height} px, ${refName} ${want.height} px (altura diferente entre direções, tolerância ${FACING_HEIGHT_TOLERANCE*100} %). O boneco cresceu ou encolheu nesta direção.`);
  });
}
/** Placeholder silhouette of the player characters (inventário §2, P2): 8 cells of 192 px in one row, DIRECTIONS order. */
export const SILHOUETTE='_silhueta';
async function validateSilhouette(spec,files,ctx,{problems,sheets}){
  const file=files.find(f=>path.basename(f).toLowerCase()===`${SILHOUETTE}.png`);
  for(const f of files)if(f!==file)problems.push(`${relName(ctx,f)}: arquivo não esperado. A silhueta é só ${spec.input}/${SILHOUETTE}.png.`);
  if(!file)return;
  const label=relName(ctx,file),img=await load(file,label,problems);
  if(!img)return;
  const width=CELL*DIRECTIONS.length;
  if(img.width!==width||img.height!==CELL)problems.push(sizeProblem(label,img,width,CELL,`${DIRECTIONS.length} direções de ${CELL} px numa linha`,`Uma célula por direção, na ordem ${DIRECTIONS.join(', ')}.`));
  else if(checkTransparent(img,label,problems)){
    checkGrid(problems,label,img,{cw:CELL,ch:CELL,cols:DIRECTIONS.length,rows:1,colName:c=>`${DIRECTION_NAMES[DIRECTIONS[c]]} (coluna ${c+1})`,anchor:ANCHOR,character:true});
    sheets.push({key:'silhueta',source:file,output:`${SILHOUETTE}.webp`,cell:[CELL,CELL],frames:1,directions:DIRECTIONS.length,anchor:[...ANCHOR]});
  }
}
async function validateDir8(spec,id,files,ctx,r){
  const {problems,notes,sheets}=r;
  if(id===SILHOUETTE)return validateSilhouette(spec,files,ctx,r);
  let atlas,downed;
  for(const f of files){
    const name=path.basename(f),label=relName(ctx,f);
    if(name.toLowerCase()===`${id}.dir8.png`)atlas=f;
    else if(name.toLowerCase()===`${id}.downed.png`)downed=f;
    else problems.push(`${label}: arquivo não esperado. Para ${id} use ${spec.input}/${id}.dir8.png e, opcional, ${spec.input}/${id}.downed.png.`);
  }
  const approved=path.join(ctx.repoRoot,'public/art/sprites',`${id}.webp`);
  const known=ctx.classes?ctx.classes.includes(id):true;
  if(!known){problems.push(`${spec.input}/${id}: "${id}" não é uma classe com folha aprovada (public/art/sprites/${id}.webp). Confira o nome do arquivo (tabela de docs/sprite-directions.md).`);return;}
  if(atlas&&!downed)notes.push(`${spec.input}/${id}: falta a pose caída (${id}.downed.png) — ${keeps(1)}.`);
  if(downed&&!atlas)notes.push(`${spec.input}/${id}: falta o atlas de 8 direções (${id}.dir8.png) — o jogo continua com a arte atual para parado, andar e ataque.`);
  if(atlas){
    const label=relName(ctx,atlas),img=await load(atlas,label,problems);
    if(img){
      if(img.width!==DIR8.width||img.height!==DIR8.height)problems.push(sizeProblem(label,img,DIR8.width,DIR8.height,`atlas de 8 direções: ${COLUMNS} colunas × ${ROWS*DIRECTIONS.length} linhas de ${CELL} px`,`Exporte a folha inteira: 8 blocos de 3 linhas (parado, andar, ataque) na ordem ${DIRECTIONS.join(', ')}.`));
      else if(checkTransparent(img,label,problems)){
        checkDir8(problems,label,img,await approvedPivotX(approved));
        const common={source:atlas,cell:[CELL,CELL],frames:COLUMNS,directions:4};
        sheets.push({key:'dir4',output:`${id}.dir4.webp`,blocks:[...DIR4_FROM_DIR8],...common});
        sheets.push({key:'dir4c',output:`${id}.dir4c.webp`,blocks:[...CARDINALS],...common});
      }
    }
  }
  if(downed){
    const label=relName(ctx,downed),img=await load(downed,label,problems);
    if(img){
      if(img.width!==DOWNED.width||img.height!==DOWNED.height)problems.push(sizeProblem(label,img,DOWNED.width,DOWNED.height,`${COLUMNS} quadros × ${DIRECTIONS.length} direções de ${CELL} px`,`Uma linha por direção, na ordem ${DIRECTIONS.join(', ')}.`));
      else if(checkTransparent(img,label,problems)){
        // Lying down and getting up: the lowest pixel is still the ground (foot line), but the body leaves the centre.
        checkGrid(problems,label,img,{cw:CELL,ch:CELL,cols:COLUMNS,rows:DIRECTIONS.length,rowName:r=>`${DIRECTION_NAMES[DIRECTIONS[r]]} (linha ${r+1})`,anchor:ANCHOR,footX:()=>false,character:true});
        sheets.push({key:'downed',source:downed,output:`${id}.downed.webp`,cell:[CELL,CELL],frames:COLUMNS,directions:DIRECTIONS.length,anchor:[...ANCHOR]});
      }
    }
  }
}

// ---------------------------------------------------------------- towers (base in 4 views + weapon in 8 directions)
/** Keys of a tower's base.json and of its `meta` (08-TORRES.md: no other key). */
export const TOWER_BASE_KEYS=Object.freeze(['kind','cell','views','rows','anchor','meta']);
export const TOWER_META_KEYS=Object.freeze(['footprint','mount']);
const sameList=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
/**
 * `torres/<id>/` (spec.mjs TOWER_*): `base.png` + `base.json` (4 views × TOWER_ROWS, or TOWER_WALL_ROWS for a wall,
 * which has no weapon) and the weapon `idle/fire/reload.png` (8 directions, or one PNG per direction) + `meta.json`.
 * Absent weapon animations are notes; the base is required unless approved in an earlier run.
 */
async function validateTower(spec,id,files,ctx,r){
  const {problems,notes,sheets}=r,folder=`${spec.input}/${id}`,dir=path.join(ctx.input,spec.input,id);
  if(!ID_PATTERN.test(id)){problems.push(`${folder}/: nome "${id}" inválido. Use só letras minúsculas sem acento, números e hífen (ex.: ${spec.input}/vigia-do-predio).`);return;}
  let basePng,baseJson,metaJson;const anims={},perDir={};
  for(const f of files){
    const rel=path.relative(dir,f).split(path.sep),name=rel.at(-1),label=relName(ctx,f);
    if(rel.length!==1)problems.push(`${label}: fora do lugar. Coloque os arquivos direto em ${folder}/.`);
    else if(name==='base.png')basePng=f;
    else if(name==='base.json')baseJson=f;
    else if(name==='meta.json')metaJson=f;
    else if(isPng(name)&&TOWER_ANIMS.includes(name.slice(0,-4)))anims[name.slice(0,-4)]=f;
    else if(directionFile(name,TOWER_ANIMS))addDirection(perDir,directionFile(name,TOWER_ANIMS),f);
    else problems.push(`${label}: arquivo não esperado. Na pasta da torre vão base.png, base.json, meta.json e ${list(TOWER_ANIMS.map(a=>`${a}.png`))} (ou uma imagem por direção, <animação>-S.png … -SE.png).`);
  }
  const sentAnims=TOWER_ANIMS.filter(a=>anims[a]||perDir[a]),approvedBefore=ctx.manifest?.pieces?.[id];
  // Base.
  let wall=false;
  if(!basePng&&!approvedBefore)problems.push(`${folder}/base.png: faltando. Toda torre precisa da base: 4 vistas (${VIEW_NAMES.join(', ')}) × ${TOWER_ROWS.length} linhas (${TOWER_ROWS.join(', ')}), com base.json.`);
  if(basePng&&!baseJson)problems.push(`${folder}/base.json: faltando. Crie com {"kind":"views","cell":[W,H],"views":4,"rows":${json(TOWER_ROWS)},"anchor":[0.5,Y],"meta":{"footprint":[a,b],"mount":[x,y]}}.`);
  if(baseJson&&!basePng)problems.push(`${folder}/base.png: faltando (só veio o base.json). Envie a imagem da base.`);
  if(basePng&&baseJson){
    const label=relName(ctx,baseJson),b=await readSidecar(baseJson,label,problems,TOWER_BASE_KEYS);
    if(!b.invalid){
      const before=problems.length;
      if(b.kind!==undefined&&b.kind!=='views')problems.push(`${label}: kind ${json(b.kind)}, esperado "views".`);
      if(b.views!==undefined&&b.views!==VIEW_NAMES.length)problems.push(`${label}: views ${json(b.views)}, esperado ${VIEW_NAMES.length} (câmera ${VIEW_NAMES.join(', ')}).`);
      if(!isPair(b.cell))problems.push(`${label}: cell ${json(b.cell)} inválido; use [largura,altura] de uma vista em px, como [448,832].`);
      let rows=b.rows??[...TOWER_ROWS];
      wall=sameList(rows,TOWER_WALL_ROWS);
      if(!sameList(rows,TOWER_ROWS)&&!wall){problems.push(`${label}: rows ${json(b.rows)} inválido; use ${json(TOWER_ROWS)} (ou, num muro, ${json(TOWER_WALL_ROWS)}).`);rows=undefined;}
      const anchor=checkAnchor(b.anchor,label,problems,{required:true});
      const meta=isObject(b.meta)?b.meta:undefined;
      if(!meta)problems.push(`${label}: falta "meta" {"footprint":[a,b],"mount":[x,y]} (tamanho em células do mapa e ponto onde a arma encaixa na base).`);
      else{
        const extra=Object.keys(meta).filter(k=>!TOWER_META_KEYS.includes(k));
        if(extra.length)problems.push(`${label}: meta com chave desconhecida ${list(extra.map(k=>`"${k}"`))}. Chaves aceitas: ${TOWER_META_KEYS.join(', ')}.`);
        if(!isPair(meta.footprint))problems.push(`${label}: meta.footprint ${json(meta.footprint)} inválido; use [a,b] em células do mapa, como [2,2].`);
        if(meta.mount===undefined){if(!wall)problems.push(`${label}: falta meta.mount [x,y]: o ponto da base (em px da célula, vista 0°) onde fica a âncora da arma.`);}
        else if(!(isPair(meta.mount,false)&&isPair(b.cell)&&meta.mount[0]<=b.cell[0]&&meta.mount[1]<=b.cell[1]))
          problems.push(`${label}: meta.mount ${json(meta.mount)} inválido; use [x,y] inteiros em px dentro da célula ${isPair(b.cell)?`${b.cell[0]}×${b.cell[1]}`:'da base'}.`);
      }
      if(problems.length===before){
        r.meta={footprint:meta.footprint,...(meta.mount?{mount:meta.mount}:{})};
        const png=relName(ctx,basePng),img=await load(basePng,png,problems),[cw,ch]=b.cell,views=VIEW_NAMES.length;
        if(img&&(img.width!==views*cw||img.height!==rows.length*ch))
          problems.push(sizeProblem(png,img,views*cw,rows.length*ch,`${views} vistas × ${rows.length} linhas de ${cw}×${ch} px`,`Uma coluna por vista (${VIEW_NAMES.join(', ')}) e uma linha por estado (${list(rows)}).`));
        else if(img&&checkTransparent(img,png,problems)){
          checkGrid(problems,png,img,{cw,ch,cols:views,rows:rows.length,rowName:i=>`"${rows[i]}" (linha ${i+1})`,
            colName:c=>`vista ${VIEW_NAMES[c]} (coluna ${c+1})`,anchor,anchorFile:label});
          sheets.push({key:'base',source:basePng,output:`${id}/base.webp`,cell:[cw,ch],views,rows:[...rows],anchor});
        }
      }
    }
  }
  // Weapon + crew.
  if(wall&&(sentAnims.length||metaJson)){problems.push(`${folder}: um muro (rows ${json(TOWER_WALL_ROWS)}) não tem arma; tire ${list([...sentAnims.map(a=>`${a}.png`),...(metaJson?['meta.json']:[])])} da pasta.`);return;}
  if(!sentAnims.length){
    if(metaJson)problems.push(`${folder}/meta.json: veio sem nenhuma animação da arma (${list(TOWER_ANIMS.map(a=>`${a}.png`))}).`);
    else if(!wall&&basePng)notes.push(`${folder}: sem a arma (${list(TOWER_ANIMS.map(a=>`${a}.png`))}) — ${keeps(1)}.`);
    return;
  }
  if(!metaJson){problems.push(`${folder}/meta.json: faltando. Crie com {"cell":[W,H],"anchor":${json(ANCHOR)},"fps":{"idle":4,"fire":12,"reload":8}}.`);return;}
  const label=relName(ctx,metaJson),m=await readSidecar(metaJson,label,problems,['cell','anchor','fps']);
  if(m.invalid)return;
  const before=problems.length;
  if(!isPair(m.cell))problems.push(`${label}: cell ${json(m.cell)} inválido; use [largura,altura] de um quadro da arma em px, como [128,128].`);
  const anchor=checkAnchor(m.anchor,label,problems,{required:true}),fps=checkFps(m.fps,label,problems,[...TOWER_ANIMS]);
  if(problems.length>before)return;
  const [cw,ch]=m.cell,dirs=DIRECTIONS.length;
  for(const anim of sentAnims){
    const s=await sheetSource(ctx,folder,anim,anims[anim],perDir[anim],problems);if(!s)continue;
    const img=await load(s.source,s.label,problems);if(!img)continue;
    const frames=img.width/cw;
    if(img.height!==dirs*ch||!Number.isInteger(frames)||!frames||(anim==='idle'&&frames!==TOWER_IDLE_FRAMES)){
      const want=anim==='idle'?TOWER_IDLE_FRAMES:Number.isInteger(frames)&&frames>0?frames:'N';
      problems.push(sizeProblem(s.label,img,typeof want==='number'?want*cw:`${cw}×N`,dirs*ch,`${want} quadros × ${dirs} direções de ${cw}×${ch} px`,`Uma linha por direção (${DIRECTIONS.join(', ')}), quadros lado a lado.`));continue;
    }
    if(!checkTransparent(img,s.label,problems))continue;
    // The weapon stands on its mount (foot line at the anchor); recoil and the crew moving leave the centre free.
    checkGrid(problems,s.label,img,{cw,ch,cols:frames,rows:dirs,rowName:i=>`${DIRECTION_NAMES[DIRECTIONS[i]]} (linha ${i+1})`,anchor,footX:()=>false,anchorFile:label});
    sheets.push({key:anim,source:s.source,...(Buffer.isBuffer(s.source)?{label:s.label}:{}),output:`${id}/${anim}.webp`,cell:[cw,ch],frames,directions:dirs,anchor,...(fps?.[anim]?{fps:fps[anim]}:{})});
  }
  const missing=TOWER_ANIMS.filter(a=>!sentAnims.includes(a));
  if(missing.length)notes.push(`${folder}: ${missing.length>1?'faltam as animações':'falta a animação'} ${list(missing)} da arma — ${keeps(missing.length)}.`);
}

// ---------------------------------------------------------------- scenery pieces (sheet + layers, spec.mjs 'cenario')
/** Layer names of a decor piece besides `sheet`: a full-cell animation, a place's named overlay, the break sheet. */
export const DECOR_LAYER=/^(anim(-[a-z0-9]+(-[a-z0-9]+)*)?|quebra)$/;
/**
 * `cenario/decor/<id>/` (scripts/art-v2/adaptar/decor.mjs): `sheet.png` + `sheet.json` (a views sheet, the same rules as
 * any views piece) and optional layers `<layer>.png` + `<layer>.json` {"cell":[w,h],"frames":N,"views":4,"fps"?}: 4 rows
 * (views 0°/90°/180°/270°) × N frames. Layers are drawn over the sheet at meta.anims (or, full-cell, at the sheet's
 * anchor), so they have no foot rule.
 */
async function validateDecor(spec,id,files,ctx,r){
  const {problems,sheets}=r,folder=`${spec.input}/${id}`,dir=path.join(ctx.input,spec.input,id);
  if(!ID_PATTERN.test(id)){problems.push(`${folder}/: nome "${id}" inválido. Use só letras minúsculas sem acento, números e hífen.`);return;}
  const sheetFiles=[],layers=new Map();
  for(const f of files){
    const rel=path.relative(dir,f).split(path.sep),name=rel.at(-1),label=relName(ctx,f),m=/^(.+)\.(png|json)$/i.exec(name);
    if(rel.length!==1)problems.push(`${label}: fora do lugar. Coloque os arquivos direto em ${folder}/.`);
    else if(m&&m[1]==='sheet')sheetFiles.push(f);
    else if(m&&DECOR_LAYER.test(m[1])){if(!layers.has(m[1]))layers.set(m[1],{});layers.get(m[1])[m[2].toLowerCase()]=f;}
    else problems.push(`${label}: arquivo não esperado. Na pasta da peça vão sheet.png + sheet.json e, opcionais, anim.png, anim-<nome>.png e quebra.png (cada um com o seu .json).`);
  }
  if(!sheetFiles.length){problems.push(`${folder}/sheet.png: faltando. Toda peça precisa da folha com as 4 vistas.`);return;}
  await validateOneFile({...spec,kind:'views',kinds:['views'],expected:{}},`${id}/sheet`,sheetFiles,ctx,r);
  const own=spec.expected?.[id]?.meta;if(own)r.meta={...own,...r.meta};
  for(const [name,{png,json:side}] of layers){
    const label=`${folder}/${name}`;
    if(!png){problems.push(`${label}.png: faltando (só veio o ${name}.json).`);continue;}
    if(!side){problems.push(`${label}.json: faltando. Crie com {"cell":[W,H],"frames":N,"views":4}.`);continue;}
    const sc=await readSidecar(side,`${label}.json`,problems,['cell','frames','views','fps']);
    if(sc.invalid)continue;
    const before=problems.length;
    if(!isPair(sc.cell))problems.push(`${label}.json: cell ${json(sc.cell)} inválido; use [largura,altura] de um quadro em px.`);
    if(!(Number.isInteger(sc.frames)&&sc.frames>0))problems.push(`${label}.json: frames ${json(sc.frames)} inválido; use um inteiro maior que 0.`);
    if(sc.views!==VIEW_NAMES.length)problems.push(`${label}.json: views ${json(sc.views)}, esperado ${VIEW_NAMES.length} (uma linha por vista: ${VIEW_NAMES.join(', ')}).`);
    const fps=checkFps(sc.fps,`${label}.json`,problems);
    if(problems.length>before)continue;
    const img=await load(png,`${label}.png`,problems);if(!img)continue;
    const [cw,ch]=sc.cell;
    if(img.width!==sc.frames*cw||img.height!==sc.views*ch){problems.push(sizeProblem(`${label}.png`,img,sc.frames*cw,sc.views*ch,`${sc.frames} quadros × ${sc.views} vistas de ${cw}×${ch} px`,`Uma linha por vista (${VIEW_NAMES.join(', ')}), quadros lado a lado.`));continue;}
    if(!checkTransparent(img,`${label}.png`,problems))continue;
    sheets.push({key:name,source:png,output:`${id}/${name}.webp`,cell:[cw,ch],frames:sc.frames,views:sc.views,...(fps!==undefined?{fps}:{})});
  }
}

// ---------------------------------------------------------------- one-file kinds (views, frames, seamless, nineslice, icon)
/**
 * Seam rule (spec.mjs SEAM_*): for each wrapped pair of edges, the edge is split in SEAM_SEGMENTS stretches and the mean
 * step across the wrap in each stretch is compared with SEAM_PERCENTILE of the same measure over every interior line
 * (the step between neighbouring columns, or rows, over the same stretch). `alpha`: steps over premultiplied colour
 * plus alpha, so the transparent part of a telegraph texture counts by its coverage, not by its hidden colour.
 */
function seamProblems(img,label,problems,{wrap='xy',alpha=false}={}){
  const {data,width:w,height:h}=img;
  const px=(x,y)=>(y*w+x)*4;
  const step=alpha
    ?(i,j)=>{const a=data[i+3]/255,b=data[j+3]/255;return (Math.abs(data[i]*a-data[j]*b)+Math.abs(data[i+1]*a-data[j+1]*b)+Math.abs(data[i+2]*a-data[j+2]*b)+Math.abs(data[i+3]-data[j+3]))/4;}
    :(i,j)=>(Math.abs(data[i]-data[j])+Math.abs(data[i+1]-data[j+1])+Math.abs(data[i+2]-data[j+2]))/3;
  // horizontal wrap: columns x|x+1 along y (the edge runs along y); vertical wrap: rows y|y+1 along x.
  const axis=(horizontal)=>{
    const lines=horizontal?w:h,length=horizontal?h:w,n=Math.min(SEAM_SEGMENTS,length);
    const pair=horizontal?(l,t)=>step(px(l,t),px((l+1)%w,t)):(l,t)=>step(px(t,l),px(t,(l+1)%h));
    const bounds=Array.from({length:n},(_,k)=>[Math.floor(k*length/n),Math.floor((k+1)*length/n)]);
    const mean=(l,[a,b])=>{let sum=0;for(let t=a;t<b;t++)sum+=pair(l,t);return sum/(b-a);};
    const inside=[];
    for(let l=0;l+1<lines;l++)for(const b of bounds)inside.push(mean(l,b));
    const ref=Math.max(inside.length?percentile(inside,SEAM_PERCENTILE):0,SEAM_MIN_STEP);
    const bad=bounds.map((b,k)=>({k,b,v:mean(lines-1,b)})).filter(s=>s.v>SEAM_FACTOR*ref);
    if(!bad.length)return;
    const worst=Math.max(...bad.map(s=>s.v)),coord=horizontal?'y':'x';
    const where=list(bad.map(s=>`${coord} = ${s.b[0]}–${s.b[1]-1}`));
    const part=bad.length===n?'em toda a borda':`em ${bad.length} de ${n} trechos (${where})`;
    problems.push(horizontal
      ?`${label}: não emenda na horizontal: a borda direita não continua na esquerda ${part}; a diferença chega a ${round(worst)}, ${round(worst/ref)}× a variação normal entre pixels vizinhos da textura (limite ${SEAM_FACTOR}×). Faça a borda direita continuar na esquerda (no editor, deslocar metade da largura e retocar a costura).`
      :`${label}: não emenda na vertical: a borda de baixo não continua na de cima ${part}; a diferença chega a ${round(worst)}, ${round(worst/ref)}× a variação normal entre pixels vizinhos da textura (limite ${SEAM_FACTOR}×). Faça a borda de baixo continuar na de cima (deslocar metade da altura e retocar a costura).`);
  };
  if(wrap.includes('x'))axis(true);
  if(wrap.includes('y'))axis(false);
}
/** pt-BR side of the image for a direction from its centre (8 sectors, screen y down). */
const SIDES=['à direita','no canto inferior direito','embaixo','no canto inferior esquerdo','à esquerda','no canto superior esquerdo','em cima','no canto superior direito'];
/**
 * Circle-cropped pieces (rostos): every drawn pixel (alpha > ALPHA_THRESHOLD) must have its centre inside the central
 * circle of diameter `diameter`; one message with the count, the farthest distance and where they sit.
 */
export function circleProblems(img,label,problems,diameter){
  const cx=img.width/2,cy=img.height/2,r=diameter/2,where=new Set();
  let outside=0,far=0;
  for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){
    if(img.data[(y*img.width+x)*4+3]<=ALPHA_THRESHOLD)continue;
    const dx=x+.5-cx,dy=y+.5-cy,d=Math.hypot(dx,dy);
    if(d<=r)continue;
    outside++;far=Math.max(far,d);
    where.add(SIDES[(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8]);
  }
  if(!outside)return;
  const sides=SIDES.filter(s=>where.has(s));
  problems.push(`${label}: ${outside} ${outside===1?'pixel desenhado':'pixels desenhados'} fora do círculo central de ${diameter} px (${list(sides)}; o mais longe a ${Math.round(far-r)} px além da borda do círculo). O jogo recorta o rosto em círculo e isso sumiria. Traga o desenho (cabelo, chapéu, ombros) para dentro do círculo de ${diameter} px centrado na imagem ${img.width}×${img.height} e deixe o resto transparente.`);
}
function expectedCell(sc,spec,label,problems){
  if(sc.cell===undefined)return;
  if(!isPair(sc.cell)){problems.push(`${label}: cell ${json(sc.cell)} inválido; use [largura,altura] em px inteiros, como [128,128].`);return null;}
  return sc.cell;
}

async function validateOneFile(spec,id,files,ctx,r){
  const {problems,notes,sheets}=r;
  let png,side;
  const stem=path.basename(id);
  for(const f of files){
    const name=path.basename(f),label=relName(ctx,f);
    if(isPng(name)&&name.slice(0,-4)===stem)png=f;
    else if(/\.json$/i.test(name)&&name.slice(0,-5)===stem)side=f;
    else problems.push(`${label}: arquivo não esperado. Envie ${stem}.png e, opcional, ${stem}.json.`);
  }
  const base=files[0]?relName(ctx,path.join(path.dirname(files[0]),stem)):id;
  const bad=id.split('/').filter(part=>!ID_PATTERN.test(part));
  if(bad.length)problems.push(`${base}.png: nome ${list(bad.map(b=>`"${b}"`))} inválido. Use só letras minúsculas sem acento, números e hífen (ex.: cidade-nevada/neve-fofa-1).`);
  // Groups with a closed id list (rostos: class × expression) refuse any other name before reading the image.
  const idProblem=!bad.length&&spec.checkId?.(id);
  if(idProblem){problems.push(`${base}.png: ${idProblem}`);return {kind:spec.kind};}
  const sideLabel=`${base}.json`;
  const sc=withExpected(spec,id,await readSidecar(side,sideLabel,problems),sideLabel,problems);
  if(sc.meta)r.meta=sc.meta;
  const kind=sc.kind??spec.kind;
  if(!spec.kinds.includes(kind)){problems.push(`${sideLabel}: o formato ${kindName(kind)} não é aceito em ${spec.input}/. Aceitos aqui: ${list(spec.kinds.map(kindName))}.`);return {kind:spec.kind};}
  const character=spec.character??false;
  if(!png){problems.push(`${base}.png: faltando (só veio o ${stem}.json). Envie a imagem com o mesmo nome.`);return {kind};}
  const label=relName(ctx,png),img=await load(png,label,problems);
  if(!img||sc.invalid)return {kind};
  const output=`${id}.webp`,fps=checkFps(sc.fps,sideLabel,problems);

  if(kind==='seamless'){
    const mask=sc.mask??/^trans-[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
    const wrap=sc.wrap??'xy',transparent=checkBool(sc.transparent,'transparent',sideLabel,problems);
    if(!Object.hasOwn(WRAPS,wrap)){problems.push(`${sideLabel}: wrap ${json(wrap)} inválido; use "xy" (repete nos dois sentidos), "x" (só na horizontal, como uma faixa de borda) ou "y" (só na vertical).`);return {kind};}
    if(transparent===null)return {kind};
    if(mask&&transparent){problems.push(`${sideLabel}: a máscara de transição não pode ser transparente; tire "transparent" do arquivo.`);return {kind};}
    let size=expectedCell(sc,spec,sideLabel,problems);
    if(size===null)return {kind};
    if(!size){const s=sc.size??spec.size;if(s!==undefined&&!(Number.isInteger(s)&&s>0)){problems.push(`${sideLabel}: size ${json(s)} inválido; use um inteiro em px, como 512.`);return {kind};}size=s?[s,s]:undefined;}
    if(size&&(img.width!==size[0]||img.height!==size[1])){problems.push(sizeProblem(label,img,size[0],size[1],'textura contínua',`Exporte a textura em ${size[0]}×${size[1]}${sc.cell?'':` ou diga o tamanho em ${stem}.json, como {"cell":[${img.width},${img.height}]}`}.`));return {kind};}
    if(!size&&img.width!==img.height){problems.push(`${label}: tamanho ${img.width}×${img.height}; a textura contínua precisa ser quadrada (ou diga o tamanho em ${stem}.json, como {"cell":[${img.width},${img.height}],"wrap":"x"}).`);return {kind};}
    let translucent=0,colour=0;
    for(let i=0;i<img.data.length;i+=4){
      if(img.data[i+3]!==255)translucent++;
      if(mask&&Math.max(img.data[i],img.data[i+1],img.data[i+2])-Math.min(img.data[i],img.data[i+1],img.data[i+2])>GRAY_TOLERANCE)colour++;
    }
    if(translucent&&!transparent)problems.push(`${label}: ${translucent} pixels transparentes ou translúcidos; ${mask?'a máscara':'a textura'} precisa ser totalmente opaca, até a borda. Salve sem canal alfa${mask?'':` (ou, se a transparência for de propósito, ponha "transparent":true em ${stem}.json)`}.`);
    if(colour)problems.push(`${label}: ${colour} pixels coloridos; a máscara de transição precisa ser só tons de cinza (preto = primeiro material, branco = segundo). Converta para escala de cinza.`);
    seamProblems(img,label,problems,{wrap,alpha:!!transparent});
    sheets.push({key:'sheet',source:png,output,cell:[img.width,img.height],frames:1,...(mask?{mask:true}:{}),
      ...(wrap!=='xy'?{wrap}:{}),...(transparent?{transparent:true}:{})});
    return {kind};
  }
  if(kind==='icon'){
    const s=sc.size??spec.sizes?.[stem]??spec.size;
    if(!(Number.isInteger(s)&&s>0)){problems.push(`${sideLabel}: size ${json(s)} inválido; use um inteiro em px, como 128.`);return {kind};}
    if(img.width!==s||img.height!==s){problems.push(sizeProblem(label,img,s,s,'ícone quadrado',`Exporte o ícone em ${s}×${s}.`));return {kind};}
    const opaque=checkBool(sc.opaque,'opaque',sideLabel,problems)??spec.opaque?.[stem]??false;
    if(opaque===null)return {kind};
    // A full-bleed opaque icon (the app icon): only the size counts, no transparency nor margin rule. Never for a
    // circle-cropped group (rostos): its corners must stay empty.
    if(opaque&&!spec.circle){sheets.push({key:'sheet',source:png,output,cell:[s,s],frames:1});return {kind};}
    if(!checkTransparent(img,label,problems))return {kind};
    if(spec.circle)circleProblems(img,label,problems,spec.circle);
    checkGrid(problems,label,img,{cw:s,ch:s,cols:1,rows:1,colName:()=>'ícone'});
    sheets.push({key:'sheet',source:png,output,cell:[s,s],frames:1});
    return {kind};
  }
  if(kind==='nineslice'){
    const cell=expectedCell(sc,spec,sideLabel,problems);
    if(cell===null)return {kind};
    if(cell&&(img.width!==cell[0]||img.height!==cell[1])){problems.push(sizeProblem(label,img,cell[0],cell[1],'moldura em 9 partes',`Exporte a moldura em ${cell[0]}×${cell[1]} ou corrija "cell" em ${stem}.json.`));return {kind};}
    const [w,h]=[img.width,img.height];
    if(sc.slice===undefined)problems.push(`${sideLabel}: falta "slice" [esquerda,cima,direita,baixo] em px: a parte da borda que não estica, como [8,8,8,8].`);
    else if(!(Array.isArray(sc.slice)&&sc.slice.length===4&&sc.slice.every(n=>Number.isInteger(n)&&n>=0)))problems.push(`${sideLabel}: slice ${json(sc.slice)} inválido; use 4 inteiros [esquerda,cima,direita,baixo] em px.`);
    else if(sc.slice[0]+sc.slice[2]>=w||sc.slice[1]+sc.slice[3]>=h)problems.push(`${sideLabel}: slice ${json(sc.slice)} não cabe em ${w}×${h}: esquerda + direita precisa ser menor que ${w} e cima + baixo menor que ${h}, sobrando um miolo que estica.`);
    if(!img.meta.hasAlpha)problems.push(`${label}: sem transparência (canal alfa). Salve o PNG com canal alfa.`);
    else{let drawn=false;for(let i=3;i<img.data.length;i+=4)if(img.data[i]>ALPHA_THRESHOLD){drawn=true;break;}if(!drawn)problems.push(`${label}: a moldura está vazia (nenhum pixel desenhado).`);}
    sheets.push({key:'sheet',source:png,output,cell:[w,h],frames:1,...(Array.isArray(sc.slice)?{slice:sc.slice}:{})});
    return {kind};
  }
  if(kind==='frames'){
    let cell=expectedCell(sc,spec,sideLabel,problems);
    if(cell===null)return {kind};
    const hint=sc.cell?'':` Se a imagem for um quadro só ou os quadros não forem quadrados, diga o tamanho em ${stem}.json, como {"cell":[${img.width},${img.height}]}.`;
    if(!cell&&sc.frames===undefined&&img.width%img.height!==0){
      problems.push(`${label}: ${img.width}×${img.height} não se divide em quadros quadrados de ${img.height}×${img.height}. Envie ${stem}.json com o tamanho de um quadro, como {"cell":[largura,altura]}.`);return {kind};
    }
    if(!cell)notes.push(`${label}: assumi quadros quadrados de ${img.height}×${img.height}; se não forem, envie ${stem}.json com "cell".`);
    cell??=[img.height,img.height];
    const frames=sc.frames??img.width/cell[0];
    if(sc.frames!==undefined&&!(Number.isInteger(sc.frames)&&sc.frames>0)){problems.push(`${sideLabel}: frames ${json(sc.frames)} inválido; use um inteiro maior que 0.`);return {kind};}
    if(img.height!==cell[1]||img.width!==frames*cell[0]||!Number.isInteger(frames)){
      problems.push(sizeProblem(label,img,Number.isInteger(frames)?frames*cell[0]:`${cell[0]}×N`,cell[1],`${Number.isInteger(frames)?frames:'N'} quadros de ${cell[0]}×${cell[1]} px numa linha`,`Exporte os quadros lado a lado, todos do mesmo tamanho.${hint}`));return {kind};
    }
    if(sc.framesRange&&!(frames>=sc.framesRange[0]&&frames<=sc.framesRange[1]))
      problems.push(`${label}: ${frames} ${frames===1?'quadro':'quadros'} de ${cell[0]}×${cell[1]} px, esperado de ${sc.framesRange[0]} a ${sc.framesRange[1]} (inventário de sprites). Exporte entre ${sc.framesRange[0]} e ${sc.framesRange[1]} quadros${side?'':`, ou diga quantos são em ${stem}.json, como {"frames":${frames}}`}.`);
    if(!checkTransparent(img,label,problems))return {kind};
    const anchor=checkAnchor(sc.anchor,sideLabel,problems);
    checkGrid(problems,label,img,{cw:cell[0],ch:cell[1],cols:frames,rows:1,hint,character,padding:!spec.fullBleed?.[stem]});
    sheets.push({key:'sheet',source:png,output,cell,frames,...(anchor?{anchor}:{}),...(fps!==undefined?{fps}:{})});
    return {kind};
  }
  if(kind==='views'){
    const views=sc.views??spec.views??1;
    if(!(views===1||views===VIEW_NAMES.length)){problems.push(`${sideLabel}: views ${json(views)} inválido; use 4 (câmera 0°, 90°, 180°, 270°) ou 1 (objeto simétrico visto de cima).`);return {kind};}
    // The cell (and anchor) come from the sidecar, or from the expected table when it gives them.
    const declared=!!side||sc.cell!==undefined;
    const rowsHint=Array.isArray(sc.rows)?json(sc.rows):'["inteira"]';
    if(!declared)problems.push(`${base}.json: faltando. Peças com vistas precisam dizer a célula e a âncora, como {"cell":[256,256],"anchor":[0.5,0.88],"views":${views},"rows":${rowsHint}}.`);
    let cell=expectedCell(sc,spec,sideLabel,problems);
    if(cell===null)return {kind};
    if(declared&&!cell)problems.push(`${sideLabel}: falta "cell" [largura,altura] de uma vista, em px.`);
    const anchor=declared?checkAnchor(sc.anchor,sideLabel,problems,{required:!!side||views>1}):undefined;
    let rows=sc.rows;
    if(rows!==undefined&&!(Array.isArray(rows)&&rows.length&&rows.every(r=>typeof r==='string'&&r))){problems.push(`${sideLabel}: rows ${json(rows)} inválido; use a lista de nomes das linhas (estados ou quadros), como ["inteira","avariada","quebrada"].`);rows=undefined;}
    if(!cell)return {kind};
    const n=rows?.length??img.height/cell[1];
    if(img.width!==views*cell[0]||img.height!==n*cell[1]||!Number.isInteger(n)){
      const layout=`${views} ${views>1?'vistas':'vista'} × ${Number.isInteger(n)?n:'N'} ${n===1?'linha':'linhas'} de ${cell[0]}×${cell[1]} px`;
      problems.push(sizeProblem(label,img,views*cell[0],Number.isInteger(n)?n*cell[1]:`${cell[1]}×N`,layout,`Uma coluna por vista${views>1?` (${VIEW_NAMES.join(', ')})`:''} e uma linha por estado${rows?` (${list(rows)})`:''}.`));return {kind};
    }
    if(!checkTransparent(img,label,problems))return {kind};
    const rowName=r=>n>1||rows?`${rows?`"${rows[r]}"`:'linha'} (linha ${r+1})`:'';
    const colName=c=>views>1?`vista ${VIEW_NAMES[c]} (coluna ${c+1})`:`coluna ${c+1}`;
    // Top-down 1-view pieces (decals, rings) do not stand on a foot point. The rules use the PIECE's anchor (sidecar:
    // a building stands on its base corner), with the AIRBORNE/LUNGE rows of spec.mjs.
    checkGrid(problems,label,img,{cw:cell[0],ch:cell[1],cols:views,rows:n,rowName,colName,anchor:views>1?anchor:undefined,
      footY:r=>!AIRBORNE_ANIMS.has(rows?.[r]),footX:r=>!AIRBORNE_ANIMS.has(rows?.[r])&&!LUNGE_ANIMS.has(rows?.[r]),character,anchorFile:sideLabel});
    sheets.push({key:'sheet',source:png,output,cell,views,rows:rows??Array.from({length:n},(_,r)=>String(r+1)),...(anchor?{anchor}:{}),...(fps!==undefined?{fps}:{})});
    return {kind};
  }
  problems.push(`${sideLabel}: formato ${kindName(kind)} desconhecido. Use um de: ${list(spec.kinds.map(kindName))}.`);
  return {kind};
}

/** Output size of a sheet once packed (dir8 blocks are split by the converter into 1152×2304 atlases). */
const packedSize=s=>s.blocks?undefined:[s.cell[0]*(s.frames??s.views??1),s.cell[1]*(s.directions??s.rows?.length??1)];

/**
 * Validates one piece of a group. `files`: absolute paths of every input file of the piece (PNG and sidecar; for
 * enemies also `<group>/elite/<id>-<anim>.png`). `ctx`: {input (delivery root), repoRoot, classes?:string[] (dir8),
 * spec?: group override, manifest?: the group's current manifest (pieces approved in earlier runs)}.
 * Returns {problems, notes, sheets, kind}: `problems` (pt-BR) block the piece; `notes` (pt-BR) are informational
 * (absent optional parts, assumed cell size, sheets the converter paginates); `sheets` to convert when there are no
 * problems: {key, source, output (relative to the group output dir), cell, frames?, views?, rows?, directions?,
 * anchor?, fps?, slice?, mask?, wrap?, transparent?, blocks? (dir8: DIRECTIONS blocks to stack)}; `meta`: the piece's
 * render metadata (spec.mjs `expected` table merged with the sidecar's `meta`), when there is any.
 * @returns {Promise<{problems:string[],notes:string[],sheets:object[],kind:string,meta?:object}>}
 */
export async function validatePiece(group,id,files,ctx){
  const spec=ctx.spec??GROUPS[group];
  if(!spec)throw new Error(`grupo desconhecido: ${group}`);
  const r={problems:[],notes:[],sheets:[]};
  let kind=spec.kind;
  if(spec.kind==='animations')await validateAnimations(spec,id,files,ctx,r);
  else if(spec.kind==='dir8')await validateDir8(spec,id,files,ctx,r);
  else if(spec.kind==='tower')await validateTower(spec,id,files,ctx,r);
  else if(spec.kind==='decor')await validateDecor(spec,id,files,ctx,r);
  else kind=(await validateOneFile(spec,id,files,ctx,r)).kind??kind;
  const {problems,notes,sheets}=r;
  if(!problems.length&&!sheets.length)problems.push(`${spec.input}/${id}: nenhum arquivo de imagem da peça.`);
  if(!problems.length)for(const s of sheets){
    const size=packedSize(s);
    if(size&&(size[0]>MAX_TEXTURE||size[1]>MAX_TEXTURE))
      notes.push(`${s.label??relName(ctx,s.source)}: a folha é grande (${size[0]}×${size[1]}); o importador divide em páginas de até ${MAX_TEXTURE} px.`);
  }
  return {problems,notes,sheets:problems.length?[]:sheets,kind,...(r.meta?{meta:r.meta}:{})};
}
