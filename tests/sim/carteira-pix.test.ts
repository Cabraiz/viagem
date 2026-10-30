// NEW-20261014-ORQ-carteira-e-pix (contract wallet.ts; board plans/carteira-pix-proposta.md): each player's wallet
// (SimPlayer.grana). Kill credit (the killer, a tower's owner, a split, the boss always split with a rotating
// remainder), the vaquinha, the PIX and its refusals, the inheritance, the checkpoint migration of the old team pot,
// and the room bots (they PIX only the forger, never a person).
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,PIX_MAX,PIX_MEMOS,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {defensesStep} from '../../src/sim/towers/system.ts';
import {payKill,splitAmong,vaquinha,walletOf} from '../../src/sim/wallet.ts';
import {GRANA_PER_KILL} from '../../src/rules/index.ts';
import {CEDULA_DELAY_SECONDS,CEDULA_WAIT_SECONDS} from '../../src/sim/progression.ts';
import {ticks} from '../../src/contract/index.ts';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';

function body(id:string,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},x:0,y:0,...extra} as SimPlayer;
}
const seats=(...list:SimPlayer[])=>new Map(list.map(p=>[p.id,p]));
const purses=(m:ReadonlyMap<string,SimPlayer>)=>[...m.values()].map(p=>walletOf(p));

test('split: equal whole parts in join order, the remainder one R$ at a time from a rotating cursor',()=>{
  const list=[body('a'),body('b'),body('c')],cursor={splitCursor:0};
  assert.deepEqual(splitAmong(list,10,cursor),[4,3,3]);assert.equal(cursor.splitCursor,1);
  assert.deepEqual(splitAmong(list,10,cursor),[3,4,3],'the next remainder starts after the last one paid');assert.equal(cursor.splitCursor,2);
  assert.deepEqual(splitAmong(list,2,cursor),[1,0,1],'and wraps');assert.equal(cursor.splitCursor,1);
  assert.deepEqual(splitAmong(list,9,cursor),[3,3,3],'no remainder: the cursor stays');assert.equal(cursor.splitCursor,1);
  assert.deepEqual(list.map(p=>p.grana),[11,10,10]);
  assert.deepEqual(splitAmong([],50,cursor),[],'nobody to pay: nothing happens');
});

test('kill credit: the killer, else the credit (a tower\'s owner), else split among the standing; the boss always among every seat',()=>{
  const a=body('a'),b=body('b'),c=body('c',{downed:{sinceTick:0,bleedOutTick:99,progress:0}}),s=body('s',{spectator:true});
  const players=seats(a,b,c,s),cursor={splitCursor:0},normal={},elite={elite:true},boss={boss:true};
  payKill(players,normal,1,cursor,'a');assert.deepEqual(purses(players),[1,0,0,0],'the killer');
  payKill(players,elite,5,cursor,undefined,'b');assert.deepEqual(purses(players),[1,5,0,0],'a tower\'s owner');
  payKill(players,normal,1,cursor,'gone','b');assert.deepEqual(purses(players),[1,6,0,0],'a killer no longer here: the credit');
  payKill(players,normal,1,cursor,'s');assert.deepEqual(purses(players),[2,6,0,0],'a spectator earns nothing: split among the standing (a, b; remainder from the cursor)');
  payKill(players,elite,5,cursor);assert.deepEqual(purses(players),[4,9,0,0],'no author: the standing a and b, the downed c out (3 to b: the cursor moved on)');
  payKill(players,boss,50,cursor,'a');assert.deepEqual(purses(players),[21,26,16,0],'the boss: every seat, downed included, the spectator out; 50 = 17+17+16, the remainder from the cursor');
  a.downed=b.downed={sinceTick:0,bleedOutTick:99,progress:0};
  payKill(players,normal,1,cursor);assert.equal(purses(players).reduce((n,x)=>n+x,0),64,'nobody standing: still paid to a seat');
});

test('kill credit through the world: a tower kill\'s cédula flies to its owner, never as their kill; the boss splits at once; nobody\'s kill goes to the nearest hero',()=>{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:defaultTerrain,seed:9,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const run=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{}});
  world.step();
  // Both heroes far from the kills (NEW-20261024-ORQ-tirar-drops-cedula-girando): nobody walks by the cédula, so after
  // CEDULA_WAIT_SECONDS it flies by itself (only the pickups system runs here).
  const a=body('a',{x:30,y:30}),b=body('b',{x:30,y:31});players.set('a',a);players.set('b',b);
  const settle=(seconds:number)=>{for(let i=0;i<ticks(seconds);i++){world.tick++;run.progression.pickups.step(world);}};
  const enemy=(id:string,extra:Partial<EnemyState>={})=>{const e:EnemyState={id,kind:'bebado',x:6,y:5,hp:1,maxHp:1,speed:1,damage:1,radius:.4,xp:0,spawnTick:0,readyTick:0,...extra};world.enemies.set(id,e);return e;};
  // A ready Vigia of a's fires in the wave: the kill's Grana goes to a, the kill event names nobody.
  const st=run.stonewards.state;
  st.defenses={list:[{id:'defesa-9',kind:'vigia-do-predio',site:'obra-01',owner:'a',x:5,y:5,hp:100,maxHp:100,r:1,startTick:0,readyTick:0,fireTick:0}],gustavoes:0};
  enemy('t1');world.enemyIndex.rebuild(world.enemies.values());
  world.round.phase='wave';defensesStep(world,st);
  assert.equal(world.enemies.has('t1'),false,'the Vigia killed it');
  assert.deepEqual([a.grana,b.grana],[undefined,undefined],'nothing at once');
  settle(CEDULA_DELAY_SECONDS);
  const note=[...world.pickups.values()].find(p=>p.kind==='grana');
  assert.ok(note&&note.value===GRANA_PER_KILL.normal&&note.owner==='a','the cédula, a second later, a\'s');
  settle(CEDULA_WAIT_SECONDS+5);
  assert.deepEqual([a.grana,b.grana],[GRANA_PER_KILL.normal,undefined],'flew to a');
  const kill=world.flush().find(e=>e.type==='kill');assert.ok(kill&&kill.type==='kill'&&kill.by===undefined,'not a\'s kill (stats, xp)');
  // Nobody's kill (an explosion): the nearest hero (a, a step closer) gets it all.
  enemy('n1',{elite:true});world.damageEnemy('n1',1e9);
  settle(CEDULA_DELAY_SECONDS+CEDULA_WAIT_SECONDS+5);
  assert.deepEqual([walletOf(a),walletOf(b)],[GRANA_PER_KILL.normal+GRANA_PER_KILL.elite,0]);
  // The boss, last-hit by b: split anyway.
  const before=[walletOf(a),walletOf(b)];
  enemy('boss',{boss:true});world.damageEnemy('boss',1e9,'b');
  assert.deepEqual([walletOf(a)-before[0],walletOf(b)-before[1]],[GRANA_PER_KILL.boss/2,GRANA_PER_KILL.boss/2]);
  assert.equal(st.splitCursor,0,'no remainder: the elite\'s cédula went whole to one hero');
  run.dispose();
});

test('vaquinha: equal parts; the short pay what they have; the richest cover the rest; what nobody has is debt',()=>{
  const pay=(had:number[],bill:number)=>{const list=had.map((g,i)=>body(`p${i}`,{grana:g}));const r=vaquinha(list,bill);return {...r,left:list.map(p=>p.grana)};};
  assert.deepEqual(pay([100,100,100],60),{grana:300,paid:60,debt:0,share:[{id:'p0',had:100,paid:20},{id:'p1',had:100,paid:20},{id:'p2',had:100,paid:20}],left:[80,80,80]});
  assert.deepEqual(pay([5,100,40],60).share.map(s=>s.paid),[5,35,20],'p0 is short by 15: the richest left (p1) covers it');
  assert.deepEqual(pay([5,30,40],60).share.map(s=>s.paid),[5,20,35],'p2 has the most left: it covers first');
  assert.deepEqual(pay([5,22,21],60),{grana:48,paid:48,debt:12,share:[{id:'p0',had:5,paid:5},{id:'p1',had:22,paid:22},{id:'p2',had:21,paid:21}],left:[0,0,0]});
  assert.deepEqual(pay([100,100,100],10).share.map(s=>s.paid),[4,3,3],'the division\'s remainder: the richest (ties: join order)');
  assert.deepEqual(pay([],25),{grana:0,paid:0,debt:25,share:[],left:[]});
});

/** An island simulation with seats a, b, c (spectator) and wallets, in its first run. */
function pixSim(){
  const sim=new Simulation(77);
  const a=sim.add('a','Ana','cidadao-comum'),b=sim.add('b','Bia','cidadao-comum'),c=sim.add('c','Caio','cidadao-comum');
  sim.resetRun();c.spectator=true;a.grana=150;b.grana=3;
  return {sim,a,b,c};
}
test('PIX: the validation table, the money, the event with its memo, and a resent req',()=>{
  const {sim,a,b}=pixSim();
  const no=(from:string,to:string,amount:number,reason:string,req?:string)=>assert.deepEqual(sim.pix(from,to,amount,req),{ok:false,reason},`${from}→${to} ${amount}`);
  for(const amount of [0,-5,1.5,PIX_MAX+1,Number.NaN,Infinity])no('a','b',amount,'amount');
  no('b','a',4,'grana');no('a','a',5,'self');no('a','zé',5,'target');no('a','c',5,'target');no('c','a',1,'phase');no('ghost','a',1,'phase');
  assert.deepEqual([a.grana,b.grana],[150,3],'nothing moved');
  assert.deepEqual(sim.pix('a','b',PIX_MAX,'p:1'),{ok:true,to:'b',amount:PIX_MAX,grana:50});
  assert.deepEqual([a.grana,b.grana],[50,103]);
  no('a','b',10,'duplicate','p:1');
  assert.deepEqual(sim.pix('b','a',3,'p:1'),{ok:true,to:'a',amount:3,grana:100},'request ids are per sender');
  const events=sim.step().filter(e=>e.type==='pix');
  assert.equal(events.length,2);
  for(const e of events)assert.ok(e.type==='pix'&&Number.isInteger(e.memo)&&e.memo>=0&&e.memo<PIX_MEMOS.length);
  assert.deepEqual(events.map(e=>e.type==='pix'&&[e.from,e.to,e.amount]),[['a','b',PIX_MAX],['b','a',3]]);
  (sim as unknown as {result:string}).result='victory';
  no('a','b',1,'phase');
});
test('PIX memos: drawn from the run\'s own stream (the same on a replay and after a checkpoint), not all alike',()=>{
  const memos=(sim:Simulation,n:number)=>{const out:number[]=[];for(let i=0;i<n;i++){sim.pix('a','b',1);sim.pix('b','a',1);for(const e of sim.step())if(e.type==='pix')out.push(e.memo);}return out;};
  const one=pixSim().sim,two=pixSim().sim;
  const first=memos(one,6);
  assert.deepEqual(memos(two,6),first,'same seed, same PIX: same memos');
  assert.ok(new Set(first).size>1,`varied: ${first.join(',')}`);
  // The stream lives in the stonewards state (checkpointed): restored, it goes on alike.
  const st=one.run.stonewards.state,copy=structuredClone(st);
  const next=memos(one,3);
  Object.assign(two.run.stonewards.state,copy);
  assert.deepEqual(memos(two,3),next);
});

test('inheritance: a player removed for good leaves their wallet to the seats that stay (the same split); spectators get none',()=>{
  const {sim,a,b,c}=pixSim();
  const d=sim.add('d','Duda','cidadao-comum');d.grana=1;a.grana=11;
  sim.remove('a');
  assert.equal(sim.players.has('a'),false);
  assert.deepEqual([b.grana,c.grana,d.grana],[3+6,undefined,1+5],'11 between b and d (c spectates), the remainder to the first');
  assert.equal(sim.run.stonewards.state.splitCursor,1);
  sim.remove('c');assert.deepEqual([b.grana,d.grana],[9,6],'an empty wallet leaves nothing');
  sim.remove('b');assert.equal(d.grana,15);
  sim.remove('d');assert.equal(sim.players.size,0,'the last one: the money is gone with them');
});

test('a new run empties the wallets; a seat added later starts at 0',()=>{
  const {sim,a,b}=pixSim();
  sim.resetRun();
  assert.deepEqual([a.grana,b.grana],[undefined,undefined]);
  assert.equal(sim.add('e','Edu','cidadao-comum').grana,undefined);
});

const SEED=4242,BOTS=[['bot-1','Robô do Gás','tio-do-churrasco'],['bot-2','Robô da Feira','cidadao-comum'],['bot-3','Robô do Bar','cidadao-comum']] as const;
const seat=(sim:Simulation)=>{for(const [id,name,classId] of BOTS)sim.addBot(id,name,classId);return sim;};
function playTo(round:number){
  const sim=seat(new Simulation(SEED,{world:'infinito'})),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
  sim.resetRun();
  for(let i=0,before=sim.world.round.index;i<20*60*6;i++){
    bots.think(sim);sim.step(sim.tick*50);
    if(sim.world.round.index!==before&&sim.world.round.index===round)return sim;
    before=sim.world.round.index;
  }
  throw new Error(`never reached round ${round}`);
}
type Pot={shape:string;systems:{stonewards:{grana?:number;splitCursor?:number}};players:{id:string;run:{grana?:number}}[]};
test('checkpoint: the wallets ride with the players; a checkpoint with the old team pot is split among them and resumes',()=>{
  const sim=playTo(2);
  assert.ok(sim.teamGrana()>0,'the kills of round 1 paid the wallets');
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint&Pot;
  assert.deepEqual(cp.players.map(p=>p.run.grana),[...sim.players.values()].map(p=>p.grana),'in the checkpoint with the players');
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.resume(JSON.parse(JSON.stringify(cp))),true);
  assert.deepEqual([...fresh.players.values()].map(p=>p.grana),[...sim.players.values()].map(p=>p.grana),'resumed with them');
  // The build before the wallets: a pot of R$ 100 in the stonewards state, no cursor, no wallet on the players.
  const pot=JSON.parse(JSON.stringify(cp)) as Pot;
  pot.systems.stonewards.grana=100;delete pot.systems.stonewards.splitCursor;for(const p of pot.players)delete p.run.grana;
  pot.shape=fresh.freshShape().pot;
  assert.notEqual(fresh.freshShape().pot,fresh.freshShape().fingerprint,'the wallets changed the fingerprint on purpose');
  const old=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(old.checkpointShapeOk(pot),true,'migrated before the shape check');
  assert.deepEqual(pot.players.map(p=>p.run.grana),[34,33,33],'R$ 100 split among the three, the remainder to the first');
  assert.equal(pot.systems.stonewards.grana,undefined);assert.equal(pot.systems.stonewards.splitCursor,1);
  assert.equal(old.resume(pot),true);
  assert.deepEqual([...old.players.values()].map(p=>p.grana),[34,33,33]);
  const again=JSON.parse(JSON.stringify(pot));old.migrateCheckpoint(again);assert.deepEqual(again,pot,'idempotent');
  // A wallet that is not a whole non-negative R$ is refused like any other junk.
  const junk=JSON.parse(JSON.stringify(cp)) as Pot;junk.players[0].run.grana=-3;
  assert.equal(seat(new Simulation(SEED,{world:'infinito'})).resume(junk),false);
});

test('room bots: each spends its own wallet, sends its surplus to the forger by PIX, never to a person',()=>{
  const sim=new Simulation(SEED,{world:'infinito'}),bots=new RoomBots();
  sim.botState=()=>bots.state();
  const ana=sim.add('ana','Ana','cidadao-comum');
  BOTS.forEach(([id,name,classId],i)=>{sim.addBot(id,name,classId);bots.add(id,i);});
  sim.resetRun();
  const pixes:{from:string;to:string;amount:number}[]=[];
  for(let i=0;i<20*60*4&&!sim.outcome;i++){
    ana.invulnerableUntil=Number.MAX_SAFE_INTEGER;
    bots.think(sim);
    for(const e of sim.step(sim.tick*50))if(e.type==='pix')pixes.push({from:e.from,to:e.to,amount:e.amount});
  }
  console.log(`[carteira-pix] 3 bots + Ana, 4 min: ${pixes.length} PIX (R$ ${pixes.reduce((n,p)=>n+p.amount,0)}), wallets ${[...sim.players.values()].map(p=>`${p.id} ${walletOf(p)}`).join(', ')}`);
  assert.ok(pixes.length>0,'the bots sent their surplus');
  assert.equal(bots.pixes,pixes.length);
  assert.ok(pixes.every(p=>sim.bots.has(p.from)&&sim.bots.has(p.to)),'bot to bot only');
  assert.ok(pixes.every(p=>p.to!=='ana'),'never to the person');
  assert.equal(new Set(pixes.map(p=>p.to)).size,1,'all to the forger (the first standing bot)');
  assert.ok(pixes.every(p=>p.amount>=5&&p.amount<=PIX_MAX));
});
