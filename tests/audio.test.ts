import test from 'node:test';
import assert from 'node:assert/strict';
import {SOUND_IDS,recipeLength,type SoundId} from '../src/game/audio/types.ts';
import {RECIPES} from '../src/game/audio/recipes.ts';
import {AudioEngine,DEFAULT_SETTINGS,SETTINGS_KEY} from '../src/game/audio/engine.ts';
import {soundForEvent,playEvents} from '../src/game/audio/events.ts';
import type {SimEvent} from '../src/game/sim/types.ts';

// ---- fake WebAudio (Node has no DOM) ----
type Call=[string,...number[]];
class FakeParam {
  value=0;calls:Call[]=[];
  setValueAtTime(v:number,t:number){this.calls.push(['set',v,t]);this.value=v;return this;}
  linearRampToValueAtTime(v:number,t:number){this.calls.push(['linear',v,t]);return this;}
  exponentialRampToValueAtTime(v:number,t:number){this.calls.push(['exp',v,t]);return this;}
  setTargetAtTime(v:number,t:number,c:number){this.calls.push(['target',v,t,c]);return this;}
  cancelScheduledValues(t:number){this.calls.push(['cancel',t]);return this;}
}
class FakeNode {
  kind:string;connected:unknown[]=[];disconnects=0;
  constructor(kind:string){this.kind=kind;}
  connect(dest:unknown){this.connected.push(dest);return dest;}
  disconnect(){this.disconnects++;}
}
class FakeGain extends FakeNode {gain=new FakeParam();constructor(){super('gain');}}
class FakeSource extends FakeNode {
  starts:number[]=[];stops:number[]=[];onended:(()=>void)|null=null;
  start(t=0){this.starts.push(t);}
  stop(t=0){this.stops.push(t);}
  end(){this.onended?.();}
}
class FakeOsc extends FakeSource {type='sine';frequency=new FakeParam();constructor(){super('osc');}}
class FakeBufferSource extends FakeSource {buffer:unknown=null;loop=false;constructor(){super('buffer-source');}}
class FakeFilter extends FakeNode {type='lowpass';frequency=new FakeParam();Q=new FakeParam();constructor(){super('filter');}}
class FakeCompressor extends FakeNode {
  threshold=new FakeParam();knee=new FakeParam();ratio=new FakeParam();attack=new FakeParam();release=new FakeParam();
  constructor(){super('compressor');}
}
class FakeCtx {
  sampleRate=48000;currentTime=0;state='suspended';destination=new FakeNode('destination');
  nodes:FakeNode[]=[];resumes=0;closes=0;suspends=0;autoResume=true;
  createDynamicsCompressor?:()=>FakeCompressor=()=>this.add(new FakeCompressor());
  private add<T extends FakeNode>(n:T){this.nodes.push(n);return n;}
  createGain(){return this.add(new FakeGain());}
  createOscillator(){return this.add(new FakeOsc());}
  createBufferSource(){return this.add(new FakeBufferSource());}
  createBiquadFilter(){return this.add(new FakeFilter());}
  createBuffer(channels:number,length:number,sampleRate:number){
    const data=Array.from({length:channels},()=>new Float32Array(length));
    return {numberOfChannels:channels,length,sampleRate,getChannelData:(i:number)=>data[i]};
  }
  resume(){this.resumes++;if(this.autoResume)this.state='running';return Promise.resolve();}
  suspend(){this.suspends++;this.state='suspended';return Promise.resolve();}
  close(){this.closes++;this.state='closed';return Promise.resolve();}
  blips(from=0){return this.nodes.slice(from).filter(n=>n instanceof FakeBufferSource&&(n.buffer as {length:number}|null)?.length===1);}
  sources(from=0){return this.nodes.slice(from).filter((n):n is FakeSource=>n instanceof FakeSource);}
  oscs(from=0){return this.nodes.slice(from).filter((n):n is FakeOsc=>n instanceof FakeOsc);}
}
class CountingTarget extends EventTarget {
  live=new Set<string>();ids=new Map<unknown,number>();
  private key(type:string,fn:unknown){if(!this.ids.has(fn))this.ids.set(fn,this.ids.size);return `${type}#${this.ids.get(fn)}`;}
  get active(){return this.live.size;}
  addEventListener(type:string,fn:EventListenerOrEventListenerObject|null,opts?:AddEventListenerOptions|boolean){this.live.add(this.key(type,fn));super.addEventListener(type,fn,opts);}
  removeEventListener(type:string,fn:EventListenerOrEventListenerObject|null,opts?:EventListenerOptions|boolean){this.live.delete(this.key(type,fn));super.removeEventListener(type,fn,opts);}
}
function memStorage(){const m=new Map<string,string>();return {map:m,getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};}
const throwingStorage={getItem():string|null{throw new Error('blocked');},setItem(){throw new Error('blocked');}};

interface RigOpts {maxVoices?:number;storage?:{getItem(k:string):string|null;setItem(k:string,v:string):void}|null;unlock?:boolean;autoResume?:boolean;compressor?:boolean}
function rig(opts:RigOpts={}){
  const ctxs:FakeCtx[]=[],vibes:number[][]=[],nodesAtVibe:number[]=[];let now=0;
  const engine=new AudioEngine({
    createContext:()=>{
      const c=new FakeCtx();c.autoResume=opts.autoResume??true;
      if(opts.compressor===false)c.createDynamicsCompressor=undefined;
      ctxs.push(c);return c as unknown as AudioContext;
    },
    vibrate:p=>{vibes.push(p);nodesAtVibe.push(ctxs[0]?.nodes.length??0);return true;},
    nowMs:()=>now,maxVoices:opts.maxVoices,storage:opts.storage,
  });
  if(opts.unlock!==false)engine.unlock();
  return {engine,ctxs,vibes,nodesAtVibe,get ctx(){return ctxs[0];},setNow(t:number){now=t;}};
}
const masterOf=(ctx:FakeCtx)=>ctx.nodes[0] as FakeGain;
const faded=(g:FakeGain,t:number)=>g.gain.calls.some(c=>c[0]==='cancel'&&c[1]===t)&&g.gain.calls.some(c=>c[0]==='target'&&c[1]===0&&c[2]===t&&c[3]===.005);
const near=(a:number,b:number)=>Math.abs(a-b)<1e-9;
function withDocument(run:(doc:EventTarget&{visibilityState:string})=>void){
  const g=globalThis as {document?:unknown},prev=g.document;
  const doc=Object.assign(new CountingTarget(),{visibilityState:'visible'});
  g.document=doc;
  try{run(doc);}finally{if(prev===undefined)delete g.document;else g.document=prev;}
}

// ---- 1. recipes ----
test('recipes cover exactly SOUND_IDS and stay within budget',()=>{
  assert.equal(SOUND_IDS.length,12);
  for(const id of ['buzina','boing','risada'] as const)assert.ok(SOUND_IDS.includes(id));
  assert.deepEqual(Object.keys(RECIPES).sort(),[...SOUND_IDS].sort());
  assert.ok(Object.isFrozen(RECIPES));
  for(const id of SOUND_IDS){
    const r=RECIPES[id],msg=`recipe ${id}`;
    assert.equal(r.id,id,msg);
    assert.ok(typeof r.label==='string'&&r.label.trim().length>0,msg);
    assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.tones),msg);
    assert.ok(r.tones.length>=1,msg);
    const len=recipeLength(r);
    assert.ok(len>0&&len<=1.6,`${msg} length ${len}`);
    if(id==='golpe'||id==='gema')assert.ok(len<=.15,`${msg} length ${len}`);
    assert.ok(Number.isFinite(r.throttleMs)&&r.throttleMs>=0,msg);
    assert.ok(Number.isInteger(r.priority)&&r.priority>=0&&r.priority<=3,msg);
    if(r.vibrate){assert.ok(r.vibrate.length>0,msg);assert.ok(r.vibrate.every(n=>Number.isFinite(n)&&n>0),msg);}
    for(const t of r.tones){
      assert.ok(Object.isFrozen(t),msg);
      const freqs=[t.from,t.to];
      if(t.filter)freqs.push(t.filter.freq);
      if(t.vibrato)freqs.push(Math.min(t.from,t.to)-t.vibrato.depth,Math.max(t.from,t.to)+t.vibrato.depth);
      for(const f of freqs)assert.ok(f>=20&&f<=12000,`${msg} freq ${f}`);
      assert.ok(t.gain>0&&t.gain<=.6,`${msg} gain ${t.gain}`);
      assert.ok(t.at>=0&&t.dur>0,msg);
    }
  }
  assert.ok(RECIPES.queda.priority>=2&&RECIPES.chefe.priority>=2);
});

// ---- 2. no sound before interaction; gestures ----
const GESTURES=['pointerup','touchend','click','keydown'];
test('nothing plays before a real gesture; pointerdown alone is not one',()=>{
  const r=rig({unlock:false}),target=new CountingTarget();
  assert.equal(r.engine.unlocked,false);assert.equal(r.engine.running,false);
  assert.equal(r.engine.play('queda'),false);
  assert.equal(r.engine.play('nivel'),false);
  assert.equal(r.ctxs.length,0);
  assert.equal(r.vibes.length,0);
  r.engine.attachUnlock(target);
  assert.equal(target.active,GESTURES.length);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(r.ctxs.length,0,'pointerdown does not create a context');
  assert.equal(r.engine.unlocked,false);
  assert.equal(r.engine.play('nivel'),false);
  target.dispatchEvent(new Event('pointerup'));
  assert.equal(r.engine.unlocked,true);assert.equal(r.engine.running,true);
  assert.equal(r.ctxs.length,1);
  assert.equal(r.ctx.resumes,1);
  assert.equal(r.ctx.blips().length,1,'silent sample for iOS');
  assert.equal(target.active,GESTURES.length,'listeners stay to revive the context later');
  for(const type of GESTURES)target.dispatchEvent(new Event(type));
  assert.equal(r.ctxs.length,1,'never a second context');
  assert.equal(r.ctx.resumes,1,'running context: later gestures are no-ops');
  r.ctx.currentTime=5;
  const before=r.ctx.nodes.length;
  assert.equal(r.engine.play('nivel'),true);
  const oscs=r.ctx.oscs(before);
  assert.ok(oscs.length>=RECIPES.nivel.tones.length);
  for(const o of oscs){assert.equal(o.starts.length,1);assert.ok(o.starts[0]>=5);assert.ok(o.stops[0]>o.starts[0]);}
});

test('each of pointerup/touchend/click/keydown unlocks',()=>{
  for(const type of GESTURES){
    const r=rig({unlock:false}),target=new CountingTarget();
    r.engine.attachUnlock(target);
    target.dispatchEvent(new Event(type));
    assert.equal(r.ctxs.length,1,type);assert.equal(r.engine.unlocked,true,type);
  }
});

test('later gestures wake a suspended context; attachUnlock works after unlock and detaches',()=>{
  const r=rig(),ctx=r.ctx,target=new CountingTarget();
  r.engine.attachUnlock(target);
  assert.equal(target.active,GESTURES.length);
  ctx.state='suspended';
  assert.equal(r.engine.running,false);
  const n=ctx.nodes.length,res=ctx.resumes;
  target.dispatchEvent(new Event('touchend'));
  assert.equal(r.ctxs.length,1);
  assert.equal(ctx.resumes,res+1);
  assert.equal(ctx.blips(n).length,1);
  assert.equal(r.engine.running,true);
  const other=new CountingTarget(),detach=r.engine.attachUnlock(other);
  assert.equal(other.active,GESTURES.length);
  detach();
  assert.equal(other.active,0);
});

test('running getter and suspend() stop voices and suspend the context',()=>{
  const r=rig({unlock:false});
  assert.equal(r.engine.running,false);
  r.engine.unlock();
  const ctx=r.ctx;
  assert.equal(r.engine.running,true);
  ctx.currentTime=1;
  const from=ctx.nodes.length;
  assert.equal(r.engine.play('chefe'),true);
  const out=ctx.nodes[from] as FakeGain,srcs=ctx.sources(from);
  let fired=0;r.engine.onChange(()=>{fired++;});
  r.engine.suspend();
  assert.equal(ctx.suspends,1);
  assert.equal(r.engine.running,false);
  assert.equal(r.engine.activeVoices(),0);
  assert.ok(faded(out,1));
  for(const s of srcs)assert.ok(near(s.stops.at(-1)!,1.03));
  assert.ok(fired>=1);
  // Outside a gesture: refused, asks to resume, schedules nothing and does not start the throttle window.
  r.setNow(10000);
  const n=ctx.nodes.length,res=ctx.resumes;
  assert.equal(r.engine.play('nivel'),false);
  assert.equal(ctx.nodes.length,n);
  assert.equal(ctx.resumes,res+1);
  assert.equal(r.engine.running,true);
  assert.equal(r.engine.play('nivel'),true,'not throttled by the refused play');
});

test('suspended context only accepts sounds within the 500 ms grace window after a gesture',()=>{
  const r=rig({unlock:false,autoResume:false}),target=new CountingTarget();
  r.engine.attachUnlock(target);
  r.setNow(1000);
  target.dispatchEvent(new Event('click'));
  const ctx=r.ctx;
  assert.equal(ctx.state,'suspended');assert.equal(r.engine.running,false);
  assert.equal(ctx.resumes,1);
  r.setNow(1400);
  assert.equal(r.engine.play('nivel'),true,'inside grace');
  r.setNow(1501);
  let n=ctx.nodes.length,res=ctx.resumes;
  assert.equal(r.engine.play('upgrade'),false);
  assert.equal(r.engine.play('chefe'),false);
  assert.equal(ctx.nodes.length,n,'no pile-up on a frozen clock');
  assert.equal(ctx.resumes,res+2);
  assert.equal(r.vibes.length,0,'refused chefe does not buzz');
  r.setNow(3000);
  n=ctx.nodes.length;res=ctx.resumes;
  target.dispatchEvent(new Event('keydown'));
  assert.equal(ctx.resumes,res+1);assert.equal(ctx.blips(n).length,1);
  r.setNow(3500);
  assert.equal(r.engine.play('upgrade'),true,'grace window is inclusive at 500 ms');
  r.setNow(4001);
  assert.equal(r.engine.play('chefe'),false);
});

// ---- 3. voice limit ----
test('voice limit caps voices, fades out the oldest lowest-priority victim and drops outranked sounds',()=>{
  const r=rig({maxVoices:3}),ctx=r.ctx,master=masterOf(ctx);
  const play=(id:SoundId)=>{ctx.currentTime+=.01;const from=ctx.nodes.length,ok=r.engine.play(id);return {ok,at:ctx.currentTime,out:ctx.nodes[from] as FakeGain,srcs:ctx.sources(from)};};
  const golpe=play('golpe'),gema=play('gema'),buzina=play('buzina');
  assert.ok(golpe.ok&&gema.ok&&buzina.ok);
  assert.equal(golpe.out.connected[0],master);
  assert.equal(r.engine.activeVoices(),3);
  const queda=play('queda');
  assert.ok(queda.ok);
  assert.equal(r.engine.activeVoices(),3);
  // golpe (priority 0, oldest) is the victim: short fade, sources stop 30 ms later, no hard disconnect yet.
  assert.ok(faded(golpe.out,queda.at),'victim fades');
  for(const s of golpe.srcs)assert.ok(near(s.stops.at(-1)!,queda.at+.03),'victim sources stop after the fade');
  assert.equal(golpe.out.disconnects,0);
  for(const s of golpe.srcs)s.end();
  assert.equal(golpe.out.disconnects,1,'released once every source ended');
  for(const s of gema.srcs)assert.equal(s.stops.length,1,'gema untouched');
  const chefe=play('chefe');
  assert.ok(chefe.ok);assert.ok(faded(gema.out,chefe.at),'gema stolen next');
  const nivel=play('nivel');
  assert.ok(nivel.ok);assert.ok(faded(buzina.out,nivel.at),'buzina stolen next');
  assert.equal(r.engine.activeVoices(),3);
  const nodes=ctx.nodes.length;
  assert.equal(play('boing').ok,false,'priority 1 dropped when all voices outrank it');
  assert.equal(ctx.nodes.length,nodes);
  assert.equal(r.engine.activeVoices(),3);
  ctx.currentTime+=10;
  assert.equal(r.engine.activeVoices(),0);
  assert.ok(play('boing').ok,'dropped boing did not start its throttle window');
});

test('every voice disconnects only after its last source ends',()=>{
  const r=rig(),ctx=r.ctx,from=ctx.nodes.length;
  assert.equal(r.engine.play('nivel'),true);
  const out=ctx.nodes[from] as FakeGain,srcs=ctx.sources(from);
  assert.ok(srcs.length>1);
  assert.ok(srcs.every(s=>typeof s.onended==='function'));
  for(const s of srcs.slice(0,-1))s.end();
  assert.equal(out.disconnects,0);
  srcs.at(-1)!.end();
  assert.equal(out.disconnects,1);
});

test('a sound dropped by the voice limit neither vibrates nor starts its throttle window',()=>{
  const r=rig({maxVoices:2}),ctx=r.ctx;
  assert.equal(r.engine.play('queda'),true);
  assert.equal(r.engine.play('chefe'),true);
  assert.equal(r.vibes.length,2);
  const n=ctx.nodes.length;
  assert.equal(r.engine.play('resgate'),false);
  assert.equal(r.vibes.length,2);
  assert.equal(ctx.nodes.length,n);
  ctx.currentTime=10;
  assert.equal(r.engine.play('resgate'),true);
  assert.equal(r.vibes.length,3);
  assert.deepEqual(r.vibes[2],[...RECIPES.resgate.vibrate!]);
  assert.ok(r.nodesAtVibe[2]>n,'vibrates after scheduling');
});

// ---- 4. throttle ----
test('per-sound throttle limits hit spam',()=>{
  const r=rig();
  r.setNow(1000);
  assert.equal(r.engine.play('golpe'),true);
  r.setNow(1000+RECIPES.golpe.throttleMs-1);
  assert.equal(r.engine.play('golpe'),false);
  r.setNow(1000+RECIPES.golpe.throttleMs);
  assert.equal(r.engine.play('golpe'),true);
  const b=rig();b.setNow(5000);
  let played=0;
  for(let i=0;i<40;i++)if(b.engine.play(i%2?'gema':'golpe'))played++;
  assert.ok(played<=2,`played ${played}`);
  assert.equal(played,2);
});

// ---- 5. volume / mute / vibration / persistence ----
test('volume clamps, ignores NaN and drives the master gain as volume squared',()=>{
  const r=rig(),master=masterOf(r.ctx);
  assert.ok(Math.abs(master.gain.value-DEFAULT_SETTINGS.volume**2)<1e-9);
  r.engine.setVolume(2);assert.equal(r.engine.settings.volume,1);
  r.engine.setVolume(-1);assert.equal(r.engine.settings.volume,0);
  r.engine.setVolume(.5);assert.equal(r.engine.settings.volume,.5);
  r.engine.setVolume(NaN);assert.equal(r.engine.settings.volume,.5);
  r.engine.setVolume(Infinity);assert.equal(r.engine.settings.volume,.5);
  let last=master.gain.calls.at(-1)!;
  assert.equal(last[0],'target');assert.ok(Math.abs(last[1]-.25)<1e-9);
  r.engine.setMuted(true);
  last=master.gain.calls.at(-1)!;
  assert.deepEqual(last.slice(0,2),['target',0]);
  r.engine.setMuted(false);
  assert.ok(Math.abs(master.gain.calls.at(-1)![1]-.25)<1e-9);
  r.engine.setVolume(0);
  assert.equal(r.engine.play('nivel'),false,'volume 0 plays nothing');
});

test('mute fades active voices; muted or silent plays still vibrate and start the throttle window',()=>{
  const r=rig(),ctx=r.ctx;
  ctx.currentTime=1;
  const from=ctx.nodes.length;
  assert.equal(r.engine.play('chefe'),true);
  const out=ctx.nodes[from] as FakeGain,srcs=ctx.sources(from);
  assert.equal(r.vibes.length,1);
  assert.deepEqual(r.vibes[0],[...RECIPES.chefe.vibrate!]);
  r.engine.setMuted(true);
  assert.equal(r.engine.activeVoices(),0);
  assert.ok(faded(out,1));
  for(const s of srcs)assert.ok(near(s.stops.at(-1)!,1.03),'stopped on mute');
  r.setNow(1000);
  const n=ctx.nodes.length;
  assert.equal(r.engine.play('queda'),false);
  assert.equal(ctx.nodes.length,n);
  assert.equal(r.vibes.length,2,'muted fall still buzzes');
  assert.deepEqual(r.vibes[1],[...RECIPES.queda.vibrate!]);
  r.engine.setMuted(false);
  r.setNow(1000+RECIPES.queda.throttleMs-1);
  assert.equal(r.engine.play('queda'),false,'muted play started the throttle window');
  assert.equal(r.vibes.length,2);
  r.setNow(1000+RECIPES.queda.throttleMs);
  r.engine.setVibration(false);
  assert.equal(r.engine.play('queda'),true);
  assert.equal(r.vibes.length,2,'vibration off');
  r.engine.setVibration(true);
  r.engine.setVolume(0);
  r.setNow(5000);
  assert.equal(r.engine.play('queda'),false,'volume 0 plays nothing');
  assert.equal(r.vibes.length,3,'but still buzzes');
});

test('master runs through a limiter when available and connects directly otherwise',()=>{
  const r=rig(),ctx=r.ctx,master=masterOf(ctx);
  const lim=ctx.nodes.find((n):n is FakeCompressor=>n instanceof FakeCompressor)!;
  assert.ok(lim);
  assert.equal(lim.threshold.value,-6);assert.equal(lim.ratio.value,20);
  assert.deepEqual(master.connected,[lim]);
  assert.deepEqual(lim.connected,[ctx.destination]);
  const d=rig({compressor:false});
  assert.ok(!d.ctx.nodes.some(n=>n instanceof FakeCompressor));
  assert.deepEqual(masterOf(d.ctx).connected,[d.ctx.destination]);
  assert.equal(d.engine.play('nivel'),true);
});

test('setVolume with persist:false updates the gain without writing storage',()=>{
  const store=memStorage(),r=rig({storage:store}),master=masterOf(r.ctx);
  r.engine.setVolume(.4,{persist:false});
  assert.equal(store.map.has(SETTINGS_KEY),false);
  assert.equal(r.engine.settings.volume,.4);
  assert.ok(near(master.gain.calls.at(-1)![1],.16));
  r.engine.setVolume(.5);
  assert.equal(JSON.parse(store.map.get(SETTINGS_KEY)!).volume,.5);
  r.engine.setVolume(.9,{persist:false});
  assert.equal(JSON.parse(store.map.get(SETTINGS_KEY)!).volume,.5);
  assert.equal(new AudioEngine({storage:store}).settings.volume,.5);
  r.engine.setVolume(.6,{persist:true});
  assert.equal(JSON.parse(store.map.get(SETTINGS_KEY)!).volume,.6);
});

test('settings persist, survive corrupt or throwing storage and notify listeners',()=>{
  const store=memStorage();
  const a=new AudioEngine({storage:store,createContext:()=>{throw new Error('x');}});
  assert.deepEqual(a.settings,{...DEFAULT_SETTINGS});
  let fired=0;const off=a.onChange(()=>{fired++;});
  a.setVolume(.3);a.setMuted(true);a.setVibration(false);
  assert.equal(fired,3);
  off();a.setVolume(.4);assert.equal(fired,3);
  assert.deepEqual(JSON.parse(store.map.get(SETTINGS_KEY)!),{volume:.4,muted:true,vibration:false});
  assert.equal(SETTINGS_KEY,'viagem:audio:v1');
  assert.deepEqual(new AudioEngine({storage:store}).settings,{volume:.4,muted:true,vibration:false});
  store.map.set(SETTINGS_KEY,'{not json');
  assert.deepEqual(new AudioEngine({storage:store}).settings,{...DEFAULT_SETTINGS});
  store.map.set(SETTINGS_KEY,JSON.stringify({volume:9,muted:'yes',vibration:null}));
  assert.deepEqual(new AudioEngine({storage:store}).settings,{...DEFAULT_SETTINGS,volume:1});
  const t=new AudioEngine({storage:throwingStorage});
  assert.deepEqual(t.settings,{...DEFAULT_SETTINGS});
  assert.doesNotThrow(()=>{t.setVolume(.2);t.setMuted(true);});
  assert.equal(t.settings.volume,.2);
  assert.deepEqual(new AudioEngine({storage:null}).settings,{...DEFAULT_SETTINGS});
  assert.equal(DEFAULT_SETTINGS.vibration,true);assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

// ---- 6. robustness ----
test('a failing AudioContext never throws and plays nothing',()=>{
  const vibes:number[][]=[];
  const e=new AudioEngine({createContext:()=>{throw new Error('WebAudio unavailable');},vibrate:p=>{vibes.push(p);return true;}});
  const target=new CountingTarget();
  e.attachUnlock(target);
  assert.doesNotThrow(()=>target.dispatchEvent(new Event('touchend')));
  assert.equal(e.unlocked,true);assert.equal(e.running,false);
  assert.doesNotThrow(()=>target.dispatchEvent(new Event('click')));
  assert.equal(e.play('nivel'),false);
  assert.equal(e.play('queda'),false);
  assert.equal(vibes.length,1,'haptics still work without audio');
  assert.doesNotThrow(()=>{e.setVolume(.1);e.setMuted(true);e.suspend();e.dispose();});
  assert.equal(target.active,0);
});

test('dispose removes gesture and visibility listeners, closes the context and relocks',()=>{
  withDocument(doc=>{
    const r=rig({unlock:false}),target=new CountingTarget();
    r.engine.attachUnlock(target);
    target.dispatchEvent(new Event('pointerup'));
    const ctx=r.ctx,docs=doc as CountingTarget&{visibilityState:string};
    assert.equal(docs.active,1);
    ctx.state='suspended';
    let res=ctx.resumes;
    docs.visibilityState='hidden';docs.dispatchEvent(new Event('visibilitychange'));
    assert.equal(ctx.resumes,res,'hidden: no wake');
    docs.visibilityState='visible';docs.dispatchEvent(new Event('visibilitychange'));
    assert.equal(ctx.resumes,res+1,'visible again: wake');
    assert.equal(r.engine.running,true);
    const from=ctx.nodes.length;
    assert.equal(r.engine.play('chefe'),true);
    r.engine.dispose();
    assert.equal(target.active,0);
    assert.equal(docs.active,0);
    assert.equal(ctx.closes,1);
    assert.equal(r.engine.unlocked,false);assert.equal(r.engine.running,false);
    for(const s of ctx.sources(from))assert.equal(s.stops.length,2);
    assert.equal(r.engine.play('nivel'),false);
    res=ctx.resumes;
    docs.dispatchEvent(new Event('visibilitychange'));
    target.dispatchEvent(new Event('pointerup'));
    assert.equal(r.ctxs.length,1);assert.equal(ctx.resumes,res);
  });
  const l=rig({unlock:false}),target=new CountingTarget();
  l.engine.attachUnlock(target);
  l.engine.dispose();
  assert.equal(target.active,0);
  target.dispatchEvent(new Event('pointerup'));
  assert.equal(l.ctxs.length,0);
  assert.equal(l.engine.unlocked,false);
});

test('noise sounds use a filled, looping buffer',()=>{
  const r=rig(),ctx=r.ctx,from=ctx.nodes.length;
  assert.equal(r.engine.play('golpe'),true);
  const noise=ctx.nodes.slice(from).find((n):n is FakeBufferSource=>n instanceof FakeBufferSource)!;
  assert.ok(noise&&noise.loop);
  const data=(noise.buffer as {getChannelData(i:number):Float32Array}).getChannelData(0);
  assert.ok(data.length>1000&&data.some(v=>v!==0)&&data.every(v=>v>=-1&&v<=1));
});

// ---- 7. events ----
const ME='p1',OTHER='p2';
test('soundForEvent maps sim events to sounds for the local player',()=>{
  const cases:[SimEvent,SoundId|undefined][]=[
    [{type:'damage',target:'e1',amount:3,source:ME},'golpe'],
    [{type:'damage',target:ME,amount:3,source:'e1'},'golpe'],
    [{type:'damage',target:'e1',amount:3,source:OTHER},undefined],
    [{type:'damage',target:OTHER,amount:3,source:'e1'},undefined],
    [{type:'damage',target:'e1',amount:3},undefined],
    [{type:'pickup',player:ME,pickup:'g1',kind:'xp',value:1},'gema'],
    [{type:'pickup',player:ME,pickup:'c1',kind:'chest',value:1},'buzina'],
    [{type:'pickup',player:ME,pickup:'m1',kind:'magnet',value:1},'boing'],
    [{type:'pickup',player:OTHER,pickup:'g2',kind:'xp',value:1},undefined],
    [{type:'pickup',player:OTHER,pickup:'c2',kind:'chest',value:1},undefined],
    [{type:'levelup',level:2},'nivel'],
    [{type:'upgrade',player:ME,item:'x',level:2},'upgrade'],
    [{type:'evolve',player:ME,from:'a',to:'b'},'upgrade'],
    [{type:'upgrade',player:OTHER,item:'x',level:2},undefined],
    [{type:'downed',player:OTHER},'queda'],
    [{type:'revived',player:OTHER,by:ME},'resgate'],
    [{type:'eliminated',player:ME},'risada'],
    [{type:'boss-phase',enemy:'b1',phase:2},'chefe'],
    [{type:'round',index:1,phase:'wave'},'round-inicio'],
    [{type:'round',index:1,phase:'prepare'},undefined],
    [{type:'round',index:0,phase:'prepare'},undefined],
    [{type:'round',index:5,phase:'end'},'round-fim'],
    [{type:'bark',enemy:'e1',line:'oi'},undefined],
    [{type:'fire',player:ME,weapon:'w',x:0,y:0},undefined],
    [{type:'spawn-warning',x:0,y:0,atTick:10,count:3},undefined],
  ];
  for(const [event,want] of cases)assert.equal(soundForEvent(event,ME),want,JSON.stringify(event));
});

test('soundForEvent without a local player never treats a sourceless hit as own damage',()=>{
  assert.equal(soundForEvent({type:'damage',target:'e1',amount:1}),undefined);
});

test('playEvents counts successful plays and respects engine throttling',()=>{
  const r=rig();r.setNow(100);
  const hits:SimEvent[]=Array.from({length:30},()=>({type:'damage',target:'e1',amount:1,source:ME}));
  const events:SimEvent[]=[...hits,{type:'levelup',level:3},{type:'bark',enemy:'e',line:'x'},{type:'damage',target:'e1',amount:1,source:OTHER}];
  assert.equal(playEvents(r.engine,events,ME),2);
  const ids:SoundId[]=[];
  assert.equal(playEvents({play:id=>{ids.push(id);return id!=='nivel';}},events,ME),30);
  assert.equal(ids.length,31);
  const locked=rig({unlock:false});
  assert.equal(playEvents(locked.engine,events,ME),0);
});
