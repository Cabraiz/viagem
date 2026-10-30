// NEW-20261029-ORQ-so-3-inimigos: a headless run of 3 rounds (the room's defaults, bots playing) spawns only the
// liberated enemies (rules/inimigos-liberados.ts): the mendigo horde, the sleepers included. The saci elite is round 5's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {INIMIGOS_LIBERADOS} from '../../src/rules/index.ts';

const BOTS=[['bot-1','Robô do Gás','mendigo'],['bot-2','Robô da Feira','cidadao-comum'],['bot-3','Robô do Bar','cidadao-comum']] as const;

test('3 rounds headless: every enemy spawned is a liberated one (the mendigo), the sleepers included',()=>{
  const sim=new Simulation(4242,{world:'infinito'}),bots=new RoomBots();
  BOTS.forEach(([id,name,classId],i)=>{sim.addBot(id,name,classId);bots.add(id,i);});
  sim.resetRun();
  const seen=new Set<number>(),kinds=new Map<string,number>(),byRound:Record<number,Record<string,number>>={};
  const take=()=>{for(const [id,e] of sim.world.enemies)if(!seen.has(id)){seen.add(id);kinds.set(e.kind,(kinds.get(e.kind)??0)+1);
    const r=(byRound[sim.world.round.index]??={});r[e.kind]=(r[e.kind]??0)+1;}};
  take();
  for(let i=0;i<20*60*8&&sim.world.round.index<=3&&sim.outcome===undefined;i++){bots.think(sim);sim.step(sim.tick*50);take();}
  assert.ok(sim.world.round.index>3,`the bots reached round 4 (at ${sim.world.round.index}, outcome ${sim.outcome})`);
  if(process.env.SO3_LOG)console.log(JSON.stringify(byRound));
  assert.ok((kinds.get('mendigo')??0)>20,`a mendigo horde: ${JSON.stringify([...kinds])}`);
  for(const k of kinds.keys())assert.ok(INIMIGOS_LIBERADOS.includes(k),`spawned ${k}, not liberated: ${JSON.stringify([...kinds])}`);
});
