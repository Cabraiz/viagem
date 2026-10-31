// NEW-20261031-ORQ-construir-andando-ate-a-obra: the kit's release walks the hero to the obra; the order goes only on arrival.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BuildWalk,STAND_GAP,standPoint,type BuildOrder} from '../../src/client/hud/kit-place/walk.ts';
import {KitPlace} from '../../src/client/hud/kit-place/model.ts';
import {cellRect,distToRect} from '../../src/client/render/fortify-rules.ts';
import {BUILD_REACH} from '../../src/sim/towers/system.ts';
import {PIECE_OBRA_MS,PieceObras,buildFacing} from '../../src/client/sprites/build-facing.ts';

const CELL=.88;
type P={x:number;y:number};
/** A scene stub: goTo walks the hero straight to the target over `frames` ticks; stick() drops the route. */
function stubScene(hero:P,{frames=5,reachable=true}={}){
  let target:P|undefined,left=0;
  const goals:P[]=[];
  return {goals,hero,
    goTo(t:P){goals.push(t);if(reachable){target=t;left=frames;}},
    get walking(){return !!target;},
    step(){if(!target)return;left--;hero.x+=(target.x-hero.x)/(left+1);hero.y+=(target.y-hero.y)/(left+1);if(left<=0)target=undefined;},
    stick(){target=undefined;}};
}
function orderAt(c:number,r:number):BuildOrder{
  const rect=cellRect(c,r,2,1,CELL);
  return {cell:{c,r},rot:0,rect,ghost:{piece:'barricada',c,r,w:2,h:1,look:'ok'}};
}

test('standPoint: on the nearest side, STAND_GAP off the edge; out through the nearest side when inside; skips bad ground',()=>{
  const rect=cellRect(10,10,2,1,CELL);
  const left=standPoint(rect,{x:0,y:rect.cy})!;
  assert.ok(Math.abs(left.x-(rect.x0-STAND_GAP))<1e-9&&Math.abs(left.y-rect.cy)<1e-9,'the west side, level with the hero');
  assert.ok(distToRect(left.x,left.y,rect)<BUILD_REACH,'well inside the reach');
  const inside=standPoint(rect,{x:rect.cx,y:rect.y0+.05})!;
  assert.ok(Math.abs(inside.y-(rect.y0-STAND_GAP))<1e-9,'standing on it: out through the top');
  const ok=(p:P)=>p.x>rect.x1; // only the east side is ground
  const east=standPoint(rect,{x:0,y:rect.cy},ok)!;
  assert.ok(east.x>rect.x1&&distToRect(east.x,east.y,rect)<BUILD_REACH,'the nearest standable side');
  assert.equal(standPoint(rect,{x:0,y:0},()=>false),undefined,'nowhere to stand');
});

test('in reach: the order goes at once, the hero does not move',()=>{
  const o=orderAt(10,10),hero={x:o.rect.x0-1,y:o.rect.cy},s=stubScene(hero),w=new BuildWalk();
  assert.equal(w.begin(o,hero,s),'now');
  assert.equal(s.goals.length,0);assert.equal(w.pending,false);
});

test('from afar: the hero walks to the stand, nothing is sent on the way, the frozen order comes on arrival',()=>{
  const o=orderAt(30,10),hero={x:2,y:o.rect.cy},s=stubScene(hero),w=new BuildWalk();
  assert.equal(w.begin(o,hero,s),'walk');
  assert.equal(s.goals.length,1);assert.equal(w.order,o,'the ghost stays on the order');
  for(let i=0;i<4;i++){s.step();assert.equal(w.tick(hero,s),undefined,`frame ${i}: still walking, no order`);}
  s.step();
  const got=w.tick(hero,s);
  assert.equal(got,o,'arrived: the order');
  assert.ok(distToRect(hero.x,hero.y,o.rect)<=BUILD_REACH,'the room will take it (BUILD_REACH)');
  assert.equal(w.pending,false);assert.equal(w.tick(hero,s),undefined,'sent once');
});

test('the stick drops the walk on the way: cancelled, nothing sent; a kit mode ending cancels too',()=>{
  const o=orderAt(30,10),hero={x:2,y:o.rect.cy},s=stubScene(hero,{frames:10}),w=new BuildWalk();
  w.begin(o,hero,s);s.step();s.step();s.stick();
  assert.equal(w.tick(hero,s),'cancelled');assert.equal(w.pending,false);
  w.begin(o,hero,s);w.cancel();s.stick();
  assert.equal(w.tick(hero,s),undefined,'the host cancelled it: nothing comes later');
});

test('no route there: blocked, nothing pending',()=>{
  const o=orderAt(30,10),hero={x:2,y:o.rect.cy},s=stubScene(hero,{reachable:false}),w=new BuildWalk();
  assert.equal(w.begin(o,hero,s),'blocked');assert.equal(w.pending,false);
});

test('the host: KitPlace.order freezes the release, aim brings confirm back to it after the mouse moved',()=>{
  const k=new KitPlace(()=>0),sent:unknown[][]=[];
  const net={place:(...a:unknown[])=>{sent.push(a);return sent.length;}};
  k.start(0,'kit:barricada');k.press({x:30,y:30},CELL);k.release();
  const o=k.order(CELL)!;
  assert.equal(o.ghost.look,'ok');assert.deepEqual([o.rect.w,o.rect.h],[2,1]);
  k.move({x:5,y:5},CELL);
  k.aim(o);k.confirm(net);
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].slice(2,4),[o.cell.c,o.cell.r],'the frozen cell, not the hovered one');
});

test('PieceObras: a wall going up is an obra for one build16 loop, then not; gone pieces are forgotten',()=>{
  const p=new PieceObras(),wall={id:'b1',kind:'barricada',phase:'obra-1',c:10,r:10,rot:0};
  const at0=p.spots([wall],CELL,0);
  assert.equal(at0.length,1);
  assert.deepEqual(at0[0].half,[CELL,CELL/2],'the 2×1 footprint');
  assert.ok(buildFacing({x:at0[0].x-CELL-1,y:at0[0].y},at0),'a hero 1 u off its edge faces it');
  const done={...wall,phase:'pronta'};
  assert.equal(p.spots([done],CELL,PIECE_OBRA_MS-1).length,1,'finished early: kept to the end of the loop');
  assert.equal(p.spots([done],CELL,PIECE_OBRA_MS).length,0,'the loop played: no more');
  assert.equal(p.spots([{id:'t',kind:'vigia-do-predio',phase:'obra-1',c:1,r:1}],CELL,0).length,0,'towers come from TowerFeed');
  assert.equal(p.spots([{...wall,id:'b2',phase:'pronta'}],CELL,0).length,0,'a wall first seen standing never was an obra here');
});
