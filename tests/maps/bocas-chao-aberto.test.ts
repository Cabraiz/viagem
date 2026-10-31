/**
 * NEW-20261030-ORQ-bocas-chao-aberto (the audit of the mouths: 181 of them with a wall, a rock or a building in the strip
 * right behind, the street narrower than its mouth; the worst #40, #298, #366). On the committed Cidade Nevada (map v10):
 *  1. the mouths stay many, wide ones too; the plaza is no street (ORQ 30/10: a mouth 3 u from its centre was a false
 *     positive): no strip reaches into its ring (PRACA_LIVRE), and a strip spans its whole mouth unless the ring clips it;
 *  2. the map's opening is done (scripts/becos-cidade.ts abrirChaoDasBocas cuts nothing more): what solid is left in a
 *     strip is a building, a protected cell (passageBan), a high cliff, the map's edge or the viaduct's pillars, or a
 *     wall or rock the opening may not take (a safe place would go, a bit would be left loose in a protected zone, a
 *     block of the base over BOCA_PEDACO cells would go whole); a wall the defence would keep goes (ORQ 30/10);
 *  3. behind the audit's worst mouths at most a few such cells are left;
 *  4. the Uno's body still gets near the hero's ground (unoArea).
 * The ground is the map's, the same in every seed (what a match lays: sim/entradas-livres.test.ts). D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityAssetToData,decodeCityAsset} from '../../src/maps/city-asset.ts';
import {PRACA_LIVRE,bocaFaixa,bocaSolido,cityEntradas,faixaCelulas} from '../../src/maps/city/entradas.ts';
import {BOCA_CLIFF_STEP,abrirChaoDasBocas,allowedIn,cityGraph,passageBan,unoArea} from '../../scripts/becos-cidade.ts';

const d=decodeCityAsset(readFileSync(fileURLToPath(new URL('../../public/maps/cidade-nevada.json',import.meta.url)),'utf8'));
if(!d.ok)throw new Error(d.error);
const a=d.asset,W=a.cells.w,C=a.unitsPerCell;
const walk=(t:number)=>a.walkableAt((t%W+.5)*C,(Math.floor(t/W)+.5)*C),P=a.points.praca;
const ring=(t:number)=>Math.hypot((t%W+.5)*C-P.x,(Math.floor(t/W)+.5)*C-P.y)<PRACA_LIVRE;

test('the mouths stay many; none in the plaza ring; each strip spans its mouth unless the ring clips it',()=>{
  const all=cityEntradas(a),strips=all.map(e=>faixaCelulas(a,e));
  assert.ok(all.length>=300,`${all.length} mouths`);
  assert.ok(all.filter(e=>e.largura>5).length>=60,'wide mouths too');
  assert.deepEqual(strips.flatMap((s,i)=>s.filter(ring).map(t=>`#${i} ${t%W},${Math.floor(t/W)}`)),[],'the plaza\'s ground is no strip');
  for(const [i,e] of all.entries())if(Math.hypot(e.x-P.x,e.y-P.y)>=PRACA_LIVRE+e.largura*C)assert.ok(strips[i].length>=e.largura,`#${i}: the strip covers the mouth`);
  let ground=0;for(let t=0;t<W*W;t++)if(ring(t)&&walk(t))ground++;
  assert.ok(ground>=400,`${ground} cells of plaza ground`);
});

test('the opening is done: the solid left in a strip is one the opening may not take',()=>{
  const data=cityAssetToData(a),r=abrirChaoDasBocas(data);
  assert.deepEqual(r.cells.map(t=>`${t%W},${Math.floor(t/W)}`),[],'abrirChaoDasBocas opens nothing more');
  const g=cityGraph(a),ban=passageBan(g),cut=allowedIn(a,g,BOCA_CLIFF_STEP),left=[...new Set([...bocaSolido(a).values()].flat())];
  const kinds=new Map<string,number>();
  for(const t of left){const k=g.kind[t]==='building'?'building':ban(t)?'ban':cut(t)?`${g.kind[t]}-refused`:g.kind[t]||'other';kinds.set(k,(kinds.get(k)??0)+1);}
  const all=JSON.stringify(Object.fromEntries(kinds));
  // v10 (30/10, on cercas-nordeste): 122 cells: 47 building, 54 protected, 11 high cliff; 10 refused (1 the wall of safe
  // places seguro-7/8, 9 a base block's whole: b-0058, b-0086); the audit's 431 (v9) and 232 before the defence's walls
  // went. The refused are a protected zone for now (ORQ 30/10), listed in the card's status.md.
  assert.ok(left.length<=130,`${left.length} solid cells in the strips: ${all}`);
  const refused=[...kinds].filter(([k])=>k.endsWith('-refused')).reduce((n,[,v])=>n+v,0);
  assert.ok(refused<=16,`${refused} cuttable cells refused: ${all}`);
  assert.ok(!kinds.has('other'),all);
});

test('the audit\'s worst mouths (#40, #298, #366: 12–16 wall cells behind) keep at most a few cells the opening may not take',()=>{
  const g=cityGraph(a),ban=passageBan(g),raw=cityEntradas(a,true),solid=bocaSolido(a,true);
  for(const [i,x,y,largura] of [[40,135.4,20.2,23],[298,143.6,89,18],[366,118.9,121.9,19]] as const){
    const k=raw.findIndex(q=>Math.hypot(q.x-x,q.y-y)<C&&q.largura>=largura-2);
    // Gone (#40 in v10: the place that closed its side, padaria-1, keeps off the strips now and the street opens onto
    // open ground): no mouth within its half width keeps more than a few cells the opening may take.
    if(k<0){
      const near=[...raw.entries()].filter(([,q])=>Math.hypot(q.x-x,q.y-y)<largura*C/2);
      assert.ok(i===40,`#${i}: the mouth at (${x},${y}) is still ≥ ${largura-2} cells`);
      for(const [j,q] of near){const walls=(solid.get(j)??[]).filter(t=>g.kind[t]!=='building'&&!ban(t));
        assert.ok(walls.length<=5,`#${i}: (${q.x.toFixed(1)},${q.y.toFixed(1)}) ${walls.map(t=>`${t%W},${Math.floor(t/W)}:${g.kind[t]}`).join(' ')}`);}
      continue;
    }
    const left=solid.get(k)??[],walls=left.filter(t=>g.kind[t]!=='building'&&!ban(t));
    assert.ok(left.length<=8&&walls.length<=5,`#${i}: ${left.map(t=>`${t%W},${Math.floor(t/W)}:${g.kind[t]}`).join(' ')}`);
    // Fully open: the mouth stays where it is, as wide as it is; else it is measured further in (BOCA_RECUO).
    if(!left.length){
      const e=cityEntradas(a).find(q=>Math.hypot(q.x-x,q.y-y)<C&&q.largura>=largura-2);
      assert.ok(e&&faixaCelulas(a,e).every(walk),`#${i}: all ground`);
      const f=bocaFaixa(a,e);
      assert.ok((e.ax?f.w:f.h)>=(largura-2)*C,`#${i}: its strip`);
    }
  }
});

test('the Uno\'s body still gets near the hero\'s ground',()=>{
  const {share}=unoArea(a);
  assert.ok(share>=.99,`${(100*share).toFixed(2)} %`);
});
