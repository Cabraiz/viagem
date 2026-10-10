/**
 * Top of the run HUD (VGM-040): round chip ("Round N/10" + critters or interval countdown),
 * team XP bar with level, boss bar, and the animated round marquee with its absurd name.
 */
import type {RunView} from '../sim/view.ts';
import {bossInfo,roundInfo,xpFraction,type HudPart} from './model.ts';
import {MARQUEE_MS} from './zones.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export function createTopBar():HudPart{
  const root=el('div','rh-top');
  // Not a live region: the countdown changes every second. Round changes are announced by the marquee.
  const chip=el('div','rh-round',root);
  const label=el('strong','rh-round-label',chip),detail=el('span','rh-round-detail',chip);
  const xp=el('div','rh-xp',root);
  const level=el('span','rh-xp-level',xp);
  const track=el('div','rh-xp-track',xp),fill=el('i','rh-xp-fill',track);
  xp.setAttribute('role','progressbar');xp.setAttribute('aria-label','XP do time');
  const boss=el('div','rh-boss',root);boss.hidden=true;
  const bossName=el('strong','rh-boss-name',boss),bossTrack=el('div','rh-boss-track',boss),bossFill=el('i','rh-boss-fill',bossTrack);
  let lastLevel=-1;
  // Last written values: update runs for every view, but these change rarely.
  const last=new Map<string,string>();
  const put=(key:string,value:string,write:(value:string)=>void)=>{if(last.get(key)!==value){last.set(key,value);write(value);}};
  return {el:root,update(view:RunView){
    const round=roundInfo(view);
    chip.hidden=!round;
    if(round){
      put('label',round.label,v=>{label.textContent=v;});
      put('detail',round.detail,v=>{detail.textContent=v;});
      put('phase',round.phase,v=>{chip.dataset.phase=v;});
      chip.classList.toggle('rh-urgent',round.phase==='prepare'&&(round.countdown??99)<=5);
    }
    const fraction=xpFraction(view);
    put('xp',`scaleX(${fraction})`,v=>{fill.style.transform=v;});
    put('level',`Nv ${view.team.level}`,v=>{level.textContent=v;});
    put('xpAria',String(Math.round(fraction*100)),v=>xp.setAttribute('aria-valuenow',v));
    if(lastLevel>=0&&view.team.level>lastLevel){xp.classList.remove('rh-pop');void xp.offsetWidth;xp.classList.add('rh-pop');}
    lastLevel=view.team.level;
    const info=bossInfo(view);
    boss.hidden=!info;
    if(info){
      put('boss',info.enraged?`${info.name} · FURIOSO`:info.name,v=>{bossName.textContent=v;});
      put('bossHp',`scaleX(${info.fraction})`,v=>{bossFill.style.transform=v;});
      boss.classList.toggle('rh-enraged',info.enraged);
    }
  }};
}

/** Lines for the interval marquee, picked by round index so it is stable per round. */
const intervalLines=[
  'Respira, bebe água e escolhe o upgrade',
  'Intervalo comercial: resgata a galera',
  'Pausa pro cafezinho. Rápido!',
  'Hora de fingir que tem estratégia',
];

/**
 * title: the absurd round name; subtitle: the modifier. Two lines at most (UX-zonas-tela): the round number lives in the
 * chip right above, so the old "ROUND 3/10 · CHEFE" kicker is gone (it was caps and "A · B" too, D-020).
 */
export interface Marquee {title:string;subtitle?:string;tone:'round'|'interval'|'boss'}

/** Marquee copy for a round event; pure so tests can check the copy. */
export function marqueeFor(event:{index:number;phase:'wave'|'prepare'|'end';name?:string;modifier?:string},total=10):Marquee|undefined{
  if(event.phase==='wave'){
    const boss=event.index>=total;
    return {title:event.name||`Round ${event.index}`,subtitle:event.modifier??(boss?'O Síndico Supremo quer falar com você':undefined),tone:boss?'boss':'round'};
  }
  if(event.phase==='prepare')return {title:'Intervalo!',subtitle:intervalLines[Math.abs(event.index)%intervalLines.length],tone:'interval'};
  return undefined;
}

/**
 * Round/boss banner (UX-zonas-tela): lives in the top band's announcement slot, two lines at most, MARQUEE_MS on
 * screen, then shrinks into the round chip. A title that wraps drops the subtitle (the joke goes first).
 */
export function createAnnouncer():HudPart{
  const root=el('div','rh-marquee');root.setAttribute('aria-live','polite');root.hidden=true;
  const title=el('strong','rh-marquee-title',root),subtitle=el('span','rh-marquee-sub',root);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const show=(marquee:Marquee)=>{
    // A notice already in the slot wins (danger over the joke): the round name skips its turn; the chip shows the round.
    if(root.parentElement?.querySelector('.rh-alert:not([hidden])'))return;
    // Word joiner after hyphens: "E-mail" must never break into "E-" / "mail" on a narrow phone.
    title.textContent=marquee.title.replace(/-/g,'-\u2060');subtitle.textContent=marquee.subtitle??'';subtitle.hidden=!marquee.subtitle;
    root.dataset.tone=marquee.tone;root.hidden=false;
    // Two lines at most: a title that needs two lines keeps them and the subtitle goes.
    const line=parseFloat(getComputedStyle(title).lineHeight)||28;
    if(!subtitle.hidden&&title.getBoundingClientRect().height>line*1.5)subtitle.hidden=true;
    root.classList.remove('rh-marquee-in');void root.offsetWidth;root.classList.add('rh-marquee-in');
    clearTimeout(timer);timer=setTimeout(()=>{root.hidden=true;root.classList.remove('rh-marquee-in');},MARQUEE_MS);
  };
  let seen=-1;
  return {el:root,update(view:RunView){
    for(const event of view.events){
      if(event.eventId<=seen||event.type!=='round')continue;
      seen=event.eventId;
      const marquee=marqueeFor(event,view.round?.total);
      if(marquee)show(marquee);
    }
  },destroy(){clearTimeout(timer);}};
}
