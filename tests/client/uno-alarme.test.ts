/**
 * Card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 4: the Uno's alarm. Silent beyond the radius, louder close and
 * while hit; the provisional loop meets at zero (no click at the seam); the voice joins the effects bus (volume, mute
 * and the ads' hush apply there) only once audible, and stops when the objective goes.
 * Run: node --experimental-strip-types --test tests/client/uno-alarme.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ALARM_HIT_BOOST,ALARM_LOOP_S,ALARM_MAX,ALARM_RADIUS_U,AlarmLoop,alarmLevel,alarmSamples} from '../../src/client/audio/alarm.ts';

test('level: silent beyond the radius (no bed), rises toward the car, louder while hit, never above 1',()=>{
  assert.equal(alarmLevel(ALARM_RADIUS_U,false),0);assert.equal(alarmLevel(ALARM_RADIUS_U+50,true),0);
  assert.equal(alarmLevel(NaN,false),0);assert.equal(alarmLevel(-1,false),0);
  assert.equal(alarmLevel(0,false),ALARM_MAX);
  const far=alarmLevel(ALARM_RADIUS_U*.8,false),mid=alarmLevel(ALARM_RADIUS_U*.4,false);
  assert.ok(far>0&&mid>far&&ALARM_MAX>mid,'louder coming close');
  assert.ok(Math.abs(alarmLevel(5,true)-alarmLevel(5,false)*ALARM_HIT_BOOST)<1e-12);
  assert.ok(alarmLevel(0,true)<=1);
});

test('the provisional loop: 2.4 s, both ends at zero, siren and horn parts, peak under 0.8',()=>{
  const rate=8000,s=alarmSamples(rate);
  assert.equal(s.length,Math.round(ALARM_LOOP_S*rate));
  assert.ok(Math.abs(s[0])<1e-3&&Math.abs(s[s.length-1])<1e-3,'the seam meets at zero');
  let peak=0;for(const v of s)peak=Math.max(peak,Math.abs(v));
  assert.ok(peak<=.8&&peak>.3);
  const rms=(a:number,b:number)=>{let q=0;for(let i=Math.round(a*rate);i<Math.round(b*rate);i++)q+=s[i]**2;return Math.sqrt(q/((b-a)*rate));};
  assert.ok(rms(.2,1.4)>.15,'siren');assert.ok(rms(1.72,1.83)>.15,'horn');assert.ok(rms(1.62,1.68)<.01,'a gap');
  assert.deepEqual(alarmSamples(rate),s,'deterministic');
});

/** A stand-in WebAudio: records the graph and the level targets. */
function fakeAudio(){
  const log:string[]=[];
  const gain={gain:{value:1,setTargetAtTime:(v:number)=>{log.push(`level ${v.toFixed(3)}`);}},connect:(n:unknown)=>{log.push(n===bus?'gain→effects':'gain→?');},disconnect:()=>log.push('gain off')};
  const bus={};
  const ctx={currentTime:0,sampleRate:8000,createGain:()=>gain,
    createBuffer:(_c:number,n:number)=>{const d=new Float32Array(n);return {getChannelData:()=>d};},
    createBufferSource:()=>({buffer:null,loop:false,connect:()=>log.push('src→gain'),start:()=>log.push('start'),stop:()=>log.push('stop'),disconnect:()=>{}})};
  return {log,audio:{unlocked:true,context:ctx as unknown as AudioContext,effectsOutput:bus as unknown as AudioNode}};
}

test('the loop: no voice while silent, joins the effects bus once audible, follows the level, stops with the objective',()=>{
  const {log,audio}=fakeAudio(),loop=new AlarmLoop(audio);
  loop.update(true,ALARM_RADIUS_U+5,false);
  assert.deepEqual(log,[],'far away: no voice at all');
  loop.update(true,6,false);
  assert.deepEqual(log.slice(0,3),['gain→effects','src→gain','start']);
  assert.equal(log.at(-1),`level ${alarmLevel(6,false).toFixed(3)}`);
  loop.update(true,6,true);assert.equal(log.at(-1),`level ${alarmLevel(6,true).toFixed(3)}`);
  loop.update(true,ALARM_RADIUS_U+5,false);assert.equal(log.at(-1),'level 0.000','walked away: faded to silence');
  loop.update(false,6,false);assert.ok(log.includes('stop'),'the objective went');
  const n=log.length;loop.update(false,6,false);assert.equal(log.length,n,'nothing more');
  // Locked (before the first gesture): nothing at all.
  const locked=fakeAudio();new AlarmLoop({...locked.audio,unlocked:false}).update(true,1,true);assert.deepEqual(locked.log,[]);
});
