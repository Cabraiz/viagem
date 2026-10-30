// Card NEW-20261030-ORQ-corte-C0-sim-digest: scripts/sim-digest.ts is the gate of every cut that touches sim/, rules/
// or maps/ (estudo-arquivos-400-linhas §6 item 4), so it must be stable (the same checkout twice, in one process, gives
// the same lines) and sensitive (a change in the state moves the digest from that tick on, and only from there).
// Shorter than the CLI's 3600 ticks to keep the suite quick; the CLI run is measured in the card's status.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DIGEST_MAPS,DIGEST_SEED,simDigest} from '../../scripts/sim-digest.ts';

const TICKS=1200,EVERY=60,PLANT=600;

for(const map of DIGEST_MAPS){
  test(`${map}: the same seed twice in one process gives the same digest`,async()=>{
    const first=await simDigest({map,ticks:TICKS,every:EVERY}),again=await simDigest({map,ticks:TICKS,every:EVERY});
    assert.equal(first.lines.length,TICKS/EVERY+1);
    assert.deepEqual(again.lines,first.lines);
    assert.equal(again.digest,first.digest);
  });

  test(`${map}: a nudge of one bot at tick ${PLANT} changes the digest from that tick on, not before`,async()=>{
    const clean=await simDigest({map,ticks:TICKS,every:EVERY});
    const planted=await simDigest({map,ticks:TICKS,every:EVERY,afterStep:sim=>{
      if(sim.tick!==sim.world.runStartTick+PLANT)return;
      const bot=sim.players.get('bot-1');assert.ok(bot,'bot-1 is seated');bot.x+=1e-3;
    }});
    const at=PLANT/EVERY;// lines[at-1] is tick PLANT: hashed right after the nudge
    assert.deepEqual(planted.lines.slice(0,at-1),clean.lines.slice(0,at-1),'same before the nudge');
    assert.notEqual(planted.lines[at-1],clean.lines[at-1],'the nudged tick hashes differently');
    assert.notEqual(planted.digest,clean.digest);
  });
}

test('another seed is another digest',async()=>{
  const a=await simDigest({map:'ilha',ticks:EVERY*2}),b=await simDigest({map:'ilha',seed:DIGEST_SEED+1,ticks:EVERY*2});
  assert.notEqual(b.digest,a.digest);
});
