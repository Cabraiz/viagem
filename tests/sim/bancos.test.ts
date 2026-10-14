/**
 * Bancos (card NEW-20261014-ORQ-bancos-e-veiculos, part 1; src/sim/bancos/system.ts, rules/bancos.ts BANCO): the
 * "Caixa 24 h que só dá nota de 2" on the REAL Cidade Nevada.
 *  - Placement: planBanks and an assembled city run, both modes (the chaveiro's route or the plaza as the anchor),
 *    deterministic from the seed, BANCO.count banks one per third of the map, the car and route distances; the island
 *    and the endless world have none.
 *  - Unit rigs: a SimWorld of the city with no systems, the BanksSystem stepped by hand and heroes/critters placed by
 *    hand (the hero's withdrawal and its queue, the bait, the critter's withdrawal and the Cliente Prime, the empty ATM
 *    and its refill).
 *  - An assembled city run, both modes: a checkpoint at an intermission resumes on a fresh world with the same state
 *    hash on every tick.
 * D-031: sim ticks only, no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {clearSegment,walkable,type Point} from '../../src/maps/world.ts';
import {BANK_IDS,BASE_STATS,ticks,type EnemyState,type SimPlayer,type StampedEvent} from '../../src/contract/index.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {cityLoot} from '../../src/sim/stonewards/loot.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {planChaveiro} from '../../src/sim/chaveiro/system.ts';
import {createBanks,distanceToPolyline,isPrime,planBanks,type BankPlace,type BanksSystem} from '../../src/sim/bancos/system.ts';
import {BANCO} from '../../src/rules/bancos.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PTS=city.asset.points;
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
const CAR=placeWall(city),PLAZA=PTS.praca;
/** The bank candidates exactly as assemble.ts hands them: the city's reachable loot points. */
const LOOT=cityLoot(city)!.crates.map(c=>({x:c.node.x,y:c.node.y}));
const SAQUE=ticks(BANCO.saqueS),BICHO_SAQUE=ticks(BANCO.bichoSaqueS),ISCA=ticks(BANCO.iscaS),RECARGA=ticks(BANCO.recargaS);
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

interface Got {tick:number;e:StampedEvent}
interface Rig {world:SimWorld;sys:BanksSystem;purse:{grana:number};events:Got[];step(n?:number):Got[];bank(i?:number):BankPlace}
function rig(seed=7,route?:readonly Point[]):Rig{
  const world=new SimWorld({terrain:city,seed,players:new Map<string,SimPlayer>(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const purse={grana:0},events:Got[]=[];
  const sys=createBanks({seed,candidates:LOOT,car:CAR,plaza:PLAZA,...(route?{route}:{}),wallet:{add:n=>{purse.grana+=n;}}});
  const step=(n=1)=>{
    const got:Got[]=[];
    for(let i=0;i<n;i++){world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);for(const e of world.flush())got.push({tick:world.tick,e});}
    events.push(...got);return got;
  };
  return {world,sys,purse,events,step,bank:(i=0)=>sys.places[i]};
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
const at=(b:Point,dx:number,dy=0)=>({x:b.x+dx,y:b.y+dy});
const cash=(got:readonly Got[],by?:'hero'|'enemy')=>got.filter(g=>g.e.type==='bank-cash'&&(!by||g.e.by===by));
const ofType=(got:readonly Got[],type:string)=>got.filter(g=>g.e.type===type);
const row=(r:Rig,i=0)=>r.sys.state.list[i];
const viewOf=(r:Rig,i=0)=>r.sys.view(r.world.tick)[i];
/** Is there a start angle that puts each point in its own third (120°) around `c`? (The sim draws that angle.) */
function onePerThird(points:readonly Point[],c:Point){
  const angles=points.map(p=>Math.atan2(p.y-c.y,p.x-c.x));
  for(let k=0;k<720;k++){
    const off=k*Math.PI/360,sectors=new Set(angles.map(a=>Math.floor((((a-off)%(2*Math.PI))+2*Math.PI)%(2*Math.PI)/(2*Math.PI/3))));
    if(sectors.size===points.length)return true;
  }
  return false;
}

// ---------- Placement ----------
test('placement: 3 banks per seed, deterministic, ids and names, one per third, ≥ 35 u from the car, 20–60 u from the moto route (chaveiro) or the plaza (wall)',()=>{
  assert.equal(BANCO.count,3);
  const seen=new Set<string>(),relaxed:string[]=[];
  for(let seed=1;seed<=24;seed++){
    const route=planChaveiro(seed,OPEN,ENTRANCES,CAR).route.points;
    for(const [mode,anchor] of [['chaveiro',{route}],['muralha',{plaza:PLAZA}]] as const){
      const a=planBanks(seed,LOOT,CAR,anchor),b=planBanks(seed,LOOT,CAR,anchor);
      assert.deepEqual(b,a,`same seed, same banks (${mode} ${seed})`);
      assert.equal(a.length,BANCO.count);
      assert.deepEqual(a.map(p=>p.id),['banco-1','banco-2','banco-3']);
      assert.deepEqual([...a.map(p=>p.name)].sort(),[...BANK_IDS].sort());
      assert.equal(new Set(a.map(p=>`${p.x},${p.y}`)).size,3,'three different spots');
      for(const p of a)assert.ok(LOOT.some(c=>c.x===p.x&&c.y===p.y),'on a loot point');
      assert.ok(onePerThird(a,CAR),`one per third of the map around the car (${mode} ${seed})`);
      for(const p of a){
        const fromAnchor='route' in anchor?distanceToPolyline(p,anchor.route):dist(p,anchor.plaza);
        if(dist(p,CAR)<BANCO.distCarro||fromAnchor<BANCO.desvio[0]||fromAnchor>BANCO.desvio[1])
          relaxed.push(`${mode} seed ${seed} ${p.id}: car ${dist(p,CAR).toFixed(1)} anchor ${fromAnchor.toFixed(1)}`);
      }
      seen.add(JSON.stringify(a.map(p=>[p.x,p.y])));
    }
  }
  assert.ok(seen.size>=12,`the seed moves the banks: ${seen.size} different layouts in 48`);
  // The fallback tiers (a third with no candidate that fits) must stay the exception on the real city.
  assert.deepEqual(relaxed,[],'every bank keeps the distance rules on the real city');
});

test('placement in a run: the city has banks in both modes (route anchor with the chaveiro), the island and the endless world have none',()=>{
  for(const objective of ['chaveiro',undefined] as const){
    const world=new SimWorld({terrain:city.fork(),seed:11,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const run=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,...(objective?{objective}:{})});
    assert.ok(run.banks,`banks in the city (${objective??'muralha'})`);
    const anchor=objective?{route:run.chaveiro!.route.points}:{plaza:PLAZA};
    assert.deepEqual(run.banks.places,planBanks(11,LOOT,CAR,anchor),'the run plans with the loot points, the car and the mode\'s anchor');
    const views=run.bankViews()!;
    assert.equal(views.length,3);
    for(const v of views){assert.equal(v.saldo,BANCO.saldo);assert.equal(v.state,'aberto');assert.equal(v.until,undefined);assert.equal(v.drawer,undefined);}
    assert.ok('banks' in run.state(),'the bank state is in the checkpoint');
    run.dispose();
  }
  for(const w of ['ilha','infinito'] as const){
    const sim=new Simulation(5,{world:w});
    assert.equal(sim.run.banks,undefined,`no banks on ${w}`);
    assert.equal(sim.run.bankViews(),undefined);
    assert.equal('banks' in sim.run.state(),false,`nothing in the ${w} digest`);
  }
});

// ---------- The hero's withdrawal ----------
test('hero withdrawal: a standing hero within 4 u takes R$ 2 every 3 s into the Grana; more heroes are not faster; out of reach or downed, nothing',()=>{
  const r=rig(),b=r.bank();
  addPlayer(r.world,'p1',at(b,BANCO.holdR-.1));
  assert.equal(cash(r.step(SAQUE-1)).length,0,'nothing before 3 s');
  assert.equal(row(r).state,'sacando');assert.equal(viewOf(r).state,'sacando');
  const first=r.step(1);
  assert.deepEqual(cash(first).map(g=>g.e),[{type:'bank-cash',bank:b.id,amount:BANCO.nota,by:'hero',eventId:(first[0].e as StampedEvent).eventId}]);
  assert.equal(r.purse.grana,2);assert.equal(row(r).saldo,BANCO.saldo-2);assert.equal(r.sys.state.paid,2);
  // The rate over 30 s: 10 notes, alone or with five friends at the ATM.
  const alone=cash(r.step(ticks(30))).length;
  assert.equal(alone,10);
  const s=rig(),c=s.bank();
  for(let k=0;k<6;k++)addPlayer(s.world,`p${k}`,at(c,0,-3+k));
  assert.equal(cash(s.step(SAQUE+ticks(30))).length,11,'six heroes: the same rate');
  assert.equal(s.purse.grana,22);
  // The other banks did nothing.
  assert.ok(cash(r.events).every(g=>g.e.type==='bank-cash'&&g.e.bank===b.id));
  // Out of reach: nothing, 'aberto'.
  const far=rig(),fb=far.bank();
  addPlayer(far.world,'p1',at(fb,BANCO.holdR+.2));
  assert.equal(cash(far.step(SAQUE*3)).length,0);assert.equal(row(far).state,'aberto');
  // Downed: nothing.
  const down=rig(),db=down.bank();
  addPlayer(down.world,'p1',at(db,1)).downed=true;
  assert.equal(cash(down.step(SAQUE*3)).length,0);assert.equal(row(down).state,'aberto');
});

test('hero withdrawal: "tem gente na fila" — a critter within 3 u stops it (the count waits), one 3.5 u away does not; the boss and a dead critter do not queue',()=>{
  const r=rig(),b=r.bank();
  addPlayer(r.world,'p1',at(b,0,2));
  r.step(SAQUE-5);
  const q=addEnemy(r.world,'q',at(b,-(BANCO.filaR-.1)));
  assert.equal(cash(r.step(SAQUE*3)).length,0,'the queue stops the notes');
  assert.equal(row(r).state,'aberto');
  assert.equal(cash(r.events,'enemy').length,0,'a hero at the ATM: the critter in the queue draws nothing');
  // It leaves: the count resumes where it waited (5 ticks to go).
  q.x=b.x-(BANCO.filaR+.5);
  assert.equal(cash(r.step(4)).length,0);
  assert.equal(cash(r.step(1),'hero').length,1,'the count waited, it did not restart');
  // The boss and a dead critter right at the ATM do not queue.
  const s=rig(),c=s.bank();
  addPlayer(s.world,'p1',at(c,0,2));
  addEnemy(s.world,'boss',at(c,-1),{boss:true,hp:1000,maxHp:1000});addEnemy(s.world,'dead',at(c,1),{hp:0});
  assert.equal(cash(s.step(SAQUE)).length,1);
});

// ---------- The bait ----------
test('bait: each hero note lures the critters within 20 u (not the boss) to the bank for 4 s; they walk there and forget it after',()=>{
  const r=rig();
  // A lured critter: 6–12 u from an ATM on a clear straight walk (the rig has no city steer); the hero on the far side.
  let spot:Point|undefined,b=r.bank();
  for(const place of r.sys.places){
    for(let k=0;k<128&&!spot;k++){
      const a=k*Math.PI/64,d=6+(k%4)*2,p=at(place,Math.cos(a)*d,Math.sin(a)*d);
      if(walkable(p,city)&&clearSegment(p,place,city)){spot=p;b=place;}
    }
    if(spot)break;
  }
  assert.ok(spot,'a clear spot near an ATM');
  const away=dist(spot!,b),hero=addPlayer(r.world,'p1',at(b,-(spot!.x-b.x)/away,-(spot!.y-b.y)/away));
  const near=addEnemy(r.world,'near',spot!),edge=addEnemy(r.world,'edge',at(b,BANCO.iscaR-.1,0)),out=addEnemy(r.world,'out',at(b,BANCO.iscaR+1,0));
  const boss=addEnemy(r.world,'boss',at(b,0,-10),{boss:true,hp:1000,maxHp:1000});
  const got=r.step(SAQUE);
  assert.equal(cash(got,'hero').length,1);
  const t=got.find(g=>g.e.type==='bank-cash')!.tick;
  assert.ok(got.every(g=>g.e.type!=='bank-cash'||g.e.bank===b.id));
  for(const e of [near,edge])assert.deepEqual([e.memory?.baitX,e.memory?.baitY,e.memory?.baitUntil],[b.x,b.y,t+ISCA],`${e.id} lured`);
  for(const e of [out,boss])assert.equal(e.memory?.baitUntil,undefined,`${e.id} not lured`);
  // The hero walks off (60 u): the bait is nearer than any player, the lured critter walks to the ATM.
  hero.x=b.x+60;hero.y=b.y;
  r.world.enemies.delete('edge');r.world.enemies.delete('out');r.world.enemies.delete('boss');
  const ai=createEnemyAi({heroSpeed:10}),d0=dist(near,b);
  for(let k=0;k<ISCA-1;k++){r.world.step();r.world.enemyIndex.rebuild(r.world.enemies.values());ai.step(r.world);r.world.enemyIndex.rebuild(r.world.enemies.values());r.sys.step(r.world);r.world.flush();}
  assert.ok(dist(near,b)<d0-1,`walked to the ATM: ${d0.toFixed(2)} → ${dist(near,b).toFixed(2)} u`);
  assert.ok(dist(near,hero)>dist(near,b),'not to the hero');
  // After 4 s (no new note: the hero left) the bait is forgotten.
  for(let k=0;k<3;k++){r.world.step();r.world.enemyIndex.rebuild(r.world.enemies.values());ai.step(r.world);r.world.flush();}
  assert.equal(near.memory?.baitUntil,undefined,'forgotten after iscaS');
});

// ---------- The critter's withdrawal and the Cliente Prime ----------
test('critter withdrawal: alone within 2 u it takes R$ 2 every 2 s (state bicho, drawer = it); Prime exactly at R$ 10, once, hp and maxHp × 1.5',()=>{
  const r=rig(),b=r.bank();
  const e=addEnemy(r.world,'e1',at(b,BANCO.bichoR-.1),{hp:8,maxHp:10});
  r.step(1);
  assert.equal(row(r).state,'bicho');assert.equal(viewOf(r).state,'bicho');assert.equal(viewOf(r).drawer,'e1');
  assert.equal(cash(r.step(BICHO_SAQUE-2)).length,0);
  const got=r.step(1);
  assert.deepEqual(cash(got).map(g=>g.e.type==='bank-cash'&&[g.e.bank,g.e.amount,g.e.by,g.e.enemy]),[[b.id,2,'enemy','e1']]);
  assert.equal(r.purse.grana,0,'the critter keeps it: no Grana for the team');
  assert.equal(row(r).saldo,BANCO.saldo-2);assert.equal(r.sys.state.taken,2);
  // Notes 2..4: no Prime yet (R$ 8).
  r.step(BICHO_SAQUE*3);
  assert.equal(ofType(r.events,'bank-prime').length,0);assert.equal(isPrime(e),false);assert.equal(e.maxHp,10);
  // Note 5 (R$ 10): Prime in the same tick.
  const fifth=r.step(BICHO_SAQUE);
  assert.equal(cash(fifth,'enemy').length,1);
  assert.deepEqual(ofType(fifth,'bank-prime').map(g=>g.e.type==='bank-prime'&&[g.e.bank,g.e.enemy]),[[b.id,'e1']]);
  assert.equal(isPrime(e),true);assert.equal(e.maxHp,10*BANCO.primeVida);assert.equal(e.hp,8*BANCO.primeVida);
  assert.equal(r.sys.state.primes,1);
  // Notes 6..10 (R$ 20): no second Prime, no more life.
  r.step(BICHO_SAQUE*5);
  assert.equal(cash(r.events,'enemy').length,10);
  assert.equal(ofType(r.events,'bank-prime').length,1,'Prime once');assert.equal(e.maxHp,10*BANCO.primeVida);
});

test('critter withdrawal: not with a hero within 4 u, not from 2.5 u, not the boss; a second critter takes over the drawer only when the first leaves',()=>{
  const r=rig(),b=r.bank();
  addEnemy(r.world,'e1',at(b,1));
  const p=addPlayer(r.world,'p1',at(b,0,BANCO.holdR-.2));
  assert.equal(cash(r.step(BICHO_SAQUE*3)).length,0,'a hero at the ATM (and the critter is in its queue): nobody draws');
  assert.equal(row(r).state,'aberto');assert.equal(viewOf(r).drawer,undefined);
  p.x=b.x+50;
  r.step(1);assert.equal(row(r).state,'bicho');
  const s=rig(),c=s.bank();
  addEnemy(s.world,'far',at(c,BANCO.bichoR+.5));addEnemy(s.world,'boss',at(c,-1),{boss:true,hp:1000,maxHp:1000});
  assert.equal(cash(s.step(BICHO_SAQUE*3)).length,0);assert.equal(row(s).state,'aberto');
  // Two critters: the first keeps the drawer while in reach; it leaves, the other one starts its own count.
  const t=rig(),d=t.bank();
  const a=addEnemy(t.world,'a',at(d,1.5));t.step(1);
  addEnemy(t.world,'b',at(d,.5));
  t.step(BICHO_SAQUE);
  assert.deepEqual(cash(t.events,'enemy').map(g=>g.e.type==='bank-cash'&&g.e.enemy),['a'],'the first one keeps it though another is nearer');
  a.x=d.x+10;
  t.step(1);assert.equal(viewOf(t).drawer,'b');
  assert.equal(cash(t.step(BICHO_SAQUE-2),'enemy').length,0,'its own count from the takeover');
  assert.deepEqual(cash(t.step(1),'enemy').map(g=>g.e.type==='bank-cash'&&g.e.enemy),['b']);
});

// ---------- Empty and refill ----------
test('empty and refill: the 20th note leaves "SEM CÉDULAS" for 150 s (bank-empty, until), nothing meanwhile, then R$ 40 again (bank-refill)',()=>{
  const r=rig(),b=r.bank();
  addPlayer(r.world,'p1',at(b,1));
  r.step(SAQUE*(BANCO.saldo/BANCO.nota));
  assert.equal(cash(r.events).length,20);assert.equal(r.purse.grana,BANCO.saldo);
  const empty=ofType(r.events,'bank-empty');
  assert.equal(empty.length,1);
  const until=empty[0].e.type==='bank-empty'?empty[0].e.until:NaN;
  assert.equal(until,empty[0].tick+RECARGA);
  assert.equal(empty[0].tick,cash(r.events).at(-1)!.tick,'with the last note');
  assert.deepEqual(viewOf(r),{id:b.id,x:b.x,y:b.y,name:b.name,saldo:0,state:'sem-cedulas',until});
  // 150 s with the hero still there: nothing.
  const wait=r.step(until-r.world.tick-1);
  assert.equal(cash(wait).length,0);assert.equal(row(r).state,'sem-cedulas');
  const refill=r.step(1);
  assert.equal(refill[0]?.tick,until);
  assert.deepEqual(refill.map(g=>g.e.type),['bank-refill']);
  assert.equal(row(r).saldo,BANCO.saldo);assert.equal(row(r).state,'sacando');assert.equal(viewOf(r).until,undefined);
  assert.equal(cash(r.step(SAQUE),'hero').length,1,'the hero draws again 3 s after the refill');
  // A critter at an empty ATM: nothing.
  const s=rig(),c=s.bank();
  s.sys.state.list[0].saldo=2;
  addEnemy(s.world,'e1',at(c,1));
  s.step(BICHO_SAQUE);
  assert.equal(ofType(s.events,'bank-empty').length,1,'the critter emptied it');
  assert.equal(cash(s.step(BICHO_SAQUE*5)).length,0);
});

// ---------- Checkpoint ----------
interface Run {world:SimWorld;sys:RunSystems}
function assembled(seed:number,players:Map<string,SimPlayer>,objective:'chaveiro'|undefined,checkpoint?:ReturnType<RunSystems['state']>):Run{
  const world=new SimWorld({terrain:city.fork(),seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,...(objective?{objective}:{}),...(checkpoint?{checkpoint}:{})});
  return {world,sys};
}
for(const objective of ['chaveiro',undefined] as const){
  test(`checkpoint (${objective??'muralha'}): taken at an intermission mid-withdrawal and mid-refill, a fresh world plays on with the same state hash on every tick`,()=>{
    const SEED=21,players=new Map<string,SimPlayer>();
    const a=assembled(SEED,players,objective);
    for(let i=0;i<20*60*4&&!(a.world.round.index===2&&a.world.round.phase==='prepare');i++)a.world.step();
    assert.equal(a.world.round.index,2);assert.equal(a.world.round.phase,'prepare');
    const banks=a.sys.banks!,[b0,b1]=banks.places;
    // p1 holds bank 1 mid-count; bank 2 is dry and refills inside the window; bank 3 is half empty.
    addPlayer(a.world,'p1',at(b0,1));
    for(let i=0;i<SAQUE+SAQUE/2;i++)a.world.step();
    assert.ok(banks.state.list[0].saldo<BANCO.saldo&&banks.state.list[0].clock>0,'mid-withdrawal');
    Object.assign(banks.state.list[1],{saldo:0,state:'sem-cedulas',until:a.world.tick+ticks(10),clock:0,held:0});
    banks.state.list[2].saldo=14;
    assert.equal(dist(b1,a.world.players.get('p1')!)>BANCO.holdR,true);
    const hash0=stateHash(a.sys.state());
    const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
    assert.deepEqual(systems.banks,banks.state,'the bank rows are in the checkpoint');
    const copies=new Map([...players].map(([id,p])=>[id,structuredClone(p)]));
    const b=assembled(SEED,copies,objective,systems);b.world.load(world);
    assert.deepEqual(b.sys.banks!.places,banks.places,'the places come back from the seed');
    assert.equal(stateHash(b.sys.state()),hash0);
    for(const m of [a.world.enemies,a.world.projectiles,a.world.telegraphs])m.clear();
    const N=ticks(20);let notes=0,refills=0;
    for(let i=0;i<N;i++){
      const ea=a.world.step(),eb=b.world.step();
      assert.deepEqual(eb.map(e=>e.type),ea.map(e=>e.type),`same events at tick ${a.world.tick}`);
      assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}),`tick ${a.world.tick}`);
      notes+=ea.filter(e=>e.type==='bank-cash').length;refills+=ea.filter(e=>e.type==='bank-refill').length;
    }
    assert.ok(notes>=5,`p1 kept withdrawing: ${notes} notes`);assert.equal(refills,1,'bank 2 refilled in the window');
    // The bank state moves the hash.
    const before=stateHash(a.sys.state());a.sys.banks!.state.list[2].saldo--;
    assert.notEqual(stateHash(a.sys.state()),before);
    a.sys.dispose();b.sys.dispose();
  });
}
