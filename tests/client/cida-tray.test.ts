/**
 * Dona Cida's tray (D-047, card chaveiro-hud, review of 8953916): the desktop keys inside the game's modal shell, one
 * purchase at a time (pending, the room's answer, the 3 s give-up), closing by itself, and never open with the obra window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {ObjectiveView} from '../../src/contract/objective.ts';
import {cidaKeyOf,hotkeyOf,SHELL_DIALOG} from '../../src/client/desktop-input.ts';
import {CIDA_DEFAULT_NOTE,CIDA_OFFLINE_NOTE,CIDA_PENDING_NOTE,CIDA_TIMEOUT_NOTE,CidaTray,type CidaInput} from '../../src/client/hud/cida-state.ts';

/** A key target inside these ancestors (outermost first); closest() answers the one selector cidaKeyOf asks. */
type Ancestor={tag:string;open?:boolean;cls?:string};
function inside(ancestors:Ancestor[],tagName='CANVAS'){
  return {tagName,closest(selector:string){
    assert.equal(selector,`dialog[open]:not(${SHELL_DIALOG})`);
    return [...ancestors].reverse().find(a=>a.tag==='dialog'&&a.open&&a.cls!=='explore-shell')??null;
  }};
}
const shell:Ancestor={tag:'dialog',open:true,cls:'explore-shell'};

test('Cida keys inside the match: the shell is a modal dialog and never blocks them; another dialog or a field does',()=>{
  const canvas=inside([shell]);
  assert.deepEqual(cidaKeyOf({code:'KeyC',key:'c',target:canvas},false),{kind:'toggle'});
  assert.deepEqual(cidaKeyOf({code:'KeyC',key:'C',target:canvas},false),{kind:'toggle'},'Shift/Caps C too');
  assert.deepEqual(cidaKeyOf({code:'Digit1',key:'1',target:canvas},false),{kind:'buy',index:0});
  assert.deepEqual(cidaKeyOf({code:'Numpad3',key:'3',target:canvas},false),{kind:'buy',index:2});
  assert.equal(cidaKeyOf({code:'Digit4',key:'4',target:canvas},false),undefined);
  assert.deepEqual(cidaKeyOf({code:'Escape',key:'Escape',target:canvas},false),{kind:'close'});
  // The layout's letter: on a layout where KeyC types another letter, that key is not C (like Q/E/T).
  assert.equal(cidaKeyOf({code:'KeyC',key:'j',target:canvas},false),undefined);
  assert.deepEqual(cidaKeyOf({code:'KeyC',target:canvas},false),{kind:'toggle'},'no letter: by the code');
  // The settings dialog (inside the shell) keeps every key: from a target inside it, or open while focus is elsewhere.
  const settings=inside([shell,{tag:'dialog',open:true,cls:'explore-settings'}],'BUTTON');
  for(const code of ['KeyC','Digit1','Escape'])assert.equal(cidaKeyOf({code,key:code==='KeyC'?'c':code==='Digit1'?'1':'Escape',target:settings},false),undefined,code);
  assert.equal(cidaKeyOf({code:'KeyC',key:'c',target:canvas},true),undefined);
  // A closed dialog around the target does not block.
  assert.deepEqual(cidaKeyOf({code:'KeyC',key:'c',target:inside([shell,{tag:'dialog',open:false,cls:'x'}])},false),{kind:'toggle'});
  // Typing, a repeat, a modifier (browser shortcuts: Ctrl+C!) keep the key for the page.
  for(const tagName of ['INPUT','TEXTAREA','SELECT'])assert.equal(cidaKeyOf({code:'KeyC',key:'c',target:inside([shell],tagName)},false),undefined,tagName);
  assert.equal(cidaKeyOf({code:'KeyC',key:'c',target:{tagName:'DIV',isContentEditable:true}},false),undefined);
  assert.equal(cidaKeyOf({code:'KeyC',key:'c',target:canvas,repeat:true},false),undefined);
  assert.equal(cidaKeyOf({code:'KeyC',key:'c',target:canvas,ctrlKey:true},false),undefined);
  assert.equal(cidaKeyOf({code:'KeyC',key:'c',target:canvas,metaKey:true},false),undefined);
  // C is not one of the game's hotkeys (no clash with Q/E/Space/T).
  assert.equal(hotkeyOf({code:'KeyC',key:'c',target:canvas},false),undefined);
});

const objective=(over:Partial<ObjectiveView>={}):ObjectiveView=>({kind:'chaveiro',moto:{x:10,y:10,mode:'lombada'},route:[],stops:[],etaS:300,alarmUntil:0,
  grana:20,budget:120,stock:[4,1,0],car:{x:0,y:0,hits:0,limit:120,parts:0},...over});
const by=(over:Partial<CidaInput>={}):CidaInput=>({view:{objective:objective()},standing:true,hero:{x:11,y:11},offerOpen:false,ended:false,...over});

test('the tray: opens by the moto, a blocked sweet says why, one purchase waits for the room, LEVEI or the reason',()=>{
  const tray=new CidaTray();
  tray.sync(by({hero:{x:20,y:20}}));
  assert.equal(tray.shown,false);assert.equal(tray.toggle(),false,'away from the moto: C does nothing');
  tray.sync(by());
  assert.equal(tray.shown,true);assert.equal(tray.toggle(),true);assert.equal(tray.open,true);
  assert.deepEqual(tray.tap('pacoca',()=>{throw new Error('a blocked sweet never reaches the room');}),{text:'Falta R$ 5.',keep:false});
  assert.deepEqual(tray.tap('cocada',()=>{throw new Error('out of stock');}),{text:'Acabou esse doce.',keep:false});
  assert.deepEqual(tray.tap('brigadeiro',()=>undefined),{text:CIDA_OFFLINE_NOTE,keep:false},'no room: says so, nothing pending');
  assert.equal(tray.pending,undefined);
  const sent:string[]=[];
  assert.deepEqual(tray.tap('brigadeiro',item=>{sent.push(item);return 7;}),{text:CIDA_PENDING_NOTE,keep:true});
  assert.deepEqual(tray.pending,{req:7,item:'brigadeiro',name:'Brigadeiro de Panela'});
  assert.equal(tray.tap('brigadeiro',item=>{sent.push(item);return 8;}),undefined,'one at a time');
  assert.deepEqual(sent,['brigadeiro']);
  tray.resetNote();assert.equal(tray.note,CIDA_PENDING_NOTE,'the pending line stays until the answer');
  assert.equal(tray.reply({req:6,item:'brigadeiro',ok:true}),undefined,'another request\'s answer');
  const ok=tray.reply({req:7,item:'brigadeiro',ok:true,grana:5});
  assert.deepEqual(ok,{note:{text:'Brigadeiro na mão!',keep:false},stamp:'brigadeiro'});
  assert.equal(tray.pending,undefined);
  tray.resetNote();assert.equal(tray.note,CIDA_DEFAULT_NOTE);
  // A refusal from the room (someone else bought the last one first).
  tray.tap('brigadeiro',()=>9);
  assert.deepEqual(tray.reply({req:9,item:'brigadeiro',ok:false,reason:'stock'}),{note:{text:'Acabou esse doce.',keep:false}});
  // A resend the room already handled: the pending line goes back to the default (review: it stuck on "Embrulhando…").
  tray.tap('brigadeiro',()=>10);
  assert.deepEqual(tray.reply({req:10,item:'brigadeiro',ok:false,reason:'duplicate'}),{note:{text:CIDA_DEFAULT_NOTE,keep:true}});
  assert.equal(tray.note,CIDA_DEFAULT_NOTE);assert.equal(tray.pending,undefined);
});

test('no answer in 3 s: the purchase is given up once; a late answer changes nothing',()=>{
  const tray=new CidaTray();tray.sync(by());tray.toggle();
  tray.tap('brigadeiro',()=>11);
  assert.deepEqual(tray.timeout(11),{text:CIDA_TIMEOUT_NOTE,keep:false});
  assert.equal(tray.pending,undefined);
  assert.equal(tray.timeout(11),undefined,'once');
  assert.equal(tray.reply({req:11,item:'brigadeiro',ok:true}),undefined,'late');
  // The timer of an answered request does nothing.
  tray.tap('brigadeiro',()=>12);tray.reply({req:12,item:'brigadeiro',ok:true});
  assert.equal(tray.timeout(12),undefined);
});

test('the tray closes by itself: walking away, falling, an offer opening, the end, the objective ending',()=>{
  const cases:[string,Partial<CidaInput>][]=[
    ['walked away',{hero:{x:14,y:10}}],['fell',{standing:false}],['offer',{offerOpen:true}],['result',{ended:true}],
    ['the car opened',{view:{objective:objective({ended:'victory'})}}],['no objective',{view:{}}],
  ];
  for(const [name,over] of cases){
    const tray=new CidaTray();tray.sync(by());tray.toggle();tray.tap('brigadeiro',()=>1);
    assert.equal(tray.sync(by(over)),true,name);
    assert.equal(tray.open,false,name);assert.equal(tray.shown,false,name);
    assert.equal(tray.pending,undefined,name);assert.equal(tray.note,CIDA_DEFAULT_NOTE,name);
  }
  // A step back inside the 3.4 u keeps it open (the predicted spot wobbles at the edge).
  const tray=new CidaTray();tray.sync(by());tray.toggle();
  assert.equal(tray.sync(by({hero:{x:13.2,y:10}})),false);assert.equal(tray.open,true);
});

test('never with the obra window: the obra opening closes the tray and hides her button; she comes back when it closes',()=>{
  const tray=new CidaTray();tray.sync(by());tray.toggle();
  assert.equal(tray.yieldTo(true),true,'the last opened (obra) wins');
  assert.equal(tray.open,false);assert.equal(tray.shown,false);
  assert.equal(tray.toggle(),false,'C or a tap cannot open her over the obra window');
  tray.sync(by());assert.equal(tray.shown,false,'a new view keeps her away while the obra is open');
  assert.equal(tray.yieldTo(false),false);
  assert.equal(tray.shown,true);assert.equal(tray.toggle(),true);
  // Before any view: the obra flag is kept for the first one.
  const fresh=new CidaTray();fresh.yieldTo(true);fresh.sync(by());assert.equal(fresh.shown,false);
  // The HUD tells her: RunHud.yieldForge (explore.ts onWindow of the obra HUD) yields the forge and Dona Cida.
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/yieldForge\(obra:boolean\)\{[^}]*this\.cida\.yieldTo\(obra\)/);
});
