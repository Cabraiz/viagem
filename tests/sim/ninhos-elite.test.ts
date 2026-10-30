/**
 * NEW-20261029-ORQ-saci-nasce-nos-ninhos: in mode 'ninhos' (the default) the run's ELITE_ONLY elite (the saci) comes with
 * the waves (src/sim/ninhos/ninhos.ts NEST_ELITE): none in wave 1, then 1 and 2 a wave, under the per-wave and alive caps,
 * born in a live nest's yard at the director's elite numbers; a run without one (a legacy mini-chefe as round 5's elite,
 * no roster) sends none; the legacy cast stays out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import type {NestPlan} from '../../src/maps/nests.ts';
import {Rng,type EnemyState} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {createEnemy,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {ELITE_HP,ELITE_ONLY,ELITE_SIZE,INIMIGOS_LIBERADOS,ROUNDS,drawRotation,playerScale,roundRoster,type RoundRoster} from '../../src/rules/index.ts';
import {NEST_ELITE,NEST_MEMORY,NEST_PACE,WAVE_MEMORY,createNests,waveElites,type WaveEntrance} from '../../src/sim/ninhos/ninhos.ts';
import {BASE_STATS,type SimPlayer} from '../../src/contract/index.ts';
import {SIEGE_FLAG} from '../../src/sim/stonewards/wall.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const SACI=ELITE_ONLY[0];

const PLAN:NestPlan={seed:1,players:1,nests:[
  {id:'p0',kind:'terreno',x:40,y:40,size:'P',radius:6,sleepers:[{x:40,y:41},{x:41,y:40}]},
  {id:'g0',kind:'terreno',x:80,y:80,size:'G',radius:12,sleepers:[{x:80,y:81},{x:81,y:80}]},
],loose:[{x:20,y:20,training:false,members:Array.from({length:18},(_,i)=>({x:20+i%9,y:20+Math.floor(i/9)}))}]};
const DOOR:WaveEntrance={id:'N',x:10,y:0,route:[{x:10,y:0},{x:50,y:50}]};

/** The waves' timing is not the subject: no Minerva, no warm start, no alive cap; a wave over 1 s after it left. */
function quickPace(fn:()=>void){
  const saved=structuredClone(NEST_PACE);
  Object.assign(NEST_PACE,{minerva:0,first:[0,0],firstLate:[0,0],alive:[1e9,1e9],warm:0,warmEase:0,waveMin:1,waveCap:1,explore:1});
  try{fn();}finally{Object.assign(NEST_PACE,saved);}
}
function rig(roster:((round:number)=>RoundRoster|undefined)|undefined,maxEnemies=300){
  const world=new SimWorld({terrain:city.fork(),seed:7,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  world.players.set('p1',{id:'p1',classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:0,y:0,ack:0,score:0} as SimPlayer);
  const nests=createNests({plan:()=>PLAN,maxEnemies,entrances:[DOOR],...(roster?{roster}:{}),
    createEnemy:(ctx,kind,at,scale)=>ctx.enemies.size<maxEnemies&&isEnemyKind(kind)?createEnemy(ctx,kind,at,scale):undefined});
  world.register({id:'director',step:ctx=>nests.step(ctx)});
  return {world,nests};
}
/** Plays `waves` waves; before each next one the wave's bodies die (`keepElites`: the elites stay up). Kinds per wave. */
function play(r:ReturnType<typeof rig>,waves:number,keepElites=false){
  const seen=new Set<string>(),perWave:Record<string,number>[]=[];
  for(let guard=0;r.nests.state.sent<waves&&guard<1e5;guard++){
    const sent=r.nests.state.sent;
    r.world.step();
    if(r.nests.state.sent===sent)continue;
    const kinds:Record<string,number>={};
    for(const [id,e] of r.world.enemies)if(!seen.has(id)){seen.add(id);kinds[e.kind]=(kinds[e.kind]??0)+1;}
    perWave.push(kinds);
    for(const [id,e] of r.world.enemies)if(!(keepElites&&e.elite))r.world.enemies.delete(id);
  }
  return perWave;
}
const liberated=()=>{const rotation=drawRotation(new Rng(11));return (round:number)=>roundRoster(rotation,round);};

test('NEST_ELITE: none in wave 1, then 1 a wave, 2 from wave 4, never past perWave',()=>{
  assert.deepEqual([0,1,2,3,4,5,8,20].map(waveElites),[0,1,1,2,2,2,2,2]);
  assert.equal(waveElites(0),0,'wave 1 has none');
  for(let i=0;i<50;i++)assert.ok(waveElites(i)<=NEST_ELITE.perWave);
  assert.ok(NEST_ELITE.alive>=NEST_ELITE.perWave);
});

test('6 waves of the liberated run: the saci comes from wave 2 (1, 1, 2, 2, 2), at the elite\'s numbers in a nest yard; only liberated kinds',()=>quickPace(()=>{
  const roster=liberated();
  assert.equal(roster(5).elite,SACI,'the liberated rotation\'s round-5 elite is the saci');
  const r=rig(roster);
  const elites:EnemyState[]=[];
  const seen=new Set<string>();
  const perWave:Record<string,number>[]=[];
  for(let guard=0;r.nests.state.sent<6&&guard<1e5;guard++){
    const sent=r.nests.state.sent;
    r.world.step();
    if(r.nests.state.sent===sent)continue;
    const kinds:Record<string,number>={};
    for(const [id,e] of r.world.enemies)if(!seen.has(id)){seen.add(id);kinds[e.kind]=(kinds[e.kind]??0)+1;if(e.kind===SACI)elites.push(structuredClone(e));}
    perWave.push(kinds);
    r.world.enemies.clear();
  }
  if(process.env.SACI_LOG)console.log(JSON.stringify(perWave));
  assert.equal(perWave.length,6);
  assert.deepEqual(perWave.map(w=>w[SACI]??0),[0,1,1,2,2,2],JSON.stringify(perWave));
  for(const w of perWave){
    assert.ok((w.mendigo??0)>0,'the mendigo horde still comes');
    for(const k of Object.keys(w))assert.ok(INIMIGOS_LIBERADOS.includes(k),`spawned ${k}, not liberated`);
  }
  const log=r.nests.state.log!;
  assert.deepEqual(log.map(l=>l.elite??0),[0,1,1,2,2,2],'the wave log counts them');
  for(const l of log)assert.equal(l.total,l.nests+l.outside+(l.elite??0));
  // The director's elite: ELITE_HP × the row's hp × playerScale.solo (× crowd, 1 for 1p), ELITE_SIZE, the flag, besieging.
  const plain=createEnemy(r.world,SACI,{x:0,y:0},1);r.world.enemies.delete(plain.id);
  for(const e of elites){
    assert.ok(e.elite,'flagged elite (its extras and its chest)');
    assert.ok(Math.abs(e.radius-plain.radius*ELITE_SIZE)<1e-9,'elite size');
    assert.ok(e.memory?.[WAVE_MEMORY]!==undefined&&e.memory?.[SIEGE_FLAG]===1,'a wave body besieging the car');
    const nest=PLAN.nests[e.memory![NEST_MEMORY]!];
    assert.ok(nest.sleepers.some(p=>p.x===e.x&&p.y===e.y),'born in a live nest\'s yard');
  }
  const rows=elites.map(e=>e.maxHp/plain.maxHp);
  const lo=Math.min(...ROUNDS.slice(1,9).map(row=>row.hpNinhos??row.hpScale))*playerScale(1).solo*ELITE_HP;
  assert.ok(rows.every(x=>x>=lo*.99),`elite hp × ${rows} ≥ ${lo}`);
}));

test('the alive cap: elites left standing hold the next waves to NEST_ELITE.alive up',()=>quickPace(()=>{
  const r=rig(liberated());
  play(r,8,true);
  const up=[...r.world.enemies.values()].filter(e=>e.elite);
  assert.equal(up.length,NEST_ELITE.alive);
}));

test('no ELITE_ONLY elite in the run (no roster, or a legacy mini-chefe as round 5\'s): no elite from the nests',()=>quickPace(()=>{
  for(const roster of [undefined,(round:number)=>({roles:{corredor:['mendigo']},...(round===5?{elite:'tio-pave-gigante'}:{})})]){
    const r=rig(roster);
    let elites=0;
    for(let guard=0;r.nests.state.sent<5&&guard<1e5;guard++){
      r.world.step();
      for(const e of r.world.enemies.values())if(e.elite)elites++;
      r.world.enemies.clear();
    }
    assert.equal(r.nests.state.sent,5);
    assert.equal(elites,0);
    assert.ok(r.nests.state.log!.every(l=>l.elite===undefined));
  }
}));

test('the enemy cap: no elite past maxEnemies',()=>quickPace(()=>{
  const r=rig(liberated(),4);
  play(r,4);
  assert.ok(r.nests.state.log!.every(l=>l.total<=4));
}));

test('assembled mode ninhos (the room rotation, the real city): a 6-wave run counts the saci from wave 2, the legacy cast out',()=>{
  const world=new SimWorld({terrain:city.fork(),seed:21,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,mode:'ninhos',objective:'chaveiro'});
  const car=sys.chaveiro!.state.car;
  world.players.set('p1',{id:'p1',classId:'x',hp:1e9,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e9},weaponReady:{},x:car.x+1.5,y:car.y,ack:0,score:0} as SimPlayer);
  const seen=new Set<string>(),byWave:Record<number,Record<string,number>>={},all=new Set<string>();
  for(let i=0;i<20*60*30&&sys.nests!.state.sent<6;i++){
    world.step();
    for(const [id,e] of world.enemies)if(!seen.has(id)){
      seen.add(id);all.add(e.kind);
      const w=e.memory?.[WAVE_MEMORY];
      if(typeof w==='number')(byWave[w]??={})[e.kind]=(byWave[w][e.kind]??0)+1;
    }
    // The team clears every wave (and the chefão, who holds the waves' clock) once a second: the waves end on calm.
    if(i%20===0)for(const [id,e] of world.enemies){e.hp=0;world.enemies.delete(id);}
  }
  if(process.env.SACI_LOG)console.log(JSON.stringify(byWave));
  assert.equal(sys.nests!.state.sent,6);
  assert.deepEqual([0,1,2,3,4,5].map(w=>byWave[w]?.[SACI]??0),[0,1,1,2,2,2],JSON.stringify(byWave));
  for(const k of all)assert.ok(INIMIGOS_LIBERADOS.includes(k)||k==='chefe'||k==='o-grande-credor',`spawned ${k}, not liberated`);
});
