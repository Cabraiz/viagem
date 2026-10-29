/**
 * Bancos (card NEW-20261014-ORQ-bancos-e-veiculos, part 1; src/sim/bancos/system.ts, rules/bancos.ts BANCO): the
 * "Caixa 24 h que só dá nota de 2" on the REAL Cidade Nevada, now the BICOS (card NEW-20261024-ORQ-bancos-viram-bicos,
 * rules/bicos.ts BICO): Trabalhar in the ring clocks in, R$/s in notes of R$ 5, the queue cuts the pay and throws the
 * shift out; the shift has no limit (card NEW-20261029-ORQ-bico-sem-limite-pix-voando): no saldo runs out, no shop closes.
 *  - Placement: planBanks and an assembled city run, both modes (the chaveiro's route or the plaza as the anchor),
 *    deterministic from the seed, BANCO.count banks one per third of the map, the car and route distances; the island
 *    and the endless world have none.
 *  - Unit rigs: a SimWorld of the city with no systems, the BanksSystem stepped by hand and heroes/critters placed by
 *    hand (the hero's withdrawal and its queue, the bait, the critter's withdrawal and the Cliente Prime, the shift with
 *    no end and a closed row from before opening at once).
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
import {BANK_IDS,BASE_STATS,BICO_IDS,SIM_HZ,ticks,type EnemyState,type SimPlayer,type StampedEvent} from '../../src/contract/index.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {cityLoot} from '../../src/sim/stonewards/loot.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {planChaveiro} from '../../src/sim/chaveiro/system.ts';
import {bicoPay,createBanks,distanceToPolyline,firstBicos,isPrime,nextBico,planBanks,ringCandidates,type BankPlace,type BanksSystem} from '../../src/sim/bancos/system.ts';
import {BANCO} from '../../src/rules/bancos.ts';
import {BICO,BICOS} from '../../src/rules/bicos.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PTS=city.asset.points;
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
const CAR=placeWall(city),PLAZA=PTS.praca;
/** The bank candidates exactly as assemble.ts hands them: the city's reachable loot points. */
const LOOT=cityLoot(city)!.crates.map(c=>({id:c.node.id,x:c.node.x,y:c.node.y}));
/** What a run offers planBanks (assemble.ts): the street ring around the car first, the loot points as a fallback. */
const CANDIDATES=[...ringCandidates(CAR,(x,y,r)=>city.clearDisc(x,y,r)),...LOOT];
/** Ticks per R$ 5 note of one hero alone in a shift (R$ 1/s). */
const NOTA=Math.ceil(BICO.nota*1000/bicoPay('telemarketing',1,0));
const BICHO_SAQUE=ticks(BANCO.bichoSaqueS),ISCA=ticks(BANCO.iscaS);
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

interface Got {tick:number;e:StampedEvent}
/** work: each player's Trabalhar this tick as the players system hands it (absent: no input this tick). */
interface Rig {world:SimWorld;sys:BanksSystem;purse:{grana:number};events:Got[];work:Map<string,boolean>;step(n?:number):Got[];bank(i?:number):BankPlace}
function rig(seed=7,route?:readonly Point[]):Rig{
  const world=new SimWorld({terrain:city,seed,players:new Map<string,SimPlayer>(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const purse={grana:0},events:Got[]=[],work=new Map<string,boolean>();
  const sys=createBanks({seed,candidates:CANDIDATES,car:CAR,plaza:PLAZA,...(route?{route}:{}),wallet:{add:n=>{purse.grana+=n;}},work:id=>work.get(id)});
  const step=(n=1)=>{
    const got:Got[]=[];
    for(let i=0;i<n;i++){world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);for(const e of world.flush())got.push({tick:world.tick,e});}
    events.push(...got);return got;
  };
  return {world,sys,purse,events,work,step,bank:(i=0)=>sys.places[i]};
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
const bico=(got:readonly Got[])=>got.flatMap(g=>g.e.type==='bico'?[[g.e.player,g.e.what]]:[]);
/** A hero in the ring with Trabalhar held. */
function worker(r:Rig,id:string,p:Point){const h=addPlayer(r.world,id,p);r.work.set(id,true);return h;}
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
test('placement: 3 banks per seed, deterministic, ids and names, one per third, on the streets distCarro..distCarroMax from the car, desvio from the moto route (chaveiro) or the plaza (wall)',()=>{
  assert.equal(BANCO.count,3);
  const seen=new Set<string>(),relaxed:string[]=[],noLot:string[]=[],noDesvio:string[]=[];
  for(let seed=1;seed<=24;seed++){
    const route=planChaveiro(seed,OPEN,ENTRANCES,CAR).route.points;
    for(const [mode,anchor] of [['chaveiro',{route}],['muralha',{plaza:PLAZA}]] as const){
      const a=planBanks(seed,CANDIDATES,CAR,anchor),b=planBanks(seed,CANDIDATES,CAR,anchor);
      assert.deepEqual(b,a,`same seed, same banks (${mode} ${seed})`);
      assert.equal(a.length,BANCO.count);
      assert.deepEqual(a.map(p=>p.id),['banco-1','banco-2','banco-3']);
      assert.deepEqual([...a.map(p=>p.name)].sort(),[...BANK_IDS].sort());
      assert.equal(new Set(a.map(p=>`${p.x},${p.y}`)).size,3,'three different spots');
      for(const p of a)assert.ok(city.clearDisc(p.x,p.y,1.5),'on open street ground');
      // Bicos: the whole shop fits (a BICO.lote disc clear) wherever the ring has such a spot in that third.
      for(const p of a)if(!city.clearDisc(p.x,p.y,BICO.lote))noLot.push(`${mode} seed ${seed} ${p.id}`);
      assert.ok(onePerThird(a,CAR),`one per third of the map around the car (${mode} ${seed})`);
      for(const p of a){
        const fromAnchor='route' in anchor?distanceToPolyline(p,anchor.route):dist(p,anchor.plaza);
        if(dist(p,CAR)<BANCO.distCarro-1e-6||dist(p,CAR)>BANCO.distCarroMax+1e-6)
          relaxed.push(`${mode} seed ${seed} ${p.id}: car ${dist(p,CAR).toFixed(1)}`);
        else if(fromAnchor<BANCO.desvio[0]||fromAnchor>BANCO.desvio[1])noDesvio.push(`${mode} seed ${seed} ${p.id}: anchor ${fromAnchor.toFixed(1)}`);
      }
      seen.add(JSON.stringify(a.map(p=>[p.x,p.y])));
    }
  }
  assert.ok(seen.size>=12,`the seed moves the banks: ${seen.size} different layouts in 48`);
  // The fallback tiers (a third with no candidate that fits) must stay the exception on the real city.
  assert.deepEqual(relaxed,[],'every bank keeps the car ring on the real city');
  // Bicos: the shop's lot comes before the desvio rule; on the 1.75× shorter city (mapa-175-com-viaduto) a third rarely
  // has a lot off the route (chaveiro seed 7). It stays rare: at most 2 of the 144 banks.
  assert.ok(noDesvio.length<=2,`the desvio rule drops only for a lot, rarely: ${noDesvio.join('; ')}`);
  // On the 1.75× shorter city a few thirds have no clear BICO.lote disc on the ring at all (8 of 144 at lote 4, still 4
  // at lote 3); those shops stand on the fallback spot. Keep it the exception.
  assert.ok(noLot.length<=8,`the shop has its lot on the real city but rarely: ${noLot.length} without (${noLot.join('; ')})`);
});

test('placement in a run: the city has banks in both modes (route anchor with the chaveiro), the island and the endless world have none',()=>{
  for(const objective of ['chaveiro',undefined] as const){
    const world=new SimWorld({terrain:city.fork(),seed:11,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const run=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,...(objective?{objective}:{})});
    assert.ok(run.banks,`banks in the city (${objective??'muralha'})`);
    const anchor=objective?{route:run.chaveiro!.route.points}:{plaza:PLAZA};
    assert.deepEqual(run.banks.places,planBanks(11,CANDIDATES,CAR,anchor),'the run plans with the street ring (then the loot points), the car and the mode\'s anchor');
    for(const p of run.banks.places)if(p.crate)assert.ok(run.banks.crates.has(p.crate),`${p.id}: its crate is not in the run`);
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

// ---------- The shift (bicos) ----------
test('bicos: each shop has a gig, all different, drawn by the seed; the gig opens in its shop front',()=>{
  for(let seed=1;seed<=30;seed++){
    const a=firstBicos(seed,BANCO.count);
    assert.deepEqual(firstBicos(seed,BANCO.count),a);
    assert.equal(new Set(a).size,BANCO.count,`seed ${seed}: three different gigs`);
    for(const b of a)assert.ok((BICO_IDS as readonly string[]).includes(b));
  }
  assert.ok(new Set(Array.from({length:30},(_,i)=>firstBicos(i+1,BANCO.count).join())).size>10,'the seed moves the gigs');
  for(const id of BICO_IDS){assert.ok(BICOS[id].nome.length>0&&BICOS[id].frase.length>0,id);}
  const r=rig();
  assert.deepEqual(r.sys.view(0).map(v=>v.bico),firstBicos(7,BANCO.count));
});

test('shift: standing in the ring is not working; Trabalhar clocks in (bico entrou), R$ 5 a note (every BICO.nota/porSegundo s) into the wallet; moving or letting go clocks out; no input keeps them in',()=>{
  const r=rig(),b=r.bank();
  const h=addPlayer(r.world,'p1',at(b,BANCO.holdR-.1));
  assert.equal(cash(r.step(NOTA*2)).length,0,'in the ring without Trabalhar: nothing');
  assert.equal(row(r).state,'aberto');
  r.work.set('p1',true);
  const first=r.step(1);
  assert.deepEqual(bico(first),[['p1','entrou']]);
  assert.equal(row(r).state,'sacando');assert.deepEqual(viewOf(r).workers,['p1']);
  assert.equal(r.sys.working('p1'),b.id);
  assert.ok((h.invulnerableUntil??0)>r.world.tick,'inside: no hit lands');
  assert.equal(cash(r.step(NOTA-2)).length,0,'nothing before the first note');
  const note=r.step(1);
  assert.deepEqual(cash(note).map(g=>g.e.type==='bank-cash'&&[g.e.bank,g.e.amount,g.e.by]),[[b.id,BICO.nota,'hero']]);
  assert.equal(r.purse.grana,5);assert.equal(row(r).saldo,BANCO.saldo,'no saldo spent: the view keeps a full shop');
  // BICO.porSegundo: the notes of 15 s (6 at R$ 2/s).
  assert.equal(cash(r.step(ticks(15))).length,Math.floor(15*BICO.porSegundo/BICO.nota));
  // No input this tick (the room had none): still in.
  r.work.delete('p1');
  assert.deepEqual(bico(r.step(5)),[]);assert.equal(r.sys.working('p1'),b.id);
  // Moving (the players system hands false): out, and the pay stops.
  r.work.set('p1',false);
  assert.deepEqual(bico(r.step(1)),[['p1','saiu']]);
  assert.equal(r.sys.working('p1'),undefined);assert.equal(viewOf(r).workers,undefined);assert.equal(row(r).state,'aberto');
  assert.equal(cash(r.step(NOTA*2)).length,0);
  // Out of the ring, downed: never clocks in.
  const far=rig(),fb=far.bank();
  worker(far,'p1',at(fb,BANCO.holdR+.2));
  assert.equal(cash(far.step(NOTA*2)).length,0);assert.equal(row(far).state,'aberto');
  const down=rig(),db=down.bank();
  worker(down,'p1',at(db,1)).downed=true;
  assert.equal(cash(down.step(NOTA*2)).length,0);assert.equal(row(down).state,'aberto');
  // Pushed out of the ring while working: out.
  const push=rig(),pb=push.bank(),ph=worker(push,'p1',at(pb,1));
  push.step(3);ph.x=pb.x+BANCO.holdR+1;
  assert.deepEqual(bico(push.step(1)),[['p1','saiu']]);
});

test('shift: two or more share the boss\'s money (R$ 0.6/s each); a player works one shop at a time',()=>{
  const r=rig(),b=r.bank();
  worker(r,'p1',at(b,1));worker(r,'p2',at(b,-1));
  r.step(1);
  assert.deepEqual(viewOf(r).workers,['p1','p2']);
  const each=Math.ceil(BICO.nota*1000/bicoPay(row(r).bico,2,0));
  assert.equal(bicoPay(row(r).bico,2,0),Math.round(BICO.dupla*1000/SIM_HZ));
  r.step(each-2);
  assert.equal(cash(r.events).length,0);
  r.step(1);
  assert.equal(cash(r.events,'hero').length,2,'one note each at 0.6/s');
  assert.equal(r.purse.grana,10);
});

test('queue: each critter within 3 u cuts the pay by 25 % (fila in the view); 3 critters: the manager throws everyone out, slowed 1 s, kept out 3 s; the boss and the dead do not queue',()=>{
  const r=rig(),b=r.bank();
  const h=worker(r,'p1',at(b,0,1));
  r.step(1);
  const one=addEnemy(r.world,'q1',at(b,-(BANCO.filaR-.1)));
  r.step(1);
  assert.equal(viewOf(r).fila,1);
  assert.equal(bicoPay(row(r).bico,1,1),Math.round(BICO.porSegundo*(1-(BICOS[row(r).bico].filaCorte??BICO.filaCorte))*1000/SIM_HZ));
  assert.ok(bicoPay('telemarketing',1,1)<bicoPay('telemarketing',1,0));
  assert.ok(bicoPay('fiscal',1,1)>bicoPay('telemarketing',1,1),'the Fiscal de Fila loses less to the queue');
  // One 3.5 u away does not queue; the boss and a dead critter do not either.
  addEnemy(r.world,'far',at(b,BANCO.filaR+.5));addEnemy(r.world,'boss',at(b,1),{boss:true,hp:1000,maxHp:1000});addEnemy(r.world,'dead',at(b,-1,0),{hp:0});
  r.step(1);assert.equal(viewOf(r).fila,1);assert.deepEqual(viewOf(r).workers,['p1']);
  assert.equal(cash(r.events,'enemy').length,0,'a shift at work: the critters draw nothing');
  // Two more: out.
  addEnemy(r.world,'q2',at(b,0,-1));addEnemy(r.world,'q3',at(b,1,-1));
  const out=r.step(1);
  assert.deepEqual(bico(out),[['p1','expulso']]);
  assert.equal(r.sys.working('p1'),undefined);
  assert.equal(h.slowUntil,r.world.tick+ticks(BICO.expulsoS));
  // Still holding Trabalhar, the queue gone: kept out for 3 s, then back in.
  for(const id of ['q1','q2','q3'])r.world.enemies.delete(id);
  void one;
  assert.deepEqual(bico(r.step(ticks(BICO.banidoS)-1)),[]);
  assert.deepEqual(bico(r.step(1)),[['p1','entrou']]);
});
// ---------- The bait ----------
test('bait: each note of the shift lures the critters within 20 u (not the boss) to the bank for 4 s; they walk there and forget it after',()=>{
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
  const away=dist(spot!,b),hero=worker(r,'p1',at(b,-(spot!.x-b.x)/away,-(spot!.y-b.y)/away));
  const near=addEnemy(r.world,'near',spot!),edge=addEnemy(r.world,'edge',at(b,BANCO.iscaR-.1,0)),out=addEnemy(r.world,'out',at(b,BANCO.iscaR+1,0));
  const boss=addEnemy(r.world,'boss',at(b,0,-10),{boss:true,hp:1000,maxHp:1000});
  const got=r.step(NOTA);
  assert.equal(cash(got,'hero').length,1);
  const t=got.find(g=>g.e.type==='bank-cash')!.tick;
  assert.ok(got.every(g=>g.e.type!=='bank-cash'||g.e.bank===b.id));
  for(const e of [near,edge])assert.deepEqual([e.memory?.baitX,e.memory?.baitY,e.memory?.baitUntil],[b.x,b.y,t+ISCA],`${e.id} lured`);
  for(const e of [out,boss])assert.equal(e.memory?.baitUntil,undefined,`${e.id} not lured`);
  // The hero walks off (60 u): the bait is nearer than any player, the lured critter walks to the ATM.
  hero.x=b.x+60;hero.y=b.y;r.work.set('p1',false);
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
  assert.equal(row(r).saldo,BANCO.saldo,'the shop stays open');assert.equal(r.sys.state.taken,2);
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
  assert.equal(cash(r.step(BICHO_SAQUE*3)).length,0,'a hero in the ring (working or not): nobody draws');
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

// ---------- No limit ----------
test('no limit (bico-sem-limite-pix-voando): 3 min on the shift pay every note, alone and with 6 seats; no bank-empty, the shop never closes',()=>{
  for(const seats of [1,6]){
    const r=rig(),b=r.bank(),was=row(r).bico;
    worker(r,'p1',at(b,1));
    for(let i=2;i<=seats;i++)addPlayer(r.world,`p${i}`,at(b,60+i));
    r.step(1+NOTA*40);
    assert.equal(cash(r.events,'hero').length,40,`${seats} seats: 40 notes, R$ 200`);assert.equal(r.purse.grana,40*BICO.nota);
    assert.equal(ofType(r.events,'bank-empty').length,0);assert.equal(ofType(r.events,'bank-refill').length,0);
    assert.deepEqual(bico(r.events),[['p1','entrou']],'never thrown out by the till');
    assert.equal(row(r).state,'sacando');assert.equal(row(r).saldo,BANCO.saldo);assert.equal(row(r).bico,was);
  }
  // A critter robbing 1 min: it keeps taking (the Prime), the shop stays open.
  const s=rig(),c=s.bank();
  addEnemy(s.world,'e1',at(c,1));
  s.step(BICHO_SAQUE*30);
  assert.ok(cash(s.events,'enemy').length>=29,'a note every BICHO_SAQUE');assert.equal(ofType(s.events,'bank-empty').length,0);assert.equal(row(s).saldo,BANCO.saldo);
});

test('a closed row from before (a checkpoint of the old rule) opens at once with ANOTHER gig, none of the other shops',()=>{
  const r=rig(),b=r.bank(),was=row(r).bico;
  worker(r,'p1',at(b,1));
  Object.assign(r.sys.state.list[0],{saldo:0,state:'sem-cedulas',until:r.world.tick+ticks(100),clock:0,held:0});
  const refill=r.step(1);
  assert.deepEqual(refill.map(g=>g.e.type).slice(0,2),['bank-refill','bico']);
  assert.equal(row(r).saldo,BANCO.saldo);assert.equal(row(r).opened,1);
  const now=row(r).bico;
  assert.notEqual(now,was,'another gig');
  assert.ok(!r.sys.state.list.slice(1).some(x=>x.bico===now),'not one another shop has');
  assert.equal(now,nextBico(7,0,1,was,r.sys.state.list.slice(1).map(x=>x.bico)),'drawn by (seed, shop, times opened)');
  assert.equal(viewOf(r).until,undefined);
});

// ---------- Checkpoint ----------
interface Run {world:SimWorld;sys:RunSystems}
function assembled(seed:number,players:Map<string,SimPlayer>,objective:'chaveiro'|undefined,checkpoint?:ReturnType<RunSystems['state']>):Run{
  const world=new SimWorld({terrain:city.fork(),seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,...(objective?{objective}:{}),...(checkpoint?{checkpoint}:{})});
  return {world,sys};
}
for(const objective of ['chaveiro',undefined] as const){
  test(`checkpoint (${objective??'muralha'}): taken at an intermission mid-shift and mid-refill, a fresh world plays on with the same state hash on every tick`,()=>{
    const SEED=21,players=new Map<string,SimPlayer>();
    const a=assembled(SEED,players,objective);
    for(let i=0;i<20*60*4&&!(a.world.round.index===2&&a.world.round.phase==='prepare');i++)a.world.step();
    assert.equal(a.world.round.index,2);assert.equal(a.world.round.phase,'prepare');
    const banks=a.sys.banks!,[b0,b1]=banks.places;
    // p1 works bank 1 mid-note (in the shift since before: these runs take no input, so nobody clocks in or out);
    // bank 2 is dry and refills inside the window; bank 3 is half empty.
    addPlayer(a.world,'p1',at(b0,1));banks.state.list[0].workers=['p1'];
    for(let i=0;i<NOTA+NOTA/2;i++)a.world.step();
    assert.ok((banks.state.list[0].earn?.p1??0)>0,'mid-shift');
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
    assert.ok(notes>=3,`p1 kept working: ${notes} notes`);assert.equal(refills,1,'bank 2 refilled in the window');
    // The bank state moves the hash.
    const before=stateHash(a.sys.state());a.sys.banks!.state.list[2].saldo--;
    assert.notEqual(stateHash(a.sys.state()),before);
    a.sys.dispose();b.sys.dispose();
  });
}

test('bots in the wave: a full team (BANK_WAVE_MIN_UP standing) sends one bot per BANK_WAVE_PER to the nearest ATM, never the builder; a smaller team keeps the car',async()=>{
  const {bankTask,BANK_WAVE_MIN_UP,BANK_WAVE_PER,BANK_WAVE_REACH}=await import('../../src/sim/bot-brain.ts');
  const bot=(id:string,x:number,y:number)=>({id,online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x,y});
  const bank=(id:string,x:number,y:number)=>({id,x,y,name:'juros' as const,saldo:40,state:'aberto' as const,bico:'telemarketing' as const});
  // The car at the origin; three ATMs 40–50 u out (straight, no terrain); six bots, b1 the builder.
  const banks=[bank('banco-1',45,0),bank('banco-2',-45,0),bank('banco-3',0,50)];
  const players=[bot('b1',44,0),bot('b2',40,0),bot('b3',-41,0),bot('b4',-30,0),bot('b5',0,2),bot('b6',2,2)],ids=players.map(p=>p.id);
  const view=(list:typeof players,phase:'wave'|'prepare'='wave')=>({tick:1000,players:list,banks,enemies:[],
    round:{index:3,total:10,phase,phaseEndsTick:1000+ticks(20),remaining:0},camp:{grana:0},
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600}]} as any);
  assert.ok(BANK_WAVE_REACH>=45);
  const goes=ids.filter(id=>bankTask(view(players),id,ids,'b1'));
  assert.equal(goes.length,Math.floor(players.length/BANK_WAVE_PER),'one per BANK_WAVE_PER standing');
  assert.ok(!goes.includes('b1'),'the builder keeps the forge and the towers');
  assert.deepEqual(goes.map(id=>bankTask(view(players),id,ids,'b1')!.bank),['banco-2'],'the ATM with the nearest bot (b3, 4 u)');
  assert.deepEqual(goes,['b3']);
  // Fewer than BANK_WAVE_MIN_UP standing: nobody leaves the car in the wave.
  const pair=players.slice(0,BANK_WAVE_MIN_UP-1),pairIds=pair.map(p=>p.id);
  assert.deepEqual(pairIds.filter(id=>bankTask(view(pair),id,pairIds,'b1')),[]);
  // Enough Grana: nobody goes.
  assert.equal(ids.filter(id=>bankTask({...view(players),camp:{grana:1e6}},id,ids,'b1')).length,0);
});

test('bots at a shop: in the ring with no critter within 12 u and a short queue they hold Trabalhar and stand still; a critter near or a queue of 2 and they step out',async()=>{
  const {decide,newMemory,BICO_BOT_CLEAR,BICO_BOT_FILA}=await import('../../src/sim/bot-brain.ts');
  const bot=(id:string,x:number,y:number)=>({id,name:id,classId:'x',online:true,spectator:false,hp:100,maxHp:100,weapons:[],passives:[],bot:true,x,y});
  const shop=(fila?:number)=>[{id:'banco-1',x:45,y:0,name:'juros' as const,saldo:40,state:'aberto' as const,bico:'telemarketing' as const},
    {id:'banco-2',x:-45,y:0,name:'pao-duro' as const,saldo:40,state:'aberto' as const,bico:'curso' as const,...(fila?{fila}:{})},
    {id:'banco-3',x:0,y:50,name:'posto' as const,saldo:40,state:'aberto' as const,bico:'fiscal' as const}];
  const players=[bot('b1',44,0),bot('b2',30,0),bot('b3',-44,0),bot('b4',-30,0),bot('b5',0,2),bot('b6',2,2)],ids=players.map(p=>p.id);
  const view=(enemies:unknown[]=[],fila?:number)=>({tick:1000,players,banks:shop(fila),enemies,pickups:[],projectiles:[],telegraphs:[],offers:[],events:[],
    team:{xp:0,level:1,nextXp:10},round:{index:3,total:10,phase:'wave',phaseEndsTick:1000+ticks(20),remaining:0},camp:{grana:0,units:0},
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600}]} as any);
  const run=(v:unknown)=>decide({view:v as any,selfId:'b3',at:{x:-44,y:0},index:2,memory:newMemory(2),forger:'b1',teamBots:ids});
  const calm=run(view());
  assert.equal(calm.mode,'bank');assert.equal(calm.work,true);assert.deepEqual(calm.direction,{x:0,y:0});
  const near=run(view([{id:'e1',kind:'bebado',x:-44+BICO_BOT_CLEAR-1,y:0,hp:10,maxHp:10}]));
  assert.equal(near.mode,'bank');assert.notEqual(near.work,true,'a critter within 12 u: out');
  assert.notEqual(run(view([],BICO_BOT_FILA)).work,true,'a queue of 2: out');
});
