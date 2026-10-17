/**
 * Team strip and revive alerts (VGM-040). Read-only overlays (no pointer events):
 * up to 6 portraits with HP, downed ring with rescue progress, offline/eliminated badges,
 * and banners telling who fell and how long is left.
 */
import type {PlayerRunView,RunView} from '../../contract/index.ts';
import {reviveBanner,clamp01,hpFraction,reviveAlerts,secondsLeft,secondsText,teamOrder,type HudContext,type HudPart} from './model.ts';
import {railName} from '../render/map-label-rules.ts';
import {icon,type IconName} from '../ui/icon.ts';
import {faceExpression,faceImg,setFace} from '../ui/face-crop.ts';
import {artIndexVersion} from '../art/manifest.ts';
import {teamColor} from './wc-minimap/minimap.ts';
import {pickMarks,validPause} from './pausa.ts';
import {itemDisplay} from './items.ts';
import {sticker} from '../ui/sticker.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export type MemberState='ok'|'low'|'downed'|'eliminated'|'offline'|'spectator';
/** Visual state of a team member; downed/eliminated win over offline because they change what allies must do. */
export function memberState(player:PlayerRunView):MemberState{
  if(player.eliminated)return 'eliminated';
  if(player.downed)return 'downed';
  // Away beats watching (UX onda 5): someone not back after a restart is offline, not a spectator.
  if(!player.online)return 'offline';
  if(player.spectator)return 'spectator';
  return hpFraction(player)<=.3?'low':'ok';
}
/** Status stickers (DSG-icones-sistema, §2.4): boia caído, porta (saiu) fora, fone cortado offline, pipoca assistindo. */
export const BADGES:Record<MemberState,IconName|''>={ok:'',low:'',downed:'boia',eliminated:'saiu',offline:'sem-linha',spectator:'pipoca'};
/** D-051: the weapon a hero holds in the manual combat (its hand slot), or undefined (automatic weapons, out, watching). */
export const handWeapon=(player:PlayerRunView):string|undefined=>player.hand===undefined||player.eliminated||player.spectator?undefined:player.weapons[player.hand]?.id;
// One short name everywhere: the map's caído ficha uses the same rule (render/map-label-rules.ts).
const firstName=railName;

interface MemberNodes {root:HTMLElement;face:HTMLElement;ring:HTMLElement;fill:HTMLElement;badge:HTMLElement;bot:HTMLElement;arma:HTMLElement;mood:HTMLElement;escolha:HTMLElement;name:HTMLElement;timer:HTMLElement;classId:string;last:Map<string,string>;art:number}

/** Writes a DOM value only when it changed (update runs every view; most fields are stable). */
const put=(nodes:MemberNodes,key:string,value:string,write:(value:string)=>void)=>{
  if(nodes.last.get(key)===value)return;
  nodes.last.set(key,value);write(value);
};

/** How long a teammate's name stays after a tap on their portrait, once the finger lifts (the phone's fan has no names). */
export const NAME_TAP_MS=1600;

export function createTeamStrip():HudPart{
  const root=el('div','rh-team');root.setAttribute('aria-label','Time');
  const members=new Map<string,MemberNodes>();
  // The phone's fan (hud-mobile-minimo, fone.css) shows no names: a tap (or a held finger) on a portrait shows that
  // one's name under it (data-nome), NAME_TAP_MS after the finger lifts. The desktop's column always shows them.
  let named:HTMLElement|undefined,nameTimer:ReturnType<typeof setTimeout>|undefined;
  const hideName=()=>{if(named)delete named.dataset.nome;named=undefined;};
  root.addEventListener('pointerdown',event=>{
    const member=(event.target as HTMLElement).closest<HTMLElement>('.rh-member');if(!member)return;
    clearTimeout(nameTimer);if(named!==member)hideName();named=member;member.dataset.nome='';
  });
  const release=()=>{if(!named)return;clearTimeout(nameTimer);nameTimer=setTimeout(hideName,NAME_TAP_MS);};
  for(const type of ['pointerup','pointercancel','pointerleave'] as const)root.addEventListener(type,release);
  const make=(player:PlayerRunView,ctx:HudContext):MemberNodes=>{
    const item=el('div','rh-member');
    const ring=el('div','rh-member-ring',item);
    // The face, not the whole body squeezed in the ring (rostos-hud): ui/face-crop.ts crops the portrait thumb.
    const face=faceImg(document,player.classId,{className:'rh-member-img',portrait:ctx.portrait});ring.append(face);
    const badge=el('span','rh-member-badge',item),timer=el('span','rh-member-timer',item);
    // Room bot (D-025): the robot sticker on the portrait's other corner (the state sticker keeps its own).
    const bot=el('span','rh-member-bot',item);bot.hidden=true;
    // D-051 manual combat: the weapon in the hand (PlayerRunView.hand), its sticker at the portrait's lower corner.
    const arma=el('span','rh-member-arma',item);arma.hidden=true;arma.setAttribute('aria-hidden','true');
    // KKKK (rostos-kkkk): the laugh sticker at the portrait's foot while ring[data-mood=rindo] (2.2 s, CSS shows it).
    const mood=el('span','rh-member-mood',item);mood.innerHTML=icon('risada');mood.setAttribute('aria-hidden','true');
    // The level-up pause (D-050, pausa.ts/pausa.css): a "pronto" sticker on who picked, a thinking ficha on who has not.
    const escolha=el('span','rh-member-escolha',item);escolha.hidden=true;escolha.setAttribute('aria-hidden','true');
    const bar=el('div','rh-member-hp',item),fill=el('i','rh-member-hp-fill',bar);
    const name=el('span','rh-member-name',item);
    return {root:item,face,ring,fill,badge,bot,arma,mood,escolha,name,timer,classId:player.classId,last:new Map(),art:artIndexVersion};
  };
  return {el:root,update(view:RunView,ctx:HudContext){
    const ordered=teamOrder(view.players,ctx.localId);
    // Each teammate's colour, as their dot on the minimap (wc-minimap teamColor: their place in the run's list).
    for(const p of view.players){const nodes=members.get(p.id);if(nodes&&p.id!==ctx.localId)put(nodes,'cor',teamColor(view.players,p.id),v=>nodes.root.style.setProperty('--rh-cor',v));}
    const live=new Set(ordered.map(p=>p.id));
    for(const [id,nodes] of members)if(!live.has(id)){nodes.root.remove();members.delete(id);}
    root.dataset.count=String(ordered.length);
    // The level-up pause (D-050, ctx.pause): who picked and who the room still waits for.
    const marks=pickMarks(validPause(ctx.pause),view.players);
    ordered.forEach((player,index)=>{
      let nodes=members.get(player.id);
      if(!nodes){nodes=make(player,ctx);nodes.root.dataset.id=player.id;members.set(player.id,nodes);}
      // Class and expression (caido when down or out, rindo for 2.2 s after a KKKK, ferido at 30%, else normal):
      // setFace writes only what changed.
      const expression=faceExpression({hp:player.hp,maxHp:player.maxHp,downed:!!player.downed,eliminated:player.eliminated,emote:ctx.mood?.(player.id)});
      // Also when the art index arrives after the strip was drawn (slow network): the imported face replaces the crop.
      if(nodes.classId!==player.classId||nodes.face.dataset.face!==expression||nodes.art!==artIndexVersion){nodes.classId=player.classId;nodes.art=artIndexVersion;setFace(nodes.face,player.classId,{expression,portrait:ctx.portrait});}
      if(root.children[index]!==nodes.root)root.insertBefore(nodes.root,root.children[index]??null);
      const state=memberState(player),n=nodes;
      put(n,'state',state,v=>{n.root.dataset.state=v;const badge=BADGES[v as MemberState];n.badge.innerHTML=badge?icon(badge):'';n.badge.hidden=!badge;n.timer.hidden=v!=='downed';});
      put(n,'me',String(player.id===ctx.localId),v=>n.root.classList.toggle('rh-me',v==='true'));
      // Today's crop is the same picture for every expression: the ring's data-mood is what makes the laugh read.
      put(n,'mood',expression==='rindo'?'rindo':'',v=>{if(v)n.ring.dataset.mood=v;else delete n.ring.dataset.mood;});
      put(n,'bot',String(!!player.bot),v=>{n.bot.innerHTML=v==='true'?icon('robo'):'';n.bot.hidden=v!=='true';});
      const held=handWeapon(player);
      put(n,'arma',held?`${held}:${artIndexVersion}`:'',v=>{n.arma.innerHTML=held?sticker(itemDisplay(held).icon):'';n.arma.hidden=!v;if(held)n.arma.dataset.arma=held;else delete n.arma.dataset.arma;});
      put(n,'name',player.id===ctx.localId?'Você':firstName(player.name),v=>{n.name.textContent=v;});
      put(n,'hp',`scaleX(${hpFraction(player)})`,v=>{n.fill.style.transform=v;});
      const progress=player.downed?clamp01(player.downed.progress):0;
      put(n,'rescue',`${Math.round(progress*360)}deg`,v=>n.ring.style.setProperty('--rh-rescue',v));
      if(player.downed)put(n,'timer',secondsText(secondsLeft(player.downed.bleedOutTick,view.tick)),v=>{n.timer.textContent=v;});
      const pick=marks.get(player.id)??'';
      put(n,'escolha',pick,v=>{if(v)n.root.dataset.escolha=v;else delete n.root.dataset.escolha;n.escolha.innerHTML=v==='escolheu'?icon('pronto'):'';n.escolha.hidden=!v;});
      put(n,'aria',`${player.name}${player.bot?' (bot)':''}: ${state==='downed'?'caído':state==='eliminated'?'fora':`${player.hp} de ${player.maxHp} de vida`}${pick==='escolheu'?', já escolheu':pick==='pensando'?', escolhendo':''}`,v=>n.root.setAttribute('aria-label',v));
    });
    if(named&&!named.isConnected)named=undefined;
  },destroy(){clearTimeout(nameTimer);}};
}

export function createReviveAlerts():HudPart{
  // The banner ticks every second, so it is not a live region; a hidden one announces each new fall once.
  const root=el('div','rh-alerts');
  const live=el('span','rh-sr',root);live.setAttribute('aria-live','assertive');
  const announced=new Set<string>();
  // One banner only (VGM-043): falls at the same time are grouped instead of stacking over the field.
  const row=el('div','rh-alert',root);row.hidden=true;
  const text=el('span','rh-alert-text',row),track=el('div','rh-alert-track',row),fill=el('i','rh-alert-fill',track);
  // Own fall: what got you, as an optional second line (critter sticker + joke); the first line stays the instruction.
  const cause=el('span','rh-alert-cause',row);cause.hidden=true;
  const causeIcon=el('img','rh-alert-cause-icon',cause);causeIcon.alt='';causeIcon.decoding='async';causeIcon.draggable=false;
  const causeText=el('span','rh-alert-cause-text',cause);
  return {el:root,update(view:RunView,ctx:HudContext){
    const all=reviveAlerts(view,ctx.localId);
    const down=new Set(all.map(alert=>alert.playerId));
    for(const id of announced)if(!down.has(id))announced.delete(id);
    const fresh=all.filter(alert=>!announced.has(alert.playerId));
    if(fresh.length){
      for(const alert of fresh)announced.add(alert.playerId);
      live.textContent=fresh.map(alert=>alert.kind==='self'?'Você caiu!':`${alert.name} caiu!`).join(' ');
    }
    const banner=reviveBanner(view,ctx.localId,ctx.network,ctx.tally.causes,ctx.watching,ctx.worldRescue);
    row.hidden=!banner;
    if(!banner)return;
    if(row.dataset.kind!==banner.kind)row.dataset.kind=banner.kind;
    row.classList.toggle('rh-alert-urgent',banner.urgent);
    if(text.textContent!==banner.text)text.textContent=banner.text;
    track.hidden=!Number.isFinite(banner.seconds);
    cause.hidden=!banner.cause;
    if(banner.cause){
      if(causeText.textContent!==banner.cause.line)causeText.textContent=banner.cause.line;
      const src=ctx.critterIcon?.(banner.cause.kind)??'';
      causeIcon.hidden=!src;if(src&&causeIcon.getAttribute('src')!==src)causeIcon.src=src;
      cause.dataset.kind=banner.cause.kind;
    }
    fill.style.transform=`scaleX(${banner.progress})`;
  }};
}
