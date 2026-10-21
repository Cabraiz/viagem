// M16 gameplay (card movimento16-espelho, 21/10): 16 walk/attack poses and 8 rest poses in 5 drawn directions: S, N and
// ONE side of each pair W×E, NW×NE, SW×SE, chosen per class by the folders delivered (plano B: viciado draws W, NW, SE);
// the game mirrors it into the other side (src/client/sprites/movement128.ts movement16Source). Never replaces
// R06, dance or legacy files: a class without the 15 sheets keeps them. Dry-run is the default.
//   node scripts/import-movimento16.mjs --input <arte-entrada> [--ids viciado-em-bet] [--write] [--report x.json]
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rename,rm,access} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {GROUPS} from './art-v2/spec.mjs';
import {readIndex,readManifest,writeManifest,writeIndex,writeAtomic,WEBP} from './art-v2/convert.mjs';
import {rootMotionShifts} from './import-movimento128.mjs';

export const MOVEMENT16_META=Object.freeze({revision:16,cell:[192,192],directions:['S','SW','W','NW','N'],mirrored:{E:'W',NE:'NW',SE:'SW'},
  pairs:[['W','E'],['NW','NE'],['SW','SE']],
  anchor:[.5,.875],movementHands:'empty',motions:{
    walk:{columns:4,rows:4,frames:16,durationMs:600,loop:true},
    attack:{columns:4,rows:4,frames:16,durationMs:1000,loop:false},
    idle:{columns:4,rows:2,frames:8,durationMs:2000,loop:true},
    // Optional (card passo-3x-mais-lento): a run, the hero's gait when the class has it; the walk stays.
    run:{columns:4,rows:4,frames:16,durationMs:600,loop:true}}});
/** The motions every M16 class draws; `run` is optional, all 5 drawn directions or none. */
const MOTIONS=['walk','attack','idle'],OPTIONAL_MOTIONS=['run'];
const exists=file=>access(file).then(()=>true,()=>false);
/**
 * The 5 directions a class draws: S, N and, for each mirror pair, the side delivered in all three motions (the default
 * W/NW/SW when neither is complete, so the validation names what is missing). Both sides delivered: an error, one per pair.
 */
export async function movement16Drawn(input,id){
  const complete=async d=>(await Promise.all(MOTIONS.map(m=>exists(movement16Source(input,id,m,d))))).every(Boolean);
  const drawn=['S','N'];
  for(const [a,b] of MOVEMENT16_META.pairs){
    const [hasA,hasB]=[await complete(a),await complete(b)];
    assert.ok(!(hasA&&hasB),`${id}: ${a} and ${b} both delivered; draw one side per pair (the other is mirrored)`);
    drawn.push(hasB?b:a);
  }
  return drawn;
}
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),SPEC=GROUPS.personagens,FOLDER='personagens-movimento16';
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id);
export const movement16Source=(input,id,motion,direction)=>path.join(input,FOLDER,id,motion,direction+'.png');

/** Every cell drawn, transparent somewhere and 2 px off the edge (alpha > 20); walk/attack poses all distinct. */
export async function inspectMovement16(source,motion,label=`${motion}`){
  const {columns,rows,frames}=MOVEMENT16_META.motions[motion];
  const bytes=await readFile(source),image=sharp(bytes),meta=await image.metadata();
  assert.equal(meta.format,'png',`${label}: PNG required`);
  assert.equal(meta.width,columns*192,`${label}: width ${columns*192} required (${columns}×${rows} cells of 192)`);
  assert.equal(meta.height,rows*192,`${label}: height ${rows*192} required (${columns}×${rows} cells of 192)`);
  assert.equal(meta.hasAlpha,true,`${label}: alpha (RGBA) required`);
  const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true}),hashes=[],cell=Buffer.alloc(192*192*4);
  let firstFrameHeight;
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*192,sy=Math.floor(frame/columns)*192;let drawn=0,transparent=0,top=192,bottom=-1;
    for(let y=0;y<192;y++){
      data.copy(cell,y*192*4,((sy+y)*info.width+sx)*4,((sy+y)*info.width+sx+192)*4);
      for(let x=0;x<192;x++){
        const o=(y*192+x)*4,alpha=cell[o+3];
        if(alpha===0){transparent++;cell[o]=cell[o+1]=cell[o+2]=0;}
        else if(alpha<255)for(let c=0;c<3;c++)cell[o+c]=Math.round(cell[o+c]*alpha/255);
        if(alpha<=20)continue;
        assert.ok(x>=2&&x<190&&y>=2&&y<190,`${label}: frame ${frame} touches cell edge`);
        drawn++;top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
    }
    assert.ok(drawn>0&&transparent>0,`${label}: frame ${frame} empty or opaque`);hashes.push(SHA(cell));
    if(frame===0)firstFrameHeight=bottom-top+1;
  }
  // The rest may hold a pose (breathing is subtle); a walk or a swing with repeated cells is not 16 poses.
  if(motion!=='idle')assert.equal(new Set(hashes).size,frames,`${label}: all ${frames} poses must be distinct`);
  return {source,sourceSha256:SHA(bytes),firstFrameHeight,uniqueFrames:new Set(hashes).size};
}

/** Torso x (alpha > 20 in the 25–55 % band of the figure height) and lowest foot row of every 192 px cell. */
function poseAnchors(data,width,columns,frames){
  const anchors=[];
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*192,sy=Math.floor(frame/columns)*192;let top=192,bottom=-1;
    for(let y=0;y<192;y++)for(let x=0;x<192;x++)if(data[((sy+y)*width+sx+x)*4+3]>20){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const y0=Math.round(top+(bottom-top)*.25),y1=Math.round(top+(bottom-top)*.55);let sum=0,count=0;
    for(let y=y0;y<y1;y++)for(let x=0;x<192;x++)if(data[((sy+y)*width+sx+x)*4+3]>20){sum+=x;count++;}
    anchors.push({x:count?sum/count:96,bottom});
  }
  return anchors;
}
/**
 * As R06 (import-movimento128 normalizeRootMotion): every pose moved whole so its torso x and lowest foot row sit on the
 * clip median (no pose redrawn). Also returns that torso x, the column the mirror pivots on, and the figure box (192 px).
 */
export async function alignMovement16(bytes,motion,label=motion){
  const {columns,frames}=MOVEMENT16_META.motions[motion];
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // A run keeps each pose's height (its flight off the ground): only the torso x is aligned, the feet stay as drawn.
  const anchors=poseAnchors(data,info.width,columns,frames),shifts=rootMotionShifts(anchors).map(s=>motion==='run'?{...s,dy:0}:s);
  const out=Buffer.alloc(data.length),figure={left:192,top:192,right:0,bottom:0},xs=[];
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*192,sy=Math.floor(frame/columns)*192,{dx,dy}=shifts[frame];xs.push(anchors[frame].x+dx);
    for(let y=0;y<192;y++)for(let x=0;x<192;x++){
      const from=((sy+y)*info.width+sx+x)*4,alpha=data[from+3];if(alpha===0)continue;
      const tx=x+dx,ty=y+dy;
      if(alpha>20){
        assert.ok(tx>=2&&tx<190&&ty>=2&&ty<190,`${label}: frame ${frame} root-motion shift ${dx},${dy} touches cell edge`);
        figure.left=Math.min(figure.left,tx);figure.top=Math.min(figure.top,ty);figure.right=Math.max(figure.right,tx+1);figure.bottom=Math.max(figure.bottom,ty+1);
      }
      if(tx<0||tx>=192||ty<0||ty>=192)continue;
      data.copy(out,((sy+ty)*info.width+sx+tx)*4,from,from+4);
    }
  }
  const sorted=xs.sort((a,b)=>a-b),pivot=sorted.length%2?sorted[sorted.length>>1]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  return {raw:out,width:info.width,height:info.height,figure,shifts,pivotX:pivot};
}
async function checkGamePoses(encoded,motion,label){
  const {columns,frames}=MOVEMENT16_META.motions[motion];
  const {data,info}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true}),hashes=[],cell=Buffer.alloc(96*96*4);
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*96,sy=Math.floor(frame/columns)*96;
    for(let y=0;y<96;y++)data.copy(cell,y*96*4,((sy+y)*info.width+sx)*4,((sy+y)*info.width+sx+96)*4);
    for(let i=0;i<cell.length;i+=4)if(cell[i+3]<255)for(let c=0;c<3;c++)cell[i+c]=Math.round(cell[i+c]*cell[i+3]/255);
    hashes.push(SHA(cell));
  }
  if(motion!=='idle')assert.equal(new Set(hashes).size,frames,`${label}: 96px game output must retain ${frames} distinct poses`);
}

/** Validates every selected class before writing; merges its 15 M16 keys into the personagens piece (R06 stays). */
export async function importMovement16({input,outRoot=ROOT,ids,write=false}={}){
  assert.ok(input,'explicit input directory required');input=path.resolve(input);outRoot=path.resolve(outRoot);
  assert.ok(Array.isArray(ids)&&ids.length>0&&ids.every(safeId)&&new Set(ids).size===ids.length,'--ids: unique safe character IDs required');
  const manifestFile=path.join(outRoot,SPEC.output,'manifest.json'),indexFile=path.join(outRoot,'public/art/manifest.json');
  const previous=await readManifest(manifestFile),index=await readIndex(indexFile);
  assert.ok(previous&&index?.groups?.personagens,'existing personagens group/index required');
  const records=[];
  for(const id of ids){
    const old=previous.pieces[id];
    if(old)assert.equal(old.kind,'dir8',`${id}: existing piece kind`);
    else assert.equal(index.groups.personagens.pieces[id],undefined,`${id}: index/group disagreement`);
    const clips=[],drawn=await movement16Drawn(input,id);
    const optional=[];
    for(const motion of OPTIONAL_MOTIONS){
      const has=await Promise.all(drawn.map(d=>exists(movement16Source(input,id,motion,d))));
      assert.ok(has.every(Boolean)||!has.some(Boolean),`${id}: ${motion} needs all of ${drawn.join(' ')} or none`);
      if(has[0])optional.push(motion);
    }
    for(const motion of [...MOTIONS,...optional])for(const direction of drawn)
      clips.push({...await inspectMovement16(movement16Source(input,id,motion,direction),motion,`${id}/${motion}/${direction}`),motion,direction});
    // The scale reference is the first rest pose facing S (alpha > 20, native px), shared by the 15 sheets.
    const height=clips.find(c=>c.motion==='idle'&&c.direction==='S').firstFrameHeight;
    assert.ok(Number.isFinite(height)&&height>=8&&height<=192,`${id}: M16 idle-S standing height required`);
    records.push({id,height,bootstrap:!old,drawn,mirrored:Object.fromEntries(MOVEMENT16_META.pairs.map(([a,b])=>drawn.includes(a)?[b,a]:[a,b])),clips,outputs:[]});
  }
  if(write){
    assert.deepEqual(await readManifest(manifestFile),previous,'hero manifest changed during M16 validation');
    const entries={};
    for(const record of records){
      const staged=[],files={};
      try{
        for(const clip of record.clips){
          const bytes=await readFile(clip.source);assert.equal(SHA(bytes),clip.sourceSha256,`${record.id}: source changed during import`);
          const m=MOVEMENT16_META.motions[clip.motion],key=`${clip.motion}16-${clip.direction}`;
          const aligned=await alignMovement16(bytes,clip.motion,`${record.id}/${key}`);
          const encoded=await sharp(aligned.raw,{raw:{width:aligned.width,height:aligned.height,channels:4}}).resize(m.columns*96,m.rows*96,{kernel:'lanczos3'}).webp(WEBP).toBuffer();
          await checkGamePoses(encoded,clip.motion,`${record.id}/${key}`);
          // Named by the WebP bytes (the alignment changes them without changing the source): no stale cached URL.
          const file=`${record.id}.${clip.motion}16-${clip.direction.toLowerCase()}.${SHA(encoded).slice(0,12)}.webp`,target=path.join(outRoot,SPEC.output,file);
          const tmp=path.join(path.dirname(target),`.${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
          await mkdir(path.dirname(target),{recursive:true});staged.push({tmp,target});await writeFile(tmp,encoded);
          const f=aligned.figure;
          files[key]={file,cell:[96,96],frames:m.frames,durationMs:m.durationMs,fps:m.frames*1000/m.durationMs,loop:m.loop,
            revision:16,movementHands:'empty',anchor:[.5,.875],height:record.height/2,pivotX:Math.round(aligned.pivotX/2*100)/100,
            figure:{left:Math.max(0,Math.floor(f.left/2)-2),top:Math.max(0,Math.floor(f.top/2)-2),right:Math.min(96,Math.ceil(f.right/2)+2),bottom:Math.min(96,Math.ceil(f.bottom/2)+2)},
            pages:[{file,columns:m.columns,rows:m.rows,firstFrame:0,frameCount:m.frames,sha256:SHA(encoded)}],sha256:SHA(encoded)};
          clip.pivotX=files[key].pivotX;
        }
        // The other side of each pair is mirrored now: a key it had from an earlier import goes (null drops it in the merge).
        for(const motion of [...MOTIONS,...OPTIONAL_MOTIONS])for(const d of Object.keys(record.mirrored))if(previous.pieces[record.id]?.files?.[`${motion}16-${d}`])files[`${motion}16-${d}`]=null;
        for(const file of staged){await rename(file.tmp,file.target);record.outputs.push(file.target);}
        entries[record.id]={kind:'dir8',files,...(previous.pieces[record.id]?.meta?{meta:previous.pieces[record.id].meta}:{})};
      }finally{await Promise.all(staged.map(file=>rm(file.tmp,{force:true})));}
    }
    assert.deepEqual(await readManifest(manifestFile),previous,'hero manifest changed during M16 conversion');
    await writeManifest('personagens',SPEC,entries,{outRoot});await writeIndex({personagens:SPEC},{outRoot});
  }
  return {revision:16,dryRun:!write,ids:[...ids],characters:records,cell:[96,96],motions:MOVEMENT16_META.motions};
}

export function parseMovement16Args(args){
  const result={write:false};
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--write')result.write=true;
    else if(arg==='--dry-run')result.write=false;
    else if(['--input','--report','--ids','--out'].includes(arg)){
      const value=args[++i];assert.ok(value&&!value.startsWith('--'),`${arg} needs a value`);
      if(arg==='--ids')result.ids=value.split(',');else if(arg==='--out')result.outRoot=value;else result[arg.slice(2)]=value;
    }else throw new Error(`unknown option: ${arg}`);
  }
  assert.ok(result.input,'--input required');assert.ok(result.ids,'--ids required (e.g. --ids viciado-em-bet)');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  sharp.cache(false);sharp.concurrency(1);
  const {report,...options}=parseMovement16Args(process.argv.slice(2)),result=await importMovement16(options);
  if(report)await writeAtomic(path.resolve(report),JSON.stringify(result,null,2)+'\n');
  console.log(`M16 ${result.dryRun?'validated':'imported'} ${result.characters.map(c=>`${c.id} (${c.drawn.join(' ')}; mirrored ${Object.entries(c.mirrored).map(([to,from])=>`${to}←${from}`).join(' ')})`).join(', ')}: 16 walk+attack poses and 8 rest poses x 5 drawn directions; 96px game cells; R06/legacy preserved.`);
}
