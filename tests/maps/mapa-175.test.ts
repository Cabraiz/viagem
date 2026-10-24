/**
 * NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 2 (O2, the user 23/10): the Cidade Nevada with its distances 1.75×
 * shorter and its walls as thick as before (asset v4, scripts/compactar-cidade.ts). Checked on the committed asset:
 * every base is still there, the city's ground stays one piece, and everything the run uses is on it.
 * Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,CITY_NEST_POOL,citySafePlaces,decodeCityAsset,type Point} from '../../src/maps/index.ts';
import {PLAZA_DROP,SOURCE_COMMIT,compactedAsset,sourceAsset,sourceAvailable} from '../../scripts/compactar-cidade.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const decoded=decodeCityAsset(TEXT);
if(!decoded.ok)throw new Error(decoded.error);
const asset=decoded.asset,city=new CityTerrain(asset,'test'),u=asset.unitsPerCell,m=asset.cells.w;
/** Open cells (a cell centre the hero may stand on) reached from the plaza, 4-neighbour. */
const reached=(()=>{
  const open=(t:number)=>asset.walkableAt((t%m+.5)*u,(Math.floor(t/m)+.5)*u),seen=new Uint8Array(m*m),P=asset.points.praca;
  const s=Math.floor(P.x/u)+Math.floor(P.y/u)*m,queue=[s];seen[s]=1;
  for(let h=0;h<queue.length;h++){const t=queue[h],x=t%m,y=(t-x)/m;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy,q=X+Y*m;if(X>=0&&Y>=0&&X<m&&Y<m&&!seen[q]&&open(q)){seen[q]=1;queue.push(q);}}}
  let all=0;for(let t=0;t<m*m;t++)if(open(t))all++;
  return {seen,count:queue.length,all};
})();
const onCity=(p:Point)=>reached.seen[Math.floor(p.x/u)+Math.floor(p.y/u)*m]===1;
/** The two tests that read the source city need SOURCE_COMMIT, which the shallow CI checkout lacks: they skip there. */
const NO_SOURCE=sourceAvailable()?false:`SOURCE_COMMIT ${SOURCE_COMMIT} not in this checkout (shallow clone)`;

test('scripts/compactar-cidade.ts writes exactly the committed asset (from the 1.7× city of SOURCE_COMMIT)',{skip:NO_SOURCE},async()=>{
  const {text}=await compactedAsset();
  assert.equal(text,TEXT,`run: node --experimental-strip-types scripts/compactar-cidade.ts (source ${SOURCE_COMMIT})`);
});

test('every base is still there: every block of the 1.7× city (but the plaza fountains and a few slivers), on the same cell',{skip:NO_SOURCE},async()=>{
  const src=await sourceAsset(),U=src.unitsPerCell;
  assert.equal(asset.unitsPerCell,U,'the cell keeps its size');
  assert.equal(m,Math.round(src.cells.w/1.75));
  const ids=new Set(asset.blocks.map(b=>b.id));
  let lost=0;
  for(const b of src.blocks){
    if(PLAZA_DROP.includes(b.id)||ids.has(b.id))continue;
    // Only slivers may go: a block of a few cells whose ground a door needed.
    const area=b.rects.reduce((sum,r)=>sum+r[2]*r[3],0)/U/U;
    assert.ok(area<=6,`${b.kind} ${b.id} (${area.toFixed(1)} cells) kept`);lost++;
  }
  assert.ok(lost<=6,`${lost} slivers lost`);
  // A wall keeps its thickness: every wall/cliff block has a cell with open ground on both sides of one axis (a line
  // one cell thick somewhere), as on the source.
  const solid=new Set<number>();for(const b of asset.blocks)for(const [x,y,w,h] of b.rects)for(let cy=Math.round(y/u);cy<Math.round((y+h)/u);cy++)for(let cx=Math.round(x/u);cx<Math.round((x+w)/u);cx++)solid.add(cx+cy*m);
  let thin=0;for(const t of solid){const x=t%m,y=(t-x)/m;if((!solid.has(t-1)&&!solid.has(t+1)&&x>0&&x<m-1)||(!solid.has(t-m)&&!solid.has(t+m)&&y>0&&y<m-1))thin++;}
  assert.ok(thin>300,`${thin} cells of 1-cell-thick wall`);
});

test('the city is one piece of ground: the plaza reaches almost all of it, and every point the run uses',()=>{
  assert.ok(reached.count>=reached.all*.97,`${reached.count} of ${reached.all} open cells reached from the plaza`);
  const P=asset.points;
  for(const [k,p] of Object.entries({inicio:P.inicio,spawnN:P.spawnN,spawnS:P.spawnS,spawnL:P.spawnL,spawnO:P.spawnO,...P.bocas}))assert.ok(onCity(p),`${k} reached`);
  for(const [i,p] of asset.loot.entries())assert.ok(onCity(p),`loot ${i} reached`);
  for(const s of CITY_NEST_POOL)if(s.kind==='terreno')assert.ok(onCity(s),`${s.id} reached`);
  const safe=citySafePlaces(city);
  assert.ok(safe.length>=15,`${safe.length} safe places`);
  for(const s of safe)assert.ok(onCity(s.opening),`${s.id}: its opening is on the city`);
});
