/**
 * NEW-20261028-ORQ-som-alarme-gema-e-chefe (auditoria som-impacto itens 6, 7 e 10):
 * - the gem (the kill's cédula) climbs a semitone per catch in a row and is back at its base pitch 1 s later
 *   (recipes.ts GemCombo, played by audio/events.ts playEvents and hud/rescue.ts), and its recipe follows the pitch too;
 * - the Uno's alarm is loud while the sim's alarm runs (alarmOn), not only 1.5 s after a hit (alarm.ts alarmHit);
 *   the intermission's 'horn' honks;
 * - an elite's and a boss's death tremble and pause the drawing; reduced motion cuts both (render/impact-rules.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {GEM_COMBO_MS,GEM_COMBO_MAX,GemCombo,gemRate} from '../../src/client/audio/recipes.ts';
import {playEvents,soundForEvent} from '../../src/client/audio/events.ts';
import {ALARM_HIT_MS,alarmHit} from '../../src/client/audio/alarm.ts';
import {BOSS_SHAKE_PX,DEATH_SHAKE_MS,ELITE_SHAKE_PX,GEM_GLOW_MS,HIT_STOP_MS,HitStop,deathImpact,gemGlow,shakeIntensity} from '../../src/client/render/impact-rules.ts';
import {AudioEngine} from '../../src/client/audio/engine.ts';
import {RECIPES} from '../../src/client/audio/recipes.ts';
import type {SimEvent} from '../../src/contract/types.ts';

const ME='p1';
const semitone=2**(1/12);

test('the gem climbs a semitone per catch in a row, up to its cap, and is back at the base pitch 1 s later',()=>{
  const combo=new GemCombo();
  assert.equal(combo.next(0),1,'the first gem: base pitch');
  assert.ok(Math.abs(combo.next(300)-semitone)<1e-9,'the second, a semitone up');
  assert.ok(Math.abs(combo.next(600)-semitone**2)<1e-9);
  assert.equal(combo.next(600+GEM_COMBO_MS+1),1,'a pause over 1 s: back to the base');
  let rate=1;for(let i=0;i<40;i++)rate=combo.next(5000+i*100);
  assert.ok(Math.abs(rate-gemRate(GEM_COMBO_MAX))<1e-9,'it stops climbing at the cap');
  assert.ok(gemRate(GEM_COMBO_MAX)<=2,'within the engine\'s playback range');
  assert.equal(combo.next(5000+39*100+GEM_COMBO_MS),gemRate(GEM_COMBO_MAX),'exactly 1 s still counts');
});

test('playEvents: my gems climb in pitch, a gem heard at the catch neither plays nor counts, others\' are silent',()=>{
  const played:{id:string;rate?:number}[]=[];
  const audio={play(id:string,opts:{rate?:number}={}){played.push({id,rate:opts.rate});return true;}};
  const gem=(pickup:string,player=ME):SimEvent=>({type:'pickup',player,pickup,kind:'grana',value:1});
  const combo=new GemCombo();let now=0;
  playEvents(audio as never,[gem('a'),gem('b'),gem('c','p2')],ME,undefined,undefined,{gems:combo,now:()=>now});
  assert.deepEqual(played.map(p=>p.id),['gema','gema']);
  assert.equal(played[0].rate,1);assert.ok(Math.abs(played[1].rate!-semitone)<1e-9);
  played.length=0;now=100;
  playEvents(audio as never,[gem('d'),gem('e')],ME,e=>(e as {pickup:string}).pickup==='d',undefined,{gems:combo,now:()=>now});
  assert.equal(played.length,1);
  assert.ok(Math.abs(played[0].rate!-semitone**2)<1e-9,'the heard one did not climb');
  played.length=0;now=100+GEM_COMBO_MS+50;
  playEvents(audio as never,[gem('f')],ME,undefined,undefined,{gems:combo,now:()=>now});
  assert.equal(played[0].rate,1,'back to the base after the pause');
});

test('the Uno: loud while the sim\'s alarm runs or right after a hit; the horn honks',()=>{
  assert.equal(alarmHit(true,Infinity),true,'the sim\'s alarm on: loud');
  assert.equal(alarmHit(false,Infinity),false,'off: back to the soft pass');
  assert.equal(alarmHit(false,ALARM_HIT_MS),true);assert.equal(alarmHit(false,ALARM_HIT_MS+1),false);
  assert.equal(soundForEvent({type:'horn',endsTick:900} as SimEvent,ME),'buzina');
});

test('an elite\'s and a boss\'s death tremble and pause the drawing; reduced motion cuts both',()=>{
  assert.equal(deathImpact(false,false,false),undefined,'a plain critter: nothing');
  assert.deepEqual(deathImpact(false,true,false),{shakePx:ELITE_SHAKE_PX,shakeMs:DEATH_SHAKE_MS,stopMs:HIT_STOP_MS});
  assert.deepEqual(deathImpact(true,false,false),{shakePx:BOSS_SHAKE_PX,shakeMs:DEATH_SHAKE_MS,stopMs:HIT_STOP_MS});
  assert.equal(ELITE_SHAKE_PX,3);assert.equal(BOSS_SHAKE_PX,6);assert.equal(HIT_STOP_MS,60);
  assert.equal(deathImpact(true,false,true),undefined,'reduced motion: no tremble, no hit-stop');
  assert.equal(deathImpact(false,true,true),undefined);
  // Phaser's shake lands intensity × size × zoom² on screen.
  for(const zoom of [.5,1,2.3]){const i=shakeIntensity(6,390,844,zoom);assert.ok(Math.abs(i.x*390*zoom**2-6)<1e-9&&Math.abs(i.y*844*zoom**2-6)<1e-9);}
});

test('the hit-stop holds the drawn clock 60 ms, then runs on without a jump; a second stop extends it',()=>{
  const stop=new HitStop();
  assert.equal(stop.clock(1000),1000,'no stop: the real clock');
  stop.start(1000,HIT_STOP_MS);
  assert.equal(stop.clock(1010),1000);assert.equal(stop.clock(1059),1000);assert.ok(stop.stopped(1059));
  assert.equal(stop.clock(1060),1000,'resumes where it stopped');
  assert.equal(stop.clock(1100),1040);assert.ok(!stop.stopped(1100));
  stop.start(2000,60);stop.start(2030,60);
  assert.equal(stop.clock(2080),2000-60,'still held: extended to 2090');
  assert.equal(stop.clock(2200),2200-60-90);
  stop.start(3000,0);assert.equal(stop.clock(3000),3000-150,'a zero stop does nothing');
});

test('the caught gem\'s glow grows and fades in GEM_GLOW_MS; reduced motion only fades',()=>{
  const a=gemGlow(0,false)!,b=gemGlow(GEM_GLOW_MS/2,false)!;
  assert.ok(b.size>a.size&&b.alpha<a.alpha);
  assert.equal(gemGlow(GEM_GLOW_MS,false),undefined);assert.equal(gemGlow(-1,false),undefined);
  assert.equal(gemGlow(0,true)!.size,gemGlow(GEM_GLOW_MS-1,true)!.size,'no growth with reduced motion');
});

// A minimal WebAudio stand-in: only what the recipe path touches.
class Param {value=0;sets:number[]=[];setValueAtTime(v:number){this.sets.push(v);this.value=v;return this;}linearRampToValueAtTime(){return this;}exponentialRampToValueAtTime(){return this;}setTargetAtTime(){return this;}cancelScheduledValues(){return this;}}
class Node {connect(d:unknown){return d;}disconnect(){}}
class Src extends Node {onended:(()=>void)|null=null;start(){}stop(){}}
class Osc extends Src {type='sine';frequency=new Param();}
class Ctx {
  sampleRate=48000;currentTime=0;state='running';destination=new Node();oscs:Osc[]=[];
  createGain(){return Object.assign(new Node(),{gain:new Param()});}
  createOscillator(){const o=new Osc();this.oscs.push(o);return o;}
  createBufferSource(){return Object.assign(new Src(),{buffer:null,loop:false,playbackRate:new Param()});}
  createBiquadFilter(){return Object.assign(new Node(),{type:'',frequency:new Param(),Q:new Param()});}
  createBuffer(_c:number,length:number){return {length,duration:length/48000,getChannelData:()=>new Float32Array(length)};}
  resume(){return Promise.resolve();}
  close(){return Promise.resolve();}
}

test('the synthesized gem follows the combo pitch too (no file: the recipe plays)',()=>{
  const ctx=new Ctx();let now=0;
  const engine=new AudioEngine({createContext:()=>ctx as unknown as AudioContext,nowMs:()=>now,loadFile:null,storage:null});
  engine.unlock();
  const first=RECIPES.gema.tones[0].from;
  assert.ok(engine.play('gema'));
  assert.equal(ctx.oscs.at(-2)!.frequency.sets[0],first);
  now=1000;const rate=gemRate(5);
  assert.ok(engine.play('gema',{rate}));
  assert.ok(Math.abs(ctx.oscs.at(-2)!.frequency.sets[0]-first*rate)<1e-6,'a semitone step is a frequency step');
});
