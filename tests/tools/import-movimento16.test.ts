import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,mkdir,readFile,writeFile,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MOVEMENT16_META,IDLE_BREATH,importMovement16,parseMovement16Args,movement16Source} from '../../scripts/import-movimento16.mjs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movementPlan,movementSheets,hasMovement16,hasRun16,hasPush16,pushPlan,hasPull16,pullPlan,hasHurt16,hurtPlan,hasIdle16,movement16Source as drawnSource} from '../../src/client/sprites/movement128.ts';
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
/** The class's sheets in `input`: walk, attack and idle in the 5 default directions, and the optional run with `run` (never the push, the pull, the hurt or the build). */
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
      if(motion==='run'&&!run||motion==='push'||motion==='pull'||motion==='hurt'||motion==='build'||motion==='work')continue;
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
    if(motion==='run'||motion==='push'||motion==='pull'||motion==='hurt'||motion==='build'||motion==='work')continue;
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

test('M16 takes a 4×4 idle as the breathing rest: 16 distinct poses over 3.2 s, kept as drawn; the client plays them',async()=>fixture(async({input,outRoot,manifestFile,old})=>{
  // Card parado-respiracao-herois: the poses slide 0–9 px (a sway) and must stay so; a held 4×4 rest is refused.
  for(const d of MOVEMENT16_META.directions)await writeFile(movement16Source(input,'aposentado','idle',d),await sheet(4,4,{distinct:false,slide:0}));
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],write:true}),/idle\/S: all 16 poses must be distinct/);
  assert.deepEqual(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado,old);
  for(const d of MOVEMENT16_META.directions)await writeFile(movement16Source(input,'aposentado','idle',d),await sheet(4,4));
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  const f=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files['idle16-S'],webp=path.join(outRoot,'public/art/sprites',f.file);
  assert.deepEqual([f.frames,f.durationMs,f.loop,f.pages[0].columns,f.pages[0].rows],[16,3200,true,4,4]);assert.deepEqual(IDLE_BREATH,{columns:4,rows:4,frames:16,durationMs:3200,loop:true});
  assert.deepEqual(await sharp(webp).metadata().then(m=>[m.width,m.height]),[384,384]);
  const {data,info}=await sharp(webp).ensureAlpha().raw().toBuffer({resolveWithObject:true}),xs:number[]=[];
  for(let i=0;i<4;i++){let left=96;for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(data[((Math.floor(i/4)*96+y)*info.width+i%4*96+x)*4+3]>20)left=Math.min(left,x);xs.push(left);}
  assert.ok(xs[3]-xs[0]>=4,`as drawn, not aligned: ${xs}`);
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  const plan=movementPlan('aposentado','idle','S');
  assert.deepEqual([plan?.columns,plan?.rows,plan?.frameCount,plan?.durationMs,plan?.loop],[4,4,16,3200,true]);
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
  // A phase table next to a run sheet goes into the manifest; a malformed one is refused.
  const table={d:Array(16).fill(.05),v:Array.from({length:16},(_,i)=>i<3?[2,0]:[0,0])};
  await writeFile(movement16Source(input,'aposentado','run','W').replace(/\.png$/,'.phase.json'),JSON.stringify(table));
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  assert.deepEqual(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files['run16-W'].phase,table);
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.deepEqual(movementPlan('aposentado','walk','E')?.phase,table,'the mirrored side uses the drawn table');
  await writeFile(movement16Source(input,'aposentado','run','W').replace(/\.png$/,'.phase.json'),JSON.stringify({d:[1],v:[[0,0]]}));
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado']}),/phase.d needs 16/);
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

test('push (empurrar-uno): --motions push imports only the push of a class, with its phase table, the other sheets kept',async()=>fixture(async({input,outRoot,manifestFile})=>{
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  const before=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  const m=MOVEMENT16_META.motions.push,bytes=await sheet(m.columns,m.rows),table={d:Array(16).fill(.03),v:Array.from({length:16},(_,i)=>i%2?[1.5,0]:[0,0])};
  for(const d of MOVEMENT16_META.directions){const target=movement16Source(input,'aposentado','push',d);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  // a push sheet without its phase table is refused (the game places it by the ground walked)
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],motions:['push'],write:true}),/a push needs its phase table/);
  for(const d of MOVEMENT16_META.directions)await writeFile(movement16Source(input,'aposentado','push',d).replace(/\.png$/,'.phase.json'),JSON.stringify(table));
  const result=await importMovement16({input,outRoot,ids:['aposentado'],motions:['push'],write:true});
  assert.equal(result.characters[0].outputs.length,5);assert.deepEqual(result.characters[0].motions,['push']);
  const files=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  for(const [k,f] of Object.entries(before))assert.deepEqual(files[k],f,`${k} kept`);
  for(const d of MOVEMENT16_META.directions){const f=files[`push16-${d}`];assert.equal(f.frames,16);assert.equal(f.durationMs,1000);assert.deepEqual(f.phase,table);assert.equal(f.height,before['idle16-S'].height);}
  // the client sees it (the index keeps push16 keys) and pushes on it, mirrored like the rest of the class
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasPush16('aposentado'),true);assert.equal(pushPlan('aposentado','SE')?.key,'sprite16:aposentado:push:SW');assert.deepEqual(pushPlan('aposentado','E')?.phase,table);
}));

test('pull (puxar-uno-corda): --motions pull imports the rope pull of a class like its push, with its phase table',async()=>fixture(async({input,outRoot,manifestFile})=>{
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  const before=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  const m=MOVEMENT16_META.motions.pull,bytes=await sheet(m.columns,m.rows),table={d:Array(16).fill(.03),v:Array.from({length:16},(_,i)=>i%2?[1.5,0]:[0,0])};
  assert.deepEqual([m.columns,m.rows,m.frames,m.durationMs,m.loop],[4,4,16,1000,true]);
  for(const d of MOVEMENT16_META.directions){const target=movement16Source(input,'aposentado','pull',d);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],motions:['pull'],write:true}),/a pull needs its phase table/);
  for(const d of MOVEMENT16_META.directions)await writeFile(movement16Source(input,'aposentado','pull',d).replace(/\.png$/,'.phase.json'),JSON.stringify(table));
  const result=await importMovement16({input,outRoot,ids:['aposentado'],motions:['pull'],write:true});
  assert.equal(result.characters[0].outputs.length,5);assert.deepEqual(result.characters[0].motions,['pull']);
  const files=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  for(const [k,f] of Object.entries(before))assert.deepEqual(files[k],f,`${k} kept`);
  for(const d of MOVEMENT16_META.directions){const f=files[`pull16-${d}`];assert.equal(f.frames,16);assert.deepEqual(f.phase,table);assert.equal(f.height,before['idle16-S'].height);}
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasPull16('aposentado'),true);assert.equal(pullPlan('aposentado','SE')?.key,'sprite16:aposentado:pull:SW');assert.deepEqual(pullPlan('aposentado','E')?.phase,table);
  // no push here: the pull stands alone
  assert.equal(hasPush16('aposentado'),false);
}));

test('hurt (animacao-receber-dano): --motions hurt imports the flinch, its last pose the rest again, placed as drawn on the rest pivot',async()=>fixture(async({input,outRoot,manifestFile})=>{
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  const before=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files,m=MOVEMENT16_META.motions.hurt;
  assert.deepEqual([m.columns,m.rows,m.frames,m.durationMs,m.loop],[3,2,6,300,false]);
  // pose 0 and pose 5 the same rest pose; 1-4 lean back (the body moves, the feet stay at 168)
  const cell=(i:number)=>{const k=i===5?0:i,x=i%3*192+60-[0,6,10,6,3][k],y=Math.floor(i/3)*192;return `<rect x="${x}" y="${y+60}" width="60" height="108" fill="rgb(${k*40},${k*20},90)"/>`;};
  const flinch=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="576" height="384">${Array.from({length:6},(_,i)=>cell(i)).join('')}</svg>`)).png().toBuffer();
  for(const d of MOVEMENT16_META.directions){const target=movement16Source(input,'aposentado','hurt',d);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,flinch);}
  const result=await importMovement16({input,outRoot,ids:['aposentado'],motions:['hurt'],write:true});
  assert.equal(result.characters[0].outputs.length,5);assert.deepEqual(result.characters[0].motions,['hurt']);
  const files=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  for(const [k,f] of Object.entries(before))assert.deepEqual(files[k],f,`${k} kept`);
  for(const d of MOVEMENT16_META.directions){
    const f=files[`hurt16-${d}`];assert.equal(f.frames,6);assert.equal(f.durationMs,300);assert.equal(f.loop,false);assert.equal(f.phase,undefined);
    assert.equal(f.pivotX,before[`idle16-${d}`].pivotX,`${d}: the rest's pivot`);assert.deepEqual([f.pages[0].columns,f.pages[0].rows],[3,2]);
    // as drawn: pose 1 still leans 6 px (192) left of pose 0 at the game's 96, not pulled back onto the torso median
    const {data,info}=await sharp(path.join(outRoot,'public/art/sprites',f.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const left=(i:number)=>{for(let x=0;x<96;x++)for(let y=0;y<96;y++)if(data[((Math.floor(i/3)*96+y)*info.width+i%3*96+x)*4+3]>128)return x;return -1;};
    assert.equal(left(0)-left(1),3);assert.equal(left(5),left(0));
  }
  // a flinch with every pose the same is refused (only the last may repeat the first)
  const still=await sheet(3,2,{distinct:false,slide:0});
  await writeFile(movement16Source(input,'aposentado','hurt','N'),still);
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],motions:['hurt']}),/poses must be distinct/);
  // the client sees it and flinches on it, mirrored like the rest of the class
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasHurt16('aposentado'),true);
  const se=hurtPlan('aposentado','SE');assert.equal(se?.key,'sprite16:aposentado:hurt:SW');assert.equal(se?.flip,true);assert.equal(se?.loop,false);assert.equal(se?.frameCount,6);
}));

test('rest alone (parado-respiracao-herois): --motions idle on an R06 class takes its 8 directions, none mirrored, on the idle8 spot',async()=>fixture(async({input,outRoot,manifestFile,indexFile,old})=>{
  // The CLT: an R06 class (walk128, attack128, idle8) whose idle8 becomes a breathing idle16; the R06 sheets stay.
  const idle8={file:'aposentado.idle8.000000000000.webp',cell:[96,96],frames:1,directions:8,revision:6,movementHands:'empty',loop:false,anchor:[.5,.875],height:54,
    figure:{left:8,top:20,right:88,bottom:86},pages:[{file:'aposentado.idle8.000000000000.webp',columns:8,rows:1,firstFrame:0,frameCount:8}]};
  const r06={...old,files:{...old.files,idle8}};
  await write(manifestFile,{version:2,group:'personagens',pieces:{aposentado:r06}});
  await write(indexFile,{version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:r06}}}});
  for(const motion of ['walk','attack','idle'])await rm(path.join(input,'personagens-movimento16','aposentado',motion),{recursive:true,force:true});
  const breath=await sheet(4,4,{x0:40});
  for(const d of MOVEMENT16_META.directions){const target=movement16Source(input,'aposentado','idle',d);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,breath);}
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],motions:['idle'],write:true}),/an R06 rest needs idle\/NE\.png/);
  for(const d of ['NE','E','SE'])await writeFile(movement16Source(input,'aposentado','idle',d),breath);
  const result=await importMovement16({input,outRoot,ids:['aposentado'],motions:['idle'],write:true});
  assert.equal(result.characters[0].outputs.length,8);assert.deepEqual(result.characters[0].mirrored,{});assert.equal(result.characters[0].height,108);
  const files=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  assert.deepEqual(files['walk128-S'],old.files['walk128-S']);const {sha256:_,...kept}=files.idle8;assert.deepEqual(kept,idle8,'the idle8 stays (the size reference)');
  for(const d of ['S','SW','W','NW','N','NE','E','SE']){
    const f=files[`idle16-${d}`];assert.deepEqual([f.frames,f.durationMs,f.loop],[16,3200,true],d);
    assert.equal(f.pivotX,48,`${d}: stands where its idle8 did (anchor .5), not on its measured body`);
  }
  setArtIndex(parseArtIndex(JSON.parse(await readFile(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
  assert.equal(hasIdle16('aposentado'),true);assert.equal(movementPlan('aposentado','idle','E')?.key,'sprite16:aposentado:idle:E');assert.equal(movementPlan('aposentado','idle','E')?.flip,false);
}));

test('walk alone (andar-proporcao): only walk16 is replaced, at the M16 rest scale; attack, rest and run stay',async()=>fixture(async({input,outRoot,manifestFile})=>{
  const walkOnly=async()=>{for(const motion of ['attack','idle'])await rm(path.join(input,'personagens-movimento16','aposentado',motion),{recursive:true,force:true});};
  await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  const before=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  await walkOnly();
  const taller=await sheet(4,4,{x0:40,slide:2});
  for(const d of MOVEMENT16_META.directions)await writeFile(movement16Source(input,'aposentado','walk',d),taller);
  const result=await importMovement16({input,outRoot,ids:['aposentado'],write:true});
  assert.equal(result.characters[0].walkOnly,true);assert.equal(result.characters[0].outputs.length,5);assert.equal(result.characters[0].height,before['idle16-S'].height*2);
  const after=JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado.files;
  for(const key of Object.keys(before))if(key.startsWith('walk16-'))assert.notEqual(after[key].file,before[key].file,`${key} replaced`);
  else assert.deepEqual(after[key],before[key],`${key} kept`);
  assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());
}));

test('a walk alone needs the class\'s M16 rest (its size reference)',async()=>fixture(async({input,outRoot,manifestFile,old})=>{
  for(const motion of ['attack','idle'])await rm(path.join(input,'personagens-movimento16','aposentado',motion),{recursive:true,force:true});
  await assert.rejects(importMovement16({input,outRoot,ids:['aposentado'],write:true}),/a walk alone needs the class's M16 idle16-S/);
  assert.deepEqual(JSON.parse(await readFile(manifestFile,'utf8')).pieces.aposentado,old);
}));
