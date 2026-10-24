import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks} from '../../src/contract/types.ts';
import type {EnemyState,OwnedItem,PickupState,PlayerBuild,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createTeamProgress} from '../../src/sim/progression.ts';
import {
  BOSS_CHEST_PREFIX,CRATE_ID_PREFIX,CRATE_WEAPONS,MAX_CRATES,NEAR_SHARE,crateCap,START_CRATES_MAX,START_CRATES_MIN,OPEN_NOISE_RADIUS,OPEN_REACH,stageShift,OPEN_SECONDS,RESPAWN_MIN_DIST,RESPAWN_SECONDS,
  FIRST_MINUTE_CRATES,FIRST_MINUTE_S,PASS_DIST,START_CRATES_PER_PLAYER,START_PLAYERS_MAX,STARTER_WEAPONS,TRAIL_AHEAD,TRAIL_MAX,
  VERDE_PISTOL,createCrates,prizeKey,rollCrate,rollPrize,rollStarter,startBands,type CrateHooks,type CratesState,
} from '../../src/sim/crates.ts';
import {INVENTORY_SLOTS} from '../../src/sim/inventory.ts';
import {ARSENAL_WEAPONS,NEW_WEAPONS,legendaryId,type Rarity} from '../../src/sim/weapons/arsenal.ts';
import {WEAPON_IDS,getWeapon} from '../../src/sim/weapons/catalog.ts';
import {CRATE_BODY_RADIUS,CRATE_OPEN_MARGIN,CRATE_SCALE} from '../../src/rules/crate-size.ts';
import {KIT_CHANCE,KIT_POOL,isKitId,kitId} from '../../src/rules/tower-kits.ts';

// ---------- Fake context (the sim-progression pattern) ----------
type Mutable<T>={-readonly [K in keyof T]:T[K]};
type FakeCtx=Mutable<SimContext>&{players:Map<string,SimPlayer>;events:SimEvent[];team:TeamProgress;round:RoundState};
function naiveIndex<T extends {x:number;y:number;id:string}>():SpatialIndex<T>{
  let items:T[]=[];
  return {rebuild(src){items=[...src];},query(x,y,r,out=[]){for(const i of items)if(Math.hypot(i.x-x,i.y-y)<=r)out.push(i);return out;},nearest:()=>undefined};
}
function makeCtx(seed=1):FakeCtx{
  const counters=new Map<string,number>(),events:SimEvent[]=[];
  return {
    tick:0,runStartTick:0,terrain:{} as never,rng:new Rng(seed),players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),
    telegraphs:new Map(),team:createTeamProgress(),offers:new Map(),round:{index:1,total:10,phase:'wave',phaseEndsTick:0,remaining:0},
    enemyIndex:naiveIndex<EnemyState>(),
    nextId:(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:(e:SimEvent)=>{events.push(e);},damageEnemy:()=>false,damagePlayer:()=>{},events,
  };
}
const startBuild=():PlayerBuild=>({weapons:[{id:'faca',level:1}],passives:[],hand:0});
function addPlayer(ctx:FakeCtx,id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  const p:SimPlayer={id,classId:'turista',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},build:startBuild(),stats:{...BASE_STATS},weaponReady:{},...extra};
  ctx.players.set(id,p);
  return p;
}
const chests=(ctx:FakeCtx)=>[...ctx.pickups.values()].filter(p=>p.kind==='chest');
const opened=(ctx:FakeCtx)=>ctx.events.filter((e):e is Extract<SimEvent,{type:'pickup'}>=>e.type==='pickup'&&e.kind==='chest');
function run(ctx:FakeCtx,crates:{step(ctx:SimContext):void},n:number,each?:(ctx:FakeCtx)=>void){
  for(let i=0;i<n;i++){each?.(ctx);crates.step(ctx);ctx.tick++;}
}
/** Points along a line, 10 apart, walk time = index (so thirds are by index). */
const line=(n:number)=>Array.from({length:n},(_,i)=>({x:i*10,y:0,seconds:i}));

/** The cap of the runs below (no player at the first step: the cap of one). */
const CAP=crateCap(0);

test('initial placement: crateCap on distinct points, half near first, base rarity by distance third, shifted by stage',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=40;seed++){
    const points=line(30),ctx=makeCtx(seed),crates=createCrates({seed,points});
    ctx.round.index=4;// stage 1: no shift, the base shows
    crates.step(ctx);
    const placed=chests(ctx);
    assert.equal(placed.length,CAP);
    assert.equal(new Set(placed.map(c=>`${c.x},${c.y}`)).size,CAP,'distinct points');
    assert.ok(placed.filter(c=>c.x<100).length>=Math.ceil(CAP*NEAR_SHARE),'the near third first');
    for(const c of placed){
      const tier=Math.floor(c.x/10/10),allowed=[[1,2],[2,3],[3,4]][tier];
      assert.ok(allowed.includes(c.value),`tier ${tier} rolled ${c.value}`);
      assert.equal(crates.state.crates[c.id].rarity,c.value);
      assert.equal(crates.state.crates[c.id].base,c.value);
      seen.add(`${tier}:${c.value}`);
    }
  }
  assert.deepEqual([...seen].sort(),['0:1','0:2','1:2','1:3','2:3','2:4'],'every tier rolls both of its rarities');
  // Fewer points than the cap: all of them; none: nothing, and a later step places nothing either.
  const few=makeCtx(),fewCrates=createCrates({seed:3,points:line(CAP-1)});
  fewCrates.step(few);assert.equal(chests(few).length,CAP-1);
  const none=makeCtx(),noCrates=createCrates({seed:3,points:[]});
  run(none,noCrates,5);assert.equal(chests(none).length,0);
  const dropped=noCrates.dropCrate(none,{x:1,y:2},4);
  assert.equal(dropped.kind,'chest');assert.equal(dropped.value,4);
  assert.deepEqual(noCrates.state.crates[dropped.id],{rarity:4,origin:'dropped',item:dropped.resource});
});

/** Standing ticks until a crate of this rarity opens (the first step only records where the player stands). */
function openTime(rarity:Rarity){
  const ctx=makeCtx(),crates=createCrates({seed:1,points:[]});
  addPlayer(ctx,'a',0,0);
  crates.dropCrate(ctx,{x:.5,y:0},rarity);
  let steps=0;
  while(!opened(ctx).length&&steps<1000){run(ctx,crates,1);steps++;}
  return steps-1;
}
test('opening takes OPEN_SECONDS by rarity of standing still',()=>{
  assert.deepEqual(OPEN_SECONDS,[1,1.5,2,2.5,3]);
  for(const r of [1,2,3,4,5] as Rarity[])assert.equal(openTime(r),ticks(OPEN_SECONDS[r-1]),`rarity ${r}`);
});

test('moving or taking damage starts the opening over; out of reach never opens',()=>{
  for(const disturb of ['move','hurt'] as const){
    const ctx=makeCtx(),crates=createCrates({seed:1,points:[]}),p=addPlayer(ctx,'a',0,0);
    const crate=crates.dropCrate(ctx,{x:.5,y:0},1);
    run(ctx,crates,1+ticks(.8));
    assert.equal(crates.opening('a')?.crate,crate.id);
    assert.ok(Math.abs(crates.opening('a')!.progress-.8)<1e-9);
    if(disturb==='move')p.x+=.1;else p.hp-=5;
    run(ctx,crates,1);
    assert.equal(crates.opening('a'),undefined,disturb);
    run(ctx,crates,ticks(1)-1);
    assert.equal(opened(ctx).length,0,`${disturb}: the progress was lost`);
    run(ctx,crates,1);
    assert.equal(opened(ctx).length,1);
    assert.equal(ctx.pickups.has(crate.id),false);
  }
  const ctx=makeCtx(),crates=createCrates({seed:1,points:[]});
  addPlayer(ctx,'a',0,0);crates.dropCrate(ctx,{x:OPEN_REACH+.01,y:0},1);
  run(ctx,crates,100);
  assert.equal(opened(ctx).length,0);
  // Healing is not damage: the opening goes on.
  const healCtx=makeCtx(),healCrates=createCrates({seed:1,points:[]}),h=addPlayer(healCtx,'a',0,0,{hp:50});
  healCrates.dropCrate(healCtx,{x:0,y:0},1);
  run(healCtx,healCrates,10);h.hp=60;run(healCtx,healCrates,ticks(1)-9);
  assert.equal(opened(healCtx).length,1);
});

test('coleta-3x: the crate is 3× its old size and opens when a hero touches its new edge; the nearest hero wins',()=>{
  assert.equal(CRATE_SCALE,3);
  assert.equal(CRATE_BODY_RADIUS,1.5,'3× the old .5 u body');
  assert.equal(OPEN_REACH,CRATE_BODY_RADIUS+CRATE_OPEN_MARGIN,'the reach follows the edge');
  assert.equal(OPEN_REACH,2,'the old margin (1 - .5) past the new edge');
  for(const [d,opens] of [[1.9,true],[2.1,false]] as const){
    const ctx=makeCtx(),crates=createCrates({seed:1,points:[]});
    addPlayer(ctx,'a',0,0);crates.dropCrate(ctx,{x:d,y:0},1);
    run(ctx,crates,ticks(1)+2);
    assert.equal(opened(ctx).length,opens?1:0,`at ${d} u`);
  }
  // Two heroes at one crate since the same tick: the nearer one gets it, whatever the player order.
  for(const order of [['far','near'],['near','far']]){
    const ctx=makeCtx(),crates=createCrates({seed:1,points:[]});
    for(const id of order)addPlayer(ctx,id,id==='near'?.4:-1.6,0);
    crates.dropCrate(ctx,{x:0,y:0},1);
    run(ctx,crates,ticks(1)+2);
    assert.deepEqual(opened(ctx).map(e=>e.player),['near'],order.join(','));
  }
});

test('the nearest crate, one at a time; roxa and up make noise once at the start',()=>{
  const noise:{at:{x:number;y:number};radius:number;source:string}[]=[];
  const hooks:CrateHooks={onNoise:(_ctx,at,radius,source)=>noise.push({at,radius,source})};
  const ctx=makeCtx(),crates=createCrates({seed:1,points:[],hooks});
  addPlayer(ctx,'a',0,0);
  const far=crates.dropCrate(ctx,{x:.9,y:0},2),near=crates.dropCrate(ctx,{x:0,y:.3},3);
  run(ctx,crates,5);
  assert.equal(crates.opening('a')?.crate,near.id);
  assert.deepEqual(noise,[{at:{x:0,y:.3},radius:OPEN_NOISE_RADIUS,source:near.id}]);
  run(ctx,crates,ticks(2));
  assert.deepEqual(opened(ctx).map(e=>e.pickup),[near.id]);
  assert.equal(opened(ctx)[0].value,3);
  // Next the azul one: silent.
  run(ctx,crates,ticks(1.5)+1);
  assert.deepEqual(opened(ctx).map(e=>e.pickup),[near.id,far.id]);
  assert.equal(noise.length,1,'azul is silent');
});

test('a downed, eliminated, spectator or inventory-less player cannot open',()=>{
  const cases:Partial<SimPlayer>[]=[
    {downed:{sinceTick:0,bleedOutTick:9999,progress:0}},{eliminated:true},{spectator:true},
    {build:{weapons:[{id:'chinelo',level:1}],passives:[]}},{hp:0},
  ];
  for(const extra of cases){
    const ctx=makeCtx(),crates=createCrates({seed:1,points:[]});
    addPlayer(ctx,'a',0,0,extra);crates.dropCrate(ctx,{x:0,y:0},1);
    run(ctx,crates,200);
    assert.equal(opened(ctx).length,0,JSON.stringify(extra));
    assert.equal(crates.opening('a'),undefined);
  }
});

test('start crates (caixas-sumiram): START_CRATES_PER_PLAYER a player (1..6), one in each walk band, spread, verde/azul, never respawn',()=>{
  // Spots on rings of radius 6..48 (walk = radius), 24 a ring.
  const spots=Array.from({length:8*24},(_,i)=>{const r=6+Math.floor(i/24)*6,a=(i%24)/24*2*Math.PI;return {x:Math.cos(a)*r,y:Math.sin(a)*r,walk:r};});
  const bands=startBands(spots);
  assert.equal(bands.length,START_CRATES_PER_PLAYER);
  assert.ok(bands.every((b,k)=>b.length&&b.every(p=>p.walk>=6+k*42/START_CRATES_PER_PLAYER-1e-9&&p.walk<=6+(k+1)*42/START_CRATES_PER_PLAYER+1e-9)),'equal walk bands, nearest first');
  assert.equal(START_CRATES_MIN,START_CRATES_PER_PLAYER);assert.equal(START_CRATES_MAX,START_CRATES_PER_PLAYER*START_PLAYERS_MAX);
  for(const [players,want] of [[0,START_CRATES_MIN],[1,START_CRATES_MIN],[4,4*START_CRATES_PER_PLAYER],[8,START_CRATES_MAX]] as const){
    const ctx=makeCtx(3),crates=createCrates({seed:3,points:line(30).map(p=>({...p,x:p.x+100})),startPoints:spots});
    for(let i=0;i<players;i++)addPlayer(ctx,`p${i}`,0,0);
    crates.step(ctx);
    const start=chests(ctx).filter(c=>crates.state.crates[c.id].start);
    assert.equal(start.length,want,`${players} players`);
    assert.ok(start.every(c=>crates.state.crates[c.id].origin==='dropped'&&Math.hypot(c.x,c.y)<=48+1e-9));
    assert.deepEqual(start.map(c=>c.value),start.map((_,i)=>i%2?2:1),'verde and azul alternate');
    start.forEach((c,i)=>{const band=i%START_CRATES_PER_PLAYER;assert.ok(bands[band].some(b=>b.x===c.x&&b.y===c.y),`crate ${i} in band ${band}`);});
    const gap=Math.min(...start.flatMap((a,i)=>start.slice(i+1).map(b=>Math.hypot(a.x-b.x,a.y-b.y))));
    assert.ok(gap>=4,`not piled up (closest pair ${gap.toFixed(1)} u)`);
  }
  const none=makeCtx(),noStart=createCrates({seed:3,points:[]});
  addPlayer(none,'p',0,0);noStart.step(none);assert.equal(chests(none).length,0,'no start points: none');
});

/** A straight street along x: the trail spot is `ahead` u along the heading when it stays on the street (|y| < 3). */
const street=(at:{x:number;y:number},h:{x:number;y:number},ahead:number)=>{const p={x:at.x+h.x*ahead,y:at.y+h.y*ahead};return Math.abs(p.y)<3?p:undefined;};

test('trail crates (caixas-sumiram): a hero who walks the first minute passes FIRST_MINUTE_CRATES, each hero his own, ahead and out of view',()=>{
  const ctx=makeCtx(5),crates=createCrates({seed:5,points:[],trailSpot:street}),a=addPlayer(ctx,'a',0,0),b=addPlayer(ctx,'b',0,1);
  const passed={a:new Set<string>(),b:new Set<string>()},born:{id:string;at:number;hero:{x:number;y:number}}[]=[];
  const before=new Set<string>();
  for(let t=0;t<ticks(FIRST_MINUTE_S);t++){
    // a walks east, b west, at the 4 u/s walk.
    a.x+=4/20;b.x-=4/20;a.hp=b.hp=100;
    crates.step(ctx);ctx.tick++;
    for(const c of chests(ctx)){
      if(!before.has(c.id)){before.add(c.id);born.push({id:c.id,at:Math.min(Math.hypot(c.x-a.x,c.y-a.y),Math.hypot(c.x-b.x,c.y-b.y)),hero:{x:c.x,y:c.y}});}
      if(Math.hypot(c.x-a.x,c.y-a.y)<=PASS_DIST)passed.a.add(c.id);
      if(Math.hypot(c.x-b.x,c.y-b.y)<=PASS_DIST)passed.b.add(c.id);
    }
  }
  assert.ok(passed.a.size>=FIRST_MINUTE_CRATES&&passed.b.size>=FIRST_MINUTE_CRATES,`passed a ${passed.a.size}, b ${passed.b.size}`);
  assert.equal([...passed.a].filter(id=>passed.b.has(id)).length,0,'each hero his own crates');
  assert.ok(born.every(c=>c.at>=TRAIL_AHEAD[0]*.85-.5),`born out of view: ${born.map(c=>c.at.toFixed(1)).join(' ')}`);
  assert.ok(born.length<=2*TRAIL_MAX);
  assert.ok(Object.values(crates.state.crates).every(r=>r.start&&r.origin==='dropped'));
  // After the first minute: no more trail crates, and the trail state is gone.
  const n=chests(ctx).length;
  for(let t=0;t<ticks(20);t++){a.x+=4/20;crates.step(ctx);ctx.tick++;}
  assert.equal(chests(ctx).length,n);assert.equal(crates.state.trail,undefined);
  // A hero standing still gets none; without trailSpot nobody does.
  const still=makeCtx(5),sc=createCrates({seed:5,points:[],trailSpot:street});addPlayer(still,'s',0,0);run(still,sc,ticks(30));
  assert.equal(chests(still).length,0);
  const off=makeCtx(5),oc=createCrates({seed:5,points:[]}),w=addPlayer(off,'w',0,0);run(off,oc,ticks(30),()=>{w.x+=.2;});
  assert.equal(chests(off).length,0);
});

test('starter prizes (caixas-sumiram): every weapon and verde kit shows up; in 100 matches no item passes 35 % of a hero\'s first four crates, never the same twice in a row',()=>{
  const seen=new Set<string>();
  for(let s=0;s<600;s++)for(const r of [1,2] as Rarity[]){
    const prize=rollStarter(new Rng(s).fork('t'),r);seen.add(prizeKey(prize));
    for(const it of prize.items)if(getWeapon(it.id))assert.ok(it.level>=r&&it.level>=(NEW_WEAPONS.find(w=>w.id===it.id)?.minRarity??1));
  }
  assert.deepEqual([...seen].sort(),[...STARTER_WEAPONS,...KIT_POOL[1].map(kitId)].sort());
  // 100 matches: a hero opens his first four start crates one after the other.
  const tally=new Map<string,number>();let total=0;
  for(let m=1;m<=100;m++){
    // hideAfterTaken [] / goldChance 0: the caixa-gamble is tested on its own (caixa-gamble-raridade.test.ts).
    const ctx=makeCtx(m),crates=createCrates({seed:1000+m,points:[],hideAfterTaken:[],goldChance:0}),p=addPlayer(ctx,'a',0,0);
    const keys:string[]=[];
    for(let i=0;i<4;i++){
      const crate=crates.dropCrate(ctx,{x:0,y:0},(i%2+1) as Rarity);crates.state.crates[crate.id].start=true;
      const before=opened(ctx).length;
      p.build.weapons=[{id:'faca',level:1}];
      run(ctx,crates,1+ticks(3));
      assert.equal(opened(ctx).length,before+1);
      keys.push(crates.state.last!.a);
    }
    for(let i=1;i<keys.length;i++)assert.notEqual(keys[i],keys[i-1],`match ${m}: ${keys.join(',')}`);
    for(const k of keys){tally.set(k,(tally.get(k)??0)+1);total++;}
  }
  const share=[...tally].map(([k,n])=>[k,n/total] as const).sort((x,y)=>y[1]-x[1]);
  assert.ok(share[0][1]<=.35,`dominant: ${share.map(([k,f])=>`${k} ${(f*100).toFixed(0)}%`).join(', ')}`);
  assert.ok(share.length>=5,'varied');
});

test('the same prize never twice in a row for a hero, in any crate (rollCrate redraws on the same stream)',()=>{
  for(let m=1;m<=30;m++){
    const ctx=makeCtx(m),crates=createCrates({seed:m,points:[],hideAfterTaken:[],goldChance:0}),p=addPlayer(ctx,'a',0,0);let last='';
    for(let i=0;i<6;i++){
      crates.dropCrate(ctx,{x:0,y:0},1);p.build.weapons=[{id:'faca',level:1}];
      run(ctx,crates,1+ticks(2));
      const k=crates.state.last!.a;assert.notEqual(k,last,`match ${m} crate ${i}`);last=k;
    }
  }
});

test('caixa-icone-torre-arma: a crate shows its prize from the start (resource), opening gives that item, never the same as the last one shown',()=>{
  const kinds=new Set<string>();
  for(let seed=1;seed<=30;seed++){
    const ctx=makeCtx(seed),crates=createCrates({seed,points:line(30),startPoints:line(8).map(p=>({x:p.x,y:200})),goldChance:0});
    addPlayer(ctx,'a',-500,-500);
    crates.step(ctx);
    let prev:string|undefined;
    for(const c of chests(ctx)){
      const record=crates.state.crates[c.id];
      assert.ok(c.resource,'every crate shows an item');
      assert.equal(record.item,c.resource);
      const pool=record.start?[...STARTER_WEAPONS,...KIT_POOL[1].map(kitId)]:[...CRATE_WEAPONS[record.rarity],...KIT_POOL[record.rarity].map(kitId)];
      assert.ok(pool.includes(c.resource!),`${c.resource} in a ${record.start?'start':record.rarity} crate`);
      assert.notEqual(c.resource,prev,'never the same as the crate before');prev=c.resource;
      kinds.add(isKitId(c.resource)?'kit':'arma');
    }
    // Opening gives exactly what it showed: a weapon at the crate's rarity of that moment.
    const c=chests(ctx).find(k=>!crates.state.crates[k.id].start&&!isKitId(k.resource))!;
    const p=addPlayer(ctx,'b',c.x,c.y),rarity=crates.state.crates[c.id].rarity;
    run(ctx,crates,1+ticks(3));
    assert.ok(!ctx.pickups.has(c.id));
    assert.deepEqual(p.build.weapons[1],{id:c.resource,level:Math.max(rarity,ARSENAL_WEAPONS.find(w=>w.id===c.resource)?.minRarity??1)});
  }
  assert.deepEqual([...kinds].sort(),['arma','kit']);
  // Same seed, same items (its own stream: the rest of the step does not shift it).
  const items=(seed:number)=>{const ctx=makeCtx(seed),crates=createCrates({seed,points:line(30)});crates.step(ctx);return chests(ctx).map(c=>c.resource);};
  assert.deepEqual(items(7),items(7));
});

test('caixa-icone-torre-arma: a crate from an older checkpoint (no item) still rolls its prize when opened',()=>{
  const ctx=makeCtx(2),crates=createCrates({seed:2,points:[]}),p=addPlayer(ctx,'a',0,0);
  const c=crates.dropCrate(ctx,{x:0,y:0},2);
  delete crates.state.crates[c.id].item;delete c.resource;
  run(ctx,crates,1+ticks(2));
  assert.ok(!ctx.pickups.has(c.id));
  assert.ok(crates.state.last!.a&&crates.state.last!.a!=='nada');
  assert.ok(p.build.weapons.length>1||isKitId(crates.state.last!.a));
});

test('the placed crates scale with the players: 1 + 3 a player, up to MAX_CRATES; the cap is kept for the run',()=>{
  assert.deepEqual([0,1,2,3,6,8].map(crateCap),[4,4,7,10,16,16]);
  assert.equal(MAX_CRATES,16);
  const ctx=makeCtx(4),crates=createCrates({seed:4,points:line(40)});
  for(let i=0;i<6;i++)addPlayer(ctx,`p${i}`,-50,0);
  crates.step(ctx);
  assert.equal(chests(ctx).length,16);assert.equal(crates.state.cap,16);
});

test('the rarity grows along the match: rounds 1-3 shift -1, the last rounds +2, an unopened crate follows',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,7,8,9,10].map(index=>stageShift({index,total:10})),[-1,-1,-1,-1,0,0,1,1,1,2,2]);
  const ctx=makeCtx(2),crates=createCrates({seed:2,points:line(30)});
  ctx.round.index=1;crates.step(ctx);
  const near=chests(ctx).filter(c=>c.x<100),far=chests(ctx).filter(c=>c.x>=200);
  assert.ok(near.length&&near.every(c=>c.value===1),'rounds 1-3: the near crates are verde');
  assert.ok(far.every(c=>c.value===2||c.value===3),'rounds 1-3: the far ones azul/roxa');
  ctx.round.index=10;crates.step(ctx);
  for(const c of chests(ctx)){const r=crates.state.crates[c.id];assert.equal(c.value,Math.min(5,r.base!+2));assert.equal(r.rarity,c.value);}
  assert.ok(chests(ctx).some(c=>c.value===5)||!far.length,'the last rounds: a far crate can be lendária');
  // Dropped crates keep their rarity.
  const dropped=crates.dropCrate(ctx,{x:1,y:1},2);ctx.round.index=1;crates.step(ctx);
  assert.equal(dropped.value,2);
});

test('prize table: one weapon of the rarity (never below its minimum), every weapon that comes in it, nothing else',()=>{
  // arsenal-completo-no-bau: the firearms and the playable Pack 12 weapons by their minimum rarity, 10 mil sorteios each.
  const N=10_000,ids=new Map<Rarity,Map<string,number>>();
  for(const r of [1,2,3,4,5] as Rarity[]){
    const seen=new Map<string,number>();ids.set(r,seen);
    for(let s=0;s<N;s++){
      const prize=rollPrize(new Rng(s).fork('t'),r);
      assert.equal(prize.items.length,1);
      const item=prize.items[0];
      seen.set(item.id,(seen.get(item.id)??0)+1);
      const w=getWeapon(item.id);assert.ok(w?.pattern,`${item.id} is a weapon`);
      const min=ARSENAL_WEAPONS.find(n=>n.id===item.id)?.minRarity??5;
      assert.ok(item.level>=min&&item.level===r,`${item.id}:${item.level} from ${r}`);
    }
  }
  const comes=(r:Rarity)=>ARSENAL_WEAPONS.filter(w=>w.id!=='faca'&&w.minRarity<=r).map(w=>w.id).sort();
  for(const r of [1,2,3,4] as Rarity[])assert.deepEqual([...ids.get(r)!.keys()].sort(),comes(r),`rarity ${r}`);
  assert.deepEqual([...ids.get(5)!.keys()].sort(),[...WEAPON_IDS.map(legendaryId),...ARSENAL_WEAPONS.filter(w=>w.minRarity===5).map(w=>w.id)].sort());
  assert.ok(comes(1).includes('pistola')&&comes(2).includes('escopeta')&&comes(4).includes('rojao')&&!comes(3).includes('rojao'));
  // The verde keeps the pistol at VERDE_PISTOL, the rest share the remainder evenly; from the azul up, even odds.
  const verde=ids.get(1)!,others=comes(1).filter(id=>id!=='pistola');
  assert.ok(others.length>0);
  assert.ok(Math.abs(verde.get('pistola')!/N-VERDE_PISTOL)<.02,`pistola ${verde.get('pistola')}`);
  for(const id of others)assert.ok(Math.abs(verde.get(id)!/N-(1-VERDE_PISTOL)/others.length)<.02,`${id} ${verde.get(id)}`);
  for(const r of [2,3,4] as Rarity[]){const each=1/comes(r).length;for(const [id,n] of ids.get(r)!)assert.ok(Math.abs(n/N-each)<.02,`${r} ${id} ${n}`);}
  // Every arsenal weapon (all but the starting faca) comes from some crate.
  assert.deepEqual([...new Set(Object.values(CRATE_WEAPONS).flat())].filter(id=>!id.endsWith('-lendario')).sort(),ARSENAL_WEAPONS.map(w=>w.id).filter(id=>id!=='faca').sort());
});

test('bau-so-arma-ou-torre: 10 mil sorteios of every rarity and of the starter give one weapon or one kit, never coxinha, doces, Grana, fichas or XP',()=>{
  const draws:[string,(rng:Rng)=>{items:OwnedItem[]}][]=[
    ...([1,2,3,4,5] as Rarity[]).map(r=>[`caixa ${r}`,(rng:Rng)=>rollCrate(rng,r)] as [string,(rng:Rng)=>{items:OwnedItem[]}]),
    ...([1,2] as Rarity[]).map(r=>[`starter ${r}`,(rng:Rng)=>rollStarter(rng,r)] as [string,(rng:Rng)=>{items:OwnedItem[]}]),
  ];
  for(const [name,draw] of draws){
    let kits=0;
    for(let s=0;s<10000;s++){
      const prize=draw(new Rng(s).fork('so'));
      assert.deepEqual(Object.keys(prize),['items'],`${name}: only items`);
      assert.equal(prize.items.length,1,name);
      const id=prize.items[0].id;
      if(isKitId(id)){kits++;continue;}
      assert.ok(getWeapon(id)?.pattern&&id!=='faca',`${name}: ${id} is a weapon`);
    }
    assert.ok(Math.abs(kits/10000-KIT_CHANCE)<.02,`${name}: ${kits} kits`);
  }
});

test('prizes land in the inventory, the overflow on the ground; no Grana, fichas nor team XP',()=>{
  // Lendária: one weapon (or a kit), no team XP.
  const ctx=makeCtx(),crates=createCrates({seed:7,points:[]}),p=addPlayer(ctx,'a',0,0);
  crates.dropCrate(ctx,{x:0,y:0},5);
  run(ctx,crates,1+ticks(3));
  assert.equal(p.build.weapons.length,2);
  assert.match(p.build.weapons[1].id,/-lendario$/);
  assert.equal(p.build.weapons[1].level,5);
  assert.equal(ctx.team.xp,0);
  // A full inventory: the legendary falls beside the crate as an 'item'.
  const full=makeCtx(),fullCrates=createCrates({seed:7,points:[]}),q=addPlayer(full,'a',0,0);
  q.build.weapons=Array.from({length:INVENTORY_SLOTS},():OwnedItem=>({id:'faca',level:1}));
  fullCrates.dropCrate(full,{x:.4,y:.2},5);
  run(full,fullCrates,1+ticks(3));
  assert.equal(q.build.weapons.length,INVENTORY_SLOTS);
  const ground=[...full.pickups.values()].filter(i=>i.kind==='item');
  assert.equal(ground.length,1);
  assert.match(ground[0].resource!,/-lendario$/);
  assert.deepEqual([ground[0].x,ground[0].y],[.4,.2]);
  // Many crates of every rarity: the opener's Grana and the team's XP never move.
  for(let seed=1;seed<=20;seed++){
    const c=makeCtx(),cr=createCrates({seed,points:[]}),b=addPlayer(c,'b',0,0),xp=c.team.xp;
    for(let i=0;i<5;i++){cr.dropCrate(c,{x:0,y:0},(i+1) as Rarity);}
    run(c,cr,ticks(20));
    assert.equal(b.grana??0,0);assert.equal(c.team.xp,xp);
  }
});

test('an opened placed crate respawns 180 s later on a free point away from every player',()=>{
  const points=line(CAP+1),ctx=makeCtx(),crates=createCrates({seed:5,points});
  crates.step(ctx);ctx.tick++;
  const used=new Set(Object.values(crates.state.crates).map(r=>r.point));
  const free=points.findIndex((_,i)=>!used.has(i));
  const [target]=chests(ctx);
  const a=addPlayer(ctx,'a',target.x,target.y);
  const blocker=addPlayer(ctx,'b',points[free].x+RESPAWN_MIN_DIST-.5,0);
  run(ctx,crates,1+ticks(OPEN_SECONDS[target.value-1]));
  assert.equal(opened(ctx).length,1);
  const openTick=ctx.tick-1;
  assert.equal(chests(ctx).length,CAP-1);
  assert.deepEqual(crates.state.respawns,[openTick+ticks(RESPAWN_SECONDS)]);
  // Due, but the only free points are next to a player (a stands on the opened point, b near the other): it waits.
  while(ctx.tick<openTick+ticks(RESPAWN_SECONDS)+50)run(ctx,crates,1);
  assert.equal(chests(ctx).length,CAP-1,'no point qualifies');
  blocker.x=-1000;
  run(ctx,crates,1);
  const back=chests(ctx).find(c=>c.x===points[free].x);
  assert.ok(back,'came back on the free point away from both players');
  assert.equal(crates.state.crates[back.id].origin,'placed');
  assert.ok([1,2,3,4].includes(back.value));
  assert.equal(chests(ctx).length,CAP);
  assert.equal(crates.state.respawns.length,0);
  assert.ok(Math.hypot(a.x-back.x,a.y-back.y)>=RESPAWN_MIN_DIST);
  // Exact timing: not a tick early (fresh run, nobody around).
  const c2=makeCtx(),cr2=createCrates({seed:5,points});
  cr2.step(c2);c2.tick++;
  const [t2]=chests(c2);const p2=addPlayer(c2,'a',t2.x,t2.y);
  run(c2,cr2,1+ticks(OPEN_SECONDS[t2.value-1]));
  p2.x=-1000;
  const due=cr2.state.respawns[0];
  while(c2.tick<due)run(c2,cr2,1);
  assert.equal(chests(c2).length,CAP-1);
  run(c2,cr2,1);
  assert.equal(chests(c2).length,CAP);
});

test('elite and boss chests become dropped crates; dropped crates skip the cap and never respawn',()=>{
  const rarities=new Set<number>();
  for(let seed=1;seed<=40;seed++){
    const ctx=makeCtx(seed),crates=createCrates({seed,points:line(CAP)});
    crates.step(ctx);ctx.tick++;
    // progression.ts dropLoot: ctx.nextId('chest'); boss.ts finish: ctx.nextId('pickup'). Both value 1.
    const elite:PickupState={id:ctx.nextId('chest'),kind:'chest',value:1,x:500,y:500,spawnTick:ctx.tick};
    const boss:PickupState={id:ctx.nextId('pickup'),kind:'chest',value:1,x:600,y:600,spawnTick:ctx.tick};
    const nest:PickupState={id:ctx.nextId('ninho'),kind:'chest',value:4,x:700,y:700,spawnTick:ctx.tick};
    for(const c of [elite,boss,nest])ctx.pickups.set(c.id,c);
    assert.ok(boss.id.startsWith(BOSS_CHEST_PREFIX));
    run(ctx,crates,1);
    assert.ok(elite.value===2||elite.value===3);rarities.add(elite.value);
    assert.equal(boss.value,5);
    assert.equal(nest.value,4,'a chest that already has a rarity keeps it');
    for(const c of [elite,boss,nest])assert.equal(crates.state.crates[c.id].origin,'dropped');
    assert.equal(chests(ctx).length,CAP+3,'dropped crates do not count to the cap');
    if(seed===1){
      const p=addPlayer(ctx,'a',boss.x,boss.y);
      run(ctx,crates,1+ticks(3));
      assert.equal(opened(ctx).at(-1)?.value,5);
      assert.equal(crates.state.last!.a,boss.resource,'the item it showed');
      assert.ok(isKitId(boss.resource)||/-lendario$/.test(boss.resource!),boss.resource);
      assert.deepEqual(crates.state.respawns,[],'a dropped crate never respawns');
    }
  }
  assert.deepEqual([...rarities].sort(),[2,3]);
});

test('deterministic, and a JSON checkpoint resumes exactly like an uninterrupted run',()=>{
  const points=Array.from({length:30},(_,i)=>({x:(i%6)*12,y:Math.floor(i/6)*12,seconds:(i*7)%30}));
  const hooks=(log:string[]):CrateHooks=>({
    onNoise:(c,_at,r,s)=>log.push(`n${c.tick}:${s}:${r}`),
  });
  /** Players hop onto a crate every 3 s (the one their index picks), an elite chest drops every 7 s. */
  const script=(crates:{state:CratesState})=>(ctx:FakeCtx)=>{
    if(!ctx.players.size){addPlayer(ctx,'a',0,0);addPlayer(ctx,'b',30,30);}
    if(ctx.tick%ticks(7)===5){const id=ctx.nextId('chest');ctx.pickups.set(id,{id,kind:'chest',value:1,x:ctx.tick%50,y:3,spawnTick:ctx.tick});}
    if(ctx.tick%ticks(3)===0){
      const ids=Object.keys(crates.state.crates);
      [...ctx.players.values()].forEach((p,i)=>{const c=ids.length&&ctx.pickups.get(ids[(ctx.tick/ticks(3)+i*5)%ids.length]);if(c){p.x=c.x;p.y=c.y;}});
    }
  };
  const total=ticks(RESPAWN_SECONDS)+ticks(90),half=ticks(150);
  const digest=(ctx:FakeCtx,state:CratesState,log:string[])=>JSON.stringify({
    state,log,events:ctx.events,team:ctx.team,pickups:[...ctx.pickups.values()],inv:[...ctx.players.values()].map(p=>p.build),
  });
  // The first minute too: start spots and trail crates (caixas-sumiram).
  const startPoints=Array.from({length:30},(_,i)=>({x:i*1.5,y:-6,walk:6+i})),trailSpot=street;
  const fresh=()=>{const log:string[]=[],ctx=makeCtx(9),crates=createCrates({seed:42,points,startPoints,trailSpot,hooks:hooks(log)});return {log,ctx,crates};};
  const a=fresh();run(a.ctx,a.crates,total,script(a.crates));
  const again=fresh();run(again.ctx,again.crates,total,script(again.crates));
  assert.equal(digest(again.ctx,again.crates.state,again.log),digest(a.ctx,a.crates.state,a.log),'same seed, same run');
  assert.ok(opened(a.ctx).length>=10,`${opened(a.ctx).length} crates opened`);
  assert.ok(a.log.some(l=>l.startsWith('n')),'some noise');
  assert.ok(opened(a.ctx).some(e=>e.pickup.startsWith(`${CRATE_ID_PREFIX}-`)&&Number(e.pickup.split('-')[1])>CAP),'respawned crates came back and were opened');
  const b=fresh();run(b.ctx,b.crates,half,script(b.crates));
  const resumed=createCrates({seed:42,points,startPoints,trailSpot,hooks:hooks(b.log),state:JSON.parse(JSON.stringify(b.crates.state)) as CratesState});
  run(b.ctx,resumed,total-half,script(resumed));
  assert.equal(digest(b.ctx,resumed.state,b.log),digest(a.ctx,a.crates.state,a.log),'checkpoint resume');
  // Another seed places differently.
  const other=makeCtx(9),otherCrates=createCrates({seed:43,points});otherCrates.step(other);
  const first=makeCtx(9),firstCrates=createCrates({seed:42,points});firstCrates.step(first);
  assert.notDeepEqual(chests(other).map(c=>[c.x,c.y,c.value]),chests(first).map(c=>[c.x,c.y,c.value]));
});
