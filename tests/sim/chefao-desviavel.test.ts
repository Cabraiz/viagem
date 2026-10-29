import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,BOT_WALK_MULT,SIM_HZ} from '../../src/contract/types.ts';
import type {EnemyState,SimPlayer,SpatialIndex,Telegraph} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {CITY_HERO_SPEED,HERO_SPEED_MULT,RADIUS} from '../../src/maps/world.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {BOSS_TUNING,createBoss} from '../../src/sim/boss.ts';
import {telegraphHits,telegraphSystem} from '../../src/sim/telegraphs.ts';
import {DODGE_SLACK,DODGE_WALK,coneEscape,waveBossTuning} from '../../src/sim/ninhos/chefao.ts';

/** Card chefao-desviavel: walking out from the worst spot, every golpe of the wave boss misses by >= .3 u. */
const T=waveBossTuning();
const walked=(delay:number)=>(delay-1)/SIM_HZ*DODGE_WALK; // one tick to react

test('the dodge walk is a room bot in the city, the slowest hero',()=>{
  assert.ok(Math.abs(DODGE_WALK-CITY_HERO_SPEED*HERO_SPEED_MULT*BOT_WALK_MULT)<1e-12);
  assert.ok(DODGE_WALK<CITY_HERO_SPEED*HERO_SPEED_MULT);
  assert.equal(DODGE_SLACK,.3);
});

test('every warning of the wave boss is long enough to walk out of its area with .3 u to spare',()=>{
  const need={
    slam:[T.slamDelay,T.slamRadius],stamp:[T.fineDelay,T.fineRadius],charge:[T.chargeDelay,T.chargeWidth/2],
    charge2:[T.chargeDelay2,T.chargeWidth/2],cone:[T.coneDelay,coneEscape(T.coneRange,T.coneAngle)],
  } as const;
  for(const [name,[delay,reach]] of Object.entries(need))
    assert.ok(walked(delay)>=reach+RADIUS+DODGE_SLACK,`${name}: ${delay} ticks walk ${walked(delay).toFixed(2)} u < ${(reach+RADIUS+DODGE_SLACK).toFixed(2)} u`);
  for(const k of ['slamDelay','fineDelay','chargeDelay','chargeDelay2','coneDelay'] as const)assert.ok(T[k]>=BOSS_TUNING[k],`${k} never shorter than the boss's`);
  assert.deepEqual(waveBossTuning(BOSS_TUNING,1,99).slamDelay,BOSS_TUNING.slamDelay,'a small, fast case keeps the authored warning');
});

test('cone escape is the axis point as far from the side as from the rim',()=>{
  const R=10,a=1,h=a/2,e=coneEscape(R,a),d=e/Math.sin(h);
  assert.ok(Math.abs(d+e-R)<1e-9);
});

const player=(id:string,x:number,y:number):SimPlayer=>({
  id,classId:'test',x,y,hp:1e6,online:true,spectator:false,facing:{x:1,y:0},
  build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},
});
function naiveIndex<T extends {id:string;x:number;y:number}>():SpatialIndex<T>{
  let items:T[]=[];
  const query=(x:number,y:number,r:number,out:T[]=[])=>{for(const i of items)if(Math.hypot(i.x-x,i.y-y)<=r)out.push(i);return out;};
  return {rebuild(src){items=[...src];},query,
    nearest(x,y,r,filter){let best:T|undefined,bd=Infinity;for(const i of query(x,y,r)){const d=Math.hypot(i.x-x,i.y-y);if(d<bd&&(!filter||filter(i))){best=i;bd=d;}}return best;}};
}
function fakeCtx(players:SimPlayer[],seed:number):SimContext&{tick:number}{
  let counter=0;
  const ps=new Map(players.map(p=>[p.id,p] as const));
  const ctx:SimContext&{tick:number}={
    tick:0,terrain:defaultTerrain,rng:new Rng(seed),players:ps,enemies:new Map<string,EnemyState>(),
    pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},round:{index:1,total:10,phase:'wave',phaseEndsTick:99999,remaining:1},
    enemyIndex:naiveIndex<EnemyState>(),
    nextId(prefix){return `${prefix}${++counter}`;},emit(){},damageEnemy(){return false;},
    damagePlayer(id,amount){const p=ps.get(id);if(p)p.hp=Math.max(0,p.hp-amount);},
  };
  return ctx;
}

/** The worst spot inside `t` (boss at `boss`) and the way out of it. */
function worst(t:Telegraph,boss:{x:number;y:number}):{at:{x:number;y:number};dir:{x:number;y:number}}{
  if(t.shape==='line'){
    const dx=t.dx!,dy=t.dy!,m=t.radius/2;
    return {at:{x:t.x+dx*m,y:t.y+dy*m},dir:{x:-dy,y:dx}};
  }
  if(t.shape==='cone'){
    const h=(t.width??T.coneAngle)/2,d=t.radius/(1+Math.sin(h)),ax=Math.atan2(t.dy!,t.dx!);
    return {at:{x:t.x+Math.cos(ax)*d,y:t.y+Math.sin(ax)*d},dir:{x:Math.cos(ax+h+Math.PI/2),y:Math.sin(ax+h+Math.PI/2)}};
  }
  // a circle: its centre, or the edge of his body when it is centred under him (a hero can't stand inside him)
  const off=Math.hypot(t.x-boss.x,t.y-boss.y),body=T.radius+RADIUS;
  if(off<body){
    const a=off>1e-9?Math.atan2(t.y-boss.y,t.x-boss.x):0,r=body-off;
    return {at:{x:t.x+Math.cos(a)*r,y:t.y+Math.sin(a)*r},dir:{x:Math.cos(a),y:Math.sin(a)}};
  }
  return {at:{x:t.x,y:t.y},dir:{x:1,y:0}};
}

test('walking out at the dodge walk, a hero leaves every golpe of the wave boss with .3 u to spare, in every phase',()=>{
  const seen=new Map<string,number>();
  for(const hp of [1,.5,.2])for(let seed=1;seed<=6;seed++){
    const players=[player('p1',12,6.5),player('p2',17.5,12),player('p3',6.5,12)];
    const ctx=fakeCtx(players,seed),boss=createBoss({tuning:T,summon:()=>undefined});
    const e=boss.spawnBoss(ctx,{x:12,y:12})!;e.hp=e.maxHp*hp;
    const checked=new Set<string>();
    for(let i=0;i<SIM_HZ*25;i++){
      boss.step(ctx);
      for(const t of ctx.telegraphs.values()){
        if(checked.has(t.id))continue;
        checked.add(t.id);
        const {at,dir}=worst(t,e),steps=t.fireTick-ctx.tick-1,go=steps/SIM_HZ*DODGE_WALK;
        const end={x:at.x+dir.x*go,y:at.y+dir.y*go};
        const label=`${t.shape} r${t.radius.toFixed(2)} (hp ${hp}, seed ${seed}, ${t.fireTick-ctx.tick} ticks)`;
        assert.ok(telegraphHits(t,at,RADIUS),`${label}: the start is inside`);
        assert.ok(!telegraphHits(t,end,RADIUS+DODGE_SLACK-1e-6),`${label}: still caught after ${go.toFixed(2)} u`);
        seen.set(t.shape,(seen.get(t.shape)??0)+1);
      }
      telegraphSystem.step(ctx);
      for(const p of ctx.players.values())p.hp=1e6;
      ctx.tick++;
    }
  }
  for(const shape of ['circle','line','cone'])assert.ok((seen.get(shape)??0)>0,`saw a ${shape}`);
});
