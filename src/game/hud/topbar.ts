/**
 * Top of the run HUD (VGM-040): round chip ("Round N/10" + critters or interval countdown),
 * team XP bar with level, boss bar, and the animated round marquee with its absurd name.
 */
import type {RunView} from '../sim/view.ts';
import {bossInfo,roundInfo,xpFraction,type HudPart} from './model.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export function createTopBar():HudPart{
  const root=el('div','rh-top');
  const chip=el('div','rh-round',root);chip.setAttribute('role','status');
  const label=el('strong','rh-round-label',chip),detail=el('span','rh-round-detail',chip);
  const xp=el('div','rh-xp',root);
  const level=el('span','rh-xp-level',xp);
  const track=el('div','rh-xp-track',xp),fill=el('i','rh-xp-fill',track);
  xp.setAttribute('role','progressbar');xp.setAttribute('aria-label','XP do time');
  const boss=el('div','rh-boss',root);boss.hidden=true;
  const bossName=el('strong','rh-boss-name',boss),bossTrack=el('div','rh-boss-track',boss),bossFill=el('i','rh-boss-fill',bossTrack);
  let lastLevel=-1;
  return {el:root,update(view:RunView){
    const round=roundInfo(view);
    chip.hidden=!round;
    if(round){
      label.textContent=round.label;detail.textContent=round.detail;
      chip.dataset.phase=round.phase;
      chip.classList.toggle('rh-urgent',round.phase==='prepare'&&(round.countdown??99)<=5);
    }
    const fraction=xpFraction(view);
    fill.style.transform=`scaleX(${fraction})`;
    level.textContent=`Nv ${view.team.level}`;
    xp.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
    if(lastLevel>=0&&view.team.level>lastLevel){xp.classList.remove('rh-pop');void xp.offsetWidth;xp.classList.add('rh-pop');}
    lastLevel=view.team.level;
    const info=bossInfo(view);
    boss.hidden=!info;
    if(info){
      bossName.textContent=info.enraged?`${info.name} · FURIOSO`:info.name;
      bossFill.style.transform=`scaleX(${info.fraction})`;
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

/** kicker: small line above the title ("ROUND 3/10"); title: the absurd round name; subtitle: the modifier. */
export interface Marquee {kicker?:string;title:string;subtitle?:string;tone:'round'|'interval'|'boss'}

/** Marquee copy for a round event; pure so tests can check the copy. */
export function marqueeFor(event:{index:number;phase:'wave'|'prepare'|'end';name?:string;modifier?:string},total=10):Marquee|undefined{
  if(event.phase==='wave'){
    const boss=event.index>=total;
    const kicker=`ROUND ${event.index}/${total}${boss?' · CHEFE':''}`;
    return {kicker,title:event.name||`Round ${event.index}`,subtitle:event.modifier??(boss?'O Síndico Supremo quer falar com você':undefined),tone:boss?'boss':'round'};
  }
  if(event.phase==='prepare')return {title:'Intervalo!',subtitle:intervalLines[Math.abs(event.index)%intervalLines.length],tone:'interval'};
  return undefined;
}

export function createAnnouncer():HudPart{
  const root=el('div','rh-marquee');root.setAttribute('aria-live','polite');root.hidden=true;
  const kicker=el('span','rh-marquee-kicker',root),title=el('strong','rh-marquee-title',root),subtitle=el('span','rh-marquee-sub',root);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const show=(marquee:Marquee)=>{
    kicker.textContent=marquee.kicker??'';kicker.hidden=!marquee.kicker;
    // Word joiner after hyphens: "E-mail" must never break into "E-" / "mail" on a narrow phone.
    title.textContent=marquee.title.replace(/-/g,'-\u2060');subtitle.textContent=marquee.subtitle??'';subtitle.hidden=!marquee.subtitle;
    root.dataset.tone=marquee.tone;root.hidden=false;
    root.classList.remove('rh-marquee-in');void root.offsetWidth;root.classList.add('rh-marquee-in');
    clearTimeout(timer);timer=setTimeout(()=>{root.hidden=true;},3400);
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
