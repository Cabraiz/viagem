/**
 * NEW-20261025-ORQ-mapa-conexoes-sem-beco (o usuário 25/10: "faltou conexões entre os lugares, vi muito beco sem
 * saída"): the Cidade Nevada v5 (scripts/becos-cidade.ts, run by scripts/compactar-cidade.ts). Checked on the committed
 * asset. v4 had 54 dead ends (32 without loot or shelter at the end), the walk between crates was > 1.4× the straight
 * line for 59 % of the pairs (median 1.55×, p90 3.10×), and the Uno reached 48 % of the hero's ground, not spawn S.
 * Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,citySafePlaces,decodeCityAsset,cityAssetToData} from '../../src/maps/index.ts';
import {PLAZA_RUIN,cityGraph,resumo,rubbleForUno,unoAlcance,walk} from '../../scripts/becos-cidade.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const asset=decoded.asset;

test('becos: almost every dead end left has a reason (a crate at its end, or it is a safe place)',()=>{
  const r=resumo(asset);
  assert.ok(r.becosSemMotivo<=10,`${r.becosSemMotivo} dead ends with no crate and no shelter (v4: 32; a crate moves in only when it keeps 11 u from the others)`);
  assert.ok(r.becos<=40,`${r.becos} dead ends (v4: 54)`);
});

test('conexões: the walk between crates and between places is near the straight line',()=>{
  const r=resumo(asset);
  assert.ok(r.caixas.mediana<=1.4,`crates: median ${r.caixas.mediana.toFixed(2)}× (v4 1.55×)`);
  assert.ok(r.caixas.acima/r.caixas.pares<=.5,`crates: ${r.caixas.acima}/${r.caixas.pares} pairs above 1.4× (v4 59 %)`);
  assert.ok(r.caixas.p90<=2.4,`crates: p90 ${r.caixas.p90.toFixed(2)}× (v4 3.10×)`);
  assert.ok(r.lugares.mediana<=1.35,`places: median ${r.lugares.mediana.toFixed(2)}× (v4 1.43×)`);
});

test('the defence holds: the plaza is still entered by its 4 mouths only, the enemies walk as far, the safe places stay',()=>{
  const g=cityGraph(asset),P=asset.points,cell=(p:{x:number;y:number})=>Math.floor(p.x/g.u)+Math.floor(p.y/g.u)*g.m;
  const d=walk(g.city,g.m,cell(P.praca));
  // v4: 77, 85, 75, 72 u on foot from each spawn to the plaza: no passage is a shortcut for the hordes.
  for(const [k,v4] of [['spawnN',77],['spawnS',85],['spawnL',75],['spawnO',72]] as const){
    const now=d[cell(P[k])]*g.u;assert.ok(now>=v4-1,`${k}: ${now.toFixed(0)} u to the plaza (v4 ${v4})`);
  }
  assert.ok(citySafePlaces(new CityTerrain(asset,'test')).length>=23,'safe places (v4: 23)');
});

test('o Uno: no heap of rubble left in its way, none at the plaza mouths, it reaches every spawn',()=>{
  const P=asset.points.praca;
  assert.deepEqual(asset.props.filter(p=>p.kind==='ruin'&&Math.hypot(p.x-P.x,p.y-P.y)<PLAZA_RUIN),[]);
  const u=unoAlcance(asset);
  assert.ok(u.share>=.5,`the Uno reaches ${(100*u.share).toFixed(0)} % of the hero's ground (v4 48 %)`);
  assert.deepEqual(u.spawns,{spawnN:true,spawnS:true,spawnL:true,spawnO:true},'the Uno near every spawn (v4: not S)');
  assert.deepEqual(rubbleForUno(cityAssetToData(asset)),[],'a heap that, taken off, opens ≥ 4 u² to the Uno');
});
