/**
 * NEW-20261031-ORQ-itens-so-de-monstro-ultra-raro (the user, 31/10: no more random items on the map; a rare one only when
 * a monster dies): on the real Cidade Nevada the only crates a run lays out by itself are the heroes' near ones (one each,
 * NEAR_WEAPON); everything else comes from a kill (crates-abate.ts killRoll/killDrop) or the boss. Results only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {bocaFaixa,cityEntradas} from '../../src/maps/city/entradas.ts';
import {ticks,type EnemyState,type PickupState} from '../../src/contract/index.ts';
import {CRATE_BODY_RADIUS} from '../../src/rules/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {crateInMouth} from '../../src/sim/crates-gap.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {ELITE_CRATE_CHANCE,KILL_CRATE_CHANCE,MAP_CRATES,NEAR_WEAPON,killDrop,killRoll} from '../../src/sim/crates-abate.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city);
type World=SimContext&{enemies:Map<string,EnemyState>;pickups:Map<string,PickupState>};
const run=(seed:number,heroes:number)=>{
  const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  for(let i=0;i<heroes;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  return {s,world:(s as unknown as {world:World}).world};
};
const chests=(world:World)=>[...world.pickups.values()].filter(k=>k.kind==='chest');
const enemy=(id:string,over:Partial<EnemyState>={}):EnemyState=>({id,x:0,y:0,hp:0,elite:false,boss:false,...over} as EnemyState);

test('the map\'s own crate sources are off',()=>{assert.equal(MAP_CRATES,false);});

test('the first step: one near crate a hero, each the NEAR_WEAPON, by its own hero (1 to 4 heroes)',()=>{
  for(let heroes=1;heroes<=4;heroes++){
    const {s,world}=run(heroes,heroes);
    s.step(1000);
    const list=chests(world);
    assert.deepEqual(list.map(k=>k.resource),Array(heroes).fill(NEAR_WEAPON),`${heroes} heroes`);
    for(const p of s.players.values())assert.ok(list.some(k=>Math.hypot(k.x-p.x,k.y-p.y)<8),`${heroes} heroes: no crate by ${p.id}`);
  }
});

test('a run with no monster (every enemy taken away each tick) lays out no crate besides the near one, 3 min',()=>{
  const {s,world}=run(1,1);
  let now=1000;
  for(let t=0;t<ticks(180);t++){world.enemies.clear();s.step(now+=50);}
  assert.deepEqual(chests(world).map(k=>k.resource),[NEAR_WEAPON]);
});

test('killRoll: a common monster leaves a crate at KILL_CRATE_CHANCE, an elite at ELITE_CRATE_CHANCE, the boss never',()=>{
  const N=20000,rate=(over:Partial<EnemyState>)=>{let n=0;for(let i=0;i<N;i++)if(killRoll(7,enemy(`e${i}`,over)))n++;return n/N;};
  const common=rate({}),elite=rate({elite:true});
  // 4 standard deviations of a binomial(N, p).
  assert.ok(Math.abs(common-KILL_CRATE_CHANCE)<4*Math.sqrt(KILL_CRATE_CHANCE*(1-KILL_CRATE_CHANCE)/N),`common ${common}`);
  assert.ok(Math.abs(elite-ELITE_CRATE_CHANCE)<4*Math.sqrt(ELITE_CRATE_CHANCE*(1-ELITE_CRATE_CHANCE)/N),`elite ${elite}`);
  assert.equal(rate({boss:true,elite:true}),0);
  for(let i=0;i<200;i++){const r=killRoll(7,enemy(`e${i}`,{elite:true}));if(r)assert.ok(r===2||r===3,`elite ${r}`);}
  for(let i=0;i<5000;i++){const r=killRoll(7,enemy(`e${i}`));if(r)assert.ok(r===1||r===2,`common ${r}`);}
  assert.equal(killRoll(7,enemy('e42')),killRoll(7,enemy('e42')),'same seed and id, same roll');
});

test('killDrop: a kill in a street mouth leaves its crate off the mouth on open ground, and the elite\'s sure chest goes',()=>{
  const {world}=run(1,1);
  const strip=bocaFaixa(city.asset,cityEntradas(city.asset)[0]),at={x:strip.x+strip.w/2,y:strip.y+strip.h/2};
  assert.ok(crateInMouth(city,at.x,at.y),'the kill spot is in a mouth');
  let id=0;while(!killRoll(world.seed,enemy(`x${id}`,{elite:true})))id++;
  const dead=enemy(`x${id}`,{elite:true,...at}),sure:PickupState={id:'sure-chest',kind:'chest',value:2,x:at.x,y:at.y,spawnTick:0} as PickupState;
  world.pickups.set(sure.id,sure);
  const dropped:{x:number;y:number}[]=[];
  const spot=killDrop(world,world.seed,dead,[sure],(_c,p)=>{dropped.push(p);});
  assert.equal(world.pickups.has(sure.id),false,'the sure chest is gone');
  assert.ok(spot&&dropped.length===1);
  assert.equal(crateInMouth(city,spot.x,spot.y),false,'off the mouth');
  assert.ok(city.clearDisc(spot.x,spot.y,CRATE_BODY_RADIUS),'on open ground');
  // A kill whose roll leaves nothing drops nothing; no `drop` (automatic combat) changes nothing, the chest stays.
  let none=0;while(killRoll(world.seed,enemy(`y${none}`)))none++;
  assert.equal(killDrop(world,world.seed,enemy(`y${none}`,at),[],()=>{throw new Error('dropped');}),undefined);
  world.pickups.set(sure.id,sure);
  assert.equal(killDrop(world,world.seed,dead,[sure]),undefined);
  assert.equal(world.pickups.has(sure.id),true);
});
