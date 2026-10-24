/**
 * cidade-11 (balanco-run): the pure aggregation helpers of scripts/bench-city-run.ts on synthetic run records. The
 * bench itself never runs here (D-031: scripts only, no time asserts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BANK_SHARE_TARGET,RECIPE_MEAN_UNITS,barricadeStates,barricadesFell,classRotation,classRotationWide,countBankEvent,countVehicleEvent,emptyBanks,emptyVehicles,parsePlayers,parseSeeds,runLine,summarize,summaryLines,winTarget,type RunRecord} from '../../scripts/bench-city-run.ts';
import type {SimEvent} from '../../src/contract/index.ts';

function run(seed:number,players:number,outcome:RunRecord['outcome'],roundReached:number,extra:Partial<RunRecord>={}):RunRecord{
  return {key:`${seed}:${players}`,seed,players,classes:[],outcome,cause:outcome==='victory'?'boss':outcome==='timeout'?'timeout':'team',
    roundReached,diedRound:outcome==='victory'?null:roundReached,ticks:0,simMinutes:0,wallHpEnd:0,wallMaxHp:600,
    rounds:[{round:1,waveStartTick:0,endTick:10,firstInsideBaseTick:null,firstArrivalS:null,downed:0,eliminated:0,revived:0,wallHpStart:600,wallHpEnd:600,barricadesFallen:null},
      {round:2,waveStartTick:100,endTick:200,firstInsideBaseTick:300,firstArrivalS:10+seed,downed:1,eliminated:0,revived:1,wallHpStart:600,wallHpEnd:500,barricadesFallen:null}],
    intermissions:[{round:2,startTick:10,endTick:100,seconds:4.5,balanceStart:{units:0},balanceEnd:{units:6},gathered:{units:6+seed},
      spent:{units:seed,forge:seed},perPlayer:{},cratesEmptied:2,purchases:[]}],
    forge:{count:seed,byRecipe:{},list:[]},boss:null,
    nav:{round1ArrivalS:{},tutorialArrivalS:30,modeTicks:{},stuck:0,crateTrips:0},perf:{wallSeconds:0,msPerTick:0,thinkMsPerTick:0,navMsPerTick:0},knobsApplied:false,...extra};
}

test('city run summary: seed and player lists',()=>{
  assert.deepEqual(parseSeeds('1-4'),[1,2,3,4]);
  assert.deepEqual(parseSeeds('3,1-2,3'),[1,2,3]);
  assert.deepEqual(parsePlayers('6,1,3'),[1,3,6]);
  assert.throws(()=>parsePlayers('0'));
  assert.throws(()=>parseSeeds('a-b'));
  assert.deepEqual(classRotation(['a','b','c','d','e','f','g','h','i','j','k','l'],3),['a','e','i']);
  // sala-ate-10-jogadores: seats 7..10 sit between the first six's picks; the first six stay as they were.
  const ids=Array.from({length:36},(_,i)=>`c${i}`),wide=classRotationWide(ids,10);
  assert.deepEqual(wide.slice(0,6),classRotation(ids));assert.equal(wide.length,10);assert.equal(new Set(wide).size,10);
  assert.deepEqual(parsePlayers('8,10'),[8,10]);assert.throws(()=>parsePlayers('11'));
});

test('city run summary: wins, death rounds, arrivals, loot and verdict per team size',()=>{
  const runs=[run(1,6,'victory',10),run(2,6,'defeat',7),run(1,1,'defeat',4),run(2,1,'timeout',9)];
  const s=summarize(runs);
  assert.equal(s.runs,4);
  const six=s.byPlayers[6],one=s.byPlayers[1];
  assert.equal(six.wins,1);assert.equal(six.winRate,.5);
  assert.deepEqual(six.deathRounds,{7:1});
  assert.deepEqual(one.deathRounds,{4:1,9:1});
  assert.equal(one.causes.timeout,1);assert.equal(one.causes.team,1);
  assert.deepEqual(six.firstArrivalS.all,{n:2,mean:11.5,min:11,median:11.5,max:12});
  assert.deepEqual(six.loot.unitsPerIntermission,{n:2,mean:7.5,min:7,median:7.5,max:8});
  // The mean loot over the mean recipe price (rules RECIPES), to two places.
  assert.equal(six.loot.recipesPerIntermission,Math.round(7.5/RECIPE_MEAN_UNITS*100)/100);
  // 2 seeds: 6p target 7–11 of 16 → 0.875–1.375 wins (1 is ok); 1p target 2–6 of 16 → 0.25–0.75 (0 is too hard).
  assert.deepEqual(winTarget(6,2),{min:.875,max:1.375});
  assert.equal(six.verdict.wins,'ok');assert.equal(one.verdict.wins,'too-hard');
  assert.equal(s.byPlayers[1].verdict.round1,'ok');
  assert.equal(s.verdict.ok,false);
  assert.equal(s.verdict.notes.length,1);
});

test('city run summary: roots and fichas de torre per run (D-048); runs without towers leave it null',()=>{
  const towers=(roots:number,gustavao:boolean)=>({orders:roots+1,units:roots*40+(gustavao?120:0),refused:{},final:{},ruined:0,gustavao,roots,tokens:roots+(gustavao?3:0)});
  const s=summarize([run(1,6,'victory',10,{towers:towers(3,true)}),run(2,6,'defeat',7,{towers:towers(2,false)}),run(1,1,'defeat',4)]);
  assert.deepEqual(s.byPlayers[6].towers,{runs:2,rootsPerRun:{n:2,mean:2.5,min:2,median:2.5,max:3},tokensPerRun:{n:2,mean:4,min:2,median:4,max:6},gustavoes:1});
  assert.equal(s.byPlayers[1].towers,null);
  // A run from an older file (no roots/tokens) still counts, without numbers.
  const old=summarize([run(1,3,'victory',10,{towers:{orders:1,units:6,refused:{},final:{},ruined:0,gustavao:false}})]);
  assert.deepEqual(old.byPlayers[3].towers,{runs:1,rootsPerRun:null,tokensPerRun:null,gustavoes:0});
});

test('city run summary: Grana per run (D-048) and the chaveiro\'s victories with debt; older files without them still load',()=>{
  const grana=(earned:number,evolutions:number,forge:number)=>({earned,spent:{evolutions,repairs:5,forge,other:0},final:earned-evolutions-5-forge});
  const bill=(outcome:'victory'|'defeat',debt:number)=>({kind:'chaveiro',outcome,cause:outcome==='victory'?'opened':'car',wave:10,extraWaves:0,eta:0,seconds:600,
    hits:debt/8,limit:120,budget:120+debt,grana:120,paid:120,debt,parts:0,bossCalled:true,moments:{},deliveries:{clean:3,dirty:0}}) as unknown as RunRecord['objective'];
  const s=summarize([run(1,3,'victory',10,{grana:grana(200,60,20),objective:bill('victory',0)}),run(2,3,'victory',11,{grana:grana(300,90,10),objective:bill('victory',40)}),
    run(3,3,'defeat',6,{grana:grana(100,40,0),objective:bill('defeat',16)}),run(4,3,'victory',10)]);
  const t=s.byPlayers[3];
  assert.deepEqual(t.grana?.earned,{n:3,mean:200,min:100,median:200,max:300});
  assert.deepEqual(t.grana?.spent,{n:3,mean:78.33,min:45,median:85,max:105},'evolutions + repairs + forge (+ other)');
  assert.equal(t.grana?.runs,3,'the run from an older file (no grana) is left out');
  assert.deepEqual(t.chaveiro,{runs:3,wins:2,winsWithDebt:1,debt:{n:2,mean:20,min:0,median:20,max:40}},'victories with debt / victories');
  // An older file: neither field.
  const old=summarize([run(1,6,'victory',10)]).byPlayers[6];
  assert.equal(old.grana,null);assert.equal(old.chaveiro,null);
});

test('city run summary: a death in round 1 fails the tutorial target',()=>{
  const bad=run(1,3,'defeat',1);
  bad.rounds[0].eliminated=1;
  const s=summarize([bad]);
  assert.equal(s.byPlayers[3].verdict.round1,'deaths');
  assert.equal(s.byPlayers[3].verdict.wins,'no-target');
  assert.equal(s.byPlayers[3].round1.defeats,1);
});

test('city run summary: barricades are read generically and only up → down counts as a fall',()=>{
  assert.equal(barricadeStates({}),null);
  const down=barricadeStates({barricades:[{id:'N',hp:0,maxHp:100,down:true},{id:'S',hp:50,maxHp:100,down:false}]});
  const up=barricadeStates({barricades:[{id:'N',hp:100,maxHp:100,down:false},{id:'S',hp:50,maxHp:100,down:false}]});
  assert.deepEqual([...down!],[['N',true],['S',false]]);
  assert.equal(barricadesFell(down,up),0);
  assert.equal(barricadesFell(up,down),1);
  assert.equal(barricadesFell(null,down),0);
  const r=run(1,6,'victory',10);
  r.rounds[1].barricadesFallen=2;
  assert.deepEqual(summarize([r]).byPlayers[6].barricadesFallen.perRound,{n:1,mean:2,min:2,median:2,max:2});
});

test('city run summary: banks (bancos-e-veiculos): the events fold into a run, the summary pools the share and checks 25–35 %',()=>{
  const b=emptyBanks();
  const events:SimEvent[]=[
    {type:'bank-cash',bank:'banco-1',amount:2,by:'hero'},{type:'bank-cash',bank:'banco-1',amount:2,by:'hero'},
    {type:'bank-cash',bank:'banco-2',amount:2,by:'enemy',enemy:'e-1'},{type:'bank-prime',bank:'banco-2',enemy:'e-1'},
    {type:'bank-empty',bank:'banco-3',until:9000},{type:'bank-refill',bank:'banco-3'},{type:'kill',enemy:'e-9'} as unknown as SimEvent,
  ];
  for(const e of events)countBankEvent(b,e);
  assert.deepEqual(b,{grana:4,withdraws:2,share:null,enemyWithdraws:1,enemyGrana:2,primes:1,empties:1});
  const grana=(earned:number)=>({earned,spent:{evolutions:0,repairs:0,forge:0,other:0},final:earned});
  const banks=(grana:number,share:number|null,primes=0)=>({grana,withdraws:grana/2,share,enemyWithdraws:primes*5,enemyGrana:primes*10,primes,empties:0});
  // 6p: 30 of 100 and 20 of 100 → pooled 25 % (ok); per run 30 % and 20 %.
  const six=summarize([run(1,6,'victory',10,{grana:grana(100),banks:banks(30,.3,1)}),run(2,6,'defeat',7,{grana:grana(100),banks:banks(20,.2)})]).byPlayers[6].banks!;
  assert.equal(six.runs,2);assert.equal(six.pooledShare,.25);assert.equal(six.verdict,'ok');
  assert.deepEqual(six.share,{n:2,mean:.25,min:.2,median:.25,max:.3});
  assert.deepEqual(six.primes,{n:2,mean:.5,min:0,median:.5,max:1});
  assert.equal(six.enemyGrana?.mean,5);
  // Pooled, not the mean of the shares: 10 of 20 and 10 of 180 → 10 % (low) though the shares' mean is 27.8 %.
  const low=summarize([run(1,1,'defeat',4,{grana:grana(20),banks:banks(10,.5)}),run(2,1,'defeat',4,{grana:grana(180),banks:banks(10,10/180)})]);
  assert.equal(low.byPlayers[1].banks!.pooledShare,.1);assert.equal(low.byPlayers[1].banks!.verdict,'low');
  assert.ok(low.verdict.notes.some(n=>n.includes('banks 10 %')&&n.includes('(low)')),low.verdict.notes.join('; '));
  assert.equal(summarize([run(1,3,'victory',10,{grana:grana(100),banks:banks(50,.5)})]).byPlayers[3].banks!.verdict,'high');
  assert.equal(BANK_SHARE_TARGET.min,.25);assert.equal(BANK_SHARE_TARGET.max,.35);
  // The lines: the run shows its bank R$ and share, the summary one line per team size.
  const r=run(1,6,'victory',10,{grana:grana(100),banks:banks(30,.3,1)});
  assert.match(runLine(r),/banks R\$ 30 \(30 %\) bicho 5× R\$ 10 prime 1 dry 0/);
  assert.ok(summaryLines([r]).some(l=>l.startsWith('banks 6p: R$/run 30 share of Grana 30 % pooled')),summaryLines([r]).join('\n'));
  // Older files (no banks): null, and no note.
  const old=summarize([run(1,6,'victory',10)]);
  assert.equal(old.byPlayers[6].banks,null);
});

test('city run summary: vehicles (bancos-e-veiculos, part 2): pegou counts a ride per kind and rider, acabou/largou how it ended; the summary checks ≥ 1 per bot',()=>{
  const v=emptyVehicles(),seen=new Set<string>();
  const events:SimEvent[]=[
    {type:'vehicle',player:'bot-1',kind:'patinete',what:'pegou'},{type:'vehicle',player:'bot-1',kind:'patinete',what:'acabou'},
    {type:'vehicle',player:'bot-2',kind:'carrinho',what:'pegou'},{type:'vehicle',player:'bot-2',kind:'carrinho',what:'largou'},
    {type:'vehicle',player:'bot-1',kind:'carrinho',what:'pegou'},{type:'bank-prime',bank:'banco-2',enemy:'e-1'},
  ];
  for(const e of events)countVehicleEvent(v,seen,e);
  assert.deepEqual(v,{rides:3,byKind:{patinete:1,carrinho:2},acabou:1,largou:1,riders:2});
  const lines=summaryLines([run(1,2,'victory',10,{vehicles:v}),run(2,2,'defeat',4,{vehicles:{...emptyVehicles(),rides:1,byKind:{crossfiteiro:1},riders:1}})]);
  assert.ok(lines.some(l=>l.startsWith('vehicles 2p: rides/run 2 per bot 1 (target ≥ 1) | runs where every bot rode 1/2 | by kind {"patinete":1,"carrinho":2,"crossfiteiro":1}')),lines.join('\n'));
  assert.ok(!summaryLines([run(1,2,'victory',10)]).some(l=>l.startsWith('vehicles')),'older files: no line');
});
