// No upload spike in a fight (card NEW-20261018-ORQ-upload-fora-partida, estudo-desempenho F1): the per-frame budget of
// the upload queue, and the loader patch (decode with createImageBitmap, complete from the queue, Phaser's path otherwise).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UPLOAD_BUDGET_PX,UploadQueue,installUploadQueue,uploads} from '../../src/client/preload/upload-queue.ts';

test('one big sheet per frame; small icons share a frame', () => {
  const q=new UploadQueue(),ran:string[]=[];
  q.push(3_000_000,()=>ran.push('death'));q.push(2_000_000,()=>ran.push('walk'));
  for(let i=0;i<10;i++)q.push(64*64,()=>ran.push(`icon${i}`));
  assert.equal(q.tick(),1);assert.deepEqual(ran,['death']); // bigger than the budget: alone, but it goes
  assert.equal(q.tick(),1);assert.deepEqual(ran.at(-1),'walk');
  assert.equal(q.tick(),10);assert.equal(q.size,0);
});

test('a frame stops before the sheet that would pass the budget', () => {
  const q=new UploadQueue(),ran:number[]=[];
  q.push(UPLOAD_BUDGET_PX*.6,()=>ran.push(1));q.push(UPLOAD_BUDGET_PX*.6,()=>ran.push(2));q.push(10,()=>ran.push(3));
  assert.equal(q.tick(),1);assert.equal(q.tick(),2);assert.deepEqual(ran,[1,2,3]);
});

test('a throwing upload does not stop the queue; flush runs everything', () => {
  const q=new UploadQueue(),ran:number[]=[];
  q.push(10,()=>{throw new Error('x');});q.push(UPLOAD_BUDGET_PX*2,()=>ran.push(1));q.push(UPLOAD_BUDGET_PX*2,()=>ran.push(2));
  const err=console.error;console.error=()=>{};try{q.flush();}finally{console.error=err;}
  assert.deepEqual(ran,[1,2]);assert.equal(q.size,0);
});

test('the loader patch decodes off the main thread and completes from the queue, one big sheet per frame', async () => {
  const frames:(()=>void)[]=[];
  class ImageFile{state=0;data:unknown;loader:unknown={};xhrLoader:{response?:unknown};done=0;fallback=0;constructor(response:unknown){this.xhrLoader={response};}
    onProcess(){this.fallback++;}onProcessComplete(){this.done++;}onProcessError(){}}
  const bitmaps:{width:number;height:number;close():void}[]=[];
  const win={createImageBitmap:(async (b:Blob)=>{const size=Number(await b.text());const bm={width:size,height:size,close(){}};bitmaps.push(bm);return bm;}) as unknown as typeof createImageBitmap,
    requestAnimationFrame:(cb:()=>void)=>{frames.push(cb);return frames.length;},document:{hidden:false}};
  assert.equal(installUploadQueue({Loader:{FileTypes:{ImageFile},FILE_PROCESSING:3}} as never,win),true);
  const big=[new ImageFile(new Blob(['1500'])),new ImageFile(new Blob(['1500']))],data=new ImageFile('not a blob');
  for(const f of big)f.onProcess();data.onProcess();
  assert.equal(data.fallback,1); // Phaser's own path
  await new Promise(r=>setTimeout(r,10));
  assert.equal(big[0].state,3);assert.equal(big[0].data,bitmaps[0]);assert.equal(big[0].done,0); // decoded, waiting for a frame
  frames.shift()!();assert.deepEqual(big.map(f=>f.done),[1,0]);
  frames.shift()!();assert.deepEqual(big.map(f=>f.done),[1,1]);
  assert.equal(uploads.size,0);assert.equal(frames.length,0);
  assert.equal(installUploadQueue({Loader:{FileTypes:{ImageFile},FILE_PROCESSING:3}} as never,win),false); // once
});

test('Q4: out of combat the frame budget is the warm-up one; in combat one big sheet a frame', async () => {
  const {WARMUP_BUDGET_PX,setUploadBudget,uploadBudget}=await import('../../src/client/preload/upload-queue.ts');
  const {warmBudget}=await import('../../src/client/preload/warm-up.ts');
  assert.equal(warmBudget('combat'),UPLOAD_BUDGET_PX);
  for(const phase of ['lobby','countdown','result',undefined])assert.equal(warmBudget(phase),WARMUP_BUDGET_PX,String(phase));
  assert.ok(WARMUP_BUDGET_PX>=3*UPLOAD_BUDGET_PX);
  setUploadBudget(WARMUP_BUDGET_PX);assert.equal(uploadBudget(),WARMUP_BUDGET_PX);
  setUploadBudget(Number.NaN);assert.equal(uploadBudget(),UPLOAD_BUDGET_PX,'a bad value falls back to the combat budget');
  // Three walk clips (1536×768 each) in one warm-up frame, one in a combat frame.
  const q=new UploadQueue();for(let i=0;i<3;i++)q.push(1536*768,()=>{});
  assert.equal(q.tick(WARMUP_BUDGET_PX),3);
  for(let i=0;i<3;i++)q.push(1536*768,()=>{});
  assert.equal(q.tick(UPLOAD_BUDGET_PX),1);
});
