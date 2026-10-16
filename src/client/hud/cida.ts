/**
 * Dona Cida's button and tray (D-047, card NEW-20261014-ORQ-chaveiro-hud). She rides on the chaveiro's moto and sells
 * three sweets to whoever stands by the moto (≤ CIDA_REACH_U, the room checks it again), paid from their own wallet
 * (carteira-e-pix: CampView.grana; the buff is theirs too):
 * - the button (a right-thumb control, 24 px above the skill button): shows while the hero is by the moto and the
 *   objective runs; dim when nothing on the tray can be bought now (my wallet too short, or the tray is empty); a tap (or C on a
 *   desktop, D-044) opens the tray;
 * - the tray (an intermission-like window in the forge's place, never two open: an offer or the obra window closes it
 *   and the forge yields to it): the three sweets with what they do, the price and what is left. A tap buys
 *   ({t:'cida'}, the room answers {t:'bought'}); a tag that cannot be bought now stays readable (padlock or "acabou")
 *   and says why on tap; 1–3 buy on a desktop, Esc closes (and only closes: the shell's settings stay shut). Walking
 *   away from the moto closes it.
 * The decisions live in cida-state.ts (CidaTray, tested in node); this file draws them and keeps the timers. Every
 * number (Grana, stock, prices) comes from the room.
 */
import './cida.css';
import type {CidaItemId,RunView} from '../../contract/index.ts';
import {icon,uiArtUrl} from '../ui/icon.ts';
import {sticker} from '../ui/sticker.ts';
import type {HudContext,HudPart} from './model.ts';
import {cidaOffers,reais} from './chaveiro.ts';
import {cidaKeyOf,SHELL_DIALOG} from '../desktop-input.ts';
import {CIDA_DEFAULT_NOTE,CIDA_NOTE_MS,CIDA_STAMP_MS,CIDA_TIMEOUT_MS,CidaTray,type CidaAnswer,type CidaNote} from './cida-state.ts';

export {CIDA_DEFAULT_NOTE,CIDA_STAMP_MS,CIDA_TIMEOUT_MS,type CidaAnswer} from './cida-state.ts';
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
  /** The obra window opened or closed: while it is open her button hides and the tray stays shut (the last opened wins). */
  yieldTo(obra:boolean):void;
  /** The tray is on screen. */
  readonly open:boolean;
}

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export function createCida(options:CidaOptions):CidaPart{
  const doc=document,tray=new CidaTray();
  // ---------- Button ----------
  const button=el('button','rh-cida-btn');button.type='button';button.hidden=true;
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
  // Her own sticker (ui/cida, icones-no-hud); without that art, popcorn (her sweets: the skill button wears the bag).
  button.innerHTML=`${uiArtUrl('cida')?sticker('cida',{size:32}):icon('pipoca',{size:32})}<span class="rh-cida-btn-text">Cida</span>`;
  // ---------- Tray ----------
  const panel=el('section','rh-cida');panel.hidden=true;panel.id='rh-cida';panel.setAttribute('aria-label','Doces da Dona Cida');
  button.setAttribute('aria-controls',panel.id);
  const head=el('div','rh-cida-head',panel);
  const title=el('h2','rh-cida-title',head);title.textContent='Dona Cida';
  const grana=el('b','rh-cida-grana',head);
  // What a tap did (or why not) rides in the header, between the Grana and the close button: the tags stay one low row.
  const note=el('p','rh-cida-note',head);note.setAttribute('aria-live','polite');note.textContent=CIDA_DEFAULT_NOTE;
  const close=el('button','rh-cida-close',head);close.type='button';close.setAttribute('aria-label','Fechar os doces');close.insertAdjacentHTML('beforeend',icon('fechar',{size:32}));
  const list=el('div','rh-cida-doces',panel);
  interface Tag {button:HTMLButtonElement;stock:HTMLElement;lock:HTMLElement;blocked?:string;label?:string}
  const tags=new Map<CidaItemId,Tag>();
  // The tags in CIDA_ITEMS order, built once (names, effects and prices never change); stock and blocks follow the room.
  for(const offer of cidaOffers({grana:0,stock:[0,0,0]})){
    const b=el('button','rh-cida-doce',list);b.type='button';b.dataset.item=offer.id;
    el('strong','rh-cida-nome',b).textContent=offer.name;
    el('span','rh-cida-efeito',b).textContent=offer.effect;
    const foot=el('span','rh-cida-pe',b);
    el('b','rh-cida-preco',foot).textContent=offer.priceText;
    const lock=el('span','rh-cida-cadeado',foot);lock.insertAdjacentHTML('beforeend',icon('cadeado',{label:'Sem grana'}));lock.hidden=true;
    const stock=el('span','rh-cida-estoque',foot);
    el('span','rh-cida-carimbo',b).textContent='LEVEI';
    tags.set(offer.id,{button:b,stock,lock});
  }

  let last:RunView|undefined,ctxId='',hero:{x:number;y:number}|undefined,wasOpen=false,buttonLabel='';
  let noteTimer:ReturnType<typeof setTimeout>|undefined,stampTimer:ReturnType<typeof setTimeout>|undefined,pendingTimer:ReturnType<typeof setTimeout>|undefined;
  let busy:CidaItemId|undefined;
  /** Shows a note from the tray; one that answered a tap goes back to the default line after CIDA_NOTE_MS. */
  const show=(n:CidaNote|undefined)=>{
    if(!n)return;
    clearTimeout(noteTimer);
    if(!n.keep)noteTimer=setTimeout(()=>{tray.resetNote();paint();},CIDA_NOTE_MS);
    paint();
  };
  /** Draws what the tray decided, writing only what changed. */
  const paint=()=>{
    const open=tray.open;
    if(panel.hidden===open)panel.hidden=!open;
    const showButton=tray.shown&&!open;
    if(button.hidden===showButton)button.hidden=!showButton;
    if(note.textContent!==tray.note)note.textContent=tray.note;
    // The tag waiting for the room's answer.
    const now=tray.pending?.item;
    if(busy!==now){
      if(busy){const t=tags.get(busy)!;t.button.classList.remove('rh-cida-pending');t.button.removeAttribute('aria-busy');}
      if(now){const t=tags.get(now)!;t.button.classList.add('rh-cida-pending');t.button.setAttribute('aria-busy','true');}
      busy=now;
    }
    if(!tray.pending&&pendingTimer){clearTimeout(pendingTimer);pendingTimer=undefined;}
    if(open!==wasOpen){
      wasOpen=open;button.setAttribute('aria-expanded',String(open));
      if(!open)clearTimeout(noteTimer);
      options.onWindow?.(open);
    }
    if(!tray.offers.length)return;
    if(button.classList.contains('rh-cida-apagado')===tray.sells)button.classList.toggle('rh-cida-apagado',!tray.sells);
    const g=reais(tray.grana);
    const label=`Doces da Dona Cida: ${tray.sells?`você tem ${g}`:tray.offers.every(o=>o.blocked==='stock')?'acabaram':`seus ${g} não pagam nenhum`}`;
    if(label!==buttonLabel){buttonLabel=label;button.setAttribute('aria-label',label);}
    if(!open)return;
    if(grana.textContent!==g){grana.textContent=g;grana.setAttribute('aria-label',`Você tem ${g}`);}
    for(const offer of tray.offers){
      const t=tags.get(offer.id)!,blocked=offer.blocked??'';
      if(t.blocked!==blocked){
        t.blocked=blocked;t.button.dataset.bloqueio=blocked;
        t.button.classList.toggle('rh-cida-bloqueado',!!blocked);t.lock.hidden=blocked!=='grana';
      }
      if(t.stock.textContent!==offer.stockText)t.stock.textContent=offer.stockText;
      if(t.label!==offer.label){t.label=offer.label;t.button.setAttribute('aria-label',offer.label);}
    }
  };
  const sync=()=>{
    const view=last,me=view?.players.find(p=>p.id===ctxId),root=button.closest('.rh');
    tray.sync({view,hero,standing:!!me&&!me.spectator&&!me.eliminated&&!me.downed&&me.hp>0,
      offerOpen:!!root?.querySelector('.rh-offer:not([hidden])'),ended:!!root?.classList.contains('rh-ended')});
    paint();
  };
  const buy=(item:CidaItemId)=>{
    const n=tray.tap(item,options.onBuy);
    const req=tray.pending?.req;
    if(n&&req!==undefined&&tray.pending?.item===item){clearTimeout(pendingTimer);pendingTimer=setTimeout(()=>{show(tray.timeout(req));},CIDA_TIMEOUT_MS);}
    show(n);
  };
  for(const [item,{button:b}] of tags){
    // Pointer down answers at once (the tap is the purchase; a mouse's left button too, D-044); a keyboard click (detail 0) as well.
    b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();buy(item);});
    b.addEventListener('click',e=>{if(e.detail===0)buy(item);});
  }
  button.addEventListener('click',()=>{if(tray.toggle())paint();});
  close.addEventListener('click',()=>{if(tray.close())paint();});
  // Desktop (D-044): C opens or closes the tray while the button shows, 1–3 buy, Esc closes (desktop-input.ts cidaKeyOf:
  // never while typing, nor with the settings open; the match's own shell dialog does not count).
  const onKey=(e:KeyboardEvent)=>{
    const key=cidaKeyOf(e,!!doc.querySelector(`dialog[open]:not(${SHELL_DIALOG})`));
    if(!key)return;
    if(key.kind==='toggle'){if(tray.open||tray.shown){e.preventDefault();if(tray.toggle())paint();}return;}
    if(!tray.open)return;
    // Esc closes the tray and nothing else: the shell's 'cancel' (it opens the settings, explore.ts) never sees it.
    if(key.kind==='close'){e.preventDefault();e.stopPropagation();if(tray.close())paint();return;}
    e.preventDefault();const offer=tray.offers[key.index];if(offer)buy(offer.id);
  };
  // Capture: the tray answers before any other key listener of the page (Esc must not reach the shell).
  doc.addEventListener('keydown',onKey,{capture:true});
  // The button and the tray hold their own taps (VGM-040): nothing leaks to the joystick or the map.
  for(const node of [button,panel])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)node.addEventListener(type,event=>event.stopPropagation());

  return {
    el:panel,button,panel,
    get open(){return tray.open;},
    update(view:RunView,ctx:HudContext){last=view;ctxId=ctx.localId;sync();},
    setHero(at){hero=at&&{x:at.x,y:at.y};if(last)sync();},
    yieldTo(obra){tray.yieldTo(obra);paint();},
    bought(answer){
      const r=tray.reply(answer);
      if(!r)return;
      if(r.stamp){
        const b=tags.get(r.stamp)!.button;
        b.classList.add('rh-cida-feito');clearTimeout(stampTimer);
        stampTimer=setTimeout(()=>b.classList.remove('rh-cida-feito'),CIDA_STAMP_MS);
      }
      show(r.note);
    },
    destroy(){doc.removeEventListener('keydown',onKey,{capture:true});clearTimeout(noteTimer);clearTimeout(stampTimer);clearTimeout(pendingTimer);button.remove();panel.remove();},
  };
}
