// NEW-20261029-ORQ-smoke-worker-espera-mais: the local rooms Worker gets 240 s (LOCAL_WORKER_WAIT_S) to answer /health,
// says every 30 s where wrangler's log is, and fails at once when wrangler exits. A fake clock stands in for the minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {healthOk,waitForHealth,waitSeconds,wranglerPhase} from '../../scripts/local-worker.mjs';

/** A clock that only moves when the waiter sleeps. */
function fakeClock(){
  let t=0;
  return {now:()=>t,pause:async(ms:number)=>{t+=ms;}};
}

test('a fake /health that answers only after 100 s passes, with a progress line at 30, 60 and 90 s',async()=>{
  const clock=fakeClock(),reports:number[]=[];
  // A real HTTP /health: 503 until the fake clock reaches 100 s, then 200.
  const server=createServer((_,res)=>{res.statusCode=clock.now()>=100_000?200:503;res.end();});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    const result=await waitForHealth({probe:()=>healthOk(endpoint),
      waitMs:waitSeconds({})*1000,now:clock.now,pause:clock.pause,report:(s:number)=>reports.push(s)});
    assert.equal(result,'ready');
    assert.equal(clock.now(),100_000);
    assert.deepEqual(reports,[30,60,90]);
  }finally{server.close();}
});

test('never healthy: gives up at the 240 s default, not at the old 60 s',async()=>{
  const clock=fakeClock();let tries=0;
  const result=await waitForHealth({probe:async()=>{tries++;return false;},waitMs:waitSeconds({})*1000,now:clock.now,pause:clock.pause});
  assert.equal(result,'timeout');
  assert.equal(clock.now(),240_000);
  assert.equal(tries,241);
});

test('wrangler exiting fails at once, without waiting out the deadline',async()=>{
  const clock=fakeClock();let gone=false,tries=0;
  const result=await waitForHealth({probe:async()=>{if(++tries===3)gone=true;return false;},exited:()=>gone,waitMs:240_000,now:clock.now,pause:clock.pause});
  assert.equal(result,'exited');
  assert.equal(tries,3);
  assert.equal(clock.now(),2000);
});

test('LOCAL_WORKER_WAIT_S sets the deadline; nonsense is refused',()=>{
  assert.equal(waitSeconds({}),240);
  assert.equal(waitSeconds({LOCAL_WORKER_WAIT_S:'400'}),400);
  for(const bad of ['0','-5','abc'])assert.throws(()=>waitSeconds({LOCAL_WORKER_WAIT_S:bad}),/LOCAL_WORKER_WAIT_S/);
});

test("the progress line shows the log's last line, without colors",()=>{
  const log='\x1b[33m⛅️ wrangler 4.147.0\x1b[0m\r\n───────────\r\nUsing vars defined in multiplayer/.dev.vars\r\n\x1b[2mStarting local server...\x1b[0m\r\n\r\n';
  assert.equal(wranglerPhase(log),'Starting local server...');
  assert.equal(wranglerPhase(''),'(log vazio)');
});

test('a /health that does not answer at all counts as not ready (no throw)',async()=>{
  assert.equal(await healthOk('http://127.0.0.1:9',500),false);
});
