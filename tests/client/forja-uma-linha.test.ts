/**
 * NEW-20261014-E4-forja-uma-linha-paisagem: in landscape (667x375, 844x390) and on the desktop (1343x618) the forge's
 * third tag sat under the fold: the window left 135–150 px of list for 163–189 px of two-line tags (prints of the card,
 * at 100% and 125% text). There each tag is now one row (sticker, name, short effect, price; the long effect in the
 * aria-label), and the portrait phone keeps its two-line tags. These tests sum the window's box from camp.css itself
 * (the declarations that apply at each size, in cascade order) at both text scales and check the three tags fit with
 * no scrolling, each tag a 44 px tap; then the tag's texts over a minimal fake DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {RECIPE_SHORT,barricadeText,createCamp} from '../../src/client/hud/camp.ts';
import {forgePriceLabel} from '../../src/client/hud/price.ts';
import {FIXTURE_HERO,fakeView} from '../../src/client/hud/fixtures.ts';
import {RECIPES,RECIPE_IDS,forgePrice} from '../../src/rules/index.ts';
import type {RunView} from '../../src/contract/view.ts';
import type {HudContext} from '../../src/client/hud/model.ts';

type Decl={selector:string;prop:string;value:string;line:number};
const css=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
const CAMP=declarations(css('src/client/hud/camp.css')) as Decl[];
const TOKENS_CSS=css('src/client/ui/tokens.css'),TOKENS=declarations(TOKENS_CSS) as Decl[];

interface Screen {width:number;height:number;scale:1|1.25}
const SIZES=[{width:667,height:375},{width:844,height:390},{width:1343,height:618}] as const;
const PORTRAIT={width:390,height:844} as const;
const SCALES=[1,1.25] as const;
test('the text scales are the tokens\' (100%, and 125% under <html data-texto="125">)',()=>{
  assert.equal(token('--t-escala'),'1');assert.equal(token('--t-escala',':root[data-texto="125"]'),'1.25');
});

/** Whether a media prelude ("@media (max-height:500px),(orientation:landscape)") holds at `s` (no reduced motion). */
function holds(media:string,s:Screen){
  return media.replace(/^@media\s*/,'').split(',').some(part=>part.split(/\s+and\s+/).every(cond=>{
    const c=cond.trim();
    let m=/^\((min|max)-(width|height):(\d+)px\)$/.exec(c);
    if(m){const v=m[2]==='width'?s.width:s.height,n=Number(m[3]);return m[1]==='min'?v>=n:v<=n;}
    m=/^\(orientation:(landscape|portrait)\)$/.exec(c);
    if(m)return (s.width>s.height)===(m[1]==='landscape');
    return false;
  }));
}
/** A declaration's media prelude and rule selector ("@media (a),(b) .rh .x" → ["@media (a),(b)", ".rh .x"]). */
const split=(chain:string):[string,string]=>{const m=/^(@media .*?\))\s+(?!and\s)([^(].*)$/.exec(chain);return m?[m[1],m[2]]:['',chain];};
/** Whether declaration `d` is a rule of `selector` that applies at `s` (bare, or in a media block that holds). */
const applies=(d:Decl,selector:string,s:Screen)=>{const [media,rule]=split(d.selector);return rule===selector&&(!media||holds(media,s));};
/** The value `prop` of `selector` takes at `s`: the last declaration (file order) that applies. */
function cascade(selector:string,prop:string,s:Screen){
  const found=CAMP.filter(d=>d.prop===prop&&applies(d,selector,s)).at(-1);
  assert.ok(found,`camp.css: ${selector} { ${prop} } at ${s.width}x${s.height}`);
  return found.value;
}
const token=(name:string,selector=':root,::backdrop')=>{const d=TOKENS.filter(t=>t.selector===selector&&t.prop===name).at(-1);assert.ok(d,name);return d.value;};

/** A CSS length expression in px at `s`: px, vh/svh/vw, calc/max/min, the tokens the forge uses, env() = 0 (no notch). */
function length(expr:string,s:Screen):number{
  const vars:Record<string,string>={'--rh-t':token('--sa-t'),'--botao-habilidade':token('--botao-habilidade'),'--t-escala':String(s.scale)};
  let e=expr;
  for(let i=0;i<4;i++)e=e.replace(/var\((--[\w-]+)\)/g,(_,n:string)=>{
    const t=/^--t-(\d+)$/.exec(n);if(t){
      // (the lint's parser keeps only letter-and-dash names: the size tokens are read from the file itself)
      assert.ok(TOKENS_CSS.includes(`${n}:calc(${t[1]}px * var(--t-escala));`),`tokens.css ${n}`);return `${Number(t[1])*s.scale}px`;}
    assert.ok(vars[n]!==undefined,`unknown var ${n}`);return `(${vars[n]})`;
  });
  e=e.replace(/env\([^)]*\)/g,'0px');
  const tokens=e.match(/-?\d*\.?\d+(?:px|svh|vh|vw)?|[a-z]+\(|[-+*/(),]/g)??[];
  let i=0;
  const unit=(t:string)=>{const m=/^(-?\d*\.?\d+)(px|svh|vh|vw)?$/.exec(t);assert.ok(m,`length token ${t} in ${expr}`);const v=Number(m[1]);
    return m[2]==='vh'||m[2]==='svh'?v*s.height/100:m[2]==='vw'?v*s.width/100:v;};
  const atom=():number=>{
    const t=tokens[i++];
    if(t==='('){const v=sum();i++;return v;}
    if(t==='calc('){const v=sum();i++;return v;}
    if(t==='max('||t==='min('){const args=[sum()];while(tokens[i]===','){i++;args.push(sum());}i++;return t==='max('?Math.max(...args):Math.min(...args);}
    return unit(t);
  };
  const product=():number=>{let v=atom();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++],r=atom();v=op==='*'?v*r:v/r;}return v;};
  const sum=():number=>{let v=product();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++],r=product();v=op==='+'?v+r:v-r;}return v;};
  return sum();
}
const box=(v:string,s:Screen)=>{const p=v.split(/\s+(?![^(]*\))/).map(x=>length(x,s));return {top:p[0],right:p[1]??p[0],bottom:p[2]??p[0],left:p[3]??p[1]??p[0]};};
/** A `font` shorthand's line box: size × line-height ("400 var(--t-21)/1.05 var(--f-cartaz)"). */
const lineBox=(font:string,s:Screen)=>{const m=/(var\(--t-\d+\))\/([\d.]+)/.exec(font);assert.ok(m,font);return length(m[1],s)*Number(m[2]);};
/** The widest tilt of a tag (camp.css --tilt: -1deg and .8deg on the even ones), in degrees. */
const TILT=Math.max(...CAMP.filter(d=>d.prop==='--tilt').map(d=>Math.abs(parseFloat(d.value))));

/** The forge window at `s` with three tags: its height, its cap, and how far the last tag's tilt reaches past the list. */
function forgeBox(s:Screen){
  const win=box(cascade('.rh-forge','padding',s),s),edge=length(cascade('.rh-forge','border',s).split(' ')[0],s);
  // The head row: the close button, the title cell (title + the R$ under it), the note on one line.
  const close=length(cascade('.rh .rh-forge-close','height',s),s);
  const title=lineBox(cascade('.rh-forge-title','font',s),s)+length(cascade('.rh-forge-titulo','gap',s),s)+lineBox(cascade('.rh-forge-grana','font',s),s);
  const head=Math.max(close,title,lineBox(cascade('.rh-forge-note','font',s),s));
  const list=box(cascade('.rh-forge-tags','padding',s),s),margin=box(cascade('.rh-forge-tags','margin',s),s),gap=length(cascade('.rh-forge-tags','gap',s),s);
  // A one-line tag: its tallest cell (sticker, name, short effect, price) inside its padding and edge, or its min-height.
  const tagPad=box(cascade('.rh .rh-forge-tag','padding',s),s),tagEdge=length(cascade('.rh .rh-forge-tag','border',s).split(' ')[0],s);
  const cells=Math.max(length(cascade('.rh-forge-icon .ic','height',s),s),lineBox(cascade('.rh-forge-name','font',s),s),
    lineBox(cascade('.rh-forge-curto','font',s),s),lineBox(cascade('.rh-forge-cost b','font',s),s));
  const tag=Math.max(length(cascade('.rh .rh-forge-tag','min-height',s),s),cells+tagPad.top+tagPad.bottom+2*tagEdge);
  const height=2*edge+win.top+head+margin.top+list.top+3*tag+2*gap+list.bottom+win.bottom;
  const cap=length(cascade('.rh-forge','max-height',s),s);
  // The tag's width: the window (landscape: min(42vw,380px); else its max-width) less the frame and the list's insets.
  const width=s.height<=500?length(cascade('.rh-forge','width',s),s):length(cascade('.rh-forge','max-width',s),s);
  const tagWidth=width-2*edge-win.left-win.right-margin.left-margin.right-list.left-list.right;
  const poke=tagWidth/2*Math.sin(TILT*Math.PI/180); // half the tag's width, tilted, below its box
  return {height,cap,tag,gap,cells,tagPad,tagEdge,listBottom:list.bottom,poke};
}

for(const size of SIZES)for(const scale of SCALES){
  const s:Screen={...size,scale},name=`${s.width}x${s.height} at ${scale*100}%`;
  test(`${name}: three one-line tags fit the forge window without scrolling`,()=>{
    const b=forgeBox(s);
    assert.ok(b.height<=b.cap,`${name}: window ${b.height.toFixed(1)} px > its cap ${b.cap.toFixed(1)} px (the third tag scrolls)`);
    assert.ok(b.cells+b.tagPad.top+b.tagPad.bottom+2*b.tagEdge<=b.tag+.01,`${name}: one row of text holds in the tag`);
    // The tilted last tag stays inside the list's bottom padding (a tilted box counts as scrollable overflow).
    assert.ok(b.poke<=b.listBottom+.01,`${name}: the tilt pokes ${b.poke.toFixed(1)} px past a ${b.listBottom} px padding`);
  });
  test(`${name}: every tag is a 44 px tap, and the taps never overlap`,()=>{
    const b=forgeBox(s);
    const after=CAMP.filter(d=>d.prop==='inset'&&applies(d,'.rh-forge-tag::after',s)).at(-1);
    const reach=after?-box(after.value,s).top:0;
    assert.ok(b.tag+2*reach>=44,`${name}: ${b.tag} px tag + ${reach} px each side`);
    assert.ok(2*reach<=b.gap,`${name}: the reach (${reach} px) stays in its half of the ${b.gap} px gap`);
    if(reach)assert.equal(cascade('.rh-forge-tag::after','position',s),'absolute');
  });
}

test('the one-line form: name, short effect and price on one row; only the name gives way; the long effect hides',()=>{
  for(const size of SIZES)for(const scale of SCALES){
    const s:Screen={...size,scale};
    assert.equal(cascade('.rh .rh-forge-tag','grid-template-areas',s),"'icon name curto price'");
    assert.equal(cascade('.rh .rh-forge-tag','grid-template-columns',s),'28px minmax(0,1fr) auto auto');
    assert.equal(cascade('.rh-forge-desc','display',s),'none');
    assert.equal(cascade('.rh-forge-curto','display',s),'block');assert.equal(cascade('.rh-forge-curto','white-space',s),'nowrap');
    assert.equal(cascade('.rh-forge-name','white-space',s),'nowrap');assert.equal(cascade('.rh-forge-name','text-overflow',s),'ellipsis');
    // At rest the stamp is out of the layout (its tilted box made the list scroll); a purchase shows it.
    assert.equal(cascade('.rh-forge-stamp','display',s),'none');assert.equal(cascade('.rh-forge-done .rh-forge-stamp','display',s),'block');
  }
});

test('the portrait phone keeps its two-line tags and its 32svh window (unchanged by the card)',()=>{
  for(const scale of SCALES){
    const s:Screen={...PORTRAIT,scale};
    assert.equal(cascade('.rh .rh-forge-tag','grid-template-areas',s),"'icon name price' 'icon desc desc'");
    assert.equal(cascade('.rh-forge-curto','display',s),'none');
    assert.ok(!CAMP.some(d=>d.prop==='display'&&applies(d,'.rh-forge-desc',s)),'the long effect shows');
    assert.equal(cascade('.rh-forge','max-height',s),'32svh');
    assert.equal(cascade('.rh-forge-stamp','opacity',s),'0');
  }
});

test('the short effects: a few pt-BR characters each, never the long line, no arrows or emoji',()=>{
  const fence=[barricadeText({name:'Norte',down:false}),barricadeText({name:'Sul',down:true})];
  const all=[...RECIPE_IDS.map(id=>({short:RECIPE_SHORT[id],describe:RECIPES[id].describe})),...fence];
  for(const {short,describe} of all){
    assert.ok(short.length>0&&short.length<=8,`"${short}" fits beside the name (≤ 8 characters)`);
    assert.ok(short.length<describe.length,`"${short}" shorter than "${describe}"`);
    assert.doesNotMatch(short,/[—→·]|\p{Extended_Pictographic}|[A-Z]{2}/u);
  }
  // Each tells its own recipe apart (the sticker says what it acts on).
  assert.equal(new Set(RECIPE_IDS.map(id=>RECIPE_SHORT[id])).size,RECIPE_IDS.length);
});

// ---------- The tags' texts over a minimal fake DOM (as forja-inflacao.test.ts) ----------
class FakeEl {
  className='';hidden=false;textContent='';innerHTML='';type='';
  dataset:Record<string,string>={};attrs:Record<string,string>={};children:FakeEl[]=[];parentElement:FakeEl|null=null;
  style={transform:'',setProperty(){}};scrollHeight=0;clientHeight=0;scrollTop=0;
  readonly tagName:string;
  constructor(tagName:string){this.tagName=tagName;}
  classList={
    has:(c:string)=>this.className.split(/\s+/).includes(c),
    add:(c:string)=>{if(!this.classList.has(c))this.className=`${this.className} ${c}`.trim();},
    remove:(c:string)=>{this.className=this.className.split(/\s+/).filter(x=>x&&x!==c).join(' ');},
    toggle:(c:string,on?:boolean)=>{const want=on??!this.classList.has(c);if(want)this.classList.add(c);else this.classList.remove(c);return want;},
    contains:(c:string)=>this.classList.has(c),
  };
  append(...nodes:FakeEl[]){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  prepend(n:FakeEl){n.remove();n.parentElement=this;this.children.unshift(n);}
  replaceChildren(...nodes:FakeEl[]){this.children=[];this.append(...nodes);}
  remove(){const p=this.parentElement;if(p)p.children=p.children.filter(c=>c!==this);this.parentElement=null;}
  insertAdjacentHTML(_where:string,html:string){this.innerHTML+=html;}
  setAttribute(k:string,v:string){this.attrs[k]=v;}
  getAttribute(k:string){return this.attrs[k]??null;}
  removeAttribute(k:string){delete this.attrs[k];}
  addEventListener(){}
  removeEventListener(){}
  getBoundingClientRect(){return {top:0,bottom:0,left:0,right:0,width:0,height:0};}
  get firstElementChild(){return this.children[0]??null;}
  get lastElementChild(){return this.children.at(-1)??null;}
  querySelector(selector:string):FakeEl|null{
    const m=/^\.([\w-]+)$/.exec(selector);if(!m)return null;
    for(const c of this.children){if(c.classList.has(m[1]))return c;const deep=c.querySelector(selector);if(deep)return deep;}
    return null;
  }
  all(pred:(e:FakeEl)=>boolean):FakeEl[]{return this.children.flatMap(c=>[...(pred(c)?[c]:[]),...c.all(pred)]);}
}

test('each tag carries its short effect; the aria-label keeps the long one and the inflated price (forgePrice)',()=>{
  const g=globalThis as {document?:unknown};const before=g.document;
  g.document={createElement:(tag:string)=>new FakeEl(tag)};
  try{
    const part=createCamp({onForge:()=>1});
    const base=fakeView('camp-forge',1),view:RunView={...base,camp:{...base.camp!,forge:{gambiarra:1}}};
    part.setHero(FIXTURE_HERO['camp-forge']);
    part.update(view,{localId:'p1'} as HudContext);
    const forge=part.forge as unknown as FakeEl;
    assert.equal(forge.hidden,false);
    for(const id of RECIPE_IDS){
      const tag=forge.all(e=>e.classList.has('rh-forge-tag')&&e.dataset.recipe===id&&!e.hidden)[0];
      assert.equal(tag.querySelector('.rh-forge-curto')?.textContent,RECIPE_SHORT[id]);
      assert.equal(tag.querySelector('.rh-forge-desc')?.textContent,RECIPES[id].describe,'the portrait line is still there');
      const price=forgePrice(id,view.camp!.forge);
      assert.equal(tag.querySelector('.rh-forge-cost')?.dataset.price,String(price));
      const label=tag.attrs['aria-label'];
      assert.ok(label.startsWith(`${RECIPES[id].name}: ${RECIPES[id].describe}. Custa ${forgePriceLabel(price).speech}.`),label);
    }
    assert.equal(forgePrice('gambiarra',view.camp!.forge),2*RECIPES.gambiarra.cost,'the second gambiarra costs double');
    part.destroy();
  }finally{if(before===undefined)delete g.document;else g.document=before;}
});
