/**
 * BUG-20261022-ORQ-minerva-acordar-trava (the user, 22/10: "quando os monstros acordaram o servidor travou e eu fui
 * devorado"). scripts/bench-minerva.ts measured it on the real city: the tick was fine AT the end of the minuto de
 * Minerva and froze seconds later (1 player 55 ms, 6 players 182 ms, against ~0.3 ms), when the crowd it had held lost
 * the hero and walked home: each home is a goal field of its own, the cache kept 8, and every miss built a new field
 * over the whole grid (~3 ms), 20–40 a tick. Here, on the real Cidade Nevada, mode 'ninhos' (chaveiro):
 *  - a recycled goal field is the same field as a new one (the cache stays out of the run);
 *  - twenty bodies walking to twenty homes build at most one whole-grid field a tick, and still get home;
 *  - at the end of the minute the bodies it held stand MINERVA_REACT s more (none hits the hero at their side), then
 *    start one by one over MINERVA_SPREAD s, the nearest first.
 * D-031: sim ticks and call counts only, no clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {FlowField,UNREACHABLE,walkable} from '../../src/maps/index.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {BAND_RADIUS,HOME_REACH,MINERVA_REACH,MINERVA_REACT,MINERVA_SPREAD,MODE} from '../../src/sim/ninhos/sono.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function run(minerva:number,seed=1,population=1):{world:SimWorld;sys:RunSystems}{
  const saved=NEST_PACE.minerva;NEST_PACE.minerva=minerva;
  try{
    const world=new SimWorld({terrain:city.fork(),seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos',nestPopulation:population});
    world.step();
    return {world,sys};
  }finally{NEST_PACE.minerva=saved;}
}
function addPlayer(world:SimWorld,id:string,x:number,y:number){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}
/** Whole-grid reads of a FlowField (its constructor, or a full invalidate): the ~3 ms the tick paid per goal. */
function countBuilds(){
  const proto=FlowField.prototype as unknown as {readNear(x0:number,y0:number,x1:number,y1:number):void};
  const inner=proto.readNear;let n=0;
  proto.readNear=function(this:FlowField,x0,y0,x1,y1){if(x0===0&&y0===0&&x1===this.width-1&&y1===this.height-1)n++;return inner.call(this,x0,y0,x1,y1);};
  return {get n(){return n;},restore(){proto.readNear=inner;}};
}

test('a goal field that takes a new goal is the same field as a new one toward it (cost and direction on every cell)',()=>{
  const g=cityPlanner(city).grid,cs=g.cellSize,ox=g.originX??0,oy=g.originY??0;
  const spots:{x:number;y:number}[]=[];
  for(let i=0;spots.length<4;i++){const p={x:(i*37.3)%280+5,y:(i*53.7)%280+5};if(walkable(p,city))spots.push(p);}
  const reused=new FlowField(g,[spots[0]]);
  // Read it first (its lazy pass runs), as the cache does before handing it over.
  reused.costAt(spots[3].x,spots[3].y);
  for(const goal of spots.slice(1)){
    reused.setTargets([goal]);
    const fresh=new FlowField(g,[goal]),a={x:0,y:0},b={x:0,y:0};
    let reached=0;
    for(let cy=0;cy<g.height;cy++)for(let cx=0;cx<g.width;cx++){
      const x=ox+(cx+.5)*cs,y=oy+(cy+.5)*cs,c=fresh.costAt(x,y);
      assert.equal(reused.costAt(x,y),c,`cost at cell ${cx},${cy}`);
      reused.directionAt(x,y,a);fresh.directionAt(x,y,b);
      assert.deepEqual(a,b,`direction at cell ${cx},${cy}`);
      if(c!==UNREACHABLE)reached++;
    }
    assert.ok(reached>1000,'a real goal: most of the city reaches it');
  }
});

test('twenty bodies walking to twenty homes: at most one whole-grid field a tick (was one per body a tick), and they get home',()=>{
  const {world,sys}=run(0);
  // No wave in the window (missao-proteger-uno-tempo: the first leaves 5–15 s after the minute): the walk home only.
  sys.nests!.state.nextWave=world.tick+ticks(60);
  const sono=sys.sono()!;
  // Twenty plan bodies, homes at least 3 cells apart (twenty goal fields, over the cache's 8), all lost 25 u away.
  const picked:typeof sono.bodies[number][]=[];
  for(const b of sono.bodies)if(picked.every(o=>Math.hypot(o.home.x-b.home.x,o.home.y-b.home.y)>=5)&&picked.length<20)picked.push(b);
  assert.equal(picked.length,20);
  const bodies:EnemyState[]=[];
  for(const b of picked){
    assert.equal(sono.wakeAround(world,b.home.x,b.home.y,.01,'ruido'),1);
    const e=world.enemies.get(b.id)!;
    // 12 u off home, on ground the body walks (the first clear one around it).
    for(let k=0;k<64;k++){
      const a=k*.7,r=12+(k>>4)*3,x=b.home.x+Math.cos(a)*r,y=b.home.y+Math.sin(a)*r;
      if(walkable({x,y},city)){e.x=x;e.y=y;break;}
    }
    e.readyTick=world.tick;
    Object.assign(e.memory!,{sono:MODE.perdeu,lost:world.tick,seen:world.tick});
    delete e.memory!.gx;delete e.memory!.gy;
    bodies.push(e);
  }
  const builds=countBuilds();
  try{
    let worst=0,total=0;
    for(let i=0;i<ticks(15);i++){
      const before=builds.n;
      world.step();
      const n=builds.n-before;worst=Math.max(worst,n);total+=n;
    }
    assert.ok(worst<=1,`whole-grid fields a tick: at most 1 (was ${worst})`);
    assert.ok(total<=8,`whole-grid fields in all: the cache's 8 at most (was ${total})`);
    const home=picked.filter(b=>!world.enemies.has(b.id)).length;
    assert.ok(home>=15,`they still walk home and sleep (${home} of 20 within ${HOME_REACH} u)`);
  }finally{builds.restore();sys.dispose();}
});

test('the end of the minuto de Minerva: the bodies it held stand MINERVA_REACT s more (no hit on the hero at their side), then start one by one over MINERVA_SPREAD s, nearest first',()=>{
  const {world,sys}=run(5,3,20);
  const sono=sys.sono()!,until=sys.nests!.state.minervaUntil!;
  // The hero walks into a band (MINERVA_REACH of a body): it wakes with its band, held, and hits him standing.
  // The sleeper with the most others within BAND_RADIUS (in a nest's yard: a band of many).
  const near=(x:typeof sono.bodies[number])=>sono.bodies.filter(o=>Math.hypot(o.home.x-x.home.x,o.home.y-x.home.y)<=BAND_RADIUS).length;
  const b=sono.bodies.reduce((a,x)=>near(x)>near(a)?x:a);
  const p=addPlayer(world,'p1',b.home.x+MINERVA_REACH*.6,b.home.y);
  while(world.tick<until-1)world.step();
  const held=[...world.enemies.values()];
  assert.ok(held.length>=3,`a band held (${held.length})`);
  const at=new Map(held.map(e=>[e.id,{x:e.x,y:e.y}]));
  while(world.tick<=until)world.step();
  const react=ticks(MINERVA_REACT),spread=ticks(MINERVA_SPREAD);
  const dist=(e:EnemyState)=>Math.hypot(p.x-e.x,p.y-e.y);
  const order=[...held].sort((x,y)=>dist(x)-dist(y));
  for(const e of held){
    assert.ok(e.readyTick>=until+react&&e.readyTick<until+react+spread,`${e.id} starts in the window (${e.readyTick-until})`);
  }
  for(let k=1;k<order.length;k++)assert.ok(order[k].readyTick>=order[k-1].readyTick,'the nearest first');
  const perTick=new Map<number,number>();
  for(const e of held)perTick.set(e.readyTick,(perTick.get(e.readyTick)??0)+1);
  assert.ok(Math.max(...perTick.values())<=Math.ceil(held.length/spread),'never all on one tick');
  // MINERVA_REACT s: nobody moves and the hero takes no hit, the band at his side. A shot or a telegraph still in the
  // air belongs to the minute (a held body hits whoever is in its reach, a sogra's chinelo too: with the 120 s minute of
  // inicio-no-uno-caixas-120 one leaves on its last tick): dropped, so only a new attack would count.
  world.projectiles.clear();world.telegraphs.clear();
  const hp=p.hp;
  // world.tick is the tick of the step just run: until+react is the first one they act on.
  while(world.tick<until+react-1)world.step();
  assert.equal(p.hp,hp,'no hit in the reaction second');
  // None walks at him (the hero's knife still knocks them back: a push away is no walk).
  for(const e of held)if(world.enemies.has(e.id)){
    const was=at.get(e.id)!;
    assert.ok(dist(e)>=Math.hypot(p.x-was.x,p.y-was.y)-.01,`${e.id} never came closer`);
  }
  // Then they come.
  while(world.tick<until+react+spread+ticks(1))world.step();
  assert.ok(held.some(e=>Math.hypot(e.x-at.get(e.id)!.x,e.y-at.get(e.id)!.y)>.2)||p.hp<hp,'they act after it');
  sys.dispose();
});
