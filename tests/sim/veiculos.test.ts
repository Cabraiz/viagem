/**
 * Veículos (card NEW-20261014-ORQ-bancos-e-veiculos, part 2, slice 1: patinete, carrinho, crossfiteiro;
 * src/sim/veiculos/system.ts, rules/veiculos.ts VEICULO, contract vehicles.ts) on the REAL Cidade Nevada.
 *  - The prediction (maps/prediction.ts moveStep): the ride's multiplier (not on top of the brigadeiro), the cart's
 *    turn, the crossfiteiro's burpee, a burp still slowing it.
 *  - Unit rigs: a SimWorld of the city with no systems, the VehiclesSystem stepped by hand: the spawn (when, where,
 *    the cap, the expiry), the take, the scooter's battery, the crossfiteiro's heal and burpee, the early end.
 *  - An assembled city run, both modes: vehicles in the state (none on the island or the endless world), the pickups
 *    system never takes one, the Simulation's view carries the ride, and a checkpoint mid-ride resumes with the same
 *    state hash on every tick.
 * D-031: sim ticks only, no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {heroSpeed,type Point} from '../../src/maps/world.ts';
import {moveStep,walkMult,STEP} from '../../src/maps/prediction.ts';
import {BASE_STATS,BURPEE_TICKS,CART_TURN,CIDA_FAST_MULT,PLAYER_SLOW_MULT,RIDE_MULT,VEHICLE_KINDS,ticks,type EnemyState,type PickupState,type SimPlayer,type StampedEvent} from '../../src/contract/index.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {VEHICLE_CLEAR,createVehicles,rideTicks,type VehiclesSystem} from '../../src/sim/veiculos/system.ts';
import {VEICULO,vehicleCap} from '../../src/rules/veiculos.ts';
import {Rng} from '../../src/contract/rng.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PLAZA=city.asset.points.praca;
const FIRST=ticks(VEICULO.firstS),EVERY=ticks(VEICULO.everyS),LIFE=ticks(VEICULO.lifeS);
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

interface Got {tick:number;e:StampedEvent}
interface Rig {world:SimWorld;sys:VehiclesSystem;busy:Set<string>;events:Got[];step(n?:number):Got[];parked():PickupState[]}
function rig(seed=7):Rig{
  const world=new SimWorld({terrain:city,seed,players:new Map<string,SimPlayer>(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const events:Got[]=[],busy=new Set<string>();
  const sys=createVehicles({seed,clear:(x,y,r)=>city.clearDisc(x,y,r),busy:id=>busy.has(id)});
  const step=(n=1)=>{
    const got:Got[]=[];
    for(let i=0;i<n;i++){world.step();sys.step(world);for(const e of world.flush())got.push({tick:world.tick,e});}
    events.push(...got);return got;
  };
  return {world,sys,busy,events,step,parked:()=>[...world.pickups.values()].filter(k=>k.kind==='vehicle')};
}
function addPlayer(world:SimWorld,id:string,p:Point,hp=100){
  const player={id,classId:'x',hp,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:Math.max(100,hp)},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
const vehicleEvents=(got:readonly Got[])=>got.filter(g=>g.e.type==='vehicle').map(g=>g.e as Extract<StampedEvent,{type:'vehicle'}>);
/** Parks a vehicle of `kind` by hand (the spawn's own shape), `value` its stream number. */
function park(r:Rig,kind:typeof VEHICLE_KINDS[number],at:Point,value=0){
  const k:PickupState={id:`veiculo-hand-${kind}-${value}`,kind:'vehicle',resource:kind,value,x:at.x,y:at.y,spawnTick:r.world.tick,expiresTick:r.world.tick+LIFE};
  r.world.pickups.set(k.id,k);return k;
}

// ---------- The prediction ----------
test('prediction: a ride walks × RIDE_MULT (the larger of it and the brigadeiro, never both), a burp still slows it, the cart turns 15° left, the burpee stands still, an expired ride is plain walking',()=>{
  const walk=heroSpeed(city)*STEP,from={...PLAZA},east={x:1,y:0};
  const moved=(effects:Parameters<typeof moveStep>[3],tick=100)=>{const q=moveStep(from,east,tick,effects,city);return {d:dist(q,from),a:Math.atan2(q.y-from.y,q.x-from.x)};};
  const close=(a:number,b:number,m:string)=>assert.ok(Math.abs(a-b)<1e-9,`${m}: ${a} vs ${b}`);
  close(moved(undefined).d,walk,'plain');
  for(const kind of VEHICLE_KINDS){
    close(moved({ride:kind,rideUntil:1000}).d,walk*RIDE_MULT[kind],kind);
    close(moved({ride:kind,rideUntil:1000,fastUntil:1000}).d,walk*Math.max(RIDE_MULT[kind],CIDA_FAST_MULT),`${kind} + brigadeiro: the larger`);
    close(moved({ride:kind,rideUntil:1000,slowUntil:1000}).d,walk*PLAYER_SLOW_MULT*RIDE_MULT[kind],`${kind} + burp`);
    close(moved({ride:kind,rideUntil:100}).d,walk,`${kind} over at rideUntil`);
  }
  close(moved({ride:'carrinho',rideUntil:1000}).a,CART_TURN,'the cart pulls to the left');
  close(moved({ride:'patinete',rideUntil:1000}).a,0,'the scooter goes straight');
  // The crossfiteiro: carrying until the last BURPEE_TICKS, then the burpee (walking × 0).
  assert.equal(walkMult({ride:'crossfiteiro',rideUntil:200},200-BURPEE_TICKS-1),RIDE_MULT.crossfiteiro);
  assert.equal(walkMult({ride:'crossfiteiro',rideUntil:200},200-BURPEE_TICKS),0);
  assert.equal(moved({ride:'crossfiteiro',rideUntil:110}).d,0,'standing still in the burpee');
  // An unknown ride is plain walking (a forged frame cannot speed the phone up).
  close(moved({ride:'jatinho' as 'patinete',rideUntil:1000}).d,walk,'unknown ride');
});

// ---------- The spawn ----------
test('spawn: the first at firstS, then every everyS, 15–40 u from a standing hero on clear ground, ≥ 8 u from every hero; never above the cap; gone after lifeS; deterministic per seed',()=>{
  const trace=(seed:number)=>{
    const r=rig(seed);addPlayer(r.world,'p1',PLAZA);addPlayer(r.world,'p2',{x:PLAZA.x+3,y:PLAZA.y});
    const out:string[]=[];
    // firstS after the system's first step (tick 1 here).
    r.step(FIRST);assert.equal(r.parked().length,0,'nothing before firstS');
    r.step(1);
    let parked=r.parked();assert.equal(parked.length,1,'the first at firstS');
    for(let n=0;n<4;n++){
      for(const k of parked){
        const near=Math.min(...[...r.world.players.values()].map(p=>dist(p,k)));
        assert.ok(near>=VEICULO.clearHero,`not at a hero's feet (${near.toFixed(1)})`);
        assert.ok([...r.world.players.values()].some(p=>dist(p,k)>=VEICULO.near-1e-9&&dist(p,k)<=VEICULO.far+1e-9),'15–40 u from a hero');
        assert.ok(city.clearDisc(k.x,k.y,VEHICLE_CLEAR),'on clear ground');
        assert.ok((VEHICLE_KINDS as readonly string[]).includes(k.resource!),k.resource);
      }
      out.push(parked.map(k=>`${k.resource}@${k.x.toFixed(2)},${k.y.toFixed(2)}`).join(' '));
      r.step(EVERY);parked=r.parked();
      assert.ok(parked.length<=vehicleCap(2),`cap ${vehicleCap(2)} for 2 players`);
    }
    return out;
  };
  assert.deepEqual(trace(5),trace(5),'same seed, same vehicles');
  assert.notDeepEqual(trace(5),trace(6),'the seed moves them');
  assert.deepEqual([1,2,3,4,6,8].map(vehicleCap),[2,2,3,3,4,4]);
  // Nobody takes it: gone lifeS later.
  const r=rig(9);addPlayer(r.world,'p1',PLAZA);
  r.step(FIRST+1);const [k]=r.parked();assert.ok(k);
  r.step(LIFE-1);assert.ok(r.world.pickups.has(k.id),'still parked');
  r.step(1);assert.equal(r.world.pickups.has(k.id),false,'gone after lifeS');
  // Kinds: all three come up over the seeds.
  const kinds=new Set<string>();
  for(let seed=1;seed<=12;seed++){const s=rig(seed);addPlayer(s.world,'p1',PLAZA);s.step(FIRST+1);for(const v of s.parked())kinds.add(v.resource!);}
  assert.deepEqual([...kinds].sort(),[...VEHICLE_KINDS].sort());
});

// ---------- The take and the rides ----------
test('take: the nearest standing hero within 1.2 u (not riding, not moving the car) rides it: event pegou, the pickup gone; the scooter\'s battery is 6–10 s and ends with acabou',()=>{
  const r=rig();
  const p1=addPlayer(r.world,'p1',PLAZA),p2=addPlayer(r.world,'p2',{x:PLAZA.x+.9,y:PLAZA.y});
  const k=park(r,'patinete',{x:PLAZA.x+.6,y:PLAZA.y},3);
  r.busy.add('p2');
  const got=vehicleEvents(r.step());
  assert.deepEqual(got.map(e=>[e.player,e.kind,e.what,e.pickup]),[['p1','patinete','pegou',k.id]],'p2 is nearer but moving the car');
  assert.equal(r.world.pickups.has(k.id),false);
  assert.equal(p1.ride,'patinete');assert.equal(p2.ride,undefined);
  const len=p1.rideUntil!-r.world.tick;
  assert.equal(len,rideTicks('patinete',new Rng(7>>>0).fork('veiculos').fork('3').fork('ride')),'the battery comes from the vehicle\'s own stream');
  assert.ok(len>=ticks(VEICULO.batteryS[0])&&len<=ticks(VEICULO.batteryS[1]),`battery ${len} ticks`);
  // A rider takes nothing else; out of reach nothing.
  const k2=park(r,'carrinho',{x:PLAZA.x,y:PLAZA.y+.5},4);
  park(r,'carrinho',{x:PLAZA.x+30,y:PLAZA.y},5);
  r.busy.delete('p2');p2.x=PLAZA.x+50;
  r.step();assert.ok(r.world.pickups.has(k2.id),'p1 already rides, p2 is far');
  assert.equal(vehicleEvents(r.step(len-2)).length,0);
  // The battery dies; free again on the same tick, p1 takes the cart next to it.
  assert.deepEqual(vehicleEvents(r.step()).map(e=>[e.player,e.kind,e.what]),[['p1','patinete','acabou'],['p1','carrinho','pegou']]);
  assert.equal(p1.rideUntil!-r.world.tick,ticks(VEICULO.seconds.carrinho));
  assert.equal(r.sys.state.taken,2);
  // A downed hero takes nothing.
  const s=rig();const d=addPlayer(s.world,'d',PLAZA);d.downed={bleedOutTick:9999,progress:0} as SimPlayer['downed'];
  park(s,'patinete',PLAZA);
  assert.equal(vehicleEvents(s.step()).length,0);
});

test('crossfiteiro: 12 s carried, healing 5 every 3 s (not past maxHp), then the 0.8 s burpee inside the ride; acabou at its end',()=>{
  const r=rig(),p=addPlayer(r.world,'p1',PLAZA,50);
  park(r,'crossfiteiro',PLAZA);
  r.step();
  const start=r.world.tick,carry=ticks(VEICULO.seconds.crossfiteiro);
  assert.equal(p.rideUntil,start+carry+BURPEE_TICKS,'the burpee is part of the ride');
  const heals:number[]=[];let hp=p.hp;
  for(let i=0;i<carry+BURPEE_TICKS-1;i++){r.step();if(p.hp!==hp){heals.push(r.world.tick-start);hp=p.hp;}}
  const every=ticks(VEICULO.healEvery);
  assert.deepEqual(heals,[every,2*every,3*every],'a heal every 3 s of the carry (the 4th lands on the burpee: none)');
  assert.equal(p.hp,50+3*VEICULO.healHp);
  assert.equal(p.ride,'crossfiteiro','still in the burpee');
  assert.deepEqual(vehicleEvents(r.step()).map(e=>e.what),['acabou']);
  // Full life: no heal past maxHp.
  const s=rig(),q=addPlayer(s.world,'q',PLAZA,100);park(s,'crossfiteiro',PLAZA);
  s.step(ticks(VEICULO.healEvery)+2);assert.equal(q.hp,100);
});

test('early end: a fall or moving the car ends the ride (largou) and its fields go',()=>{
  for(const how of ['down','car'] as const){
    const r=rig(),p=addPlayer(r.world,'p1',PLAZA);
    park(r,'carrinho',PLAZA);r.step();assert.equal(p.ride,'carrinho');
    r.step(20);
    if(how==='down')p.hp=0;else r.busy.add('p1');
    assert.deepEqual(vehicleEvents(r.step()).map(e=>[e.kind,e.what]),[['carrinho','largou']],how);
    assert.equal(p.ride,undefined);assert.equal(p.rideUntil,undefined);
  }
});

// ---------- In a run ----------
interface Run {world:SimWorld;sys:RunSystems}
function assembled(seed:number,players:Map<string,SimPlayer>,objective:'chaveiro'|undefined,checkpoint?:ReturnType<RunSystems['state']>):Run{
  const world=new SimWorld({terrain:city.fork(),seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,...(objective?{objective}:{}),...(checkpoint?{checkpoint}:{})});
  return {world,sys};
}

test('in a run: the city has vehicles in both modes (in the state), the island and the endless world none; the pickups system never takes one; the Simulation view carries the ride',()=>{
  for(const objective of ['chaveiro',undefined] as const){
    const players=new Map<string,SimPlayer>(),a=assembled(11,players,objective);
    assert.ok(a.sys.vehicles,`vehicles in the city (${objective??'muralha'})`);
    assert.ok('veiculos' in a.sys.state());
    // A vehicle under a hero: only the vehicles system takes it (no 'pickup' event).
    const p=addPlayer(a.world,'p1',PLAZA);
    a.world.pickups.set('veiculo-x',{id:'veiculo-x',kind:'vehicle',resource:'patinete',value:0,x:PLAZA.x,y:PLAZA.y,spawnTick:0,expiresTick:1e6});
    const ev=a.world.step();
    assert.equal(ev.filter(e=>e.type==='pickup').length,0,'not a plain pickup');
    assert.deepEqual(ev.filter(e=>e.type==='vehicle').map(e=>(e as {what:string}).what),['pegou']);
    assert.equal(p.ride,'patinete');
    a.sys.dispose();
  }
  for(const w of ['ilha','infinito'] as const){
    const sim=new Simulation(5,{world:w});
    assert.equal(sim.run.vehicles,undefined,`no vehicles on ${w}`);
    assert.equal('veiculos' in sim.run.state(),false,`nothing in the ${w} digest`);
  }
  const sim=new Simulation(5,{world:'cidade',terrain:city.fork()});
  sim.add('p1','Ana','cidadao-comum');
  const p=sim.players.get('p1')!;p.ride='carrinho';p.rideUntil=sim.world.tick+100;
  const me=sim.view('p1').players.find(o=>o.id==='p1')!;
  assert.deepEqual([me.ride,me.rideUntil],['carrinho',sim.world.tick+100]);
  p.rideUntil=sim.world.tick;
  assert.equal(sim.view('p1').players.find(o=>o.id==='p1')!.ride,undefined,'an expired ride costs no bytes');
});

for(const objective of ['chaveiro',undefined] as const){
  test(`checkpoint (${objective??'muralha'}): mid-ride with a vehicle parked, a fresh world plays on with the same state hash on every tick`,()=>{
    const SEED=21,players=new Map<string,SimPlayer>();
    const a=assembled(SEED,players,objective);
    // Too tough for the critters of the first minute.
    const p=addPlayer(a.world,'p1',PLAZA,1e6);
    for(let i=0;i<FIRST+2;i++)a.world.step();
    a.world.pickups.set('veiculo-cf',{id:'veiculo-cf',kind:'vehicle',resource:'crossfiteiro',value:0,x:p.x,y:p.y,spawnTick:a.world.tick,expiresTick:a.world.tick+LIFE});
    for(let i=0;i<ticks(2);i++)a.world.step();
    assert.equal(p.ride,'crossfiteiro');
    const hash0=stateHash(a.sys.state());
    const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
    assert.deepEqual(systems.veiculos,a.sys.vehicles!.state);
    const copies=new Map([...players].map(([id,q])=>[id,structuredClone(q)]));
    const b=assembled(SEED,copies,objective,systems);b.world.load(world);
    assert.equal(stateHash(b.sys.state()),hash0);
    for(const m of [a.world.enemies,a.world.projectiles,a.world.telegraphs])m.clear();
    let rides=0;
    for(let i=0;i<EVERY+ticks(12);i++){
      const ea=a.world.step(),eb=b.world.step();
      assert.deepEqual(eb.map(e=>e.type),ea.map(e=>e.type),`same events at tick ${a.world.tick}`);
      assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}),`tick ${a.world.tick}`);
      rides+=ea.filter(e=>e.type==='vehicle').length;
    }
    assert.ok(rides>=1,'the ride ended in the window');
    a.sys.dispose();b.sys.dispose();
  });
}
