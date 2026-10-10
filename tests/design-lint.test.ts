import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations,emojiCount,lintCss,lintDesign,sizePx} from '../scripts/lint-design.mjs';

type Violation={file:string;line:number;rule:string;msg:string};
const rules=(css:string,file='src/game/coop.css')=>(lintCss(file,css) as Violation[]).map(v=>v.rule);

test('design lint: src passes (only tokens, two families, hard shadows, no caps, readable sizes)',()=>{
  const {violations}=lintDesign('.') as {violations:Violation[]};
  assert.deepEqual(violations.map(v=>`${v.file}:${v.line} [${v.rule}] ${v.msg}`),[]);
});

test('design lint: each rule catches its case and lets the tokens through',()=>{
  assert.deepEqual(rules('.a{color:#fff}'),['hex']);
  assert.deepEqual(rules('.a{background:color-mix(in srgb,var(--c-breu) 40%,transparent)}'),[]);
  assert.deepEqual(rules(".a{font:700 14px Georgia,serif}"),['font-family']);
  assert.deepEqual(rules(".a{font-family:'Trebuchet MS',system-ui}"),['font-family']);
  assert.deepEqual(rules('.a{font:700 14px var(--f-sistema)}'),[]);
  assert.deepEqual(rules('.a{font:inherit}'),[]);
  assert.deepEqual(rules('.a{border-radius:16px}'),['radius']);
  assert.deepEqual(rules('.a{border-radius:999px}'),['radius']);
  assert.deepEqual(rules('.a{border-radius:var(--r-janela) var(--r-janela) 0 0}'),[]);
  assert.deepEqual(rules('.a{border-radius:50%}'),[]);
  assert.deepEqual(rules('.a{box-shadow:0 3px 12px var(--c-sombra)}'),['shadow']);
  assert.deepEqual(rules('.a{box-shadow:var(--s-1),inset 0 0 0 2px var(--c-papel)}'),[]);
  assert.deepEqual(rules('.a{--rh-shadow:0 3px 12px var(--c-breu)}'),['shadow']);
  assert.deepEqual(rules('.a{filter:drop-shadow(0 2px 4px var(--c-breu))}'),['shadow']);
  assert.deepEqual(rules('.a{text-transform:uppercase}'),['uppercase']);
  assert.deepEqual(rules('.a{letter-spacing:.12em}'),['letter-spacing']);
  assert.deepEqual(rules('.a{letter-spacing:2px}'),['letter-spacing']);
  assert.deepEqual(rules('.a{letter-spacing:.02em}'),['letter-spacing'],'any positive tracking, not only big ones');
  assert.deepEqual(rules('.a{letter-spacing:-.02em}'),[]);
  // Colors in any notation, not only hex.
  assert.deepEqual(rules('.a{color:rgb(10 20 30)}'),['color']);
  assert.deepEqual(rules('.a{background:hsl(200 50% 50% / .4)}'),['color']);
  assert.deepEqual(rules('.a{border:1px solid white}'),['color']);
  assert.deepEqual(rules('.a{color:transparent;background:currentColor}'),[]);
  assert.deepEqual(rules('.a{background:url(x.svg#bad) no-repeat}'),[],'a url fragment is not a hex color');
  assert.deepEqual(rules('.a{content:"#fff red"}'),[],'text in content is not a color');
  // Shadows kept in any variable.
  assert.deepEqual(rules('.a{--lift:0 3px 12px var(--c-breu)}'),['shadow']);
  assert.deepEqual(rules('.a{--lift:0 3px 0 var(--c-breu)}'),[]);
  // Match screens (HUD, emotes) need 13 px; the rest 10 px.
  assert.deepEqual(rules('.a{font-size:12px}','src/game/hud/hud.css'),['font-size']);
  assert.deepEqual(rules('.a{font:700 clamp(11px,3vw,13px) var(--f-sistema)}','src/game/fun/fun.css'),['font-size']);
  assert.deepEqual(rules('.a{font-size:var(--t-13)}','src/game/hud/hud.css'),[]);
  assert.deepEqual(rules('.a{font-size:12px}','src/game/coop.css'),[]);
  assert.deepEqual(rules('.a{font-size:9px}','src/style.css'),['font-size']);
  // rem and calc() count; an unknown var() with a fallback is not guessed.
  assert.deepEqual(rules('.a{font-size:.75rem}','src/game/hud/hud.css'),['font-size']);
  assert.deepEqual(rules('.a{font-size:calc(var(--t-13) * .8)}','src/game/hud/hud.css'),['font-size']);
  assert.deepEqual(rules('.a{font:700 calc(10px + .1rem)/1 var(--f-sistema)}','src/game/hud/hud.css'),['font-size']);
  assert.deepEqual(rules('.a{font-size:var(--x,12px)}','src/game/hud/hud.css'),[]);
  assert.deepEqual(rules('.a{font-size:max(12px,var(--t-13))}','src/game/hud/hud.css'),[]);
  assert.equal(sizePx('clamp(13px,3vw,16px)'),13);assert.equal(sizePx('calc(2 * var(--t-13))'),26);
});

test('design lint: CSS nesting is linted at every depth',()=>{
  const css='.a{color:var(--c-breu);\n  .b{border-radius:3px;\n    &:hover{box-shadow:0 2px 8px var(--c-breu)}}\n  margin:0}';
  const v=lintCss('src/game/coop.css',css) as Violation[];
  assert.deepEqual(v.map(x=>[x.rule,x.line]),[['radius',2],['shadow',3]]);
});

test('design lint: declarations survive @media nesting and report the right line',()=>{
  const ds=declarations('.a{color:red}\n@media (max-height:500px){\n  .b{border-radius:3px}\n}') as {selector:string;prop:string;line:number}[];
  assert.deepEqual(ds.map(d=>[d.selector,d.prop,d.line]),[['.a','color',1],['@media (max-height:500px) .b','border-radius',3]]);
});

test('design lint: emoji count ignores comments (not strings), and the baseline must match exactly',()=>{
  assert.equal(emojiCount("const a='🩴';// 🎉 no\n/* ✦ no */const b=`✦ ok`;const url='https://x';"),2);
  assert.equal(emojiCount("const a='// not a comment 🎉';const b=\"/* nor this ✦ */\";"),2,'comment markers inside strings');
  const baseline=JSON.parse(fs.readFileSync('scripts/design-lint-baseline.json','utf8')).emoji as Record<string,number>;
  const {emoji}=lintDesign('.') as {emoji:Record<string,number>};
  assert.deepEqual(emoji,baseline,'the baseline matches exactly: lower it when emoji leave the code');
});

test('fonts: served from public/fonts with the OFL, pt-BR subset within 120 KB, no Georgia/Trebuchet/monospace in src CSS',()=>{
  const files=['londrina-solid-400','londrina-solid-900','m-plus-rounded-1c-400','m-plus-rounded-1c-700','m-plus-rounded-1c-800'];
  const total=files.reduce((n,f)=>n+fs.statSync(`public/fonts/${f}.woff2`).size,0);
  assert.ok(total<=120*1024,`pt-BR font weight ${total} B`);
  for(const f of ['OFL-londrina-solid.txt','OFL-m-plus-rounded-1c.txt'])assert.match(fs.readFileSync(`public/fonts/${f}`,'utf8'),/SIL Open Font License/);
  const tokens=fs.readFileSync('src/ui/tokens.css','utf8');
  for(const f of files)assert.ok(tokens.includes(`/fonts/${f}.woff2`),`${f} declared in tokens.css`);
  assert.equal((tokens.match(/font-display:swap/g)??[]).length,(tokens.match(/@font-face/g)??[]).length,'every face swaps');
  const html=fs.readFileSync('index.html','utf8');
  assert.equal((html.match(/rel="preload"[^>]*as="font"/g)??[]).length,2,'two preloads');
});
