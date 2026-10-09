/**
 * Upgrade offer panel (VGM-040): non-blocking, touch-only card picker for the oldest pending offer.
 * Level-ups read lilac/XP, end-of-round offers read gold/marquee. The DOM is rebuilt only when the
 * shown offer changes; per-tick updates touch just the deadline bar and the countdown text.
 */
import {SIM_HZ,type OfferSource} from '../sim/types.ts';
import type {OfferView,RunView} from '../sim/view.ts';
import {itemDisplay,levelTag} from './items.ts';
import {offerDeadlineFraction,offerTitle,secondsLeft,type HudPart} from './model.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

/** Seconds left at which the deadline turns coral and pulses. */
export const OFFER_URGENT_SECONDS=3;
/** A choice the server has not confirmed (offer still pending) is unlocked after this, so a lost `choose` on 4G can be retried. */
export const OFFER_RETRY_TICKS=Math.round(2.5*SIM_HZ);

const jokes:Record<OfferSource,readonly string[]>={
  level:[
    'Escolhe rápido que o bicho não espera',
    'Subiu de nível sem nem estudar',
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

/** One goofy line per offer, picked deterministically from its id and source. */
export function offerJoke(offerId:string,source:OfferSource){
  const lines=jokes[source]??jokes.level;
  return lines[hashId(offerId)%lines.length];
}

/** Clicks are ignored unless the finger went down this long after the shown offer was rendered. */
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
 * Tick each offer became the head (offers[0]). Queued offers are not timed yet: the server chains their
 * deadlines (each one starts when the previous resolves), so timing them from the queue would start the
 * bar half empty. Returns the head's start tick.
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

/** Card flags: the default pick (applied on timeout) and the 4th "luck" slot. */
export function choiceFlags(offer:OfferView,index:number){
  return {isDefault:index===offer.defaultIndex,luck:index===3};
}

export function createOfferPanel(options:{onChoose(offerId:string,index:number):void}):HudPart{
  const root=el('section','rh-offer');root.hidden=true;
  root.setAttribute('role','region');root.setAttribute('aria-label','Escolha de melhoria');
  const head=el('header','rh-offer-head',root);
  const eyebrow=el('span','rh-offer-eyebrow',head),title=el('strong','rh-offer-title',head);
  const queue=el('span','rh-offer-queue',head),time=el('span','rh-offer-time',head);
  const joke=el('p','rh-offer-joke',root);
  const track=el('div','rh-offer-deadline',root),fill=el('i','rh-offer-deadline-fill',track);
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Tempo para escolher');
  const cards=el('div','rh-offer-cards',root);

  const shownAt=new Map<string,number>();
  const guard=new OfferTapGuard();
  const now=()=>performance.now();
  let shown:OfferView|undefined;
  let pending:{id:string;index:number;atTick?:number}|undefined;
  let lastSeconds=-1,lastQueue=-1,lastUrgent=false;

  const render=(offer:OfferView)=>{
    const heading=offerTitle(offer);
    root.dataset.source=offer.source;
    eyebrow.textContent=heading.eyebrow;title.textContent=heading.title;
    joke.textContent=offerJoke(offer.id,offer.source);
    root.dataset.count=cards.dataset.count=String(offer.choices.length);
    cards.replaceChildren(...offer.choices.map((choice,index)=>{
      const item=itemDisplay(choice.itemId),tag=levelTag(choice.itemId,choice.level),flags=choiceFlags(offer,index);
      const card=el('button','rh-card');card.type='button';card.dataset.index=String(index);
      card.dataset.kind=item.kind==='evolution'?'evo':item.kind==='snack'?'snack':choice.level<=1?'new':'up';
      card.classList.toggle('rh-card-default',flags.isDefault);card.classList.toggle('rh-card-luck',flags.luck);
      el('span','rh-card-icon',card).textContent=item.icon;
      const body=el('span','rh-card-body',card);
      el('strong','rh-card-name',body).textContent=item.name;
      el('span','rh-card-level',body).textContent=tag;
      el('span','rh-card-blurb',body).textContent=item.blurb;
      el('em','rh-card-joke',body).textContent=item.joke;
      if(flags.isDefault||flags.luck){
        const marks=el('span','rh-card-flags',card);
        if(flags.luck)el('span','rh-card-flag rh-card-flag-luck',marks).textContent='🍀 sorte!';
        if(flags.isDefault)el('span','rh-card-flag rh-card-flag-default',marks).textContent='padrão';
      }
      card.setAttribute('aria-label',`${item.name}, ${tag}. ${item.blurb}${flags.isDefault?' Escolha padrão quando o tempo acabar.':''}`);
      return card;
    }));
    guard.rendered(offer.id,now());
    root.classList.remove('rh-offer-pending','rh-offer-in');void root.offsetWidth;root.classList.add('rh-offer-in');
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
    options.onChoose(shown.id,index);
  });

  return {el:root,update(view:RunView){
    const offers=view.offers;
    const ids=new Set(offers.map(offer=>offer.id));
    const startTick=trackShownAt(shownAt,offers,view.tick);
    if(pending&&!ids.has(pending.id))pending=undefined;
    if(pending){pending.atTick??=view.tick;if(view.tick-pending.atTick>OFFER_RETRY_TICKS)pending=undefined;}
    const offer=offers[0];
    if(!offer||!offer.choices.length){shown=undefined;root.hidden=true;return;}
    root.hidden=false;
    if(offer.id!==shown?.id){shown=offer;render(offer);markPending();}
    else shown=offer;
    if(root.classList.contains('rh-offer-pending')!==(!!pending&&pending.id===offer.id))markPending();
    const fraction=offerDeadlineFraction(offer,view.tick,startTick??view.tick);
    fill.style.transform=`scaleX(${fraction})`;
    const seconds=secondsLeft(offer.deadlineTick,view.tick);
    if(seconds!==lastSeconds){
      lastSeconds=seconds;time.textContent=`${seconds} s`;
      track.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
    }
    const urgent=seconds<=OFFER_URGENT_SECONDS;
    if(urgent!==lastUrgent){lastUrgent=urgent;root.classList.toggle('rh-offer-urgent',urgent);}
    const queued=offers.length-1;
    if(queued!==lastQueue){lastQueue=queued;queue.textContent=queueLabel(queued);queue.hidden=queued<=0;}
  }};
}
