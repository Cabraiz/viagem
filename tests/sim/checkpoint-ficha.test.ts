// NEW-20261013-ORQ-ficha-de-torre (D-048): a round checkpoint written by the build before the single pile of material
// (balance {coco, pedra}, that build's fingerprint) resumes on this build with {units: coco + pedra}; any other shape is
// still refused. Phase 2: the team's Grana moved to the stonewards state; that legacy build had none there (the
// chaveiro's state held it when the run had the objective), so it migrates to stonewards.grana = chaveiro.grana ?? 0.
// Since NEW-20261014-ORQ-carteira-e-pix that team pot is then split among the players' wallets (the chain: legacy →
// pot → wallets; tests/sim/carteira-pix.test.ts has the pot step alone).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {UNITS_PER_TOKEN,tokensOf,tokenProgress} from '../../src/rules/index.ts';

const SEED=4242,BOTS=[['bot-1','Robô do Gás','mendigo'],['bot-2','Robô da Feira','cidadao-comum']] as const;
const seat=(sim:Simulation)=>{for(const [id,name,classId] of BOTS)sim.addBot(id,name,classId);return sim;};
function playTo(round:number){
  const sim=seat(new Simulation(SEED,{world:'infinito'})),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
  sim.resetRun();
  for(let i=0,before=sim.world.round.index;i<20*60*6;i++){
    bots.think(sim);sim.step(sim.tick*50);
    if(sim.world.round.index!==before&&sim.world.round.index===round)return sim;
    before=sim.world.round.index;
  }
  throw new Error(`never reached round ${round}`);
}
const balanceOf=(sim:Simulation)=>(sim.run.state().stonewards as {balance:{units:number}}).balance;
type Legacy={shape:string;systems:{stonewards:{balance:unknown;grana?:number;splitCursor?:number};chaveiro?:{grana?:number}};players:{id:string;run:{grana?:number}}[]};
/** What the builds before the wallets wrote: no split cursor, no wallet on the players. */
const unwallet=(cp:Legacy)=>{delete cp.systems.stonewards.splitCursor;for(const p of cp.players)delete p.run.grana;return cp;};

test('a pre-ficha checkpoint (two piles, the old fingerprint) resumes with one pile of coco + pedra units',()=>{
  const sim=playTo(2);
  balanceOf(sim).units=57;
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint&{shape:string};
  // What the older build wrote for the same run: two piles and its own fingerprint.
  const legacy=unwallet(JSON.parse(JSON.stringify(cp)) as Legacy);
  // No team Grana in that build's stonewards state (and, without the objective, no chaveiro to hold one).
  assert.ok(sim.teamGrana()>0,'the kills of round 1 paid the wallets');assert.equal(legacy.systems.chaveiro,undefined);
  legacy.systems.stonewards.balance={coco:25,pedra:32};delete legacy.systems.stonewards.grana;legacy.shape=sim.freshShape().legacy;
  assert.notEqual(sim.freshShape().legacy,sim.freshShape().fingerprint,'the pile shape is in the fingerprint');
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.checkpointShapeOk(legacy),true,'migrated before the shape check');
  assert.deepEqual(legacy.systems.stonewards.balance,{units:57});assert.equal(legacy.shape,fresh.freshShape().fingerprint);
  assert.equal(legacy.systems.stonewards.grana,undefined,'a run without the objective had no Grana: nothing to split');
  assert.equal(legacy.systems.stonewards.splitCursor,0);
  assert.equal(fresh.resume(legacy),true);
  assert.equal(balanceOf(fresh).units,57);assert.equal(fresh.teamGrana(),0);
  // The one pile reads as whole fichas and the ring's fraction of the next (whatever UNITS_PER_TOKEN is).
  const whole=Math.floor(57/UNITS_PER_TOKEN);
  assert.equal(tokensOf(57),whole);assert.ok(Math.abs(tokenProgress(57)-(57-whole*UNITS_PER_TOKEN)/UNITS_PER_TOKEN)<1e-9);
  // Idempotent: a second pass changes nothing.
  fresh.migrateCheckpoint(legacy);assert.deepEqual(legacy.systems.stonewards.balance,{units:57});assert.equal(legacy.systems.stonewards.grana,undefined);
});

test('a pre-ficha checkpoint of a city run with the chaveiro: its Grana moves from the chaveiro to the team, then into the wallets, and the bill reads them',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string};
  const loaded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),manifest.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const make=()=>seat(new Simulation(SEED,{world:'cidade',terrain:loaded.terrain,cityStructures:true,objective:'chaveiro'}));
  const sim=make();sim.resetRun();
  for(let i=0;i<40;i++)sim.step(sim.tick*50);
  balanceOf(sim).units=57;sim.players.get('bot-1')!.grana=5;
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint&Legacy;
  assert.ok(cp.systems.chaveiro,'the run has the objective');assert.equal('grana' in cp.systems.chaveiro!,false,'no Grana of its own (D-048)');
  // The older build: two piles, no team Grana, R$ 73 in the chaveiro's state, its own fingerprint.
  const legacy=unwallet(JSON.parse(JSON.stringify(cp)) as Legacy);
  legacy.systems.stonewards.balance={coco:25,pedra:32};delete legacy.systems.stonewards.grana;legacy.systems.chaveiro!.grana=73;
  // Nor the banks nor the vehicles (they came after): the migration gives it a fresh run's.
  delete (legacy.systems as {banks?:unknown}).banks;delete (legacy.systems as {veiculos?:unknown}).veiculos;
  legacy.shape=sim.freshShape().legacy;
  const fresh=make();
  assert.equal(fresh.checkpointShapeOk(legacy),true,'migrated before the shape check');
  assert.deepEqual(legacy.systems.stonewards.balance,{units:57});assert.equal(legacy.systems.stonewards.grana,undefined,'the pot went to the wallets');
  assert.deepEqual(legacy.players.map(p=>[p.id,p.run.grana]),[['bot-1',37],['bot-2',36]],'R$ 73 split in join order, the remainder to the first');
  assert.equal(legacy.systems.stonewards.splitCursor,1,'the next remainder starts after it');
  assert.equal('grana' in legacy.systems.chaveiro!,false,'gone from the chaveiro');assert.equal(legacy.shape,fresh.freshShape().fingerprint);
  assert.equal(fresh.resume(legacy),true);
  assert.equal(fresh.granaOf('bot-1'),37);assert.equal(fresh.granaOf('bot-2'),36);assert.equal(fresh.run.objectiveView()!.grana,73,'the bill reads the wallets together');
  // Idempotent, and the same checkpoint under any other fingerprint is left alone.
  const again=JSON.parse(JSON.stringify(legacy));fresh.migrateCheckpoint(again);assert.deepEqual(again,legacy);
  const odd=JSON.parse(JSON.stringify(cp)) as Legacy;odd.systems.stonewards.balance={coco:1,pedra:2};delete odd.systems.stonewards.grana;
  odd.systems.chaveiro!.grana=9;odd.shape='something-else';
  assert.equal(fresh.checkpointShapeOk(odd),false);assert.equal(odd.systems.chaveiro!.grana,9,'not touched');assert.equal(odd.systems.stonewards.grana,undefined);
});

test('only that shape is migrated: two piles under another fingerprint, or a current checkpoint, are left as they are',()=>{
  const sim=playTo(2),cp=JSON.parse(JSON.stringify(sim.checkpoint()));
  const odd=JSON.parse(JSON.stringify(cp));odd.systems.stonewards.balance={coco:1,pedra:2};odd.shape='something-else';
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.checkpointShapeOk(odd),false,'another build: refused');
  assert.deepEqual(odd.systems.stonewards.balance,{coco:1,pedra:2},'not touched');
  const now=JSON.parse(JSON.stringify(cp));fresh.migrateCheckpoint(now);assert.deepEqual(now,cp,'a current checkpoint is untouched');
  assert.equal(fresh.checkpointShapeOk(now),true);
});

// Review: the fingerprints the production build before D-048 really wrote (main at e5b34e5, its code identical to the
// origin/main this branch merged; measured by exporting that build and running its freshShape). If main changes a
// system's shape before this branch lands, re-measure them against main's build and update both together.
const PRE_FICHA_FINGERPRINTS={ilha:'e9cdc54b',infinito:'e9cdc54b',cidade:'1ced0520','cidade+chaveiro':'9ed0df3e'};
test('the legacy fingerprint is exactly the one the pre-ficha production build wrote, for every world and the chaveiro',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string};
  const loaded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),manifest.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const city={world:'cidade' as const,terrain:loaded.terrain,cityStructures:true};
  const variants:[keyof typeof PRE_FICHA_FINGERPRINTS,ConstructorParameters<typeof Simulation>[1]][]=[['ilha',{world:'ilha'}],['infinito',{world:'infinito'}],['cidade',city],['cidade+chaveiro',{...city,objective:'chaveiro'}]];
  for(const [name,options] of variants)assert.equal(new Simulation(4242,options).freshShape().legacy,PRE_FICHA_FINGERPRINTS[name],name);
});

// Bancos (card bancos-e-veiculos): a city checkpoint written before the banks (this code's fingerprint without them)
// resumes with every ATM full; the island's and the endless world's have no banks and no preBanks fingerprint.
test('bancos: a city checkpoint from the build before the banks resumes with fresh banks; island and endless have none',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string};
  const loaded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),manifest.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  for(const objective of [undefined,'chaveiro'] as const){
    const make=()=>seat(new Simulation(SEED,{world:'cidade',terrain:loaded.terrain,cityStructures:true,...(objective?{objective}:{})}));
    const sim=make();sim.resetRun();
    for(let i=0;i<40;i++)sim.step(sim.tick*50);
    const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint&{shape:string;systems:{banks?:unknown}};
    assert.ok(cp.systems.banks,'the city checkpoint carries the banks');
    // The build before the banks had no vehicles either (they came after).
    const old=JSON.parse(JSON.stringify(cp)) as typeof cp&{systems:{veiculos?:unknown}};delete old.systems.banks;delete old.systems.veiculos;old.shape=sim.freshShape().preBanks!;
    assert.ok(old.shape&&old.shape!==sim.freshShape().fingerprint,'the banks are in the fingerprint');
    const fresh=make();
    assert.equal(fresh.resume(old),true,`${objective??'muralha'}: the pre-banks checkpoint resumes`);
    assert.deepEqual(fresh.run.banks!.state,sim.freshShape().banks,'every ATM full');
  }
  for(const world of ['ilha','infinito'] as const){
    const shape=new Simulation(SEED,{world}).freshShape();
    assert.equal(shape.preBanks,undefined,world);assert.equal(shape.banks,undefined,world);
  }
});
