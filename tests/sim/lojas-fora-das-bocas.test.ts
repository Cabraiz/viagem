/**
 * Shops off the street mouths (card NEW-20261030-ORQ-lojas-bico-fora-das-bocas): no bico shop's lot (a BICO.lote disc)
 * on an entrance's free strip (maps/city/entradas.ts bocaFaixa) in 200 seeds, with the same number of shops a run; not crowded (BANK_SPACING); the candidates moved off a mouth keep their order. E2 30/10, before
 * this: 594 of 600 shops had their lot on a strip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {bocaFaixa,cityEntradas} from '../../src/maps/index.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {cityLoot} from '../../src/sim/stonewards/loot.ts';
import {BANK_SPACING,RING_CLEAR,SHOP_MOUTH_REACH,lojasForaDasBocas,lotInMouth,planBanks,ringCandidates,shopCandidates} from '../../src/sim/bancos/system.ts';
import {BANCO} from '../../src/rules/bancos.ts';
import {BICO} from '../../src/rules/bicos.ts';

const root=(p:string)=>fileURLToPath(new URL(`../../${p}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(root('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(root('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,CAR=placeWall(city),PLAZA=city.asset.points.praca;
const LOOT=cityLoot(city)!.crates.map(c=>({id:c.node.id,x:c.node.x,y:c.node.y}));
const STRIPS=cityEntradas(city.asset).map(e=>bocaFaixa(city.asset,e));
/** Gap (u) from a point to a strip rect (0 inside). */
const gap=(x:number,y:number,f:{x:number;y:number;w:number;h:number})=>Math.hypot(x-Math.max(f.x,Math.min(x,f.x+f.w)),y-Math.max(f.y,Math.min(y,f.y+f.h)));
const inMouth=(x:number,y:number)=>STRIPS.some(f=>gap(x,y,f)<BICO.lote);

test('lotInMouth: the lookup grid answers like every strip checked by hand',()=>{
  for(let x=CAR.x-40;x<=CAR.x+40;x+=1.3)for(let y=CAR.y-40;y<=CAR.y+40;y+=1.3)
    assert.equal(lotInMouth(city,x,y),inMouth(x,y),`(${x.toFixed(1)}, ${y.toFixed(1)})`);
});

test('candidates: none in a mouth; the ones off it as they were, the moved ones near and in order',()=>{
  const raw=[...ringCandidates(CAR,(x,y,r)=>city.clearDisc(x,y,r)),...LOOT];
  assert.ok(raw.filter(p=>inMouth(p.x,p.y)).length>raw.length/2,'the case: most raw candidates sit in a mouth');
  const out=shopCandidates(city,CAR,LOOT);
  assert.equal(shopCandidates(city,CAR,LOOT),out,'memo: the same city, car and crates give the same list');
  assert.deepEqual(lojasForaDasBocas(city,raw),out);
  assert.ok(out.length>=raw.length/2,`most candidates survive: ${out.length} of ${raw.length}`);
  const key=(p:object)=>JSON.stringify(p),rawKeys=new Set(raw.map(key)),isRaw=(q:object)=>rawKeys.has(key(q));
  const off=raw.filter(p=>!inMouth(p.x,p.y)),kept=out.filter(isRaw);
  assert.deepEqual(kept,off,'every candidate off the mouths stays as it was, in its order');
  const mouths=raw.filter(p=>inMouth(p.x,p.y));
  for(const q of out.filter(q=>!isRaw(q))){
    assert.equal(q.id,undefined,'a moved loot point is no longer a crate place');
    assert.ok(mouths.some(p=>Math.hypot(q.x-p.x,q.y-p.y)<=SHOP_MOUTH_REACH+1e-6),`(${q.x}, ${q.y}) moved at most SHOP_MOUTH_REACH`);
    assert.ok(city.clearDisc(q.x,q.y,RING_CLEAR),`(${q.x}, ${q.y}) a hero fits where it moved`);
  }
  for(const p of out)assert.ok(!inMouth(p.x,p.y),`(${p.x}, ${p.y}) off every mouth`);
});

test('200 seeds: 0 shop lots on a strip, 3 shops a run, not crowded, near the car',()=>{
  const C=shopCandidates(city,CAR,LOOT);
  let lots=0,nearest=0,dist=0;
  for(let seed=1;seed<=200;seed++){
    const a=planBanks(seed,C,CAR,{plaza:PLAZA});
    assert.equal(a.length,BANCO.count,`seed ${seed}: ${BANCO.count} shops`);
    for(const p of a){lots++;assert.ok(!inMouth(p.x,p.y),`seed ${seed} ${p.id} (${p.x}, ${p.y}): the lot is off every strip`);}
    for(let i=0;i<a.length;i++)for(let k=i+1;k<a.length;k++)
      assert.ok(Math.hypot(a[i].x-a[k].x,a[i].y-a[k].y)>=BANK_SPACING,`seed ${seed}: ${a[i].id} and ${a[k].id} not crowded`);
    const d=a.map(p=>Math.hypot(p.x-CAR.x,p.y-CAR.y));
    nearest+=Math.min(...d);dist+=d.reduce((s,x)=>s+x,0);
  }
  assert.equal(lots,600);
  // The bench (card: within ±15 % of before). E2 30/10, 200 seeds: the nearest shop 18.62 u on average before, 18.58
  // after; the three shops' mean 20.97 → 21.01 u (a sector with no ring spot left takes another sector's, planBanks).
  const mean=dist/600;
  assert.ok(nearest/200>=18.62*.85&&nearest/200<=18.62*1.15,`the nearest shop stays near the car: ${(nearest/200).toFixed(2)} u on average`);
  assert.ok(mean>=20.97*.85&&mean<=20.97*1.15,`the shops stay near the car: ${mean.toFixed(2)} u on average`);
});
