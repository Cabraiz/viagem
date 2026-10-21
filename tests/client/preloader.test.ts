/**
 * The room's pre-download (NEW-20261013-ORQ-3g-precarga-partida): priority order, at most 4 fetches at once (2 on
 * 2g/3g, P2 held until the match starts), abort, failures counted as done, and the ready gate / ring over it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreloader,slowConnection,MAX_FETCHES,SLOW_FETCHES} from '../../src/client/preload/preloader.ts';
import {holdBackground,backgroundHeld} from '../../src/client/preload/background-hold.ts';
import {preloadBlock,preloadRing,preloadText,PRELOAD_CAP_MS} from '../../src/client/preload/ready-gate.ts';
import type {MatchAsset} from '../../src/client/preload/match-assets.ts';

const asset=(url:string,priority:MatchAsset['priority']):MatchAsset=>({url,priority,kind:'hero'});
const tick=()=>new Promise(r=>setImmediate(r));
/** A fetch whose answers the test releases one by one. */
function fakeFetch(fail=new Set<string>()){
  const calls:{url:string;priority:string;signal:AbortSignal;done:()=>void}[]=[];
  let open=0,peak=0;
  const fetch=(url:string,init:{signal:AbortSignal;priority:string})=>new Promise<{ok:boolean;blob():Promise<{size:number}>}>((resolve,reject)=>{
    open++;peak=Math.max(peak,open);
    init.signal.addEventListener('abort',()=>{open--;reject(new Error('aborted'));});
    calls.push({url,priority:init.priority,signal:init.signal,done:()=>{open--;if(fail.has(url))reject(new Error('net'));else resolve({ok:true,blob:async()=>({size:10})});}});
  });
  return {fetch,calls,peak:()=>peak};
}
const list=[asset('/c2','P2'),asset('/a1','P0'),asset('/b1','P1'),asset('/a2','P0'),asset('/b2','P1'),asset('/c1','P2')];

test('priority order, never more than 4 at once, P0 asked with high priority',async()=>{
  const f=fakeFetch();
  const p=createPreloader({fetch:f.fetch,connection:{effectiveType:'4g'}});
  p.add(list);
  await tick();
  assert.deepEqual(f.calls.map(c=>c.url),['/a1','/a2','/b1','/b2']);
  assert.deepEqual(f.calls.map(c=>c.priority),['high','high','auto','auto']);
  while(f.calls.some(c=>!('settled' in c))){
    const c=f.calls.find(x=>!('settled' in x))!;(c as unknown as {settled:boolean}).settled=true;c.done();await tick();
  }
  assert.deepEqual(f.calls.map(c=>c.url),['/a1','/a2','/b1','/b2','/c2','/c1']);
  assert.equal(f.peak(),MAX_FETCHES);
  const pr=p.progress();
  assert.deepEqual([pr.P0.done,pr.P1.done,pr.P2.done,pr.bytes,pr.slow],[2,2,2,60,false]);
  assert.equal(pr.P2.fraction,1);
});

test('adding the same files again downloads only the new ones; a new P0 jumps the queue',async()=>{
  const f=fakeFetch();
  const p=createPreloader({fetch:f.fetch,connection:{}});
  p.add([asset('/x','P1'),asset('/y','P1'),asset('/z','P1'),asset('/w','P1'),asset('/v','P2')]);
  await tick();
  p.add([asset('/x','P1'),asset('/new','P0')]);
  f.calls[0].done();await tick();
  assert.equal(f.calls[4].url,'/new');
  assert.equal(p.progress().P1.total,4);
});

test('failures count as done (with the failure counted) and never throw',async()=>{
  const f=fakeFetch(new Set(['/a1']));
  const p=createPreloader({fetch:f.fetch,connection:{}});
  p.add([asset('/a1','P0'),asset('/a2','P0')]);
  await tick();
  for(const c of [...f.calls])c.done();
  await tick();
  const pr=p.progress().P0;
  assert.deepEqual([pr.done,pr.failed,pr.fraction],[2,1,1]);
  const broken=createPreloader({fetch:()=>{throw new Error('sync');},connection:{}});
  broken.add([asset('/q','P0')]);await tick();
  assert.equal(broken.progress().P0.failed,1);
});

test('abort stops in-flight and queued downloads; later calls do nothing',async()=>{
  const f=fakeFetch();
  const p=createPreloader({fetch:f.fetch,connection:{}});
  p.add(list);await tick();
  p.abort();await tick();
  assert.ok(f.calls.every(c=>c.signal.aborted));
  assert.equal(f.calls.length,4);
  p.add([asset('/late','P0')]);p.release();await tick();
  assert.equal(f.calls.length,4);
  assert.equal(p.progress().P0.done,0);
});

test('2g/3g: 2 at once, P2 only after release (the match start)',async()=>{
  assert.equal(slowConnection({effectiveType:'3g'}),true);
  assert.equal(slowConnection({effectiveType:'slow-2g'}),true);
  assert.equal(slowConnection({effectiveType:'4g'}),false);
  assert.equal(slowConnection(undefined),false);
  const f=fakeFetch();
  const p=createPreloader({fetch:f.fetch,connection:{effectiveType:'3g'}});
  p.add(list);await tick();
  assert.equal(f.calls.length,SLOW_FETCHES);
  for(let i=0;i<4;i++){f.calls[i].done();await tick();}
  assert.deepEqual(f.calls.map(c=>c.url),['/a1','/a2','/b1','/b2']);
  assert.equal(p.progress().slow,true);
  p.release();await tick();
  assert.deepEqual(f.calls.slice(4).map(c=>c.url),['/c2','/c1']);
  assert.ok(f.peak()<=SLOW_FETCHES);
});

test("the page-wide hold (the scene's near art, cena-nasce-rapido): P0 goes on, P1/P2 wait until the last hold goes",async()=>{
  const f=fakeFetch();
  const first=holdBackground(),second=holdBackground();
  assert.equal(backgroundHeld(),true);
  const p=createPreloader({fetch:f.fetch,connection:{effectiveType:'4g'}});
  p.add(list);
  await tick();
  assert.deepEqual(f.calls.map(c=>c.url),['/a1','/a2'],'only P0 while held');
  for(const c of f.calls)c.done();await tick();
  assert.deepEqual(f.calls.map(c=>c.url),['/a1','/a2']);
  first();first();await tick();
  assert.equal(f.calls.length,2,'another hold still taken (and a release counts once)');
  second();await tick();
  assert.equal(backgroundHeld(),false);
  assert.deepEqual(f.calls.map(c=>c.url),['/a1','/a2','/b1','/b2','/c2','/c1'],'the rest in order once free');
  p.abort();
});

test('a file in flight counts by its bytes when the length is known',async()=>{
  let push:((n:number|null)=>void)|undefined;
  const fetch=async()=>({ok:true,headers:{get:(n:string)=>n==='content-length'?'100':null},blob:async()=>({size:0}),
    body:{getReader:()=>({read:()=>new Promise<{done:boolean;value?:{byteLength:number}}>(r=>{push=n=>r(n===null?{done:true}:{done:false,value:{byteLength:n}});})})}});
  const p=createPreloader({fetch,connection:{}});
  p.add([asset('/a','P0'),asset('/b','P0')]);await tick();
  push!(50);await tick();
  assert.equal(p.progress().P0.fraction,.25);
  assert.equal(p.progress().bytes,50);
});

test('ready gate: blocked with the % until P0 is in or the cap passed; the ring follows P0',()=>{
  const pr=(done:number,total:number,fraction=total?done/total:1)=>({P0:{done,total,failed:0,fraction},P1:{done:0,total:0,failed:0,fraction:1},P2:{done:0,total:0,failed:0,fraction:1},bytes:0,slow:false});
  assert.equal(preloadBlock(pr(1,4),1000),'Baixando: 25%');
  assert.equal(preloadBlock(pr(1,4),PRELOAD_CAP_MS),undefined,'after the cap the button is free');
  assert.equal(preloadBlock(pr(4,4),0),undefined);
  assert.equal(preloadBlock(pr(0,0),0),undefined,'nothing to download');
  assert.equal(preloadBlock(undefined,0),undefined);
  assert.equal(preloadText(.999),'Baixando: 99%');
  assert.deepEqual(preloadRing(pr(1,2)),{fraction:.5,done:false});
  assert.deepEqual(preloadRing(pr(2,2)),{fraction:1,done:true});
});
