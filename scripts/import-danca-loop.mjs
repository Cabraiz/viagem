#!/usr/bin/env node
/**
 * Card dancas-5-herois-16q (28/10): "sendo 16 frames que precisam estar em looping", then "16 frames está poucos": the
 * aposentado, the CLT, the viciado, the maromba and the vendedor dance a loop of 16 to 64 poses facing the camera, drawn
 * by Codex (16 poses, then in-betweens where the pose changes most) and assembled on their own rest (viagem-board
 * evidence/…/remontar/montar-work.mjs): a sheet of 192 px cells, each pose on the rest S cell at 2× (feet on the 0.875
 * anchor, at the rest's feet x). Here it is halved to the game's 96 px cells as drawn, nothing moved, so it keeps the
 * rest's scale: `height` and `pivotX` are the rest S clip's (idle16-S, else idle8), and the dancer draws the size of its
 * idle, at DANCE_LOOP.fps. The `dance-loop` file replaces the class's `dance128` (removed, file and lite copy); the other
 * classes and the bots keep theirs. The game loads the lossy copy (node scripts/art-lite.mjs --kinds sprites).
 *
 *   node scripts/import-danca-loop.mjs --input <dir>            validate and report (no writes)
 *   node scripts/import-danca-loop.mjs --input <dir> --write    write the sheets, the personagens manifest and the index
 *   node scripts/import-danca-loop.mjs --input <dir> --ids a,b  only these heroes
 *
 * <dir>/<id>.png: RGBA, poses of 192 px row by row, 4 columns unless <dir>/<id>.json says {"columns":n,"frames":n}
 * (default: every cell); the last pose runs into pose 0.
 */
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {GROUPS} from './art-v2/spec.mjs';
import {readManifest,writeManifest,writeIndex,writeAtomic,WEBP} from './art-v2/convert.mjs';
import {boxOf} from './import-danca-jogo.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const SPEC=GROUPS.personagens;
/**
 * The sheet the game reads (src/client/sprites/movement128.ts dancePlan): the delivery's grid at 96 px, 16 to 64 poses
 * (DANCE_LOOP_FRAMES), played at `fps` (the user: slower but fluid, so twice the poses, ~48, at 10 a second, a loop of ~5 s; 5 a second read as stills).
 */
export const DANCE_LOOP=Object.freeze({min:16,max:64,fps:10,cell:96,source:192,anchor:[.5,.875]});
/** The five heroes of the card (the Gatito keeps its dance128: the reference). */
export const DANCE_LOOP_IDS=Object.freeze(['aposentado','clt-cansado','viciado-em-bet','maromba','vendedor-praia']);
/** Kept clear around every pose in the 96 px cell (the game samples with no padding: sheet-cells.mjs's ring). */
const MARGIN=2;
const SHA=b=>createHash('sha256').update(b).digest('hex');
const cellOf=(raw,width,columns,k,size)=>{
  const out=Buffer.alloc(size*size*4),ox=k%columns*size,oy=Math.floor(k/columns)*size;
  for(let y=0;y<size;y++)raw.copy(out,y*size*4,((oy+y)*width+ox)*4,((oy+y)*width+ox+size)*4);
  return out;
};
/** The rest S clip the dance was assembled on: its height and body column are the dance's. */
export function restOf(files,id){
  const rest=files?.['idle16-S']??files?.idle8;
  assert.ok(rest&&Number.isFinite(rest.height),`${id}: a rest S clip (idle16-S or idle8) is the dance's size reference`);
  return {height:rest.height,pivotX:Number.isFinite(rest.pivotX)?rest.pivotX:DANCE_LOOP.cell*DANCE_LOOP.anchor[0],clip:files['idle16-S']?'idle16-S':'idle8'};
}

/** The 96 px sheet of one delivery (`grid`: its columns and poses), checked: distinct poses, none empty, none on the cell's edge. */
export async function danceLoopSheet(png,id,grid={}){
  const {cell,source,min,max}=DANCE_LOOP;
  const meta=await sharp(png).metadata(),columns=grid.columns??4,rows=Math.round(meta.height/source),frames=grid.frames??columns*rows;
  assert.equal(meta.width,columns*source,`${id}: ${columns*source} px wide (${columns} poses of ${source})`);
  assert.equal(meta.height,rows*source,`${id}: whole rows of ${source} px`);
  assert.ok(Number.isInteger(frames)&&frames>=min&&frames<=max&&rows===Math.ceil(frames/columns),`${id}: ${min} to ${max} poses filling ${columns}-pose rows (${frames})`);
  const {data:raw}=await sharp(png).ensureAlpha().resize(columns*cell,rows*cell,{kernel:'lanczos3'}).raw().toBuffer({resolveWithObject:true});
  const width=columns*cell,hashes=new Set();let figure;
  for(let k=0;k<frames;k++){
    const c=cellOf(raw,width,columns,k,cell),b=boxOf(c,cell,cell);
    assert.ok(b,`${id}: pose ${k} is empty`);
    assert.ok(b.left>=MARGIN&&b.top>=MARGIN&&b.right<=cell-MARGIN&&b.bottom<=cell-MARGIN,`${id}: pose ${k} touches the cell's edge ${JSON.stringify(b)}`);
    hashes.add(SHA(c));
    figure=figure?{left:Math.min(figure.left,b.left),top:Math.min(figure.top,b.top),right:Math.max(figure.right,b.right),bottom:Math.max(figure.bottom,b.bottom)}:b;
  }
  assert.equal(hashes.size,frames,`${id}: ${frames} distinct poses (a repeated pose is a held frame, not a loop)`);
  for(let k=frames;k<columns*rows;k++)assert.ok(!boxOf(cellOf(raw,width,columns,k,cell),cell,cell),`${id}: cell ${k} past the last pose is not empty`);
  return {raw,width,height:rows*cell,columns,rows,frames,figure};
}

export async function importDanceLoop({input,outRoot=ROOT,ids=DANCE_LOOP_IDS,write=false}){
  assert.ok(input,'--input <dir> with <id>.png');
  const manifestFile=path.join(outRoot,SPEC.output,'manifest.json'),previous=await readManifest(manifestFile);
  assert.ok(previous,'personagens manifest required');
  const report=[],entries={},stale=[];
  for(const id of ids){
    const piece=previous.pieces[id];assert.ok(piece,`${id}: personagens piece required`);
    const gridFile=path.join(input,`${id}.json`),grid=existsSync(gridFile)?JSON.parse(await readFile(gridFile,'utf8')):{};
    const rest=restOf(piece.files,id),sheet=await danceLoopSheet(await readFile(path.join(input,`${id}.png`)),id,grid);
    const encoded=await sharp(sheet.raw,{raw:{width:sheet.width,height:sheet.height,channels:4}}).webp(WEBP).toBuffer();
    const sha=SHA(encoded),file=`${id}.dance.${sha.slice(0,12)}.webp`;
    const durationMs=Math.round(sheet.frames/DANCE_LOOP.fps*1000);
    report.push({id,frames:sheet.frames,durationMs,height:rest.height,pivotX:rest.pivotX,rest:rest.clip,figure:sheet.figure,file,bytes:encoded.length});
    console.log(`${id}: ${sheet.frames} poses ${durationMs} ms height ${rest.height} pivotX ${rest.pivotX} (${rest.clip}) figure ${JSON.stringify(sheet.figure)} ${(encoded.length/1024).toFixed(0)} KB`);
    if(!write)continue;
    await writeAtomic(path.join(outRoot,SPEC.output,file),encoded);
    const {columns,rows,frames}=sheet,{cell,anchor}=DANCE_LOOP;
    entries[id]={kind:piece.kind,files:{
      'dance-loop':{file,revision:16,cell:[cell,cell],frames,durationMs,loop:true,anchor:[...anchor],height:rest.height,pivotX:rest.pivotX,figure:sheet.figure,
        source:{input:'codex',file:`${id}.png`,rest:rest.clip},pages:[{file,columns,rows,firstFrame:0,frameCount:frames,sha256:sha}],sha256:sha},
      // The 128-pose dance goes: this class dances its loop (mergeEntry drops a null file).
      dance128:null},...(piece.meta?{meta:piece.meta}:{})};
    const old=piece.files['dance-loop']?.file;
    for(const f of [piece.files.dance128?.file,old!==file?old:undefined])if(f)stale.push(f);
  }
  if(write){
    assert.deepEqual(await readManifest(manifestFile),previous,'personagens manifest changed during the dance import');
    await writeManifest('personagens',SPEC,entries,{outRoot});await writeIndex({personagens:SPEC},{outRoot});
    for(const f of stale)for(const dir of [SPEC.output,'public/art/lite/sprites'])await rm(path.join(outRoot,dir,f),{force:true});
  }
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  sharp.cache(false);sharp.concurrency(1);
  const args=process.argv.slice(2),i=args.indexOf('--ids'),j=args.indexOf('--input');
  const report=await importDanceLoop({write:args.includes('--write'),input:j>=0?path.resolve(args[j+1]):undefined,...(i>=0?{ids:args[i+1].split(',')}:{})});
  console.log(`${report.length} dances ${args.includes('--write')?'imported':'validated'}`);
}
