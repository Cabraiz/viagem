/**
 * NEW-20261028-ORQ-bot-nao-trava-entre-casa-e-arma (ORQ 29/10, with the fence of cercas-nordeste): in the crowd at the
 * car (cells 52-56,55-60, seed 1) a critter within PERIL_R let the stick swap every think. In peril only a critter
 * ahead of the heading turns the bot back at once, and not into another one within PERIL_R.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PERIL_R,holdHeading,newMemory,type BrainInput,type Decision} from '../../src/sim/bot-brain.ts';
import type {RunView} from '../../src/contract/index.ts';

function input(tick:number,critters:{x:number;y:number}[]):BrainInput{
  const memory=newMemory(0);memory.heading={x:1,y:0};memory.headingTick=tick-4;
  const view={tick,round:{index:1,total:3,phase:'wave',phaseEndsTick:tick+1200,remaining:1},
    players:[{id:'b',name:'b',classId:'clt',hp:10,maxHp:10,bot:true,online:true,weapons:[]}],
    enemies:critters.map((c,i)=>({id:'e'+i,kind:'bebado',x:c.x,y:c.y,hp:5,maxHp:5})),
    pickups:[],projectiles:[],telegraphs:[],structures:[],offers:[]} as unknown as RunView;
  return {view,selfId:'b',at:{x:0,y:0},index:1,memory};
}
const west=():Decision=>({mode:'fight',direction:{x:-1,y:0}}) as Decision;
const r=PERIL_R/2;

test('in peril: a critter ahead of the heading turns the bot back at once',()=>{
  assert.ok(holdHeading(west(),input(1000,[{x:r,y:0}])).direction.x<0);
});
test('in peril: a critter behind the heading (the bot already goes away) does not turn it back',()=>{
  assert.ok(holdHeading(west(),input(1000,[{x:-r,y:0}])).direction.x>=0);
});
test('in peril: one ahead and one in the way back, it does not turn back into the other',()=>{
  assert.ok(holdHeading(west(),input(1000,[{x:r,y:0},{x:-r,y:.2}])).direction.x>=0);
});
