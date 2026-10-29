// Card NEW-20261029-ORQ-foto-cenas-cidade: the city scenes of the modo foto open on the map (tools/foto.mjs fails a
// print that is mostly the off-map background), praça/luta/sombra stand at their own places and cidade-beco is a
// real narrow alley of the current map.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {FOTO_CENAS} from '../../src/client/dev/foto.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {EMPTY_MAX,OUTSIDE_RGB,emptyShare,sceneSandboxes} from '../../tools/foto-vazio.mjs';

const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
const decoded=decodeCityAsset(read('../../public/maps/cidade-nevada.json'));
if(!decoded.ok)throw new Error('cidade-nevada.json does not decode');
const city=decoded.asset,u=city.unitsPerCell;
const hero=(name:string)=>{
  const m=/(?:^|&)hero=(-?[\d.]+),(-?[\d.]+)(?:&|$)/.exec(FOTO_CENAS[name]!.query)!;
  return [Number(m[1]),Number(m[2])] as const;
};

const pixels=(rgb:readonly number[],n:number,channels:number)=>{
  const data=new Uint8Array(n*channels);
  for(let i=0;i<n;i++)data.set(rgb.slice(0,channels),i*channels);
  return data;
};

test('emptyShare tells an off-map print (all background) from a print of the map',()=>{
  assert.ok(emptyShare(pixels(OUTSIDE_RGB,100,3),3)>EMPTY_MAX,'all background is "sem mapa"');
  assert.ok(emptyShare(pixels([...OUTSIDE_RGB.map(c=>c+3),255],100,4),4)>EMPTY_MAX,'near the background colour, RGBA');
  assert.equal(emptyShare(pixels([0xe8,0xee,0xf4,255],100,4),4),0,'snow is map');
  const edge=new Uint8Array([...pixels(OUTSIDE_RGB,30,3),...pixels([0x60,0x70,0x80],70,3)]);
  assert.ok(emptyShare(edge,3)<=EMPTY_MAX,'an edge of the map in the frame passes');
});

test('the check knows every scene of the registry and which ones are the city',()=>{
  const listed=new Map(sceneSandboxes(read('../../src/client/dev/foto.ts')));
  assert.deepEqual([...listed.keys()].sort(),Object.keys(FOTO_CENAS).sort());
  for(const [name,cena] of Object.entries(FOTO_CENAS))assert.equal(listed.get(name),cena.sandbox,name);
  for(const name of ['cidade-regua','cidade-postes','cidade-praca','cidade-beco','luta','sombra'])assert.equal(listed.get(name),'cidade',name);
});

test('praça, luta and sombra stand at different places of the map',()=>{
  const names=['cidade-praca','luta','sombra'] as const;
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
    const [ax,ay]=hero(names[i]!),[bx,by]=hero(names[j]!);
    assert.ok(Math.hypot(ax-bx,ay-by)>=10,`${names[i]} and ${names[j]} are ${Math.hypot(ax-bx,ay-by).toFixed(1)} cells apart`);
  }
});

test('cidade-beco stands in a narrow alley: walls close by on both sides, open along it',()=>{
  const [cx,cy]=hero('cidade-beco'),x=cx*u,y=cy*u;
  assert.ok(city.walkableAt(x,y),'the hero stands on open ground');
  const wall=(dx:number)=>{for(let d=0.25;d<=4;d+=0.25)if(!city.walkableAt(x+dx*d,y))return d;return Infinity;};
  const w=wall(-1)+wall(1);
  assert.ok(w<=4,`the alley is ${w.toFixed(2)} u wide between the walls (west ${wall(-1)}, east ${wall(1)})`);
  let open=0;for(let dy=-8;dy<=8;dy+=0.25)if(city.walkableAt(x,y+dy))open+=0.25;
  assert.ok(open>=4*u,`the alley runs ${open} u along it`);
});
