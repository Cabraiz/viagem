// D-052 slice 3 (HUD): the Puxar button, the free build's ghost and requests, and the wall counter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR_PULL_REACH,CAR_RADIUS} from '../../src/contract/index.ts';
import {CITY_BUILD_CELL} from '../../src/maps/build-sites.ts';
import {FORT_PENDING_MS,FortBuild,ROOT_PIECE,WALL_LIMIT,fortCounts,fortRefusalText,pullRefusalText,pullState,wallCounterText} from '../../src/client/hud/fortify/model.ts';

const cell=CITY_BUILD_CELL;
const car={x:10,y:10};

test('Puxar shows within the pull reach of the car body, Soltar while on the rope', ()=>{
  assert.equal(pullState(undefined,'a',{x:0,y:0}).show,false);
  const edge=CAR_RADIUS+CAR_PULL_REACH;
  assert.deepEqual(pullState(car,'a',{x:10+edge-.01,y:10}),{show:true,on:false,label:'Puxar',pushing:false});
  assert.equal(pullState(car,'a',{x:10+edge+.1,y:10}).show,false);
  // On the rope it stays (the rope is 3 u: the hero may be past the reach) and says Soltar.
  assert.deepEqual(pullState({...car,rope:'a',movers:['a']},'a',{x:20,y:10}),{show:true,on:true,label:'Soltar',pushing:false});
  // Someone else's rope: this player may still be pushing.
  assert.equal(pullState({...car,rope:'b',movers:['a','b']},'a',{x:11,y:10}).pushing,true);
});

test('the wall counter counts free walls and barricades standing', ()=>{
  const s=[{id:'m1',kind:'muro',x:0,y:0,hp:10},{id:'m2',kind:'muro',x:0,y:0,hp:0},{id:'b1',kind:'barricada',x:0,y:0,hp:5,c:1,r:1},
    {id:'b2',kind:'barricada',x:0,y:0,hp:5}];
  assert.deepEqual(fortCounts(s),{walls:1,barricades:1});
  assert.equal(wallCounterText(3),`Muros 3/${WALL_LIMIT}`);
});

test('the ghost follows the pointer on the grid and turns red near the car', ()=>{
  const b=new FortBuild(()=>0);
  assert.equal(b.ghost({cell,structures:[]}),null);
  b.toggle(true);b.pick('muro');b.point({x:20,y:20},cell);
  const g=b.ghost({cell,car,structures:[]});
  assert.ok(g);assert.equal(g.piece,'muro');assert.equal(g.look,'ok');
  b.point(car,cell);
  assert.equal(b.ghost({cell,car,structures:[]})?.look,'bloqueado');
  // The barricade turns: rot 1 is sent, rot 0 is left out.
  b.pick('barricada');b.turn();b.point({x:20,y:20},cell);
  assert.equal(b.ghost({cell,structures:[]})?.rot,1);
  b.toggle(false);
  assert.equal(b.ghost({cell,structures:[]}),null);
});

test('confirm sends one build per cell, the room answer paints the ghost', ()=>{
  let t=0;const sent:unknown[]=[];let req=100;
  const net={buildAt:(piece:string,c:number,r:number,rot?:number)=>{sent.push({piece,c,r,rot});return ++req;}};
  const b=new FortBuild(()=>t);
  assert.equal(b.confirm(net),'none');
  b.toggle(true);b.point({x:20,y:20},cell);
  assert.equal(b.confirm(net),'sent');
  assert.equal(b.confirm(net),'pending');
  assert.equal(sent.length,1);
  assert.equal((sent[0] as {piece:string}).piece,ROOT_PIECE);
  assert.equal((sent[0] as {rot?:number}).rot,undefined);
  assert.equal(b.owns(101),true);
  assert.equal(b.answer({req:101,ok:false,reason:'tranca'}),'Isso tranca o chaveiro, chefe');
  assert.equal(b.owns(101),false);
  // 'tranca' needs the sim's flow field: the local check said ok, the room's answer wins.
  assert.equal(b.ghost({cell,structures:[]})?.look,'bloqueado');
  assert.equal(b.answer({req:999,ok:false}),undefined);
  // Pending expires.
  assert.equal(b.confirm(net),'sent');t+=FORT_PENDING_MS;
  assert.equal(b.confirm(net),'sent');
  assert.equal(b.confirm({buildAt:()=>undefined}),'pending');
});

test('a dragged wall sends each new cell once', ()=>{
  let req=0;const cells:string[]=[];
  const net={buildAt:(_p:string,c:number,r:number)=>{cells.push(`${c},${r}`);return ++req;}};
  const b=new FortBuild(()=>0);b.toggle(true);b.pick('muro');
  for(const x of [20,20.1,20+cell,20+cell*1.1,20+cell*2]){b.point({x,y:20},cell);b.drag(net);}
  assert.equal(cells.length,3);
  b.endDrag();b.point({x:20,y:20},cell);
  assert.equal(b.drag(net),'pending'); // the first cell still waits for its answer
});

test('refusal words, with a fallback', ()=>{
  assert.equal(fortRefusalText('limite'),'Chegou no limite');
  assert.equal(fortRefusalText('xyz'),'Agora não dá');
  assert.equal(pullRefusalText('ocupado'),'Já tem gente na corda');
  assert.equal(pullRefusalText(undefined),'Agora não dá');
});
