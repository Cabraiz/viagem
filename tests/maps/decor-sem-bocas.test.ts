/**
 * NEW-20261029-ORQ-sem-tralha-nas-entradas (the user, 29/10: the junk at the street mouths spoils them): on the committed
 * Cidade Nevada no sidewalk object (OBJETOS_1/OBJETOS_2) stands in the middle of an entrance (maps/city/entradas.ts
 * estreitaBoca), and the rest of the sidewalk scenery is still there (cenario-cidade.ts semDecorNasBocas, map v8; map v9
 * takes every piece off the ground of any entrance, maps/bocas-chao-livre.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {bocaPassagem,entradasEstreitas,estreitaBoca} from '../../src/maps/city/entradas.ts';
import {BOCA_DECOR_RAIO,isCalcada} from '../../scripts/cenario-cidade.ts';

const d=decodeCityAsset(readFileSync(fileURLToPath(new URL('../../public/maps/cidade-nevada.json',import.meta.url)),'utf8'));
if(!d.ok)throw new Error(d.error);
const a=d.asset,u=a.unitsPerCell,bocas=entradasEstreitas(a);
const gap=(q:{c:number;r:number;w:number;h:number},e:{x:number;y:number})=>Math.hypot(Math.max(q.c*u-e.x,0,e.x-(q.c+q.w)*u),Math.max(q.r*u-e.y,0,e.y-(q.r+q.h)*u));

test('estreitaBoca: a piece on the middle of a passage narrows it, one beside the passage does not',()=>{
  const e=bocas[0],rows=bocaPassagem(a,e);
  assert.ok(rows.length>0);
  const row=rows[0],mid=row[Math.floor(row.length/2)];
  assert.equal(estreitaBoca(a,e,{c:mid.c,r:mid.r,w:1,h:1}),true);
  const far=rows.flat().reduce((m,q)=>Math.max(m,q.c,q.r),0)+3;
  assert.equal(estreitaBoca(a,e,{c:far,r:far,w:1,h:1}),false);
});

test('no sidewalk object in the middle of an entrance; the other sidewalk scenery stays',()=>{
  const calcada=a.decor.filter(q=>isCalcada(q.id));
  const bad=calcada.filter(q=>bocas.some(e=>gap(q,e)<=BOCA_DECOR_RAIO&&estreitaBoca(a,e,q)));
  assert.deepEqual(bad.map(q=>`${q.id} ${q.c},${q.r}`),[]);
  // v7 → v8 took 100 pieces off the mouths (215 left), v8 → v9 the 129 on an entrance's ground; the sidewalks keep 86,
  // most of them near an entrance (76).
  assert.ok(calcada.length>=80,`${calcada.length} sidewalk objects`);
  assert.ok(calcada.filter(q=>bocas.some(e=>gap(q,e)<=BOCA_DECOR_RAIO)).length>=70,'the ones beside the mouths stay');
});
