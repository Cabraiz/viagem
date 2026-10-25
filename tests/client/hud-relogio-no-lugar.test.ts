/**
 * BUG-20261025-ORQ-celular-travando: the HUD's clocks change their number in place (dom-put.ts putTextData /
 * putIconNumber). A node inserted every second made Chrome check the page's :has() rules up to <html> and restyle the
 * whole document, the menu under the match included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {putIconNumber,putTextData} from '../../src/client/hud/dom-put.ts';

/** Just enough DOM: one text node child, innerHTML that builds `<b>` with an empty text node, counted rebuilds. */
class Txt {nodeType=3;nodeValue:string;constructor(v:string){this.nodeValue=v;}}
class El {
  tagName:string;kids:(El|Txt)[]=[];builds=0;
  constructor(tag='span'){this.tagName=tag.toUpperCase();}
  get firstChild(){return this.kids[0]??null;}
  get lastChild(){return this.kids.at(-1)??null;}
  get lastElementChild(){return [...this.kids].reverse().find(k=>k instanceof El)??null;}
  get textContent():string{return this.kids.map(k=>k instanceof El?k.textContent:k.nodeValue).join('');}
  set textContent(v:string){this.kids=v?[new Txt(v)]:[];}
  set innerHTML(html:string){this.builds++;const b=new El('b');b.kids=[new Txt(/<b>(.*)<\/b>/.exec(html)?.[1]??'')];this.kids=html.includes('<img')?[new El('img'),b]:[b];}
}

test('putTextData changes the text node\'s data, never the node',()=>{
  const el=new El();el.textContent='0:10';const node=el.firstChild;
  putTextData(el as unknown as Node,'0:09');
  assert.equal(el.firstChild,node);assert.equal(el.textContent,'0:09');
});

test('putIconNumber rebuilds only when the icon changes',()=>{
  const host=new El();
  putIconNumber(host as unknown as HTMLElement,'<img a>','1:00');
  const b=host.lastElementChild,txt=(b as El).firstChild;
  putIconNumber(host as unknown as HTMLElement,'<img a>','0:59');
  putIconNumber(host as unknown as HTMLElement,'<img a>','0:58');
  assert.equal(host.builds,1);assert.equal(host.lastElementChild,b);assert.equal((b as El).firstChild,txt);
  assert.equal(host.textContent,'0:58');
  putIconNumber(host as unknown as HTMLElement,'<img b>','0:57');
  assert.equal(host.builds,2);assert.equal(host.textContent,'0:57');
});

test('the top band\'s clocks use them (no innerHTML per second)',()=>{
  const top=readFileSync(new URL('../../src/client/hud/topbar.ts',import.meta.url),'utf8');
  const camp=readFileSync(new URL('../../src/client/hud/camp.ts',import.meta.url),'utf8');
  assert.match(top,/putIconNumber\(eta\.lastElementChild/);
  assert.match(top,/putIconNumber\(detail\.lastElementChild/);
  assert.match(camp,/putIconNumber\(clockPicture,icon\(bar\.icon\),bar\.text\)/);
  assert.doesNotMatch(top+camp,/<b>\$\{(clock\.clock|bar\.text)\}<\/b>/);
});
