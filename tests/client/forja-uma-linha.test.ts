/**
 * NEW-20261014-E4-forja-uma-linha-paisagem: in landscape (667x375, 844x390) and on the desktop (1343x618) the forge's
 * third tag sat under the fold: the window left 135–150 px of list for 163–189 px of two-line tags (prints of the card,
 * at 100% and 125% text). Each tag is now one row (sticker, name, short effect, price; the long effect in the
 * aria-label). BUG-20261014-ORQ-forja-cobre-heroi-retrato: on the portrait phone (390x844, 360x800) the two-line window
 * (y 446–684) covered the hero, whose body the round's camera puts at the viewport centre; there too the tags are one
 * row and the window sits on the thumbs, and so does Dona Cida's tray (cida.css), which shares its place.
 * These tests sum the windows' boxes from camp.css and cida.css themselves (the declarations that apply at each size,
 * in cascade order) at both text scales and check the three tags fit with no scrolling, each tag a 44 px tap, and in
 * portrait the hero ± HERO_MARGIN and the thumbs + THUMB_GAP stay clear; then the tag's texts over a minimal fake DOM.
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
import {HERO_MARGIN,THUMB_GAP,crosses,type Rect} from '../../src/client/hud/zones.ts';
import {HERO_SIDE} from '../../src/client/hud/city/layout.ts';
import type {RunView} from '../../src/contract/view.ts';
import type {HudContext} from '../../src/client/hud/model.ts';

type Decl={selector:string;prop:string;value:string;line:number};
const css=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
const CAMP=declarations(css('src/client/hud/camp.css')) as Decl[],CIDA=declarations(css('src/client/hud/cida.css')) as Decl[];
const FONE=declarations(css('src/client/hud/fone.css')) as Decl[],COOP=declarations(css('src/client/coop.css')) as Decl[];
// (explore.css writes "@media(" with no space: the same prelude as the others for `split`)
const EXPLORE=(declarations(css('src/client/explore.css')) as Decl[]).map(d=>({...d,selector:d.selector.replace(/^@media\(/,'@media (')}));
const TOKENS_CSS=css('src/client/ui/tokens.css'),TOKENS=declarations(TOKENS_CSS) as Decl[];

interface Screen {width:number;height:number;scale:1|1.25}
const SIZES=[{width:667,height:375},{width:844,height:390},{width:1343,height:618}] as const;
const PORTRAITS=[{width:390,height:844},{width:360,height:800}] as const;
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
/** Whether declaration `d` is a rule of `selector` that applies at `s` (bare, or in a media block that holds; a selector
 * list ".a,.b" is a rule of each). */
const applies=(d:Decl,selector:string,s:Screen)=>{
  const [media,rule]=split(d.selector);
  return rule.split(/,(?![^(]*\))/).map(r=>r.trim()).includes(selector)&&(!media||holds(media,s));
};
/** The value `prop` of `selector` takes at `s` in `sheet`: the last declaration (file order) that applies, if any. */
const maybe=(selector:string,prop:string,s:Screen,sheet=CAMP)=>sheet.filter(d=>d.prop===prop&&applies(d,selector,s)).at(-1)?.value;
/** The value `prop` of `selector` takes at `s` (camp.css unless told). */
function cascade(selector:string,prop:string,s:Screen,sheet=CAMP){
  const found=maybe(selector,prop,s,sheet);
  assert.ok(found!==undefined,`${selector} { ${prop} } at ${s.width}x${s.height}`);
  return found;
}
const token=(name:string,selector=':root,::backdrop')=>{const d=TOKENS.filter(t=>t.selector===selector&&t.prop===name).at(-1);assert.ok(d,name);return d.value;};

/** A CSS length expression in px at `s`: px, vh/svh/vw, calc/max/min, the tokens the forge uses, env() = 0 (no notch). */
function length(expr:string,s:Screen):number{
  const vars:Record<string,string>={'--rh-t':token('--sa-t'),'--rh-l':token('--sa-l'),'--rh-r':token('--sa-r'),
    '--botao-habilidade':token('--botao-habilidade'),'--t-escala':String(s.scale)};
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
/** The widest tilt of a forge tag at `s` (camp.css --tilt on the odd and the even ones), in degrees. */
const tilt=(s:Screen)=>Math.max(...['.rh .rh-forge-tag','.rh .rh-forge-tag:nth-child(even)'].map(t=>Math.abs(parseFloat(cascade(t,'--tilt',s)))));
const portrait=(s:Screen)=>s.height>500&&s.height>s.width;
/** How far a tag's tap area (::after, inset -N px 0) reaches past its border box, at `s`: an absolute box's inset counts
 * from the tag's padding box, inside its 2 px edge (inset -2px reached 0 px past the tag). */
const reachOf=(s:Screen)=>{
  const after=maybe('.rh-forge-tag::after','inset',s);if(!after)return 0;
  return -box(after,s).top-length(cascade('.rh .rh-forge-tag','border',s).split(' ')[0],s);
};

/** The forge window at `s` with three tags: its height, its cap, and how far the last tag's tilt reaches past the list. */
function forgeBox(s:Screen){
  const win=box(cascade('.rh-forge','padding',s),s),edge=length(cascade('.rh-forge','border',s).split(' ')[0],s);
  // The head row: the close button (its margin box: landscape and portrait lift it 4 px), the title cell (title + the R$
  // under it), the note.
  const closeMargin=box(cascade('.rh .rh-forge-close','margin',s),s),closeHeight=length(cascade('.rh .rh-forge-close','height',s),s);
  const close=closeMargin.top+closeHeight+closeMargin.bottom;
  const title=lineBox(cascade('.rh-forge-title','font',s),s)+length(cascade('.rh-forge-titulo','gap',s),s)+lineBox(cascade('.rh-forge-grana','font',s),s);
  // The note: one line in landscape (nowrap) and on the desktop, 2 at most in portrait (-webkit-line-clamp).
  const noteLines=Number(maybe('.rh-forge-note','-webkit-line-clamp',s)??1);
  const head=Math.max(close,title,noteLines*lineBox(cascade('.rh-forge-note','font',s),s));
  const list=box(cascade('.rh-forge-tags','padding',s),s),margin=box(cascade('.rh-forge-tags','margin',s),s),gap=length(cascade('.rh-forge-tags','gap',s),s);
  // A one-line tag: its tallest cell (sticker, name, short effect, price) inside its padding and edge, or its min-height.
  const tagPad=box(cascade('.rh .rh-forge-tag','padding',s),s),tagEdge=length(cascade('.rh .rh-forge-tag','border',s).split(' ')[0],s);
  const cells=Math.max(length(cascade('.rh-forge-icon .ic','height',s),s),lineBox(cascade('.rh-forge-name','font',s),s),
    lineBox(cascade('.rh-forge-curto','font',s),s),lineBox(cascade('.rh-forge-cost b','font',s),s));
  const tag=Math.max(length(cascade('.rh .rh-forge-tag','min-height',s),s),cells+tagPad.top+tagPad.bottom+2*tagEdge);
  const height=2*edge+win.top+head+margin.top+list.top+3*tag+2*gap+list.bottom+win.bottom;
  const cap=length(cascade('.rh-forge','max-height',s),s);
  // The tag's width: the window (landscape: min(42vw,380px); portrait phone: the screen less its edges, fone.css; else
  // its max-width) less the frame and the list's insets.
  const width=s.height<=500?length(cascade('.rh-forge','width',s),s)
    :portrait(s)?Math.min(length(cascade('.rh-forge','max-width',s),s),s.width-length('var(--rh-l)',s)-length('var(--rh-r)',s))
    :length(cascade('.rh-forge','max-width',s),s);
  const tagWidth=width-2*edge-win.left-win.right-margin.left-margin.right-list.left-list.right;
  const poke=tagWidth/2*Math.sin(tilt(s)*Math.PI/180); // half the tag's width, tilted, below its box
  // The tap band (::after, `reach` px over and under the tag) tilts with its tag: its corner reaches
  // reach·cos θ + (w/2)·sin θ past the tag's box.
  const reach=reachOf(s),theta=tilt(s)*Math.PI/180,band=reach?reach*Math.cos(theta)+tagWidth/2*Math.sin(theta):0;
  // Inside the window's padding box, from its top: the close button's box and where the first tag's taps start (its
  // band, or its own tilted corner, whichever is higher).
  const closeBox={top:closeMargin.top,bottom:closeMargin.top+closeHeight};
  const firstTap=head+margin.top+list.top-Math.max(band,poke);
  return {height,cap,tag,gap,cells,tagPad,tagEdge,listTop:list.top,listBottom:list.bottom,poke,reach,band,closeBox,firstTap};
}

for(const size of [...SIZES,...PORTRAITS])for(const scale of SCALES){
  const s:Screen={...size,scale},name=`${s.width}x${s.height} at ${scale*100}%`;
  test(`${name}: three one-line tags fit the forge window without scrolling`,()=>{
    const b=forgeBox(s);
    assert.ok(b.height<=b.cap,`${name}: window ${b.height.toFixed(1)} px > its cap ${b.cap.toFixed(1)} px (the third tag scrolls)`);
    assert.ok(b.cells+b.tagPad.top+b.tagPad.bottom+2*b.tagEdge<=b.tag+.01,`${name}: one row of text holds in the tag`);
    // The tilted last tag and its tap band stay inside the list's bottom padding (both count as scrollable overflow).
    assert.ok(b.poke<=b.listBottom+.01,`${name}: the tilt pokes ${b.poke.toFixed(1)} px past a ${b.listBottom} px padding`);
    assert.ok(b.band<=b.listBottom+.01,`${name}: the last tap reaches ${b.band.toFixed(2)} px past a ${b.listBottom} px padding`);
  });
  test(`${name}: every tag is a 44 px tap, and the taps never overlap`,()=>{
    const b=forgeBox(s),reach=b.reach;
    assert.ok(b.tag+2*reach>=44,`${name}: ${b.tag} px tag + ${reach} px each side`);
    assert.ok(2*reach<=b.gap,`${name}: the reach (${reach} px) stays in its half of the ${b.gap} px gap`);
    // The list clips its top: the first tag's band must fit its top padding, or that tag's tap is short of 44 px.
    assert.ok(b.band<=b.listTop+.01,`${name}: the first tap reaches ${b.band.toFixed(2)} px over a ${b.listTop} px padding`);
    if(reach)assert.equal(cascade('.rh-forge-tag::after','position',s),'absolute');
  });
  test(`${name}: the close button's box ends where the first tag's tap starts`,()=>{
    const b=forgeBox(s);
    assert.ok(b.closeBox.bottom<=b.firstTap+.01,`${name}: the close button (to ${b.closeBox.bottom} px) over the first tap (from ${b.firstTap.toFixed(2)} px)`);
    assert.ok(b.closeBox.bottom-b.closeBox.top>=44,'the close button keeps 44 px');
  });
}

test('the one-line form on every screen: name, short effect and price on one row; only the name gives way',()=>{
  for(const size of [...SIZES,...PORTRAITS])for(const scale of SCALES){
    const s:Screen={...size,scale};
    assert.equal(cascade('.rh .rh-forge-tag','grid-template-areas',s),"'icon name curto price'");
    assert.equal(cascade('.rh .rh-forge-tag','grid-template-columns',s),'28px minmax(0,1fr) auto auto');
    assert.equal(cascade('.rh-forge-curto','display',s),'block');assert.equal(cascade('.rh-forge-curto','white-space',s),'nowrap');
    assert.equal(cascade('.rh-forge-name','white-space',s),'nowrap');assert.equal(cascade('.rh-forge-name','text-overflow',s),'ellipsis');
    // At rest the stamp is out of the layout (its tilted box made the list scroll); a purchase shows it.
    assert.equal(cascade('.rh-forge-stamp','display',s),'none');assert.equal(cascade('.rh-forge-done .rh-forge-stamp','display',s),'block');
  }
});

/** The thumbs' top as the phone's shell draws them: the controls' bottom padding, the stick (explore.css) and the skill
 * button (coop.css #coop-attack, --botao-habilidade) at the same inset; the taller one. */
function thumbs(s:Screen){
  const pad=box(cascade('.explore-controls','padding',s,EXPLORE),s).bottom,stick=length(cascade('.explore-stick','height',s,EXPLORE),s);
  const skill=length(cascade('#coop-attack','height',s,COOP),s);
  return s.height-pad-Math.max(stick,skill);
}
/** The hero's box: the round's camera puts its body at the viewport centre (BUG-20261013-ORQ-camera-centro-heroi). */
const heroAt=(s:Screen):Rect=>({x:s.width/2-HERO_SIDE/2,y:s.height/2-HERO_SIDE/2,width:HERO_SIDE,height:HERO_SIDE});
/** A window on the portrait phone: from the screen's edge (fone.css), its bottom from its sheet, `height` tall. */
function windowAt(selector:string,sheet:Decl[],height:number,s:Screen):Rect{
  assert.equal(cascade('.rh.rh[data-hud=fone] :is(.rh-forge,.rh-cida)','left',s,FONE),'var(--rh-l)');
  const left=length('var(--rh-l)',s),bottom=s.height-length(cascade(selector,'bottom',s,sheet),s);
  return {x:left,y:bottom-height,width:s.width-left-length('var(--rh-r)',s),height};
}

/**
 * Dona Cida's tray at `s`, at its tallest: the frame, the head row (the close button, the title, the Grana, a note of
 * 2 lines at most) and the row of three sweets, each with the hole and the stock on top, the name and what it does (as
 * many lines as their -webkit-line-clamp lets them) and the price.
 */
function cidaBox(s:Screen){
  const c=(selector:string,prop:string)=>cascade(selector,prop,s,CIDA);
  const lines=(selector:string)=>{
    assert.equal(c(selector,'display'),'-webkit-box',`${selector} is clamped`);
    const big=s.scale===1.25?maybe(`:root[data-texto="125"] ${selector}`,'-webkit-line-clamp',s,CIDA):undefined;
    return Number(big??c(selector,'-webkit-line-clamp'));
  };
  const win=box(c('.rh-cida','padding'),s),edge=length(c('.rh-cida','border').split(' ')[0],s);
  const head=Math.max(length(c('.rh .rh-cida-close','height'),s),lineBox(c('.rh-cida-title','font'),s),lineBox(c('.rh-cida-grana','font'),s),
    Number(c('.rh-cida-note','-webkit-line-clamp'))*lineBox(c('.rh-cida-note','font'),s));
  const list=box(c('.rh-cida-doces','padding'),s),pad=box(c('.rh .rh-cida-doce','padding'),s);
  const tagEdge=length(c('.rh .rh-cida-doce','border').split(' ')[0],s),inner=length(c('.rh .rh-cida-doce','gap'),s);
  const pe=Math.max(lineBox(c('.rh-cida-preco','font'),s),length(c('.rh-cida-cadeado .ic','height'),s));
  const nome=lines('.rh-cida-nome'),efeito=lines('.rh-cida-efeito');
  const tag=2*tagEdge+pad.top+nome*lineBox(c('.rh-cida-nome','font'),s)+inner+efeito*lineBox(c('.rh-cida-efeito','font'),s)+inner+pe+pad.bottom;
  const height=2*edge+win.top+head+length(c('.rh-cida','gap'),s)+list.top+tag+list.bottom+win.bottom;
  // The sides: 4 px, so at 360 px and 125% "menos dano" (88 px in its font) keeps the effect's second line whole.
  return {height,nome,efeito,sides:[c('.rh .rh-cida-doce','padding-left'),c('.rh .rh-cida-doce','padding-right')]};
}

for(const size of PORTRAITS)for(const scale of SCALES){
  const s:Screen={...size,scale},name=`portrait ${s.width}x${s.height} at ${scale*100}%`,hero=heroAt(s),thumbTop=thumbs(s);
  const span=(r:Rect)=>`y ${r.y.toFixed(1)}–${(r.y+r.height).toFixed(1)}, the hero's ${hero.y}–${hero.y+hero.height} ± ${HERO_MARGIN}`;
  test(`${name}: the forge sits on the thumbs, clear of the hero ± ${HERO_MARGIN} px`,()=>{
    const forge=windowAt('.rh-forge',CAMP,forgeBox(s).height,s),under=forge.y+forge.height;
    assert.ok(!crosses(forge,hero,HERO_MARGIN),`${name}: the window covers the hero (${span(forge)})`);
    // THUMB_GAP over the taller thumb, and no higher: the hero's room is the window's height budget.
    assert.ok(Math.abs(thumbTop-THUMB_GAP-under)<.01,`${name}: the window ends at ${under} px, the thumbs start at ${thumbTop}`);
  });
  test(`${name}: Dona Cida's tray sits on the thumbs, clear of the hero ± ${HERO_MARGIN} px`,()=>{
    const b=cidaBox(s),tray=windowAt('.rh-cida',CIDA,b.height,s),under=tray.y+tray.height;
    assert.ok(!crosses(tray,hero,HERO_MARGIN),`${name}: the tray covers the hero (${span(tray)})`);
    assert.ok(Math.abs(thumbTop-THUMB_GAP-under)<.01,`${name}: the tray ends at ${under} px, the thumbs start at ${thumbTop}`);
    assert.equal(b.efeito,2,'what a sweet does keeps 2 lines');
    assert.equal(b.nome,scale===1.25?1:2,'the name: 2 lines, 1 at 125% (whole in the aria-label)');
    assert.deepEqual(b.sides,['4px','4px']);
  });
}

test('portrait: a smaller tilt than the desktop\'s; the stamp waits for a purchase; the fall note is one line',()=>{
  for(const size of PORTRAITS)for(const scale of SCALES){
    const s:Screen={...size,scale};
    assert.ok(tilt(s)<1,`${tilt(s)}deg`);
    assert.equal(cascade('.rh-forge-stamp','display',s),'none');assert.equal(cascade('.rh-forge-done .rh-forge-stamp','display',s),'block');
    assert.equal(cascade('.rh-forge-fall .rh-window-fall-hint','display',s),'none');
    assert.equal(cascade('.rh-forge-fall','white-space',s),'nowrap');
    assert.equal(cascade('.rh-forge','max-height',s),'32svh');
  }
  // The desktop (no tap band) keeps its tilt; the landscape phone's band needs the smaller one too.
  assert.equal(tilt({width:1343,height:618,scale:1}),1);
  for(const size of SIZES.filter(z=>z.height<=500))assert.ok(tilt({...size,scale:1})<1);
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
      assert.equal(tag.querySelector('.rh-forge-desc'),null,'no long line on any screen (it is in the aria-label)');
      const price=forgePrice(id,view.camp!.forge);
      assert.equal(tag.querySelector('.rh-forge-cost')?.dataset.price,String(price));
      const label=tag.attrs['aria-label'];
      assert.ok(label.startsWith(`${RECIPES[id].name}: ${RECIPES[id].describe}. Custa ${forgePriceLabel(price).speech}.`),label);
    }
    assert.equal(forgePrice('gambiarra',view.camp!.forge),2*RECIPES.gambiarra.cost,'the second gambiarra costs double');
    part.destroy();
  }finally{if(before===undefined)delete g.document;else g.document=before;}
});
