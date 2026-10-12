/** Economy mode (VGM-048): settings that survive a broken storage, the FPS watch and the 30 fps gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ECONOMY_KEY,DEFAULT_ECONOMY,loadEconomy,saveEconomy,toggleEconomy,autoEconomy,renderProfile,frameGateMs,FpsWatch,FPS_WATCH,type KeyValue} from '../src/game/economy.ts';

const memory=():KeyValue&{data:Map<string,string>}=>{const data=new Map<string,string>();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}};};
const broken:KeyValue={getItem:()=>{throw new Error('SecurityError');},setItem:()=>{throw new Error('QuotaExceededError');}};

test('settings: default off, saved and read back, broken or missing storage never throws',()=>{
  const store=memory();
  assert.deepEqual(loadEconomy(store),DEFAULT_ECONOMY);
  assert.equal(saveEconomy(store,{on:true,auto:false,declined:false}),true);
  assert.deepEqual(loadEconomy(store),{on:true,auto:false,declined:false});
  assert.deepEqual(loadEconomy(broken),DEFAULT_ECONOMY);
  assert.equal(saveEconomy(broken,{on:true,auto:false,declined:false}),false);
  assert.deepEqual(loadEconomy(null),DEFAULT_ECONOMY);assert.equal(saveEconomy(undefined,DEFAULT_ECONOMY),false);
  for(const junk of ['{','null','42','"on"','{"on":"yes","auto":true}']){store.data.set(ECONOMY_KEY,junk);assert.deepEqual(loadEconomy(store),DEFAULT_ECONOMY,junk);}
  store.data.set(ECONOMY_KEY,'{"on":false,"auto":true,"declined":true}');
  assert.deepEqual(loadEconomy(store),{on:false,auto:false,declined:true},'auto only means something while on');
});

test('the watch turns it on once; turning that off is remembered, a tap still works',()=>{
  let s=loadEconomy(memory());
  const auto=autoEconomy(s);assert.deepEqual(auto,{on:true,auto:true,declined:false});s=auto!;
  assert.equal(autoEconomy(s),undefined,'already on');
  s=toggleEconomy(s,false);assert.deepEqual(s,{on:false,auto:false,declined:true});
  assert.equal(autoEconomy(s),undefined,'the player said no: never again on this phone');
  s=toggleEconomy(s,true);assert.deepEqual(s,{on:true,auto:false,declined:true},'a tap turns it on anyway');
  s=toggleEconomy(s,false);assert.deepEqual(s,{on:false,auto:false,declined:true});
  // Turned on by hand and off by hand: the watch may still help later.
  assert.deepEqual(toggleEconomy(toggleEconomy(DEFAULT_ECONOMY,true),false),{on:false,auto:false,declined:false});
});

test('profiles: economy is 30 fps with the reduced effects budget',()=>{
  assert.deepEqual(renderProfile(false),{fps:60,effects:'full'});
  assert.deepEqual(renderProfile(true),{fps:30,effects:'reduced'});
});

/** Phaser's TimeStep.stepLimitFPS: deltas add up and a frame is drawn when they reach the gate. */
function drawn(gate:number,rafMs:number,seconds:number,jitter=0){
  let acc=0,frames=0,seed=3;const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648-.5)*2;
  for(let t=0;t<seconds*1000;t+=rafMs){const d=rafMs+jitter*rnd();acc+=d;if(acc>=gate){frames++;acc=0;}}
  return frames/seconds;
}
test('frame gate: 30 fps on 60, 90 and 120 Hz screens even with rAF jitter; 60 stays 60',()=>{
  for(const hz of [60,120]){
    const fps30=drawn(frameGateMs(30),1000/hz,20,1.2);assert.ok(fps30>=29&&fps30<=31,`${hz} Hz: ${fps30} fps at 30`);
    const fps60=drawn(frameGateMs(60),1000/hz,20,1.2);assert.ok(fps60>=58&&fps60<=61,`${hz} Hz: ${fps60} fps at 60`);
  }
  // The plain 1000/30 gate drops to 20 fps every time a 60 Hz frame comes a hair early: the reason for the margin.
  assert.ok(drawn(1000/30,1000/60,20,1.2)<28);
  const at90=drawn(frameGateMs(30),1000/90,20,1.2);assert.ok(at90>=29&&at90<=31,`90 Hz: ${at90}`);
});

/** Feeds `ms` of frames at `fps`, each ± `jitter` ms (deterministic); returns how many times the watch fired. */
function feed(w:FpsWatch,fps:number,ms:number,jitter=0){
  let fired=0,seed=11;const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648-.5)*2;
  for(let t=0;t<ms;){const d=1000/fps+jitter*rnd();t+=d;if(w.frame(d))fired++;}
  return fired;
}
test('FPS watch: warm-up, two slow windows in a row, then once; a good window breaks the streak',()=>{
  const w=new FpsWatch();
  assert.equal(feed(w,20,FPS_WATCH.warmupMs),0,'warm-up never fires');
  assert.equal(feed(w,20,FPS_WATCH.windowMs,6),0,'one slow window is not enough');
  assert.equal(feed(w,55,FPS_WATCH.windowMs),0,'a good window resets the count');
  assert.equal(feed(w,22,FPS_WATCH.windowMs,8),0);
  assert.equal(feed(w,22,FPS_WATCH.windowMs+50,8),1,'second slow window in a row: fires');
  assert.equal(w.done,true);assert.equal(feed(w,10,20_000),0,'fires once');
  assert.ok(w.history.length>=4&&w.history.every(f=>f>0));
  // A phone that keeps 45 fps never gets it.
  assert.equal(feed(new FpsWatch(),45,60_000,3),0);
  // Paused or out of combat: reset() starts the warm-up over.
  const r=new FpsWatch();feed(r,20,FPS_WATCH.warmupMs+FPS_WATCH.windowMs*1.5,6);r.reset();
  assert.equal(feed(r,20,FPS_WATCH.warmupMs+FPS_WATCH.windowMs,6),0);
});

test('FPS watch: a window with a rAF pause over 250 ms or a hidden moment does not count, either way',()=>{
  const w=new FpsWatch();feed(w,60,FPS_WATCH.warmupMs);
  assert.equal(feed(w,22,FPS_WATCH.windowMs,8),0,'one slow window');
  // The notification shade: 20 fps with one 400 ms stop. Thrown away (not a 2nd slow window, not a good one).
  feed(w,22,2000,8);w.frame(400);assert.equal(feed(w,22,FPS_WATCH.windowMs-2400,8),0,'tainted window: no fire');
  assert.equal(w.ignored,1);
  // Hidden for a moment (the scene calls taint()): thrown away too.
  feed(w,22,1000,8);w.taint();assert.equal(feed(w,22,FPS_WATCH.windowMs,8),0);
  assert.ok(w.ignored>=2);
  // The streak survived the ignored windows: the next clean slow window fires.
  assert.equal(feed(w,22,FPS_WATCH.windowMs+50,8),1);
  // A phone stuck at 2 fps has a pause in every window: the watch never decides for it (the switch is still there).
  assert.equal(feed(new FpsWatch(),2,60_000),0);
});

test('FPS watch: a steady 30 Hz rAF (iOS Low Power Mode) is a cap, not choking',()=>{
  const capped=new FpsWatch();
  assert.equal(feed(capped,30,120_000,1.5),0,'steady 33 ms frames: never');
  assert.ok(capped.capped>=20,`${capped.capped} windows read as a 30 Hz cap`);
  // A choking phone around 30 fps is not steady (frames 20–50 ms): it still gets it.
  assert.equal(feed(new FpsWatch(),30,60_000,15),1);
  // 20 fps steady is under the cap: slow.
  assert.equal(feed(new FpsWatch(),20,60_000,1),1);
});

test('the world canvas has no resolution knob (DPR 1 under the cap of 2); the HUD stays DOM',()=>{
  const scene=readFileSync(new URL('../src/game/scene.ts',import.meta.url),'utf8');
  const config=scene.slice(scene.indexOf('new Phaser.Game('),scene.indexOf('scene:[scene]})'));
  assert.ok(config.length>0);
  assert.doesNotMatch(config,/resolution|devicePixelRatio/,'a DPR above 2 would make the canvas 9× the pixels of DPR 1');
  assert.match(config,/fps:\{target:60,limit:60\}/,'the frame gate setEconomy changes');
});
