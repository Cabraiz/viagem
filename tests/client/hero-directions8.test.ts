import test from 'node:test';
import assert from 'node:assert/strict';
import {Facing8Tracker,HERO_DIRECTIONS,HERO_DIRECTION_PAGE,SPRITE_CLIPS,cycleFrame,walkCycles} from '../../src/client/sprites/sprite-motion.ts';
import {HERO_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {screenDirection} from '../../src/client/projection.ts';
import {CharacterSprites} from '../../src/client/sprites/character-sprites.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';

const vectors={N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1],S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1]} as const;
test('all eight joystick headings select their actual compass direction in every camera view',()=>{
  for(let view=0;view<4;view++)for(const [direction,[x,y]] of Object.entries(vectors)){
    const tracker=new Facing8Tracker(),intent=screenDirection(x,y,view);
    assert.equal(tracker.update(0,0,view,intent),direction,`${direction}, view ${view}`);
    assert.equal(tracker.update(-intent.x,-intent.y,view,intent),direction,'prediction correction cannot reverse local facing');
    assert.equal(tracker.update(0,0,view,{x:0,y:0}),direction,'idle keeps the heading');
  }
});
test('eight headings rotate with the camera and ignore teleports and interpolation jitter',()=>{
  const tracker=new Facing8Tracker();
  tracker.update(0,0,0,screenDirection(0,-1,0));
  assert.deepEqual([0,1,2,3,0].map(view=>tracker.update(0,0,view)),['N','E','S','W','N']);
  assert.equal(tracker.update(50,50,0),'N');
  assert.equal(tracker.update(.005,.005,0),'N');
  assert.equal(tracker.update(0,0,0),'N');
});
test('eight-heading hysteresis holds a sector through boundary wobble and changes when cleared',()=>{
  const tracker=new Facing8Tracker(),point=(deg:number)=>screenDirection(Math.cos(deg*Math.PI/180),Math.sin(deg*Math.PI/180),0);
  assert.equal(tracker.update(0,0,0,point(0)),'E');
  for(const deg of [20,25,29,21,27])assert.equal(tracker.update(0,0,0,point(deg)),'E');
  assert.equal(tracker.update(0,0,0,point(32)),'SE');
});

const box={left:20,top:50,right:170,bottom:169};
const file=(key:string)=>({file:`aposentado.${key}.webp`,cell:[192,192],frames:6,directions:4,height:119,figure:box,
  pages:[{file:`aposentado.${key}.webp`,columns:6,rows:12,firstFrame:0,frameCount:72}]});
function fixture(cardLoaded=true){
  const hero={kind:'dir8',files:{dir4:file('dir4'),dir4c:file('dir4c')}};
  setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:hero}}}}));
  const textures=new Set(['sprite:aposentado:dir4',...(cardLoaded?['sprite:aposentado:dir4c']:[])]),animations=new Map<string,any>(),loads:any[]=[],listeners=new Map<string,any>(),once=new Map<string,(()=>void)[]>();
  const scene={time:{now:0},textures:{exists:(k:string)=>textures.has(k)},
    load:{once(event:string,fn:()=>void){once.set(event,[...(once.get(event)??[]),fn]);},on:(event:string,fn:unknown)=>listeners.set(event,fn),spritesheet:(...args:unknown[])=>loads.push(args),isLoading:()=>false,list:{size:0},start(){}},
    anims:{exists:(key:string)=>animations.has(key),generateFrameNumbers:(texture:string,config:unknown)=>({texture,...config as object}),create:(a:any)=>animations.set(a.key,a)}};
  const sprite={texture:{key:'stand-in'},flipX:false,scaleX:1,scaleY:1,played:'',progress:0,
    setTexture(key:string){this.texture={key};return this;},setOrigin(){return this;},setScale(x:number,y:number){this.scaleX=x;this.scaleY=y;return this;},
    setFlipX(flip:boolean){this.flipX=flip;return this;},play(key:string){this.played=key;return this;},
    anims:{getProgress:()=>.4,setProgress:(p:number)=>{sprite.progress=p;},pause(){},resume(){}}};
  return {sprites:new CharacterSprites(scene as never),sprite,scene,animations,loads,listeners,complete(){const callbacks=once.get('complete')??[];once.delete('complete');for(const fn of callbacks)fn();}};
}
test('renderer selects both pages and the right walk block without mirroring or restarting progress',()=>{
  // The legacy walk follows the ground walked (passo-sem-deslizar): its cycle carries across the 8 turns.
  const f=fixture();let x=0,y=0,cycles=0;const figurePx=96*HERO_DRAW_SCALE;
  f.sprites.animate(f.sprite as never,'aposentado',0,0);
  for(const direction of HERO_DIRECTIONS){
    const [sx,sy]=vectors[direction],intent=screenDirection(sx,sy,0),page=HERO_DIRECTION_PAGE[direction];
    x+=intent.x*.1;y+=intent.y*.1;cycles+=walkCycles(intent.x*.1,intent.y*.1,0,figurePx);
    f.sprites.animate(f.sprite as never,'aposentado',x,y,0,true,0,intent);
    assert.equal(f.sprite.texture.key,`sprite:aposentado:${page.page}`,direction);
    assert.equal(f.sprite.flipX,false,direction);
    const anim=f.animations.get(f.sprite.played);
    assert.deepEqual(anim.frames.frames,SPRITE_CLIPS.walk.frames.map(n=>n+page.block*18),direction);
  }
  const n=SPRITE_CLIPS.walk.frames.length;
  assert.equal(f.sprite.progress,cycleFrame(cycles,n)/(n-1));
  setArtIndex(parseArtIndex(undefined));
});
test('missing lite cardinals retry their original once, then retain the working diagonal sheet',()=>{
  const f=fixture(false);
  f.sprites.queue('aposentado');
  assert.equal(f.loads[0][1],'/art/lite/sprites/aposentado.dir4c.webp');
  f.listeners.get('loaderror')({key:'sprite:aposentado:dir4c'});
  f.sprites.queue('aposentado');
  assert.equal(f.loads[1][1],'/art/sprites/aposentado.dir4c.webp');
  f.listeners.get('loaderror')({key:'sprite:aposentado:dir4c'});
  f.sprites.animate(f.sprite as never,'aposentado',0,0,0,true,0,screenDirection(0,-1,0));
  assert.equal(f.sprite.texture.key,'sprite:aposentado:dir4');
  assert.equal(f.loads.length,2);
  setArtIndex(parseArtIndex(undefined));
});
test('cardinal image decode failure without a network error also retries once and keeps the diagonal fallback',()=>{
  const f=fixture(false);
  f.sprites.queue('aposentado');f.complete();
  f.sprites.queue('aposentado');
  assert.deepEqual(f.loads.map(load=>load[1]),['/art/lite/sprites/aposentado.dir4c.webp','/art/sprites/aposentado.dir4c.webp']);
  f.complete();
  f.sprites.animate(f.sprite as never,'aposentado',0,0,0,true,0,screenDirection(0,-1,0));
  assert.equal(f.sprite.texture.key,'sprite:aposentado:dir4');assert.equal(f.loads.length,2);
  setArtIndex(parseArtIndex(undefined));
});
