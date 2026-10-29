/**
 * NEW-20261029-ORQ-celular-voltar-e-pinca (auditoria-controles-celular A, C, F): a step back in the match (iPhone edge
 * swipe, browser back, an Android Back the dialog's `cancel` can no longer stop) opens the gear and keeps the match's
 * history entry; the shell blocks the page's pinch zoom and the long-press menu; the gear says "Pausa" in the first match.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {GEAR_TAG_KEY,MATCH_ENTRY,gearTagSeen,guardBack,wantsGearTag,type BackHistory,type PopTarget} from '../../src/client/match-guard.ts';

/** A history stack: back() pops and fires popstate like a browser (here at once, the browser does it a task later). */
function fakeBrowser(start:unknown=null){
  const stack:unknown[]=[start],listeners:{fn:()=>void;signal:AbortSignal}[]=[];
  let backs=0;
  const pop=()=>{stack.pop();for(const l of listeners)if(!l.signal.aborted)l.fn();};
  const history:BackHistory={get state(){return stack.at(-1)??null;},pushState:data=>{stack.push(data);},back:()=>{backs++;pop();}};
  const target:PopTarget={addEventListener:(_type,fn,{signal})=>{listeners.push({fn,signal});}};
  return {history,target,stack,pop,get backs(){return backs;}};
}

test('opening the match pushes its entry and keeps what the state had',()=>{
  const b=fakeBrowser({tela:'lobby'}),abort=new AbortController();
  guardBack(b.history,b.target,()=>{},abort.signal);
  assert.equal(b.stack.length,2);
  assert.deepEqual(b.history.state,{tela:'lobby',[MATCH_ENTRY]:true});
});

test('each step back (swipe, browser back, second Android Back) opens the gear and the entry comes back',()=>{
  const b=fakeBrowser(),abort=new AbortController();let gear=0;
  guardBack(b.history,b.target,()=>gear++,abort.signal);
  for(let i=1;i<=3;i++){
    b.pop();
    assert.equal(gear,i,'the gear answers the step back');
    assert.equal(b.stack.length,2,'the page never leaves: the entry is on top again');
    assert.equal((b.history.state as Record<string,unknown>)[MATCH_ENTRY],true);
  }
});

test('a pop that still lands on the match entry (a post opened over it closing) leaves the gear alone',()=>{
  const b=fakeBrowser(),abort=new AbortController();let gear=0;
  guardBack(b.history,b.target,()=>gear++,abort.signal);
  b.history.pushState({...(b.history.state as object),instaPost:true},'');
  b.pop();
  assert.equal(gear,0);assert.equal(b.stack.length,2);
});

test('closing the match: no more gear, and its entry goes away only if it is still on top',()=>{
  const b=fakeBrowser(),abort=new AbortController();let gear=0;
  const release=guardBack(b.history,b.target,()=>gear++,abort.signal);
  abort.abort();release();
  assert.equal(b.backs,1);assert.equal(b.stack.length,1);assert.equal(gear,0,'the step back of the release is not a Back');
  // Already gone (the page moved on): nothing to take away.
  const c=fakeBrowser(),other=new AbortController();
  const releaseC=guardBack(c.history,c.target,()=>{},other.signal);
  other.abort();c.history.pushState({tela:'outra'},'');releaseC();
  assert.equal(c.backs,0);
});

test('the gear\'s "Pausa" tag: until the first match ends, and a broken storage still shows it',()=>{
  const map=new Map<string,string>(),store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
  assert.equal(wantsGearTag(store),true);
  gearTagSeen(store);
  assert.equal(map.get(GEAR_TAG_KEY),'1');assert.equal(wantsGearTag(store),false);
  const broken={getItem:()=>{throw new Error('private');},setItem:()=>{throw new Error('quota');}};
  assert.equal(wantsGearTag(broken),true);assert.doesNotThrow(()=>gearTagSeen(broken));
});

type Decl={selector:string;prop:string;value:string};
const EXPLORE=declarations(readFileSync(new URL('../../src/client/explore.css',import.meta.url),'utf8')) as Decl[];
const SOURCE=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');

test('explore.css: the whole shell takes the touch (no page pinch zoom), the tag hangs under the gear',()=>{
  const shell=EXPLORE.filter(d=>d.selector==='.explore-shell'&&d.prop==='touch-action').at(-1);
  assert.equal(shell?.value,'none');
  const top=EXPLORE.filter(d=>d.selector==='.explore-config-tag'&&d.prop==='top').at(-1);
  assert.equal(top?.value,'calc(100% + 4px)');
});

test('explore.ts wires the guard, the long-press block and the tag',()=>{
  assert.match(SOURCE,/releaseBack=guardBack\(history,window,/);
  assert.match(SOURCE,/abort\.abort\(\);releaseBack\(\);gearTagSeen\(\);/,'closing aborts the listener before taking the entry away');
  assert.match(SOURCE,/shell\.addEventListener\('contextmenu',e=>e\.preventDefault\(\),\{signal\}\)/);
  assert.match(SOURCE,/shell\.addEventListener\('close',\(\)=>\{if\(closed\)return;shell\.showModal\(\);openSettings\(\);\}/);
  assert.match(SOURCE,/wantsGearTag\(\)\?'<span class="explore-config-tag" aria-hidden="true">Pausa<\/span>'/);
});
