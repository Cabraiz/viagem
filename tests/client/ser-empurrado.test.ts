// Card NEW-20261030-ORQ-anim-ser-empurrado: on the room's colisao-entre-herois marks, the hero whose walk pushes plays
// its push16 facing the push, and the one pushed plays its shoved16 (knocked back, down, up again) once from the push's
// start, facing the pusher. Saci and sanfoneiro (and the hidden legacy) have neither sheet and never play them.
import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {artPiece,parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {MENDIGO,withMendigo} from '../../src/client/art/mendigo.ts';
import {applyEnemyArt,enemyArtKey,facingRow,playEnemyAction} from '../../src/client/art/horde-art.ts';
import {hasShoved16,shovedPlan,hasPush16,pushPlan,MOVEMENT16_DURATION} from '../../src/client/sprites/movement128.ts';
import {CharacterSprites} from '../../src/client/sprites/character-sprites.ts';
import {HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';

afterEach(()=>setArtIndex(parseArtIndex(undefined)));
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const ID='aposentado',DRAWN=['S','SE','W','NW','N'] as const;
const HEROES=['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado'];
const idle8={file:`${ID}.idle8.webp`,cell:[96,96],frames:1,directions:8,revision:6,movementHands:'empty',loop:false,anchor:[.5,.875],height:60,
  figure:{left:8,top:20,right:88,bottom:86},pages:[{file:`${ID}.idle8.webp`,columns:8,rows:1,firstFrame:0,frameCount:8}]};
const m16=(motion:'walk'|'attack'|'idle'|'push'|'shoved',d:string)=>{
  const file=`${ID}.${motion}16-${d.toLowerCase()}.webp`,rows=motion==='idle'?2:4,frames=4*rows;
  return {file,cell:[96,96],revision:16,movementHands:'empty',frames,durationMs:{walk:600,attack:1000,idle:2000,push:1000,shoved:1400}[motion],
    loop:motion==='walk'||motion==='idle'||motion==='push',anchor:[.5,.875],height:58,pivotX:48,figure:{left:20,top:18,right:70,bottom:80},
    pages:[{file,columns:4,rows,firstFrame:0,frameCount:frames}],...(motion==='push'?{phase:{d:Array(16).fill(1/16),v:Array(16).fill([0,0])}}:{})};
};
function index(motions:readonly ('push'|'shoved')[]=['push','shoved']){
  const files:Record<string,unknown>={idle8};
  for(const motion of ['walk','attack','idle',...motions] as const)for(const d of DRAWN)files[`${motion}16-${d}`]=m16(motion,d);
  return parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[ID]:{kind:'dir8',files}}}}});
}
function rig(){
  const images=new Map<string,{width:number;height:number;close():void}>(),events=new EventEmitter();
  const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
    addSpriteSheet:()=>{throw new Error('preloaded');},remove:(key:string)=>images.delete(key)},
    load:{spritesheet:(key:string,_url:string,config:{endFrame:number})=>{images.set(key,{width:384,height:config.endFrame===7?192:384,close(){}});},isLoading:()=>false,list:{size:0}},
    anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('no legacy animation');}}};
  const sprite=new class extends EventEmitter {
    scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=false;flipY=false;originX=.5;originY=.5;
    anims={isPlaying:false,stop(){}};
    setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
    setOrigin(x:number,y:number){this.originX=x;this.originY=y;return this;}setScale(){return this;}setFlipX(v:boolean){this.flipX=v;return this;}setFlipY(v:boolean){this.flipY=v;return this;}
  }();
  const renderer=new CharacterSprites(scene as never);renderer.queue(ID);renderer.queueOwnWalk(ID);
  // The push and shoved sheets preloaded the same way (the game asks them on first use, by fetch, absent here).
  for(const d of HERO_DIRECTIONS)for(const plan of [pushPlan(ID,d),shovedPlan(ID,d)])if(plan)(renderer as unknown as {queueDetailed(p:unknown):void}).queueDetailed(plan);
  // Standing still at (0,0); `shove` as the room's PlayerRunView sends it.
  // The first draw of a sheet asks for it (the fake loads it at once); a second draw at the same time shows it.
  const at=async(ms:number,shove?:{pushing?:{x:number;y:number};pushed?:{x:number;y:number}})=>{
    scene.time.now=ms;
    for(let i=0;i<2;i++){renderer.animate(sprite as never,ID,0,0,0,true,0,undefined,undefined,undefined,undefined,undefined,false,shove);await flush();}
    return {key:sprite.texture.key,frame:Number(sprite.frame.name)};
  };
  return {at};
}

test('shoved16 is a class sheet in 5 drawn directions + 3 mirrors, played once in 1400 ms',()=>{
  setArtIndex(index());
  assert.equal(hasShoved16(ID),true);
  for(const d of HERO_DIRECTIONS){const p=shovedPlan(ID,d)!;assert.equal(p.motion,'shoved');assert.equal(p.loop,false);assert.equal(p.frameCount,16);assert.equal(p.durationMs,MOVEMENT16_DURATION.shoved);}
  assert.equal(shovedPlan(ID,'E')!.flip,true,'E is W mirrored');
  setArtIndex(index(['push']));assert.equal(hasShoved16(ID),false);assert.equal(shovedPlan(ID,'S'),undefined);
});

test('pushing a hero plays push16 facing the push; pushed plays shoved16 once from the push start, not restarted while held',async()=>{
  setArtIndex(index());
  const pusher=rig();
  assert.match((await pusher.at(0,{pushing:{x:1,y:0}})).key,/:push:/,'the pusher pushes with its push16');
  assert.match((await pusher.at(100,{pushing:{x:1,y:0},pushed:{x:1,y:0}})).key,/:push:/,'middle of a line: pushing wins');
  assert.match((await pusher.at(200)).key,/:idle:/,'the push over: back to its rest');

  const pushed=rig(),held={pushed:{x:1,y:0}};
  const start=await pushed.at(1000,held);
  assert.match(start.key,/:shoved:/);assert.equal(start.frame,0,'starts at the rest pose');
  let last=0;
  for(let ms=1000;ms<1000+MOVEMENT16_DURATION.shoved;ms+=100){const s=await pushed.at(ms,held);assert.match(s.key,/:shoved:/,`${ms}`);assert.ok(s.frame>=last,'never goes back');last=s.frame;}
  assert.ok(last>=14,'reaches the end');
  assert.match((await pushed.at(1000+MOVEMENT16_DURATION.shoved+50,held)).key,/:idle:/,'held past its end: up, resting, no restart');
  await pushed.at(3000);
  const again=await pushed.at(3100,held);assert.match(again.key,/:shoved:/);assert.equal(again.frame,0,'a new push plays it again');
  // A blink in the mark (PUSH_HOLD ran out a tick) mid-fall does not restart it.
  await pushed.at(3300);assert.ok((await pushed.at(3400,held)).frame>0,'goes on, not from 0');
});

test('a class without shoved16 or push16 never plays them: it rests',async()=>{
  setArtIndex(index([]));
  const r=rig();
  assert.match((await r.at(0,{pushed:{x:0,y:1}})).key,/:idle:/);
  assert.match((await r.at(100,{pushing:{x:0,y:1}})).key,/:idle:/);
});

test('the 6 heroes have shoved16 and push16; saci and sanfoneiro have neither',()=>{
  setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
  for(const id of HEROES){assert.ok(hasShoved16(id),`${id}: shoved16`);assert.ok(hasPush16(id),`${id}: push16`);}
  for(const id of ['saci','sanfoneiro']){assert.equal(hasShoved16(id),false,id);assert.equal(hasPush16(id),false,id);}
});

// The mendigo enemy: a hero's walk pushing it (EnemyView.pushed, from the pusher to it) plays its shoved once.
type Img=Parameters<typeof applyEnemyArt>[0];
function mockImage(){
  const scene={textures:{exists:()=>true},add:{image:()=>mockImage()},events:{on(){},off(){}}};
  const m:{[k:string]:unknown;texture:{key:string};frame:number}={texture:{key:'horde:enemy:bebado'},frame:0,visible:true,alpha:1,x:0,y:0,depth:0,scaleX:1,scaleY:1,originX:.5,originY:.92,scene,
    tintFill:false,tintTopLeft:0,tintTopRight:0,tintBottomLeft:0,tintBottomRight:0};
  const self=(f:(...a:never[])=>void)=>(...a:never[])=>{f(...a);return m;};
  Object.assign(m,{
    setTexture:self(((k:string,f?:number)=>{m.texture={key:k};m.frame=f??0;}) as never),setFrame:self(((f:number)=>{m.frame=f;}) as never),
    setOrigin:self(()=>{}),setScale:self(()=>{}),setFlipX:self(()=>{}),setRotation:self(()=>{}),setAlpha:self(()=>{}),setVisible:self(()=>{}),
    setPosition:self(()=>{}),setDepth:self(()=>{}),once:()=>m,
  });
  return m;
}
test('the mendigo enemy pushed by a hero plays its shoved once (8 directions), facing the pusher, held on that row, then walks again',()=>{
  setArtIndex(withMendigo(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{}}}})));
  const sh=artPiece('inimigos',MENDIGO)!.files.shoved;
  assert.equal(sh.directions,8);assert.equal(sh.frames,16);
  assert.deepEqual(sh.pages!.map(p=>p.file),['S','SW','W','NW','N','NE','E','SE'].map(d=>`mendigo/shoved-${d}.webp`));
  const m=mockImage(),img=m as never as Img,a:Parameters<typeof applyEnemyArt>[1]={kind:'bebado',art:MENDIGO,elite:false,phase:0,x:0,y:0};
  applyEnemyArt(img,a,false,0,0,0);assert.match(m.texture.key,/:idle/);
  // Pushed along +x (the hero at its left): it falls back facing −x, and the push walking it along +x does not turn it.
  a.pushed={x:1,y:0};
  applyEnemyArt(img,a,true,.02,0,100);
  const row=facingRow(-1,0,0,-1),key=enemyArtKey(MENDIGO,'shoved',row,8);
  assert.equal(m.texture.key,key,'the page of the row facing the pusher');assert.equal(m.frame,0,'from its first frame');
  let last=m.frame;
  for(let t=200;t<=1450;t+=50){a.x!+=.02;applyEnemyArt(img,a,true,.02,0,t);assert.equal(m.texture.key,key,`${t}`);assert.ok(m.frame>=last);last=m.frame;}
  assert.ok(last>=14,'reaches its end');
  // A swing while it is down waits for it to get up; the held mark does not restart it.
  assert.equal(playEnemyAction(img,MENDIGO,'attack',1400),false);
  a.pushed=undefined;applyEnemyArt(img,a,true,.02,0,1700);assert.match(m.texture.key,/:walk/,'up again: walks');
});
