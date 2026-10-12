/** Stonewards HUD and renderer rules (VGM-046B): what the forge allows, what is missing, the wall bar, gather pops. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {blockedReason,inCamp,missing,MAX_TOWERS} from '../src/game/hud/camp.ts';
import {LESSONS} from '../src/game/hud/coach.ts';
import {gatheredSince,wallBar,WALL_LOW} from '../src/game/render/stonewards-rules.ts';
import {CAMP_RADIUS,FORGE_REFUSALS,RECIPE_IDS,RECIPES,returnTicks,nodeValue} from '../src/game/sim/stonewards/rules.ts';
import {MAX_TOWERS as SERVER_MAX_TOWERS} from '../src/game/sim/stonewards/forge.ts';
import type {NodeView,RunView} from '../src/game/sim/view.ts';
import {fakeView} from '../src/game/hud/fixtures.ts';

const view=(camp:RunView['camp'],extra:Partial<RunView>={})=>({...fakeView('camp-forge',1),camp,...extra});

test('the forge tags: buyable, short of money, wall full, towers full, no weapon, wall down',()=>{
  const rich={coco:20,pedra:20};
  for(const id of RECIPE_IDS)assert.equal(blockedReason(id,view(rich),'p1'),undefined,id);
  assert.equal(blockedReason('torre-chinelo',view({coco:3,pedra:3}),'p1'),'balance');
  assert.equal(missing({coco:3,pedra:3},'torre-chinelo'),'Falta 1 pedra.');
  assert.equal(missing({coco:0,pedra:0},'gambiarra'),'Falta 4 coco e 2 pedra.');
  const v=view(rich);
  assert.equal(blockedReason('reparo',{...v,structures:v.structures.map(s=>({...s,hp:s.maxHp}))},'p1'),'full');
  const towers=Array.from({length:MAX_TOWERS},(_,i)=>({id:`t${i}`,kind:'torre-chinelo',x:0,y:0,hp:80,maxHp:80}));
  assert.equal(blockedReason('torre-chinelo',{...v,structures:[...v.structures,...towers]},'p1'),'full');
  assert.equal(MAX_TOWERS,SERVER_MAX_TOWERS,'the HUD and the forge agree');
  const maxed={...v,players:v.players.map(p=>({...p,weapons:[{id:'chinelo',level:8},{id:'boleto-evo',level:1}]}))};
  assert.equal(blockedReason('gambiarra',maxed,'p1'),'no-weapon');
  assert.equal(blockedReason('reparo',view({...rich,wallDown:true}),'p1'),'wall-down');
  for(const reason of ['phase','player','recipe','balance','full','no-weapon','duplicate','wall-down','away'])assert.ok(FORGE_REFUSALS[reason],reason);
  for(const r of Object.values(RECIPES))assert.ok(r.cost.coco>0&&r.cost.pedra>0&&r.name&&r.describe.length<=40);
});

test('in the camp means within CAMP_RADIUS of the wall',()=>{
  const wall={id:'s1',kind:'muralha',x:0,y:0,hp:1,maxHp:1};
  assert.equal(inCamp({x:0,y:CAMP_RADIUS},wall),true);assert.equal(inCamp({x:0,y:CAMP_RADIUS+.01},wall),false);
  assert.equal(inCamp(undefined,wall),false);assert.equal(inCamp({x:0,y:0},undefined),false);
});

test('the wall bar turns low under 30%, and a gathered unit pops its value',()=>{
  assert.deepEqual(wallBar(600,600),{fraction:1,low:false});
  assert.deepEqual(wallBar(150,600),{fraction:.25,low:true});
  assert.deepEqual(wallBar(0,600),{fraction:0,low:false},'down is not "low"');
  assert.deepEqual(wallBar(Number.NaN,600),{fraction:0,low:false});
  assert.ok(WALL_LOW===.3);
  const n=(id:string,remaining:number,value=2):NodeView=>({id,kind:'coco',x:0,y:0,remaining,capacity:4,value,progress:0});
  const before=new Map([['n1',n('n1',4)],['n2',n('n2',2)]]);
  assert.deepEqual(gatheredSince(before,[n('n1',3),n('n2',2),n('n3',1)]).map(g=>[g.node.id,g.amount]),[['n1',2]]);
});

test('return time and node value bands (base-stonewards-mapa)',()=>{
  assert.equal(returnTicks(CAMP_RADIUS),0);assert.equal(returnTicks(3),0);
  // 150 units out: 144 to the camp's edge at 3.1 u/s × 1.1 + 2 s ≈ 53.1 s.
  assert.equal(returnTicks(150),Math.ceil((144/3.1*1.1+2)*20));
  assert.equal(returnTicks(Number.NaN),0);
  assert.ok([10,20,40,80].map(nodeValue).every((v,i,a)=>i===0||v>=a[i-1]));
});

test('the gathering tip lives in the first-run coach now (VGM-056: tests/coach.test.ts covers once per phone and storage)',()=>{
  const tip=LESSONS.gather.text;
  assert.ok(tip.length<=48&&!/[A-Z]{2}/.test(tip));
  assert.equal(LESSONS.gather.icon,'coco');
});
