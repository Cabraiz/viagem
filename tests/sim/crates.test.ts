import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks} from '../../src/contract/types.ts';
import type {EnemyState,OwnedItem,PickupState,PlayerBuild,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createTeamProgress} from '../../src/sim/progression.ts';
import {
  BOSS_CHEST_PREFIX,CRATE_ID_PREFIX,GRANA_DOURADA,GRANA_VERDE,LEGENDARY_TEAM_XP,MAX_CRATES,OPEN_NOISE_RADIUS,OPEN_SECONDS,RESPAWN_MIN_DIST,RESPAWN_SECONDS,
  createCrates,rollPrize,type CrateHooks,type CratesState,
} from '../../src/sim/crates.ts';
import {INVENTORY_SLOTS} from '../../src/sim/inventory.ts';
import {NEW_WEAPONS,isConsumableId,legendaryId,type Rarity} from '../../src/sim/weapons/arsenal.ts';
import {WEAPON_IDS,getWeapon} from '../../src/sim/weapons/catalog.ts';
import {UNITS_PER_TOKEN} from '../../src/rules/stonewards.ts';

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

test('initial placement: MAX_CRATES on distinct points, rarity by distance third',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=40;seed++){
    const points=line(30),ctx=makeCtx(seed),crates=createCrates({seed,points});
    crates.step(ctx);
    const placed=chests(ctx);
    assert.equal(placed.length,MAX_CRATES);
    assert.equal(new Set(placed.map(c=>`${c.x},${c.y}`)).size,MAX_CRATES,'distinct points');
    for(const c of placed){
      const tier=Math.floor(c.x/10/10),allowed=[[1,2],[2,3],[3,4]][tier];
      assert.ok(allowed.includes(c.value),`tier ${tier} rolled ${c.value}`);
      assert.equal(crates.state.crates[c.id].rarity,c.value);
      seen.add(`${tier}:${c.value}`);
    }
  }
  assert.deepEqual([...seen].sort(),['0:1','0:2','1:2','1:3','2:3','2:4'],'every tier rolls both of its rarities');
  // Fewer points than the cap: all of them; none: nothing, and a later step places nothing either.
  const few=makeCtx(),fewCrates=createCrates({seed:3,points:line(5)});
  fewCrates.step(few);assert.equal(chests(few).length,5);
  const none=makeCtx(),noCrates=createCrates({seed:3,points:[]});
  run(none,noCrates,5);assert.equal(chests(none).length,0);
  const dropped=noCrates.dropCrate(none,{x:1,y:2},4);
  assert.equal(dropped.kind,'chest');assert.equal(dropped.value,4);
  assert.deepEqual(noCrates.state.crates[dropped.id],{rarity:4,origin:'dropped'});
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
  addPlayer(ctx,'a',0,0);crates.dropCrate(ctx,{x:1.01,y:0},1);
  run(ctx,crates,100);
  assert.equal(opened(ctx).length,0);
  // Healing is not damage: the opening goes on.
  const healCtx=makeCtx(),healCrates=createCrates({seed:1,points:[]}),h=addPlayer(healCtx,'a',0,0,{hp:50});
  healCrates.dropCrate(healCtx,{x:0,y:0},1);
  run(healCtx,healCrates,10);h.hp=60;run(healCtx,healCrates,ticks(1)-9);
  assert.equal(opened(healCtx).length,1);
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

test('prize table: every item exists, weapons at the rarity (never below their minimum), side prizes',()=>{
  const ids=new Map<Rarity,Set<string>>(),grana=new Set<number>(),units=new Set<number>();
  for(const r of [1,2,3,4,5] as Rarity[]){
    ids.set(r,new Set());
    for(let s=0;s<2000;s++){
      const prize=rollPrize(new Rng(s).fork('t'),r);
      for(const item of prize.items){
        ids.get(r)!.add(`${item.id}:${item.level}`);
        if(isConsumableId(item.id))assert.ok(item.level===1||item.level===2);
        else{
          const w=getWeapon(item.id);assert.ok(w?.pattern,`${item.id} is a weapon`);
          const min=NEW_WEAPONS.find(n=>n.id===item.id)?.minRarity??5;
          assert.ok(item.level>=min&&item.level>=Math.min(r,4)||r===5&&item.level===5);
        }
      }
      if(prize.grana)grana.add(prize.grana);
      if(prize.towerUnits)units.add(prize.towerUnits);
      if(r===5)assert.equal(prize.teamXp,LEGENDARY_TEAM_XP);
    }
  }
  assert.deepEqual([...ids.get(1)!].sort(),['coxinha:1','pistola:1']);
  assert.deepEqual([...ids.get(2)!].sort(),['brigadeiro:1','cocada:1','escopeta:2','pacoca:1','submetralhadora:2']);
  assert.deepEqual([...ids.get(3)!].sort(),['brigadeiro:2','cocada:2','escopeta:3','macarico:3','pacoca:2','rifle:3','submetralhadora:3']);
  assert.deepEqual([...ids.get(4)!].sort(),['escopeta:4','kit-torre:1','macarico:4','pistola:4','rifle:4','rojao:4','submetralhadora:4']);
  assert.deepEqual([...ids.get(5)!].sort(),WEAPON_IDS.map(id=>`${legendaryId(id)}:5`).sort());
  assert.deepEqual([...grana].sort((a,b)=>a-b),[GRANA_VERDE,GRANA_DOURADA]);
  assert.deepEqual([...units].sort((a,b)=>a-b),[UNITS_PER_TOKEN/2,UNITS_PER_TOKEN]);
  // Rough odds of the verde row (50/40/10).
  let pistol=0;for(let s=0;s<4000;s++)if(rollPrize(new Rng(s).fork('o'),1).items[0]?.id==='pistola')pistol++;
  assert.ok(pistol>1800&&pistol<2200,`${pistol}`);
});

test('prizes land in the inventory, the overflow on the ground; Grana and fichas go through the hooks',()=>{
  // Lendária: always one weapon, plus team XP.
  const ctx=makeCtx(),crates=createCrates({seed:7,points:[]}),p=addPlayer(ctx,'a',0,0);
  crates.dropCrate(ctx,{x:0,y:0},5);
  run(ctx,crates,1+ticks(3));
  assert.equal(p.build.weapons.length,2);
  assert.match(p.build.weapons[1].id,/-lendario$/);
  assert.equal(p.build.weapons[1].level,5);
  assert.equal(ctx.team.xp,LEGENDARY_TEAM_XP);
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
  // Many verde/azul crates: Grana and tower units reach the hooks with the opener.
  const grana:[string,number][]=[],units:number[]=[];
  const hooks:CrateHooks={addGrana:(_c,pl,amount)=>grana.push([pl.id,amount]),addTowerUnits:(_c,u)=>units.push(u)};
  for(let seed=1;seed<=60&&(!grana.length||!units.length);seed++){
    const c=makeCtx(),cr=createCrates({seed,points:[],hooks});addPlayer(c,'b',0,0);
    for(let i=0;i<4;i++){cr.dropCrate(c,{x:0,y:0},(i%2+1) as Rarity);}
    run(c,cr,ticks(8));
  }
  assert.ok(grana.length&&grana.every(([id,amount])=>id==='b'&&amount===GRANA_VERDE));
  assert.ok(units.length&&units.every(u=>u===UNITS_PER_TOKEN/2));
});

test('an opened placed crate respawns 180 s later on a free point away from every player',()=>{
  const points=line(MAX_CRATES+1),ctx=makeCtx(),crates=createCrates({seed:5,points});
  crates.step(ctx);ctx.tick++;
  const used=new Set(Object.values(crates.state.crates).map(r=>r.point));
  const free=points.findIndex((_,i)=>!used.has(i));
  const [target]=chests(ctx);
  const a=addPlayer(ctx,'a',target.x,target.y);
  const blocker=addPlayer(ctx,'b',points[free].x+RESPAWN_MIN_DIST-.5,0);
  run(ctx,crates,1+ticks(OPEN_SECONDS[target.value-1]));
  assert.equal(opened(ctx).length,1);
  const openTick=ctx.tick-1;
  assert.equal(chests(ctx).length,MAX_CRATES-1);
  assert.deepEqual(crates.state.respawns,[openTick+ticks(RESPAWN_SECONDS)]);
  // Due, but the only free points are next to a player (a stands on the opened point, b near the other): it waits.
  while(ctx.tick<openTick+ticks(RESPAWN_SECONDS)+50)run(ctx,crates,1);
  assert.equal(chests(ctx).length,MAX_CRATES-1,'no point qualifies');
  blocker.x=-1000;
  run(ctx,crates,1);
  const back=chests(ctx).find(c=>c.x===points[free].x);
  assert.ok(back,'came back on the free point away from both players');
  assert.equal(crates.state.crates[back.id].origin,'placed');
  assert.ok([1,2,3,4].includes(back.value));
  assert.equal(chests(ctx).length,MAX_CRATES);
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
  assert.equal(chests(c2).length,MAX_CRATES-1);
  run(c2,cr2,1);
  assert.equal(chests(c2).length,MAX_CRATES);
});

test('elite and boss chests become dropped crates; dropped crates skip the cap and never respawn',()=>{
  const rarities=new Set<number>();
  for(let seed=1;seed<=40;seed++){
    const ctx=makeCtx(seed),crates=createCrates({seed,points:line(MAX_CRATES)});
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
    assert.equal(chests(ctx).length,MAX_CRATES+3,'dropped crates do not count to the cap');
    if(seed===1){
      const p=addPlayer(ctx,'a',boss.x,boss.y);
      run(ctx,crates,1+ticks(3));
      assert.equal(opened(ctx).at(-1)?.value,5);
      assert.match(p.build.weapons[1].id,/-lendario$/);
      assert.deepEqual(crates.state.respawns,[],'a dropped crate never respawns');
    }
  }
  assert.deepEqual([...rarities].sort(),[2,3]);
});

test('deterministic, and a JSON checkpoint resumes exactly like an uninterrupted run',()=>{
  const points=Array.from({length:30},(_,i)=>({x:(i%6)*12,y:Math.floor(i/6)*12,seconds:(i*7)%30}));
  const hooks=(log:string[]):CrateHooks=>({
    addGrana:(c,p,a)=>log.push(`g${c.tick}:${p.id}:${a}`),addTowerUnits:(c,u)=>log.push(`u${c.tick}:${u}`),onNoise:(c,_at,r,s)=>log.push(`n${c.tick}:${s}:${r}`),
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
  const fresh=()=>{const log:string[]=[],ctx=makeCtx(9),crates=createCrates({seed:42,points,hooks:hooks(log)});return {log,ctx,crates};};
  const a=fresh();run(a.ctx,a.crates,total,script(a.crates));
  const again=fresh();run(again.ctx,again.crates,total,script(again.crates));
  assert.equal(digest(again.ctx,again.crates.state,again.log),digest(a.ctx,a.crates.state,a.log),'same seed, same run');
  assert.ok(opened(a.ctx).length>=10,`${opened(a.ctx).length} crates opened`);
  assert.ok(a.log.some(l=>l.startsWith('n')),'some noise');
  assert.ok(opened(a.ctx).some(e=>e.pickup.startsWith(`${CRATE_ID_PREFIX}-`)&&Number(e.pickup.split('-')[1])>MAX_CRATES),'respawned crates came back and were opened');
  const b=fresh();run(b.ctx,b.crates,half,script(b.crates));
  const resumed=createCrates({seed:42,points,hooks:hooks(b.log),state:JSON.parse(JSON.stringify(b.crates.state)) as CratesState});
  run(b.ctx,resumed,total-half,script(resumed));
  assert.equal(digest(b.ctx,resumed.state,b.log),digest(a.ctx,a.crates.state,a.log),'checkpoint resume');
  // Another seed places differently.
  const other=makeCtx(9),otherCrates=createCrates({seed:43,points});otherCrates.step(other);
  const first=makeCtx(9),firstCrates=createCrates({seed:42,points});firstCrates.step(first);
  assert.notDeepEqual(chests(other).map(c=>[c.x,c.y,c.value]),chests(first).map(c=>[c.x,c.y,c.value]));
});
