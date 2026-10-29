/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1: the chefão at the end of the 1st wave (sim/ninhos/chefao.ts), on the real
 * Cidade Nevada in mode 'ninhos' (chaveiro). The wave's moment is set on the nests' state (sent, drip, log) instead of
 * playing 3 minutes: the chefão reads only that.
 *  - who: drawn from the seed among the four (all four come up over the seeds), forced by the option;
 *  - he appears once, on the step the 1st wave's last body left (not while its drip runs), as a boss of his roster kind,
 *    WAVE_BOSS.clear from every body, along the wave's way in; arrival() says so on that tick only;
 *  - hp × players like the final boss (bossMaxHp with WAVE_BOSS's numbers); the final boss is untouched;
 *  - beaten: a dourada crate where he fell, up() false; a checkpoint keeps him (and brings him back if he stood);
 *  - the bots aim at a boss near the car (bot-brain bossFocus);
 *  - he stops the time: while he stands no wave leaves and the nests' clock waits (holdWaveClock), then it resumes; the
 *    chaveiro's ETA stands still too (holdChaveiroClock, ORQ 24/10).
 * D-031: sim ticks only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,type EnemyState,type EnemyView,type SimPlayer} from '../../src/contract/index.ts';
import {BOSS_FOCUS_R,bossFocus} from '../../src/sim/bot-brain.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems,type RunSystemsState} from '../../src/sim/assemble.ts';
import {bossMaxHp} from '../../src/sim/boss.ts';
import {holdChaveiroClock,holdWaveClock,waveBossSpot,waveBossTuning,type ChaveiroClock,type WaveClock} from '../../src/sim/ninhos/chefao.ts';
import {WAVE_BOSS,WAVE_BOSS_IDS,pickWaveBoss} from '../../src/rules/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function addPlayer(world:SimWorld,id:string,x:number,y:number){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}
function run(opts:{seed?:number;players?:number;chefao?:string;checkpoint?:RunSystemsState;world?:SimWorld}={}):{world:SimWorld;sys:RunSystems}{
  const world=opts.world??new SimWorld({terrain:city.fork(),seed:opts.seed??1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos',combat:'manual',
    nestPopulation:.2,...(opts.chefao?{chefao:opts.chefao}:{}),...(opts.checkpoint?{checkpoint:opts.checkpoint}:{})});
  if(!opts.world){
    const car=sys.chaveiro!.state.car;
    for(let i=0;i<(opts.players??1);i++)addPlayer(world,`p${i}`,car.x+1+i*.5,car.y+1);
    world.step();
  }
  return {world,sys};
}
/** The 1st wave left from the N entrance; `dripping`: its map share still leaving. */
function waveOneLeft(sys:RunSystems,world:SimWorld,dripping=false){
  const n=sys.nests!.state;
  n.sent=1;n.log=[{tick:world.tick,entrance:'N',quota:0,kills:0,map:0,nests:0,outside:0,total:0}];
  if(dripping)n.drip={door:0,left:5,tick:world.tick};else delete n.drip;
  n.nextWave=world.tick+10_000;
}
const bossesOf=(world:SimWorld)=>[...world.enemies.values()].filter(e=>e.boss);

test('who: the seed draws one of the four, the same each time; all four come up; the option forces one',()=>{
  assert.deepEqual([...WAVE_BOSS_IDS].sort(),['boitata-de-sacolinha','dj-do-fim-do-mundo','mapinguari-do-shopping','o-grande-credor']);
  for(let s=0;s<20;s++)assert.equal(pickWaveBoss(s).id,pickWaveBoss(s).id);
  assert.equal(new Set(Array.from({length:64},(_,s)=>pickWaveBoss(s).id)).size,4);
  const {sys}=run({chefao:'boitata-de-sacolinha'});
  assert.equal(sys.chefao!.who.id,'boitata-de-sacolinha');
});

test('the spot: on the route, at least fromCar from the car end and clear of every body; the start when nothing fits',()=>{
  const route=[{x:0,y:0},{x:50,y:0}];
  const p=waveBossSpot(route,[{x:30,y:0}],()=>true)!;
  assert.ok(50-p.x>=WAVE_BOSS.fromCar&&Math.abs(p.x-30)>=WAVE_BOSS.clear,`at ${p.x}`);
  assert.deepEqual(waveBossSpot(route,[],()=>false),undefined);
  assert.deepEqual(waveBossSpot([{x:0,y:0},{x:5,y:0}],[],()=>true),{x:0,y:0});
});

test('he comes once, when the 1st wave\'s last body left: his kind, a boss, clear of everyone; arrival on that tick only',()=>{
  const {world,sys}=run({seed:3});
  const c=sys.chefao!;
  for(let i=0;i<5;i++)world.step();
  assert.equal(bossesOf(world).length,0,'nothing before the wave');
  waveOneLeft(sys,world,true);
  for(let i=0;i<5;i++)world.step();
  assert.equal(bossesOf(world).length,0,'not while its map share still leaves');
  delete sys.nests!.state.drip;
  world.step();
  const [boss]=bossesOf(world);
  assert.ok(boss,'he appeared');
  assert.equal(boss.kind,c.who.id);assert.equal(boss.kind,pickWaveBoss(world.seed).id);
  assert.equal(c.state.called,world.tick);assert.deepEqual(c.arrival(world.tick),{enemy:boss.id,who:c.who.id,x:boss.x,y:boss.y});
  for(const p of world.players.values())assert.ok(Math.hypot(p.x-boss.x,p.y-boss.y)>=WAVE_BOSS.clear,'clear of the players');
  const car=sys.chaveiro!.state.car;
  assert.ok(Math.hypot(car.x-boss.x,car.y-boss.y)>=WAVE_BOSS.clear,'and of the car');
  assert.ok(c.up());
  assert.equal(sys.boss.state.bossId,undefined,'the final boss is another one');
  for(let i=0;i<40;i++)world.step();
  assert.equal(c.arrival(world.tick),undefined,'arrival only on its tick');
  assert.equal(bossesOf(world).length,1,'one chefão');
  // A later wave never calls another.
  sys.nests!.state.sent=3;world.step();
  assert.equal(bossesOf(world).filter(e=>e.kind===c.who.id).length,1);
});

test('hp × players like the final boss, with WAVE_BOSS\'s numbers; his hits are WAVE_BOSS.damage of the final boss\'s',()=>{
  const hp:number[]=[];
  for(const n of [1,3,6]){
    const {world,sys}=run({seed:5,players:n});
    waveOneLeft(sys,world);world.step();
    const [boss]=bossesOf(world);
    assert.equal(boss.maxHp,bossMaxHp(n,waveBossTuning()),`${n} players`);
    hp.push(boss.maxHp);
  }
  assert.ok(hp[0]<hp[1]&&hp[1]<hp[2],hp.join(' < '));
  assert.equal(bossMaxHp(1,waveBossTuning()),WAVE_BOSS.baseHp);
  const t=waveBossTuning();assert.equal(t.slamDamage,Math.round(28*WAVE_BOSS.damage));
});

test('beaten: a dourada crate where he fell and up() false; the checkpoint keeps him; one taken while he stood brings him back',()=>{
  const {world,sys}=run({seed:2});
  waveOneLeft(sys,world);world.step();
  const boss=bossesOf(world)[0];
  // A checkpoint while he stands: resumed, he comes back on the next step.
  const cp=structuredClone(sys.state());
  assert.equal(cp.chefao?.enemy,boss.id);
  const resumedWorld=new SimWorld({terrain:city.fork(),seed:world.seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  resumedWorld.load(world.checkpoint());
  for(const p of world.players.values())resumedWorld.players.set(p.id,structuredClone(p));
  for(const e of [...resumedWorld.enemies.values()])resumedWorld.enemies.delete(e.id);
  const resumed=run({world:resumedWorld,checkpoint:cp});
  assert.equal(stateHash(resumed.sys.state().chefao),stateHash(cp.chefao),'the restore is lossless');
  assert.equal(resumed.sys.chefao!.up(),true,'he still stands (the clock stays held) until his body is called again');
  resumedWorld.step();
  assert.equal(bossesOf(resumedWorld).length,1,'back after the restore');assert.equal(resumed.sys.chefao!.up(),true);
  // The kill.
  world.damageEnemy(boss.id,boss.hp+1);
  world.step();
  assert.equal(sys.chefao!.up(),false);
  const crate=[...world.pickups.values()].find(p=>p.kind==='chest'&&p.value===WAVE_BOSS.crate&&Math.hypot(p.x-boss.x,p.y-boss.y)<.5);
  assert.ok(crate,'a dourada where he fell');
  const done=sys.state().chefao!;assert.equal(done.boss.defeated,true);
  for(let i=0;i<20;i++)world.step();
  assert.equal(bossesOf(world).length,0,'he never comes back');
});

test('he stops the time: while he stands no wave leaves, nobody is born and the clock waits; it resumes once he fell',()=>{
  const {world,sys}=run({seed:4});
  waveOneLeft(sys,world);world.step();
  const n=sys.nests!.state,start=n.startTick!,boss=bossesOf(world)[0];
  assert.ok(boss&&sys.chefao!.up());
  // The 2nd wave was due in 5 ticks: it waits as long as he stands.
  n.nextWave=world.tick+5;
  const horde=world.enemies.size;
  for(let i=0;i<60;i++)world.step();
  assert.equal(n.sent,1,'no wave while he stands');
  assert.equal(n.nextWave-world.tick,5,'the next wave as far as it was');
  assert.equal(n.startTick,start+60,'the ramp waits too');
  assert.ok(world.enemies.size<=horde,`${world.enemies.size} > ${horde}: nobody born in the fight`);
  world.damageEnemy(boss.id,boss.hp+1);
  for(let i=0;i<10&&n.sent<2;i++)world.step();
  assert.equal(sys.chefao!.up(),false);
  assert.equal(n.sent,2,'the 2nd wave right after he fell');
});

test('holdWaveClock: every deadline and the ramp start move by the ticks held; nothing before the first step',()=>{
  const c:WaveClock={startTick:100,nextWave:900,waveOpen:300,exploreFrom:400,exploreUntil:2800};
  holdWaveClock(c,30);
  assert.deepEqual(c,{startTick:130,nextWave:930,waveOpen:330,exploreFrom:430,exploreUntil:2830});
  const before:WaveClock={startTick:null,nextWave:5};holdWaveClock(before);
  assert.deepEqual(before,{startTick:null,nextWave:5});
  const old:WaveClock={startTick:0,nextWave:10};holdWaveClock(old);
  assert.deepEqual(old,{startTick:1,nextWave:11},'absent fields stay absent');
});

test("the chaveiro's ETA stands still while he stands (the moto stays, nobody pushes the car), and runs again once he fell",()=>{
  const {world,sys}=run({seed:4});
  for(let i=0;i<40;i++)world.step(); // the moto rides a little
  waveOneLeft(sys,world);world.step();
  const ch=sys.chaveiro!,boss=bossesOf(world)[0];
  assert.ok(boss&&sys.chefao!.up());
  const eta=ch.eta(world.tick),s=ch.state.moto.s;
  for(let i=0;i<90;i++)world.step();
  assert.equal(ch.eta(world.tick),eta,'the ETA reads the same');
  assert.equal(ch.state.moto.s,s,'the moto waits');
  assert.equal(ch.view(world.tick).etaS,Math.ceil(eta));
  world.damageEnemy(boss.id,boss.hp+1);
  world.step();
  assert.equal(sys.chefao!.up(),false);
  for(let i=0;i<60;i++)world.step();
  assert.ok(ch.eta(world.tick)<eta,'it runs again once he fell');
});

test("holdChaveiroClock: the alarm, the fall, the next sale and the start move by the ticks held; the car's movers go; nothing before the first step",()=>{
  const c:ChaveiroClock={car:{alarmUntil:50,movers:['p0']},moto:{tomboUntil:70,tomboReady:90},cida:{nextSaleTick:200},startTick:10};
  holdChaveiroClock(c,30);
  assert.deepEqual(c,{car:{alarmUntil:80},moto:{tomboUntil:100,tomboReady:120},cida:{nextSaleTick:230},startTick:40});
  const before:ChaveiroClock={car:{alarmUntil:5},moto:{tomboUntil:0,tomboReady:0},cida:{nextSaleTick:9},startTick:null};
  holdChaveiroClock(before);
  assert.deepEqual(before,{car:{alarmUntil:5},moto:{tomboUntil:0,tomboReady:0},cida:{nextSaleTick:9},startTick:null});
});

test('bots: a boss within BOSS_FOCUS_R of the car is their target (the nearest such); farther, or dead, none',()=>{
  const car={x:0,y:0},e=(id:string,x:number,boss=true,hp=100)=>({id,kind:'k',x,y:0,hp,maxHp:100,...(boss?{boss:true}:{})}) as unknown as EnemyView;
  assert.equal(bossFocus([e('a',BOSS_FOCUS_R+1)],car),undefined);
  assert.equal(bossFocus([e('a',3,false)],car),undefined);
  assert.equal(bossFocus([e('a',3,true,0)],car),undefined);
  assert.equal(bossFocus([e('far',10),e('near',4),e('x',2,false)],car)?.id,'near');
  assert.equal(bossFocus([e('a',3)],undefined),undefined);
});

test('a lab summon: he comes on the next step even before the wave left, once; arrival on that tick',()=>{
  const {world,sys}=run({seed:3});
  assert.equal(sys.chefao!.summon(),true);
  world.step();
  assert.equal(bossesOf(world).length,1);
  assert.equal(sys.chefao!.arrival(world.tick)?.enemy,bossesOf(world)[0].id);
  assert.equal(sys.chefao!.summon(),false,'he already came');
  // His body follows his drawing (WAVE_BOSS.drawScale).
  assert.equal(bossesOf(world)[0].radius,waveBossTuning().radius);
});

test('alone (the user, 24/10: "pancadas ×0,5 solo"), his telegraphed hits are WAVE_BOSS.soloDamage of the team fight',()=>{
  const hits=(players:number)=>{
    const {world,sys}=run({seed:5,players});
    sys.chefao!.summon();world.step();
    const [b]=bossesOf(world);let k=0;for(const p of world.players.values()){p.x=b.x+3+k*.4;p.y=b.y+1;k++;}
    const seen:number[]=[];
    for(let i=0;i<20*30&&seen.length<3;i++){world.step();for(const t of world.telegraphs.values())if(t.owner===sys.chefao!.state.enemy&&!seen.includes(t.damage))seen.push(t.damage);}
    return {solo:!!sys.chefao!.state.boss.solo,max:Math.max(...seen)};
  };
  const one=hits(1),three=hits(3);
  assert.equal(one.solo,true);assert.equal(three.solo,false);
  assert.ok(Number.isFinite(one.max)&&Number.isFinite(three.max),'he swung in both');
  assert.ok(one.max<=Math.ceil(three.max*WAVE_BOSS.soloDamage)+1,`solo ${one.max} vs team ${three.max}`);
});

test('the Tank\'s punch: a push telegraph throws the hero away from it, then down a moment (no walk, no attack); the slam pushes, the Síndico\'s does not',async()=>{
  const {addTelegraph}=await import('../../src/sim/telegraphs.ts');
  const {KNOCK_TICKS,KNOCK_DOWN_TICKS}=await import('../../src/sim/player-effects.ts');
  const {world}=run({seed:7});
  const p=[...world.players.values()][0];
  // The start grace (comeca-armado-e-levanta-seguro: untouchable until the first crate or 20 s) is not this test's.
  p.invulnerableUntil=undefined;
  const at={x:p.x,y:p.y},from={x:p.x-1,y:p.y};
  addTelegraph(world,{shape:'circle',x:from.x,y:from.y,radius:3,damage:1,owner:'env:test',push:5},1);
  for(let i=0;i<60&&p.downUntil===undefined;i++){at.x=p.x;at.y=p.y;world.step();}
  assert.ok(p.downUntil!==undefined&&p.knockUntil!==undefined,'thrown');
  for(let i=0;i<KNOCK_TICKS+1;i++)world.step();
  const flew=Math.hypot(p.x-at.x,p.y-at.y);
  assert.ok(flew>3.5&&flew<=5.2,`flew ${flew.toFixed(2)} u`);
  assert.ok(p.x>at.x,'away from where it landed');
  // Down: a held stick does not move him (the shared step; the phone predicts the same).
  const {moveStep}=await import('../../src/maps/index.ts');
  assert.deepEqual(moveStep({x:p.x,y:p.y},{x:1,y:0},world.tick,p,world.terrain),{x:p.x,y:p.y});
  for(let i=0;i<KNOCK_DOWN_TICKS+1;i++)world.step();
  assert.equal(p.downUntil,undefined,'up again');
  assert.notDeepEqual(moveStep({x:p.x,y:p.y},{x:1,y:0},world.tick,p,world.terrain),{x:p.x,y:p.y});
  // His tuning: the slam and the charge push; the final boss's (BOSS_TUNING) does not.
  const t=waveBossTuning();assert.equal(t.slamPush,WAVE_BOSS.slamPush);assert.equal(t.chargePush,WAVE_BOSS.chargePush);
  const {BOSS_TUNING}=await import('../../src/sim/boss.ts');assert.equal(BOSS_TUNING.slamPush,undefined);
});
