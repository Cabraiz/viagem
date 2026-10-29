/**
 * Lighting card (render/light.ts): one sun, `?luz=0`, and the contrast rule on the GRADED colours — the Breu outline
 * keeps 3:1 against every block face, ground tone and shadowed ground of the city after the colour grade, in the middle
 * of the screen and in the vignetted corners. Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUND_KINDS} from '../../src/client/render/city/asset.ts';
import {BLOCK_COLORS,CITY_PALETTE,GROUND_COLORS,groundColor,luminance,mixColor} from '../../src/client/render/city/palette.ts';
import {ACTOR_TINT,BUILDING_TINT,EXPOSURE_BAND,EXPOSURE_GLSL,GRADES,exposeColor,exposureFor,exposureParam,gradeGlsl,LIT_SHADOW,SHADOW_PER_HEIGHT,SUN_VIEW,gradeColor,lightEnabled,rgbOf} from '../../src/client/render/light.ts';
import {reliefShader} from '../../src/client/render/city/relevo/shader.ts';

const lum=(c:readonly number[])=>{const f=(v:number)=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4;return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
const ratio=(a:readonly number[],b:readonly number[])=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const mul=(hex:number,tint:number)=>{const a=rgbOf(hex),t=rgbOf(tint);return [a[0]*t[0],a[1]*t[1],a[2]*t[2]] as [number,number,number];};

test('one sun: a unit vector from the upper left, shadows ~1.2× the height, the same as the city relief shader', () => {
  assert.ok(Math.abs(Math.hypot(...SUN_VIEW)-1)<1e-12);
  assert.ok(SUN_VIEW[0]<0&&SUN_VIEW[1]<0&&SUN_VIEW[2]>0);
  assert.ok(SHADOW_PER_HEIGHT>1&&SHADOW_PER_HEIGHT<1.3,String(SHADOW_PER_HEIGHT));
  // Executor-8's relief shader writes its sun as a literal: it must stay this one (same direction once normalized).
  const m=/vec3 sun=normalize\(vec3\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)\)/.exec(reliefShader);
  assert.ok(m,'relief sun found');
  const r=[+m![1],+m![2],+m![3]],l=Math.hypot(...r);
  r.forEach((v,i)=>assert.ok(Math.abs(v/l-SUN_VIEW[i])<1e-3,`relief sun ${r} vs ${SUN_VIEW}`));
});

test('?luz=0 (or off) turns the light off; anything else keeps it on', () => {
  assert.equal(lightEnabled(''),true);
  assert.equal(lightEnabled('?sandbox=cidade'),true);
  assert.equal(lightEnabled('?luz=0'),false);
  assert.equal(lightEnabled('?a=1&luz=off'),false);
  assert.equal(lightEnabled('?luz=1'),true);
});

test('the grade is subtle: shadows colder, lights warmer, the vignette only at the corners and off in economy mode', () => {
  const g=GRADES.cidade,mid=[.5,.5,.5] as const;
  const dark=gradeColor([.25,.25,.25],g),light=gradeColor([.95,.95,.95],g);
  assert.ok(dark[2]>dark[0],'shade goes blue');
  assert.ok(light[0]>light[2],'sun goes golden');
  for(const c of [mid,[.2,.4,.6],[.9,.85,.8]] as const)gradeColor(c,g).forEach((v,i)=>assert.ok(Math.abs(v-c[i])<.12));
  assert.deepEqual(gradeColor(mid,g,0),gradeColor(mid,g,.5),'centre untouched by the vignette');
  assert.ok(lum(gradeColor(mid,g,1))<lum(gradeColor(mid,g,0)),'corners darker');
  assert.deepEqual(gradeColor(mid,g,1,false),gradeColor(mid,g,0),'economy: no vignette');
});

test('contrast rule after the grade: Breu vs every face, ground tone and lit cast shadow keeps 3:1, centre and corners', () => {
  for(const [world,g] of Object.entries(GRADES))for(const radius of [0,1]){
    const breu=gradeColor(rgbOf(CITY_PALETTE.breu),g,radius);
    const check=(name:string,hex:number)=>{const c=gradeColor(rgbOf(hex),g,radius);assert.ok(ratio(c,breu)>=3,`${world} r${radius} ${name} ${ratio(c,breu).toFixed(2)}:1`);};
    for(const [kind,faces] of Object.entries(BLOCK_COLORS))for(const [face,color] of Object.entries(faces))check(`${kind}.${face}`,color);
    for(const [kind,{base,detail}] of Object.entries(GROUND_COLORS)){check(`${kind} base`,base);check(`${kind} detail`,detail);}
    for(const kind of Object.values(GROUND_KINDS))for(let s=-1;s<=1.0001;s+=.25)check(`${kind} shade ${s} in a lit shadow`,mixColor(groundColor(kind,s),LIT_SHADOW.color,LIT_SHADOW.alpha));
  }
});

test('the lit cast shadow keeps the 0.131 floor of the palette rule before the grade too', () => {
  for(const kind of Object.values(GROUND_KINDS))for(let s=-1;s<=1.0001;s+=.05){
    const c=mixColor(groundColor(kind,s),LIT_SHADOW.color,LIT_SHADOW.alpha);
    assert.ok(luminance(c)>=.131,`${kind} ${s.toFixed(2)} L=${luminance(c).toFixed(3)}`);
  }
});

test('actors: the sun tint is light (every corner ≥ 90% of white) and the hero still reads 3:1 on graded snow', () => {
  for(const t of Object.values(ACTOR_TINT))for(const v of rgbOf(t))assert.ok(v>=.9);
  const snow=GROUND_COLORS[GROUND_KINDS.s].base,g=GRADES.cidade;
  const outline=gradeColor(mul(CITY_PALETTE.breu,ACTOR_TINT.bottomRight),g,1),ground=gradeColor(rgbOf(snow),g,1);
  assert.ok(ratio(outline,ground)>=3,`Breu outline on snow ${ratio(outline,ground).toFixed(2)}:1`);
});

test('building art tinted by side keeps 3:1 against Breu on every palette face, all four corners, graded', () => {
  for(const [world,g] of Object.entries(GRADES)){
    const breu=gradeColor(rgbOf(CITY_PALETTE.breu),g,1);
    for(const [kind,faces] of Object.entries(BLOCK_COLORS))for(const [face,color] of Object.entries(faces))for(const [corner,t] of Object.entries(BUILDING_TINT)){
      const c=gradeColor(mul(color,t),g,0);
      assert.ok(ratio(c,breu)>=3,`${world} ${kind}.${face} ${corner} ${ratio(c,breu).toFixed(2)}:1`);
    }
  }
});

test('the ground shaders get the grade as a GLSL function; ?luz=0 makes it the identity', () => {
  assert.equal(gradeGlsl('cidade',false),'vec3 lightGrade(vec3 c){return c;}');
  const on=gradeGlsl('cidade',true),g=GRADES.cidade;
  assert.match(on,/^vec3 lightGrade\(vec3 c\)\{/);
  for(const v of [...g.cool,...g.warm])assert.ok(on.includes(v.toFixed(3)),`${v} in the GLSL`);
  assert.ok(on.includes(g.contrast.toFixed(3))&&on.includes(g.pivot.toFixed(3)));
  assert.match(reliefShader,/lightGrade\(color\)/,'the city relief applies it');
});

// Card jogo-mais-escuro: the world 10–25 % darker at full light; the board compares 1, 0.9, 0.83 and 0.75.
const EXPOSURES=[1,.9,.83,.75] as const;
const luma=(c:readonly number[])=>c[0]*.299+c[1]*.587+c[2]*.114;

test('exposure: darks below the band never move, the top takes the whole factor, and it stays monotonic', () => {
  for(const k of EXPOSURES){
    for(const c of [[.1,.1,.12],[.3,.35,.4],[EXPOSURE_BAND[0]-.001,EXPOSURE_BAND[0]-.001,EXPOSURE_BAND[0]-.001]] as const)assert.deepEqual(exposeColor(c,k),[...c]);
    exposeColor([1,1,1],k).forEach(v=>assert.ok(Math.abs(v-k)<1e-12));
    for(let L=0;L<1;L+=.002)assert.ok(luma(exposeColor([L+.002,L+.002,L+.002],k))>=luma(exposeColor([L,L,L],k)),`${k} at ${L}`);
  }
  assert.ok(luma(exposeColor([.7,.7,.7],.75))<.7&&luma(exposeColor([.7,.7,.7],.75))>.7*.75,'between: part of the factor');
});

test('exposure: ?exposicao= picks it (0.5..1), ?luz=0 turns it off, the map gives the default', () => {
  assert.equal(exposureParam(''),undefined);
  assert.equal(exposureParam('?exposicao=0.83'),.83);
  assert.equal(exposureParam('?exposicao=0.2'),.5);
  assert.equal(exposureParam('?exposicao=x'),undefined);
  assert.equal(exposureFor('cidade','?exposicao=0.75'),.75);
  assert.equal(exposureFor('cidade','?exposicao=0.75&luz=0'),1);
  for(const [world,g] of Object.entries(GRADES)){
    assert.equal(exposureFor(world as keyof typeof GRADES,''),g.exposure);
    assert.ok(g.exposure>=.75&&g.exposure<=1,`${world} ${g.exposure}`);
  }
});

test('exposure keeps the contrast rule: Breu 3:1 against every face, ground tone, lit shadow and tinted building, down to 0.75', () => {
  for(const k of EXPOSURES)for(const [world,g] of Object.entries(GRADES)){
    const ex=(c:readonly [number,number,number])=>exposeColor(c,k);
    for(const radius of [0,1]){
      const breu=ex(gradeColor(rgbOf(CITY_PALETTE.breu),g,radius));
      const check=(name:string,hex:number)=>{const c=ex(gradeColor(rgbOf(hex),g,radius));assert.ok(ratio(c,breu)>=3,`${k} ${world} r${radius} ${name} ${ratio(c,breu).toFixed(2)}:1`);};
      for(const [kind,faces] of Object.entries(BLOCK_COLORS))for(const [face,color] of Object.entries(faces))check(`${kind}.${face}`,color);
      for(const [kind,{base,detail}] of Object.entries(GROUND_COLORS)){check(`${kind} base`,base);check(`${kind} detail`,detail);}
      for(const kind of Object.values(GROUND_KINDS))for(let s=-1;s<=1.0001;s+=.25)check(`${kind} shade ${s} in a lit shadow`,mixColor(groundColor(kind,s),LIT_SHADOW.color,LIT_SHADOW.alpha));
    }
    const breu=ex(gradeColor(rgbOf(CITY_PALETTE.breu),g,1));
    for(const [kind,faces] of Object.entries(BLOCK_COLORS))for(const [face,color] of Object.entries(faces))for(const [corner,t] of Object.entries(BUILDING_TINT)){
      const c=ex(gradeColor(mul(color,t),g,0));
      assert.ok(ratio(c,breu)>=3,`${k} ${world} ${kind}.${face} ${corner} ${ratio(c,breu).toFixed(2)}:1`);
    }
    const snow=GROUND_COLORS[GROUND_KINDS.s].base,outline=ex(gradeColor(mul(CITY_PALETTE.breu,ACTOR_TINT.bottomRight),g,1));
    assert.ok(ratio(outline,ex(gradeColor(rgbOf(snow),g,1)))>=3,`${k} ${world} hero outline on snow`);
  }
});

test('the exposure GLSL is the same band as exposeColor, on the unpremultiplied colour', () => {
  assert.ok(EXPOSURE_GLSL.includes(`smoothstep(${EXPOSURE_BAND[0].toFixed(2)},${EXPOSURE_BAND[1].toFixed(2)}`));
  assert.match(EXPOSURE_GLSL,/uExposicao/);
  assert.match(EXPOSURE_GLSL,/color\.rgb\/max\(color\.a/);
});
