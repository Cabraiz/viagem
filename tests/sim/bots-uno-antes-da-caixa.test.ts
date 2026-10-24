// NEW-20261023-ORQ-inicio-no-uno-caixas-120 (the bench): in mode 'ninhos' a room bot leaves the crates while a critter
// is within LOOT_CAR_THREAT of the car. planLoot's lull looks only around the bot, so with the start and its crates
// beside the Uno six bots stood at crates 8-25 u off while the first wave took the car in ~60 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR_ID} from '../../src/contract/index.ts';
import {LOOT_CAR_THREAT,decide,newMemory} from '../../src/sim/bot-brain.ts';
import type {RunView} from '../../src/contract/view.ts';

const me={id:'b',name:'B',classId:'x',hp:100,maxHp:100,online:true,spectator:false,downed:false,eliminated:false,weapons:[{id:'faca',level:1}],passives:[],x:12,y:0,skillReadyTick:0};
const view=(enemies:{x:number;y:number}[],phase:'wave'|'prepare'='wave'):RunView=>({tick:1000,team:{xp:0,level:1,nextXp:5},
  round:{index:1,total:10,phase,phaseEndsTick:1e9,remaining:1},
  enemies:enemies.map((e,i)=>({id:`e${i}`,kind:'bebado',x:e.x,y:e.y,hp:10,maxHp:10})),
  pickups:[{id:'bau-1',kind:'chest',value:2,x:13,y:0}],projectiles:[],telegraphs:[],
  structures:[{id:CAR_ID,kind:CAR_ID,x:0,y:0,hp:120,maxHp:120}],players:[me],offers:[],events:[],
  objective:{moto:{x:60,y:0,mode:'anda'},etaS:300,budget:120,car:{x:0,y:0,hits:0,limit:120,parts:0}}} as unknown as RunView);
const mode=(v:RunView)=>decide({view:v,selfId:'b',at:{x:12,y:0},index:0,memory:newMemory(0),combat:'manual',nests:true}).mode;

test('a crate 1 u off and nothing at the car: the bot loots',()=>{
  assert.equal(mode(view([])),'loot');
  assert.equal(mode(view([{x:0,y:LOOT_CAR_THREAT+3}])),'loot','a critter farther than LOOT_CAR_THREAT from the car');
});
test('a critter at the car (12 u from the bot, outside its own lull radius): the bot leaves the crate',()=>{
  assert.notEqual(mode(view([{x:-2,y:1}])),'loot');
});
test('outside mode ninhos the old rule holds (the lull around the bot only)',()=>{
  assert.equal(decide({view:view([{x:-2,y:1}]),selfId:'b',at:{x:12,y:0},index:0,memory:newMemory(0),combat:'manual'}).mode,'loot');
});
