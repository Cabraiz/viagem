/**
 * The caça-níquel of the dourada escondida (NEW-20261023-ORQ-caixa-gamble-raridade, the user 24/10: "quando a arma é
 * dourada ... uma animação de slot machine de fade in e out na tela"): the server turns a weapon crate verde/azul/roxa
 * DOURADA when it is opened (sim/crates.ts rarityAtOpen) and the 'pickup' chest event carries the real rarity (4).
 * When the LOCAL hero opens one whose crate showed less, a slot machine fades in over the screen, its three reels spin
 * weapon stickers and stop one after the other on the weapon, gold, a "DOURADA!" banner shines, and it fades out
 * (SLOT_MS in all). Nothing waits on it: the root ignores the pointer and the game goes on under it.
 * The colour the crate showed comes from the previous view (the crate is gone from the view that carries the event).
 * Under prefers-reduced-motion the reels do not spin: the weapon shows at once, then fades.
 * No CSS import here (the module stays importable by node tests): hud.ts imports caca-niquel.css.
 */
import type {RunView,SimEvent} from '../../contract/index.ts';
import {kitPiece} from '../../rules/index.ts';
import {GOLD_LEVEL,goldSticker,sticker} from '../ui/sticker.ts';
import {allItemDisplays,itemDisplay} from './items.ts';
import type {HudContext,HudPart} from './model.ts';

/** The whole show (ms): fade in, the reels stop at REEL_STOP_MS, the banner shines, fade out at FADE_OUT_AT_MS. */
export const SLOT_MS=1900,FADE_IN_MS=200,FADE_OUT_AT_MS=1600;
/** When each reel stops (ms from the start): one after the other, the last on the banner. */
export const REEL_STOP_MS:readonly number[]=[700,900,1100];
/** Stickers each reel runs through before stopping on the weapon. */
export const REEL_CELLS=12;
/** Coins and sparkles that burst out of the frame when the last reel stops (caca-niquel.css .rh-cn-chuva). */
export const BURST_PIECES=12;

/** The burst: piece i flies out at an even angle (a little jitter), coins and sparkles alternating, far ones bigger. */
export function burst(n=BURST_PIECES):{kind:'moeda'|'brilho';dx:number;dy:number;rot:number;scale:number;delay:number}[]{
  return Array.from({length:n},(_,i)=>{
    const angle=(i/n)*Math.PI*2+(i%3-1)*.18,reach=110+(i*37%5)*22;
    return {kind:i%2?'brilho':'moeda',dx:Math.round(Math.cos(angle)*reach),dy:Math.round(Math.sin(angle)*reach*.7),
      rot:(i%2?1:-1)*(180+i*40),scale:+(.8+(i*29%5)*.12).toFixed(2),delay:REEL_STOP_MS[REEL_STOP_MS.length-1]+(i%4)*30};
  });
}
/** The rarity the gamble reveals (sim/crates.ts GOLD_RARITY) and the colours it may hide under (GOLD_HIDDEN_FROM). */
const GOLD=4,HIDES_UNDER=new Set([1,2,3]);

type ChestEvent=Extract<SimEvent,{type:'pickup'}>;
/** What a crate looked like on the map: its colour and the item it showed. */
export interface CrateSeen {value:number;resource?:string}

/** The crates of a view by id (kind 'chest'), to read the colour of the one an event opens in the next view. */
export function cratesOf(view:Pick<RunView,'pickups'>):Map<string,CrateSeen>{
  const out=new Map<string,CrateSeen>();
  for(const k of view.pickups)if(k.kind==='chest')out.set(k.id,{value:k.value,...(k.resource?{resource:k.resource}:{})});
  return out;
}

/**
 * The weapon of a crate the local hero opened that turned DOURADA (it showed verde, azul or roxa and gave 4), or
 * undefined. A crate this client never saw (it opened out of view) gives nothing: no surprise to tell.
 */
export function goldTurn(event:SimEvent,seen:ReadonlyMap<string,CrateSeen>,localId:string):string|undefined{
  if(event.type!=='pickup'||event.kind!=='chest'||event.player!==localId||event.value!==GOLD)return undefined;
  const crate=seen.get((event as ChestEvent).pickup);
  if(!crate||!HIDES_UNDER.has(crate.value)||!crate.resource)return undefined;
  return kitPiece(crate.resource)?undefined:crate.resource;
}

/** A reel: REEL_CELLS weapon ids (seeded by `seed`, never the same twice in a row) ending on `item`. */
export function reelStrip(item:string,seed:number,cells=REEL_CELLS):string[]{
  const pool=allItemDisplays().filter(d=>d.kind==='weapon').map(d=>d.id);
  const out:string[]=[];
  let s=(seed>>>0)||1;
  for(let i=0;i<cells-1;i++){
    s=Math.imul(s^(s>>>15),0x2c1b3c6d)>>>0;s^=s+Math.imul(s^(s>>>7),61);s>>>=0;
    let id=pool.length?pool[s%pool.length]:item;
    if(id===out[i-1]||(i===cells-2&&id===item))id=pool.length>1?pool[(pool.indexOf(id)+1)%pool.length]:item;
    out.push(id);
  }
  out.push(item);
  return out;
}

const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface CacaNiquelPart extends HudPart {
  /** Starts the show for this weapon now (also what an event triggers). */
  play(item:string):void;
  /** Whether it is on screen. */
  readonly playing:boolean;
}

export function createCacaNiquel(doc:Document=document,options:{onPlay?:(item:string)=>void}={}):CacaNiquelPart{
  const el=doc.createElement('div');
  el.className='rh-cn';el.hidden=true;el.setAttribute('role','status');el.setAttribute('aria-live','polite');
  let seen=new Map<string,CrateSeen>(),lastEvent=-1,timer:ReturnType<typeof setTimeout>|undefined,playing=false,shows=0;

  function stop(){if(timer!==undefined)clearTimeout(timer);timer=undefined;playing=false;el.hidden=true;el.innerHTML='';delete el.dataset.fase;}

  function play(item:string){
    stop();
    const name=itemDisplay(item).name,icon=goldSticker(itemDisplay(item).icon,GOLD_LEVEL),still=reducedMotion();
    shows++;
    const reels=REEL_STOP_MS.map((ms,r)=>{
      const strip=still?[item]:reelStrip(item,shows*7919+r*104729);
      // The last cell is the weapon in its dourada sticker (the CSS warms the plain one to gold until that art is in).
      const cells=strip.map((id,i)=>{const last=i===strip.length-1;
        return `<span class="rh-cn-cell${last&&strip.length===1?' rh-cn-gold':''}">${sticker(last?icon:itemDisplay(id).icon,{size:48})}</span>`;}).join('');
      return `<span class="rh-cn-reel"><span class="rh-cn-strip" style="--cells:${strip.length};--stop:${ms}ms">${cells}</span></span>`;
    }).join('');
    const chuva=burst().map(b=>`<span class="rh-cn-${b.kind}" style="--dx:${b.dx}px;--dy:${b.dy}px;--rot:${b.rot}deg;--s:${b.scale};--at:${b.delay}ms"></span>`).join('');
    el.innerHTML=`<div class="rh-cn-box"><div class="rh-cn-frame"><div class="rh-cn-reels">${reels}</div></div><div class="rh-cn-chuva">${chuva}</div>`+
      `<div class="rh-cn-banner">DOURADA!</div><div class="rh-cn-item">${sticker(icon,{size:48,className:icon.endsWith('-dourada')?'':'rh-cn-gold-ic'})}<span>${name}</span></div></div>`;
    el.setAttribute('aria-label',`${name} dourada!`);
    el.hidden=false;el.dataset.fase=still?'parado':'gira';playing=true;
    // Each strip's last cell is the weapon: gold once its reel stops (caca-niquel.css runs the motion).
    el.querySelectorAll<HTMLElement>('.rh-cn-strip').forEach(strip=>strip.lastElementChild?.classList.add('rh-cn-gold'));
    options.onPlay?.(item);
    timer=setTimeout(stop,SLOT_MS);
  }

  return {
    el,
    get playing(){return playing;},
    play,
    update(view:RunView,ctx:HudContext){
      for(const event of view.events){
        if(event.eventId<=lastEvent)continue;
        lastEvent=event.eventId;
        const item=goldTurn(event,seen,ctx.localId);
        if(item)play(item);
      }
      seen=cratesOf(view);
    },
    destroy:stop,
  };
}
