import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,type Input} from '../src/game/net/shared.ts';
import {Rng} from '../src/game/sim/rng.ts';
import {stateHash} from '../src/game/sim/core.ts';
import type {SimEvent} from '../src/game/sim/types.ts';

const IDS=['a','b','c'];
/** Scripted commands: same script seed => same commands. Includes taps, skills and a disconnect window. */
function play(seed:number,script:number,ticks=600,onTick?:(s:Simulation,before:Map<string,number>)=>void){
  const s=new Simulation(seed),r=new Rng(script);
  IDS.forEach((id,i)=>s.add(id,`P${i}`,'cidadao-comum'));
  s.resetRun();
  const hashes:string[]=[];
  for(let t=1;t<=ticks;t++){
    if(t===200)s.setOnline('c',false);
    if(t===300)s.setOnline('c',true);
    for(const id of IDS){
      const live=s.enemies.filter(e=>e.hp>0);
      const input:Input={seq:t,x:r.range(-1,1),y:r.range(-1,1),attack:true,skill:r.chance(.03),target:live.length&&r.chance(.3)?r.pick(live).id:undefined};
      s.input(id,input);
    }
    const before=new Map<string,number>([...s.players.values(),...s.enemies].map(e=>[e.id,e.hp]));
    s.step();
    onTick?.(s,before);
    hashes.push(s.stateHash());
  }
  return {s,hashes};
}

test('600-tick replay with the same seed and commands yields the same state hash every tick',()=>{
  const a=play(0x4c8f2a17,99),b=play(0x4c8f2a17,99);
  assert.equal(a.hashes.length,600);
  assert.deepEqual(a.hashes,b.hashes);
  assert.deepEqual(a.s.snapshot(),b.s.snapshot());
  assert.notEqual(play(0x4c8f2a17,100).hashes.at(-1),a.hashes.at(-1));
  assert.notEqual(play(54321,99).hashes.at(-1),a.hashes.at(-1));
});

test('replay hp changes are explained by central damage events; kills once; events stay in their tick',()=>{
  const kills=new Map<string,number>();let lastId=0,damageEvents=0;
  play(0x4c8f2a17,7,600,(s,before)=>{
    const events=s.events as (SimEvent&{eventId:number})[];
    for(const e of events){assert.ok(e.eventId>lastId,'eventId must grow and never repeat across ticks');lastId=e.eventId;}
    const dealt=new Map<string,number>(),healed=new Set<string>();
    for(const e of events){
      if(e.type==='damage'){damageEvents++;dealt.set(e.target,(dealt.get(e.target)??0)+e.amount);}
      if(e.type==='kill')kills.set(e.enemy,(kills.get(e.enemy)??0)+1);
      // Heals have their own events (coxinha pickup/offer, revive, upgrade raising maxHp, chest).
      if((e.type==='pickup'||e.type==='revived'||e.type==='upgrade'||e.type==='evolve')&&'player' in e)healed.add(e.player);
    }
    for(const p of s.players.values()){
      const was=before.get(p.id)!,expected=was-(dealt.get(p.id)??0);
      assert.ok(p.hp<=p.stats.maxHp+1e-9,`player ${p.id} hp above max`);
      if(healed.has(p.id)||p.stats.regen>0)assert.ok(p.hp>=expected-1e-9,`player ${p.id} hp ${was}->${p.hp} lost more than events ${dealt.get(p.id)??0}`);
      else assert.ok(Math.abs(expected-p.hp)<1e-9,`player ${p.id} hp ${was}->${p.hp} vs events ${dealt.get(p.id)??0}`);
    }
    for(const e of s.enemies){
      // Enemies that spawned this tick have no "before".
      if(!before.has(e.id))continue;
      assert.ok(Math.abs(before.get(e.id)!-(dealt.get(e.id)??0)-e.hp)<1e-9,`enemy ${e.id}`);
      assert.ok(e.hp>0);
    }
    for(const [id] of kills)assert.equal(s.world.enemies.has(id),false,`killed ${id} left the world`);
  });
  assert.ok(damageEvents>0,'scenario must exercise damage');
  assert.ok(kills.size>0,'scenario must exercise kills');
  for(const [id,n] of kills)assert.equal(n,1,`kill for ${id} emitted ${n} times`);
});

test('step with no activity returns no events from earlier ticks',()=>{
  // No players: the director announces round 1 on the first tick, then nothing happens until the opening ends.
  const s=new Simulation();s.resetRun();
  const first=s.step();
  assert.ok(first.some(e=>e.type==='round'&&e.phase==='prepare'));
  assert.deepEqual(s.events,first);
  for(let i=0;i<20;i++){assert.deepEqual(s.step(),[]);assert.deepEqual(s.events,[]);}
});

test('rematch reset is deterministic and clears world, combat fields and id counters',()=>{
  // Both runs end before the scripted disconnect at tick 200, so membership is identical.
  const runA=play(0x4c8f2a17,3,190).s,runB=play(0x4c8f2a17,3,120).s;
  runA.resetRun();runB.resetRun();
  // eventSeq is monotonic across rematches by design; everything else must match.
  const fresh=(s:Simulation)=>({...s.world.state(),eventSeq:0});
  assert.equal(stateHash(fresh(runA)),stateHash(fresh(runB)));
  assert.ok(runA.world.state().eventSeq>=runB.world.state().eventSeq);
  assert.equal(runA.tick,0);assert.equal(runA.outcome,undefined);
  assert.equal(runA.world.enemies.size,0);assert.equal(runA.world.pickups.size,0);assert.equal(runA.world.projectiles.size,0);
  assert.equal(runA.world.round.index,0);assert.deepEqual(runA.world.team,{xp:0,level:1,nextXp:5});
  for(const p of runA.players.values()){
    const twin=runB.players.get(p.id)!;
    assert.deepEqual(p.weaponReady,{});assert.deepEqual(p.build,twin.build);
    assert.deepEqual(p.build.weapons.map(w=>[w.id,w.level]),[['chinelo',1]],'class kit starting weapon');
    assert.deepEqual(p.build.passives,[]);
    assert.equal(p.target,undefined);assert.equal(p.downed,undefined);assert.ok(!p.eliminated);
    assert.equal(p.hp,p.stats.maxHp);assert.equal(p.stats.maxHp,110,'base 100 + cidadao-comum kit bonus');
    assert.equal(p.score,0);assert.equal(p.attackTick,0);
  }
  assert.equal(runA.world.nextId('x'),'x-1');
});

test('players carry contract combat fields and facing follows movement',()=>{
  const s=new Simulation();s.add('p','P','cidadao-comum');s.resetRun();const p=s.players.get('p')!;
  assert.deepEqual(p.facing,{x:0,y:1});assert.equal(p.stats.might,1);assert.deepEqual(p.weaponReady,{});
  s.input('p',{seq:1,x:-1,y:0,attack:false});s.step();
  assert.deepEqual(p.facing,{x:-1,y:0});
  s.input('p',{seq:2,x:0,y:0,attack:false});s.step();
  assert.deepEqual(p.facing,{x:-1,y:0});
});
