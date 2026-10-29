import test from 'node:test';
import assert from 'node:assert/strict';
import {planLoot,LOOT_ANY_NEAR,CRATE_CLAIM} from '../../src/sim/bot-loot.ts';

type View=Parameters<typeof planLoot>[0];type Me=Parameters<typeof planLoot>[1];
const me=(weapons:{id:string;level:number}[]):Me=>({id:'b',x:0,y:0,hp:100,maxHp:100,weapons,hand:0} as unknown as Me);
const view=(pickups:{id:string;kind:string;value:number;x:number;y:number}[]):View=>({players:[],enemies:[],pickups} as unknown as View);

test('a bot with a firearm leaves the far verde crates to the ones still with the faca; near ones and better crates it opens',()=>{
  const verde={id:'bau-1',kind:'chest',value:1,x:3,y:0},azul={id:'bau-2',kind:'chest',value:2,x:6,y:0};
  const longe={...verde,x:LOOT_ANY_NEAR+1},azulLonge={...azul,x:LOOT_ANY_NEAR+1.5};
  assert.equal(planLoot(view([verde,azul]),me([{id:'faca',level:1}]),{x:0,y:0}).goal?.id,'bau-1','with the faca: the nearest crate');
  // Item 4 (bots-resgatam): within LOOT_ANY_NEAR an armed bot opens the verde too (6p: verdes next to the car waited).
  assert.equal(planLoot(view([verde,azul]),me([{id:'pistola',level:1}]),{x:0,y:0}).goal?.id,'bau-1','armed: a near verde');
  assert.equal(planLoot(view([longe,azulLonge]),me([{id:'pistola',level:1}]),{x:0,y:0}).goal?.id,'bau-2','armed: skips a far verde');
  assert.equal(planLoot(view([longe]),me([{id:'faca',level:1},{id:'pistola',level:1}]),{x:0,y:0}).goal,undefined,'a pistol in the bag counts');
});

test('item 4: a crate another standing bot is opening (nearer, within CRATE_CLAIM) is left to it; an eliminated one or a person claims nothing',()=>{
  const bau={id:'bau-1',kind:'chest',value:1,x:5,y:0},outro={id:'bau-2',kind:'chest',value:1,x:-7,y:0};
  const other=(extra:object={})=>({id:'a',bot:true,x:5+CRATE_CLAIM*.5,y:0,...extra});
  const v=(players:object[])=>({players,enemies:[],pickups:[bau,outro]} as unknown as View);
  assert.equal(planLoot(v([other()]),me([{id:'faca',level:1}]),{x:0,y:0}).goal?.id,'bau-2','claimed: the other crate');
  assert.equal(planLoot(v([other({eliminated:true})]),me([{id:'faca',level:1}]),{x:0,y:0}).goal?.id,'bau-1','an eliminated bot claims nothing');
  assert.equal(planLoot(v([other({bot:false})]),me([{id:'faca',level:1}]),{x:0,y:0}).goal?.id,'bau-1','a person claims nothing');
});

test('items 2 and 3: a skipped crate and one past the leash are left out',()=>{
  const perto={id:'bau-1',kind:'chest',value:1,x:3,y:0},longe={id:'bau-2',kind:'chest',value:1,x:-9,y:0};
  const faca=me([{id:'faca',level:1}]);
  assert.equal(planLoot(view([perto,longe]),faca,{x:0,y:0},undefined,{skip:id=>id==='bau-1'}).goal?.id,'bau-2','skipped');
  assert.equal(planLoot(view([perto,longe]),faca,{x:0,y:0},undefined,{leash:{at:{x:-10,y:0},r:5}}).goal?.id,'bau-2','leashed to the car');
  assert.equal(planLoot(view([perto]),faca,{x:0,y:0},undefined,{leash:{at:{x:-10,y:0},r:5}}).goal,undefined,'nothing within the leash');
});
