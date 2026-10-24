/**
 * Card BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima (user, 24/10: "uma pessoa meio que flutua no Uno, tem que ter melhor
 * block nele"): the car's body is its box (contract CAR_HALF_LENGTH × CAR_HALF_WIDTH at the heading), not the 1 u disc.
 *  - the geometry (carGap, carPushOut);
 *  - heroes: the players system keeps them out of the box, walking or standing (the car rolled onto them), and the
 *    phone's replay (maps reconcile with clock.car) takes the very same steps;
 *  - critters: shoved off the box every tick (moving or not), hit it from its edge (the target's gap); the boss stays;
 *  - a pusher leaning on the rear bumper still pushes (the reach from the box).
 * On the REAL Cidade Nevada (the street at the wall's spot), D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom,CityTerrain} from '../../src/maps/city/terrain.ts';
import {RADIUS,type Point} from '../../src/maps/world.ts';
import {carBlock,reconcile} from '../../src/maps/prediction.ts';
import {BASE_STATS,CAR_HALF_LENGTH,CAR_HALF_WIDTH,CAR_ID,CAR_RADIUS,carGap,carPushOut,type EnemyState,type PlayerInput,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER,playersSystem} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {createChaveiro} from '../../src/sim/chaveiro/system.ts';
import {seatedPlayers} from '../../src/sim/wallet.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PTS=city.asset.points;
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
// The street runs east-west at the wall's spot (sim-carro.test.ts): the car lies along it, heading 0.
const CAR=placeWall(city);

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:100},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
/** A world with only the players system and the car at `car` (heading as given). */
function walkRig(car:{x:number;y:number;heading?:number},input:(id:string)=>PlayerInput|undefined){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  world.register(playersSystem(input,undefined,undefined,undefined,()=>car));
  return world;
}

test('geometry: carGap is 0 on the box and grows off it; carPushOut leaves a clear body alone and puts one inside radius off its nearest side',()=>{
  for(const heading of [0,Math.PI/3,-2.2]){
    const car={x:10,y:20,heading},c=Math.cos(heading),s=Math.sin(heading);
    const at=(l:number,w:number)=>({x:car.x+l*c-w*s,y:car.y+l*s+w*c});
    assert.equal(carGap(car,at(0,0)),0);
    assert.equal(carGap(car,at(CAR_HALF_LENGTH-.01,CAR_HALF_WIDTH-.01)),0);
    assert.ok(Math.abs(carGap(car,at(CAR_HALF_LENGTH+.5,0))-.5)<1e-9,'off the bumper');
    assert.ok(Math.abs(carGap(car,at(0,-CAR_HALF_WIDTH-.3))-.3)<1e-9,'off the side');
    assert.ok(Math.abs(carGap(car,at(CAR_HALF_LENGTH+.3,CAR_HALF_WIDTH+.4))-.5)<1e-9,'off the corner');
    const clear=at(CAR_HALF_LENGTH+.5,0);
    assert.equal(carPushOut(car,clear,.22),clear,'clear: the same point');
    // The old disc's edge on the axis (1 u) is inside the box: out through the bumper.
    const q=carPushOut(car,at(CAR_RADIUS,0),.22);
    assert.ok(Math.abs(carGap(car,q)-.22)<1e-9&&Math.hypot(q.x-car.x,q.y-car.y)>CAR_HALF_LENGTH,'out the bumper');
    // Near the side, inside: out through the side (the shallower way).
    const r=carPushOut(car,at(.4,CAR_HALF_WIDTH-.1),.3);
    const rl=(r.x-car.x)*c+(r.y-car.y)*s,rw=-(r.x-car.x)*s+(r.y-car.y)*c;
    assert.ok(Math.abs(rl-.4)<1e-9&&Math.abs(rw-(CAR_HALF_WIDTH+.3))<1e-9,`side ${rl} ${rw}`);
    // A body grazing the corner goes radius off it.
    const g=carPushOut(car,at(CAR_HALF_LENGTH+.1,CAR_HALF_WIDTH+.1),.3);
    assert.ok(Math.abs(carGap(car,g)-.3)<1e-9);
  }
});

test('heroes: walking at the bumper, the side or the corner, nobody ever stands in the box (the old disc let them 0.32 u into each end)',()=>{
  for(const [name,start,dir] of [
    ['rear bumper',{x:CAR.x-4,y:CAR.y},{x:1,y:0}],
    ['front bumper',{x:CAR.x+4,y:CAR.y},{x:-1,y:0}],
    ['side',{x:CAR.x+.3,y:CAR.y+2.5},{x:0,y:-1}],
    ['corner',{x:CAR.x-3,y:CAR.y+1},{x:.97,y:-.24}],
  ] as const){
    const car={x:CAR.x,y:CAR.y};
    const world=walkRig(car,()=>({seq:1,x:dir.x,y:dir.y} as PlayerInput));
    const p=addPlayer(world,'p',start);
    let closest=Infinity;
    for(let i=0;i<120;i++){world.step();closest=Math.min(closest,carGap(car,p));}
    assert.ok(closest>=RADIUS-1e-9,`${name}: ${closest.toFixed(3)} u off the box`);
    assert.ok(closest<RADIUS+.12,`${name}: it reached the car (${closest.toFixed(3)} u)`);
  }
});

test('heroes: a hero walking along the side slides past it (blocked, not stuck), and one the car rolled onto stands out on the next tick without a stick',()=>{
  const car={x:CAR.x,y:CAR.y};
  // Pressing at the side and along it: the along part keeps going.
  const world=walkRig(car,()=>({seq:1,x:.7,y:-.7} as PlayerInput));
  const p=addPlayer(world,'p',{x:CAR.x-.8,y:CAR.y+CAR_HALF_WIDTH+RADIUS+.05});
  const x0=p.x;
  for(let i=0;i<10;i++)world.step();
  assert.ok(p.x-x0>.3,`slid ${(p.x-x0).toFixed(3)} u`);
  assert.ok(carGap(car,p)>=RADIUS-1e-9);
  // Standing inside (the car just rolled there), no input: out at the edge.
  const still=walkRig(car,()=>undefined),q=addPlayer(still,'q',{x:CAR.x+.9,y:CAR.y+.1});
  still.step();
  assert.ok(Math.abs(carGap(car,q)-RADIUS)<1e-9,`out at ${carGap(car,q)}`);
});

test('the phone replays the same steps: reconcile with clock.car lands where the room\'s players system does',()=>{
  for(const heading of [0,.7]){
    const car={x:CAR.x,y:CAR.y,heading};
    const inputs=Array.from({length:40},(_,i)=>({seq:i+1,x:1,y:i<20?.05:-.4} as PlayerInput));
    let k=0;
    const world=walkRig(car,()=>inputs[k++]);
    const start={x:CAR.x-3.5,y:CAR.y+.2},p=addPlayer(world,'p',start);
    for(let i=0;i<inputs.length;i++)world.step();
    const phone=reconcile(start,inputs,city,{tick:0,car});
    assert.ok(Math.hypot(phone.x-p.x,phone.y-p.y)<1e-9,`heading ${heading}: phone ${phone.x},${phone.y} room ${p.x},${p.y}`);
    assert.ok(carGap(car,phone)>=RADIUS-1e-9);
  }
  // No car: the plain step.
  assert.deepEqual(carBlock({x:1,y:1},{x:2,y:1},undefined,city),{x:2,y:1});
});

function chaveiroRig(){
  const players=new Map<string,SimPlayer>(),sticks=new Map<string,Point>();
  const world=new SimWorld({terrain:city,seed:7,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createChaveiro({wallet:{seated:()=>seatedPlayers(players)},seed:7,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:()=>{},input:id=>sticks.get(id)});
  const step=(n=1)=>{for(let i=0;i<n;i++){world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);world.flush();}};
  return {world,sys,sticks,step};
}
const critter=(id:string,p:Point,boss=false):EnemyState=>({id,kind:'bebado',x:p.x,y:p.y,hp:10,maxHp:10,speed:1,damage:5,radius:.32,xp:1,spawnTick:0,readyTick:0,...(boss?{boss:true}:{})});

test('critters: pressed into the parked car\'s end or side they stand at its box\'s edge every tick (no push needed), unhurt; the boss stays put',()=>{
  const r=chaveiroRig(),c=r.sys.state.car;
  const end=critter('end',{x:c.x+CAR_HALF_LENGTH-.1,y:c.y+.05}),side=critter('side',{x:c.x-.5,y:c.y-CAR_HALF_WIDTH+.1});
  const boss=critter('boss',{x:c.x+.2,y:c.y+CAR_HALF_WIDTH-.05},true);
  for(const e of [end,side,boss])r.world.enemies.set(e.id,e);
  const bx=boss.x,by=boss.y;
  r.step();
  for(const e of [end,side])assert.ok(Math.abs(carGap(c,e)-e.radius)<1e-9,`${e.id}: ${carGap(c,e)}`);
  assert.equal(end.hp,10);
  assert.deepEqual({x:boss.x,y:boss.y},{x:bx,y:by});
  assert.equal(r.sys.view(r.world.tick).car.movers,undefined,'parked');
});

test('critters hit the car from its box\'s edge: the car target\'s gap is the box\'s, not the disc\'s',()=>{
  const r=chaveiroRig(),c=r.sys.state.car;
  const car=r.sys.targets().find(t=>t.id===CAR_ID)!;
  assert.ok(car.gap,'the car target has a gap');
  // 0.1 u off the bumper (the disc said 0.42 u) and 0.1 u off the side (the disc said 0.32 u inside it).
  assert.ok(Math.abs(car.gap!({x:c.x+CAR_HALF_LENGTH+.1,y:c.y})-.1)<1e-9);
  assert.ok(Math.abs(car.gap!({x:c.x,y:c.y-CAR_HALF_WIDTH-.1})-.1)<1e-9);
});

test('a hero leaning on the rear bumper (as close as the box lets it) still pushes the car',()=>{
  const r=chaveiroRig(),c=r.sys.state.car,x0=c.x;
  const p=addPlayer(r.world,'p',{x:c.x-CAR_HALF_LENGTH-RADIUS,y:c.y});
  r.sticks.set('p',{x:1,y:0});
  for(let i=0;i<10;i++){p.x=c.x-CAR_HALF_LENGTH-RADIUS;r.step();}
  assert.ok(c.x>x0,`moved ${c.x-x0}`);
  assert.deepEqual(r.sys.view(r.world.tick).car.movers,['p']);
});
