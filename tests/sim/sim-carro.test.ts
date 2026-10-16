/**
 * D-052 slice 1, sim-carro (card NEW-20261016-ORQ-carro-e-fortificacao-livre; src/sim/chaveiro/car.ts and system.ts):
 * on the REAL Cidade Nevada, the ChaveiroSystem stepped by hand with players and enemies placed by hand.
 *  - push (reach, angle, stick), speeds by movers, the rope (hook, refusals, taut/slack, drop on a hit), collision with
 *    the city mask, structures and nests, the shove, the lock while opening, the moto's replan (drift, gap, restore);
 *  - the players system's step cap and the weapons' busy hands.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import type {Point} from '../../src/maps/world.ts';
import {BASE_STATS,CAR_NEST_KEEP_OUT,CAR_RADIUS,CAR_ROPE,SIM_HZ,carSpeed,ticks,type EnemyState,type PlayerInput,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER,playersSystem} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {pointAt} from '../../src/sim/chaveiro/route.ts';
import {CAR_STOP,REPLAN_DRIFT,REPLAN_GAP_SECONDS,createChaveiro,type ChaveiroOptions,type ChaveiroSystem} from '../../src/sim/chaveiro/system.ts';
import {seatedPlayers} from '../../src/sim/wallet.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PTS=city.asset.points;
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
// From the wall's spot the street runs ~17 u east and west for the car's body; a building stands 0.5 u north.
const CAR=placeWall(city);
const EAST={x:1,y:0},WEST={x:-1,y:0},NORTH={x:0,y:-1};

interface Rig {world:SimWorld;sys:ChaveiroSystem;sticks:Map<string,Point>;step(n?:number):void}
function rig(extra:Partial<ChaveiroOptions>={},restore?:ChaveiroSystem['state']):Rig{
  const players=new Map<string,SimPlayer>(),sticks=new Map<string,Point>();
  const world=new SimWorld({terrain:city,seed:7,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createChaveiro({wallet:{seated:()=>seatedPlayers(players)},seed:7,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:()=>{},
    input:id=>sticks.get(id),...extra},restore);
  const step=(n=1)=>{for(let i=0;i<n;i++){world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);world.flush();}};
  return {world,sys,sticks,step};
}
function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:100},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
/** Players `gap` u from the car's body on the side opposite `dir`, leaning on it (kept there every tick by `lean`). */
function pushers(r:Rig,n:number,dir:Point,gap=.3){
  const ids=Array.from({length:n},(_,i)=>`p${i}`);
  for(const id of ids){addPlayer(r.world,id,{x:0,y:0});r.sticks.set(id,dir);}
  const lean=()=>{const c=r.sys.state.car;ids.forEach((id,i)=>{const p=r.world.players.get(id)!,side=(i-(n-1)/2)*.15;
    p.x=c.x-dir.x*(CAR_RADIUS+gap)-dir.y*side;p.y=c.y-dir.y*(CAR_RADIUS+gap)+dir.x*side;});};
  lean();
  return {ids,run(ticksN:number){for(let i=0;i<ticksN;i++){lean();r.step();}}};
}

test('push: one hero leaning on the car and walking at it moves it at carSpeed(1) and is listed as a mover',()=>{
  const r=rig(),c=r.sys.state.car,x0=c.x,y0=c.y;
  const team=pushers(r,1,EAST);
  team.run(SIM_HZ);
  assert.ok(Math.abs(c.x-x0-carSpeed(1))<1e-9,`moved ${c.x-x0}`);
  assert.equal(c.y,y0);
  assert.deepEqual(r.sys.view(r.world.tick).car.movers,['p0']);
  assert.equal(r.sys.busy('p0'),true);
  assert.equal(r.sys.moverCap('p0'),carSpeed(1)/SIM_HZ);
  r.sticks.delete('p0');r.step();
  assert.equal(r.sys.view(r.world.tick).car.movers,undefined,'standing still: nobody moves it');
  assert.equal(r.sys.busy('p0'),false);
});

test('speeds: 1, 2, 3 and 4 movers give 0.8, 1.4, 1.8 and 1.8 u/s (3 is the cap)',()=>{
  for(const [n,v] of [[1,.8],[2,1.4],[3,1.8],[4,1.8]]){
    const r=rig(),c=r.sys.state.car,x0=c.x;
    pushers(r,n,WEST).run(SIM_HZ);
    assert.ok(Math.abs(x0-c.x-v)<1e-9,`${n} movers: ${x0-c.x}`);
  }
});

test('push needs reach, aim and a real stick: far, sideways, away, a light touch or a downed hero move nothing',()=>{
  const cases:[string,(p:SimPlayer,r:Rig)=>void][]=[
    ['far',(p)=>{p.x-=1.2;}],
    ['sideways',(_p,r)=>{r.sticks.set('p0',{x:.3,y:1});}],
    ['away',(_p,r)=>{r.sticks.set('p0',WEST);}],
    ['light',(_p,r)=>{r.sticks.set('p0',{x:.2,y:0});}],
    ['downed',(p)=>{p.downed=true;}],
  ];
  for(const [name,spoil] of cases){
    const r=rig(),c=r.sys.state.car,x0=c.x;
    pushers(r,1,EAST);spoil(r.world.players.get('p0')!,r);
    r.step(5);
    assert.equal(c.x,x0,name);
    assert.equal(r.sys.view(r.world.tick).car.movers,undefined,name);
  }
});

test('the body keeps to the mask: pushed into the building north it does not move; along the street it slides',()=>{
  const r=rig(),c=r.sys.state.car,y0=c.y;
  pushers(r,2,NORTH).run(SIM_HZ*2);
  assert.ok(city.clearDisc(c.x,c.y,CAR_RADIUS),'still on the street');
  assert.ok(y0-c.y<.5+1e-9,`went ${y0-c.y} u north into a building 0.5 u away`);
  // A diagonal push north-east keeps the east part (axis slide).
  const s=rig(),d=s.sys.state.car,x0=d.x;
  pushers(s,2,{x:Math.SQRT1_2,y:-Math.SQRT1_2}).run(SIM_HZ*2);
  assert.ok(d.x-x0>1,`slid ${d.x-x0} u east`);
  assert.ok(city.clearDisc(d.x,d.y,CAR_RADIUS));
});

test('structures and nests stop it: never into a barricade, never within CAR_NEST_KEEP_OUT of a living nest',()=>{
  const block={x:CAR.x+4,y:CAR.y,radius:.8};
  const r=rig({blocks:()=>[block]}),c=r.sys.state.car;
  pushers(r,3,EAST).run(SIM_HZ*4);
  assert.ok(c.x>CAR.x+1,'it moved');
  assert.ok(Math.hypot(c.x-block.x,c.y-block.y)>=block.radius+CAR_RADIUS-1e-9,`overlaps the barricade at ${c.x-CAR.x}`);
  const nest={x:CAR.x-10,y:CAR.y};
  const s=rig({nests:()=>[nest]}),d=s.sys.state.car;
  pushers(s,3,WEST).run(SIM_HZ*6);
  assert.ok(d.x<CAR.x-2,'it moved');
  assert.ok(Math.hypot(d.x-nest.x,d.y-nest.y)>=CAR_NEST_KEEP_OUT-1e-9,`${Math.hypot(d.x-nest.x,d.y-nest.y)} u from the nest`);
});

test('the car shoves enemies to its edge without hurting them; the boss stands its ground',()=>{
  const r=rig(),c=r.sys.state.car;
  const e:EnemyState={id:'e1',kind:'bebado',x:CAR.x+CAR_RADIUS+.42,y:CAR.y+.05,hp:10,maxHp:10,speed:1,damage:5,radius:.4,xp:1,spawnTick:0,readyTick:0};
  const b:EnemyState={...e,id:'boss',boss:true,x:CAR.x+CAR_RADIUS+.42,y:CAR.y-.05};
  r.world.enemies.set(e.id,e);r.world.enemies.set(b.id,b);
  const bx=b.x,by=b.y;
  pushers(r,1,EAST).run(10);
  assert.ok(Math.hypot(e.x-c.x,e.y-c.y)>=CAR_RADIUS+e.radius-1e-9);
  assert.equal(e.hp,10);
  assert.deepEqual({x:b.x,y:b.y},{x:bx,y:by});
});

test('rope: hooked within reach, one at a time; taut it pulls, slack it rests; a hit, a fall or "off" drops it; a resent req is duplicate',()=>{
  const r=rig(),c=r.sys.state.car,x0=c.x;
  const a=addPlayer(r.world,'a',{x:CAR.x+CAR_RADIUS+3,y:CAR.y}),b=addPlayer(r.world,'b',{x:CAR.x-CAR_RADIUS-1,y:CAR.y});
  assert.deepEqual(r.sys.pull(r.world,'a',true,'r:1'),{ok:false,reason:'longe'});
  a.x=CAR.x+CAR_RADIUS+1.4;
  assert.deepEqual(r.sys.pull(r.world,'a',true,'r:2'),{ok:true});
  assert.deepEqual(r.sys.pull(r.world,'a',true,'r:2'),{ok:false,reason:'duplicate'});
  assert.deepEqual(r.sys.pull(r.world,'b',true,'r:1'),{ok:false,reason:'ocupado'});
  r.step(5);
  assert.equal(c.x,x0,'slack: the car rests');
  assert.equal(r.sys.view(r.world.tick).car.rope,'a');
  assert.equal(r.sys.busy('a'),true,'the rope holder does not fire');
  assert.equal(r.sys.moverCap('a'),undefined,'slack: walks free');
  // Taut: the holder walks out to the rope's length and keeps it there.
  for(let i=0;i<SIM_HZ;i++){a.x=c.x+CAR_RADIUS+CAR_ROPE+.1;r.step();}
  assert.ok(Math.abs(c.x-x0-carSpeed(1))<1e-9,`pulled ${c.x-x0}`);
  assert.deepEqual(r.sys.view(r.world.tick).car.movers,['a']);
  a.hp-=1;r.step();
  assert.equal(r.sys.view(r.world.tick).car.rope,undefined,'a hit drops the rope');
  // Hooked again, then dropped by hand, then by going too far.
  a.x=c.x+CAR_RADIUS+1;
  assert.deepEqual(r.sys.pull(r.world,'a',true,'r:3'),{ok:true});
  assert.deepEqual(r.sys.pull(r.world,'a',false,'r:4'),{ok:true});
  assert.equal(r.sys.state.car.rope,undefined);
  b.x=c.x-CAR_RADIUS-1;
  assert.deepEqual(r.sys.pull(r.world,'b',true,'r:5'),{ok:true});
  b.x=c.x-CAR_RADIUS-CAR_ROPE-1.5;r.step();
  assert.equal(r.sys.state.car.rope,undefined,'too far: it slips off');
  b.downed=true;
  assert.deepEqual(r.sys.pull(r.world,'b',true,'r:6'),{ok:false,reason:'fase'});
});

test('nobody moves the car while the chaveiro opens it',()=>{
  const r=rig(),c=r.sys.state.car,x0=c.x;
  const m=r.sys.state.moto;m.task='abrindo';m.mode='abrindo';m.left=ticks(15);m.s=r.sys.route.length;m.stop=r.sys.stops.length;
  pushers(r,2,EAST).run(10);
  assert.equal(c.x,x0);
});

test('replan: the car drifts past REPLAN_DRIFT, the moto replans from where he is (stops keep their share), at most every REPLAN_GAP_SECONDS; a restore rebuilds it',()=>{
  const r=rig(),c=r.sys.state.car,m=r.sys.state.moto;
  r.step(SIM_HZ*10);
  c.x+=REPLAN_DRIFT*.9;r.step();
  assert.equal(r.sys.state.route.via,undefined,'within the drift: same route');
  // What the replan starts from: the moto as the last step left him.
  const sAt=m.s,stopAt=m.stop,left=r.sys.stops.slice(stopAt).map(o=>o.s),L0=r.sys.route.length,motoAt=r.sys.moto();
  assert.equal(m.task,'anda');
  c.x+=REPLAN_DRIFT*.3;r.step();
  const via=r.sys.state.route.via!;
  assert.ok(via,'replanned');
  assert.ok(Math.hypot(via.from.x-motoAt.x,via.from.y-motoAt.y)<.05,'from where the moto was');
  assert.deepEqual(via.to,{x:c.x,y:c.y});
  const end=pointAt(r.sys.route,r.sys.route.length);
  assert.ok(Math.abs(Math.hypot(end.x-c.x,end.y-c.y)-CAR_STOP)<.6,'the route ends next to the car');
  assert.equal(r.sys.stops.length,left.length,'the stops ahead are kept');
  const scale=r.sys.route.length/(L0-sAt);
  r.sys.stops.forEach((o,i)=>assert.ok(Math.abs(o.s-(left[i]-sAt)*scale)<1e-9));
  assert.equal(m.stop,0);
  // Within the gap another drift waits; past it, it replans again.
  const at=r.sys.state.route.at!;
  c.x+=REPLAN_DRIFT*1.2;r.step();
  assert.equal(r.sys.state.route.at,at);
  r.step(ticks(REPLAN_GAP_SECONDS));
  assert.ok(r.sys.state.route.at!>at);
  // Restore: the same route and stops from the state.
  const back=rig({},structuredClone(r.sys.state));
  assert.deepEqual(back.sys.route,r.sys.route);
  assert.deepEqual(back.sys.stops,r.sys.stops);
});

test('players system: a step cap cuts the walk along its own line; without one the hero walks as before',()=>{
  const step=(cap?:number)=>{
    const players=new Map<string,SimPlayer>();
    const world=new SimWorld({terrain:city,seed:1,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const p=addPlayer(world,'p',{x:CAR.x,y:CAR.y+3});
    const input:PlayerInput={seq:1,x:1,y:0} as PlayerInput;
    world.register(playersSystem(()=>input,undefined,undefined,cap===undefined?undefined:()=>cap));
    world.step();
    return Math.hypot(p.x-CAR.x,p.y-CAR.y-3);
  };
  const free=step(),capped=step(carSpeed(2)/SIM_HZ);
  assert.ok(free>carSpeed(3)/SIM_HZ,`free ${free}`);
  assert.ok(Math.abs(capped-carSpeed(2)/SIM_HZ)<1e-9,`capped ${capped}`);
});
