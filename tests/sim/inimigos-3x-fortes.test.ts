/**
 * Card NEW-20261031-ORQ-inimigos-3x-fortes-metade-da-horda (rules/forca-inimigos.ts): every enemy ×3 (hp at birth, the
 * boss included; every hit a hero or a structure takes), the hordes bring half their bodies (rounded up, at least 1), the map's
 * sleepers keep their number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityNestPlan,type NestPlan} from '../../src/maps/index.ts';
import {BASE_STATS,Rng,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {ENEMY_DAMAGE,ENEMY_HP,ENEMY_POWER,HORDE_SHARE,LEGACY_KINDS,MAX_ROUND_ENEMIES,ROUNDS,halfHorde,planRound} from '../../src/rules/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {ENEMIES,createEnemy} from '../../src/sim/enemies/catalog.ts';
import {BOSS_TUNING,bossMaxHp,createBoss} from '../../src/sim/boss.ts';
import {createStonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {SIEGE_FLAG,placeWall,siegeStep} from '../../src/sim/stonewards/wall.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {CAR_HIT_UNITS,createChaveiro} from '../../src/sim/chaveiro/system.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PRACA=city.asset.points.praca;
const world=()=>new SimWorld({terrain:city,seed:5,players:new Map<string,SimPlayer>(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
function addPlayer(w:SimWorld,id:string,armor=0){
  const player={id,classId:'x',hp:1000,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1000,armor},weaponReady:{},x:PRACA.x,y:PRACA.y,ack:0,score:0} as SimPlayer;
  w.players.set(id,player);return player;
}

test('one knob: ENEMY_POWER=3 is the hp and the damage, the horde share is a half', ()=>{
  assert.equal(ENEMY_POWER,3);assert.equal(ENEMY_HP,3);assert.equal(ENEMY_DAMAGE,3);assert.equal(HORDE_SHARE,.5);
});

test('halfHorde: half rounded up, at least 1 when there was any, none stays none', ()=>{
  assert.deepEqual([0,1,2,3,4,5,9,10,41].map(halfHorde),[0,1,1,2,2,3,5,5,21]);
});

test('createEnemy: every kind is born with 3× its def hp, on top of the caller scale', ()=>{
  const w=world();
  for(const kind of LEGACY_KINDS)for(const scale of [1,1.75,.35]){
    const e=createEnemy(w,kind,PRACA,scale);
    assert.equal(e.maxHp,Math.max(1,Math.round(ENEMIES[kind].hp*scale*3)),`${kind} ×${scale}`);
    assert.equal(e.hp,e.maxHp);
  }
});

test('the boss is born with 3× the bossMaxHp of its room', ()=>{
  for(const n of [1,4]){
    const w=world();
    for(let i=0;i<n;i++)addPlayer(w,`p${i}`);
    const boss=createBoss().spawnBoss(w,PRACA)!;
    assert.ok(boss,'spawned');
    assert.equal(boss.maxHp,Math.round(bossMaxHp(n,BOSS_TUNING)*3),`${n} heroes`);
  }
});

test('damagePlayer: a hero takes 3× the hit, before armor', ()=>{
  const w=world(),p=addPlayer(w,'a'),q=addPlayer(w,'b',2);
  w.damagePlayer('a',4);assert.equal(p.hp,1000-12);
  w.damagePlayer('b',4);assert.equal(q.hp,1000-(12-2),'armor comes off the tripled hit');
});

/**
 * The regular bodies (no elite, no mini-chefe, no boss) of planRound(round, players, seed 7) before this card (origin/main
 * f22ba48e, read with HORDE_SHARE=1). The table's count is cut to halfHorde of it.
 */
const BEFORE:Record<string,number>={"1:1":9,"1:2":26,"1:3":32,"1:4":46,"1:5":54,"1:6":76,"1:7":64,"1:8":72,"1:9":82,"1:10":30,"4:1":23,"4:2":53,"4:3":66,"4:4":94,"4:5":111,"4:6":156,"4:7":131,"4:8":148,"4:9":168,"4:10":61};
const regularOf=(round:number,players:number)=>planRound(round,players,{name:'x'},new Rng(7)).groups.filter(g=>!g.elite&&!g.boss&&!g.solo).reduce((n,g)=>n+g.members.length,0);

test('planRound: a round brings half its regular bodies (rounded up), solo and 4 heroes, every round', ()=>{
  for(const players of [1,4])for(let round=1;round<=ROUNDS.length;round++){
    const before=BEFORE[`${players}:${round}`];
    assert.equal(regularOf(round,players),Math.min(MAX_ROUND_ENEMIES,halfHorde(before)),`round ${round}, ${players} heroes (before ${before})`);
  }
});

test('planRound: the elite and the boss still come, one body each', ()=>{
  for(let round=1;round<=ROUNDS.length;round++){
    const plan=planRound(round,1,{name:'x'},new Rng(7));
    if(ROUNDS[round-1].elite)assert.equal(plan.groups.filter(g=>g.elite).reduce((n,g)=>n+g.members.length,0),1,`round ${round} elite`);
    if(ROUNDS[round-1].boss)assert.equal(plan.groups.filter(g=>g.boss).reduce((n,g)=>n+g.members.length,0),1,`round ${round} boss`);
  }
});

/** The map's sleepers of cityNestPlan (seed 3) before this card: they do not change in number. */
const SLEEPERS_BEFORE:Record<number,number>={1:820,4:1189};
const bodiesOf=(plan:NestPlan)=>plan.nests.reduce((n,x)=>n+x.sleepers.length,0)+plan.loose.reduce((n,b)=>n+b.members.length,0);

test('the map keeps its sleepers: the nest plan has the same bodies as before', ()=>{
  for(const players of [1,4])assert.equal(bodiesOf(cityNestPlan(city,3,{players})),SLEEPERS_BEFORE[players],`${players} heroes`);
});

test('structures take 3× too (ORQ 31/10): the wall through hitStructure and the siege, the Uno 3× its hit units', ()=>{
  const w=world(),sys=createStonewardsSystem({terrain:city,barricades:false,siegeContact:false});
  const hp0=sys.state.wall.hp;
  sys.hit(w,sys.state.wall.id,4);assert.equal(sys.state.wall.hp,hp0-12,'hitStructure ×3');
  const e=createEnemy(w,'bebado',{x:sys.state.wall.x,y:sys.state.wall.y});e.readyTick=0;e.memory={...e.memory,[SIEGE_FLAG]:1} as EnemyState['memory'];
  const before=sys.state.wall.hp;siegeStep(w,sys.state);
  assert.equal(sys.state.wall.hp,Math.max(0,before-e.damage*3),'the siege ×3');
  const P=city.asset.points,ENT={N:P.spawnN,S:P.spawnS,L:P.spawnL,O:P.spawnO};
  const car=createChaveiro({wallet:{seated:()=>[]},seed:7,grid:cityFlowGrid(new CityTerrain(city.asset,city.signature)),entrances:ENT,car:placeWall(city),onOutcome:()=>{}});
  car.hitCar(w,e);assert.equal(car.state.car.hits,CAR_HIT_UNITS.normal*3,'a normal blow is 3 hit units');
});
