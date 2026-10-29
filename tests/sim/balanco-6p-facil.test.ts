/**
 * balanco-6p-facil (card NEW-20261025-ORQ-balanco-6p-facil): the chaveiro rides longer for a bigger room (mode 'ninhos',
 * ChaveiroOptions.ride = CHAVEIRO_PACE.ride), read at the first step from the players then in the run, like the Uno's
 * limit; 1p-3p ride MOTO_RIDE_SECONDS as before and keep no state.ride (no state hash moves). With it NEST_PACE.crowd:
 * a big room's wave bodies march faster and carry more hp and damage, 1p-3p × 1. On the REAL Cidade Nevada.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {CHAVEIRO_PACE,MOTO_RIDE_SECONDS,createChaveiro,rideSecondsFor,type ChaveiroState} from '../../src/sim/chaveiro/system.ts';
import {seatedPlayers} from '../../src/sim/wallet.ts';
import {NEST_PACE,crowd} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
const city=loaded.terrain,PTS=city.asset.points;
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
const CAR=placeWall(city);

function rig(players:number,ride:readonly number[]|undefined,restore?:ChaveiroState,finalNotBefore?:number){
  const team=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city,seed:7,players:team,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  for(let i=0;i<players;i++)team.set(`p${i}`,{id:`p${i}`,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:CAR.x,y:CAR.y,ack:0,score:0} as SimPlayer);
  const sys=createChaveiro({wallet:{seated:()=>seatedPlayers(team)},seed:7,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:()=>{},...(ride?{ride}:{}),...(finalNotBefore!==undefined?{finalNotBefore}:{})},restore);
  const step=(n=1)=>{for(let i=0;i<n;i++){world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);}};
  return {world,sys,step};
}

test('CHAVEIRO_PACE: 2p-3p ride MOTO_RIDE_SECONDS as before, a solo shorter (solo-uno-aguenta-1a-onda); from 2p a bigger room never rides faster, six the longest',()=>{
  const ride=CHAVEIRO_PACE.ride;
  assert.equal(ride.length,6);
  for(const n of [2,3])assert.equal(rideSecondsFor(ride,n),MOTO_RIDE_SECONDS,`${n}p`);
  assert.ok(rideSecondsFor(ride,1)<MOTO_RIDE_SECONDS,`1p rides shorter: ${rideSecondsFor(ride,1)} s`);
  for(let n=3;n<=6;n++)assert.ok(rideSecondsFor(ride,n)>=rideSecondsFor(ride,n-1),`${n}p not faster than ${n-1}p`);
  assert.ok(rideSecondsFor(ride,6)>MOTO_RIDE_SECONDS,`6p rides longer: ${rideSecondsFor(ride,6)} s`);
  // Out of range rooms clamp to 1..6.
  assert.equal(rideSecondsFor(ride,0),rideSecondsFor(ride,1));assert.equal(rideSecondsFor(ride,9),rideSecondsFor(ride,6));
});

test('the ride follows the room at the first step: the moto rides the route in ride[n] s, the ETA grows by the same share',()=>{
  const ride=[420,420,420,500,560,630];
  for(const n of [1,3,6]){
    const base=rig(n,undefined),paced=rig(n,ride);
    base.step(40);paced.step(40);
    const k=ride[n-1]/MOTO_RIDE_SECONDS;
    assert.ok(Math.abs(base.sys.state.moto.s/paced.sys.state.moto.s-k)<1e-9,`${n}p: ${k}× slower`);
    if(n<=3){
      assert.equal(paced.sys.state.ride,undefined,`${n}p keeps no state.ride (same hash as before)`);
      assert.equal(paced.sys.eta(paced.world.tick),base.sys.eta(base.world.tick));
    }else{
      assert.equal(paced.sys.state.ride,ride[n-1]);
      assert.ok(paced.sys.eta(paced.world.tick)>base.sys.eta(base.world.tick)+(ride[n-1]-MOTO_RIDE_SECONDS)*.9,`${n}p ETA ${paced.sys.eta(paced.world.tick)} vs ${base.sys.eta(base.world.tick)}`);
    }
  }
  // Without the option (the legacy chaveiro), six ride MOTO_RIDE_SECONDS.
  const legacy=rig(6,undefined);legacy.step(5);assert.equal(legacy.sys.state.ride,undefined);
});

test('a checkpoint keeps the ride: restored on a fresh world, the moto rides on at the same pace and ETA',()=>{
  const ride=[420,420,420,500,560,630];
  const a=rig(6,ride);a.step(100);
  const b=rig(6,ride,structuredClone(a.sys.state));
  assert.equal(b.sys.eta(a.world.tick),a.sys.eta(a.world.tick));
  const s0=a.sys.state.moto.s;a.step(40);
  for(let i=0;i<100;i++)b.world.step();
  b.step(40);
  assert.ok(Math.abs((a.sys.state.moto.s-s0)-(b.sys.state.moto.s-s0))<1e-9,'same pace after the restore');
  // A room that grows after the start keeps the pace it started with (like the Uno's limit).
  const c=rig(3,ride);c.step(1);
  c.world.players.set('late',{...c.world.players.get('p0')!,id:'late'});c.world.players.set('late2',{...c.world.players.get('p0')!,id:'late2'});
  c.step(10);assert.equal(c.sys.state.ride,undefined);
});

// bots-resgatam: the bots that rescue first won 3p 15/16, so 3p meets stronger bodies too (1p-2p as before).
test('NEST_PACE.crowd: 1p-2p bodies as before (× 1); a bigger room never meets weaker ones, 3p up stronger, six the strongest',()=>{
  for(const k of ['march','hp','damage'] as const){
    assert.equal(NEST_PACE.crowd[k].length,6,k);
    for(const n of [1,2])assert.equal(crowd(k,n),1,`${k} ${n}p`);
    assert.ok(crowd(k,3)>1,`${k} 3p: ${crowd(k,3)}`);
    for(let n=2;n<=6;n++)assert.ok(crowd(k,n)>=crowd(k,n-1),`${k} ${n}p ≥ ${n-1}p`);
    assert.ok(crowd(k,6)>1,`${k} 6p: ${crowd(k,6)}`);
    assert.equal(crowd(k,0),crowd(k,1));assert.equal(crowd(k,9),crowd(k,6));
  }
});

test('solo-uno-aguenta-1a-onda: a solo never pushes, so the hold counts his dead motos at their by-itself time and his first ETA is the same 540 s as a team',()=>{
  const FINAL=540;
  for(const n of [1,3]){
    const r=rig(n,CHAVEIRO_PACE.ride,undefined,FINAL);r.step(1);
    const eta=r.sys.eta(r.world.tick);
    assert.ok(eta<=FINAL+1&&eta>=FINAL-15,`${n}p first ETA ${eta} s`);
  }
  // At the old 420 s ride a solo's three dead motos (MORTA_ALONE_SECONDS each) put him far past it.
  const old=rig(1,[MOTO_RIDE_SECONDS,...CHAVEIRO_PACE.ride.slice(1)],undefined,FINAL);old.step(1);
  assert.ok(old.sys.eta(old.world.tick)>FINAL+120,`1p at 420 s: ${old.sys.eta(old.world.tick)} s`);
});
