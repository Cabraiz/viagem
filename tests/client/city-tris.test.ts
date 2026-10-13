import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MeshBuilder,meshBytes,meshOnScreen,segmentOnScreen} from '../../src/client/render/city/tris.ts';

const view=(x:number,y:number,width:number,height:number)=>({x,y,width,height});

test('MeshBuilder keeps triangles in draw order with one style per (colour, alpha)',()=>{
  const b=new MeshBuilder();
  const red=b.style(0xff0000,1),faint=b.style(0xff0000,0.35),again=b.style(0xff0000,1);
  assert.equal(red,again);
  assert.notEqual(red,faint);
  b.tri(red,0,0,10,0,0,10);
  b.tri(faint,1,2,3,4,5,6);
  const m=b.freeze();
  assert.equal(m.count,2);
  assert.deepEqual([...m.xy],[0,0,10,0,0,10,1,2,3,4,5,6]);
  assert.deepEqual([...m.style],[red,faint]);
  assert.deepEqual(m.colors,[0xff0000,0xff0000]);
  assert.deepEqual(m.alphas,[1,0.35]);
  assert.deepEqual([m.x0,m.y0,m.x1,m.y1],[0,0,10,10]);
});

test('positions stay float64: the stored numbers are the ones Phaser would transform',()=>{
  const b=new MeshBuilder(),s=b.style(1,1),x=0.1+0.2;
  b.tri(s,x,1/3,2,2,3,3);
  const m=b.freeze();
  assert.equal(m.xy[0],x);
  assert.equal(m.xy[1],1/3);
});

test('segments split the triangles in parts with their own bounds; empty parts add no segment',()=>{
  const b=new MeshBuilder(),s=b.style(0,1);
  b.mark();// nothing yet: no segment
  b.tri(s,0,0,1,0,0,1);b.tri(s,1,1,2,1,1,2);
  b.mark();
  b.mark();// empty part
  b.tri(s,100,50,110,50,100,60);
  const m=b.freeze();
  assert.deepEqual([...m.ends],[2,3]);
  assert.deepEqual([...m.bounds],[0,0,2,2,100,50,110,60]);
  assert.deepEqual([m.x0,m.y0,m.x1,m.y1],[0,0,110,60]);
  assert.ok(meshBytes(m)>=m.xy.byteLength+m.style.byteLength);
});

test('an empty mesh has no segment and is never on screen',()=>{
  const m=new MeshBuilder().freeze();
  assert.equal(m.count,0);
  assert.equal(m.ends.length,0);
  assert.equal(meshOnScreen(m,0,0,view(-1e9,-1e9,2e9,2e9),2),false);
});

test('culling: off camera only when the bounds plus margin miss the world view, offset by the object position',()=>{
  const b=new MeshBuilder(),s=b.style(0,1);
  b.tri(s,0,0,10,0,0,10);b.mark();
  b.tri(s,100,0,110,0,100,10);
  const m=b.freeze(),cam=view(20,0,50,50);
  assert.equal(meshOnScreen(m,0,0,cam,2),true);// the mesh spans the view
  assert.equal(segmentOnScreen(m,0,0,0,cam,2),false);// x1 = 10 < 20 - 2
  assert.equal(segmentOnScreen(m,0,0,0,cam,10),true);// within the margin
  assert.equal(segmentOnScreen(m,1,0,0,cam,2),false);// x0 = 100 > 70 + 2
  assert.equal(segmentOnScreen(m,1,-40,0,cam,2),true);// moved left by its position
  assert.equal(meshOnScreen(m,0,100,cam,2),false);// moved below the view
  // Touching the widened edge still counts as on screen (never drop a pixel).
  assert.equal(segmentOnScreen(m,0,8,0,cam,2),true);
});

test('city layer draws blocks, glints and procedural props through TriBand, never per-frame Graphics',()=>{
  const src=readFileSync(new URL('../../src/client/render/city/city-layer.ts',import.meta.url),'utf8');
  // The only live Graphics left are the temporary ones baked into the ground render texture (make, not add).
  assert.equal(/scene\.add\.graphics\(/.test(src),false);
  assert.ok((src.match(/TriBand\.make\(/g)??[]).length>=4);
  const band=readFileSync(new URL('../../src/client/render/city/tri-band.ts',import.meta.url),'utf8');
  // Frozen meshes are culled against the camera and keep Phaser's fill tint effect (2) and tint packing.
  assert.match(band,/meshOnScreen\(/);
  assert.match(band,/F\[o\+5\]=2/);
  assert.match(band,/getTintAppendFloatAlpha/);
});

test('TriBand guard: the installed Phaser still has the internals the frozen-triangle replay relies on',async()=>{
  const {readFileSync}=await import('node:fs');
  const root=new URL('../../node_modules/phaser/',import.meta.url);
  const {TRI_PHASER_VERSION}=await import('../../src/client/render/city/tri-band.ts').catch(()=>({TRI_PHASER_VERSION:'3.90.0'}));
  const version=JSON.parse(readFileSync(new URL('package.json',root),'utf8')).version;
  assert.equal(version,TRI_PHASER_VERSION,'Phaser changed: re-verify tri-band.ts (recording/replay) before bumping TRI_PHASER_VERSION');
  const renderer=readFileSync(new URL('src/gameobjects/graphics/GraphicsWebGLRenderer.js',root),'utf8');
  assert.match(renderer,/Utils\.getTintAppendFloatAlpha/,'GraphicsWebGLRenderer still packs tints through Utils.getTintAppendFloatAlpha');
  const multi=readFileSync(new URL('src/renderer/webgl/pipelines/MultiPipeline.js',root),'utf8');
  for(const name of ['batchFillPath','batchStrokePath','batchLine','batchFillRect','batchFillTriangle','batchStrokeTriangle'])
    assert.match(multi,new RegExp(`${name}: function`),`MultiPipeline.${name}`);
  // batchTri/batchQuad live on the base WebGLPipeline.
  const base=readFileSync(new URL('src/renderer/webgl/WebGLPipeline.js',root),'utf8');
  for(const name of ['batchTri','batchQuad'])assert.match(base,new RegExp(`${name}: function`),`WebGLPipeline.${name}`);
  const tri=base.slice(base.indexOf('batchTri: function'));
  assert.equal(tri.slice(tri.indexOf('(')+1,tri.indexOf(')')).split(',').length,17,'batchTri arity (tint is the 12th argument)');
});
