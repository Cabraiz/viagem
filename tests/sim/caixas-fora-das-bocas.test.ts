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
import {RADIUS,cityAsField} from '../../src/maps/index.ts';
import {bocaFaixa,cityEntradas,naFaixa} from '../../src/maps/city/entradas.ts';
import {CRATE_BODY_RADIUS} from '../../src/rules/index.ts';
import {CAR_HALF_LENGTH,CAR_HALF_WIDTH} from '../../src/contract/objective.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {MOUTH_REACH,NEAR_START_FAR,foraDasBocas} from '../../src/sim/crates.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,asset=city.asset,field=cityAsField(city);
const R=CRATE_BODY_RADIUS,strips=cityEntradas(asset).map(e=>bocaFaixa(asset,e));
// A crate body overlapping a street mouth's free strip. Not naBoca: its plaza ring (PRACA_LIVRE, bocas-chao-aberto) keeps
// structures out, but the heroes spawn there by the Uno and their start crates stand by them (crateInMouth: strips only).
const inStrip=(p:{x:number;y:number})=>strips.some(f=>p.x-R<f.x+f.w&&f.x<p.x+R&&p.y-R<f.y+f.h&&f.y<p.y+R);

test('foraDasBocas: a loot point in a mouth\'s strip moves to clear ground beside it; one outside stays put',()=>{
  const inside=asset.loot.filter(p=>inStrip(p));
  assert.ok(inside.length>=50,`${inside.length} loot points in a strip (the audit: 75)`);
  const moved=foraDasBocas(city,asset.loot);
  assert.equal(moved.length,asset.loot.length);
  moved.forEach((p,i)=>{
    const was=asset.loot[i];
    if(!inStrip(was)){assert.deepEqual([p.x,p.y],[was.x,was.y]);return;}
    assert.equal(inStrip(p),false,`loot#${i} still in a strip`);
    assert.ok(city.clearDisc(p.x,p.y,R),`loot#${i} on blocked ground`);
    assert.ok(Math.hypot(p.x-was.x,p.y-was.y)<=MOUTH_REACH,`loot#${i} moved ${Math.hypot(p.x-was.x,p.y-was.y).toFixed(1)} u`);
  });
});

// NEW-20261030-ORQ-uno-estaciona-fora-da-boca: the Uno parks off every strip, the team spawns beside it off them too,
// and so does every crate, the heroes' own start crates included (item 2: out to NEAR_START_FAR u when nothing nearer fits).
const CAR=(c:{x:number;y:number})=>({x:c.x-CAR_HALF_LENGTH,y:c.y-CAR_HALF_WIDTH,w:2*CAR_HALF_LENGTH,h:2*CAR_HALF_WIDTH});
test('a run\'s first step: the Uno and every hero off every entrance\'s strip, 18 crates a solo, none in one, seeds 1 to 8',()=>{
  for(let seed=1;seed<=8;seed++){
    for(const players of [1,6]){
      const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
      for(let i=0;i<players;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
      s.resetRun();
      const heroes=[...s.players.values()].map(p=>({id:p.id,x:p.x,y:p.y}));
      const car=s.run.chaveiro!.state.car;
      assert.equal(naFaixa(asset,CAR(car)),false,`seed ${seed}: the Uno at ${car.x},${car.y} in a strip`);
      assert.deepEqual(heroes.filter(h=>naFaixa(asset,{x:h.x-RADIUS,y:h.y-RADIUS,w:2*RADIUS,h:2*RADIUS})).map(h=>h.id),[],`seed ${seed}: heroes in a strip`);
      s.step(1000);
      const chests=[...(s as unknown as {world:{pickups:Map<string,{kind:string;id:string;x:number;y:number}>}}).world.pickups.values()].filter(k=>k.kind==='chest');
      if(players===1)assert.equal(chests.length,18,`seed ${seed}: ${chests.length} crates`);
      assert.deepEqual(chests.filter(k=>inStrip(k)).map(k=>`${k.id} ${k.x.toFixed(1)},${k.y.toFixed(1)}`),[],`seed ${seed}, ${players} players: crates in a strip`);
      // Each hero still gets his verde start crate.
      const own=heroes.map(h=>chests.filter(k=>Math.hypot(k.x-h.x,k.y-h.y)<=NEAR_START_FAR+1e-9).length);
      assert.ok(own.every(n=>n>=1),`seed ${seed}: a hero without a start crate (${own})`);
    }
  }
});
