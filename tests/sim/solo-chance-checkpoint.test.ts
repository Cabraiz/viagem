// NEW-20261029-ORQ-solo-segunda-chance, the checkpoint gap: the solo second chance is part of the room checkpoint, so a
// room that restarts and resumes the run does not give a spent chance back. A run that never spent it stores nothing
// (no state hash, no shape fingerprint moves) and resumes with the chance; junk from storage counts as a fresh run's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {REVIVE_INVULNERABLE_TICKS,SOLO_SECOND_CHANCES,SOLO_SELF_REVIVE_TICKS,downPlayer} from '../../src/sim/revive.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const field=cityAsField(loaded.terrain);
const SEED=7;

function solo(){
  const s=new Simulation(SEED,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  s.add('p0','P0','cidadao-comum');
  let now=1000;
  const step=(n=1)=>{for(let i=0;i<n&&!s.outcome;i++)s.step(now+=50);};
  return {s,hero:()=>s.players.get('p0')!,step};
}
/** What the Durable Object stores and reads back: JSON. */
const stored=(s:Simulation)=>JSON.parse(JSON.stringify(s.checkpoint())) as SimCheckpoint;
function resumed(cp:SimCheckpoint){
  const m=solo();
  assert.equal(m.s.resume(cp),true,'the checkpoint resumes');
  return m;
}

test('a spent solo chance is in the checkpoint: the resumed room does not give it back and the next fall is the defeat',()=>{
  const m=solo();m.s.resetRun();m.step(5);
  downPlayer(m.s.world,m.hero());
  m.step(SOLO_SELF_REVIVE_TICKS+2);
  assert.equal(m.hero().downed,undefined,'got up by himself');
  assert.equal(m.s.run.revive.soloChances,0);
  m.step(REVIVE_INVULNERABLE_TICKS+1);
  const cp=stored(m.s);
  assert.equal(cp.systems.soloChances,0,'the checkpoint keeps it');
  const r=resumed(cp);
  assert.equal(r.s.run.revive.soloChances,0,'not given back');
  downPlayer(r.s.world,r.hero());
  r.step(5);
  assert.equal(r.s.outcome,'defeat','the fall after the restart is the end');
});

test('an unspent chance stores nothing and resumes as one chance; the fresh shape and state hash keep no new key',()=>{
  const m=solo();m.s.resetRun();m.step(5);
  const cp=stored(m.s);
  assert.equal('soloChances' in cp.systems,false,'absent while unspent');
  assert.equal('soloChances' in (m.s.run.state() as object),false);
  const r=resumed(cp);
  assert.equal(r.s.run.revive.soloChances,SOLO_SECOND_CHANCES);
  downPlayer(r.s.world,r.hero());
  r.step(SOLO_SELF_REVIVE_TICKS+2);
  assert.equal(r.s.outcome,undefined);
  assert.equal(r.hero().downed,undefined,'the chance still works after the restart');
});

test('junk soloChances from storage resumes as a fresh run’s chance, never more',()=>{
  const m=solo();m.s.resetRun();m.step(5);
  for(const junk of [-1,0.5,99,'1',null]){
    const cp=stored(m.s);
    (cp.systems as {soloChances?:unknown}).soloChances=junk;
    assert.equal(resumed(cp).s.run.revive.soloChances,SOLO_SECOND_CHANCES,`junk ${JSON.stringify(junk)}`);
  }
});
