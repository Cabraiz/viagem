// BUG-20261023-ORQ-armas-sem-projetil (usuário 23/10: "a shotgun e outras armas são explosivos, nem aparece o projétil
// indo"): a thrown zone (rojão, tijolo baiano, traque; rules/thrown.ts) leaves the hero, flies THROW_TICKS hitting
// nothing and only then bursts on its spot, with the same damage, area and duration as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,SIM_HZ} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {createWeaponSystem} from '../../src/sim/weapons/system.ts';
import {createProjectileSystem,type WeaponProjectile} from '../../src/sim/projectiles.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {THROW_MS,THROW_TICKS} from '../../src/rules/index.ts';

interface Fake extends SimContext {tick:number;players:Map<string,SimPlayer>;events:{tick:number;event:SimEvent}[]}
function arena(weapon:string,at:{x:number;y:number}){
  let ids=0,items:EnemyState[]=[];
  const index:SpatialIndex<EnemyState>={
    rebuild(it){items=[...it];},
    query(x,y,r,out=[]){out.length=0;for(const e of items)if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
    nearest(x,y,r,ok){let best:EnemyState|undefined,bd=Infinity;for(const e of items){const d=Math.hypot(e.x-x,e.y-y);if(d<=r&&d<bd&&(!ok||ok(e))){best=e;bd=d;}}return best;},
  };
  const ctx:Fake={
    tick:0,terrain:{} as TerrainField,rng:new Rng(1),players:new Map(),enemies:new Map(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},enemyIndex:index,events:[],
    nextId(prefix){return prefix+(++ids);},
    emit(event){ctx.events.push({tick:ctx.tick,event});},
    damageEnemy(id,amount){const e=ctx.enemies.get(id);if(!e||e.hp<=0)return false;e.hp-=amount;return false;},
    damagePlayer(){},
  };
  const p:SimPlayer={id:'p1',classId:'x',x:10,y:10,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:weapon,level:4}],passives:[]},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(p.id,p);
  ctx.enemies.set('e0',{id:'e0',kind:'mosquito',x:10+at.x,y:10+at.y,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0});
  const weapons=createWeaponSystem({manual:{attacking:()=>true}}),projectiles=createProjectileSystem();
  const step=()=>{ctx.tick++;ctx.enemyIndex.rebuild(ctx.enemies.values());weapons.step(ctx);projectiles.step(ctx);};
  const shot=()=>[...ctx.projectiles.values()].find(q=>q.source===weapon) as WeaponProjectile|undefined;
  return {ctx,step,shot,hurt:()=>1e6-ctx.enemies.get('e0')!.hp};
}

test('thrown: the flight lasts 0,4 s',()=>{
  assert.equal(THROW_TICKS/SIM_HZ,.4);assert.equal(THROW_MS,400);
});

for(const id of ['rojao','tijolo-baiano','traque']){
  test(`thrown ${id}: flies from the hero, hurts nobody in flight, bursts on the target when it lands`,()=>{
    assert.equal(getWeapon(id)?.effect?.thrown,true);
    const a=arena(id,{x:5,y:0});
    a.step();
    const p=a.shot()!;
    assert.ok(p,'thrown on the first tick');
    const fired=a.ctx.tick;
    assert.ok(p.vx>0,'flying toward the target');
    assert.ok(Math.hypot(p.x-10,p.y-10)<6/THROW_TICKS*1.5,'leaves from the hero');
    for(let t=1;t<THROW_TICKS;t++){a.step();assert.equal(a.hurt(),0,`no hit in flight (tick ${t})`);}
    assert.ok(p.vx>0&&p.landTick!==undefined,'still in flight one tick before landing');
    a.step();
    assert.equal(a.ctx.tick,fired+THROW_TICKS);
    assert.equal(p.vx,0);assert.equal(p.vy,0);assert.equal(p.landTick,undefined);
    assert.ok(a.hurt()>0,'bursts when it lands');
    const w=resolveWeapon(getWeapon(id)!,4,BASE_STATS);
    assert.equal(p.untilTick,fired+THROW_TICKS+w.durationTicks,'same burst duration, after the flight');
    assert.equal(p.radius,w.area);assert.equal(p.damage,w.damage);
  });
}

test('not thrown: the café puddle still sits on the target at once',()=>{
  const a=arena('cafe',{x:2,y:0});
  a.step();
  const p=a.shot()!;
  assert.ok(p);assert.equal(p.vx,0);assert.equal(p.landTick,undefined);
});
