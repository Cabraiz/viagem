// R06 gameplay: detailed walk/attack and native idle. Never replaces dance or legacy hero files.
// Dry-run is the default. Real import: --input <arte-entrada> --write (after the35 R06 receipts are verified).
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {DIRECTIONS,FACE_CLASSES,GROUPS} from './art-v2/spec.mjs';
import {readIndex,readManifest,writeManifest,writeIndex,writeAtomic,WEBP} from './art-v2/convert.mjs';

export const MOVEMENT128_META=Object.freeze({revision:6,cell:[192,192],columns:16,rows:8,frames:128,
  directions:[...DIRECTIONS],anchor:[.5,.875],motions:{walk:{durationMs:600,loop:true},attack:{durationMs:1000,loop:false}},attackHands:'empty',movementHands:'empty',
  idle:{file:'idle.png',cell:[192,192],columns:8,rows:1,framesPerDirection:1}});
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),SPEC=GROUPS.personagens;
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const safeId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id);
const sourcePath=(input,id,motion,direction)=>path.join(input,'personagens-movimento128',id,motion,direction+'.png');

async function checkGamePoses(encoded,label,columns=16,frames=128){
  const {data,info}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true}),hashes=[];
  const cell=Buffer.alloc(96*96*4);
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*96,sy=Math.floor(frame/columns)*96;
    for(let y=0;y<96;y++)data.copy(cell,y*96*4,((sy+y)*info.width+sx)*4,((sy+y)*info.width+sx+96)*4);
    for(let i=0;i<cell.length;i+=4)if(cell[i+3]<255)for(let c=0;c<3;c++)cell[i+c]=Math.round(cell[i+c]*cell[i+3]/255);
    hashes.push(SHA(cell));
  }
  assert.equal(new Set(hashes).size,frames,`${label}:96px game output must retain${frames} distinct poses`);
}

/** Torso x (alpha>20 pixels in the 25–55 % band of the figure height) and lowest foot row, per 192 px cell. */
function poseAnchors(data,width,frames=128,columns=16){
  const anchors=[];
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*192,sy=Math.floor(frame/columns)*192;let top=192,bottom=-1;
    for(let y=0;y<192;y++)for(let x=0;x<192;x++)if(data[((sy+y)*width+sx+x)*4+3]>20){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const y0=Math.round(top+(bottom-top)*.25),y1=Math.round(top+(bottom-top)*.55);let sum=0,count=0;
    for(let y=y0;y<y1;y++)for(let x=0;x<192;x++)if(data[((sy+y)*width+sx+x)*4+3]>20){sum+=x;count++;}
    anchors.push({x:sum/count,bottom});
  }
  return anchors;
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length>>1;return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
/**
 * The R06 sources are four native sheets of32 poses per clip, and most of them slide the figure across the cell
 * every8 poses and snap it back, on a ground line that differs per sheet: in game the body skated and jumped.
 * Every walk/attack pose is moved whole (no pose is redrawn) so its torso x and lowest foot row sit on the clip median.
 */
export function rootMotionShifts(anchors){
  const targetX=median(anchors.map(a=>a.x)),targetY=median(anchors.map(a=>a.bottom));
  return anchors.map(a=>({dx:Math.round(targetX-a.x),dy:Math.round(targetY-a.bottom)}));
}
/** Returns the192 px RGBA sheet with each pose shifted whole, its figure box and the shifts applied. */
export async function normalizeRootMotion(bytes,label='movement128'){
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const shifts=rootMotionShifts(poseAnchors(data,info.width)),out=Buffer.alloc(data.length),figure={left:192,top:192,right:0,bottom:0};
  for(let frame=0;frame<128;frame++){
    const sx=frame%16*192,sy=Math.floor(frame/16)*192,{dx,dy}=shifts[frame];
    for(let y=0;y<192;y++)for(let x=0;x<192;x++){
      const from=((sy+y)*info.width+sx+x)*4,alpha=data[from+3];if(alpha===0)continue;
      const tx=x+dx,ty=y+dy;
      if(alpha>20){
        assert.ok(tx>=2&&tx<190&&ty>=2&&ty<190,`${label}: frame${frame} root-motion shift ${dx},${dy} touches cell edge`);
        figure.left=Math.min(figure.left,tx);figure.top=Math.min(figure.top,ty);figure.right=Math.max(figure.right,tx+1);figure.bottom=Math.max(figure.bottom,ty+1);
      }
      if(tx<0||tx>=192||ty<0||ty>=192)continue;
      data.copy(out,((sy+ty)*info.width+sx+tx)*4,from,from+4);
    }
  }
  return {raw:out,width:info.width,height:info.height,figure,shifts};
}

/** Alpha/content checks over every cell, without changing Desktop pixels or synthesizing any pose. */
export async function inspectMovement128(source,label='movement128'){
  return inspectMovementGrid(source,label,16,8);
}
export async function inspectIdle8(source,label='idle8'){
  return inspectMovementGrid(source,label,8,1);
}
async function inspectMovementGrid(source,label,columns,rows){
  const frames=columns*rows;
  const bytes=await readFile(source),image=sharp(bytes),meta=await image.metadata();
  assert.equal(meta.format,'png',`${label}: PNG required`);assert.equal(meta.width,columns*192,`${label}: width${columns*192} required`);
  assert.equal(meta.height,rows*192,`${label}: height${rows*192} required`);assert.equal(meta.hasAlpha,true,`${label}: alpha required`);
  const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const hashes=[],cell=Buffer.alloc(192*192*4),figure={left:192,top:192,right:0,bottom:0};let firstFrameHeight;
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*192,sy=Math.floor(frame/columns)*192;let drawn=0,transparent=0,top=192,bottom=-1;
    for(let y=0;y<192;y++){
      data.copy(cell,y*192*4,((sy+y)*info.width+sx)*4,((sy+y)*info.width+sx+192)*4);
      for(let x=0;x<192;x++){
        const offset=(y*192+x)*4,alpha=cell[offset+3];
        if(alpha===0){transparent++;cell[offset]=cell[offset+1]=cell[offset+2]=0;}
        else if(alpha<255)for(let channel=0;channel<3;channel++)cell[offset+channel]=Math.round(cell[offset+channel]*alpha/255);
        if(alpha<=20)continue;
        assert.ok(x>=2&&x<190&&y>=2&&y<190,`${label}: frame${frame} touches cell edge`);
        drawn++;figure.left=Math.min(figure.left,x);figure.top=Math.min(figure.top,y);
        figure.right=Math.max(figure.right,x+1);figure.bottom=Math.max(figure.bottom,y+1);
        top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
    }
    assert.ok(drawn>0&&transparent>0,`${label}: frame${frame} empty or opaque`);hashes.push(SHA(cell));
    if(frame===0)firstFrameHeight=bottom-top+1;
  }
  assert.equal(new Set(hashes).size,frames,`${label}: all${frames} poses must be distinct`);
  return {source,sourceSha256:SHA(bytes),figure,firstFrameHeight,uniqueFrames:frames};
}

/** Validates every selected character before writing. Merges17 new keys into the existing personagens piece. */
export async function importMovement128({input,outRoot=ROOT,ids=[...FACE_CLASSES],write=false}={}){
  assert.ok(input,'explicit input directory required');input=path.resolve(input);outRoot=path.resolve(outRoot);
  assert.ok(Array.isArray(ids)&&ids.length>0&&ids.every(safeId)&&new Set(ids).size===ids.length,'unique safe character IDs required');
  const manifestFile=path.join(outRoot,SPEC.output,'manifest.json'),indexFile=path.join(outRoot,'public/art/manifest.json');
  const previous=await readManifest(manifestFile),index=await readIndex(indexFile);
  assert.ok(previous&&index?.groups?.personagens,'existing personagens group/index required');
  const records=[];
  for(const id of ids){
    const old=previous.pieces[id],indexed=index.groups.personagens.pieces[id];
    if(old){assert.equal(old.kind,'dir8',`${id}: existing piece kind`);assert.equal(indexed?.kind,'dir8',`${id}: indexed existing hero required`);}
    else assert.equal(indexed,undefined,`${id}: index/group disagreement`);
    const metadataFile=path.join(input,'personagens-movimento128',id,'meta.json'),metadata=await json(metadataFile);
    assert.deepEqual(metadata,MOVEMENT128_META,`${id}: revision06 metadata mismatch`);
    const idle=await inspectIdle8(path.join(input,'personagens-movimento128',id,'idle.png'),`${id}/idle8`);
    const height=idle.firstFrameHeight;
    assert.ok(Number.isFinite(height)&&height>=8&&height<=192,`${id}: native R06 idle-S standing height required`);
    const clips=[];
    for(const motion of ['walk','attack'])for(const direction of DIRECTIONS){
      const inspected=await inspectMovement128(sourcePath(input,id,motion,direction),`${id}/${motion}/${direction}`);
      clips.push({...inspected,motion,direction});
    }
    records.push({id,height,bootstrap:!old,scaleReference:{motion:'idle',direction:'S',source:idle.source,sourceSha256:idle.sourceSha256,sourceHeight:height,gameHeight:height/2},
      metadataFile,metadataSha256:SHA(await readFile(metadataFile)),idle,clips,outputs:[]});
  }
  if(write){
    // Validate-to-commit guard: no manifest changes while another importer is updating the same group.
    assert.deepEqual(await readManifest(manifestFile),previous,'hero manifest changed during R06 validation');
    const entries={};
    for(const record of records){
      const staged=[],files={};
      try{
        assert.equal(SHA(await readFile(record.metadataFile)),record.metadataSha256,`${record.id}: metadata changed during import`);
        for(const clip of [{...record.idle,motion:'idle'},...record.clips]){
          const bytes=await readFile(clip.source);assert.equal(SHA(bytes),clip.sourceSha256,`${record.id}: source changed during import`);
          const idle=clip.motion==='idle',columns=idle?8:16,rows=idle?1:8,count=idle?8:128;
          // Content-addressed names keep every previous manifest usable if a later conversion fails.
          const key=idle?'idle8':`${clip.motion}128-${clip.direction}`;
          // Idle is not shifted. Clips are, so they are named by the WebP bytes: a new alignment never reuses a cached URL.
          const aligned=idle?undefined:await normalizeRootMotion(bytes,`${record.id}/${key}`);
          const encoded=await (aligned?sharp(aligned.raw,{raw:{width:aligned.width,height:aligned.height,channels:4}}):sharp(bytes)).resize(columns*96,rows*96,{kernel:'lanczos3'}).webp(WEBP).toBuffer();
          await checkGamePoses(encoded,`${record.id}/${key}`,columns,count);
          const file=`${record.id}.${idle?'idle8':`${clip.motion}128-${clip.direction.toLowerCase()}`}.${(idle?clip.sourceSha256:SHA(encoded)).slice(0,12)}.webp`,target=path.join(outRoot,SPEC.output,file);
          const tmp=path.join(path.dirname(target),`.${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
          await mkdir(path.dirname(target),{recursive:true});staged.push({tmp,target});await writeFile(tmp,encoded);
          const timing=MOVEMENT128_META.motions[clip.motion],f=aligned?.figure??clip.figure;
          files[key]={file,cell:[96,96],frames:idle?1:128,...(idle?{directions:8,loop:false}:{durationMs:timing.durationMs,fps:128000/timing.durationMs,loop:timing.loop}),
            revision:6,movementHands:'empty',anchor:[.5,.875],height:record.height/2,
            figure:{left:Math.max(0,Math.floor(f.left/2)-2),top:Math.max(0,Math.floor(f.top/2)-2),right:Math.min(96,Math.ceil(f.right/2)+2),bottom:Math.min(96,Math.ceil(f.bottom/2)+2)},
            pages:[{file,columns,rows,firstFrame:0,frameCount:count,sha256:SHA(encoded)}],sha256:SHA(encoded)};
        }
        for(const file of staged){await rename(file.tmp,file.target);record.outputs.push(file.target);}
        entries[record.id]={kind:'dir8',files,...(previous.pieces[record.id]?.meta?{meta:previous.pieces[record.id].meta}:{})};
      }finally{await Promise.all(staged.map(file=>rm(file.tmp,{force:true})));}
    }
    assert.deepEqual(await readManifest(manifestFile),previous,'hero manifest changed during R06 conversion');
    await writeManifest('personagens',SPEC,entries,{outRoot});await writeIndex({personagens:SPEC},{outRoot});
  }
  return {revision:6,dryRun:!write,ids:[...ids],characters:records.map(({id,height,bootstrap,scaleReference,metadataFile,metadataSha256,idle,clips,outputs})=>({id,height,bootstrap,scaleReference,metadataFile,metadataSha256,idle,clips,outputs})),
    cell:[96,96],frames:128,directions:[...DIRECTIONS],motions:MOVEMENT128_META.motions,idle:MOVEMENT128_META.idle};
}

export function parseMovement128Args(args){
  const result={write:false};
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--write')result.write=true;
    else if(arg==='--dry-run')result.write=false;
    else if(['--input','--report','--ids'].includes(arg)){
      const value=args[++i];assert.ok(value&&!value.startsWith('--'),`${arg} needs a value`);
      if(arg==='--ids')result.ids=value.split(',');else result[arg.slice(2)]=value;
    }else throw new Error(`unknown option:${arg}`);
  }
  assert.ok(result.input,'--input required');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  sharp.cache(false);sharp.concurrency(1);
  const {report,...options}=parseMovement128Args(process.argv.slice(2)),result=await importMovement128(options);
  if(report)await writeAtomic(path.resolve(report),JSON.stringify(result,null,2)+'\n');
  console.log(`R06 ${result.dryRun?'validated':'imported'} ${result.ids.length} characters,128 walk+attack frames x8 directions+8 resting poses;96px game cells;legacy/dance preserved.`);
}
