import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Legibility audit 29/10 (L1): the compact card is 156 px wide on the phone (--perfil-w:min(40vw,156px)), so a size in
// cqw alone gives 5.4 % of 156 = 8.4 px. Every text of the card has a px floor that wins on the phone.
const css=readFileSync('src/client/hud/perfis.css','utf8');
const rule=(sel:string)=>{const m=css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g,'\\.')}\\{([^}]*)\\}`));assert.ok(m,sel);return m[1];};
const PHONE_W=156;
/** The font size a `font:` shorthand gives on a card PHONE_W wide. */
function sizeOn(font:string,w:number){
  const m=font.match(/font:[0-9]+ (max\(([0-9.]+)px,([0-9.]+)cqw\)|([0-9.]+)cqw)\//);assert.ok(m,font);
  return m[4]?+m[4]*w/100:Math.max(+m[2],+m[3]*w/100);
}

test('the card\'s texts are 12 px or more on the phone, the name 14 px',()=>{
  const want:Record<string,number>={'.rh-perfil-balao':12,'.rh-perfil-nome':14,'.rh-perfil-dist':12,'.rh-perfil-bio':12};
  for(const [sel,min] of Object.entries(want))assert.ok(sizeOn(rule(sel),PHONE_W)>=min,`${sel}: ${sizeOn(rule(sel),PHONE_W)} px`);
  assert.match(css,/--perfil-w:min\(40vw,156px\)/,'the phone width this test measures');
});

const hex=(h:string)=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
const lum=(c:number[])=>{const [r,g,b]=c.map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
const ratio=(a:number[],b:number[])=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
test('the MATCH stamp is 4.5:1 on the card\'s cream',()=>{
  const tok=readFileSync('src/client/ui/tokens.css','utf8'),t=(n:string)=>hex(tok.match(new RegExp(`--perfil-${n}:#([0-9A-Fa-f]{6})`))![1]);
  const m=css.match(/--perfil-match-tinta:color-mix\(in srgb,var\(--perfil-match\) ([0-9]+)%,var\(--perfil-tinta\)\)/);assert.ok(m);
  const p=+m[1]/100,mix=t('match').map((v,i)=>v*p+t('tinta')[i]*(1-p));
  assert.ok(ratio(mix,t('papel'))>=4.5,`${ratio(mix,t('papel')).toFixed(2)}`);
  assert.match(rule('.rh-perfil-match'),/color:var\(--perfil-match-tinta\)/);
});
