import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {dancePlan} from '../../src/client/sprites/movement128.ts';
import {CharacterSprites,danceFrame} from '../../src/client/sprites/character-sprites.ts';
import {Cheers,DanceGate,danceAllowed,CHEER_MS,CHEER_RADIUS,DANCE_IDLE_MS,DANCE_PREFETCH_MS,DANCE_RATE} from '../../src/client/sprites/hero-dance.ts';
import {HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';
import {screenDirection} from '../../src/client/projection.ts';

afterEach(()=>setArtIndex(parseArtIndex(undefined)));
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const dance=(extra:Record<string,unknown>={})=>({file:'tio.dance128.webp',cell:[96,96],frames:128,fps:128/36,durationMs:36000,loop:true,anchor:[.5,.875],
  height:64,figure:{left:16,top:16,right:82,bottom:88},pages:[{file:'tio.dance128.webp',columns:16,rows:8,firstFrame:0,frameCount:128}],...extra});
const idle8=()=>({file:'tio.idle8.webp',cell:[96,96],frames:1,directions:8,revision:6,movementHands:'empty',loop:false,anchor:[.5,.875],height:60,
  figure:{left:8,top:20,right:88,bottom:86},pages:[{file:'tio.idle8.webp',columns:8,rows:1,firstFrame:0,frameCount:8}]});
const clip=(motion:string,direction:string)=>{
  const file=`tio.${motion}128-${direction.toLowerCase()}.webp`;
  return {file,cell:[96,96],revision:6,movementHands:'empty',frames:128,durationMs:motion==='walk'?600:1000,loop:motion==='walk',anchor:[.5,.875],
    height:60,figure:{left:8,top:20,right:88,bottom:86},pages:[{file,columns:16,rows:8,firstFrame:0,frameCount:128}]};
};
function index(extra:Record<string,unknown>={dance128:dance()}){
  const files:Record<string,unknown>={idle8:idle8(),...extra};
  for(const motion of ['walk','attack'])for(const direction of HERO_DIRECTIONS)files[`${motion}128-${direction}`]=clip(motion,direction);
  setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{tio:{kind:'dir8',files}}}}}));
}
const on={allowed:true};

test('the wait: 5 s standing still starts the dance, from its first pose; the sheet is asked for 3 s before',()=>{
  const gate=new DanceGate();
  assert.equal(gate.update(0,true,on),undefined);
  assert.equal(gate.update(DANCE_IDLE_MS-DANCE_PREFETCH_MS-1,true,on),undefined);assert.equal(gate.prefetch,false);
  assert.equal(gate.update(DANCE_IDLE_MS-DANCE_PREFETCH_MS,true,on),undefined);assert.equal(gate.prefetch,true);
  assert.equal(gate.update(DANCE_IDLE_MS-1,true,on),undefined);
  assert.equal(gate.update(DANCE_IDLE_MS,true,on),DANCE_IDLE_MS,'the dance clock starts at the 5 s mark');
  assert.equal(gate.update(DANCE_IDLE_MS+9000,true,on),DANCE_IDLE_MS,'and keeps its start while it dances');
});

test('moving, swinging or any input cuts it at once, and the wait starts over',()=>{
  const gate=new DanceGate();gate.update(0,true,on);
  assert.equal(gate.update(6000,true,on),DANCE_IDLE_MS);
  assert.equal(gate.update(6016,false,on),undefined,'a step (or a swing, a push, a flinch) cuts it');assert.equal(gate.prefetch,false);
  assert.equal(gate.update(6032,true,on),undefined);
  assert.equal(gate.update(6016+DANCE_IDLE_MS,true,on),6016+DANCE_IDLE_MS,'5 s after the last step');
  // The local player's input (a tap on the HUD, a key) cuts it even without a step.
  const poked=new DanceGate();poked.update(0,true,on);
  assert.equal(poked.update(7000,true,{allowed:true,poke:-Infinity}),DANCE_IDLE_MS);
  assert.equal(poked.update(7016,true,{allowed:true,poke:7010}),undefined,'the tap cut it');
  assert.equal(poked.update(7010+DANCE_IDLE_MS-1,true,{allowed:true,poke:7010}),undefined);
  assert.equal(poked.update(7010+DANCE_IDLE_MS,true,{allowed:true,poke:7010}),7010+DANCE_IDLE_MS);
  assert.equal(poked.update(13000,true,{allowed:true,poke:12990}),undefined,'a held stick pokes every frame');
});

test('no dance dead, downed, out, offline, watching, riding or sliding; without a cue, never',()=>{
  const ok={hp:80,online:true,spectator:false};
  assert.equal(danceAllowed(ok,100),true);
  for(const bad of [{...ok,hp:0},{...ok,downed:{progress:0}},{...ok,eliminated:true},{...ok,online:false},{...ok,spectator:true},
    {...ok,ride:'moto',rideUntil:200},{...ok,slipUntil:120}])assert.equal(danceAllowed(bad as never,100),false,JSON.stringify(bad));
  assert.equal(danceAllowed({...ok,ride:'moto',rideUntil:90} as never,100),true,'the ride is over');
  assert.equal(danceAllowed(undefined,0),false);
  const gate=new DanceGate();
  for(let t=0;t<=20000;t+=500){assert.equal(gate.update(t,true,{allowed:false}),undefined);assert.equal(gate.update(t,true,undefined),undefined);}
  // Allowed again (got up, left the moto): the 5 s count from the last frame it was not.
  assert.equal(gate.update(20500,true,on),undefined);assert.equal(gate.update(20000+DANCE_IDLE_MS-1,true,on),undefined);
  assert.equal(gate.update(20000+DANCE_IDLE_MS,true,on),20000+DANCE_IDLE_MS);
});

test('a cheer dances at once while still, for CHEER_MS; a step or a tap cuts it; bots never dance from the wait',()=>{
  const gate=new DanceGate();
  assert.equal(gate.update(1000,true,{allowed:true,cheer:1000}),1000,'from the cheer, no 5 s wait');assert.equal(gate.prefetch,true);
  assert.equal(gate.update(1500,false,{allowed:true,cheer:1000}),undefined,'a step cuts it');
  assert.equal(gate.update(2000,true,{allowed:true,cheer:1000}),1500,'standing again within the cheer, it dances again from its last step');
  // A person that stays still runs on into the wait's dance with the same start (no jump to the first pose).
  assert.equal(gate.update(1000+CHEER_MS+3000,true,{allowed:true,cheer:1000}),1500);
  const tapped=new DanceGate();tapped.update(0,true,{allowed:true,cheer:0});
  assert.equal(tapped.update(100,true,{allowed:true,cheer:0,poke:50}),undefined,'the local player tap cuts the cheer');
  assert.equal(tapped.update(200,true,{allowed:true,cheer:0,poke:50}),undefined);
  // A bot: only the cheer, and only for CHEER_MS.
  const bot=new DanceGate();
  assert.equal(bot.update(0,true,{allowed:true,idle:false}),undefined);
  assert.equal(bot.update(20000,true,{allowed:true,idle:false}),undefined,'a bot never dances from standing still');assert.equal(bot.prefetch,false);
  assert.equal(bot.update(30000,true,{allowed:true,idle:false,cheer:30000}),30000);
  assert.equal(bot.update(30000+CHEER_MS-1,true,{allowed:true,idle:false,cheer:30000}),30000);
  assert.equal(bot.update(30000+CHEER_MS,true,{allowed:true,idle:false,cheer:30000}),undefined,'the cheer is over');
  // Never in the forbidden states, cheer or not.
  assert.equal(new DanceGate().update(0,true,{allowed:false,cheer:0}),undefined);
});

test('who cheers: a round that ends, everyone; the level-up, the bots; a boss or an elite down near a bot, that bot',()=>{
  const players=[{id:'eu',x:0,y:0},{id:'bot-perto',x:3,y:0,bot:true},{id:'bot-longe',x:CHEER_RADIUS+20,y:0,bot:true}];
  let c=new Cheers();
  c.push(100,[{type:'damage'},{type:'round',phase:'wave'},{type:'kill',enemy:'e1',kind:'pombo',x:0,y:0}],players);
  assert.deepEqual(players.map(p=>c.of(p.id)),[undefined,undefined,undefined],'a round that starts or a small kill: nobody');
  c.push(200,[{type:'round',phase:'end'}],players);
  assert.deepEqual(players.map(p=>c.of(p.id)),[200,200,200],'the wave down (the last one is the win): all');
  c=new Cheers();c.push(300,[{type:'levelup',level:4}],players);
  assert.deepEqual(players.map(p=>c.of(p.id)),[undefined,300,300],'the level-up: the bots only');
  // The elite is known by the view before its kill (the kill's tick no longer lists it).
  c=new Cheers();c.push(400,[],players,[{id:'e2',elite:true},{id:'e3'}]);
  c.push(450,[{type:'kill',enemy:'e2',kind:'motoboy',x:4,y:1}],players,[]);
  assert.deepEqual(players.map(p=>c.of(p.id)),[undefined,450,undefined],'the elite fell near one bot');
  c.push(500,[{type:'kill',enemy:'e9',kind:'chefe-pastel',x:CHEER_RADIUS+19,y:0}],players);
  assert.equal(c.of('bot-longe'),500,'a boss by its kind');assert.equal(c.of('eu'),undefined);
  c.push(600,[],players.slice(0,1));
  assert.equal(c.of('bot-perto'),undefined,'a bot that left is forgotten');
});

test('the dance plan: one frontal 16×8 sheet of 96 px cells, its lite copy, malformed entries ignored',()=>{
  index();const plan=dancePlan('tio')!;
  assert.equal(plan.key,'sprite128:tio:dance');assert.equal(plan.url,'/art/lite/sprites/tio.dance128.webp');assert.equal(plan.original,'/art/sprites/tio.dance128.webp');
  assert.equal(plan.motion,'dance');assert.equal(plan.frameCount,128);assert.equal(plan.loop,true);assert.equal(plan.height,64);
  for(const bad of [{frames:64},{loop:false},{anchor:[.5,.9]},{cell:[192,192]},{height:0},{durationMs:0},{figure:{left:0,top:0,right:200,bottom:96}}]){
    index({dance128:dance(bad)});assert.equal(dancePlan('tio'),undefined,JSON.stringify(bad));
  }
  index({});assert.equal(dancePlan('tio'),undefined,'a class without a dance');
});

test('the pose follows the clock at DANCE_RATE and loops',()=>{
  const plan={durationMs:36000,frameCount:128};
  assert.equal(danceFrame(plan,0),0);
  assert.equal(danceFrame(plan,36000/128/DANCE_RATE),1);
  assert.equal(danceFrame(plan,36000/DANCE_RATE),0,'one loop');
  assert.equal(danceFrame(plan,36000/DANCE_RATE-1),127);
});

test('in the match: still 5 s → the dance sheet, facing the camera whatever the direction; a step goes back to the walk',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Image'),requests:string[]=[];
  class FakeImage {src='';decoding='';naturalWidth=1536;naturalHeight=768;get width(){return this.naturalWidth;}get height(){return this.naturalHeight;}async decode(){requests.push(this.src);}}
  Object.defineProperty(globalThis,'Image',{value:FakeImage,configurable:true});
  try{
    index();
    const images=new Map<string,{width:number;height:number}>(),events=new EventEmitter();
    const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
      addSpriteSheet:(key:string,image:FakeImage)=>images.set(key,image),remove:(key:string)=>images.delete(key)},
      load:{spritesheet:(key:string,_url:string,config:{endFrame:number})=>images.set(key,config.endFrame===7?{width:768,height:96}:{width:1536,height:768}),isLoading:()=>false,list:{size:0}},
      anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('no legacy animations');}}};
    const sprite=new class extends EventEmitter {
      scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=false;flipY=false;originY=0;
      anims={isPlaying:false,stop(){}};
      setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
      setOrigin(_x:number,y:number){this.originY=y;return this;}setScale(){return this;}setFlipX(value:boolean){this.flipX=value;return this;}setFlipY(value:boolean){this.flipY=value;return this;}
    }();
    const renderer=new CharacterSprites(scene as never);renderer.queue('tio');
    const still={x:0,y:0},west=screenDirection(-1,0,0);
    // Looking west, standing: rest pose until 2 s, then the dance sheet is fetched; at 5 s it dances.
    renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',0,0,0,true,0,west);
    for(let t=100;t<=DANCE_IDLE_MS-DANCE_PREFETCH_MS-100;t+=100){scene.time.now=t;renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',0,0,0,true,0,still);}
    await flush();assert.equal(requests.filter(u=>u.includes('dance')).length,0,'nothing asked before the prefetch mark');
    for(let t=DANCE_IDLE_MS-DANCE_PREFETCH_MS;t<DANCE_IDLE_MS;t+=100){scene.time.now=t;renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',0,0,0,true,0,still);await flush();}
    assert.deepEqual(requests.filter(u=>u.includes('dance')),['/art/lite/sprites/tio.dance128.webp'],'the lite sheet, once');
    assert.equal(sprite.texture.key,'sprite128:tio:idle8');assert.equal(renderer.dancing(sprite as never),false);
    scene.time.now=DANCE_IDLE_MS;renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',0,0,0,true,0,still);
    assert.equal(sprite.texture.key,'sprite128:tio:dance');assert.equal(sprite.frame.name,'0');assert.equal(sprite.flipX,false);
    assert.equal(sprite.originY,.875,'its ground on the anchor');assert.equal(renderer.dancing(sprite as never),true);
    scene.time.now=DANCE_IDLE_MS+36000/128/DANCE_RATE*10;renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',0,0,0,true,0,still);
    assert.equal(sprite.frame.name,'10');
    // A step: the walk at once.
    scene.time.now+=16;renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',.1,0,0,true,0,screenDirection(1,0,0));await flush();
    scene.time.now+=16;renderer.danceCue(sprite as never,on);renderer.animate(sprite as never,'tio',.2,0,0,true,0,screenDirection(1,0,0));
    assert.notEqual(sprite.texture.key,'sprite128:tio:dance');assert.equal(renderer.dancing(sprite as never),false);
    // A swing cuts it as well; a hero that dies standing never dances; no cue (sandboxes, the ghost), never.
    const quiet=(cue:{allowed:boolean}|undefined,alive=true,attackTick=0)=>{
      const s=new (sprite.constructor as new()=>typeof sprite)();
      for(let t=0;t<=DANCE_IDLE_MS+500;t+=250){scene.time.now=100000+t;renderer.danceCue(s as never,cue as never);renderer.animate(s as never,'tio',5,5,attackTick&&t>=DANCE_IDLE_MS?attackTick:0,alive,0,still);}
      return renderer.dancing(s as never);
    };
    assert.equal(quiet(on),true);assert.equal(quiet(undefined),false);assert.equal(quiet({allowed:false}),false);assert.equal(quiet(on,false),false);
    assert.equal(quiet(on,true,7),false,'a swing at the 5 s mark');
    events.emit('shutdown');
  }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});

test('the imported dances: every hero with one stands on the clip anchor at a sane size, and its lite copy exists',()=>{
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));setArtIndex(parseArtIndex(index));
  const pieces=index.groups.personagens.pieces as Record<string,{files:Record<string,{file:string;height:number}>}>;
  const ids=Object.keys(pieces).filter(id=>pieces[id].files.dance128);
  assert.ok(ids.length>=32,`${ids.length} dances`);
  for(const id of ids){
    const plan=dancePlan(id);assert.ok(plan,id);
    assert.ok(plan!.height>=40&&plan!.height<=72,`${id}: height ${plan!.height}`);
    assert.ok(readFileSync(`public${plan!.url}`).length<600_000,`${id}: lite copy under 600 KB`);
  }
  assert.equal(pieces.maromba?.files.dance128,undefined,'the old maromba dance is not the new maromba (stage 3 draws it)');
});
