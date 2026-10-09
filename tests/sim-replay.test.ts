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

test('replay hp changes are fully explained by central damage events; kills once; events stay in their tick',()=>{
  const kills=new Map<string,number>();let lastId=0,damageEvents=0,respawns=0;
  play(0x4c8f2a17,7,600,(s,before)=>{
    const events=s.events as (SimEvent&{eventId:number})[];
    for(const e of events){assert.ok(e.eventId>lastId,'eventId must grow and never repeat across ticks');lastId=e.eventId;}
    const dealt=new Map<string,number>();
    for(const e of events){
      if(e.type==='damage'){damageEvents++;dealt.set(e.target,(dealt.get(e.target)??0)+e.amount);}
      if(e.type==='kill')kills.set(e.enemy,(kills.get(e.enemy)??0)+1);
    }
    for(const p of s.players.values()){
      const was=before.get(p.id)!;
      // Legacy respawn is the only heal: 0 -> 100 before any same-tick damage.
      const base=was===0&&p.hp>0?100:was;if(base!==was)respawns++;
      assert.ok(Math.abs(base-(dealt.get(p.id)??0)-p.hp)<1e-9,`player ${p.id} hp ${was}->${p.hp} vs events ${dealt.get(p.id)??0}`);
    }
    for(const e of s.enemies){
      assert.ok(Math.abs(before.get(e.id)!-(dealt.get(e.id)??0)-e.hp)<1e-9,`enemy ${e.id}`);
      if(e.hp===0)assert.equal(s.world.enemies.has(e.id),false);
    }
  });
  assert.ok(damageEvents>0,'scenario must exercise damage');
  assert.ok(kills.size>0,'scenario must exercise kills');
  for(const [id,n] of kills)assert.equal(n,1,`kill for ${id} emitted ${n} times`);
  assert.ok(respawns>=0);
});

test('step with no activity returns no events from earlier ticks',()=>{
  const s=new Simulation();const p=s.add('p','P','cidadao-comum');
  s.enemies=[{id:'enemy',x:p.x+.6,y:p.y,hp:60}];
  s.input('p',{seq:1,x:0,y:0,attack:true});
  assert.ok(s.step().some(e=>e.type==='damage'));
  s.enemies=[];
  assert.deepEqual(s.step(),[]);assert.deepEqual(s.events,[]);
});

test('rematch reset is deterministic and clears world, combat fields and id counters',()=>{
  // Both runs end before the scripted disconnect at tick 200, so membership is identical.
  const runA=play(0x4c8f2a17,3,190).s,runB=play(0x4c8f2a17,3,120).s;
  runA.resetRun();runB.resetRun();
  // eventSeq is monotonic across rematches by design; everything else must match.
  const fresh=(s:Simulation)=>({...s.world.state(),eventSeq:0,enemies:s.enemies});
  assert.equal(stateHash(fresh(runA)),stateHash(fresh(runB)));
  assert.ok(runA.world.state().eventSeq>=runB.world.state().eventSeq);
  assert.equal(runA.tick,0);assert.equal(runA.world.nextId('x'),'x-1');
  for(const p of runA.players.values()){
    assert.deepEqual(p.weaponReady,{});assert.deepEqual(p.build,{weapons:[],passives:[]});
    assert.equal(p.target,undefined);assert.equal(p.respawnTick,undefined);assert.equal(p.stats.maxHp,100);
  }
  assert.equal(runA.world.enemies.size,3);assert.ok(runA.enemies.every(e=>e.hp===e.maxHp));
});

test('players carry contract combat fields and facing follows movement',()=>{
  const s=new Simulation();s.enemies=[];const p=s.add('p','P','cidadao-comum');
  assert.deepEqual(p.facing,{x:0,y:1});assert.equal(p.stats.might,1);assert.deepEqual(p.weaponReady,{});
  s.input('p',{seq:1,x:-1,y:0,attack:false});s.step();
  assert.deepEqual(p.facing,{x:-1,y:0});
  s.input('p',{seq:2,x:0,y:0,attack:false});s.step();
  assert.deepEqual(p.facing,{x:-1,y:0});
});

test('direct hp writes on prototype gosmas keep world membership consistent (revive, kill, push)',()=>{
  const s=new Simulation();s.add('p','P','cidadao-comum');
  s.enemies.forEach(e=>e.hp=0);s.step();
  assert.equal(s.world.enemies.size,0);assert.equal(s.victory,true);
  s.enemies[0].hp=1000;s.step();
  assert.equal(s.world.enemies.has(s.enemies[0].id),true);assert.equal(s.victory,false);
});
