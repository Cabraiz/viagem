/**
 * Boss music (NEW-20261014-ORQ-musica-do-chefe): format pick, load gating, the state machine, fades, mute and the
 * hidden tab, with a fake <audio> element and a fake WebAudio context (Node has no DOM).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BossMusic,FADE_IN_S,FADE_OUT_S,MUSIC_LEVEL,MUSIC_M4A,MUSIC_WEBM,musicCue,pickMusicSource,shouldLoad,type MusicElement,type MusicEngine} from '../../src/client/audio/music.ts';
import type {RunView} from '../../src/contract/view.ts';

type Call=[string,...number[]];
class FakeParam {
  value=0;calls:Call[]=[];
  setValueAtTime(v:number,t:number){this.calls.push(['set',v,t]);this.value=v;}
  linearRampToValueAtTime(v:number,t:number){this.calls.push(['linear',v,t]);}
  cancelScheduledValues(t:number){this.calls.push(['cancel',t]);}
}
class FakeNode {connected:unknown[]=[];disconnects=0;connect(d:unknown){this.connected.push(d);return d;}disconnect(){this.disconnects++;}}
class FakeGain extends FakeNode {gain=new FakeParam();}
class FakeCtx {
  currentTime=10;sources:unknown[]=[];gains:FakeGain[]=[];
  createGain(){const g=new FakeGain();this.gains.push(g);return g;}
  createMediaElementSource(el:unknown){this.sources.push(el);return new FakeNode();}
}
class FakeAudio implements MusicElement {
  src='';loop=false;preload='none';currentTime=0;paused=true;plays=0;pauses=0;loads=0;
  answers:Record<string,string>={'audio/webm; codecs="opus"':'probably'};
  refuse:string|undefined;
  canPlayType(type:string){return this.answers[type]??'';}
  play(){
    this.plays++;
    if(this.refuse){const name=this.refuse;return Promise.reject(Object.assign(new Error(name),{name}));}
    this.paused=false;return Promise.resolve();
  }
  pause(){this.pauses++;this.paused=true;}
  load(){this.loads++;}
  removeAttribute(name:string){if(name==='src')this.src='';}
}
class FakeEngine implements MusicEngine {
  unlocked=false;ctx:FakeCtx|undefined;master=new FakeNode();settings={volume:.7,muted:false};
  listeners=new Set<()=>void>();attached=0;
  get context(){return this.ctx as unknown as AudioContext|undefined;}
  get output(){return this.ctx?this.master as unknown as AudioNode:undefined;}
  onChange(l:()=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
  attachUnlock(target:EventTarget){
    this.attached++;
    const h=()=>{if(!this.unlocked){this.unlocked=true;this.ctx=new FakeCtx();}};
    target.addEventListener('pointerup',h);
    return ()=>{this.attached--;target.removeEventListener('pointerup',h);};
  }
  set(patch:Partial<{volume:number;muted:boolean}>){this.settings={...this.settings,...patch};for(const l of [...this.listeners])l();}
}
class FakePage extends EventTarget {visibilityState='visible';}

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function rig(opts:{fetchFails?:boolean}={}){
  const audio=new FakeAudio(),engine=new FakeEngine(),page=new FakePage();
  const timers:{fn:()=>void;ms:number;id:number;live:boolean}[]=[];let next=0;
  const fetched:string[]=[],revoked:string[]=[];
  const music=new BossMusic({engine,createElement:()=>audio,
    fetchUrl:url=>{fetched.push(url);return opts.fetchFails?Promise.reject(new Error('3G')):Promise.resolve(`blob:${url}`);},
    revokeUrl:url=>{revoked.push(url);},
    setTimer:(fn,ms)=>{const t={fn,ms,id:++next,live:true};timers.push(t);return t.id;},
    clearTimer:id=>{const t=timers.find(x=>x.id===id);if(t)t.live=false;}});
  music.attach(page);
  const tap=()=>page.dispatchEvent(new Event('pointerup'));
  const fire=()=>{for(const t of timers.splice(0))if(t.live)t.fn();};
  const gain=()=>engine.ctx!.gains[0]!.gain;
  return {audio,engine,page,music,tap,fire,timers,fetched,revoked,gain};
}

test('format: Opus/WebM first, AAC/M4A as the fallback, none when neither plays',()=>{
  assert.equal(pickMusicSource(t=>t==='audio/webm; codecs="opus"'?'probably':''),MUSIC_WEBM);
  assert.equal(pickMusicSource(t=>t==='audio/webm; codecs="opus"'?'maybe':'probably'),MUSIC_WEBM);
  assert.equal(pickMusicSource(t=>t.startsWith('audio/mp4')?'maybe':''),MUSIC_M4A);
  assert.equal(pickMusicSource(()=>''),null);
  assert.equal(pickMusicSource(()=>{throw new Error('old browser');}),null);
  const audio=new FakeAudio();audio.answers={};
  const music=new BossMusic({engine:new FakeEngine(),createElement:()=>audio});
  assert.equal(music.source,null);
  music.update({boss:true,round:10});
  assert.equal(music.state,'idle','no playable format: inert');
});

test('load gating: from round 6, the chaveiro under 3 min, or the boss already there; never at the start',()=>{
  assert.equal(shouldLoad({round:1,boss:false}),false);
  assert.equal(shouldLoad({round:5,boss:false}),false);
  assert.equal(shouldLoad({round:6,boss:false}),true);
  assert.equal(shouldLoad({boss:false,etaS:240}),false);
  assert.equal(shouldLoad({boss:false,etaS:179}),true);
  assert.equal(shouldLoad({boss:false,etaS:0}),false,'no ETA yet is not "close"');
  assert.equal(shouldLoad({boss:true}),true);
  const {music,fetched,audio}=rig();
  music.update({round:3,boss:false});
  assert.equal(music.state,'idle');assert.deepEqual(fetched,[]);assert.equal(audio.src,'');
});

test('cue from the view: round index, live ETA, a living boss while the run is on',()=>{
  const view={tick:1,enemies:[{id:'b',kind:'chefe',x:0,y:0,hp:10,maxHp:20,boss:true}],round:{index:10}} as unknown as RunView;
  assert.deepEqual(musicCue(view,false),{round:10,etaS:undefined,boss:true});
  assert.equal(musicCue(view,true).boss,false,'the result screen');
  assert.equal(musicCue({...view,enemies:[{...view.enemies[0]!,hp:0}]},false).boss,false,'dead boss');
  const chave={...view,enemies:[],objective:{etaS:120}} as unknown as RunView;
  assert.equal(musicCue(chave,false).etaS,120);
  assert.equal(musicCue({...chave,objective:{etaS:0,ended:'victory'}} as unknown as RunView,false).etaS,undefined);
});

test('unlock: the first gesture routes element -> gain -> master and plays a silent data URI, then pauses',async()=>{
  const {audio,engine,tap}=rig();
  assert.equal(engine.attached,1,'the engine unlocks on the same gestures');
  tap();
  assert.ok(engine.ctx);
  assert.deepEqual(engine.ctx.sources,[audio]);
  assert.equal(engine.ctx.gains[0]!.gain.value,0);
  assert.deepEqual(engine.ctx.gains[0]!.connected,[engine.master]);
  assert.match(audio.src,/^data:audio\/wav;base64,/);
  assert.equal(audio.plays,1);
  await flush();
  assert.equal(audio.paused,true);
  tap();
  assert.equal(audio.plays,1,'once is enough');
});

test('states: idle -> loading -> ready -> playing (fade-in 1 s) -> stopping (fade-out 2 s) -> ready',async()=>{
  const {audio,music,tap,fire,timers,fetched,gain}=rig();
  tap();await flush();
  music.update({round:6,boss:false});
  assert.equal(music.state,'loading');
  assert.deepEqual(fetched,[MUSIC_WEBM]);
  await flush();
  assert.equal(music.state,'ready');
  assert.equal(audio.src,`blob:${MUSIC_WEBM}`);assert.equal(audio.loop,true);assert.equal(audio.paused,true);
  music.update({round:10,boss:true});
  assert.equal(music.state,'playing');
  assert.equal(audio.paused,false);
  assert.deepEqual(gain().calls.slice(-3),[['cancel',10],['set',0,10],['linear',MUSIC_LEVEL,10+FADE_IN_S]]);
  music.update({round:10,boss:true});
  assert.equal(audio.plays,2,'one play per boss');
  music.update({round:10,boss:false});
  assert.equal(music.state,'stopping');
  assert.deepEqual(gain().calls.at(-1),['linear',0,10+FADE_OUT_S]);
  assert.equal(timers.at(-1)!.ms,FADE_OUT_S*1000);
  assert.equal(audio.paused,false,'still fading');
  audio.currentTime=31;
  fire();
  assert.equal(music.state,'ready');assert.equal(audio.paused,true);assert.equal(audio.currentTime,0,'next boss from the top');
});

test('the boss comes back mid fade-out: the fade turns around, no rewind',async()=>{
  const {audio,music,tap,timers,gain}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  assert.equal(music.state,'playing');
  music.update({round:10,boss:false});
  audio.currentTime=12;
  music.update({round:10,boss:true});
  assert.equal(music.state,'playing');
  assert.equal(timers.at(-1)!.live,false,'the stop timer is cancelled');
  assert.deepEqual(gain().calls.at(-1),['linear',MUSIC_LEVEL,10+FADE_IN_S]);
  assert.equal(audio.currentTime,12);assert.equal(audio.paused,false);
});

test('the boss before any download (late join): loads at once and plays when ready',async()=>{
  const {audio,music,tap}=rig();
  tap();await flush();
  music.update({round:10,boss:true});
  assert.equal(music.state,'loading');
  await flush();
  assert.equal(music.state,'playing');assert.equal(audio.paused,false);
});

test('a failed fetch falls back to streaming the URL',async()=>{
  const {audio,music}=rig({fetchFails:true});
  music.update({round:7,boss:false});
  await flush();await flush();
  assert.equal(music.state,'ready');assert.equal(audio.src,MUSIC_WEBM);
});

test('mute pauses at once and unmute resumes while the boss is there; volume 0 counts as mute',async()=>{
  const {audio,engine,music,tap}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  assert.equal(audio.paused,false);
  engine.set({muted:true});
  assert.equal(audio.paused,true);
  music.update({round:10,boss:true});
  assert.equal(audio.paused,true,'views do not restart it');
  engine.set({muted:false});
  assert.equal(audio.paused,false);
  engine.set({volume:0});
  assert.equal(audio.paused,true);
  engine.set({volume:.5});
  assert.equal(audio.paused,false);
  assert.equal(music.state,'playing');
});

test('muting during the fade-out ends it at once',async()=>{
  const {audio,engine,music,tap}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  music.update({round:10,boss:false});
  engine.set({muted:true});
  assert.equal(music.state,'ready');assert.equal(audio.paused,true);
});

test('hidden tab pauses, visible resumes only if it should be playing',async()=>{
  const {audio,page,music,tap}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.paused,true);
  page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.paused,false);
  music.update({round:10,boss:false});
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(music.state,'ready','hidden mid fade-out: stopped');
  page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.paused,true);
});

test('autoplay refusal: silent, no retry storm, retried on the next gesture',async()=>{
  const {audio,engine,music,tap}=rig();
  tap();await flush();
  audio.refuse='NotAllowedError';
  music.update({round:10,boss:true});await flush();await flush();
  const plays=audio.plays;
  assert.equal(audio.paused,true);
  engine.set({volume:.6});music.update({round:10,boss:true});
  assert.equal(audio.plays,plays,'no retry outside a gesture');
  audio.refuse=undefined;
  tap();
  assert.equal(audio.paused,false);assert.equal(music.state,'playing');
});

test('no gesture yet: nothing plays unrouted, the first tap starts it with the fade',async()=>{
  const {audio,engine,music,tap}=rig();
  music.update({round:10,boss:true});await flush();
  assert.equal(music.state,'playing');assert.equal(audio.plays,0);assert.equal(engine.ctx,undefined);
  tap();
  assert.equal(audio.paused,false);
  assert.deepEqual(engine.ctx!.gains[0]!.gain.calls.at(-1),['linear',MUSIC_LEVEL,10+FADE_IN_S]);
});

test('dispose: listeners off, element emptied, nodes disconnected, blob URL revoked; never throws after',async()=>{
  const {audio,engine,page,music,tap,revoked}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  music.dispose();
  assert.equal(audio.paused,true);assert.equal(audio.src,'');assert.ok(audio.loads>=1);
  assert.deepEqual(revoked,[`blob:${MUSIC_WEBM}`]);
  assert.equal(engine.listeners.size,0);assert.equal(engine.attached,0);
  assert.equal(engine.ctx!.gains[0]!.disconnects,1);
  const plays=audio.plays;
  page.dispatchEvent(new Event('pointerup'));music.update({round:10,boss:true});music.dispose();
  assert.equal(audio.plays,plays);
});

test('a download that lands after dispose is revoked, not kept',async()=>{
  const {music,revoked}=rig();
  music.update({round:6,boss:false});
  music.dispose();
  await flush();await flush();
  assert.deepEqual(revoked,[`blob:${MUSIC_WEBM}`]);
});
