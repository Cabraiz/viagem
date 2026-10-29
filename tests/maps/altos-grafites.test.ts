/**
 * NEW-20261029-ORQ-cidade-decor-alto-e-grafite (colocação): on the committed Cidade Nevada (map v9) the scenery the
 * mouths lost comes back as tall pieces on the walls and boulders and graffiti on the wall faces (scripts/altos-grafites-
 * cidade.ts): all on solid cells, no tall piece on an entrance, never two alike graffiti side by side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {cityEntradas,estreitaBoca} from '../../src/maps/city/entradas.ts';
import {ALTO_ENTRADA_RAIO,ALTO_LIVRE,GAP,PAREDE,PAREDE_INTEIRA,isAlto,isGrafite} from '../../scripts/altos-grafites-cidade.ts';

const d=decodeCityAsset(readFileSync(fileURLToPath(new URL('../../public/maps/cidade-nevada.json',import.meta.url)),'utf8'));
if(!d.ok)throw new Error(d.error);
const a=d.asset,u=a.unitsPerCell,bocas=cityEntradas(a);
const altos=a.decor.filter(q=>isAlto(q.id)),grafites=a.decor.filter(q=>isGrafite(q.id));
const mid=(q:{c:number;r:number;w:number;h:number})=>({x:q.c+q.w/2,y:q.r+q.h/2});
const gap=(q:{c:number;r:number;w:number;h:number},e:{x:number;y:number})=>Math.hypot(Math.max(q.c*u-e.x,0,e.x-(q.c+q.w)*u),Math.max(q.r*u-e.y,0,e.y-(q.r+q.h)*u));

test('the map is v9 and brings back at least the 100 pieces the mouths lost',()=>{
  assert.ok(a.version>=9,`v${a.version}`);
  assert.ok(altos.length>=30,`${altos.length} tall pieces`);
  assert.ok(grafites.length>=60,`${grafites.length} graffiti`);
  assert.ok(altos.length+grafites.length>=100);
  assert.ok(new Set(grafites.map(q=>q.id)).size>=10,'10–16 graffiti designs');
});

test('nothing new on walkable ground; a tall piece keeps its wall cell covered',()=>{
  const bad=[...altos,...grafites].filter(q=>{const o=mid(q);return a.walkableAt(o.x*u,o.y*u);});
  assert.deepEqual(bad.map(q=>`${q.id} ${q.c},${q.r}`),[]);
  for(const q of altos)assert.ok(a.decor.some(p=>p.cover&&p.c===q.c&&p.r===q.r&&p.w===q.w&&p.h===q.h),`${q.id} ${q.c},${q.r} cover`);
});

test('no tall piece on an entrance',()=>{
  const bad=altos.filter(q=>bocas.some(e=>gap(q,e)<=ALTO_ENTRADA_RAIO||estreitaBoca(a,e,q)));
  assert.deepEqual(bad.map(q=>`${q.id} ${q.c},${q.r}`),[]);
});

test('never two alike side by side (graffiti and tall pieces)',()=>{
  const near=(xs:typeof altos,r:number)=>xs.flatMap((p,i)=>xs.slice(i+1).filter(q=>q.id===p.id&&Math.hypot(mid(p).x-mid(q).x,mid(p).y-mid(q).y)<r).map(q=>`${p.id} ${p.c},${p.r}~${q.c},${q.r}`));
  assert.deepEqual(near(grafites,GAP.mesmoGrafite),[]);
  assert.deepEqual(near(altos,GAP.mesmoAlto),[]);
});

test('no tall piece over a standing piece (a cart, a lamp)',()=>{
  const standing=a.decor.filter(q=>!q.cover&&!isAlto(q.id)&&!isGrafite(q.id)&&!PAREDE.test(q.id)&&!/^(pedregulho|penhasco)/.test(q.id)&&!/-(reto|quina|t|ponta)-/.test(q.id));
  const bad=altos.flatMap(p=>standing.filter(q=>Math.hypot(mid(p).x-mid(q).x,mid(p).y-mid(q).y)<ALTO_LIVRE).map(q=>`${p.id} ${p.c},${p.r} ~ ${q.id}`));
  assert.deepEqual(bad,[]);
});

test('a graffito is painted on a whole wall piece (a broken one has its hole in the middle)',()=>{
  const bad=grafites.filter(g=>!a.decor.some(p=>!p.cover&&PAREDE_INTEIRA.test(p.id)&&p.c===g.c&&p.r===g.r&&p.w===g.w&&p.h===g.h)).map(g=>`${g.id} ${g.c},${g.r}`);
  assert.deepEqual(bad,[]);
});
