/**
 * The scenery on Cidade Nevada (NEW-20261016-ORQ-cenario-no-mapa, src/maps/city-decor.ts, scripts/cenario-cidade.ts),
 * checked on the committed asset (version 3):
 *  - the decor list decodes and round-trips; old readers ignore it (it is one extra top-level key);
 *  - every piece is a delivered id, inside the map, no two overlap;
 *  - lines (walls, fences, cliffs) sit on their own block cells with the links of their neighbours; lots on unwalkable
 *    cells; poles and objects on walkable sidewalk cells; nothing in a keep-out;
 *  - poles keep POLE_SPACING; places with life: every kind at least once, never closer than LUGAR_SPACING on open ground;
 *  - the open-ground places only took cells off the plaza's ground without cutting any of it off (undecorate restores
 *    the grid exactly).
 * Re-running the placement is slow (~1 min): `node --experimental-strip-types scripts/cenario-cidade.ts --check`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeCityAsset,encodeCityAsset,cityAssetToData,type CityAsset,type CityDecor} from '../../src/maps/city-asset.ts';
import {LINK,LUGARES,LUGAR_SPACING,MORADIAS,MOUNTAINS,OBJETOS_1,OBJETOS_2,POLE_SPACING,POSTES,WALL_FAMILIES,lineShape,turnLinks} from '../../src/maps/city-decor.ts';
import {KEEP,undecorate} from '../../scripts/cenario-cidade.ts';
import {CITY_SITE_CELL,buildPlanFor,footprint} from '../../src/maps/build-sites.ts';
import {CityTerrain} from '../../src/maps/city/terrain.ts';

const TEXT=readFileSync('public/maps/cidade-nevada.json','utf8');
const decoded=decodeCityAsset(TEXT);
if(!decoded.ok)throw new Error(decoded.error);
const asset:CityAsset=decoded.asset,W=asset.cells.w,u=asset.unitsPerCell,S=asset.samples.w/W;
const cellWalk=(c:number,r:number)=>{let n=0;for(let j=0;j<S;j++)for(let i=0;i<S;i++)if(asset.walkable(c*S+i,r*S+j))n++;return n;};
const kindAt=new Map<number,string>();
for(const b of asset.blocks)for(const [x,y,w,h] of b.rects)
  for(let r=Math.round(y/u);r<Math.round((y+h)/u);r++)for(let c=Math.round(x/u);c<Math.round((x+w)/u);c++)kindAt.set(r*W+c,b.kind);
const cells=(d:CityDecor)=>{const out:[number,number][]=[];for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)out.push([c,r]);return out;};
const isLugar=(id:string)=>LUGARES.some(([l])=>id.startsWith(`${l}-`));
const isLine=(id:string)=>WALL_FAMILIES.some(f=>id.startsWith(`${f}-`))||id.startsWith('penhasco');
const isPole=(id:string)=>POSTES.some(([p])=>p===id);
const isObject=(id:string)=>[...OBJETOS_1,...OBJETOS_2].some(o=>id===o||id.startsWith(`${o}-`));

test('the decor decodes, round-trips through the encoder, and is one extra top-level key',()=>{
  assert.equal(asset.version,3);
  assert.ok(asset.decor.length>5000,`${asset.decor.length} pieces`);
  assert.equal(encodeCityAsset(cityAssetToData(asset)),TEXT);
  const keys=Object.keys(JSON.parse(TEXT));
  assert.equal(keys.at(-2)==='decor'||keys.at(-1)==='decor',true);
  // An asset without the key decodes with an empty list (the reader stays compatible both ways).
  const without=JSON.parse(TEXT);delete without.decor;
  const old=decodeCityAsset(JSON.stringify(without));
  assert.ok(old.ok&&old.asset.decor.length===0);
});

test('every piece is a delivered id inside the map; no two pieces share a cell',()=>{
  const known=(id:string)=>isLugar(id)||isLine(id)||isPole(id)||isObject(id)||MORADIAS.some(([m])=>id.startsWith(`${m}-`))
    ||MOUNTAINS.some(([m])=>id===m||id.startsWith(`${m}-`))||/^pedregulho-[123]$/.test(id);
  const taken=new Set<number>();
  for(const d of asset.decor){
    assert.ok(known(d.id),d.id);
    assert.ok(/-(1|2|3|intacto|quebrado|reto|externa|ponta|3x3)$/.test(d.id),`variant in ${d.id}`);
    for(const [c,r] of cells(d)){assert.ok(!taken.has(r*W+c),`${d.id} overlaps at ${c},${r}`);taken.add(r*W+c);}
  }
});

test('lines on their block cells with the links of their neighbours; lots on unwalkable cells; sidewalk pieces on walkable cells',()=>{
  const lineKind=(id:string)=>id.startsWith('penhasco')?'cliff':'wall';
  for(const d of asset.decor){
    if(isLine(d.id)){
      const k=lineKind(d.id),same=(c:number,r:number)=>kindAt.get(r*W+c)===k;
      assert.equal(kindAt.get(d.r*W+d.c),k,`${d.id} at ${d.c},${d.r}`);
      const links=(same(d.c,d.r-1)?LINK.N:0)|(same(d.c+1,d.r)?LINK.E:0)|(same(d.c,d.r+1)?LINK.S:0)|(same(d.c-1,d.r)?LINK.W:0);
      assert.equal(d.links,links);assert.equal(d.rot,lineShape(links).rot);
    }else if(isPole(d.id)||isObject(d.id)){
      for(const [c,r] of cells(d))assert.equal(cellWalk(c,r),S*S,`${d.id} at ${c},${r} on a walkable cell`);
    }else for(const [c,r] of cells(d))assert.equal(cellWalk(c,r),0,`${d.id} at ${c},${r} on an unwalkable cell`);
  }
  // lineShape draws every mask with the base turned the way rot goes.
  for(let m=0;m<16;m++){const {rot}=lineShape(m);let b=m;for(let k=0;k<(4-rot/90)%4;k++)b=turnLinks(b);assert.ok([5,6,7,4,15].includes(b)||m===0||m===15,`mask ${m}`);}
});

test('nothing stands in a keep-out: the plaza, the start, spawns, mouths, build sites',()=>{
  const p=asset.points;
  const discs=[{...p.praca,r:KEEP.praca},{...p.inicio,r:KEEP.inicio},...[p.spawnN,p.spawnS,p.spawnL,p.spawnO].map(q=>({...q,r:KEEP.spawn})),
    ...Object.values(p.bocas).map(q=>({...q,r:KEEP.boca}))];
  const sites=buildPlanFor(new CityTerrain(asset,'decor-test')).sites.map(s=>footprint(s,s.maxSize,CITY_SITE_CELL));
  for(const d of asset.decor){
    const x0=d.c*u,y0=d.r*u,x1=(d.c+d.w)*u,y1=(d.r+d.h)*u;
    for(const k of discs){
      const nx=Math.max(x0,Math.min(k.x,x1)),ny=Math.max(y0,Math.min(k.y,y1));
      assert.ok(Math.hypot(nx-k.x,ny-k.y)>=k.r-1e-6,`${d.id} at ${d.c},${d.r} inside a keep-out disc`);
    }
    for(const s of sites)assert.ok(x1<=s.x+1e-6||x0>=s.x+s.w-1e-6||y1<=s.y+1e-6||y0>=s.y+s.h-1e-6,`${d.id} at ${d.c},${d.r} on a build site`);
  }
});

test('poles keep their spacing; every place with life at least once, apart on open ground',()=>{
  const poles=asset.decor.filter(d=>isPole(d.id));
  assert.ok(poles.length>500,`${poles.length} poles`);
  for(let i=0;i<poles.length;i++)for(let j=i+1;j<poles.length;j++)
    assert.ok(Math.max(Math.abs(poles[i].c-poles[j].c),Math.abs(poles[i].r-poles[j].r))>=POLE_SPACING);
  const lugares=asset.decor.filter(d=>isLugar(d.id));
  for(const [l] of LUGARES)assert.ok(lugares.some(d=>d.id.startsWith(`${l}-`)),`${l} placed`);
  const open=lugares.filter(d=>cells(d).some(([c,r])=>!kindAt.has(r*W+c)));
  assert.ok(open.length>=10,`${open.length} places on open ground`);
  for(let i=0;i<open.length;i++)for(let j=i+1;j<open.length;j++)
    assert.ok(Math.max(Math.abs(open[i].c-open[j].c),Math.abs(open[i].r-open[j].r))>=LUGAR_SPACING);
});

test('undecorate gives back the grid without the places: they only took cells, all on open ground',()=>{
  const before=decodeCityAsset(undecorate(TEXT));
  assert.ok(before.ok);
  const b=before.asset;
  assert.equal(b.decor.length,0);assert.equal(b.version,2);
  let changed=0;
  for(let s=0;s<b.samples.w*b.samples.h;s++){
    const x=s%b.samples.w,y=(s-x)/b.samples.w,was=b.walkable(x,y),now=asset.walkable(x,y);
    if(was!==now){changed++;assert.ok(was&&!now,`sample ${x},${y} only goes unwalkable`);}
  }
  const open=asset.decor.filter(d=>isLugar(d.id)).flatMap(cells).filter(([c,r])=>!kindAt.has(r*W+c)).length;
  assert.equal(changed,open*S*S);
});
