/**
 * Card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 4: the Uno's alarm. Silent beyond the radius, louder close and
 * while hit; the provisional loop meets at zero (no click at the seam); the voice joins the effects bus (volume, mute
 * and the ads' hush apply there) only once audible, and stops when the objective goes. Card
 * NEW-20261025-ORQ-alarme-uno-pausa: one pass, ALARM_GAP_S of silence, then again (file and synthesized).
 * Run: node --experimental-strip-types --test tests/client/uno-alarme.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {ALARM_EDGE_FADE_S,ALARM_GAP_S,ALARM_HIT_BOOST,ALARM_LOOP_S,ALARM_MAX,ALARM_RADIUS_U,ALARM_FILE,ALARM_FILE_WAIT_MS,AlarmLoop,alarmLevel,alarmSamples,alarmWithGap} from '../../src/client/audio/alarm.ts';

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
    createBuffer:(c:number,n:number,rate:number)=>{
      const data=Array.from({length:c},()=>new Float32Array(n));
      return {numberOfChannels:c,length:n,sampleRate:rate,getChannelData:(i:number)=>data[i]};
    },
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

test('the TangoFlux file: fetched once in the browser format, plays when decoded; synthesized when it fails or is slow',async()=>{
  const decoded=fakeSound(2,3.5,8000);
  const withFile=(load:(url:string)=>Promise<ArrayBuffer>)=>{
    const f=fakeAudio(),urls:string[]=[],sources:unknown[]=[];let now=0;
    const ctx=f.audio.context as unknown as Record<string,unknown>;
    ctx.decodeAudioData=async()=>decoded;
    const make=ctx.createBufferSource as ()=>Record<string,unknown>;
    ctx.createBufferSource=()=>{const s=make();sources.push(s);return s;};
    const loop=new AlarmLoop(f.audio,{format:'webm',nowMs:()=>now,loadFile:url=>{urls.push(url);return load(url);}});
    return {...f,loop,urls,sources,tick:(ms:number)=>{now+=ms;}};
  };
  const ok=withFile(async()=>new ArrayBuffer(8));
  ok.loop.update(true,ALARM_RADIUS_U+5,false);
  assert.deepEqual(ok.urls,[`${ALARM_FILE}.webm`],'asked as soon as the objective runs, before it is audible');
  await new Promise(r=>setImmediate(r));
  ok.loop.update(true,6,false);ok.loop.update(true,5,false);
  assert.equal(ok.urls.length,1,'once');
  const played=(ok.sources[0] as {buffer:{getChannelData:(c:number)=>Float32Array}}).buffer;
  assert.equal(played.getChannelData(1)[8000],decoded.getChannelData(1)[8000],'the file plays');
  const slow=withFile(()=>new Promise(()=>{}));
  slow.loop.update(true,6,false);
  assert.equal(slow.sources.length,0,'waits for the file a moment, in silence');
  slow.tick(ALARM_FILE_WAIT_MS);slow.loop.update(true,6,false);
  assert.equal(slow.sources.length,1,'then the synthesized loop');
  assert.notEqual((slow.sources[0] as {buffer:unknown}).buffer,decoded);
  const bad=withFile(async()=>{throw new Error('404');});
  bad.loop.update(true,6,false);await new Promise(r=>setImmediate(r));bad.loop.update(true,6,false);
  assert.equal(bad.sources.length,1,'failed: the synthesized loop at once');
});

/** A decoded stand-in: `channels` × `seconds` of a steady tone (0.5) at `rate` Hz. */
function fakeSound(channels:number,seconds:number,rate:number){
  const data=Array.from({length:channels},()=>new Float32Array(Math.round(seconds*rate)).fill(.5));
  return {numberOfChannels:channels,length:data[0].length,sampleRate:rate,getChannelData:(c:number)=>data[c]};
}

/** What the looping voice sounds like over [a, b) s: the peak of |sample| (the buffer wraps, as `loop` does). */
function heard(buffer:{length:number;sampleRate:number;getChannelData:(c:number)=>Float32Array},a:number,b:number){
  const d=buffer.getChannelData(0),rate=buffer.sampleRate;let peak=0;
  for(let i=Math.round(a*rate);i<Math.round(b*rate);i++)peak=Math.max(peak,Math.abs(d[i%buffer.length]));
  return peak;
}

test('the gap: one pass, then 4 s of silence, then again; the pass meets the silence at zero',()=>{
  assert.equal(ALARM_GAP_S,4);
  const rate=8000,pass=new Float32Array(Math.round(3.5*rate)).fill(.5),[out]=alarmWithGap([pass],rate);
  assert.equal(out.length,Math.round(7.5*rate),'3.5 s of alarm + 4 s of silence');
  const fade=Math.round(ALARM_EDGE_FADE_S*rate);
  assert.equal(out[0],0);assert.ok(Math.abs(out[Math.round(3.5*rate)-1])<1e-6,'no click into the gap');
  assert.equal(out[fade+10],.5,'the pass itself untouched past the fade');
  assert.equal(pass[0],.5,'the decoded sound is not modified');
  assert.deepEqual(alarmWithGap([pass,pass],rate).map(c=>c.length),[out.length,out.length],'every channel');
});

test('the voice over time (file and synthesized): sound 0–3.5 s, silence 3.5–7.5 s, sound again',async()=>{
  const file=fakeAudio(),ctx=file.audio.context as unknown as Record<string,unknown>,sources:{buffer:never;loop:boolean}[]=[];
  ctx.decodeAudioData=async()=>fakeSound(2,3.5,8000);
  const make=ctx.createBufferSource as ()=>{buffer:never;loop:boolean};
  ctx.createBufferSource=()=>{const s=make();sources.push(s);return s;};
  const loop=new AlarmLoop(file.audio,{format:'webm',loadFile:async()=>new ArrayBuffer(8)});
  loop.update(true,ALARM_RADIUS_U+5,false);await new Promise(r=>setImmediate(r));loop.update(true,6,false);
  const voice=sources[0];
  assert.ok(voice.loop,'it repeats');
  assert.ok(heard(voice.buffer,.1,3.4)>.4,'0–3.5 s: the alarm');
  assert.equal(heard(voice.buffer,3.5,7.5),0,'3.5–7.5 s: silence');
  assert.ok(heard(voice.buffer,7.6,10.9)>.4,'7.5 s: the alarm again');
  assert.equal(heard(voice.buffer,11,15),0,'and the gap again');
  // The synthesized loop (no file): 2.4 s of alarm, then the same 4 s of silence.
  const synth=fakeAudio(),synthCtx=synth.audio.context as unknown as Record<string,unknown>,made:{buffer:never}[]=[];
  const makeSynth=synthCtx.createBufferSource as ()=>{buffer:never};
  synthCtx.createBufferSource=()=>{const s=makeSynth();made.push(s);return s;};
  new AlarmLoop(synth.audio,{loadFile:null}).update(true,6,false);
  const b=made[0].buffer as {length:number;sampleRate:number};
  assert.equal(b.length,Math.round((ALARM_LOOP_S+ALARM_GAP_S)*b.sampleRate));
  assert.ok(heard(made[0].buffer,.2,1.4)>.3,'the siren');
  assert.equal(heard(made[0].buffer,ALARM_LOOP_S,ALARM_LOOP_S+ALARM_GAP_S),0,'4 s of silence');
  assert.ok(heard(made[0].buffer,ALARM_LOOP_S+ALARM_GAP_S+.2,ALARM_LOOP_S+ALARM_GAP_S+1.4)>.3,'the siren again');
});

test('the imported loop (scripts/import-uno-alarme.mjs): both formats in public/, small',()=>{
  for(const f of ['webm','m4a']){
    const size=statSync(new URL(`../../public${ALARM_FILE}.${f}`,import.meta.url)).size;
    assert.ok(size>8_000&&size<60_000,`uno-alarme.${f}: ${size} B`);
  }
});
