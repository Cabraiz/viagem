/**
 * NEW-20261028-ORQ-sons-da-partida-ligados: the match's sounds (audio/events.ts cueForEvent, fed once per authoritative
 * view by hud/rescue.ts). The fall whistle plays once (the caído's call is the 'sos' ping), the kill has its plop (an
 * elite's a smaller chefe-morte), the team hears a rescue quietly, and the hits vary in pitch under a 70 ms throttle.
 * The storm: 300 critters hit every frame stay ≤ MAX_VOICES, each sound within its throttle, under 0 dBFS at the default
 * volume (the sounds adding in power; their all-in-phase worst case is the master limiter's, engine.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AudioEngine,DEFAULT_SETTINGS,MAX_VOICES} from '../../src/client/audio/engine.ts';
import {busGain} from '../../src/client/audio/settings.ts';
import {CRIT_CUE,ELITE_DEATH,HIT_RATES,KILL_RATES,TEAM_RESCUE_GAIN,bucket,cueForEvent,playEvents,soundForEvent} from '../../src/client/audio/events.ts';
import {RECIPES} from '../../src/client/audio/recipes.ts';
import {SFX,sfxNames} from '../../src/client/audio/sfx.ts';
import {SOUND_IDS,type SoundId} from '../../src/client/audio/types.ts';
import type {SimEvent} from '../../src/contract/types.ts';

const ME='p1',OTHER='p2';

test('each match event plays its cue: hits by target pitch, crit lower and louder, kill plop, elite and boss deaths',()=>{
  const hit=(target:string,extra:Partial<SimEvent&{type:'damage'}>={})=>cueForEvent({type:'damage',target,amount:3,source:ME,...extra} as SimEvent,ME);
  assert.deepEqual(hit('e1'),{id:'bicho-acerto',rate:HIT_RATES[bucket('e1',4)]});
  assert.deepEqual(hit('e1',{weapon:'faca'}),{id:'golpe',rate:HIT_RATES[bucket('e1',4)]});
  assert.deepEqual(hit('e1',{crit:true}),{id:'bicho-acerto',...CRIT_CUE});
  assert.deepEqual(hit('e1'),hit('e1'),'the same critter always sounds the same');
  const rates=new Set(Array.from({length:40},(_,i)=>hit(`e${i}`)!.rate));
  assert.equal(rates.size,HIT_RATES.length,'the crowd reaches every pitch');
  assert.ok(CRIT_CUE.rate<Math.min(...HIT_RATES)&&CRIT_CUE.gain>1,'a crit is lower and louder than any hit');
  assert.equal(cueForEvent({type:'damage',target:'e1',amount:3,source:OTHER},ME),undefined,'an ally\'s hit is silent here');
  assert.deepEqual(cueForEvent({type:'damage',target:ME,amount:3,source:'e1'},ME),{id:'dano-heroi'});

  const kill=(enemy:string,kind='bebado',by=ME,elite?:(id:string)=>boolean)=>cueForEvent({type:'kill',enemy,kind,by,x:0,y:0},ME,elite);
  assert.deepEqual(kill('e7'),{id:'bicho-morte',rate:KILL_RATES[bucket('e7',KILL_RATES.length)]});
  assert.equal(kill('e7','bebado',OTHER),undefined,'an ally\'s kill is silent here');
  assert.deepEqual(kill('e7','bebado',ME,id=>id==='e7'),{id:'chefe-morte',...ELITE_DEATH},'an elite: a smaller chefe-morte');
  assert.equal(kill('e7','bebado',OTHER,()=>true),undefined,'an ally\'s elite too');
  assert.deepEqual(kill('b1','chefe',OTHER),{id:'chefe-morte'},'the boss falls for everyone, full');
  assert.ok(SFX['chefe-morte'].throttleMs===0&&SFX['chefe-morte'].priority>SFX['bicho-morte'].priority,'never eaten by a crowd of plops');
});

test('the fall whistles once; the caído\'s call is its own sos ping (a recipe, no file)',()=>{
  assert.equal(soundForEvent({type:'downed',player:OTHER},ME),'queda');
  assert.equal(soundForEvent({type:'downed',player:ME},ME),'queda');
  assert.ok((SOUND_IDS as readonly string[]).includes('sos'));
  assert.equal(SFX.sos.takes,0);
  assert.ok(!sfxNames().includes('sos'),'no file is asked for');
  const r=RECIPES.sos;
  assert.ok(r.priority>=2&&r.throttleMs>=300&&r.tones.length<=4,'short and heard');
  const src=readFileSync(new URL('../../src/client/hud/rescue.ts',import.meta.url),'utf8');
  assert.ok(!/play\('queda'\)/.test(src),'the SOS ping no longer plays the fall again');
  assert.ok(/play\('sos'\)/.test(src));
});

test('a rescue: the rescuer full, the rescued sighs "ufa", the team quietly; rescue.ts plays it no more',()=>{
  assert.deepEqual(cueForEvent({type:'revived',player:OTHER,by:ME},ME),{id:'resgate'});
  assert.deepEqual(cueForEvent({type:'revived',player:ME,by:OTHER},ME),{id:'ufa',with:{id:'levantar'}},'the rescued sighs and gets up');
  assert.deepEqual(cueForEvent({type:'revived',player:OTHER,by:'p3'},ME),{id:'resgate',gain:TEAM_RESCUE_GAIN});
  assert.ok(TEAM_RESCUE_GAIN<.5);
  const src=readFileSync(new URL('../../src/client/hud/rescue.ts',import.meta.url),'utf8');
  assert.ok(!/play\('resgate'\)/.test(src),'one resgate per rescue (playEvents), not two for the rescuer');
  assert.ok(/playEvents\(audio,[^;]*feed\.enemies\.get\(id\)\?\.elite/.test(src),'the feed tells the elites');
});

test('playEvents hands the cue\'s level and pitch to the engine',()=>{
  const calls:[SoundId,{gain?:number;rate?:number}|undefined][]=[];
  const audio={play:(id:SoundId,opts?:{gain?:number;rate?:number})=>{calls.push([id,opts]);return true;}};
  playEvents(audio,[{type:'revived',player:OTHER,by:'p3'},{type:'kill',enemy:'x',kind:'bebado',by:ME,x:0,y:0},{type:'levelup',level:2}],ME,undefined,id=>id==='x');
  assert.deepEqual(calls,[['resgate',{gain:TEAM_RESCUE_GAIN}],['chefe-morte',{...ELITE_DEATH}],['nivel',{}]]);
});

test('the hit and the plop are throttled at 70 and 80 ms',()=>{
  assert.equal(RECIPES.golpe.throttleMs,70);
  assert.equal(SFX.golpe.throttleMs,70);
  assert.equal(SFX['bicho-acerto'].throttleMs,70);
  assert.equal(SFX['bicho-morte'].throttleMs,80);
});

// ---- the storm, on an engine with every file decoded ----

class Param {value=1;setValueAtTime(){return this;}linearRampToValueAtTime(){return this;}exponentialRampToValueAtTime(){return this;}setTargetAtTime(){return this;}cancelScheduledValues(){return this;}}
class Node {connected:unknown[]=[];connect(d:unknown){this.connected.push(d);return d;}disconnect(){}}
class Gain extends Node {gain=new Param();}
class Source extends Node {starts:number[]=[];stops:number[]=[];onended:(()=>void)|null=null;start(t=0){this.starts.push(t);}stop(t=0){this.stops.push(t);}}
class BufferSource extends Source {buffer:{duration:number;length?:number;name?:string}|null=null;loop=false;playbackRate=new Param();}
class Osc extends Source {type='sine';frequency=new Param();}
/** Every take lasts this long (the imported files are 0.2 to 1.7 s; the hits and the plop ~0.3 s). */
const TAKE_S=.35;
class Ctx {
  sampleRate=48000;currentTime=0;state='running';destination=new Node();nodes:Node[]=[];
  add<T extends Node>(n:T){this.nodes.push(n);return n;}
  createGain(){return this.add(new Gain());}
  createBufferSource(){return this.add(new BufferSource());}
  createOscillator(){return this.add(new Osc());}
  createBiquadFilter(){return this.add(Object.assign(new Node(),{type:'',frequency:new Param(),Q:new Param()}));}
  createBuffer(_c:number,length:number){return {length,duration:length/48000,getChannelData:()=>new Float32Array(length)};}
  decodeAudioData(data:ArrayBuffer){return Promise.resolve({duration:TAKE_S,name:new TextDecoder().decode(data)});}
  resume(){return Promise.resolve();}
  close(){return Promise.resolve();}
  played(){return this.nodes.filter((n):n is BufferSource=>n instanceof BufferSource&&(n.buffer?.length??0)!==1&&n.starts.length>0);}
}
const settle=()=>new Promise(r=>setTimeout(r,0));

test('300 critters hit every frame for 3 s: each sound within its throttle, ≤ MAX_VOICES, under 0 dBFS at the default volume',async()=>{
  const ctx=new Ctx();let now=0;
  const engine=new AudioEngine({createContext:()=>ctx as unknown as AudioContext,nowMs:()=>now,format:'webm',random:()=>.5,storage:null,
    loadFile:url=>Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer)});
  engine.unlock();
  engine.preload(['bicho-acerto','bicho-morte','golpe','chefe-morte','dano-heroi','gema']);
  await settle();
  const counts=new Map<SoundId,number>(),audio={play:(id:SoundId,opts?:{gain?:number;rate?:number})=>{
    const ok=engine.play(id,opts);if(ok)counts.set(id,(counts.get(id)??0)+1);return ok;}};
  const FRAME_MS=50,FRAMES=60,elites=new Set(['e0','e150']);
  // Each file peaks at -1 dBFS (scripts/import-sfx.mjs); the effects bus at its default volume (settings.ts).
  const FILE_PEAK=10**(-1/20),bus=busGain(DEFAULT_SETTINGS.effects);
  let rms=0,inPhase=0,maxVoices=0;
  for(let f=0;f<FRAMES;f++){
    now=f*FRAME_MS;ctx.currentTime=now/1000;
    const events:SimEvent[]=[];
    for(let i=0;i<300;i++)events.push({type:'damage',target:`e${i}`,amount:2,source:ME,weapon:i%3?'pistola':'faca',crit:i%17===0});
    for(let i=0;i<20;i++)events.push({type:'kill',enemy:`e${(f*20+i)%300}`,kind:'bebado',by:ME,x:0,y:0});
    events.push({type:'damage',target:ME,amount:1,source:'e9'},{type:'pickup',player:ME,pickup:`g${f}`,kind:'xp',value:1});
    playEvents(audio,events,ME,undefined,id=>elites.has(id));
    maxVoices=Math.max(maxVoices,engine.activeVoices());
    // The levels sounding now (a stolen voice fades out in 5 ms and stops 30 ms later: gone).
    const t=ctx.currentTime;let sum=0,power=0;
    for(const src of ctx.played()){
      const start=src.starts[0],end=Math.min(start+src.buffer!.duration/src.playbackRate.value,(src.stops[0]??Infinity)-.025);
      if(start>t+.01||end<=t)continue;
      const g=(src.connected[0] as Gain).gain.value;sum+=g;power+=g*g;
    }
    // Different sounds add up in power; all of them peaking on the same sample is the bound the limiter is for.
    rms=Math.max(rms,Math.sqrt(power)*FILE_PEAK*bus);inPhase=Math.max(inPhase,sum*FILE_PEAK*bus);
  }
  const seconds=FRAMES*FRAME_MS/1000;
  for(const [id,n] of counts){
    const throttle=SFX[id].throttleMs;
    if(throttle>0)assert.ok(n<=Math.ceil(seconds*1000/Math.max(throttle,FRAME_MS))+1,`${id}: ${n} plays in ${seconds} s`);
  }
  assert.ok(counts.get('bicho-acerto')!>0&&counts.get('golpe')!>0&&counts.get('bicho-morte')!>0,'the storm is heard');
  assert.ok(maxVoices<=MAX_VOICES,`${maxVoices} voices`);
  assert.ok(rms<1,`the storm at ${(20*Math.log10(rms)).toFixed(1)} dBFS`);
  const db=(x:number)=>(20*Math.log10(x)).toFixed(1);
  console.log(`storm: ${[...counts].map(([id,n])=>`${id} ${n}`).join(', ')}; ${maxVoices} voices; ${db(rms)} dBFS (all in phase ${db(inPhase)}, the limiter's)`);
});

// ---- NEW-20261029-ORQ-som-golpe-e-resgate ----

test('a slash storm through the engine: every pitch of the hit is heard, a crit lower, ≤ 1 thwack per 70 ms',async()=>{
  const ctx=new Ctx();let now=0;
  const engine=new AudioEngine({createContext:()=>ctx as unknown as AudioContext,nowMs:()=>now,format:'webm',random:()=>.5,storage:null,
    loadFile:url=>Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer)});
  engine.unlock();engine.preload(['golpe']);await settle();
  const before=ctx.played().length;
  // 300 critters slashed every 10 ms for 2 s (faster than any frame): the crowd, not one target.
  for(let t=0;t<2000;t+=10){
    now=t;ctx.currentTime=t/1000;
    const i=t/10;
    playEvents(engine,[{type:'damage',target:`e${(i*37)%300}`,amount:2,source:ME,weapon:'faca',crit:i%23===0}],ME);
  }
  const golpes=ctx.played().slice(before).filter(s=>s.buffer?.name?.includes('golpe'));
  assert.ok(golpes.length<=Math.ceil(2000/70)+1,`${golpes.length} thwacks in 2 s`);
  assert.ok(golpes.length>=20,'the storm is heard');
  const rates=new Set(golpes.map(s=>Math.round(s.playbackRate.value*100)/100));
  for(const r of HIT_RATES)assert.ok(rates.has(r),`the pitch ${r} is heard (${[...rates]})`);
  assert.ok(rates.has(CRIT_CUE.rate),'the crit lands lower');
});

test('one rescue sounds once on each phone: resgate for the rescuer, ufa for the rescued, a quiet resgate for the team',()=>{
  const event:SimEvent={type:'revived',player:'p2',by:'p1'};
  const heard=(local:string)=>{const calls:[SoundId,unknown][]=[];playEvents({play:(id,opts)=>{calls.push([id,opts]);return true;}},[event],local);return calls;};
  assert.deepEqual(heard('p1'),[['resgate',{}]]);
  assert.deepEqual(heard('p2'),[['ufa',{}],['levantar',{}]],'the rescued also gets up');
  assert.deepEqual(heard('p3'),[['resgate',{gain:TEAM_RESCUE_GAIN}]]);
  // 'ufa' and 'tsc' are recipes only: no file asked for, short and heard over the crowd's hits.
  for(const id of ['ufa','tsc'] as const){
    assert.ok((SOUND_IDS as readonly string[]).includes(id));
    assert.equal(SFX[id].takes,0);assert.ok(!sfxNames().includes(id));
    const r=RECIPES[id];
    assert.ok(r.priority>RECIPES.golpe.priority&&r.throttleMs>=300&&r.tones.length<=3,id);
  }
  assert.ok(Math.max(...RECIPES.tsc.tones.map(t=>t.from))<1000,'the "tsc" is low');
});

test('"sem alvo" is heard: the skill\'s empty answer plays the tsc once, the engine throttles a second tap',()=>{
  const src=readFileSync(new URL('../../src/client/hud/skill.ts',import.meta.url),'utf8');
  assert.ok(/if\(verdict==='none'\)\{this\.flash\(NOTE_NO_TARGET,now\);const audio=getAudio\(\);if\(audio\.unlocked\)audio\.play\('tsc'\);\}/.test(src));
  const ctx=new Ctx();let now=0;
  const engine=new AudioEngine({createContext:()=>ctx as unknown as AudioContext,nowMs:()=>now,storage:null,loadFile:()=>Promise.reject(new Error('no file'))});
  engine.unlock();
  assert.ok(engine.play('tsc'));now=100;assert.ok(!engine.play('tsc'),'a second tap 100 ms later stays quiet');
  now=400;assert.ok(engine.play('tsc'));
});
