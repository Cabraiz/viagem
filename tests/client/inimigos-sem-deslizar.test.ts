// Card NEW-20261022-ORQ-monstros-sem-deslizar: the enemies' walk follows the ground they cover (not the clock), and an
// enemy near its player, or swinging at it, faces it; a contact hit always comes with a swing.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setArtIndex,parseArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {ENEMY_STRIDE_DEFAULT,ENEMY_STRIDE_MIN,ENEMY_WALK,ENEMY_WALK_CADENCE,ENEMY_WALK_MAX_CPS,FACE_ACTING,FACE_NEAR,applyEnemyArt,enemyDrawScale,enemyStride,
  enemyWalkCycles,facingRow,pieceAction,playEnemyAction,targetRow} from '../../src/client/art/horde-art.ts';
import {ENEMY_STRIDES} from '../../src/client/art/enemy-strides.ts';
import {CONTACT_REACH,eventAction,type ActionActor,type ActionWorld} from '../../src/client/art/horde-actions.ts';
import type {EnemyKind} from '../../src/client/render/keys.ts';

afterEach(()=>{setArtIndex(parseArtIndex({version:2,groups:{}}));ENEMY_WALK.byGround=true;});

const sheet=(file:string,frames:number,fps=10)=>({file,cell:[128,128] as [number,number],frames,directions:8,anchor:[.5,.88] as [number,number],fps});
const bebado:ArtPiece={kind:'animations',files:{idle:sheet('bebado/idle.webp',6,6),walk:sheet('bebado/walk.webp',8),attack:sheet('bebado/attack.webp',6,12)}};
/** A walker without an idle loop (rato-de-boteco, boleto-vivo…): standing still it shows its walk. */
const rato:ArtPiece={kind:'animations',files:{walk:sheet('rato/walk.webp',6)}};
function useArt(){setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{bebado,'rato-de-boteco':rato}}}}));}

interface Mock {[k:string]:unknown;texture:{key:string};frame:number}
function mockImage():Mock{
  const scene={textures:{exists:()=>true},add:{image:()=>mockImage()},events:{on(){},off(){}}};
  const m:Mock={texture:{key:'horde:enemy:bebado'},frame:0,visible:true,alpha:1,x:0,y:0,depth:0,scaleX:1,scaleY:1,originX:.5,originY:.92,scene,
    tintFill:false,tintTopLeft:0,tintTopRight:0,tintBottomLeft:0,tintBottomRight:0};
  const self=(f:(...a:never[])=>void)=>(...a:never[])=>{f(...a);return m;};
  Object.assign(m,{
    setTexture:self(((k:string,f?:number)=>{m.texture={key:k};m.frame=f??0;}) as never),setFrame:self(((f:number)=>{m.frame=f;}) as never),
    setOrigin:self(()=>{}),setScale:self(()=>{}),setFlipX:self(()=>{}),setRotation:self(()=>{}),setAlpha:self(()=>{}),setVisible:self(()=>{}),
    setPosition:self(()=>{}),setDepth:self(()=>{}),once:()=>m,
  });
  return m;
}
type Img=Parameters<typeof applyEnemyArt>[0];
/** Screen px a world step (s, −s) covers: straight across the screen at view 0 (sprite-motion screenMotion). */
const ACROSS=84;
/** The bêbado's figure on screen when its drawn height is not measured (node has no canvas): today's height. */
const figure=(kind:EnemyKind,piece:ArtPiece)=>enemyDrawScale(kind,piece.files.walk)*128*.88;
const col=(m:Mock)=>m.frame%8;

test('the walk follows the ground: still holds its frame, the clock alone never steps, a cycle every 1/ENEMY_WALK_CADENCE visible steps',()=>{
  useArt();
  const m=mockImage(),img=m as never as Img,a={kind:'bebado' as EnemyKind,elite:false,phase:0,x:10,y:10};
  applyEnemyArt(img,a,true,1,-1,0);
  assert.equal(m.texture.key,'art:enemy:bebado:walk');
  const start=col(m);
  // Walking, but not moving an inch (a crowd holding it, a reconcile nudge): 3 s and the legs do not tread.
  for(let t=16;t<=3000;t+=16){applyEnemyArt(img,a,true,1,-1,t);assert.equal(col(m),start,'no ground walked, no step');}
  // A cycle of ground (stride × figure on screen ÷ the cadence: two visible steps), in 60 small steps: exactly one
  // cycle, every frame shown.
  const L=enemyStride('bebado')*figure('bebado',bebado)/ENEMY_WALK_CADENCE,seen=new Set<number>();
  for(let i=1;i<=60;i++){a.x+=L*1.0001/ACROSS/60;a.y-=L*1.0001/ACROSS/60;applyEnemyArt(img,a,true,1,-1,3000+i*100);seen.add(col(m));}
  assert.equal(seen.size,8,'the whole cycle shows');
  assert.equal(col(m),start,'a cycle of ground walked = one cycle');
  // Twice as fast or twice as slow (per frame), the same ground gives the same frame: the clock has no say.
  const frameAfter=(steps:number,dt:number)=>{const n=mockImage(),b={...a,x:10,y:10};applyEnemyArt(n as never as Img,b,true,1,-1,0);
    for(let i=1;i<=steps;i++){b.x+=L*.37/ACROSS/steps;b.y-=L*.37/ACROSS/steps;applyEnemyArt(n as never as Img,b,true,1,-1,i*dt);}return col(n);};
  assert.equal(frameAfter(20,50),frameAfter(40,25));
});

test('a walker without an idle loop stands still on one frame instead of treading in place (rato-de-boteco in the air: 1.2 cycles/s at 0 px/s)',()=>{
  useArt();
  const m=mockImage(),img=m as never as Img,a={kind:'pombos' as EnemyKind,art:'rato-de-boteco',elite:false,phase:.4,x:3,y:3};
  const frames=new Set<number>();
  for(let t=0;t<=4000;t+=16){applyEnemyArt(img,a,false,0,0,t);frames.add(m.frame);}
  assert.equal(m.texture.key,'art:enemy:rato-de-boteco:walk');
  assert.equal(frames.size,1);
  // The before/after switch of the sandbox brings back the clock (and its treading).
  ENEMY_WALK.byGround=false;const n=mockImage(),seen=new Set<number>();
  for(let t=0;t<=4000;t+=16){applyEnemyArt(n as never as Img,{...a},false,0,0,t);seen.add(n.frame);}
  assert.ok(seen.size>1);
});

test('cadence: half a cycle per visible step walked (inimigos-animacao-2x-lenta), capped at ENEMY_WALK_MAX_CPS; nothing on a teleport',()=>{
  const fig=90,s=.5,px=s*fig;
  assert.equal(ENEMY_WALK_CADENCE,.5,'2x slower than one cycle per visible step');
  assert.ok(Math.abs(enemyWalkCycles(px/ACROSS,-px/ACROSS,0,fig,s,1000)-ENEMY_WALK_CADENCE)<1e-9);
  // Down the screen the same ground on screen counts the same (screen distance, foreshortening included).
  assert.ok(Math.abs(enemyWalkCycles(px/42,px/42,0,fig,s,1000)-ENEMY_WALK_CADENCE)<1e-9);
  assert.equal(enemyWalkCycles(2,-2,0,fig,s,1000),ENEMY_WALK_MAX_CPS,'a shove is not a sprint (1.9 cycles of ground in 1 s)');
  assert.equal(ENEMY_WALK_MAX_CPS,1.5,'the cap halved with the cadence');
  assert.equal(enemyWalkCycles(4,0,0,fig,s,16),0,'teleport');
  assert.equal(enemyWalkCycles(px/ACROSS,-px/ACROSS,0,fig,s,0),0,'no time, no step');
});

test('every walk sheet in the manifest has its visible step in the table (rerun scripts/passada-inimigos.mjs --ts after new art)',()=>{
  const pieces=JSON.parse(fs.readFileSync('public/art/manifest.json','utf8')).groups.inimigos.pieces as Record<string,ArtPiece>;
  const walkers=Object.entries(pieces).filter(([,p])=>p.files.walk).map(([id])=>id);
  assert.ok(walkers.length>100);
  for(const id of walkers){assert.ok(Object.hasOwn(ENEMY_STRIDES,id),`${id}: no stride`);assert.ok(enemyStride(id)>=ENEMY_STRIDE_MIN);}
  assert.deepEqual(Object.keys(ENEMY_STRIDES).filter(id=>!walkers.includes(id)),[],'no stride of a sheet that is gone');
  // A sample of the cast: one stride on screen is half a cycle (the legs keep pace with the ground they cover).
  for(const id of ['bebado','tio-pave','agiota','rato-de-boteco','camelo-pirata','coach']){
    const fig=86,px=enemyStride(id)*fig;
    assert.ok(Math.abs(enemyWalkCycles(px/ACROSS,-px/ACROSS,0,fig,enemyStride(id),2000)-ENEMY_WALK_CADENCE)<1e-9,id);
  }
  assert.equal(enemyStride('peca-que-nao-existe'),ENEMY_STRIDE_DEFAULT);
});

/** Angle (deg) on the ground plane of an 8-direction row (0 = S, clockwise), and of a world direction seen through view `v`. */
const rowAngle=(r:number)=>r*45;
function groundAngle(dx:number,dy:number,v:number){
  const rx=v===1?-dy:v===2?-dx:v===3?dy:dx,ry=v===1?dx:v===2?-dy:v===3?-dx:dy,gx=rx-ry,gy=rx+ry;
  let a=Math.atan2(-gx,gy)*180/Math.PI;if(a<0)a+=360;return a;
}
test('an enemy swinging at its player, or right next to it, faces it (≤ 45°), whatever row it walked in with',()=>{
  for(let v=0;v<4;v++)for(let k=0;k<72;k++)for(const prev of [0,3,4,6]){
    const a=k*5*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a);
    for(const [d,acting] of [[FACE_NEAR*.9,false],[FACE_ACTING*.9,true]] as const){
      const row=targetRow(0,0,{x:dx*d,y:dy*d},acting,v,prev);
      let diff=Math.abs(rowAngle(row)-groundAngle(dx,dy,v))%360;if(diff>180)diff=360-diff;
      assert.ok(diff<=45,`view ${v} ${k*5}° prev ${prev}: row ${row} is ${diff.toFixed(0)}° off`);
    }
  }
  // Far from it, and not swinging, it keeps the row of its own steps.
  assert.equal(targetRow(0,0,{x:FACE_NEAR*1.5,y:0},false,0,4),4);
  assert.equal(targetRow(0,0,{x:FACE_ACTING*1.2,y:0},true,0,4),4);
  assert.equal(targetRow(0,0,undefined,true,0,4),4);
});

test('applyEnemyArt: an attack plays on the row towards the player, not on the back it walked in with',()=>{
  useArt();
  const m=mockImage(),img=m as never as Img,a={kind:'bebado' as EnemyKind,elite:false,phase:0,x:0,y:0};
  // It walked away from the hero (a shove of the crowd), the hero behind it, at (−1, 0).
  for(let t=0;t<200;t+=16){a.x+=.01;applyEnemyArt(img,a,true,.01,0,t);}
  const hero={x:a.x-1,y:a.y},away=Math.floor(m.frame/8);
  assert.ok(playEnemyAction(img,'bebado','attack',300));
  applyEnemyArt(img,a,false,0,0,316,0,1,undefined,hero);
  assert.equal(m.texture.key,'art:enemy:bebado:attack');
  const facing=Math.floor(m.frame/6);
  assert.equal(facing,facingRow(-1,0,0,-1));assert.notEqual(facing,away);
});

test('a contact hit from any enemy is a swing (attack) within reach; a shot from afar is not',()=>{
  const actors:ActionActor[]=[{id:'b1',kind:'bebado',nx:0,ny:0},{id:'a1',kind:'agiota',nx:5,ny:0},{id:'t1',kind:'tio-pave',nx:9,ny:9}];
  const w:ActionWorld={enemy:id=>actors.find(a=>a.id===id),nearest:()=>undefined,telegraph:()=>undefined,player:id=>id==='hero'?{x:1,y:0}:undefined};
  const cue=(source:string,target='hero')=>{const c=eventAction({type:'damage',target,amount:4,source},w,{enemy:'',action:'hit'});return c&&`${c.enemy}:${c.action}`;};
  assert.equal(cue('b1'),'b1:attack');
  assert.equal(cue('a1'),undefined,`the boleto from ${5-1} u (> ${CONTACT_REACH}): its throw played on the shot`);
  assert.equal(cue('t1'),'t1:shove','the Tio shoves, near or not');
  assert.equal(cue('b1','ghost'),undefined,'a player the renderer does not know: no guess');
});

test('every walking enemy of the manifest has a sheet to swing with on a contact hit',()=>{
  const pieces=JSON.parse(fs.readFileSync('public/art/manifest.json','utf8')).groups.inimigos.pieces as Record<string,ArtPiece>;
  const none=Object.entries(pieces).filter(([,p])=>p.files.walk&&!pieceAction(p,'attack')).map(([id])=>id);
  assert.deepEqual(none,[]);
});
