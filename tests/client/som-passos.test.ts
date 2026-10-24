/**
 * BUG-20261024-ORQ-som-passos-fora-do-eixo: the footsteps land on the feet as drawn. The steps used to count a walk cycle
 * of their own (RUN_STRIDE 1.24 heights) while the M16 run is drawn at its phase table's stride (1.89 to 3.78), and each
 * snow take's crunch came 44 to 137 ms after the play. Here: the real renderer (fake scene, as ataque-1s.test.ts) runs an
 * M16 class on the real phase tables, Footsteps reads its gait, and every step must sound on a contact pose.
 */
import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {heroRuns,movementPlan,phaseContacts,phaseStride,runPhase,type RunPhase} from '../../src/client/sprites/movement128.ts';
import {CharacterSprites,LOOP_CONTACTS,type Gait} from '../../src/client/sprites/character-sprites.ts';
import {Footsteps,MAX_LEAD_CYCLES,MIN_STEP_MS,allyGain,contactsCrossed,type StepFigure} from '../../src/client/audio/footsteps.ts';
import {ALIGN_LEVEL_DB,SFX,alignTake} from '../../src/client/audio/sfx.ts';
import {AudioEngine} from '../../src/client/audio/engine.ts';
import type {SoundId} from '../../src/client/audio/types.ts';

afterEach(()=>setArtIndex(parseArtIndex(undefined)));
const MANIFEST=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
const realPhase=(id:string,d:string):RunPhase=>MANIFEST.groups.personagens.pieces[id].files[`run16-${d}`].phase;

test('contactsCrossed counts each contact once per cycle, two at most a frame',()=>{
  const c=[0,.5];
  assert.equal(contactsCrossed(0,.49,c),0);
  assert.equal(contactsCrossed(.49,.51,c),1);
  assert.equal(contactsCrossed(.9,1.1,c),1);
  assert.equal(contactsCrossed(.1,1.6,c),2);
  assert.equal(contactsCrossed(.4,.4,c),0);
  assert.equal(contactsCrossed(0,9,c),2,'a jump plays at most two');
  assert.equal(contactsCrossed(.2,.3,[0,.25]),1,'any contact point');
});

test('a phase table plants its feet on pose 0 and the middle pose: the cycle point is the ground before it',()=>{
  for(const id of ['viciado-em-bet','maromba','gato-nada-pra-comer','clt-cansado'])for(const d of ['S','W','NW','N','SE']){
    const p=realPhase(id,d),[a,b]=phaseContacts(p),n=p.d.length;
    assert.equal(a,0);
    assert.equal(runPhase(p,b+1e-9).frame,n/2,`${id} ${d}: the second contact opens pose ${n/2}`);
    assert.equal(runPhase(p,b-1e-9).frame,n/2-1);
  }
  assert.deepEqual(LOOP_CONTACTS,[0,.5]);
});

// ---- the renderer's gait, end to end ----

const ID='viciado-em-bet',DRAWN=['S','SW','W','NW','N'] as const;
function rig(){
  const piece=MANIFEST.groups.personagens.pieces[ID];
  const files:Record<string,unknown>={};
  for(const [k,v] of Object.entries(piece.files as Record<string,unknown>))if(/^(walk|attack|idle|run)16-/.test(k))files[k]=v;
  setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[ID]:{...piece,files}}}}}));
  assert.equal(heroRuns(ID),true,'the class runs on run16');
  const images=new Map<string,{width:number;height:number;close():void}>(),events=new EventEmitter();
  for(const motion of ['walk','attack','idle','run'])for(const d of ['S','SW','W','NW','N','SE','NE','E']){
    const plan=movementPlan(ID,motion==='run'?'walk':motion as 'walk',d as never);
    if(plan)images.set(plan.key,{width:384,height:plan.rows*96,close(){}});
  }
  const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
    addSpriteSheet:()=>{throw new Error('preloaded sheets are adopted');},remove:(key:string)=>images.delete(key)},
    load:{spritesheet:()=>{},isLoading:()=>false,list:{size:0}},
    anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('no legacy animation');}}};
  const sprite=new class extends EventEmitter {
    scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=false;flipY=false;originX=.5;originY=.5;
    anims={isPlaying:false,stop(){}};
    setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
    setOrigin(x:number,y:number){this.originX=x;this.originY=y;return this;}setScale(){return this;}setFlipX(v:boolean){this.flipX=v;return this;}setFlipY(v:boolean){this.flipY=v;return this;}
  }();
  const renderer=new CharacterSprites(scene as never);
  return {renderer,scene,sprite};
}
function listen(latencyMs=0){
  const plays:{id:SoundId;at:number;gain:number;pan:number}[]=[];let now=0;
  const steps=new Footsteps({play:(id,o)=>{plays.push({id,at:now,gain:o?.gain??1,pan:o?.pan??0});return true;},latencyMs},()=>.5);
  return {steps,plays,tick(t:number,figures:StepFigure[]){now=t;steps.update(t,figures);}};
}

test('on screen: a run in every direction steps exactly when the drawn pose reaches 0 or 8, twice a cycle',()=>{
  const {renderer,scene,sprite}=rig(),{plays,tick}=listen();
  const dirs:[number,number][]=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  let x=0,y=0,t=0,contacts=0,cycles=0;
  for(const [dx,dy] of dirs){
    const l=Math.hypot(dx,dy),v=.0045;
    let last:number|undefined,lastGait:Gait|undefined;
    for(let i=0;i<120;i++){
      t+=16;x+=dx/l*v*16;y+=dy/l*v*16;scene.time.now=t;
      renderer.animate(sprite as never,ID,x,y,0,true,0,{x:dx,y:dy});
      const gait=renderer.gait(sprite as never),frame=Number(sprite.frame.name),before=plays.length;
      tick(t,[{id:'me',gait,local:true,runs:true,gain:1,alive:true}]);
      if(!gait){assert.equal(plays.length,before,'no walk drawn, no step');last=undefined;continue;}
      assert.ok(sprite.texture.key.includes(':run:'),'runs on the run16 sheet: '+sprite.texture.key);
      const contact=last===undefined?frame===0:last!==frame&&(frame===0||frame===8||(last<8&&frame>8)||(last>frame&&frame>0));
      if(contact)contacts++;
      assert.equal(plays.length>before,contact,`step only on a contact: ${sprite.texture.key} pose ${last}→${frame} at ${t} ms`);
      last=frame;lastGait=gait;
    }
    cycles+=lastGait!.cycles;
    // A stop: the walk ends (WalkGate's hold), no step standing.
    const n=plays.length;
    for(let i=0;i<40;i++){t+=16;scene.time.now=t;renderer.animate(sprite as never,ID,x,y,0,true,0);tick(t,[{id:'me',gait:renderer.gait(sprite as never),local:true,runs:true,gain:1,alive:true}]);}
    assert.equal(plays.length,n,'no step standing still');
  }
  assert.ok(contacts>=16&&Math.abs(plays.length-(cycles*2+dirs.length))<=dirs.length,`${plays.length} steps for ${cycles.toFixed(2)} cycles`);
  assert.ok(plays.every(p=>p.id==='passo-neve'&&p.pan===0&&p.gain>1),'the local hero runs centred and louder');
});

test('the output latency is made up ahead: each step sounds that long before its pose, never more than MAX_LEAD_CYCLES',()=>{
  const p=realPhase(ID,'W'),contacts=phaseContacts(p),lead=60,{plays,tick}=listen(lead);
  const rate=2/1000;// cycles per ms (a run's ~2 cycles a second)
  const at=(cycles:number,since=0,time=since):Gait=>({cycles,contacts,since,at:time});
  // The HUD also ticks on a network view, between two drawn frames (the same gait again, a few ms later): the pace is
  // the drawing's, so those ticks never push the steps earlier (in the game they came up to 75 ms early).
  for(let t=0;t<=3000;t+=16){
    const g=at(t*rate,0,t);
    tick(t,[{id:'me',gait:g,local:true,gain:1,alive:true}]);
    tick(t+3,[{id:'me',gait:g,local:true,gain:1,alive:true}]);
  }
  // The contacts' times, then each step's lead over its contact.
  const times:number[]=[];for(let k=0;k<7;k++)for(const c of contacts)times.push((k+c)/rate);
  for(const s of plays.slice(1)){
    const next=times.filter(c=>c>=s.at-16).sort((a,b)=>a-b)[0];
    assert.ok(next-s.at<=lead+3&&next-s.at>=lead-19,`a step ${(next-s.at).toFixed(0)} ms before its contact (lead ${lead})`);
  }
  assert.ok(MAX_LEAD_CYCLES*1000/rate/1000>=.05);
  // A walk restarts (attack, stop): its first step at once; the minimum gap holds.
  const n=plays.length;tick(3020,[{id:'me',gait:at(0,3020),local:true,gain:1,alive:true}]);
  assert.equal(plays.length,n,`within MIN_STEP_MS (${MIN_STEP_MS}) of the last`);
  tick(3400,[{id:'me',gait:at(0,3400),local:true,gain:1,alive:true}]);
  assert.equal(plays.length,n+1,'a new walk opens on a planted foot');
});

test('allies are quieter with distance and come from their side of the screen; a downed figure is silent',()=>{
  const {plays,tick}=listen(),g:Gait={cycles:.01,contacts:[0,.5],since:0,at:0};
  tick(0,[{id:'ally',gait:g,gain:allyGain(6),alive:true,side:-1},{id:'b',gait:g,gain:allyGain(3),alive:true,side:.5},{id:'down',gait:g,gain:1,alive:false}]);
  assert.equal(plays.length,2);
  assert.ok(plays[0].gain<.4&&plays[0].pan<-.5,'left of the screen, quieter');
  assert.ok(plays[1].pan>0&&plays[1].pan<plays[1].gain*10);
});

// ---- the takes: each from its crunch, at one level ----

test('alignTake starts a take at its attack, a few ms of rise kept, and evens its level',()=>{
  const rate=48000,x=new Float32Array(rate*.2);
  // A faint rustle, then the crunch at 120 ms (as take 1), then a tail.
  for(let i=0;i<x.length;i++)x[i]=.01*Math.sin(i*.37);
  for(let i=0;i<rate*.03;i++)x[Math.round(rate*.12)+i]=.9*Math.sin(i*.9)*Math.exp(-i/(rate*.015));
  const a=alignTake(x,rate);
  assert.ok(a.offset>.11&&a.offset<.121,`offset ${a.offset}`);
  const b=alignTake(x.map(v=>v/2),rate);
  assert.ok(Math.abs(b.offset-a.offset)<1e-9&&Math.abs(b.gain/a.gain-2)<.01,'a take half as loud gets twice the gain (within ±6 dB)');
  assert.deepEqual(alignTake(new Float32Array(1000),rate),{offset:0,gain:1},'silence plays whole');
  assert.ok(ALIGN_LEVEL_DB<0&&SFX['passo-neve'].align===true);
});

test('the six snow takes, decoded: each starts on its rise (the loudest 5 ms within 45 ms of the play, was 44 to 137) at one level',async()=>{
  const {execFileSync}=await import('node:child_process');
  let ffmpeg=true;try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});}catch{ffmpeg=false;}
  if(!ffmpeg)return;
  const crunch:number[]=[],level:number[]=[];
  for(let k=1;k<=6;k++){
    const raw=execFileSync('ffmpeg',['-v','error','-i',`public/audio/sfx/passo-neve-${k}.webm`,'-f','f32le','-ac','1','-ar','48000','-']);
    const x=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4),a=alignTake(x,48000);
    // The loudest 5 ms window after the offset, and the level of the 40 ms from the attack after the gain.
    const w=240;let best=-1,at=0;for(let i=Math.round(a.offset*48000);i+w<=x.length;i+=w){let s=0;for(let j=i;j<i+w;j++)s+=x[j]*x[j];if(s>best){best=s;at=i;}}
    crunch.push((at/48000-a.offset)*1000);
    const from=Math.round((a.offset+.004)*48000);let s=0;for(let j=from;j<from+1920&&j<x.length;j++)s+=x[j]*x[j];
    level.push(10*Math.log10(s/1920)+20*Math.log10(a.gain));
  }
  assert.ok(crunch.every(c=>c<=45),`crunch after the start: ${crunch.map(c=>c.toFixed(0)).join(', ')} ms`);
  assert.ok(Math.max(...level)-Math.min(...level)<=1,`levels ${level.map(v=>v.toFixed(1)).join(', ')} dB`);
});

test('the engine plays an aligned take from its offset at its gain, panned when asked',async()=>{
  class Param {value=1;setValueAtTime(){return this;}linearRampToValueAtTime(){return this;}setTargetAtTime(){return this;}cancelScheduledValues(){return this;}}
  class Node {connected:unknown[]=[];connect(d:unknown){this.connected.push(d);return d;}disconnect(){}}
  class Src extends Node {buffer:unknown=null;playbackRate=new Param();starts:number[][]=[];onended=null;start(...a:number[]){this.starts.push(a);}stop(){}}
  const nodes:Node[]=[];
  const crunchAt=(rate:number)=>{const x=new Float32Array(rate*.2);for(let i=0;i<rate*.02;i++)x[Math.round(rate*.1)+i]=.3*Math.sin(i);return x;};
  const ctx={sampleRate:48000,currentTime:0,state:'running',destination:new Node(),baseLatency:.01,outputLatency:.04,
    createGain:()=>{const n=Object.assign(new Node(),{gain:new Param()});nodes.push(n);return n;},
    createBufferSource:()=>{const n=new Src();nodes.push(n);return n;},
    createStereoPanner:()=>{const n=Object.assign(new Node(),{pan:new Param()});nodes.push(n);return n;},
    createBuffer:(_c:number,length:number)=>({length,duration:length/48000,getChannelData:()=>new Float32Array(length)}),
    decodeAudioData:()=>Promise.resolve({duration:.2,sampleRate:48000,length:9600,getChannelData:()=>crunchAt(48000)}),
    resume:()=>Promise.resolve(),close:()=>Promise.resolve()};
  const engine=new AudioEngine({createContext:()=>ctx as never,nowMs:()=>0,format:'webm',loadFile:()=>Promise.resolve(new ArrayBuffer(8))});
  engine.unlock();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(engine.latencyMs,50,'base + output latency');
  assert.ok(engine.play('passo-neve',{gain:1,pan:-.6}));
  const src=nodes.filter((n):n is Src=>n instanceof Src&&n.starts.length>0).at(-1)!;
  const [,offset]=src.starts[0];
  assert.ok(offset>.09&&offset<.1,`starts at the crunch: ${offset}`);
  const panner=src.connected[0] as {pan:Param;connected:unknown[]};
  assert.equal(panner.pan.value,-.6,'panned');
  const voice=panner.connected[0] as {gain:Param};
  assert.ok(voice.gain.value!==SFX['passo-neve'].gain,'the take is evened');
});
