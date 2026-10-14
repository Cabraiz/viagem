/**
 * D-047, the chaveiro objective (card NEW-20261013-ORQ-objetivo-chaveiro, src/sim/chaveiro/): on the REAL Cidade Nevada.
 *  - Unit rigs: a SimWorld of the city with no systems, the ChaveiroSystem stepped by hand and enemies/players placed
 *    by hand (the route, the alarm, the limit, the tranco, the bump, the deliveries, the fall, Dona Cida, the bill,
 *    the boss call).
 *  - The director's waves (DirectorOptions.endlessWaves): no boss, waves after the last round repeat it, count × 1.1ⁿ.
 *  - An assembled city run with the objective (createRunSystems objective 'chaveiro'): checkpoint at an intermission,
 *    restored on a fresh world, plays on with the same state hash.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import type {Point} from '../../src/maps/world.ts';
import {BASE_STATS,CAR_ID,Rng,CIDA_ITEMS,SIM_HZ,ticks,type EnemyState,type SimPlayer,type StampedEvent} from '../../src/contract/index.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {createDirector} from '../../src/sim/director.ts';
import {SUGAR,coachMult,createEnemy,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {BOSS_SIEGE_EVERY,BOSS_SIEGE_REACH,createBoss} from '../../src/sim/boss.ts';
import {pointAt} from '../../src/sim/chaveiro/route.ts';
import {ABRINDO_SECONDS,ALARM_MAX_SECONDS,ALARM_PER_HIT_SECONDS,BOSS_ETA_SECONDS,BUDGET_BASE,BUDGET_PER_HIT,CAR_HIT_UNITS,CAR_LIMIT,CAR_STOP,
  CIDA_STOCK,ENTREGA_CLEAN_SECONDS,ENTREGA_SECONDS,LOMBADAS,LOMBADA_SECONDS,MORTA_ALONE_SECONDS,lombadaLength,PUSH_SECONDS,SALE_GAP_SECONDS,
  TOMBO_GAP_SECONDS,TOMBO_SECONDS,createChaveiro,planChaveiro,type ChaveiroSystem} from '../../src/sim/chaveiro/system.ts';
import {ROUND_COUNT,planRound} from '../../src/rules/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PTS=city.asset.points;
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
const CAR=placeWall(city);

interface Rig {world:SimWorld;sys:ChaveiroSystem;outcomes:string[];bosses:{tick:number;at:Point}[];events:StampedEvent[];step(n?:number):StampedEvent[]}
function rig(seed=7):Rig{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const outcomes:string[]=[],bosses:{tick:number;at:Point}[]=[],events:StampedEvent[]=[];
  const sys=createChaveiro({seed,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:o=>outcomes.push(o),spawnBoss:(ctx,at)=>bosses.push({tick:ctx.tick,at})});
  const step=(n=1)=>{
    const got:StampedEvent[]=[];
    for(let i=0;i<n;i++){world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);got.push(...world.flush());}
    events.push(...got);return got;
  };
  return {world,sys,outcomes,bosses,events,step};
}
function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
function addEnemy(world:SimWorld,id:string,p:Point,extra:Partial<EnemyState>={}){
  const e:EnemyState={id,kind:'bebado',x:p.x,y:p.y,hp:10,maxHp:10,speed:1,damage:5,radius:.4,xp:1,spawnTick:0,readyTick:0,...extra};
  world.enemies.set(id,e);return e;
}
/** Puts the moto riding just before stop `i` (or `s` u along the route when no stop is given). */
function before(r:Rig,i:number,gap=.001){
  const m=r.sys.state.moto;m.task='anda';m.stop=i;m.s=r.sys.stops[i].s-gap;m.left=0;m.push=0;
}
const stopIndex=(r:Rig,kind:string,nth=0)=>r.sys.stops.map((o,i)=>({o,i})).filter(x=>x.o.kind===kind)[nth].i;
const ofType=(events:readonly StampedEvent[],type:string)=>events.filter(e=>e.type===type);
const stopPoint=(r:Rig,i:number)=>pointAt(r.sys.route,r.sys.stops[i].s);

test('route: drawn from the seed (same seed, same route and stops; restore rebuilds it), entrance to the car, stops apart',()=>{
  const a=planChaveiro(11,OPEN,ENTRANCES,CAR),b=planChaveiro(11,OPEN,ENTRANCES,CAR);
  assert.deepEqual(b,a);
  const froms=new Set<string>();
  for(let seed=1;seed<=24;seed++){
    const p=planChaveiro(seed,OPEN,ENTRANCES,CAR);froms.add(p.from);
    const first=p.route.points[0],last=p.route.points[p.route.points.length-1],start=ENTRANCES[p.from];
    assert.deepEqual(first,{x:start.x,y:start.y});
    // Within 0.6 of a city cell (0.6 u at 0.88 u; the route ends in a grid cell: cidade-escala-1-7's 1.496 u cell).
    assert.ok(Math.abs(Math.hypot(last.x-CAR.x,last.y-CAR.y)-CAR_STOP)<.6*city.asset.unitsPerCell/.88,`ends next to the car: ${Math.hypot(last.x-CAR.x,last.y-CAR.y)}`);
    // Map-relative (the city may scale): the streets are longer than the straight line, but not a maze.
    const line=Math.hypot(start.x-CAR.x,start.y-CAR.y);
    assert.ok(p.route.length>=line-CAR_STOP-.6&&p.route.length<line*2,`route ${p.route.length} u for ${line} u straight`);
    assert.ok(p.route.points.length<40,`simplified: ${p.route.points.length} points`);
    assert.deepEqual(p.stops.map(o=>o.kind).sort(),['entrega','entrega','entrega','lombada','lombada','lombada','morta','morta','morta']);
    for(let i=1;i<p.stops.length;i++){
      const prev=p.stops[i-1];
      assert.ok(p.stops[i].s>=prev.s+(prev.kind==='lombada'?lombadaLength(p.route.length):0),`stops in order, a bump never overlaps the next (seed ${seed})`);
    }
  }
  assert.ok(froms.size>=3,`entrances vary with the seed: ${[...froms]}`);
  // A restored system (from its state only) rebuilds the same route and stops.
  const r=rig(5);r.step(200);
  const again=createChaveiro({seed:5,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:()=>{}},structuredClone(r.sys.state));
  assert.deepEqual(again.route,r.sys.route);assert.deepEqual(again.stops,r.sys.stops);
  assert.ok(r.sys.state.moto.s>0,'the moto rode');
  // The view carries the static route and stops.
  const v=r.sys.view(r.world.tick);
  assert.equal(v.route.length,r.sys.route.points.length);assert.equal(v.stops.length,9);assert.equal(v.kind,'chaveiro');
});

test('map scale: on the city scaled 1.7× the route is 1.7× longer, the stops sit at the same fractions and every timing is the same',()=>{
  const K=1.7,grid={...OPEN,cellSize:OPEN.cellSize*K,walkable:OPEN.walkable.bind(OPEN)};
  const scale=(p:Point)=>({x:p.x*K,y:p.y*K});
  const big={N:scale(ENTRANCES.N),S:scale(ENTRANCES.S),L:scale(ENTRANCES.L),O:scale(ENTRANCES.O)};
  for(const seed of [3,8,13]){
    const a=planChaveiro(seed,OPEN,ENTRANCES,CAR),b=planChaveiro(seed,grid,big,scale(CAR));
    assert.equal(b.from,a.from);
    const ratio=b.route.length/a.route.length;
    assert.ok(Math.abs(ratio-K)<.05,`length ratio ${ratio}`);
    assert.deepEqual(b.stops.map(o=>[o.kind,(o.s/b.route.length).toFixed(9)]),a.stops.map(o=>[o.kind,(o.s/a.route.length).toFixed(9)]));
    const sa=createChaveiro({seed,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:()=>{}});
    const sb=createChaveiro({seed,grid,entrances:big,car:scale(CAR),onOutcome:()=>{}});
    assert.ok(Math.abs(sa.eta(0)-sb.eta(0))<1e-6,`ETA ${sa.eta(0)} vs ${sb.eta(0)}`);
  }
});

test('car hit: alarm (+1.5 s per hit, at most 8 s ahead), the moto rides around the block and stalls only while it sounds',()=>{
  const r=rig();r.step(20);
  const s0=r.sys.state.moto.s,tick=r.world.tick;
  r.sys.hitCar(r.world,addEnemy(r.world,'e1',CAR));
  assert.equal(r.sys.state.car.alarmUntil,tick+ticks(ALARM_PER_HIT_SECONDS));
  assert.equal(r.sys.state.budget,BUDGET_BASE+BUDGET_PER_HIT);
  const ev=r.world.flush();
  assert.equal(ofType(ev,'alarm').length,1);
  assert.deepEqual(ofType(ev,'structure').map(e=>e.type==='structure'&&[e.id,e.hp,e.maxHp]),[[CAR_ID,CAR_LIMIT-1,CAR_LIMIT]]);
  const got=r.step(ticks(ALARM_PER_HIT_SECONDS)-1);
  assert.equal(r.sys.state.moto.s,s0,'no progress while the alarm sounds');
  assert.equal(r.sys.state.moto.mode,'volta');
  assert.deepEqual(ofType(got,'moto').map(e=>e.type==='moto'&&e.mode),['volta']);
  r.step(2);
  assert.ok(r.sys.state.moto.s>s0,'rides again when it stops');assert.equal(r.sys.state.moto.mode,'anda');
  // A crowd: 60 hits in one tick never push the alarm past 8 s, and only the first one starts it.
  const crowd=rig();crowd.step(5);crowd.world.flush();
  for(let i=0;i<60;i++)crowd.sys.hitCar(crowd.world,addEnemy(crowd.world,`c${i}`,CAR));
  assert.equal(crowd.sys.state.car.alarmUntil,crowd.world.tick+ticks(ALARM_MAX_SECONDS));
  assert.equal(ofType(crowd.world.flush(),'alarm').length,1);
  const s1=crowd.sys.state.moto.s;crowd.step(ticks(ALARM_MAX_SECONDS)+1);
  assert.ok(crowd.sys.state.moto.s>s1,'the delay is bounded by real time');
});

test('car limit: elite 3 and boss 3 hits, parts at 25/50/75/90 %, perda total at the limit (defeat, once)',()=>{
  const r=rig();r.step(2);r.world.flush();
  r.sys.hitCar(r.world,addEnemy(r.world,'el',CAR,{elite:true}));
  assert.equal(r.sys.state.car.hits,3);
  r.sys.hitCar(r.world,addEnemy(r.world,'bo',CAR,{boss:true}));
  assert.equal(r.sys.state.car.hits,6);assert.equal(r.sys.state.budget,BUDGET_BASE+6*BUDGET_PER_HIT);
  const normal=addEnemy(r.world,'n',CAR);
  while(r.sys.state.car.hits<CAR_LIMIT)r.sys.hitCar(r.world,normal);
  const ev=r.world.flush();
  assert.deepEqual(ofType(ev,'part').map(e=>e.type==='part'&&e.name),['para-choque','retrovisor','porta','capo']);
  assert.equal(r.sys.state.car.parts,15);
  assert.deepEqual(r.outcomes,['defeat']);assert.equal(r.sys.state.ended,'defeat');
  r.sys.hitCar(r.world,normal);r.step(5);
  assert.deepEqual(r.outcomes,['defeat'],'reported once');assert.deepEqual(r.sys.targets(),[]);
  const res=r.sys.result(r.world.tick,r.world.round)!;assert.equal(res.cause,'car');
  assert.equal(res.outcome,'defeat');assert.equal(res.hits,CAR_LIMIT);assert.ok(res.eta>0);
  // The last blow past the limit bills only the hits left (budget = base + R$ 8 per hit taken).
  const over=rig();over.step(2);over.sys.state.car.hits=CAR_LIMIT-1;
  over.sys.hitCar(over.world,addEnemy(over.world,'el2',CAR,{elite:true}));
  assert.equal(over.sys.state.car.hits,CAR_LIMIT);assert.equal(over.sys.state.budget,BUDGET_BASE+BUDGET_PER_HIT);
});

test('moto morta: two players push it in 4 s (tranco); alone, or one player, it starts by itself after 75 s',()=>{
  for(const pushers of [2,1,0]){
    const r=rig();const i=stopIndex(r,'morta');before(r,i);
    r.step(1);assert.equal(r.sys.state.moto.task,'morta');assert.equal(r.sys.state.moto.mode,'morta');
    const p=stopPoint(r,i);
    for(let k=0;k<pushers;k++)addPlayer(r.world,`p${k}`,{x:p.x+.5*k,y:p.y+1});
    assert.ok(r.sys.view(r.world.tick).moto.push===0);
    const need=pushers>=2?ticks(PUSH_SECONDS):ticks(MORTA_ALONE_SECONDS);
    r.step(need-1);assert.equal(r.sys.state.moto.task,'morta',`${pushers}: still dead`);
    const got=r.step(1);
    assert.equal(r.sys.state.moto.task,'anda',`${pushers}: started`);
    assert.deepEqual(ofType(got,'moto').map(e=>e.type==='moto'&&[e.mode,e.alone??false]),[['tranco',pushers<2]]);
    assert.equal(r.sys.state.moto.stop,i+1);
  }
  // Pushing is accumulated: 2 s, away, 2 s more.
  const r=rig();const i=stopIndex(r,'morta',1);before(r,i);r.step(1);
  const p=stopPoint(r,i),a=addPlayer(r.world,'a',{x:p.x,y:p.y+1}),b=addPlayer(r.world,'b',{x:p.x+1,y:p.y});
  r.step(ticks(2));a.x+=10;r.step(ticks(10));a.x-=10;
  assert.equal(r.sys.view(r.world.tick).moto.push,.5);
  r.step(ticks(2));assert.equal(r.sys.state.moto.task,'anda');
  void b;
});

test('lombada: ~11 s crawling at half the moto speed (a time, so a scaled map keeps it)',()=>{
  const r=rig();const i=stopIndex(r,'lombada');before(r,i,0);
  const got=r.step(1);assert.equal(r.sys.state.moto.mode,'lombada');
  assert.deepEqual(ofType(got,'moto').map(e=>e.type==='moto'&&e.mode),['lombada']);
  let n=1;while(r.sys.state.moto.task==='lombada'){r.step(1);n++;}
  assert.ok(Math.abs(n-ticks(LOMBADA_SECONDS))<=2,`${n} ticks for the bump`);
  assert.equal(LOMBADAS,r.sys.stops.filter(o=>o.kind==='lombada').length);
});

test('delivery: 25 s when an enemy is within 6 u of the point at arrival, 6 s when the team cleared it; the view marks it',()=>{
  for(const dirty of [true,false]){
    const r=rig();const i=stopIndex(r,'entrega');before(r,i,.5);
    const p=stopPoint(r,i);
    if(dirty)addEnemy(r.world,'d',{x:p.x+4,y:p.y});
    else addEnemy(r.world,'far',{x:p.x+6.5,y:p.y});
    const v=r.sys.view(r.world.tick);
    assert.ok(v.delivery&&Math.hypot(v.delivery.x-p.x,v.delivery.y-p.y)<1e-9,'the next delivery point');
    assert.ok(v.delivery!.etaS>0&&v.delivery!.etaS<10,`${v.delivery!.etaS} s ahead`);
    while(r.sys.state.moto.task!=='entrega')r.step(1);
    const left=r.sys.state.moto.left;
    assert.equal(left,ticks(dirty?ENTREGA_SECONDS:ENTREGA_CLEAN_SECONDS));
    r.step(left);assert.equal(r.sys.state.moto.task,'anda');assert.equal(r.sys.state.moto.stop,i+1);
  }
});

test('tombo: an enemy touching the riding moto knocks it over for 4 s, then not again for 6 s',()=>{
  const r=rig();r.step(10);
  const m=r.sys.moto(),e=addEnemy(r.world,'t',{x:m.x+.5,y:m.y});
  const got=r.step(1);
  assert.equal(r.sys.state.moto.mode,'tombo');assert.deepEqual(ofType(got,'moto').map(x=>x.type==='moto'&&x.mode),['tombo']);
  const s=r.sys.state.moto.s;
  r.step(ticks(TOMBO_SECONDS)-1);assert.equal(r.sys.state.moto.s,s,'down: no progress');
  r.step(1);assert.equal(r.sys.state.moto.mode,'anda');
  // Still touching (the enemy follows): it rides during the gap.
  const follow=()=>{const q=r.sys.moto();e.x=q.x+.5;e.y=q.y;};
  for(let k=0;k<ticks(TOMBO_GAP_SECONDS)-1;k++){follow();r.step(1);assert.equal(r.sys.state.moto.mode,'anda');}
  follow();r.step(1);assert.equal(r.sys.state.moto.mode,'tombo');
  // The moto is a siege target only while riding, within the lure reach.
  const t=r.sys.targets().find(x=>x.id==='moto');assert.ok(t&&t.reach===6);
});

test('Dona Cida: the team buys near the moto (refusals: away, stock, grana, phase, item); she sells to an enemy every 20 s',()=>{
  const r=rig();r.step(2);
  const m=r.sys.moto(),p=addPlayer(r.world,'p',{x:m.x+1,y:m.y});
  assert.deepEqual(r.sys.buy(r.world,'p','brigadeiro'),{ok:false,reason:'grana'});
  r.sys.state.grana=200;
  assert.deepEqual(r.sys.buy(r.world,'p','pastel'),{ok:false,reason:'item'});
  assert.deepEqual(r.sys.buy(r.world,'ghost','pacoca'),{ok:false,reason:'phase'});
  p.x+=5;assert.deepEqual(r.sys.buy(r.world,'p','pacoca'),{ok:false,reason:'away'});p.x-=5;
  const tick=r.world.tick;
  for(const item of CIDA_ITEMS)assert.equal(r.sys.buy(r.world,'p',item.id).ok,true);
  assert.equal(r.sys.state.grana,200-15-25-20);
  assert.equal(p.fastUntil,tick+ticks(30));assert.equal(p.mightUntil,tick+ticks(30));assert.equal(p.guardUntil,tick+ticks(30));
  assert.deepEqual(ofType(r.world.flush(),'buy').map(e=>e.type==='buy'&&e.item),['brigadeiro','pacoca','cocada']);
  for(let k=1;k<CIDA_STOCK;k++)assert.equal(r.sys.buy(r.world,'p','cocada').ok,true);
  assert.deepEqual(r.sys.buy(r.world,'p','cocada'),{ok:false,reason:'stock'});
  assert.deepEqual(r.sys.state.cida.stock,[CIDA_STOCK-1,CIDA_STOCK-1,0]);
  p.hp=0;p.downed={sinceTick:0,bleedOutTick:1e9,progress:0};
  assert.deepEqual(r.sys.buy(r.world,'p','pacoca'),{ok:false,reason:'phase'});
  // The buffs: damage dealt × 1.3, damage taken × 0.7 (core), walking × 1.25 (players step / prediction).
  const q=addPlayer(r.world,'q',{x:m.x,y:m.y+1});q.stats.armor=0;
  q.guardUntil=r.world.tick+100;r.world.damagePlayer('q',10);assert.equal(q.hp,1e6-7);
  const target=addEnemy(r.world,'dummy',{x:0,y:0},{hp:100,maxHp:100});
  q.mightUntil=r.world.tick+100;r.world.damageEnemy('dummy',10,'q');assert.equal(target.hp,100-13);
  // Sales to enemies (stock untouched): the nearest within 3 u, then a 20 s gap.
  const stock=[...r.sys.state.cida.stock];
  const near=r.sys.moto(),a=addEnemy(r.world,'a',{x:near.x+2,y:near.y});
  const got=r.step(1);
  assert.deepEqual(ofType(got,'sale').map(e=>e.type==='sale'&&e.enemy),['a']);
  assert.equal((a as EnemyState&{sugarUntil?:number}).sugarUntil,r.world.tick+SUGAR.duration);
  assert.deepEqual(r.sys.state.cida.stock,stock);
  // Sugar: × 1.3 on every hit (coachMult) and × 1.2 on the walk (enemy-ai paceSpeed, under the peak cap), checked right
  // after a's own sale: 20 s later it has worn off unless a wins the next sale too (cidade-escala-1-7: the moto runs the
  // 1.7× route in the same 420 s, so a is out of reach by then).
  assert.equal(coachMult(a,r.world.tick),SUGAR.damage);
  const ai=createEnemyAi({heroSpeed:10});
  assert.equal(ai.paceSpeed(a,1,r.world.tick),a.speed*SUGAR.speed);
  assert.equal(ai.paceSpeed(a,1,(a as {sugarUntil?:number}).sugarUntil!),a.speed);
  const b=addEnemy(r.world,'b',{x:near.x,y:near.y+2});
  let sales=0;
  for(let k=0;k<ticks(SALE_GAP_SECONDS)-1;k++){const mm=r.sys.moto();b.x=mm.x;b.y=mm.y+2;sales+=ofType(r.step(1),'sale').length;}
  assert.equal(sales,0,'one sale per 20 s');
  const mm=r.sys.moto();b.x=mm.x;b.y=mm.y+2;
  assert.equal(ofType(r.step(1),'sale').length,1);
});

test('the bill: kills pay Grana (1/5/50), abrindo 15 s at the car, victory with budget, paid and debt',()=>{
  for(const grana of [0,500]){
    const r=rig();r.step(2);
    r.sys.onKill(addEnemy(r.world,'k1',CAR));r.sys.onKill(addEnemy(r.world,'k2',CAR,{elite:true}));r.sys.onKill(addEnemy(r.world,'k3',CAR,{boss:true}));
    assert.equal(r.sys.state.grana,56);
    r.sys.state.grana=grana;
    for(let k=0;k<5;k++)r.sys.hitCar(r.world,addEnemy(r.world,`h${k}`,CAR));
    const m=r.sys.state.moto;m.stop=r.sys.stops.length;m.s=r.sys.route.length-1e-4;
    while(r.world.tick+1<r.sys.state.car.alarmUntil)r.step(1);
    assert.equal(m.task,'anda');assert.equal(m.mode,'volta');
    const got=r.step(1);
    assert.equal(m.task,'abrindo');
    assert.deepEqual(ofType(got,'moto').map(e=>e.type==='moto'&&e.mode),['chegou','abrindo']);
    r.step(ticks(ABRINDO_SECONDS)-1);assert.deepEqual(r.outcomes,[]);
    r.step(1);assert.deepEqual(r.outcomes,['victory']);
    const res=r.sys.result(r.world.tick,r.world.round)!,budget=BUDGET_BASE+5*BUDGET_PER_HIT;
    assert.deepEqual({budget:res.budget,paid:res.paid,debt:res.debt,eta:res.eta,hits:res.hits},
      {budget,paid:Math.min(grana,budget),debt:Math.max(0,budget-grana),eta:0,hits:5});
    assert.equal(r.sys.view(r.world.tick).ended,'victory');
  }
});

test('the boss is called once, when the ETA drops below BOSS_ETA_SECONDS (60 s), on the route behind the moto',()=>{
  const r=rig();r.step(1);
  const eta0=r.sys.eta(r.world.tick);
  assert.ok(eta0>420&&eta0<700,`ETA at the start ${eta0} s`);
  // Skip to the last stretch: past every stop, ~100 s of riding left.
  const m=r.sys.state.moto,speed=r.sys.route.length/(420*SIM_HZ);
  m.stop=r.sys.stops.length;m.s=r.sys.route.length-speed*ticks(100-ABRINDO_SECONDS);
  r.step(1);
  assert.ok(r.sys.eta(r.world.tick)>=BOSS_ETA_SECONDS,'not yet');assert.equal(r.bosses.length,0);
  while(r.sys.eta(r.world.tick)>=BOSS_ETA_SECONDS)r.step(1);
  assert.equal(r.bosses.length,1);
  r.step(200);assert.equal(r.bosses.length,1,'once');
  const at=r.bosses[0].at;
  assert.ok(Math.hypot(at.x-CAR.x,at.y-CAR.y)>10,'away from the car');
});

test('the boss besieges the car when no player is nearer: one blow (3 hits) every 3 s, players first otherwise',()=>{
  const r=rig();
  const hits:number[]=[];
  const boss=createBoss({siege:()=>r.sys.targets().find(t=>t.id===CAR_ID),hitSiege:(ctx,id,b)=>{hits.push(ctx.tick);r.sys.hitCar(ctx,b);}});
  r.world.register(boss);
  const far=addPlayer(r.world,'far',{x:CAR.x+30,y:CAR.y});
  const b=boss.spawnBoss(r.world,{x:CAR.x+4,y:CAR.y})!;
  for(let i=0;i<ticks(12);i++){r.world.step();r.sys.step(r.world);}
  assert.ok(Math.hypot(b.x-CAR.x,b.y-CAR.y)<=BOSS_SIEGE_REACH+1e-9,'walked to the car');
  assert.ok(hits.length>=2,`${hits.length} blows`);
  for(let i=1;i<hits.length;i++)assert.equal(hits[i]-hits[i-1],BOSS_SIEGE_EVERY);
  assert.equal(r.sys.state.car.hits,CAR_HIT_UNITS.boss*hits.length);
  // A player nearer than the car: the boss goes for the player.
  far.x=b.x+1.5;far.y=b.y;const n=hits.length;
  for(let i=0;i<ticks(6);i++){r.world.step();r.sys.step(r.world);}
  assert.equal(hits.length,n,'no blows on the car while a player is nearer');
});

test('director waves (endlessWaves): no boss in any plan, the run goes past round 10, extra waves repeat it with count × 1.1ⁿ',()=>{
  const terrain=new TerrainField(3);
  const world=new SimWorld({terrain,seed:3});
  let bosses=0;const plans=new Map<number,number>();
  const director=createDirector({
    createEnemy:(ctx,kind,point,scale)=>isEnemyKind(kind)?createEnemy(ctx,kind,point,scale):undefined,
    spawnBoss:()=>{bosses++;return undefined;},endlessWaves:true,
  });
  world.register(director);
  for(let i=0;i<20*60*40&&world.round.index<ROUND_COUNT+3;i++){
    world.step();world.enemies.clear();
    const plan=director.state.plan;
    if(plan&&!plans.has(plan.index)){plans.set(plan.index,plan.total);assert.ok(!plan.boss&&plan.groups.every(g=>!g.boss),`round ${plan.index}: no boss`);}
  }
  assert.equal(bosses,0);assert.notEqual(director.state.stage,'done');
  assert.ok(world.round.index>=ROUND_COUNT+2,`reached wave ${world.round.index}`);
  // Round 10's regular count (the table's, without the boss), then × 1.1 and × 1.21.
  const regular10=planRound(ROUND_COUNT,1,{name:'x'},new Rng(1)).groups.filter(g=>!g.boss).reduce((n,g)=>n+g.members.length,0);
  assert.equal(plans.get(ROUND_COUNT),regular10);
  assert.equal(plans.get(ROUND_COUNT+1),Math.round(regular10*1.1));
  assert.equal(plans.get(ROUND_COUNT+2),Math.round(regular10*1.1**2));
});

// ---------- Assembled run: checkpoint mid-route ----------
interface Run {world:SimWorld;sys:RunSystems;outcomes:string[]}
function assembled(terrain:CityTerrain,seed:number,players:Map<string,SimPlayer>,checkpoint?:RunSystems['state'] extends ()=>infer S?S:never):Run{
  const world=new SimWorld({terrain,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const outcomes:string[]=[];
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:o=>outcomes.push(o),cityTutorial:false,objective:'chaveiro',...(checkpoint?{checkpoint}:{})});
  return {world,sys,outcomes};
}
test('assembled city run with the objective: the car replaces the wall, and a checkpoint mid-route plays on like the original',()=>{
  const SEED=21,players=new Map<string,SimPlayer>();
  const a=assembled(city.fork(),SEED,players);
  addPlayer(a.world,'p1',{x:CAR.x+1.5,y:CAR.y});addPlayer(a.world,'p2',{x:CAR.x-1.5,y:CAR.y});
  assert.ok(a.sys.chaveiro,'the objective is wired');
  const t=a.sys.stonewards.state;
  // Into the round-2 intermission (a checkpoint is taken at an intermission).
  for(let i=0;i<20*60*4&&!(a.world.round.index===2&&a.world.round.phase==='prepare');i++)a.world.step();
  assert.equal(a.world.round.index,2);assert.equal(a.world.round.phase,'prepare');
  const cs=structuredClone(a.sys.state().chaveiro!);
  assert.ok(cs.moto.s>0&&cs.moto.s<a.sys.chaveiro!.route.length,'mid-route');
  assert.equal(t.wall.hp,t.wall.maxHp,'the wall is never a target');
  const view=a.sys.objectiveView()!;assert.equal(view.kind,'chaveiro');
  const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
  const copies=new Map([...players].map(([id,p])=>[id,structuredClone(p)]));
  const b=assembled(city.fork(),SEED,copies,systems);b.world.load(world);
  assert.equal(stateHash(b.sys.state()),stateHash(a.sys.state()));
  for(const m of [a.world.enemies,a.world.projectiles,a.world.telegraphs])m.clear();
  for(let i=0;i<ticks(40);i++){a.world.step();b.world.step();}
  assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}));
  const after=a.sys.state().chaveiro!.moto;
  assert.ok(after.s>cs.moto.s||after.task!=='anda',`it rode on or stopped: ${JSON.stringify(after)} from ${JSON.stringify(cs.moto)}`);
  // Objective off: no chaveiro in the state (the other digests stay as they were).
  const off=new SimWorld({terrain:city.fork(),seed:SEED,players:new Map(),order:RUN_ORDER});
  const sysOff=createRunSystems(off,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false});
  assert.equal('chaveiro' in sysOff.state(),false);assert.equal(sysOff.objectiveView(),undefined);
  assert.ok(!sysOff.chaveiro);
});

test('a checkpoint taken while the called boss still stands forgets that fight: no free chest, and the chaveiro calls it again',()=>{
  const SEED=21,players=new Map<string,SimPlayer>();
  const a=assembled(city.fork(),SEED,players);
  addPlayer(a.world,'p1',{x:CAR.x+1.5,y:CAR.y});
  for(let i=0;i<5;i++)a.world.step();
  a.sys.chaveiro!.state.bossCalled=true;a.sys.boss.spawnBoss(a.world,a.sys.chaveiro!.moto());
  const systems=structuredClone(a.sys.state()),world=a.world.checkpoint();
  assert.ok(systems.boss.bossId&&!systems.boss.defeated,'the checkpoint names a live boss');
  // The checkpoint keeps no live enemy: the boss is not in the resumed world.
  const b=assembled(city.fork(),SEED,new Map([...players].map(([id,p])=>[id,structuredClone(p)])),systems);b.world.load(world);
  assert.equal(b.sys.boss.state.bossId,undefined);assert.equal(b.sys.state().chaveiro!.bossCalled,false);
  const chests=()=>[...b.world.pickups.values()].filter(p=>p.kind==='chest').length,before=chests();
  for(let i=0;i<5;i++)b.world.step();
  assert.equal(b.sys.boss.state.defeated,false,'not settled as beaten');assert.equal(chests(),before,'no chest');
  // Near the car the ETA is under BOSS_ETA_SECONDS: the chaveiro calls the boss again.
  const m=b.sys.chaveiro!.state.moto;m.stop=b.sys.chaveiro!.stops.length;m.task='anda';m.s=b.sys.chaveiro!.route.length-.01;
  for(let i=0;i<3;i++)b.world.step();
  assert.ok([...b.world.enemies.values()].some(e=>e.boss),'called again');
});
