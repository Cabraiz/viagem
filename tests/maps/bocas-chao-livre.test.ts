/**
 * NEW-20261030-ORQ-bocas-sem-muro-pedra-decor (the user, 30/10: "obstáculos em entradas são horríveis"; the audit of the
 * mouths found postes, sidewalk objects and ruins standing in them). On the committed Cidade Nevada (map v9), the ground
 * of every entrance's free strip, of any width (maps/city/entradas.ts bocaChao), holds no scenery:
 *  1. no drawn piece of the map's decor nor of the wall lines the client adds (render/city/from-maps.ts
 *     leftoverWallLines) has a cell there: no wall, fence or cliff (they stand on solid cells), no sidewalk object, no
 *     poste;
 *  2. no prop (junk, ruin, rock) on the ground overlaps a strip (the ones taken keep their index as PROP_REMOVED);
 *  3. the asset is what the step writes (chaoLivreNasBocas takes nothing more), and the city keeps its postes and
 *     sidewalk objects elsewhere.
 * The scenery is the map's, the same in every seed; what a match lays (tralha, barracas, nests) is
 * sim/entradas-livres.test.ts. D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityAssetToData,decodeCityAsset} from '../../src/maps/city-asset.ts';
import {bocaChao,cityEntradas,naBoca} from '../../src/maps/city/entradas.ts';
import {POSTES} from '../../src/maps/city-decor.ts';
import {leftoverWallLines} from '../../src/client/render/city/from-maps.ts';
import {chaoLivreNasBocas,isCalcada} from '../../scripts/cenario-cidade.ts';
import {PROP_REMOVED} from '../../scripts/becos-cidade.ts';

const d=decodeCityAsset(readFileSync(fileURLToPath(new URL('../../public/maps/cidade-nevada.json',import.meta.url)),'utf8'));
if(!d.ok)throw new Error(d.error);
const a=d.asset,W=a.cells.w,chao=bocaChao(a);
const onGround=(q:{c:number;r:number;w:number;h:number})=>{
  for(let r=q.r;r<q.r+q.h;r++)for(let c=q.c;c<q.c+q.w;c++)if(chao.has(r*W+c))return true;
  return false;
};

test('the ground of the entrances: every mouth\'s strip, wide ones too, on walkable cells only',()=>{
  assert.ok(cityEntradas(a).length>=300);
  assert.ok(chao.size>=2000,`${chao.size} cells`);
  for(const i of chao)assert.ok(a.walkableAt((i%W+.5)*a.unitsPerCell,(Math.floor(i/W)+.5)*a.unitsPerCell),`cell ${i}`);
});

test('no drawn piece on an entrance\'s ground: walls, cliffs, sidewalk objects, postes',()=>{
  const drawn=[...a.decor,...leftoverWallLines(a)].filter(q=>!q.cover);
  assert.deepEqual(drawn.filter(onGround).map(q=>`${q.id} ${q.c},${q.r} ${q.w}x${q.h}`),[]);
});

test('no prop on an entrance\'s ground; the ones taken keep their index',()=>{
  const bad=a.props.map((p,i)=>({...p,i})).filter(p=>p.kind!==PROP_REMOVED&&a.walkableAt(p.x,p.y)&&naBoca(a,{x:p.x-p.r,y:p.y-p.r,w:2*p.r,h:2*p.r}));
  assert.deepEqual(bad.map(p=>`${p.i} ${p.kind} (${p.x},${p.y})`),[]);
  assert.ok(a.props.filter(p=>p.kind===PROP_REMOVED).length>=20,'v9 took the props of the mouths (#94, #283, #469…)');
});

test('the asset is what chaoLivreNasBocas writes; postes and sidewalk objects stay off the mouths',()=>{
  const data=cityAssetToData(a),taken=chaoLivreNasBocas(data);
  assert.deepEqual({decor:taken.decor.length,props:taken.props.length},{decor:0,props:0});
  // v8 → v9 took 218 postes and 129 sidewalk objects off the mouths' ground; the streets keep the rest.
  assert.ok(a.decor.filter(q=>POSTES.some(([p])=>p===q.id)).length>=120,'postes');
  assert.ok(a.decor.filter(q=>isCalcada(q.id)).length>=80,'sidewalk objects');
});
