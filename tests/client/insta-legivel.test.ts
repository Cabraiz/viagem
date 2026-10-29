import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// NEW-20261029-ORQ-legivel-insta-e-css-morto: the insta texts pass WCAG AA (4.5) on their worst background, and no
// insta text, stories included, shrinks below 12 px.
const tokens=readFileSync(new URL('../../src/client/ui/tokens.css',import.meta.url),'utf8');
const insta=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
const style=readFileSync(new URL('../../src/client/style.css',import.meta.url),'utf8');
const token=(n:string)=>{const m=new RegExp(String.raw`--${n}:\s*(#[0-9A-Fa-f]{6})`).exec(tokens);assert.ok(m,n);return m[1];};
const lum=(h:string)=>{
  const [r,g,b]=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
};
const contrast=(a:string,b:string)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};

test('insta greys and the red likes badge reach 4.5 on their worst background',()=>{
  for(const [fg,bg] of [['insta-cinza','insta-fundo'],['insta-cinza','insta-chip'],['insta-st-cinza','insta-st-campo'],['insta-st-branco','insta-st-vermelho']])
    assert.ok(contrast(token(fg),token(bg))>=4.5,`${fg} on ${bg}: ${contrast(token(fg),token(bg)).toFixed(2)}`);
});

test('no insta text floor under 12 px, and style.css keeps nothing under 12 px',()=>{
  for(const m of insta.matchAll(/font(?:-size)?:[^;}]*?(?:clamp|max)\((\d+)px/g))assert.ok(+m[1]>=12,m[0]);
  // A sticker part smaller than its sticker (.85em) keeps the floor too: the pergunta field was 11.2 px at 390x844.
  for(const m of insta.matchAll(/font-size:\s*([^;}]*?)(?<!\d)\.\d+em/g))assert.match(m[1],/max\(12px,\s*$/,m[0]);
  for(const m of style.matchAll(/font(?:-size)?:[^;}]*?(?<![\w.-])(\d+(?:\.\d+)?)px/g))assert.ok(+m[1]>=12,m[0]);
});
