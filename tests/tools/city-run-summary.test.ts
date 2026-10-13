/**
 * cidade-11 (balanco-run): the pure aggregation helpers of scripts/bench-city-run.ts on synthetic run records. The
 * bench itself never runs here (D-031: scripts only, no time asserts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {barricadeStates,barricadesFell,classRotation,parsePlayers,parseSeeds,summarize,winTarget,type RunRecord} from '../../scripts/bench-city-run.ts';

function run(seed:number,players:number,outcome:RunRecord['outcome'],roundReached:number,extra:Partial<RunRecord>={}):RunRecord{
  return {key:`${seed}:${players}`,seed,players,classes:[],outcome,cause:outcome==='victory'?'boss':outcome==='timeout'?'timeout':'team',
    roundReached,diedRound:outcome==='victory'?null:roundReached,ticks:0,simMinutes:0,wallHpEnd:0,wallMaxHp:600,
    rounds:[{round:1,waveStartTick:0,endTick:10,firstInsideBaseTick:null,firstArrivalS:null,downed:0,eliminated:0,revived:0,wallHpStart:600,wallHpEnd:600,barricadesFallen:null},
      {round:2,waveStartTick:100,endTick:200,firstInsideBaseTick:300,firstArrivalS:10+seed,downed:1,eliminated:0,revived:1,wallHpStart:600,wallHpEnd:500,barricadesFallen:null}],
    intermissions:[{round:2,startTick:10,endTick:100,seconds:4.5,balanceStart:{coco:0,pedra:0},balanceEnd:{coco:3,pedra:3},gathered:{coco:3,pedra:3+seed,units:6+seed},
      spent:{coco:0,pedra:seed,units:seed},perPlayer:{},cratesEmptied:2,purchases:[]}],
    forge:{count:seed,byRecipe:{},list:[]},boss:null,
    nav:{round1ArrivalS:{},tutorialArrivalS:30,modeTicks:{},stuck:0,crateTrips:0},perf:{wallSeconds:0,msPerTick:0,thinkMsPerTick:0,navMsPerTick:0},knobsApplied:false,...extra};
}

test('city run summary: seed and player lists',()=>{
  assert.deepEqual(parseSeeds('1-4'),[1,2,3,4]);
  assert.deepEqual(parseSeeds('3,1-2,3'),[1,2,3]);
  assert.deepEqual(parsePlayers('6,1,3'),[1,3,6]);
  assert.throws(()=>parsePlayers('0,7'));
  assert.throws(()=>parseSeeds('a-b'));
  assert.deepEqual(classRotation(['a','b','c','d','e','f','g','h','i','j','k','l'],3),['a','e','i']);
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
  assert.equal(six.loot.recipesPerIntermission,1.25);
  // 2 seeds: 6p target 7–11 of 16 → 0.875–1.375 wins (1 is ok); 1p target 2–6 of 16 → 0.25–0.75 (0 is too hard).
  assert.deepEqual(winTarget(6,2),{min:.875,max:1.375});
  assert.equal(six.verdict.wins,'ok');assert.equal(one.verdict.wins,'too-hard');
  assert.equal(s.byPlayers[1].verdict.round1,'ok');
  assert.equal(s.verdict.ok,false);
  assert.equal(s.verdict.notes.length,1);
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
