// BUG-20261029-ORQ-fotos-fora-do-mapa: every modo-foto spot on the city map (hero=cx,cy, in cells) stands on open
// walkable ground of the current map, so a print shows the hero where the scene says and not inside a cliff or off the map.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {FOTO_CENAS} from '../../src/client/dev/foto.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';

const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
const decoded=decodeCityAsset(read('../../public/maps/cidade-nevada.json'));
if(!decoded.ok)throw new Error('cidade-nevada.json does not decode');
const city=decoded.asset;
/** Open ground the spot needs around it (u): the hero's body and a step in any direction, not a crack between rocks. */
const CLEAR=1;

const heroCells=(query:string)=>{
  const m=/(?:^|&)hero=(-?[\d.]+),(-?[\d.]+)(?:&|$)/.exec(query);
  return m?[Number(m[1]),Number(m[2])] as const:undefined;
};
const offGround=(cx:number,cy:number)=>{
  const x=cx*city.unitsPerCell,y=cy*city.unitsPerCell,{playable:p}=city,bad:string[]=[];
  if(x<p.x+CLEAR||y<p.y+CLEAR||x>p.x+p.w-CLEAR||y>p.y+p.h-CLEAR)bad.push('outside the playable area');
  for(let a=0;a<16;a++)for(const r of [0,CLEAR/2,CLEAR]){
    const px=x+Math.cos(a*Math.PI/8)*r,py=y+Math.sin(a*Math.PI/8)*r;
    if(!city.walkableAt(px,py)){bad.push(`blocked at (${px.toFixed(2)},${py.toFixed(2)}) u`);break;}
  }
  return bad;
};

test('every city scene of the modo foto puts the hero on open walkable ground of the current map',()=>{
  const spots=Object.entries(FOTO_CENAS).flatMap(([name,cena])=>{
    const cells=cena.sandbox==='cidade'&&/(?:^|&)mapa=real(?:&|$)/.test(cena.query)?heroCells(cena.query):undefined;
    return cells?[[name,cells] as const]:[];
  });
  assert.ok(spots.length>=10,`expected the city scenes with hero=, found ${spots.length}`);
  for(const [name,[cx,cy]] of spots)assert.deepEqual(offGround(cx,cy),[],`${name}: hero=${cx},${cy}`);
});

test('the folha de prints extras (scripts/folha-prints.mjs) put the hero on open walkable ground too',()=>{
  // Read as text: the script takes the prints when imported.
  const extras=[...read('../../scripts/folha-prints.mjs').matchAll(/\[\s*'([a-z0-9-]+)'\s*,\s*'([^']*hero=[^']*)'/g)];
  for(const [,name,extra] of extras){
    const cena=FOTO_CENAS[name!];
    if(cena?.sandbox!=='cidade')continue;
    const [cx,cy]=heroCells(extra!.replace(/^&/,''))!;
    assert.deepEqual(offGround(cx,cy),[],`${name}${extra}`);
  }
});

test('the spots are cells of the map: the praça scene stands on the praça point',()=>{
  const praca=city.points.praca!,[cx,cy]=heroCells(FOTO_CENAS['cidade-praca']!.query)!;
  assert.ok(Math.hypot(cx*city.unitsPerCell-praca.x,cy*city.unitsPerCell-praca.y)<2,'cidade-praca is at the praça');
});
