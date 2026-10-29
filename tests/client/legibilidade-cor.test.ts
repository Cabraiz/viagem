import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HAZARD,TELEGRAPH_LOOKS} from '../../src/client/render/telegraph-look.ts';

// Legibility audit 29/10 (evidence/auditoria-legibilidade-29-10.md, L2): colors told apart by people with full color
// vision and by protan/deutan eyes (Machado 2009, severity 1), measured as CIELAB ΔE.
type Rgb=[number,number,number];
const CVD:Record<'normal'|'protan'|'deutan',number[][]>={
  normal:[[1,0,0],[0,1,0],[0,0,1]],
  protan:[[.152286,1.052583,-.204868],[.114503,.786281,.099216],[-.003882,-.048116,1.051998]],
  deutan:[[.367322,.860646,-.227968],[.280085,.672501,.047413],[-.01182,.04294,.968881]],
};
const lin=(c:number)=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
const srgb=(c:number)=>{c=Math.max(0,Math.min(1,c));return 255*(c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055);};
const rgb=(n:number):Rgb=>[n>>16&255,n>>8&255,n&255];
const see=(c:Rgb,m:number[][]):Rgb=>{const l=c.map(lin);return m.map(r=>srgb(r[0]*l[0]+r[1]*l[1]+r[2]*l[2])) as Rgb;};
function lab(c:Rgb){
  const [r,g,b]=c.map(lin),f=(t:number)=>t>.008856?Math.cbrt(t):7.787*t+16/116;
  const x=f((.4124*r+.3576*g+.1805*b)/.95047),y=f(.2126*r+.7152*g+.0722*b),z=f((.0193*r+.1192*g+.9505*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
function deltaE(a:number,b:number,mode:keyof typeof CVD='normal'){
  const p=lab(see(rgb(a),CVD[mode])),q=lab(see(rgb(b),CVD[mode]));
  return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
}
const hexIn=(file:string,re:RegExp)=>{const m=readFileSync(file,'utf8').match(re);assert.ok(m,`${re} in ${file}`);return parseInt(m[1],16);};

/** The grounds the hazards fall on: the endless map's grass, the minimap's grass shades and the snow. */
const GROUNDS={
  grama:hexIn('src/client/ui/tokens.css',/--cena-grama:#([0-9a-fA-F]{6})/),
  grass:hexIn('src/client/hud/wc-minimap/terrain.ts',/grass:'#([0-9a-f]{6})'/),
  grassDark:hexIn('src/client/hud/wc-minimap/terrain.ts',/grassDark:'#([0-9a-f]{6})'/),
  snow:hexIn('src/client/hud/wc-minimap/terrain.ts',/snow:'#([0-9a-f]{6})'/),
};

test('the measure: the old green bottle vanished on the grass; the old explosion yellow merged with the gas for protans',()=>{
  assert.ok(deltaE(0x3f8a3a,GROUNDS.grama)<10);
  assert.ok(deltaE(0xb9cf34,0xffc93a,'protan')<5);
  assert.ok(deltaE(0xff0000,0x00ff00)>80);
});
test('the molotov bottle reads on grass and snow, for every eye',()=>{
  for(const [name,ground] of Object.entries(GROUNDS))for(const mode of ['normal','protan','deutan'] as const)
    assert.ok(deltaE(HAZARD.glass,ground,mode)>=30,`glass on ${name} (${mode}): ${deltaE(HAZARD.glass,ground,mode).toFixed(1)}`);
});
test('the burp gas and the explosion are told apart by protan and deutan eyes, not only by shape',()=>{
  const gas=TELEGRAPH_LOOKS.arroto.fill!,boom=TELEGRAPH_LOOKS.explosao.fill!;
  assert.equal(boom,HAZARD.boomYellow);
  assert.ok(deltaE(gas,boom)>=30);
  assert.ok(deltaE(gas,boom,'protan')>=20,`protan ${deltaE(gas,boom,'protan').toFixed(1)}`);
  assert.ok(deltaE(gas,boom,'deutan')>=15,`deutan ${deltaE(gas,boom,'deutan').toFixed(1)}`);
});
