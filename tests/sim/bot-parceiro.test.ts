// NEW-20261028-ORQ-bot-parceiro-e-bichos-parados, item 1 (the playtest's item 6: the person alone, away from the Uno,
// while the bots loot): the partner (BrainInput.partner) loots only within PARTNER_LOOT u of its person and otherwise
// walks to them, in a lull or in a wave; the other bots keep looting as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR_ID} from '../../src/contract/index.ts';
import {ESCORT_LEASH,PARTNER_LOOT,decide,newMemory} from '../../src/sim/bot-brain.ts';
import type {RunView} from '../../src/contract/view.ts';

const me={id:'b',name:'B',classId:'x',hp:100,maxHp:100,online:true,spectator:false,downed:false,eliminated:false,weapons:[{id:'faca',level:1}],passives:[],x:12,y:0,skillReadyTick:0};
const view=(enemies:{x:number;y:number}[]=[],phase:'wave'|'prepare'='wave'):RunView=>({tick:1000,team:{xp:0,level:1,nextXp:5},
  round:{index:1,total:10,phase,phaseEndsTick:1e9,remaining:1},
  enemies:enemies.map((e,i)=>({id:`e${i}`,kind:'bebado',x:e.x,y:e.y,hp:10,maxHp:10})),
  pickups:[{id:'bau-1',kind:'chest',value:2,x:13,y:0}],projectiles:[],telegraphs:[],
  structures:[{id:CAR_ID,kind:CAR_ID,x:0,y:0,hp:120,maxHp:120}],players:[me],offers:[],events:[],
  objective:{moto:{x:60,y:0,mode:'anda'},etaS:300,budget:120,car:{x:0,y:0,hits:0,limit:120,parts:0}}} as unknown as RunView);
const think=(v:RunView,partner?:{x:number;y:number})=>decide({view:v,selfId:'b',at:{x:12,y:0},index:1,memory:newMemory(1),combat:'manual',nests:true,...(partner?{partner}:{})});

test('no partner: the crate 1 u off is looted (as before)',()=>{
  assert.equal(think(view()).mode,'loot');
});
test('the partner by its person: the crate within PARTNER_LOOT of them is looted',()=>{
  assert.equal(think(view(),{x:13,y:PARTNER_LOOT-1}).mode,'loot');
});
test('the partner with its person 25 u off: it leaves the crate and walks to them (a lull)',()=>{
  const person={x:12,y:25},d=think(view(),person);
  assert.equal(d.mode,'escort');
  assert.ok(d.direction.y>.7,`toward the person (${d.direction.x.toFixed(2)}, ${d.direction.y.toFixed(2)})`);
});
test('the partner in a wave (a critter near it): it fights by its person, pulled back past ESCORT_LEASH',()=>{
  const person={x:12,y:20},d=think(view([{x:14,y:3}]),person);
  assert.equal(d.mode,'escort');
  assert.ok(d.direction.y>0,`back toward the person (${d.direction.x.toFixed(2)}, ${d.direction.y.toFixed(2)})`);
  assert.ok(20>ESCORT_LEASH);
});
test('the partner by its person (within PARTNER_NEAR) in a lull, nothing to loot near them: it stands',()=>{
  const v=view();(v as unknown as {pickups:unknown[]}).pickups=[];
  const d=think(v,{x:13,y:1});
  assert.equal(d.mode,'escort');
  assert.equal(Math.hypot(d.direction.x,d.direction.y),0);
});
