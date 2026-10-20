import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MOVEMENT128_META,importMovement128,inspectMovement128,parseMovement128Args} from '../../scripts/import-movimento128.mjs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movement128Plan,movement128Frame} from '../../src/client/sprites/movement128.ts';
import {HERO_ANIM_RATE} from '../../src/client/sprites/sprite-motion.ts';

sharp.cache(false);sharp.concurrency(1);
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const write=async(file:string,value:unknown)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));};
const rgb=(frame:number)=>[frame*7%256,frame*13%256,frame*19%256];
async function png(frames=128){
  const rects=Array.from({length:128},(_,i)=>`<rect x="${i%16*192+30}" y="${Math.floor(i/16)*192+60}" width="100" height="108" fill="rgb(${rgb(i%frames).join(',')})"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3072" height="1536">${rects}</svg>`)).png().toBuffer();
}
async function fixture(fn:(p:{input:string;outRoot:string;work:string;manifestFile:string;indexFile:string;old:any})=>Promise<void>){
  const work=await mkdtemp(path.join(tmpdir(),'viagem-movement128-')),input=path.join(work,'input'),outRoot=path.join(work,'out');
  try{
    const files:Record<string,unknown>={};
    for(const key of ['dir4','dir4c','downed']){
      const file=`aposentado.${key}.webp`,bytes=Buffer.from('unchanged '+key);
      await mkdir(path.join(outRoot,'public/art/sprites'),{recursive:true});await writeFile(path.join(outRoot,'public/art/sprites',file),bytes);
      files[key]={file,cell:[192,192],frames:6,directions:4,height:120,sha256:hash(bytes)};
    }
    const old={kind:'dir8',files,meta:{sentinel:'keep'}},manifestFile=path.join(outRoot,'public/art/sprites/manifest.json'),indexFile=path.join(outRoot,'public/art/manifest.json');
    await write(manifestFile,{version:2,group:'personagens',pieces:{aposentado:old}});
    await write(indexFile,{version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:old}},menu:{output:'public/art/menu/danca',pieces:{sentinel:{kind:'dance',files:{dance:{file:'sentinel.webp',cell:[768,512],frames:128,fps:128/36}}}}}}});
    await write(path.join(input,'personagens-movimento128/aposentado/meta.json'),MOVEMENT128_META);
    const idle=Array.from({length:8},(_,i)=>`<rect x="${i*192+30}" y="60" width="100" height="108" fill="rgb(${rgb(i).join(',')})"/>`).join('');
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="192">${idle}</svg>`)).png().toFile(path.join(input,'personagens-movimento128/aposentado/idle.png'));
    const bytes=await png();
    for(const motion of ['walk','attack'])for(const direction of MOVEMENT128_META.directions){
      const target=path.join(input,'personagens-movimento128/aposentado',motion,direction+'.png');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);
    }
    await fn({input,outRoot,work,manifestFile,indexFile,old});
  }finally{
    setArtIndex(parseArtIndex(undefined));const absolute=path.resolve(work);
    assert.equal(path.dirname(absolute),path.resolve(tmpdir()));assert.ok(path.basename(absolute).startsWith('viagem-movement128-'));await rm(absolute,{recursive:true,force:true});
  }
}

test('R06 CLI defaults to dry-run; requires explicit source and write flag',()=>{
  assert.deepEqual(parseMovement128Args(['--input','art']),{write:false,input:'art'});
  assert.deepEqual(parseMovement128Args(['--input','art','--write','--ids','a,b']),{write:true,input:'art',ids:['a','b']});
  assert.throws(()=>parseMovement128Args(['--write']),/input required/);assert.throws(()=>parseMovement128Args(['--input','--write']),/needs a value/);
});

test('R06 adds16 detailed clips+idle8, preserves2056 frame pixels/order, legacy files and dance manifest',async()=>fixture(async({input,outRoot,manifestFile,indexFile,old})=>{
  const beforeIndex=JSON.parse(await readFile(indexFile,'utf8')),beforeSource=hash(await readFile(path.join(input,'personagens-movimento128/aposentado/walk/S.png')));
  const preview=await importMovement128({input,outRoot,ids:['aposentado']});assert.equal(preview.dryRun,true);
  assert.deepEqual(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado,old,'dry-run cannot write');
  const result=await importMovement128({input,outRoot,ids:['aposentado'],write:true});assert.equal(result.characters[0].outputs.length,17);assert.equal(result.characters[0].idle.uniqueFrames,8);
  const index=JSON.parse(await readFile(indexFile,'utf8')),entry=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado;
  assert.deepEqual(index.groups.menu,beforeIndex.groups.menu);assert.deepEqual(entry.meta,old.meta);
  for(const key of ['dir4','dir4c','downed']){
    assert.deepEqual(entry.files[key],old.files[key]);assert.equal((await readFile(path.join(outRoot,'public/art/sprites',old.files[key].file),'utf8')),'unchanged '+key);
  }
  setArtIndex(parseArtIndex(index));
  for(const motion of ['walk','attack'] as const)for(const direction of MOVEMENT128_META.directions){
    const file=entry.files[`${motion}128-${direction}`],absolute=path.join(outRoot,'public/art/sprites',file.file),meta=await sharp(absolute).metadata();
    assert.deepEqual([meta.width,meta.height,meta.hasAlpha],[1536,768,true]);assert.deepEqual(file.cell,[96,96]);assert.equal(file.height,54,'scale comes from native idle108px, not legacy120px');assert.equal(file.movementHands,'empty');
    const plan=movement128Plan('aposentado',motion,direction)!;assert.ok(plan);assert.equal(plan.durationMs,motion==='walk'?600:1000);
    const {data,info}=await sharp(absolute).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=0;frame<128;frame++){
      const offset=((Math.floor(frame/16)*96+45)*info.width+frame%16*96+30)*4;
      assert.deepEqual([...data.subarray(offset,offset+3)],rgb(frame),`${motion}/${direction}/${frame}`);
      assert.equal(movement128Frame(plan,(frame+.5)*plan.durationMs/128/HERO_ANIM_RATE),frame);
    }
  }
  const idle8=entry.files.idle8,idleFile=path.join(outRoot,'public/art/sprites',idle8.file),idleMeta=await sharp(idleFile).metadata();
  assert.deepEqual([idleMeta.width,idleMeta.height],[768,96]);assert.equal(idle8.frames,1);assert.equal(idle8.directions,8);assert.equal(idle8.pages[0].frameCount,8);
  const {data:idlePixels}=await sharp(idleFile).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let direction=0;direction<8;direction++){
    const at=(45*768+direction*96+30)*4;assert.deepEqual([...idlePixels.subarray(at,at+3)],rgb(direction));
  }
  assert.equal(Object.keys(entry.files).length,20);assert.equal(hash(await readFile(path.join(input,'personagens-movimento128/aposentado/walk/S.png'))),beforeSource,'Desktop originals stay192px and byte-identical');
  assert.deepEqual(result.characters[0].scaleReference,{motion:'idle',direction:'S',source:path.join(input,'personagens-movimento128/aposentado/idle.png'),sourceSha256:result.characters[0].idle.sourceSha256,sourceHeight:108,gameHeight:54});
}));

test('R06 root motion: poses that slide every8 frames and change ground per32-block come out pinned in place',async()=>fixture(async({input,outRoot,manifestFile})=>{
  // Same skate-and-snap as the real R06 sources: +6 px per frame inside each row of8, ground line 3 px higher per block.
  const rects=Array.from({length:128},(_,i)=>`<rect x="${i%16*192+30+i%8*6}" y="${Math.floor(i/16)*192+60-Math.floor(i/32)*3}" width="100" height="108" fill="rgb(${rgb(i).join(',')})"/>`).join('');
  const sliding=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3072" height="1536">${rects}</svg>`)).png().toBuffer();
  for(const motion of ['walk','attack'])for(const direction of MOVEMENT128_META.directions)await writeFile(path.join(input,'personagens-movimento128/aposentado',motion,direction+'.png'),sliding);
  await importMovement128({input,outRoot,ids:['aposentado'],write:true});
  const entry=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado,shas=new Set<string>();
  for(const motion of ['walk','attack'])for(const direction of MOVEMENT128_META.directions){
    const file=entry.files[`${motion}128-${direction}`];shas.add(file.sha256);
    assert.ok(file.file.includes(file.sha256.slice(0,12)),'aligned clips are named by their WebP bytes, never reusing a cached URL');
    const {data,info}=await sharp(path.join(outRoot,'public/art/sprites',file.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true}),lefts:number[]=[],bottoms:number[]=[];
    for(let frame=0;frame<128;frame++){
      const sx=frame%16*96,sy=Math.floor(frame/16)*96;let left=96,bottom=-1;
      for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(data[((sy+y)*info.width+sx+x)*4+3]>128){left=Math.min(left,x);bottom=Math.max(bottom,y);}
      lefts.push(left);bottoms.push(bottom);
      const at=((sy+bottom-20)*info.width+sx+left+25)*4;assert.deepEqual([...data.subarray(at,at+3)],rgb(frame),`${motion}/${direction}/${frame} keeps pose order`);
    }
    assert.ok(Math.max(...lefts)-Math.min(...lefts)<=1,`${motion}/${direction} x: ${Math.min(...lefts)}..${Math.max(...lefts)}`);
    assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=1,`${motion}/${direction} ground: ${Math.min(...bottoms)}..${Math.max(...bottoms)}`);
    assert.ok(file.figure.right-file.figure.left<=50+6,'figure box is measured after alignment, not over the slide');
  }
  assert.equal(shas.size,1,'same source bytes for all16 clips → same aligned WebP');
}));

test('R06 bootstraps both missing IDs from native idle+16 clips, with no fabricated legacy sheet',async()=>fixture(async({input,outRoot,manifestFile,indexFile,old})=>{
  const ids=['tio-do-churrasco','conspiracionista'],beforeIndex=JSON.parse(await readFile(indexFile,'utf8'));
  for(const id of ids)await cp(path.join(input,'personagens-movimento128/aposentado'),path.join(input,'personagens-movimento128',id),{recursive:true});
  const result=await importMovement128({input,outRoot,ids,write:true}),group=JSON.parse(await readFile(manifestFile,'utf8')),index=JSON.parse(await readFile(indexFile,'utf8'));
  assert.deepEqual(group.pieces.aposentado,old);assert.deepEqual(index.groups.menu,beforeIndex.groups.menu);
  for(const id of ids){
    const entry=group.pieces[id],record=result.characters.find((c:any)=>c.id===id);
    assert.equal(record.bootstrap,true);assert.equal(record.height,108);assert.equal(record.outputs.length,17);
    assert.equal(entry.files.dir4,undefined);assert.equal(entry.files.dir4c,undefined);assert.equal(entry.files.downed,undefined);
    assert.equal(Object.keys(entry.files).length,17);assert.equal(entry.files.idle8.height,54);assert.equal(entry.files.idle8.pages[0].frameCount,8);
    for(const motion of ['walk','attack'])for(const direction of MOVEMENT128_META.directions)assert.equal(entry.files[`${motion}128-${direction}`].frames,128);
    for(const file of record.outputs)assert.ok(path.basename(file).startsWith(id+'.')&&!/\.dir4/.test(file));
  }
}));

test('R06 rejects armed movement or missing directions before touching existing game files',async()=>fixture(async({input,outRoot,manifestFile})=>{
  const before=await readFile(manifestFile,'utf8'),metadata=path.join(input,'personagens-movimento128/aposentado/meta.json');
  await write(metadata,{...MOVEMENT128_META,movementHands:'weapon'});await assert.rejects(importMovement128({input,outRoot,ids:['aposentado'],write:true}),/metadata mismatch/);
  await write(metadata,MOVEMENT128_META);
  const idleFile=path.join(input,'personagens-movimento128/aposentado/idle.png'),idle=await readFile(idleFile);await rm(idleFile);
  await assert.rejects(importMovement128({input,outRoot,ids:['aposentado'],write:true}),/ENOENT/);await writeFile(idleFile,idle);
  await rm(path.join(input,'personagens-movimento128/aposentado/attack/SE.png'));
  await assert.rejects(importMovement128({input,outRoot,ids:['aposentado'],write:true}),/ENOENT/);
  assert.equal(await readFile(manifestFile,'utf8'),before);assert.equal((await readdir(path.join(outRoot,'public/art/sprites'))).filter(name=>name.includes('128')).length,0);
}));

test('R06 content validation rejects repeated visual poses even if transparent RGB differs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'viagem-movement128-'));
  try{
    const file=path.join(dir,'repeated.png'),{data,info}=await sharp(await png(64)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=0;frame<128;frame++){
      const offset=(Math.floor(frame/16)*192*info.width+frame%16*192)*4;
      data[offset]=frame;data[offset+1]=255-frame;data[offset+2]=123;data[offset+3]=0;
    }
    await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(file);
    await assert.rejects(inspectMovement128(file),/all128 poses must be distinct/);
  }finally{const absolute=path.resolve(dir);assert.equal(path.dirname(absolute),path.resolve(tmpdir()));assert.ok(path.basename(absolute).startsWith('viagem-movement128-'));await rm(absolute,{recursive:true,force:true});}
});
