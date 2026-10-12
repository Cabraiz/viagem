import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUND_KINDS} from '../../src/client/render/city/asset.ts';
import {BLOCK_COLORS,CITY_PALETTE,GROUND_COLORS,SHADOW,groundColor,luminance,mixColor} from '../../src/client/render/city/palette.ts';

/** Art lane contrast rule (board design/cidade-nevada/contraste.md): large faces keep luminance >= 0.131 (3:1 vs Breu). */
const MIN_FACE_LUMINANCE=0.131;
const ratio=(a:number,b:number)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);

test('palette: every block face and ground tone keeps 3:1 against the Breu outline',()=>{
  for(const [kind,faces] of Object.entries(BLOCK_COLORS))for(const [face,color] of Object.entries(faces)){
    assert.ok(luminance(color)>=MIN_FACE_LUMINANCE,`${kind}.${face} #${color.toString(16)} L=${luminance(color).toFixed(3)}`);
    assert.ok(ratio(color,CITY_PALETTE.breu)>=3,`${kind}.${face} vs breu`);
  }
  for(const [kind,{base,detail}] of Object.entries(GROUND_COLORS)){
    assert.ok(luminance(base)>=MIN_FACE_LUMINANCE,`${kind} base`);
    assert.ok(luminance(detail)>=MIN_FACE_LUMINANCE,`${kind} detail`);
  }
});

test('ground shading never goes darker than the measured palette tones and stays deterministic',()=>{
  for(const kind of Object.values(GROUND_KINDS)){
    const {base,detail}=GROUND_COLORS[kind];
    const floor=Math.min(luminance(base),luminance(detail))-1e-9;
    assert.equal(groundColor(kind,0),base);
    for(let s=-1;s<=1.0001;s+=0.05){
      const c=groundColor(kind,s);
      assert.ok(luminance(c)>=floor,`${kind} shade ${s.toFixed(2)}`);
      if(s>0)assert.ok(luminance(c)>=luminance(base)-1e-9,`${kind} lit slopes only lighten`);
      assert.equal(groundColor(kind,s),c);
    }
    assert.equal(groundColor(kind,NaN),base);
  }
  assert.equal(mixColor(0x000000,0xffffff,0.5),0x808080);
  assert.equal(mixColor(0x123456,0xabcdef,0),0x123456);
  assert.equal(mixColor(0x123456,0xabcdef,2),0xabcdef);
});

test('ground under a cast shadow still keeps the 0.131 contrast rule, on every slope shade',()=>{
  for(const kind of Object.values(GROUND_KINDS))for(let s=-1;s<=1.0001;s+=0.05){
    const shadowed=mixColor(groundColor(kind,s),CITY_PALETTE.breu,SHADOW.alpha);
    assert.ok(luminance(shadowed)>=MIN_FACE_LUMINANCE,`${kind} shade ${s.toFixed(2)} in shadow: ${luminance(shadowed).toFixed(3)}`);
  }
});
