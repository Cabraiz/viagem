import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {eventAction,projectileAction,actionDuration,onceColumn,deathAlpha,DEATH_FADE_MS,TELEGRAPH_ACTIONS,
  type ActionActor,type ActionCue,type ActionWorld} from '../../src/client/art/horde-actions.ts';
import {ENEMY_ANIM_RATE,ENEMY_LOOP_RATE,applyEnemyArt,artLoads,currentAction,drawDeathArt,enemyArtActive,enemyArtRow,enemyFrame,hasDeathArt,loopAnim,
  playEnemyAction,projectileFrame,projectileFrames,projectileLook,startAction,hitGap,HIT_GAP_MIN_MS,SWING_FILL,SWING_FILL_MAX_MS,SWING_RESTART,STATIC_ART,type ActionState} from '../../src/client/art/horde-art.ts';
import {FX,projectileTexture,type EnemyKind} from '../../src/client/render/keys.ts';
import {Ring} from '../../src/client/render/pool.ts';
import type {SimEvent,TelegraphKind} from '../../src/contract/index.ts';

const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));

// ---------------------------------------------------------------- fixtures
const sheet=(file:string,frames:number,fps=10)=>({file,cell:[128,128] as [number,number],frames,directions:8,anchor:[.5,.88] as [number,number],fps});
const bebado:ArtPiece={kind:'animations',files:{
  idle:sheet('bebado/idle.webp',6,6),walk:sheet('bebado/walk.webp',8),attack:sheet('bebado/attack.webp',6,12),
  hit:sheet('bebado/hit.webp',3,12),death:sheet('bebado/death.webp',10,10),'elite/walk':sheet('elite/bebado-walk.webp',8),'elite/idle':sheet('elite/bebado-idle.webp',6,6),
}};
const chefe:ArtPiece={kind:'animations',files:{idle:sheet('chefe/idle.webp',6,6),walk:sheet('chefe/walk.webp',8),'phase2-idle':sheet('chefe/phase2-idle.webp',6,6),slam:sheet('chefe/slam.webp',10,12)}};
const strip=(file:string,frames:number,cell=64)=>({kind:'frames',files:{sheet:{file,cell:[cell,cell] as [number,number],frames}}});
function useArt(projeteis:Record<string,unknown>={}){
  setArtIndex(parseArtIndex({version:2,groups:{
    inimigos:{output:'public/art/enemies',pieces:{bebado,chefe}},
    projeteis:{output:'public/art/projectiles',pieces:projeteis},
  }}));
}

/** A tiny world: actors by id, telegraphs by id. */
function world(actors:ActionActor[],telegraphs:Record<string,{kind?:TelegraphKind;x:number;y:number}>={}):ActionWorld{
  return {
    enemy:id=>actors.find(a=>a.id===id),
    nearest:(kind,x,y,max)=>{
      let best:ActionActor|undefined,d=max;
      for(const a of actors){const k=Math.hypot(a.nx-x,a.ny-y);if(a.kind===kind&&k<=d){d=k;best=a;}}
      return best;
    },
    telegraph:id=>telegraphs[id],
  };
}
const actor=(id:string,kind:EnemyKind,nx:number,ny:number,bossPhase=1):ActionActor=>({id,kind,nx,ny,bossPhase});
const ev=(e:SimEvent)=>e;
const cueOf=(e:SimEvent,w:ActionWorld)=>{const c=eventAction(e,w,{enemy:'',action:'hit'});return c&&`${c.enemy}:${c.action}`;};

// ---------------------------------------------------------------- 1. event → action
test('event → action table: hit, contact, telegraphs, bark, summon; nothing for kill and unowned hazards',()=>{
  const w=world([actor('b1','bebado',0,0),actor('t1','tio-pave',10,0),actor('a1','agiota',20,0),actor('p1','pombos',30,0),
    actor('m1','anao-molotov',40,0),actor('c1','chefe',60,0,2)],{
    burp:{kind:'arroto',x:.3,y:0},poop:{kind:'coco',x:30,y:.5},bomb:{kind:'molotov',x:47,y:0},far:{kind:'molotov',x:52,y:0},
    joke:{kind:'investida',x:9,y:0},charge:{kind:'investida',x:60.5,y:0},stamp:{kind:'carimbo',x:80,y:5},stomp:{kind:'pancada',x:60,y:0},
    sweep:{kind:'varredura',x:60,y:0},fire:{kind:'fogo',x:47,y:0},boom:{kind:'explosao',x:40,y:0},plain:{x:0,y:0},
  });
  const rows:[SimEvent,string|undefined][]=[
    [ev({type:'damage',target:'b1',amount:3}),'b1:hit'],
    [ev({type:'damage',target:'c1',amount:3,source:'hero'}),'c1:hit'],
    // The bêbado's burp damage is not a second attack: its telegraph already played it (below).
    [ev({type:'damage',target:'hero',amount:4,source:'b1'}),undefined],
    [ev({type:'damage',target:'hero',amount:4,source:'t1'}),'t1:shove'],
    [ev({type:'damage',target:'hero',amount:4,source:'a1'}),undefined], // the boleto hits with the agiota's id: not a swing
    [ev({type:'damage',target:'hero',amount:4,source:'env:molotov:m1'}),undefined],
    [ev({type:'damage',target:'hero',amount:4}),undefined],
    [ev({type:'telegraph',telegraph:'burp'}),'b1:attack'],
    [ev({type:'telegraph',telegraph:'poop'}),'p1:poop'],
    [ev({type:'telegraph',telegraph:'bomb'}),'m1:throw'],
    [ev({type:'telegraph',telegraph:'far'}),undefined], // 12 u away: past MOLOTOV.fireRange, not his
    [ev({type:'telegraph',telegraph:'joke'}),'t1:joke'],
    [ev({type:'telegraph',telegraph:'charge'}),'c1:charge'],
    [ev({type:'telegraph',telegraph:'stamp'}),'c1:slam'],
    [ev({type:'telegraph',telegraph:'stomp'}),'c1:slam'],
    [ev({type:'telegraph',telegraph:'sweep'}),'c1:slam'],
    [ev({type:'telegraph',telegraph:'fire'}),undefined],
    [ev({type:'telegraph',telegraph:'boom'}),undefined],
    [ev({type:'telegraph',telegraph:'plain'}),undefined],
    [ev({type:'telegraph',telegraph:'gone'}),undefined],
    [ev({type:'bark',enemy:'t1',line:'pavê ou pacumê?'}),'t1:joke'],
    [ev({type:'bark',enemy:'b1',line:'hic'}),undefined],
    [ev({type:'spawn-warning',x:62.5,y:0,atTick:9,count:1}),'c1:summon'],
    [ev({type:'spawn-warning',x:62.5,y:0,atTick:9,count:3}),undefined],
    [ev({type:'spawn-warning',x:0,y:0,atTick:9,count:1}),undefined],
    [ev({type:'kill',enemy:'b1',kind:'bebado',x:0,y:0}),undefined],
    [ev({type:'boss-phase',enemy:'c1',phase:2}),undefined],
  ];
  for(const [e,want] of rows)assert.equal(cueOf(e,w),want,JSON.stringify(e));
  // A phase-1 chefe does not summon (sim/boss.ts summons from PHASE_ASSEMBLY).
  assert.equal(cueOf(ev({type:'spawn-warning',x:62.5,y:0,atTick:9,count:1}),world([actor('c1','chefe',60,0,1)])),undefined);
  // Every hazard kind with an owner names a real action of that kind in the spec.
  for(const owners of Object.values(TELEGRAPH_ACTIONS))for(const o of owners??[])assert.ok(o.max>0,o.kind);
});

test('hostile projectile spawn → the nearest agiota throws; friendly shots and strangers do nothing',()=>{
  const w=world([actor('a1','agiota',0,0),actor('a2','agiota',1.5,0)]),out:ActionCue={enemy:'',action:'hit'};
  assert.deepEqual({...projectileAction('boleto-juros',true,1.2,0,w,out)},{enemy:'a2',action:'throw'});
  assert.equal(projectileAction('boleto-juros',true,9,9,w,out),undefined,'too far from any agiota');
  assert.equal(projectileAction('chinelo',false,0,0,w,out),undefined);
  assert.equal(projectileAction('mystery',true,0,0,w,out),undefined);
});

// ---------------------------------------------------------------- 2. timing
/** On-screen time of `ms` of drawn animation: enemies play at ENEMY_ANIM_RATE (+1 ms clears float rounding at a frame edge). */
const slow=(ms:number)=>ms/ENEMY_ANIM_RATE+1;
/** The same for the loops (idle, walk, fly), half as fast again (inimigos-animacao-2x-lenta). */
const slowLoop=(ms:number)=>ms/ENEMY_LOOP_RATE+1;

test('an action plays once at its fps, then the loop comes back; hit never interrupts, the same action never restarts',()=>{
  const s:ActionState={at:0,end:0};
  assert.equal(startAction(s,bebado,'throw',0),false,'missing animation: keeps walking');
  assert.equal(s.action,undefined);
  assert.ok(startAction(s,bebado,'attack',1000));
  assert.equal(s.end-s.at,actionDuration(6,12*ENEMY_ANIM_RATE),'30% slower than drawn');assert.equal(actionDuration(6,12),500);
  assert.equal(startAction(s,bebado,'hit',1100),false,'a hit does not cut the attack');
  assert.equal(startAction(s,bebado,'attack',1200),false,'not restarted');assert.equal(s.at,1000);
  assert.equal(currentAction(s,s.end-1),'attack');assert.equal(currentAction(s,s.end),undefined,'over: back to the loop');
  assert.ok(startAction(s,bebado,'hit',1800));assert.equal(startAction(s,bebado,'hit',1850),false,'hit not restarted');
  assert.ok(startAction(s,bebado,'attack',1900),'an action replaces a hit');assert.equal(s.action,'attack');
  // An enemy in an aura is hit every tick: at most one hit per hitGap (≥ 3 hit animations, ≥ 1500 ms), so it walks in between.
  const gap=hitGap(actionDuration(3,12*ENEMY_ANIM_RATE));assert.equal(gap,HIT_GAP_MIN_MS);assert.equal(hitGap(800),2400);
  assert.equal(startAction(s,bebado,'hit',2900),false);assert.equal(currentAction(s,2900),undefined,'walking (the swing at 1900 came 900 ms after the last: SWING_FILL stretched it to 972 ms)');
  assert.equal(startAction(s,bebado,'hit',1800+gap-1),false);
  assert.ok(startAction(s,bebado,'hit',1800+gap));
  // Frames: one pass, the last frame holds (never wraps to 0 while the action lasts).
  assert.equal(onceColumn(0,6,12),0);assert.equal(onceColumn(250,6,12),3);assert.equal(onceColumn(499,6,12),5);assert.equal(onceColumn(9999,6,12),5);
  assert.deepEqual(enemyFrame('bebado',bebado,'attack',2,slow(250),{key:'',frame:0},true),{key:'art:enemy:bebado:attack',frame:2*6+3});
  assert.deepEqual(enemyFrame('bebado',bebado,'attack',2,slow(5000),{key:'',frame:0},true),{key:'art:enemy:bebado:attack',frame:2*6+5});
  assert.deepEqual(enemyFrame('bebado',bebado,'walk',0,slowLoop(1000)),{key:'art:enemy:bebado:walk',frame:10%8},'loops still loop');
});
test('a swing that comes back fills the gap: no idle flash between two contact hits (inimigos-animacao-auditoria)',()=>{
  const s:ActionState={at:0,end:0},drawn=actionDuration(6,12*ENEMY_ANIM_RATE),near=(a:number,b:number,m:string)=>assert.ok(Math.abs(a-b)<1e-6,`${m}: ${a} vs ${b}`);
  assert.ok(startAction(s,bebado,'attack',1000));near(s.end-s.at,drawn,'a first swing keeps its own length');assert.equal(s.pace,1);
  // The sim hits every second (contactCooldown 1 s): the second swing plays over that second and a bit, slower.
  assert.ok(startAction(s,bebado,'attack',2000));near(s.end-s.at,1000*SWING_FILL,'fills the second');assert.ok(Math.abs(s.pace!-drawn/(1000*SWING_FILL))<1e-9);
  assert.equal(currentAction(s,3040),'attack','still swinging when the next hit is a bit late');
  // The network brings the next hit a bit early: past SWING_RESTART of the swing it restarts; before, it does not.
  assert.equal(startAction(s,bebado,'attack',2000+1000*SWING_FILL*SWING_RESTART-5),false);
  assert.ok(startAction(s,bebado,'attack',2950),'restarted near its end');
  // Its frames: the column follows the drawn time, so the stretched swing reaches its last frame only at its end.
  assert.equal(onceColumn((s.end-s.at-1)*s.pace!,6,12*ENEMY_ANIM_RATE),5);assert.equal(onceColumn(((s.end-s.at)/2)*s.pace!,6,12*ENEMY_ANIM_RATE),3);
  // A lone swing after a pause (> SWING_FILL_MAX_MS) and a faster-than-drawn repeat keep the drawn length.
  assert.ok(startAction(s,bebado,'attack',2950+SWING_FILL_MAX_MS+1));near(s.end-s.at,drawn,'lone swing');
  const q:ActionState={at:0,end:0};assert.ok(startAction(q,bebado,'attack',0));assert.ok(startAction(q,bebado,'attack',drawn*.85));assert.ok(q.end-q.at>=drawn-1e-6,'never faster than drawn');
  // A hit in between does not count as a swing.
  const h:ActionState={at:0,end:0};assert.ok(startAction(h,bebado,'attack',0));assert.ok(startAction(h,bebado,'hit',900));assert.ok(startAction(h,bebado,'attack',1300));
  near(h.end-h.at,1300*SWING_FILL,'the gap is from the last swing, not the hit');
});


test('phase 2: the still chefe idles with phase2-idle; walking, phase 1 or no such sheet keep today\'s choice',()=>{
  assert.equal(loopAnim(chefe,false,false,2),'phase2-idle');assert.equal(loopAnim(chefe,false,false,3),'phase2-idle');
  assert.equal(loopAnim(chefe,true,false,2),'walk');assert.equal(loopAnim(chefe,false,false,1),'idle');
  assert.equal(loopAnim(chefe,false,false),'idle');assert.equal(loopAnim(bebado,false,false,2),'idle','no phase2-idle sheet');
});

// ---------------------------------------------------------------- Phaser-free mocks of what horde-art touches
interface Mock {[k:string]:unknown;texture:{key:string};frame:number;visible:boolean;alpha:number;x:number;y:number;depth:number;scaleX:number;originX:number;originY:number}
function mockScene(loaded:Set<string>){
  const hooks:(()=>void)[]=[],made:Mock[]=[];
  const scene={textures:{exists:(k:string)=>loaded.has(k)},add:{image:()=>{const o=mockImage(scene);made.push(o);return o;}},
    events:{on:(_:string,f:()=>void)=>hooks.push(f),off(){}},hooks,made};
  return scene;
}
function mockImage(scene:ReturnType<typeof mockScene>):Mock{
  const m:Mock={texture:{key:'horde:enemy:bebado'},frame:0,visible:true,alpha:1,x:0,y:0,depth:0,scaleX:1,originX:.5,originY:.92,scene,
    tintFill:false,tintTopLeft:0,tintTopRight:0,tintBottomLeft:0,tintBottomRight:0};
  const self=(f:(...a:never[])=>void)=>(...a:never[])=>{f(...a);return m;};
  Object.assign(m,{
    setTexture:self(((k:string,f?:number)=>{m.texture={key:k};m.frame=f??0;}) as never),setFrame:self(((f:number)=>{m.frame=f;}) as never),
    setOrigin:self(((x:number,y:number)=>{m.originX=x;m.originY=y;}) as never),setScale:self(((s:number)=>{m.scaleX=s;}) as never),
    setFlipX:self(()=>{}),setRotation:self(()=>{}),setAlpha:self(((a:number)=>{m.alpha=a;}) as never),
    setVisible:self(((v:boolean)=>{m.visible=v;}) as never),setPosition:self(((x:number,y:number)=>{m.x=x;m.y=y;}) as never),
    setDepth:self(((d:number)=>{m.depth=d;}) as never),once:()=>m,
  });
  return m;
}
const keysOf=(piece:ArtPiece,id:string)=>Object.keys(piece.files).map(f=>`art:enemy:${id}:${f}`);

test('applyEnemyArt: the attack plays its 6 frames once over the walk, then the walk comes back; without elite/attack the elite walk layer stays on',()=>{
  useArt();
  const scene=mockScene(new Set(keysOf(bebado,'bebado'))),image=mockImage(scene) as never as Parameters<typeof applyEnemyArt>[0];
  const a={kind:'bebado' as EnemyKind,elite:true,phase:0};
  assert.ok(applyEnemyArt(image,a,true,1,0,0));
  const m=image as never as Mock;
  assert.equal(m.texture.key,'art:enemy:bebado:walk');
  scene.hooks.forEach(h=>h());
  assert.equal(scene.made.length,1,'one elite overlay');const overlay=scene.made[0];
  assert.equal(overlay.visible,true);assert.equal(overlay.texture.key,'art:enemy:bebado:elite/walk');
  assert.ok(playEnemyAction(image,'bebado','attack',1000));
  assert.equal(playEnemyAction(image,'bebado','throw',1000),false,'no throw sheet: the walk goes on');
  const seen:number[]=[],marker:number[]=[];
  for(let f=0;f<6;f++){
    const t=1000+slow(f*1000/12);
    applyEnemyArt(image,a,true,1,0,t);assert.equal(m.texture.key,'art:enemy:bebado:attack');seen.push(m.frame);
    // No elite/attack: the elite marker never blinks off, it shows the elite walk on the attack's column (walk has 8).
    scene.hooks.forEach(h=>h());assert.equal(overlay.visible,true,'no elite/attack: the elite walk layer stays');
    assert.equal(overlay.texture.key,'art:enemy:bebado:elite/walk');marker.push(overlay.frame);
  }
  const row=enemyArtRow(image);
  assert.deepEqual(seen,[0,1,2,3,4,5].map(f=>row*6+f),'each frame once, in order, on the facing row');
  assert.deepEqual(marker,[0,1,2,3,4,5].map(f=>row*8+f),'the elite layer follows the base frame index');
  applyEnemyArt(image,a,true,1,0,1000+slow(500));assert.equal(m.texture.key,'art:enemy:bebado:walk','back to the loop');
  scene.hooks.forEach(h=>h());assert.equal(overlay.visible,true);
  playEnemyAction(image,'bebado','hit',2000);applyEnemyArt(image,a,true,1,0,2000);
  assert.equal(m.texture.key,'art:enemy:bebado:hit');scene.hooks.forEach(h=>h());assert.equal(overlay.visible,true);
  assert.equal(overlay.texture.key,'art:enemy:bebado:elite/walk');assert.equal(overlay.frame,row*8);
  assert.equal(scene.made.length,1,'never a new overlay per frame');
});

test('applyEnemyArt: an action longer than the loop shows the first elite loop frame past its last column',()=>{
  const long:ArtPiece={kind:'animations',files:{walk:sheet('b/walk.webp',4),attack:sheet('b/attack.webp',6,12),'elite/walk':sheet('b/elite-walk.webp',4)}};
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{bebado:long}}}}));
  const scene=mockScene(new Set(keysOf(long,'bebado'))),image=mockImage(scene) as never as Parameters<typeof applyEnemyArt>[0];
  const a={kind:'bebado' as EnemyKind,elite:true,phase:0};
  applyEnemyArt(image,a,true,1,0,0);assert.ok(playEnemyAction(image,'bebado','attack',0));
  const row=enemyArtRow(image),overlay=scene.made[0],frames:number[]=[];
  for(let f=0;f<6;f++){applyEnemyArt(image,a,true,1,0,slow(f*1000/12));scene.hooks.forEach(h=>h());assert.equal(overlay.visible,true);frames.push(overlay.frame);}
  assert.deepEqual(frames,[0,1,2,3,0,0].map(f=>row*4+f));
});

test('applyEnemyArt: a hit sheet that did not load keeps the loop instead of the procedural sprite',()=>{
  useArt();
  const loaded=new Set(keysOf(bebado,'bebado'));loaded.delete('art:enemy:bebado:hit');
  const scene=mockScene(loaded),image=mockImage(scene) as never as Parameters<typeof applyEnemyArt>[0],m=image as never as Mock;
  const a={kind:'bebado' as EnemyKind,elite:false,phase:0};
  assert.ok(playEnemyAction(image,'bebado','hit',0));
  assert.ok(applyEnemyArt(image,a,false,0,0,10));assert.equal(m.texture.key,'art:enemy:bebado:idle');
});

test('applyEnemyArt: the chefe from phase 2 idles with phase2-idle',()=>{
  useArt();
  const scene=mockScene(new Set(keysOf(chefe,'chefe'))),image=mockImage(scene) as never as Parameters<typeof applyEnemyArt>[0],m=image as never as Mock;
  applyEnemyArt(image,{kind:'chefe',elite:false,phase:0,bossPhase:1},false,0,0,0);assert.equal(m.texture.key,'art:enemy:chefe:idle');
  applyEnemyArt(image,{kind:'chefe',elite:false,phase:0,bossPhase:2},false,0,0,0);assert.equal(m.texture.key,'art:enemy:chefe:phase2-idle');
  applyEnemyArt(image,{kind:'chefe',elite:false,phase:0,bossPhase:2},true,1,0,0);assert.equal(m.texture.key,'art:enemy:chefe:walk');
  assert.ok(playEnemyAction(image,'chefe','slam',100));
  applyEnemyArt(image,{kind:'chefe',elite:false,phase:0,bossPhase:2},false,0,0,150);assert.equal(m.texture.key,'art:enemy:chefe:slam');
});

// ---------------------------------------------------------------- 3. death actor
test('death: plays once on the pooled death actor, holds, fades and is released; no art = today\'s puff',()=>{
  assert.equal(hasDeathArt({exists:()=>true},'bebado'),false,'empty manifest: the puff and stars stay');
  useArt();
  const loaded=new Set(keysOf(bebado,'bebado')),textures={exists:(k:string)=>loaded.has(k)};
  assert.ok(hasDeathArt(textures,'bebado'));assert.equal(hasDeathArt(textures,'chefe'),false,'no chefe death sheet');
  assert.equal(hasDeathArt({exists:()=>false},'bebado'),false,'not loaded');
  const scene=mockScene(loaded),drawn=mockImage(scene) as never as Parameters<typeof applyEnemyArt>[0];
  assert.equal(hasDeathArt(textures,'bebado',mockImage(scene)),false,'an actor that never showed the art keeps the puff');
  applyEnemyArt(drawn,{kind:'bebado',elite:false,phase:0},true,-1,0,0);
  assert.ok(hasDeathArt(textures,'bebado',drawn));
  const duration=actionDuration(10,10);assert.equal(duration,1000);
  assert.equal(deathAlpha(500,duration),1);assert.ok(deathAlpha(duration+DEATH_FADE_MS/2,duration)>0);assert.ok(deathAlpha(duration+DEATH_FADE_MS,duration)<=0);
  const ring=new Ring(()=>({image:mockImage(scene),top:mockImage(scene),born:0}),(o,active)=>{if(!active)o.image.visible=false;},4);
  const d=ring.spawn();d.born=0;
  const row=enemyArtRow(drawn),frames:number[]=[];
  let now=0;const step=(t:number)=>{now=t;ring.retain(o=>drawDeathArt(o.image as never,o.top as never,'bebado',false,row,now-o.born));};
  for(let f=0;f<10;f++){step(slow(f*100));frames.push((d.image as Mock).frame);}
  assert.deepEqual(frames,[0,1,2,3,4,5,6,7,8,9].map(f=>row*10+f),'every death frame once');
  assert.equal((d.image as Mock).texture.key,'art:enemy:bebado:death');
  step(slow(1100));assert.equal(ring.active,1);assert.equal((d.image as Mock).frame,row*10+9,'holds the last frame');assert.ok((d.image as Mock).alpha<1);
  assert.equal((d.top as Mock).visible,false,'no elite/death: the overlay stays hidden');
  step(slow(1000)+DEATH_FADE_MS);assert.equal(ring.active,0,'released');assert.equal(ring.created,1);
  const again=ring.spawn();assert.equal(again,d,'the next death reuses the pooled actor');assert.equal(ring.created,1);
});

// ---------------------------------------------------------------- 4. projectiles
test('projectile keys: own art → art:proj:<id> (animated), tiro-aliado → today\'s friendly key, none → today\'s key',()=>{
  // Empty manifest: no look at all, so layers.ts keeps keys.ts projectileTexture exactly.
  for(const source of ['pombo','boleto','cafe-evo','audio'])assert.equal(projectileLook(false,source),undefined,source);
  assert.equal(projectileLook(true,'boleto-juros'),undefined);
  assert.equal(projectileTexture(false,'pombo'),FX.projFriendly);assert.equal(projectileTexture(true,'boleto-juros'),FX.projBoleto);
  useArt({pombo:strip('pombo.webp',8),'boleto-juros':strip('boleto-juros.webp',8,48),'garrafa-molotov':strip('garrafa-molotov.webp',8),'tiro-aliado':strip('tiro-aliado.webp',4,32)});
  assert.deepEqual({...projectileLook(false,'pombo')},{key:'art:proj:pombo',frames:8,fps:8});
  assert.equal(projectileLook(false,'pombo'),projectileLook(false,'pombo'),'cached: no allocation per push');
  assert.deepEqual({...projectileLook(false,'cafe')},{key:FX.projFriendly,frames:4,fps:8},'no own art: the shared tiro-aliado');
  assert.equal(projectileLook(true,'boleto-juros')?.key,'art:proj:boleto-juros');
  assert.equal(projectileLook(true,'molotov')?.key,'art:proj:garrafa-molotov','alias');
  assert.equal(projectileLook(true,'star'),undefined,'an unknown hostile shot keeps the star');
  assert.equal(projectileLook(false,'__proto__')?.key,FX.projFriendly);
  assert.equal(projectileFrame({frames:8,fps:8},0),0);assert.equal(projectileFrame({frames:8,fps:8},1000),0);assert.equal(projectileFrame({frames:8,fps:8},625),5);
  assert.equal(projectileFrame({frames:1,fps:8},625),0);
  // Frames are played only when the texture under the key has them (frameTotal counts __BASE): a failed load leaves
  // today's procedural tiro-aliado (one frame) under FX.projFriendly, which must never be stepped.
  const tex=(total:Record<string,number>)=>({exists:(k:string)=>k in total,get:(k:string)=>({frameTotal:total[k]})});
  const pombo=projectileLook(false,'pombo')!,friendly=projectileLook(false,'cafe')!;
  assert.equal(projectileFrames(tex({'art:proj:pombo':9}),pombo),8);
  assert.equal(projectileFrames(tex({'art:proj:pombo':5}),pombo),4,'fewer frames in the texture: only those');
  assert.equal(projectileFrames(tex({[FX.projFriendly]:1}),friendly),1,'procedural texture: still');
  assert.equal(projectileFrames(tex({}),pombo),1);
  const loads=new Map(artLoads().map(l=>[l.key,l]));
  assert.equal(loads.get('art:proj:pombo')?.url,'/art/projectiles/pombo.webp');assert.deepEqual(loads.get('art:proj:pombo')?.cell,[64,64]);
  assert.equal(loads.get('art:proj:boleto-juros')?.url,'/art/projectiles/boleto-juros.webp');
  assert.ok(loads.has('art:proj:garrafa-molotov'));assert.ok(!loads.has('art:proj:cafe'));assert.ok(!loads.has('art:proj:tiro-aliado'));
  assert.equal(loads.get(FX.projFriendly)?.url,'/art/projectiles/tiro-aliado.webp');assert.ok(!loads.has(FX.projBoleto));
});

test('empty manifest: nothing loads, no action starts, no death art, no projectile look (today\'s keys)',()=>{
  setArtIndex(parseArtIndex(EMPTY));
  assert.deepEqual(artLoads(),[]);assert.equal(enemyArtActive(),false);
  assert.equal(playEnemyAction({},'bebado','attack',0),false);
  assert.equal(hasDeathArt({exists:()=>true},'chefe'),false);
  assert.ok(STATIC_ART.every(s=>s.key!==FX.projBoleto));
  useArt();assert.ok(enemyArtActive());
});
