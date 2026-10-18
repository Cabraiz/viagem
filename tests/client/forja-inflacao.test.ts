/**
 * Inflação in the HUD (D-048 balance): the forge tags show the price the room will charge now (rules forgePrice over
 * camp.forge), not the recipe's base: the second gambiarra reads 2× the base, the repair always its base, and the
 * refusal says what is missing at the inflated price. The window runs over a minimal fake DOM (no browser).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {blockedReason,createCamp,missing} from '../../src/client/hud/camp.ts';
import {forgePriceLabel,granaText} from '../../src/client/hud/price.ts';
import {FIXTURE_HERO,fakeView} from '../../src/client/hud/fixtures.ts';
import {RECIPES,RECIPE_IDS,forgePrice,type RecipeId} from '../../src/rules/index.ts';
import type {CampView,RunView} from '../../src/contract/view.ts';
import {CAR_ID} from '../../src/contract/index.ts';
import type {HudContext} from '../../src/client/hud/model.ts';
import {HUD_SWITCH} from '../../src/client/hud/arrows.ts';
// The forge window and its gathering hint are off in the game (arrows.ts, user 18/10); their code is tested switched on.
HUD_SWITCH.forge=true;

const G=RECIPES.gambiarra.cost,C=RECIPES['torre-chinelo'].cost,R=RECIPES.reparo.cost;

/** Just enough of an element for camp.ts: classes, data, attributes, children, markup kept as a string. */
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
  /** Only ".class" selectors (what the forge's render asks for). */
  querySelector(selector:string):FakeEl|null{
    const m=/^\.([\w-]+)$/.exec(selector);if(!m)return null;
    for(const c of this.children){if(c.classList.has(m[1]))return c;const deep=c.querySelector(selector);if(deep)return deep;}
    return null;
  }
  all(pred:(e:FakeEl)=>boolean):FakeEl[]{return this.children.flatMap(c=>[...(pred(c)?[c]:[]),...c.all(pred)]);}
}

function withDom<T>(run:()=>T):T{
  const g=globalThis as {document?:unknown};const before=g.document;
  g.document={createElement:(tag:string)=>new FakeEl(tag)};
  try{return run();}finally{if(before===undefined)delete g.document;else g.document=before;}
}

/** The forge window open in the camp (fixture camp-forge, hero at the forge) for `camp`; the price on each recipe tag. */
function tagPrices(camp:CampView){
  return withDom(()=>{
    const part=createCamp({onForge:()=>1});
    const view:RunView={...fakeView('camp-forge',1),camp};
    part.setHero(FIXTURE_HERO['camp-forge']);
    part.update(view,{localId:'p1'} as HudContext);
    const forge=part.forge as unknown as FakeEl;
    assert.equal(forge.hidden,false,'the forge window is open in the camp');
    const out={} as Record<RecipeId,{html:string;price:string;label:string}>;
    for(const id of RECIPE_IDS){
      const tag=forge.all(e=>e.classList.has('rh-forge-tag')&&e.dataset.recipe===id&&!e.hidden)[0];
      assert.ok(tag,id);
      const cost=tag.querySelector('.rh-forge-cost')!;
      out[id]={html:cost.innerHTML,price:cost.dataset.price,label:tag.attrs['aria-label']};
    }
    part.destroy();
    return out;
  });
}

test('the forge tags show the base before any purchase',()=>{
  const tags=tagPrices({units:0,grana:1000});
  for(const id of RECIPE_IDS){
    const base=RECIPES[id].cost;
    assert.equal(tags[id].html,forgePriceLabel(base).html,id);assert.equal(tags[id].price,String(base),id);
    assert.match(tags[id].label,new RegExp(`Custa ${forgePriceLabel(base).speech}\\.`),id);
  }
});

test('the forge tag price follows camp.forge: the second gambiarra shows 2× the base, the repair keeps its base',()=>{
  const tags=tagPrices({units:0,grana:1000,forge:{gambiarra:1,'torre-chinelo':2}});
  assert.equal(tags.gambiarra.html,forgePriceLabel(2*G).html);assert.equal(tags.gambiarra.price,String(2*G));
  assert.match(tags.gambiarra.label,new RegExp(`Custa ${forgePriceLabel(2*G).speech}\\.`),'spoken at the inflated price too');
  assert.equal(tags['torre-chinelo'].price,String(3*C),'the third chinelo at 3× its base');
  assert.equal(tags.reparo.price,String(R),'defence never inflates');
  assert.equal(tags.reparo.html,forgePriceLabel(R).html);
});

test('the tag locks and the refusal names the shortfall at the inflated price',()=>{
  const view=(camp:CampView)=>({...fakeView('camp-forge',1),camp});
  const bought={gambiarra:1};
  assert.equal(forgePrice('gambiarra',bought),2*G);
  assert.equal(blockedReason('gambiarra',view({units:0,grana:2*G-1,forge:bought}),'p1'),'balance','the base no longer pays it');
  assert.equal(blockedReason('gambiarra',view({units:0,grana:2*G,forge:bought}),'p1'),undefined,'exactly the inflated price');
  assert.equal(missing({grana:G,forge:bought},'gambiarra'),`Falta ${granaText(G)}.`);
  assert.equal(missing({grana:0,forge:{gambiarra:4}},'reparo'),`Falta ${granaText(R)}.`,'the repair at its base');
});

test('chaveiro mode (D-047): no wall in the view, the car stands at the base: the forge still opens there (E4\'s finding)',()=>{
  withDom(()=>{
    const part=createCamp({onForge:()=>1});
    const base=fakeView('camp-forge',1),wall=base.structures.find(s=>s.kind==='muralha')!;
    const view:RunView={...base,camp:{units:0,grana:1000},
      structures:[...base.structures.filter(s=>s.kind!=='muralha'),{id:CAR_ID,kind:CAR_ID,x:wall.x,y:wall.y,hp:120,maxHp:120}]};
    part.setHero(FIXTURE_HERO['camp-forge']);
    part.update(view,{localId:'p1'} as HudContext);
    assert.equal((part.forge as unknown as FakeEl).hidden,false,'the forge window opens at the car');
    part.destroy();
  });
});
