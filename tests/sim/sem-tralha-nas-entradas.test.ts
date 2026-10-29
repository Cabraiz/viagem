/**
 * NEW-20261029-ORQ-sem-tralha-nas-entradas (the user, 29/10, print: a junk pile, an open blue car and a shopping cart at
 * the mouth of a street by a zinc fence: "eu falei para remover essas tralhas da entradas, elas perdem a graça"). The
 * map's tralha is laid off the entrances, not only run over by the Uno:
 *  1. entradas finds the mouths of the streets into the avenues (the one at the north avenue's bend, where seed 1 laid a
 *     row before) and no notch in a wall;
 *  2. per match (seeds 1–8, the real Cidade Nevada), no square of tralha within TRALHA_ENTRADA_RAIO of an entrance nor
 *     within TRALHA_POINT_KEEP of the plaza, its mouths or a spawn, and some tralha is still laid (run over in the middle).
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField,type Point} from '../../src/maps/index.ts';
import {pieceRectOf,type PieceState} from '../../src/sim/towers/free-build.ts';
import {TRALHA_ENTRADA_RAIO,TRALHA_OWNER,TRALHA_POINT_KEEP,entradas} from '../../src/sim/towers/tralha.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,P=city.asset.points;
const gap=(r:{x:number;y:number;w:number;h:number},p:Point)=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));

test('entradas: the street mouths on the avenues, every one on walkable ground',()=>{
  const all=entradas(city);
  assert.ok(all.length>=100,`${all.length} entrances`);
  assert.ok(all.every(e=>city.asset.walkableAt(e.x,e.y)),'every mouth on the ground');
  // The street that opens east off the north avenue at y ≈ 38 (seed 1 laid a row across it before this card).
  assert.ok(all.some(e=>Math.hypot(e.x-83.7,e.y-37.8)<2),'the mouth at the north avenue\'s bend');
  assert.equal(entradas(city),all,'memoised per asset');
});

test('per match (seeds 1–8): no tralha at an entrance, the plaza, its mouths or a spawn; some still laid',()=>{
  const mouths=entradas(city),B=P.bocas,points=[P.praca,B.N,B.S,B.L,B.O,P.spawnN,P.spawnS,P.spawnL,P.spawnO];
  for(let seed=1;seed<=8;seed++){
    const s=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    s.add('p0','P0','cidadao-comum');s.resetRun();s.step();
    const pieces=((s.run.stonewards.state as unknown as {defenses?:{pieces?:PieceState[]}}).defenses?.pieces??[]).filter(p=>p.owner===TRALHA_OWNER);
    assert.ok(pieces.length>=3,`seed ${seed}: ${pieces.length} squares`);
    for(const p of pieces){
      const r=pieceRectOf(p),near=mouths.find(e=>gap(r,e)<=TRALHA_ENTRADA_RAIO);
      assert.equal(near,undefined,`seed ${seed}: ${p.id} at (${p.x.toFixed(1)},${p.y.toFixed(1)}) by the entrance (${near?.x.toFixed(1)},${near?.y.toFixed(1)})`);
      assert.ok(points.every(q=>gap(r,q)>=TRALHA_POINT_KEEP),`seed ${seed}: ${p.id} by the plaza, a mouth of it or a spawn`);
    }
  }
});
