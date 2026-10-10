/** NEW-20261009-N2-award-stats-server: the result-screen prizes come from the server counters, so every client agrees. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,applyDelta,delta,type Snapshot} from '../src/game/net/shared.ts';
import {JsonRunFeed} from '../src/game/net/run-feed.ts';
import {FrameDecoder,FrameEncoder,WireIds,type FrameInput} from '../src/game/net/protocol4.ts';
import {applyEvents,emptyTally,type RunResult} from '../src/game/hud/model.ts';
import {computeAwards} from '../src/game/hud/awards.ts';

function playRun(){
  const s=new Simulation(9001);
  s.add('a','Ana','rei-do-pastel');s.add('b','Bia','tio-do-churrasco');s.add('c','Caio','goleira');
  s.resetRun();
  const steps:Snapshot[]=[];
  for(let t=0;t<2400;t++){
    [...s.players.values()].forEach((p,i)=>s.input(p.id,{seq:t+1,x:Math.cos(t/25+i*2),y:Math.sin(t/25+i*2),attack:false}));
    s.step();
    if(t%2)steps.push(s.snapshot(-1));
  }
  return {s,steps};
}
const resultOf=(feed:JsonRunFeed):RunResult=>({victory:false,durationTicks:2400,round:1,totalRounds:10,seed:'x',players:[...feed.players.values()].map(p=>({...p}))});

test('two clients, one reconnecting near the end, show exactly the same prizes',()=>{
  const {s,steps}=playRun();
  // A follows every broadcast as deltas; B lost the connection and only gets the welcome snapshot at the end.
  const a=new JsonRunFeed(),tallyA=emptyTally();
  let last:Snapshot|undefined;
  for(const full of steps){
    const sent=last?delta(last,full):full;last=last?applyDelta(last,sent):full;
    a.apply(sent);applyEvents(tallyA,a.take());
  }
  const b=new JsonRunFeed(),tallyB=emptyTally();
  b.apply(s.snapshot(-1));applyEvents(tallyB,b.take());
  const stats=[...a.players.values()].map(p=>p.stats);
  assert.ok(stats.every(st=>st&&st.downs!==undefined),'server counters reach the client');
  assert.ok(stats.some(st=>st!.pickups>0)&&stats.some(st=>st!.damage>0),JSON.stringify(stats));
  assert.deepEqual([...b.players.values()].map(p=>p.stats),stats,'same counters after a reconnect');
  const awardsA=computeAwards(resultOf(a),tallyA),awardsB=computeAwards(resultOf(b),tallyB);
  assert.ok(awardsA.length>=3);
  assert.deepEqual(awardsB,awardsA);
  // Without the server counters the reconnected client would count from the few events it saw.
  const strip=(r:RunResult)=>({...r,players:r.players.map(p=>({...p,stats:{damage:p.stats!.damage,kills:0,revives:0,pickups:0}}))});
  assert.notDeepEqual(computeAwards(strip(resultOf(b)),tallyB),computeAwards(strip(resultOf(a)),tallyA),'the old path disagreed');
});

test('the counters match what the event tally saw from the start, and reset on a rematch',()=>{
  const {s,steps}=playRun();
  const feed=new JsonRunFeed(),tally=emptyTally();
  for(const snap of steps){feed.apply(snap);applyEvents(tally,feed.take());}
  for(const p of feed.players.values()){
    const t=tally.players.get(p.id),st=p.stats!;
    if(!t)continue;
    assert.equal(st.pickups,t.pickups,`${p.id} pickups`);assert.equal(st.heals,t.heals);assert.equal(st.chests,t.chests);
    assert.equal(st.downs,t.downs);assert.equal(st.kills,t.kills);
  }
  s.resetRun();
  assert.ok([...s.players.values()].every(p=>Object.values(s.statsOf(p.id)).every(v=>v===0)));
});

test('protocol 4 carries the same counters (pickups of a far ally are not needed as events)',()=>{
  const {s}=playRun();
  const view=s.view('a') as unknown as FrameInput;
  const r=new FrameDecoder().decode(new FrameEncoder(new WireIds(),{viewer:'a'}).encode(view));
  assert.ok(r.ok);
  for(const p of r.view.players){
    const st=s.statsOf(p.id);
    assert.deepEqual(p.stats,{...st,damage:Math.round(st.damage)});
  }
});
