// NEW-20261022-ORQ-arsenal-completo-no-bau, fatia A1: the Pack 12 weapons on the sim's own patterns (eight since the
// rings left the game: sem-arma-girando-no-chao), through the real weapon and projectile systems (manual combat, attack
// held): every one hurts an enemy in its reach, and each type does its own thing (the sacolé slows, the tampa comes
// back, the traque scatters, the tarô fans, the espeto pierces, the buscapé homes).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {createWeaponSystem,manualReach} from '../../src/sim/weapons/system.ts';
import {createProjectileSystem,type WeaponProjectile} from '../../src/sim/projectiles.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {A1_PLAYABLE} from '../../src/sim/weapons/pack12.ts';
import {THROW_TICKS} from '../../src/rules/index.ts';

interface Fake extends SimContext {tick:number;players:Map<string,SimPlayer>;events:{tick:number;event:SimEvent}[]}
function naiveIndex():SpatialIndex<EnemyState>{
  let items:EnemyState[]=[];
  return {
    rebuild(it){items=[...it];},
    query(x,y,r,out=[]){out.length=0;for(const e of items)if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
    nearest(x,y,r,ok){let best:EnemyState|undefined,bd=Infinity;for(const e of items){const d=Math.hypot(e.x-x,e.y-y);if(d<=r&&d<bd&&(!ok||ok(e))){best=e;bd=d;}}return best;},
  };
}
function arena(weapon:string,level:number,enemies:readonly {x:number;y:number}[]){
  let ids=0;
  const ctx:Fake={
    tick:0,terrain:{} as TerrainField,rng:new Rng(1),players:new Map(),enemies:new Map(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},enemyIndex:naiveIndex(),events:[],
    nextId(prefix){return prefix+(++ids);},
    emit(event){ctx.events.push({tick:ctx.tick,event});},
    damageEnemy(id,amount){const e=ctx.enemies.get(id);if(!e||e.hp<=0)return false;e.hp-=amount;return false;},
    damagePlayer(){},
  };
  const p:SimPlayer={id:'p1',classId:'x',x:10,y:10,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:weapon,level}],passives:[]},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(p.id,p);
  enemies.forEach((at,i)=>ctx.enemies.set(`e${i}`,{id:`e${i}`,kind:'mosquito',x:10+at.x,y:10+at.y,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0}));
  const weapons=createWeaponSystem({manual:{attacking:()=>true}}),projectiles=createProjectileSystem();
  const seen:WeaponProjectile[]=[];
  const run=(n:number)=>{for(let i=0;i<n;i++){
    ctx.tick++;ctx.enemyIndex.rebuild(ctx.enemies.values());weapons.step(ctx);
    for(const pr of ctx.projectiles.values())if(!seen.includes(pr as WeaponProjectile))seen.push(pr as WeaponProjectile);
    projectiles.step(ctx);
  }};
  return {ctx,player:p,run,seen,hurt:(i=0)=>{const e=ctx.enemies.get(`e${i}`)!;return e.maxHp-e.hp;}};
}
const reachOf=(id:string)=>manualReach(resolveWeapon(getWeapon(id)!,1,BASE_STATS)).reach;

test('A1: every one of the eight is a catalog weapon, rarities from its minimum, and hurts an enemy in its reach',()=>{
  assert.equal(A1_PLAYABLE.length,8);
  for(const id of A1_PLAYABLE){
    const def=getWeapon(id);assert.ok(def?.pattern,id);
    // Just inside the reach for the aimed ones; the rings touch what stands on them.
    const at=def.pattern==='orbit'?def.levels[0].area:Math.max(.5,reachOf(id)*.7);
    const a=arena(id,2,[{x:at,y:0}]);
    a.run(150);
    assert.ok(a.hurt()>0,`${id} hurt nobody at ${at.toFixed(2)} u`);
    assert.ok(a.ctx.events.some(e=>e.event.type==='fire'&&(e.event as {weapon?:string}).weapon===id),`${id} fired`);
  }
});

test('A1 sacolé: the hit slows the enemy',()=>{
  const a=arena('sacole',1,[{x:3,y:0}]);
  a.run(60);
  const e=a.ctx.enemies.get('e0')!;
  assert.ok(a.hurt()>0);assert.ok((e.slowUntil??0)>a.ctx.tick-60,'slowed');
});

test('A1 tampa-voadora: the lid flies out and comes back (boomerang), through everyone',()=>{
  const a=arena('tampa-voadora',1,[{x:3,y:0}]);
  a.run(3);
  const lid=a.seen.find(p=>p.source==='tampa-voadora')!;
  assert.ok(lid,'thrown');assert.ok(lid.returnTick!==undefined,'returns');assert.ok(lid.pierce>=1e5,'pierces all');
  const vx=lid.vx;a.run(lid.returnTick!-a.ctx.tick+1);
  assert.ok(Math.sign(lid.vx)===-Math.sign(vx),'comes back');
});

test('A1 traque: four small bursts ring the target at the scatter distance',()=>{
  const a=arena('traque',2,[{x:4,y:0}]);
  // Thrown (rules/thrown.ts): they fly THROW_TICKS from the hero, then land around the target.
  a.run(THROW_TICKS+1);
  const pops=a.seen.filter(p=>p.source==='traque');
  assert.equal(pops.length,4);
  for(const p of pops)assert.ok(Math.abs(Math.hypot(p.x-14,p.y-10)-1)<1e-6,'1 u from the target');
  assert.ok(a.ctx.events.some(e=>e.event.type==='fire'&&(e.event as {weapon?:string}).weapon==='traque'));
});

test('A1 tarô: five cards fan .25 rad apart around the first target, even with one enemy',()=>{
  const a=arena('taro-vencido',1,[{x:3,y:0}]);
  a.run(2);
  const cards=a.seen.filter(p=>p.source==='taro-vencido');
  assert.equal(cards.length,5);
  const angles=cards.map(p=>Math.atan2(p.vy,p.vx)).sort((x,y)=>x-y);
  for(let i=1;i<5;i++)assert.ok(Math.abs(angles[i]-angles[i-1]-.25)<1e-6);
  assert.ok(Math.abs(angles[2])<1e-6,'centred on the target');
});

test('A1 espeto: one skewer runs through a line of four; the baladeira stops at the first',()=>{
  const line=[{x:2,y:0},{x:2.8,y:0},{x:3.6,y:0},{x:4.4,y:0}];
  const a=arena('espeto',1,line);a.run(150);
  for(let i=0;i<4;i++)assert.ok(a.hurt(i)>0,`espeto e${i}`);
  const b=arena('baladeira',1,line);b.run(150);
  assert.ok(b.hurt(0)>0);assert.equal(b.hurt(3),0);
});

test('A1 buscapé: a homing firework; the tijolo lands where the enemy stands, far',()=>{
  const a=arena('buscape',1,[{x:5,y:2}]);
  a.run(2);
  assert.ok(a.seen.some(p=>p.source==='buscape'&&p.motion==='homing'));
  const b=arena('tijolo-baiano',1,[{x:10,y:0}]);
  b.run(THROW_TICKS+1);
  const brick=b.seen.find(p=>p.source==='tijolo-baiano')!;
  assert.ok(brick);assert.ok(Math.hypot(brick.x-20,brick.y-10)<1e-6);assert.ok(b.hurt()>0);
});
