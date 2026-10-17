/**
 * Ninhos (D-051, NEW-20261014-ORQ-ninhos-sim, E2): the sleeping bodies (sim/ninhos/sono.ts) on a synthetic plan. They
 * stay out of ctx.enemies until something wakes them; damage wakes the body and its band (core damageEnemy), the nest
 * call (E1) wakes a nest, wakeAround a disc; every wake emits one `acordou`; a checkpoint rebuilds the same bodies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SimWorld} from '../../src/sim/core.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import type {NestPlan} from '../../src/maps/nests.ts';
import {createSono,noiseP,WAKE_SIGHT,BAND_RADIUS,ALERT_PAUSE,LOST_AFTER,MODE,NOISE_EVERY,SEE_RADIUS,SLEEP_ANYWHERE,type Sono,type SonoOptions} from '../../src/sim/ninhos/sono.ts';
import {isAlive,queryHittable} from '../../src/sim/projectiles.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {BASE_STATS,ticks,type EnemyState,type SimEvent,type SimPlayer} from '../../src/contract/index.ts';

/** Two nests (A: 3 bodies close together, B: 2) and one loose band of 2 far away. */
const PLAN:NestPlan={seed:1,players:1,nests:[
  {id:'A',kind:'terreno',x:0,y:0,size:'P',radius:6,sleepers:[{x:0,y:0},{x:2,y:0},{x:0,y:2}]},
  {id:'B',kind:'terreno',x:40,y:0,size:'P',radius:6,sleepers:[{x:40,y:0},{x:41,y:1}]},
],loose:[{x:0,y:40,training:false,members:[{x:0,y:40},{x:1.5,y:40}]}]};

function world(saved?:Sono['state'],extra:Partial<SonoOptions>={},seed=7){
  const w=new SimWorld({terrain:defaultTerrain,seed});
  const sono=createSono({plan:PLAN,kindOf:()=>'bebado',events:()=>w.lastEvents,...extra},saved);
  w.sleepers=sono.sleepers;
  w.register({id:'director',step:ctx=>sono.step(ctx)});
  return {w,sono};
}
const woke=(events:readonly SimEvent[])=>events.filter((e):e is Extract<SimEvent,{type:'acordou'}>=>e.type==='acordou');

test('the plan sleeps out of ctx.enemies, with ids by plan order', ()=>{
  const {w,sono}=world();
  w.step();
  assert.equal(w.enemies.size,0);
  assert.equal(sono.sleepers.size,7);
  assert.deepEqual(sono.bodies.map(b=>b.id),['z-0','z-1','z-2','z-3','z-4','z-5','z-6']);
  assert.deepEqual(sono.bodiesOf('A'),['z-0','z-1','z-2']);
  assert.equal(sono.asleepIn('B'),2);
  assert.deepEqual(sono.sleepers.query(0,0,3).map(e=>e.id).sort(),['z-0','z-1','z-2']);
});

test('a hit on a sleeper wakes it and its band (≤ BAND_RADIUS), lands, and emits one acordou', ()=>{
  const {w,sono}=world();
  w.step();
  const hp=sono.sleepers.get('z-0')!.hp;
  assert.ok(BAND_RADIUS>=2*Math.SQRT2);
  assert.equal(w.damageEnemy('z-0',1),false);
  assert.equal(w.enemies.get('z-0')?.hp,hp-1);
  assert.deepEqual([...w.enemies.keys()].sort(),['z-0','z-1','z-2']);
  assert.equal(sono.asleepIn('A'),0);
  assert.equal(sono.asleepIn('B'),2);
  const events=w.flush();
  assert.deepEqual(woke(events).map(e=>e.n),[1+2]);
  assert.ok(events.findIndex(e=>e.type==='acordou')<events.findIndex(e=>e.type==='damage'));
  // Awake now: the next hit is an ordinary one.
  w.damageEnemy('z-0',1);
  assert.equal(woke(w.flush()).length,0);
});

test('wakeNest and wakeAround wake only what is asleep there', ()=>{
  const {w,sono}=world();
  w.step();
  assert.equal(sono.wakeNest(w,'B','ninho'),2);
  assert.equal(sono.wakeNest(w,'B','ninho'),0);
  assert.equal(sono.wakeAround(w,0,40,1,'chamado'),1);
  assert.equal(sono.wakeAround(w,0,40,5,'chamado'),1);
  assert.deepEqual(woke(w.flush()).map(e=>e.n),[2,1,1]);
  assert.equal(sono.sleepers.size,3);
  assert.equal(sono.sleepers.has('z-3'),false);
  assert.deepEqual(sono.sleepers.query(40,0,5),[]);
});

test('the checkpoint keeps who died and the hp; an awake body sleeps again at its spot', ()=>{
  const {w,sono}=world();
  w.step();
  w.damageEnemy('z-0',1);
  w.enemies.get('z-1')!.x=10;
  while(w.enemies.has('z-2'))w.damageEnemy('z-2',100);
  w.step();
  const saved=structuredClone(sono.state);
  assert.deepEqual(saved.life.slice(0,3).map(l=>l[0]),[2,2,0]);
  const again=world(saved);
  again.w.step();
  assert.equal(again.w.enemies.size,0);
  assert.equal(again.sono.sleepers.size,6);
  assert.equal(again.sono.sleepers.has('z-2'),false);
  const z0=again.sono.sleepers.get('z-0')!,z1=again.sono.sleepers.get('z-1')!;
  assert.equal(z0.hp,z0.maxHp-1);
  assert.deepEqual({x:z1.x,y:z1.y},{x:2,y:0});
});

function addPlayer(w:SimWorld,id:string,x:number,y:number){
  const p={id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  w.players.set(id,p);return p;
}
/** Steps to the end of the current noise window (the step that rolls). */
function toWindow(w:SimWorld){const every=ticks(NOISE_EVERY);do w.step();while(w.tick%every!==0);}

test('noiseP follows the table: knife .15, pistol .25, shotgun .35, rifle .45, rocket .6, between them linear', ()=>{
  assert.deepEqual([6,12,18,22,28].map(noiseP),[.15,.25,.35,.45,.6]);
  assert.equal(noiseP(15),.3);
  assert.equal(noiseP(2),.15);
  assert.equal(noiseP(99),.6);
});

test('a noise rolls at the end of its window: a sure roll wakes the body and its band, alerta toward the noise', ()=>{
  const {w,sono}=world();
  w.step();
  sono.noise('p1',{x:0,y:0,r:1e6,p:1});
  sono.noise('p1',{x:0,y:0,r:1,p:1});
  assert.equal(w.enemies.size,0,'nothing before the window ends');
  toWindow(w);
  const awake=[...w.enemies.values()];
  // z-0 (d 0, chance 1) and its band: z-1 and z-2.
  for(const id of ['z-0','z-1','z-2'])assert.ok(w.enemies.has(id),id);
  // z-0 stands on the noise: nothing to walk to, it hunts at once.
  assert.equal(w.enemies.get('z-0')?.memory?.sono,MODE.cacando);
  for(const e of awake.filter(o=>o.id!=='z-0')){
    assert.equal(e.memory?.sono,MODE.alerta);
    assert.deepEqual([e.memory?.gx,e.memory?.gy],[0,0]);
    assert.ok(e.readyTick>=w.tick+ticks(ALERT_PAUSE[0])&&e.readyTick<=w.tick+ticks(ALERT_PAUSE[1]),'the hã? pause');
  }
  assert.equal(woke(w.lastEvents).length,1);
  assert.deepEqual(sono.state.heard,[],'the window is spent');
});

test('the noise is the run rng (fork ruido): same seed, same wakes; it never reaches past its radius', ()=>{
  const run=(seed:number)=>{
    const {w,sono}=world(undefined,{},seed);
    w.step();
    for(let k=0;k<6;k++){sono.noise('p1',{x:20,y:20,r:40,p:.6});sono.noise('p2',{x:40,y:30,r:30,p:.6});toWindow(w);}
    return [...w.enemies.keys()].sort();
  };
  assert.deepEqual(run(3),run(3));
  const {w,sono}=world();
  w.step();
  for(let k=0;k<10;k++){sono.noise('far',{x:20,y:20,r:10,p:1});toWindow(w);}
  assert.equal(w.enemies.size,0);
});

test('shots and kills of the last step are heard (weaponNoise), and maxAwake stops the noise but never a hit', ()=>{
  const loud={weaponNoise:()=>({r:1e6,p:1})};
  const {w}=world(undefined,loud);
  w.step();
  w.emit({type:'fire',player:'p1',weapon:'x',x:40,y:0});
  toWindow(w);
  assert.ok(w.enemies.has('z-3')&&w.enemies.has('z-4'));
  const capped=world(undefined,{...loud,maxAwake:0});
  capped.w.step();
  capped.w.emit({type:'fire',player:'p1',weapon:'x',x:40,y:0});
  toWindow(capped.w);
  assert.equal(capped.w.enemies.size,0);
  capped.w.damageEnemy('z-3',1);
  assert.ok(capped.w.enemies.has('z-3'));
});

test('alerta → caçando at the noise; caçando with nobody near → perdeu, home, asleep again', ()=>{
  const {w,sono}=world();
  w.step();
  sono.noise('p1',{x:0,y:0,r:1e6,p:1});
  toWindow(w);
  const z1=w.enemies.get('z-1')!;
  assert.deepEqual(sono.goal(w,z1),{x:0,y:0,pace:.8});
  z1.x=.5;z1.y=0;
  w.step();
  assert.equal(z1.memory?.sono,MODE.cacando);
  assert.equal(sono.goal(w,z1),undefined,'caçando: the AI hunts');
  for(let k=0;k<ticks(LOST_AFTER);k++)w.step();
  assert.equal(z1.memory?.sono,MODE.perdeu);
  assert.deepEqual(sono.goal(w,z1),{x:2,y:0,pace:1});
  // A player in sight: caçando again.
  const p=addPlayer(w,'p1',z1.x+SEE_RADIUS-1,z1.y);
  w.step();
  assert.equal(z1.memory?.sono,MODE.cacando);
  p.x=1e3;
  for(let k=0;k<=ticks(LOST_AFTER);k++)w.step();
  assert.equal(z1.memory?.sono,MODE.perdeu);
  z1.x=2.2;z1.y=0;
  w.step();
  assert.equal(w.enemies.has('z-1'),false);
  assert.equal(sono.sleepers.get('z-1'),z1);
  assert.equal(z1.memory?.sono,undefined);
  assert.deepEqual(sono.sleepers.query(2,0,.5).map(e=>e.id),['z-1'],'indexed again');
});

test('a perdeu that never gets home sleeps where it stands after SLEEP_ANYWHERE', ()=>{
  const {w,sono}=world();
  w.step();
  w.damageEnemy('z-3',1);
  const z3=w.enemies.get('z-3')!;
  z3.x=60;
  for(let k=0;k<ticks(LOST_AFTER)+ticks(SLEEP_ANYWHERE)+2;k++)w.step();
  assert.equal(sono.sleepers.get('z-3'),z3);
  assert.equal(z3.x,60);
});

test('hits see the sleepers (queryHittable, isAlive); aiming does not (enemyIndex)', ()=>{
  const {w}=world();
  w.step();
  const near=queryHittable(w,0,40,1,[]);
  assert.deepEqual(near.map(e=>e.id),['z-5']);
  assert.ok(isAlive(w,near[0]));
  assert.equal(w.enemyIndex.nearest(0,40,5),undefined);
});

test('the AI walks a body with a goal there instead of hunting the player', ()=>{
  const w=new SimWorld({terrain:defaultTerrain,seed:1});
  addPlayer(w,'p1',10,0);
  const e:EnemyState={id:'e1',kind:'bebado',x:0,y:0,hp:10,maxHp:10,speed:2,damage:1,radius:.4,xp:1,spawnTick:0,readyTick:0};
  w.enemies.set('e1',e);
  w.register(createEnemyAi({goal:(_ctx,o)=>o.id==='e1'?{x:0,y:10,pace:.5}:undefined}));
  for(let k=0;k<20;k++)w.step();
  assert.ok(e.y>.5,`walked toward the goal (y ${e.y})`);
  assert.ok(Math.abs(e.x)<.05,`not toward the player (x ${e.x})`);
});

test('a hit target (a nest) takes the hits after the might, stands in the hit tests, and is dropped when it falls', ()=>{
  const {w,sono}=world();
  w.step();
  const p=addPlayer(w,'p1',100,100);p.stats={...p.stats,might:2};
  const got:number[]=[];let hp=10;
  sono.addTarget({id:'ninho:A',x:0,y:-10,radius:3,hit:(_ctx,amount)=>{got.push(amount);hp-=amount;return hp<=0;}});
  assert.deepEqual(queryHittable(w,0,-10,1,[]).map(e=>e.id),['ninho:A']);
  assert.ok(isAlive(w,sono.sleepers.get('ninho:A')!));
  assert.equal(w.damageEnemy('ninho:A',3,'p1'),false);
  assert.equal(w.enemies.has('ninho:A'),false,'never woken into ctx.enemies');
  assert.equal(w.damageEnemy('ninho:A',3,'p1'),true);
  assert.deepEqual(got,[6,6]);
  assert.equal(sono.sleepers.has('ninho:A'),false);
  assert.equal(w.damageEnemy('ninho:A',3,'p1'),false);
  assert.deepEqual(queryHittable(w,0,-10,1,[]),[]);
  // The noise and the bands never take a target for a body.
  sono.addTarget({id:'ninho:B',x:40,y:0,radius:3,hit:()=>false});
  assert.equal(sono.wakeAround(w,40,0,5,'chamado'),2);
  assert.equal(w.enemies.has('ninho:B'),false);
});

test('card ninhos-perto-ataca-20x: a hero (person or bot) within WAKE_SIGHT wakes the sleeper caçando with its band, one acordou; just past it, nobody; a downed hero or a spectator wakes nothing; the cap does not stop it', ()=>{
  assert.ok(WAKE_SIGHT>=5&&WAKE_SIGHT<=7&&WAKE_SIGHT<SEE_RADIUS);
  // Past the sight of every body of B (40,0 and 41,1): nobody wakes, ever.
  const far=world();far.w.step();
  addPlayer(far.w,'p1',40-WAKE_SIGHT-.05,0);
  for(let i=0;i<40;i++)far.w.step();
  assert.equal(far.w.enemies.size,0,'just past the sight');
  // Walking in: the body seen and its band, caçando, at once (no hã? pause).
  const p=far.w.players.get('p1')!;p.x=40-WAKE_SIGHT+.1;
  far.w.step();
  assert.deepEqual([...far.w.enemies.keys()].sort(),['z-3','z-4'],'B whole (its band)');
  for(const e of far.w.enemies.values()){assert.equal(e.memory?.sono,MODE.cacando);assert.ok(e.readyTick<=far.w.tick);}
  assert.equal(woke(far.w.lastEvents).length,1);
  assert.equal(far.w.enemies.has('z-0'),false,'A sleeps on');
  // Down or watching: nothing. The awake cap (maxAwake 0) does not stop the sight.
  const down=world(undefined,{maxAwake:0});down.w.step();
  const d=addPlayer(down.w,'d',0,0);d.downed={sinceTick:0,bleedOutTick:9999,progress:0} as SimPlayer['downed'];
  const s=addPlayer(down.w,'s',40,0);s.spectator=true;
  for(let i=0;i<10;i++)down.w.step();
  assert.equal(down.w.enemies.size,0,'downed and spectator see nothing');
  addPlayer(down.w,'b',0,40);
  down.w.step();
  assert.deepEqual([...down.w.enemies.keys()].sort(),['z-5','z-6'],'the loose band, past the cap');
});
