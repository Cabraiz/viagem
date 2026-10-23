// Card NEW-20261022-ORQ-corrida-proporcao-contorno: every movement sheet draws the hero at the rest pose's size, and every
// looping clip closes its loop (scripts/proporcao.mjs). The user saw the viciado's run with a smaller head and a thinner
// body than standing ("tomou Mounjaro"), and the run's last pose not matching its first.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {GATED,SEAM_MAX,TOL,cells,headScale,measureClass,measuredClasses,poseDistance,seam,shape,verdict} from '../../scripts/proporcao.mjs';

const manifest=JSON.parse(readFileSync('public/art/sprites/manifest.json','utf8'));
const sharp=createRequire(import.meta.url)('sharp');
const classes:string[]=measuredClasses(manifest);
assert.ok(classes.includes('clt-cansado'),'the CLT runs (corrida-clt): its run is measured against its idle8');
/**
 * Walks drawn before this gate (movimento16-espelho, 21/10) that miss it. The walk only shows with HERO_GAIT.run off: the
 * viciado runs. A fixed one leaves the list (the test asks for that), a new miss fails.
 */
const KNOWN_WALK:Record<string,readonly string[]>={};

test('the meter finds a known scale: the rest pose shrunk to 80 % reads a head of 0.8 (±2.5 %)',async()=>{
  const files=manifest.pieces['viciado-em-bet'].files,idle=files['idle16-S'];
  const [rest]=await cells(`public/art/sprites/${idle.file}`,1),restShape=shape(rest);
  for(const k of [.8,1,1.15]){
    const size=Math.round(96*k),left=Math.round((96-size)/2),top=Math.round(84-84*k);
    let cell=await sharp(`public/art/sprites/${idle.file}`).extract({left:0,top:0,width:96,height:96}).resize(size,size,{kernel:'lanczos3'}).png().toBuffer();
    // grown past the cell: keep the 96 px window around the feet
    if(size>96)cell=await sharp(cell).extract({left:-left,top:-top,width:96,height:96}).png().toBuffer();
    const file=join(tmpdir(),`proporcao-${process.pid}-${k}.png`);
    await sharp({create:{width:96,height:96,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:cell,left:Math.max(0,left),top:Math.max(0,top)}]).png().toFile(file);
    const [img]=await cells(file,1),h=headScale(rest,restShape,img,shape(img));
    assert.ok(Math.abs(h.scale-k)<=.025,`scale ${k}: read ${h.scale}`);assert.ok(h.iou>.9,`iou ${h.iou}`);
  }
});

test('the loop seam: a clip played in order closes, a clip cut in the middle shows its jump',async()=>{
  const files=manifest.pieces['viciado-em-bet'].files,run=files['run16-W'];
  const frames=await cells(`public/art/sprites/${run.file}`,16),shapes=frames.map(a=>shape(a));
  assert.equal(poseDistance(frames[0],frames[0],shapes[0],shapes[0]),0);
  const ok=seam(frames,shapes);assert.equal(ok.steps.length,16);
  // dropping the 4 poses before the seam leaves a jump there
  const cut=seam(frames.slice(0,12),shapes.slice(0,12));
  assert.ok(cut.seam>ok.seam,`cut ${cut.seam} > whole ${ok.seam}`);
});

for(const id of classes)test(`${id}: every run pose at the rest pose's head and height (±${TOL.head*100} %), every loop closed (≤ ${SEAM_MAX}× the median step)`,async()=>{
  const m=await measureClass(manifest,id),bad=verdict(m);
  const walk=bad.filter((b:string)=>b.includes(' walk16-')),rest=bad.filter((b:string)=>!b.includes(' walk16-'));
  assert.deepEqual(rest,[],`${id}:\n${rest.join('\n')}`);
  assert.deepEqual(walk,[...KNOWN_WALK[id]??[]],`${id} walk16 (KNOWN_WALK):\n${walk.join('\n')}`);
  for(const [d,e] of Object.entries(m.dirs) as [string,{clips:Record<string,{frames:{headIou:number}[]}>}][])
    for(const [motion,c] of Object.entries(e.clips))if(motion!=='idle')
      assert.ok(c.frames.every(f=>f.headIou>.8),`${id} ${motion}16-${d}: the head fit holds (IoU > 0.8)`);
  assert.deepEqual(GATED,['head','height']);
});
