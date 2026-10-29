/**
 * NEW-20261029-ORQ-inimigos-avisos-justos on a real SimWorld (the elenco-p1.test.ts arena, open endless ground):
 *   refletor: one pose sends back at most REFLECT.cap in all (the crossing shot clipped, the coach buff included), then
 *     the pose breaks and the next shot hurts him; every reflection and the break emit a 'pose' event; the next pose
 *     starts a fresh count
 *   avisos: the agiota's and the motoboy's aim are ≥ MIN_TELEGRAPH_TICKS; the anão's death blast and the marmita blast
 *     let a hero at their centre walk out at the city's base walk with .3 u to spare (the audit's dodge rule); the
 *     motoboy's trigger sits inside his run in the city and in the endless world (at 7 he stopped short: 0 % hits)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,SIM_HZ,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {ACTION_PEAK_MAX,AGIOTA_SHOT,ENEMIES,MOLOTOV,MOTOBOY,PALESTRA,REFLECT,createEnemy,isReflecting,type CoachedEnemy} from '../../src/sim/enemies/catalog.ts';
import {EnemyAi,STATE} from '../../src/sim/enemies/ai.ts';
import {createProjectileSystem,spawnProjectile,type WeaponProjectile} from '../../src/sim/projectiles.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import {MAX_PROJECTILES} from '../../src/rules/budget.ts';
import {CITY_HERO_SPEED,RADIUS,SPEED,walkable,type Point} from '../../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';

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

type Pose=Extract<SimEvent,{type:'pose'}>;
/** An influencer at O posing at a hero 4.5 u ahead (+x), after one step. */
function poser(){
  const world=new SimWorld({terrain:TERRAIN,seed:9});
  world.round.index=3;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES});
  world.register(ai).register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  const p:SimPlayer={id:'p',classId:'test',x:O.x+4.5,y:O.y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{}};
  world.players.set('p',p);
  const e=createEnemy(world,'influencer',O);
  const events:SimEvent[]=[];
  const step=(n:number)=>{for(let i=0;i<n;i++)events.push(...world.step());};
  step(1);
  const poses=()=>events.filter((v):v is Pose=>v.type==='pose'&&v.enemy===e.id);
  /** `n` friendly 10-damage linear shots from beside the hero at him, all this tick. */
  const volley=(n:number)=>{
    const out:WeaponProjectile[]=[];
    for(let i=0;i<n;i++)out.push(spawnProjectile(world,{owner:'p',source:'boleto',motion:'linear',x:p.x-.5,y:O.y,vx:-10,vy:0,radius:.25,damage:10,
      pierce:2,untilTick:world.tick+SIM_HZ,hostile:false,knockback:.3})!);
    return out;
  };
  return {world,p,e,events,step,poses,volley};
}
const near=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<=eps;

test('refletor: one pose reflects REFLECT.cap in all, then breaks and the next shot hurts him; pose events',()=>{
  const I=poser();
  assert.equal(I.e.memory!.state,STATE.pose,'he poses');
  const per=10*REFLECT.mult,n=Math.ceil(REFLECT.cap/per);
  const hp=I.e.hp;
  const shots=I.volley(n+1);
  I.step(SIM_HZ);   // enemy-ai walks him on his next pass (it runs each enemy every few ticks)
  const reflect=I.poses().filter(v=>v.act==='reflect'),broke=I.poses().filter(v=>v.act==='break');
  assert.equal(reflect.length,n,'shots reflected until the cap');
  assert.ok(near(reflect.reduce((s,v)=>s+(v.amount??0),0),REFLECT.cap),'the reflected sum is the cap');
  assert.ok(reflect.every(v=>v.player==='p'&&near(v.x,I.e.x,1)&&v.amount!>0),'who fired it, where he stands');
  assert.equal(broke.length,1,'one break');
  assert.equal(shots.filter(s=>s.hostile).length,n);
  assert.equal(I.e.hp,hp-10,'the shot after the break hits him');
  assert.ok(!isReflecting(I.e,I.world.tick),'the pose is over');
  assert.equal(I.e.memory!.state,STATE.walk,'enemy-ai walks');
  const hurt=I.events.flatMap(v=>v.type==='damage'&&v.target==='p'&&v.source===I.e.id?[v.amount]:[]);
  assert.ok(hurt.reduce((s,a)=>s+a,0)<=REFLECT.cap+1e-9,`the hero ate ${hurt.join('+')} back`);
  // The next pose counts from zero.
  I.e.memory!.actReady=I.world.tick;
  for(let i=0;i<SIM_HZ&&!isReflecting(I.e,I.world.tick);i++)I.step(1);
  assert.ok(isReflecting(I.e,I.world.tick),'posing again');
  const again=I.volley(1)[0];
  I.step(SIM_HZ/2);
  assert.ok(again.hostile,'reflected again');
  assert.ok(near(I.poses().filter(v=>v.act==='reflect').at(-1)!.amount!,per),'a full shot, not the leftover');
});

test('refletor: the coach buff counts toward the cap; the crossing shot is clipped to what is left',()=>{
  const I=poser();
  (I.e as CoachedEnemy).coachedUntil=1e9;
  I.volley(3);
  I.step(SIM_HZ/2);
  const per=10*REFLECT.mult*PALESTRA.damageMult;
  const got=I.poses().filter(v=>v.act==='reflect').map(v=>v.amount!);
  const want:number[]=[];for(let left=REFLECT.cap;left>1e-9;left-=Math.min(per,left))want.push(Math.min(per,left));
  assert.equal(got.length,want.length);
  got.forEach((a,i)=>assert.ok(near(a,want[i]),`shot ${i}: ${a} vs ${want[i]}`));
  assert.equal(I.poses().filter(v=>v.act==='break').length,1);
});

test('avisos: aims ≥ MIN_TELEGRAPH_TICKS; blasts dodgeable from their centre at the city base walk (+.3 u)',()=>{
  assert.ok(AGIOTA_SHOT.aim>=MIN_TELEGRAPH_TICKS,'agiota aim');
  assert.ok(MOTOBOY.aim>=MIN_TELEGRAPH_TICKS,'motoboy aim');
  for(const [name,delay,radius] of [['anão death',MOLOTOV.deathDelay,MOLOTOV.deathRadius],['marmita',MOTOBOY.blastDelay,MOTOBOY.blastRadius]] as const){
    assert.ok(delay>=MIN_TELEGRAPH_TICKS,`${name} delay`);
    const walk=delay/SIM_HZ*CITY_HERO_SPEED;
    assert.ok(walk>=radius+RADIUS+.3,`${name}: walks ${walk.toFixed(2)} u, needs ${(radius+RADIUS+.3).toFixed(2)}`);
  }
});

test('avisos: the motoboy triggers only within his run (city and endless), so a hero who stands still is reached',()=>{
  for(const base of [CITY_HERO_SPEED,SPEED]){
    // He touches a hero within his radius + the hero's (enemy-ai contact) at the end of the run.
    const reach=base*ACTION_PEAK_MAX*MOTOBOY.charge/SIM_HZ+ENEMIES.motoboy.radius+RADIUS;
    assert.ok(MOTOBOY.trigger<=reach,`trigger ${MOTOBOY.trigger} vs run + touch ${reach.toFixed(2)} u`);
  }
});
