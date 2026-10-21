import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MOVEMENT16_META,importMovement16,parseMovement16Args,movement16Source} from '../../scripts/import-movimento16.mjs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movementPlan,hasMovement16} from '../../src/client/sprites/movement128.ts';

sharp.cache(false);sharp.concurrency(1);
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const write=async(file:string,value:unknown)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));};
/** A body (torso at x0+30 of 192, feet at 168) sliding `slide` px per pose, colour per pose so every pose is distinct. */
async function sheet(columns:number,rows:number,{x0=50,slide=3,distinct=true}={}){
  const rects=Array.from({length:columns*rows},(_,i)=>{const c=distinct?i:0,x=i%columns*192+x0+(i%4)*slide,y=Math.floor(i/columns)*192;
    return `<rect x="${x}" y="${y+60}" width="60" height="108" fill="rgb(${c*13%256},${c*29%256},${80+c*7%170})"/>`;}).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*192}" height="${rows*192}">${rects}</svg>`)).png().toBuffer();
}
async function fixture(fn:(p:{input:string;outRoot:string;manifestFile:string;indexFile:string;old:any})=>Promise<void>){
  const work=await mkdtemp(path.join(tmpdir(),'viagem-movement16-')),input=path.join(work,'input'),outRoot=path.join(work,'out');
  try{
    const file=`aposentado.walk128-s.000000000000.webp`,bytes=Buffer.from('r06 walk');
    await mkdir(path.join(outRoot,'public/art/sprites'),{recursive:true});await writeFile(path.join(outRoot,'public/art/sprites',file),bytes);
    const old={kind:'dir8',files:{'walk128-S':{file,cell:[96,96],frames:128,sha256:hash(bytes)}},meta:{sentinel:'keep'}};
    const manifestFile=path.join(outRoot,'public/art/sprites/manifest.json'),indexFile=path.join(outRoot,'public/art/manifest.json');
    await write(manifestFile,{version:2,group:'personagens',pieces:{aposentado:old}});
    await write(indexFile,{version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:old}}}});
    for(const [motion,m] of Object.entries(MOVEMENT16_META.motions)){
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
