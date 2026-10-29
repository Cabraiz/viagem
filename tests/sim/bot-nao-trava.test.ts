/**
 * Card NEW-20261028-ORQ-bot-nao-trava-entre-casa-e-arma (P1): on Cidade Nevada (chaveiro, ninhos, manual) the bot went
 * 'home' and 'loot' by the car for good and never got a weapon (1p seeds 6 and 11; 48 swaps in 60 s on seed 6). The
 * bodies by its crates were awake but held still (the Minuto de Minerva) or asleep, and planLoot left any loot with a
 * critter within LOOT_SAFE.
 *  1. the seeds of the card (1p 6/10/11/12, 3p 6/7/11), 30 s headless: each bot but the partner has a weapon by then
 *     and goes back to 'loot' after leaving it for 'home' at most once in any 5 s; seeds 1-16, each has one within ~30 s;
 *  2. planLoot: a bot with no weapon looks for one with critters near (one hurt below LOOT_KEEP_HP does not); an armed
 *     one keeps its goal (opts.keep) and only that; a sleeper is no critter; a crate the bot stands by is its own
 *     against a bot a hair nearer;
 *  3. hasWeapon.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityAsField,cityTerrainFrom} from '../../src/maps/index.ts';
import {BOT_CLASS_IDS} from '../../src/rules/index.ts';
import {STEP_MS} from '../../src/protocol/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots,botIdentity} from '../../multiplayer/room-bots.ts';
import {LevelupPause} from '../../multiplayer/levelup-pause.ts';
import {LOOT_KEEP_HP,LOOT_SAFE,hasWeapon,planLoot} from '../../src/sim/bot-loot.ts';
import {OPEN_REACH} from '../../src/sim/crates.ts';
import type {PlayerRunView,RunView} from '../../src/contract/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const HZ=20,CAP_S=30,WINDOW=5*HZ,ARMED_S=36;

/** The bench's run (the card's trace): `players` room bots, the first in the person seat, `capS` s. */
function run(seed:number,players:number,capS=CAP_S){
  const sim=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  const room=new RoomBots();
  for(let i=0;i<players;i++){
    const id=`bot${i+1}`,{name,classId}=botIdentity(seed,i,[...BOT_CLASS_IDS],new Set([...sim.players.values()].map(p=>p.name)));
    sim.addBot(id,name,classId);room.add(id,i);if(i===0)sim.personPace.add(id);
  }
  sim.botState=()=>room.state();sim.resetRun();room.reset();
  const pause=new LevelupPause(),armed=new Map<string,number>(),modes=new Map<string,{tick:number;mode:string}[]>();
  let clock=0;
  while(!sim.outcome&&sim.world.tick<capS*HZ){
    clock+=STEP_MS;if(pause.update(sim,clock))continue;
    room.think(sim);sim.step();
    const tick=sim.world.tick;
    for(const [id,p] of sim.players){
      if(!armed.has(id)&&p.build.weapons.length)armed.set(id,tick);
      const m=room.modes.get(id),seq=modes.get(id)??[];modes.set(id,seq);
      if(m!==undefined&&seq.at(-1)?.mode!==m)seq.push({tick,mode:m});
    }
  }
  return {armed,modes};
}
/** The most times, in any WINDOW ticks, the bot went back to 'loot' right after leaving it for 'home'. */
function returns(seq:readonly {tick:number;mode:string}[]){
  const back:number[]=[];
  for(let i=2;i<seq.length;i++)if(seq[i].mode==='loot'&&seq[i-1].mode==='home'&&seq[i-2].mode==='loot')back.push(seq[i].tick);
  let most=0;
  for(let i=0;i<back.length;i++){let n=0;for(let j=i;j<back.length&&back[j]-back[i]<WINDOW;j++)n++;most=Math.max(most,n);}
  return most;
}

for(const [players,seeds] of [[1,[6,10,11,12]],[3,[6,7,11]]] as const)for(const seed of seeds){
  test(`seed ${seed} ${players}p: every bot but the partner has a weapon within ${CAP_S} s and does not swing home and loot`,()=>{
    const {armed,modes}=run(seed,players);
    for(const [id,seq] of modes){
      if(seq.some(s=>s.mode==='escort'))continue;
      const trail=seq.map(s=>`${(s.tick/HZ).toFixed(1)}:${s.mode}`).join(' ');
      assert.ok(armed.has(id),`${id} never armed: ${trail}`);
      assert.ok(returns(seq)<=1,`${id} back to loot ${returns(seq)} times in 5 s: ${trail}`);
    }
  });
}

test(`seeds 1-16, 1p and 3p: every bot but the partner has its first weapon within ~30 s (${ARMED_S} s)`,()=>{
  const late:string[]=[];
  for(const players of [1,3])for(let seed=1;seed<=16;seed++){
    const {armed,modes}=run(seed,players,ARMED_S);
    for(const [id,seq] of modes)if(!seq.some(s=>s.mode==='escort')&&!armed.has(id))late.push(`${seed}/${players}p ${id}`);
  }
  assert.deepEqual(late,[]);
});

const me=(weapons:PlayerRunView['weapons'],hp=100):PlayerRunView=>({id:'bot-1',name:'bot-1',bot:true,online:true,hp,maxHp:100,x:0,y:0,weapons,passives:[]} as unknown as PlayerRunView);
const crate=(id:string,x:number,y=0)=>({id,kind:'chest',value:2,x,y});
const view=(o:{enemies?:object[];pickups?:object[];players?:object[]}={})=>({players:o.players??[],pickups:o.pickups??[],enemies:o.enemies??[]} as unknown as Pick<RunView,'players'|'pickups'|'enemies'>);
const AT={x:0,y:0},near={id:'z-1',hp:40,x:2,y:0};

test('planLoot: a bot with no weapon goes for a crate with a critter near; hurt below LOOT_KEEP_HP it does not',()=>{
  assert.ok(2<LOOT_SAFE);
  const v=view({enemies:[near],pickups:[crate('bau-1',5)]});
  assert.equal(planLoot(v,me([]),AT).goal?.id,'bau-1');
  assert.equal(planLoot(v,me([],100*LOOT_KEEP_HP-1),AT).goal,undefined);
});

test('planLoot: an armed bot with a critter near keeps only the goal it had (opts.keep); with none, it loots nothing',()=>{
  const v=view({enemies:[near],pickups:[crate('bau-1',5),crate('bau-2',3)]}),knife=[{id:'faca',level:1}];
  assert.equal(planLoot(v,me(knife),AT).goal,undefined);
  assert.equal(planLoot(v,me(knife),AT,undefined,{keep:'bau-1'}).goal?.id,'bau-1','not the nearer bau-2');
  assert.equal(planLoot(v,me(knife,100*LOOT_KEEP_HP-1),AT,undefined,{keep:'bau-1'}).goal,undefined,'hurt: it lets go');
  // In a lull it loots as before: the nearest.
  assert.equal(planLoot(view({pickups:[crate('bau-1',5),crate('bau-2',3)]}),me(knife),AT,undefined,{keep:'bau-1'}).goal?.id,'bau-2');
});

test('planLoot: a body asleep by the crate is no critter',()=>{
  const v=view({enemies:[{...near,asleep:true}],pickups:[crate('bau-1',5)]});
  assert.equal(planLoot(v,me([{id:'faca',level:1}]),AT).goal?.id,'bau-1');
});

test('planLoot: the crate the bot stands by is its own against another bot a hair nearer; walking to it, not',()=>{
  const by={x:5-OPEN_REACH*.5,y:0},other={id:'bot-2',name:'bot-2',bot:true,online:true,hp:100,maxHp:100,x:5-OPEN_REACH*.4,y:0,weapons:[],passives:[]};
  const v=view({pickups:[crate('bau-1',5)],players:[other]});
  assert.equal(planLoot(v,me([]),by,undefined,{keep:'bau-1'}).goal?.id,'bau-1');
  assert.equal(planLoot(v,me([]),by).goal,undefined,'not kept: it leaves it to the nearer one');
  assert.equal(planLoot(v,me([]),AT,undefined,{keep:'bau-1'}).goal,undefined,'5 u off: it leaves it too');
});

test('hasWeapon: a weapon, not a kit or food',()=>{
  assert.equal(hasWeapon([]),false);
  assert.equal(hasWeapon([{id:'coxinha',level:1}]),false);
  assert.equal(hasWeapon([{id:'faca',level:1}]),true);
});
