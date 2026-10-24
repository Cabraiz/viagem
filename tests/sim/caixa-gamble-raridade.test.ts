import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks} from '../../src/contract/types.ts';
import type {EnemyState,PickupState,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState} from '../../src/contract/types.ts';
import type {PickupView,PlayerRunView,RunView} from '../../src/contract/view.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createTeamProgress} from '../../src/sim/progression.ts';
import {GOLD_HIDDEN_CHANCE,GOLD_HIDDEN_FROM,GOLD_RARITY,HIDE_AFTER_TAKEN,createCrates,type Crates} from '../../src/sim/crates.ts';
import type {Rarity} from '../../src/sim/weapons/arsenal.ts';
import {KIT_POOL,kitId} from '../../src/rules/tower-kits.ts';
import {FrameDecoder,FrameEncoder,WireIds} from '../../src/protocol/protocol4.ts';
import {planLoot} from '../../src/sim/bot-loot.ts';

// NEW-20261023-ORQ-caixa-gamble-raridade (the user, 24/10): a weapon crate verde/azul/roxa may turn DOURADA when
// opened, and who took a verde (azul) weapon no longer sees verde (azul) weapon crates; kit crates stay for everyone.

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
function addPlayer(ctx:FakeCtx,id:string,x:number,y:number):SimPlayer{
  const p:SimPlayer={id,classId:'turista',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:'faca',level:1}],passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(id,p);
  return p;
}
const opened=(ctx:FakeCtx)=>ctx.events.filter((e):e is Extract<SimEvent,{type:'pickup'}>=>e.type==='pickup'&&e.kind==='chest');
function run(ctx:FakeCtx,crates:Crates,n:number){for(let i=0;i<n;i++){crates.step(ctx);ctx.tick++;}}
/** A dropped crate of this colour that shows (and gives) `item`. */
function crate(ctx:FakeCtx,crates:Crates,at:{x:number;y:number},rarity:Rarity,item:string):PickupState{
  const c=crates.dropCrate(ctx,at,rarity);
  crates.state.crates[c.id].item=item;c.resource=item;
  return c;
}
const KIT1=kitId(KIT_POOL[1][0]);

test('dourada escondida: ~GOLD_HIDDEN_CHANCE of the verde/azul/roxa weapon crates give the weapon DOURADA; the map kept the colour',()=>{
  assert.deepEqual(GOLD_HIDDEN_FROM,[1,2,3]);
  assert.equal(GOLD_HIDDEN_CHANCE,.05);
  const N=2000;
  for(const rarity of GOLD_HIDDEN_FROM){
    let gold=0;
    for(let s=0;s<N;s++){
      const ctx=makeCtx(s),crates=createCrates({seed:s*7+rarity,points:[]}),p=addPlayer(ctx,'a',0,0);
      const c=crate(ctx,crates,{x:0,y:0},rarity,'pistola');
      run(ctx,crates,1);
      assert.equal(c.value,rarity,'the crate shows its own colour while closed');
      run(ctx,crates,ticks(3.2));
      const e=opened(ctx)[0];
      assert.ok(e,'opened');
      const level=p.build.weapons.find(w=>w.id==='pistola')!.level;
      assert.equal(e.value,level,'the pickup event tells the real rarity (the client reveals it)');
      assert.ok(level===rarity||level===GOLD_RARITY,`${level}`);
      if(level===GOLD_RARITY)gold++;
    }
    const share=gold/N;
    assert.ok(Math.abs(share-GOLD_HIDDEN_CHANCE)<.02,`rarity ${rarity}: ${(share*100).toFixed(1)} % dourada`);
  }
});

test('dourada escondida: kits never turn, a lendária gives its own; same seed, same surprise',()=>{
  for(let s=0;s<100;s++){
    const ctx=makeCtx(s),crates=createCrates({seed:s,points:[],goldChance:1}),p=addPlayer(ctx,'a',0,0);
    crate(ctx,crates,{x:0,y:0},3,kitId(KIT_POOL[3][0]));
    run(ctx,crates,ticks(3.2));
    assert.equal(opened(ctx)[0].value,3,'a kit crate gives its colour');
    p.build.weapons=[{id:'faca',level:1}];
    crate(ctx,crates,{x:0,y:0},5,'pistola');
    run(ctx,crates,ticks(3.5));
    assert.equal(opened(ctx)[1].value,5,'a lendária stays lendária');
  }
  const surprise=(seed:number)=>{
    const ctx=makeCtx(seed),crates=createCrates({seed,points:[],hideAfterTaken:[]}),p=addPlayer(ctx,'a',0,0);
    for(let i=0;i<40;i++){p.build.weapons=[{id:'faca',level:1}];crate(ctx,crates,{x:0,y:0},2,'pistola');run(ctx,crates,ticks(2));}
    return opened(ctx).map(e=>e.value).join();
  };
  assert.equal(opened(makeCtx()).length,0);
  assert.equal(surprise(9),surprise(9));
  assert.ok(surprise(9).split(',').length===40);
});

test('per player: who opened a verde weapon crate no longer sees nor opens verde weapon crates; the others do; kits stay',()=>{
  assert.deepEqual(HIDE_AFTER_TAKEN,[1,2]);
  const ctx=makeCtx(3),crates=createCrates({seed:3,points:[],goldChance:0}),a=addPlayer(ctx,'a',0,0);
  crate(ctx,crates,{x:0,y:0},1,'pistola');
  run(ctx,crates,ticks(1.2));
  assert.equal(opened(ctx).length,1);
  assert.deepEqual(crates.state.took,{a:[1]});
  // A new verde weapon crate right under him: hidden for him, he cannot open it.
  const verde=crate(ctx,crates,{x:0,y:0},1,'sacole');
  const kit=crate(ctx,crates,{x:50,y:0},1,KIT1);
  const azul=crate(ctx,crates,{x:100,y:0},2,'pistola');
  run(ctx,crates,ticks(3));
  assert.ok(ctx.pickups.has(verde.id),'still on the map');
  assert.deepEqual(verde.hiddenFor,['a']);
  assert.equal(kit.hiddenFor,undefined,'a verde kit crate (towers) stays for everyone');
  assert.equal(azul.hiddenFor,undefined,'he took no azul yet');
  assert.equal(crates.opening('a'),undefined,'he does not start opening it');
  // Another hero, who never took a verde, sees and opens it.
  a.x=500;
  const b=addPlayer(ctx,'b',0,0);
  run(ctx,crates,ticks(1.2));
  assert.ok(!ctx.pickups.has(verde.id));
  assert.equal(opened(ctx).at(-1)!.player,'b');
  assert.ok(b.build.weapons.some(w=>w.id==='sacole'));
  // A JSON checkpoint keeps who took what.
  const resumed=createCrates({seed:3,points:[],state:JSON.parse(JSON.stringify(crates.state))});
  assert.deepEqual(resumed.state.took,{a:[1],b:[1]});
});

test('per player: the azul hides the same way after an azul weapon; roxa, dourada and lendária never; a kit does not count',()=>{
  const ctx=makeCtx(6),crates=createCrates({seed:6,points:[],goldChance:0}),a=addPlayer(ctx,'a',0,0);
  crate(ctx,crates,{x:0,y:0},2,'pistola');
  run(ctx,crates,ticks(2));
  assert.deepEqual(crates.state.took,{a:[2]});
  const others=([1,2,3,4,5] as Rarity[]).map(r=>crate(ctx,crates,{x:100*r,y:0},r,'pistola'));
  run(ctx,crates,1);
  assert.deepEqual(others.map(c=>c.hiddenFor?.join()??''),['','a','','',''],'only the azul hides (he took no verde)');
  const k=makeCtx(4),kc=createCrates({seed:4,points:[]});addPlayer(k,'k',0,0);
  crate(k,kc,{x:0,y:0},1,KIT1);run(k,kc,ticks(1.2));
  assert.equal(opened(k).length,1);
  assert.equal(kc.state.took,undefined,'a verde kit does not hide the verdes');
});

test('a verde crate that turned dourada still counts as verde taken (the colour it showed)',()=>{
  const ctx=makeCtx(5),crates=createCrates({seed:5,points:[],goldChance:1}),a=addPlayer(ctx,'a',0,0);
  crate(ctx,crates,{x:0,y:0},1,'pistola');
  run(ctx,crates,ticks(1.2));
  assert.equal(a.build.weapons.find(w=>w.id==='pistola')?.level,GOLD_RARITY);
  assert.deepEqual(crates.state.took,{a:[1]});
});

test('trail crates: a hero who took verde gets them azul; verde and azul, roxa',()=>{
  const street=(at:{x:number;y:number},h:{x:number;y:number},ahead:number)=>{const p={x:at.x+h.x*ahead,y:at.y+h.y*ahead};return Math.abs(p.y)<3?p:undefined;};
  for(const [took,want] of [[[1],2],[[1,2],3]] as const){
    const ctx=makeCtx(5),crates=createCrates({seed:5,points:[],trailSpot:street}),a=addPlayer(ctx,'a',0,0);
    crates.state.took={a:[...took]};
    for(let i=0;i<ticks(20);i++){a.x+=.2;crates.step(ctx);ctx.tick++;}
    const trail=Object.values(crates.state.crates).filter(r=>r.start);
    assert.ok(trail.length>=2,`${trail.length}`);
    assert.ok(trail.every(r=>r.rarity>=want),trail.map(r=>r.rarity).join());
  }
});

test('the encoder leaves a crate out of the frames of the players it is hidden for (never on the wire); bots skip it',()=>{
  const players=['a','b'].map((id,i):PlayerRunView=>({id,name:id,classId:'turista',hp:100,maxHp:100,online:true,spectator:false,
    weapons:[{id:'faca',level:1}],passives:[],x:i,y:0} as PlayerRunView));
  const pickups:PickupView[]=[{id:'bau-1',kind:'chest',x:3,y:0,value:1,resource:'pistola',hiddenFor:['a']},{id:'bau-2',kind:'chest',x:9,y:0,value:1,resource:KIT1}];
  const view={tick:10,team:{xp:0,level:1,nextXp:10},round:{index:1,total:10,phase:'wave',phaseEndsTick:100,remaining:0},
    players:players.map(p=>({...p,ack:0})),enemies:[],projectiles:[],telegraphs:[],structures:[],pickups};
  // Decoded ids are wire labels: tell the crates apart by the item they show.
  for(const [viewer,want] of [['a',[KIT1]],['b',[KIT1,'pistola'].sort()]] as const){
    for(const interest of [undefined,false] as const){
      const res=new FrameDecoder().decode(new FrameEncoder(new WireIds(),{viewer,interest}).encode(view as never));
      assert.ok(res.ok);
      assert.deepEqual(res.view.pickups.map(k=>k.resource).sort(),[...want],`${viewer} interest ${interest}`);
      assert.ok(res.view.pickups.every(k=>!('hiddenFor' in k)),'never on the wire');
    }
  }
  const loot=(me:PlayerRunView)=>planLoot({players,pickups,enemies:[]} as Pick<RunView,'players'|'pickups'|'enemies'>,me,me).goal?.id;
  assert.equal(loot(players[0]),'bau-2','a bot skips the crate hidden for him');
  assert.equal(loot(players[1]),'bau-1');
});
