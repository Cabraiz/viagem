import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,MAX_PASSIVES,MAX_WEAPONS,ticks} from '../src/game/sim/types.ts';
import type {
  EnemyState,ItemDef,ItemKind,LevelOffer,OfferChoice,OwnedItem,PickupKind,PickupState,PlayerBuild,PlayerStats,
  SimContext,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState,
} from '../src/game/sim/types.ts';
import {
  ARM_SECONDS,BASE_CHOICES,HEAL_AMOUNT,HEAL_CHOICE,HELD_DEADLINE,MAX_CHOICES,OFFER_SECONDS,
  applyChoice,isHeldOffer,baseItemId,defaultIndexFor,isEligible,nextLevel,rollChoices,
} from '../src/game/sim/offers.ts';
import type {ItemCatalog} from '../src/game/sim/offers.ts';
import {computeStats} from '../src/game/sim/stats.ts';
import {COLLECT_RADIUS,HOME_ANY,createProgression,createTeamProgress,xpToNext} from '../src/game/sim/progression.ts';
import type {ProgressionOptions,ProgressionState} from '../src/game/sim/progression.ts';

// ---------- Fake catalog ----------
const WEAPONS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio'];
const EVOLUTIONS=['chinelo-evo','boleto-evo','cafe-evo'];
const PASSIVES=['cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao'];

function makeCatalog(extraWeapons:string[]=[]):ItemCatalog{
  const defs:ItemDef[]=[];
  const add=(id:string,kind:ItemKind,maxLevel:number)=>defs.push({
    id,kind,name:id,icon:id,maxLevel,describe:(level:number)=>`Nível ${level}: ${id} fica mais forte`,
  });
  for(const id of [...WEAPONS,...extraWeapons])add(id,'weapon',8);
  for(const id of EVOLUTIONS)add(id,'evolution',1);
  for(const id of PASSIVES)add(id,'passive',5);
  const byId=new Map(defs.map(d=>[d.id,d]));
  return {get:(id:string)=>byId.get(id),all:()=>defs};
}
const catalog=makeCatalog();

// ---------- Fake context ----------
type Mutable<T>={-readonly [K in keyof T]:T[K]};
type FakeCtx=Mutable<SimContext>&{players:Map<string,SimPlayer>;events:SimEvent[];team:TeamProgress;round:RoundState};

function naiveIndex<T extends {x:number;y:number;id:string}>():SpatialIndex<T>{
  let items:T[]=[];
  return {
    rebuild(src){items=[...src];},
    query(x,y,r,out=[]){for(const i of items)if(Math.hypot(i.x-x,i.y-y)<=r)out.push(i);return out;},
    nearest(x,y,r,filter){
      let best:T|undefined,bd=Infinity;
      for(const i of items){const d=Math.hypot(i.x-x,i.y-y);if(d<=r&&d<bd&&(!filter||filter(i))){best=i;bd=d;}}
      return best;
    },
  };
}

function makeCtx(seed=1):FakeCtx{
  let counter=0;
  const events:SimEvent[]=[];
  const ctx:FakeCtx={
    tick:0,
    terrain:{} as never,
    rng:new Rng(seed),
    players:new Map(),
    enemies:new Map(),
    pickups:new Map(),
    projectiles:new Map(),
    telegraphs:new Map(),
    team:createTeamProgress(),
    offers:new Map(),
    round:{index:1,total:10,phase:'wave',phaseEndsTick:0,remaining:0},
    enemyIndex:naiveIndex<EnemyState>(),
    nextId:(prefix:string)=>`${prefix}-${++counter}`,
    emit:(e:SimEvent)=>{events.push(e);},
    damageEnemy:()=>false,
    damagePlayer:()=>{},
    events,
  };
  return ctx;
}

interface PlayerInit {
  x?:number;y?:number;hp?:number;online?:boolean;spectator?:boolean;eliminated?:boolean;downed?:boolean;
  build?:PlayerBuild;stats?:Partial<PlayerStats>;
}
function addPlayer(ctx:FakeCtx,id:string,init:PlayerInit={}):SimPlayer{
  const p:SimPlayer={
    id,classId:'turista',x:init.x??5,y:init.y??5,hp:init.hp??100,online:init.online??true,spectator:init.spectator??false,
    facing:{x:1,y:0},build:init.build??{weapons:[{id:'chinelo',level:1}],passives:[]},
    stats:{...BASE_STATS,...init.stats},weaponReady:{},
  };
  if(init.eliminated)p.eliminated=true;
  if(init.downed)p.downed={sinceTick:0,bleedOutTick:1000,progress:0};
  ctx.players.set(id,p);
  return p;
}
function addPickup(ctx:FakeCtx,kind:PickupKind,x:number,y:number,value=1,extra:Partial<PickupState>={}):PickupState{
  const p:PickupState={id:ctx.nextId(kind),kind,x,y,value,spawnTick:ctx.tick,...extra};
  ctx.pickups.set(p.id,p);
  return p;
}
function makeEnemy(id:string,x:number,y:number,extra:Partial<EnemyState>={}):EnemyState{
  return {id,kind:'pivete',x,y,hp:0,maxHp:10,speed:1,damage:1,radius:.4,xp:3,spawnTick:0,readyTick:0,...extra};
}

function setup(seed=1,opts:Partial<ProgressionOptions>={},state?:ProgressionState){
  const ctx=makeCtx(seed);
  const sim=createProgression({catalog,reachable:()=>true,...opts},state);
  const tick=(n=1)=>{for(let i=0;i<n;i++){ctx.tick++;sim.pickups.step(ctx);sim.progression.step(ctx);}};
  const pickupsOnly=(n=1)=>{for(let i=0;i<n;i++){ctx.tick++;sim.pickups.step(ctx);}};
  return {ctx,sim,tick,pickupsOnly};
}
/** The director opens an intermission of `seconds` (D-021 deadlines follow it). */
function intermission(ctx:FakeCtx,seconds=20){Object.assign(ctx.round,{phase:'prepare',phaseEndsTick:ctx.tick+ticks(seconds)});return ctx.round.phaseEndsTick;}
/** The director starts the next wave. */
function wave(ctx:FakeCtx){Object.assign(ctx.round,{phase:'wave',phaseEndsTick:ctx.tick+ticks(60)});}
/** No round director: the VGM-034 head clock (OFFER_SECONDS) applies. */
function undirected(ctx:FakeCtx){Object.assign(ctx.round,{total:0,phase:'prepare',phaseEndsTick:0});}
function eventsOf<T extends SimEvent['type']>(ctx:FakeCtx,type:T):Extract<SimEvent,{type:T}>[]{
  return ctx.events.filter((e):e is Extract<SimEvent,{type:T}>=>e.type===type);
}
const queue=(ctx:FakeCtx,id:string):LevelOffer[]=>ctx.offers.get(id)??[];
const levelSum=(b:PlayerBuild)=>[...b.weapons,...b.passives].reduce((n,i)=>n+i.level,0);
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const owned=(b:PlayerBuild,id:string):OwnedItem|undefined=>[...b.weapons,...b.passives].find(i=>i.id===id);
function assertValidOffer(o:LevelOffer,build:PlayerBuild){
  assert.ok(o.choices.length>=1&&o.choices.length<=MAX_CHOICES,`choice count ${o.choices.length}`);
  assert.equal(new Set(o.choices.map(c=>c.itemId)).size,o.choices.length,'choices must be distinct');
  for(const c of o.choices)assert.ok(isEligible(catalog,build,c),`ineligible choice ${JSON.stringify(c)}`);
  assert.ok(Number.isInteger(o.defaultIndex)&&o.defaultIndex>=0&&o.defaultIndex<o.choices.length,'defaultIndex in range');
}
function fullBuild():PlayerBuild{
  return {
    weapons:WEAPONS.map(id=>({id,level:8})),
    passives:PASSIVES.slice(0,MAX_PASSIVES).map(id=>({id,level:5})),
  };
}

// ---------- 1. XP curve ----------
test('xpToNext follows the 5 / +10 / +13 / +16 curve and team progress starts at level 1',()=>{
  assert.equal(xpToNext(1),5);
  assert.equal(xpToNext(2),15);
  assert.equal(xpToNext(3),25);
  assert.equal(xpToNext(19),185);
  assert.equal(xpToNext(20),195);
  assert.equal(xpToNext(21),208);
  assert.equal(xpToNext(39),442);
  assert.equal(xpToNext(40),455);
  assert.equal(xpToNext(41),471);
  assert.equal(xpToNext(42),487);
  for(let l=1;l<120;l++){
    assert.ok(Number.isInteger(xpToNext(l)));
    assert.ok(xpToNext(l+1)>xpToNext(l),`curve must grow at ${l}`);
  }
  assert.deepEqual(createTeamProgress(),{xp:0,level:1,nextXp:5});
  assert.notEqual(createTeamProgress(),createTeamProgress(),'fresh object each call');
});

// ---------- 2. Collection ----------
test('two players equidistant from one gem in the same tick collect it exactly once',()=>{
  const {ctx,sim,pickupsOnly}=setup();
  addPlayer(ctx,'b',{x:5,y:5.5});
  addPlayer(ctx,'a',{x:5,y:4.5});
  const gem=addPickup(ctx,'xp',5,5,3);
  pickupsOnly(1);
  assert.equal(ctx.pickups.has(gem.id),false,'pickup deleted');
  assert.equal(ctx.team.xp,3,'team xp added once');
  const ev=eventsOf(ctx,'pickup');
  assert.equal(ev.length,1);
  assert.deepEqual(ev[0],{type:'pickup',player:'a',pickup:gem.id,kind:'xp',value:3},'tie goes to lowest player id');
  pickupsOnly(5);
  assert.equal(ctx.team.xp,3);
  assert.equal(eventsOf(ctx,'pickup').length,1);
  void sim;
});

test('many gems around two players: total xp conserved and each gem collected once',()=>{
  const {ctx,pickupsOnly}=setup();
  addPlayer(ctx,'a',{x:6,y:6});
  addPlayer(ctx,'b',{x:6.4,y:6});
  let total=0;
  const ids:string[]=[];
  for(let i=0;i<30;i++){
    const v=1+(i%4);total+=v;
    ids.push(addPickup(ctx,'xp',6.2+Math.cos(i)*.5,6+Math.sin(i)*.5,v).id);
  }
  pickupsOnly(60);
  assert.equal(ctx.pickups.size,0);
  assert.equal(ctx.team.xp,total);
  const ev=eventsOf(ctx,'pickup');
  assert.equal(ev.length,30);
  assert.deepEqual(ev.map(e=>e.pickup).sort(),[...ids].sort());
  assert.equal(ev.reduce((n,e)=>n+e.value,0),total,'events report collected value');
});

test('growth multiplier comes from the collector stats',()=>{
  const {ctx,pickupsOnly}=setup();
  addPlayer(ctx,'a',{x:5,y:5,stats:{growth:1.5}});
  addPlayer(ctx,'b',{x:15,y:15,stats:{growth:3}});
  addPickup(ctx,'xp',5,5,4);
  pickupsOnly(1);
  assert.equal(ctx.team.xp,6);
});

// ---------- 3. Who collects, heal, magnet, chest, resource ----------
test('downed, spectator, offline and eliminated players never collect nor attract pickups',()=>{
  const {ctx,pickupsOnly}=setup();
  const spots:[string,PlayerInit][]=[
    ['d',{x:3,y:3,downed:true}],['s',{x:8,y:3,spectator:true}],['o',{x:3,y:8,online:false}],['e',{x:8,y:8,eliminated:true}],
  ];
  const gems:PickupState[]=[];
  for(const [id,init] of spots){
    addPlayer(ctx,id,{...init,hp:50});
    gems.push(addPickup(ctx,'xp',init.x!,init.y!,2));
    gems.push(addPickup(ctx,'heal',init.x!+.2,init.y!,20));
    gems.push(addPickup(ctx,'xp',init.x!+1,init.y!,2));
  }
  pickupsOnly(40);
  assert.equal(ctx.team.xp,0);
  assert.equal(eventsOf(ctx,'pickup').length,0);
  for(const g of gems){
    const now=ctx.pickups.get(g.id);
    assert.ok(now,`pickup ${g.id} kept`);
    assert.equal(now.homing,undefined);
  }
  for(const p of ctx.players.values())assert.equal(p.hp,50);
});

test('heal caps at stats.maxHp',()=>{
  const {ctx,pickupsOnly}=setup();
  const a=addPlayer(ctx,'a',{x:5,y:5,hp:90});
  const b=addPlayer(ctx,'b',{x:15,y:15,hp:90,stats:{maxHp:150}});
  addPickup(ctx,'heal',5,5,30);
  addPickup(ctx,'heal',15,15,30);
  pickupsOnly(1);
  assert.equal(a.hp,100);
  assert.equal(b.hp,120);
  assert.deepEqual(eventsOf(ctx,'pickup').map(e=>e.kind),['heal','heal']);
});

test('magnet makes every xp gem home to the collector until collected; resource untouched',()=>{
  const {ctx,pickupsOnly}=setup();
  addPlayer(ctx,'a',{x:5,y:5});
  addPlayer(ctx,'z',{x:20,y:2,online:false});
  const mag=addPickup(ctx,'magnet',5,5,1);
  const far=[addPickup(ctx,'xp',18,18,2),addPickup(ctx,'xp',2,20,3),addPickup(ctx,'xp',20,3,5)];
  const heal=addPickup(ctx,'heal',19,19,10);
  const res=addPickup(ctx,'resource',5,5,1,{resource:'madeira'});
  pickupsOnly(1);
  assert.equal(ctx.pickups.has(mag.id),false);
  for(const g of far)assert.equal(ctx.pickups.get(g.id)?.homing,'a',`${g.id} homing to collector`);
  assert.equal(ctx.pickups.get(heal.id)?.homing,undefined,'magnet only pulls xp');
  pickupsOnly(120);
  for(const g of far)assert.equal(ctx.pickups.has(g.id),false,`${g.id} eventually collected`);
  assert.equal(ctx.team.xp,10);
  assert.ok(ctx.pickups.has(heal.id));
  const r=ctx.pickups.get(res.id);
  assert.ok(r,'resource kept');
  assert.deepEqual(r,{...res},'resource not moved nor marked');
  assert.ok(!eventsOf(ctx,'pickup').some(e=>e.pickup===res.id));
});

test('chest goes to the VGM-036 opener while still in ctx.pickups, once, and only if it opened (D-006)',()=>{
  {
    // Default opener (real openChest): consumes the chest and upgrades the build.
    const {ctx,pickupsOnly}=setup();
    const a=addPlayer(ctx,'a',{x:5,y:5});
    (a as SimPlayer&{classBonus?:Partial<PlayerStats>}).classBonus={might:1.1};
    const chest=addPickup(ctx,'chest',5,5,1);
    pickupsOnly(20);
    assert.equal(ctx.pickups.has(chest.id),false);
    assert.equal(a.build.weapons[0].level,2,'chest reward applied');
    assert.equal(eventsOf(ctx,'pickup').filter(e=>e.kind==='chest').length,1);
  }
  {
    // The class kit is no longer an option: the opener reads SimPlayer.classBonus itself. The chest gets
    // progression's own stream so its rolls do not depend on other systems' draws from ctx.rng.
    const calls:{player:string;present:boolean;keys:string[];rngIsStream:boolean;runStartTick:number|undefined}[]=[];
    const {ctx,pickupsOnly}=setup(1,{openChest:(c,p,id,o)=>{
      calls.push({player:p.id,present:c.pickups.has(id),keys:Object.keys(o).sort(),rngIsStream:o.rng instanceof Rng&&o.rng!==c.rng,runStartTick:o.runStartTick});
      c.pickups.delete(id);return {kind:'heal',pickup:'x'};
    }});
    (ctx as FakeCtx&{runStartTick?:number}).runStartTick=7;
    addPlayer(ctx,'b',{x:5,y:5.5});
    const a=addPlayer(ctx,'a',{x:5,y:4.5});
    (a as SimPlayer&{classBonus?:Partial<PlayerStats>}).classBonus={area:1.2};
    const chest=addPickup(ctx,'chest',5,5,1);
    pickupsOnly(20);
    assert.deepEqual(calls,[{player:'a',present:true,keys:['rng','runStartTick'],rngIsStream:true,runStartTick:7}]);
    assert.equal(ctx.pickups.has(chest.id),false);
    const ev=eventsOf(ctx,'pickup');
    assert.equal(ev.length,1);
    assert.equal(ev[0].kind,'chest');
  }
  {
    // Opener refuses (null): chest stays, no event, retried later.
    let allow=false,calls=0;
    const {ctx,pickupsOnly}=setup(1,{openChest:(c,_p,id)=>{calls++;if(!allow)return null;c.pickups.delete(id);return {kind:'heal',pickup:'x'};}});
    addPlayer(ctx,'a',{x:5,y:5});
    const chest=addPickup(ctx,'chest',5,5,1);
    pickupsOnly(5);
    assert.ok(ctx.pickups.has(chest.id));
    assert.equal(eventsOf(ctx,'pickup').length,0);
    allow=true;pickupsOnly(5);
    assert.equal(ctx.pickups.has(chest.id),false);
    assert.equal(eventsOf(ctx,'pickup').length,1);
    assert.equal(calls,6);
  }
});

test('real chest rolls ignore ctx.rng and progression draws, survive reset and keep the class kit (D-005/D-006)',()=>{
  const bonus={might:0.5,maxHp:20};
  const passives=()=>['marmita','oculos','bone','tenis','ima'].map(id=>({id,level:1}));
  /** Two chests opened by the real opener in the same tick; `burn` draws from ctx.rng, `offers` draws from progression's stream. */
  const roll=(opts:{seed?:number;burn?:number;offers?:boolean;resetFirst?:boolean})=>{
    const {ctx,sim,pickupsOnly}=setup(1,opts.seed===undefined?{}:{seed:opts.seed});
    const a=addPlayer(ctx,'a',{x:5,y:5,build:{weapons:[],passives:passives()}});
    (a as SimPlayer&{classBonus?:Partial<PlayerStats>}).classBonus=bonus;
    if(opts.resetFirst){
      const warm=addPickup(ctx,'chest',5,5,1);
      pickupsOnly(1);
      assert.equal(ctx.pickups.has(warm.id),false);
      sim.reset();a.build={weapons:[],passives:passives()};ctx.events.length=0;
    }
    if(opts.offers){sim.grantLevelOffers(ctx,2);sim.grantLevelOffers(ctx,3);}
    for(let i=0;i<(opts.burn??0);i++)ctx.rng.next();
    const c1=addPickup(ctx,'chest',5,5,1,{id:'chest-a'}),c2=addPickup(ctx,'chest',5,5.1,1,{id:'chest-b'});
    pickupsOnly(1);
    assert.ok(!ctx.pickups.has(c1.id)&&!ctx.pickups.has(c2.id),'both chests opened in the same tick');
    assert.deepEqual(a.stats,computeStats(a.build,bonus),'passive upgrade recomputed with SimPlayer.classBonus');
    return clone({build:a.build,upgrades:eventsOf(ctx,'upgrade')});
  };
  const seeded=roll({seed:42});
  assert.ok(seeded.upgrades.length>=2);
  for(const burn of [1,9,40])assert.deepEqual(roll({seed:42,burn}),seeded,`ctx.rng burn ${burn}`);
  assert.deepEqual(roll({seed:42,offers:true}),seeded,'progression draws (offers) do not shift chest rolls');
  assert.deepEqual(roll({seed:42,offers:true,burn:7}),seeded);
  assert.deepEqual(roll({seed:42,resetFirst:true}),seeded,'reset restarts the chest stream from the seed');
  // Without a seed the chest stream is forked from ctx.rng once; progression draws still do not shift it.
  assert.deepEqual(roll({offers:true}),roll({}));
  // Sanity: the seed does matter, so the equalities above are meaningful.
  assert.ok(new Set([1,2,3,4,5,6,7,8].map(seed=>JSON.stringify(roll({seed})))).size>1);
});

test('a choice refreshes stats by default with the player class bonus (D-005)',()=>{
  const {ctx,sim,tick}=setup(1,{});
  const a=addPlayer(ctx,'a',{build:{weapons:[{id:'chinelo',level:1}],passives:[]}});
  (a as SimPlayer&{classBonus?:Partial<PlayerStats>}).classBonus={might:1.25};
  ctx.team.xp=5;tick(1);
  const head=queue(ctx,'a')[0];
  assert.ok(sim.choose(ctx,'a',head.id,0).ok);
  assert.deepEqual(a.stats,computeStats(a.build,{might:1.25}),'stats recomputed from the new build with the class bonus');
  assert.ok(a.stats.might>=2.25-1e-9,'class bonus delta kept');
});

test('homing target lost: re-target to nearest collector, or freeze when none; expired idle pickups vanish',()=>{
  const {ctx,pickupsOnly}=setup();
  const a=addPlayer(ctx,'a',{x:5,y:5});
  const b=addPlayer(ctx,'b',{x:20,y:20,online:false});
  const gem=addPickup(ctx,'xp',10,5,2,{homing:'a'});
  pickupsOnly(1);
  const moved=ctx.pickups.get(gem.id)!;
  assert.ok(moved.x<10,'homing gem moves toward its player');
  a.online=false;
  pickupsOnly(1);
  const after=ctx.pickups.get(gem.id)!;
  const x=after.x,y=after.y;
  pickupsOnly(3);
  assert.ok(ctx.pickups.has(gem.id),'xp never lost while nobody can collect');
  assert.equal(ctx.pickups.get(gem.id)?.x,x,'no movement without a collector');
  assert.equal(ctx.pickups.get(gem.id)?.y,y);
  assert.equal(ctx.team.xp,0);
  b.online=true;
  pickupsOnly(1);
  assert.equal(ctx.pickups.get(gem.id)?.homing,'b','re-targeted to the remaining collector at any distance');
  pickupsOnly(60);
  assert.equal(ctx.pickups.has(gem.id),false);
  assert.equal(ctx.team.xp,2);
  assert.equal(eventsOf(ctx,'pickup').find(e=>e.pickup===gem.id)?.player,'b');
  b.online=false;b.x=30;b.y=30;
  const exp=addPickup(ctx,'xp',15,15,2,{expiresTick:ctx.tick+3});
  const expHoming=addPickup(ctx,'xp',15,2,2,{expiresTick:ctx.tick+1});
  a.online=true;a.x=2;a.y=2;
  ctx.pickups.get(expHoming.id)!.homing='a';
  pickupsOnly(4);
  assert.equal(ctx.pickups.has(exp.id),false,'expired pickup removed');
  assert.ok(ctx.pickups.has(expHoming.id),'homing pickup is not expired (13 units away, 4 ticks of homing)');
  assert.equal(ctx.team.xp,2,'expired gem gave no xp');
  pickupsOnly(40);
  assert.equal(ctx.pickups.has(expHoming.id),false);
  assert.equal(ctx.team.xp,4,'expired-but-homing gem still delivered');
});

// ---------- 4. Level-ups and offers ----------
test('two level-ups in one tick produce two queued offers per eligible player, oldest first',()=>{
  const {ctx,tick}=setup();
  addPlayer(ctx,'a');
  addPlayer(ctx,'b',{online:false});
  addPlayer(ctx,'c',{downed:true});
  addPlayer(ctx,'s',{spectator:true});
  addPlayer(ctx,'e',{eliminated:true});
  ctx.team.xp=xpToNext(1)+xpToNext(2);
  tick(1);
  assert.deepEqual({...ctx.team},{xp:0,level:3,nextXp:xpToNext(3)});
  assert.deepEqual(eventsOf(ctx,'levelup').map(e=>e.level),[2,3]);
  for(const id of ['a','b','c']){
    const q=queue(ctx,id);
    assert.deepEqual(q.map(o=>o.id),[`lvl-2-${id}`,`lvl-3-${id}`]);
    assert.deepEqual(q.map(o=>o.level),[2,3]);
    for(const o of q){
      assert.ok(o.id.startsWith('lvl-'));
      assert.equal(o.playerId,id);
      assert.equal(o.source,'level');
      assert.equal(o.choices.length,BASE_CHOICES);
      assertValidOffer(o,ctx.players.get(id)!.build);
      assert.ok(Number.isInteger(o.deadlineTick));
    }
    assert.ok(q.every(isHeldOffer),'D-021: level offers granted in combat wait for the intermission');
  }
  assert.equal(ctx.offers.has('s'),false);
  assert.equal(ctx.offers.has('e'),false);
  const offerEv=eventsOf(ctx,'offer');
  assert.deepEqual(offerEv.map(e=>`${e.player}:${e.offer}`).sort(),
    ['a:lvl-2-a','a:lvl-3-a','b:lvl-2-b','b:lvl-3-b','c:lvl-2-c','c:lvl-3-c']);
  assert.deepEqual(clone(Object.fromEntries(ctx.offers)),Object.fromEntries(ctx.offers),'offers JSON-safe');
});

test('xp just below the threshold does not level; leftover xp carries over',()=>{
  const {ctx,tick}=setup();
  addPlayer(ctx,'a');
  ctx.team.xp=4;
  tick(1);
  assert.equal(ctx.team.level,1);
  assert.equal(ctx.offers.size,0);
  ctx.team.xp=5+7;
  tick(1);
  assert.deepEqual({...ctx.team},{xp:7,level:2,nextXp:15});
});

test('high luck yields a fourth choice; luck 1 always three',()=>{
  for(let seed=1;seed<=20;seed++){
    const build:PlayerBuild={weapons:[{id:'chinelo',level:1}],passives:[]};
    const lucky=rollChoices(catalog,build,1e9,new Rng(seed));
    assert.equal(lucky.length,MAX_CHOICES);
    const plain=rollChoices(catalog,build,1,new Rng(seed));
    assert.equal(plain.length,BASE_CHOICES);
    for(const cs of [lucky,plain]){
      assert.equal(new Set(cs.map(c=>c.itemId)).size,cs.length);
      for(const c of cs)assert.ok(isEligible(catalog,build,c));
    }
  }
  const {ctx,tick}=setup();
  addPlayer(ctx,'a',{stats:{luck:1e9}});
  addPlayer(ctx,'b');
  ctx.team.xp=5;
  tick(1);
  assert.equal(queue(ctx,'a')[0].choices.length,MAX_CHOICES);
  assert.equal(queue(ctx,'b')[0].choices.length,BASE_CHOICES);
});

test('rollChoices is deterministic for the same rng state and never pads with heal when candidates exist',()=>{
  const build:PlayerBuild={weapons:[{id:'chinelo',level:3},{id:'boleto',level:1}],passives:[{id:'tenis',level:2}]};
  assert.deepEqual(rollChoices(catalog,build,1,new Rng(99)),rollChoices(catalog,build,1,new Rng(99)));
  // Only two candidates left: chinelo upgrade and marmita upgrade.
  const narrow:PlayerBuild={
    weapons:[{id:'chinelo',level:7},...WEAPONS.slice(1).map(id=>({id,level:8}))],
    passives:[{id:'marmita',level:4},...PASSIVES.filter(id=>id!=='marmita').slice(0,MAX_PASSIVES-1).map(id=>({id,level:5}))],
  };
  for(let seed=0;seed<10;seed++){
    const cs=rollChoices(catalog,narrow,1e9,new Rng(seed));
    assert.deepEqual(cs.map(c=>`${c.itemId}@${c.level}`).sort(),['chinelo@8','marmita@5']);
  }
});

test('defaultIndexFor prefers upgrading an owned item, else 0',()=>{
  const build:PlayerBuild={weapons:[{id:'chinelo',level:2}],passives:[{id:'tenis',level:1}]};
  assert.equal(defaultIndexFor(build,[{itemId:'boleto',level:1},{itemId:'tenis',level:2},{itemId:'chinelo',level:3}]),1);
  assert.equal(defaultIndexFor(build,[{itemId:'boleto',level:1},{itemId:'cafe',level:1}]),0);
});

// ---------- 5. Round offers ----------
test('grantRoundOffers: rnd- ids, round source, idempotent, prepare deadline',()=>{
  const {ctx,sim}=setup();
  addPlayer(ctx,'a');addPlayer(ctx,'b',{online:false});addPlayer(ctx,'s',{spectator:true});
  ctx.tick=100;
  ctx.round.phase='prepare';ctx.round.phaseEndsTick=100+ticks(30);
  const first=sim.grantRoundOffers(ctx,2);
  assert.deepEqual(first.map(o=>o.id).sort(),['rnd-2-a','rnd-2-b']);
  sim.grantRoundOffers(ctx,2);
  for(const id of ['a','b']){
    const q=queue(ctx,id);
    assert.equal(q.length,1,'no duplicate round offer');
    assert.equal(q[0].id,`rnd-2-${id}`);
    assert.equal(q[0].source,'round');
    assert.equal(q[0].deadlineTick,100+ticks(30));
    assertValidOffer(q[0],ctx.players.get(id)!.build);
  }
  assert.equal(ctx.offers.has('s'),false);
  assert.equal(eventsOf(ctx,'offer').length,2);
  assert.equal(sim.state.lastRoundGranted,2);
  // Persisted state survives a rebuild of the progression module.
  const resumed=createProgression({catalog,reachable:()=>true},clone(sim.state));
  ctx.offers.clear();
  assert.deepEqual(resumed.grantRoundOffers(ctx,2),[]);
  assert.equal(ctx.offers.size,0);
});

test('grantRoundOffers deadline defaults and explicit deadline',()=>{
  {
    const {ctx,sim}=setup();
    addPlayer(ctx,'a');
    ctx.tick=500;ctx.round.phase='wave';ctx.round.phaseEndsTick=900;
    sim.grantRoundOffers(ctx,1);
    assert.equal(queue(ctx,'a')[0].deadlineTick,500+ticks(20),'wave phase -> tick+20s');
  }
  {
    const {ctx,sim}=setup();
    addPlayer(ctx,'a');
    ctx.tick=500;ctx.round.phase='prepare';ctx.round.phaseEndsTick=400;
    sim.grantRoundOffers(ctx,1);
    assert.equal(queue(ctx,'a')[0].deadlineTick,500+ticks(20),'past phaseEndsTick ignored');
  }
  {
    const {ctx,sim}=setup();
    addPlayer(ctx,'a');
    ctx.tick=500;ctx.round.phase='prepare';ctx.round.phaseEndsTick=900;
    sim.grantRoundOffers(ctx,4,500+ticks(45));
    assert.equal(queue(ctx,'a')[0].deadlineTick,500+ticks(45));
  }
});

test('grantLevelOffers is idempotent per level',()=>{
  const {ctx,sim}=setup();
  addPlayer(ctx,'a');
  sim.grantLevelOffers(ctx,2);
  assert.deepEqual(sim.grantLevelOffers(ctx,2),[]);
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-2-a']);
  assert.equal(sim.state.lastLevelGranted,2);
});

// ---------- 6. choose ----------
test('choose rejects forged, out-of-order, bad-index and unknown-player requests',()=>{
  const {ctx,sim,tick}=setup();
  const a=addPlayer(ctx,'a');
  addPlayer(ctx,'b');
  ctx.team.xp=20;
  tick(1);
  const before=clone(a.build);
  assert.deepEqual(sim.choose(ctx,'a','lvl-99-a',0),{ok:false,reason:'unknown-offer'});
  assert.deepEqual(sim.choose(ctx,'a','lvl-2-b',0),{ok:false,reason:'unknown-offer'},'cannot pick another player offer');
  assert.deepEqual(sim.choose(ctx,'a','lvl-3-a',0),{ok:false,reason:'not-oldest'});
  const n=queue(ctx,'a')[0].choices.length;
  for(const idx of [-1,1.5,99,NaN,n,Infinity,-0.5]){
    assert.deepEqual(sim.choose(ctx,'a','lvl-2-a',idx),{ok:false,reason:'bad-index'},`index ${idx}`);
  }
  assert.deepEqual(sim.choose(ctx,'zz','lvl-2-a',0),{ok:false,reason:'no-player'});
  assert.deepEqual(a.build,before,'nothing applied');
  assert.equal(queue(ctx,'a').length,2);
  assert.equal(eventsOf(ctx,'upgrade').length,0);
  const empty=setup();
  addPlayer(empty.ctx,'a');
  assert.deepEqual(empty.sim.choose(empty.ctx,'a','lvl-2-a',0),{ok:false,reason:'no-offer'});
});

test('choose applies once: new weapon at level 1, then upgrade; repeats fail',()=>{
  const built:string[]=[];
  const {ctx,sim,tick}=setup(1,{onBuildChange:(_c,p)=>{built.push(p.id);}});
  const a=addPlayer(ctx,'a',{build:{weapons:[{id:'chinelo',level:1}],passives:[]}});
  ctx.team.xp=20;
  tick(1);
  const [o1,o2]=queue(ctx,'a');
  o1.choices=[{itemId:'boleto',level:1},{itemId:'chinelo',level:2},{itemId:'marmita',level:1}];o1.defaultIndex=1;
  o2.choices=[{itemId:'tenis',level:1},{itemId:'chinelo',level:2},{itemId:'cafe',level:1}];o2.defaultIndex=1;
  assert.deepEqual(sim.choose(ctx,'a',o1.id,0),{ok:true,itemId:'boleto',level:1});
  assert.deepEqual(owned(a.build,'boleto'),{id:'boleto',level:1});
  assert.ok(a.build.weapons.some(w=>w.id==='boleto'),'weapon goes to weapons');
  assert.equal(levelSum(a.build),2);
  const r=sim.choose(ctx,'a',o1.id,0);
  assert.equal(r.ok,false);
  assert.ok(!r.ok&&(r.reason==='unknown-offer'||r.reason==='no-offer'));
  assert.equal(levelSum(a.build),2,'repeat did not apply');
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-3-a']);
  assert.deepEqual(sim.choose(ctx,'a','lvl-3-a',1),{ok:true,itemId:'chinelo',level:2});
  assert.equal(owned(a.build,'chinelo')?.level,2);
  assert.equal(a.build.weapons.filter(w=>w.id==='chinelo').length,1,'upgrade does not duplicate');
  const r2=sim.choose(ctx,'a','lvl-3-a',1);
  assert.ok(!r2.ok&&(r2.reason==='unknown-offer'||r2.reason==='no-offer'));
  assert.equal(owned(a.build,'chinelo')?.level,2);
  assert.equal(ctx.offers.has('a'),false,'empty queue entry deleted');
  assert.deepEqual(eventsOf(ctx,'upgrade'),[
    {type:'upgrade',player:'a',item:'boleto',level:1},
    {type:'upgrade',player:'a',item:'chinelo',level:2},
  ]);
  assert.deepEqual(built,['a','a']);
  tick(ticks(OFFER_SECONDS)*3);
  assert.equal(eventsOf(ctx,'upgrade').length,2,'no late default after manual choice');
});

test('without a director, after the head is chosen the next offer is rearmed with a fresh deadline',()=>{
  const {ctx,sim,tick}=setup();
  undirected(ctx);
  addPlayer(ctx,'a');
  ctx.team.xp=20;
  tick(1);
  tick(ticks(OFFER_SECONDS)-20);
  assert.ok(sim.choose(ctx,'a','lvl-2-a',0).ok);
  tick(1);
  assert.ok(queue(ctx,'a')[0].deadlineTick>=ctx.tick-1+ticks(OFFER_SECONDS));
});

// ---------- 7. Eligibility ----------
test('nextLevel / isEligible respect slots, max levels and evolutions',()=>{
  assert.equal(baseItemId('chinelo-evo'),'chinelo');
  assert.equal(baseItemId('chinelo'),'chinelo');
  const empty:PlayerBuild={weapons:[],passives:[]};
  assert.equal(nextLevel(catalog,empty,'chinelo'),1);
  assert.equal(nextLevel(catalog,empty,'marmita'),1);
  assert.equal(nextLevel(catalog,empty,'chinelo-evo'),undefined,'evolutions are not offerable');
  assert.equal(nextLevel(catalog,empty,'nao-existe'),undefined);
  assert.equal(nextLevel(catalog,{weapons:[{id:'chinelo',level:8}],passives:[]},'chinelo'),undefined);
  assert.equal(nextLevel(catalog,{weapons:[{id:'chinelo',level:7}],passives:[]},'chinelo'),8);
  assert.equal(nextLevel(catalog,{weapons:[],passives:[{id:'marmita',level:5}]},'marmita'),undefined);
  assert.equal(nextLevel(catalog,{weapons:[{id:'chinelo-evo',level:1}],passives:[]},'chinelo'),undefined);
  assert.equal(isEligible(catalog,empty,{itemId:'chinelo',level:2}),false,'level must be exactly next');
  assert.equal(isEligible(catalog,empty,{itemId:'chinelo',level:1}),true);
  assert.equal(isEligible(catalog,fullBuild(),{itemId:HEAL_CHOICE,level:1}),true);

  const wide=makeCatalog(['vassoura']);
  const sixWeapons:PlayerBuild={weapons:WEAPONS.map(id=>({id,level:1})),passives:[]};
  assert.equal(sixWeapons.weapons.length,MAX_WEAPONS);
  assert.equal(nextLevel(wide,sixWeapons,'vassoura'),undefined,'no free weapon slot');
  const sixPassives:PlayerBuild={weapons:[],passives:PASSIVES.slice(0,MAX_PASSIVES).map(id=>({id,level:1}))};
  for(const id of PASSIVES.slice(MAX_PASSIVES))assert.equal(nextLevel(catalog,sixPassives,id),undefined);

  const maxed:PlayerBuild={weapons:[{id:'chinelo-evo',level:1},{id:'boleto',level:8}],passives:[{id:'marmita',level:5}]};
  for(let seed=0;seed<200;seed++){
    for(const c of rollChoices(wide,sixWeapons,1e9,new Rng(seed))){
      assert.notEqual(c.itemId,'vassoura');
      assert.ok(isEligible(wide,sixWeapons,c));
    }
    for(const c of rollChoices(catalog,maxed,1e9,new Rng(seed))){
      assert.ok(!['chinelo','boleto','marmita'].includes(c.itemId),`offered ${c.itemId}`);
      assert.ok(!c.itemId.endsWith('-evo'),'evolution offered');
      assert.ok(isEligible(catalog,maxed,c));
    }
    for(const c of rollChoices(catalog,{weapons:[],passives:[]},1,new Rng(seed))){
      assert.ok(!EVOLUTIONS.includes(c.itemId));
      assert.equal(c.level,1);
    }
  }
});

test('applyChoice mutates the build and rejects ineligible choices',()=>{
  const ctx=makeCtx();
  const p=addPlayer(ctx,'a',{build:{weapons:[{id:'chinelo',level:1}],passives:[]}});
  assert.equal(applyChoice(catalog,p,{itemId:'chinelo',level:3}),false);
  assert.equal(applyChoice(catalog,p,{itemId:'chinelo-evo',level:1}),false);
  assert.deepEqual(p.build,{weapons:[{id:'chinelo',level:1}],passives:[]});
  assert.equal(applyChoice(catalog,p,{itemId:'chinelo',level:2}),true);
  assert.equal(applyChoice(catalog,p,{itemId:'ima',level:1}),true);
  assert.deepEqual(p.build,{weapons:[{id:'chinelo',level:2}],passives:[{id:'ima',level:1}]});
});

test('full build gets a single heal choice that heals by HEAL_AMOUNT (capped)',()=>{
  assert.equal(HEAL_AMOUNT,30);
  assert.deepEqual(rollChoices(catalog,fullBuild(),1e9,new Rng(3)),[{itemId:HEAL_CHOICE,level:1}]);
  const {ctx,sim,tick}=setup();
  const a=addPlayer(ctx,'a',{hp:50,build:fullBuild()});
  const b=addPlayer(ctx,'b',{hp:90,build:fullBuild()});
  ctx.team.xp=5;
  tick(1);
  for(const id of ['a','b']){
    const q=queue(ctx,id);
    assert.equal(q.length,1);
    assert.deepEqual(q[0].choices,[{itemId:HEAL_CHOICE,level:1}]);
    assert.equal(q[0].defaultIndex,0);
  }
  const snapshot=clone(a.build);
  assert.deepEqual(sim.choose(ctx,'a','lvl-2-a',0),{ok:true,itemId:HEAL_CHOICE,level:1});
  assert.equal(a.hp,80);
  assert.deepEqual(a.build,snapshot);
  assert.ok(sim.choose(ctx,'b','lvl-2-b',0).ok);
  assert.equal(b.hp,100,'heal capped at maxHp');
  assert.equal(eventsOf(ctx,'upgrade').length,0,'coxinha is not an item upgrade');
  assert.deepEqual(eventsOf(ctx,'pickup'),[
    {type:'pickup',player:'a',pickup:'lvl-2-a',kind:'heal',value:HEAL_AMOUNT},
    {type:'pickup',player:'b',pickup:'lvl-2-b',kind:'heal',value:HEAL_AMOUNT},
  ]);
});

test('stale choice is rejected as ineligible and the head is re-rolled on the next step',()=>{
  const {ctx,sim,tick}=setup();
  const a=addPlayer(ctx,'a',{build:{weapons:[{id:'chinelo',level:1}],passives:[]}});
  ctx.team.xp=5;
  tick(1);
  const head=queue(ctx,'a')[0],originalId=head.id;
  head.choices=[{itemId:'chinelo',level:2},{itemId:'boleto',level:1},{itemId:'marmita',level:1}];
  head.defaultIndex=0;
  a.build.weapons[0].level=2; // build changed after the roll (e.g. evolution/chest)
  assert.deepEqual(sim.choose(ctx,'a',head.id,0),{ok:false,reason:'ineligible'});
  assert.equal(a.build.weapons[0].level,2);
  assert.equal(eventsOf(ctx,'upgrade').length,0);
  tick(1);
  const q=queue(ctx,'a');
  assert.equal(q.length,1);
  assert.ok(q[0].id.startsWith(originalId+'~'),'re-roll gets a new id with the same origin prefix');
  assert.equal(eventsOf(ctx,'offer').at(-1)?.offer,q[0].id);
  assert.deepEqual(sim.choose(ctx,'a',originalId,0),{ok:false,reason:'unknown-offer'},'a pick against the old cards is refused');
  assertValidOffer(q[0],a.build);
  // Same thing when the stale item reached max level.
  a.build.weapons[0].level=8;
  const stale=queue(ctx,'a')[0];
  stale.choices=[{itemId:'boleto',level:1},{itemId:'chinelo',level:9}];
  tick(1);
  assertValidOffer(queue(ctx,'a')[0],a.build);
  assert.ok(!queue(ctx,'a')[0].choices.some(c=>c.itemId==='chinelo'));
});

// ---------- 8. Deadlines, offline, reconnection ----------
test('D-021: level offers wait through combat and get their default once at the end of the next intermission',()=>{
  const {ctx,sim,tick}=setup();
  const a=addPlayer(ctx,'a');
  ctx.team.xp=20;
  tick(1);
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-2-a','lvl-3-a']);
  const startSum=levelSum(a.build);
  tick(ticks(OFFER_SECONDS)*30);
  assert.equal(eventsOf(ctx,'upgrade').length,0,'never a default in combat, however long the wave');
  assert.ok(queue(ctx,'a').every(isHeldOffer));
  // Round ends: the intermission arms every held offer with its end; the round offer joins behind them.
  const ends=intermission(ctx);
  sim.grantRoundOffers(ctx,1,ends);
  tick(1);
  assert.deepEqual(queue(ctx,'a').map(o=>[o.id,o.deadlineTick]),[['lvl-2-a',ends],['lvl-3-a',ends],['rnd-1-a',ends]]);
  const expected=queue(ctx,'a').map(o=>clone(o.choices[o.defaultIndex]));
  while(ctx.tick<ends-1)tick(1);
  assert.equal(eventsOf(ctx,'upgrade').length,0,'not before the end of the intermission');
  tick(1);
  assert.equal(ctx.tick,ends);
  // All three in the same tick, oldest first; a card made stale by the pick before it is re-rolled, never lost.
  const ups=eventsOf(ctx,'upgrade');
  assert.equal(ups.length+eventsOf(ctx,'pickup').filter(e=>e.kind==='heal').length,3,'three defaults, one per offer');
  assert.deepEqual(ups[0],{type:'upgrade',player:'a',item:expected[0].itemId,level:expected[0].level});
  assert.equal(levelSum(a.build),startSum+3);
  assert.equal(ctx.offers.has('a'),false,'queue empty when the wave starts');
  wave(ctx);
  tick(ticks(OFFER_SECONDS)*3);
  assert.equal(eventsOf(ctx,'upgrade').length,ups.length,'default never applied twice');
});

test('D-021: same default twice in the queue: the second is re-rolled at the deadline instead of being lost',()=>{
  const {ctx,sim,tick}=setup();
  const a=addPlayer(ctx,'a',{build:{weapons:[{id:'chinelo',level:1}],passives:[]}});
  sim.grantLevelOffers(ctx,2);sim.grantLevelOffers(ctx,3);
  for(const o of queue(ctx,'a')){o.choices=[{itemId:'chinelo',level:2},{itemId:'boleto',level:1}];o.defaultIndex=0;}
  const ends=intermission(ctx,20);
  tick(ticks(20));
  assert.equal(ctx.tick,ends);
  const ups=eventsOf(ctx,'upgrade');
  assert.equal(ups.length,2,'both offers applied');
  assert.deepEqual(ups[0],{type:'upgrade',player:'a',item:'chinelo',level:2});
  assert.notDeepEqual(ups[1],{type:'upgrade',player:'a',item:'chinelo',level:2},'second pick is a fresh card');
  assert.equal(levelSum(a.build),3);
  assert.ok(eventsOf(ctx,'offer').some(e=>e.offer.startsWith('lvl-3-a~')),'re-roll announced');
});

test('D-021: a level offer granted with at least ARM_SECONDS left is due at the end of this intermission; later, at the next one',()=>{
  const {ctx,sim,tick}=setup();
  addPlayer(ctx,'a');
  const ends=intermission(ctx,20);
  sim.grantLevelOffers(ctx,2);
  assert.equal(queue(ctx,'a')[0].deadlineTick,ends,'enough time: this intermission');
  tick(ticks(20-ARM_SECONDS)+1);
  sim.grantLevelOffers(ctx,3);
  assert.ok(isHeldOffer(queue(ctx,'a')[1]),'too late: held for the next intermission');
  while(ctx.tick<ends)tick(1);
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-3-a'],'the late one survives the end of this intermission');
  assert.ok(isHeldOffer(queue(ctx,'a')[0]));
  wave(ctx);tick(ticks(30));
  assert.ok(isHeldOffer(queue(ctx,'a')[0]),'still waiting in combat');
  const next=intermission(ctx,20);tick(1);
  assert.equal(queue(ctx,'a')[0].deadlineTick,next);
  // A pick in combat or in the intermission still works at any time; only the oldest can be picked.
  assert.ok(sim.choose(ctx,'a','lvl-3-a',0).ok);
  assert.equal(ctx.offers.has('a'),false);
});

test('D-021: choosing in combat works on held offers, oldest first, and the rest keep waiting',()=>{
  const {ctx,sim,tick}=setup();
  addPlayer(ctx,'a');
  ctx.team.xp=20;tick(1);
  assert.deepEqual(sim.choose(ctx,'a','lvl-3-a',0),{ok:false,reason:'not-oldest'});
  assert.ok(sim.choose(ctx,'a','lvl-2-a',0).ok);
  tick(ticks(OFFER_SECONDS)*5);
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-3-a']);
  assert.ok(isHeldOffer(queue(ctx,'a')[0]),'no fresh head clock in combat');
});

test('D-021 review: offline across the intermission, back in combat: the round offer behind the level one waits too',()=>{
  const {ctx,sim,tick}=setup();
  const b=addPlayer(ctx,'b');
  const ends=intermission(ctx,20);
  sim.grantLevelOffers(ctx,2);sim.grantRoundOffers(ctx,1,ends);
  assert.deepEqual(queue(ctx,'b').map(o=>[o.id,o.deadlineTick]),[['lvl-2-b',ends],['rnd-1-b',ends]]);
  b.online=false;
  while(ctx.tick<ends+ticks(3))tick(1);
  wave(ctx);
  b.online=true;tick(1);
  assert.ok(queue(ctx,'b').every(isHeldOffer),'both held in combat, whatever the source');
  const before=eventsOf(ctx,'upgrade').length+eventsOf(ctx,'pickup').filter(e=>e.kind==='heal').length;
  assert.ok(sim.choose(ctx,'b','lvl-2-b',0).ok);
  tick(1);
  const after=eventsOf(ctx,'upgrade').length+eventsOf(ctx,'pickup').filter(e=>e.kind==='heal').length;
  assert.equal(after-before,1,'one pick, one upgrade: the round offer did not expire behind it');
  assert.deepEqual(queue(ctx,'b').map(o=>o.id),['rnd-1-b']);
  assert.ok(isHeldOffer(queue(ctx,'b')[0]));
  tick(ticks(OFFER_SECONDS)*3);
  assert.equal(eventsOf(ctx,'upgrade').length+eventsOf(ctx,'pickup').filter(e=>e.kind==='heal').length,after,'still waiting in combat');
  const next=intermission(ctx,20);tick(1);
  assert.equal(queue(ctx,'b')[0].deadlineTick,next,'armed by the next intermission');
});

test('D-021 review: an intermission shorter than ARM_SECONDS still arms what waited in combat; its own late levels wait',()=>{
  const {ctx,sim,tick}=setup();
  addPlayer(ctx,'a');
  ctx.team.xp=5;tick(1);
  assert.ok(isHeldOffer(queue(ctx,'a')[0]));
  const ends=intermission(ctx,3);
  tick(1);
  assert.equal(queue(ctx,'a')[0].deadlineTick,ends,'3 s intermission arms the held offer');
  sim.grantLevelOffers(ctx,3);
  assert.ok(isHeldOffer(queue(ctx,'a')[1]),'a level granted inside it is late');
  while(ctx.tick<ends)tick(1);
  assert.equal(eventsOf(ctx,'upgrade').length,1,'the armed one got its default once');
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-3-a']);
  wave(ctx);tick(ticks(20));
  assert.ok(isHeldOffer(queue(ctx,'a')[0]));
  assert.equal(sim.state.lateHeld,undefined,'late list cleared when the wave starts');
  const next=intermission(ctx,3);tick(1);
  assert.equal(queue(ctx,'a')[0].deadlineTick,next,'armed by the next one');
});

test('D-023: in the boss wave (last round) level offers use the 10 s head clock and nothing waits forever',()=>{
  const {ctx,sim,tick}=setup();
  addPlayer(ctx,'a');
  sim.grantLevelOffers(ctx,2);
  assert.ok(isHeldOffer(queue(ctx,'a')[0]),'round 1 wave: held');
  Object.assign(ctx.round,{index:10,total:10,phase:'wave',phaseEndsTick:ctx.tick+ticks(120)});
  tick(1);
  assert.equal(queue(ctx,'a')[0].deadlineTick,ctx.tick+ticks(OFFER_SECONDS),'held offer gets the head clock in the boss wave');
  sim.grantLevelOffers(ctx,3);
  const [first,second]=queue(ctx,'a');
  assert.ok(second.deadlineTick>=first.deadlineTick+ticks(OFFER_SECONDS),'queued level offer chained after the head');
  tick(ticks(OFFER_SECONDS));
  assert.equal(eventsOf(ctx,'upgrade').length,1,'default after 10 s, in combat, because no intermission follows');
  assert.ok(queue(ctx,'a')[0].deadlineTick>=ctx.tick+ticks(OFFER_SECONDS)-1,'next one rearmed with a fresh head clock');
  tick(ticks(OFFER_SECONDS)+1);
  assert.equal(eventsOf(ctx,'upgrade').length,2);
  assert.equal(ctx.offers.has('a'),false);
});

test('offline player deadline is frozen and resumes after reconnection with the same queue',()=>{
  const {ctx,tick}=setup();
  const b=addPlayer(ctx,'b',{online:false});
  ctx.team.xp=20;
  tick(1);
  const ids=queue(ctx,'b').map(o=>o.id);
  assert.deepEqual(ids,['lvl-2-b','lvl-3-b']);
  tick(ticks(OFFER_SECONDS)*10);
  assert.ok(queue(ctx,'b').every(o=>o.deadlineTick===HELD_DEADLINE),'held offers are not shifted while offline');
  intermission(ctx,20);tick(1);
  const remaining=queue(ctx,'b')[0].deadlineTick-ctx.tick;
  tick(ticks(OFFER_SECONDS)*10);
  assert.deepEqual(queue(ctx,'b').map(o=>o.id),ids,'queue preserved while offline');
  assert.equal(eventsOf(ctx,'upgrade').length,0);
  assert.ok(Math.abs((queue(ctx,'b')[0].deadlineTick-ctx.tick)-remaining)<=1,'clock frozen');
  // Flapping connection keeps the queue.
  for(let i=0;i<6;i++){b.online=!b.online;tick(1);}
  assert.equal(b.online,false);
  assert.deepEqual(queue(ctx,'b').map(o=>o.id),ids);
  b.online=true;
  tick(remaining+5);
  assert.equal(eventsOf(ctx,'upgrade').length,2,'resumed and both applied once at the (shifted) deadline');
  assert.equal(ctx.offers.has('b'),false);
});

test('D-021: an offer carried into combat by the offline freeze waits again for the next intermission',()=>{
  const {ctx,sim,tick}=setup();
  const b=addPlayer(ctx,'b');
  const ends=intermission(ctx,20);
  sim.grantLevelOffers(ctx,2);
  b.online=false;
  while(ctx.tick<ends+ticks(5))tick(1);
  wave(ctx);
  b.online=true;
  tick(1);
  assert.ok(isHeldOffer(queue(ctx,'b')[0]),'back online in combat: held, no default in the middle of the horde');
  tick(ticks(OFFER_SECONDS)*3);
  assert.equal(eventsOf(ctx,'upgrade').length,0);
});

test('queues are dropped for removed, spectating or eliminated players',()=>{
  const {ctx,tick}=setup();
  addPlayer(ctx,'a');addPlayer(ctx,'b');addPlayer(ctx,'c');addPlayer(ctx,'d');
  ctx.team.xp=5;
  tick(1);
  assert.equal(ctx.offers.size,4);
  ctx.players.delete('a');
  ctx.players.get('b')!.spectator=true;
  ctx.players.get('c')!.eliminated=true;
  tick(1);
  assert.deepEqual([...ctx.offers.keys()],['d']);
  intermission(ctx,20);
  tick(ticks(20)+2);
  assert.deepEqual(eventsOf(ctx,'upgrade').map(e=>e.player),['d']);
});

// ---------- 9. Determinism ----------
function scenario(seed:number){
  const {ctx,sim,tick}=setup(seed);
  addPlayer(ctx,'a',{x:5,y:5});
  addPlayer(ctx,'b',{x:9,y:5,stats:{luck:3}});
  for(let i=0;i<12;i++)sim.dropLoot(ctx,makeEnemy(`e${i}`,5+(i%5),5+Math.floor(i/5),{xp:4,elite:i===7}),i%2?'a':'b');
  const log:unknown[]=[];
  for(let t=0;t<600;t++){
    tick(1);
    if(t===30){const h=queue(ctx,'a')[0];if(h)log.push(sim.choose(ctx,'a',h.id,h.choices.length-1));}
    if(t===50)sim.grantRoundOffers(ctx,1);
  }
  return clone({
    offers:Object.fromEntries(ctx.offers),
    builds:[...ctx.players.values()].map(p=>p.build),
    team:ctx.team,pickups:[...ctx.pickups.values()],events:ctx.events,log,state:sim.state,
  });
}
test('same seed and same actions give identical offers, builds and events',()=>{
  const a=scenario(1234),b=scenario(1234);
  assert.deepEqual(a,b);
  assert.ok((a.events as SimEvent[]).some(e=>e.type==='upgrade'),'scenario exercises upgrades');
});

// ---------- 10. Loot ----------
test('dropLoot: xp gem at enemy position, chest only for non-boss elites',()=>{
  const {ctx,sim}=setup();
  addPlayer(ctx,'a',{x:2,y:2});
  ctx.tick=42;
  const plain=sim.dropLoot(ctx,makeEnemy('e1',7,8,{xp:3}),'a');
  const gems=plain.filter(p=>p.kind==='xp');
  assert.equal(gems.length,1);
  assert.equal(gems[0].value,3);
  assert.equal(gems[0].x,7);assert.equal(gems[0].y,8);
  assert.equal(gems[0].spawnTick,42);
  assert.ok(!plain.some(p=>p.kind==='chest'));
  for(const p of plain)assert.equal(ctx.pickups.get(p.id),p,'returned pickups are in ctx');

  const elite=sim.dropLoot(ctx,makeEnemy('e2',10,10,{xp:9,elite:true}),'a');
  assert.equal(elite.filter(p=>p.kind==='chest').length,1);
  assert.equal(elite.filter(p=>p.kind==='xp').length,1);
  const boss=sim.dropLoot(ctx,makeEnemy('e3',12,12,{xp:50,elite:true,boss:true}),'a');
  assert.equal(boss.filter(p=>p.kind==='chest').length,0,'boss chest comes from VGM-036, not dropLoot');
  assert.equal(boss.filter(p=>p.kind==='xp').reduce((n,p)=>n+p.value,0),50);
  const ids=[...plain,...elite,...boss].map(p=>p.id);
  assert.equal(new Set(ids).size,ids.length,'unique pickup ids');
});

test('dropLoot: huge killer luck makes heal and magnet drops appear; luck 1 rarely',()=>{
  const {ctx,sim}=setup();
  addPlayer(ctx,'lucky',{x:2,y:2,stats:{luck:1e9}});
  const kinds=new Set<string>();
  for(let i=0;i<60;i++)for(const p of sim.dropLoot(ctx,makeEnemy(`l${i}`,10,10,{xp:1}),'lucky'))kinds.add(p.kind);
  assert.ok(kinds.has('heal'),'heal drop');
  assert.ok(kinds.has('magnet'),'magnet drop');
  const plain=setup(7);
  addPlayer(plain.ctx,'a',{x:2,y:2});
  let extras=0;
  for(let i=0;i<60;i++)extras+=plain.sim.dropLoot(plain.ctx,makeEnemy(`n${i}`,10,10,{xp:1}),'a').filter(p=>p.kind==='heal'||p.kind==='magnet').length;
  assert.ok(extras<30,`luck 1 drops should be uncommon, got ${extras}/60`);
});

test('unreachable drop becomes a gem homing to the nearest collector and is collected',()=>{
  const {ctx,sim,pickupsOnly}=setup(1,{reachable:()=>false});
  addPlayer(ctx,'a',{x:5,y:5});
  addPlayer(ctx,'b',{x:15,y:15});
  addPlayer(ctx,'s',{x:20,y:20,spectator:true});
  addPlayer(ctx,'o',{x:14,y:14,online:false});
  const drops=sim.dropLoot(ctx,makeEnemy('e1',20.5,20.5,{xp:6}));
  const gem=drops.find(p=>p.kind==='xp');
  assert.ok(gem);
  assert.equal(gem.homing,'b');
  pickupsOnly(80);
  assert.equal(ctx.pickups.has(gem.id),false);
  assert.ok(ctx.team.xp>=6);
  assert.equal(eventsOf(ctx,'pickup').find(e=>e.pickup===gem.id)?.player,'b');
});

void COLLECT_RADIUS;
void ({} as OfferChoice);

// ---------- 11. Review fixes: rematch, rng stream, unreachable drops, queue deadlines ----------
test('reset forgets granted levels/rounds so a rematch grants offers again',()=>{
  const {ctx,sim,tick}=setup(4,{seed:99});
  addPlayer(ctx,'a');
  ctx.team.xp=20;tick(1);
  sim.grantRoundOffers(ctx,3);
  assert.equal(sim.state.lastLevelGranted,3);assert.equal(sim.state.lastRoundGranted,3);
  sim.reset();
  ctx.offers.clear();ctx.team.xp=0;ctx.team.level=1;ctx.team.nextXp=xpToNext(1);
  ctx.team.xp=5;tick(1);
  assert.deepEqual(queue(ctx,'a').map(o=>o.id),['lvl-2-a']);
  assert.equal(sim.grantRoundOffers(ctx,3).length,1);
});

test('seeded stream ignores draws by other systems and resumes from rngState',()=>{
  const roll=(burn:number,state?:ProgressionState)=>{
    const {ctx,sim}=setup(1,{seed:42},state);
    addPlayer(ctx,'a');
    for(let i=0;i<burn;i++)ctx.rng.next();
    sim.grantLevelOffers(ctx,2);
    return {choices:queue(ctx,'a')[0].choices,state:clone(sim.state)};
  };
  assert.deepEqual(roll(0).choices,roll(17).choices,'other systems drawing from ctx.rng does not shift offers');
  const first=roll(0);
  const resumed=(()=>{const {ctx,sim}=setup(1,{seed:42},clone(first.state));addPlayer(ctx,'a');sim.grantLevelOffers(ctx,3);return queue(ctx,'a')[0].choices;})();
  const straight=(()=>{const {ctx,sim}=setup(1,{seed:42});addPlayer(ctx,'a');sim.grantLevelOffers(ctx,2);ctx.offers.clear();sim.grantLevelOffers(ctx,3);return queue(ctx,'a')[0].choices;})();
  assert.deepEqual(resumed,straight,'checkpointed rngState continues the same rolls');
});

test('unreachable drop while nobody can collect waits and then homes to the first collector',()=>{
  const {ctx,sim,tick}=setup(1,{reachable:()=>false,openChest:()=>{}});
  const a=addPlayer(ctx,'a',{x:15,y:15,downed:true});
  const [gem,chest]=sim.dropLoot(ctx,makeEnemy('e1',3,3,{xp:7,elite:true}));
  assert.equal(gem.homing,HOME_ANY);assert.equal(chest.homing,HOME_ANY);
  tick(40);
  assert.equal(gem.x,3,'does not move while nobody can collect');
  assert.equal(ctx.team.xp,0);
  delete a.downed;
  tick(60);
  assert.ok(!ctx.pickups.has(gem.id)&&!ctx.pickups.has(chest.id),'both delivered');
  assert.deepEqual([ctx.team.level,ctx.team.xp],[2,2],'7 xp delivered once (5 for level 2, 2 left)');
});

test('round offers are skipped after the last round and queued offers show a chained deadline',()=>{
  const {ctx,sim}=setup();
  addPlayer(ctx,'a');
  assert.equal(sim.grantRoundOffers(ctx,10).length,0,'no upgrade after the final round');
  sim.grantLevelOffers(ctx,2);sim.grantLevelOffers(ctx,3);
  assert.ok(queue(ctx,'a').every(isHeldOffer),'D-021: in combat both wait');
  const legacy=setup();
  undirected(legacy.ctx);
  addPlayer(legacy.ctx,'a');
  legacy.sim.grantLevelOffers(legacy.ctx,2);legacy.sim.grantLevelOffers(legacy.ctx,3);
  const [first,second]=queue(legacy.ctx,'a');
  assert.ok(second.deadlineTick>=first.deadlineTick+ticks(OFFER_SECONDS),'without a director a queued deadline never shows the past');
});

test('offline freezes every queued deadline, not only the head',()=>{
  const {ctx,sim,tick}=setup();
  const a=addPlayer(ctx,'a');
  intermission(ctx,60);
  sim.grantLevelOffers(ctx,2);sim.grantLevelOffers(ctx,3);sim.grantRoundOffers(ctx,1);
  const before=queue(ctx,'a').map(o=>o.deadlineTick-ctx.tick);
  a.online=false;tick(500);
  assert.deepEqual(queue(ctx,'a').map(o=>o.deadlineTick-ctx.tick),before);
});

test('chest evolution gate counts from this run, also after reset at a high room tick',()=>{
  const seen:number[]=[];
  const {ctx,sim,pickupsOnly}=setup(1,{openChest:(c,_p,id,o)=>{seen.push(o.runStartTick??-1);c.pickups.delete(id);return {kind:'heal',pickup:'x'};}});
  addPlayer(ctx,'a',{x:5,y:5});
  ctx.tick=5000;
  pickupsOnly(1);
  sim.reset();
  ctx.tick=90000;
  pickupsOnly(1);
  addPickup(ctx,'chest',5,5,1);
  pickupsOnly(1);
  assert.deepEqual(seen,[90001],'run start is the first tick after reset, not 0');
  assert.equal(sim.state.runStartTick,90001);
});
