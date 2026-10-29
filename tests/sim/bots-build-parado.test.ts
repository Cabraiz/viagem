/**
 * Card NEW-20261029-ORQ-bots-build-parado (evidence/bots-build-parado-29-10): what kept the bots standing in 'build'.
 *  - The builder on its own obra (D-052 holdsObra: the sim holds it still) stood idle, 46 s a match in 6p: in the manual
 *    combat it now swings at a critter in its weapon's reach (bot-brain attackReach), the stick still at rest.
 *  - 1p: the bot alone left the verdes past LOOT_ANY_NEAR shut (r1 20 %): planLoot's anyVerde opens them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import type {Simulation} from '../../multiplayer/simulation.ts';
import {planLoot,LOOT_ANY_NEAR} from '../../src/sim/bot-loot.ts';
import {ROOT_DEFENSE} from '../../src/sim/towers/catalog.ts';

/** A room on tick 0 whose only bot has its root under way (ticks 0..100), a critter `gap` u away. */
function frozen(gap:number,combat?:'manual'){
  const inputs:unknown[][]=[];
  const me={id:'bot-1',x:10,y:10,hp:100,maxHp:100,weapons:[{id:'faca',level:1}],hand:0};
  const sim={tick:0,mode:'ninhos',...(combat?{combat}:{}),players:new Map([['bot-1',{id:'bot-1',x:10,y:10}]]),
    run:{stonewards:{state:{defenses:{list:[{id:'def-1',cell:{c:0,r:0},kind:ROOT_DEFENSE,owner:'bot-1',startTick:0,readyTick:100}],pieces:[]}}}},
    botView:()=>({tick:0,players:[me],enemies:[{id:'e',hp:5,maxHp:5,x:10+gap,y:10}],pickups:[],structures:[]}),
    setBotInput:(...args:unknown[])=>{inputs.push(args);}} as unknown as Simulation;
  const bots=new RoomBots();bots.add('bot-1',0);
  bots.think(sim);
  return {inputs,mode:bots.modes.get('bot-1')};
}

test('a bot held on its own obra swings at a critter in reach in the manual combat, the stick at rest',()=>{
  const near=frozen(.5,'manual');
  assert.equal(near.mode,'build');
  assert.deepEqual(near.inputs[0]?.slice(0,2),['bot-1',{x:0,y:0}],'it holds still');
  assert.equal(near.inputs[0]?.[3],true,'it attacks the critter in reach');
  assert.notEqual(frozen(30,'manual').inputs[0]?.[3],true,'none in reach: no swing');
  assert.notEqual(frozen(.5).inputs[0]?.[3],true,'the auto combat swings on its own');
});

test('a bot alone (anyVerde) opens the verde past LOOT_ANY_NEAR an armed bot in company leaves',()=>{
  const longe={id:'bau-1',kind:'chest',value:1,x:LOOT_ANY_NEAR+4,y:0};
  const view={players:[],enemies:[],pickups:[longe]} as unknown as Parameters<typeof planLoot>[0];
  const armed={id:'b',x:0,y:0,hp:100,maxHp:100,weapons:[{id:'pistola',level:1}],hand:0} as unknown as Parameters<typeof planLoot>[1];
  assert.equal(planLoot(view,armed,{x:0,y:0},30).goal,undefined,'in company: left to the faca bots');
  assert.equal(planLoot(view,armed,{x:0,y:0},30,{anyVerde:true}).goal?.id,'bau-1','alone: opened');
});
