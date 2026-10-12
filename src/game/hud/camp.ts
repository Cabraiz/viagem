/**
 * Stonewards HUD (VGM-046B), three pieces in the zones of UX-zonas-tela:
 * - the base ficha (status, top band): the wall's life (bar + number) and the team's coco and pedra, always in a run;
 * - the forge window (an intermission window, like the round offer): opens by itself while the hero stands in the camp
 *   during the intermission and no offer is open; three price tags, one tap buys for the team. Tags the team cannot
 *   buy stay readable with a padlock and say why on tap (no dead button);
 * - the horn notice (announcement slot): "Volta pra base" with the seconds left and an arrow to the base; inside the
 *   camp it says when the critters arrive. In a wave, the wall crossing 50% and 25% shows here for 3 s.
 * Pure DOM over RunView plus what explore.ts knows on the client (the hero's predicted spot, the base's direction on
 * screen); every number comes from the room. Names always through textContent.
 */
import type {RunView,StructureView} from '../sim/view.ts';
import {CAMP_RADIUS,FORGE_REFUSALS,RECIPES,RECIPE_IDS,canPay,type Balance,type RecipeId} from '../sim/stonewards/rules.ts';
import {icon,type IconName} from '../../ui/icon.ts';
import {sticker,type StickerName} from '../../ui/sticker.ts';
import {fallLine,secondsLeft,type HudContext,type HudPart} from './model.ts';
import {writeFallLine} from './offer.ts';
import {watchOverflow} from './overflow.ts';

/** Forge answers slower than this are given up (the tag comes back, the note says so). */
export const FORGE_TIMEOUT_MS=3000;
/** A bought tag keeps its "LEVEI" stamp this long. */
export const FORGE_STAMP_MS=900;
/** Wall warnings in a wave (fraction crossed downwards) and how long each shows. */
export const WALL_WARNINGS=[.5,.25] as const;
export const WALL_WARNING_MS=3000;
/** Max towers at once (forge.ts MAX_TOWERS; kept here so the HUD does not bundle the server forge). */
export const MAX_TOWERS=3;
/** Highest weapon level (evolutions.ts; gambiarra only raises a weapon below it). */
const MAX_WEAPON_LEVEL=8;

/** The tower throws the same Chinelo da Mãe the run offers, so it wears that item's sticker (DSG-adesivos-itens). */
export const RECIPE_ICON:Readonly<Record<RecipeId,IconName|{sticker:StickerName}>>={reparo:'muralha',gambiarra:'fita','torre-chinelo':{sticker:'chinelo'}};
const recipeArt=(art:IconName|{sticker:StickerName})=>typeof art==='string'?icon(art,{size:32}):sticker(art.sticker,{size:32});

export interface ForgeAnswer {req:number;recipe:string;ok:boolean;reason?:string}
export interface CampOptions {
  /** Sends the purchase; returns the request id, or undefined when it cannot reach the room now. */
  onForge(recipe:RecipeId):number|undefined;
}
/** Where the hero is (client prediction) and where the base lies on screen (degrees, 0 = right, clockwise). */
export interface HeroSpot {x:number;y:number;bearing?:number}

/** Why a tag cannot be bought right now, or undefined when it can (pure, tested). */
export function blockedReason(recipe:RecipeId,view:Pick<RunView,'camp'|'structures'|'players'>,localId:string):string|undefined{
  const camp=view.camp;
  if(!camp)return 'phase';
  if(camp.wallDown)return 'wall-down';
  if(!canPay(camp,RECIPES[recipe].cost))return 'balance';
  if(recipe==='reparo'){const w=wallOf(view.structures);if(w&&w.hp>=w.maxHp)return 'full';}
  if(recipe==='torre-chinelo'&&view.structures.filter(s=>s.kind!=='muralha').length>=MAX_TOWERS)return 'full';
  if(recipe==='gambiarra'){
    const me=view.players.find(p=>p.id===localId);
    if(me&&!me.weapons.some(w=>!w.id.endsWith('-evo')&&w.level<MAX_WEAPON_LEVEL))return 'no-weapon';
  }
  return undefined;
}
/** What is missing for a recipe, "Falta 1 pedra" style (pure, tested). */
export function missing(balance:Balance,recipe:RecipeId){
  const cost=RECIPES[recipe].cost,parts:string[]=[];
  for(const kind of ['coco','pedra'] as const){const n=cost[kind]-balance[kind];if(n>0)parts.push(`${n} ${kind}`);}
  return parts.length?`Falta ${parts.join(' e ')}.`:'';
}
export const wallOf=(structures:readonly StructureView[])=>structures.find(s=>s.kind==='muralha');
/** Whether the hero stands in the camp (the forge works there). */
export const inCamp=(hero:HeroSpot|undefined,wall:StructureView|undefined)=>!!hero&&!!wall&&Math.hypot(hero.x-wall.x,hero.y-wall.y)<=CAMP_RADIUS;

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export interface CampPart extends HudPart {
  /** The base ficha, for the top band. */
  readonly readout:HTMLElement;
  /** The horn / wall notice, for the announcement slot. */
  readonly notice:HTMLElement;
  /** The forge window. */
  readonly forge:HTMLElement;
  /** The room's answer to a forge tap. */
  forged(answer:ForgeAnswer):void;
  setHero(spot:HeroSpot|undefined):void;
}

export function createCamp(options:CampOptions):CampPart{
  // ---------- Base ficha ----------
  const readout=el('div','rh-camp');readout.hidden=true;readout.setAttribute('role','group');readout.setAttribute('aria-label','Base');
  const wallRow=el('span','rh-camp-wall',readout);
  // The base has one symbol everywhere (design onda 6 D10): the tent with its flag, as on the map, the arrows and the minimap.
  wallRow.insertAdjacentHTML('beforeend',icon('base',{label:'Base'}));
  const track=el('span','rh-camp-track',wallRow),fill=el('i','rh-camp-fill',track),hp=el('b','rh-camp-hp',wallRow);
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Vida da muralha');
  const res=el('span','rh-camp-res',readout);
  const coco=el('span','rh-camp-item',res);coco.insertAdjacentHTML('beforeend',icon('coco',{label:'Coco'}));const cocoN=el('b','',coco);
  const pedra=el('span','rh-camp-item',res);pedra.insertAdjacentHTML('beforeend',icon('pedra',{label:'Pedra'}));const pedraN=el('b','',pedra);

  // ---------- Horn / wall notice ----------
  const notice=el('div','rh-alert rh-horn');notice.hidden=true;notice.setAttribute('role','status');
  const noticeRow=el('span','rh-horn-row',notice);
  // The gathering tip of the first intermission moved to the first-run coach (VGM-056, hud/coach.ts).
  noticeRow.insertAdjacentHTML('beforeend',`<span class="rh-horn-icon" data-for="horn">${icon('corneta')}</span><span class="rh-horn-icon" data-for="wall">${icon('muralha')}</span>`);
  const noticeText=el('span','rh-horn-text',noticeRow),noticeTime=el('b','rh-horn-time',noticeRow);
  const arrow=el('span','rh-horn-arrow',noticeRow);arrow.insertAdjacentHTML('beforeend',icon('voltar',{label:'Direção da base'}));
  const noticeJoke=el('span','rh-horn-joke',notice);

  // ---------- Forge window ----------
  const forge=el('section','rh-forge');forge.hidden=true;forge.setAttribute('aria-label','Forja');
  const head=el('div','rh-forge-head',forge);
  const title=el('h2','rh-forge-title',head);title.textContent='Forja';
  const close=el('button','rh-forge-close',head);close.type='button';close.setAttribute('aria-label','Fechar a forja');close.insertAdjacentHTML('beforeend',icon('fechar',{size:32}));
  const list=el('div','rh-forge-tags',forge);
  const tags=new Map<RecipeId,{button:HTMLButtonElement;lock:HTMLElement;full:HTMLElement}>();
  for(const id of RECIPE_IDS){
    const r=RECIPES[id],button=el('button','rh-forge-tag',list);button.type='button';button.dataset.recipe=id;
    button.insertAdjacentHTML('beforeend',`<span class="rh-forge-icon">${recipeArt(RECIPE_ICON[id])}</span>`);
    const body=el('span','rh-forge-body',button);
    el('strong','rh-forge-name',body).textContent=r.name;
    el('span','rh-forge-desc',body).textContent=r.describe;
    const price=el('span','rh-forge-price',button);
    for(const kind of ['coco','pedra'] as const){
      const part=el('span','rh-forge-cost',price);el('b','',part).textContent=String(r.cost[kind]);
      part.insertAdjacentHTML('beforeend',icon(kind,{label:kind==='coco'?'coco':'pedra'}));
    }
    const lock=el('span','rh-forge-lock',price);lock.insertAdjacentHTML('beforeend',icon('cadeado',{label:'Sem saldo'}));lock.hidden=true;
    // Nothing to do (wall already full, three towers up): a check, not only a paler tag (review onda 6, B8).
    const full=el('span','rh-forge-full',price);full.insertAdjacentHTML('beforeend',icon('pronto',{label:'Já tá no máximo'}));full.hidden=true;
    el('span','rh-forge-stamp',button).textContent='LEVEI';
    tags.set(id,{button,lock,full});
  }
  const note=el('p','rh-forge-note',head);note.setAttribute('aria-live','polite');
  // Someone fell while the forge is open: a Cone ficha in the note's place (the note comes back for a tap's answer).
  const fall=el('p','rh-window-fall rh-forge-fall',head);fall.hidden=true;fall.setAttribute('role','status');
  const overflow=watchOverflow(list);

  let last:RunView|undefined,ctxId='',hero:HeroSpot|undefined;
  let dismissed=false,stint=-1,wasInCamp=false;
  let pending:{req:number;recipe:RecipeId;timer:ReturnType<typeof setTimeout>}|undefined;
  let stampTimer:ReturnType<typeof setTimeout>|undefined,noteTimer:ReturnType<typeof setTimeout>|undefined;
  let lastFraction:number|undefined,warning:{text:string;until:number}|undefined,warnTimer:ReturnType<typeof setTimeout>|undefined;

  const say=(text:string,keep=false)=>{
    note.textContent=text;note.hidden=false;fall.hidden=true;clearTimeout(noteTimer);
    if(!keep)noteTimer=setTimeout(()=>{note.textContent=DEFAULT_NOTE;},2600);
  };
  const DEFAULT_NOTE='O saldo é da turma. Toca pra comprar.';
  note.textContent=DEFAULT_NOTE;

  const tap=(id:RecipeId)=>{
    if(!last||pending)return;
    const reason=blockedReason(id,last,ctxId);
    if(reason){say(reason==='balance'&&last.camp?missing(last.camp,id):FORGE_REFUSALS[reason]??'Agora não dá.');return;}
    const req=options.onForge(id);
    if(req===undefined){say('Sem conexão com a sala. Tenta de novo.');return;}
    tags.get(id)!.button.classList.add('rh-forge-pending');tags.get(id)!.button.setAttribute('aria-busy','true');
    say('Forjando…',true);
    pending={req,recipe:id,timer:setTimeout(()=>{if(pending?.req===req){clearPending();say('Sem resposta da sala. Tenta de novo.');}},FORGE_TIMEOUT_MS)};
  };
  const clearPending=()=>{
    if(!pending)return;
    clearTimeout(pending.timer);
    const t=tags.get(pending.recipe)!;t.button.classList.remove('rh-forge-pending');t.button.removeAttribute('aria-busy');
    pending=undefined;
  };
  for(const [id,{button}] of tags){
    // Pointer down answers at once (the tap is the purchase); a keyboard click (detail 0) is the debug fallback (D-009).
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();tap(id);});
    button.addEventListener('click',e=>{if(e.detail===0)tap(id);});
  }
  close.addEventListener('click',()=>{dismissed=true;forge.hidden=true;});
  // The window holds its own taps (VGM-040): nothing leaks to the joystick or the map.
  for(const node of [forge,readout,notice])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)node.addEventListener(type,event=>event.stopPropagation());

  const render=()=>{
    const view=last;
    const camp=view?.camp;
    readout.hidden=!camp;
    if(!view||!camp){forge.hidden=true;notice.hidden=true;return;}
    const wall=wallOf(view.structures),fraction=wall&&wall.maxHp>0?Math.max(0,Math.min(1,wall.hp/wall.maxHp)):0;
    const low=fraction>0&&fraction<.3;
    fill.style.transform=`scaleX(${fraction})`;
    readout.classList.toggle('rh-camp-low',low||!!camp.wallDown);
    hp.textContent=String(Math.max(0,Math.ceil(wall?.hp??0)));
    track.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
    cocoN.textContent=String(camp.coco);pedraN.textContent=String(camp.pedra);
    // Index 1 is the opening countdown before round 1: nothing to forge yet, the window stays shut.
    const round=view.round,prepare=round?.phase==='prepare'&&(round.index??0)>=2;
    // The wall crossing 50% and 25% in a wave: one notice each time (danger, 3 s).
    if(lastFraction!==undefined&&round?.phase==='wave'&&!camp.wallDown)for(const mark of WALL_WARNINGS)if(lastFraction>=mark&&fraction<mark){
      warning={text:`Muralha em ${Math.round(mark*100)}%!`,until:performance.now()+WALL_WARNING_MS};
      clearTimeout(warnTimer);warnTimer=setTimeout(render,WALL_WARNING_MS+20);
    }
    lastFraction=fraction;
    // ---------- notice ----------
    const me=view.players.find(p=>p.id===ctxId),standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed;
    const home=inCamp(hero,wall);
    if(warning&&performance.now()<warning.until){
      notice.hidden=false;notice.dataset.kind='wall';noticeText.textContent=warning.text;noticeTime.textContent='';arrow.hidden=true;noticeJoke.textContent='';
    }else if(prepare&&camp.hornEndsTick!==undefined&&standing){
      warning=undefined;
      const left=secondsLeft(camp.hornEndsTick,view.tick);
      notice.hidden=false;notice.dataset.kind=home?'home':'horn';
      notice.classList.toggle('rh-horn-urgent',!home&&left<=5);
      noticeText.textContent=home?'Bichos chegando':'Volta pra base';noticeTime.textContent=`${left} s`;
      const bearing=hero?.bearing;
      arrow.hidden=home||bearing===undefined;
      if(bearing!==undefined)arrow.style.setProperty('--rumo',`${Math.round(bearing)+180}deg`);
    }else{warning=undefined;notice.hidden=true;}
    // ---------- forge ----------
    if(!prepare||round?.index!==stint){stint=prepare?round!.index:-1;dismissed=false;}
    if(home&&!wasInCamp)dismissed=false;
    wasInCamp=home;
    const offerOpen=!!forge.parentElement?.querySelector('.rh-offer:not([hidden])');
    const show=prepare&&home&&standing&&!camp.wallDown&&!offerOpen&&!dismissed;
    if(forge.hidden===show)forge.hidden=!show;
    if(!show){if(pending&&!prepare)clearPending();return;}
    const line=fallLine(view,ctxId),quiet=note.textContent===DEFAULT_NOTE;
    if(fall.textContent!==line)writeFallLine(fall,line);
    fall.hidden=!line||!quiet;note.hidden=!!line&&quiet;
    for(const [id,{button,lock,full}] of tags){
      const reason=blockedReason(id,view,ctxId);
      button.classList.toggle('rh-forge-blocked',!!reason);
      lock.hidden=reason!=='balance';full.hidden=reason!=='full';
      button.setAttribute('aria-label',`${RECIPES[id].name}: ${RECIPES[id].describe}. Custa ${RECIPES[id].cost.coco} coco e ${RECIPES[id].cost.pedra} pedra.${reason?` ${reason==='balance'?missing(camp,id):FORGE_REFUSALS[reason]}`:''}`);
    }
  };

  return {
    el:forge,readout,notice,forge,
    update(view:RunView,ctx:HudContext){last=view;ctxId=ctx.localId;render();},
    setHero(spot){hero=spot;if(last)render();},
    forged(answer){
      if(!pending||answer.req!==pending.req)return;
      const id=pending.recipe;clearPending();
      if(answer.ok){
        const button=tags.get(id)!.button;
        button.classList.add('rh-forge-done');clearTimeout(stampTimer);
        stampTimer=setTimeout(()=>button.classList.remove('rh-forge-done'),FORGE_STAMP_MS);
        say(`${RECIPES[id].name}: feito!`);
      }else say(answer.reason==='balance'&&last?.camp?missing(last.camp,id)||FORGE_REFUSALS.balance:FORGE_REFUSALS[answer.reason??'']??'Agora não dá.');
    },
    destroy(){overflow.destroy();clearTimeout(stampTimer);clearTimeout(noteTimer);clearTimeout(warnTimer);if(pending)clearTimeout(pending.timer);readout.remove();notice.remove();forge.remove();},
  };
}
