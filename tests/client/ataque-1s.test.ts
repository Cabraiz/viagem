// NEW-20261022-ORQ-ataque-1s (the user's ask, 22/10): a swing takes ~1 s on screen, never 2–3 s; holding Atacar shows
// one clean swing per hit, squeezed into the weapon's period, instead of several hits run together into one movement.
import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movementPlan,swingFrame,hasMovement16} from '../../src/client/sprites/movement128.ts';
import {CharacterSprites} from '../../src/client/sprites/character-sprites.ts';
import {SpriteMotion,SPRITE_CLIPS,ATTACK_MS,ATTACK_VISUAL_MS,HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';
import {classes} from '../../src/rules/classes.ts';

afterEach(()=>setArtIndex(parseArtIndex(undefined)));

test('every attack sheet plays its whole swing in at most 1000 ms: legacy, R06 and M16, every class and direction',()=>{
  assert.ok(ATTACK_MS>=800&&ATTACK_MS<=1000);
  assert.ok(SPRITE_CLIPS.attack.frames.length/SPRITE_CLIPS.attack.frameRate*1000<=1000,'legacy clip');
  setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
  let sheets=0;
  for(const hero of classes)for(const d of HERO_DIRECTIONS){
    const plan=movementPlan(hero.id,'attack',d);if(!plan)continue;sheets++;
    const n=plan.frameCount,at=(ms:number)=>swingFrame(plan,ms/ATTACK_VISUAL_MS);
    assert.equal(at(0),0,`${hero.id} ${d} starts on its first pose`);
    assert.equal(at(ATTACK_VISUAL_MS-1),n-1,`${hero.id} ${d} reaches its last pose within the swing`);
    assert.equal(at(ATTACK_VISUAL_MS/2),Math.floor(n/2),`${hero.id} ${d} plays at an even pace`);
  }
  assert.ok(sheets>0,'the manifest has detailed attack sheets');
});

test('back-to-back hits never stretch one swing past the period between them',()=>{
  const motion=new SpriteMotion();
  // The server moves attackTick at most every 600 ms (ATTACK_ANIMATION_TICKS 12 × 50 ms); slower weapons, longer gaps.
  for(const period of [600,700,900,1500]){
    let now=100000*period,tick=1000*period,shown=0,swings=0;
    for(let hit=0;hit<5;hit++){
      motion.update(now,false,++tick);swings++;
      assert.equal(motion.swing.start,now,'each hit restarts the swing');
      assert.ok(motion.swing.ms<=Math.min(1000,hit?period:Infinity),`${period} ms: the swing fits the period`);
      for(let t=now;t<now+period;t+=10)if(motion.update(t,false,tick)==='attack')shown+=10;
      now+=period;
    }
    assert.ok(shown/swings<=Math.min(ATTACK_MS,period)+10,`${period} ms: ${shown/swings} ms of attack a hit`);
  }
});

// The real renderer over an M16 class (fake scene, as movement16.test.ts): the frame on screen while holding Atacar.
const ID='aposentado',DRAWN=['S','SW','W','NW','N'] as const;
const m16=(motion:'walk'|'attack'|'idle',direction:string)=>{
  const file=`${ID}.${motion}16-${direction.toLowerCase()}.webp`,rows=motion==='idle'?2:4,frames=4*rows;
  return {file,cell:[96,96],revision:16,movementHands:'empty',frames,durationMs:{walk:600,attack:1000,idle:2000}[motion],loop:motion!=='attack',
    anchor:[.5,.875],height:58,pivotX:48,figure:{left:20,top:18,right:70,bottom:80},pages:[{file,columns:4,rows,firstFrame:0,frameCount:frames}]};
};
test('on screen: a lone swing shows its 16 poses in ATTACK_MS; the next hit 600 ms later starts again from pose 0',()=>{
  const files:Record<string,unknown>={};
  for(const motion of ['walk','attack','idle'] as const)for(const d of DRAWN)files[`${motion}16-${d}`]=m16(motion,d);
  setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[ID]:{kind:'dir8',files}}}}}));
  assert.equal(hasMovement16(ID),true);
  const images=new Map<string,{width:number;height:number;close():void}>(),events=new EventEmitter();
  for(const motion of ['walk','attack','idle'])for(const d of DRAWN)images.set(`sprite16:${ID}:${motion}:${d}`,{width:384,height:motion==='idle'?192:384,close(){}});
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
  const at=(ms:number,tick:number)=>{scene.time.now=ms;renderer.animate(sprite as never,ID,0,0,tick);return [sprite.texture.key.split(':')[2],Number(sprite.frame.name)] as const;};
  at(0,0);
  assert.deepEqual(at(1000,1),['attack',0]);
  assert.deepEqual(at(1000+ATTACK_MS/2,1),['attack',8]);
  assert.deepEqual(at(1000+ATTACK_MS-1,1),['attack',15]);
  assert.equal(at(1000+ATTACK_MS+1,1)[0],'idle','a lone swing is over within ATTACK_MS');
  // Holding Atacar: hits every 600 ms, each a whole swing of its own.
  assert.deepEqual(at(5000,2),['attack',0]);
  assert.deepEqual(at(5590,2),['attack',Math.floor(590/ATTACK_MS*16)],'the first swing of a burst plays at full length');
  assert.deepEqual(at(5600,3),['attack',0],'the next hit starts over');
  assert.deepEqual(at(5900,3),['attack',8],'and plays its 16 poses in the 600 ms until the next');
  assert.deepEqual(at(6199,3),['attack',15]);
  assert.equal(at(6200,3)[0],'idle','no hit, no swing: the attack never runs on past the period');
});
