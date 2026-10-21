// M16 (card movimento16-espelho): 16/8 poses in 5 drawn directions, the other side of each pair mirrored on the body's pivot.
import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movement16Plan,movementPlan,movementSheets,movementFrame,movementPivotX,hasMovement16,movement128Figure,movement16Source} from '../../src/client/sprites/movement128.ts';
import {CharacterSprites} from '../../src/client/sprites/character-sprites.ts';
import {HERO_ANIM_RATE,HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';
import {screenDirection} from '../../src/client/projection.ts';
import {heroSheetUrl,heroMotionUrls} from '../../src/client/preload/match-assets.ts';
import {variantGeometry,variantOrigin,copyX,cropOf} from '../../src/client/render/city-outline-rules.ts';

const T=(ms:number)=>Math.ceil(ms/HERO_ANIM_RATE);
afterEach(()=>setArtIndex(parseArtIndex(undefined)));
const ID='aposentado',DRAWN=['S','SW','W','NW','N'] as const;
const PIVOT={S:48,SW:44,W:41,NW:43.5,N:50,SE:46,E:47,NE:45} as const;
const r06=(motion:string,direction:string)=>{
  const file=`${ID}.${motion}128-${direction.toLowerCase()}.webp`;
  return {file,cell:[96,96],revision:6,movementHands:'empty',frames:128,durationMs:motion==='walk'?600:1000,loop:motion==='walk',anchor:[.5,.875],
    height:60,figure:{left:8,top:20,right:88,bottom:86},pages:[{file,columns:16,rows:8,firstFrame:0,frameCount:128}]};
};
const idle8={file:`${ID}.idle8.webp`,cell:[96,96],frames:1,directions:8,revision:6,movementHands:'empty',loop:false,anchor:[.5,.875],height:60,
  figure:{left:8,top:20,right:88,bottom:86},pages:[{file:`${ID}.idle8.webp`,columns:8,rows:1,firstFrame:0,frameCount:8}]};
const m16=(motion:'walk'|'attack'|'idle',direction:keyof typeof PIVOT)=>{
  const file=`${ID}.${motion}16-${direction.toLowerCase()}.webp`,rows=motion==='idle'?2:4,frames=4*rows;
  return {file,cell:[96,96],revision:16,movementHands:'empty',frames,durationMs:{walk:600,attack:1000,idle:2000}[motion],loop:motion!=='attack',
    anchor:[.5,.875],height:58,pivotX:PIVOT[direction],figure:{left:20,top:18,right:70,bottom:80},pages:[{file,columns:4,rows,firstFrame:0,frameCount:frames}]};
};
function index(drop:string[]=[],drawn:readonly (keyof typeof PIVOT)[]=DRAWN){
  const files:Record<string,unknown>={idle8};
  for(const motion of ['walk','attack'])for(const d of HERO_DIRECTIONS)files[`${motion}128-${d}`]=r06(motion,d);
  for(const motion of ['walk','attack','idle'] as const)for(const d of drawn)files[`${motion}16-${d}`]=m16(motion,d);
  files['walk16-E']=m16('walk','W');
  for(const key of drop)delete files[key];
  return parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{[ID]:{kind:'dir8',files}}}}});
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

test('by default W/NW/SW are drawn and E/NE/SE are their mirrored plans; a side drawn in one motion only is not a side',()=>{
  const parsed=index();assert.ok(parsed.groups.personagens.pieces[ID].files['walk16-E'],'E keys are valid manifest keys');
  setArtIndex(parsed);assert.equal(hasMovement16(ID),true);
  for(const motion of ['walk','attack','idle'] as const)for(const d of HERO_DIRECTIONS){
    const plan=movementPlan(ID,motion,d)!,{source,flip}=movement16Source(ID,d);
    assert.equal(plan.key,`sprite16:${ID}:${motion}:${source}`);assert.equal(!!plan.flip,flip,d);assert.equal(plan.direction,d);
    assert.equal(plan.frameCount,motion==='idle'?8:16);assert.deepEqual([plan.columns,plan.rows],[4,motion==='idle'?2:4]);
    assert.match(plan.url,/^\/art\/lite\/sprites\//);
  }
  assert.deepEqual(movement16Source(ID,'E'),{source:'W',flip:true},'walk16-E alone (no attack/idle E) does not draw E');
  assert.deepEqual(movement16Source(ID,'NE'),{source:'NW',flip:true});assert.deepEqual(movement16Source(ID,'SE'),{source:'SW',flip:true});
  assert.equal(movementSheets(ID,'walk').length,5);assert.equal(movementSheets(ID,'idle').length,5);
  // Figure union holds the drawn box and its mirror (192 px system).
  assert.deepEqual(movement128Figure(ID),{left:40,top:36,right:152,bottom:160});
  for(const patch of [{revision:6},{frames:128},{pivotX:0},{pivotX:96},{pivotX:undefined},{loop:false},{durationMs:1000},{pages:[{...m16('walk','S').pages[0],rows:2}]}]){
    const bad=index();(bad.groups.personagens.pieces[ID].files['walk16-S'] as unknown as Record<string,unknown>)=Object.assign({},m16('walk','S'),patch);
    setArtIndex(bad);assert.equal(movement16Plan(ID,'walk','S'),undefined,JSON.stringify(patch));assert.equal(hasMovement16(ID),false);
  }
});

test('a class without the complete M16 keeps exactly R06: 128 poses, idle8 and the 8 drawn directions, never mirrored',()=>{
  setArtIndex(index(['idle16-N']));assert.equal(hasMovement16(ID),false);
  for(const d of HERO_DIRECTIONS){
    const walk=movementPlan(ID,'walk',d)!,idle=movementPlan(ID,'idle',d)!;
    assert.equal(walk.key,`sprite128:${ID}:walk:${d}`);assert.equal(walk.flip,undefined);assert.equal(walk.frameCount,128);
    assert.equal(idle.key,`sprite128:${ID}:idle8`);assert.equal(movementFrame(idle,d,5000),HERO_DIRECTIONS.indexOf(d));
    assert.equal(movementPivotX(walk),.5);
  }
  assert.equal(heroMotionUrls(ID).length,16);assert.match(heroSheetUrl(ID)!,/idle8/);
});

test('M16 timing: walk 600 ms and rest 2000 ms loop over 16/8 poses, the attack holds its last pose at 1000 ms',()=>{
  setArtIndex(index());
  const walk=movementPlan(ID,'walk','E')!,attack=movementPlan(ID,'attack','E')!,idle=movementPlan(ID,'idle','E')!;
  assert.deepEqual(Array.from({length:16},(_,i)=>movementFrame(walk,'E',T((i+.5)*600/16))),Array.from({length:16},(_,i)=>i));
  assert.equal(movementFrame(walk,'E',T(600)+1),0);
  assert.deepEqual(Array.from({length:8},(_,i)=>movementFrame(idle,'E',T((i+.5)*2000/8))),Array.from({length:8},(_,i)=>i));
  assert.equal(movementFrame(attack,'E',T(999)),15);assert.equal(movementFrame(attack,'E',T(5000)),15);
});

test('the mirror pivots on the body: flipped origin x is 1 − pivot/96, in the plain sheet and in the city copy',()=>{
  setArtIndex(index());
  for(const d of HERO_DIRECTIONS){
    const plan=movementPlan(ID,'walk',d)!,px=movementPivotX(plan)*96,origin=plan.flip?1-movementPivotX(plan):movementPivotX(plan);
    // Phaser 3.90: column c of a frame w wide shows at c − ox unflipped and at w − ox − c flipped (mirrored in its box).
    const shown=plan.flip?96-origin*96-px:px-origin*96;assert.ok(Math.abs(shown)<1e-9,`${d}: pivot column on the sprite's x`);
    assert.equal(px,PIVOT[movement16Source(ID,d).source]);
  }
  // City copy (cropped to the figure, padded): its crop is symmetric, so mirroring after variantOrigin keeps the pivot.
  const plan=movementPlan(ID,'walk','E')!,g=variantGeometry(96,96,1.7,1.3,1,cropOf(plan.figure,96,96))!,ax=movementPivotX(plan);
  const o=variantOrigin(g,ax,.8),flipped=1-o.x;
  assert.ok(Math.abs((g.slotW-flipped*g.slotW-copyX(g,ax*96)))<1e-9,'copy: mirrored pivot column on the origin');
});

test('the sprite shows E/NE/SE as W/NW/SW flipped on the pivot, keeps the walk phase on a W→E turn and loads 5 sheets per motion',async()=>{
  setArtIndex(index());
  type Sheet={width:number;height:number;close():void};
  const images=new Map<string,Sheet>(),events=new EventEmitter(),loads:string[]=[];
  const scene={events,time:{now:0},textures:{exists:(key:string)=>images.has(key),get:(key:string)=>({getSourceImage:()=>images.get(key)}),
    addSpriteSheet:()=>{throw new Error('preloaded sheets are adopted, never decoded again');},remove:(key:string)=>images.delete(key)},
    load:{spritesheet:(key:string,_url:string,config:{endFrame:number})=>{loads.push(key);images.set(key,{width:384,height:config.endFrame===7?192:384,close(){}});},isLoading:()=>false,list:{size:0}},
    anims:{exists:()=>false,generateFrameNumbers:()=>[],create:()=>{throw new Error('no legacy animation');}}};
  const sprite=new class extends EventEmitter {
    scene=scene;active=true;visible=true;texture={key:'portrait'};frame={name:'0'};flipX=false;flipY=false;originX=.5;originY=.5;
    anims={isPlaying:false,stop(){}};
    setTexture(key:string,frame=0){this.texture={key};this.frame={name:String(frame)};return this;}setFrame(frame:number){this.frame={name:String(frame)};return this;}
    setOrigin(x:number,y:number){this.originX=x;this.originY=y;return this;}setScale(){return this;}setFlipX(v:boolean){this.flipX=v;return this;}setFlipY(v:boolean){this.flipY=v;return this;}
  }();
  const renderer=new CharacterSprites(scene as never);renderer.queue(ID);renderer.queueOwnWalk(ID);
  assert.deepEqual(loads,[...DRAWN.map(d=>`sprite16:${ID}:idle:${d}`),...DRAWN.map(d=>`sprite16:${ID}:walk:${d}`)]);
  assert.match(heroSheetUrl(ID)!,/idle16-s\.webp$/);assert.equal(heroMotionUrls(ID).length,14,'5 walk + 5 attack + the other 4 rests');
  const vectors={S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1],N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1]} as const;
  renderer.animate(sprite as never,ID,0,0);
  for(const d of HERO_DIRECTIONS){
    renderer.animate(sprite as never,ID,0,0,0,true,0,screenDirection(...vectors[d],0));
    const {source,flip}=movement16Source(ID,d),px=PIVOT[source]/96;
    assert.equal(sprite.texture.key,`sprite16:${ID}:idle:${source}`,d);assert.equal(sprite.flipX,flip,d);
    assert.ok(Math.abs(sprite.originX-(flip?1-px:px))<1e-9,`${d} rest origin`);
  }
  // Walking W, then turning E mid-cycle: same sheet, mirrored, the phase goes on.
  let x=0;const step=(dx:number,ms:number)=>{scene.time.now+=ms;x+=dx;renderer.animate(sprite as never,ID,x,0,0,true,0,screenDirection(dx,0,0));};
  step(-.1,16);for(let i=0;i<12;i++)step(-.1,16);
  assert.equal(sprite.texture.key,`sprite16:${ID}:walk:W`);assert.equal(sprite.flipX,false);
  const before=Number(sprite.frame.name);step(.1,16);step(.1,1);
  assert.equal(sprite.texture.key,`sprite16:${ID}:walk:W`,'E draws the W sheet');assert.equal(sprite.flipX,true);
  assert.ok(Math.abs(sprite.originX-(1-PIVOT.W/96))<1e-9);
  assert.ok(Number(sprite.frame.name)>=before&&Number(sprite.frame.name)<=before+1,'the walk phase survives the turn');
  assert.ok(Math.abs(sprite.originY-80/96)<1e-9,'feet line from the M16 rests and walks');
  await flush();events.emit('shutdown');
});

test('freeing a loader-preloaded <img> drops its handlers first (clearing the src fired Phaser onerror, a page error)',async()=>{
  const {freeSheet}=await import('../../src/client/sprites/movement128-textures.ts');
  let fired=0;const img={src:'x.webp',onload:()=>{fired++;},onerror:()=>{fired++;}} as unknown as HTMLImageElement;
  freeSheet(img);assert.equal(img.src,'');assert.equal(img.onerror,null);assert.equal(img.onload,null);assert.equal(fired,0);
  let closed=false;freeSheet({width:1,height:1,close(){closed=true;}} as unknown as ImageBitmap);assert.ok(closed);
});

test('plano B: the drawn side is chosen per class and per pair (viciado: W, NW and SE drawn; E, NE and SW mirrored)',()=>{
  setArtIndex(index([],['S','W','NW','N','SE']));assert.equal(hasMovement16(ID),true);
  const want={S:['S',false],N:['N',false],W:['W',false],E:['W',true],NW:['NW',false],NE:['NW',true],SE:['SE',false],SW:['SE',true]} as const;
  for(const d of HERO_DIRECTIONS){
    assert.deepEqual(movement16Source(ID,d),{source:want[d][0],flip:want[d][1]},d);
    for(const motion of ['walk','attack','idle'] as const){
      const plan=movementPlan(ID,motion,d)!;assert.equal(plan.key,`sprite16:${ID}:${motion}:${want[d][0]}`);assert.equal(!!plan.flip,want[d][1]);
      const origin=plan.flip?1-movementPivotX(plan):movementPivotX(plan);assert.equal(origin,want[d][1]?1-PIVOT[want[d][0]]/96:PIVOT[want[d][0]]/96);
    }
  }
  assert.deepEqual(movementSheets(ID,'walk').map(p=>p.key),['S','SE','W','NW','N'].map(d=>`sprite16:${ID}:walk:${d}`),'5 sheets, S first (SW brings SE)');
  assert.match(heroSheetUrl(ID)!,/idle16-s\.webp$/);assert.equal(heroMotionUrls(ID).length,14);
  // A pair with neither side complete: no M16 (R06 stays); both sides drawn: each shows its own.
  setArtIndex(index(['idle16-SE'],['S','W','NW','N','SE']));assert.equal(hasMovement16(ID),false);assert.equal(movementPlan(ID,'walk','SE')?.key,`sprite128:${ID}:walk:SE`);
  setArtIndex(index([],['S','SW','W','NW','N','SE']));assert.deepEqual(movement16Source(ID,'SE'),{source:'SE',flip:false});assert.deepEqual(movement16Source(ID,'SW'),{source:'SW',flip:false});
  assert.equal(movementSheets(ID,'idle').length,6);
});
