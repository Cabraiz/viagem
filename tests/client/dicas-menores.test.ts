/**
 * BUG-20261013-ORQ-oferta-e-dicas-menores: the hints and toasts of the match are one line at about half their old
 * height (13 px text, never under 11 px), cut with an ellipsis, in the announcement slot (under the top band, off the
 * screen's middle) and gone on their own. "Vai pra praça!" shows its line for OBJECTIVE_FULL_MS on screen, then folds
 * to the distance and the arrow (and goes while there is no arrow).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {OBJECTIVE_FULL_MS,createObjectiveRow} from '../../src/client/hud/city/objective.ts';

type Decl={selector:string;prop:string;value:string};
const read=(file:string)=>declarations(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8')) as Decl[];
const HUD=read('src/client/hud/hud.css'),EXPLORE=read('src/client/explore.css'),OBRA=read('src/client/hud/towers/obra.css');
const value=(decls:Decl[],selector:string,prop:string)=>{
  const found=decls.filter(d=>d.selector===selector&&d.prop===prop).at(-1);
  assert.ok(found,`${selector} { ${prop} }`);return found.value;
};
/** Font size in px at 100% from a font shorthand or size (tokens --t-N = N px). */
const fontPx=(v:string)=>{const m=v.match(/var\(--t-(\d+)\)|(\d+(?:\.\d+)?)px/);assert.ok(m,v);return Number(m[1]??m[2]);};

test('hints: one line, cut with an ellipsis, 13 px text, small stickers',()=>{
  for(const row of ['.rh-coach','.rh-objetivo','.rh-marquee'])assert.equal(value(HUD,row,'white-space'),'nowrap',`${row}: one line`);
  for(const text of ['.rh-coach-text','.rh-objetivo-text','.rh-marquee-sub'])
    assert.equal(value(HUD,text,'text-overflow'),'ellipsis',`${text}: cut, never wrapped`);
  // The banner's title is never cut (BUG-20261023-ORQ-resultado-paisagem-e-125): whole, or two lines past the banner's
  // width; the subtitle then fits by words in topbar.ts (whole, the modifier's name, or gone), so its ellipsis is a net.
  assert.ok(!HUD.some(d=>d.selector==='.rh-marquee-title'&&d.prop==='text-overflow'),'.rh-marquee-title: no ellipsis');
  assert.equal(value(HUD,'.rh-marquee-title','max-width'),'100%');
  for(const [sel,prop] of [['.rh-coach-text','font'],['.rh-objetivo-text','font'],['.rh-marquee-title','font'],['.rh-marquee-sub','font']] as const){
    const size=fontPx(value(HUD,sel,prop));assert.ok(size>=11&&size<=16,`${sel}: ${size} px`);
  }
  // The second lines go (the line is the whole hint).
  assert.equal(value(HUD,'.rh-coach-sub','display'),'none');
  assert.equal(value(HUD,'.rh-objetivo-sub','display'),'none');
  for(const mark of ['.rh-coach-mark','.rh-objetivo-mark,.rh-objetivo-arrow'])assert.equal(value(HUD,mark,'height'),'18px');
  // The tower works notice and the economy toast: one thin line too; "Desligar" keeps a 44 px target.
  assert.equal(value(OBRA,'.rh-obra-aviso','white-space'),'nowrap');
  assert.equal(value(OBRA,'.rh-obra-aviso','padding'),'1px 10px');
  assert.equal(value(EXPLORE,'.economy-toast','white-space'),'nowrap');
  assert.equal(value(EXPLORE,'.economy-toast-text','text-overflow'),'ellipsis');
  assert.equal(value(EXPLORE,'.economy-toast-off','min-height'),'24px');
  assert.equal(value(EXPLORE,'.economy-toast-off::before','inset'),'-10px 0','24 + 2 x 10 = 44 px of target');
});

test('hints: about half the old height (border, padding, one 13 px line, 18 px sticker)',()=>{
  // Old: coach 2 + 5 + (16 + 13) x 1.2 + 6 + 2 = 49.8 px; objective 2 + 5 + 34.8 + 6 + 2 = 49.8; marquee 57 (measured).
  const pad=(v:string)=>{const p=v.split(/\s+/).map(s=>parseFloat(s));return p[0]+(p[2]??p[0]);};
  const coach=4+pad(value(HUD,'.rh-coach','padding'))+Math.max(18,13*1.2);
  const objetivo=4+pad(value(HUD,'.rh-objetivo','padding'))+Math.max(18,16*1.1);
  const marquee=4+pad(value(HUD,'.rh-marquee','padding'))+16*1.15;
  assert.ok(coach<=49.8*.55,`coach ${coach.toFixed(1)} px`);
  assert.ok(objetivo<=49.8*.55,`objective ${objetivo.toFixed(1)} px`);
  assert.ok(marquee<=57*.55,`marquee ${marquee.toFixed(1)} px`);
  // The banner keeps its in-place exit (marquee-saida): it still scales about its top edge.
  assert.equal(value(HUD,'.rh-marquee','transform-origin'),'50% 0');
});

/** Just enough of a DOM for the objective row. */
function fakeDoc(){
  const make=(tag:string):any=>{
    const node:any={tagName:tag,className:'',hidden:false,textContent:'',lang:'',children:[] as any[],dataset:{} as Record<string,string>,attrs:{} as Record<string,string>,
      style:{props:{} as Record<string,string>,setProperty(k:string,v:string){this.props[k]=v;}},
      classList:{set:new Set<string>(),add(c:string){this.set.add(c);},contains(c:string){return this.set.has(c);}},
      append(...c:any[]){node.children.push(...c);},setAttribute(k:string,v:string){node.attrs[k]=v;},insertAdjacentHTML(){}};
    return node;
  };
  return {createElement:make} as unknown as Document;
}

test('"Vai pra praça!" shows its line for OBJECTIVE_FULL_MS on screen, then only the distance and the arrow',()=>{
  let t=0;
  const row=createObjectiveRow(fakeDoc(),()=>t);
  const el=row.el as any;
  assert.equal(OBJECTIVE_FULL_MS,3000);
  const go={meters:72,bearing:90} as any;
  assert.equal(row.render(go),true,'shown');assert.equal(el.hidden,false);assert.equal(el.dataset.compact,undefined);
  t=1500;assert.equal(row.render(go),false);
  // Out of the slot for a while (a notice): that time does not count.
  t=1600;assert.equal(row.render(undefined),true);assert.equal(el.hidden,true);
  t=9000;assert.equal(row.render(go),true);assert.equal(el.dataset.compact,undefined,'1.6 s seen so far');
  t=10300;row.render(go);assert.equal(el.dataset.compact,undefined,'2.9 s');
  t=10400;assert.equal(row.render(go),true,'the row changed size: the slot lays out again');
  assert.equal(el.dataset.compact,'true');assert.ok(el.classList.contains('rh-objetivo-compact'));assert.equal(el.hidden,false);
  // Folded, with no arrow (bearing unknown) there is nothing to show: it goes, and comes back with the arrow.
  t=11000;assert.equal(row.render({meters:60} as any),true);assert.equal(el.hidden,true);
  t=11100;assert.equal(row.render({meters:58,bearing:80} as any),true);assert.equal(el.hidden,false);assert.equal(el.dataset.compact,'true');
});
