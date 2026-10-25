import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {MM_CELL,MM_CITY_ART,MM_FACES,MM_ICONS,cityArtTerrain,faceCell,iconCell,marksAtlas} from '../../src/client/hud/wc-minimap/art.ts';
import {PLAYABLE_CLASS_IDS,classes} from '../../src/rules/index.ts';
import {decodeCityAsset} from '../../src/maps/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));

test('every playable hero (bots included) has a minimap face, and every face is a real class', () => {
  for(const id of PLAYABLE_CLASS_IDS)assert.ok(faceCell(id)>=0,`${id} has no minimap face`);
  for(const id of MM_FACES)assert.ok(classes.some(c=>c.id===id),`${id} is not a class`);
  assert.equal(faceCell('nobody'),-1);assert.equal(faceCell(undefined),-1);
  assert.equal(iconCell(MM_ICONS[0]),MM_FACES.length);
});

test('the atlas is one row of cells: the faces, then the icons', async () => {
  const m=await sharp(fromRoot('public/art/minimapa/marcas.webp')).metadata();
  assert.equal(m.width,MM_CELL*(MM_FACES.length+MM_ICONS.length));assert.equal(m.height,MM_CELL);assert.ok(m.hasAlpha);
});

test('no DOM: no art, so the minimap keeps its drawn shapes', () => {
  assert.equal(marksAtlas(),undefined);
  assert.equal(cityArtTerrain({id:MM_CITY_ART.id,version:MM_CITY_ART.version,cells:{w:110,h:110},unitsPerCell:1.5}),undefined);
});

test('the painted city still matches the real plan (IoU of the solid ≥ 0.85), when it is the asset it was painted from', async t => {
  const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
  if(!decoded.ok)throw new Error(decoded.error);
  const a=decoded.asset;
  if(a.id!==MM_CITY_ART.id||a.version!==MM_CITY_ART.version){
    // The minimap falls back to the procedural image; paint again with scripts/minimapa/ (README in the card).
    t.diagnostic(`city ${a.id} v${a.version} ≠ art v${MM_CITY_ART.version}: the painted background is off until repainted`);return;
  }
  const N=220,side=a.cells.w*a.unitsPerCell;
  const grey=new Uint8Array(await sharp(fromRoot('public/art/minimapa/cidade-nevada.webp')).greyscale().resize(N,N,{fit:'fill'}).raw().toBuffer());
  // Otsu: the solid is the dark side.
  const h=new Array(256).fill(0);for(const v of grey)h[v]++;
  let sum=0;for(let i=0;i<256;i++)sum+=i*h[i];
  let sb=0,wb=0,best=0,th=128;
  for(let i=0;i<256;i++){wb+=h[i];if(!wb)continue;const wf=grey.length-wb;if(!wf)break;sb+=i*h[i];const v=wb*wf*(sb/wb-(sum-sb)/wf)**2;if(v>best){best=v;th=i;}}
  let inter=0,uni=0;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const wx=(x+.5)/N*side,wy=(y+.5)/N*side,want=!a.walkableAt(wx,wy)&&!a.water(wx/a.unitsPerCell*4,wy/a.unitsPerCell*4),have=grey[y*N+x]<=th;
    if(want&&have)inter++;if(want||have)uni++;
  }
  const iou=inter/uni;
  assert.ok(iou>=.85,`IoU ${iou.toFixed(3)}`);
});
