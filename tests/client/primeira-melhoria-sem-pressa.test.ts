/**
 * Card NEW-20261030-E4-primeira-melhoria-sem-pressa (auditoria primeira-partida-30-10 item 6): the run's first level-up
 * pause tells a new player what to do, "Toque numa carta · Rolar de novo troca as cartas" ("Clique…" on the desktop),
 * under the pause's line, while this phone still has a card to pick (the room gives that pause 15 s: tests/rooms). The later pauses keep today's box; a new run (rematch) shows it again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PAUSE_HINT_MOUSE,PAUSE_HINT_TOUCH,createPausePart,pauseHint,pauseView,type RunPause} from '../../src/client/hud/pausa.ts';
import type {HudContext} from '../../src/client/hud/model.ts';
import type {RunView} from '../../src/contract/index.ts';

class Txt {nodeType=3;nodeValue:string;constructor(v:string){this.nodeValue=v;}}
/** Just enough of an element for the part (the same fake as pausa-mede-depois-da-pintura). */
class El {
  className='';hidden=false;lang='';kids:(El|Txt)[]=[];attrs=new Map<string,string>();
  dataset:Record<string,string>={};style:Record<string,string>={};
  classes=new Set<string>();classList={contains:(c:string)=>this.classes.has(c)};
  append(...nodes:El[]){this.kids.push(...nodes);}
  setAttribute(k:string,v:string){this.attrs.set(k,v);}
  get firstChild(){return this.kids[0]??null;}
  get lastChild(){return this.kids.at(-1)??null;}
  get textContent():string{return this.kids.map(k=>k instanceof El?k.textContent:k.nodeValue).join('');}
  set textContent(v:string){this.kids=v?[new Txt(v)]:[];}
  getBoundingClientRect(){return {left:0,top:0,width:0,height:0};}
  get offsetWidth(){return 160;}
  get offsetHeight(){return 52;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
}

const scene=(hud?:'fone'|'mesa')=>{
  const created:El[]=[];
  const doc={createElement:()=>{const e=new El();created.push(e);return e;}} as unknown as Document;
  const root=new El(),offer=new El(),top=new El();
  if(hud)root.dataset.hud=hud;
  const part=createPausePart(doc,{root:root as unknown as HTMLElement,offer:offer as unknown as HTMLElement,top:top as unknown as HTMLElement,now:()=>0,schedule:()=>{}});
  const hint=created.find(e=>e.className.includes('rh-pausa-dica'))!;
  const players=[{id:'p1',name:'Mateus',online:true},{id:'p2',name:'Tia',online:true}];
  const at=(level:number,pause?:RunPause)=>part.update({players,team:{level}} as unknown as RunView,{localId:'p1',pause} as unknown as HudContext);
  return {part,root,hint,at};
};
const pause=(level:number,waiting=['p1','p2']):RunPause=>({leftMs:9000,totalMs:12000,level,waiting});

test('pauseHint: only the first pause, only while this phone picks; touch or mouse words',()=>{
  const roster=[{id:'p1',name:'Mateus'},{id:'p2',name:'Tia'}];
  const mine=pauseView(pause(2),roster,'p1',0),picked=pauseView(pause(2,['p2']),roster,'p1',0);
  assert.equal(pauseHint(mine,true,true),PAUSE_HINT_TOUCH);
  assert.equal(pauseHint(mine,true,false),PAUSE_HINT_MOUSE);
  assert.equal(PAUSE_HINT_TOUCH,'Toque numa carta · Rolar de novo troca as cartas');
  assert.equal(PAUSE_HINT_MOUSE,'Clique numa carta · Rolar de novo troca as cartas');
  assert.equal(pauseHint(mine,false,true),'','a later pause: no hint');
  assert.equal(pauseHint(picked,true,true),'','this phone already picked');
  assert.equal(pauseHint(undefined,true,true),'');
});

test('the first pause shows "Toque numa carta"; the next one does not',()=>{
  const {part,hint,at}=scene('fone');
  try{
    at(2,pause(2));assert.equal(hint.textContent,PAUSE_HINT_TOUCH);
    at(2,pause(2,['p2']));assert.equal(hint.textContent,'','gone once this phone picked');
    at(2,undefined);
    at(3,pause(3));assert.equal(hint.textContent,'','the second pause keeps today\'s box');
  }finally{part.destroy?.();}
});

test('the desktop says "Clique numa carta"',()=>{
  const {part,hint,at}=scene('mesa');
  try{at(2,pause(2));assert.equal(hint.textContent,PAUSE_HINT_MOUSE);}finally{part.destroy?.();}
});

test('a new run in the same HUD (rematch, or the team level back down) shows the hint again',()=>{
  const {part,root,hint,at}=scene();
  try{
    at(2,pause(2));at(2,undefined);at(3,pause(3));assert.equal(hint.textContent,'');
    at(3,undefined);
    root.classes.add('rh-ended');at(3,undefined);root.classes.delete('rh-ended');
    at(2,pause(2));assert.equal(hint.textContent,PAUSE_HINT_TOUCH,'after the result screen');
    at(2,undefined);at(4,pause(4));at(4,undefined);
    at(1,undefined);at(2,pause(2));assert.equal(hint.textContent,PAUSE_HINT_TOUCH,'the team level dropped: a new run');
  }finally{part.destroy?.();}
});
