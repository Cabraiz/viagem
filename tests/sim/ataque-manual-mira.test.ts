// D-051 step 1 (NEW-20261014-ORQ-ataque-manual-wild-rift): the manual combat's weapons, aim, skill and bots
// (RunSystemsOptions.combat 'manual'). The off path is pinned in ataque-manual.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext,SimSystem} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {createWeaponSystem,equippedWeapon,manualReach} from '../../src/sim/weapons/system.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {AGGRO_TICKS,BOSS_BONUS,SWITCH_MARGIN,attackTargets,targetDistance} from '../../src/rules/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {decide,newMemory,attackReach} from '../../src/sim/bot-brain.ts';
import type {RunView} from '../../src/contract/view.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

// ---------- A small SimContext (like sim-weapons.test.ts) ----------
interface Fake extends SimContext {tick:number;players:Map<string,SimPlayer>;events:{tick:number;event:SimEvent}[]}
function naiveIndex():SpatialIndex<EnemyState>{
  let items:EnemyState[]=[];
  return {
    rebuild(it){items=[...it];},
    query(x,y,r,out=[]){out.length=0;for(const e of items)if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
    nearest(){return undefined;},
  };
}
function makeCtx():Fake{
  let ids=0;
  const ctx:Fake={
    tick:0,terrain:{} as TerrainField,rng:new Rng(1),players:new Map(),enemies:new Map(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},enemyIndex:naiveIndex(),events:[],
    nextId(prefix){return prefix+(++ids);},
    emit(event){ctx.events.push({tick:ctx.tick,event});},
    damageEnemy(id,amount){const e=ctx.enemies.get(id);if(!e||e.hp<=0)return false;e.hp-=amount;if(e.hp>0)return false;ctx.enemies.delete(id);return true;},
    damagePlayer(){},
  };
  return ctx;
}
function addPlayer(ctx:Fake,id:string,x:number,y:number,weapons:[string,number][],o:Partial<SimPlayer>={}):SimPlayer{
  const p:SimPlayer={id,classId:'x',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:weapons.map(([id,level])=>({id,level})),passives:[]},stats:{...BASE_STATS},weaponReady:{},...o};
  ctx.players.set(id,p);return p;
}
function addEnemy(ctx:Fake,id:string,x:number,y:number,o:Partial<EnemyState>={}):EnemyState{
  const e:EnemyState={id,kind:'mosquito',x,y,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0,...o};
  ctx.enemies.set(id,e);return e;
}
/** The manual weapons with a hand on the attack button: `held` says who holds it on each tick. */
function manualSystems(held:Set<string>):SimSystem[]{return [createWeaponSystem({manual:{attacking:id=>held.has(id)}}),createProjectileSystem({})];}
function run(ctx:Fake,sys:SimSystem[],n=1,before?:(ctx:Fake)=>void){
  for(let i=0;i<n;i++){ctx.tick++;before?.(ctx);ctx.enemyIndex.rebuild(ctx.enemies.values());for(const s of sys)s.step(ctx);}
}
const fires=(ctx:Fake,weapon?:string)=>ctx.events.filter(e=>e.event.type==='fire'&&(!weapon||(e.event as {weapon:string}).weapon===weapon));
const R=(id:string,level=1)=>resolveWeapon(getWeapon(id)!,level,{...BASE_STATS});
/** The direction (unit) of a fire event. */
const aimOf=(e:{event:SimEvent})=>{const f=e.event as {dx:number;dy:number};const l=Math.hypot(f.dx,f.dy);return {x:f.dx/l,y:f.dy/l};};

// ---------- 1. The pure target choice (rules/attack-target.ts) ----------
test('target choice: chosen → who hit me (2 s) → nearest with the boss 30 % closer → posing last; ties by id',()=>{
  assert.equal(AGGRO_TICKS,40);assert.equal(BOSS_BONUS,.3);assert.equal(SWITCH_MARGIN,.2);
  const at={x:0,y:0},e=(id:string,x:number,o:object={})=>({id,x,y:0,...o});
  const near=e('near',2),far=e('far',5),mid=e('mid',3);
  const ids=(r:{order:{id:string}[]})=>r.order.map(c=>c.id);
  assert.deepEqual(ids(attackTargets(at,[far,mid,near],{tick:100})),['near','mid','far']);
  // The chosen one first (in range: the caller only hands what is in reach), then the rest by distance.
  assert.deepEqual(ids(attackTargets(at,[far,mid,near],{tick:100,chosen:'far'})),['far','near','mid']);
  // Who hit me within AGGRO_TICKS beats the nearest; one tick later it is just one more critter.
  assert.deepEqual(ids(attackTargets(at,[far,mid,near],{tick:100,lastHit:{id:'mid',tick:100-AGGRO_TICKS}})),['mid','near','far']);
  assert.deepEqual(ids(attackTargets(at,[far,mid,near],{tick:100,lastHit:{id:'mid',tick:99-AGGRO_TICKS}})),['near','mid','far']);
  // The chosen one still comes before who hit me.
  assert.deepEqual(ids(attackTargets(at,[far,mid,near],{tick:100,chosen:'far',lastHit:{id:'mid',tick:100}})),['far','mid','near']);
  // Boss: 30 % closer. At 4 u it counts 2.8 (< 3); at 4.5 u, 3.15 (> 3).
  assert.ok(Math.abs(targetDistance(at,e('b',4,{boss:true}))-2.8)<1e-9);
  assert.deepEqual(ids(attackTargets(at,[mid,e('boss',4,{boss:true})],{tick:0})),['boss','mid']);
  assert.deepEqual(ids(attackTargets(at,[mid,e('boss',4.5,{boss:true})],{tick:0})),['mid','boss']);
  // Posing ones after everyone else, even nearer, and never as "who hit me".
  const poser=e('poser',1,{reflecting:true});
  assert.deepEqual(ids(attackTargets(at,[poser,far],{tick:0})),['far','poser']);
  assert.deepEqual(ids(attackTargets(at,[poser,far],{tick:10,lastHit:{id:'poser',tick:10}})),['far','poser']);
  assert.deepEqual(ids(attackTargets(at,[poser],{tick:0})),['poser'],'a poser alone is still a target');
  // Ties by id.
  assert.deepEqual(ids(attackTargets(at,[e('z',2),e('a',-2)],{tick:0})),['a','z']);
  assert.deepEqual(attackTargets(at,[],{tick:0}),{order:[]});
});

test('target choice: the current auto target stays unless the new one is 20 % closer; auto is the pick after the chosen',()=>{
  const at={x:0,y:0},e=(id:string,x:number)=>({id,x,y:0});
  const cur=e('cur',3);
  // 2.5 > 0.8 × 3 = 2.4: kept.
  let r=attackTargets(at,[cur,e('new',2.5)],{tick:0,current:'cur'});
  assert.deepEqual(r.order.map(c=>c.id),['cur','new']);assert.equal(r.auto,'cur');
  // 2.3 < 2.4: switched.
  r=attackTargets(at,[cur,e('new',2.3)],{tick:0,current:'cur'});
  assert.deepEqual(r.order.map(c=>c.id),['new','cur']);assert.equal(r.auto,'new');
  // A current one out of reach (not a candidate) is simply forgotten.
  assert.equal(attackTargets(at,[e('new',2.9)],{tick:0,current:'gone'}).auto,'new');
  // With a chosen target, the auto pick is the next one (the hysteresis keeps following it).
  r=attackTargets(at,[cur,e('new',2.5),e('pick',6)],{tick:0,current:'cur',chosen:'pick'});
  assert.deepEqual(r.order.map(c=>c.id),['pick','cur','new']);assert.equal(r.auto,'cur');
  // Who hit me overrides the hysteresis.
  r=attackTargets(at,[cur,e('hitter',2.9)],{tick:5,current:'cur',lastHit:{id:'hitter',tick:5}});
  assert.equal(r.order[0].id,'hitter');assert.equal(r.auto,'hitter');
});

test('target choice: the picker only orders what it is handed; a candidate from a second list (the sleepers of the nests) can win',()=>{
  const at={x:0,y:0},awake=[{id:'awake',x:4,y:0}],asleep=[{id:'sleeper',x:2.5,y:0},{id:'sleeping-boss',x:3.4,y:0,boss:true}];
  // No penalty for sleeping: the nearest effective distance wins (the boss at 3.4 counts 2.38, under the sleeper's 2.5).
  assert.deepEqual(attackTargets(at,[...awake,...asleep],{tick:0}).order.map(c=>c.id),['sleeping-boss','sleeper','awake']);
  assert.deepEqual(attackTargets(at,awake,{tick:0}).order.map(c=>c.id),['awake'],'not handed, not a target');
  // In the sim: a sleeper from ctx.sleepers (out of enemyIndex) is shot when it is the nearest.
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  addPlayer(ctx,'p',10,10,[['boleto',1]]);addEnemy(ctx,'awake',14,10);
  const sleeper:EnemyState={id:'sleeper',kind:'mosquito',x:10,y:12,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0};
  ctx.enemies.set(sleeper.id,sleeper);
  const asleepIndex=naiveIndex();asleepIndex.rebuild([sleeper]);
  (ctx as {sleepers?:typeof asleepIndex}).sleepers=asleepIndex;
  // enemyIndex only knows the awake one (the sim's rebuild would skip sleepers).
  ctx.tick++;ctx.enemyIndex.rebuild([ctx.enemies.get('awake')!]);for(const s of sys)s.step(ctx);
  assert.ok(aimOf(fires(ctx)[0]).y>.99,'aimed at the sleeper');assert.equal(ctx.players.get('p')!.autoTarget,'sleeper');
});

// ---------- 2. The manual weapons ----------
test('manual: holding fires the equipped weapon at its cadence, the other weapons stay idle; releasing stops',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  const p=addPlayer(ctx,'p',10,10,[['boleto',1],['chinelo',1],['pombo',1]]);
  addEnemy(ctx,'e1',13,10);
  assert.equal(equippedWeapon(p.build)?.id,'boleto');
  const cd=R('boleto').cooldownTicks;
  run(ctx,sys,3*cd+1);
  assert.deepEqual(fires(ctx).map(f=>f.tick),[1,1+cd,1+2*cd,1+3*cd],'boleto only, every cooldown');
  assert.deepEqual(fires(ctx).map(f=>(f.event as {weapon:string}).weapon),['boleto','boleto','boleto','boleto']);
  assert.deepEqual(Object.keys(p.weaponReady),['boleto'],'chinelo and pombo never ran');
  held.clear();
  run(ctx,sys,4*cd);
  assert.equal(fires(ctx).length,4,'released: nothing more');
});

test('manual: a single tap (one tick held) fires once; a tap on cooldown is spent, no shot',()=>{
  const ctx=makeCtx(),held=new Set<string>(),sys=manualSystems(held);
  addPlayer(ctx,'p',10,10,[['boleto',1]]);addEnemy(ctx,'e1',12,10);
  held.add('p');run(ctx,sys,1);held.clear();run(ctx,sys,60);
  assert.deepEqual(fires(ctx).map(f=>f.tick),[1]);
  held.add('p');run(ctx,sys,1);held.clear();
  assert.deepEqual(fires(ctx).map(f=>f.tick),[1,62]);
  held.add('p');run(ctx,sys,1);held.clear();
  assert.equal(fires(ctx).length,2,'on cooldown: the tap does nothing');
});

test('manual: no shot into the air (nobody in reach: the cooldown waits) and the hero never walks to a target',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  const p=addPlayer(ctx,'p',10,10,[['boleto',1]]);
  const reach=manualReach(R('boleto')).reach,e=addEnemy(ctx,'far',10+reach+.5,10);
  run(ctx,sys,40);
  assert.equal(fires(ctx).length,0);assert.equal(p.weaponReady.boleto,undefined,'the cooldown never started');
  assert.deepEqual({x:p.x,y:p.y},{x:10,y:10},'the hero stood where he was');
  e.x=10+reach-.5;run(ctx,sys,1);
  assert.deepEqual(fires(ctx).map(f=>f.tick),[41],'fires the tick one comes into reach');
});

test('manual: the aim follows the chosen target, then who hit me (2 s), then the nearest with the boss bonus',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  const p=addPlayer(ctx,'p',10,10,[['boleto',1]]),cd=R('boleto').cooldownTicks;
  addEnemy(ctx,'east',12,10);addEnemy(ctx,'north',10,7);addEnemy(ctx,'boss',5.8,10,{boss:true,radius:.8});
  const dirs:{x:number;y:number}[]=[];
  const shoot=()=>{const n=fires(ctx).length;run(ctx,sys,cd);const f=fires(ctx);assert.equal(f.length,n+1);dirs.push(aimOf(f.at(-1)!));};
  // Nearest: east at 2 (the boss at 4.2 counts 2.94, north at 3).
  shoot();assert.ok(dirs.at(-1)!.x>.99);assert.equal(p.autoTarget,'east');
  // Chosen: north.
  p.target='north';shoot();assert.ok(dirs.at(-1)!.y<-.99);assert.equal(p.autoTarget,'east','the auto pick is kept apart');
  delete p.target;
  // Who hit me (the boss) within 2 s: the boss, west.
  p.lastHitBy={id:'boss',tick:ctx.tick+1};shoot();assert.ok(dirs.at(-1)!.x<-.99);
  // Past AGGRO_TICKS: the nearest again, but the hysteresis keeps the boss (the auto target now) unless east is 20 % closer:
  // east 2 vs boss 2.94 × 0.8 = 2.35, so east takes it back.
  p.lastHitBy={id:'boss',tick:ctx.tick-AGGRO_TICKS-cd};shoot();assert.ok(dirs.at(-1)!.x>.99);assert.equal(p.autoTarget,'east');
});

test('manual: hysteresis on the live weapon: a slightly nearer critter does not steal the aim',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  const p=addPlayer(ctx,'p',10,10,[['boleto',1]]),cd=R('boleto').cooldownTicks;
  addEnemy(ctx,'a',13,10);
  run(ctx,sys,1);assert.equal(p.autoTarget,'a');
  // b at 2.6 vs a at 3: not 20 % closer (2.4), a stays.
  addEnemy(ctx,'b',10,12.6);run(ctx,sys,cd);
  assert.ok(aimOf(fires(ctx).at(-1)!).x>.99);assert.equal(p.autoTarget,'a');
  // b at 2.2: 20 % closer, the aim switches.
  ctx.enemies.get('b')!.y=12.2;run(ctx,sys,cd);
  assert.ok(aimOf(fires(ctx).at(-1)!).y>.99);assert.equal(p.autoTarget,'b');
});

test('manual: orbit, shield and the cone are effects of the equipped weapon (held, someone to touch), not passives',()=>{
  for(const id of ['chinelo','guarda-chuva']){
    const ctx=makeCtx(),held=new Set<string>(),sys=manualSystems(held);
    addPlayer(ctx,'p',10,10,[[id,1]]);
    const {reach}=manualReach(R(id)),e=addEnemy(ctx,'e',10+reach+.3+1,10);
    run(ctx,sys,30);assert.equal(fires(ctx).length,0,`${id}: not held, nothing`);
    held.add('p');run(ctx,sys,30);assert.equal(fires(ctx).length,0,`${id}: held, nobody in its ring`);
    e.x=10+reach-.1;run(ctx,sys,1);assert.equal(fires(ctx,id).length,1,`${id}: held with a critter in its ring: one cycle`);
  }
  // A passive weapon of the build (orbit behind a boleto) never spins in the manual combat.
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  addPlayer(ctx,'p',10,10,[['boleto',1],['chinelo',1],['guarda-chuva',1]]);addEnemy(ctx,'e',10.5,10);
  run(ctx,sys,100);
  assert.deepEqual([...new Set(fires(ctx).map(f=>(f.event as {weapon:string}).weapon))],['boleto']);
  // The cone turns to the aim (the facing points away): the critter behind is hit.
  const c=makeCtx(),h=new Set(['p']),s=manualSystems(h);
  addPlayer(c,'p',10,10,[['audio',1]],{facing:{x:1,y:0}});const behind=addEnemy(c,'behind',9,10),ahead=addEnemy(c,'ahead',10,8.6);
  c.players.get('p')!.target='behind';
  run(c,s,1);
  assert.ok(behind.hp<behind.maxHp,'the chosen one behind is hit');assert.equal(ahead.hp,ahead.maxHp,'the one off the aimed cone is not');
});

test('manual: the zone and homing weapons shoot the aimed targets only while held',()=>{
  for(const id of ['cafe','pombo']){
    const ctx=makeCtx(),held=new Set<string>(),sys=manualSystems(held);
    addPlayer(ctx,'p',10,10,[[id,1]]);addEnemy(ctx,'e',12,10);
    run(ctx,sys,20);assert.equal(fires(ctx).length,0,id);
    held.add('p');run(ctx,sys,1);assert.equal(fires(ctx,id).length,1,id);
  }
});

// ---------- 3. The whole run: lastHitBy, the skill, the bots ----------
test('manual Simulation: damagePlayer records who hit me (enemies only); the automatic run never does',()=>{
  for(const combat of ['manual',undefined] as const){
    const s=new Simulation(7,combat?{combat}:{}),p=s.add('p','P','cidadao-comum');s.resetRun();
    const e=createEnemy(s.world,'bebado',{x:p.x+1,y:p.y});
    s.world.damagePlayer('p',1,e.id);s.world.damagePlayer('p',1,'env:molotov:1');
    assert.deepEqual(p.lastHitBy,combat?{id:e.id,tick:s.tick}:undefined,String(combat));
    // A new run forgets it.
    s.resetRun();assert.equal(p.lastHitBy,undefined);
  }
  // The next run of the same world in the automatic combat does not record (the flag goes with the run).
  const s=new Simulation(7);assert.equal(s.world.recordLastHit,false);
});

test('manual Simulation: the skill is ignored (taps refused, held skill does nothing), the held attack fires the kit weapon',()=>{
  const s=new Simulation(11,{combat:'manual'}),p=s.addBot('b','B','viciado-em-bet');s.resetRun();
  // Empty-handed start (torre-limite-rebocar-sem-arma): the ilha has no crates, so the bot gets a Faca de Pão.
  s.step();p.build.weapons.push({id:'faca',level:1});
  assert.equal(s.tap('b',1),false);
  const tough=createEnemy(s.world,'bebado',{x:p.x+2,y:p.y});tough.hp=tough.maxHp=1e6;
  s.setBotInput('b',{x:0,y:0},true,false);
  for(let i=0;i<10;i++)s.step();
  assert.equal(p.skillTick,0,'no cast');
  const fired=()=>s.events.filter(e=>e.type==='fire'&&e.player==='b');
  let n=0;s.setBotInput('b',{x:0,y:0},false,true);
  for(let i=0;i<60;i++){s.step();n+=fired().length;}
  assert.ok(n>=2,`held for 3 s: ${n} shots`);
  s.setBotInput('b',{x:0,y:0},false,false);n=0;
  for(let i=0;i<60;i++){s.step();n+=fired().length;}
  assert.equal(n,0,'released');
  // The same in the automatic combat: the skill casts and the weapon fires without any button.
  const a=new Simulation(11),q=a.addBot('b','B','viciado-em-bet');a.resetRun();
  const rock=createEnemy(a.world,'bebado',{x:q.x+2,y:q.y});rock.hp=rock.maxHp=1e6;a.setBotInput('b',{x:0,y:0},true);
  let auto=0;for(let i=0;i<40;i++){a.step();auto+=a.events.filter(e=>e.type==='fire'&&e.player==='b'&&!e.weapon.startsWith('skill:')).length;}
  assert.ok(q.skillTick>0);assert.ok(auto>0);
});

test('bots: in the manual combat they hold the attack with a critter in the equipped weapon\'s reach and never cast',()=>{
  const me={id:'b',name:'B',classId:'x',hp:100,maxHp:100,online:true,spectator:false,weapons:[{id:'boleto',level:1}],passives:[],x:10,y:10,skillReadyTick:0};
  const view=(enemyAt:number):RunView=>({tick:1000,team:{xp:0,level:1,nextXp:5},round:{index:1,total:10,phase:'wave',phaseEndsTick:1e9,remaining:1},
    enemies:[{id:'e',kind:'bebado',x:10+enemyAt,y:10,hp:10,maxHp:10}],pickups:[],projectiles:[],telegraphs:[],structures:[],players:[me],offers:[],events:[]} as unknown as RunView);
  const reach=manualReach(R('boleto')).reach;
  const close=decide({view:view(1),selfId:'b',at:{x:10,y:10},index:0,memory:newMemory(0),combat:'manual'});
  assert.equal(close.attack,true);assert.equal(close.cast,false,'no skill in the manual combat');
  assert.equal(decide({view:view(reach-.2),selfId:'b',at:{x:10,y:10},index:0,memory:newMemory(0),combat:'manual'}).attack,true);
  assert.equal(decide({view:view(reach+.5),selfId:'b',at:{x:10,y:10},index:0,memory:newMemory(0),combat:'manual'}).attack,false);
  // The automatic combat: no attack field, the skill as before.
  const auto=decide({view:view(1),selfId:'b',at:{x:10,y:10},index:0,memory:newMemory(0)});
  assert.equal(auto.attack,undefined);assert.equal(auto.cast,true);
  assert.equal(attackReach({weapons:[]},{x:0,y:0},[]),false,'no weapon, no attack');
});

test('manual room: the room bots attack (equipped weapon only, no skill) and an old client\'s cast is answered ok false',()=>{
  const messages:any[]=[],a={send:(m:string|Uint8Array)=>{if(typeof m==='string')messages.push(JSON.parse(m));},close:()=>{}} as Peer;
  let n=0;
  const room=new Room(1000,0x2b1d,{world:'ilha',newId:()=>`pessoa-${++n}`,combat:'manual'});
  assert.equal(room.sim.combat,'manual');
  let t=1000;
  const say=(m:object)=>room.receive(a,JSON.stringify(m),t),round=()=>room.run.snapshot().round;
  room.connect(a,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'viciado-em-bet'});
  for(let i=0;i<2;i++){t+=OWNER_GAP_MS;say({t:'bot-add',round:round()});}
  t+=OWNER_GAP_MS;say({t:'ready',round:round(),ready:true});
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const ana=messages.find(m=>m.t==='welcome').id as string,bots=[...room.sim.bots];
  say({t:'cast',round:round(),id:1});
  assert.deepEqual(messages.filter(m=>m.t==='cast'),[{t:'cast',seq:1,ok:false,readyTick:0}]);
  // Empty-handed start (torre-limite-rebocar-sem-arma), no crates on the ilha: each bot gets a Faca de Pão.
  room.advance(t+=50);for(const id of bots)room.sim.players.get(id)!.build.weapons.push({id:'faca',level:1});
  const weapons=new Map<string,Set<string>>();
  for(let i=0;i<1600&&room.run.snapshot().phase==='combat';i++){
    t+=50;if(i%20===0)say({t:'ack',seq:0});
    // Bodies near the bots, so they have someone to hold the attack for.
    if(i%100===50)for(const id of bots){const p=room.sim.players.get(id)!;if(p.hp>0)createEnemy(room.sim.world,'bebado',{x:p.x+1.5,y:p.y});}
    room.advance(t);
    for(const e of room.sim.events)if(e.type==='fire'){let s=weapons.get(e.player);if(!s)weapons.set(e.player,s=new Set());s.add(e.weapon);}
  }
  for(const id of bots){
    const p=room.sim.players.get(id)!,own=weapons.get(id);
    assert.ok(own?.size,`${id} attacked`);
    assert.deepEqual([...own!],[equippedWeapon(p.build)!.id],`${id}: the equipped weapon only, no skill`);
    assert.equal(p.skillTick,0,`${id} never cast`);
  }
  assert.equal(weapons.get(ana),undefined,'Ana never held the attack: her weapon never fired');
});
