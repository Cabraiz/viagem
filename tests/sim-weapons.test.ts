import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,SIM_HZ} from '../src/game/sim/types.ts';
import type {EnemyState,PlayerStats,SimContext,SimEvent,SimPlayer,SimSystem,SpatialIndex} from '../src/game/sim/types.ts';
import type {TerrainField} from '../src/game/terrain/field.ts';
import {WEAPON_IDS,EVOLUTION_IDS,PIERCE_INFINITE,MAX_AMOUNT,MIN_COOLDOWN_TICKS,getWeapon,weaponCatalog,weaponLevel,resolveWeapon} from '../src/game/sim/weapons/catalog.ts';
import type {WeaponDef} from '../src/game/sim/weapons/catalog.ts';
import {createWeaponSystem} from '../src/game/sim/weapons/system.ts';
import {PROJECTILE_CAP,spawnProjectile,createProjectileSystem,takeAreaHit} from '../src/game/sim/projectiles.ts';
import {EVOLUTIONS,WEAPON_IDS as EVO_WEAPON_IDS,itemMaxLevel} from '../src/game/sim/evolutions.ts';
import type {ProjectileInit,WeaponProjectile} from '../src/game/sim/projectiles.ts';

// ---------- Fake SimContext ----------
type Hit={tick:number;enemy:string;amount:number;source?:string;weapon?:string;alive:boolean};
interface Fake extends SimContext {
  tick:number; players:Map<string,SimPlayer>;
  events:{tick:number;event:SimEvent}[]; hits:Hit[]; kills:string[];
  playerHits:{tick:number;player:string;amount:number;source?:string}[];
}

function naiveIndex():SpatialIndex<EnemyState>{
  let items:EnemyState[]=[];
  return {
    rebuild(it){items=[...it];},
    query(x,y,r,out=[]){out.length=0;for(const e of items)if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
    nearest(x,y,r,filter){
      let best:EnemyState|undefined,bd=Infinity;
      for(const e of items){
        if(filter&&!filter(e))continue;
        const d=Math.hypot(e.x-x,e.y-y);
        if(d>r)continue;
        if(d<bd||(d===bd&&best&&e.id<best.id)){best=e;bd=d;}
      }
      return best;
    },
  };
}

function makeCtx(seed=1):Fake{
  let ids=0;
  const ctx:Fake={
    tick:0,terrain:{} as TerrainField,rng:new Rng(seed),players:new Map(),enemies:new Map(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},enemyIndex:naiveIndex(),
    events:[],hits:[],kills:[],playerHits:[],
    nextId(prefix){return prefix+(++ids);},
    emit(event){ctx.events.push({tick:ctx.tick,event});},
    // Mirrors the core contract: might applied here, once per call, kill emitted once.
    damageEnemy(id,amount,src,weapon){
      const e=ctx.enemies.get(id);
      ctx.hits.push({tick:ctx.tick,enemy:id,amount,source:src,weapon,alive:!!e&&e.hp>0});
      if(!e||e.hp<=0)return false;
      e.hp-=amount*(src?ctx.players.get(src)?.stats.might??1:1);
      if(e.hp>0)return false;
      ctx.enemies.delete(id);ctx.kills.push(id);
      ctx.emit({type:'kill',enemy:id,kind:e.kind,by:src,x:e.x,y:e.y});
      return true;
    },
    damagePlayer(id,amount,source){ctx.playerHits.push({tick:ctx.tick,player:id,amount,source});},
  };
  return ctx;
}

function addPlayer(ctx:Fake,id:string,x:number,y:number,weapons:[string,number][]=[],o:Partial<SimPlayer>={}):SimPlayer{
  const p:SimPlayer={id,classId:'turista',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:weapons.map(([id,level])=>({id,level})),passives:[]},stats:{...BASE_STATS},weaponReady:{},...o};
  ctx.players.set(id,p);return p;
}
function addEnemy(ctx:Fake,id:string,x:number,y:number,o:Partial<EnemyState>={}):EnemyState{
  const e:EnemyState={id,kind:'mosquito',x,y,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0,...o};
  ctx.enemies.set(id,e);return e;
}
const systems=(cap?:number):SimSystem[]=>[createWeaponSystem({cap}),createProjectileSystem({cap})];
/** Mirrors SYSTEM_ORDER for the two systems under test: weapons, then projectiles. */
function run(ctx:Fake,sys:SimSystem[],n=1,each?:(ctx:Fake)=>void){
  for(let i=0;i<n;i++){
    ctx.tick++;
    ctx.enemyIndex.rebuild(ctx.enemies.values());
    for(const s of sys)s.step(ctx);
    each?.(ctx);
  }
}
const shot=(o:Partial<ProjectileInit>={}):ProjectileInit=>({owner:'p1',source:'test',motion:'linear',x:10,y:12,vx:0,vy:0,radius:.2,damage:10,pierce:0,untilTick:1e9,hostile:false,...o});
const projs=(ctx:Fake,source?:string)=>[...ctx.projectiles.values()].map(p=>p as WeaponProjectile).filter(p=>!source||p.source===source);
const hitsOn=(ctx:Fake,enemy:string)=>ctx.hits.filter(h=>h.enemy===enemy);
const fires=(ctx:Fake,weapon?:string)=>ctx.events.filter(e=>e.event.type==='fire'&&(!weapon||(e.event as {weapon:string}).weapon===weapon));
const def=(id:string):WeaponDef=>{const d=getWeapon(id);assert.ok(d,`missing ${id}`);return d;};
const R=(id:string,level:number,stats:Partial<PlayerStats>={})=>resolveWeapon(def(id),level,{...BASE_STATS,...stats});
function noDeadHits(ctx:Fake){
  assert.deepEqual(ctx.hits.filter(h=>!h.alive),[],'damageEnemy called on a dead/removed enemy');
  assert.equal(new Set(ctx.kills).size,ctx.kills.length,'enemy killed twice');
}
/** Hits on one enemy by one weapon never come closer than `gap` ticks (and never twice in a tick). */
function assertGap(ctx:Fake,enemy:string,weapon:string,gap:number){
  const t=hitsOn(ctx,enemy).filter(h=>h.weapon===weapon).map(h=>h.tick);
  for(let i=1;i<t.length;i++)assert.ok(t[i]-t[i-1]>=gap,`${weapon} hit ${enemy} at ${t[i-1]} and ${t[i]} (rehit ${gap})`);
  return t;
}

// ---------- 1. Catalog ----------
test('catalog: fixed ids, full level tables, pt-BR texts and monotonic power',()=>{
  assert.deepEqual([...WEAPON_IDS],['chinelo','boleto','cafe','guarda-chuva','pombo','audio']);
  assert.deepEqual([...EVOLUTION_IDS],['chinelo-evo','boleto-evo','cafe-evo']);
  assert.deepEqual(weaponCatalog.all().map(d=>d.id).sort(),[...WEAPON_IDS,...EVOLUTION_IDS].sort());
  for(const id of [...WEAPON_IDS,...EVOLUTION_IDS]){
    const d=def(id),evo=(EVOLUTION_IDS as readonly string[]).includes(id);
    assert.equal(d.id,id);assert.equal(weaponCatalog.get(id),d);
    assert.equal(d.kind,evo?'evolution':'weapon',id);
    assert.equal(d.maxLevel,evo?1:8,id);
    assert.equal(d.levels.length,d.maxLevel,id);
    assert.ok(d.name.trim().length>2&&d.quip.trim().length>5,`${id} name/quip`);
    assert.ok(d.pattern,`${id} pattern`);
    for(let l=1;l<=d.maxLevel;l++){
      const text=d.describe(l);
      assert.ok(typeof text==='string'&&text.trim().length>3,`${id} describe(${l}) empty`);
      assert.doesNotMatch(text,/undefined|NaN|\[object/,`${id} describe(${l})`);
    }
    for(let i=1;i<d.levels.length;i++){
      const a=d.levels[i-1],b=d.levels[i],at=`${id} lv${i}->lv${i+1}`;
      assert.ok(b.damage>=a.damage&&b.amount>=a.amount&&b.area>=a.area&&b.duration>=a.duration&&b.pierce>=a.pierce&&b.range>=a.range&&b.speed>=a.speed&&b.knockback>=a.knockback,`${at} lost power`);
      assert.ok(b.cooldown<=a.cooldown&&b.hitInterval<=a.hitInterval,`${at} got slower`);
      const better=b.damage>a.damage||b.amount>a.amount||b.area>a.area||b.duration>a.duration||b.pierce>a.pierce||b.range>a.range||b.speed>a.speed||b.cooldown<a.cooldown||b.hitInterval<a.hitInterval;
      assert.ok(better,`${at} changes nothing`);
    }
    assert.equal(weaponLevel(d,0),d.levels[0]);assert.equal(weaponLevel(d,99),d.levels[d.maxLevel-1]);
  }
  const pairs={'chinelo-evo':['chinelo','tenis'],'boleto-evo':['boleto','cartao'],'cafe-evo':['cafe','cafe-forte']};
  for(const [id,[base,passive]] of Object.entries(pairs)){const d=def(id);assert.equal(d.base,base);assert.equal(d.passive,passive);}
  assert.ok(def('audio').coneHalfAngle!>0&&def('audio').coneHalfAngle!<Math.PI/2);
});

test('catalog: resolveWeapon applies stats, clamps, and never applies might',()=>{
  for(const id of [...WEAPON_IDS,...EVOLUTION_IDS]){
    const d=def(id);
    for(const level of [1,d.maxLevel]){
      const base=R(id,level),row=weaponLevel(d,level);
      assert.equal(base.damage,row.damage,`${id} base damage`);
      assert.equal(R(id,level,{might:3}).damage,row.damage,`${id} damage must exclude might`);
      const s=R(id,level,{cooldown:.5,area:2,amount:1,duration:1.5,speed:2});
      assert.ok(Math.abs(s.area-base.area*2)<1e-9,`${id} area`);
      assert.ok(Math.abs(s.speed-base.speed*2)<1e-9,`${id} speed`);
      assert.equal(s.amount,Math.min(MAX_AMOUNT,base.amount+1),`${id} amount`);
      assert.ok(s.durationTicks>=base.durationTicks&&(base.durationTicks<2||s.durationTicks>base.durationTicks),`${id} duration`);
      assert.ok(s.cooldownTicks<=base.cooldownTicks&&(base.cooldownTicks<=MIN_COOLDOWN_TICKS||s.cooldownTicks<base.cooldownTicks),`${id} cooldown`);
      assert.ok(base.cooldownTicks>=MIN_COOLDOWN_TICKS&&base.amount>=1&&base.amount<=MAX_AMOUNT&&base.durationTicks>=1&&base.rehitTicks>=1);
      const extreme=R(id,level,{cooldown:.0001,amount:100});
      assert.equal(extreme.cooldownTicks,MIN_COOLDOWN_TICKS,`${id} cooldown clamp`);
      assert.equal(extreme.amount,MAX_AMOUNT,`${id} amount clamp`);
    }
  }
});

// ---------- 2. Builds ----------
function buildRun(weapons:[string,number][]){
  const ctx=makeCtx(3),p=addPlayer(ctx,'p1',12,12,weapons);
  const ring=R('chinelo',8).area;
  for(let k=0;k<8;k++){const a=k*Math.PI/4+.1;addEnemy(ctx,`r${k}`,12+Math.cos(a)*ring,12+Math.sin(a)*ring);}
  const far=Math.min(R('boleto',8).range,R('pombo',8).range)*.85;
  assert.ok(far>ring+1.5,'far enemy must be beyond the orbit');
  addEnemy(ctx,'f0',12,12-far);
  p.target='f0';
  const motions=new Set<string>(),sources=new Set<string>();
  run(ctx,systems(),100,c=>{for(const q of projs(c)){sources.add(q.source);motions.add(q.motion==='linear'&&q.vx===0&&q.vy===0&&q.rehit!==undefined?'zone':q.motion??'linear');}});
  noDeadHits(ctx);
  const dmg:Record<string,number>={};for(const h of ctx.hits)dmg[h.enemy]=(dmg[h.enemy]??0)+h.amount;
  const ringHit=Object.keys(dmg).filter(k=>k.startsWith('r')).length;
  return {ctx,dmg,ringHit,motions,sources};
}
test('builds: chinelo+cafe and boleto+pombo behave measurably differently on the same layout',()=>{
  const a=buildRun([['chinelo',8],['cafe',8]]),b=buildRun([['boleto',8],['pombo',8]]);
  assert.deepEqual([...a.sources].sort(),['cafe','chinelo']);
  assert.deepEqual([...b.sources].sort(),['boleto','pombo']);
  assert.ok(a.motions.has('orbit')&&a.motions.has('zone')&&!a.motions.has('homing'),`A motions ${[...a.motions]}`);
  assert.ok(b.motions.has('homing')&&b.motions.has('linear')&&!b.motions.has('orbit')&&!b.motions.has('zone'),`B motions ${[...b.motions]}`);
  // Orbit sweeps the whole ring around the player; aimed shots concentrate on the line to the target.
  assert.ok(a.ringHit>=6,`chinelo+cafe hit only ${a.ringHit}/8 close enemies`);
  assert.ok(b.ringHit<a.ringHit,`boleto+pombo hit ${b.ringHit} close enemies, A ${a.ringHit}`);
  assert.ok((b.dmg.f0??0)>0,'boleto+pombo never reached the far tapped target');
  assert.notDeepEqual(a.dmg,b.dmg);
});

test('system: damage is base weapon damage (might applied by damageEnemy) and stats drive volleys',()=>{
  const ctx=makeCtx(),p=addPlayer(ctx,'p1',12,12,[['boleto',1]]);p.stats.might=3;
  addEnemy(ctx,'e',13,12);
  run(ctx,systems(),20);
  const w=R('boleto',1),h=hitsOn(ctx,'e');
  assert.ok(h.length>0);
  assert.ok(h.every(x=>x.amount===w.damage&&x.source==='p1'&&x.weapon==='boleto'));
  assert.equal(ctx.enemies.get('e')!.hp,1e6-3*w.damage*h.length);
  // Every weapon and evolution passes its base damage, whatever the might.
  // Bases and evolutions never share a build (the evolution replaces its base), so test them apart.
  const bases=WEAPON_IDS.map(id=>[id,8] as [string,number]),evos=EVOLUTION_IDS.map(id=>[id,1] as [string,number]);
  for(const all of [bases,[...evos,['guarda-chuva',8],['pombo',8],['audio',8]] as [string,number][]]){
    const cm=makeCtx(4),pm=addPlayer(cm,'p1',12,12,all);pm.stats.might=2.5;
    for(let i=0;i<10;i++)addEnemy(cm,`m${i}`,12+Math.cos(i)*(.8+i*.3),12+Math.sin(i)*(.8+i*.3));
    run(cm,systems(),120);
    const lvl=Object.fromEntries(all);
    for(const [id] of all)assert.ok(cm.hits.some(x=>x.weapon===id),`${id} never hit`);
    for(const x of cm.hits)assert.equal(x.amount,R(x.weapon!,lvl[x.weapon!]).damage,`${x.weapon} passed ${x.amount}`);
  }
  // amount stat adds projectiles to a volley; area stat widens the orbit.
  const c2=makeCtx(),p2=addPlayer(c2,'p1',12,12,[['boleto',1],['chinelo',1]]);p2.stats.amount=2;
  addEnemy(c2,'e',15,12);
  const c3=makeCtx(),p3=addPlayer(c3,'p1',12,12,[['chinelo',1]]);p3.stats.area=2;
  run(c2,systems(),1);run(c3,systems(),1);
  assert.equal(projs(c2,'boleto').length,R('boleto',1,{amount:2}).amount);
  assert.equal(projs(c2,'chinelo').length,R('chinelo',1,{amount:2}).amount);
  assert.deepEqual([fires(c2,'boleto').length,fires(c2,'chinelo').length],[1,1],'one fire event per volley');
  assert.ok(projs(c3,'chinelo')[0].orbitRadius!>projs(c2,'chinelo')[0].orbitRadius!);
});

test('system: orbiters re-anchor to the moving owner and vanish when the owner goes down',()=>{
  const ctx=makeCtx(),p=addPlayer(ctx,'p1',12,12,[['chinelo',3]]);
  run(ctx,systems(),2);
  p.x=15;p.y=13;run(ctx,systems(),1);
  const orb=projs(ctx,'chinelo');assert.ok(orb.length>0);
  for(const q of orb){assert.equal(q.motion,'orbit');assert.ok(Math.abs(Math.hypot(q.x-15,q.y-13)-q.orbitRadius!)<1e-6);}
  p.downed={sinceTick:ctx.tick,bleedOutTick:1e9,progress:0};
  run(ctx,systems(),1);
  assert.equal(projs(ctx,'chinelo').length,0);
});

// ---------- 3. Evolutions ----------
test('evolution: chinelo-evo flings linear sandals that chinelo lv8 never does',()=>{
  const seen=(id:string,level:number)=>{
    const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[[id,level]]);
    for(let k=0;k<4;k++)addEnemy(ctx,`e${k}`,12+5*Math.cos(k*1.6),12+5*Math.sin(k*1.6));
    const w=R(id,level),all=new Map<string,WeaponProjectile>();
    run(ctx,systems(),2*(w.durationTicks+w.cooldownTicks)+3,c=>{for(const q of projs(c))if(!all.has(q.id))all.set(q.id,{...q});});
    noDeadHits(ctx);
    return [...all.values()];
  };
  const base=seen('chinelo',8),evo=seen('chinelo-evo',1);
  assert.ok(base.some(q=>q.motion==='orbit'));
  assert.ok(!base.some(q=>(q.motion??'linear')==='linear'),'chinelo lv8 flung something');
  const flung=evo.filter(q=>q.motion==='linear'&&Math.hypot(q.vx,q.vy)>0);
  assert.ok(evo.some(q=>q.motion==='orbit')&&flung.length>=R('chinelo-evo',1).amount,`flung ${flung.length}`);
  assert.ok(flung.every(q=>q.source==='chinelo-evo'));
  // Flung "outward": velocity points away from the owner.
  for(const q of flung)assert.ok((q.x-12)*q.vx+(q.y-12)*q.vy>0,'flung sandal moves toward the owner');
});

test('evolution: boleto-evo returns, has infinite pierce, and hits once per pass',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['boleto-evo',1]]);
  const w=R('boleto-evo',1);
  run(ctx,systems(),1);
  const [first]=projs(ctx,'boleto-evo');
  assert.ok(first,'boleto-evo fired along facing with no enemies');
  assert.ok(first.pierce>=PIERCE_INFINITE&&first.returnTick===1+w.durationTicks,`pierce ${first.pierce} return ${first.returnTick}`);
  assert.ok(first.vx>0,'fired along facing (+x)');
  ctx.players.get('p1')!.weaponReady['boleto-evo']=1e9;
  const xs:number[]=[first.x];
  run(ctx,systems(),2*w.durationTicks,c=>{const q=c.projectiles.get(first.id);if(q)xs.push(q.x);});
  const peak=Math.max(...xs),i=xs.indexOf(peak);
  assert.ok(peak>12+.5&&i<xs.length-1,'never went out');
  assert.ok(xs[xs.length-1]<peak-.5,'never came back');
  assert.equal(ctx.projectiles.has(first.id),false,'expired after the return');

  // Projectile level: enemy on the path is hit on the way out and again on the way back, once per pass.
  const c2=makeCtx();addPlayer(c2,'p1',30,30);addEnemy(c2,'e',12,12);
  spawnProjectile(c2,shot({x:10,y:12,vx:4,pierce:PIERCE_INFINITE,returnTick:20,untilTick:45}));
  run(c2,[createProjectileSystem()],50);
  const t=hitsOn(c2,'e').map(h=>h.tick);
  assert.equal(t.length,2,`hits at ${t}`);assert.ok(t[1]-t[0]>=10);

  // Weapon level, single volley aimed at the only enemy: each projectile hits it at most twice.
  const c3=makeCtx();const p3=addPlayer(c3,'p1',12,12,[['boleto-evo',1]]);
  addEnemy(c3,'e',12+w.speed*w.durationTicks/SIM_HZ/2,12);
  run(c3,systems(),1);p3.weaponReady['boleto-evo']=1e9;
  run(c3,systems(),2*w.durationTicks+2);
  const n=hitsOn(c3,'e').length;
  assert.ok(n>=2&&n<=2*w.amount,`boleto-evo volley of ${w.amount} hit ${n} times`);
});

test('evolution: cafe-evo zone follows the owner and slows enemies',()=>{
  assert.ok((def('cafe-evo').evolved?.slowSeconds??0)>0,'cafe-evo needs slowSeconds');
  const ctx=makeCtx(),p=addPlayer(ctx,'p1',12,12,[['cafe-evo',1]]);
  const e=addEnemy(ctx,'e',12.3,12);
  run(ctx,systems(),2);
  const [z]=projs(ctx,'cafe-evo');
  assert.ok(z&&z.motion==='follow'&&z.anchor==='p1'&&z.rehit!==undefined);
  assert.ok((e.slowUntil??0)>ctx.tick,'enemy not slowed');
  p.x=16;p.y=14;run(ctx,systems(),1);
  const moved=ctx.projectiles.get(z.id)!;
  assert.ok(Math.hypot(moved.x-16,moved.y-14)<1e-6,'zone did not follow the owner');
  // Base cafe drops stationary puddles on enemies instead.
  const c2=makeCtx(),p2=addPlayer(c2,'p1',12,12,[['cafe',1]]);addEnemy(c2,'e',13,12);
  run(c2,systems(),1);
  const [puddle]=projs(c2,'cafe');
  assert.ok(puddle&&puddle.vx===0&&puddle.vy===0&&puddle.rehit!==undefined&&Math.hypot(puddle.x-13,puddle.y-12)<1e-6);
  p2.x=16;run(c2,systems(),1);
  assert.equal(c2.projectiles.get(puddle.id)!.x,13,'base puddle must stay put');
});

// ---------- 4. No double hits ----------
test('projectiles: a linear projectile hits a stationary enemy once even while overlapping for many ticks',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',30,30);addEnemy(ctx,'e',12,12);
  spawnProjectile(ctx,shot({vx:2,pierce:3}));
  run(ctx,[createProjectileSystem()],60);
  assert.equal(hitsOn(ctx,'e').length,1);
  // Tunnelling: 10 units per tick still hits via the swept segment, once.
  const c2=makeCtx();addPlayer(c2,'p1',30,30);addEnemy(c2,'e',7,12);
  spawnProjectile(c2,shot({x:2,vx:200,pierce:3,untilTick:3}));
  run(c2,[createProjectileSystem()],3);
  assert.equal(hitsOn(c2,'e').length,1);
});

test('projectiles: pierce 0 stops at the first enemy; pierce N hits N+1 enemies once each',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',30,30);addEnemy(ctx,'a',12,12);addEnemy(ctx,'b',13,12);
  spawnProjectile(ctx,shot({vx:4,pierce:0}));
  let removedAt=-1;
  run(ctx,[createProjectileSystem()],40,c=>{if(removedAt<0&&!c.projectiles.size)removedAt=c.tick;});
  assert.equal(hitsOn(ctx,'a').length,1);assert.equal(hitsOn(ctx,'b').length,0);
  assert.equal(removedAt,hitsOn(ctx,'a')[0].tick,'projectile must be removed on its first hit');
  const c2=makeCtx();addPlayer(c2,'p1',30,30);for(let i=0;i<5;i++)addEnemy(c2,`e${i}`,12+i,12);
  spawnProjectile(c2,shot({vx:4,pierce:2}));
  run(c2,[createProjectileSystem()],60);
  assert.deepEqual(['e0','e1','e2','e3','e4'].map(id=>hitsOn(c2,id).length),[1,1,1,0,0]);
  assert.equal(c2.projectiles.size,0);
});

test('projectiles: overlapping area hitboxes of one group share the per-enemy cooldown',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',30,30);addEnemy(ctx,'e',12,12);
  for(let i=0;i<3;i++)spawnProjectile(ctx,shot({x:12+i*.1,y:12,radius:1,rehit:10,group:'p1:cafe',source:'cafe',pierce:PIERCE_INFINITE,untilTick:31}));
  run(ctx,[createProjectileSystem()],32);
  const t=assertGap(ctx,'e','cafe',10);
  assert.deepEqual(t,[1,11,21]);
  // Different groups (other owner) are independent.
  const c2=makeCtx();addPlayer(c2,'p1',30,30);addPlayer(c2,'p2',30,31);addEnemy(c2,'e',12,12);
  spawnProjectile(c2,shot({x:12,y:12,radius:1,rehit:10,group:'p1:cafe',source:'cafe'}));
  spawnProjectile(c2,shot({owner:'p2',x:12,y:12,radius:1,rehit:10,group:'p2:cafe',source:'cafe'}));
  run(c2,[createProjectileSystem()],1);
  assert.equal(hitsOn(c2,'e').length,2);
  assert.equal(c2.projectiles.size,2,'area projectiles never consume pierce');
});

test('weapons: orbit and zones with amount>1 respect rehit per enemy',()=>{
  for(const id of ['chinelo','cafe','guarda-chuva']){
    const ctx=makeCtx(),p=addPlayer(ctx,'p1',12,12,[[id,8]]);p.stats.amount=3;
    const w=R(id,8,{amount:3});
    const orbitAt=id==='chinelo'?w.area:0;
    addEnemy(ctx,'e',12+orbitAt,12);
    run(ctx,systems(),w.durationTicks+w.cooldownTicks+w.durationTicks);
    const t=assertGap(ctx,'e',id,w.rehitTicks);
    assert.ok(t.length>=1,`${id} never hit`);
    noDeadHits(ctx);
  }
});

test('projectiles: a dying enemy is damaged once and killed once when two projectiles reach it together',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',30,30);addEnemy(ctx,'e',12,12,{hp:5,maxHp:5});addEnemy(ctx,'f',20,20);
  spawnProjectile(ctx,shot({x:12,y:12,damage:10}));
  spawnProjectile(ctx,shot({x:12,y:12,damage:10}));
  spawnProjectile(ctx,shot({x:12,y:12,damage:10,radius:1,rehit:5,group:'g'}));
  run(ctx,[createProjectileSystem()],3);
  assert.equal(hitsOn(ctx,'e').length,1);
  assert.deepEqual(ctx.kills,['e']);
  assert.equal(ctx.events.filter(e=>e.event.type==='kill').length,1);
  noDeadHits(ctx);
  // Same through the weapon system: many pombos/boletos at weak enemies.
  const c2=makeCtx(5),p=addPlayer(c2,'p1',12,12,[['pombo',8],['boleto',8],['audio',8],['chinelo',8]]);p.stats.amount=4;
  for(let i=0;i<20;i++)addEnemy(c2,`w${i}`,12+Math.cos(i)*(1+i*.2),12+Math.sin(i)*(1+i*.2),{hp:8,maxHp:8});
  run(c2,systems(),80);
  noDeadHits(c2);
  assert.ok(c2.kills.length>5);
});

// ---------- 5. Cap ----------
test('cap: spawnProjectile refuses at the cap and the systems never exceed it',()=>{
  assert.equal(PROJECTILE_CAP,400);
  const ctx=makeCtx();
  for(let i=0;i<3;i++)assert.ok(spawnProjectile(ctx,shot(),3));
  assert.equal(spawnProjectile(ctx,shot(),3),undefined);assert.equal(ctx.projectiles.size,3);
  const c2=makeCtx();
  for(let i=0;i<PROJECTILE_CAP;i++)spawnProjectile(c2,shot());
  assert.equal(spawnProjectile(c2,shot()),undefined);assert.equal(c2.projectiles.size,PROJECTILE_CAP);
  const c3=makeCtx(9),p=addPlayer(c3,'p1',12,12,[...WEAPON_IDS.map(id=>[id,8] as [string,number]),['chinelo-evo',1],['boleto-evo',1]]);
  p.stats.amount=10;p.stats.cooldown=.1;p.stats.duration=3;
  for(let i=0;i<30;i++)addEnemy(c3,`e${i}`,12+Math.cos(i)*(1+i*.15),12+Math.sin(i)*(1+i*.15));
  let peak=0;
  run(c3,systems(5),200,c=>{peak=Math.max(peak,c.projectiles.size);});
  assert.ok(peak<=5&&peak>0,`peak ${peak}`);
});

// ---------- 6. Target and facing ----------
test('targeting: valid tapped target wins over nearer enemies; invalid/dead/out-of-range falls back to nearest',()=>{
  for(const id of ['boleto','pombo']){
    const w=R(id,1);assert.ok(w.range>2,`${id} range ${w.range}`);
    const setup=(target:string|undefined,tapAt:number)=>{
      const ctx=makeCtx(),p=addPlayer(ctx,'p1',12,12,[[id,1]],{target});
      addEnemy(ctx,'a',13,12);addEnemy(ctx,'b',12,12+tapAt);
      run(ctx,systems(),1);
      const f=fires(ctx,id)[0]?.event as {dx:number;dy:number}|undefined;
      assert.ok(f,`${id} did not fire`);
      const len=Math.hypot(f.dx,f.dy);
      return {ctx,dir:{x:f.dx/len,y:f.dy/len}};
    };
    const tapped=setup('b',w.range*.8);
    assert.ok(tapped.dir.y>.99,`${id} ignored the tapped target`);
    if(id==='pombo')assert.ok(projs(tapped.ctx,'pombo').some(q=>q.homing==='b'));
    for(const [target,at] of [['zzz',w.range*.8],['b',w.range+1.5]] as [string,number][]){
      const r=setup(target,at);
      assert.ok(r.dir.x>.99,`${id} target=${target}@${at} should fall back to nearest`);
      if(id==='pombo')assert.ok(projs(r.ctx,'pombo').every(q=>q.homing==='a'));
    }
    // Dead tapped target (hp 0 but still in map, as within a tick) also falls back.
    const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[[id,1]],{target:'b'});
    addEnemy(ctx,'a',13,12);addEnemy(ctx,'b',12,13,{hp:0});
    run(ctx,systems(),1);
    const f=fires(ctx,id)[0].event as {dx:number;dy:number};
    assert.ok(f.dx>0&&Math.abs(f.dy)<1e-9,`${id} aimed at a dead target`);
  }
});

test('facing: boleto fires along facing with no enemies; pombo/cafe/audio hold fire without spending cooldown',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['boleto',1]],{facing:{x:0,y:-1}});
  run(ctx,systems(),1);
  const f=fires(ctx,'boleto')[0].event as {dx:number;dy:number};
  assert.ok(Math.abs(f.dx)<1e-9&&f.dy<-.99);
  assert.ok(projs(ctx,'boleto').every(q=>q.vy<0));
  for(const id of ['pombo','cafe','audio']){
    const w=R(id,1),reach=Math.max(w.range,w.area)+3;
    const c=makeCtx(),p=addPlayer(c,'p1',12,12,[[id,1]]);const e=addEnemy(c,'e',12+reach,12);
    run(c,systems(),5);
    assert.equal(fires(c,id).length,0,`${id} fired at nothing`);
    assert.equal(p.weaponReady[id]??0,0,`${id} spent cooldown while holding`);
    e.x=12.8;run(c,systems(),1);
    assert.ok(fires(c,id).length>0&&fires(c,id)[0].tick===6,`${id} did not fire as soon as a target appeared`);
  }
});

test('facing: audio cone hits enemies in front once per volley, not behind or beside; amount adds directions',()=>{
  const half=def('audio').coneHalfAngle!,row=weaponLevel(def('audio'),1);
  const setup=(amount:number)=>{
    const ctx=makeCtx(),p=addPlayer(ctx,'p1',12,12,[['audio',1]]);p.stats.amount=amount-row.amount;
    const w=R('audio',1,{amount:amount-row.amount});assert.equal(w.amount,amount);
    const d=w.area*.6;
    addEnemy(ctx,'front',12+d,12);addEnemy(ctx,'front2',12+d*Math.cos(half*.8),12+d*Math.sin(half*.8));
    addEnemy(ctx,'behind',12-d,12);addEnemy(ctx,'side',12,12+d);
    run(ctx,systems(),1);
    return ctx;
  };
  const one=setup(1);
  assert.equal(hitsOn(one,'front').length,1);assert.equal(hitsOn(one,'front2').length,1);
  assert.equal(hitsOn(one,'behind').length,0);
  if(half<Math.PI/2-.1)assert.equal(hitsOn(one,'side').length,0);
  assert.equal(fires(one,'audio').length,1);
  const two=setup(2);
  assert.equal(hitsOn(two,'front').length,1);assert.equal(hitsOn(two,'behind').length,1,'second direction points backwards');
  assert.equal(fires(two,'audio').length,2,'one fire event per direction');
});

// ---------- 7. Hostile projectiles and guarda-chuva ----------
test('hostile: projectiles hurt live players once, ignore enemies and downed players',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12);addEnemy(ctx,'e',11,12);
  spawnProjectile(ctx,shot({owner:'boss1',source:'cuspe',x:9,vx:6,damage:7,hostile:true,pierce:0,untilTick:40}));
  run(ctx,[createProjectileSystem()],40);
  assert.deepEqual(ctx.playerHits.map(h=>[h.player,h.amount,h.source]),[['p1',7,'boss1']]);
  assert.equal(ctx.hits.length,0,'hostile projectile damaged an enemy');
  assert.equal(ctx.projectiles.size,0);
  const c2=makeCtx();addPlayer(c2,'p1',12,12,[],{downed:{sinceTick:0,bleedOutTick:1e9,progress:0}});
  addPlayer(c2,'p2',13,12,[],{spectator:true});
  spawnProjectile(c2,shot({owner:'boss1',x:9,vx:6,hostile:true,pierce:5,untilTick:30}));
  run(c2,[createProjectileSystem()],30);
  assert.equal(c2.playerHits.length,0);
});

test('hostile: an active guarda-chuva deletes incoming hostile projectiles before they reach its owner',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['guarda-chuva',1]]);
  run(ctx,systems(),1);
  const [shield]=projs(ctx,'guarda-chuva');
  assert.ok(shield&&shield.blocksHostile&&shield.motion==='follow'&&shield.anchor==='p1');
  const w=R('guarda-chuva',1);
  const start=12-(shield.radius+1);
  const bullet=spawnProjectile(ctx,shot({owner:'boss1',x:start,vx:10,hostile:true,radius:.2,damage:9,untilTick:ctx.tick+60}))!;
  const arrive=Math.ceil((shield.radius+1)/(10/SIM_HZ));
  assert.ok(arrive<w.durationTicks-1,'aura should still be up when the bullet arrives');
  run(ctx,systems(),arrive+5);
  assert.equal(ctx.projectiles.has(bullet.id),false,'bullet survived the umbrella');
  assert.equal(ctx.playerHits.length,0);
  // Without the umbrella the same bullet hurts.
  const c2=makeCtx();addPlayer(c2,'p1',12,12);
  spawnProjectile(c2,shot({owner:'boss1',x:start,vx:10,hostile:true,radius:.2,damage:9,untilTick:60}));
  run(c2,systems(),arrive+5);
  assert.equal(c2.playerHits.length,1);
});

test('guarda-chuva knocks back regular enemies but not bosses',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['guarda-chuva',1]]);
  const w=R('guarda-chuva',1);assert.ok(w.knockback>0);
  const e=addEnemy(ctx,'e',12+w.area*.5,12),b=addEnemy(ctx,'b',12-w.area*.5,12,{boss:true});
  run(ctx,systems(),2);
  assert.ok(hitsOn(ctx,'e').length>0&&hitsOn(ctx,'b').length>0);
  assert.ok(e.knock&&e.knock.x>0,'enemy not pushed away from the owner');
  assert.equal(b.knock,undefined);
});

// ---------- 8. Skips, cooldowns, determinism ----------
test('skips: spectator, offline, downed, eliminated and dead players never fire',()=>{
  const ctx=makeCtx(),ws:[string,number][]=WEAPON_IDS.map(id=>[id,1]);
  addPlayer(ctx,'s',12,12,ws,{spectator:true});addPlayer(ctx,'o',12,12,ws,{online:false});
  addPlayer(ctx,'d',12,12,ws,{downed:{sinceTick:0,bleedOutTick:1e9,progress:0}});
  addPlayer(ctx,'x',12,12,ws,{eliminated:true});addPlayer(ctx,'z',12,12,ws,{hp:0});
  addEnemy(ctx,'e',12.8,12);
  run(ctx,systems(),10);
  assert.equal(ctx.events.length,0);assert.equal(ctx.projectiles.size,0);assert.equal(ctx.hits.length,0);
  for(const p of ctx.players.values())assert.deepEqual(p.weaponReady,{});
});

test('cooldown: weapons fire exactly on their ready ticks',()=>{
  const ctx=makeCtx();const p=addPlayer(ctx,'p1',12,12,[['boleto',1],['chinelo',1]]);addEnemy(ctx,'e',13,12);
  const b=R('boleto',1),c=R('chinelo',1),period=c.durationTicks+c.cooldownTicks;
  const n=Math.max(3*b.cooldownTicks,2*period)+1;
  run(ctx,systems(),n);
  const ticksOf=(id:string)=>fires(ctx,id).map(e=>e.tick);
  const expect=(step:number)=>Array.from({length:Math.floor((n-1)/step)+1},(_,i)=>1+i*step);
  assert.deepEqual(ticksOf('boleto'),expect(b.cooldownTicks));
  assert.deepEqual(ticksOf('chinelo'),expect(period));
  assert.equal(p.weaponReady.boleto,ticksOf('boleto').at(-1)!+b.cooldownTicks);
  for(const t of new Set(fires(ctx).map(e=>e.tick)))
    for(const id of ['boleto','chinelo'])assert.ok(fires(ctx,id).filter(e=>e.tick===t).length<=1,'more than one fire event per volley');
});

test('determinism: same setup gives identical projectiles, enemies, events and hits',()=>{
  const once=()=>{
    const ctx=makeCtx(11);
    addPlayer(ctx,'p1',10,12,WEAPON_IDS.map(id=>[id,4]),{target:'e3'});
    addPlayer(ctx,'p2',14,12,[['chinelo-evo',1],['boleto-evo',1],['cafe-evo',1]],{facing:{x:0,y:1}});
    for(let i=0;i<16;i++)addEnemy(ctx,`e${i}`,12+Math.cos(i*.9)*(1.5+i*.3),12+Math.sin(i*.9)*(1.5+i*.3),{hp:300,maxHp:300});
    run(ctx,systems(),150);
    noDeadHits(ctx);
    return JSON.stringify({p:[...ctx.projectiles.entries()],e:[...ctx.enemies.entries()],ev:ctx.events,h:ctx.hits,k:ctx.kills,r:[...ctx.players.values()].map(p=>p.weaponReady)});
  };
  const a=once();
  assert.equal(a,once());
  assert.ok(JSON.parse(a).k.length>0);
});

// ---------- 9. Expiry ----------
test('expiry: projectiles are removed at untilTick and weapon projectiles all expire',()=>{
  const ctx=makeCtx();
  const q=spawnProjectile(ctx,shot({untilTick:5}))!;
  run(ctx,[createProjectileSystem()],4);assert.ok(ctx.projectiles.has(q.id));
  run(ctx,[createProjectileSystem()],1);assert.equal(ctx.projectiles.has(q.id),false);
  const c2=makeCtx(),p=addPlayer(c2,'p1',12,12,[...WEAPON_IDS.map(id=>[id,8] as [string,number]),['chinelo-evo',1],['boleto-evo',1],['cafe-evo',1]]);
  addEnemy(c2,'e',13,12);
  const sys=systems();
  run(c2,sys,10);assert.ok(c2.projectiles.size>0);
  p.build.weapons=[];
  const longest=Math.max(...[...WEAPON_IDS,...EVOLUTION_IDS].map(id=>R(id,8).durationTicks*2));
  run(c2,sys,longest+SIM_HZ*2);
  assert.equal(c2.projectiles.size,0);
});

// ---------- 10. Catalog vs evolution rules (VGM-036) ----------
test('catalog agrees with evolutions.ts: max levels, recipes and weapon ids',()=>{
  assert.deepEqual([...EVO_WEAPON_IDS],[...WEAPON_IDS]);
  for(const d of weaponCatalog.all())assert.equal(d.maxLevel,itemMaxLevel(d.id),`${d.id} maxLevel`);
  assert.deepEqual(EVOLUTIONS.map(r=>r.id).sort(),[...EVOLUTION_IDS].sort());
  for(const r of EVOLUTIONS){
    const d=def(r.id);
    assert.equal(d.kind,'evolution');assert.equal(d.base,r.weapon);assert.equal(d.passive,r.passive);assert.equal(d.name,r.name);
  }
});

// ---------- 11. Review regressions ----------
test('regression: piercing homing projectile retargets after hitting its target',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',10,10);addEnemy(ctx,'A',12,10);addEnemy(ctx,'B',12,13);
  const q=spawnProjectile(ctx,shot({source:'pombo',motion:'homing',homing:'A',seek:8,turn:.25,x:10,y:10,vx:5,radius:.27,damage:12,pierce:1,untilTick:60}))!;
  const homing=new Set<string>();
  run(ctx,[createProjectileSystem()],59,c=>{const p=c.projectiles.get(q.id) as WeaponProjectile|undefined;if(p?.homing)homing.add(p.homing);});
  assert.equal(hitsOn(ctx,'A').length,1);assert.equal(hitsOn(ctx,'B').length,1);
  assert.ok(homing.has('B'),'never steered toward B');
  assert.equal(ctx.projectiles.has(q.id),false,'pierce spent on B');
});

test('regression: area cooldowns live on the enemy, so a rematch reusing ids and systems hits normally',()=>{
  const e=addEnemy(makeCtx(),'e',0,0);
  assert.equal(takeAreaHit(e,'p1:cafe',5,10),true);
  assert.equal(takeAreaHit(e,'p1:cafe',14,10),false);
  assert.equal(takeAreaHit(e,'p2:cafe',14,10),true,'other group is independent');
  assert.equal(takeAreaHit(e,'p1:cafe',15,10),true);
  assert.deepEqual(JSON.parse(JSON.stringify(e)).weaponHits,{'p1:cafe':25,'p2:cafe':24});
  // Reset like SimWorld.reset(): tick 0, maps cleared, same systems and enemy ids.
  const ctx=makeCtx(),pl=addPlayer(ctx,'p1',10,10,[['cafe-evo',1]]);addEnemy(ctx,'e-1',10.5,10);
  const sys=systems();
  run(ctx,sys,999);
  const first=ctx.hits.filter(h=>h.tick<=200).length;
  assert.ok(first>5);
  ctx.tick=0;ctx.projectiles.clear();ctx.enemies.clear();pl.weaponReady={};ctx.hits=[];
  addEnemy(ctx,'e-1',10.5,10);
  run(ctx,sys,200);
  assert.equal(ctx.hits.length,first);
});

test('regression: hostile shots resolve along their path, not by player order',()=>{
  for(const order of [['far','near'],['near','far']]){
    const ctx=makeCtx();for(const id of order)addPlayer(ctx,id,id==='far'?10.9:10.45,10);
    spawnProjectile(ctx,shot({owner:'e1',source:'spit',x:10,y:10,vx:20,radius:.1,damage:5,pierce:0,untilTick:99,hostile:true}));
    run(ctx,[createProjectileSystem()],1);
    assert.deepEqual(ctx.playerHits.map(h=>h.player),['near'],`insertion order ${order}`);
  }
  // Passes unshielded A, then ends inside B's umbrella in the same tick: A is hit, the shot dies, B untouched.
  const c2=makeCtx();addPlayer(c2,'A',10.3,10);addPlayer(c2,'B',11.6,10);
  spawnProjectile(c2,shot({owner:'B',source:'guarda-chuva',motion:'follow',anchor:'B',x:11.6,y:10,radius:.9,damage:0,pierce:PIERCE_INFINITE,rehit:12,group:'B:guarda-chuva',blocksHostile:true}));
  spawnProjectile(c2,shot({owner:'e1',source:'spit',x:10,y:10,vx:16,radius:.1,damage:5,pierce:0,untilTick:99,hostile:true}));
  run(c2,[createProjectileSystem()],1);
  assert.deepEqual(c2.playerHits.map(h=>h.player),['A']);
  assert.equal(projs(c2).filter(p=>p.hostile).length,0);
});

test('regression: evolving retires base projectiles next tick and inherits the base timer',()=>{
  const ctx=makeCtx(),p=addPlayer(ctx,'p1',10,10,[['chinelo',8]]);addEnemy(ctx,'E',12,10,{radius:.5});
  const sys=systems();run(ctx,sys,5);
  const ready=p.weaponReady.chinelo;
  assert.ok(projs(ctx,'chinelo').length>0&&ready>ctx.tick+1);
  p.build.weapons=[{id:'chinelo-evo',level:1}];
  const t0=ctx.tick;run(ctx,sys,1);
  assert.equal(projs(ctx,'chinelo').length,0,'base orbiters survived the evolution');
  assert.equal(fires(ctx,'chinelo-evo').length,0,'evolution fired on the swap tick');
  assert.equal(p.weaponReady.chinelo,undefined);assert.equal(p.weaponReady['chinelo-evo'],ready);
  run(ctx,sys,ready-ctx.tick);
  assert.deepEqual(ctx.hits.filter(h=>h.tick>t0&&h.weapon==='chinelo'),[]);
  assert.deepEqual(fires(ctx,'chinelo-evo').map(e=>e.tick),[ready]);
  // Same for cafe puddles (stationary, not anchored).
  const c2=makeCtx(),p2=addPlayer(c2,'p1',10,10,[['cafe',8]]);addEnemy(c2,'E',11,10);
  const s2=systems();run(c2,s2,3);
  const ready2=p2.weaponReady.cafe;
  assert.ok(projs(c2,'cafe').length>0);
  p2.build.weapons=[{id:'cafe-evo',level:1}];
  const t1=c2.tick;run(c2,s2,1);
  assert.equal(projs(c2,'cafe').length,0,'base puddles survived the evolution');
  assert.equal(fires(c2,'cafe-evo').length,0);assert.equal(p2.weaponReady['cafe-evo'],ready2);
  run(c2,s2,10);
  assert.deepEqual(c2.hits.filter(h=>h.tick>t1&&h.weapon==='cafe'),[]);
  // A non-weapon source (tower, skill) with rehit is never retired by evolution logic.
  const c3=makeCtx();addPlayer(c3,'p1',10,10,[['cafe-evo',1],['chinelo-evo',1]]);addEnemy(c3,'T',20,20);
  const torre=spawnProjectile(c3,shot({source:'torre',x:20,y:20,radius:1,rehit:5,group:'p1:torre',pierce:PIERCE_INFINITE,untilTick:100}))!;
  run(c3,systems(),12);
  assert.ok(c3.projectiles.has(torre.id));
  assert.equal(hitsOn(c3,'T').filter(h=>h.weapon==='torre').length,3);
});

test('regression: boomerang does not double-hit an enemy at the turnaround, but hits path enemies on both passes',()=>{
  // Projectile level: apex at x=13.8 (reverses at tick 20); T on the path, X touching at the turn.
  const ctx=makeCtx();addPlayer(ctx,'p1',30,30);addEnemy(ctx,'T',12,12);addEnemy(ctx,'X',13.8,12);
  spawnProjectile(ctx,shot({x:10,y:12,vx:4,pierce:PIERCE_INFINITE,returnTick:20,untilTick:45}));
  run(ctx,[createProjectileSystem()],45);
  assert.equal(hitsOn(ctx,'T').length,2);
  assert.equal(hitsOn(ctx,'X').length,1,`X hit at ${hitsOn(ctx,'X').map(h=>h.tick)}`);
  // Weapon level: enemy at the apex of a real boleto-evo volley.
  const w=R('boleto-evo',1),leg=w.speed*w.durationTicks/SIM_HZ;
  const c2=makeCtx(),p=addPlayer(c2,'p1',2,10,[['boleto-evo',1]]);addEnemy(c2,'T',8,10);addEnemy(c2,'X',2+leg,10);
  const s2=systems();run(c2,s2,1);p.weaponReady['boleto-evo']=1e9;
  run(c2,s2,2*w.durationTicks+2);
  const t=hitsOn(c2,'X').map(h=>h.tick);
  for(let i=1;i<t.length;i++)assert.ok(t[i]-t[i-1]>2,`X hit at ${t}`);
  assert.ok(hitsOn(c2,'T').length>=2,'path enemy should be hit on both passes');
});

test('regression: chinelo-evo spawns all orbiters before flings when near the cap',()=>{
  const w=R('chinelo-evo',1),cap=w.amount+2;
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['chinelo-evo',1]]);
  run(ctx,systems(cap),1);
  const all=projs(ctx,'chinelo-evo');
  assert.equal(all.filter(q=>q.motion==='orbit').length,w.amount);
  assert.equal(all.filter(q=>q.motion==='linear').length,2);
  assert.equal(ctx.projectiles.size,cap);
});

// ---------- BUG-20261009-N5-chinelo-buraco-orbita: the starting weapons answer a hug ----------
test('orbit: a chinelo hits an enemy hugging a player who stands still (inside the ring), and still skips the far one',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['chinelo',1]]);
  const w=R('chinelo',1);
  // Gosma contact distance: enemy radius .32 + player radius .22 + .05.
  addEnemy(ctx,'hug',12+.59,12,{radius:.32});
  addEnemy(ctx,'far',12,12+w.area+1.5,{radius:.32});
  run(ctx,systems(),Math.round(2.5*SIM_HZ));
  assert.ok(hitsOn(ctx,'hug').length>=1,'the hugging enemy is never hit');
  assert.equal(hitsOn(ctx,'far').length,0,'the spoke must not reach past the ring');
  assertGap(ctx,'hug','chinelo',w.rehitTicks);
  noDeadHits(ctx);
});

test('cone: with nobody in the facing cone, the audio wave turns to the nearest enemy in reach (a hug from behind)',()=>{
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['audio',1]],{facing:{x:1,y:0}});
  const w=R('audio',1);
  addEnemy(ctx,'behind',12-w.area*.5,12);addEnemy(ctx,'further',12,12-w.area*.9);
  run(ctx,systems(),1);
  assert.equal(hitsOn(ctx,'behind').length,1,'the enemy behind is answered');
  assert.equal(hitsOn(ctx,'further').length,0,'only the cone toward the nearest one fires');
  const f=fires(ctx,'audio')[0].event as {dx:number;dy:number};
  assert.ok(f.dx<-.99,'the wave points at the nearest enemy');
});

/** Hits per second on one still enemy at `dist` from a still chinelo owner (its own context, so no crowding). */
function orbitRate(weapon:string,dist:number,seconds=20){
  const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[[weapon,weapon==='chinelo'?1:1]]);
  addEnemy(ctx,'e',12+dist,12,{radius:.32});
  run(ctx,systems(),Math.round(seconds*SIM_HZ));
  return hitsOn(ctx,'e').filter(h=>h.weapon===weapon).length/seconds;
}
test('orbit: hugging the owner is no safer and no deadlier than standing on the ring (L1 and evolution)',t=>{
  const rates=['chinelo','chinelo-evo'].map(id=>({id,hug:orbitRate(id,.59),ring:orbitRate(id,R(id,1).area)}));
  for(const r of rates)t.diagnostic(`${r.id}: hugging ${r.hug.toFixed(2)} hits/s, on the ring ${r.ring.toFixed(2)} hits/s`);
  for(const {id,hug,ring} of rates){
    assert.ok(hug>0,`${id}: the hug is never answered`);
    assert.ok(hug<=ring*1.25&&hug>=ring*.6,`${id}: hug ${hug.toFixed(2)} vs ring ${ring.toFixed(2)} hits/s`);
  }
});
test('orbit: every chinelo hit pushes the enemy away from the owner, also from inside the ring',()=>{
  for(const [x,y] of [[.59,0],[0,-.59],[-.4,.4]] as const){
    const ctx=makeCtx();addPlayer(ctx,'p1',12,12,[['chinelo',1]]);
    const e=addEnemy(ctx,'e',12+x,12+y,{radius:.32});
    let knock:{x:number;y:number}|undefined;
    run(ctx,systems(),Math.round(3*SIM_HZ),()=>{if(e.knock&&!knock)knock={...e.knock};});
    assert.ok(knock,'never pushed');
    assert.ok(knock.x*x+knock.y*y>0,`pushed toward the hero from (${x},${y}): ${JSON.stringify(knock)}`);
  }
});
test('cone: a tapped target in reach but outside the facing cone is the one the turned wave hits',()=>{
  const ctx=makeCtx();const w=R('audio',1);
  addPlayer(ctx,'p1',12,12,[['audio',1]],{facing:{x:1,y:0},target:'tapped'});
  addEnemy(ctx,'near',12-w.area*.3,12);addEnemy(ctx,'tapped',12,12+w.area*.8);
  run(ctx,systems(),1);
  assert.equal(hitsOn(ctx,'tapped').length,1,'the tapped target is ignored');
  assert.equal(hitsOn(ctx,'near').length,0,'the wave went to the nearest instead of the tap');
  const f=fires(ctx,'audio')[0].event as {dx:number;dy:number};
  assert.ok(f.dy>.99,'the wave points at the tapped target');
});
