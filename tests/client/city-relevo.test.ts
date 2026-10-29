import test from 'node:test';
import assert from 'node:assert/strict';
import {ALBEDO_MEANS} from '../../src/client/render/city/relevo/albedo-meta.ts';
import {readFileSync} from 'node:fs';
import {groundAt,groundZ,parseCityAsset,type CityAsset} from '../../src/client/render/city/asset.ts';
import {CITY_PALETTE,MATERIALS} from '../../src/client/render/city/palette.ts';
import {cliffCells,cornerHeights,reliefHeight,reliefTextures,withoutCliffs,MIN_RELIEF_HEIGHT} from '../../src/client/render/city/relevo/field.ts';
import {previewHills} from '../../src/client/render/city/relevo/preview.ts';
import {RELIEF_RAY_STEPS,reliefShader} from '../../src/client/render/city/relevo/shader.ts';
import {CLIFF_LIP_HEIGHT} from '../../src/client/render/city/from-maps.ts';
import {makeSampleCity} from '../../src/client/render/city/sample.ts';

const mini=parseCityAsset(JSON.parse(readFileSync(new URL('./fixtures/cidade-mini.json',import.meta.url),'utf8')));
const sample=parseCityAsset(makeSampleCity());
/** A 4×3 city with hand-set corners and one cell of every kind. */
const tiny:CityAsset={...sample,width:4,height:3,cell:0.88,origin:{x:0,y:0},blocks:[],props:[],
  ground:'spci'+'wrss'+'ssss',heights:new Array(12).fill(0),
  corners:[0,0,0,0,0, 0,1,2,0,0, 0,0.5,0,0,0, 0,0,0,0,0]};

test('relief field: one texel per corner, R is the corner over maxHeight, so the GPU bilinear equals groundZ',()=>{
  assert.ok(tiny.corners);
  for(const asset of [mini,sample,tiny]){
    const t=reliefTextures(asset),W=asset.width+1,H=asset.height+1;
    assert.equal(t.fieldWidth,W);assert.equal(t.fieldHeight,H);
    assert.equal(t.field.length,W*H*4);assert.equal(t.kinds.length,asset.width*asset.height*4);
    const corners=cornerHeights(asset);
    assert.equal(t.maxHeight,Math.max(MIN_RELIEF_HEIGHT,...corners));
    for(let i=0;i<W*H;i++)assert.ok(Math.abs(t.field[i*4]/255*t.maxHeight-corners[i])<=t.maxHeight/255/2+1e-9,`corner ${i}`);
    // Alpha stays opaque (a premultiplied upload would wipe the masks).
    for(let i=3;i<t.field.length;i+=4)assert.equal(t.field[i],255);
    for(let i=3;i<t.kinds.length;i+=4)assert.equal(t.kinds[i],255);
    // With exact corners (the real city) the shader's read-back matches the ground actors stand on, within one 8-bit step.
    if(asset.corners)for(let k=0;k<200;k++){
      const fx=((k*37)%997)/997*asset.width,fy=((k*61)%991)/991*asset.height;
      const z=groundZ(asset,asset.origin.x+fx*asset.cell,asset.origin.y+fy*asset.cell);
      assert.ok(Math.abs(reliefHeight(t,fx,fy)-z)<=t.maxHeight/255+1e-9,`(${fx.toFixed(2)},${fy.toFixed(2)}) ${reliefHeight(t,fx,fy)} vs ${z}`);
    }
  }
});

test('relief masks: one texel per cell, so a single-cell patch keeps its full value at its centre',()=>{
  const t=reliefTextures(tiny);
  const kind=(cx:number,cy:number)=>Array.from(t.kinds.slice((cy*4+cx)*4,(cy*4+cx)*4+3));
  const cover=(cx:number,cy:number)=>Array.from(t.cover.slice((cy*4+cx)*4,(cy*4+cx)*4+3));
  assert.deepEqual(kind(0,0),[0,0,0]);assert.deepEqual(cover(0,0),[0,0,0]);   // snow
  assert.deepEqual(kind(1,0),[255,0,0]);     // packed
  assert.deepEqual(kind(2,0),[0,255,0]);     // cobble
  assert.deepEqual(kind(3,0),[0,0,255]);     // ice
  assert.equal(groundAt(tiny,0,1),'water');assert.deepEqual(cover(0,1),[0,255,0]);
  assert.equal(groundAt(tiny,1,1),'rubble');assert.deepEqual(cover(1,1),[255,0,0]);
  for(let i=3;i<t.cover.length;i+=4)assert.equal(t.cover[i],255);
  // The field keeps only the height.
  for(let i=0;i<t.field.length;i+=4){assert.equal(t.field[i+1],0);assert.equal(t.field[i+2],0);}
});

test('cliff slopes: cliff blocks leave the boxes and become the blue channel of the cover mask; walls stay boxes',()=>{
  const withCliff={...tiny,blocks:[{id:'c1',kind:'cliff' as const,x:1,y:2,w:2,h:1,height:0.35},{id:'w1',kind:'wall' as const,x:3,y:2,w:1,h:1,height:1.6}]};
  const t=reliefTextures(withCliff),blue=(cx:number,cy:number)=>t.cover[(cy*4+cx)*4+2];
  assert.equal(blue(1,2),255);assert.equal(blue(2,2),255);
  assert.equal(blue(3,2),0,'a wall stays a box');assert.equal(blue(0,2),0);assert.equal(blue(1,1),0);
  assert.deepEqual(Array.from(cliffCells(withCliff)),[0,0,0,0, 0,0,0,0, 0,1,1,0]);
  const drawn=withoutCliffs(withCliff);
  assert.deepEqual(drawn.blocks.map(b=>b.id),['w1']);
  assert.equal(withCliff.blocks.length,2,'the asset itself keeps its cliffs (sim, relief mask)');
  // The ridge rises as high as the box did, and the ray marches it like the hills.
  assert.ok(reliefShader.includes(`BERM=${CLIFF_LIP_HEIGHT.toFixed(2)}`));
  assert.ok(reliefShader.includes('if(z<=Hs(cellAt(s,z)))'));
});

test('relief field without corners spreads each cell height to its corners (averaged where cells meet)',()=>{
  const flat={...tiny,corners:undefined,heights:[0,0,0,0, 0,4,0,0, 0,0,0,0]};
  const c=cornerHeights(flat);
  assert.equal(c[1*5+1],1);assert.equal(c[1*5+2],1);assert.equal(c[2*5+1],1);assert.equal(c[2*5+2],1);assert.equal(c[0],0);
});

test('relief shader: GLSL ES 1.00 safe (no reserved words, constant loop bounds) and colours copied from the city palette',()=>{
  const code=reliefShader.replace(/\/\/[^\n]*/g,'');
  for(const word of ['flat','packed','input','output','sample','filter','class','union','half','fixed','long','short','double','active','common','partition','smooth','superp'])
    assert.ok(!new RegExp(`\\b${word}\\b`).test(code),`reserved word ${word}`);
  for(const m of code.matchAll(/for\(int i=\d+;i<=?([^;]+);/g))assert.match(m[1],/^\d+$/,`loop bound ${m[1]}`);
  assert.ok(code.includes(`i<=${RELIEF_RAY_STEPS}`));
  const hex=(c:number)=>[(c>>16)&255,(c>>8)&255,c&255].map(v=>(v/255).toFixed(4)).join(',');
  for(const c of [CITY_PALETTE.neve,CITY_PALETTE['neve-detalhe'],CITY_PALETTE['neve-pisada'],CITY_PALETTE.calcada,CITY_PALETTE.gelo,CITY_PALETTE.agua,
    CITY_PALETTE['entulho-chao'],MATERIALS.pedra.luz,MATERIALS.pedra.clara,MATERIALS.pedra.escura,MATERIALS['neve-tampa'].luz,MATERIALS['neve-tampa'].escura])
    assert.ok(code.includes(`vec3(${hex(c)})`),`palette colour #${c.toString(16)}`);
  // Every colour constant is a palette tone: none invented in the shader.
  const palette=new Set([...Object.values(CITY_PALETTE),...Object.values(MATERIALS).flatMap(m=>Object.values(m))].map(c=>hex(c as number)));
  // ...but the albedo atlas's mean colours (albedo-meta.ts): divisors of the photo's detail ratio, never painted.
  const means=new Set(ALBEDO_MEANS.map(m=>m.map(v=>v.toFixed(4)).join(',')));
  for(const m of code.matchAll(/vec3\((\d\.\d{4},\d\.\d{4},\d\.\d{4})\)/g))assert.ok(palette.has(m[1])||means.has(m[1]),`vec3(${m[1]}) is not a palette tone`);
});

test('snow edge (chao-da-cidade-sem-emenda): the cliff ridge height wanders along the line and its flank fades up to the snow',()=>{
  const code=reliefShader.replace(/\/\/[^\n]*/g,'');
  // ±30 % of BERM by a value noise over the cell, so the shaded flank is not one band width; 0 off the ridge.
  assert.match(code,/float Hs\(vec2 f\)\{float b=berm\(f\);return H\(f\)\+\(b>0\.0\?BERM\*b\*\(0\.7\+0\.6\*n\(/);
  // Hs is declared after the noise it uses (GLSL needs the function above its caller).
  assert.ok(code.indexOf('float n(vec2 p)')<code.indexOf('float Hs(vec2 f)'));
  // The flank rock is graded by the ridge profile (dark foot, light crest) and greyed towards the snow shade's hue.
  assert.ok(code.includes('float up=berm(f);'));
  assert.match(code,/cliffRock=mix\(cliffRock\*0\.86,mix\(cliffRock,SNOW_SHADE,0\.5\),smoothstep\(0\.05,0\.85,up\)\);/);
  assert.match(code,/cliffRock=mix\(cliffRock,SNOW_DEEP\*/);
});

test('preview hills (sandbox only) leave streets, plaza, water and blocks at their height and only ever raise snow',()=>{
  const hilly=previewHills(mini),before=cornerHeights(mini),after=cornerHeights(hilly),W=mini.width+1;
  let raised=0;
  for(let j=0;j<=mini.height;j++)for(let i=0;i<=mini.width;i++){
    const k=j*W+i;assert.ok(after[k]>=before[k]-1e-9);
    if(after[k]>before[k]+1e-6)raised++;
    for(const [dx,dy] of [[-1,-1],[0,-1],[-1,0],[0,0]]){
      const cx=i+dx,cy=j+dy;if(cx<0||cy<0||cx>=mini.width||cy>=mini.height)continue;
      const kind=groundAt(mini,cx,cy),blocked=mini.blocks.some(b=>cx>=b.x&&cx<b.x+b.w&&cy>=b.y&&cy<b.y+b.h);
      if(kind!=='snow'||blocked)assert.ok(Math.abs(after[k]-before[k])<1e-9,`corner (${i},${j}) next to ${blocked?'a block':kind}`);
    }
  }
  assert.ok(raised>0,'some snow rises');
  assert.equal(hilly.heights.length,mini.heights.length);
});
