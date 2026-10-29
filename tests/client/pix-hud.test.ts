/**
 * NEW-20261014-ORQ-carteira-e-pix, the HUD half: the PIX balloon on a friend's portrait (hud/pix.ts), its toasts and
 * flash, my wallet on the top bar (no "do time"), and the result's vaquinha. The balloon's timing runs on an injected
 * clock (D-031: no wall-clock asserts); the DOM part runs over a minimal fake DOM (as forja-uma-linha.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {PIX_BALLOON_MS,PIX_MAX,PIX_MEMOS,PIX_REFUSALS,type PixResult,type RunView} from '../../src/contract/index.ts';
import {PIX_FLASH_MS,PIX_NO_ANSWER,PIX_OFFLINE,PIX_REFUSAL_MS,PIX_WAIT_MS,PixBalloon,createPix,granaOf,myGrana,pixBlock,pixButtons,pixSpot,pixToast,type PixOptions} from '../../src/client/hud/pix.ts';
import {fakeView,FIXTURE_GRANA} from '../../src/client/hud/fixtures.ts';
import {granaReadout} from '../../src/client/hud/camp.ts';
import {vaquinhaLine,VAQUINHA_ZERO_JOKES,cidaOffers} from '../../src/client/hud/chaveiro.ts';
import {CidaTray} from '../../src/client/hud/cida-state.ts';
import type {HudContext} from '../../src/client/hud/model.ts';

const live={live:true,paused:false};
const view4=():RunView=>fakeView('wave',4);

test('the balloon opens on a friend\'s portrait only: not mine, not a spectator\'s, not mine as a spectator or caído, not outside a run, not in the pause',()=>{
  const v=view4();
  assert.equal(pixBlock(v,'p1','p2',live),undefined,'a friend: it opens');
  assert.equal(pixBlock(v,'p1','p1',live),'me');
  const spectatorFriend={...v,players:v.players.map(p=>p.id==='p2'?{...p,spectator:true}:p)};
  assert.equal(pixBlock(spectatorFriend,'p1','p2',live),'friend');
  const meWatching={...v,players:v.players.map(p=>p.id==='p1'?{...p,spectator:true}:p)};
  assert.equal(pixBlock(meWatching,'p1','p2',live),'seat');
  assert.equal(pixBlock(v,'nobody','p2',live),'seat','not seated in the run');
  const meDown={...v,players:v.players.map(p=>p.id==='p1'?{...p,hp:0,downed:{progress:0,bleedOutTick:2000}}:p)};
  assert.equal(pixBlock(meDown,'p1','p2',live),'down','caído keeps the "seguir"');
  assert.equal(pixBlock({...v,round:undefined,wave:undefined},'p1','p2',live),'phase','no round: not a run\'s combat/intermission');
  assert.equal(pixBlock(fakeView('prepare',4),'p1','p2',live),undefined,'the intermission: yes');
  assert.equal(pixBlock(v,'p1','p2',{live:false,paused:false}),'phase','the result is up or the HUD is away');
  assert.equal(pixBlock(v,'p1','p2',{live:true,paused:true}),'pause');
  // A caído, offline or bot friend still receives (a seated player, the room checks it again).
  const others={...v,players:v.players.map(p=>p.id==='p2'?{...p,hp:0,online:false,bot:true,downed:{progress:0,bleedOutTick:2000}}:p)};
  assert.equal(pixBlock(others,'p1','p2',live),undefined);
});

test('the buttons: R$ 5 · R$ 10 · R$ 25 · tudo, off above my balance; "tudo" is my balance up to PIX_MAX',()=>{
  const twelve=pixButtons(12);
  assert.deepEqual(twelve.map(b=>[b.label,b.amount,b.enabled]),[['R$ 5',5,true],['R$ 10',10,true],['R$ 25',25,false],['tudo',12,true]]);
  assert.match(twelve[2].aria,/falta grana/);
  assert.deepEqual(pixButtons(0).map(b=>b.enabled),[false,false,false,false],'no money: every button off');
  assert.equal(pixButtons(250).at(-1)!.amount,PIX_MAX,'tudo stops at PIX_MAX');
  assert.equal(pixButtons(PIX_MAX).at(-1)!.amount,PIX_MAX);
  assert.equal(pixButtons(7.9).at(-1)!.amount,7,'whole reais only');
  // My wallet is CampView.grana (the viewer's own); a friend's comes with their player.
  const v=view4();
  assert.equal(myGrana(v,'p1'),v.camp!.grana);
  assert.equal(myGrana({...v,camp:undefined},'p2'),FIXTURE_GRANA[1]);
  assert.equal(granaOf(v.players[2]),FIXTURE_GRANA[2]);assert.equal(granaOf(undefined),0);
});

test('toasts: the receiver reads who, how much and the memo; the sender reads it went; nobody else reads anything',()=>{
  const names:Record<string,string>={p1:'Mateus',p2:'Tia'};const nameOf=(id:string)=>names[id];
  assert.deepEqual(pixToast({from:'p2',to:'p1',amount:10,memo:0},'p1',nameOf),{text:`Tia te mandou um Pix de R$ 10 — '${PIX_MEMOS[0]}'`,mine:false});
  assert.deepEqual(pixToast({from:'p1',to:'p2',amount:25,memo:3},'p1',nameOf),{text:'Pix de R$ 25 pra Tia enviado',mine:true});
  assert.equal(pixToast({from:'p2',to:'p3',amount:5,memo:1},'p1',nameOf),undefined);
  assert.equal(pixToast({from:'p2',to:'p1',amount:5,memo:99},'p1',nameOf)!.text,'Tia te mandou um Pix de R$ 5','an unknown memo is left out');
});

test('the balloon\'s clock: closes PIX_BALLOON_MS untouched, a touch extends it, a send waits, a refusal shows PIX_REFUSAL_MS',()=>{
  const b=new PixBalloon();
  b.open('p2',1000);b.step(1000+PIX_BALLOON_MS-1);assert.equal(b.friend,'p2');
  b.step(1000+PIX_BALLOON_MS);assert.equal(b.friend,undefined,'untouched: closed');
  b.open('p2',0);b.touch(3000);b.step(PIX_BALLOON_MS);assert.equal(b.friend,'p2','touched at 3 s');b.step(3000+PIX_BALLOON_MS);assert.equal(b.friend,undefined);
  // A send: no second press while waiting, no auto-close while waiting.
  b.open('p2',0);
  const token=b.press({amount:10,all:false,enabled:true},100)!;
  assert.equal(typeof token,'number');
  assert.equal(b.press({amount:5,all:false,enabled:true},200),undefined,'one at a time');
  assert.equal(b.press({amount:5,all:false,enabled:false},200),undefined);
  b.step(100+PIX_WAIT_MS-1);assert.ok(b.pending,'still waiting');
  // Refused: the line for PIX_REFUSAL_MS, the balloon stays PIX_BALLOON_MS from the answer.
  b.answer(token,{ok:false,reason:'grana'},2000);
  assert.equal(b.refusal?.text,PIX_REFUSALS.grana);assert.equal(b.pending,undefined);
  b.step(2000+PIX_REFUSAL_MS-1);assert.ok(b.refusal);
  b.step(2000+PIX_REFUSAL_MS);assert.equal(b.refusal,undefined);assert.equal(b.friend,'p2');
  b.step(2000+PIX_BALLOON_MS);assert.equal(b.friend,undefined);
  // Accepted: closed. A late answer for a closed or moved balloon is dropped.
  b.open('p2',0);const ok=b.press({amount:5,all:false,enabled:true},0)!;b.answer(ok,{ok:true,to:'p2',amount:5,grana:7},10);assert.equal(b.friend,undefined);
  b.open('p2',0);const stale=b.press({amount:5,all:false,enabled:true},0)!;b.open('p3',5);b.answer(stale,{ok:false,reason:'rate'},10);assert.equal(b.refusal,undefined);
  // No answer in PIX_WAIT_MS: the button comes back with the line; the tap that never left says so.
  // (read through a function: the asserts above narrowed the fields for the type checker)
  const line=()=>b.refusal?.text,waiting=()=>b.pending;
  b.open('p2',0);b.press({amount:5,all:false,enabled:true},0);b.step(PIX_WAIT_MS);assert.equal(line(),PIX_NO_ANSWER);assert.equal(waiting(),undefined);
  b.open('p2',0);const lost=b.press({amount:5,all:false,enabled:true},0)!;b.answer(lost,undefined,1);assert.equal(line(),PIX_OFFLINE);
});

test('where it goes: under the fan\'s portrait on the phone, inside 390x844 and 360x800, clear of the joystick and the skill button',()=>{
  for(const screen of [{width:390,height:844},{width:360,height:800},{width:844,height:390}]){
    // The fan's ends and middle (the fan sits in the top band, centred between the minimap and the gear).
    for(const x of [screen.width/2-70,screen.width/2-14,screen.width/2+42]){
      const portrait={x,y:58,width:28,height:30},size={width:228,height:112};
      const at=pixSpot(portrait,size,screen,'below');
      assert.equal(at.side,'below');
      assert.ok(at.x>=8&&at.x+size.width<=screen.width-8,`${screen.width}: inside, x ${at.x}`);
      assert.ok(at.y>=portrait.y+portrait.height,'under the portrait, not over it');
      // explore.css thumbs: the 112 px stick (96 in landscape) and the 94 px skill, 16–24 px from the bottom.
      const thumbsTop=screen.height-24-112;
      assert.ok(at.y+size.height<thumbsTop,`${screen.width}x${screen.height}: ends at ${at.y+size.height}, thumbs from ${thumbsTop}`);
      assert.ok(at.beak>=0&&at.beak<=size.width,'the beak points at the portrait');
    }
  }
  // The desktop's column: right of the portrait; a portrait at the right edge falls back under it.
  const right=pixSpot({x:12,y:300,width:54,height:60},{width:228,height:112},{width:1280,height:800},'right');
  assert.equal(right.side,'right');assert.equal(right.x,12+54+8);
  assert.equal(pixSpot({x:1240,y:300,width:30,height:30},{width:228,height:112},{width:1280,height:800},'right').side,'below');
});

test('pix.css: tokens only, the match\'s 13 px floor, 44 px buttons, the balloon above the HUD\'s parts and under the result',()=>{
  const decls=declarations(readFileSync(new URL('../../src/client/hud/pix.css',import.meta.url),'utf8')) as {selector:string;prop:string;value:string}[];
  const get=(sel:string,prop:string)=>decls.find(d=>d.selector===sel&&d.prop===prop)?.value;
  assert.equal(get('.rh .rh-pix','z-index'),'var(--z-painel)');
  assert.equal(get('.rh .rh-pix','pointer-events'),'auto');
  assert.equal(get('.rh-pix-btn','min-height'),'44px');
  for(const d of decls)if(d.prop==='font')assert.match(d.value,/var\(--t-(13|16)\)/,`${d.selector} { font }`);
  for(const d of decls)assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|rgba?\(/i,`${d.selector} { ${d.prop} }`);
});

// ---------- The DOM part over a minimal fake DOM ----------
type Listener={type:string;fn:(e:FakeEvent)=>void;capture:boolean};
interface FakeEvent {target:FakeEl;stopped:boolean;stopPropagation():void}
class FakeEl {
  className='';hidden=false;textContent='';type='';disabled=false;
  dataset:Record<string,string>={};attrs:Record<string,string>={};children:FakeEl[]=[];parentElement:FakeEl|null=null;
  listeners:Listener[]=[];rect={left:0,top:0,width:0,height:0};offsetWidth=228;offsetHeight=112;
  style:{top:string;left:string;setProperty(k:string,v:string):void}={top:'',left:'',setProperty(k:string,v:string){(this as unknown as Record<string,string>)[k]=v;}};
  ownerDocument:FakeDoc;readonly tagName:string;
  constructor(tagName:string,doc:FakeDoc){this.tagName=tagName;this.ownerDocument=doc;}
  classList={
    has:(c:string)=>this.className.split(/\s+/).includes(c),
    toggle:(c:string,on?:boolean)=>{const want=on??!this.classList.has(c);this.className=[...this.className.split(/\s+/).filter(x=>x&&x!==c),...(want?[c]:[])].join(' ');return want;},
    contains:(c:string)=>this.classList.has(c),
  };
  get isConnected():boolean{return this.ownerDocument.body===this||!!this.parentElement?.isConnected;}
  append(...nodes:FakeEl[]){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  insertBefore(n:FakeEl,ref:FakeEl|null){n.remove();n.parentElement=this;const i=ref?this.children.indexOf(ref):-1;if(i<0)this.children.push(n);else this.children.splice(i,0,n);}
  remove(){const p=this.parentElement;if(p)p.children=p.children.filter(c=>c!==this);this.parentElement=null;}
  setAttribute(k:string,v:string){this.attrs[k]=v;}
  getAttribute(k:string){return this.attrs[k]??null;}
  removeAttribute(k:string){delete this.attrs[k];}
  toggleAttribute(k:string,on:boolean){if(on)this.attrs[k]='';else delete this.attrs[k];return on;}
  addEventListener(type:string,fn:(e:FakeEvent)=>void,capture?:boolean){this.listeners.push({type,fn,capture:!!capture});}
  removeEventListener(type:string,fn:(e:FakeEvent)=>void,capture?:boolean){this.listeners=this.listeners.filter(l=>!(l.type===type&&l.fn===fn&&l.capture===!!capture));}
  getBoundingClientRect(){const r=this.rect;return {...r,right:r.left+r.width,bottom:r.top+r.height,x:r.left,y:r.top};}
  contains(other:FakeEl|null):boolean{for(let n=other;n;n=n.parentElement)if(n===this)return true;return false;}
  closest(selector:string):FakeEl|null{
    assert.equal(selector,'.rh-member[data-id]');
    for(let n:FakeEl|null=this;n;n=n.parentElement)if(n.classList.has('rh-member')&&n.dataset.id!==undefined)return n;
    return null;
  }
  querySelectorAll(selector:string):FakeEl[]{assert.equal(selector,'.rh-member[data-id]');return this.all(e=>e.classList.has('rh-member')&&e.dataset.id!==undefined);}
  all(pred:(e:FakeEl)=>boolean):FakeEl[]{return this.children.flatMap(c=>[...(pred(c)?[c]:[]),...c.all(pred)]);}
  click(){dispatch(this,'click');}
}
class FakeDoc {
  listeners:Listener[]=[];body:FakeEl;
  constructor(){this.body=new FakeEl('body',this);}
  createElement(tag:string){return new FakeEl(tag,this);}
  addEventListener(type:string,fn:(e:FakeEvent)=>void,capture?:boolean){this.listeners.push({type,fn,capture:!!capture});}
  removeEventListener(type:string,fn:(e:FakeEvent)=>void,capture?:boolean){this.listeners=this.listeners.filter(l=>!(l.type===type&&l.fn===fn&&l.capture===!!capture));}
}
/** Capture from the document down, then the target and the bubble up (stopPropagation honoured between nodes). */
function dispatch(target:FakeEl,type:string):FakeEvent{
  const event:FakeEvent={target,stopped:false,stopPropagation(){this.stopped=true;}};
  const path:FakeEl[]=[];for(let n:FakeEl|null=target;n;n=n.parentElement)path.unshift(n);
  const doc=target.ownerDocument;
  for(const l of doc.listeners)if(l.type===type&&l.capture)l.fn(event);
  for(const node of path){if(event.stopped)return event;for(const l of node.listeners)if(l.type===type&&(l.capture||node===target))l.fn(event);}
  for(const node of [...path].reverse().slice(1)){if(event.stopped)return event;for(const l of node.listeners)if(l.type===type&&!l.capture)l.fn(event);}
  return event;
}

function rig(options:Partial<PixOptions>={}){
  const doc=new FakeDoc(),root=doc.createElement('div');root.className='rh';root.dataset.hud='fone';doc.body.append(root);
  root.rect={left:0,top:0,width:390,height:844};
  const team=doc.createElement('div');team.className='rh-team';root.append(team);
  // team.ts's own tap: the name under the portrait (bubble phase on the strip).
  let named:string|undefined;team.addEventListener('pointerdown',e=>{named=e.target.closest('.rh-member[data-id]')?.dataset.id;});
  const members=new Map<string,FakeEl>();
  ['p1','p2','p3','p4'].forEach((id,i)=>{
    const m=doc.createElement('div');m.className='rh-member';m.dataset.id=id;m.rect={left:150+i*24,top:58,width:28,height:30};
    const ring=doc.createElement('div');ring.className='rh-member-ring';m.append(ring);team.append(m);members.set(id,m);
  });
  let clock=0;const sent:[string,number][]=[],said:{text:string;mine:boolean}[]=[];
  let answer:(r:PixResult)=>void=()=>undefined;
  const pix=createPix({root:root as unknown as HTMLElement,now:()=>clock,live:()=>true,
    send:(to,amount)=>{sent.push([to,amount]);return new Promise<PixResult>(done=>{answer=done;});},
    say:(row,mine)=>said.push({text:row.textContent??'',mine}),...options});
  root.append(pix.el as unknown as FakeEl);
  const balloon=pix.el as unknown as FakeEl;
  const ctx={localId:'p1'} as HudContext;
  const update=(v:RunView,c:HudContext=ctx)=>pix.update(v,c);
  return {doc,root,team,members,pix,balloon,update,ctx,sent,said,
    tick:(ms:number)=>{clock+=ms;},get named(){return named;},reply:(r:PixResult)=>answer(r)};
}
const buttonsOf=(balloon:FakeEl)=>balloon.all(e=>e.classList.has('rh-pix-btn'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('DOM: a tap on a friend opens the balloon by them and stops the name; mine, a spectator\'s, in the pause or out of a run fall through',()=>{
  const r=rig(),v=view4();r.update(v);
  // Mine: no balloon, the name shows (team.ts).
  let e=dispatch(r.members.get('p1')!.children[0],'pointerdown');
  assert.equal(e.stopped,false);assert.equal(r.balloon.hidden,true);assert.equal(r.named,'p1');
  // A friend: the balloon, the name does not show.
  e=dispatch(r.members.get('p2')!.children[0],'pointerdown');
  assert.equal(e.stopped,true,'stopPropagation only when it opens');assert.equal(r.balloon.hidden,false);
  assert.equal(r.named,'p1','the strip never saw the tap');
  const name=r.balloon.all(x=>x.classList.has('rh-pix-nome'))[0],saldo=r.balloon.all(x=>x.classList.has('rh-pix-saldo'))[0];
  assert.equal(name.textContent,'Pix pra Tia');assert.equal(saldo.textContent,`tem R$ ${FIXTURE_GRANA[1]}`);
  // Under the portrait, inside the phone.
  const top=Number(r.balloon.style.top.replace('px','')),left=Number(r.balloon.style.left.replace('px',''));
  assert.ok(top>=58+30,`top ${top}`);assert.ok(left>=8&&left+228<=390-8,`left ${left}`);assert.equal(r.balloon.dataset.lado,'below');
  // A tap outside closes it.
  dispatch(r.doc.body,'pointerdown');assert.equal(r.balloon.hidden,true);
  // The pause (D-050 ctx.pause), a spectator friend, outside a run: the tap falls through.
  r.update(v,{...r.ctx,pause:{leftMs:9000}} as HudContext);
  e=dispatch(r.members.get('p2')!,'pointerdown');assert.equal(e.stopped,false);assert.equal(r.balloon.hidden,true);assert.equal(r.named,'p2');
  r.update({...v,players:v.players.map(p=>p.id==='p3'?{...p,spectator:true}:p)});
  e=dispatch(r.members.get('p3')!,'pointerdown');assert.equal(e.stopped,false);assert.equal(r.balloon.hidden,true);
  r.update({...v,round:undefined});
  e=dispatch(r.members.get('p4')!,'pointerdown');assert.equal(e.stopped,false);assert.equal(r.balloon.hidden,true);
  const off=rig({live:()=>false});off.update(v);
  assert.equal(dispatch(off.members.get('p2')!,'pointerdown').stopped,false,'the result is up');
  r.pix.destroy?.();
  assert.equal(r.doc.listeners.length,0,'destroy drops the document listener');
});

test('DOM: buttons off above my balance, "tudo" capped, one tap sends, pending "…", a refusal\'s line, closes on the injected clock',async()=>{
  const r=rig(),base=view4(),v={...base,camp:{...base.camp!,grana:12}};r.update(v);
  dispatch(r.members.get('p2')!,'pointerdown');
  const btns=buttonsOf(r.balloon);
  assert.deepEqual(btns.map(b=>b.disabled),[false,false,true,false],'R$ 25 over my R$ 12');
  assert.equal(btns[3].dataset.valor,'12');
  btns[3].click();
  assert.deepEqual(r.sent,[['p2',12]],'tudo = my R$ 12');
  assert.ok(btns.every(b=>b.disabled),'all off while waiting');
  assert.equal(btns[3].all(x=>x.classList.has('rh-pix-valor'))[0].textContent,'…');
  btns[0].click();assert.equal(r.sent.length,1,'no second send while waiting');
  r.reply({ok:false,reason:'rate'});await flush();
  const line=r.balloon.all(x=>x.classList.has('rh-pix-linha'))[0];
  assert.equal(line.hidden,false);assert.equal(line.textContent,PIX_REFUSALS.rate);
  r.tick(PIX_REFUSAL_MS);r.update(v);assert.equal(line.hidden,true,'the line goes after PIX_REFUSAL_MS');assert.equal(r.balloon.hidden,false);
  r.tick(PIX_BALLOON_MS-PIX_REFUSAL_MS);r.update(v);assert.equal(r.balloon.hidden,true,'untouched since the answer: closed');
  // Rich: tudo stops at PIX_MAX; accepted closes it.
  const rich={...v,camp:{...v.camp,grana:500}};r.update(rich);
  dispatch(r.members.get('p3')!,'pointerdown');
  buttonsOf(r.balloon)[3].click();assert.deepEqual(r.sent.at(-1),['p3',PIX_MAX]);
  r.reply({ok:true,to:'p3',amount:PIX_MAX,grana:400});await flush();
  assert.equal(r.balloon.hidden,true);
  // A tap that cannot reach the room says so at once.
  const offline=rig({send:()=>undefined});offline.update(v);dispatch(offline.members.get('p2')!,'pointerdown');
  buttonsOf(offline.balloon)[0].click();
  assert.equal(offline.balloon.all(x=>x.classList.has('rh-pix-linha'))[0].textContent,PIX_OFFLINE);
});

test('DOM: the pix event: the receiver\'s and the sender\'s toasts, nothing for others, the receiver\'s portrait flashes for PIX_FLASH_MS',()=>{
  const r=rig(),v=view4();r.update(v);
  r.update({...v,events:[{type:'pix',from:'p2',to:'p1',amount:10,memo:2,eventId:5}]});
  assert.deepEqual(r.said,[{text:`Tia te mandou um Pix de R$ 10 — '${PIX_MEMOS[2]}'`,mine:false}]);
  assert.equal('pix' in r.members.get('p1')!.dataset,true,'my portrait flashes');
  r.update({...v,events:[{type:'pix',from:'p2',to:'p1',amount:10,memo:2,eventId:5}]});assert.equal(r.said.length,1,'the same event once');
  r.update({...v,events:[{type:'pix',from:'p1',to:'p4',amount:25,memo:0,eventId:6}]});
  assert.deepEqual(r.said.at(-1),{text:'Pix de R$ 25 pra Bruninha enviado',mine:true});
  r.update({...v,events:[{type:'pix',from:'p2',to:'p3',amount:5,memo:0,eventId:7}]});
  assert.equal(r.said.length,2,'someone else\'s PIX: no toast');assert.equal('pix' in r.members.get('p3')!.dataset,true,'but the flash');
  r.tick(PIX_FLASH_MS);r.update(v);
  for(const id of ['p1','p3','p4'])assert.equal('pix' in r.members.get(id)!.dataset,false,`${id}: the flash is over`);
});

test('the top bar shows my wallet, never "do time"; the Cida tray pays from my wallet (CampView.grana)',()=>{
  assert.deepEqual(granaReadout(120),{text:'R$ 120',label:'Você tem R$ 120'});
  assert.doesNotMatch(granaReadout(0).label,/do time|da turma/);
  const objective={kind:'chaveiro' as const,moto:{x:10,y:10,mode:'lombada' as const},route:[],stops:[],etaS:300,alarmUntil:0,grana:200,budget:120,stock:[4,1,0],car:{x:0,y:0,hits:0,limit:120,parts:0}};
  const tray=new CidaTray();
  tray.sync({view:{objective,camp:{grana:15}},standing:true,hero:{x:11,y:11},offerOpen:false,ended:false});
  assert.equal(tray.grana,15,'my R$ 15, not the objective\'s copy');
  assert.deepEqual(tray.offers.map(o=>o.blocked??''),cidaOffers({grana:15,stock:[4,1,0]}).map(o=>o.blocked??''));
});

test('the result\'s vaquinha: each player\'s part, me as "Você", the R$ 0 with its joke',()=>{
  const names:Record<string,string>={p1:'Você',p2:'Ana',p3:'Bot',p4:'Zé',p5:'Tio'};const nameOf=(id:string)=>names[id];
  const line=vaquinhaLine([{id:'p2',had:30,paid:12},{id:'p3',had:8,paid:8},{id:'p4',had:0,paid:0},{id:'p5',had:0,paid:0}],nameOf)!;
  assert.equal(line.text,`Vaquinha: Ana R$ 12; Bot R$ 8; Zé R$ 0, ${VAQUINHA_ZERO_JOKES[0]}; Tio R$ 0, ${VAQUINHA_ZERO_JOKES[1]}`);
  assert.equal(VAQUINHA_ZERO_JOKES[0],'pediu o recibo','the approved joke first');
  assert.match(line.aria,/^Vaquinha da conta: /);
  assert.equal(vaquinhaLine([],nameOf),undefined);assert.equal(vaquinhaLine(undefined,nameOf),undefined);
  assert.equal(vaquinhaLine([{id:'p1',had:5,paid:5}],nameOf)!.text,'Vaquinha: Você R$ 5');
});
