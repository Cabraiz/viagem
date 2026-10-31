/**
 * NEW-20261013-ORQ-papeis-de-inimigo (D-040): roster entries in the sim.
 *  - enemyDef: the nine keep their hand-tuned defs; every other roster id is its role's profile on the role's base kind
 *    (stats × multipliers, the base's behavior, its own or its role's lines); createEnemy takes any roster id
 *  - a hazard a roster entry leaves behind names it once it is gone (hazardOwner/hazardKind); the nine's owners as before
 *  - roles on the nine's behaviors: an atirador fires the generic shot (no devendo), a refletor reflects, a suporte is the
 *    weapons' priority target; the brutamontes shoves on contact
 *  - the invocador: a warned call (spawn-warnings ≥ SUMMON.safe from players), then 2-3 minions of the given kinds, flagged,
 *    capped (SUMMON.maxGlobal), nobody if he dies first, through EnemyAiOptions.summon when given
 *  - the mini-chefe: a warned 'pancada' stomp around himself (≥ MIN_TELEGRAPH_TICKS), phase 1, it fizzles if he dies
 *  - the director's rotation: drawn on the first step from its own stream, JSON (checkpoint round-trip), rounds spawn only
 *    its entries, the invocador's minions join the round (tracked, scaled), off by default
 *  - a full assembled run (6 room bots, rotation on, endless world) ends without error
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type RoundState,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import {Rng} from '../../src/contract/rng.ts';
import {SimWorld} from '../../src/sim/core.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {AGIOTA_SHOT,BRUTE,ENEMIES,ENEMY_KINDS,GENERIC_SHOT_SOURCE,HAZARD_OWNERS,POSE_STATE,SLAM,SUMMON,createEnemy,enemyDef,
  hazardKind,hazardOwner,isEnemyKind,isPriorityTarget,isReflecting,roleHp} from '../../src/sim/enemies/catalog.ts';
import {ENEMY_PHASE,EnemyAi,MINION_FLAG,STATE,type EnemyAiOptions} from '../../src/sim/enemies/ai.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import {createDirector,type DirectorOptions} from '../../src/sim/director.ts';
import {MAX_PROJECTILES} from '../../src/rules/budget.ts';
import {CIDADE_MODIFIERS,LEGACY_KINDS,enemyFeel,MAX_ROUND_ENEMIES,MINI_SOLO_HP,MODIFIERS,ROLE_PROFILES,ROSTER,THREAT,drawRotation,entryLines,isRotation,planRound,roleOf,rotationIds,
  roundRoster,type RegularKind} from '../../src/rules/index.ts';
import {CITY_BALANCE,applyCityBalance,isNeutralRound,roundKnobs} from '../../src/sim/city/balance.ts';
import {walkable,SPAWN,type Point} from '../../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';
import {setRosterOnlyLiberados,setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
// A deterministic run script: the whole roster (ROSTER_ONLY_WITH_ART off); tests/rules/enemy-art-ids.test.ts plays art only.
setRosterOnlyWithArt(false);setRosterOnlyLiberados(false);

const TERRAIN=new TerrainField(DEFAULT_SEED,{world:'infinito'});
function openSpot(r:number):Point{
  const clear=(c:Point)=>{
    for(let dx=-r;dx<=r;dx+=.5)for(let dy=-r;dy<=r;dy+=.5)if(dx*dx+dy*dy<=r*r&&!walkable({x:c.x+dx,y:c.y+dy},TERRAIN))return false;
    return true;
  };
  for(let x=-60;x<=60;x+=2)for(let y=-60;y<=60;y+=2)if(clear({x,y}))return {x,y};
  throw new Error(`no open disc of radius ${r}`);
}
const O=openSpot(10);
const at=(dx:number,dy=0):Point=>({x:O.x+dx,y:O.y+dy});
function arena(seed=1,round=7,options:EnemyAiOptions={}){
  const world=new SimWorld({terrain:TERRAIN,seed});
  world.round.index=round;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES,...options});
  world.register(ai).register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  const events:(SimEvent&{tick:number})[]=[];
  const step=(n:number,each?:()=>void)=>{for(let i=0;i<n;i++){for(const e of world.step())events.push({...e,tick:world.tick});each?.();}};
  return {world,ai,events,step};
}
function addPlayer(world:{players:Map<string,SimPlayer>},id:string,p:Point,extra:Partial<SimPlayer>={}){
  const player:SimPlayer={id,classId:'test',x:p.x,y:p.y,hp:1000,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS,maxHp:1000},weaponReady:{},...extra};
  world.players.set(id,player);
  return player;
}
const ofRole=(role:string,priority='P0')=>ROSTER.find(e=>e.role===role&&!e.legacy&&e.priority===priority)!.id;

// ---------- defs ----------
test('enemyDef: the nine are their catalog defs; every roster id is its role on the base kind, with its lines',()=>{
  for(const kind of ENEMY_KINDS)assert.equal(enemyDef(kind),ENEMIES[kind],kind);
  assert.deepEqual([...ENEMY_KINDS],[...LEGACY_KINDS]);
  for(const e of ROSTER){
    assert.ok(isEnemyKind(e.id),e.id);
    // The own entries (pack 6: the sanfoneiro) have their own def (sim/enemies/sanfoneiro.ts, tests/sim/sanfoneiro.test.ts).
    if(e.legacy||e.pack===6)continue;
    const def=enemyDef(e.id),r=ROLE_PROFILES[e.role],base=ENEMIES[r.base];
    assert.equal(def,enemyDef(e.id),'built once');
    assert.equal(def.id,e.id);assert.equal(def.name,e.name);assert.equal(def.behavior,r.behavior,e.id);
    // The clones' feel (rules/enemy-feel.ts, tests/sim/inimigos-variedade.test.ts) sits on top; the rest are the role's own numbers.
    const f=enemyFeel(e.id)??{speed:1,hp:1,radius:1,sway:1};
    assert.equal(def.hp,f.hp===1?roleHp(e.role,base.hp):Math.round(roleHp(e.role,base.hp)*f.hp),`${e.id} hp (the role's, ROLE_HITS)`);
    assert.equal(def.speed,base.speed*r.speed*f.speed);assert.equal(def.damage,Math.max(1,Math.round(base.damage*r.damage)));
    assert.equal(def.radius,base.radius*r.radius*e.cell/r.cell*f.radius);assert.equal(def.contactCooldown,base.contactCooldown);
    assert.equal(def.accent,e.accent);
    const lines=entryLines(e.id)!;
    assert.equal(def.barks,lines.barks);assert.equal(def.deathLines,lines.deathLines);assert.equal(def.reactionLines,r.reactionLines);
    assert.ok(def.reactionLines.length>0,`${e.id}: a palhaço's joke needs a line to start`);
    assert.equal(def.marks,undefined,`${e.id}: only the agiota marks`);
    if(r.behavior==='ranged')assert.equal(def.shotSource,GENERIC_SHOT_SOURCE);
    if((r.behavior==='swarm'||r.behavior==='stagger')&&f.sway===1)assert.deepEqual(def.zigzag,base.zigzag,`${e.id} sways like its base`);
    assert.ok(Object.isFrozen(def));
  }
  assert.equal(ENEMIES.agiota.marks,'devendo');assert.equal(ENEMIES.agiota.shotSource,AGIOTA_SHOT.source);
  assert.equal(enemyDef('não-existe'),ENEMIES.bebado,'unknown reads as the bêbado');
  assert.ok(!isEnemyKind('gosma')&&!isEnemyKind(''));
});

test('createEnemy takes any roster id (the chefe role is a boss body); unknown ids throw',()=>{
  const world=new SimWorld({terrain:TERRAIN,seed:3});
  for(const e of ROSTER){
    const made=createEnemy(world,e.id,O,2);
    assert.equal(made.kind,e.id);assert.equal(made.maxHp,Math.max(1,Math.round(enemyDef(e.id).hp*2)));
    assert.equal(!!made.boss,e.role==='chefe',e.id);
  }
  assert.throws(()=>createEnemy(world,'gosma',O),/unknown enemy kind/);
});

test('hazards: the nine\'s owners as before; a roster entry\'s owner names it once it is gone',()=>{
  assert.equal(hazardOwner(HAZARD_OWNERS.molotov,{id:'e9',kind:'anao-molotov'}),'env:molotov:e9');
  assert.equal(hazardKind('env:molotov:e9'),'anao-molotov');assert.equal(hazardKind('env:poop:e2'),'pombos');
  const thrower=ofRole('arremessador'),flyer=ofRole('voador'),kami=ofRole('kamikaze');
  assert.equal(hazardKind(hazardOwner(HAZARD_OWNERS.molotov,{id:'e1',kind:thrower})),thrower);
  assert.equal(hazardKind(hazardOwner(HAZARD_OWNERS.explosion,{id:'e1',kind:thrower})),thrower);
  assert.equal(hazardKind(hazardOwner(HAZARD_OWNERS.poop,{id:'e2',kind:flyer})),flyer);
  assert.equal(hazardKind(hazardOwner(HAZARD_OWNERS.marmita,{id:'e3',kind:kami})),kami);
  assert.equal(hazardKind('env:poop:e2@nao-existe'),'pombos','an unknown suffix falls back to the hazard\'s kind');
  for(const other of ['env:boss','e9','boss-1','x@'+thrower])assert.equal(hazardKind(other),undefined,other);
});

test('roles on the nine\'s behaviors: generic shot without devendo, a refletor reflects, a suporte is a priority target',()=>{
  const A=arena(4,7);
  const me=addPlayer(A.world,'p',at(5));
  const gunner=createEnemy(A.world,ofRole('atirador'),O);
  let shot:{source:string;marks?:string}|undefined;
  A.step(ticks(4),()=>{shot??=[...A.world.projectiles.values()].find(p=>p.owner===gunner.id) as typeof shot;});
  assert.ok(shot,'the atirador fired');
  assert.equal(shot!.source,GENERIC_SHOT_SOURCE);assert.equal(shot!.marks,undefined);
  assert.ok(A.events.some(e=>e.type==='damage'&&e.target==='p'),'and hit');
  assert.equal((me as {devendoUntil?:number}).devendoUntil,undefined,'no devendo mark');
  const poser=createEnemy(A.world,ofRole('refletor'),at(-3));
  poser.memory={...poser.memory!,state:POSE_STATE,until:A.world.tick+10};
  assert.ok(isReflecting(poser,A.world.tick));
  assert.ok(isPriorityTarget({kind:ofRole('suporte')})&&isPriorityTarget({kind:'coach'})&&!isPriorityTarget({kind:ofRole('corredor')}));
});

test('brutamontes: walks in and every contact hit shoves the player BRUTE.shove away',()=>{
  const A=arena(5,7);
  const p=addPlayer(A.world,'p',at(.9));
  const brute=createEnemy(A.world,ofRole('brutamontes'),O);
  brute.memory={...brute.memory,actReady:1e9};// the contact alone: his stomp (BRUTE_SLAM) is tests/sim/inimigos-variedade.test.ts
  const before={x:p.x,y:p.y};let hit=-1;
  A.step(ticks(1),()=>{if(hit<0&&A.events.some(e=>e.type==='damage'&&e.target==='p'&&e.source===brute.id))hit=A.world.tick;});
  assert.ok(hit>0,'it hit');
  assert.ok(Math.hypot(p.x-before.x,p.y-before.y)>=BRUTE.shove*.9,`shoved ${Math.hypot(p.x-before.x,p.y-before.y).toFixed(2)}`);
});

// ---------- invocador ----------
test('invocador: warned call (2-3 spawn-warnings away from players, phase 1), then the minions of the given kinds, flagged',()=>{
  const kinds=[ofRole('corredor'),ofRole('enxame')];
  const A=arena(6,7,{minionKinds:()=>kinds});
  addPlayer(A.world,'p',at(5));
  const caller=createEnemy(A.world,ofRole('invocador'),O);
  let started=-1;
  A.step(ticks(1),()=>{if(started<0&&caller.memory?.state===STATE.summon)started=A.world.tick;});
  assert.ok(started>0,'he called');
  assert.equal(caller.phase,ENEMY_PHASE.acting);
  const warnings=A.events.filter(e=>e.type==='spawn-warning');
  assert.ok(warnings.length>=SUMMON.count[0]&&warnings.length<=SUMMON.count[1],`${warnings.length} warnings`);
  for(const w of warnings){
    if(w.type!=='spawn-warning')continue;
    assert.equal(w.atTick-started,SUMMON.warn);assert.ok(Math.hypot(w.x-at(5).x,w.y-at(5).y)>=SUMMON.safe);
    assert.ok(Math.abs(Math.hypot(w.x-caller.x,w.y-caller.y)-SUMMON.radius)<1e-6);
  }
  A.step(SUMMON.warn+1);
  const minions=[...A.world.enemies.values()].filter(e=>e.memory?.[MINION_FLAG]===1);
  assert.equal(minions.length,warnings.length);
  for(const m of minions){assert.ok(kinds.includes(m.kind),m.kind);assert.ok(m.readyTick>=m.spawnTick);}
  assert.notEqual(caller.memory?.state,STATE.summon);assert.ok(caller.memory!.actReady>A.world.tick);
  assert.equal(Object.keys(caller.memory!).filter(k=>/^s\d[xy]$/.test(k)).length,0,'the spots are forgotten');
});

test('invocador: no call at the minion cap, nobody comes when he dies mid-call, the summon option makes the minions',()=>{
  // At the cap: SUMMON.maxGlobal minions alive.
  const A=arena(7,7);addPlayer(A.world,'p',at(5));
  for(let i=0;i<SUMMON.maxGlobal;i++){const m=createEnemy(A.world,'pombos',at(-8,i*.3-2));m.memory={...m.memory!,[MINION_FLAG]:1};m.readyTick=1e9;}
  const capped=createEnemy(A.world,ofRole('invocador'),O);
  A.step(ticks(2));
  assert.ok(!A.events.some(e=>e.type==='spawn-warning'),'no call at the cap');assert.notEqual(capped.memory?.state,STATE.summon);
  // Killed mid-call.
  const B=arena(8,7);addPlayer(B.world,'p',at(5));
  const doomed=createEnemy(B.world,ofRole('invocador'),O);
  B.step(ticks(1),()=>{if(doomed.memory?.state===STATE.summon&&B.world.enemies.has(doomed.id))B.world.damageEnemy(doomed.id,1e6);});
  B.step(SUMMON.warn+2);
  assert.ok(B.events.some(e=>e.type==='spawn-warning'));
  assert.equal([...B.world.enemies.values()].filter(e=>e.memory?.[MINION_FLAG]===1).length,0,'nobody came');
  // The summon option.
  const asked:string[]=[];
  const C=arena(9,7,{minionKinds:()=>['bebado'],summon:(ctx,kind,p)=>{asked.push(kind);return createEnemy(ctx,kind,p,.1);}});
  addPlayer(C.world,'p',at(5));createEnemy(C.world,ofRole('invocador'),O);
  C.step(ticks(1)+SUMMON.warn+2);
  assert.ok(asked.length>=SUMMON.count[0]&&asked.every(k=>k==='bebado'),asked.join());
  for(const m of [...C.world.enemies.values()].filter(e=>e.memory?.[MINION_FLAG]===1))assert.equal(m.maxHp,Math.max(1,Math.round(ENEMIES.bebado.hp*.1)));
});

// ---------- mini-chefe ----------
test('mini-chefe: a warned pancada stomp around him (≥ MIN_TELEGRAPH_TICKS, phase 1) that hurts; it fizzles if he dies',()=>{
  const A=arena(10,8);
  addPlayer(A.world,'p',at(2));
  const boss=createEnemy(A.world,ofRole('mini-chefe'),O);
  let t:ReturnType<typeof A.world.telegraphs.get>,made=-1;
  A.step(ticks(2),()=>{if(made<0){t=[...A.world.telegraphs.values()].find(x=>x.owner===boss.id&&x.kind==='pancada');if(t)made=A.world.tick;}});
  assert.ok(t&&made>0,'he stomped');
  assert.equal(t!.shape,'circle');assert.ok(Math.abs(t!.radius-(SLAM.radius+boss.radius))<1e-9);
  assert.ok(t!.fireTick-made>=MIN_TELEGRAPH_TICKS);
  const B=arena(10,8);addPlayer(B.world,'p',at(2));
  const doomed=createEnemy(B.world,ofRole('mini-chefe'),O);
  let killed=false;
  B.step(ticks(3),()=>{if(!killed&&doomed.memory?.state===STATE.slam){assert.equal(doomed.phase,ENEMY_PHASE.acting);B.world.damageEnemy(doomed.id,1e6);killed=true;}});
  assert.ok(killed);
  assert.ok(!B.events.some(e=>e.type==='damage'&&e.target==='p'&&e.source===doomed.id),'no damage from a dead stomper');
  assert.ok(A.events.some(e=>e.type==='damage'&&e.target==='p'&&e.source===boss.id),'the stomp (or his contact) hurts');
});

// ---------- director ----------
type FakeCtx=SimContext&{tick:number;ids:number;events:SimEvent[];round:RoundState;players:Map<string,SimPlayer>};
function fakeCtx(seed:number,terrain=new TerrainField(seed)):FakeCtx{
  const round:RoundState={index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0};
  const ctx:FakeCtx={
    tick:0,runStartTick:0,ids:0,terrain,rng:new Rng(seed),events:[],players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),
    telegraphs:new Map(),team:{xp:0,level:1,nextXp:5},offers:new Map(),round,
    enemyIndex:{rebuild(){},query:()=>[],nearest:()=>undefined},
    nextId:prefix=>`${prefix}-${++ctx.ids}`,
    emit(event){ctx.events.push(event);},
    damageEnemy(id,amount){const e=ctx.enemies.get(id);if(!e)return false;e.hp-=amount;if(e.hp>0)return false;ctx.enemies.delete(id);ctx.emit({type:'kill',enemy:id,kind:e.kind,x:e.x,y:e.y});return true;},
    damagePlayer(){},
  };
  return ctx;
}
const directorOptions=(created:{round:number;kind:string;scale:number}[],extra:Partial<DirectorOptions>={}):DirectorOptions=>({
  createEnemy(ctx,kind,point,scale){const e=createEnemy(ctx,kind,point,scale);created.push({round:ctx.round.index,kind,scale});return e;},
  spawnBoss(ctx,point){return createEnemy(ctx,'chefe',point,1);},
  ...extra,
});
const runDirector=(ctx:FakeCtx,d:{step(ctx:SimContext):void},n:number)=>{
  for(let i=0;i<n;i++){ctx.tick++;d.step(ctx);for(const e of [...ctx.enemies.values()])if(ctx.tick-e.spawnTick>=ticks(2))ctx.damageEnemy(e.id,1e9);}
};

test('director: the rotation is drawn on the first step (JSON), rounds spawn only its entries; off by default',()=>{
  const created:{round:number;kind:string;scale:number}[]=[];
  const ctx=fakeCtx(21,new TerrainField(2));ctx.players.set('a',{id:'a',classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...SPAWN});
  const d=createDirector(directorOptions(created,{rotation:true}));
  runDirector(ctx,d,1);
  const rotation=d.state.rotation!;
  assert.ok(isRotation(rotation)&&isRotation(JSON.parse(JSON.stringify(rotation))));
  runDirector(ctx,d,ticks(60*6));
  assert.ok(ctx.round.index>=4,`reached round ${ctx.round.index}`);
  const ids=new Set(rotationIds(rotation));
  for(const c of created)assert.ok(ids.has(c.kind),`round ${c.round}: ${c.kind} outside the rotation`);
  for(const c of created)assert.ok(Object.values(roundRoster(rotation,c.round).roles).flat().includes(c.kind)||c.kind===roundRoster(rotation,c.round).elite||c.kind===roundRoster(rotation,c.round).solo,`round ${c.round}: ${c.kind} outside its band`);
  // Off: the table's nine kinds, no rotation in the state.
  const plain:typeof created=[];const ctx2=fakeCtx(21,new TerrainField(2));ctx2.players=ctx.players;
  const d2=createDirector(directorOptions(plain));runDirector(ctx2,d2,ticks(60*3));
  assert.equal(d2.state.rotation,undefined);
  for(const c of plain)assert.ok((LEGACY_KINDS as readonly string[]).includes(c.kind),c.kind);
  // Per world: the same seed rotates differently on the island and in the endless world (most seeds).
  let differ=0;
  for(let seed=1;seed<=8;seed++){
    const r=[new TerrainField(2),new TerrainField(2,{world:'infinito'})].map(t=>{const c=fakeCtx(seed,t);const dd=createDirector(directorOptions([],{rotation:true}));c.tick++;dd.step(c);return JSON.stringify(dd.state.rotation);});
    if(r[0]!==r[1])differ++;
  }
  assert.ok(differ>=6,`${differ} of 8 seeds differ per world`);
});

test('director: a checkpoint mid-run keeps the rotation and the next rounds exactly (JSON state into a fresh context)',()=>{
  const build=()=>{const ctx=fakeCtx(31,new TerrainField(2));ctx.players.set('a',{id:'a',classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...SPAWN});return ctx;};
  for(const when of [ticks(10),ticks(140)]){
    const a=build(),da=createDirector(directorOptions([],{rotation:true}));
    runDirector(a,da,when);
    const b=build();b.tick=a.tick;b.ids=a.ids;(b as {rng:Rng}).rng=new Rng(999);
    for(const e of a.enemies.values())b.enemies.set(e.id,structuredClone(e));
    const restored=createDirector(directorOptions([],{rotation:true}),JSON.parse(JSON.stringify(da.state)));
    const from=a.events.length;
    runDirector(a,da,ticks(300));runDirector(b,restored,ticks(300));
    assert.deepEqual(restored.state.rotation,da.state.rotation);
    assert.deepEqual(b.events,a.events.slice(from));
    assert.deepEqual(JSON.parse(JSON.stringify(restored.state)),JSON.parse(JSON.stringify(da.state)));
  }
});

test('director.summon: a minion joins the wave (tracked, round hp × SUMMON.hp, ready after SUMMON.readyIn); refused outside a wave',()=>{
  const ctx=fakeCtx(41,new TerrainField(2));ctx.players.set('a',{id:'a',classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...SPAWN});
  const d=createDirector(directorOptions([],{rotation:true}));
  ctx.tick++;d.step(ctx);
  assert.equal(d.summon(ctx,'bebado',SPAWN),undefined,'not in a wave');
  while(d.state.stage!=='wave'){ctx.tick++;d.step(ctx);}
  const kinds=d.minionKinds()!;
  assert.ok(kinds.length&&kinds.every(k=>roleOf(k)==='corredor'||roleOf(k)==='enxame'),kinds.join());
  const m=d.summon(ctx,kinds[0],{x:SPAWN.x+3,y:SPAWN.y})!;
  assert.ok(m&&d.state.tracked.includes(m.id));
  assert.equal(m.maxHp,Math.max(1,Math.round(enemyDef(kinds[0]).hp*d.state.plan!.hp*SUMMON.hp)));
  assert.equal(m.readyTick,ctx.tick+SUMMON.readyIn);assert.equal(m.memory?.round,d.state.plan!.index);
  ctx.tick++;d.step(ctx);
  assert.ok(ctx.round.remaining>=1);
  assert.equal(createDirector(directorOptions([])).minionKinds(),undefined,'no rotation: the AI default');
});

// ---------- full run ----------
test('a full assembled run with the rotation (6 room bots, endless world) gets to the end without error and only spawns rotation kinds',async()=>{
  const {Simulation}=await import('../../multiplayer/simulation.ts');
  const {RoomBots}=await import('../../multiplayer/room-bots.ts');
  const sim=new Simulation(3,{world:'infinito'}),bots=new RoomBots();
  for(let i=0;i<6;i++){const id=`bot-${i+1}`;sim.addBot(id,`Bot ${i+1}`,'cidadao-comum');bots.add(id,i);}
  sim.resetRun();
  const rotation=sim.run.director.state.rotation;
  const seen=new Set<string>();
  // Round 6 (the swarm breather; acceptance run 2026-10-13 lost there with 211 alive): the bodies that appear in its wave
  // are exactly its plan (no invocador minions, no mini-chefe: neither is in the mid band), never more alive than planned.
  const r6={planned:0,spawned:0,peak:0,odd:[] as string[]};
  for(let i=0;i<24*60*SIM_HZ&&!sim.outcome;i++){
    bots.think(sim);sim.step(i*50);
    const wave6=sim.world.round.index===6&&sim.world.round.phase==='wave',director=sim.run.director.state;
    if(wave6){r6.planned=director.plan?.total??0;r6.spawned=director.spawned;r6.peak=Math.max(r6.peak,sim.world.enemies.size);}
    for(const e of sim.world.enemies.values()){
      seen.add(e.kind);
      if(wave6&&(e.memory?.[MINION_FLAG]===1||roleOf(e.kind)==='mini-chefe'||roleOf(e.kind)==='invocador'))r6.odd.push(e.kind);
    }
  }
  if(r6.planned){
    assert.deepEqual(r6.odd,[],'round 6: no minion, invocador nor mini-chefe');
    assert.ok(r6.spawned<=r6.planned&&r6.planned<=MAX_ROUND_ENEMIES,`round 6 spawned ${r6.spawned} of a ${r6.planned}-body plan`);
    assert.ok(r6.peak<=r6.planned,`round 6 peak ${r6.peak} alive, plan ${r6.planned}`);
  }
  // Decided, or still fighting the boss of round 10 (the boss round never times out in the sim: the Room adds that).
  assert.ok(sim.outcome==='victory'||sim.outcome==='defeat'||sim.world.round.index===10,`outcome ${sim.outcome} in round ${sim.world.round.index}`);
  const ids=new Set([...rotationIds(sim.run.director.state.rotation!),'chefe','agiota','tio-pave','bebado']);
  for(const k of seen)assert.ok(ids.has(k),`${k} outside the rotation (or the boss's minions)`);
  assert.ok(rotation===undefined||isRotation(rotation));
  assert.ok(seen.size>=8,`${seen.size} kinds met`);
});

// ---------- review fixes ----------
test('invocador: a spot behind a wall is never announced (clear line from him to it, the enemy view of the terrain)',()=>{
  // A thin wall east of him (a mask terrain over the open field): spots east of it are walkable but out of his reach.
  const WALL=[O.x+.5,O.x+.8];
  const walled=Object.assign(Object.create(TERRAIN),{
    base:{x:O.x-20,y:O.y},spawn:{x:O.x-20,y:O.y},
    clearDisc(x:number,y:number,r:number){return x+r<WALL[0]||x-r>WALL[1];},
  }) as TerrainField;
  let calls=0;
  for(let seed=1;seed<=12;seed++){
    const world=new SimWorld({terrain:walled,seed});
    world.round.index=7;world.round.phase='wave';
    const ai=new EnemyAi({projectileCap:MAX_PROJECTILES,minionKinds:()=>['bebado']});
    world.register(ai).register(createTelegraphSystem());
    addPlayer(world,'p',at(-5));
    const caller=createEnemy(world,ofRole('invocador'),O);
    const events:SimEvent[]=[];
    for(let i=0;i<ticks(1)+SUMMON.warn+2;i++)events.push(...world.step());
    const warnings=events.filter(e=>e.type==='spawn-warning');
    calls+=warnings.length?1:0;
    for(const w of warnings)if(w.type==='spawn-warning')assert.ok(w.x<WALL[0],`seed ${seed}: a spot behind the wall at x ${(w.x-O.x).toFixed(2)}`);
    for(const m of [...world.enemies.values()].filter(e=>e.memory?.[MINION_FLAG]===1))assert.ok(m.x<WALL[0],`seed ${seed}: a minion behind the wall`);
    assert.ok(caller.x<WALL[0]);
  }
  assert.ok(calls>=10,`${calls} of 12 called`);
});

test('the lone mini-chefe spawns with exactly plan.miniHp (not the elite\'s hp), a tampered checkpoint rotation is drawn again',()=>{
  const created:{round:number;kind:string;scale:number}[]=[];
  const ctx=fakeCtx(51,new TerrainField(2));ctx.players.set('a',{id:'a',classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...SPAWN});
  const d=createDirector(directorOptions(created,{rotation:true,intermissionSeconds:1}));
  let plan8:ReturnType<typeof structuredClone<NonNullable<typeof d.state.plan>>>|undefined;
  for(let i=0;i<ticks(60*25)&&!created.some(c=>c.round===8&&c.kind===d.state.rotation!.mini[1]);i++){
    runDirector(ctx,d,1);
    if(d.state.plan?.index===8)plan8=d.state.plan;
  }
  const solo=created.find(c=>c.round===8&&c.kind===d.state.rotation!.mini[1]);
  assert.ok(solo&&plan8,'the round-8 mini-chefe came');
  assert.ok(plan8!.miniHp!>0&&plan8!.miniHp!<plan8!.eliteHp);
  assert.equal(solo!.scale,plan8!.miniHp,'its hp is the plan\'s miniHp');
  // A checkpoint whose rotation is missing a role (corrupt) or names a wrong entry: refused, a valid one drawn on the
  // next step, and the caller's object is left as it was.
  for(const bad of [{roles:{},mini:[]},{roles:{corredor:['tio-pave']},mini:['bebado','bebado']},{...d.state.rotation!,roles:{...d.state.rotation!.roles,corredor:[]}}]){
    const snapshot={...JSON.parse(JSON.stringify(d.state)),rotation:bad},copy=JSON.parse(JSON.stringify(snapshot));
    const restored=createDirector(directorOptions([],{rotation:true,intermissionSeconds:1}),snapshot);
    assert.deepEqual(snapshot,copy,'the restore object is not mutated');
    assert.equal(restored.state.rotation,undefined);
    const c2=fakeCtx(51,new TerrainField(2));c2.players=ctx.players;c2.tick=ctx.tick;
    runDirector(c2,restored,ticks(30));
    assert.ok(isRotation(restored.state.rotation),'drawn again');
  }
});

test('city balance in round 8: exactly one mini-chefe whatever the team, its hp scaled by the hp knob like the elite\'s',()=>{
  const rotation=drawRotation(new Rng(3));
  for(const players of [1,3,6]){
    const plan=planRound(8,players,{name:'x'},new Rng(9),roundRoster(rotation,8));
    const knobs=roundKnobs(CITY_BALANCE,8,plan.players),out=applyCityBalance(plan,knobs);
    assert.ok(!isNeutralRound(knobs),`${players}p: the knobs act`);
    const solo=out.groups.filter(g=>g.solo);
    assert.equal(solo.length,1);assert.deepEqual(solo[0].members,[rotation.mini[1]],`${players}p: one mini-chefe`);
    assert.equal(out.miniHp,plan.miniHp!*knobs.hp);assert.equal(out.eliteHp,plan.eliteHp*knobs.hp);
    assert.ok(Math.abs(out.miniHp!/out.eliteHp-MINI_SOLO_HP)<1e-12,`${players}p: miniHp/eliteHp ${(out.miniHp!/out.eliteHp).toFixed(3)}`);
  }
});

test('size modifiers never push the lone mini-chefe past the boss\'s radius (the neighbor reach): giant-everyone banned in round 8',()=>{
  const cap=ENEMIES.chefe.radius,minis=ROSTER.filter(e=>e.role==='mini-chefe');
  const sizes=[...MODIFIERS.filter(m=>!m.banRounds.includes(8)).map(m=>[m.id,m.sizeMult??1] as const),
    ...CIDADE_MODIFIERS.filter(m=>!m.banRounds.includes(8)).map(m=>[m.id,Math.max(m.sizeMult??1,m.growth?.sizeMult??1)] as const)];
  for(const e of minis)for(const [id,size] of sizes)assert.ok(enemyDef(e.id).radius*size<=cap+1e-9,`${e.id} under ${id}: ${(enemyDef(e.id).radius*size).toFixed(3)}`);
  assert.ok(minis.some(e=>enemyDef(e.id).radius*1.5>cap),'giant-everyone would (hence the ban)');
});

// ---------- round 6 (acceptance run 2026-10-13: defeat in round 6 with 114 → 211 alive) ----------
test('round 6 with the rotation: bodies, threat and hp within a few % of the round table, mid-band roles only (6 players also under the city knobs)',()=>{
  // Measured over 300 rotations × 1/3/6 players × every round-6 modifier: bodies 1.00-1.04 of the table, threat and hp
  // 0.97-1.07. The 211 alive of the bots' run is the table's own round 6 (6 players: ~266-290 bodies, two swarms; main
  // peaks at 180-240 alive in the same harness), not a rotation balloon.
  const thr=(k:string)=>k in THREAT?THREAT[k as RegularKind]:ROLE_PROFILES[roleOf(k)!].threat;
  const mods=[undefined,...MODIFIERS.filter(m=>!m.banRounds.includes(6)).map(m=>m.id)];
  const mid=new Set(['corredor','enxame','voador','palhaco','atirador','arremessador','suporte']);
  let cases=0,ratio=0,feltHp=0;
  for(let i=0;i<60;i++){
    const roster=roundRoster(drawRotation(new Rng(i*7919+13)),6);
    for(const players of [1,3,6])for(const modifierId of mods){
      const seed=6000+i*31+players,theme={name:'x',modifierId};
      for(const city of players===6?[false,true]:[false]){
        const knob=(p:ReturnType<typeof planRound>)=>city?applyCityBalance(p,roundKnobs(CITY_BALANCE,6,p.players)):p;
        const table=knob(planRound(6,players,theme,new Rng(seed))),rot=knob(planRound(6,players,theme,new Rng(seed),roster));
        const reg=(p:typeof table)=>p.groups.filter(g=>!g.boss&&!g.elite&&!g.solo).flatMap(g=>g.members);
        // hp: the role's (the clones' feel taken off); the feel trades hp for speed (rules/enemy-feel.ts), checked below on average.
        const a=reg(table),b=reg(rot),hp=(p:typeof table,m:string[],feel=false)=>m.reduce((n,k)=>n+enemyDef(k).hp/(feel?1:enemyFeel(k)?.hp??1),0)*p.hp;
        const at=`${players}p ${modifierId??'none'}${city?' city':''}`;
        assert.ok(!rot.groups.some(g=>g.elite||g.solo||g.boss),`${at}: no elite, mini-chefe nor boss`);
        for(const k of b)assert.ok(mid.has(roleOf(k)!),`${at}: ${k} (${roleOf(k)}) is not a mid-band role`);
        assert.ok(b.length>=a.length&&b.length<=Math.ceil(a.length*1.05)&&b.length<=MAX_ROUND_ENEMIES,`${at}: ${b.length} bodies vs the table's ${a.length}`);
        const t=b.reduce((n,k)=>n+thr(k),0)/a.reduce((n,k)=>n+thr(k),0),h=hp(rot,b)/hp(table,a);
        // ×0.7 bodies (CLASH_BODIES, vida-inimigos-estilo-clash): one body more or less is a bigger share at 1 player.
        assert.ok(t>.9&&t<1.12,`${at}: threat ×${t.toFixed(3)}`);
        assert.ok(h>.9&&h<1.12,`${at}: hp ×${h.toFixed(3)}`);
        // With the feel: a rotation may draw only the sturdy clone of a role (measured .80-1.25, ×1.016 on average).
        const hf=hp(rot,b,true)/hp(table,a,true);
        assert.ok(hf>.75&&hf<1.3,`${at}: hp with the feel ×${hf.toFixed(3)}`);
        cases++;ratio+=b.length/a.length;feltHp+=hf;
      }
    }
  }
  assert.ok(ratio/cases<1.03,`bodies ×${(ratio/cases).toFixed(3)} on average`);
  assert.ok(Math.abs(feltHp/cases-1)<.05,`hp with the feel ×${(feltHp/cases).toFixed(3)} on average`);
});
