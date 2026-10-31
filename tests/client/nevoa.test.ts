import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {ECONOMY_ASH_SHARE,FURO_GLSL,LUZES_DEPTH,NEVOA_DEFAULT,NEVOA_DEPTH,NEVOA_LEVELS,SEPIA_GLSL,furo,nevoaFor,nevoaLayers,nevoaParam,sepiaColor} from '../../src/client/render/nevoa-rules.ts';
import {BLACKOUT_DEPTH} from '../../src/client/render/blackout-rules.ts';
import {SELF_DEPTH} from '../../src/client/render/you.ts';
import {CITY_PALETTE} from '../../src/client/render/city/palette.ts';
import {rgbOf} from '../../src/client/render/light.ts';

const luma=(c:readonly number[])=>c[0]!*.299+c[1]!*.587+c[2]!*.114;
const lum=(c:readonly number[])=>{const f=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;return .2126*f(c[0]!)+.7152*f(c[1]!)+.0722*f(c[2]!);};
const contrast=(a:readonly number[],b:readonly number[])=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

describe('nevoa (jogo-mais-escuro, the user\'s fog)',()=>{
  it('levels grow with n; 0 draws nothing; the city has fog by default, the tropical maps none',()=>{
    const z=NEVOA_LEVELS[0]!;assert.deepEqual([z.haze,z.bands,z.ash,z.sepia],[0,0,0,0]);
    for(let i=1;i<NEVOA_LEVELS.length;i++){
      const a=NEVOA_LEVELS[i-1]!,b=NEVOA_LEVELS[i]!;
      assert.ok(b.haze>a.haze&&b.bands>a.bands&&b.ash>a.ash);
      // Faint wind bands (the user: running, not dense): thin streaks always lighter than the haze, never past half.
      assert.ok(b.bands<b.haze&&b.bands<=.5);
      // The hole never clears the fog to nothing, and stays near the hero (under 40 % of the short side).
      assert.ok(b.floor>0&&b.clear[1]<.4);
    }
    assert.deepEqual({...NEVOA_DEFAULT},{cidade:2,infinito:0,ilha:0});
  });
  it('Leve (economy) keeps the wind and the ash, with fewer flakes; level 0 draws nothing (nevoa-cinzas-no-celular)',()=>{
    assert.deepEqual(nevoaLayers(NEVOA_LEVELS[0]!,false),{haze:0,bands:0,ash:0});
    assert.deepEqual(nevoaLayers(NEVOA_LEVELS[0]!,true),{haze:0,bands:0,ash:0});
    assert.ok(ECONOMY_ASH_SHARE>0&&ECONOMY_ASH_SHARE<1);
    for(const l of NEVOA_LEVELS.slice(1)){
      const full=nevoaLayers(l,false),leve=nevoaLayers(l,true);
      assert.deepEqual(full,{haze:l.haze,bands:l.bands,ash:l.ash});
      assert.equal(leve.haze,l.haze);assert.equal(leve.bands,l.bands);
      assert.ok(leve.ash>=Math.floor(l.ash/3)&&leve.ash<l.ash,`ash ${leve.ash} of ${l.ash}`);
    }
  });
  it('?nevoa= picks the level (clamped), ?luz=0 turns it off',()=>{
    assert.equal(nevoaParam(''),undefined);assert.equal(nevoaParam('?nevoa=x'),undefined);
    assert.equal(nevoaParam('?nevoa=1'),1);assert.equal(nevoaParam('?nevoa=9'),3);assert.equal(nevoaParam('?nevoa=-2'),0);
    assert.equal(nevoaFor('cidade',''),2);assert.equal(nevoaFor('ilha','?nevoa=3'),3);assert.equal(nevoaFor('cidade','?nevoa=3&luz=0'),0);
  });
  it('the fog sits over the world, under the blackout and the hero; the lights over the fog',()=>{
    assert.ok(NEVOA_DEPTH+2<LUZES_DEPTH&&LUZES_DEPTH<BLACKOUT_DEPTH&&BLACKOUT_DEPTH<SELF_DEPTH);
  });
  it('the sepia grade keeps every colour\'s luma, so the Breu outline keeps its 3:1',()=>{
    const s=NEVOA_LEVELS.at(-1)!.sepia,breu=rgbOf(CITY_PALETTE.breu);
    for(const hex of Object.values(CITY_PALETTE) as number[]){
      const c=rgbOf(hex),g=sepiaColor(c,s);
      assert.ok(Math.abs(luma(g)-luma(c))<1e-3);
      if(contrast(c,breu)>=3)assert.ok(contrast(g,breu)>=2.95,hex.toString(16));
    }
    assert.deepEqual(sepiaColor([.2,.5,.8],0),[.2,.5,.8]);
    assert.ok(SEPIA_GLSL.includes('uSepia'));
  });
  it('the hole: nothing of the fog inside clear[0] but the floor, all of it past clear[1], monotonic',()=>{
    assert.ok(Math.abs(furo(0,40,120,.1)-.1)<1e-9&&Math.abs(furo(40,40,120,.1)-.1)<1e-9);assert.equal(furo(120,40,120,.1),1);
    let last=0;for(let d=0;d<=160;d+=8){const v=furo(d,40,120,.1);assert.ok(v>=last);last=v;}
    assert.ok(FURO_GLSL.includes('gl_FragCoord'));
  });
});
