// NEW-20261029-ORQ-solo-segunda-chance (auditoria-jogabilidade-28-10 item 4), in the real match (Cidade Nevada,
// chaveiro, ninhos, manual): alone with 0 bots the first fall gets up by itself in 5 s and the run goes on; the second
// fall is the defeat, as before. With a bot in the run nothing changes: nobody gets up alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {REVIVE_INVULNERABLE_TICKS,SOLO_SELF_REVIVE_TICKS,downPlayer} from '../../src/sim/revive.ts';
import type {SimEvent} from '../../src/contract/types.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const field=cityAsField(loaded.terrain);

function match(seed:number,bots:number){
  const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  s.add('p0','P0','cidadao-comum');
  for(let i=0;i<bots;i++)s.addBot(`b${i}`,`B${i}`,'cidadao-comum');
  s.resetRun();
  let now=1000;
  const events:SimEvent[]=[];
  const step=(n=1)=>{for(let i=0;i<n&&!s.outcome;i++){s.step(now+=50);events.push(...s.events);}};
  return {s,hero:()=>s.players.get('p0')!,events,step};
}

test('solo, 0 bots: the first fall gets up by itself in 5 s; the second fall ends the match',()=>{
  for(const seed of [1,2,3]){
    const m=match(seed,0),hero=m.hero();
    m.step(5);
    assert.equal(m.s.run.revive.soloChances,1,`seed ${seed}: one second chance`);
    downPlayer(m.s.world,hero);
    const fell=m.s.tick;
    while(hero.downed&&m.s.tick<fell+SOLO_SELF_REVIVE_TICKS*2)m.step();
    assert.equal(m.s.outcome,undefined,`seed ${seed}: the first fall is not the defeat`);
    assert.equal(hero.downed,undefined,`seed ${seed}: back on his feet`);
    assert.ok(Math.abs(m.s.tick-fell-SOLO_SELF_REVIVE_TICKS)<=1,`seed ${seed}: up after 5 s (${m.s.tick-fell} ticks)`);
    assert.ok(hero.hp>0);
    assert.ok(m.events.some(e=>e.type==='revived'&&e.player==='p0'&&!('by' in e&&e.by)),'the get-up has no rescuer');
    assert.equal(m.s.run.revive.soloChances,0);
    // The protection runs out; the next fall is the end, at once.
    m.step(REVIVE_INVULNERABLE_TICKS+1);
    if(!hero.downed&&!m.s.outcome)downPlayer(m.s.world,hero);
    m.step(5);
    assert.equal(m.s.outcome,'defeat',`seed ${seed}: the second fall is the defeat`);
  }
});

test('with a bot nothing changes: the fallen hero never gets up alone and the solo chance stays unused',()=>{
  const m=match(1,1),hero=m.hero(),bot=m.s.players.get('b0')!;
  m.step(5);
  // The bot stands far away and is never driven here (the room's brain is not in the Simulation): no rescue comes.
  bot.x+=40;
  downPlayer(m.s.world,hero);
  m.step(SOLO_SELF_REVIVE_TICKS*2);
  assert.ok(hero.downed,'still down after 10 s');
  assert.equal(m.s.outcome,undefined,'the bot is still up');
  assert.ok(!m.events.some(e=>e.type==='revived'),'nobody got up');
  assert.equal(m.s.run.revive.soloChances,1);
  // Both down: the defeat, with no second chance.
  downPlayer(m.s.world,bot);
  m.step(5);
  assert.equal(m.s.outcome,'defeat');
});
