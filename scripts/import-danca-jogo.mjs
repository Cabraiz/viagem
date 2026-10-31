#!/usr/bin/env node
/**
 * Card danca-no-jogo (23/10): the user's frontal dances (menu group, 128 cells of 768×512, public/art/menu/danca/; since
 * menu-sem-danca (29/10) out of the index, in legado/menu-danca/menu/danca/ with its own manifest) become
 * an in-match clip of each hero: one 16×8 sheet of 96 px cells like the R06 walk (movement128.ts), the `dance128` file of
 * its `personagens` piece. Nothing is redrawn or interpolated: every pose is the menu's, cut by one window per hero and
 * scaled once, so the dance keeps its own sway and bounce.
 *
 * Per hero, over the 128 poses (alpha > 20): the standing height is the median pose height, the ground line the median
 * lowest row, the body's column the median centre. The window puts that column at the cell's centre and that ground on
 * the clip anchor (0.875 of the cell, the R06 one), scaled so the median pose stands TARGET px tall, smaller when a
 * pose would leave the cell. The manifest's `height` is that median: the client draws it 96 world px tall like any rest
 * pose (96/height), so the dancer is the size of its idle. The game loads the lossy copy (node scripts/art-lite.mjs
 * --kinds sprites), on demand: nothing preloads a dance.
 *
 *   node scripts/import-danca-jogo.mjs                validate and report (no writes)
 *   node scripts/import-danca-jogo.mjs --write        write the sheets, the personagens manifest and the index
 *   node scripts/import-danca-jogo.mjs --ids a,b      only these heroes
 *   node scripts/import-danca-jogo.mjs --input <dir> --ids gato-nada-pra-comer,maromba [--write]
 *
 * --input (stage 3: the gato and the new maromba, drawn by Codex): `<dir>/<id>.png` (128 cells of 768×512, `columns`×`rows`)
 * and `<id>.meta.json` in the menu dance's shape, plus `restFrames`: the standing poses. Their median height is the
 * `height` (a dance with the arms over the head would otherwise draw the body smaller than the idle), times
 * `heightPerFigure` when given: the idle's manifest height over its figure's, so the standing pose draws as tall as the idle.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {GROUPS} from './art-v2/spec.mjs';
import {readIndex,readManifest,writeManifest,writeIndex,writeAtomic,WEBP} from './art-v2/convert.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const SPEC=GROUPS.personagens;
export const CELL=96,COLUMNS=16,ROWS=8,FRAMES=128,ANCHOR=[.5,.875];
/** The median pose's height in the cell (R06 rests stand 42–62; the dance gets a few more pixels, it is seen close). */
export const TARGET=64;
const SRC=[768,512],ALPHA=20,MARGIN=1;
/** Heroes whose menu dance is not of the in-game drawing (the old maromba): stage 3 of the card draws theirs. */
export const SKIP=new Set(['maromba']);
const SHA=b=>createHash('sha256').update(b).digest('hex');
/** Where the menu dances went when menu-sem-danca took the menu group out of public/art (29/10). */
export const LEGADO_MENU='legado/menu-danca/menu/danca';
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

/** The 128 poses of a menu dance as raw RGBA cells, in order. */
async function poses(file,menuDir){
  const cells=[];
  for(const page of file.pages){
    const {data,info}=await sharp(path.join(menuDir,page.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,page.columns*SRC[0]);assert.equal(info.height,page.rows*SRC[1]);
    for(let k=0;k<page.frameCount;k++){
      const cx=k%page.columns*SRC[0],cy=Math.floor(k/page.columns)*SRC[1],cell=Buffer.alloc(SRC[0]*SRC[1]*4);
      for(let y=0;y<SRC[1];y++)data.copy(cell,y*SRC[0]*4,((cy+y)*info.width+cx)*4,((cy+y)*info.width+cx+SRC[0])*4);
      cells.push(cell);
    }
  }
  return cells;
}
export function boxOf(rgba,w,h){
  let l=w,t=h,r=-1,b=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(rgba[(y*w+x)*4+3]>ALPHA){if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>b)b=y;}
  return r<0?undefined:{left:l,top:t,right:r+1,bottom:b+1};
}
/**
 * The source window (integer px, `size` square) mapped onto the 96 px cell: the body column at its centre, the ground
 * at the anchor, the median pose TARGET tall unless a pose would cross the cell's edge (MARGIN px kept).
 */
export function windowOf(boxes,rest=boxes){
  const height=median(rest.map(b=>b.bottom-b.top)),ground=median(boxes.map(b=>b.bottom)),column=median(boxes.map(b=>(b.left+b.right)/2));
  const ax=CELL*ANCHOR[0],ay=CELL*ANCHOR[1];
  let s=TARGET/height;
  for(const b of boxes){
    const up=ground-b.top,down=b.bottom-ground,side=Math.max(column-b.left,b.right-column);
    if(up>0)s=Math.min(s,(ay-MARGIN)/up);
    if(down>0)s=Math.min(s,(CELL-ay-MARGIN)/down);
    if(side>0)s=Math.min(s,(ax-MARGIN)/side);
  }
  const size=Math.ceil(CELL/s);
  return {size,left:Math.round(column-ax*size/CELL),top:Math.round(ground-ay*size/CELL),height};
}
async function cellOf(rgba,win){
  const {size,left,top}=win,out=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++){
    const sy=top+y;if(sy<0||sy>=SRC[1])continue;
    const x0=Math.max(0,left),x1=Math.min(SRC[0],left+size);if(x1<=x0)continue;
    rgba.copy(out,(y*size+(x0-left))*4,(sy*SRC[0]+x0)*4,(sy*SRC[0]+x1)*4);
  }
  return sharp(out,{raw:{width:size,height:size,channels:4}}).resize(CELL,CELL,{kernel:'lanczos3'}).raw().toBuffer();
}

/** The menu dances: the index's menu group while it has one, else the legado copy's manifest. */
async function menuGroup(outRoot,index){
  if(index?.groups?.menu)return {dir:path.join(outRoot,index.groups.menu.output),pieces:index.groups.menu.pieces};
  const dir=path.join(outRoot,LEGADO_MENU);
  const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
  return {dir,pieces:manifest.pieces};
}

/** A Codex dance of --input: its sheet as the one page of a menu-shaped dance, and its standing poses. */
async function inputDance(dir,id){
  const meta=JSON.parse(await readFile(path.join(dir,`${id}.meta.json`),'utf8'));
  assert.ok(meta.columns*meta.rows>=meta.frames&&meta.restFrames?.length,`${id}: input meta with columns, rows and restFrames`);
  return {...meta,pages:[{file:`${id}.png`,columns:meta.columns,rows:meta.rows,firstFrame:0,frameCount:meta.frames}]};
}

export async function importDance({outRoot=ROOT,ids,write=false,input}={}){
  const index=await readIndex(path.join(outRoot,'public/art/manifest.json')),manifestFile=path.join(outRoot,SPEC.output,'manifest.json');
  const previous=await readManifest(manifestFile);
  assert.ok(previous,'personagens group required');
  const menu=await menuGroup(outRoot,index),menuDir=menu.dir;
  const all=Object.keys(menu.pieces).filter(id=>previous.pieces[id]&&!SKIP.has(id));
  assert.ok(!input||ids,'--input needs --ids');
  const chosen=ids??all;
  const report=[],entries={};
  for(const id of chosen){
    const dance=input?await inputDance(input,id):menu.pieces[id]?.files?.dance;
    assert.ok(dance&&dance.frames===FRAMES&&dance.cell[0]===SRC[0]&&dance.cell[1]===SRC[1],`${id}: 128-pose menu dance required`);
    assert.ok(previous.pieces[id],`${id}: personagens piece required`);
    const cells=await poses(dance,input??menuDir),boxes=cells.map(c=>boxOf(c,SRC[0],SRC[1]));
    assert.ok(boxes.every(Boolean),`${id}: empty pose`);
    const win=windowOf(boxes,dance.restFrames?.map(k=>boxes[k])??boxes),sheet=Buffer.alloc(COLUMNS*CELL*ROWS*CELL*4);
    for(let k=0;k<FRAMES;k++){
      const cell=await cellOf(cells[k],win),ox=k%COLUMNS*CELL,oy=Math.floor(k/COLUMNS)*CELL;
      for(let y=0;y<CELL;y++)cell.copy(sheet,((oy+y)*COLUMNS*CELL+ox)*4,y*CELL*4,(y+1)*CELL*4);
    }
    // The figure over every pose, in the cell (the city outline crops its copies to it).
    let figure;
    for(let k=0;k<FRAMES;k++){
      const ox=k%COLUMNS*CELL,oy=Math.floor(k/COLUMNS)*CELL,c=Buffer.alloc(CELL*CELL*4);
      for(let y=0;y<CELL;y++)sheet.copy(c,y*CELL*4,((oy+y)*COLUMNS*CELL+ox)*4,((oy+y)*COLUMNS*CELL+ox+CELL)*4);
      const b=boxOf(c,CELL,CELL);assert.ok(b,`${id}: pose ${k} vanished in the cell`);
      figure=figure?{left:Math.min(figure.left,b.left),top:Math.min(figure.top,b.top),right:Math.max(figure.right,b.right),bottom:Math.max(figure.bottom,b.bottom)}:b;
    }
    // An --input dance may carry its idle's `height` over the idle figure's (the Chad maromba's head stands over its 56).
    const height=+(win.height*CELL/win.size*(dance.heightPerFigure??1)).toFixed(2);
    const encoded=await sharp(sheet,{raw:{width:COLUMNS*CELL,height:ROWS*CELL,channels:4}}).webp(WEBP).toBuffer();
    const sha=SHA(encoded),file=`${id}.dance128.${sha.slice(0,12)}.webp`;
    report.push({id,height,window:win,figure,file,bytes:encoded.length});
    if(write){
      await writeAtomic(path.join(outRoot,SPEC.output,file),encoded);
      const durationMs=Math.round(FRAMES/dance.fps*1000);
      entries[id]={kind:previous.pieces[id].kind,files:{dance128:{file,cell:[CELL,CELL],frames:FRAMES,fps:dance.fps,durationMs,loop:true,anchor:[...ANCHOR],
        height,figure,source:input?{input:'codex',pages:dance.pages.map(p=>p.file),...(dance.source?{drawn:dance.source}:{})}:{group:'menu',pages:dance.pages.map(p=>p.file)},
        pages:[{file,columns:COLUMNS,rows:ROWS,firstFrame:0,frameCount:FRAMES,sha256:sha}],sha256:sha}},
        ...(previous.pieces[id].meta?{meta:previous.pieces[id].meta}:{})};
    }
    console.log(`${id}: height ${height} window ${win.size}px figure ${JSON.stringify(figure)} ${(encoded.length/1024).toFixed(0)} KB`);
  }
  if(write){
    assert.deepEqual(await readManifest(manifestFile),previous,'personagens manifest changed during the dance import');
    await writeManifest('personagens',SPEC,entries,{outRoot});await writeIndex({personagens:SPEC},{outRoot});
  }
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  sharp.cache(false);sharp.concurrency(1);
  const args=process.argv.slice(2),i=args.indexOf('--ids'),j=args.indexOf('--input');
  const report=await importDance({write:args.includes('--write'),...(i>=0?{ids:args[i+1].split(',')}:{}),...(j>=0?{input:path.resolve(args[j+1])}:{})});
  console.log(`${report.length} dances ${args.includes('--write')?'imported':'validated'}`);
}
