/**
 * NEW-20261029-ORQ-saci-nasce-nos-ninhos: in mode 'ninhos' (the default) the run's ELITE_ONLY elite comes with the waves
 * (src/sim/ninhos/ninhos.ts NEST_ELITE): none in wave 1, then 1 and 2 a wave, under the per-wave and alive caps. Card
 * NEW-20261030-ORQ-saci-chefe-2x (the user 30/10: "O saci é o boss do jogo"): ELITE_ONLY is empty, the saci is the end of
 * wave 1's chefão (rules/chefao-onda.ts SACI_BOSS), so the nests send no elite; the legacy cast stays out.
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
const SACI='aberracao-saci';

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

test('the liberated run: no elite from the nests (the saci is the chefão, not an elite), only liberated kinds',()=>quickPace(()=>{
  assert.deepEqual([...ELITE_ONLY],[]);
  const r=rig(liberated());
  const perWave=play(r,6,true);
  assert.equal(perWave.length,6);
  assert.ok(![...r.world.enemies.values()].some(e=>e.elite),'no elite left standing');
  assert.ok(r.nests.state.log!.every(l=>(l.elite??0)===0),'the wave log counts none');
  for(const kinds of perWave)for(const k of Object.keys(kinds))assert.ok(INIMIGOS_LIBERADOS.includes(k),`spawned ${k}`);
  assert.ok(perWave.every(kinds=>!kinds['aberracao-saci']),'the saci never comes from a nest');
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

test('assembled mode ninhos (the room rotation, the real city): a 6-wave run: the saci only as the wave-1 chefão, none from the nests, the legacy cast out',()=>{
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
  assert.deepEqual([0,1,2,3,4,5].map(w=>byWave[w]?.[SACI]??0),[0,0,0,0,0,0],JSON.stringify(byWave));
  assert.ok(all.has(SACI),'the saci came, as the chefão');
  for(const k of all)assert.ok(INIMIGOS_LIBERADOS.includes(k)||k==='chefe',`spawned ${k}, not liberated`);
});
