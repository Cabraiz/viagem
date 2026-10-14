/**
 * Dona Cida's button and tray (D-047, card NEW-20261014-ORQ-chaveiro-hud). She rides on the chaveiro's moto and sells
 * the team three sweets for the team's Grana to whoever stands by the moto (≤ CIDA_REACH_U, the room checks it again):
 * - the button (a right-thumb control, 24 px above the skill button): shows while the hero is by the moto and the
 *   objective runs; dim when nothing on the tray can be bought now (no Grana, or the tray is empty); a tap (or C on a
 *   desktop, D-044) opens the tray;
 * - the tray (an intermission-like window in the forge's place, never two open: an offer closes it and the forge yields
 *   to it): the three sweets with what they do, the price and what is left. A tap buys ({t:'cida'}, the room answers
 *   {t:'bought'}); a tag that cannot be bought now stays readable (padlock or "acabou") and says why on tap; 1–3 buy on
 *   a desktop, Esc closes. Walking away from the moto closes it.
 * Pure DOM over RunView and the hero's predicted spot; every number (Grana, stock, prices) comes from the room.
 */
import './cida.css';
import type {CidaItemId,RunView} from '../../contract/index.ts';
import {icon} from '../ui/icon.ts';
import type {HudContext,HudPart} from './model.ts';
import {cidaBought,cidaButtonShown,cidaOffers,cidaRefusal,cidaSells,liveObjective,nearMoto,reais,type CidaOffer} from './chaveiro.ts';

/** Answers slower than this are given up (the tag comes back, the note says so); the forge's number. */
export const CIDA_TIMEOUT_MS=3000;
/** A bought tag keeps its "LEVEI" stamp this long. */
export const CIDA_STAMP_MS=900;
export const CIDA_DEFAULT_NOTE='Cada doce dura 30 s.';

export interface CidaAnswer {req:number;item:string;ok:boolean;grana?:number;reason?:string}
export interface CidaOptions {
  /** Sends the purchase ({t:'cida'}); the request id, or undefined when it cannot reach the room now. */
  onBuy(item:CidaItemId):number|undefined;
  /** The tray opened or closed (the forge yields to it, the zones are measured again). */
  onWindow?(open:boolean):void;
}
export interface CidaPart extends HudPart {
  readonly button:HTMLButtonElement;
  readonly panel:HTMLElement;
  /** The hero's predicted spot (world units), as the camp gets it. */
  setHero(spot:{x:number;y:number}|undefined):void;
  /** The room's {t:'bought'} answer. */
  bought(answer:CidaAnswer):void;
  /** The tray is on screen. */
  readonly open:boolean;
}


const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export function createCida(options:CidaOptions):CidaPart{
  const doc=document;
  // ---------- Button ----------
  const button=el('button','rh-cida-btn');button.type='button';button.hidden=true;
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
  // Popcorn, a snack (her tray of sweets): the skill button below already wears the shopping bag.
  button.innerHTML=`${icon('pipoca',{size:32})}<span class="rh-cida-btn-text">Cida</span>`;
  // ---------- Tray ----------
  const panel=el('section','rh-cida');panel.hidden=true;panel.id='rh-cida';panel.setAttribute('aria-label','Doces da Dona Cida');
  button.setAttribute('aria-controls',panel.id);
  const head=el('div','rh-cida-head',panel);
  const title=el('h2','rh-cida-title',head);title.textContent='Dona Cida';
  const grana=el('b','rh-cida-grana',head);
  // What a tap did (or why not) rides in the header, between the Grana and the close button: the tags stay one low row.
  const note=el('p','rh-cida-note',head);
  const close=el('button','rh-cida-close',head);close.type='button';close.setAttribute('aria-label','Fechar os doces');close.insertAdjacentHTML('beforeend',icon('fechar',{size:32}));
note.setAttribute('aria-live','polite');note.textContent=CIDA_DEFAULT_NOTE;
  const list=el('div','rh-cida-doces',panel);
  interface Tag {button:HTMLButtonElement;price:HTMLElement;stock:HTMLElement;lock:HTMLElement}
  const tags=new Map<CidaItemId,Tag>();
  for(const offer of cidaOffers({grana:0,stock:[0,0,0]})){
    const b=el('button','rh-cida-doce',list);b.type='button';b.dataset.item=offer.id;
    el('strong','rh-cida-nome',b).textContent=offer.name;
    el('span','rh-cida-efeito',b).textContent=offer.effect;
    const foot=el('span','rh-cida-pe',b);
    const price=el('b','rh-cida-preco',foot);price.textContent=offer.priceText;
    const lock=el('span','rh-cida-cadeado',foot);lock.insertAdjacentHTML('beforeend',icon('cadeado',{label:'Sem grana'}));lock.hidden=true;
    const stock=el('span','rh-cida-estoque',foot);
    el('span','rh-cida-carimbo',b).textContent='LEVEI';
    tags.set(offer.id,{button:b,price,stock,lock});
  }

  let last:RunView|undefined,ctxId='',hero:{x:number;y:number}|undefined,near=false,open=false,offers:CidaOffer[]=[];
  let pending:{req:number;item:CidaItemId;name:string;timer:ReturnType<typeof setTimeout>}|undefined;
  let noteTimer:ReturnType<typeof setTimeout>|undefined,stampTimer:ReturnType<typeof setTimeout>|undefined;
  const say=(text:string,keep=false)=>{
    note.textContent=text;clearTimeout(noteTimer);
    if(!keep)noteTimer=setTimeout(()=>{note.textContent=CIDA_DEFAULT_NOTE;},2600);
  };
  const setOpen=(next:boolean)=>{
    if(open===next)return;
    open=next;panel.hidden=!next;button.setAttribute('aria-expanded',String(next));
    if(!next){clearPending();clearTimeout(noteTimer);note.textContent=CIDA_DEFAULT_NOTE;}
    render();options.onWindow?.(next);
  };
  const clearPending=()=>{
    if(!pending)return;
    clearTimeout(pending.timer);
    const t=tags.get(pending.item);t?.button.classList.remove('rh-cida-pending');t?.button.removeAttribute('aria-busy');
    pending=undefined;
  };
  const buy=(item:CidaItemId)=>{
    if(!open||pending)return;
    const offer=offers.find(o=>o.id===item);
    if(!offer)return;
    if(offer.blocked){say(cidaRefusal(offer.blocked,offer));return;}
    const req=options.onBuy(item);
    if(req===undefined){say('Sem conexão com a sala. Tenta de novo.');return;}
    const t=tags.get(item)!;t.button.classList.add('rh-cida-pending');t.button.setAttribute('aria-busy','true');
    say('Embrulhando…',true);
    pending={req,item,name:offer.name,timer:setTimeout(()=>{if(pending?.req===req){clearPending();say('Sem resposta da sala. Tenta de novo.');}},CIDA_TIMEOUT_MS)};
  };
  for(const [item,{button:b}] of tags){
    // Pointer down answers at once (the tap is the purchase; a mouse's left button too, D-044); a keyboard click (detail 0) as well.
    b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();buy(item);});
    b.addEventListener('click',e=>{if(e.detail===0)buy(item);});
  }
  button.addEventListener('click',()=>{if(!button.hidden)setOpen(!open);});
  close.addEventListener('click',()=>setOpen(false));
  // Desktop (D-044): C opens or closes the tray while the button shows, 1–3 buy, Esc closes. Never while typing.
  const onKey=(e:KeyboardEvent)=>{
    if(e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
    const target=e.target as HTMLElement|null;
    if(target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))||target?.closest?.('dialog[open]'))return;
    if(e.code==='KeyC'&&(!button.hidden||open)){e.preventDefault();setOpen(!open);return;}
    if(!open)return;
    if(e.code==='Escape'){setOpen(false);return;}
    const n=/^(?:Digit|Numpad)([1-3])$/.exec(e.code)?.[1];
    if(n){e.preventDefault();const offer=offers[Number(n)-1];if(offer)buy(offer.id);}
  };
  doc.addEventListener('keydown',onKey);
  // The button and the tray hold their own taps (VGM-040): nothing leaks to the joystick or the map.
  for(const node of [button,panel])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)node.addEventListener(type,event=>event.stopPropagation());

  const render=()=>{
    const view=last,objective=liveObjective(view);
    const me=view?.players.find(p=>p.id===ctxId),standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed&&me.hp>0;
    near=nearMoto(hero,objective?.moto,near);
    const root=button.closest('.rh');
    const offerOpen=!!root?.querySelector('.rh-offer:not([hidden])'),ended=!!root?.classList.contains('rh-ended');
    const shown=cidaButtonShown({live:!!objective,standing,near,offerOpen,ended});
    // Walking away, falling, the run ending or an offer opening close the tray (it comes back with a tap).
    if(open&&!shown){setOpen(false);return;}
    const showButton=shown&&!open;
    if(button.hidden===showButton)button.hidden=!showButton;
    if(!objective)return;
    offers=cidaOffers(objective);
    const sells=cidaSells(offers);
    if(button.classList.contains('rh-cida-apagado')===sells)button.classList.toggle('rh-cida-apagado',!sells);
    const g=reais(objective.grana);
    button.setAttribute('aria-label',`Doces da Dona Cida: ${sells?`a turma tem ${g}`:offers.every(o=>o.blocked==='stock')?'acabaram':`${g} não paga nenhum`}`);
    if(!open)return;
    if(grana.textContent!==g){grana.textContent=g;grana.setAttribute('aria-label',`${g} da turma`);}
    for(const offer of offers){
      const t=tags.get(offer.id)!;
      t.button.classList.toggle('rh-cida-bloqueado',!!offer.blocked);
      t.button.dataset.bloqueio=offer.blocked??'';
      t.lock.hidden=offer.blocked!=='grana';
      if(t.stock.textContent!==offer.stockText)t.stock.textContent=offer.stockText;
      t.button.setAttribute('aria-label',offer.label);
    }
  };

  return {
    el:panel,button,panel,
    get open(){return open;},
    update(view:RunView,ctx:HudContext){last=view;ctxId=ctx.localId;render();},
    setHero(at){hero=at&&{x:at.x,y:at.y};if(last)render();},
    bought(answer){
      if(!pending||answer.req!==pending.req)return;
      const {item,name}=pending;clearPending();
      // A resend the room already handled: its first answer was the one that counted.
      if(!answer.ok&&answer.reason==='duplicate')return;
      if(answer.ok){
        const b=tags.get(item)!.button;
        b.classList.add('rh-cida-feito');clearTimeout(stampTimer);
        stampTimer=setTimeout(()=>b.classList.remove('rh-cida-feito'),CIDA_STAMP_MS);
        say(cidaBought(name));
      }else say(cidaRefusal(answer.reason,offers.find(o=>o.id===item)));
    },
    destroy(){doc.removeEventListener('keydown',onKey);clearTimeout(noteTimer);clearTimeout(stampTimer);if(pending)clearTimeout(pending.timer);button.remove();panel.remove();},
  };
}
