import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,mkdir,readFile,writeFile,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MOVEMENT16_META,importMovement16,parseMovement16Args,movement16Source} from '../../scripts/import-movimento16.mjs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movementPlan,movementSheets,hasMovement16,hasRun16,movement16Source as drawnSource} from '../../src/client/sprites/movement128.ts';
import {HERO_GAIT} from '../../src/client/sprites/sprite-motion.ts';

sharp.cache(false);sharp.concurrency(1);
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const write=async(file:string,value:unknown)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));};
/** A body (torso at x0+30 of 192, feet at 168) sliding `slide` px per pose, colour per pose so every pose is distinct. */
async function sheet(columns:number,rows:number,{x0=50,slide=3,distinct=true}={}){
  const rects=Array.from({length:columns*rows},(_,i)=>{const c=distinct?i:0,x=i%columns*192+x0+(i%4)*slide,y=Math.floor(i/columns)*192;
    return `<rect x="${x}" y="${y+60}" width="60" height="108" fill="rgb(${c*13%256},${c*29%256},${80+c*7%170})"/>`;}).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*192}" height="${rows*192}">${rects}</svg>`)).png().toBuffer();
}
/** The class's sheets in `input`: walk, attack and idle in the 5 default directions, and the optional run with `run`. */
async function fixture(fn:(p:{input:string;outRoot:string;manifestFile:string;indexFile:string;old:any})=>Promise<void>,{run=false}={}){
  const work=await mkdtemp(path.join(tmpdir(),'viagem-movement16-')),input=path.join(work,'input'),outRoot=path.join(work,'out');
  try{
    const file=`aposentado.walk128-s.000000000000.webp`,bytes=Buffer.from('r06 walk');
    await mkdir(path.join(outRoot,'public/art/sprites'),{recursive:true});await writeFile(path.join(outRoot,'public/art/sprites',file),bytes);
    const old={kind:'dir8',files:{'walk128-S':{file,cell:[96,96],frames:128,sha256:hash(bytes)}},meta:{sentinel:'keep'}};
    const manifestFile=path.join(outRoot,'public/art/sprites/manifest.json'),indexFile=path.join(outRoot,'public/art/manifest.json');
    await write(manifestFile,{version:2,group:'personagens',pieces:{aposentado:old}});
    await write(indexFile,{version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:old}}}});
    for(const [motion,m] of Object.entries(MOVEMENT16_META.motions)){
      if(motion==='run'&&!run)continue;
      const bytes=await sheet(m.columns,m.rows,{distinct:motion!=='idle'});
      for(const d of MOVEMENT16_META.directions){const target=movement16Source(input,'aposentado',motion,d);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
    }
    await fn({input,outRoot,manifestFile,indexFile,old});
  }finally{
    setArtIndex(parseArtIndex(undefined));const absolute=path.resolve(work);
    assert.ok(path.basename(absolute).startsWith('viagem-movement16-'));await rm(absolute,{recursive:true,force:true});
  }
}

test('M16 CLI defaults to dry-run and needs the input and the classes',()=>{
  assert.deepEqual(parseMovement16Args(['--input','art','--ids','viciado-em-bet']),{write:false,input:'art',ids:['viciado-em-bet']});
  assert.throws(()=>parseMovement16Args(['--input','art']),/--ids required/);assert.throws(()=>parseMovement16Args(['--write','--ids','a']),/input required/);
});

test('M16 writes 15 WebP of 96 px cells (4×4 / 4×2), aligns the body, records the pivot and keeps R06 and meta',async()=>fixture(async({input,outRoot,manifestFile,old})=>{
  const preview=await importMovement16({input,outRoot,ids:['aposentado']});assert.equal(preview.dryRun,true);
  assert.deepEqual(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado,old,'dry-run cannot write');
  const result=await importMovement16({input,outRoot,ids:['aposentado'],write:true});assert.equal(result.characters[0].outputs.length,15);
  const entry=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado;
  assert.deepEqual(entry.files['walk128-S'],old.files['walk128-S'],'R06 untouched');assert.deepEqual(entry.meta,old.meta);
  assert.deepEqual(Object.keys(entry.files).filter(k=>k.includes('16-')).sort(),
    ['attack','idle','walk'].flatMap(m=>MOVEMENT16_META.directions.map(d=>`${m}16-${d}`)).sort());
  for(const [motion,m] of Object.entries(MOVEMENT16_META.motions))for(const d of MOVEMENT16_META.directions){
    if(motion==='run')continue;
    const f=entry.files[`${motion}16-${d}`],webp=path.join(outRoot,'public/art/sprites',f.file),meta=await sharp(webp).metadata();
    assert.deepEqual([meta.width,meta.height],[m.columns*96,m.rows*96]);assert.equal(f.frames,m.frames);assert.equal(f.durationMs,m.durationMs);assert.equal(f.loop,m.loop);
    assert.equal(f.revision,16);assert.match(f.file,new RegExp(`^aposentado\\.${motion}16-${d.toLowerCase()}\\.[0-9a-f]{12}\\.webp$`));
    assert.equal(f.height,108/2);assert.ok(Math.abs(f.pivotX-(50+30+4.5)/2)<=1,`pivot ${f.pivotX}`);
    // Every pose's torso on the clip's median after the alignment (the source slides 0–9 px).
    const {data,info}=await sharp(webp).ensureAlpha().raw().toBuffer({resolveWithObject:true}),xs:number[]=[];
    for(let i=0;i<m.frames;i++){let left=96;for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(data[((Math.floor(i/m.columns)*96+y)*info.width+i%m.columns*96+x)*4+3]>20)left=Math.min(left,x);xs.push(left);}
    assert.ok(Math.max(...xs)-Math.min(...xs)<=1,`${motion}/${d} aligned: ${xs}`);
  }
  // The client reads what the importer wrote: the class switches to M16.
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasMovement16('aposentado'),true);assert.equal(movementPlan('aposentado','walk','SE')?.key,'sprite16:aposentado:walk:SW');
}));

test('M16 rejects a wrong grid, missing alpha and repeated walk poses before writing anything',async()=>fixture(async({input,outRoot,manifestFile,old})=>{
  const walk=movement16Source(input,'aposentado','walk','N'),good=await readFile(walk);
  await writeFile(walk,await sheet(4,2));await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],write:true}),/height 768 required/);
  await writeFile(walk,await sharp(good).flatten({background:'#fff'}).png().toBuffer());await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],write:true}),/alpha/);
  await writeFile(walk,await sheet(4,4,{distinct:false,slide:0}));await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],write:true}),/16 poses must be distinct/);
  assert.deepEqual(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado,old);
}));

test('plano B: the side delivered per pair is imported (SE instead of SW), the old side goes, both sides are refused',async()=>fixture(async({input,outRoot,manifestFile})=>{
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  const moveSide=async(from:string,to:string)=>{for(const motion of ['walk','attack','idle'])await rename(movement16Source(input,'aposentado',motion,from),movement16Source(input,'aposentado',motion,to)).catch(async()=>{
    await mkdir(path.dirname(movement16Source(input,'aposentado',motion,to)),{recursive:true});await rename(movement16Source(input,'aposentado',motion,from),movement16Source(input,'aposentado',motion,to));});};
  await moveSide('SW','SE');
  const result=await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  assert.deepEqual(result.characters[0].drawn,['S','N','W','NW','SE']);assert.deepEqual(result.characters[0].mirrored,{E:'W',NE:'NW',SW:'SE'});
  const keys=Object.keys(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files).filter(k=>k.includes('16-')).sort();
  assert.deepEqual(keys,['attack','idle','walk'].flatMap(m=>['S','N','W','NW','SE'].map(d=>`${m}16-${d}`)).sort(),'SW keys dropped');
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasMovement16('aposentado'),true);assert.deepEqual(drawnSource('aposentado','SW'),{source:'SE',flip:true});
  assert.equal(movementPlan('aposentado','walk','SW')?.key,'sprite16:aposentado:walk:SE');
  // Both W and E delivered: one side per pair.
  for(const motion of ['walk','attack','idle']){const e=movement16Source(input,'aposentado',motion,'E');await mkdir(path.dirname(e),{recursive:true});await writeFile(e,await readFile(movement16Source(input,'aposentado',motion,'W')));}
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado']}),/W and E both delivered/);
}));

test('run (passo-3x-mais-lento): optional, all drawn directions or none; the hero runs when it has one, the walk stays',async()=>fixture(async({input,outRoot,manifestFile})=>{
  const result=await importMovement16({input,outRoot,ids:['aposentado'],write:true});assert.equal(result.characters[0].outputs.length,20);
  const files=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  for(const d of MOVEMENT16_META.directions){const f=files[`run16-${d}`];assert.equal(f.frames,16);assert.equal(f.loop,true);assert.equal(f.revision,16);}
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasRun16('aposentado'),true);
  const gait=HERO_GAIT.run;
  try{
    HERO_GAIT.run=true;
    assert.equal(movementPlan('aposentado','walk','SE')?.key,'sprite16:aposentado:run:SW');assert.equal(movementPlan('aposentado','walk','SE')?.flip,true);
    assert.equal(movementPlan('aposentado','attack','S')?.key,'sprite16:aposentado:attack:S','attack and rest unchanged');
    assert.deepEqual(movementSheets('aposentado','walk').map(p=>p.motion),['run','run','run','run','run']);
    HERO_GAIT.run=false;
    assert.equal(movementPlan('aposentado','walk','SE')?.key,'sprite16:aposentado:walk:SW','the walk comes back with the gait off');
  }finally{HERO_GAIT.run=gait;}
  // A run in only some directions is refused.
  await rm(movement16Source(input,'aposentado','run','N'));
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado']}),/run needs all of S N W NW SW or none/);
},{run:true}));

test('run poses keep their height off the ground (only the torso x is aligned)',async()=>{
  const {alignMovement16}=await import('../../scripts/import-movimento16.mjs');
  // Pose 0 on the ground (feet at 168), pose 1 lifted 20 px: a walk would drop it to the ground, a run keeps it.
  const rects=Array.from({length:16},(_,i)=>`<rect x="${i%4*192+60}" y="${Math.floor(i/4)*192+60-(i===1?20:0)}" width="60" height="108" fill="rgb(${i*13},${i*29},${80+i*7})"/>`).join('');
  const bytes=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768">${rects}</svg>`)).png().toBuffer();
  const walk=await alignMovement16(bytes,'walk'),run=await alignMovement16(bytes,'run');
  assert.equal(walk.shifts[1].dy,20);assert.equal(run.shifts[1].dy,0);
});
