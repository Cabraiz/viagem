// Card NEW-20261022-ORQ-agua-realista: the water is the painted tile of the albedo atlas (not the flat palette blue), with
// a ragged shore of ice drawn by the relief shader, and the layer no longer strokes the striped rim, foam ring and
// diamond glints over it; the flat ground (no relief: Canvas, ?relevo=0) keeps them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALBEDO_MEANS,ALBEDO_SLOTS} from '../../src/client/render/city/relevo/albedo-meta.ts';
import {WATER_ART_LIFT,WATER_EDGE,reliefShader} from '../../src/client/render/city/relevo/shader.ts';
import {groundDecor} from '../../src/client/render/city/decor.ts';
import {groundAt,parseCityAsset} from '../../src/client/render/city/asset.ts';
import {makeSampleCity} from '../../src/client/render/city/sample.ts';

test('the water slot is a dark, cold blue-green paint (not the bright palette blue) and the shader reads it',()=>{
  const m=ALBEDO_MEANS[ALBEDO_SLOTS.indexOf('agua')];
  assert.ok(m,'agua slot');
  const [r,g,b]=m.map(v=>v*WATER_ART_LIFT);
  assert.ok(b>r&&g>r,'cold: blue and green over red');
  assert.ok(Math.max(r,g,b)<0.5,'darker than the palette agua #3F8EC0');
  assert.ok(reliefShader.includes(`albedoDetail(${ALBEDO_SLOTS.indexOf('agua').toFixed(1)},w,`));
  assert.ok(reliefShader.includes('water=mix(water,mix(paint,'),'the paint replaces the flat blue once the atlas is in');
});

test('the shore wobbles with noise (not the cell grid): an ice ledge first, then the open water',()=>{
  assert.ok(WATER_EDGE.shelf<WATER_EDGE.open&&WATER_EDGE.open<0.5,'the open water starts inside the shelf, before the cell edge');
  assert.ok(WATER_EDGE.wobble>0.15&&WATER_EDGE.wobble<0.5);
  assert.ok(reliefShader.includes('float wm=cv.g+(fbm('),'the cover mask is pushed by fbm');
  assert.ok(reliefShader.includes('color=mix(color,shelf,'));
});

test('groundDecor draws the water rim/foam/glints only on the flat ground; the relief layer asks for none',()=>{
  const asset=parseCityAsset(makeSampleCity());
  const chunk={key:'all',cx:0,cy:0,x0:0,y0:0,x1:asset.width,y1:asset.height};
  let water=0;for(let y=0;y<asset.height;y++)for(let x=0;x<asset.width;x++)if(groundAt(asset,x,y)==='water')water++;
  assert.ok(water>0,'the sample city has its fountain');
  const flat=groundDecor(chunk as never,asset,0),relief=groundDecor(chunk as never,asset,0,undefined,false);
  assert.ok(flat.length>relief.length,'the water decor is gone without the rim');
  assert.ok(!relief.some(p=>p.shimmer),'no glint diamonds over the painted water');
  const layer=readFileSync(new URL('../../src/client/render/city/city-layer.ts',import.meta.url),'utf8');
  assert.equal(layer.match(/groundDecor\([^;]*!this\.relief\)/g)?.length,3,'every groundDecor call of the layer');
});
