/**
 * Top of the run HUD (VGM-040): round chip ("Round N/10" + critters or interval countdown),
 * team XP bar with level, boss bar, and the animated round marquee with its absurd name.
 */
import {putData,putHidden,putIconNumber,putTextData} from './dom-put.ts';
import type {RunView} from '../../contract/index.ts';
import {bossInfo,exploraLeft,nestCount,nestsMode,roundInfo,xpFraction,type HudContext,type HudPart} from './model.ts';
import {ClockTag,arrivalBand,liveObjective,type ChaveiroClock} from './chaveiro.ts';
import {MARQUEE_MS} from './zones.ts';
import {HAPPENING_COPY} from '../fun/zueira.ts';
import {icon} from '../ui/icon.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export function createTopBar():HudPart{
  // Lazy, and its rejection dropped, so the node tests that build this part (hud.test, hud-sem-escrita-repetida) never load
  // a .css (card chaveiro-chegou-e-relogio); Vite always serves it.
  import('./chaveiro-relogio.css').catch(()=>{});
  const root=el('div','rh-top');
  // Not a live region: the countdown changes every second. Round changes are announced by the marquee.
  const chip=el('div','rh-round',root);
  const label=el('strong','rh-round-label',chip),eta=el('span','rh-round-eta',chip),detail=el('span','rh-round-detail',chip);
  // D-047: the chaveiro's clock ("Onda 3 · 9:48", no moto since topo-sem-icone-contagem-exploracao), only while the
  // objective runs; in the time to explore, the seconds left ("120", "119"…).
  eta.hidden=true;
  // Card chaveiro-chegou-e-relogio: while the moto is stopped the clock wears the stop's colour and, under the chip, the
  // time the stop added ("Moto tombou: +4 s", hud/chaveiro.ts ClockStopTracker).
  // Right after the clock, in the chip: "+N s", with what stopped the moto before it where the row has room (chaveiro-relogio.css).
  const stopTag=el('span','rh-relogio-motivo');eta.after(stopTag);stopTag.hidden=true;
  const stopName=el('span','rh-relogio-motivo-nome',stopTag),stopAdded=el('span','rh-relogio-motivo-mais',stopTag);
  const tag=new ClockTag();
  // "Chegou" is a moment: the band under the chip while he opens the car, the seconds left and a bar filling up.
  const arrival=el('div','rh-chaveiro-chegou',root);arrival.setAttribute('role','status');arrival.hidden=true;
  const arrivalTitle=el('strong','rh-chegou-titulo',arrival),arrivalHold=el('span','rh-chegou-segurem',arrival);
  const arrivalFill=el('i','rh-chegou-fill',el('div','rh-chegou-track',arrival));
  const xp=el('div','rh-xp',root);
  const level=el('span','rh-xp-level',xp);
  const track=el('div','rh-xp-track',xp),fill=el('i','rh-xp-fill',track);
  xp.setAttribute('role','progressbar');xp.setAttribute('aria-label','XP do time');
  // BUG-20261023-ORQ-hud-tirar-nivel-e-ninhos: the user asked for no level on screen; the badge and its thread stay
  // built (the level-up pop, the tests) but hidden (hud.css .rh-xp[hidden]).
  xp.hidden=true;
  const boss=el('div','rh-boss',root);boss.hidden=true;
  const bossName=el('strong','rh-boss-name',boss),bossTrack=el('div','rh-boss-track',boss),bossFill=el('i','rh-boss-fill',bossTrack);
  let lastLevel=-1;
  // Last written values: update runs for every view, but these change rarely.
  const last=new Map<string,string>();
  const put=(key:string,value:string,write:(value:string)=>void)=>{if(last.get(key)!==value){last.set(key,value);write(value);}};
  return {el:root,update(view:RunView,ctx:HudContext){
    const round=roundInfo(view),explora=exploraLeft(view.tick,ctx);
    // D-051 nests: no waves, so no "Onda N" and no critter count; the chip keeps only the chaveiro's clock.
    const nests=!!round?.nests;
    putHidden(chip,!round||(nests&&!round.chaveiro&&explora===undefined));
    put('nests',String(nests),()=>{label.hidden=detail.hidden=nests;if(nests)chip.dataset.modo='ninhos';else delete chip.dataset.modo;});
    if(round){
      put('label',round.label,v=>{label.textContent=v;});
      // One-row band (card hud-topo-uma-linha): the count as a sticker and a number ("onda" for the bichos left, the
      // clock for the intermission); the full words stay for screen readers and the tooltip.
      const n=round.phase==='prepare'?round.countdown:round.phase==='wave'?round.remaining:undefined;
      put('detail',n===undefined?round.detail:`${round.phase}:${n}`,()=>{
        detail.title=round.detail;
        if(n===undefined){detail.textContent=round.detail;return;}
        // The words for screen readers (a span's aria-label is not read): a hidden copy, the sticker and number hidden.
        if(detail.childElementCount!==2)detail.innerHTML='<span class="rh-sr"></span><span aria-hidden="true"></span>';
        putTextData(detail.firstElementChild!,round.detail);
        putIconNumber(detail.lastElementChild as HTMLElement,icon(round.phase==='prepare'?'relogio':'onda'),round.phase==='prepare'?`${n} s`:String(n));
      });
      put('phase',round.phase,v=>{chip.dataset.phase=v;});
      // D-051 nests: the nests still standing go to screen readers only (BUG-20261023-ORQ-hud-tirar-nivel-e-ninhos: no "6/8" on screen).
      const count=nests?nestCount(view):undefined;
      const clock:Pick<ChaveiroClock,'clock'|'aria'|'held'>|undefined=explora!==undefined?{clock:String(explora),aria:`Exploração: faltam ${explora} s`,held:false}:round.chaveiro;
      put('eta',clock?`${clock.clock}|${clock.aria}|${clock.held}|${count?.text??''}`:'',()=>{
        putHidden(eta,!clock);
        // The chefão up (boss-fim-onda-1): a padlock and the number grey, the clock stopped until he falls.
        if(clock?.held)eta.dataset.parado='';else delete eta.dataset.parado;
        // Built once; each second only the words and the number change in place (dom-put.ts putTextData, no new node).
        if(clock){
          putData(chip,'objetivo','chaveiro');
          if(eta.childElementCount!==2)eta.innerHTML='<span class="rh-sr"></span><span aria-hidden="true"></span>';
          putTextData(eta.firstElementChild!,`${clock.aria}${count?`. ${count.aria}`:''}`);
          putIconNumber(eta.lastElementChild as HTMLElement,clock.held?icon('cadeado'):'',clock.clock,'<i class="rh-round-sep"></i>');
        }
        else{delete chip.dataset.objetivo;eta.textContent='';}
      });
      const objective=liveObjective(view);
      // A stop's "+N s" first; else a hit's on the Uno (card missao-proteger-uno-tempo): both read the ETA, held = nothing.
      const stop=tag.step(objective&&!round.chaveiro?.held?objective:undefined,view.tick);
      put('stop',stop?`${stop.mode}|${stop.text}`:'',()=>{
        putHidden(stopTag,!stop);
        if(stop){eta.dataset.motivo=stop.urgent?'urgente':'parada';stopTag.dataset.motivo=eta.dataset.motivo;
          stopName.textContent=`${stop.label}: `;stopAdded.textContent=`+${stop.added} s`;stopTag.title=stop.text;}
        else{delete eta.dataset.motivo;stopName.textContent=stopAdded.textContent=stopTag.title='';}
      });
      chip.classList.toggle('rh-urgent',!nests&&round.phase==='prepare'&&(round.countdown??99)<=5);
    }
    const band=arrivalBand(liveObjective(view));
    put('chegou',band?`${band.seconds}`:'',()=>{
      putHidden(arrival,!band);
      if(band){arrivalTitle.textContent=band.title;arrivalHold.textContent=band.hold;arrival.setAttribute('aria-label',band.aria);}
    });
    if(band)put('chegouFill',`scaleX(${Math.round(band.fraction*100)/100})`,v=>{arrivalFill.style.transform=v;});
    const fraction=xpFraction(view);
    put('xp',`scaleX(${fraction})`,v=>{fill.style.transform=v;});
    put('level',`Nív. ${view.team.level}`,v=>{level.textContent=v;});
    put('xpAria',String(Math.round(fraction*100)),v=>xp.setAttribute('aria-valuenow',v));
    if(lastLevel>=0&&view.team.level>lastLevel){xp.classList.remove('rh-pop');void xp.offsetWidth;xp.classList.add('rh-pop');}
    lastLevel=view.team.level;
    const info=bossInfo(view);
    putHidden(boss,!info);
    if(info){
      put('boss',info.enraged?`${info.name} tá furioso`:info.name,v=>{bossName.textContent=v;});
      put('bossHp',`scaleX(${info.fraction})`,v=>{bossFill.style.transform=v;});
      boss.classList.toggle('rh-enraged',info.enraged);
    }
  }};
}

/** Lines for the interval marquee, picked by round index so it is stable per round. */
const intervalLines=[
  'Respira, bebe água e escolhe a melhoria',
  'Intervalo comercial: resgata a galera',
  'Pausa pro cafezinho. Rápido!',
  'Hora de fingir que tem estratégia',
];

/**
 * title: the absurd round name; subtitle: the modifier. Two lines at most (UX-zonas-tela): the round number lives in the
 * chip right above, so the old "ROUND 3/10 · CHEFE" kicker is gone (it was caps and "A · B" too, D-020).
 */
export interface Marquee {title:string;subtitle?:string;tone:'round'|'interval'|'boss'|'evento'}

/** Marquee copy for a round event; pure so tests can check the copy. */
export function marqueeFor(event:{index:number;phase:'wave'|'prepare'|'end';name?:string;modifier?:string},total=10,word:'Rodada'|'Onda'='Rodada'):Marquee|undefined{
  if(event.phase==='wave'){
    const boss=event.index>=total;
    return {title:event.name||`${word} ${event.index}`,subtitle:event.modifier??(boss?'O Síndico Supremo quer falar com você':undefined),tone:boss?'boss':'round'};
  }
  if(event.phase==='prepare')return {title:'Intervalo!',subtitle:intervalLines[Math.abs(event.index)%intervalLines.length],tone:'interval'};
  return undefined;
}

/**
 * Round/boss banner (UX-zonas-tela): lives in the top band's announcement slot, two lines at most, MARQUEE_MS on
 * screen, then fades out inside its own slot (the chip shows the round). A title that wraps drops the subtitle (the joke goes first).
 */
export function createAnnouncer():HudPart{
  const root=el('div','rh-marquee');root.setAttribute('aria-live','polite');root.hidden=true;
  const title=el('strong','rh-marquee-title',root),subtitle=el('span','rh-marquee-sub',root);
  // The whole subtitle for screen readers when the line shows less of it (fitSubtitle).
  const whole=el('span','rh-sr',root);
  let timer:ReturnType<typeof setTimeout>|undefined,full='';
  /**
   * One line and nothing cut (BUG-20261023-ORQ-resultado-paisagem-e-125): the title is always whole; the subtitle shows
   * whole if it fits beside it, else only the modifier's name (modifierLabel "Nome: descrição"), else it goes. Runs again
   * when the banner's size changes (text at 125%, a turned phone), starting from the whole text every time.
   */
  const fitSubtitle=()=>{
    if(root.hidden||!full)return;
    subtitle.textContent=full;subtitle.hidden=false;whole.textContent='';
    // Two lines at most: a title that needs two lines keeps them and the subtitle goes.
    const line=parseFloat(getComputedStyle(title).lineHeight)||28,oneLine=title.getBoundingClientRect().height<=line*1.5;
    const over=()=>subtitle.scrollWidth>subtitle.clientWidth+1;
    if(oneLine&&!over())return;
    const name=full.split(/:\s/)[0];
    if(oneLine&&name!==full){subtitle.textContent=name;if(!over()){whole.textContent=full;return;}}
    subtitle.hidden=true;whole.textContent=full;
  };
  // Next frame (a size change inside the observer's own callback is a "loop" error), and only when the room or the text
  // size changed: the fit itself resizes the banner.
  let fitted='';
  const fitKey=()=>`${root.parentElement?.clientWidth}|${getComputedStyle(title).fontSize}|${full}`;
  const resized=typeof ResizeObserver==='function'?new ResizeObserver(()=>requestAnimationFrame(()=>{
    if(fitKey()!==fitted){fitted=fitKey();fitSubtitle();}
  })):undefined;
  resized?.observe(root);
  const show=(marquee:Marquee)=>{
    // A notice already in the slot wins (danger over the joke): the round name skips its turn; the chip shows the round.
    if(root.parentElement?.querySelector('.rh-alert:not([hidden])'))return;
    // An open offer window too (design onda 3 B4): the chip already shows the round.
    if(root.closest('.rh')?.querySelector('.rh-offer:not([hidden])'))return;
    // Word joiner after hyphens: "E-mail" must never break into "E-" / "mail" on a narrow phone.
    title.textContent=marquee.title.replace(/-/g,'-\u2060');full=marquee.subtitle??'';subtitle.textContent=full;subtitle.hidden=!full;whole.textContent='';
    root.dataset.tone=marquee.tone;root.hidden=false;
    fitSubtitle();fitted=fitKey();
    root.classList.remove('rh-marquee-in');void root.offsetWidth;root.classList.add('rh-marquee-in');
    clearTimeout(timer);timer=setTimeout(()=>{root.hidden=true;root.classList.remove('rh-marquee-in');},MARQUEE_MS);
  };
  let seen=-1;
  return {el:root,update(view:RunView){
    for(const event of view.events){
      if(event.eventId<=seen)continue;
      // A zueira event (VGM-053B) takes the same street banner: its name and one dry line.
      if(event.type==='happening'){seen=event.eventId;const copy=HAPPENING_COPY[event.kind];if(copy)show({...copy,tone:'evento'});continue;}
      if(event.type!=='round')continue;
      seen=event.eventId;
      // D-051 nests: no waves to announce (the round state still counts underneath).
      if(nestsMode(view))continue;
      // D-047: with the chaveiro the waves have no end and the boss comes by his clock, not by the round's number.
      const marquee=view.objective?marqueeFor(event,Infinity,'Onda'):marqueeFor(event,view.round?.total);
      if(marquee)show(marquee);
    }
  },destroy(){clearTimeout(timer);resized?.disconnect();}};
}
