// NEW-20261012-E5-cidade-barricadas-cliente: the room bots' forger counts only forge towers ('torre-*'). The city's
// 4 barricades are structures in the frames too (kind 'barricada'); counted as towers they filled MAX_TOWERS at once and
// the bots never built a tower in the city.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pickRecipe} from '../../src/sim/bot-brain.ts';
import {MAX_TOWERS} from '../../src/sim/stonewards/forge.ts';
import type {RunView,StructureView} from '../../src/contract/view.ts';

const wall:StructureView={id:'s1',kind:'muralha',x:0,y:0,hp:600,maxHp:600};
const barricades:StructureView[]=['N','S','L','O'].map((m,i)=>({id:`s${i+2}`,kind:'barricada',x:i,y:10,hp:i===3?0:300,maxHp:300}));
const view=(structures:StructureView[]):RunView=>({tick:1000,team:{xp:0,level:1,nextXp:5},round:{index:3,total:10,phase:'prepare',phaseEndsTick:1600,remaining:0},
  enemies:[],pickups:[],projectiles:[],telegraphs:[],structures,players:[],offers:[],events:[],camp:{units:20}} as unknown as RunView);

test('bot forger: the city barricades never count as towers',()=>{
  assert.ok(barricades.length>=MAX_TOWERS,'enough barricades to have filled the cap');
  assert.equal(pickRecipe(view([wall,...barricades])),'torre-chinelo');
  const towers=Array.from({length:MAX_TOWERS},(_,i)=>({id:`t${i}`,kind:'torre-chinelo',x:i,y:0,hp:1,maxHp:1,untilTick:2000}));
  assert.equal(pickRecipe(view([wall,...barricades,...towers])),'gambiarra','three real towers still fill the cap');
  // A tower whose time ran out does not count either (unchanged).
  assert.equal(pickRecipe(view([wall,...barricades,...towers.map(t=>({...t,untilTick:999}))])),'torre-chinelo');
});
