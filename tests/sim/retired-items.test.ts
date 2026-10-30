// NEW-20261027-ORQ-sem-arma-girando-no-chao: the orbit weapons left the game (the Chinelo, its evolution and legendary,
// the Pack 12 rings); an old checkpoint that still holds them resumes without them (src/sim/retired-items.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {RETIRED_ITEM_IDS,isRetired,scrubRetired} from '../../src/sim/index.ts';
import {WEAPON_IDS,EVOLUTION_IDS} from '../../src/sim/weapons/catalog.ts';
import {startingBuild} from '../../src/rules/index.ts';

test('no retired id is in the catalog',()=>{
  for(const id of [...WEAPON_IDS,...EVOLUTION_IDS])assert.equal(isRetired(id),false,id);
  assert.equal(isRetired(undefined),false);
  for(const id of RETIRED_ITEM_IDS)assert.equal(isRetired(id),true,id);
});

test('scrubRetired: builds, timers, offers, ground items, crates and their memories lose the retired ids (idempotent)',()=>{
  const cp={
    players:[
      {id:'a',run:{build:{weapons:[{id:'chinelo',level:3},{id:'cafe',level:2}],passives:[{id:'figa',level:1},{id:'tenis',level:1}],hand:0},weaponReady:{chinelo:9,cafe:4}}},
      {id:'b',run:{build:{weapons:[{id:'chinelo-evo',level:1}],passives:[]},weaponReady:{'chinelo-evo':2}}},
    ],
    world:{
      offers:[['a',[{choices:[{itemId:'pandeiro'},{itemId:'boleto'},{itemId:'pombo'}],defaultIndex:2},{choices:[{itemId:'chinelo'}],defaultIndex:0},{choices:[{itemId:'cafe'}],defaultIndex:0}]]],
      pickups:[{kind:'item',resource:'chinelo-lendario'},{kind:'item',resource:'boleto'},{kind:'chest',resource:'vela-esoterica'},{kind:'xp'}],
    },
    systems:{crates:{crates:{c1:{item:'chinelo-lendario'},c2:{item:'audio'}},lastItem:'pandeiro',last:{a:'chinelo',b:'cafe'}}},
  };
  scrubRetired(cp);
  const once=JSON.stringify(cp);
  const [a,b]=cp.players;
  assert.deepEqual(a!.run.build,{weapons:[{id:'cafe',level:2}],passives:[{id:'tenis',level:1}],hand:0},'the hand moves to the first weapon left');
  assert.deepEqual(a!.run.weaponReady,{cafe:4});
  assert.deepEqual(b!.run.build.weapons,[],'an automatic build left empty: resume() gives the class weapon back');
  assert.deepEqual(b!.run.weaponReady,{});
  assert.deepEqual(cp.world.offers[0]![1],[{choices:[{itemId:'boleto'},{itemId:'pombo'}],defaultIndex:1},{choices:[{itemId:'cafe'}],defaultIndex:0}]);
  assert.deepEqual(cp.world.pickups,[{kind:'item',resource:'boleto'},{kind:'chest'},{kind:'xp'}]);
  assert.deepEqual(cp.systems.crates,{crates:{c1:{},c2:{item:'audio'}},last:{b:'cafe'}});
  scrubRetired(cp);assert.equal(JSON.stringify(cp),once,'a second pass changes nothing');
  for(const junk of [null,1,'x',[],{players:'x',world:[]}])scrubRetired(junk);
});

test('an old checkpoint with a bot holding only the Chinelo resumes, the bot back on its class weapon',()=>{
  const SEED=4242,BOTS=[['bot-1','Robô do Gás','tio-do-churrasco'],['bot-2','Robô da Feira','cidadao-comum']] as const;
  const seat=(sim:Simulation)=>{for(const [id,name,classId] of BOTS)sim.addBot(id,name,classId);return sim;};
  const sim=seat(new Simulation(SEED,{world:'infinito'})),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
  sim.resetRun();
  for(let i=0;i<20*30;i++){bots.think(sim);sim.step(sim.tick*50);}
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint&{players:{id:string;run:{build:{weapons:{id:string;level:number}[];hand?:number}}}[]};
  const one=cp.players.find(p=>p.id==='bot-1')!,two=cp.players.find(p=>p.id==='bot-2')!;
  const automatic=one.run.build.hand===undefined;
  one.run.build.weapons=[{id:'chinelo',level:4}];if(!automatic)one.run.build.hand=0;
  two.run.build.weapons.push({id:'chinelo-evo',level:1});
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.resume(cp),true);
  const ids=(id:string)=>fresh.world.players.get(id)!.build.weapons.map(w=>w.id);
  for(const id of ['bot-1','bot-2'])assert.ok(!ids(id).some(isRetired),`${id}: ${ids(id)}`);
  if(automatic)assert.deepEqual(ids('bot-1'),startingBuild('tio-do-churrasco').weapons.map(w=>w.id));
  for(let i=0;i<20*5;i++){bots.think(fresh);fresh.step(fresh.tick*50);}
});
