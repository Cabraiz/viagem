import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks} from '../../src/contract/types.ts';
import type {EnemyState,PickupState,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createTeamProgress} from '../../src/sim/progression.ts';
import {createCrates,drawPrize,prizeKey,prizePools,type Crates} from '../../src/sim/crates.ts';
import {dropItem,inventorySystem,itemKey,owns,take} from '../../src/sim/inventory.ts';
import type {Rarity} from '../../src/sim/weapons/arsenal.ts';
import {KIT_POOL,kitId} from '../../src/rules/tower-kits.ts';
import {planLoot} from '../../src/sim/bot-loot.ts';
import type {PlayerRunView,RunView} from '../../src/contract/view.ts';

// BUG-20261025-ORQ-caixa-sem-item-repetido (the user, 25/10, a tampa de panela verde and then an azul in his
// inventory): "eu não deveria ver uma panela azul se peguei panela verde, e nem ao contrário". Who holds an item never
// gets nor sees it again in another rarity: no crate shows it, a crate showing it draws another, the ground hides it.

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
const TAMPA='tampa-voadora';
function addPlayer(ctx:FakeCtx,id:string,x:number,y:number,weapons=[{id:TAMPA,level:1}]):SimPlayer{
  const p:SimPlayer={id,classId:'turista',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:weapons.map(w=>({...w})),passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(id,p);
  return p;
}
function run(ctx:FakeCtx,crates:Crates,n:number){for(let i=0;i<n;i++){crates.step(ctx);ctx.tick++;}}
/** A dropped crate of this colour that shows (and gives) `item`. */
function crate(ctx:FakeCtx,crates:Crates,at:{x:number;y:number},rarity:Rarity,item:string):PickupState{
  const c=crates.dropCrate(ctx,at,rarity);
  crates.state.crates[c.id].item=item;c.resource=item;
  return c;
}

test('the same item: any rarity, a legendary as its weapon, a kit as its piece; consumables never',()=>{
  assert.equal(itemKey('pistola-lendario'),'pistola');
  const p={build:{weapons:[{id:TAMPA,level:1},{id:kitId(KIT_POOL[1][0]),level:1},{id:'coxinha',level:2}],passives:[],hand:0}};
  assert.equal(owns(p,TAMPA),true);
  assert.equal(owns(p,kitId(KIT_POOL[1][0])),true);
  assert.equal(owns(p,'pistola'),false);
  assert.equal(owns(p,'coxinha'),false,'a coxinha stacks');
});

test('with a tampa verde, 1000 crates of every colour never show nor give a tampa',()=>{
  for(let s=0;s<1000;s++){
    const ctx=makeCtx(s),crates=createCrates({mapCrates:true,seed:s,points:[],goldChance:0,hideAfterTaken:[]}),p=addPlayer(ctx,'a',0,0);
    const c=crates.dropCrate(ctx,{x:0,y:0},(s%5+1) as Rarity);
    assert.notEqual(c.resource,TAMPA,`seed ${s}: the crate shows ${c.resource}`);
    run(ctx,crates,ticks(3.2));
    assert.ok(!ctx.pickups.has(c.id),'opened');
    assert.equal(p.build.weapons.filter(w=>w.id===TAMPA).length,1,`seed ${s}: ${p.build.weapons.map(w=>w.id)}`);
  }
});

test('the first minute crates and the trail ones skip what the hero holds too',()=>{
  const street=(at:{x:number;y:number},h:{x:number;y:number},ahead:number)=>{const p={x:at.x+h.x*ahead,y:at.y+h.y*ahead};return Math.abs(p.y)<3?p:undefined;};
  for(let s=0;s<40;s++){
    const ctx=makeCtx(s),crates=createCrates({mapCrates:true,seed:s,points:[],trailSpot:street});
    const a=addPlayer(ctx,'a',0,0,[{id:'pistola',level:1},{id:'escopeta',level:2},{id:kitId(KIT_POOL[1][0]),level:1}]);
    for(let i=0;i<ticks(30);i++){a.x+=.2;crates.step(ctx);ctx.tick++;}
    const shown=Object.keys(crates.state.crates).map(id=>ctx.pickups.get(id)!.resource!);
    assert.ok(shown.length>=2,`${shown.length}`);
    for(const item of shown)assert.ok(!owns(a,item),`seed ${s}: a trail crate shows ${item}`);
  }
});

test('a crate showing an item somebody just got shows another one, and stays for everyone',()=>{
  const ctx=makeCtx(2),crates=createCrates({mapCrates:true,seed:2,points:[],goldChance:0}),a=addPlayer(ctx,'a',0,0,[{id:'faca',level:1}]);
  addPlayer(ctx,'b',300,0,[{id:'faca',level:1}]);
  const verde=crate(ctx,crates,{x:0,y:0},1,TAMPA),azul=crate(ctx,crates,{x:100,y:0},2,TAMPA);
  run(ctx,crates,1);
  assert.equal(azul.resource,TAMPA,'nobody holds one yet');
  run(ctx,crates,ticks(1.2));
  assert.ok(!ctx.pickups.has(verde.id));
  assert.ok(owns(a,TAMPA),'he took the tampa verde');
  assert.notEqual(azul.resource,TAMPA,'the azul crate no longer shows a tampa');
  assert.equal(crates.state.crates[azul.id].item,azul.resource);
  assert.equal(azul.hiddenFor,undefined,'it shows a free item: nobody needs it hidden');
  // Walking to it, he gets what it shows now (never a tampa).
  a.x=100;run(ctx,crates,ticks(2.2));
  assert.equal(a.build.weapons.filter(w=>itemKey(w.id)===TAMPA).length,1);
});

test('every item held: the crate keeps one and hides from who holds it; drawPrize never jams',()=>{
  const all=new Set(prizePools(2,false).flat().map(itemKey));
  const last=[...all].at(-1)!,held=new Set([...all].filter(id=>id!==last));
  for(let s=0;s<50;s++){
    assert.equal(prizeKey(drawPrize(new Rng(s),2,false,undefined,held)),last,'the only free item');
    assert.ok(prizeKey(drawPrize(new Rng(s),2,false,last,all)),'all held: still a prize');
  }
  // The start table held whole: another rarity's item.
  const start=new Set(prizePools(1,true)[0].map(itemKey));
  for(let s=0;s<50;s++)assert.ok(!start.has(itemKey(prizeKey(drawPrize(new Rng(s),1,true,undefined,start)))));
  // Hidden to its holder (the same hiddenFor): he neither opens it nor his bot goes for it.
  const ctx=makeCtx(1),crates=createCrates({mapCrates:true,seed:1,points:[],goldChance:0,hideAfterTaken:[]}),a=addPlayer(ctx,'a',0,0);
  const c=crate(ctx,crates,{x:0,y:0},1,TAMPA);
  // Everything else held by b: no free item to show instead.
  const b=addPlayer(ctx,'b',900,0,[]);
  for(const id of prizePools(1,false).flat())if(itemKey(id)!==TAMPA)b.build.weapons.push({id,level:1});
  run(ctx,crates,ticks(2));
  assert.ok(ctx.pickups.has(c.id),'he does not open it');
  assert.equal(c.resource,TAMPA);
  assert.deepEqual(c.hiddenFor,['a']);
});

test('on the ground: who holds the item neither sees nor takes it; another hero does',()=>{
  const ctx=makeCtx(1),system=inventorySystem(),a=addPlayer(ctx,'a',0,0),b=addPlayer(ctx,'b',50,0,[{id:'faca',level:1}]);
  const item=dropItem(ctx,{x:0,y:0},{id:TAMPA,level:2});
  for(let i=0;i<5;i++){system.step(ctx);ctx.tick++;}
  assert.ok(ctx.pickups.has(item.id),'he walked over it and left it');
  assert.deepEqual(item.hiddenFor,['a']);
  assert.deepEqual(take(ctx,a,item.id),{ok:false,reason:'owned'});
  const view={pickups:[...ctx.pickups.values()],enemies:[],players:[]} as unknown as Pick<RunView,'players'|'pickups'|'enemies'>;
  const me={id:'a',weapons:a.build.weapons,hand:0,hp:100,maxHp:100} as unknown as PlayerRunView;
  assert.equal(planLoot(view,me,a).goal,undefined,'his bot does not go for it (a tampa azul beats his verde)');
  b.x=0;system.step(ctx);
  assert.ok(!ctx.pickups.has(item.id),'the other hero takes it');
  assert.ok(owns(b,TAMPA));
});
