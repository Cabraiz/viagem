/**
 * NEW-20261030-ORQ-bocas-sem-loot-e-caixas (auditoria-bocas 30/10: 11-15 of a run's 18 crates stood in the strip of a
 * street mouth, 75 of the 104 loot points touch one): on the real Cidade Nevada no crate of the first step touches an
 * entrance's free strip (maps/city/entradas.ts bocaFaixa), and a run still lays out as many. Results only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {naBoca} from '../../src/maps/city/entradas.ts';
import {CRATE_BODY_RADIUS} from '../../src/rules/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {MOUTH_REACH,NEAR_START_REACH,foraDasBocas} from '../../src/sim/crates.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,asset=city.asset,field=cityAsField(city);
const R=CRATE_BODY_RADIUS,body=(p:{x:number;y:number})=>({x:p.x-R,y:p.y-R,w:2*R,h:2*R});

test('foraDasBocas: a loot point in a mouth\'s strip moves to clear ground beside it; one outside stays put',()=>{
  const inside=asset.loot.filter(p=>naBoca(asset,body(p)));
  assert.ok(inside.length>=50,`${inside.length} loot points in a strip (the audit: 75)`);
  const moved=foraDasBocas(city,asset.loot);
  assert.equal(moved.length,asset.loot.length);
  moved.forEach((p,i)=>{
    const was=asset.loot[i];
    if(!naBoca(asset,body(was))){assert.deepEqual([p.x,p.y],[was.x,was.y]);return;}
    assert.equal(naBoca(asset,body(p)),false,`loot#${i} still in a strip`);
    assert.ok(city.clearDisc(p.x,p.y,R),`loot#${i} on blocked ground`);
    assert.ok(Math.hypot(p.x-was.x,p.y-was.y)<=MOUTH_REACH,`loot#${i} moved ${Math.hypot(p.x-was.x,p.y-was.y).toFixed(1)} u`);
  });
});

// The hero's own start crate (item 2: NEAR_START_REACH u from him) may stand in a strip only when no spot that near
// is free of one (seeds 1-8: the heroes spawn beside the Uno, parked in a mouth's strip); placed and trail crates never do.
test('a run\'s first step: 18 crates for a solo, none in an entrance\'s strip but at most the hero\'s own, seeds 1 to 8',()=>{
  for(let seed=1;seed<=8;seed++){
    const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    s.add('p0','P0','cidadao-comum');
    s.resetRun();
    const hero=[...s.players.values()][0],spawn={x:hero.x,y:hero.y};
    s.step(1000);
    const chests=[...(s as unknown as {world:{pickups:Map<string,{kind:string;id:string;x:number;y:number}>}}).world.pickups.values()].filter(k=>k.kind==='chest');
    assert.equal(chests.length,18,`seed ${seed}: ${chests.length} crates`);
    const inStrip=chests.filter(k=>naBoca(asset,body(k)));
    const own=inStrip.filter(k=>Math.hypot(k.x-spawn.x,k.y-spawn.y)<=NEAR_START_REACH+1e-9);
    assert.ok(own.length<=1,`seed ${seed}: ${own.length} crates in a strip by the hero`);
    assert.deepEqual(inStrip.filter(k=>!own.includes(k)).map(k=>`${k.id} ${k.x.toFixed(1)},${k.y.toFixed(1)}`),[],`seed ${seed}`);
  }
});
