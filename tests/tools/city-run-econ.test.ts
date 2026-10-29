/**
 * NEW-20261029-ORQ-bench-economia: the economy log of scripts/bench-city-run.ts (EconTracker, affordTargets, the econ
 * summary and lines) on synthetic numbers. The bench itself never runs here (D-031: scripts only, no time asserts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EconTracker,HZ,affordTargets,econLines,econSummary,runDigest,summaryLines,type EconRecord,type RunRecord} from '../../scripts/bench-city-run.ts';
import {UNITS_PER_TOKEN} from '../../src/rules/index.ts';

const targets=[{id:'root',tokens:1},{id:'evolve-2',grana:10},{id:'never',grana:1e9}];

test('econ: first affordable, idle Grana per wave and samples',()=>{
  const e=new EconTracker(targets);
  e.step(0,1,0,[0,0],false);
  e.step(HZ,1,UNITS_PER_TOKEN,[4,6],false);           // 1 s: a ficha in reach; wallets 4+6 (no single 10 yet)
  e.step(2*HZ,2,UNITS_PER_TOKEN,[10,2],true);         // 2 s: wave 1 starts; one wallet reaches 10
  e.step(3*HZ,2,0,[6,2],false);
  e.step(4*HZ,3,0,[20,0],true);                       // wave 2
  const r=e.record({a:20,b:0});
  assert.deepEqual(r.firstAffordable,{root:1,'evolve-2':2,never:null});
  assert.equal(r.idleMean,(0+10+12+8+20)/5);
  assert.deepEqual(r.waves.map(w=>[w.t,w.round,w.grana,w.maxWallet,w.idleMean]),[[2,2,12,10,10],[4,3,20,20,20]]);
  assert.deepEqual(r.samples.map(s=>s.t),[0]);       // every 30 s from tick 0
  assert.deepEqual(r.wallets,{a:20,b:0});
});

test('econ: buys by act:kind and refusals',()=>{
  const e=new EconTracker(targets);
  e.buy({t:5,round:2,act:'upgrade',who:'a',kind:'root-2',from:'root',grana:10,units:0,wallet:12});
  e.buy({t:9,round:2,act:'upgrade',who:'b',kind:'root-2',from:'root',grana:10,units:0,wallet:10});
  e.buy({t:9,round:2,act:'build',who:'a',kind:'root',grana:0,units:UNITS_PER_TOKEN,wallet:2});
  e.refuse('forge','grana');e.refuse('forge','grana');e.refuse('place','slot');
  const r=e.record({});
  assert.deepEqual(r.byKind,{'upgrade:root-2':{count:2,grana:20,units:0},'build:root':{count:1,grana:0,units:UNITS_PER_TOKEN}});
  assert.deepEqual(r.refused,{'forge:grana':2,'place:slot':1});
  assert.equal(r.buys.length,3);
  assert.equal(r.idleMean,null);
});

test('econ: every price watched is a positive number',()=>{
  const t=affordTargets();
  assert.ok(t.some(p=>p.tokens!==undefined)&&t.some(p=>p.grana!==undefined));
  for(const p of t)assert.ok((p.tokens??p.grana??0)>0,p.id);
  assert.equal(new Set(t.map(p=>p.id)).size,t.length);
});

function rec(first:Record<string,number|null>,idle:number,waves:number[],buys:[string,number][]):EconRecord{
  const byKind=Object.fromEntries(buys.map(([k,g])=>[k,{count:1,grana:g,units:0}]));
  return {buys:[],byKind,refused:{},firstAffordable:first,idleMean:idle,
    waves:waves.map((g,i)=>({t:i,round:i+2,grana:g,units:0,maxWallet:g,idleMean:g/2})),samples:[],wallets:{}};
}

test('econ: summary over runs and its lines',()=>{
  const s=econSummary([rec({root:10,'evolve-2':null},4,[10,20],[['upgrade:root-2',10]]),rec({root:30,'evolve-2':50},8,[30],[['upgrade:root-2',10],['forge:reparo',10]])]);
  assert.equal(s.runs,2);
  assert.deepEqual(s.buysPerRun,{'forge:reparo':{count:.5,grana:5},'upgrade:root-2':{count:1,grana:10}});
  assert.deepEqual(s.idleMean,{n:2,mean:6,min:4,median:6,max:8});
  assert.deepEqual(s.firstAffordable.root,{reached:2,s:{n:2,mean:20,min:10,median:20,max:30}});
  assert.deepEqual(s.firstAffordable['evolve-2'],{reached:1,s:{n:1,mean:50,min:50,median:50,max:50}});
  assert.deepEqual(s.waves,[{index:1,runs:2,grana:20,idleMean:10,maxWallet:20},{index:2,runs:1,grana:20,idleMean:10,maxWallet:20}]);
  const lines=econLines(3,s);
  assert.equal(lines.length,3);
  assert.match(lines[0],/^econ 3p \(2 runs\)/);
  assert.match(lines[0],/upgrade:root-2 1× R\$ 10, forge:reparo 0.5× R\$ 5/);
  assert.match(lines[1],/root 20s 2\/2/);
  assert.match(lines[2],/w1 20\/10\/20 w2 20\/10\/20 \(1\)/);
});

test('econ: the digest ignores the econ record',()=>{
  const base={key:'1:1',seed:1,players:1,outcome:'defeat',roundReached:1} as unknown as RunRecord;
  assert.equal(runDigest({...base,econ:rec({},1,[],[])}),runDigest(base));
});

test('econ: summaryLines prints the econ lines of the sizes that recorded it',()=>{
  const r={key:'1:2',seed:1,players:2,outcome:'defeat',roundReached:1,rounds:[],intermissions:[],forge:{count:0,byRecipe:{},list:[]},
    nav:{round1ArrivalS:{},tutorialArrivalS:null,modeTicks:{},stuck:0,crateTrips:0},perf:{wallSeconds:0,msPerTick:0,thinkMsPerTick:0,navMsPerTick:0},
    econ:rec({root:12},5,[7],[['place:muro',0]])} as unknown as RunRecord;
  const lines=summaryLines([r]);
  assert.ok(lines.some(l=>l.startsWith('econ 2p (1 runs): idle Grana')),lines.join('\n'));
  assert.ok(lines.some(l=>l.includes('1st affordable')&&l.includes('root 12s 1/1')),lines.join('\n'));
});
