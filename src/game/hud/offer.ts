/**
 * Upgrade offer (VGM-040, D-021, DSG-oferta-etiqueta): non-blocking, touch-only picker for the oldest pending offer.
 * - In combat (round phase "wave") nothing opens by itself: a "+N" chip waits in the right-thumb zone and a tap opens a
 *   compact panel (icon, name, price, one effect line; no joke, no clock while the server holds the offer).
 * - In the intermission the offers open by themselves, one after the other, as the full window: title, joke, the
 *   flat deadline bar and "vai no automático se acabar o tempo".
 * Each choice is a price tag from the corner shop (etiqueta); picking one stamps "LEVEI" on it (the one show moment),
 * with a "tum" and a 15 ms buzz. The DOM is rebuilt only when the shown offer changes.
 */
import {SIM_HZ,type OfferSource} from '../sim/types.ts';
import type {OfferView,RunView} from '../sim/view.ts';
import {isHeldOffer} from '../sim/offers.ts';
import {itemDisplay,priceTag} from './items.ts';
import {offerDeadlineFraction,offerMode,offerTitle,secondsLeft,type HudPart,type OfferMode} from './model.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

/** Seconds left at which the deadline turns Laranja Cone (static, no blink). */
export const OFFER_URGENT_SECONDS=3;
/** A choice the server has not confirmed (offer still pending) is unlocked after this, so a lost `choose` on 4G can be retried. */
export const OFFER_RETRY_TICKS=Math.round(2.5*SIM_HZ);
/** The stamp hits in 140 ms; the stamped tag stays this long before the next offer takes its place. */
export const STAMP_MS=140,STAMP_HOLD_MS=420;
export const AUTO_NOTE='vai no automático se acabar o tempo';

const jokes:Record<OfferSource,readonly string[]>={
  level:[
    'Escolhe rápido que o bicho não espera',
    'Subiu sem nem estudar',
    'O XP bateu. Agora decide, campeão',
    'Pensa rápido, mas pensa bonito',
  ],
  round:[
    'Promoção relâmpago de poder',
    'Brinde do síndico por sobreviver',
    'Leva um, os bichos pagam o outro',
    'Oferta válida só neste intervalo',
  ],
};

/** Stable FNV-1a hash so the same offer id always gets the same line. */
export function hashId(id:string){
  let hash=0x811c9dc5;
  for(let i=0;i<id.length;i++){hash^=id.charCodeAt(i);hash=Math.imul(hash,0x01000193);}
  return hash>>>0;
}

/** One goofy line per offer, picked deterministically from its id and source (shown only in the intermission). */
export function offerJoke(offerId:string,source:OfferSource){
  const lines=jokes[source]??jokes.level;
  return lines[hashId(offerId)%lines.length];
}

/** Clicks are ignored unless the finger went down this long after the shown offer was rendered (or the panel opened). */
export const OFFER_TAP_GUARD_MS=350;

/**
 * Guards against choosing blind: with "+N na fila", picking offer A renders offer B in the same spot, and a
 * quick second tap would land on B. A click only counts when its pointerdown hit the same card of the same
 * offer at least OFFER_TAP_GUARD_MS after that offer appeared. Pure (times injected) so it is unit-tested.
 */
export class OfferTapGuard {
  private offerId?:string;
  private renderedAt=Number.NEGATIVE_INFINITY;
  private down?:{offerId:string;index:number;at:number};
  rendered(offerId:string,now:number){this.offerId=offerId;this.renderedAt=now;this.down=undefined;}
  pointerDown(offerId:string,index:number,now:number){this.down={offerId,index,at:now};}
  /** `assistive`: activation without a pointer (screen reader, keyboard); only the render delay applies. */
  accept(offerId:string,index:number,now:number,assistive=false){
    const down=this.down;this.down=undefined;
    if(offerId!==this.offerId)return false;
    if(assistive)return now-this.renderedAt>=OFFER_TAP_GUARD_MS;
    return !!down&&down.offerId===offerId&&down.index===index&&down.at-this.renderedAt>=OFFER_TAP_GUARD_MS;
  }
}

/**
 * Tick each offer became the head (offers[0]), so its deadline bar starts full when it is shown, not when it was
 * queued. Returns the head's start tick.
 */
export function trackShownAt(shownAt:Map<string,number>,offers:readonly OfferView[],tick:number){
  const ids=new Set(offers.map(offer=>offer.id));
  for(const id of shownAt.keys())if(!ids.has(id))shownAt.delete(id);
  const head=offers[0];
  if(!head)return undefined;
  if(!shownAt.has(head.id))shownAt.set(head.id,tick);
  return shownAt.get(head.id);
}

export const queueLabel=(queued:number)=>queued>0?`+${queued} na fila`:'';

/** Card flags: the default pick (applied when the clock runs out) and the 4th "luck" slot. */
export function choiceFlags(offer:OfferView,index:number){
  return {isDefault:index===offer.defaultIndex,luck:index===3};
}

/** The chip: "+N" offers waiting, and what a screen reader hears. */
export function chipText(pending:number){
  return {label:`+${pending}`,aria:`${pending} ${pending===1?'melhoria esperando':'melhorias esperando'}. Toca pra escolher.`};
}

/**
 * Pure view state of the offer UI, so the D-021 rules are unit-tested without a DOM:
 * the chip shows in combat whenever something waits; the panel shows in the intermission by itself, in combat only
 * while opened from the chip; the clock (bar, seconds, "automático" note) only when the server set a real deadline.
 */
export function offerUiState(view:RunView,open:boolean){
  const mode:OfferMode=offerMode(view),offer=view.offers[0];
  const pending=view.offers.length;
  const clock=!!offer&&!isHeldOffer(offer);
  return {mode,pending,chip:mode==='combat'&&pending>0,panel:!!offer&&(mode==='intermission'||open),clock,
    seconds:clock&&offer?secondsLeft(offer.deadlineTick,view.tick):undefined};
}

export interface OfferPanelOptions {
  onChoose(offerId:string,index:number):void;
  /** Stamp feedback (sound "tum" + vibration); RunHud wires the audio engine. */
  onStamp?():void;
}

export function createOfferPanel(options:OfferPanelOptions):HudPart&{chip:HTMLButtonElement}{
  const root=el('section','rh-offer');root.hidden=true;
  root.setAttribute('role','region');root.setAttribute('aria-label','Escolha de melhoria');
  const head=el('header','rh-offer-head',root);
  const title=el('strong','rh-offer-title',head);
  const queue=el('span','rh-offer-queue',head),time=el('span','rh-offer-time',head);
  const joke=el('p','rh-offer-joke',root);
  const track=el('div','rh-offer-deadline',root),fill=el('i','rh-offer-deadline-fill',track);
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Tempo para escolher');
  const cards=el('div','rh-offer-cards',root);
  const note=el('p','rh-offer-auto',root);note.textContent=AUTO_NOTE;

  const chip=el('button','rh-offer-chip');chip.type='button';chip.hidden=true;
  chip.setAttribute('aria-expanded','false');
  const chipCount=el('span','rh-offer-chip-count',chip);

  const shownAt=new Map<string,number>();
  const guard=new OfferTapGuard();
  const now=()=>performance.now();
  let shown:OfferView|undefined;
  let pending:{id:string;index:number;atTick?:number}|undefined;
  /** The stamped offer stays on screen for STAMP_HOLD_MS, even after the server dropped it. */
  let stamp:{offer:OfferView;until:number}|undefined;
  let open=false,lastMode:OfferMode|undefined,last:RunView|undefined;
  let lastSeconds=-1,lastPending=-1,lastQueue=-1,lastUrgent=false;

  const render=(offer:OfferView)=>{
    root.dataset.source=offer.source;
    title.textContent=offerTitle(offer).title;
    joke.textContent=offerJoke(offer.id,offer.source);
    root.dataset.count=cards.dataset.count=String(offer.choices.length);
    root.classList.remove('rh-offer-stamping');
    cards.replaceChildren(...offer.choices.map((choice,index)=>{
      const item=itemDisplay(choice.itemId),price=priceTag(choice.itemId,choice.level),flags=choiceFlags(offer,index);
      const card=el('button','rh-card');card.type='button';card.dataset.index=String(index);card.dataset.kind=price.kind;
      card.classList.toggle('rh-card-default',flags.isDefault);
      el('span','rh-card-icon',card).textContent=item.icon;
      const body=el('span','rh-card-body',card);
      el('strong','rh-card-name',body).textContent=item.name;
      el('span','rh-card-blurb',body).textContent=item.blurb;
      el('em','rh-card-joke',body).textContent=item.joke;
      if(price.kind==='level'){
        const tag=el('span','rh-card-price',card);
        el('small','rh-card-price-unit',tag).textContent='Nv';
        el('b','rh-card-price-value',tag).textContent=String(price.level);
      }else if(price.kind==='new')el('span','rh-card-star',card).append(Object.assign(document.createElement('span'),{textContent:price.label}));
      else el('span','rh-card-tag',card).textContent=price.label;
      const mark=el('span','rh-card-stamp',card);mark.textContent='LEVEI';mark.setAttribute('aria-hidden','true');
      card.setAttribute('aria-label',`${item.name}, ${price.label}. ${item.blurb}${flags.isDefault?' Vai no automático se acabar o tempo.':''}`);
      return card;
    }));
    guard.rendered(offer.id,now());
    lastSeconds=-1;
  };

  const markPending=()=>{
    const active=!!pending&&pending.id===shown?.id;
    root.classList.toggle('rh-offer-pending',active);
    for(const card of cards.children as HTMLCollectionOf<HTMLButtonElement>){
      card.disabled=active;
      card.classList.toggle('rh-card-chosen',active&&Number(card.dataset.index)===pending?.index);
    }
  };

  cards.addEventListener('pointerdown',event=>{
    const card=(event.target as HTMLElement).closest<HTMLButtonElement>('.rh-card');
    if(card&&shown)guard.pointerDown(shown.id,Number(card.dataset.index),now());
  });
  cards.addEventListener('click',event=>{
    const card=(event.target as HTMLElement).closest<HTMLButtonElement>('.rh-card');
    if(!card||!shown||pending)return;
    const index=Number(card.dataset.index);
    if(!(index>=0&&index<shown.choices.length))return;
    // detail===0: activated without a pointer (screen reader / keyboard).
    if(!guard.accept(shown.id,index,now(),event.detail===0))return;
    pending={id:shown.id,index};
    markPending();
    root.classList.add('rh-offer-stamping');
    stamp={offer:shown,until:now()+STAMP_HOLD_MS};
    try{options.onStamp?.();}catch{/* feedback is best effort */}
    options.onChoose(shown.id,index);
    // The chip counts down at once (≤ 100 ms feedback), without waiting for the next view.
    if(last)update(last);
  });
  chip.addEventListener('click',()=>{
    open=!open;
    // Opening counts as a new render for the tap guard: the finger that opened it cannot pick blind.
    if(open&&shown)guard.rendered(shown.id,now());
    if(last)update(last);
  });

  function update(view:RunView){
    last=view;
    const offers=view.offers;
    const ids=new Set(offers.map(offer=>offer.id));
    const startTick=trackShownAt(shownAt,offers,view.tick);
    if(pending&&!ids.has(pending.id))pending=undefined;
    if(pending){pending.atTick??=view.tick;if(view.tick-pending.atTick>OFFER_RETRY_TICKS){pending=undefined;stamp=undefined;shown=undefined;}}
    if(stamp&&now()>=stamp.until)stamp=undefined;
    const state=offerUiState(view,open);
    if(state.mode!==lastMode){
      // A wave starting closes whatever was open: in combat the panel only shows after a tap on the chip.
      if(state.mode==='combat')open=false;
      lastMode=state.mode;root.dataset.mode=state.mode;
    }
    if(!state.pending)open=false;
    // The chosen offer is no longer "waiting", even before the server drops it.
    const waiting=offers.filter(offer=>offer.id!==pending?.id).length;
    chip.hidden=!(state.mode==='combat'&&waiting>0);
    if(waiting!==lastPending&&waiting>0){
      lastPending=waiting;const text=chipText(waiting);
      chipCount.textContent=text.label;chip.setAttribute('aria-label',text.aria);
    }
    chip.setAttribute('aria-expanded',String(open||!!stamp));
    const offer=stamp?.offer??offers[0];
    const visible=!!stamp||(!!offer&&offer.choices.length>0&&(state.mode==='intermission'||open));
    if(!visible||!offer){if(!offer)shown=undefined;root.hidden=true;return;}
    root.hidden=false;
    if(offer.id!==shown?.id){shown=offer;render(offer);markPending();}
    else if(!stamp)shown=offer;
    if(stamp)return;
    if(root.classList.contains('rh-offer-pending')!==(!!pending&&pending.id===offer.id))markPending();
    root.classList.toggle('rh-offer-clock',state.clock);
    if(state.clock){
      const fraction=offerDeadlineFraction(offer,view.tick,startTick??view.tick);
      fill.style.transform=`scaleX(${fraction})`;
      const seconds=state.seconds!;
      if(seconds!==lastSeconds){
        lastSeconds=seconds;time.textContent=`${seconds} s`;
        track.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
      }
      const urgent=seconds<=OFFER_URGENT_SECONDS;
      if(urgent!==lastUrgent){lastUrgent=urgent;root.classList.toggle('rh-offer-urgent',urgent);}
    }else if(lastUrgent){lastUrgent=false;root.classList.remove('rh-offer-urgent');}
    const queued=offers.length-1;
    if(queued!==lastQueue){lastQueue=queued;queue.textContent=queueLabel(queued);queue.hidden=queued<=0;}
  }

  return {el:root,chip,update};
}
