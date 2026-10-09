import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,ticks,type OwnedItem,type PickupState,type PlayerBuild,type PlayerStats,type SimContext,type SimEvent,type SimPlayer} from '../src/game/sim/types.ts';
import {PASSIVES,PASSIVE_IDS,PASSIVE_MAX_LEVEL,passiveDef} from '../src/game/sim/passives.ts';
import {STAT_KEYS,STAT_LIMITS,computeStats,refreshStats,type ClassBonus,type StatKey} from '../src/game/sim/stats.ts';
import {CHEST_HEAL_LIFETIME_SECONDS,CHEST_HEAL_VALUE,EVOLUTIONS,EVOLUTION_MIN_TICKS,WEAPON_IDS,WEAPON_MAX_LEVEL,eligibleEvolutions,itemMaxLevel,openChest} from '../src/game/sim/evolutions.ts';
import {WEAPON_CATALOG,WEAPON_IDS as CATALOG_WEAPON_IDS} from '../src/game/sim/weapons/catalog.ts';
import {MAX_PICKUPS} from '../src/game/sim/budget.ts';

// ---------- Fakes ----------
interface FakeCtx {tick:number;rng:Rng;players:Map<string,SimPlayer>;pickups:Map<string,PickupState>;enemies:Map<string,unknown>;
  projectiles:Map<string,unknown>;telegraphs:Map<string,unknown>;team:{xp:number;level:number;nextXp:number};offers:Map<string,unknown>;
  round:{index:number;total:number;phase:'wave';phaseEndsTick:number;remaining:number};events:SimEvent[];nextId(prefix:string):string;emit(e:SimEvent):void}
const makeCtx=(seed=1,tick=0)=>{
  let counter=0;const events:SimEvent[]=[];
  const fake:FakeCtx={tick,rng:new Rng(seed),players:new Map(),pickups:new Map(),enemies:new Map(),projectiles:new Map(),telegraphs:new Map(),
    team:{xp:0,level:1,nextXp:10},offers:new Map(),round:{index:0,total:5,phase:'wave',phaseEndsTick:0,remaining:0},events,
    nextId:prefix=>`${prefix}${++counter}`,emit:e=>{events.push(e);}};
  return {fake,ctx:fake as unknown as SimContext,events};
};
const makePlayer=(id:string,build:PlayerBuild,extra:Partial<SimPlayer>={}):SimPlayer=>({
  id,classId:'test',x:10,y:10,hp:100,online:true,spectator:false,facing:{x:1,y:0},build,stats:computeStats(build),weaponReady:{},...extra});
const addChest=(fake:FakeCtx,id='chest1',x=5,y=7)=>{fake.pickups.set(id,{id,kind:'chest',value:1,x,y,spawnTick:0});return id;};
const LATE=EVOLUTION_MIN_TICKS;
const OPEN={runStartTick:0};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
/** Every weapon at max, every evolution recipe ready. */
const allEligible=():PlayerBuild=>({weapons:[{id:'chinelo',level:8},{id:'boleto',level:8},{id:'cafe',level:8}],
  passives:[{id:'tenis',level:5},{id:'cartao',level:5},{id:'cafe-forte',level:5}]});
const maxedBuild=():PlayerBuild=>({weapons:WEAPON_IDS.map(id=>({id,level:WEAPON_MAX_LEVEL})),
  passives:['marmita','megafone','bone','ima','oculos'].map(id=>({id,level:PASSIVE_MAX_LEVEL}))});
const inLimits=(s:PlayerStats)=>{for(const k of STAT_KEYS){const [min,max]=STAT_LIMITS[k];assert.ok(Number.isFinite(s[k])&&s[k]>=min&&s[k]<=max,`${k}=${s[k]}`);}};

// ---------- 1. Passives ----------
test('passives: exactly the 8 fixed ids with pt-BR metadata and 5 distinct descriptions',()=>{
  assert.deepEqual([...PASSIVE_IDS],['cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao']);
  assert.deepEqual(Object.keys(PASSIVES).sort(),[...PASSIVE_IDS].sort());
  for(const id of PASSIVE_IDS){
    const p=PASSIVES[id];
    assert.equal(p.id,id);assert.equal(p.kind,'passive');assert.equal(p.maxLevel,5);assert.equal(PASSIVE_MAX_LEVEL,5);
    assert.ok(p.name.trim().length>0&&p.icon.trim().length>0);
    const texts=[1,2,3,4,5].map(l=>p.describe(l));
    assert.ok(texts.every(t=>typeof t==='string'&&t.trim().length>0),id);
    assert.equal(new Set(texts).size,5,id);
    const keys=Object.keys(p.perLevel);
    assert.ok(keys.length>0);
    for(const k of keys){assert.ok((STAT_KEYS as string[]).includes(k),`${id}.${k}`);assert.ok(Number.isFinite(p.perLevel[k as StatKey]));}
    assert.equal(passiveDef(id),p);
  }
  assert.equal(passiveDef('nope'),undefined);
});

// ---------- 2. computeStats ----------
test('computeStats: empty build equals BASE_STATS and each passive at 5 adds perLevel*5',()=>{
  assert.deepEqual(computeStats({weapons:[],passives:[]}),{...BASE_STATS});
  for(const id of PASSIVE_IDS){
    const s=computeStats({weapons:[],passives:[{id,level:5}]});
    for(const k of STAT_KEYS){
      const delta=PASSIVES[id].perLevel[k]??0;
      assert.ok(Math.abs(s[k]-(BASE_STATS[k]+delta*5))<1e-9,`${id}.${k}: ${s[k]}`);
    }
  }
  const one=computeStats({weapons:[],passives:[{id:'oculos',level:3}]});
  assert.ok(Math.abs(one.might-1.3)<1e-9);
});
test('computeStats: class bonus is additive and stacking clamps to STAT_LIMITS',()=>{
  const s=computeStats({weapons:[],passives:[{id:'marmita',level:2}]},{might:0.1,maxHp:-10});
  assert.equal(s.maxHp,130);assert.ok(Math.abs(s.might-1.1)<1e-9);
  assert.equal(computeStats({weapons:[],passives:[{id:'cafe-forte',level:5}]},{cooldown:-0.5}).cooldown,0.4);
  assert.equal(computeStats({weapons:[],passives:[{id:'megafone',level:5}]},{area:5}).area,2.5);
  assert.equal(computeStats({weapons:[],passives:[]},{maxHp:-1000}).maxHp,1);
  assert.equal(computeStats({weapons:[],passives:[]},{amount:99}).amount,6);
});
test('computeStats: fuzzed builds and bonuses stay within limits, amount integer',()=>{
  const r=new Rng(1234);
  for(let i=0;i<500;i++){
    const passives:OwnedItem[]=[];
    const n=r.int(0,10);
    for(let j=0;j<n;j++)passives.push({id:r.chance(0.9)?r.pick(PASSIVE_IDS):'fake',level:r.pick([r.int(-5,12),NaN,Infinity,-Infinity,r.range(0,7)])});
    const bonus:ClassBonus={};
    for(const k of STAT_KEYS)if(r.chance(0.5))bonus[k]=r.chance(0.1)?r.pick([NaN,Infinity,-Infinity]):r.range(-20,20);
    const s=computeStats({weapons:[],passives},bonus);
    inLimits(s);assert.ok(Number.isInteger(s.amount));
  }
});
test('computeStats: duplicates, overlevels, bad levels and unknown ids do not stack',()=>{
  const max=computeStats({weapons:[],passives:[{id:'tenis',level:5}]});
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'tenis',level:5},{id:'tenis',level:5},{id:'tenis',level:3}]}),max);
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'tenis',level:50}]}),max);
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'tenis',level:-3}]}),{...BASE_STATS});
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'tenis',level:NaN}]}),{...BASE_STATS});
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'tenis',level:Infinity}]}),{...BASE_STATS});
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'turbo',level:5},{id:'chinelo',level:8}]}),{...BASE_STATS});
  assert.deepEqual(computeStats({weapons:[],passives:[{id:'tenis',level:-3},{id:'tenis',level:2}]}).moveSpeed,1.2);
});
test('computeStats: amount integer, non-finite bonus ignored, deterministic, BASE_STATS untouched',()=>{
  assert.equal(computeStats({weapons:[],passives:[]},{amount:1.7}).amount,1);
  assert.equal(computeStats({weapons:[],passives:[]},{amount:-0.5}).amount,0);
  assert.deepEqual(computeStats({weapons:[],passives:[]},{might:NaN,area:Infinity,cooldown:-Infinity}),{...BASE_STATS});
  const before={...BASE_STATS};
  const build:PlayerBuild={weapons:[],passives:[{id:'ima',level:4},{id:'cartao',level:2}]};
  const a=computeStats(build,{luck:0.3}),b=computeStats(build,{luck:0.3});
  assert.deepEqual(a,b);assert.notEqual(a,b);
  a.might=99;
  assert.deepEqual({...BASE_STATS},before);
  assert.ok(Object.isFrozen(BASE_STATS));
});

// ---------- 3. refreshStats ----------
test('refreshStats: max HP gain heals standing players only, loss caps hp',()=>{
  const p=makePlayer('p1',{weapons:[],passives:[]},{hp:60});
  p.build.passives.push({id:'marmita',level:1});
  refreshStats(p,undefined);
  assert.equal(p.stats.maxHp,120);assert.equal(p.hp,80);

  const d=makePlayer('p2',{weapons:[],passives:[]},{hp:30,downed:{sinceTick:0,bleedOutTick:100,progress:0}});
  d.build.passives.push({id:'marmita',level:2});
  refreshStats(d,undefined);
  assert.equal(d.stats.maxHp,140);assert.equal(d.hp,30);

  const e=makePlayer('p3',{weapons:[],passives:[]},{hp:0,eliminated:true});
  e.build.passives.push({id:'marmita',level:1});
  refreshStats(e,undefined);assert.equal(e.hp,0);

  const l=makePlayer('p4',{weapons:[],passives:[{id:'marmita',level:5}]},{hp:200});
  assert.equal(l.stats.maxHp,200);
  l.build.passives=[];
  refreshStats(l,undefined);
  assert.equal(l.stats.maxHp,100);assert.equal(l.hp,100);

  const c=makePlayer('p5',{weapons:[],passives:[]},{hp:50});
  refreshStats(c,{maxHp:-30});
  assert.equal(c.stats.maxHp,70);assert.equal(c.hp,50);
});

// ---------- 4. eligibleEvolutions ----------
test('eligibleEvolutions: needs base weapon 8 and the matching passive',()=>{
  const ids=(b:PlayerBuild)=>eligibleEvolutions(b).map(r=>r.id);
  assert.equal(EVOLUTIONS.length,3);
  assert.deepEqual(ids({weapons:[{id:'chinelo',level:7}],passives:[{id:'tenis',level:5}]}),[]);
  assert.deepEqual(ids({weapons:[{id:'chinelo',level:8}],passives:[]}),[]);
  assert.deepEqual(ids({weapons:[{id:'chinelo',level:8}],passives:[{id:'cartao',level:5},{id:'cafe-forte',level:5}]}),[]);
  assert.deepEqual(ids({weapons:[{id:'chinelo',level:8}],passives:[{id:'tenis',level:1}]}),['chinelo-evo']);
  assert.deepEqual(ids({weapons:[{id:'boleto',level:8}],passives:[{id:'cartao',level:1}]}),['boleto-evo']);
  assert.deepEqual(ids({weapons:[{id:'cafe',level:8}],passives:[{id:'cafe-forte',level:1}]}),['cafe-evo']);
  assert.deepEqual(ids(allEligible()).sort(),['boleto-evo','cafe-evo','chinelo-evo']);
  assert.deepEqual(ids({weapons:[{id:'chinelo-evo',level:1},{id:'boleto',level:8}],passives:[{id:'tenis',level:5},{id:'cartao',level:2}]}),['boleto-evo']);
  assert.deepEqual(ids({weapons:[{id:'chinelo',level:8},{id:'chinelo-evo',level:1}],passives:[{id:'tenis',level:5}]}),[]);
  assert.deepEqual(ids({weapons:[{id:'chinelo',level:8}],passives:[{id:'tenis',level:0}]}),[]);
  for(const r of EVOLUTIONS){assert.equal(itemMaxLevel(r.id),1);assert.equal(itemMaxLevel(r.weapon),8);assert.equal(itemMaxLevel(r.passive),5);}
});

// ---------- 5. openChest ----------
test('openChest: before 2:00 of combat never evolves, even if eligible',()=>{
  assert.equal(EVOLUTION_MIN_TICKS,ticks(120));
  for(let seed=1;seed<=30;seed++){
    const {fake,ctx,events}=makeCtx(seed,1000+LATE-1);
    const build=allEligible();build.weapons.push({id:'pombo',level:3});
    const p=makePlayer('p1',build);
    const res=openChest(ctx,p,addChest(fake),{runStartTick:1000});
    assert.ok(res&&res.kind==='upgrade');
    assert.ok(!events.some(e=>e.type==='evolve'));
    assert.ok(!p.build.weapons.some(w=>w.id.endsWith('-evo')));
  }
  // Same tick but the run started at 0: gate passed.
  const {fake,ctx}=makeCtx(1,1000+LATE-1);
  const res=openChest(ctx,makePlayer('p1',allEligible()),addChest(fake),OPEN);
  assert.equal(res?.kind,'evolve');
});
test('openChest: after 2:00 evolves exactly one recipe in place',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=40;seed++){
    const {fake,ctx,events}=makeCtx(seed,LATE);
    const build=allEligible();build.weapons.push({id:'pombo',level:3});
    const p=makePlayer('p1',build,{weaponReady:{chinelo:5,boleto:6,cafe:7,pombo:8}});
    const passivesBefore=clone(build.passives);
    const id=addChest(fake);
    const res=openChest(ctx,p,id,OPEN);
    assert.ok(res&&res.kind==='evolve');
    const recipe=EVOLUTIONS.find(r=>r.id===res.to)!;
    assert.equal(res.from,recipe.weapon);
    seen.add(res.to);
    const slot=allEligible().weapons.findIndex(w=>w.id===recipe.weapon);
    assert.deepEqual(p.build.weapons[slot],{id:recipe.id,level:1});
    assert.equal(p.build.weapons.length,4);
    assert.equal(p.build.weapons.filter(w=>w.id.endsWith('-evo')).length,1);
    assert.ok(!p.build.weapons.some(w=>w.id===recipe.weapon));
    assert.deepEqual(p.build.passives,passivesBefore);
    assert.ok(!(recipe.weapon in p.weaponReady));
    // The evolution gets its own entry (never fires on the evolving tick); the other weapons keep theirs.
    assert.equal(p.weaponReady[recipe.id],LATE+1);
    assert.equal(Object.keys(p.weaponReady).length,4);
    assert.deepEqual(events.filter(e=>e.type==='evolve'),[{type:'evolve',player:'p1',from:recipe.weapon,to:recipe.id}]);
    assert.equal(events.length,1);
    assert.ok(!fake.pickups.has(id));
    assert.equal(eligibleEvolutions(p.build).length,2);
  }
  assert.ok(seen.size>1,'different seeds should reach different recipes');
});
test('openChest: repeated and simultaneous opens apply one reward',()=>{
  const {fake,ctx,events}=makeCtx(3,LATE);
  const a=makePlayer('a',allEligible()),b=makePlayer('b',allEligible());
  fake.players.set('a',a);fake.players.set('b',b);
  const id=addChest(fake);
  assert.ok(openChest(ctx,a,id,OPEN));
  const snapA=clone(a),snapB=clone(b),n=events.length;
  assert.equal(openChest(ctx,a,id,OPEN),null);
  assert.equal(openChest(ctx,b,id,OPEN),null);
  assert.deepEqual(clone(a),snapA);assert.deepEqual(clone(b),snapB);
  assert.equal(events.length,n);assert.equal(fake.pickups.size,0);
});
test('openChest: invalid ids and players that cannot open return null without consuming',()=>{
  const {fake,ctx,events}=makeCtx(5,LATE);
  fake.pickups.set('xp1',{id:'xp1',kind:'xp',value:3,x:1,y:1,spawnTick:0});
  const ok=makePlayer('ok',allEligible());
  assert.equal(openChest(ctx,ok,'xp1',OPEN),null);assert.ok(fake.pickups.has('xp1'));
  assert.equal(openChest(ctx,ok,'missing',OPEN),null);
  const id=addChest(fake);
  const blocked:SimPlayer[]=[
    makePlayer('d',allEligible(),{downed:{sinceTick:0,bleedOutTick:99,progress:0}}),
    makePlayer('e',allEligible(),{eliminated:true}),
    makePlayer('s',allEligible(),{spectator:true}),
    makePlayer('z',allEligible(),{hp:0}),
    makePlayer('o',allEligible(),{online:false}),
  ];
  for(const p of blocked){
    const snap=clone(p);
    assert.equal(openChest(ctx,p,id,OPEN),null,p.id);
    assert.deepEqual(clone(p),snap);assert.ok(fake.pickups.has(id));
  }
  assert.equal(events.length,0);
  assert.ok(openChest(ctx,ok,id,OPEN));assert.ok(!fake.pickups.has(id));
});
test('openChest: without evolution it upgrades items within max levels',()=>{
  for(let seed=1;seed<=200;seed++){
    const {fake,ctx,events}=makeCtx(seed,LATE);
    const build:PlayerBuild={weapons:[{id:'chinelo',level:7},{id:'pombo',level:8},{id:'cafe-evo',level:1},{id:'mystery',level:1}],
      passives:[{id:'bone',level:4},{id:'tenis',level:5},{id:'ima',level:5}]};
    const p=makePlayer('p1',build,{stats:computeStats(build,{luck:2})});
    const before=clone(build);
    const res=openChest(ctx,p,addChest(fake),OPEN);
    assert.ok(res&&res.kind==='upgrade');
    assert.ok(res.items.length>=1&&res.items.length<=2);
    for(const item of [...p.build.weapons,...p.build.passives]){
      const max=item.id==='mystery'?1:itemMaxLevel(item.id);
      assert.ok(item.level<=max,`${item.id}:${item.level}`);
    }
    assert.deepEqual(p.build.weapons.find(w=>w.id==='mystery'),{id:'mystery',level:1});
    assert.deepEqual(p.build.weapons.find(w=>w.id==='cafe-evo'),{id:'cafe-evo',level:1});
    const ups=events.filter(e=>e.type==='upgrade');
    assert.equal(ups.length,res.items.length);
    assert.deepEqual(ups.map(e=>e.type==='upgrade'?{id:e.item,level:e.level}:null),res.items);
    assert.ok(!events.some(e=>e.type==='evolve'));
    const gained=[...p.build.weapons,...p.build.passives].reduce((n,i)=>n+i.level,0)-[...before.weapons,...before.passives].reduce((n,i)=>n+i.level,0);
    assert.equal(gained,res.items.length);
  }
});
test('openChest: luck can give 3 upgrades and a passive level recomputes stats',()=>{
  let triple=false;
  for(let seed=1;seed<=300;seed++){
    const {fake,ctx}=makeCtx(seed,0);
    const build:PlayerBuild={weapons:[{id:'chinelo',level:1}],passives:[{id:'bone',level:1}]};
    const p=makePlayer('p1',build,{stats:computeStats(build,{luck:5}),classBonus:{luck:5}});
    const res=openChest(ctx,p,addChest(fake),OPEN);
    assert.ok(res&&res.kind==='upgrade');
    if(res.items.length===3)triple=true;
    assert.ok(res.items.length===1||res.items.length===3);
  }
  assert.ok(triple,'some seed should roll the luck triple');

  const {fake,ctx,events}=makeCtx(9,LATE);
  const build:PlayerBuild={weapons:[{id:'chinelo',level:8}],passives:[{id:'marmita',level:4}]};
  const p=makePlayer('p1',build,{hp:100,classBonus:{maxHp:10}});
  assert.equal(p.stats.maxHp,180);
  const res=openChest(ctx,p,addChest(fake),OPEN);
  assert.deepEqual(res,{kind:'upgrade',items:[{id:'marmita',level:5}]});
  assert.equal(p.stats.maxHp,210);
  assert.equal(p.hp,130);
  assert.deepEqual(events,[{type:'upgrade',player:'p1',item:'marmita',level:5}]);
});
test('openChest: fully maxed build drops a heal pickup at the chest position',()=>{
  const {fake,ctx,events}=makeCtx(4,LATE);
  const p=makePlayer('p1',maxedBuild());
  const before=clone(p);
  const id=addChest(fake,'chestX',12.5,3.25);
  const res=openChest(ctx,p,id,OPEN);
  assert.ok(res&&res.kind==='heal');
  assert.ok(!fake.pickups.has(id));
  assert.ok(res.pickup!==null,'budget has room: the coxinha is dropped');
  const heal=fake.pickups.get(res.pickup);
  assert.ok(heal);
  assert.equal(heal.kind,'heal');assert.equal(heal.value,CHEST_HEAL_VALUE);assert.equal(CHEST_HEAL_VALUE,30);
  assert.equal(heal.x,12.5);assert.equal(heal.y,3.25);assert.equal(heal.spawnTick,LATE);
  assert.equal(heal.expiresTick,LATE+ticks(CHEST_HEAL_LIFETIME_SECONDS),'the coxinha expires like regular drops');
  assert.deepEqual(clone(p),before);
  assert.ok(!events.some(e=>e.type==='upgrade'||e.type==='evolve'));
  // Evolved build with nothing else to level also heals.
  const {fake:f2,ctx:c2}=makeCtx(4,LATE);
  const evo:PlayerBuild={weapons:[{id:'chinelo-evo',level:1}],passives:[{id:'tenis',level:5}]};
  assert.equal(openChest(c2,makePlayer('p2',evo),addChest(f2),OPEN)?.kind,'heal');
});
test('openChest: same seed and chest id give the same result',()=>{
  const run=(seed:number,chestId:string,tick:number,build:()=>PlayerBuild)=>{
    const {fake,ctx,events}=makeCtx(seed,tick);
    const p=makePlayer('p1',build());
    const res=openChest(ctx,p,addChest(fake,chestId),OPEN);
    return clone({res,build:p.build,stats:p.stats,hp:p.hp,events,pickups:[...fake.pickups.values()]});
  };
  const mixed=():PlayerBuild=>({weapons:[{id:'chinelo',level:3},{id:'boleto',level:5},{id:'audio',level:1}],passives:[{id:'marmita',level:2},{id:'bone',level:3}]});
  for(let seed=1;seed<=20;seed++){
    assert.deepEqual(run(seed,'c7',LATE,mixed),run(seed,'c7',LATE,mixed));
    assert.deepEqual(run(seed,'c7',LATE,allEligible),run(seed,'c7',LATE,allEligible));
  }
  const evos=new Set(Array.from({length:20},(_,i)=>JSON.stringify(run(77,`chest${i}`,LATE,allEligible).res)));
  assert.ok(evos.size>1,'different chest ids use different streams');
});

test('openChest: duplicated build entries evolve the max copy and never soak upgrades',()=>{
  for(let seed=1;seed<=20;seed++){
    const {fake,ctx}=makeCtx(seed,LATE);
    const p=makePlayer('p1',{weapons:[{id:'pombo',level:2},{id:'chinelo',level:3},{id:'chinelo',level:8}],passives:[{id:'tenis',level:1}]});
    const res=openChest(ctx,p,addChest(fake),OPEN);
    assert.deepEqual(res,{kind:'evolve',from:'chinelo',to:'chinelo-evo'});
    assert.deepEqual(p.build.weapons,[{id:'pombo',level:2},{id:'chinelo-evo',level:1}]);
  }
  for(let seed=1;seed<=50;seed++){
    const {fake,ctx}=makeCtx(seed,0);
    const p=makePlayer('p1',{weapons:[],passives:[{id:'tenis',level:1},{id:'tenis',level:2}]});
    const res=openChest(ctx,p,addChest(fake),OPEN);
    assert.ok(res&&res.kind==='upgrade');
    assert.equal(p.build.passives[0].level,1,'stale duplicate must not be upgraded');
    assert.equal(p.build.passives[1].level,2+res.items.length);
  }
});
test('openChest: passive upgrade keeps the class kit bonus',()=>{
  const bonus:ClassBonus={maxHp:50,might:0.2};
  const {fake,ctx}=makeCtx(2,0);
  const build:PlayerBuild={weapons:[],passives:[{id:'oculos',level:1}]};
  const p=makePlayer('p1',build,{stats:computeStats(build,bonus),hp:150,classBonus:bonus});
  const res=openChest(ctx,p,addChest(fake),OPEN);
  assert.deepEqual(res,{kind:'upgrade',items:[{id:'oculos',level:2}]});
  assert.equal(p.stats.maxHp,150);
  assert.ok(Math.abs(p.stats.might-1.4)<1e-9);
  assert.equal(p.hp,150);
});

// ---------- 6. Hardening (BUG-20261006-ORQ-evolutions-hardening, D-005/D-006) ----------
test('catalog cross-check: weapon ids, max levels and recipes come from the VGM-035 catalog',()=>{
  assert.deepEqual([...WEAPON_IDS],[...CATALOG_WEAPON_IDS]);
  for(const def of WEAPON_CATALOG.values())assert.equal(itemMaxLevel(def.id),def.maxLevel,def.id);
  for(const id of WEAPON_IDS)assert.equal(WEAPON_CATALOG.get(id)?.kind,'weapon',id);
  const evolutions=[...WEAPON_CATALOG.values()].filter(def=>def.kind==='evolution');
  assert.ok(evolutions.length>0);
  assert.equal(EVOLUTIONS.length,evolutions.length);
  for(const def of evolutions){
    const recipe=EVOLUTIONS.find(r=>r.id===def.id);
    assert.ok(recipe,`${def.id} missing from EVOLUTIONS`);
    assert.equal(recipe.weapon,def.base);assert.equal(recipe.passive,def.passive);assert.equal(recipe.name,def.name);
    assert.equal(WEAPON_CATALOG.get(recipe.weapon)?.kind,'weapon',`${def.id} base must be a catalog weapon`);
    assert.equal(itemMaxLevel(recipe.passive),PASSIVE_MAX_LEVEL);
  }
  assert.ok(Object.isFrozen(EVOLUTIONS)&&EVOLUTIONS.every(r=>Object.isFrozen(r)));
  for(const id of ['','nope','mystery','chinelo-evo-evo','Chinelo','toString','__proto__','constructor'])assert.equal(itemMaxLevel(id),0,id);
});

test('openChest: full pickup budget heals directly, returns pickup:null and adds no pickup',()=>{
  const fill=(fake:FakeCtx,others:number)=>{for(let i=0;i<others;i++)fake.pickups.set(`xp${i}`,{id:`xp${i}`,kind:'xp',value:1,x:0,y:0,spawnTick:0});};
  for(const [hp,expected] of [[100,130],[190,200]] as const){
    const {fake,ctx,events}=makeCtx(4,LATE);
    const p=makePlayer('p1',maxedBuild(),{hp});
    assert.equal(p.stats.maxHp,200);
    const before=clone(p.build);
    const id=addChest(fake);
    fill(fake,MAX_PICKUPS);
    const res=openChest(ctx,p,id,OPEN);
    assert.deepEqual(res,{kind:'heal',pickup:null});
    assert.equal(p.hp,expected,'healed by CHEST_HEAL_VALUE, capped at maxHp');
    assert.ok(!fake.pickups.has(id));
    assert.equal(fake.pickups.size,MAX_PICKUPS,'chest removed, nothing added');
    assert.ok(![...fake.pickups.values()].some(pk=>pk.kind==='heal'));
    assert.deepEqual(p.build,before);
    assert.equal(events.length,0);
  }
  // The chest's own slot is freed first: at exactly MAX_PICKUPS (chest included) the coxinha still drops.
  const {fake,ctx}=makeCtx(4,LATE);
  const p=makePlayer('p1',maxedBuild(),{hp:100});
  const id=addChest(fake);
  fill(fake,MAX_PICKUPS-1);
  const res=openChest(ctx,p,id,OPEN);
  assert.ok(res&&res.kind==='heal'&&res.pickup!==null);
  assert.equal(fake.pickups.get(res.pickup)?.kind,'heal');
  assert.equal(fake.pickups.size,MAX_PICKUPS);
  assert.equal(p.hp,100,'heal is deferred to collection');
});

test('openChest: evolving keeps the same build.weapons array and a cooldown later than the current tick',()=>{
  const {fake,ctx}=makeCtx(1,LATE);
  const weapons:OwnedItem[]=[{id:'pombo',level:2},{id:'chinelo',level:8},{id:'chinelo',level:3}];
  const p=makePlayer('p1',{weapons,passives:[{id:'tenis',level:1}]},{weaponReady:{chinelo:LATE+50,pombo:LATE+3}});
  assert.deepEqual(openChest(ctx,p,addChest(fake),OPEN),{kind:'evolve',from:'chinelo',to:'chinelo-evo'});
  assert.equal(p.build.weapons,weapons,'same array reference after evolving');
  assert.deepEqual(weapons,[{id:'pombo',level:2},{id:'chinelo-evo',level:1}]);
  assert.deepEqual(p.weaponReady,{pombo:LATE+3,'chinelo-evo':LATE+50},'inherits the later base cooldown');

  for(const base of [undefined,0,LATE-10,LATE,LATE+1,LATE+2]){
    const {fake:f,ctx:c}=makeCtx(1,LATE);
    const p2=makePlayer('p2',{weapons:[{id:'cafe',level:8}],passives:[{id:'cafe-forte',level:1}]},{weaponReady:base===undefined?{}:{cafe:base}});
    assert.equal(openChest(c,p2,addChest(f),OPEN)?.kind,'evolve');
    const ready=p2.weaponReady['cafe-evo'];
    assert.ok(ready!==undefined&&ready>c.tick,`base=${base}: ready=${ready}`);
    assert.equal(ready,Math.max(base??0,LATE+1));
    assert.ok(!('cafe' in p2.weaponReady));
  }
});

test('openChest: options.rng makes the result independent of ctx.rng draws',()=>{
  const mixed=():PlayerBuild=>({weapons:[{id:'chinelo',level:3},{id:'boleto',level:5},{id:'audio',level:1}],passives:[{id:'marmita',level:2},{id:'bone',level:3}]});
  const run=(burn:number,build:()=>PlayerBuild,seed?:number)=>{
    const {fake,ctx,events}=makeCtx(1,LATE);
    for(let i=0;i<burn;i++)fake.rng.next();
    const p=makePlayer('p1',build());
    const rng=seed===undefined?undefined:new Rng(seed);
    const stateBefore=rng?.state;
    const res=openChest(ctx,p,addChest(fake,'c1'),rng?{runStartTick:0,rng}:OPEN);
    if(rng)assert.equal(rng.state,stateBefore,'the caller stream is only forked, not advanced');
    return JSON.stringify({res,build:p.build,stats:p.stats,events});
  };
  for(let seed=1;seed<=20;seed++){
    for(const burn of [1,7,31])assert.equal(run(burn,mixed,seed),run(0,mixed,seed),`seed ${seed} burn ${burn}`);
    assert.equal(run(13,allEligible,seed),run(0,allEligible,seed));
  }
  // Sanity: without options.rng the roll does follow ctx.rng, so the check above is meaningful.
  assert.ok(new Set(Array.from({length:20},(_,burn)=>run(burn,mixed))).size>1);
});

test('openChest: runStartTick defaults to ctx.runStartTick',()=>{
  const at=(tick:number)=>{
    const {fake,ctx}=makeCtx(1,tick);
    (fake as FakeCtx&{runStartTick:number}).runStartTick=1000;
    const build=allEligible();build.weapons.push({id:'pombo',level:3});
    return openChest(ctx,makePlayer('p1',build),addChest(fake))?.kind;
  };
  assert.equal(at(1000+LATE-1),'upgrade');
  assert.equal(at(1000+LATE),'evolve');
});

test('player.classBonus is honored on refreshStats and passive upgrades without passing it',()=>{
  const bonus:ClassBonus={maxHp:20,might:0.5,amount:1};
  const p=makePlayer('p1',{weapons:[],passives:[{id:'marmita',level:1}]},{classBonus:bonus});
  refreshStats(p);
  assert.deepEqual(p.stats,computeStats(p.build,bonus));
  assert.equal(p.stats.maxHp,140);assert.equal(p.stats.amount,1);
  refreshStats(p,{});
  assert.deepEqual(p.stats,computeStats(p.build),'an explicit bonus still overrides');

  for(let seed=1;seed<=20;seed++){
    const {fake,ctx}=makeCtx(seed,0);
    const build:PlayerBuild={weapons:[],passives:[{id:'oculos',level:1},{id:'marmita',level:1}]};
    const q=makePlayer('q',build,{stats:computeStats(build,bonus),hp:140,classBonus:bonus});
    const res=openChest(ctx,q,addChest(fake),OPEN);
    assert.ok(res&&res.kind==='upgrade');
    assert.deepEqual(q.stats,computeStats(q.build,bonus),`seed ${seed}`);
    assert.equal(q.stats.amount,1);
  }
});

test('computeStats: float noise in amount never loses (or gains) a whole projectile',()=>{
  const amt=(a:number)=>computeStats({weapons:[],passives:[]},{amount:a}).amount;
  assert.equal(amt(0.9999999),1);
  assert.ok(0.7+0.2+0.1<1,'the sum really is below 1 in floating point');
  assert.equal(amt(0.7+0.2+0.1),1);
  assert.equal(amt(0.3*3+0.1),1);
  assert.equal(amt(2.9999999),3);
  assert.equal(amt(3*(1-1e-9)),3);
  assert.equal(amt(1.0000001),1);
  // Real fractions are still floored.
  assert.equal(amt(0.999),0);assert.equal(amt(0.99999),0);assert.equal(amt(1.5),1);assert.equal(amt(5.9),5);
  for(let k=0;k<=6;k++)for(const noise of [-1e-7,-1e-9,0,1e-9,1e-7]){
    const v=amt(k+noise);
    assert.ok(Number.isInteger(v),`${k}+${noise}`);
    assert.equal(v,k,`${k}+${noise}`);
  }
  // Repeated 0.1 class-bonus steps accumulate float noise but stay integer and exact.
  let acc=0;
  for(let i=1;i<=60;i++){acc+=0.1;const v=amt(acc);assert.ok(Number.isInteger(v));assert.equal(v,Math.min(6,Math.floor(i/10)),`${i}x0.1`);}
});
