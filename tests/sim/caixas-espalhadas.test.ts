/**
 * Caixas espalhadas (the user, 23/10: "adicione bem mais caixas pelo mapa e mais espalhadas, porque estão muito
 * aglomeradas"; card NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 2), on the real asset v4:
 *  - the loot points (scripts/compactar-cidade.ts spreadLoot): about twice today's 48, no two closer than the spacing,
 *    and no district of the city without one (every LOOT_DISTRICT square with room for a crate has some);
 *  - the live crates of a run (sim/crates.ts spreadPick, crateCap): many more, and spread: far apart from each other,
 *    over every quadrant around the plaza, the same after crates are opened and come back.
 * Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,decodeCityAsset,type Point} from '../../src/maps/index.ts';
import {cityLoot} from '../../src/sim/stonewards/loot.ts';
import {Rng} from '../../src/contract/rng.ts';
import {LOOT_DISTRICT,LOOT_SPACING} from '../../scripts/compactar-cidade.ts';
import {crateCap,spreadPick} from '../../src/sim/crates.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const asset=decoded.asset,city=new CityTerrain(asset,'test'),u=asset.unitsPerCell,P=asset.points.praca;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const quadrant=(p:Point)=>`${p.y<P.y?'N':'S'}${p.x<P.x?'O':'L'}`;
/** Smallest distance between two of the points. */
const closest=(ps:readonly Point[])=>{let d=Infinity;for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)d=Math.min(d,dist(ps[i],ps[j]));return d;};

test('loot points: about twice the 48 of the 1.7× city, never crowded', t => {
  const loot=asset.loot;
  t.diagnostic(`${loot.length} points, closest pair ${closest(loot).toFixed(1)} u`);
  assert.ok(loot.length>=90,`${loot.length} pontos de caixa`);
  // The Poisson draw keeps LOOT_SPACING; a district filled afterwards keeps half of it.
  assert.ok(closest(loot)>=LOOT_SPACING/2-1e-9,`par a ${closest(loot).toFixed(1)} u`);
  let wide=0;for(const p of loot)if(loot.every(q=>q===p||dist(p,q)>=LOOT_SPACING-1e-9))wide++;
  assert.ok(wide>=loot.length*.9,`${wide} de ${loot.length} a ≥ ${LOOT_SPACING} u de todos`);
});

test('loot points: no district without one (every LOOT_DISTRICT square with room for a crate), every quadrant a fair share', t => {
  const pl=asset.playable,open=(cx:number,cy:number)=>asset.walkableAt((cx+.5)*u,(cy+.5)*u);
  let districts=0,empty:string[]=[];
  for(let gy=pl.y;gy<pl.y+pl.h;gy+=LOOT_DISTRICT)for(let gx=pl.x;gx<pl.x+pl.w;gx+=LOOT_DISTRICT){
    // Room for a crate: an open cell with open ground on its 4 sides, beyond the plaza's own ring.
    let room=0;
    for(let cy=Math.floor(gy/u);cy<Math.floor((gy+LOOT_DISTRICT)/u);cy++)for(let cx=Math.floor(gx/u);cx<Math.floor((gx+LOOT_DISTRICT)/u);cx++)
      if(open(cx,cy)&&open(cx+1,cy)&&open(cx-1,cy)&&open(cx,cy+1)&&open(cx,cy-1)&&dist({x:(cx+.5)*u,y:(cy+.5)*u},P)>=14)room++;
    if(room<20)continue;
    districts++;
    if(!asset.loot.some(p=>p.x>=gx&&p.x<gx+LOOT_DISTRICT&&p.y>=gy&&p.y<gy+LOOT_DISTRICT))empty.push(`${gx.toFixed(0)},${gy.toFixed(0)}`);
  }
  t.diagnostic(`${districts} districts with room, empty: ${empty.join(' ')||'none'}`);
  assert.ok(districts>=20,`${districts} bairros`);
  assert.deepEqual(empty,[],'nenhum bairro vazio');
  for(const q of ['NO','NL','SO','SL']){
    const n=asset.loot.filter(p=>quadrant(p)===q).length;
    assert.ok(n>=asset.loot.length*.15,`${q}: ${n} de ${asset.loot.length}`);
  }
});

test('live crates of a run: crateCap of them, spread far apart over every quadrant, for 1 to 6 players and after respawns', t => {
  const points=cityLoot(city)!.crates.map(c=>({x:c.node.x,y:c.node.y}));
  assert.ok(points.length>=90,`${points.length} caixas alcançáveis`);
  for(const players of [1,3,6])for(let seed=1;seed<=12;seed++){
    const rng=new Rng(seed),free=points.map((_,i)=>i),live:Point[]=[];
    for(let n=0;n<crateCap(players);n++){const i=spreadPick(rng,points,free,live);free.splice(free.indexOf(i),1);live.push(points[i]);}
    // Open the 4 nearest the plaza and let them come back (the respawn picks the same way).
    for(let k=0;k<4;k++){
      live.sort((a,b)=>dist(a,P)-dist(b,P));const gone=live.shift()!;
      const i=spreadPick(rng,points,free,live);free.splice(free.indexOf(i),1);live.push(points[i]);
      free.push(points.findIndex(p=>p===gone));
    }
    const d=closest(live),quads=new Set(live.map(quadrant));
    if(seed===1)t.diagnostic(`${players} jogador(es): ${live.length} caixas, par mais perto ${d.toFixed(1)} u`);
    // A solo's 16 over ~120 × 120 u of open city: ~25 u apart; six players' 36 still ≥ 11 u (the loot spacing).
    const want=players===1?18:players===3?14:LOOT_SPACING-1e-9;
    assert.ok(d>=want,`seed ${seed}, ${players}: par a ${d.toFixed(1)} u`);
    assert.equal(quads.size,4,`seed ${seed}, ${players}: quadrantes ${[...quads]}`);
    for(const q of quads)assert.ok(live.filter(p=>quadrant(p)===q).length>=live.length*.12,`seed ${seed}, ${players}: ${q}`);
  }
});
