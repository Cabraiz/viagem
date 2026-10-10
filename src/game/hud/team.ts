/**
 * Team strip and revive alerts (VGM-040). Read-only overlays (no pointer events):
 * up to 6 portraits with HP, downed ring with rescue progress, offline/eliminated badges,
 * and banners telling who fell and how long is left.
 */
import type {PlayerRunView,RunView} from '../sim/view.ts';
import {reviveBanner,clamp01,hpFraction,reviveAlerts,secondsLeft,teamOrder,type HudContext,type HudPart} from './model.ts';

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

interface MemberNodes {root:HTMLElement;img:HTMLImageElement;ring:HTMLElement;fill:HTMLElement;badge:HTMLElement;name:HTMLElement;timer:HTMLElement;classId:string;last:Map<string,string>}

/** Writes a DOM value only when it changed (update runs every view; most fields are stable). */
const put=(nodes:MemberNodes,key:string,value:string,write:(value:string)=>void)=>{
  if(nodes.last.get(key)===value)return;
  nodes.last.set(key,value);write(value);
};

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
    return {root:item,img,ring,fill,badge,name,timer,classId:player.classId,last:new Map()};
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
      const state=memberState(player),n=nodes;
      put(n,'state',state,v=>{n.root.dataset.state=v;n.badge.textContent=BADGES[v as MemberState];n.badge.hidden=!BADGES[v as MemberState];n.timer.hidden=v!=='downed';});
      put(n,'me',String(player.id===ctx.localId),v=>n.root.classList.toggle('rh-me',v==='true'));
      put(n,'name',player.id===ctx.localId?'Você':firstName(player.name),v=>{n.name.textContent=v;});
      put(n,'hp',`scaleX(${hpFraction(player)})`,v=>{n.fill.style.transform=v;});
      const progress=player.downed?clamp01(player.downed.progress):0;
      put(n,'rescue',`${Math.round(progress*360)}deg`,v=>n.ring.style.setProperty('--rh-rescue',v));
      if(player.downed)put(n,'timer',`${secondsLeft(player.downed.bleedOutTick,view.tick)}s`,v=>{n.timer.textContent=v;});
      put(n,'aria',`${player.name}: ${state==='downed'?'caído':state==='eliminated'?'fora':`${player.hp} de ${player.maxHp} de vida`}`,v=>n.root.setAttribute('aria-label',v));
    });
  }};
}

export function createReviveAlerts():HudPart{
  // The banner ticks every second, so it is not a live region; a hidden one announces each new fall once.
  const root=el('div','rh-alerts');
  const live=el('span','rh-sr',root);live.setAttribute('aria-live','assertive');
  const announced=new Set<string>();
  // One banner only (VGM-043): falls at the same time are grouped instead of stacking over the field.
  const row=el('div','rh-alert',root);row.hidden=true;
  const text=el('span','rh-alert-text',row),track=el('div','rh-alert-track',row),fill=el('i','rh-alert-fill',track);
  return {el:root,update(view:RunView,ctx:HudContext){
    const all=reviveAlerts(view,ctx.localId);
    const down=new Set(all.map(alert=>alert.playerId));
    for(const id of announced)if(!down.has(id))announced.delete(id);
    const fresh=all.filter(alert=>!announced.has(alert.playerId));
    if(fresh.length){
      for(const alert of fresh)announced.add(alert.playerId);
      live.textContent=fresh.map(alert=>alert.kind==='self'?'Você caiu!':`${alert.name} caiu!`).join(' ');
    }
    const banner=reviveBanner(view,ctx.localId,ctx.network);
    row.hidden=!banner;
    if(!banner)return;
    if(row.dataset.kind!==banner.kind)row.dataset.kind=banner.kind;
    row.classList.toggle('rh-alert-urgent',banner.urgent);
    if(text.textContent!==banner.text)text.textContent=banner.text;
    track.hidden=!Number.isFinite(banner.seconds);
    fill.style.transform=`scaleX(${banner.progress})`;
  }};
}
