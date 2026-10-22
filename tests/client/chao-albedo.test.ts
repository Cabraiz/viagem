// Card NEW-20261014-ORQ-chao-albedo-cidade: the ground albedo atlas (scripts/chao-albedo.mjs) and its use by the relief
// shader: a power-of-two atlas the GPU can mipmap, every material's mean colour, the shader's hooks, the fallback, the
// binding without re-upload and the match preload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {ALBEDO_GRID,ALBEDO_MEANS,ALBEDO_SLOTS,ALBEDO_URL} from '../../src/client/render/city/relevo/albedo-meta.ts';
import {ALBEDO_CHROMA,ALBEDO_SPAN,ALBEDO_SPAN_UNITS,ALBEDO_STRENGTH,reliefShader} from '../../src/client/render/city/relevo/shader.ts';
import {matchAssets} from '../../src/client/preload/match-assets.ts';

const file=new URL(`../../public${ALBEDO_URL}`,import.meta.url);

test('the atlas: 6 materials in a power-of-two WebP under /art (Service Worker cache, out of lite/), each slot padded',async()=>{
  assert.deepEqual([...ALBEDO_SLOTS],['neve','neve-pisada','calcada','gelo','terra','agua'],'asfalto delivered but no ground kind is asphalt');
  assert.match(ALBEDO_URL,/^\/art\/chao\/[a-z-]+\.webp$/,'not under /art/lite/: the scene fallback would ask for an original that does not exist');
  assert.ok(existsSync(file),ALBEDO_URL);
  const m=await sharp(fileURLToPath(file)).metadata();
  assert.equal(m.format,'webp');
  assert.equal(m.width,ALBEDO_GRID.cols*ALBEDO_GRID.tile);assert.equal(m.height,ALBEDO_GRID.rows*ALBEDO_GRID.tile);
  const pot=(n:number)=>(n&(n-1))===0;
  assert.ok(pot(m.width!)&&pot(m.height!),'power of two: WebGL1 mipmaps it');
  assert.ok(ALBEDO_GRID.cols*ALBEDO_GRID.rows>=ALBEDO_SLOTS.length);
  assert.ok(ALBEDO_GRID.pad>0&&ALBEDO_GRID.pad<ALBEDO_GRID.tile/8);
});

test('every material has its mean colour (the detail ratio divides by it), its chroma, span and strength',()=>{
  assert.equal(ALBEDO_MEANS.length,ALBEDO_SLOTS.length);
  for(const m of ALBEDO_MEANS){assert.equal(m.length,3);for(const v of m)assert.ok(v>0.05&&v<1,`${v}`);}
  for(const s of ALBEDO_SLOTS){
    assert.ok(ALBEDO_CHROMA[s]>=0&&ALBEDO_CHROMA[s]<=1,s);assert.ok(ALBEDO_SPAN_UNITS[s]>=2&&ALBEDO_SPAN_UNITS[s]<=10,s);assert.ok(ALBEDO_STRENGTH[s]>0&&ALBEDO_STRENGTH[s]<=1,s);
  }
  assert.ok(ALBEDO_CHROMA.gelo<ALBEDO_CHROMA.terra,'the ice photo is very saturated: its palette tint dominates');
  assert.ok(ALBEDO_SPAN.lo<1&&ALBEDO_SPAN.hi>1&&ALBEDO_SPAN.lo>0.6&&ALBEDO_SPAN.hi<1.4,'detail stays near the palette tone');
});

test('the relief shader samples the atlas (iChannel3) with the turned double read, and draws the procedural ground while albedoOn is 0',()=>{
  const code=reliefShader;
  assert.ok(code.includes('uniform sampler2D iChannel3;'));assert.ok(code.includes('uniform float albedoOn;'));
  assert.ok(code.includes('vec3 material(float slot,vec2 p){vec2 q=mat2(0.8,-0.6,0.6,0.8)*p*1.37'),'Crônicas material(): a second read turned and offset');
  assert.ok(code.includes('if(albedoOn<0.5)return vec3(1.0);'),'without the atlas: ratio 1 and no texture read (the ground of before)');
  assert.ok(code.includes('return mix(vec3(1.0),r,strength);'));
  for(const s of ALBEDO_SLOTS)assert.ok(code.includes(`albedoDetail(${ALBEDO_SLOTS.indexOf(s).toFixed(1)},w,`),s);
  // Each slot's own mean is the divisor.
  for(const [i,m] of ALBEDO_MEANS.entries())assert.ok(code.includes(`vec3(${m.map(v=>v.toFixed(4)).join(',')})`),ALBEDO_SLOTS[i]);
});

test('the atlas is bound by its GL texture (no Shader textureData: no re-upload, the mipmap filter stays) and the match preloads it',()=>{
  const baker=readFileSync(new URL('../../src/client/render/city/relevo/baker.ts',import.meta.url),'utf8');
  assert.ok(baker.includes('0,0,w,h,[...this.keys],SAMPLING)'),'the targets get only the 3 data textures');
  assert.ok(baker.includes('uniform.value=texture.source[0]?.glTexture'));
  assert.ok(baker.includes('wrapper.minFilter=gl.LINEAR_MIPMAP_LINEAR'),'kept for a restored context');
  const city=matchAssets({self:'cidadao-comum',others:[],map:'cidade-nevada'});
  assert.ok(city.some(a=>a.url===ALBEDO_URL&&a.priority==='P0'&&a.kind==='ground'));
  assert.ok(!matchAssets({self:'cidadao-comum',others:[],map:'cidade-nevada',search:'?chao=0'}).some(a=>a.url===ALBEDO_URL));
});
