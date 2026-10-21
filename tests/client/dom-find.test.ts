/**
 * NEW-20261021-ORQ-q6-micro-render: the exploration's per-frame lookups (hud/dom-find.ts) give the answers of the
 * selectors they replace, without querying the page again while the element is still there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firstShown,shownHolds,stickyQuery} from '../../src/client/hud/dom-find.ts';

/** An element at a page position (`at`), with a hidden attribute and children of some classes. */
class El {
  isConnected=true;readonly at:number;hidden:boolean;readonly inner:string[];
  constructor(at:number,hidden=false,inner:string[]=[]){this.at=at;this.hidden=hidden;this.inner=inner;}
  hasAttribute(name:string){return name==='hidden'&&this.hidden;}
  /** DOCUMENT_POSITION_PRECEDING (2) when `other` comes first in the page, FOLLOWING (4) otherwise. */
  compareDocumentPosition(other:El){return other.at<this.at?2:4;}
  getElementsByClassName(name:string){return this.inner.filter(c=>c===name);}
}

test('stickyQuery: one query per selector while the element stays in the page, a new one once it leaves', ()=>{
  const queries:string[]=[];let current=new El(1);
  const find=stickyQuery({querySelector:s=>{queries.push(s);return current as unknown as Element;}});
  const first=find('#coop-health');
  for(let i=0;i<60;i++)assert.equal(find('#coop-health'),first);
  assert.deepEqual(queries,['#coop-health']);
  current.isConnected=false;current=new El(2);
  assert.equal(find('#coop-health'),current as unknown as Element);
  assert.equal(queries.length,2);
});

test('stickyQuery: a selector that found nothing asks again on the next call', ()=>{
  let calls=0;const find=stickyQuery({querySelector:()=>{calls++;return null;}});
  assert.equal(find('.coop-party'),null);assert.equal(find('.coop-party'),null);
  assert.equal(calls,2);
});

test('firstShown: the first shown element in page order, as .rh-forge:not([hidden]),.rh-cida:not([hidden])', ()=>{
  const forge=new El(5,true),cida=new El(9,true);
  assert.equal(firstShown([[forge],[cida]]),null);
  cida.hidden=false;assert.equal(firstShown([[forge],[cida]]),cida);
  forge.hidden=false;assert.equal(firstShown([[forge],[cida]]),forge);
  // Page order wins over the order of the lists.
  assert.equal(firstShown([[cida],[forge]]),forge);
  // Within one list, the first one not hidden.
  const a=new El(1,true),b=new El(2),c=new El(3);
  assert.equal(firstShown([[a,b,c]]),b);
});

test('shownHolds: a shown .rh-obra with a .rh-obra-janela inside', ()=>{
  const closed=new El(1,true,['rh-obra-janela']),empty=new El(2,false,[]);
  assert.equal(shownHolds([closed,empty],'rh-obra-janela'),false);
  const open=new El(3,false,['rh-obra-janela']);
  assert.equal(shownHolds([closed,empty,open],'rh-obra-janela'),true);
});

test('explore.ts: the position callback walks no :not([hidden]) selector over the page in combat', ()=>{
  const source=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  const start=source.indexOf('position:p=>{'),end=source.indexOf('discovered:i=>');
  assert.ok(start>0&&end>start);
  const block=source.slice(start,end);
  assert.doesNotMatch(block,/rh-forge:not\(\[hidden\]\)|rh-obra:not\(\[hidden\]\)/);
  // The template's elements come from the sticky lookup, not a fresh querySelector each frame.
  assert.doesNotMatch(block,/\$(<[^>]+>)?\('(#coop-health|#coop-attack|#coop-objective|#coop-diagnostics|\.explore-layout)'\)/);
});
