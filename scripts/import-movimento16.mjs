// M16 gameplay (card movimento16-espelho, 21/10): 16 walk/attack poses and 8 rest poses in 5 drawn directions: S, N and
// ONE side of each pair W×E, NW×NE, SW×SE, chosen per class by the folders delivered (plano B: viciado draws W, NW, SE);
// the game mirrors it into the other side (src/client/sprites/movement128.ts movement16Source). Never replaces
// R06, dance or legacy files: a class without the 15 sheets keeps them. Dry-run is the default.
//   node scripts/import-movimento16.mjs --input <arte-entrada> [--ids viciado-em-bet] [--motions push] [--write] [--report x.json]
// --motions (card empurrar-uno): only these optional motions (run, push, pull, hurt) of each class, the rest of its sheets untouched.
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
    run:{columns:4,rows:4,frames:16,durationMs:600,loop:true},
    // Optional (card empurrar-uno): pushing the Uno, two steps with the hands on its back; placed by the ground walked.
    push:{columns:4,rows:4,frames:16,durationMs:1000,loop:true},
    // Optional (card puxar-uno-corda): pulling the Uno on its rope, two steps, the fists behind the hips; as the push.
    pull:{columns:4,rows:4,frames:16,durationMs:1000,loop:true},
    // Optional (card animacao-receber-dano): a flinch when hit, the rest pose first and last (those two may be equal).
    hurt:{columns:3,rows:2,frames:6,durationMs:300,loop:false}}});
/**
 * A breathing rest (card parado-respiracao-herois): 16 poses in 4×4, the chest rising and the feet planted, played over
 * 3.2 s. The importer takes it when the idle sheet is 768 px tall (4×2 stays the held pose); its poses stay as drawn.
 */
export const IDLE_BREATH=Object.freeze({columns:4,rows:4,frames:16,durationMs:3200,loop:true});
/** The sheet layout of `motion`: the breathing rest for a 4-row idle, else its MOVEMENT16_META entry. */
export const motionSpec=(motion,breath=false)=>motion==='idle'&&breath?IDLE_BREATH:MOVEMENT16_META.motions[motion];
/** The motions every M16 class draws; `run`, `push`, `pull` and `hurt` are optional, all 5 drawn directions or none. */
const MOTIONS=['walk','attack','idle'],OPTIONAL_MOTIONS=['run','push','pull','hurt'];
/** The optional motions placed by their assembler and the ground walked (a phase table next to the sheet). */
const PHASED=new Set(['run','push','pull']);
/** The motions placed by their assembler (no pose moved here): the phased ones, and the hurt (its feet where the rest's are). */
const AS_DRAWN=new Set([...PHASED,'hurt']);
/** A hurt starts and ends on the rest pose: its last cell may repeat its first. */
const distinctPoses=(motion,hashes)=>motion==='hurt'?new Set(hashes.slice(0,-1)).size===hashes.length-1&&hashes.at(-1)!==hashes.at(-2):new Set(hashes).size===hashes.length;
const exists=file=>access(file).then(()=>true,()=>false);
/**
 * A run alone (card corrida-clt): an R06 class (walk128/attack128/idle8 in the manifest) with no walk/attack/idle M16
 * folder but a run/ one. Its run16 is drawn at the idle8's scale (the rest stays R06 and is the size reference).
 */
async function runOnly(input,id,old,optional=OPTIONAL_MOTIONS){
  const any=async m=>(await Promise.all(['S','N','W','E','NW','NE','SW','SE'].map(d=>exists(movement16Source(input,id,m,d))))).some(Boolean);
  if(!(await Promise.all(optional.map(any))).some(Boolean))return false;
  for(const m of MOTIONS)if(await any(m))return false;
  assert.ok(old?.files?.idle8?.revision===6&&Number.isFinite(old.files.idle8.height),`${id}: a run alone needs the class's R06 idle8 (its size reference)`);
  return true;
}
/**
 * A walk alone (card andar-proporcao): an M16 class (idle16-S in the manifest) with a walk/ folder and no attack/ or
 * idle/ one. Only its walk16 is replaced, drawn at the scale of the rest already imported; attack, rest and run stay.
 */
async function walkOnly(input,id,old){
  const any=async m=>(await Promise.all(['S','N','W','E','NW','NE','SW','SE'].map(d=>exists(movement16Source(input,id,m,d))))).some(Boolean);
  if(!await any('walk')||await any('attack')||await any('idle'))return false;
  assert.ok(old?.files?.['idle16-S']?.revision===16&&Number.isFinite(old.files['idle16-S'].height),`${id}: a walk alone needs the class's M16 idle16-S (its size reference)`);
  return true;
}
/**
 * The 5 directions a class draws: S, N and, for each mirror pair, the side delivered in all three motions (the default
 * W/NW/SW when neither is complete, so the validation names what is missing). Both sides delivered: an error, one per pair.
 */
export async function movement16Drawn(input,id,motions=MOTIONS){
  const complete=async d=>(await Promise.all(motions.map(m=>exists(movement16Source(input,id,m,d))))).every(Boolean);
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
/**
 * A run's phase table (optional, next to its sheet; card passo-3x-mais-lento; required for a push, empurrar-uno): per pose, `d` the ground it covers in
 * figure heights and `v` the planted foot's travel in 96 px cell px ([0,0] in flight). The game picks the pose by the
 * ground walked and shifts the sprite by the part of `v` already walked, so the planted foot stays put.
 */
async function readPhase(file,label,motion='run'){
  // a push has no other way to play (movement128 hasPush16 needs the table): required there
  if(!await exists(file)){assert.ok(motion!=='push'&&motion!=='pull',`${label}: a ${motion} needs its phase table (${path.basename(file)})`);return undefined;}
  const phase=JSON.parse(await readFile(file,'utf8')),n=MOVEMENT16_META.motions[motion].frames;
  assert.ok(Array.isArray(phase.d)&&phase.d.length===n&&phase.d.every(x=>Number.isFinite(x)&&x>0&&x<1),`${label}: phase.d needs ${n} distances in (0, 1)`);
  assert.ok(Array.isArray(phase.v)&&phase.v.length===n&&phase.v.every(p=>Array.isArray(p)&&p.length===2&&p.every(x=>Number.isFinite(x)&&Math.abs(x)<24)),`${label}: phase.v needs ${n} [x, y] shifts under 24 px`);
  return {d:phase.d,v:phase.v};
}

/** Every cell drawn, transparent somewhere and 2 px off the edge (alpha > 20); walk/attack poses all distinct. */
export async function inspectMovement16(source,motion,label=`${motion}`){
  const bytes=await readFile(source),image=sharp(bytes),meta=await image.metadata();
  const breath=motion==='idle'&&meta.height===IDLE_BREATH.rows*192,{columns,rows,frames}=motionSpec(motion,breath);
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
  // The 4×2 rest may hold a pose; a walk, a swing or a breathing rest with repeated cells is not its poses.
  if(motion!=='idle'||breath)assert.ok(distinctPoses(motion,hashes),`${label}: all ${frames} poses must be distinct`);
  return {source,sourceSha256:SHA(bytes),firstFrameHeight,uniqueFrames:new Set(hashes).size,...(breath?{breath}:{})};
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
export async function alignMovement16(bytes,motion,label=motion,breath=false){
  const {columns,frames}=motionSpec(motion,breath);
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // A run is placed by its assembler (torso on x 96, each pose at the height it flies, the planted foot measured in
  // run/<dir>.phase.json): moving a pose would move that foot, so it stays as drawn. A breathing rest too: its feet are
  // planted and its head sways, so the torso band moves while nothing may slide.
  const anchors=poseAnchors(data,info.width,columns,frames),shifts=rootMotionShifts(anchors).map(s=>AS_DRAWN.has(motion)||breath?{dx:0,dy:0}:s);
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
async function checkGamePoses(encoded,motion,label,breath=false){
  const {columns,frames}=motionSpec(motion,breath);
  const {data,info}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true}),hashes=[],cell=Buffer.alloc(96*96*4);
  for(let frame=0;frame<frames;frame++){
    const sx=frame%columns*96,sy=Math.floor(frame/columns)*96;
    for(let y=0;y<96;y++)data.copy(cell,y*96*4,((sy+y)*info.width+sx)*4,((sy+y)*info.width+sx+96)*4);
    for(let i=0;i<cell.length;i+=4)if(cell[i+3]<255)for(let c=0;c<3;c++)cell[i+c]=Math.round(cell[i+c]*cell[i+3]/255);
    hashes.push(SHA(cell));
  }
  if(motion!=='idle'||breath)assert.ok(distinctPoses(motion,hashes),`${label}: 96px game output must retain ${frames} distinct poses`);
}

/** Validates every selected class before writing; merges its 15 M16 keys into the personagens piece (R06 stays). */
export async function importMovement16({input,outRoot=ROOT,ids,write=false,motions}={}){
  assert.ok(input,'explicit input directory required');input=path.resolve(input);outRoot=path.resolve(outRoot);
  assert.ok(Array.isArray(ids)&&ids.length>0&&ids.every(safeId)&&new Set(ids).size===ids.length,'--ids: unique safe character IDs required');
  assert.ok(motions===undefined||Array.isArray(motions)&&motions.length>0&&motions.every(m=>OPTIONAL_MOTIONS.includes(m)),`--motions: some of ${OPTIONAL_MOTIONS.join(', ')}`);
  const manifestFile=path.join(outRoot,SPEC.output,'manifest.json'),indexFile=path.join(outRoot,'public/art/manifest.json');
  const previous=await readManifest(manifestFile),index=await readIndex(indexFile);
  assert.ok(previous&&index?.groups?.personagens,'existing personagens group/index required');
  const records=[];
  for(const id of ids){
    const old=previous.pieces[id];
    if(old)assert.equal(old.kind,'dir8',`${id}: existing piece kind`);
    else assert.equal(index.groups.personagens.pieces[id],undefined,`${id}: index/group disagreement`);
    // --motions: those sheets alone, at the class's own scale (its M16 idle-S, else its R06 idle8), the others kept.
    const alone=!!motions,only=alone||await runOnly(input,id,old),walk=!only&&await walkOnly(input,id,old),clips=[];
    const onlyMotions=alone?motions:(await Promise.all(OPTIONAL_MOTIONS.map(async m=>await runOnly(input,id,old,[m])&&m))).filter(Boolean);
    const drawn=await movement16Drawn(input,id,only?onlyMotions.slice(0,1):walk?['walk']:MOTIONS);
    const optional=[];
    for(const motion of only?onlyMotions:walk?[]:OPTIONAL_MOTIONS){
      const has=await Promise.all(drawn.map(d=>exists(movement16Source(input,id,motion,d))));
      assert.ok(has.every(Boolean)||!has.some(Boolean),`${id}: ${motion} needs all of ${drawn.join(' ')} or none`);
      if(has[0])optional.push(motion);
    }
    const imported=only?optional:walk?['walk']:[...MOTIONS,...optional];
    for(const motion of imported)for(const direction of drawn){
      const source=movement16Source(input,id,motion,direction),phase=PHASED.has(motion)?await readPhase(source.replace(/\.png$/,'.phase.json'),`${id}/${motion}/${direction}`,motion):undefined;
      clips.push({...await inspectMovement16(source,motion,`${id}/${motion}/${direction}`),motion,direction,...(phase?{phase}:{})});
    }
    // The scale reference is the first rest pose facing S (alpha > 20, native px), shared by the 15 sheets; a run alone
    // keeps the R06 rest's (idle8 height, 96 px cells), the run drawn at that scale; a walk alone the M16 rest's.
    const height=only?(old?.files?.['idle16-S']?.height??old?.files?.idle8?.height)*2:walk?old.files['idle16-S'].height*2:clips.find(c=>c.motion==='idle'&&c.direction==='S').firstFrameHeight;
    assert.ok(Number.isFinite(height)&&height>=8&&height<=192,`${id}: M16 idle-S standing height required`);
    records.push({id,height,runOnly:only,walkOnly:walk,alone,motions:imported,bootstrap:!old,drawn,mirrored:Object.fromEntries(MOVEMENT16_META.pairs.map(([a,b])=>drawn.includes(a)?[b,a]:[a,b])),clips,outputs:[]});
  }
  if(write){
    assert.deepEqual(await readManifest(manifestFile),previous,'hero manifest changed during M16 validation');
    const entries={};
    for(const record of records){
      const staged=[],files={};
      try{
        for(const clip of record.clips){
          const bytes=await readFile(clip.source);assert.equal(SHA(bytes),clip.sourceSha256,`${record.id}: source changed during import`);
          const m=motionSpec(clip.motion,clip.breath),key=`${clip.motion}16-${clip.direction}`;
          const aligned=await alignMovement16(bytes,clip.motion,`${record.id}/${key}`,clip.breath);
          const encoded=await sharp(aligned.raw,{raw:{width:aligned.width,height:aligned.height,channels:4}}).resize(m.columns*96,m.rows*96,{kernel:'lanczos3'}).webp(WEBP).toBuffer();
          await checkGamePoses(encoded,clip.motion,`${record.id}/${key}`,clip.breath);
          // Named by the WebP bytes (the alignment changes them without changing the source): no stale cached URL.
          const file=`${record.id}.${clip.motion}16-${clip.direction.toLowerCase()}.${SHA(encoded).slice(0,12)}.webp`,target=path.join(outRoot,SPEC.output,file);
          const tmp=path.join(path.dirname(target),`.${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
          await mkdir(path.dirname(target),{recursive:true});staged.push({tmp,target});await writeFile(tmp,encoded);
          const f=aligned.figure;
          files[key]={file,cell:[96,96],frames:m.frames,durationMs:m.durationMs,fps:m.frames*1000/m.durationMs,loop:m.loop,
            revision:16,movementHands:'empty',anchor:[.5,.875],height:record.height/2,pivotX:Math.round(aligned.pivotX/2*100)/100,
            figure:{left:Math.max(0,Math.floor(f.left/2)-2),top:Math.max(0,Math.floor(f.top/2)-2),right:Math.min(96,Math.ceil(f.right/2)+2),bottom:Math.min(96,Math.ceil(f.bottom/2)+2)},
            pages:[{file,columns:m.columns,rows:m.rows,firstFrame:0,frameCount:m.frames,sha256:SHA(encoded)}],sha256:SHA(encoded)};
          // A hurt pivots where its class's rest does (its assembler put the feet in the rest's cell spot): the flinch
          // starts and ends on the rest pose without a sideways jump. Its rest: the M16 idle16-<dir>, else the R06 idle8.
          if(clip.motion==='hurt'){
            const rest=previous.pieces[record.id]?.files?.[`idle16-${clip.direction}`]??previous.pieces[record.id]?.files?.idle8;
            const pivot=rest?.pivotX??(rest?.anchor?.[0]??.5)*96;
            assert.ok(Number.isFinite(pivot)&&pivot>0&&pivot<96,`${record.id}/${key}: the rest's pivot`);files[key].pivotX=pivot;
          }
          clip.pivotX=files[key].pivotX;
          if(clip.phase)files[key].phase=clip.phase;
        }
        // The other side of each pair is mirrored now: a key it had from an earlier import goes (null drops it in the merge).
        for(const motion of record.alone?motions:record.walkOnly?record.motions:[...MOTIONS,...OPTIONAL_MOTIONS])for(const d of Object.keys(record.mirrored))if(previous.pieces[record.id]?.files?.[`${motion}16-${d}`])files[`${motion}16-${d}`]=null;
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
    else if(['--input','--report','--ids','--out','--motions'].includes(arg)){
      const value=args[++i];assert.ok(value&&!value.startsWith('--'),`${arg} needs a value`);
      if(arg==='--ids')result.ids=value.split(',');else if(arg==='--motions')result.motions=value.split(',');else if(arg==='--out')result.outRoot=value;else result[arg.slice(2)]=value;
    }else throw new Error(`unknown option: ${arg}`);
  }
  assert.ok(result.input,'--input required');assert.ok(result.ids,'--ids required (e.g. --ids viciado-em-bet)');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  sharp.cache(false);sharp.concurrency(1);
  const {report,...options}=parseMovement16Args(process.argv.slice(2)),result=await importMovement16(options);
  if(report)await writeAtomic(path.resolve(report),JSON.stringify(result,null,2)+'\n');
  console.log(`M16 ${result.dryRun?'validated':'imported'} ${result.characters.map(c=>`${c.id} (${c.drawn.join(' ')}; mirrored ${Object.entries(c.mirrored).map(([to,from])=>`${to}←${from}`).join(' ')}${c.runOnly?`; ${c.motions.join('+')} only`:''}${c.walkOnly?'; walk only, on its M16 rest':''})`).join(', ')}: ${result.characters.every(c=>c.runOnly)?`${[...new Set(result.characters.flatMap(c=>c.motions))].map(m=>`${MOVEMENT16_META.motions[m].frames} ${m}`).join(' + ')} poses`:result.characters.every(c=>c.walkOnly)?'16 walk poses':`16 walk+attack poses and ${result.characters.every(c=>c.clips.some(k=>k.breath))?'16 breathing':'8'} rest poses`} x 5 drawn directions; 96px game cells; R06/legacy preserved.`);
}
