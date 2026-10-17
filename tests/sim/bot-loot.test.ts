import test from 'node:test';
import assert from 'node:assert/strict';
import {planLoot} from '../../src/sim/bot-loot.ts';

type View=Parameters<typeof planLoot>[0];type Me=Parameters<typeof planLoot>[1];
const me=(weapons:{id:string;level:number}[]):Me=>({id:'b',x:0,y:0,hp:100,maxHp:100,weapons,hand:0} as unknown as Me);
const view=(pickups:{id:string;kind:string;value:number;x:number;y:number}[]):View=>({players:[],enemies:[],pickups} as unknown as View);

test('a bot with a firearm leaves the verde crates to the ones still with the faca; better crates it still opens',()=>{
  const verde={id:'bau-1',kind:'chest',value:1,x:3,y:0},azul={id:'bau-2',kind:'chest',value:2,x:6,y:0};
  assert.equal(planLoot(view([verde,azul]),me([{id:'faca',level:1}]),{x:0,y:0}).goal?.id,'bau-1','with the faca: the nearest crate');
  assert.equal(planLoot(view([verde,azul]),me([{id:'pistola',level:1}]),{x:0,y:0}).goal?.id,'bau-2','armed: skips the verde');
  assert.equal(planLoot(view([verde]),me([{id:'faca',level:1},{id:'pistola',level:1}]),{x:0,y:0}).goal,undefined,'a pistol in the bag counts');
});
