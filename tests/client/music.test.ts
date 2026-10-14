/**
 * Boss music (NEW-20261014-ORQ-musica-do-chefe): format pick, load gating, the state machine, fades, mute and the
 * hidden tab, with a fake <audio> element and a fake WebAudio context (Node has no DOM).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BOSS_TRACK,END_OUT_S,FADE_IN_S,FADE_OUT_S,GameMusic,MUSIC_LEVEL,MUSIC_M4A,MUSIC_WEBM,THEME_IN_S,THEME_LEVEL,THEME_LOAD_DELAY_MS,THEME_OUT_S,THEME_TRACK,
  musicCue,pickMusicSource,shouldLoad,type MusicElement,type MusicEngine} from '../../src/client/audio/music.ts';
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
  currentTime=10;sources:unknown[]=[];gains:FakeGain[]=[];routes=new Map<unknown,FakeNode>();
  createGain(){const g=new FakeGain();this.gains.push(g);return g;}
  createMediaElementSource(el:unknown){this.sources.push(el);const n=new FakeNode();this.routes.set(el,n);return n;}
  /** The gain an element was routed into. */
  gainOf(el:unknown){return (this.routes.get(el)!.connected[0] as FakeGain).gain;}
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
  unlocked=false;ctx:FakeCtx|undefined;musicBus=new FakeNode();settings={music:{volume:.7,muted:false}};
  listeners=new Set<()=>void>();attached=0;
  get context(){return this.ctx as unknown as AudioContext|undefined;}
  get musicOutput(){return this.ctx?this.musicBus as unknown as AudioNode:undefined;}
  onChange(l:()=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
  attachUnlock(target:EventTarget){
    this.attached++;
    const h=()=>{if(!this.unlocked){this.unlocked=true;this.ctx=new FakeCtx();}};
    target.addEventListener('pointerup',h);
    return ()=>{this.attached--;target.removeEventListener('pointerup',h);};
  }
  set(patch:Partial<{volume:number;muted:boolean}>){this.settings={music:{...this.settings.music,...patch}};for(const l of [...this.listeners])l();}
}
class FakePage extends EventTarget {visibilityState='visible';}

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<4;i++)await flush();}
function rig(opts:{fetchFails?:boolean;noTheme?:boolean}={}){
  const audio=new FakeAudio(),theme=new FakeAudio(),engine=new FakeEngine(),page=new FakePage();
  const timers:{fn:()=>void;ms:number;id:number;live:boolean}[]=[];let next=0;
  const fetched:string[]=[],revoked:string[]=[];
  const music=new GameMusic({engine,createElement:spec=>spec===THEME_TRACK?theme:audio,sources:opts.noTheme?{theme:null}:undefined,
    fetchUrl:url=>{fetched.push(url);return opts.fetchFails?Promise.reject(new Error('3G')):Promise.resolve(`blob:${url}`);},
    revokeUrl:url=>{revoked.push(url);},
    setTimer:(fn,ms)=>{const t={fn,ms,id:++next,live:true};timers.push(t);return t.id;},
    clearTimer:id=>{const t=timers.find(x=>x.id===id);if(t)t.live=false;}});
  music.attach(page);
  const tap=()=>page.dispatchEvent(new Event('pointerup'));
  /** Runs the live timers of `ms` (all when omitted). */
  const fire=(ms?:number)=>{for(const t of [...timers])if(t.live&&(ms===undefined||t.ms===ms)){t.live=false;t.fn();}};
  const gain=()=>engine.ctx!.gainOf(audio);
  const themeGain=()=>engine.ctx!.gainOf(theme);
  return {audio,theme,engine,page,music,tap,fire,timers,fetched,revoked,gain,themeGain};
}

test('format: Opus/WebM first, AAC/M4A as the fallback, none when neither plays',()=>{
  assert.equal(pickMusicSource(t=>t==='audio/webm; codecs="opus"'?'probably':''),MUSIC_WEBM);
  assert.equal(pickMusicSource(t=>t==='audio/webm; codecs="opus"'?'maybe':'probably'),MUSIC_WEBM);
  assert.equal(pickMusicSource(t=>t.startsWith('audio/mp4')?'maybe':''),MUSIC_M4A);
  assert.equal(pickMusicSource(()=>''),null);
  assert.equal(pickMusicSource(t=>t.startsWith('audio/webm')?'probably':'',THEME_TRACK),THEME_TRACK.webm);
  assert.equal(pickMusicSource(t=>t.startsWith('audio/mp4')?'probably':'',THEME_TRACK),THEME_TRACK.m4a);
  assert.equal(pickMusicSource(()=>{throw new Error('old browser');}),null);
  const audio=new FakeAudio();audio.answers={};
  const music=new GameMusic({engine:new FakeEngine(),createElement:()=>audio});
  assert.equal(music.boss.source,null);assert.equal(music.theme.source,null);assert.equal(music.enabled,false);
  music.update({boss:true,round:10});
  assert.equal(music.boss.state,'idle','no playable format: inert');
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
  assert.equal(music.boss.state,'idle');assert.deepEqual(fetched,[]);assert.equal(audio.src,'');
});

test('cue from the view: round index, live ETA, a living boss while the run is on',()=>{
  const view={tick:1,enemies:[{id:'b',kind:'chefe',x:0,y:0,hp:10,maxHp:20,boss:true}],round:{index:10}} as unknown as RunView;
  assert.deepEqual(musicCue(view,false),{round:10,etaS:undefined,boss:true,ended:false});
  assert.equal(musicCue(view,true).ended,true);
  assert.equal(musicCue(view,true).boss,false,'the result screen');
  assert.equal(musicCue({...view,enemies:[{...view.enemies[0]!,hp:0}]},false).boss,false,'dead boss');
  const chave={...view,enemies:[],objective:{etaS:120}} as unknown as RunView;
  assert.equal(musicCue(chave,false).etaS,120);
  assert.equal(musicCue({...chave,objective:{etaS:0,ended:'victory'}} as unknown as RunView,false).etaS,undefined);
});

test('unlock: the first gesture routes element -> gain -> music bus and plays a silent data URI, then pauses',async()=>{
  const {audio,theme,engine,tap}=rig();
  assert.equal(engine.attached,1,'the engine unlocks on the same gestures');
  tap();
  assert.ok(engine.ctx);
  assert.deepEqual(engine.ctx.sources,[audio,theme],'each track unlocks its own element in the gesture');
  assert.equal(theme.plays,1);assert.match(theme.src,/^data:audio\/wav;base64,/);
  assert.equal(engine.ctx.gains[0]!.gain.value,0);
  assert.deepEqual(engine.ctx.gains[0]!.connected,[engine.musicBus]);
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
  assert.equal(music.boss.state,'loading');
  assert.deepEqual(fetched,[MUSIC_WEBM]);
  await flush();
  assert.equal(music.boss.state,'ready');
  assert.equal(audio.src,`blob:${MUSIC_WEBM}`);assert.equal(audio.loop,true);assert.equal(audio.paused,true);
  music.update({round:10,boss:true});
  assert.equal(music.boss.state,'playing');
  assert.equal(audio.paused,false);
  assert.deepEqual(gain().calls.slice(-3),[['cancel',10],['set',0,10],['linear',MUSIC_LEVEL,10+FADE_IN_S]]);
  music.update({round:10,boss:true});
  assert.equal(audio.plays,2,'one play per boss');
  music.update({round:10,boss:false});
  assert.equal(music.boss.state,'stopping');
  assert.deepEqual(gain().calls.at(-1),['linear',0,10+FADE_OUT_S]);
  assert.equal(timers.at(-1)!.ms,FADE_OUT_S*1000);
  assert.equal(audio.paused,false,'still fading');
  audio.currentTime=31;
  fire(FADE_OUT_S*1000);
  assert.equal(music.boss.state,'ready');assert.equal(audio.paused,true);assert.equal(audio.currentTime,0,'next boss from the top');
});

test('the boss comes back mid fade-out: the fade turns around, no rewind',async()=>{
  const {audio,music,tap,timers,gain}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  assert.equal(music.boss.state,'playing');
  music.update({round:10,boss:false});
  audio.currentTime=12;
  music.update({round:10,boss:true});
  assert.equal(music.boss.state,'playing');
  assert.equal(timers.at(-1)!.live,false,'the stop timer is cancelled');
  assert.deepEqual(gain().calls.at(-1),['linear',MUSIC_LEVEL,10+FADE_IN_S]);
  assert.equal(audio.currentTime,12);assert.equal(audio.paused,false);
});

test('the boss before any download (late join): loads at once and plays when ready',async()=>{
  const {audio,music,tap}=rig();
  tap();await flush();
  music.update({round:10,boss:true});
  assert.equal(music.boss.state,'loading');
  await flush();
  assert.equal(music.boss.state,'playing');assert.equal(audio.paused,false);
});

test('a failed fetch falls back to streaming the URL',async()=>{
  const {audio,music}=rig({fetchFails:true});
  music.update({round:7,boss:false});
  await flush();await flush();
  assert.equal(music.boss.state,'ready');assert.equal(audio.src,MUSIC_WEBM);
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
  assert.equal(music.boss.state,'playing');
});

test('muting during the fade-out ends it at once',async()=>{
  const {audio,engine,music,tap}=rig();
  tap();music.update({round:10,boss:true});await flush();await flush();
  music.update({round:10,boss:false});
  engine.set({muted:true});
  assert.equal(music.boss.state,'ready');assert.equal(audio.paused,true);
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
  assert.equal(music.boss.state,'ready','hidden mid fade-out: stopped');
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
  assert.equal(audio.paused,false);assert.equal(music.boss.state,'playing');
});

test('no gesture yet: nothing plays unrouted, the first tap starts it with the fade',async()=>{
  const {audio,engine,music,tap}=rig();
  music.update({round:10,boss:true});await flush();
  assert.equal(music.boss.state,'playing');assert.equal(audio.plays,0);assert.equal(engine.ctx,undefined);
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

// ---- the theme and the crossfade ----

/** A match underway: unlocked, the theme downloaded and fading in, the boss file ready (round 6). */
async function inMatch(){
  const r=rig();
  r.tap();await settle();
  r.music.update({round:6,boss:false});
  r.fire(THEME_LOAD_DELAY_MS);await settle();
  return r;
}

test('theme: downloads only a few seconds into the match, then loops from the start at a low gain',async()=>{
  const {theme,music,tap,fire,fetched,themeGain}=rig();
  tap();await settle();
  assert.deepEqual(fetched,[],'nothing before the match');
  music.update({round:1,boss:false});
  assert.deepEqual(fetched,[],'not during the entry');
  assert.equal(music.theme.state,'idle');
  music.update({round:1,boss:false});
  fire(THEME_LOAD_DELAY_MS);
  assert.deepEqual(fetched,[THEME_TRACK.webm],'one timer, one download');
  assert.equal(music.theme.state,'loading');assert.equal(theme.paused,true,'silent until it arrives');
  await settle();
  assert.equal(music.theme.state,'playing');
  assert.equal(theme.src,`blob:${THEME_TRACK.webm}`);assert.equal(theme.loop,true);assert.equal(theme.paused,false);
  assert.deepEqual(themeGain().calls.at(-1),['linear',THEME_LEVEL,10+THEME_IN_S]);
  assert.ok(THEME_LEVEL<=.3&&THEME_LEVEL<MUSIC_LEVEL);
  assert.equal(music.boss.state,'idle','the boss file still waits for round 6');
});

test('crossfade: the boss comes, the theme fades out as the boss fades in; it dies, the theme returns after',async()=>{
  const {audio,theme,engine,music,fire,gain,themeGain}=await inMatch();
  assert.equal(music.boss.state,'ready');
  music.update({round:10,boss:true});
  assert.equal(music.theme.state,'stopping');assert.equal(music.boss.state,'playing');
  assert.deepEqual(themeGain().calls.at(-1),['linear',0,10+THEME_OUT_S]);
  assert.deepEqual(gain().calls.at(-1),['linear',MUSIC_LEVEL,10+FADE_IN_S]);
  assert.equal(audio.paused,false);assert.equal(theme.paused,false,'still fading');
  theme.currentTime=40;
  fire(THEME_OUT_S*1000);
  assert.equal(music.theme.state,'ready');assert.equal(theme.paused,true);
  assert.equal(theme.currentTime,40,'the theme picks up where it stopped');
  engine.ctx!.currentTime=50;
  music.update({round:10,boss:false});
  assert.equal(music.boss.state,'stopping');
  assert.deepEqual(gain().calls.at(-1),['linear',0,50+FADE_OUT_S]);
  assert.equal(music.theme.state,'playing');assert.equal(theme.paused,false);
  // Held down until the boss's fade-out ends, then 2 s up.
  assert.deepEqual(themeGain().calls.slice(-3),[['set',0,50],['set',0,50+FADE_OUT_S],['linear',THEME_LEVEL,50+FADE_OUT_S+THEME_IN_S]]);
  fire(FADE_OUT_S*1000);
  assert.equal(music.boss.state,'ready');assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
  assert.equal(music.theme.state,'playing');
});

test('run end: both fade out; a rematch brings the theme back',async()=>{
  const {audio,theme,music,fire,gain,themeGain}=await inMatch();
  music.update({round:10,boss:true});
  music.update({boss:false,ended:true});
  assert.equal(music.boss.state,'stopping');assert.deepEqual(gain().calls.at(-1),['linear',0,10+END_OUT_S]);
  assert.equal(music.theme.state,'stopping');
  music.update({round:10,boss:false,ended:true});
  assert.equal(music.theme.state,'stopping','the result screen keeps it down');
  fire();
  assert.equal(audio.paused,true);assert.equal(theme.paused,true);
  assert.equal(music.boss.state,'ready');assert.equal(music.theme.state,'ready');
  music.update({round:1,boss:false});
  assert.equal(music.theme.state,'playing');assert.equal(theme.paused,false);
  assert.deepEqual(themeGain().calls.at(-1),['linear',THEME_LEVEL,10+THEME_IN_S]);
});

test('mute and a hidden tab pause both tracks; each resumes only if it should be playing',async()=>{
  const {audio,theme,engine,page,music}=await inMatch();
  assert.equal(theme.paused,false);
  engine.set({muted:true});
  assert.equal(theme.paused,true);
  engine.set({muted:false});
  assert.equal(theme.paused,false);
  music.update({round:10,boss:true});
  assert.equal(audio.paused,false);
  engine.set({muted:true});
  assert.equal(audio.paused,true);assert.equal(theme.paused,true);
  assert.equal(music.theme.state,'ready','a fade-out under mute just ends');
  engine.set({muted:false});
  assert.equal(audio.paused,false);assert.equal(theme.paused,true,'the theme stays out while the boss lives');
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.paused,true);
  page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.paused,false);
  music.update({round:10,boss:false});
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audio.paused,true);assert.equal(theme.paused,true);
  assert.equal(music.boss.state,'ready');
  page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(theme.paused,false);assert.equal(audio.paused,true);
});

test('dispose stops both tracks and the pending theme download',async()=>{
  const {music,fetched,fire,timers}=rig();
  music.update({round:1,boss:false});
  music.dispose();
  fire();
  assert.deepEqual(fetched,[]);assert.ok(timers.every(t=>!t.live));
  const r=await inMatch();
  r.music.dispose();
  assert.equal(r.theme.paused,true);assert.equal(r.theme.src,'');
  assert.ok(r.revoked.includes(`blob:${THEME_TRACK.webm}`));
});

test('a missing theme format leaves the boss music working',async()=>{
  const {audio,theme,music,tap,fire,fetched}=rig({noTheme:true});
  tap();await settle();
  assert.equal(theme.plays,0);
  music.update({round:10,boss:true});fire(THEME_LOAD_DELAY_MS);await settle();
  assert.deepEqual(fetched,[BOSS_TRACK.webm]);assert.equal(audio.paused,false);
});
