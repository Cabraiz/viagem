// NEW-20261012-ORQ-cidade-06-base-praca (E5): each city room plays on its own fork of the decoded city, so the
// barricade blockers of one room never leak into another (the decoded asset is shared by the whole process), and the
// barricades reach the frames as kind 'barricada' only behind `cityStructures` (off until the client draws them).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../../multiplayer/simulation.ts';
import {CityTerrain,cityTerrainFrom,cityAsField} from '../../src/maps/index.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string};
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const loaded=await cityTerrainFrom(cityText,manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const shared=loaded.terrain;
const citySim=(cityStructures?:boolean)=>new Simulation(7,{world:'cidade',terrain:cityAsField(shared),...(cityStructures===undefined?{}:{cityStructures})});
const cityOf=(sim:Simulation)=>{assert.ok(sim.terrain instanceof CityTerrain);return sim.terrain;};

test('two city rooms get two forks of the shared city: a blocker in one never reaches the other nor the shared one',()=>{
  const a=cityOf(citySim()),b=cityOf(citySim());
  assert.notEqual(a,b);assert.notEqual(a,shared);assert.notEqual(b,shared);
  assert.equal(a.asset,shared.asset);assert.equal(a.signature,shared.signature);
  const p=shared.asset.points.praca,before=b.blockers();
  a.setBlocker('teste-sala',{x:p.x,y:p.y,r:1});
  // Blockers stop enemies only: solid in the fork's enemy view, ignored by its own clearDisc (heroes).
  assert.equal(a.forEnemies().clearDisc(p.x,p.y,0),false);assert.equal(a.clearDisc(p.x,p.y,0),true);
  assert.equal(b.forEnemies().clearDisc(p.x,p.y,0),true);assert.equal(shared.forEnemies().clearDisc(p.x,p.y,0),true);
  assert.equal(b.blockers(),before,'the other room did not change');assert.deepEqual(shared.blockers(),[]);
});

test('island and endless rooms are not forked and say nothing new',()=>{
  for(const world of ['ilha','infinito'] as const){
    const sim=new Simulation(7,{world});
    assert.ok(!(sim.terrain instanceof CityTerrain));
    assert.deepEqual(sim.botView().structures.map(s=>s.kind),['muralha'],world);
  }
});

test('resetRun drops the previous run\'s blockers from the room\'s fork',()=>{
  const sim=citySim(),city=cityOf(sim),p=shared.asset.points.praca;
  sim.add('p','Ana','cidadao-comum');
  city.setBlocker('teste-run-velha',{x:p.x,y:p.y,r:1});
  sim.resetRun();
  assert.equal(cityOf(sim),city,'same fork for the whole room');
  assert.ok(!city.blockers().some(b=>b.id==='teste-run-velha'));
});

test("barricades are not in the frames' structures unless cityStructures is on",t=>{
  for(const sim of [citySim(),citySim(false)]){
    sim.add('p','Ana','cidadao-comum');sim.resetRun();
    assert.equal(sim.cityStructures,false);
    const kinds=sim.botView().structures.map(s=>s.kind);
    assert.ok(!kinds.includes('barricada'),`default off: ${kinds}`);
    assert.equal(kinds.filter(k=>k==='muralha').length,1);
  }
  const on=citySim(true);on.add('p','Ana','cidadao-comum');on.resetRun();
  const rows=(on.run.stonewards.state as {barricades?:readonly {id:string;hp:number;maxHp:number;down?:boolean}[]}).barricades;
  if(!rows?.length){t.skip('stonewards has no city barricades yet (cidade-06 part 2)');return;}
  const views=on.botView().structures.filter(s=>s.kind==='barricada');
  assert.deepEqual(views.map(v=>v.id),rows.map(r=>r.id));
  for(const [i,v] of views.entries())assert.deepEqual([v.hp,v.maxHp],[rows[i].down?0:rows[i].hp,rows[i].maxHp]);
  assert.deepEqual([...new Set(views.map(v=>v.id))].sort(),['barricada-L','barricada-N','barricada-O','barricada-S']);
});
