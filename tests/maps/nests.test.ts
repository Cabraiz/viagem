/**
 * Ninhos (D-051, NEW-20261014-ORQ-mapa-vivo-ninhos slice 1): the Cidade Nevada's nest pool, the per-seed draw and its
 * sleepers, the loose and training bands, checked on the real asset against the four routes the chaveiro's moto may
 * take and the team's real start. Card NEW-20261022-ORQ-monstros-espalhados: the sleepers spread a gap apart, none in a
 * safe place. Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  CityTerrain,decodeCityAsset,worldBase,CITY_NEST_POOL,cityNestPlan,drawNests,validateNestPlan,routeDistance,quadrantOf,
  buildingNestSize,scaleSleepers,NEST_COUNT,NEST_FROM_CAR,NEST_FROM_ROUTE,NEST_FROM_START,NEST_YARD_RADIUS,POPULATION,TRAINING_FROM_CAR,
  TRAINING_MEMBERS,SPREAD,fieldTarget,FIELD_BODIES,LOOSE_FROM_CAR,LOOSE_FROM_START,spreadGap,localGap,citySafePlaces,safePlaceAt,SAFE_MIN_CELLS,
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
    else{
      const b=city.asset.blocks.find(k=>k.id===s.block&&k.kind==='building');
      assert.ok(b,`${s.id}: ${s.block} é prédio`);
      assert.equal(buildingNestSize(b!.bbox[2],b!.bbox[3]),s.maxSize,`${s.id}: o tamanho do prédio`);
    }
  }
  const quads=new Set(CITY_NEST_POOL.filter(s=>Math.hypot(s.x-start.x,s.y-start.y)>=NEST_FROM_START).map(s=>quadrantOf(s,car)));
  assert.equal(quads.size,4,'with the start keep-out, every quadrant still has a spot');
});

test('every seed draws a valid plan for 1 and 6 players (mix, quadrants, spacing, keep-outs, bodies on reachable ground)', () => {
  for(const seed of SEEDS.slice(0,12))for(const players of [1,6]){
    const plan=cityNestPlan(city,seed,{players,routes:ROUTES,start});
    assert.deepEqual(validateNestPlan(plan,city,{routes:ROUTES,start}),[],`seed ${seed}, ${players} jogador(es)`);
  }
});

/** The closest pair of bodies of a plan (u), by a bucket scan. */
function closestPair(plan:NestPlan){
  const all=[...plan.nests.flatMap(n=>n.sleepers),...plan.loose.flatMap(b=>b.members)],cell=4,grid=new Map<string,{x:number;y:number}[]>();
  let best=Infinity;
  for(const p of all){
    const cx=Math.floor(p.x/cell),cy=Math.floor(p.y/cell);
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)for(const o of grid.get(`${cx+dx},${cy+dy}`)??[])best=Math.min(best,Math.hypot(o.x-p.x,o.y-p.y));
    const k=`${cx},${cy}`;(grid.get(k)??grid.set(k,[]).get(k)!).push(p);
  }
  return best;
}

test('card monstros-espalhados: today\'s total per room (FIELD_BODIES × the player scale), no two bodies closer than the plan\'s gap, for 1 to 6 players', () => {
  assert.deepEqual([1,4,6].map(n=>fieldTarget(n)),[FIELD_BODIES,1189,1435]);
  assert.equal(SPREAD.gap,0,'the game draws the gap from the target');
  for(const seed of SEEDS.slice(0,4))for(const players of [1,3,6]){
    const plan=cityNestPlan(city,seed,{players,routes:ROUTES,start});
    assert.ok(plan.gap!<=spreadGap(players)&&plan.gap!>spreadGap(players)*.8,`gap ${plan.gap}`);
    // The user (22/10): today's horde, spread: 1p 3400, 4p 4930, 6p 5950 on the 1.7× city; the same density on the city
    // 1.75× shorter (mapa-175-com-viaduto, at today's gap): 1p 820, 4p 1189, 6p 1435.
    assert.equal(sleepersOf(plan)+looseOf(plan),fieldTarget(players),`seed ${seed}, ${players}: the total of today`);
    const d=closestPair(plan);
    assert.ok(d>=plan.gap!-1e-9,`seed ${seed}, ${players}: par a ${d.toFixed(2)} u (gap ${plan.gap})`);
  }
});

test('card monstros-espalhados: the field fills the city evenly, no clumps and no holes (every open spot beyond the keep-offs has a body within 2 local gaps; no 3 u disc holds more than 1)', () => {
  const plan=cityNestPlan(city,SEEDS[1],{routes:ROUTES,start}),all=[...plan.nests.flatMap(n=>n.sleepers),...plan.loose.flatMap(b=>b.members)];
  const a=city.asset,inSafe=(x:number,y:number)=>!!safePlaceAt(city,{x,y});
  let holes=0,checked=0,crowd=0;
  for(let y=a.playable.y+3;y<a.playable.y+a.playable.h;y+=7)for(let x=a.playable.x+3;x<a.playable.x+a.playable.w;x+=7){
    if(!city.clearDisc(x,y,1)||inSafe(x,y))continue;
    if(Math.hypot(x-car.x,y-car.y)<LOOSE_FROM_CAR+8||Math.hypot(x-start.x,y-start.y)<LOOSE_FROM_START+8)continue;
    checked++;
    const r=2*localGap({x,y},plan.gap!,car,ROUTES);
    if(!all.some(p=>Math.hypot(p.x-x,p.y-y)<=r))holes++;
    // A disc of radius gap/2 holds at most one body when they stand a gap apart; 3 u is under that.
    if(all.filter(p=>Math.hypot(p.x-x,p.y-y)<=Math.min(3,plan.gap!/2-.01)).length>1)crowd++;
  }
  assert.ok(checked>100,`${checked} pontos`);
  // A spot can be open ground cut off from the car (a closed yard): a few holes are walls, not the draw.
  assert.ok(holes/checked<.03,`${holes} buracos em ${checked}`);
  assert.equal(crowd,0,'nenhum bolo');
});

test('card monstros-espalhados: the city has safe places (one narrow opening each) and no body is ever inside one, for any seed', () => {
  const safe=citySafePlaces(city);
  assert.ok(safe.length>=5,`${safe.length} lugares seguros`);
  for(const s of safe)assert.ok(s.area>=SAFE_MIN_CELLS&&s.cells.size===s.area);
  assert.equal(safePlaceAt(city,{x:car.x,y:car.y}),undefined,'the plaza is not a safe place');
  for(const seed of SEEDS.slice(0,6)){
    const plan=cityNestPlan(city,seed,{players:seed%6+1,routes:ROUTES,start});
    for(const p of [...plan.nests.flatMap(n=>n.sleepers),...plan.loose.flatMap(b=>b.members)])
      assert.equal(safePlaceAt(city,p),undefined,`seed ${seed}: corpo em (${p.x}, ${p.y}) dentro de ${safePlaceAt(city,p)?.id}`);
  }
});

test('more players or a bigger population pack the field tighter; population 1 is a light city (≈ 1/20)', () => {
  const seed=SEEDS[2],count=(p:NestPlan)=>sleepersOf(p)+looseOf(p);
  const one=cityNestPlan(city,seed,{routes:ROUTES,start}),six=cityNestPlan(city,seed,{players:6,routes:ROUTES,start});
  const light=cityNestPlan(city,seed,{routes:ROUTES,start,population:1});
  assert.ok(count(six)>count(one)*1.3,`6 jogadores ${count(six)} × 1 jogador ${count(one)}`);
  assert.equal(count(light),fieldTarget(1,1),`população 1: ${count(light)}`);assert.equal(fieldTarget(1,1),41);
  assert.equal(light.population,1);assert.equal(one.population,undefined);
  assert.equal(POPULATION,20);
  // Every nest keeps some sleepers in its yard (its wake, its groups' exits).
  for(const n of one.nests)assert.ok(n.sleepers.length>=3,`${n.id}: ${n.sleepers.length} dormindo`);
});

test('a start in a corner (no eligible spot left in its quadrant) still draws 8 nests, all clear of it', () => {
  const corner={x:60,y:50};
  for(const seed of SEEDS.slice(0,8)){
    const nests=drawNests(seed,car,corner);
    assert.equal(nests.length,NEST_COUNT);
    assert.ok(nests.every(n=>Math.hypot(n.spot.x-corner.x,n.spot.y-corner.y)>=NEST_FROM_START),`seed ${seed}`);
  }
});

test('four training bands, one per mouth, 25–35 u from the car, their members a gap apart; the field is sparser along the moto routes and near the plaza', () => {
  for(const seed of SEEDS.slice(0,8)){
    const plan=cityNestPlan(city,seed,{routes:ROUTES,start}),training=plan.loose.filter(b=>b.training);
    assert.equal(training.length,4,`seed ${seed}`);
    for(const b of training){
      const d=Math.hypot(b.x-car.x,b.y-car.y);
      assert.ok(d>=TRAINING_FROM_CAR[0]-1&&d<=TRAINING_FROM_CAR[1]+1,`seed ${seed}: treino a ${d.toFixed(1)} u`);
      assert.equal(b.members.length,scaleSleepers(TRAINING_MEMBERS,1));
    }
    for(const p of plan.loose.filter(b=>!b.training).flatMap(b=>b.members))assert.ok(Math.hypot(p.x-car.x,p.y-car.y)>=LOOSE_FROM_CAR);
  }
  const mid={x:car.x+LOOSE_FROM_CAR,y:car.y},far={x:car.x+200,y:car.y};
  assert.ok(localGap(mid,4,car,[])>localGap(far,4,car,[]),'sparser near the plaza');
  assert.ok(localGap(ROUTES[0][Math.floor(ROUTES[0].length*.8)],4,{x:-999,y:-999},ROUTES)>4,'sparser on a route');
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

test('the validator catches a nest on the moto\'s route, one by the car, a body in the plaza, two bodies too close and one in a safe place', () => {
  const plan=cityNestPlan(city,9,{routes:ROUTES,start,population:1});
  const onRoute=ROUTES[0][Math.floor(ROUTES[0].length/2)];
  const broken:NestPlan={...plan,nests:[{...plan.nests[0],x:onRoute.x,y:onRoute.y},{...plan.nests[1],x:car.x+10,y:car.y},...plan.nests.slice(2)],
    loose:[...plan.loose,{x:car.x+2,y:car.y+2,training:false,members:[{x:car.x+2,y:car.y+2}]}]};
  const reasons=validateNestPlan(broken,city,{routes:ROUTES,start}).map(p=>p.reason).join(' | ');
  assert.match(reasons,/rota da moto/);
  assert.match(reasons,/do carro/);
  const big=plan.nests.find(n=>n.kind==='predio'&&n.size==='P');
  if(big){
    const swollen:NestPlan={...plan,nests:plan.nests.map(n=>n===big?{...n,size:'G' as const}:n)};
    assert.match(validateNestPlan(swollen,city,{routes:ROUTES,start}).map(p=>p.reason).join(' | '),/não cabe um ninho G/);
  }
  const some=plan.loose.find(b=>!b.training)!,p0=some.members[0];
  const close:NestPlan={...plan,loose:[...plan.loose,{x:p0.x,y:p0.y,training:false,members:[{x:p0.x+plan.gap!/3,y:p0.y}]}]};
  assert.match(validateNestPlan(close,city,{routes:ROUTES,start}).map(p=>p.reason).join(' | '),/a menos de/);
  const s0=citySafePlaces(city)[0],cs=city.asset.unitsPerCell,w=city.asset.cells.w,k=[...s0.cells][Math.floor(s0.cells.size/2)];
  const inside={x:(k%w+.5)*cs,y:(Math.floor(k/w)+.5)*cs};
  const hidden:NestPlan={...plan,loose:[...plan.loose,{...inside,training:false,members:[inside]}]};
  assert.match(validateNestPlan(hidden,city,{routes:ROUTES,start}).map(p=>p.reason).join(' | '),/lugar seguro/);
});
