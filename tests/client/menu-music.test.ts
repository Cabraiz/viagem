/**
 * Menu music (NEW-20261014-ORQ-musica-do-menu): the boot's gating (load -> idle -> delay, skipped on 2g/Save-Data),
 * the scene machine menu -> match -> menu with its fades, the download yielding (aborted) to the match's pre-download
 * and to the match, mute and the hidden tab. Fake <audio> and WebAudio (Node has no DOM).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MENU_IN_S,MENU_LEVEL,MENU_OUT_S,MENU_TRACK,MenuMusic,sceneOfPhase} from '../../src/client/audio/menu-music.ts';
import {MENU_BOOT_DELAY_MS,scheduleMenuMusic,skipMenuMusic} from '../../src/client/ui/menu-music-boot.ts';
import {preloadDone,type PreloadProgress} from '../../src/client/preload/preloader.ts';
import type {MusicElement,MusicEngine} from '../../src/client/audio/music.ts';

type Call=[string,...number[]];
class FakeParam {
  value=0;calls:Call[]=[];
  setValueAtTime(v:number,t:number){this.calls.push(['set',v,t]);this.value=v;}
  linearRampToValueAtTime(v:number,t:number){this.calls.push(['linear',v,t]);}
  cancelScheduledValues(t:number){this.calls.push(['cancel',t]);}
}
class FakeNode {connected:unknown[]=[];connect(d:unknown){this.connected.push(d);return d;}disconnect(){}}
class FakeGain extends FakeNode {gain=new FakeParam();}
class FakeCtx {
  currentTime=10;gains:FakeGain[]=[];
  createGain(){const g=new FakeGain();this.gains.push(g);return g;}
  createMediaElementSource(){return new FakeNode();}
}
class FakeAudio implements MusicElement {
  src='';loop=false;preload='none';currentTime=0;paused=true;plays=0;
  canPlayType(type:string){return type==='audio/webm; codecs="opus"'?'probably':'';}
  play(){this.plays++;this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
  load(){}
  removeAttribute(name:string){if(name==='src')this.src='';}
}
class FakeEngine implements MusicEngine {
  unlocked=false;ctx:FakeCtx|undefined;musicBus=new FakeNode();settings={music:{volume:.7,muted:false}};
  listeners=new Set<()=>void>();
  get context(){return this.ctx as unknown as AudioContext|undefined;}
  get musicOutput(){return this.ctx?this.musicBus as unknown as AudioNode:undefined;}
  onChange(l:()=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
  attachUnlock(target:EventTarget){
    const h=()=>{if(!this.unlocked){this.unlocked=true;this.ctx=new FakeCtx();}};
    target.addEventListener('pointerup',h);
    return ()=>target.removeEventListener('pointerup',h);
  }
  set(patch:Partial<{volume:number;muted:boolean}>){this.settings={music:{...this.settings.music,...patch}};for(const l of [...this.listeners])l();}
}
class FakePage extends EventTarget {visibilityState='visible';}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

/** A menu whose downloads stay pending until `answer()`; each records its abort signal. */
function rig(){
  const audio=new FakeAudio(),engine=new FakeEngine(),page=new FakePage(),menu=new MenuMusic();
  const asks:{url:string;signal?:AbortSignal;answer:()=>void}[]=[],revoked:string[]=[];
  const timers:{fn:()=>void;ms:number;live:boolean}[]=[];
  const boot=()=>menu.boot(page,{engine,createElement:()=>audio,
    fetchUrl:(url,signal)=>new Promise(resolve=>{asks.push({url,signal,answer:()=>resolve(`blob:${url}#${asks.length}`)});}),
    revokeUrl:url=>{revoked.push(url);},
    setTimer:(fn,ms)=>{const t={fn,ms,live:true};timers.push(t);return t;},
    clearTimer:t=>{(t as {live:boolean}).live=false;}});
  const fire=()=>{for(const t of [...timers])if(t.live){t.live=false;t.fn();}};
  const tap=()=>page.dispatchEvent(new Event('pointerup'));
  const gain=()=>engine.ctx!.gains[0]!.gain;
  return {audio,engine,page,menu,asks,revoked,timers,boot,fire,tap,gain};
}

test('boot gating: nothing before the load event, then idle, then the delay; 2g, slow-2g and Save-Data skip it all',()=>{
  const log:string[]=[];let onLoad:(()=>void)|undefined,idle:(()=>void)|undefined,timer:{fn:()=>void;ms:number}|undefined;
  const deps=(connection?:{effectiveType?:string;saveData?:boolean},loaded=false)=>({connection,loaded,
    onLoad:(fn:()=>void)=>{onLoad=fn;},idle:(fn:()=>void)=>{idle=fn;},setTimer:(fn:()=>void,ms:number)=>{timer={fn,ms};},start:()=>log.push('start')});
  assert.equal(scheduleMenuMusic(deps({effectiveType:'3g'})),true);
  assert.ok(onLoad);assert.equal(idle,undefined);assert.deepEqual(log,[]);
  onLoad!();assert.ok(idle);assert.equal(timer,undefined,'waits for idle time');
  idle!();assert.equal(timer!.ms,MENU_BOOT_DELAY_MS);assert.deepEqual(log,[]);
  timer!.fn();assert.deepEqual(log,['start']);
  for(const c of [{effectiveType:'2g'},{effectiveType:'slow-2g'},{effectiveType:'4g',saveData:true}]){
    assert.equal(skipMenuMusic(c),true);
    onLoad=idle=undefined;
    assert.equal(scheduleMenuMusic(deps(c,true)),false);assert.equal(idle,undefined,'no chunk, no file');
  }
  assert.equal(skipMenuMusic(undefined),false,'no Network Information API (Safari, Firefox): plays');
  idle=undefined;scheduleMenuMusic(deps(undefined,true));assert.ok(idle,'already loaded: straight to idle');
});

test('nothing before boot: scenes and holds are remembered, no element and no fetch',()=>{
  const {menu,asks,boot}=rig();
  assert.equal(menu.track,undefined);
  menu.setScene('match');const release=menu.hold();
  assert.deepEqual(asks,[]);
  boot();
  assert.deepEqual(asks,[],'booted in the match with a hold: still nothing');
  release();
  assert.deepEqual(asks,[],'still the match');
  menu.setScene('menu');
  assert.deepEqual(asks.map(a=>a.url),[MENU_TRACK.webm]);
});

test('menu -> match -> menu: plays from the first tap at 35 %, fades out 1.5 s into the match, fades back in',async()=>{
  const {audio,menu,asks,boot,tap,fire,gain}=rig();
  boot();
  assert.equal(menu.track!.state,'loading');assert.ok(asks[0]!.signal,'abortable');
  asks[0]!.answer();await flush();
  assert.equal(menu.track!.state,'playing');assert.equal(audio.paused,true,'no gesture yet: silent');
  assert.equal(audio.loop,true);
  tap();await flush();
  assert.equal(audio.paused,false);
  assert.deepEqual(gain().calls.at(-1),['linear',MENU_LEVEL,10+MENU_IN_S]);
  menu.setScene('match');
  assert.equal(menu.track!.state,'stopping');
  assert.deepEqual(gain().calls.at(-1),['linear',0,10+MENU_OUT_S]);
  fire();
  assert.equal(menu.track!.state,'ready');assert.equal(audio.paused,true);
  menu.setScene('menu');
  assert.equal(menu.track!.state,'playing');assert.equal(audio.paused,false);
  assert.deepEqual(gain().calls.at(-1),['linear',MENU_LEVEL,10+MENU_IN_S]);
  assert.equal(asks.length,1,'the file came once');
});

test('room phases: the waiting room is the menu\'s, combat and the result the match\'s',()=>{
  assert.equal(sceneOfPhase('lobby'),'menu');assert.equal(sceneOfPhase('countdown'),'menu');assert.equal(sceneOfPhase(undefined),'menu');
  assert.equal(sceneOfPhase('combat'),'match');assert.equal(sceneOfPhase('result'),'match');
});

test('yield: the match pre-download aborts the running download; it starts again once released',async()=>{
  const {menu,asks,revoked,boot}=rig();
  boot();
  const release=menu.hold();
  assert.equal(asks[0]!.signal!.aborted,true);assert.equal(menu.track!.state,'idle');
  asks[0]!.answer();await flush();
  assert.equal(menu.track!.state,'idle','a late answer is dropped');assert.equal(revoked.length,1);
  const again=menu.hold();release();
  assert.equal(asks.length,1,'one hold left');
  again();again();
  assert.equal(asks.length,2,'released: a new fetch (the worker cache when the first had finished)');
  assert.equal(menu.track!.state,'loading');
});

test('yield: entering the match aborts the download; back in the menu it starts again',()=>{
  const {menu,asks,boot}=rig();
  boot();
  menu.setScene('match');
  assert.equal(asks[0]!.signal!.aborted,true);
  menu.setScene('menu');
  assert.equal(asks.length,2);assert.equal(asks[1]!.signal!.aborted,false);
});

test('a finished file is not touched by a hold: it keeps playing',async()=>{
  const {audio,menu,asks,boot,tap}=rig();
  boot();asks[0]!.answer();await flush();tap();await flush();
  menu.hold();
  assert.equal(menu.track!.state,'playing');assert.equal(audio.paused,false);
});

test('mute, volume 0 and a hidden tab pause it; it resumes when they clear',async()=>{
  const {audio,engine,page,asks,boot,tap}=rig();
  boot();asks[0]!.answer();await flush();tap();await flush();
  engine.set({muted:true});assert.equal(audio.paused,true);
  engine.set({muted:false});assert.equal(audio.paused,false);
  engine.set({volume:0});assert.equal(audio.paused,true);
  engine.set({volume:.5});assert.equal(audio.paused,false);
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));assert.equal(audio.paused,true);
  page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));assert.equal(audio.paused,false);
});

test('default download: fetch with priority low and the abort signal, to a blob URL',async()=>{
  const real=globalThis.fetch,asked:RequestInit[]=[];
  globalThis.fetch=(async(_url:string,init:RequestInit)=>{asked.push(init);return new Response('x');}) as typeof fetch;
  try{
    const audio=new FakeAudio(),menu=new MenuMusic();
    menu.boot(new FakePage(),{engine:new FakeEngine(),createElement:()=>audio});
    for(let i=0;i<4;i++)await flush();
    assert.equal((asked[0] as {priority?:string}).priority,'low');
    assert.ok(asked[0]!.signal instanceof AbortSignal);
    assert.match(audio.src,/^blob:/);
    menu.dispose();
  }finally{globalThis.fetch=real;}
});

test('wiring: the waiting room holds the menu download while it pre-downloads; the room phase sets the scene; the worker forwards the abort',()=>{
  const p=(done:number,total:number)=>({done,total,failed:0,fraction:0});
  const progress=(a:number):PreloadProgress=>({P0:p(2,2),P1:p(a,3),P2:p(0,0),bytes:0,slow:false});
  assert.equal(preloadDone(progress(1)),false);assert.equal(preloadDone(progress(3)),true);
  const lobby=fs.readFileSync('src/client/lobby.ts','utf8');
  assert.match(lobby,/menuHold\?\?=holdMenuDownload\(\);preloader\.add\(/);
  assert.match(lobby,/preloadDone\(preload\)\)\{menuHold\(\)/);
  const explore=fs.readFileSync('src/client/explore.ts','utf8');
  assert.match(explore,/setMusicScene\(sceneOfPhase\(run\.phase\)\)/);
  assert.match(explore,/setMusicScene\('menu'\)/);
  assert.match(fs.readFileSync('src/main.ts','utf8'),/^startMenuMusic\(\);/m);
  assert.match(fs.readFileSync('public/sw.js','utf8'),/priority:'low',signal:request\.signal/);
});
