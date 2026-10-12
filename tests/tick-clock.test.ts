/**
 * The room's wall clock (NEW-20261011-N17-relogio-da-sala), driven by a fake clock: workerd fired setInterval(…,50)
 * every ~52.5 ms and the room ran at ~19 ticks/s; the TickLoop aims each timer at the next tick and catches up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {TickClock,TickLoop,TICK_MS,MAX_TICKS_PER_FIRE,MAX_LAG_MS} from '../multiplayer/tick-clock.ts';

/** Fake timers: one pending timeout at a time (like the loop), fired `late(n)` ms after its deadline. */
function fakeTimers(late:(fire:number)=>number){
  let now=1_000_000,pending:{at:number;fn:()=>void}|undefined,fires=0,cleared=0;
  return {
    timers:{now:()=>now,set:(fn:()=>void,ms:number)=>{assert.equal(pending,undefined,'one timer at a time');pending={at:now+ms+late(fires++),fn};return pending;},
      clear:(h:unknown)=>{if(h===pending){pending=undefined;cleared++;}}},
    /** Fire timers until `ms` of fake time went by. */
    run(ms:number){const end=now+ms;while(pending&&pending.at<=end){const p=pending;pending=undefined;now=Math.max(now,p.at);p.fn();}now=end;},
    /** Jump the clock without firing (an isolate busy elsewhere). */
    stall(ms:number){now+=ms;if(pending)pending.at=Math.max(pending.at,now);},
    get now(){return now;},get pending(){return pending;},get cleared(){return cleared;},
  };
}

test('old loop vs wall clock: a timer 2.5 ms late each time keeps 20 ticks/s, no double tick',()=>{
  const t=fakeTimers(()=>2.5);
  const ticks:number[]=[];
  const loop=new TickLoop(now=>ticks.push(now),t.timers);
  loop.start();t.run(60_000);
  // The old setInterval(…,50) with the same 2.5 ms would have made 60000/52.5 = 1142 ticks (19.05/s).
  assert.ok(ticks.length>=1199&&ticks.length<=1200,`${ticks.length} ticks in 60 s`);
  assert.equal(loop.clock.stats.bursts[2],0,'no fire ran two ticks');
  assert.equal(loop.clock.stats.dropped,0);
});

test('jittery timer (0–20 ms late): 20 ticks/s, bursts of two only now and then, never a long run of them',()=>{
  let seed=7;const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
  const t=fakeTimers(()=>rnd()*20);
  const bursts:number[]=[];let last=-1;
  const loop=new TickLoop(now=>{if(now===last)bursts[bursts.length-1]++;else bursts.push(1);last=now;},t.timers);
  loop.start();t.run(10*60_000);
  const ticks=bursts.reduce((a,b)=>a+b,0);
  assert.ok(ticks>=11_999&&ticks<=12_000,`${ticks} ticks in 10 min`);
  assert.ok(Math.max(...bursts)<=2,'at most two ticks per fire');
  // "Nenhum tick duplo em sequência longa": a late fire is followed by on-time ones.
  let run=0,longest=0;for(const b of bursts){run=b>1?run+1:0;longest=Math.max(longest,run);}
  assert.ok(longest<=1,`longest run of double fires: ${longest}`);
  assert.ok(loop.clock.stats.bursts[2]<bursts.length*.05,`${loop.clock.stats.bursts[2]} double fires of ${bursts.length}`);
});

test('a fire 120 ms late catches up with three ticks at most, the rest on the next fire',()=>{
  const c=new TickClock();c.start(0);
  assert.equal(c.due(49),0,'early fire runs nothing');
  assert.equal(c.delay(49),1);
  assert.equal(c.due(50),1);
  // Next deadline 100; at 270 it owes 4 (100, 150, 200, 250): 3 now, 1 right after.
  assert.equal(c.due(270),MAX_TICKS_PER_FIRE);
  assert.equal(c.delay(270),0,'still behind: no wait');
  assert.equal(c.due(270),1);
  assert.equal(c.delay(270),30);
  assert.equal(c.stats.ticks,5);assert.equal(c.stats.dropped,0);
});

test('more than 0.5 s behind: the debt is dropped, not fast-forwarded',()=>{
  const t=fakeTimers(()=>0);
  const ticks:number[]=[];
  const loop=new TickLoop(now=>ticks.push(now),t.timers);
  loop.start();t.run(1000);
  assert.equal(ticks.length,20);
  t.stall(2000);t.run(0);
  assert.equal(ticks.length,21,'one tick after the stall, not 40');
  assert.equal(loop.clock.stats.resets,1);
  assert.ok(loop.clock.stats.dropped>=39&&loop.clock.stats.dropped<=40,`${loop.clock.stats.dropped} dropped`);
  t.run(1000);
  assert.equal(ticks.length,41,'back to 20 ticks/s from the new start');
  // A 400 ms stall (under MAX_LAG_MS) is caught up, three ticks per fire.
  const before=ticks.length;t.stall(MAX_LAG_MS-100);t.run(0);t.run(0);
  assert.ok(ticks.length-before>=8,`${ticks.length-before} ticks caught up`);
  t.run(1000);
  assert.equal(loop.clock.stats.resets,1,'no second reset');
});

test('stop() cancels the pending fire; start() again begins one step later',()=>{
  const t=fakeTimers(()=>0);
  let n=0;const loop=new TickLoop(()=>{n++;},t.timers);
  loop.start();loop.start();t.run(500);
  assert.equal(n,10,'a second start does not add a timer');
  loop.stop();assert.equal(t.pending,undefined);assert.equal(t.cleared,1);
  t.run(5000);assert.equal(n,10,'stopped');
  loop.start();t.run(TICK_MS-1);assert.equal(n,10);t.run(1);assert.equal(n,11);
  // A tick that stops the loop (last peer gone in advance) ends the burst and schedules nothing.
  const stopper=new TickLoop(()=>{stopper.stop();},t.timers);
  loop.stop();stopper.start();t.stall(160);t.run(0);
  assert.equal(stopper.clock.stats.ticks,3,'the clock owed 3');assert.equal(t.pending,undefined);
});
