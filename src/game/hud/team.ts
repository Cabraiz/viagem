/**
 * Team strip and revive alerts (VGM-040). Read-only overlays (no pointer events):
 * up to 6 portraits with HP, downed ring with rescue progress, offline/eliminated badges,
 * and banners telling who fell and how long is left.
 */
import type {PlayerRunView,RunView} from '../sim/view.ts';
import {clamp01,hpFraction,reviveAlerts,secondsLeft,teamOrder,type HudContext,type HudPart} from './model.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export type MemberState='ok'|'low'|'downed'|'eliminated'|'offline'|'spectator';
/** Visual state of a team member; downed/eliminated win over offline because they change what allies must do. */
export function memberState(player:PlayerRunView):MemberState{
  if(player.eliminated)return 'eliminated';
  if(player.downed)return 'downed';
  if(player.spectator)return 'spectator';
  if(!player.online)return 'offline';
  return hpFraction(player)<=.3?'low':'ok';
}
const BADGES:Record<MemberState,string>={ok:'',low:'',downed:'🆘',eliminated:'💀',offline:'📵',spectator:'👀'};
const firstName=(name:string)=>name.trim().split(/\s+/)[0]?.slice(0,9)??'';

interface MemberNodes {root:HTMLElement;img:HTMLImageElement;ring:HTMLElement;fill:HTMLElement;badge:HTMLElement;name:HTMLElement;timer:HTMLElement;classId:string}

export function createTeamStrip():HudPart{
  const root=el('div','rh-team');root.setAttribute('aria-label','Time');
  const members=new Map<string,MemberNodes>();
  const make=(player:PlayerRunView,ctx:HudContext):MemberNodes=>{
    const item=el('div','rh-member');
    const ring=el('div','rh-member-ring',item);
    const img=el('img','rh-member-img',ring);img.alt='';img.decoding='async';img.draggable=false;
    const badge=el('span','rh-member-badge',item),timer=el('span','rh-member-timer',item);
    const bar=el('div','rh-member-hp',item),fill=el('i','rh-member-hp-fill',bar);
    const name=el('span','rh-member-name',item);
    img.src=ctx.portrait(player.classId);
    return {root:item,img,ring,fill,badge,name,timer,classId:player.classId};
  };
  return {el:root,update(view:RunView,ctx:HudContext){
    const ordered=teamOrder(view.players,ctx.localId);
    const live=new Set(ordered.map(p=>p.id));
    for(const [id,nodes] of members)if(!live.has(id)){nodes.root.remove();members.delete(id);}
    root.dataset.count=String(ordered.length);
    ordered.forEach((player,index)=>{
      let nodes=members.get(player.id);
      if(!nodes){nodes=make(player,ctx);members.set(player.id,nodes);}
      if(nodes.classId!==player.classId){nodes.classId=player.classId;nodes.img.src=ctx.portrait(player.classId);}
      if(root.children[index]!==nodes.root)root.insertBefore(nodes.root,root.children[index]??null);
      const state=memberState(player);
      nodes.root.dataset.state=state;
      nodes.root.classList.toggle('rh-me',player.id===ctx.localId);
      nodes.name.textContent=player.id===ctx.localId?'Você':firstName(player.name);
      nodes.badge.textContent=BADGES[state];nodes.badge.hidden=!BADGES[state];
      nodes.fill.style.transform=`scaleX(${hpFraction(player)})`;
      const progress=player.downed?clamp01(player.downed.progress):0;
      nodes.ring.style.setProperty('--rh-rescue',`${Math.round(progress*360)}deg`);
      nodes.timer.hidden=state!=='downed';
      if(player.downed)nodes.timer.textContent=`${secondsLeft(player.downed.bleedOutTick,view.tick)}s`;
      nodes.root.setAttribute('aria-label',`${player.name}: ${state==='downed'?'caído':state==='eliminated'?'fora':`${player.hp} de ${player.maxHp} de vida`}`);
    });
  }};
}

export function createReviveAlerts():HudPart{
  const root=el('div','rh-alerts');root.setAttribute('aria-live','polite');
  const MAX=3;
  const rows=Array.from({length:MAX},()=>{
    const row=el('div','rh-alert',root);row.hidden=true;
    const text=el('span','rh-alert-text',row),track=el('div','rh-alert-track',row),fill=el('i','rh-alert-fill',track);
    return {row,text,fill};
  });
  return {el:root,update(view:RunView,ctx:HudContext){
    const alerts=reviveAlerts(view,ctx.localId).slice(0,MAX);
    rows.forEach((nodes,index)=>{
      const alert=alerts[index];
      nodes.row.hidden=!alert;
      if(!alert)return;
      nodes.row.dataset.kind=alert.kind;
      nodes.row.classList.toggle('rh-alert-urgent',alert.seconds<=5);
      if(nodes.text.textContent!==alert.text)nodes.text.textContent=alert.text;
      nodes.fill.style.transform=`scaleX(${alert.progress})`;
    });
  }};
}
