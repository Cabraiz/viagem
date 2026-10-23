// NEW-20261022-ORQ-arsenal-completo-no-bau, fatia A2 (E7): the three Pack 12 weapons with new mechanics, run by the real
// weapon and projectile systems: bola-murcha (ricochet: bounces from head to head), panela-de-pressao (mine: a pot that
// bursts when touched, at most 3) and carro-de-som (turret: a car on the ground that shoots waves on its own).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {createWeaponSystem} from '../../src/sim/weapons/system.ts';
import {createProjectileSystem,type WeaponProjectile} from '../../src/sim/projectiles.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {PACK12_PLAYABLE} from '../../src/sim/weapons/pack12.ts';
import {A2_PLAYABLE} from '../../src/sim/weapons/pack12-a2.ts';
import {ARSENAL_WEAPONS,weaponNoise} from '../../src/sim/weapons/arsenal.ts';
import {BOUNCE_RADIUS} from '../../src/sim/weapons/ricochet.ts';
import {MAX_MINES} from '../../src/sim/weapons/mine.ts';
import {TURRET_SHOT} from '../../src/sim/weapons/turret.ts';
import {CRATE_WEAPONS,rollPrize} from '../../src/sim/crates.ts';
import {FIRE_LOOK,ARSENAL_ITEMS,ARSENAL_PROJECTILE_ALIAS} from '../../src/client/render/arsenal-rules.ts';
import {projectileArtId} from '../../src/client/art/horde-art.ts';

interface Fake extends SimContext {tick:number;players:Map<string,SimPlayer>;events:{tick:number;event:SimEvent}[];dealt:Map<string,number>}
function naiveIndex():SpatialIndex<EnemyState>{
  let items:EnemyState[]=[];
  return {
    rebuild(it){items=[...it];},
    query(x,y,r,out=[]){out.length=0;for(const e of items)if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
    nearest(x,y,r,filter){let best:EnemyState|undefined,d=Infinity;for(const e of items){const k=Math.hypot(e.x-x,e.y-y);if(k<=r&&k<d&&(!filter||filter(e))){best=e;d=k;}}return best;},
  };
}
function makeCtx():Fake{
  let ids=0;
  const ctx:Fake={
    tick:0,terrain:{} as TerrainField,rng:new Rng(1),players:new Map(),enemies:new Map(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},enemyIndex:naiveIndex(),events:[],dealt:new Map(),
    nextId(prefix){return prefix+(++ids);},
    emit(event){ctx.events.push({tick:ctx.tick,event});},
    damageEnemy(id,amount,_by,weapon){
      const e=ctx.enemies.get(id);if(!e||e.hp<=0)return false;
      e.hp-=amount;ctx.dealt.set(weapon??'',(ctx.dealt.get(weapon??'')??0)+amount);
      if(e.hp<=0){ctx.enemies.delete(id);return true;}
      return false;
    },
    damagePlayer(){},
  };
  return ctx;
}
function setup(weapon:string,enemies:[number,number][],opts:{hp?:number;rarity?:number;attacking?:()=>boolean}={}){
  const ctx=makeCtx();
  const p:SimPlayer={id:'p1',classId:'x',x:0,y:0,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:weapon,level:opts.rarity??getWeapon(weapon)!.minRarity??1}],passives:[]},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(p.id,p);
  enemies.forEach(([x,y],i)=>{
    const e:EnemyState={id:`e${i+1}`,kind:'mosquito',x,y,hp:opts.hp??1e6,maxHp:opts.hp??1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0};
    ctx.enemies.set(e.id,e);
  });
  const weapons=createWeaponSystem({manual:{attacking:opts.attacking??(()=>true)}}),shots=createProjectileSystem();
  const step=(n=1)=>{for(let i=0;i<n;i++){ctx.tick++;ctx.enemyIndex.rebuild(ctx.enemies.values());weapons.step(ctx);ctx.enemyIndex.rebuild(ctx.enemies.values());shots.step(ctx);}};
  return {ctx,player:p,step};
}
const live=(ctx:Fake,pred:(p:WeaponProjectile)=>boolean)=>[...ctx.projectiles.values()].map(p=>p as WeaponProjectile).filter(pred);
const hurt=(ctx:Fake,id:string)=>{const e=ctx.enemies.get(id);return !e||e.hp<e.maxHp;};
const resolved=(id:string)=>{const d=getWeapon(id)!;return resolveWeapon(d,d.minRarity??1,BASE_STATS);};

test('A2: the three are playable (catalog, arsenal, noise) with their Pack 12 patterns', ()=>{
  assert.deepEqual([...A2_PLAYABLE].sort(),['bola-murcha','carro-de-som','panela-de-pressao']);
  for(const id of A2_PLAYABLE){
    assert.ok(PACK12_PLAYABLE.has(id),id);
    assert.ok(ARSENAL_WEAPONS.some(w=>w.id===id),id);
    assert.ok(getWeapon(id),id);
  }
  assert.equal(getWeapon('bola-murcha')!.pattern,'ricochet');
  assert.equal(getWeapon('panela-de-pressao')!.pattern,'mine');
  assert.equal(getWeapon('carro-de-som')!.pattern,'turret');
  assert.deepEqual(A2_PLAYABLE.map(weaponNoise),[6,22,24]);
});

test('A2: the crates draw each of the three from its rarity up (10 mil sorteios), never below', ()=>{
  const min:Record<string,number>={'bola-murcha':2,'panela-de-pressao':4,'carro-de-som':4};
  for(const [id,r] of Object.entries(min)){
    for(let k=1;k<=4;k++)assert.equal(CRATE_WEAPONS[k as 1|2|3|4].includes(id),k>=r,`${id} r${k}`);
  }
  const rng=new Rng(7),seen=new Map<number,Set<string>>();
  for(let r=2;r<=4;r++){
    const got=new Set<string>();seen.set(r,got);
    for(let i=0;i<10_000;i++)for(const item of rollPrize(rng,r).items)got.add(item.id);
  }
  assert.ok(seen.get(2)!.has('bola-murcha'));assert.ok(!seen.get(2)!.has('panela-de-pressao'));
  for(const id of A2_PLAYABLE)assert.ok(seen.get(4)!.has(id),`${id} in the dourada`);
});

test('bola-murcha: one ball hits a head, then bounces to the next nearest unhit ones, pierce (3) times', ()=>{
  // Five critters in a row 2 u apart, the first at 3 u, one volley: the ball takes the first and bounces along to the
  // fourth (the hero's shots fly HERO_SHOT_SPEED_MULT slow, so it takes a while).
  let held=true;
  const {ctx,step}=setup('bola-murcha',[[3,0],[5,0],[7,0],[9,0],[11,0]],{attacking:()=>{const h=held;held=false;return h;}});
  step(500);
  assert.deepEqual(['e1','e2','e3','e4','e5'].map(id=>hurt(ctx,id)),[true,true,true,true,false]);
  const fire=ctx.events.find(e=>e.event.type==='fire');
  assert.ok(fire&&fire.event.type==='fire'&&fire.event.weapon==='bola-murcha');
  assert.equal(resolved('bola-murcha').pierce,3);
});

test('bola-murcha: no head within the bounce radius, the ball is spent on its first hit', ()=>{
  const idle=setup('bola-murcha',[[3,0]],{attacking:()=>false});
  idle.step(5);assert.equal(live(idle.ctx,()=>true).length,0,'attack not held: nothing fired');
  let held=true;
  const {ctx,step}=setup('bola-murcha',[[3,0],[3+BOUNCE_RADIUS+1,0]],{attacking:()=>{const h=held;held=false;return h;}});
  step(200);
  assert.equal(hurt(ctx,'e1'),true);assert.equal(hurt(ctx,'e2'),false);
  assert.equal(live(ctx,p=>p.source==='bola-murcha').length,0);
});

test('bola-murcha: it never bounces back to a head it already hit', ()=>{
  let held=true;
  const {ctx,step}=setup('bola-murcha',[[3,0],[4,0]],{attacking:()=>{const h=held;held=false;return h;}});
  step(400);
  const total=ctx.dealt.get('bola-murcha')??0,one=resolved('bola-murcha').damage;
  assert.equal(total,one*2,'two heads, one hit each');
});

test('panela-de-pressao: dropped at the feet, quiet, it bursts when a critter touches it and hurts the whole area', ()=>{
  // Held once with a critter near enough: a pot at the hero's feet, no 'fire' yet (the drop makes no noise).
  let held=true;
  const run=setup('panela-de-pressao',[[2.5,0],[1.5,1],[8,0]],{attacking:()=>{const h=held;held=false;return h;}});
  run.step(1);
  const pots=live(run.ctx,p=>p.mechanic==='mine');
  assert.equal(pots.length,1);
  assert.deepEqual([pots[0].x,pots[0].y,pots[0].vx,pots[0].vy],[0,0,0,0]);
  assert.equal(run.ctx.events.filter(e=>e.event.type==='fire').length,0);
  run.step(30);assert.equal(live(run.ctx,p=>p.mechanic==='mine').length,1,'nobody touched it: still there');
  // The critter walks onto it: burst, both near ones hurt, the far one not, a 'fire' at the pot (noise + blast).
  run.ctx.enemies.get('e1')!.x=.5;
  run.step(1);
  assert.equal(live(run.ctx,p=>p.mechanic==='mine').length,0);
  assert.deepEqual(['e1','e2','e3'].map(id=>hurt(run.ctx,id)),[true,true,false]);
  const burst=run.ctx.events.find(e=>e.event.type==='fire');
  assert.ok(burst&&burst.event.type==='fire');
  assert.deepEqual([burst.event.weapon,burst.event.x,burst.event.y,burst.event.dx,burst.event.dy],['panela-de-pressao',0,0,0,0]);
  assert.equal(run.ctx.dealt.get('panela-de-pressao'),resolved('panela-de-pressao').damage*2);
});

test('panela-de-pressao: nothing near, no pot; at most 3 live, the 4th retires the oldest', ()=>{
  const far=setup('panela-de-pressao',[[20,0]]);
  far.step(30);assert.equal(live(far.ctx,()=>true).length,0);
  const {ctx,player,step}=setup('panela-de-pressao',[[2.5,0]]);
  const cd=resolved('panela-de-pressao').cooldownTicks;
  const spots:number[]=[];
  for(let i=0;i<MAX_MINES+1;i++){player.x=-i*.01;player.y=0;spots.push(player.x);step(cd);}
  const pots=live(ctx,p=>p.mechanic==='mine');
  assert.equal(pots.length,MAX_MINES);
  assert.ok(!pots.some(p=>p.x===spots[0]),'the first pot is gone');
});

test('panela-de-pressao: a pot lives its duration (12 s) and then goes away unburst', ()=>{
  let held=true;
  const {ctx,step}=setup('panela-de-pressao',[[2.5,0]],{attacking:()=>{const h=held;held=false;return h;}});
  const life=resolved('panela-de-pressao').durationTicks;
  step(life-1);assert.equal(live(ctx,p=>p.mechanic==='mine').length,1);
  step(2);assert.equal(live(ctx,p=>p.mechanic==='mine').length,0);
  assert.equal(hurt(ctx,'e1'),false);
});

test('carro-de-som: the car is placed at the feet, never hits by contact, and shoots waves every .4 s at the nearest', ()=>{
  let held=true;
  const w=resolved('carro-de-som');
  const {ctx,player,step}=setup('carro-de-som',[[6,0],[-7,0]],{attacking:()=>{const h=held;held=false;return h;}});
  step(1);
  const cars=live(ctx,p=>p.mechanic==='turret');
  assert.equal(cars.length,1);assert.deepEqual([cars[0].x,cars[0].y],[0,0]);
  // The hero walks away: the car stays and keeps shooting on its own (the attack is no longer held).
  player.x=30;
  step(w.rehitTicks*15);
  const waves=ctx.events.filter(e=>e.event.type==='fire'&&e.event.weapon==='carro-de-som');
  assert.ok(waves.length>=14&&waves.length<=16,`${waves.length} volleys in 6 s`);
  for(const e of waves)if(e.event.type==='fire')assert.ok(e.event.dx!>0,'at the nearest (the one at +6)');
  assert.equal(hurt(ctx,'e1'),true);assert.equal(hurt(ctx,'e2'),false);
  assert.ok((ctx.dealt.get(TURRET_SHOT)??0)>0);
  // A critter standing on the car takes nothing from the car itself.
  const shots=ctx.dealt.get(TURRET_SHOT)??0;
  ctx.enemies.get('e2')!.x=0;ctx.enemies.get('e1')!.x=100;
  step(w.rehitTicks*2);
  assert.ok((ctx.dealt.get(TURRET_SHOT)??0)>shots,'it shoots the one on top of it with waves, not by contact');
});

test('carro-de-som: one car per hero, it lasts until the next placement, and it is quiet when the owner is down', ()=>{
  const w=resolved('carro-de-som');
  const {ctx,player,step}=setup('carro-de-som',[[5,0]]);
  step(1);const first=live(ctx,p=>p.mechanic==='turret')[0];
  step(w.cooldownTicks+1);
  const cars=live(ctx,p=>p.mechanic==='turret');
  assert.equal(cars.length,1);assert.notEqual(cars[0].id,first.id);
  player.downed=true;
  const before=ctx.events.length;step(w.rehitTicks*4);
  assert.equal(ctx.events.slice(before).filter(e=>e.event.type==='fire').length,0);
});

test('A2 render: stickers, the pot\'s blast and the projectile art of the ball, the pot, the car and its waves', ()=>{
  for(const id of A2_PLAYABLE)assert.ok(ARSENAL_ITEMS.includes(id),id);
  assert.equal(FIRE_LOOK['panela-de-pressao'].kind,'blast');
  assert.equal(projectileArtId('bola-murcha'),'bola-murcha');
  assert.equal(projectileArtId('panela-de-pressao'),'panela-de-pressao');
  assert.equal(projectileArtId('carro-de-som'),'carro-de-som');
  assert.equal(projectileArtId(TURRET_SHOT),'carro-de-som');
  assert.ok(ARSENAL_PROJECTILE_ALIAS.some(([s])=>s===TURRET_SHOT));
});
