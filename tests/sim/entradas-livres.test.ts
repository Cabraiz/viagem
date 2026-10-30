/**
 * NEW-20261030-ORQ-entradas-livres-de-tudo (the user, 30/10, 2nd time, print: a tralha row at the mouth of a wide street
 * by the north avenue: "obstáculos em entradas são horríveis"). An entrance is the mouth of any street, avenue, square
 * or gate, of any width; its whole width stays free a cell each way (maps/city/entradas.ts bocaFaixa):
 *  1. the mouths of every width are found (wide ones too, the print's included) and each strip spans the whole mouth;
 *  2. per match (seeds 1–8, the real Cidade Nevada): no square of the map's tralha nor of a feirinha's barracas in a
 *     strip, and no terreno nest of the drawn plan within NEST_ENTRADA_FOLGA of one (validateNestPlan agrees);
 *  3. the whole nest pool (every nest a seed may draw) and the map's solid props on the ground stay off the strips.
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {bocaFaixa,cityEntradas,naBoca,pertoDaBoca} from '../../src/maps/city/entradas.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {CITY_NEST_POOL,NEST_ENTRADA_FOLGA,cityNestPlan,validateNestPlan} from '../../src/maps/nests.ts';
import {pieceRectOf,type PieceState} from '../../src/sim/towers/free-build.ts';
import {TRALHA_OWNER} from '../../src/sim/towers/tralha.ts';
import {FEIRA_OWNER} from '../../src/sim/towers/barracas.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const json=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const loaded=await cityTerrainFrom(json,(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,a=city.asset,C=a.unitsPerCell;

test('entradas: mouths of every width, the print\'s wide one included; each strip spans the whole mouth',()=>{
  const all=cityEntradas(a);
  assert.ok(all.length>=300,`${all.length} mouths`);
  assert.ok(all.filter(e=>e.largura>5).length>=30,'wide mouths too');
  // The print (30/10): the street 8 cells wide that opens off the north avenue at ≈ (79.3, 30.7).
  assert.ok(all.some(e=>e.largura>=6&&Math.hypot(e.x-79.3,e.y-30.7)<2),'the print\'s mouth');
  for(const e of all){
    const z=bocaFaixa(a,e),across=e.ax?z.w:z.h;
    assert.ok(across>=e.largura*C-1e-6,`(${e.x.toFixed(1)},${e.y.toFixed(1)}) w${e.largura}: strip ${across.toFixed(2)} u`);
    assert.ok(z.x<=e.x&&e.x<=z.x+z.w&&z.y<=e.y&&e.y<=z.y+z.h,'the strip holds the mouth\'s middle');
  }
});

test('per match (seeds 1–8): no tralha, no barraca and no terreno nest in an entrance\'s free strip; some still laid',()=>{
  for(let seed=1;seed<=8;seed++){
    const s=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    s.add('p0','P0','cidadao-comum');s.resetRun();s.step();
    const pieces=(s.run.stonewards.state as unknown as {defenses?:{pieces?:PieceState[]}}).defenses?.pieces??[];
    const tralha=pieces.filter(p=>p.owner===TRALHA_OWNER),feira=pieces.filter(p=>p.owner===FEIRA_OWNER);
    assert.ok(tralha.length>=3,`seed ${seed}: ${tralha.length} squares of tralha`);
    assert.ok(feira.length>=3,`seed ${seed}: ${feira.length} barracas`);
    for(const p of [...tralha,...feira])assert.ok(!naBoca(a,pieceRectOf(p)),`seed ${seed}: ${p.owner} ${p.id} at (${p.x.toFixed(1)},${p.y.toFixed(1)}) in an entrance`);
    const plan=cityNestPlan(city,seed);
    for(const n of plan.nests)if(n.kind==='terreno')assert.ok(!pertoDaBoca(a,n,NEST_ENTRADA_FOLGA),`seed ${seed}: nest ${n.id} at (${n.x},${n.y}) in an entrance`);
    assert.deepEqual(validateNestPlan(plan,city).filter(p=>p.reason.includes('boca')),[],`seed ${seed}`);
  }
});

test('the whole nest pool and the map\'s solid props on the ground stay off the strips',()=>{
  for(const n of CITY_NEST_POOL)if(n.kind==='terreno')assert.ok(!pertoDaBoca(a,n,NEST_ENTRADA_FOLGA),`nest ${n.id} at (${n.x},${n.y})`);
  const props=(JSON.parse(json) as {props:{x:number;y:number;r:number;kind:string;solid?:boolean}[]}).props;
  const ground=props.filter(p=>p.solid&&a.walkableAt(p.x,p.y));
  for(const p of ground)assert.ok(!naBoca(a,{x:p.x-p.r,y:p.y-p.r,w:2*p.r,h:2*p.r}),`${p.kind} at (${p.x},${p.y})`);
});
