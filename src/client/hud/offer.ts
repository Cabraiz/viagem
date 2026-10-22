/**
 * Upgrade offer (VGM-040, D-021, D-050, DSG-oferta-etiqueta): touch-only picker for the oldest pending offer.
 * - In combat (round phase "wave") a team level-up pauses the run for everyone (D-050: RunState.pause, in ctx.pause):
 *   the offer opens by itself as the compact window, with no clock of its own (the pause's HUD shows the time) and no
 *   "Depois". Outside a pause nothing shows in a wave, not even the old "+N" chip: a level inside the gap between two
 *   pauses (or one held while offline) waits for the next pause.
 * - In the intermission the offers open by themselves, one after the other, as a compact window: the deadline as a thin
 *   bar on its top edge, one header row (title, seconds, a clock icon labelled "vai no automático se acabar o tempo",
 *   a small "Depois") and one row of whole tags (BUG-20261013-ORQ-oferta-e-dicas-menores).
 * Each choice is a price tag from the corner shop (etiqueta); picking one stamps "LEVEI" on it (the one show moment),
 * with a "tum" and a 15 ms buzz. The DOM is rebuilt only when the shown offer changes.
 */
import {putAttr,putData,putHidden,putText} from './dom-put.ts';
import {SIM_HZ,type OfferSource} from '../../contract/index.ts';
import type {OfferView,RunView} from '../../contract/index.ts';
import {isHeldOffer} from '../../rules/index.ts';
import {itemDisplay,priceTag} from './items.ts';
import {sticker} from '../ui/sticker.ts';
import {OFFER_WINDOW_TITLE,RARITY_LABEL,REROLL_LABEL,SKIP_LABEL,WAIT_LINE,levelLabel,offerGain,offerRarity,offerValue} from './offer-card.ts';
import {fallLine,offerDeadlineFraction,offerMode,secondsLeft,type HudContext,type HudPart,type OfferMode} from './model.ts';

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
 * Pure view state of the offer UI, so the D-021/D-050 rules are unit-tested without a DOM:
 * - in a wave the panel shows only in a level-up pause (`paused`, D-050), by itself, with no chip and no clock;
 * - in the intermission it shows by itself unless folded, and the chip folds it away (`collapsed`) and back, so the
 *   island and the fallen stay reachable;
 * - the clock (bar, seconds, "automático" note) only when the server set a real deadline, never in a pause.
 */
export function offerUiState(view:RunView,collapsed=false,paused=false){
  const mode:OfferMode=offerMode(view),offer=view.offers[0];
  const pending=view.offers.length,intermission=mode==='intermission';
  const clock=!!offer&&!paused&&!isHeldOffer(offer);
  // The pause wins over the mode: with no round info (D-051 drops the rounds) offerMode says 'intermission'.
  return {mode,pending,chip:pending>0&&intermission&&!paused,panel:!!offer&&(paused||intermission&&!collapsed),clock,
    seconds:clock&&offer?secondsLeft(offer.deadlineTick,view.tick):undefined};
}

/** Every card is a first pick: the title says it ("Tudo novo!") and the stars shrink to a mark (DSG review D2). */
export const isAllNew=(offer:OfferView)=>offer.choices.length>1&&offer.choices.every(choice=>priceTag(choice.itemId,choice.level).kind==='new');

/** "Levar os indicados" shows when at least this many offers wait in the intermission. */
export const TAKE_ALL_MIN=2;
export const TAKE_ALL_LABEL='Levar os indicados';
/** Folds the intermission window into the chip, which opens it again (UX review janela-caido). */
export const LATER_LABEL='Depois';
/** hud.css's landscape breakpoint (the compact window keeps the same rows; only its place and sizes change there). */
export const LANDSCAPE_QUERY='(max-height:500px)';

export interface OfferPanelOptions {
  onChoose(offerId:string,index:number):void;
  /** Stamp feedback (sound "tum" + vibration); RunHud wires the audio engine. */
  onStamp?():void;
  /** A tap on the "+N" chip: the first-run coach learns it (VGM-056, hud/coach.ts holds the chip's first-time hint). */
  onChipTap?():void;
  /** This phone's player: the window's caído ficha never names you. */
  localId?:string;
  /** D-052 "Pular" / "Rolar de novo" on the shown offer (absent: the buttons stay off). */
  onSkip?(offerId:string):void;
  onReroll?(offerId:string):void;
}

export function createOfferPanel(options:OfferPanelOptions):HudPart&{chip:HTMLButtonElement}{
  // D-052: the centred window "Ofertas de melhoria" (offer-centro.css) on every screen; `.rh-offer` stays for the zones.
  const root=el('section','rh-offer rh-ofc');root.hidden=true;
  root.setAttribute('role','region');root.setAttribute('aria-label','Escolha de melhoria');root.lang='pt-BR';
  // BUG-20261013-ORQ-oferta-e-dicas-menores: a compact window. The clock is a thin bar along its top edge (no row of
  // its own); the header is one row: title, "+N na fila", the "automático" clock icon, the seconds and a small "Depois".
  // The tags are one row of small etiquetas (sticker, short name, price; the effect shows as a tooltip on hover, focus
  // or a held finger), always whole: they shrink to fit, never scroll nor hide under a "Mais N". "Levar os indicados"
  // is the row's last tile (Amarelo: a choice), right of the tags.
  const track=el('div','rh-offer-deadline',root),fill=el('i','rh-offer-deadline-fill',track);
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Tempo para escolher');
  const head=el('header','rh-offer-head',root);
  const title=el('strong','rh-offer-title',head);
  const queue=el('span','rh-offer-queue',head);
  // The old foot line ("vai no automático se acabar o tempo") is a clock icon; its words stay as the icon's label.
  const note=el('span','rh-offer-auto',head);note.setAttribute('role','img');note.setAttribute('aria-label',AUTO_NOTE);note.title=AUTO_NOTE;
  const time=el('span','rh-offer-time',head);
  const later=el('button','rh-offer-later',head);later.type='button';later.textContent=LATER_LABEL;later.hidden=true;
  later.setAttribute('aria-label','Depois: guarda a oferta no chip, que abre de novo');
  // Someone fell while the window is open: a Cone ficha under the title, first name and live seconds (janela-caido).
  const fall=el('p','rh-window-fall',root);fall.hidden=true;fall.setAttribute('role','status');
  const joke=el('p','rh-offer-joke',root);
  const cards=el('div','rh-offer-cards',root);
  const foot=el('footer','rh-offer-foot',root);
  const takeAll=el('button','rh-offer-all',foot);takeAll.type='button';takeAll.textContent=TAKE_ALL_LABEL;takeAll.hidden=true;
  // D-052 foot: "Esperando os outros jogadores…" while the pause waits for someone else, then Pular and Rolar de novo
  // with this player's counters (RunPause.skips / rerolls; off at 0 without them, e.g. an older room).
  const wait=el('p','rh-ofc-wait',root);wait.textContent=WAIT_LINE;wait.hidden=true;wait.setAttribute('role','status');
  const actions=el('div','rh-ofc-actions',root);
  const action=(cls:string,label:string)=>{
    const b=el('button',`rh-ofc-btn ${cls}`,actions);b.type='button';b.disabled=true;
    el('span','rh-ofc-btn-label',b).textContent=label;el('small','rh-ofc-btn-count',b).textContent='0';
    b.setAttribute('aria-label',`${label}: 0 restantes`);return b;
  };
  const skipBtn=action('rh-ofc-skip',SKIP_LABEL),rerollBtn=action('rh-ofc-reroll',REROLL_LABEL);
  // "Levar os indicados" joins the buttons' row (its own line on a narrow phone): the window stays short.
  actions.prepend(takeAll);

  const chip=el('button','rh-offer-chip');chip.type='button';chip.hidden=true;
  chip.setAttribute('aria-expanded','false');
  const chipCount=el('span','rh-offer-chip-count',chip);

  const shownAt=new Map<string,number>();
  const guard=new OfferTapGuard();
  const now=()=>performance.now();
  let shown:OfferView|undefined;
  let pending:{id:string;index:number;atTick?:number;atMs?:number}|undefined;
  /** The stamped offer stays on screen for STAMP_HOLD_MS, even after the server dropped it. */
  let stamp:{offer:OfferView;until:number}|undefined;
  let collapsed=false,takingAll=false,paused=false,lastPaused=false,lastMode:OfferMode|undefined,last:RunView|undefined;
  let lastSeconds=-1,lastPending=-1,lastQueue=-1,lastUrgent=false;
  let waitingIds:readonly string[]=[];
  let counts:{skips?:Record<string,number>;rerolls?:Record<string,number>}|undefined;
  /** A skip or reroll sent and not answered yet: the buttons wait for the offer to change (or a retry window). */
  let acting:{id:string;at:number}|undefined;
  let renderedAt=Number.NEGATIVE_INFINITY;

  const render=(offer:OfferView)=>{
    root.dataset.source=offer.source;
    const allNew=isAllNew(offer);const titleNew=allNew&&offer.source==='level';
    root.classList.toggle('rh-offer-all-new',titleNew);
    title.textContent=OFFER_WINDOW_TITLE;
    joke.textContent=offerJoke(offer.id,offer.source);
    root.dataset.count=cards.dataset.count=String(offer.choices.length);
    root.classList.remove('rh-offer-stamping');
    cards.replaceChildren(...offer.choices.map((choice,index)=>{
      const item=itemDisplay(choice.itemId),price=priceTag(choice.itemId,choice.level),flags=choiceFlags(offer,index);
      const card=el('button','rh-card');card.type='button';card.dataset.index=String(index);card.dataset.kind=price.kind;
      card.classList.toggle('rh-card-default',flags.isDefault);
      el('span','rh-card-icon',card).innerHTML=sticker(item.icon);
      // D-052: the rarity in the corner, "Niv N" at the right, the value line "atual > novo" (offer-card.ts).
      const rarity=offerRarity(choice.itemId,choice.level);card.dataset.rarity=rarity;
      el('small','rh-card-rarity',card).textContent=RARITY_LABEL[rarity];
      el('b','rh-card-level',card).textContent=levelLabel(choice.level);
      const body=el('span','rh-card-body',card);
      el('strong','rh-card-name',body).textContent=item.name;
      // Card upgrades-megabonk: the tome's gain, short and big ("+1 projétil", "+10% dano").
      const gain=offerGain(choice.itemId,choice.level);
      if(gain)el('b','rh-card-gain',body).textContent=gain;
      const value=offerValue(choice.itemId,choice.level),line=el('span','rh-card-value',body);
      if(value&&choice.level>1){line.append(`${value.label}: ${value.from} > `);el('b','rh-card-value-new',line).textContent=value.to;}
      else line.textContent=item.blurb;
      el('span','rh-card-blurb',body).textContent=item.blurb;
      el('em','rh-card-joke',body).textContent=item.joke;
      // "Novo!" lives in the price slot, like "Nv N" (the price of a launch); never floating over the icon.
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
    guard.rendered(offer.id,now());renderedAt=now();
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

  /** Picks `index` of the shown offer: stamp, sound, and the server command. */
  const pick=(index:number)=>{
    if(!shown)return;
    pending={id:shown.id,index};
    markPending();
    root.classList.add('rh-offer-stamping');
    stamp={offer:shown,until:now()+STAMP_HOLD_MS};
    try{options.onStamp?.();}catch{/* feedback is best effort */}
    options.onChoose(shown.id,index);
    // The chip counts down at once (≤ 100 ms feedback), without waiting for the next view.
    if(last)update(last);
    // The stamp ends on its own: in a pause (D-050) no tick brings the next view to end it.
    setTimeout(()=>{if(last)update(last);},STAMP_HOLD_MS+20);
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
    pick(index);
  });
  // "Levar os indicados": the whole queue gets its defaults, one at a time, each with its own stamp and in order
  // (the server applies each once and refuses a stale one; the next head is picked when it shows up).
  takeAll.addEventListener('click',()=>{
    if(!shown||pending)return;
    takingAll=true;
    pick(shown.defaultIndex);
  });
  later.addEventListener('click',()=>{if(lastMode!=='intermission')return;collapsed=true;if(last)update(last);});
  chip.addEventListener('click',()=>{
    if(lastMode!=='intermission')return;
    collapsed=!collapsed;
    // Opening counts as a new render for the tap guard: the finger that opened it cannot pick blind.
    if(!collapsed&&shown)guard.rendered(shown.id,now());
    try{options.onChipTap?.();}catch{/* the coach is best effort */}
    if(last)update(last);
  });

  /** One stamp-like beat on the chip when it appears or its number goes up (no loop: D-020). */
  const beat=()=>{chip.classList.remove('rh-offer-chip-beat');void chip.offsetWidth;chip.classList.add('rh-offer-chip-beat');};

  /** The buttons' counters and whether they can act now (an offer shown, nothing in flight, one left). */
  const paintActions=()=>{
    const local=options.localId??'',id=root.hidden||root.classList.contains('rh-ofc-only-wait')?undefined:shown?.id;
    if(acting&&(acting.id!==id||now()-acting.at>OFFER_RETRY_TICKS*1000/SIM_HZ))acting=undefined;
    const paint=(b:HTMLButtonElement,left:number|undefined,handler:unknown,label:string)=>{
      const n=left??0,text=String(n),count=b.querySelector('.rh-ofc-btn-count')!;
      if(count.textContent!==text){count.textContent=text;b.setAttribute('aria-label',`${label}: ${n} ${n===1?'restante':'restantes'}`);}
      const off=!handler||!id||!!pending||!!acting||!!stamp||left===undefined||left<=0;
      if(b.disabled!==off)b.disabled=off;
    };
    paint(skipBtn,counts?.skips?.[local],options.onSkip,SKIP_LABEL);
    paint(rerollBtn,counts?.rerolls?.[local],options.onReroll,REROLL_LABEL);
  };
  const act=(b:HTMLButtonElement,send:((offerId:string)=>void)|undefined)=>b.addEventListener('click',()=>{
    // The same guard as the cards: a finger that opened or re-rolled the window cannot fire blind.
    if(b.disabled||!shown||!send||now()-renderedAt<OFFER_TAP_GUARD_MS)return;
    acting={id:shown.id,at:now()};send(shown.id);paintActions();
    setTimeout(()=>{if(last)update(last);},OFFER_RETRY_TICKS*1000/SIM_HZ+20);
  });
  act(skipBtn,options.onSkip);act(rerollBtn,options.onReroll);

  function update(view:RunView,ctx?:HudContext){updateView(view,ctx);paintActions();}
  function updateView(view:RunView,ctx?:HudContext){
    last=view;
    if(ctx){paused=!!ctx.pause;waitingIds=ctx.pause?.waiting??[];counts=ctx.pause;}
    const offers=view.offers;
    const ids=new Set(offers.map(offer=>offer.id));
    const startTick=trackShownAt(shownAt,offers,view.tick);
    if(pending&&!ids.has(pending.id))pending=undefined;
    // A pick the room never answered is tried again: after OFFER_RETRY_TICKS, or that long on the wall clock in a
    // pause (D-050: the tick stands still there).
    if(pending){
      pending.atTick??=view.tick;pending.atMs??=now();
      if(view.tick-pending.atTick>OFFER_RETRY_TICKS||paused&&now()-pending.atMs>OFFER_RETRY_TICKS*1000/SIM_HZ){pending=undefined;stamp=undefined;shown=undefined;}
    }
    if(stamp&&now()>=stamp.until){stamp=undefined;root.classList.remove('rh-offer-stamping');}
    if(lastMode!==offerMode(view)||lastPaused!==paused){
      // A wave starting, or a pause opening or ending, closes whatever was open; each intermission opens the window
      // again, and "levar os indicados" only runs inside the intermission (or pause) it began in.
      const mode=offerMode(view);
      collapsed=false;takingAll=false;
      // The pause's window is the whole one (title, names, effects: the game stands still), not the combat strip.
      lastMode=mode;lastPaused=paused;root.dataset.mode=paused?'pause':mode;
    }
    const state=offerUiState(view,collapsed,paused);
    if(!state.pending)takingAll=false;
    // The chosen offer is no longer "waiting", even before the server drops it.
    const waiting=offers.filter(offer=>offer.id!==pending?.id).length;
    const chipWas=chip.hidden;
    putHidden(chip,!state.chip||waiting<=0);
    putData(chip,'mode',state.mode);
    if(waiting!==lastPending&&waiting>0){
      if(chipWas||waiting>lastPending)beat();
      lastPending=waiting;const text=chipText(waiting);
      chipCount.textContent=text.label;chip.setAttribute('aria-label',text.aria);
    }
    if(waiting<=0)lastPending=0;
    const offer=stamp?.offer??offers[0];
    const visible=!!stamp||(!!offer&&offer.choices.length>0&&state.panel);
    putAttr(chip,'aria-expanded',String(visible));
    // D-052: in a pause the window waits with the team: someone else still picks ("Esperando os outros jogadores…"),
    // and once this phone picked it stays as just that line and the buttons until the room resumes.
    const local=options.localId??'',othersWait=paused&&waitingIds.some(id=>id!==local);
    putHidden(wait,!othersWait);
    const onlyWait=othersWait&&!waitingIds.includes(local)&&(!visible||!offer);
    root.classList.toggle('rh-ofc-only-wait',onlyWait);
    if(onlyWait){if(!offer)shown=undefined;cards.replaceChildren();putText(title,OFFER_WINDOW_TITLE);putData(root,'count','0');putHidden(root,false);return;}
    if(!visible||!offer){if(!offer)shown=undefined;putHidden(root,true);return;}
    putHidden(root,false);
    if(offer.id!==shown?.id){shown=offer;render(offer);markPending();}
    else if(!stamp)shown=offer;
    if(stamp)return;
    if(root.classList.contains('rh-offer-pending')!==(!!pending&&pending.id===offer.id))markPending();
    // Taking all: the next head gets its default as soon as the previous stamp is done.
    if(takingAll&&!pending&&(state.mode==='intermission'||paused)){pick(offer.defaultIndex);return;}
    putHidden(takeAll,!((state.mode==='intermission'||paused)&&offers.length>=TAKE_ALL_MIN));
    putHidden(later,state.mode!=='intermission'||paused);
    const line=state.mode==='intermission'?fallLine(view,options.localId??''):'';
    if(fall.textContent!==line){
      // "Zé caiu, 27 s." and the hint " Dá pra andar." in their own spans (the forge drops the hint in landscape).
      writeFallLine(fall,line);
      fall.hidden=!line;
    }
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

  return {el:root,chip,update,destroy(){}};
}

/**
 * The caído ficha of a window: "Zé caiu, 27 s." and the hint " Dá pra andar." in their own spans, so a short window (the
 * landscape forge) shows one line without the hint (design review pacote-bugs-ux).
 */
export function writeFallLine(node:HTMLElement,line:string){
  const cut=line.indexOf('. ')+1,who=cut>0?line.slice(0,cut):line,hint=cut>0?line.slice(cut):'';
  const a=document.createElement('span');a.textContent=who;
  const b=document.createElement('span');b.className='rh-window-fall-hint';b.textContent=hint;
  node.replaceChildren(a,...(hint?[b]:[]));
}
