// NEW-20261031-ORQ-esconder-dejetos-sem-brilho: the junk picked on the prancha is out of the city's plan (no heap, decor or
// prop drawn) and out of the way (its ground walkable), and its art is still delivered (hidden, not deleted).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {decodeCityAsset} from '../../src/maps/index.ts';
import {parseArtIndex} from '../../src/client/art/manifest.ts';
import {blockArt,buildCityArtPlan,propSheet} from '../../src/client/render/city/art-plan.ts';
import {cityRenderAsset} from '../../src/client/render/city/from-maps.ts';
import {DECOR_OCULTO,PROPS_OCULTOS} from '../../scripts/dejetos/esconder.ts';
import {PROP_REMOVED} from '../../scripts/becos-cidade.ts';

const d=decodeCityAsset(readFileSync('public/maps/cidade-nevada.json','utf8'));
if(!d.ok)throw new Error(d.error);
const asset=d.asset,render=cityRenderAsset(asset);
const plan=buildCityArtPlan(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
const HIDDEN_PROPS=['carrinho-supermercado','isopor','placa-torta','tronco-caido'];

test('no rubble heap is left: no rubble block in the map, so no entulho lot or mound is drawn on its own',()=>{
  assert.deepEqual(asset.blocks.filter(b=>b.kind==='rubble').map(b=>b.id),[]);
  for(const b of render.blocks){
    assert.notEqual(b.kind,'rubble',b.id);
    if(b.kind!=='building')assert.ok(!blockArt(b,plan).lots.some(l=>l.sheet.key.includes('entulho')),`${b.id}: no entulho heap`);
  }
});

test('the hidden sidewalk junk is not in the decor plan; the rest of the junk stays',()=>{
  assert.deepEqual(asset.decor.filter(q=>DECOR_OCULTO.has(q.id)).map(q=>q.id),[]);
  assert.ok(asset.decor.some(q=>q.id.startsWith('cacamba-entulho')),'the cacamba stays (borderline, kept)');
});

test('the hidden debris props are PROP_REMOVED (indices kept) and no drawn prop picks a hidden piece',()=>{
  for(const [x,y] of PROPS_OCULTOS){
    const p=asset.props.find(q=>Math.abs(q.x-x)<.01&&Math.abs(q.y-y)<.01);
    assert.ok(p,`a prop at (${x}, ${y})`);
    assert.equal(p.kind,PROP_REMOVED);assert.equal(p.solid,false);
    assert.ok(asset.walkableAt(x,y),`its ground walkable (${x}, ${y})`);
  }
  for(const p of render.props){
    const s=propSheet(p,plan);
    assert.ok(!HIDDEN_PROPS.some(h=>s?.key.endsWith(`/${h}`)),`${p.id} draws ${s?.key}`);
  }
});

test('nothing hidden blocks walking: the cells of the old heaps and of the hidden junk are walkable ground, but a heap plugging a cliff gap is cliff',()=>{
  const old=JSON.parse(readFileSync('tests/fixtures/dejetos-ocultos.json','utf8')) as {rubbleCells:[number,number][];decorCells:[number,number][]};
  const u=asset.unitsPerCell,per=asset.samples.w/asset.cells.w;
  const allWalk=(c:number,r:number)=>{for(let j=0;j<per;j++)for(let i=0;i<per;i++)if(!asset.walkable(c*per+i,r*per+j))return false;return true;};
  assert.ok(old.rubbleCells.length>=35&&old.decorCells.length>=13);
  const blockAt=(c:number,r:number)=>asset.blocks.find(b=>b.rects.some(([x,y,w,h])=>(c+.5)*u>x&&(c+.5)*u<x+w&&(r+.5)*u>y&&(r+.5)*u<y+h));
  // Opened, b-0143 (74.8, 118.2) would cut a passage through cliff b-0127: a new street mouth that took the shops' ring
  // spots (esconder.ts). The few heaps plugging a cliff gap stand as cliff, nothing new walkable through the wall.
  const plug=old.rubbleCells.filter(([c,r])=>blockAt(c,r)?.kind==='cliff');
  assert.ok(plug.some(([c,r])=>c===50&&r===79)&&plug.length<=6,`the cliff plugs: ${plug.join(' ')}`);
  for(const [c,r] of plug)assert.ok(blockAt(c-1,r)?.kind==='cliff'&&blockAt(c+1,r)?.kind==='cliff'||blockAt(c,r-1)?.kind==='cliff'&&blockAt(c,r+1)?.kind==='cliff',`${c},${r} sits between cliff`);
  for(const [c,r] of [...old.rubbleCells.filter(q=>!plug.includes(q)),...old.decorCells]){
    assert.ok(allWalk(c,r),`cell ${c},${r} walkable`);
    assert.ok(!asset.blocks.some(b=>b.rects.some(([x,y,w,h])=>(c+.5)*u>x&&(c+.5)*u<x+w&&(r+.5)*u>y&&(r+.5)*u<y+h)),`no block on ${c},${r}`);
  }
});

test('hidden, not deleted: the art of every hidden piece is still delivered',()=>{
  const files=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  const text=JSON.stringify(files);
  for(const id of [...DECOR_OCULTO,...HIDDEN_PROPS,'entulho-1x1'])assert.ok(text.includes(id),`${id} still in the art manifest`);
  assert.ok(existsSync('public/art'));
});
