/**
 * NEW-20261021-E5-q1-hud-sem-escrita-repetida: the HUD writes to the DOM only what changed (hud/dom-put.ts). A second
 * frame with the same view must not touch the DOM: a write of the same value still queues a mutation and invalidates
 * the style (5.4 s of style recalculation in 40 s of walking on a 4× phone). The parts run over a fake DOM that counts
 * every write the browser would turn into a mutation record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {putAttr,putData,putHidden,putText,turnMoved} from '../../src/client/hud/dom-put.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';
import type {HudContext} from '../../src/client/hud/model.ts';
import type {RunView} from '../../src/contract/index.ts';

/** Every write a MutationObserver would see, as `<class> <what>`. */
const writes:string[]=[];
const note=(el:FakeEl,what:string)=>writes.push(`${el.className||el.tagName} ${what}`);

class FakeEl {
  readonly tagName:string;children:FakeEl[]=[];parentElement:FakeEl|null=null;
  private attrs=new Map<string,string>();private text='';private html='';
  type='';disabled=false;alt='';decoding='';draggable=false;src='';lang='';value='';
  offsetWidth=0;offsetHeight=0;isConnected=false;
  constructor(tag:string){this.tagName=tag.toUpperCase();}
  get className(){return this.attrs.get('class')??'';}
  set className(v:string){this.attrs.set('class',v);note(this,'@class');}
  get hidden(){return this.attrs.has('hidden');}
  set hidden(v:boolean){if(v)this.attrs.set('hidden','');else this.attrs.delete('hidden');note(this,'@hidden');}
  get textContent():string{return this.text+this.children.map(c=>c.textContent).join('');}
  set textContent(v:string){this.text=v;this.children=[];note(this,'text');}
  get innerHTML(){return this.html;}
  set innerHTML(v:string){this.html=v;this.children=[];this.parse(v);note(this,'html');}
  insertAdjacentHTML(_where:string,html:string){this.html+=html;this.parse(html);note(this,'html');}
  /** The markup's tags as flat children (enough for the HUD's querySelector of its own markup). */
  private parse(html:string){
    for(const m of html.matchAll(/<([a-z][\w-]*)([^>]*)>/g)){
      const c=new FakeEl(m[1]),cls=/class="([^"]*)"/.exec(m[2]);
      if(cls)c.attrs.set('class',cls[1]);if(/\shidden(\s|$|>)/.test(m[2]))c.attrs.set('hidden','');
      c.parentElement=this;this.children.push(c);
    }
  }
  getAttribute(k:string){return this.attrs.get(k)??null;}
  hasAttribute(k:string){return this.attrs.has(k);}
  setAttribute(k:string,v:string){this.attrs.set(k,String(v));note(this,`@${k}`);}
  removeAttribute(k:string){if(this.attrs.delete(k))note(this,`@${k}`);}
  toggleAttribute(k:string,on?:boolean){const want=on??!this.attrs.has(k);if(want!==this.attrs.has(k)){if(want)this.attrs.set(k,'');else this.attrs.delete(k);note(this,`@${k}`);}return want;}
  dataset=new Proxy({} as Record<string,string>,{
    get:(_t,k)=>typeof k==='string'?this.attrs.get(dataAttr(k)):undefined,
    set:(_t,k,v)=>{this.setAttribute(dataAttr(String(k)),String(v));return true;},
    deleteProperty:(_t,k)=>{this.removeAttribute(dataAttr(String(k)));return true;},
    has:(_t,k)=>typeof k==='string'&&this.attrs.has(dataAttr(k)),
  });
  /** Class changes only when the set changes (DOMTokenList does not write an unchanged list). */
  classList={
    contains:(c:string)=>this.className.split(/\s+/).includes(c),
    add:(...cs:string[])=>{for(const c of cs)if(!this.classList.contains(c))this.className=`${this.className} ${c}`.trim();},
    remove:(...cs:string[])=>{for(const c of cs)if(this.classList.contains(c))this.className=this.className.split(/\s+/).filter(x=>x!==c).join(' ');},
    toggle:(c:string,on?:boolean)=>{const want=on??!this.classList.contains(c);if(want)this.classList.add(c);else this.classList.remove(c);return want;},
  };
  /** CSSOM: setting a property to its current value is no mutation. */
  style=new Proxy({props:new Map<string,string>()} as unknown as Record<string,unknown>,{
    get:(t,k)=>{
      const props=(t as unknown as {props:Map<string,string>}).props;
      if(k==='setProperty')return (name:string,v:string)=>{if(props.get(name)!==v){props.set(name,v);note(this,`style ${name}`);}};
      if(k==='removeProperty')return (name:string)=>{if(props.delete(name))note(this,`style ${name}`);};
      if(k==='getPropertyValue')return (name:string)=>props.get(name)??'';
      return typeof k==='string'?props.get(k)??'':undefined;
    },
    set:(t,k,v)=>{const props=(t as unknown as {props:Map<string,string>}).props;if(props.get(String(k))!==v){props.set(String(k),String(v));note(this,`style ${String(k)}`);}return true;},
  });
  append(...nodes:(FakeEl|string)[]){for(const n of nodes){if(typeof n==='string'){this.text+=n;continue;}n.remove();n.parentElement=this;this.children.push(n);}}
  appendChild(n:FakeEl){this.append(n);return n;}
  prepend(...nodes:FakeEl[]){for(const n of nodes.reverse()){n.remove();n.parentElement=this;this.children.unshift(n);}}
  insertBefore(n:FakeEl,ref:FakeEl|null){n.remove();n.parentElement=this;const i=ref?this.children.indexOf(ref):-1;if(i<0)this.children.push(n);else this.children.splice(i,0,n);return n;}
  replaceChildren(...nodes:FakeEl[]){if(this.children.length||nodes.length)note(this,'children');for(const c of this.children)c.parentElement=null;this.children=[];this.append(...nodes);}
  remove(){const p=this.parentElement;if(p)p.children=p.children.filter(c=>c!==this);this.parentElement=null;}
  before(){}after(){}
  addEventListener(){}removeEventListener(){}focus(){}blur(){}animate(){return {cancel(){},finished:Promise.resolve()};}
  getBoundingClientRect(){return {left:0,top:0,width:0,height:0,right:0,bottom:0,x:0,y:0};}
  contains(o:FakeEl|null){for(let n=o;n;n=n.parentElement)if(n===this)return true;return false;}
  closest(){return null;}
  /** Enough of a selector for the HUD: each comma part's last compound (tag, .classes, [attr], :not([hidden])). */
  querySelectorAll(selector:string):FakeEl[]{
    const tests=selector.split(',').map(part=>compound(part.trim().split(/\s+|>/).filter(Boolean).at(-1)!));
    const out:FakeEl[]=[];
    const walk=(el:FakeEl)=>{for(const c of el.children){if(tests.some(t=>t(c)))out.push(c);walk(c);}};
    walk(this);return out;
  }
  querySelector(selector:string){return this.querySelectorAll(selector)[0]??null;}
  get firstElementChild(){return this.children[0]??null;}
  get lastElementChild(){return this.children.at(-1)??null;}
}
function compound(sel:string):(el:FakeEl)=>boolean{
  const visible=sel.includes(':not([hidden])');sel=sel.replace(':not([hidden])','');
  const attrs=[...sel.matchAll(/\[([\w-]+)\]/g)].map(m=>m[1]);sel=sel.replace(/\[[^\]]*\]/g,'');
  const [tag,...classes]=sel.split('.');
  return el=>(!tag||el.tagName===tag.toUpperCase())&&classes.every(c=>el.classList.contains(c))&&attrs.every(a=>el.hasAttribute(a))&&(!visible||!el.hidden);
}
const dataAttr=(key:string)=>`data-${key.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`)}`;
const fakeDoc={createElement:(tag:string)=>new FakeEl(tag),createTextNode:(t:string)=>{const n=new FakeEl('#text');n.append(t);return n;},
  addEventListener(){},removeEventListener(){},body:new FakeEl('body'),documentElement:new FakeEl('html')};

test('the dom-put helpers write only a changed value (same value: no write at all)',()=>{
  const el=new FakeEl('div');writes.length=0;
  const e=el as unknown as HTMLElement;
  putText(e,'R$ 12');putHidden(e,true);putAttr(e,'aria-valuenow','40');putData(e,'count','3');
  assert.equal(writes.length,4);
  putText(e,'R$ 12');putHidden(e,true);putAttr(e,'aria-valuenow','40');putData(e,'count','3');
  assert.equal(writes.length,4,writes.join(', '));
  putHidden(e,false);putData(e,'count','4');putText(e,'R$ 13');
  assert.deepEqual(writes.slice(4),['DIV @hidden','DIV @data-count','DIV text']);
  assert.equal(el.getAttribute('data-count'),'4');
});

test('an arrow turns only for a turn the eye sees (2°), across 0°/360°',()=>{
  assert.equal(turnMoved(undefined,90),true);
  assert.equal(turnMoved(90,91),false);
  assert.equal(turnMoved(90,92),true);
  assert.equal(turnMoved(359,1),true);
  assert.equal(turnMoved(359,360),false);
  assert.equal(turnMoved(180,-180),false);
});

test('the HUD parts the study measured, frames of the same view: once settled, a frame writes nothing to the DOM',async t=>{
  const real=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:fakeDoc,configurable:true,writable:true});
  t.after(()=>{if(real)Object.defineProperty(globalThis,'document',real);else delete (globalThis as {document?:unknown}).document;});
  const {createCamp}=await import('../../src/client/hud/camp.ts');
  const {createTeamStrip,createReviveAlerts}=await import('../../src/client/hud/team.ts');
  const {createTopBar}=await import('../../src/client/hud/topbar.ts');
  const {createOfferPanel}=await import('../../src/client/hud/offer.ts');
  const {createInventory}=await import('../../src/client/hud/inventory.ts');
  const {createObjectiveRow}=await import('../../src/client/hud/city/objective.ts');
  const doc=fakeDoc as unknown as Document;
  const ctx={localId:'p1',portrait:()=>'',tally:{causes:new Map()},critterIcon:()=>undefined} as unknown as HudContext;
  const camp=createCamp({onForge:()=>undefined});
  const parts=[camp,createTeamStrip(),createReviveAlerts(),createTopBar(),createOfferPanel({onChoose(){}}),createInventory({onCommand:()=>true},doc)];
  const objective=createObjectiveRow(doc,()=>0);
  for(const scenario of ['wave','camp-horn','offer-open','boss'] as const){
    const view:RunView=fakeView(scenario,4);
    camp.setHero({x:30,y:30,bearing:40});
    const frame=(v:RunView)=>{for(const p of parts)p.update(v,ctx);objective.render({meters:120,bearing:40.2});};
    // Two frames to settle (a teammate's colour is written the frame after their portrait is made).
    frame(view);frame(structuredClone(view));
    writes.length=0;
    frame(structuredClone(view));
    assert.deepEqual(writes,[],`${scenario}: a frame with nothing new wrote ${writes.length} times`);
    // A real change still reaches the DOM (the wall loses life: its number and its bar).
    const hurt=structuredClone(view);hurt.structures=hurt.structures.map(s=>s.kind==='muralha'?{...s,hp:s.hp-60}:s);
    frame(hurt);
    assert.ok(writes.some(w=>w.startsWith('rh-camp-hp ')),`${scenario}: the wall's number follows its life (${writes.join(', ')})`);
  }
  // The objective's arrow: a sub-2° drift is no write, a real turn is one transform write.
  writes.length=0;objective.render({meters:120,bearing:41});
  assert.deepEqual(writes,[]);
  objective.render({meters:120,bearing:70});
  assert.deepEqual(writes,['rh-objetivo-arrow style transform']);
});
