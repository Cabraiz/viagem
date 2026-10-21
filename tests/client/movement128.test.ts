import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movement128Plan,movement128Frame,movement128Figure,movementIdle8Plan,movementIdle8Frame,type Movement128Plan} from '../../src/client/sprites/movement128.ts';
import {Movement128Textures,movement128Textures} from '../../src/client/sprites/movement128-textures.ts';
import {CharacterSprites} from '../../src/client/sprites/character-sprites.ts';
import {HERO_ANIM_RATE,HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';
/** Screen ms after which `ms` of the art's own timing has played (animacao-heroi-70: the clips play at HERO_ANIM_RATE). */
const T=(ms:number)=>Math.ceil(ms/HERO_ANIM_RATE);
import {screenDirection} from '../../src/client/projection.ts';
import {heroSheetUrl,assetsParaPartida} from '../../src/client/preload/match-assets.ts';

afterEach(()=>setArtIndex(parseArtIndex(undefined)));
const legacy=(file:string)=>({file,cell:[192,192],frames:6,directions:4,height:120,figure:{left:20,top:48,right:172,bottom:170},pages:[{file,columns:6,rows:12,firstFrame:0,frameCount:72}]});
const clip=(motion='walk',direction='S')=>{
  const file=`aposentado.${motion}128-${direction.toLowerCase()}.webp`;
  return {file,cell:[96,96],revision:6,movementHands:'empty',frames:128,durationMs:motion==='walk'?600:1000,loop:motion==='walk',anchor:[.5,.875],
    height:60,figure:{left:8,top:20,right:88,bottom:86},pages:[{file,columns:16,rows:8,firstFrame:0,frameCount:128}]};
};
const idle8=()=>({file:'aposentado.idle8.webp',cell:[96,96],frames:1,directions:8,revision:6,movementHands:'empty',loop:false,anchor:[.5,.875],height:60,
  figure:{left:8,top:20,right:88,bottom:86},pages:[{file:'aposentado.idle8.webp',columns:8,rows:1,firstFrame:0,frameCount:8}]});
function manifest(extra:Record<string,unknown>={}){
  const files:Record<string,unknown>={dir4:legacy('aposentado.dir4.webp'),dir4c:legacy('aposentado.dir4c.webp')};
  for(const motion of ['walk','attack'])for(const direction of HERO_DIRECTIONS)files[`${motion}128-${direction}`]=clip(motion,direction);
  return {version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:{kind:'dir8',files:{...files,...extra}}}}}};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

test('manifest keeps exactly the16 uppercase movement keys; planner validates96px sheets without fetching them',()=>{
  const index=parseArtIndex(manifest({'walk128-BAD':clip(),'dir4-UNSAFE':clip()}));setArtIndex(index);
  assert.equal(Object.keys(index.groups.personagens.pieces.aposentado.files).length,18);
  for(const motion of ['walk','attack'] as const)for(const direction of HERO_DIRECTIONS){
    const plan=movement128Plan('aposentado',motion,direction)!;assert.ok(plan);assert.equal(plan.durationMs,motion==='walk'?600:1000);
    assert.match(plan.url,/^\/art\/lite\/sprites\//);assert.equal(plan.direction,direction);
  }
  assert.deepEqual(movement128Figure('aposentado'),{left:16,top:40,right:176,bottom:172});
  for(const patch of [{revision:5},{movementHands:'weapon'},{cell:[192,192]},{frames:64},{durationMs:36000},{loop:false},{height:0},{pages:[{...clip().pages[0],rows:4}]}]){
    setArtIndex(parseArtIndex(manifest({'walk128-S':{...clip(),...patch}})));
    assert.equal(movement128Plan('aposentado','walk','S'),undefined,JSON.stringify(patch));
  }
});

test('all128 source phases fit the 600/1000ms cycles, played at HERO_ANIM_RATE;60Hz deliberately samples fewer poses',()=>{
  for(const [durationMs,loop] of [[600,true],[1000,false]] as const){
    const plan={durationMs,loop};
    assert.deepEqual(Array.from({length:128},(_,i)=>movement128Frame(plan,(i+.5)*durationMs/128/HERO_ANIM_RATE)),Array.from({length:128},(_,i)=>i));
    assert.equal(movement128Frame(plan,T(durationMs)),loop?0:127);
    const frames=Array.from({length:Math.round(T(durationMs)/1000*60)},(_,i)=>movement128Frame(plan,i*1000/60));
    assert.ok(new Set(frames).size<=frames.length&&new Set(frames).size<128,'128 available poses do not mean128 display refreshes (60 Hz over the slowed cycle)');
  }
});

test('idle8 keeps one oblique pose for each direction and rejects incompatible rest sheets',()=>{
  setArtIndex(parseArtIndex(manifest({idle8:idle8()})));const plan=movementIdle8Plan('aposentado')!;
  assert.ok(plan);assert.deepEqual([plan.columns,plan.rows,plan.frameCount],[8,1,8]);assert.equal(plan.motion,'idle');
  assert.equal(movement128Frame(plan,0),0,'rest has no animated timeline');
  assert.deepEqual(HERO_DIRECTIONS.map(movementIdle8Frame),[0,1,2,3,4,5,6,7]);
  for(const patch of [{frames:128},{directions:4},{cell:[192,192]},{movementHands:'weapon'},{loop:true}]){
    setArtIndex(parseArtIndex(manifest({idle8:{...idle8(),...patch}})));assert.equal(movementIdle8Plan('aposentado'),undefined);
  }
});

test('shared LRU keeps eight unleased atlases, honors live leases and frees derivatives on eviction',async()=>{
  setArtIndex(parseArtIndex(manifest()));const first=movement128Plan('aposentado','walk','S')!,disposed:string[]=[];
  const cache=new Movement128Textures(async plan=>({dispose:()=>{disposed.push(plan.key);}}));
  const held={};cache.request(held,first);await flush();cache.bind(held,first.key);
  for(let i=0;i<10;i++){
    const owner={},plan={...first,key:'other:'+i};cache.request(owner,plan);await flush();cache.bind(owner,plan.key);cache.release(owner);
  }
  assert.equal(cache.stats().ready,8);assert.equal(cache.stats().leasedTextures,1);assert.equal(disposed.length,3);assert.ok(!disposed.includes(first.key));
  cache.release(held);cache.clearUnused();assert.equal(cache.stats().ready,0);assert.equal(disposed.length,11);
});

test('more than eight simultaneously visible leased atlases are never evicted; dropping a lease restores the target',async()=>{
  setArtIndex(parseArtIndex(manifest()));const first=movement128Plan('aposentado','walk','S')!,disposed:string[]=[];
  const cache=new Movement128Textures(async plan=>({dispose:()=>{disposed.push(plan.key);}})),owners=Array.from({length:9},()=>({}));
  for(const [i,owner] of owners.entries()){const plan={...first,key:'visible:'+i};cache.request(owner,plan);await flush();cache.bind(owner,plan.key);}
  assert.equal(cache.stats().ready,9);assert.equal(cache.stats().leasedTextures,9);assert.deepEqual(disposed,[]);
  cache.release(owners[0]);assert.equal(cache.stats().ready,8);assert.deepEqual(disposed,['visible:0']);
});

test('rapid turns decode at most two atlases in parallel and skip obsolete queued directions',async()=>{
  setArtIndex(parseArtIndex(manifest()));const first=movement128Plan('aposentado','walk','S')!,owner={},loaded:string[]=[],disposed:string[]=[],finish=new Map<string,()=>void>();
  const cache=new Movement128Textures(plan=>new Promise(resolve=>{loaded.push(plan.key);finish.set(plan.key,()=>resolve({dispose:()=>{disposed.push(plan.key);}}));}));
  for(let i=0;i<16;i++){cache.request(owner,{...first,key:'turn:'+i});await Promise.resolve();}
  assert.equal(cache.stats().loading,2);assert.equal(cache.stats().queued,1);assert.equal(loaded.length,2);
  finish.get(loaded[0])!();finish.get(loaded[1])!();await flush();assert.equal(loaded.length,3);assert.equal(loaded[2],'turn:15');
  finish.get('turn:15')!();await flush();assert.equal(cache.request(owner,{...first,key:'turn:15'}),true);
  assert.equal(disposed.length,2);assert.equal(cache.stats().ready,1);cache.release(owner);cache.clearUnused();
});

test('both missing manifest IDs and a catalog-free hero start from preloaded native idle8 without any legacy texture',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Image'),requests:string[]=[];
  class FakeImage {src='';decoding='';naturalWidth=1536;naturalHeight=768;get width(){return this.naturalWidth;}get height(){return this.naturalHeight;}async decode(){requests.push(this.src);}}
  Object.defineProperty(globalThis,'Image',{value:FakeImage,configurable:true});
  try{for(const id of ['tio-do-churrasco','conspiracionista','native-only-unit']){
    requests.length=0;const files:Record<string,unknown>={idle8:idle8()};
    for(const motion of ['walk','attack'])for(const direction of HERO_DIRECTIONS)files[`${motion}128-${direction}`]=clip(motion,direction);
    setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[id]:{kind:'dir8',files}}}}}));
    const images=new Map<string,{width:number;height:number;src:string}>(),events=new EventEmitter(),loads:{key:string;url:string;config:unknown}[]=[];
    const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
      addSpriteSheet:(key:string,image:FakeImage)=>images.set(key,image),remove:(key:string)=>images.delete(key)},
      load:{spritesheet:(key:string,url:string,config:unknown)=>{loads.push({key,url,config});images.set(key,{width:768,height:96,src:url});},isLoading:()=>false,list:{size:0}},
      anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('bootstrap must not fabricate legacy animations');}}};
    const sprite=new class extends EventEmitter {
      scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=true;flipY=true;
      anims={isPlaying:false,stop(){}};
      setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
      setOrigin(){return this;}setScale(){return this;}setFlipX(value:boolean){this.flipX=value;return this;}setFlipY(value:boolean){this.flipY=value;return this;}
    }();
    const renderer=new CharacterSprites(scene as never);renderer.queue(id);
    assert.equal(loads.length,1);assert.equal(loads[0].key,`sprite128:${id}:idle8`);assert.deepEqual(loads[0].config,{frameWidth:96,frameHeight:96,endFrame:7});
    assert.equal(heroSheetUrl(id),loads[0].url);assert.equal(assetsParaPartida({self:id,others:[],map:'infinito'}).find(asset=>asset.kind==='hero')?.priority,'P0');
    renderer.animate(sprite as never,id,0,0);assert.equal(sprite.texture.key,`sprite128:${id}:idle8`);assert.equal(requests.length,0,'adoption never decodes/downloads the idle twice');
    const vectors={S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1],N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1]} as const;
    for(const [i,direction] of HERO_DIRECTIONS.entries()){
      renderer.animate(sprite as never,id,0,0,0,true,0,screenDirection(...vectors[direction],0));assert.equal(sprite.frame.name,String(i));assert.equal(sprite.flipX,false);assert.equal(sprite.flipY,false);
    }
    scene.time.now=10;renderer.animate(sprite as never,id,.1,0,0,true,0,screenDirection(0,1,0));await flush();assert.equal(requests.length,1);assert.equal(sprite.texture.key,`sprite128:${id}:idle8`,'native idle survives while walk loads');
    scene.time.now=10+T(300);renderer.animate(sprite as never,id,.2,0,0,true,0,screenDirection(0,1,0));assert.equal(sprite.texture.key,`sprite128:${id}:walk:S`);assert.equal(sprite.frame.name,'64');
    assert.equal(loads.length,1,'no legacy or other15 clips were queued');
    const cache=movement128Textures(scene as never);assert.equal(cache.stats().ready,2);assert.equal(cache.stats().leasedTextures,1);
    events.emit('shutdown');assert.equal(cache.stats().ready,0);assert.equal(images.size,0,'adopted preload and streamed clip are disposed together');
  }}finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});

test('the own walk preloaded with the scene: the first step walks at once, nothing is fetched, unwalked sheets are freed',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Image'),requests:string[]=[];
  class FakeImage {src='';decoding='';naturalWidth=1536;naturalHeight=768;get width(){return this.naturalWidth;}get height(){return this.naturalHeight;}async decode(){requests.push(this.src);}}
  Object.defineProperty(globalThis,'Image',{value:FakeImage,configurable:true});
  try{
    const id='tio-do-churrasco',files:Record<string,unknown>={idle8:idle8()};
    for(const motion of ['walk','attack'])for(const direction of HERO_DIRECTIONS)files[`${motion}128-${direction}`]=clip(motion,direction);
    setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[id]:{kind:'dir8',files}}}}}));
    // Bitmaps from the upload queue (createImageBitmap): closed, not src-cleared, when freed.
    type Sheet={width:number;height:number;closed?:boolean;close():void};
    const images=new Map<string,Sheet>(),events=new EventEmitter(),loads:{key:string;url:string;config:unknown}[]=[],sheets:Sheet[]=[];
    const sheet=(width:number,height:number)=>{const s:Sheet={width,height,close(){s.closed=true;}};sheets.push(s);return s;};
    const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
      addSpriteSheet:(key:string,image:Sheet)=>images.set(key,image),remove:(key:string)=>images.delete(key)},
      load:{spritesheet:(key:string,url:string,config:{endFrame:number})=>{loads.push({key,url,config});images.set(key,config.endFrame===7?sheet(768,96):sheet(1536,768));},isLoading:()=>false,list:{size:0}},
      anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('no legacy animations');}}};
    const sprite=new class extends EventEmitter {
      scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=false;flipY=false;
      anims={isPlaying:false,stop(){}};
      setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
      setOrigin(){return this;}setScale(){return this;}setFlipX(value:boolean){this.flipX=value;return this;}setFlipY(value:boolean){this.flipY=value;return this;}
    }();
    const renderer=new CharacterSprites(scene as never);renderer.queue(id);renderer.queueOwnWalk(id);renderer.queueOwnWalk(id);
    assert.deepEqual(loads.map(l=>l.key),[`sprite128:${id}:idle8`,...HERO_DIRECTIONS.map(d=>`sprite128:${id}:walk:${d}`)],'idle8 and the 8 walks, once each');
    assert.deepEqual(loads.slice(1).map(l=>l.url),HERO_DIRECTIONS.map(d=>movement128Plan(id,'walk',d)!.url),'the lite URLs the waiting room downloads');
    assert.ok(loads.slice(1).every(l=>(l.config as {endFrame:number}).endFrame===127));
    renderer.animate(sprite as never,id,0,0);
    scene.time.now=10;renderer.animate(sprite as never,id,.1,0,0,true,0,screenDirection(0,1,0));
    assert.equal(sprite.texture.key,`sprite128:${id}:walk:S`,'the first step already walks');
    await flush();assert.equal(requests.length,0,'no clip downloaded or decoded after the match opened');
    events.emit('shutdown');
    assert.equal(images.size,0,'adopted and unwalked preloads are all released');
    assert.ok(sheets.every(s=>s.closed),'every bitmap closed');
  }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});

test('no idle/walk flicker: the local hero walks by its input, not by reconcile nudges; others hold the walk across a still frame',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Image');
  class FakeImage {src='';decoding='';naturalWidth=1536;naturalHeight=768;get width(){return this.naturalWidth;}get height(){return this.naturalHeight;}async decode(){}}
  Object.defineProperty(globalThis,'Image',{value:FakeImage,configurable:true});
  try{
    const id='tio-do-churrasco',files:Record<string,unknown>={idle8:idle8()};
    for(const motion of ['walk','attack'])for(const direction of HERO_DIRECTIONS)files[`${motion}128-${direction}`]=clip(motion,direction);
    setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[id]:{kind:'dir8',files}}}}}));
    const images=new Map<string,{width:number;height:number}>(),events=new EventEmitter();
    const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
      addSpriteSheet:(key:string,image:FakeImage)=>images.set(key,image),remove:(key:string)=>images.delete(key)},
      load:{spritesheet:(key:string,_url:string,config:{endFrame:number})=>images.set(key,config.endFrame===7?{width:768,height:96}:{width:1536,height:768}),isLoading:()=>false,list:{size:0}},
      anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('no legacy animations');}}};
    const actor=()=>new class extends EventEmitter {
      scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=false;flipY=false;
      anims={isPlaying:false,stop(){}};
      setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
      setOrigin(){return this;}setScale(){return this;}setFlipX(value:boolean){this.flipX=value;return this;}setFlipY(value:boolean){this.flipY=value;return this;}
    }();
    const renderer=new CharacterSprites(scene as never);renderer.queue(id);renderer.queueOwnWalk(id);
    // Local hero standing (no input): the reconcile correction fades over a few frames, nudging the drawing.
    const self=actor(),still={x:0,y:0},keys:string[]=[];
    let x=0;renderer.animate(self as never,id,x,0,0,true,0,still);
    for(let f=1;f<=12;f++){scene.time.now=f*16;x+=f%2?.02:0;renderer.animate(self as never,id,x,0,0,true,0,still);keys.push(self.texture.key);}
    assert.deepEqual(new Set(keys),new Set([`sprite128:${id}:idle8`]),'standing still stays at rest through the nudges');
    // Walking (input held): every frame walks, even a frame whose drawing did not move.
    const walking=screenDirection(1,0,0);keys.length=0;
    for(let f=13;f<=24;f++){scene.time.now=f*16;x+=f%3?.05:0;renderer.animate(self as never,id,x,0,0,true,0,walking);keys.push(self.texture.key);}
    assert.equal(new Set(keys).size,1,'one walk clip, no rest frame in between');assert.match(keys[0],/:walk:/);
    // A teammate (no intent): a still frame between two moves keeps the walk.
    const mate=actor();keys.length=0;let mx=0;
    renderer.animate(mate as never,id,mx,0);
    for(let f=1;f<=12;f++){scene.time.now=1000+f*16;mx+=f%2?.05:0;renderer.animate(mate as never,id,mx,0);if(f>1)keys.push(mate.texture.key);}
    assert.equal(new Set(keys).size,1,'the teammate walks without flicker');assert.match(keys[0],/:walk:/);
    scene.time.now=2000;renderer.animate(mate as never,id,mx,0);assert.equal(mate.texture.key,`sprite128:${id}:idle8`,'and rests once it stopped');
    events.emit('shutdown');
  }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});

test('an idle preload that never spawns an actor is released at scene shutdown',()=>{
  setArtIndex(parseArtIndex(manifest({idle8:idle8()})));const images=new Map<string,{width:number;height:number;src:string}>(),events=new EventEmitter();let source:{src:string}|undefined;
  const scene={events,textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),remove:(key:string)=>images.delete(key)},
    load:{spritesheet:(key:string,url:string)=>{const image={width:768,height:96,src:url};images.set(key,image);source=image;}}};
  const renderer=new CharacterSprites(scene as never);renderer.queue('aposentado');assert.equal(images.size,1);
  events.emit('shutdown');assert.equal(images.size,0);assert.equal(source?.src,'');events.emit('destroy');assert.equal(images.size,0);
  renderer.queue('aposentado');assert.equal(images.size,1,'the same scene can preload again after a restart');events.emit('shutdown');assert.equal(images.size,0);
});

test('renderer holds the last oblique rest/walk/attack while a clip decodes and falls back after a concrete failure',async()=>{
  setArtIndex(parseArtIndex(manifest()));const previous=Object.getOwnPropertyDescriptor(globalThis,'Image'),decoders=new Map<string,()=>void>(),failures=new Map<string,()=>void>(),requests:string[]=[];
  class FakeImage {src='';decoding='';get naturalWidth(){return this.src.includes('idle8')?768:1536;}get naturalHeight(){return this.src.includes('idle8')?96:768;}decode(){requests.push(this.src);return new Promise<void>((resolve,reject)=>{decoders.set(this.src,resolve);failures.set(this.src,()=>reject(new Error('technical decode failure')));});}}
  Object.defineProperty(globalThis,'Image',{value:FakeImage,configurable:true});
  const events=new EventEmitter(),keys=new Set(['sprite:aposentado:dir4','sprite:aposentado:dir4c']),removed:string[]=[],animations=new Set<string>();
  const scene={events,time:{now:0},textures:{exists:(k:string)=>keys.has(k),addSpriteSheet:(key:string)=>keys.add(key),remove:(key:string)=>{keys.delete(key);removed.push(key);}},
    anims:{exists:(key:string)=>animations.has(key),generateFrameNumbers:()=>[],create:(a:{key:string})=>animations.add(a.key)},load:{isLoading:()=>false,list:{size:0}}};
  class Sprite extends EventEmitter {
    scene=scene;active=true;visible=true;texture={key:'stand-in'};frame={name:'0'};flipX=true;flipY=true;scaleX=1;scaleY=1;originX=0;originY=0;
    anims={isPlaying:false,stop:()=>{this.anims.isPlaying=false;},getProgress:()=>.4,setProgress(){},pause(){},resume(){}};
    setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}
    setFrame(frame:number){this.frame={name:String(frame)};return this;}setOrigin(x:number,y:number){this.originX=x;this.originY=y;return this;}
    setScale(x:number,y:number){this.scaleX=x;this.scaleY=y;return this;}setFlipX(f:boolean){this.flipX=f;return this;}setFlipY(f:boolean){this.flipY=f;return this;}
    play(){this.anims.isPlaying=true;return this;}
  }
  const sprite=new Sprite(),renderer=new CharacterSprites(scene as never);let x=0;
  const render=(time:number,direction:'S'|'N'='S',attack=0,moving=true)=>{scene.time.now=time;if(moving)x+=.1;renderer.animate(sprite as never,'aposentado',x,0,attack,true,0,screenDirection(0,direction==='S'?1:-1,0));};
  try{
    render(0);render(10);await flush();assert.equal(requests.length,1);assert.match(sprite.texture.key,/dir4c$/,'legacy stays while the requested page loads');
    decoders.get(requests[0])!();await flush();render(10+T(300));
    assert.equal(sprite.texture.key,'sprite128:aposentado:walk:S');assert.equal(sprite.frame.name,'64');assert.equal(sprite.flipX,false);assert.equal(sprite.flipY,false);assert.equal(sprite.scaleX,96/60*.8);
    assert.deepEqual(renderer.figureIn(sprite as never,'aposentado'),clip().figure);
    render(10+T(400),'N');await flush();assert.equal(requests.length,2);assert.equal(sprite.texture.key,'sprite128:aposentado:walk:S','turning holds the old oblique direction while the next decodes');assert.equal(sprite.frame.name,'64');
    assert.equal(movement128Textures(scene as never).stats().leasedTextures,1,'the held pose stays leased');
    decoders.get(requests[1])!();await flush();render(10+T(450),'N');assert.equal(sprite.frame.name,'96','turn/late arrival retains450ms walk phase');
    render(1424,'N',1);await flush();assert.equal(requests.length,3);assert.equal(sprite.texture.key,'sprite128:aposentado:walk:N','attack loading keeps the matching oblique camera');assert.equal(sprite.frame.name,'96');
    decoders.get(requests[2])!();await flush();render(1424+T(500),'N',1);assert.equal(sprite.frame.name,'64');
    render(1424+T(600),'N',2);assert.equal(sprite.frame.name,'76','overlapping attack event cannot restart the1000ms swing');
    const cache=movement128Textures(scene as never);assert.equal(cache.stats().leasedTextures,1);
    setArtIndex(parseArtIndex(manifest({idle8:idle8()})));const attackKey=sprite.texture.key;
    render(1424+T(1000)+1,'N',2,false);await flush();assert.equal(requests.length,4);assert.equal(sprite.texture.key,attackKey,'stopping holds the same oblique camera while rest decodes');
    decoders.get(requests[3])!();await flush();render(2863,'N',2,false);
    assert.equal(sprite.texture.key,'sprite128:aposentado:idle8');assert.equal(sprite.frame.name,'4','N is the fifth rest cell');
    for(const [i,direction] of HERO_DIRECTIONS.entries()){
      scene.time.now=2873+i;const vectors={S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1],N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1]} as const;
      renderer.animate(sprite as never,'aposentado',x,0,2,true,0,screenDirection(...vectors[direction],0));assert.equal(sprite.frame.name,String(i));
    }
    assert.equal(requests.length,4,'turning in idle uses the same eight-pose texture');
    sprite.visible=false;render(2953,'N',2,false);assert.match(sprite.texture.key,/dir4c$/);assert.equal(cache.stats().leasedTextures,0);
    sprite.visible=true;render(3053,'N',2,false);assert.equal(cache.stats().leasedTextures,1);
    render(3153,'S',3);await flush();assert.equal(requests.length,5);assert.equal(sprite.texture.key,'sprite128:aposentado:idle8','leaving idle keeps the oblique rest until attack loads');
    failures.get(requests[4])!();await flush();assert.equal(requests.length,6,'failed lite tries the original exactly once');
    render(3163,'S',3);assert.equal(sprite.texture.key,'sprite128:aposentado:idle8');
    failures.get(requests[5])!();await flush();render(3203,'S',3);assert.match(sprite.texture.key,/dir4c$/,'concrete failure restores a usable legacy attack');assert.equal(cache.stats().leasedTextures,0);
    render(3223,'S',3);await flush();assert.equal(requests.length,6,'failed clip is not requested repeatedly');
    sprite.emit('destroy');assert.equal(cache.stats().owners,0);
    events.emit('shutdown');assert.equal(cache.stats().ready,0);assert.equal(removed.length,4);
  }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});

test('a figure off camera asks for no legacy sheet: it holds its pose; on camera, dead, the legacy pose still loads',()=>{
  setArtIndex(parseArtIndex(manifest({idle8:idle8()})));const loads:string[]=[],events=new EventEmitter();
  const scene={events,time:{now:0},textures:{exists:()=>false},cameras:{main:{worldView:{left:0,right:400,top:0,bottom:800}}},
    load:{spritesheet:(key:string)=>loads.push(key),once(){},on(){},isLoading:()=>false,start(){},list:{size:0}}};
  class Sprite extends EventEmitter {
    scene=scene;active=true;visible=true;alpha=1;x=5000;y=5000;texture={key:'stand-in'};frame={name:'0'};stops=0;
    anims={isPlaying:false,stop:()=>{this.stops++;}};
    getBounds(){return {left:this.x-10,right:this.x+10,top:this.y-10,bottom:this.y+10};}
  }
  const sprite=new Sprite(),renderer=new CharacterSprites(scene as never);
  renderer.animate(sprite as never,'aposentado',0,0);renderer.animate(sprite as never,'aposentado',1,0);
  assert.deepEqual(loads,[],'no dir4/dir4c for a figure the camera cannot see');assert.equal(sprite.texture.key,'stand-in');assert.ok(sprite.stops>0);
  sprite.x=200;sprite.y=400;renderer.animate(sprite as never,'aposentado',1,0,0,false);
  assert.deepEqual(loads,['sprite:aposentado:dir4','sprite:aposentado:dir4c'],'a dead figure on camera still loads its legacy pose');
});

test('Q4: a pinned clip (the own walk) is loaded at once, never evicted, outside the eight; unpinned it is an LRU entry again',async()=>{
  setArtIndex(parseArtIndex(manifest()));const first=movement128Plan('aposentado','walk','S')!,disposed:string[]=[],loaded:string[]=[];
  const cache=new Movement128Textures(async plan=>{loaded.push(plan.key);return {dispose:()=>{disposed.push(plan.key);}};});
  const own=Array.from({length:8},(_,i)=>({...first,key:'own:'+i}));
  for(const plan of own)cache.pin(plan);
  await flush();await flush();await flush();await flush();
  assert.deepEqual(loaded.sort(),own.map(p=>p.key).sort(),'decoded without an owner');
  // Ten other heroes' clips come and go: the eight unleased ones are the others', the own walk stays.
  for(let i=0;i<10;i++){const owner={},plan={...first,key:'other:'+i};cache.request(owner,plan);await flush();cache.bind(owner,plan.key);cache.release(owner);}
  assert.equal(cache.stats().ready,16);assert.equal(cache.stats().pinned,8);
  assert.ok(!disposed.some(k=>k.startsWith('own:')),'no own walk evicted');
  assert.equal(disposed.length,2);
  // Adopted by the hero's sprite: no new load.
  const hero={};assert.equal(cache.request(hero,own[3]),true);cache.release(hero);
  cache.clearUnused();assert.ok(!disposed.some(k=>k.startsWith('own:')),'clearUnused keeps the pins');
  for(const plan of own)cache.unpin(plan.key);
  cache.clearUnused();assert.equal(cache.stats().ready,0);
});
