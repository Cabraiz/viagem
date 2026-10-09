import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {NaiveIndex,SpatialHash} from '../src/game/sim/spatial.ts';
import {BUDGET,MAX_ENEMIES,groundXp,hasRoom,mergeXpGems,room} from '../src/game/sim/budget.ts';
import type {PickupState} from '../src/game/sim/types.ts';

type Item={id:string;x:number;y:number;tag:number};

const ids=(items:Item[])=>items.map(i=>i.id).sort();

function scatter(rng:Rng,count:number,min=-2,max=26):Item[]{
  return Array.from({length:count},(_,i)=>({id:`e${i}`,x:rng.range(min,max),y:rng.range(min,max),tag:rng.int(0,3)}));
}

test('spatial hash query and nearest match the naive index on seeded random sets',()=>{
  for(let seed=1;seed<=40;seed++){
    const rng=new Rng(seed);
    const cell=rng.pick([.5,1,2,3.7,8]);
    const items=scatter(rng,rng.int(0,400));
    // Duplicated points and exact ties exercise the id tie-break.
    for(let i=0;i<10&&items.length>1;i++){const src=rng.pick(items);items.push({...src,id:`d${seed}-${i}`});}
    const hash=new SpatialHash<Item>(cell),naive=new NaiveIndex<Item>();
    hash.rebuild(items);naive.rebuild(new Map(items.map(i=>[i.id,i])).values());
    assert.equal(hash.size,items.length);
    const out:Item[]=[];
    for(let q=0;q<120;q++){
      const x=rng.range(-6,30),y=rng.range(-6,30),r=rng.pick([0,.2,1,2.5,6,40,rng.range(0,12)]);
      const got=hash.query(x,y,r,out);
      assert.equal(got,out,'query returns the out array');
      assert.deepEqual(ids(got),ids(naive.query(x,y,r)),`seed ${seed} query ${q}`);
      assert.equal(new Set(got).size,got.length,'no duplicates');
      const filter=(i:Item)=>i.tag!==0;
      assert.equal(hash.nearest(x,y,r)?.id,naive.nearest(x,y,r)?.id,`seed ${seed} nearest ${q}`);
      assert.equal(hash.nearest(x,y,r,filter)?.id,naive.nearest(x,y,r,filter)?.id,`seed ${seed} filtered nearest ${q}`);
    }
  }
});

test('spatial hash treats the radius as inclusive and breaks distance ties by id',()=>{
  const hash=new SpatialHash<Item>(1);
  hash.rebuild([{id:'b',x:3,y:0,tag:0},{id:'a',x:-3,y:0,tag:0},{id:'c',x:0,y:3,tag:0},{id:'z',x:0,y:0,tag:1}]);
  assert.deepEqual(ids(hash.query(0,0,3)),['a','b','c','z']);
  assert.deepEqual(ids(hash.query(0,0,0)),['z']);
  assert.equal(hash.nearest(0,0,5,i=>i.tag===0)?.id,'a');
  assert.equal(hash.nearest(0,0,2.99,i=>i.tag===0),undefined);
  // Points on cell borders, including negative coordinates.
  const border=new SpatialHash<Item>(2),naive=new NaiveIndex<Item>();
  const grid:Item[]=[];for(let x=-4;x<=4;x++)for(let y=-4;y<=4;y++)grid.push({id:`g${x},${y}`,x,y,tag:0});
  border.rebuild(grid);naive.rebuild(grid);
  for(const [x,y,r] of [[0,0,2],[2,2,2],[-2,1,1],[1,1,Math.SQRT2],[-4,-4,3]])assert.deepEqual(ids(border.query(x,y,r)),ids(naive.query(x,y,r)));
});

test('spatial hash snapshots positions, reuses buffers and handles degenerate input',()=>{
  const hash=new SpatialHash<Item>();
  const item={id:'m',x:5,y:5,tag:0};
  hash.rebuild([item]);
  item.x=50;
  assert.deepEqual(ids(hash.query(5,5,.1)),['m'],'positions are taken at rebuild');
  assert.equal(hash.query(50,5,1).length,0);
  hash.rebuild([item]);
  assert.deepEqual(ids(hash.query(50,5,.1)),['m']);
  // Shrinking and empty rebuilds.
  hash.rebuild(scatter(new Rng(3),500));assert.equal(hash.size,500);
  hash.rebuild([]);assert.equal(hash.size,0);
  assert.deepEqual(hash.query(0,0,100),[]);assert.equal(hash.nearest(0,0,100),undefined);
  // Non-finite input never matches and never loops forever.
  hash.rebuild([{id:'nan',x:NaN,y:1,tag:0},{id:'inf',x:Infinity,y:1,tag:0},{id:'ok',x:1,y:1,tag:0}]);
  assert.equal(hash.size,1);
  assert.deepEqual(ids(hash.query(1,1,Infinity)),['ok']);
  assert.deepEqual(hash.query(NaN,1,5),[]);
  assert.deepEqual(hash.query(1,1,-1),[]);
  assert.deepEqual(hash.query(1,1,NaN),[]);
  assert.equal(hash.nearest(1,1,Infinity)?.id,'ok');
  assert.equal(hash.nearest(Infinity,1,5),undefined);
  const far=[{id:'far',x:1e12,y:-1e12,tag:0},{id:'near',x:1e12+1,y:-1e12,tag:0}];
  hash.rebuild(far);
  assert.deepEqual(ids(hash.query(1e12,-1e12,1.5)),['far','near']);
  assert.equal(hash.nearest(1e12+.9,-1e12,5)?.id,'near');
  assert.throws(()=>new SpatialHash(0));assert.throws(()=>new SpatialHash(NaN));
});

test('spatial hash results do not depend on insertion order',()=>{
  const rng=new Rng(9),items=scatter(rng,300,2,22);
  const a=new SpatialHash<Item>(),b=new SpatialHash<Item>();
  a.rebuild(items);b.rebuild([...items].reverse());
  for(let q=0;q<100;q++){
    const x=rng.range(2,22),y=rng.range(2,22),r=rng.range(0,5);
    assert.deepEqual(ids(a.query(x,y,r)),ids(b.query(x,y,r)));
    assert.equal(a.nearest(x,y,r)?.id,b.nearest(x,y,r)?.id);
  }
});

const gem=(id:string,x:number,y:number,value:number,spawnTick:number,extra:Partial<PickupState>={}):PickupState=>
  ({id,kind:'xp',x,y,value,spawnTick,...extra});

function randomPickups(rng:Rng,count:number){
  const map=new Map<string,PickupState>();
  for(let i=0;i<count;i++){
    const kind=rng.chance(.85)?'xp':rng.pick(['heal','magnet','chest'] as const);
    const p:PickupState={id:`p${i}`,kind,x:rng.range(2,22),y:rng.range(2,22),value:kind==='xp'?rng.int(1,25):30,spawnTick:rng.int(0,2000)};
    if(kind==='xp'&&rng.chance(.1))p.homing='player-1';
    if(rng.chance(.3))p.expiresTick=p.spawnTick+rng.int(100,600);
    map.set(p.id,p);
  }
  return map;
}

test('xp gem merge reaches the cap and conserves total xp',()=>{
  for(let seed=1;seed<=30;seed++){
    const rng=new Rng(seed),cap=rng.int(20,250);
    const pickups=randomPickups(rng,rng.int(0,600));
    const before=groundXp(pickups.values()),others=[...pickups.values()].filter(p=>p.kind!=='xp'||p.homing).map(p=>({...p}));
    const size=pickups.size,result=mergeXpGems(pickups,cap);
    assert.equal(groundXp(pickups.values()),before,`seed ${seed} conserves xp`);
    assert.equal(pickups.size,size>cap?cap+result.overBy:size);
    assert.equal(result.removed.length,size-pickups.size);
    for(const p of others)assert.deepEqual(pickups.get(p.id),p,'non-xp and homing pickups are untouched');
    for(const id of result.removed)assert.equal(pickups.has(id),false);
    for(const id of result.grown)assert.equal(pickups.get(id)?.kind,'xp');
  }
});

test('xp gem merge prefers local merges, keeps the oldest gem and is order independent',()=>{
  const build=(order:PickupState[])=>new Map(order.map(p=>[p.id,{...p}]));
  const list=[
    gem('a',3.1,3.1,5,10),gem('b',3.5,3.2,7,20,{expiresTick:400}),gem('c',3.9,3.9,1,30),
    gem('far',15,15,9,5),{id:'chest',kind:'chest',x:3.2,y:3.2,value:1,spawnTick:1} as PickupState,
  ];
  const map=build(list);
  const r=mergeXpGems(map,3);
  assert.deepEqual(r,{removed:['c','b'],grown:['a'],overBy:0});
  assert.equal(map.get('a')?.value,13);assert.equal(map.get('a')?.expiresTick,undefined,'no expiry wins');
  assert.equal(map.get('far')?.value,9);
  const reversed=build([...list].reverse());mergeXpGems(reversed,3);
  assert.deepEqual([...reversed.values()].map(p=>[p.id,p.value]).sort(),[...map.values()].map(p=>[p.id,p.value]).sort());
  // Spread-out gems fall back to merging into the oldest gem overall.
  const spread=build([gem('x',2,2,1,3),gem('y',10,10,2,1),gem('z',20,20,4,2)]);
  assert.deepEqual(mergeXpGems(spread,1),{removed:['x','z'],grown:['y'],overBy:0});
  assert.equal(spread.get('y')?.value,7);
  // Expiry keeps the longest lifetime.
  const timed=build([gem('t1',2,2,1,1,{expiresTick:100}),gem('t2',2.2,2,1,2,{expiresTick:300})]);
  mergeXpGems(timed,1);assert.equal(timed.get('t1')?.expiresTick,300);
  // Not enough gems: report what is left instead of deleting other pickups.
  const stuck=build([gem('only',2,2,3,1),{id:'h',kind:'heal',x:4,y:4,value:30,spawnTick:1} as PickupState]);
  assert.deepEqual(mergeXpGems(stuck,0),{removed:[],grown:[],overBy:2});
  assert.deepEqual(mergeXpGems(build(list),10),{removed:[],grown:[],overBy:0});
});

test('xp gem merge survives bad caps, bad ticks and keys that differ from ids',()=>{
  const pair=()=>new Map([['a',gem('a',2,2,1,1)],['b',gem('b',2.1,2,2,2)]]);
  assert.deepEqual(mergeXpGems(pair(),NaN),{removed:['b'],grown:['a'],overBy:1},'NaN cap acts as 0');
  assert.deepEqual(mergeXpGems(new Map(),NaN),{removed:[],grown:[],overBy:0});
  assert.equal(room(5,NaN),0);assert.equal(room(5,-1),0);assert.equal(room(1,Infinity),Infinity);
  // NaN spawn ticks must not make the survivor depend on insertion order.
  const rng=new Rng(4),list=Array.from({length:12},(_,i)=>gem(`n${i}`,rng.range(2,6),rng.range(2,6),rng.int(1,9),rng.chance(.3)?NaN:rng.int(0,50)));
  const survivors=new Set<string>();
  for(let s=0;s<10;s++){
    const order=[...list].sort(()=>0).reverse();if(s%2)order.push(order.shift()!);
    const map=new Map(order.map(p=>[p.id,{...p}]));mergeXpGems(map,4);
    survivors.add([...map.values()].map(p=>`${p.id}:${p.value}`).sort().join());
  }
  assert.equal(survivors.size,1);
  // Keys are the identity: a key that differs from pickup.id must not duplicate XP.
  const odd=new Map([['k1',gem('a',2,2,5,1)],['k2',gem('b',2,2,7,2)]]);
  assert.deepEqual(mergeXpGems(odd,1),{removed:['k2'],grown:['k1'],overBy:0});
  assert.equal(groundXp(odd.values()),12);
});

test('budget caps and room helpers',()=>{
  assert.equal(MAX_ENEMIES,300);assert.equal(BUDGET.enemies,300);
  assert.ok(Object.isFrozen(BUDGET));
  assert.equal(room(280,300),20);assert.equal(room(320,300),0);
  assert.equal(hasRoom(new Map([[1,1]]),2,1),true);assert.equal(hasRoom(new Map([[1,1]]),2,2),false);
});
