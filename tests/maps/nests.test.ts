/**
 * Ninhos (D-051, NEW-20261014-ORQ-mapa-vivo-ninhos slice 1): the Cidade Nevada's nest pool, the per-seed draw and its
 * sleepers, the loose and training bands, checked on the real asset against the four routes the chaveiro's moto may
 * take and the team's real start. Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  CityTerrain,decodeCityAsset,worldBase,CITY_NEST_POOL,cityNestPlan,drawNests,validateNestPlan,routeDistance,quadrantOf,
  NEST_COUNT,NEST_FROM_CAR,NEST_FROM_ROUTE,NEST_FROM_START,NEST_SLEEPERS,NEST_YARD_RADIUS,LOOSE_TOTAL,LOOSE_NEAR_ROUTE,TRAINING_FROM_CAR,
  type NestPlan,
} from '../../src/maps/index.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {ENTRANCES,planChaveiro} from '../../src/sim/chaveiro/system.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {cityRunStart} from '../../src/sim/city/tutorial.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const city=new CityTerrain(decoded.asset,'test'),P=city.asset.points,car=placeWall(city),start=cityRunStart(city);
const grid=cityFlowGrid(city),ENT={N:P.spawnN,S:P.spawnS,L:P.spawnL,O:P.spawnO};
/** The moto's four possible routes (the entrance is the only thing a seed changes in the path). */
const ROUTES=ENTRANCES.map(e=>planChaveiro(1,grid,ENT,car,e).route.points);
const SEEDS=Array.from({length:24},(_,i)=>i*7919+3);
const sleepersOf=(plan:NestPlan)=>plan.nests.reduce((n,x)=>n+x.sleepers.length,0);
const looseOf=(plan:NestPlan)=>plan.loose.reduce((n,b)=>n+b.members.length,0);

test('the car the nests keep away from is the plaza wall the sim places', () => {
  assert.ok(Math.hypot(worldBase(city).x-car.x,worldBase(city).y-car.y)<.01);
});

test('every pool spot is a nest the city can hold: far from the car and all four moto routes, on its building or a yard of its size', () => {
  for(const s of CITY_NEST_POOL){
    assert.ok(Math.hypot(s.x-car.x,s.y-car.y)>=NEST_FROM_CAR,`${s.id} a ≥ ${NEST_FROM_CAR} u do carro`);
    for(const r of ROUTES)assert.ok(routeDistance(s,r)>=NEST_FROM_ROUTE,`${s.id} a ≥ ${NEST_FROM_ROUTE} u das rotas`);
    if(s.kind==='terreno')assert.ok(city.clearDisc(s.x,s.y,NEST_YARD_RADIUS[s.maxSize]),`${s.id}: o pátio cabe ${s.maxSize}`);
    else assert.ok(city.asset.blocks.some(b=>b.id===s.block&&b.kind==='building'),`${s.id}: ${s.block} é prédio`);
  }
  const quads=new Set(CITY_NEST_POOL.filter(s=>Math.hypot(s.x-start.x,s.y-start.y)>=NEST_FROM_START).map(s=>quadrantOf(s,car)));
  assert.equal(quads.size,4,'with the start keep-out, every quadrant still has a spot');
});

test('every seed draws a valid plan for 1 and 6 players (mix, quadrants, spacing, keep-outs, bodies on reachable ground)', () => {
  for(const seed of SEEDS)for(const players of [1,6]){
    const plan=cityNestPlan(city,seed,{players,routes:ROUTES,start});
    assert.deepEqual(validateNestPlan(plan,city,{routes:ROUTES,start}),[],`seed ${seed}, ${players} jogador(es)`);
  }
});

test('the population: 110 asleep in the nests and 60 loose for one player, ≤ 320 asleep for six', () => {
  for(const seed of SEEDS){
    const one=cityNestPlan(city,seed,{routes:ROUTES,start}),six=cityNestPlan(city,seed,{players:6,routes:ROUTES,start});
    assert.equal(sleepersOf(one),2*NEST_SLEEPERS.G+3*NEST_SLEEPERS.M+3*NEST_SLEEPERS.P,`seed ${seed}: dormindo nos ninhos`);
    assert.equal(looseOf(one),LOOSE_TOTAL,`seed ${seed}: soltos`);
    assert.ok(sleepersOf(six)+looseOf(six)<=320,`seed ${seed}: 6 jogadores ≤ 320 (${sleepersOf(six)+looseOf(six)})`);
    assert.ok(sleepersOf(six)+looseOf(six)>sleepersOf(one)+looseOf(one),`seed ${seed}: mais gente, mais bicho`);
  }
});

test('four training bands, one per mouth, 25–35 u from the car; the other bands keep off the moto routes (one band each at most)', () => {
  for(const seed of SEEDS){
    const plan=cityNestPlan(city,seed,{routes:ROUTES,start}),training=plan.loose.filter(b=>b.training);
    assert.equal(training.length,4,`seed ${seed}`);
    for(const b of training){
      const d=Math.hypot(b.x-car.x,b.y-car.y);
      assert.ok(d>=TRAINING_FROM_CAR[0]-1&&d<=TRAINING_FROM_CAR[1]+1,`seed ${seed}: treino a ${d.toFixed(1)} u`);
    }
    for(const r of ROUTES)assert.ok(plan.loose.filter(b=>!b.training&&routeDistance(b,r)<LOOSE_NEAR_ROUTE).length<=1,`seed ${seed}: ≤ 1 bando perto de cada rota`);
  }
});

test('the draw is the seed\'s: the same seed gives the same plan, different seeds vary the nests', () => {
  assert.deepEqual(cityNestPlan(city,77,{routes:ROUTES,start}),cityNestPlan(city,77,{routes:ROUTES,start}));
  const sets=new Set(SEEDS.map(seed=>drawNests(seed,car,start).map(n=>`${n.spot.id}:${n.size}`).sort().join(',')));
  assert.ok(sets.size>=SEEDS.length/2,`${sets.size} sorteios diferentes em ${SEEDS.length} seeds`);
  const used=new Set(SEEDS.flatMap(seed=>drawNests(seed,car,start).map(n=>n.spot.id)));
  const eligible=CITY_NEST_POOL.filter(s=>Math.hypot(s.x-start.x,s.y-start.y)>=NEST_FROM_START);
  assert.equal(used.size,eligible.length,'every eligible spot comes out on some seed');
  assert.equal(drawNests(5,car,start).length,NEST_COUNT);
});

test('the validator catches a nest on the moto\'s route, one by the car and a band in the plaza', () => {
  const plan=cityNestPlan(city,9,{routes:ROUTES,start});
  const onRoute=ROUTES[0][Math.floor(ROUTES[0].length/2)];
  const broken:NestPlan={...plan,nests:[{...plan.nests[0],x:onRoute.x,y:onRoute.y},{...plan.nests[1],x:car.x+10,y:car.y},...plan.nests.slice(2)],
    loose:[...plan.loose,{x:car.x+2,y:car.y+2,training:false,members:[{x:car.x+2,y:car.y+2}]}]};
  const reasons=validateNestPlan(broken,city,{routes:ROUTES,start}).map(p=>p.reason).join(' | ');
  assert.match(reasons,/rota da moto/);
  assert.match(reasons,/do carro/);
});
