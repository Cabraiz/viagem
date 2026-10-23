/**
 * NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 4: the viaduct's art (render/city/viaduct.ts), pure part. The road tile
 * runs along the viaduct and spans its width (the double yellow line stays in the middle, the tiles meet cell to cell),
 * the concrete tile lines up with the cells and holds every side's height, and the pieces of art stand where the plan
 * says (on the deck, or on open street by the ramp's foot of the real map).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONCRETE_TILE_CELLS,FACES_CONCRETE,FACES_ROAD,FACES_SIZE,ROAD_TILE_CELLS,VIADUCT_PROP_IDS,concreteST,crosswalkTiles,
  regionUv,roadST,viaductPieces,viaductProps} from '../../src/client/render/city/viaduct.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {overDeck,onRamp,type CityViaduct} from '../../src/maps/index.ts';

const V:CityViaduct={id:'v',deck:[10,4,4,8],ramp:{rect:[10,12,4,6],up:'N'},pillars:[[10,6],[13,6]],height:3.5};
const U=1.5;

test('the road tile spans the viaduct across and repeats every ROAD_TILE_CELLS cells along it',()=>{
  const p=viaductPieces(V,U),cells=p.filter(q=>q.kind==='deck'||q.kind==='ramp');
  for(const q of cells){
    const st=roadST(q,V,U);
    // Across: the west column starts at 0, the east one ends at 1 (corners x0 → s, x1 → s + 1/4).
    const col=Math.round(q.x0/U)-V.deck[0];
    assert.ok(Math.abs(st[0][0]-col/4)<1e-9&&Math.abs(st[1][0]-(col+1)/4)<1e-9,`column ${col}`);
    // Along: a cell is 1/ROAD_TILE_CELLS of the tile, its row's place in the tile.
    const row=Math.round(q.y0/U)-V.deck[1],k=row%ROAD_TILE_CELLS;
    assert.ok(Math.abs(st[0][1]-k/ROAD_TILE_CELLS)<1e-9&&Math.abs(st[3][1]-(k+1)/ROAD_TILE_CELLS)<1e-9,`row ${row}`);
  }
  // The tile meets itself: the last row of a tile ends at t = 1, the next starts at 0.
  const last=cells.find(q=>Math.round(q.y0/U)-V.deck[1]===ROAD_TILE_CELLS-1)!;
  assert.ok(Math.abs(roadST(last,V,U)[3][1]-1)<1e-9);
});

test('the concrete tile lines up with the cells, keeps narrow pieces inside one tile and holds every height',()=>{
  const p=viaductPieces(V,U),T=CONCRETE_TILE_CELLS*U;
  for(const q of p.filter(r=>r.kind!=='shadow'))for(const side of ['n','e','s','w'] as const){
    const st=concreteST(q,side,U);
    for(const [s,t] of st){assert.ok(s>=-1e-9&&s<=1+1e-9,`${q.kind} ${side} s=${s}`);assert.ok(t>=0&&t<=1,`${q.kind} ${side} t=${t}`);}
    // The top edge is above the bottom one (t grows downward).
    assert.ok(st[0][1]<=st[3][1]+1e-9&&st[1][1]<=st[2][1]+1e-9);
  }
  assert.ok((V.height+.6)<T,'the tallest side (deck + parapet) fits one tile up');
  // A deck cell's south side: s on the cell's place in the tile.
  const cell=p.find(q=>q.kind==='deck'&&Math.round(q.x0/U)===11)!,st=concreteST(cell,'s',U);
  assert.ok(Math.abs(Math.min(st[0][0],st[1][0])-(11%CONCRETE_TILE_CELLS)/CONCRETE_TILE_CELLS)<1e-9);
});

test('atlas coordinates stay inside their region',()=>{
  for(const r of [FACES_ROAD,FACES_CONCRETE])for(const [s,t] of [[0,0],[1,1]]){
    const [u,v]=regionUv(r,s,t);
    assert.ok(u*FACES_SIZE[0]>r[0]&&u*FACES_SIZE[0]<r[0]+r[2]&&v*FACES_SIZE[1]>r[1]&&v*FACES_SIZE[1]<r[1]+r[3]);
  }
});

test('the pieces of art: pile-up and signs on the deck, toll plaza, bus stop and stop sign on open street by the ramp',()=>{
  const r=decodeCityAsset(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'));if(!r.ok)throw r.error;
  const a=r.asset,u=a.unitsPerCell,v=a.viaducts[0],props=viaductProps(v,u);
  assert.deepEqual([...new Set(props.map(p=>p.id))].sort(),[...VIADUCT_PROP_IDS].sort());
  for(const p of props){
    if(p.floor===1)assert.ok(overDeck(v,u,p.x,p.y),`${p.id} stands on the deck`);
    else{
      assert.ok(!overDeck(v,u,p.x,p.y)&&!onRamp(v,u,p.x,p.y),`${p.id} is off the viaduct`);
      assert.ok(a.walkableAt(p.x,p.y),`${p.id} stands on open street (${(p.x/u).toFixed(1)}, ${(p.y/u).toFixed(1)})`);
    }
  }
  // Three crashed cars at the closed end (north: the deck's first rows), across the deck.
  const pile=props.filter(p=>p.id.startsWith('carro-batido'));
  assert.equal(pile.length,3);for(const p of pile)assert.ok(p.y<(v.deck[1]+2)*u);
  // The crosswalk crosses the avenue past the ramp's foot, on open street.
  const cw=crosswalkTiles(v,u);assert.ok(cw.length>=3);
  for(const t of cw)assert.ok(a.walkableAt((t.x0+t.x1)/2,(t.y0+t.y1)/2)&&!onRamp(v,u,(t.x0+t.x1)/2,(t.y0+t.y1)/2));
});
