import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {importArtV2,parseArgs} from '../../scripts/import-art-v2.mjs';
import {GROUPS} from '../../scripts/art-v2/spec.mjs';
// menu-sem-danca: the menu player (menu-dance.ts) is gone; the importer stays, so the cell of a frame is read from its pages.
function danceCell(entry:any,frame:number){
  const pageIndex=entry.pages.findIndex((p:any)=>frame>=p.firstFrame&&frame<p.firstFrame+p.frameCount);if(pageIndex<0) return undefined;
  const page=entry.pages[pageIndex],i=frame-page.firstFrame;
  return {pageIndex,x:i%page.columns*entry.cell[0],y:Math.floor(i/page.columns)*entry.cell[1]};
}

sharp.cache(false);sharp.concurrency(1);
const modern={cell:[768,512],columns:8,rows:16,frames:128,anchor:[.5,.9],fps:128/36,loop:true};
const legacy={cell:[768,512],anchor:[.5,.9],fps:10};
const fpsFor=(frames:number)=>frames===128?128/36:frames===64?64/12:10;
test('CLI can limit the final import to characters and menu without reimporting other art groups',()=>{
  assert.deepEqual(parseArgs(['--groups','personagens,menu,personagens','--dry-run']),{dryRun:true,groups:['personagens','menu']});
  assert.throws(()=>parseArgs(['--groups','missing']),/inválido/);
  assert.throws(()=>parseArgs(['--groups']),/precisa/);
});
const rgb=(frame:number)=>[frame*7%256,frame*13%256,frame*19%256];
async function source(input:string,frames=128){
  const dir=path.join(input,'menu/danca');mkdirSync(dir,{recursive:true});
  const columns=frames===16?16:8,rows=frames/columns;
  const rects=Array.from({length:columns*rows},(_,frame)=>`<rect x="${frame%columns*768+30}" y="${Math.floor(frame/columns)*512+30}" width="100" height="100" fill="rgb(${rgb(frame).join(',')})"/>`).join('');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*768}" height="${rows*512}">${rects}</svg>`)).png().toFile(path.join(dir,'aposentado.png'));
  writeFileSync(path.join(dir,'aposentado.meta.json'),JSON.stringify(frames===16?legacy:{...modern,frames,rows,fps:fpsFor(frames)}));
}
async function temporary(fn:(dir:string)=>Promise<void>){
  const dir=mkdtempSync(path.join(tmpdir(),'viagem-menu-dance-'));
  try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
}
for(const frames of [128,64,32,16])test(`dance import ${frames===128?'grid128':`legacy${frames}`} reflows below4096 and preserves every frame through its pages`,async()=>temporary(async dir=>{
  const input=path.join(dir,'input'),outRoot=path.join(dir,'out');await source(input,frames);
  const result=await importArtV2({input,outRoot,groups:{menu:GROUPS.menu},write:true});
  const record=result.pieces.find((p:any)=>p.id==='aposentado');
  assert.equal(record.status,'aprovado',record.problems.join('; '));
  const index=JSON.parse(readFileSync(path.join(outRoot,'public/art/manifest.json'),'utf8'));
  const entry=index.groups.menu.pieces.aposentado.files.dance;
  assert.equal(entry.frames,frames);assert.equal(entry.fps,fpsFor(frames));assert.equal(entry.loop,true);
  assert.equal(entry.pages.reduce((n:number,p:any)=>n+p.frameCount,0),frames);
  if(frames>=64){
    const pages=frames===128?[[5,8,0,40],[5,8,40,40],[5,8,80,40],[5,2,120,8]]:[[5,8,0,40],[5,5,40,24]];
    assert.deepEqual(entry.pages.map((p:any)=>[p.columns,p.rows,p.firstFrame,p.frameCount]),pages);
    assert.deepEqual(danceCell(entry,39),{pageIndex:0,x:3072,y:3584});
    assert.deepEqual(danceCell(entry,40),{pageIndex:1,x:0,y:0});
    if(frames===128){
      assert.deepEqual(danceCell(entry,80),{pageIndex:2,x:0,y:0});
      assert.deepEqual(danceCell(entry,120),{pageIndex:3,x:0,y:0});
      assert.deepEqual(danceCell(entry,127),{pageIndex:3,x:1536,y:512});
    }else assert.deepEqual(danceCell(entry,63),{pageIndex:1,x:2304,y:2048});
  }
  for(const page of entry.pages){
    const file=path.join(outRoot,GROUPS.menu.output,page.file),meta=await sharp(file).metadata();
    assert.ok(meta.width!<=4096&&meta.height!<=4096);assert.equal(meta.hasAlpha,true);
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=page.firstFrame;frame<page.firstFrame+page.frameCount;frame++){
      const cell=danceCell(entry,frame)!,offset=((cell.y+40)*info.width+cell.x+40)*info.channels;
      assert.deepEqual([...data.subarray(offset,offset+3)],rgb(frame),`frame${frame}`);
    }
  }
}));

test('a selected menu import preserves unrelated index groups even when their disk manifest differs',async()=>temporary(async dir=>{
  const input=path.join(dir,'input'),outRoot=path.join(dir,'out');await source(input,32);
  const preserved={output:GROUPS.chao.output,pieces:{sentinel:{kind:'seamless',files:{sheet:{file:'unchanged.webp',cell:[32,32]}}}}};
  const groundDir=path.join(outRoot,GROUPS.chao.output);mkdirSync(groundDir,{recursive:true});
  writeFileSync(path.join(outRoot,'public/art/manifest.json'),JSON.stringify({version:2,groups:{chao:preserved}}));
  writeFileSync(path.join(groundDir,'manifest.json'),JSON.stringify({version:2,pieces:{other:{kind:'icon',files:{}}}}));
  const rosterPath=path.join(outRoot,'src/rules/enemy-art-ids.ts');mkdirSync(path.dirname(rosterPath),{recursive:true});writeFileSync(rosterPath,'unchanged roster');
  const result=await importArtV2({input,outRoot,groups:['menu'],write:true});
  const index=JSON.parse(readFileSync(path.join(outRoot,'public/art/manifest.json'),'utf8'));
  assert.deepEqual(index.groups.chao,preserved);
  assert.ok(index.groups.menu.pieces.aposentado);
  assert.equal(result.written.some((f:string)=>f.includes('enemy-art-ids')),false);
  assert.equal(readFileSync(rosterPath,'utf8'),'unchanged roster');
}));
test('invalid dance metadata cannot replace a previously imported animation',async()=>temporary(async dir=>{
  const input=path.join(dir,'input'),outRoot=path.join(dir,'out');await source(input,32);
  await importArtV2({input,outRoot,groups:{menu:GROUPS.menu},write:true});
  const manifestPath=path.join(outRoot,GROUPS.menu.output,'manifest.json');
  const before=JSON.parse(readFileSync(manifestPath,'utf8')).pieces.aposentado;
  await source(input,128);
  for(const [patch,error] of [[{frames:127,fps:0},/frames deve ser 128/],[{fps:64/12},/fps:3\.5555555555555554/]] as const){
    writeFileSync(path.join(input,'menu/danca/aposentado.meta.json'),JSON.stringify({...modern,...patch}));
    const result=await importArtV2({input,outRoot,groups:{menu:GROUPS.menu},write:true});
    const record=result.pieces.find((p:any)=>p.id==='aposentado');
    assert.equal(record.status,'reprovado');assert.match(record.problems.join('; '),error);
    assert.deepEqual(JSON.parse(readFileSync(manifestPath,'utf8')).pieces.aposentado,before);
  }
  assert.ok(existsSync(path.join(outRoot,GROUPS.menu.output,before.files.dance.pages[0].file)));
}));
