/**
 * NEW-20261022-ORQ-sons-ia-ace-step: the TangoFlux sound files (public/audio/sfx/, scripts/import-sfx.mjs), the engine
 * playing them with the procedural recipes as the fallback, the weapons' and towers' sounds and the footsteps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {ALL_SOUND_IDS,FILE_SOUND_IDS,SOUND_IDS,type SoundId} from '../../src/client/audio/types.ts';
import {RECIPES} from '../../src/client/audio/recipes.ts';
import {SFX,SFX_WARM,drawTake,pickSfxFormat,sfxNames,sfxUrl} from '../../src/client/audio/sfx.ts';
import {AudioEngine} from '../../src/client/audio/engine.ts';
import {PACK12_TYPES,chestSound,weaponSound} from '../../src/client/audio/events.ts';
import {Footsteps,STEP_DB,STEP_PITCH,allyGain,stepJitter} from '../../src/client/audio/footsteps.ts';
import {CALIBRE} from '../../src/client/render/towers/tower-rules.ts';
import {PACK12} from '../../src/sim/weapons/pack12.ts';
import {ARSENAL_WEAPONS,NEW_WEAPONS} from '../../src/sim/weapons/arsenal.ts';
import {WEAPON_CATALOG} from '../../src/sim/weapons/catalog.ts';

const SFX_DIR=new URL('../../public/audio/sfx/',import.meta.url);
const file=(name:string)=>new URL(name,SFX_DIR);

// ---- files ----

test('every SoundId has its files (webm and m4a) or a procedural fallback',()=>{
  assert.deepEqual(Object.keys(SFX).sort(),[...ALL_SOUND_IDS].sort(),'one SFX entry per sound');
  assert.equal(new Set(ALL_SOUND_IDS).size,ALL_SOUND_IDS.length,'no id twice');
  for(const id of ALL_SOUND_IDS){
    const takes=Array.from({length:SFX[id].takes},(_,i)=>sfxUrl(id,i,'webm').slice('/audio/sfx/'.length,-'.webm'.length));
    const files=takes.every(n=>existsSync(file(`${n}.webm`))&&existsSync(file(`${n}.m4a`)));
    const recipe=(SOUND_IDS as readonly string[]).includes(id)&&!!RECIPES[id as keyof typeof RECIPES];
    assert.ok(files||recipe,`${id}: no file and no recipe`);
  }
  // The file-only sounds have nothing else: their files must all be there.
  for(const id of FILE_SOUND_IDS)for(let i=0;i<SFX[id].takes;i++)assert.ok(existsSync(file(sfxUrl(id,i,'webm').slice('/audio/sfx/'.length))),`${id} take ${i+1}`);
});

test('the files are the ones imported: index.json lists each, small, and under the 1.5 MB budget',()=>{
  const index=JSON.parse(readFileSync(file('index.json'),'utf8')) as Record<string,{seconds:number;webm:number;m4a:number;gainDb:number}>;
  assert.deepEqual(Object.keys(index).sort(),sfxNames().sort(),'index.json = the names the sounds need');
  let webm=0,m4a=0;
  for(const name of sfxNames()){
    const w=statSync(file(`${name}.webm`)).size,a=statSync(file(`${name}.m4a`)).size;
    assert.equal(w,index[name].webm,`${name}.webm is the imported one`);
    assert.ok(w<24_000&&a<24_000,`${name}: ${w} B webm, ${a} B m4a`);
    assert.ok(index[name].seconds>0&&index[name].seconds<=1.7,`${name}: ${index[name].seconds} s`);
    webm+=w;m4a+=a;
  }
  // A browser downloads one format: each stays under the card's 1.5 MB for every effect.
  assert.ok(webm<1.5e6&&m4a<1.5e6,`${webm} B webm, ${m4a} B m4a`);
});

test('six takes of the snow step; the warm set and the format pick',()=>{
  assert.equal(SFX['passo-neve'].takes,6);
  assert.equal(sfxUrl('passo-neve',0,'webm'),'/audio/sfx/passo-neve-1.webm');
  assert.equal(sfxUrl('passo-neve',5,'m4a'),'/audio/sfx/passo-neve-6.m4a');
  assert.equal(sfxUrl('golpe',0,'webm'),'/audio/sfx/golpe.webm');
  for(const id of SFX_WARM)assert.ok(SFX[id],id);
  assert.equal(pickSfxFormat(t=>t.includes('webm')?'probably':''),'webm');
  assert.equal(pickSfxFormat(t=>t.includes('mp4')?'maybe':''),'m4a');
  assert.equal(pickSfxFormat(()=>''),null);
  assert.equal(pickSfxFormat(()=>{throw new Error('x');}),null);
});

test('drawTake never repeats the last take and reaches every other one',()=>{
  assert.equal(drawTake(1,0,.9),0);
  for(let last=0;last<6;last++){
    const seen=new Set<number>();
    for(let r=0;r<1;r+=.01){const t=drawTake(6,last,r);assert.notEqual(t,last);assert.ok(t>=0&&t<6);seen.add(t);}
    assert.equal(seen.size,5);
  }
  assert.ok(drawTake(6,undefined,.999)<6);
});

// ---- weapons, towers, chests ----

test('every weapon a hero can fire has a sound: arsenal, Pack 12 by type, the class weapons and their evolutions',()=>{
  for(const w of PACK12)assert.equal(PACK12_TYPES[w.id],w.type,`${w.id}: the client's copy of its type`);
  assert.equal(Object.keys(PACK12_TYPES).length,PACK12.length);
  const ids=[...NEW_WEAPONS,...ARSENAL_WEAPONS].map(w=>w.id).concat([...WEAPON_CATALOG.keys()],PACK12.map(w=>w.id));
  for(const id of ids){
    const sound=weaponSound(id);
    assert.ok(sound&&SFX[sound],`${id} → ${sound}`);
    assert.equal(weaponSound(`${id}-lendario`),sound,`${id}'s legendary`);
  }
  for(const id of ['faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao','chinelo','boleto','cafe','guarda-chuva','pombo','audio'])
    assert.equal(weaponSound(id),id);
  assert.equal(weaponSound('cafe-evo'),'cafe');
  assert.equal(weaponSound('peixeira'),'faca');
  assert.equal(weaponSound('skill:clt'),undefined);
});

test('every tower calibre fires its own sound',()=>{
  for(const calibre of Object.keys(CALIBRE))assert.ok(SFX[`torre-${calibre}` as SoundId],calibre);
});

test('a chest sounds by its rarity',()=>{
  assert.deepEqual([1,2,3,4,5].map(chestSound),['bau-comum','bau-raro','bau-raro','bau-epico','bau-lendario']);
});

// ---- engine: file first, recipe as the fallback ----

class Param {value=1;setValueAtTime(){return this;}linearRampToValueAtTime(){return this;}exponentialRampToValueAtTime(){return this;}setTargetAtTime(){return this;}cancelScheduledValues(){return this;}}
class Node {connected:unknown[]=[];connect(d:unknown){this.connected.push(d);return d;}disconnect(){}}
class Gain extends Node {gain=new Param();}
class Source extends Node {starts:number[]=[];onended:(()=>void)|null=null;start(t=0){this.starts.push(t);}stop(){}}
class BufferSource extends Source {buffer:{duration:number;length?:number;name?:string}|null=null;loop=false;playbackRate=new Param();}
class Osc extends Source {type='sine';frequency=new Param();}
class Ctx {
  sampleRate=48000;currentTime=0;state='running';destination=new Node();nodes:Node[]=[];decoded:string[]=[];
  add<T extends Node>(n:T){this.nodes.push(n);return n;}
  createGain(){return this.add(new Gain());}
  createBufferSource(){return this.add(new BufferSource());}
  createOscillator(){return this.add(new Osc());}
  createBiquadFilter(){return this.add(Object.assign(new Node(),{type:'',frequency:new Param(),Q:new Param()}));}
  createBuffer(_c:number,length:number){return {length,duration:length/48000,getChannelData:()=>new Float32Array(length)};}
  decodeAudioData(data:ArrayBuffer){const name=new TextDecoder().decode(data);this.decoded.push(name);return Promise.resolve({duration:.25,name});}
  resume(){return Promise.resolve();}
  close(){return Promise.resolve();}
  played(){return this.nodes.filter((n):n is BufferSource=>n instanceof BufferSource&&(n.buffer?.length??0)!==1&&n.starts.length>0);}
  oscs(){return this.nodes.filter(n=>n instanceof Osc);}
}
const settle=()=>new Promise(r=>setTimeout(r,0));
function rig(opts:{fail?:(url:string)=>boolean;random?:()=>number}={}){
  const ctx=new Ctx(),urls:string[]=[];let now=0;
  const engine=new AudioEngine({createContext:()=>ctx as unknown as AudioContext,nowMs:()=>now,format:'webm',random:opts.random,
    loadFile:url=>{urls.push(url);return opts.fail?.(url)?Promise.reject(new Error('404')):Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer);}});
  engine.unlock();
  return {engine,ctx,urls,setNow(t:number){now=t;}};
}

test('unlock warms the first sounds; a procedural sound plays its recipe until its file is decoded, then the file',async()=>{
  const r=rig();
  assert.ok(r.urls.includes('/audio/sfx/golpe.webm')&&r.urls.includes('/audio/sfx/passo-neve-6.webm'),'warm set fetched at unlock');
  assert.ok(!r.urls.includes('/audio/sfx/nivel.webm'),'the rest wait to be asked for');
  assert.equal(r.engine.play('nivel'),true,'recipe while the file loads');
  assert.ok(r.ctx.oscs().length>0);
  assert.ok(r.urls.includes('/audio/sfx/nivel.webm'),'asking starts its download');
  await settle();
  assert.ok(r.engine.hasFile('nivel'));
  const oscs=r.ctx.oscs().length;
  r.setNow(10_000);
  assert.equal(r.engine.play('nivel',{gain:.5,rate:1.04}),true);
  assert.equal(r.ctx.oscs().length,oscs,'no recipe once the file is in');
  const src=r.ctx.played().at(-1)!;
  assert.equal(src.buffer!.name,'/audio/sfx/nivel.webm');
  assert.equal(src.playbackRate.value,1.04);
  const voice=src.connected[0] as Gain;
  assert.ok(Math.abs(voice.gain.value-SFX.nivel.gain*.5)<1e-9,'the file level × the play gain');
  assert.equal(r.urls.filter(u=>u==='/audio/sfx/nivel.webm').length,1,'fetched once');
});

test('a file that fails leaves the recipe for good; a file-only sound is silent until it loads',async()=>{
  const r=rig({fail:url=>url.includes('gema')||url.includes('pistola')});
  await settle();
  assert.equal(r.engine.hasFile('gema'),false);
  assert.equal(r.engine.play('gema'),true,'the recipe stands in');
  assert.equal(r.ctx.played().length,0);
  assert.equal(r.engine.play('pistola'),false,'no file, no recipe: silence');
  assert.equal(r.engine.play('escopeta'),false,'first ask: still loading');
  await settle();
  assert.equal(r.engine.play('escopeta'),true);
  assert.equal(r.ctx.played().at(-1)!.buffer!.name,'/audio/sfx/escopeta.webm');
});

test('the steps draw a take never the same twice in a row',async()=>{
  let x=0;const seq=[.1,.1,.5,.5,.9,.9,.3,.3,.7,.7];
  const r=rig({random:()=>seq[x++%seq.length]});
  await settle();
  const takes:string[]=[];
  for(let i=0;i<10;i++){r.setNow(i*300);assert.ok(r.engine.play('passo-neve'));takes.push(r.ctx.played().at(-1)!.buffer!.name!);}
  for(let i=1;i<takes.length;i++)assert.notEqual(takes[i],takes[i-1],`step ${i}`);
  assert.ok(new Set(takes).size>=3);
});

// ---- footsteps (the walk as drawn: tests/client/som-passos.test.ts) ----

test('the step jitter stays within ±5 % of pitch and ±1.5 dB',()=>{
  for(const r of [0,.25,.5,.999]){
    const j=stepJitter(()=>r,1);
    assert.ok(Math.abs(j.rate-1)<=STEP_PITCH+1e-9);
    assert.ok(Math.abs(20*Math.log10(j.gain))<=STEP_DB+1e-9);
  }
  assert.ok(allyGain(0)<1&&allyGain(10)<allyGain(2)&&allyGain(20)===0);
});

function walker(){
  const plays:{id:SoundId;gain:number;rate:number}[]=[];
  const steps=new Footsteps({play:(id,o)=>{plays.push({id,gain:o?.gain??1,rate:o?.rate??1});return true;}},()=>.5);
  return {steps,plays};
}

test('the boss steps while it moves and within earshot',()=>{
  const {steps,plays}=walker(),hero={x:0,y:0};
  steps.boss(0,{x:5,y:0},hero);
  steps.boss(100,{x:5.2,y:0},hero);
  assert.equal(plays.length,1);
  assert.equal(plays[0].id,'chefe-passo');
  steps.boss(200,{x:5.4,y:0},hero);
  assert.equal(plays.length,1,'one heavy step per BOSS_STEP_MS');
  steps.boss(2000,{x:5.4,y:0},hero);
  assert.equal(plays.length,1,'a boss standing still makes no step');
  steps.boss(3000,{x:40,y:0},hero);steps.boss(4000,{x:41,y:0},hero);
  assert.equal(plays.length,1,'out of earshot');
  steps.boss(5000,undefined,hero);
  assert.equal(plays.length,1);
});
