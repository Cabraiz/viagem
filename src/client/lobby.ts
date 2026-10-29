import {getClass,type HeroClass,type Role} from '../rules/index.ts';
import {putHidden} from './hud/dom-put.ts';
import type { CoopClient } from './net/client.ts';
import type { RunState } from '../contract/index.ts';
import { icon } from './ui/icon.ts';
import {faceHtml} from './ui/face-crop.ts';
import {railName} from './render/map-label-rules.ts';
import {inviteQuery} from './dev/ux-flag.ts';
import {formatRoomCode,isRoomCode,readRoomCode,shareLink} from './ui/invite.ts';
import {fitName,NAME_MAX} from './ui/nick.ts';
import {chunkFailed,reloadUnderway} from './ui/update-toast.ts';
import {CITY_PLAYABLE,CITY_SOON,type MapId,type MapRef,type RoomCreateOptions} from '../protocol/index.ts';
import {selectorReducer,mapChangedNews,downloadText,DEFAULT_MAP,NEWS_MS,
  type SelectorState,type SelectorEvent,type Orientation} from './hud/city/index.ts';
import {assetsParaPartida,matchKey} from './preload/match-assets.ts';
import {createPreloader,preloadDone} from './preload/preloader.ts';
import {holdMenuDownload} from './audio/menu-music.ts';
import {preloadBlock,preloadRing,p0Fraction} from './preload/ready-gate.ts';
import {objectiveFromSearch,soloMemory,soloNext,soloOneRetry,soloPlan,SOLO_MAP,SOLO_STARTING,type SoloPlan,type SoloStep} from './ui/solo-plan.ts';

// ---------- Pure helpers (no DOM, tested in node) ----------

/** Nicknames shown by the "Sortear" button; the HUD and sheet cap names at 20 characters. */
export const NICK_MAX=NAME_MAX;
const NICK_HEADS=['Capivara','Pastel','Coxinha','Tiozão','Pombo','Boleto','Chinelo','Molotov','Cachaça','Marmita','Agiota','Pavê','Biscoito','Sacolé'];
const NICK_TAILS=['Veloz','Turbo','do Grau','Lendário','Sem Wi-Fi','de Feira','Cansado','Fujão','Raiz','Nutella','do Bairro','Atrasado','de Ouro','Brabo'];

/** Funny nickname that fits NICK_MAX; `random` is injectable for tests (cosmetic only, never sim). */
export function suggestNickname(random:()=>number=Math.random,avoid=''){
  for(let attempt=0;attempt<20;attempt++){
    const head=NICK_HEADS[Math.floor(random()*NICK_HEADS.length)%NICK_HEADS.length];
    const tail=NICK_TAILS[Math.floor(random()*NICK_TAILS.length)%NICK_TAILS.length];
    const nick=`${head} ${tail}`;
    if(nick.length<=NICK_MAX&&nick!==avoid)return nick;
  }
  return 'Capivara Veloz'===avoid?'Pastel Turbo':'Capivara Veloz';
}

/** Rotating lines while the room waits. */
export const WAITING_LINES:readonly string[]=Object.freeze([
  'Esperando o amigo que disse "tô chegando" há 20 minutos.',
  'Alguém foi buscar água e sumiu.',
  'O Wi-Fi do vizinho está colaborando.',
  'Aquecendo o chinelo…',
  'Conferindo se o boleto venceu.',
  'O bêbado também está esperando. Na saideira.',
  'Quem não estiver pronto paga a coxinha.',
  'O tio do pavê está ensaiando a piada.',
]);
export const WAITING_LINE_SECONDS=5;
export const waitingLine=(elapsedSeconds:number)=>WAITING_LINES[Number.isFinite(elapsedSeconds)?Math.floor(Math.max(0,elapsedSeconds)/WAITING_LINE_SECONDS)%WAITING_LINES.length:0];

/**
 * The team's makeup, as a joke that never blocks (NEW-20261009-UX-escolha-classe): with 3+ in the room and every class
 * known, the first missing role (support first: someone has to bring the coffee) says so; undefined when all is covered.
 */
export const COMPOSITION_LINES:Readonly<Record<Role,string>>=Object.freeze({
  'Suporte':'Time sem suporte: quem vai passar o café?',
  'Linha de frente':'Ninguém na linha de frente: quem vai levar a primeira chinelada?',
  'Dano':'Time sem dano: vão vencer a horda no papo?',
  'Controle':'Ninguém de controle: a horda vai entrar sem pedir licença.',
});
const COMPOSITION_ORDER:readonly Role[]=['Suporte','Linha de frente','Dano','Controle'];
export function compositionLine(members:readonly {classId?:string}[]){
  if(members.length<3)return undefined;
  const roles=new Set<Role>();
  for(const m of members){const role=m.classId?getClass(m.classId)?.role:undefined;if(!role)return undefined;roles.add(role);}
  const missing=COMPOSITION_ORDER.find(role=>!roles.has(role));
  return missing?COMPOSITION_LINES[missing]:undefined;
}
/** The class's short name under a chip's name ("CLT"); empty until the class is known. */
export const memberClassName=(classId:string|undefined)=>classId?getClass(classId)?.name??'':'';
/**
 * A chip's name as HTML. A numbered name ("Mendigo 2", a bot named after its class) keeps its number in sight: only
 * the words before it end in reticências in a narrow cell, so "Mendigo 2" and "Mendigo 3" never both read "Mendig…".
 */
export function chipNameHtml(name:string){
  const m=/^(.+) (\d)$/.exec(name);
  return m?`<b class="coop-wait-numbered"><b>${escapeHtml(m[1])}</b><b>&nbsp;${m[2]}</b></b>`:escapeHtml(name);
}

/** Joke for each countdown second (3, 2, 1). */
export function countdownJoke(seconds:number){
  if(seconds>=3)return 'Desligando o fogão…';
  if(seconds===2)return 'Avisando a mãe que vai demorar…';
  if(seconds===1)return 'Segura o chinelo!';
  return 'Bora!';
}

/** Invite link and the grouped code (ui/invite.ts, NEW-20261009-UX-lobby-mobile). */
export {shareLink,formatRoomCode,readRoomCode};

/** `bot`: a room bot; `owner`: the dono da sala (D-025). */
/** `classId`: the class picked (for the chip's face), undefined until the player's state arrives. */
export interface WaitingMember {id:string;name:string;ready:boolean;online:boolean;self:boolean;bot:boolean;owner:boolean;classId?:string}
export interface WaitingView {
  visible:boolean;
  phase:'lobby'|'countdown'|'hidden';
  members:WaitingMember[];
  readyCount:number;total:number;
  selfReady:boolean;
  /** Joined mid-countdown/combat: watches this round, cannot toggle ready. */
  selfSpectator:boolean;
  /** Countdown seconds (countdown phase only). */
  seconds?:number;
  /** Headline: who we wait for, or the countdown joke. */
  headline:string;
  /** This player owns the room and may kick and add/remove bots now (lobby or countdown, D-025). */
  canManage:boolean;
  /** Seats left (six in all, bots count): "Adicionar bot" only while there is one. */
  seatsLeft:number;
}
/**
 * What an armed chip says (D-025, design review): the verb (a person is expelled, a bot is taken out), the first name
 * as the rail shows it, and what to do: "Expulsar Wagner? Toca de novo."
 */
export const confirmText=(m:Pick<WaitingMember,'name'|'bot'>)=>`${m.bot?'Tirar':'Expulsar'} ${railName(m.name)}? Toca de novo.`;
/** The owner's line in place of the waiting joke (the joke is optional; this line says what the chips do). */
export const OWNER_HINT='Você é o dono da sala. Toca num nome pra tirar.';
/** How long the owner news stays on top of the waiting room (ms). */
export const OWNER_NEWS_MS=4000;
/**
 * The owner news (D-025, UX review): the post moved ("Bia saiu. Agora quem manda é Caio." / "Agora a sala é sua."),
 * or a guest's first look ("Caio é dono da sala."). The owner's own first look says nothing (their line says it).
 */
export function ownerNotice(before:{name?:string}|undefined,after:string,mine:boolean):string|undefined{
  if(before)return mine?'Agora a sala é sua.':`${railName(before.name??'O dono')} saiu. Agora quem manda é ${railName(after)}.`;
  return mine?undefined:`${railName(after)} é dono da sala.`;
}
/** A second tap this soon after the first is the same finger bouncing, not a confirmation (ms). */
export const DOUBLE_TAP_MS=500;

// ---------- Map selector of the waiting room (cidade-09, design/cidade-hud.md §4, D-035) ----------

/** The maps the selector shows locked "em breve", with what an owner's tap on one says: the city until CITY_PLAYABLE. */
export const soonMaps=(cityPlayable=CITY_PLAYABLE):Partial<Record<MapId,string>>=>cityPlayable?{}:{'cidade-nevada':CITY_SOON};
/** The room's news when the map changes (the room resets every ready). The city's "Leve casaco" is already its subtitle. */
export const mapNews=(map:MapId)=>mapChangedNews(map);
/** Subtitle of the room's map while its asset downloads ("Baixando a cidade: 40%"), or when it did not arrive. */
export const CITY_NOT_ARRIVED='A cidade não baixou.';
export function mapLoadText(load:{progress:number;failed?:string}|undefined):string|undefined{
  return !load?undefined:load.failed?CITY_NOT_ARRIVED:downloadText(load.progress);
}
/**
 * The ready button while the room's map is still downloading on this phone, or did not arrive (review cidade-09): it
 * cannot be marked ready, so no countdown starts on a map this phone has not loaded. The text says why.
 */
export const READY_BLOCKED={downloading:'Baixando a cidade…',failed:'A cidade não baixou'} as const;
export function readyBlock(load:{progress:number;failed?:string}|undefined):string|undefined{
  return !load?undefined:load.failed?READY_BLOCKED.failed:READY_BLOCKED.downloading;
}
/**
 * How long a join waits for the city manifest (counted from the lobby opening, review cidade-09): the lobby never
 * blocks on it, and a manifest later than this leaves the city out of join.maps (the room then offers this phone the
 * endless map only). A room already on the city refuses that join: the client waits for the manifest and retries once
 * (client.ts retryWithCity, cidade-10).
 */
export const MANIFEST_BUDGET_MS=1000;
/** `promise`'s value if it settles within `ms`, else undefined (a rejection is undefined too). Never rejects. */
export function within<T>(promise:Promise<T>,ms:number):Promise<T|undefined>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const late=new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),Math.max(0,ms));});
  return Promise.race([promise.catch(()=>undefined),late]).finally(()=>clearTimeout(timer));
}
/** The map the selector shows as the room's: the one being downloaded (the room already switched), else the applied one. */
export const roomMapId=(client:{map?:MapRef;mapLoad?:{ref:MapRef}}):MapId=>client.mapLoad?.ref.id??client.map?.id??DEFAULT_MAP;
/**
 * The map line of the settings panel (explore.ts): the city by name with its asset version and a short hash (cidade-10:
 * not "Ilha 0, relevo procedural"); the endless map and the island as they always were.
 */
export function mapInfoText(seed:number,endless:boolean,map?:MapRef):string{
  if(map?.id==='cidade-nevada')return `Cidade Nevada, versão ${map.version}${map.hash?` (${map.hash.slice(0,8)})`:''}`;
  return endless?`Mapa ${seed}`:`Ilha ${seed}, relevo procedural`;
}
/**
 * The phone's keyboard is up (lobby typing mode, coop.css data-typing): the visible part of the page is short, or much
 * shorter than the page (Android keeps the layout and shrinks only the visual viewport).
 */
export const keyboardUp=(visible:number,page:number)=>visible<=260||visible<page*.75;
/** Lobby orientation, as coop.css and the HUD zones decide it (zones.ts orientationOf): landscape up to 500 px tall. */
export const lobbyOrientation=(viewport:{width:number;height:number}):Orientation=>viewport.height<=500?'landscape':'portrait';
/**
 * The selector state brought up to date with the room (pure): owner, countdown lock, connection, the room's map (a
 * pending pick the room confirmed settles too) and the download text. Same object when nothing changed.
 */
export function syncSelector(s:SelectorState,room:{canManage:boolean;countdown:boolean;connected:boolean;map:MapId;download?:string}):SelectorState{
  const step=(e:SelectorEvent)=>{s=selectorReducer(s,e).state;};
  if(s.canManage!==room.canManage)step({type:'owner',canManage:room.canManage});
  if(s.locked!==room.countdown)step({type:'countdown',on:room.countdown});
  if(s.offline===room.connected)step({type:'offline',on:!room.connected});
  if(s.confirmed!==room.map||s.pending?.map===room.map)step({type:'confirm',map:room.map});
  if(s.download!==room.download)step({type:'download',text:room.download});
  return s;
}
/** Portrait guests in a room of 4+: the waiting joke gives its lines to the map selector (the window must not scroll). */
export const jokeYields=(orientation:Orientation,view:Pick<WaitingView,'canManage'|'members'>)=>orientation==='portrait'&&!view.canManage&&view.members.length>=4;
type Box={x:number;y:number;width:number;height:number};
/**
 * Lobby framing (explore.ts): the free band around the waiting window, cut clear of the landscape selector window
 * (cidade-hud.md §7) so the hero never stands under it. The side of the band away from the selector is kept.
 */
export function besideSelector(band:Box,selector:Box|undefined,gapPx=8):Box{
  if(!selector||!(selector.width>0&&selector.height>0))return band;
  const overlaps=selector.x<band.x+band.width&&selector.x+selector.width>band.x&&selector.y<band.y+band.height&&selector.y+selector.height>band.y;
  if(!overlaps)return band;
  if(selector.x+selector.width/2>=band.x+band.width/2)return {...band,width:Math.max(0,selector.x-gapPx-band.x)};
  const x=Math.min(band.x+band.width,selector.x+selector.width+gapPx);
  return {...band,x,width:Math.max(0,band.x+band.width-x)};
}

/** View model of the waiting room from the polled run state. Spectators are not counted. */
export function waitingRoomView(run:RunState|undefined,names:ReadonlyMap<string,{name:string;classId?:string}>,selfId:string,hz=20):WaitingView{
  const phase=run?.phase==='lobby'||run?.phase==='countdown'?run.phase:'hidden';
  const members:WaitingMember[]=(run?.members??[]).filter(m=>!m.spectator).map(m=>{
    const known=names.get(m.id);
    return {id:m.id,name:known?.name||'Alguém',ready:m.ready,online:m.online,self:m.id===selfId,bot:!!m.bot,owner:!!run?.owner&&m.id===run.owner,
      ...(known?.classId?{classId:known.classId}:{})};
  }).sort((a,b)=>Number(b.self)-Number(a.self)||Number(a.bot)-Number(b.bot)||a.name.localeCompare(b.name,'pt-BR')||(a.id<b.id?-1:1));
  const canManage=phase!=='hidden'&&!!selfId&&run?.owner===selfId,seatsLeft=Math.max(0,6-(run?.members.length??0));
  const readyCount=members.filter(m=>m.ready&&m.online).length,total=members.length;
  const selfReady=!!members.find(m=>m.self)?.ready;
  const selfSpectator=!!run?.members.find(m=>m.id===selfId)?.spectator;
  if(phase==='countdown'){
    const seconds=Math.max(0,Math.ceil((run?.remaining??0)/hz));
    return {visible:true,phase,members,readyCount,total,selfReady,selfSpectator,seconds,headline:countdownJoke(seconds),canManage,seatsLeft};
  }
  if(phase!=='hidden'&&selfSpectator)return {visible:true,phase,members,readyCount,total,selfReady,selfSpectator,headline:'Você assiste esta rodada. Pipoca liberada!',canManage,seatsLeft};
  const missing=members.filter(m=>!m.ready||!m.online);
  // Who is here but not ready apart from who is away (fell off the network, or not back after a restart, VGM-047).
  const here=missing.filter(m=>m.online),away=missing.filter(m=>!m.online);
  const who=(list:WaitingMember[])=>list.length===1?(list[0].self?'você':list[0].name):list.length===2?`${list[0].self?'você':list[0].name} e ${list[1].self?'você':list[1].name}`:String(list.length);
  const awayText=away.length===1?`${away[0].name} ainda não voltou.`:`${away.length} ainda não voltaram.`;
  const headline=phase==='hidden'?''
    :total<=1?'Só você aqui. Chama a turma!'
    :!missing.length?'Todo mundo pronto. Milagre!'
    :away.length&&!here.length?(away.length===1?`Só falta ${away[0].name} voltar.`:awayText)
    :away.length?`${here.length===1?"Falta":"Faltam"} ${who(here)}. ${awayText}`
    :missing.length===1?(missing[0].self?'Só falta você. Sem pressão.':`Só falta ${missing[0].name}. Sem pressão.`)
    :`Faltam ${missing.length}. Alguém foi ao banheiro.`;
  return {visible:phase!=='hidden',phase,members,readyCount,total,selfReady,selfSpectator,headline,canManage,seatsLeft};
}

// ---------- DOM ----------

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

/**
 * Waiting room panel inside the island shell (a modal dialog, so it must live inside it).
 * Polls client.run, shows while the run is in lobby/countdown and removes itself when the island closes.
 */
/** How long a chip waits for the confirming tap (ms) before it goes back to the name. */
export const CONFIRM_MS=3000;
/** A confirmed chip waits this long for the room before it is tappable again (lost on a bad network, refused). */
export const REARM_MS=1500;
export function mountWaitingRoom(host:HTMLElement,client:Pick<CoopClient,'code'|'id'|'run'|'players'|'ready'|'connected'>&Partial<Pick<CoopClient,'roomNotice'|'fatal'|'kick'|'addBot'|'removeBot'|'setMap'|'map'|'mapLoad'|'classId'>>,
  options:{origin?:string;now?:()=>number;cityPlayable?:boolean;
    /** false: no pre-download of the match's art (and no ready gate on it). */
    preload?:boolean;
    /** "Jogar sozinho": the room is driven by itself (the city, the bots, "pronto" when the gate opens); no invite. */
    solo?:SoloPlan}={}){
  const now=options.now??(()=>performance.now());
  const started=now();
  // The match's art, downloaded while the room waits (NEW-20261013-ORQ-3g-precarga-partida, preload/): the list follows
  // the members and the map (only new files are added); the ready button waits for this phone's P0 or PRELOAD_CAP_MS.
  const preloader=options.preload===false?undefined:createPreloader();
  let preloadKey='';
  // The menu music's download yields to this one (musica-do-menu): held (aborted) while the match's files download.
  let menuHold:(()=>void)|undefined;
  const stopPreload=()=>{preloader?.abort();menuHold?.();menuHold=undefined;};
  const panel=document.createElement('section');panel.className='coop-wait';panel.setAttribute('aria-label','Sala de espera');
  panel.innerHTML=`<div class="coop-wait-code"><small>Sala</small><strong></strong><button class="coop-wait-share" type="button"><span class="coop-wait-share-icon" aria-hidden="true">${icon('aviao',{size:24})}</span><span class="coop-wait-share-text">Chamar a turma</span></button></div>
    <div class="coop-wait-news" role="alert" hidden><strong></strong><span></span></div>
    <p class="coop-wait-owner" role="status" hidden></p>
    <p class="coop-wait-headline" role="status" aria-live="polite"></p>
    <ul class="coop-wait-members"></ul>
    <p class="coop-wait-line"></p>
    <div class="coop-wait-actions"><button class="coop-wait-ready" type="button" aria-pressed="false">Tô pronto!</button><button class="coop-wait-bot" type="button" hidden>${icon('robo')}<span>Adicionar bot</span></button></div>
    <p class="coop-wait-count" aria-hidden="true"></p>`;
  const $=<T extends HTMLElement>(s:string)=>panel.querySelector<T>(s)!;
  $('.coop-wait-code strong').textContent=formatRoomCode(client.code);
  // Read at each tap: the playtest's "Medir a turma" (dev only) may change what the invite carries.
  const link=()=>shareLink(options.origin??location.origin,client.code,inviteQuery(location.search));
  const shareButton=$<HTMLButtonElement>('.coop-wait-share');
  shareButton.addEventListener('click',async()=>{
    // Only the label changes (the icon stays); on a short landscape window the label floats (coop.css), so it never adds a row.
    const label=shareButton.querySelector<HTMLElement>('.coop-wait-share-text')!;
    const say=(text:string)=>{label.textContent=text;shareButton.classList.add('is-saying');setTimeout(()=>{label.textContent='Chamar a turma';shareButton.classList.remove('is-saying');},2500);};
    try{
      if(navigator.share){await navigator.share({title:'Viagem',text:`Bora pra sala ${formatRoomCode(client.code)}? O bêbado não espera.`,url:link()});say('Convite enviado!');return;}
      await navigator.clipboard.writeText(link());say('Copiado! Manda no grupo da família.');
    }catch(error){
      if((error as DOMException)?.name==='AbortError')return;
      say(`Código: ${formatRoomCode(client.code)}`);
    }
  });
  if(options.solo)shareButton.hidden=true;
  let soloMem=soloMemory();
  const readyButton=$<HTMLButtonElement>('.coop-wait-ready');
  let lastView:WaitingView|undefined;
  readyButton.addEventListener('click',()=>client.ready(!lastView?.selfReady));
  const botButton=$<HTMLButtonElement>('.coop-wait-bot');
  botButton.addEventListener('click',()=>{client.addBot?.();botButton.disabled=true;setTimeout(()=>{botButton.disabled=false;},400);});
  // The owner's chips (D-025): first tap asks ("Expulsar Bia? Toca de novo."), a second one between DOUBLE_TAP_MS and
  // CONFIRM_MS later does it (a bounce of the same finger is not a yes).
  let armed:{id:string;at:number;until:number}|undefined,disarm:ReturnType<typeof setTimeout>|undefined;
  const list=$('.coop-wait-members');
  list.addEventListener('click',event=>{
    const chip=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if(!chip||!lastView?.canManage)return;
    const id=chip.dataset.id!,m=lastView.members.find(x=>x.id===id);
    if(!m||m.self)return;
    if(armed?.id===id&&now()-armed.at<DOUBLE_TAP_MS)return;
    if(armed?.id===id&&now()<=armed.until){
      armed=undefined;clearTimeout(disarm);
      if(m.bot)client.removeBot?.(id);else client.kick?.(id);
      // Gone at the next state; still there (offline, refused) after REARM_MS: the chip comes back, never a dead button.
      chip.disabled=true;clearTimeout(disarm);disarm=setTimeout(()=>{membersKey='';update();},REARM_MS);return;
    }
    armed={id,at:now(),until:now()+CONFIRM_MS};clearTimeout(disarm);disarm=setTimeout(()=>{armed=undefined;membersKey='';update();},CONFIRM_MS);
    membersKey='';update();
  });
  host.append(panel);
  let membersKey='',wasReady=new Set<string>();
  // Who owned the room last time we looked, and the names seen (the one who left is gone from the run state).
  // The news strip (.coop-wait-owner) also carries the map news.
  let ownerSeen:string|undefined,ownerNews:{text:string;until:number}|undefined;
  // Said from inside update(): the line is drawn further down.
  const say=(text:string,ms:number)=>{ownerNews={text,until:now()+ms};};
  // No map choice in the room (card topo-sem-icone-contagem-exploracao, the user 25/10: "remova Cidade Nevada e Mapa
  // infinito"): the room opens on ROOM_DEFAULT_MAP; the endless map stays reachable by URL (solo plan, sandbox).
  const viewport=()=>({width:innerWidth,height:innerHeight});
  let orientation=lobbyOrientation(viewport()),mapSeen:MapId|undefined,loadFailed:string|undefined;
  const names=new Map<string,string>();
  // Only touch text that changed, so the polite live region is not re-announced every poll.
  const setText=(el:HTMLElement,text:string)=>{if(el.textContent!==text)el.textContent=text;};
  const update=()=>{
    if(!panel.isConnected||!host.isConnected){clearInterval(timer);clearTimeout(disarm);stopPreload();panel.remove();return;}
    const view=waitingRoomView(client.run,client.players,client.id);lastView=view;
    // The match is on: a slow connection now fetches the decoration too (it held it back to give P0/P1 the bandwidth).
    if(client.run?.phase==='combat')preloader?.release();
    for(const m of view.members)names.set(m.id,m.name);
    const owner=client.run?.owner;
    if(owner&&owner!==ownerSeen){
      const text=ownerNotice(ownerSeen!==undefined?{name:names.get(ownerSeen)}:undefined,names.get(owner)??'Alguém',owner===client.id);
      ownerNews=text?{text,until:Infinity}:undefined;ownerSeen=owner;
    }
    // Stopped for good (kicked, another tab, version): the terminal window says why; nothing here answers any more.
    const off=!view.visible||!!client.fatal;
    putHidden(panel,off);
    if(!view.visible)return;
    // The room's map and its download (the preload and the ready button follow it).
    const roomMap=roomMapId(client),load=client.mapLoad;
    const selfClass=view.members.find(m=>m.self)?.classId??client.classId;
    if(preloader&&selfClass){
      const room={self:selfClass,others:view.members.filter(m=>!m.self).map(m=>m.classId),map:roomMap,search:location.search};
      const key=matchKey(room);
      if(key!==preloadKey){preloadKey=key;menuHold??=holdMenuDownload();preloader.add(assetsParaPartida(room));}
    }
    const preload=preloader?.progress();
    if(menuHold&&preload&&preloadDone(preload)){menuHold();menuHold=undefined;}
    if(mapSeen!==undefined&&roomMap!==mapSeen)say(mapNews(roomMap),NEWS_MS);
    mapSeen=roomMap;
    if(load?.failed&&load.failed!==loadFailed)say(load.failed,NEWS_MS);
    loadFailed=load?.failed;
    orientation=lobbyOrientation(viewport());
    panel.dataset.phase=view.phase;
    // After a restart of the room the run is gone (VGM-047, UX onda 5): the news goes on top, as a ficha, in place of
    // the headline, and the waiting joke is suspended until the next run starts.
    const news=client.roomNotice;
    panel.classList.toggle('has-notice',!!news);
    $('.coop-wait-news').hidden=!news;
    if(news){setText($('.coop-wait-news strong'),news.title);setText($('.coop-wait-news span'),news.body);}
    $('.coop-wait-headline').hidden=!!news&&view.phase!=='countdown';
    setText($('.coop-wait-headline'),view.headline);
    // The 4 s start when the island is on screen (the loading cover can sit over the room for a while on a slow phone).
    if(ownerNews?.until===Infinity&&!host.querySelector('.explore-loading:not([hidden])'))ownerNews.until=now()+OWNER_NEWS_MS;
    const ownerLine=$('.coop-wait-owner'),showNews=!!ownerNews&&now()<ownerNews.until;
    ownerLine.hidden=!showNews;if(showNews)setText(ownerLine,ownerNews!.text);
    // A fuller window (4+): for its 4 s the news takes the headline's place, like the
    // restart notice does, and in portrait the line under the chips too, so the window never scrolls the ready button away.
    const tightNews=showNews&&view.phase!=='countdown'&&view.members.length>=4;
    if(tightNews)$('.coop-wait-headline').hidden=true;
    const hint=view.canManage&&(view.members.length>1||view.seatsLeft>0);
    // The team's makeup takes the joke's place; for the owner it takes turns with the hint (WAITING_LINE_SECONDS each).
    const makeup=compositionLine(view.members),turn=Math.floor((now()-started)/1000/WAITING_LINE_SECONDS)%2===1;
    setText($('.coop-wait-line'),view.phase==='countdown'||news?'':hint&&!(makeup&&turn)?OWNER_HINT:makeup??waitingLine((now()-started)/1000));
    $('.coop-wait-line').hidden=tightNews&&orientation==='portrait';
    botButton.hidden=!view.canManage||view.seatsLeft<1||view.selfSpectator;
    panel.classList.toggle('is-owner',view.canManage);
    setText($('.coop-wait-count'),view.seconds!==undefined?String(view.seconds):'');
    // Ready players can still back out during the countdown (the server accepts it).
    readyButton.hidden=view.selfSpectator;
    // The room's map still downloading here (or it did not arrive): no "pronto" (backing out stays possible).
    // Then this phone's P0 of the match (own hero, the map's ground) for at most PRELOAD_CAP_MS since it entered.
    const blocked=view.selfReady?undefined:readyBlock(load)??(preloader?preloadBlock(preload,now()-started):undefined);
    if(preload){
      const p0=String(Math.floor(p0Fraction(preload)*100)),bytes=String(preload.bytes);
      if(panel.dataset.preloadP0!==p0)panel.dataset.preloadP0=p0;
      if(panel.dataset.preloadBytes!==bytes)panel.dataset.preloadBytes=bytes;
    }
    readyButton.disabled=!client.connected||!!blocked;
    if(options.solo&&!soloMem.done){
      const step=soloNext(options.solo,{connected:client.connected,phase:client.run?.phase,owner:view.canManage,map:roomMap,
        bots:view.members.filter(m=>m.bot).length,seatsLeft:view.seatsLeft,selfReady:view.selfReady,readyBlocked:!!blocked},soloMem,now());
      soloMem=step.mem;
      if(step.action==='map')client.setMap?.(options.solo.map);
      else if(step.action==='bot')client.addBot?.();
      else if(step.action==='ready')client.ready(true);
    }
    setText(readyButton,blocked??(!view.selfReady?'Tô pronto!':options.solo&&client.run?.phase==='countdown'?SOLO_STARTING:'Ops, peraí'));
    readyButton.setAttribute('aria-pressed',String(view.selfReady));
    readyButton.classList.toggle('is-ready',view.selfReady);
    if(armed&&!view.members.some(m=>m.id===armed!.id&&!m.self))armed=undefined;
    const key=JSON.stringify([view.members,view.canManage,armed?.id]);
    if(key!==membersKey){
      membersKey=key;
      list.innerHTML=view.members.map(m=>{
        // Ready or waiting (check or clock) for everyone; a bot is always ready and wears the robot in the chip's corner,
        // so "pronto" never rests on the green alone. The crown marks the owner for everyone.
        const status=icon(m.ready?'pronto':'relogio'),robot=m.bot?`<span class="coop-wait-botmark">${icon('robo',{label:'bot'})}</span>`:'';
        // The class's short name under the name (escolha-classe), read aloud after it: inside the name's box on a chip, on
        // the owner's button the whole second row (the grid's cell is narrow). An <em>: the `>span` name rules skip it.
        const role=memberClassName(m.classId),kind=role?`<em class="coop-wait-class" aria-hidden="true">${escapeHtml(role)}</em>`:'';
        const said=`${m.bot?' bot':''}${role?`, ${role}`:''}${m.owner?', dono da sala':''}${m.ready?', pronto':', ainda não'}`;
        const crown=m.owner?icon('coroa',{className:'coop-wait-crown'}):'';
        // The person's face left of the name (rostos-hud, 24 px circle: the chip keeps its height); an empty circle until
        // the class is known. An <i>, so the chip's `>span` name rules (flex, ellipsis) skip it. Robot sticker and crown stay.
        // This player's face wears the download ring (its fill: --preload, set below at every update).
        const bare=faceHtml(m.classId,{className:'coop-wait-face',tag:'i'});
        const face=m.self&&preloader?`<b class="coop-wait-ring" aria-hidden="true">${bare}</b>`:bare;
        // The ready pop plays once, when a chip turns ready, not on every rebuild of the list (the owner's taps rebuild it).
        // The owner's grid shows the rail's short name (unique for bots, like the HUD); the whole name is read aloud.
        const shown=view.canManage?railName(m.name):m.name;
        const cls=`${m.ready?'is-ready':''}${m.ready&&!wasReady.has(m.id)?' just-ready':''}${m.online?'':' is-away'}${m.bot?' is-bot':' is-person'}`;
        if(view.canManage&&!m.self){
          // A bot goes out by the door (neutral); a person is expelled: the cross, and a Cone edge on the chip.
          const ask=armed?.id===m.id,out=m.bot?'saiu':'fechar';
          const label=ask?confirmText(m):`${m.name}${said}. Tocar pra ${m.bot?'tirar':'expulsar'}.`;
          return `<li class="${cls}${ask?' is-asking':''}">${robot}<button type="button" data-id="${escapeHtml(m.id)}" aria-label="${escapeHtml(label)}">${ask?icon(out):status}${face}<span>${ask?escapeHtml(confirmText(m)):chipNameHtml(shown)}</span>${ask?'':crown+icon(out,{className:'coop-wait-out'})+kind}</button></li>`;
        }
        return `<li class="${cls}${m.self?' is-self':''}">${robot}${status}${face}<span${shown!==m.name?` aria-label="${escapeHtml(m.name)}"`:''}>${chipNameHtml(shown)}${m.self?' <small>(você)</small>':''}${kind}</span>${crown}<span class="sr-only">${said}</span></li>`;
      }).join('');
      wasReady=new Set(view.members.filter(m=>m.ready).map(m=>m.id));
    }
    const ring=list.querySelector<HTMLElement>('.coop-wait-ring');
    if(ring){
      const r=preloadRing(preload),fill=r.fraction.toFixed(3);
      if(ring.style.getPropertyValue('--preload')!==fill)ring.style.setProperty('--preload',fill);
      if(ring.hasAttribute('data-done')!==r.done)ring.toggleAttribute('data-done',r.done);
    }
  };
  const timer=setInterval(update,200);update();
  return {panel,update,dispose(){clearInterval(timer);stopPreload();panel.remove();}};
}

/** Wait before the one second try of "Criar sala" (auditoria multijogador 29/10, achado 5: a 3G hiccup). */
export const CREATE_RETRY_MS=800;
export const CREATE_RETRY_TEXT='A rede engasgou. Criando sua sala de novo…';
/**
 * POST /rooms (the new room's code). A timeout or a network error gets one more try after CREATE_RETRY_MS; an answer
 * from the Worker (a 4xx like the 429 "Aguarde um minuto", or a 5xx) is final: asking again gives the same answer.
 */
export async function createRoom(endpoint:string,body:unknown,options:{onRetry?:()=>void;fetcher?:typeof fetch;wait?:(ms:number)=>Promise<void>;timeoutMs?:number}={}):Promise<string>{
  const fetcher=options.fetcher??fetch,wait=options.wait??(ms=>new Promise<void>(r=>setTimeout(r,ms)));
  for(let attempt=0;;attempt++){
    let r:Response;
    try{r=await fetcher(new URL('/rooms',endpoint),{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(options.timeoutMs??10000)});}
    catch(e){if(attempt>0)throw e;options.onRetry?.();await wait(CREATE_RETRY_MS);continue;}
    const data=await r.json().catch(()=>({}));
    if(!r.ok||typeof data.code!=='string')throw new Error(data.error??'Não foi possível criar a sala.');
    return data.code;
  }
}
/** `room` fills the code (an invite's ?sala=, main.ts); with `autoJoin` the lobby enters it by itself (invite link, or back from a version reload). */
export interface LobbyOptions {room?:string;autoJoin?:boolean}
export async function openLobby(hero:HeroClass,name:string,options:LobbyOptions={}){
  // Loaded together (CSS stays dynamic so the pure helpers above import in node tests).
  const [,{CoopClient}]=await Promise.all([import('./coop.css'),import('./net/client.ts')]);
  const dialog=document.createElement('dialog');dialog.className='coop-lobby';dialog.setAttribute('aria-label','Jogar com amigos');
  // Two columns in landscape (coop.css): make a room on the left, join one on the right.
  dialog.innerHTML=`<button class="coop-close" aria-label="Fechar">${icon('fechar',{size:32})}</button><div class="coop-lobby-cols"><div class="coop-lobby-make"><h2 tabindex="-1">Chama a turma</h2><p>Cabe até seis. Cria a sala e manda o link no grupo.</p><div class="coop-nick"><label for="coop-nick">Apelido na sala</label><div><input id="coop-nick" maxlength="60" autocomplete="nickname" spellcheck="false"/><button type="button" class="coop-nick-roll" aria-label="Sortear apelido engraçado">${icon('dado')} Sortear</button></div></div><button id="create-room">Criar sala</button></div><div class="coop-lobby-join"><div class="coop-divider">ou entre na sala de alguém</div><form novalidate><label for="room-code">Código da sala</label><input id="room-code" maxlength="80" required autocomplete="off" autocapitalize="characters" enterkeyhint="go" spellcheck="false" placeholder="3103-A23-B68"/><button type="submit">Entrar na sala</button></form><p class="coop-status" role="status"></p></div></div>`;
  // The title takes the opening focus: on the close button it drew a focus ring over the corner (and no keyboard pops up).
  document.body.append(dialog);dialog.showModal();dialog.querySelector<HTMLElement>('h2')!.focus({preventScroll:true});
  const status=dialog.querySelector<HTMLElement>('.coop-status')!;
  const nickInput=dialog.querySelector<HTMLInputElement>('#coop-nick')!;
  nickInput.value=fitName(name);
  // A long name pasted or typed: cut at a whole word with "…" (ui/nick.ts) as soon as the field is left, so it shows what the room will.
  nickInput.addEventListener('change',()=>{nickInput.value=fitName(nickInput.value);});
  dialog.querySelector('.coop-nick-roll')!.addEventListener('click',()=>{nickInput.value=suggestNickname(Math.random,nickInput.value);});
  const actionButtons=()=>dialog.querySelectorAll<HTMLButtonElement>('button:not(.coop-close):not(.coop-nick-roll)');
  for(const b of actionButtons())b.disabled=true;
  status.textContent='Preparando conexão com as salas…';
  let client:CoopClient|undefined,closed=false;
  const cancel=()=>{closed=true;client?.leave();dialog.close();dialog.remove();document.getElementById('confirm')?.focus();};
  dialog.querySelector('.coop-close')!.addEventListener('click',cancel);
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
  // Keyboard up on a field: only that field's column stays, at the top of what the keyboard leaves (no scroll).
  const typing=()=>{
    if(!dialog.isConnected){window.visualViewport?.removeEventListener('resize',typing);return;}
    const vv=window.visualViewport,field=document.activeElement?.id;
    const visible=vv?.height??innerHeight,mode=field==='room-code'?'code':field==='coop-nick'?'nick':undefined;
    if(mode&&keyboardUp(visible,innerHeight)){dialog.dataset.typing=mode;dialog.style.setProperty('--coop-vv-h',`${Math.round(visible)}px`);}
    else{delete dialog.dataset.typing;dialog.style.removeProperty('--coop-vv-h');}
  };
  window.visualViewport?.addEventListener('resize',typing);
  dialog.addEventListener('focusin',typing);dialog.addEventListener('focusout',()=>setTimeout(typing,0));
  // The city's manifest (a few bytes) rides along: its ref goes in join.maps (the 392 KB city only when a room picks it).
  // The lobby does not wait for it: a join takes it if it has arrived, waiting at most until MANIFEST_BUDGET_MS after
  // the lobby opened (later, the join offers the endless map only).
  const manifestBy=performance.now()+MANIFEST_BUDGET_MS;
  const manifest=import('./net/city-asset-loader.ts').then(m=>m.loadCityManifest()).catch(()=>undefined);
  // A room already on the city refuses a join without it: the client then waits for the manifest (the running fetch, or
  // a new one if it failed) and knocks once more (client.ts CITY_RETRY_WAIT_MS), so a slow phone is never left out.
  const manifestAgain=()=>import('./net/city-asset-loader.ts').then(m=>m.loadCityManifest());
  const endpoint=await fetch('/multiplayer.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>c?.endpoint as string|undefined).catch(()=>undefined);
  if(closed)return;
  const codeInput=dialog.querySelector<HTMLInputElement>('#room-code')!;
  codeInput.value=formatRoomCode(readRoomCode(options.room??''));
  // Pasted with or without dashes (or the whole invite link): shown grouped as soon as it is a full code.
  codeInput.addEventListener('input',()=>{const code=readRoomCode(codeInput.value);if(isRoomCode(code))codeInput.value=formatRoomCode(code);});
  let busy=false,outdated=false;
  async function enter(create:boolean){
    if(busy||closed||outdated)return;
    if(!endpoint){status.textContent='As salas ainda não estão disponíveis neste endereço. Tente novamente após a publicação.';return;}
    busy=true;for(const b of actionButtons())b.disabled=true;
    try{
      let code=readRoomCode(codeInput.value);
      if(create){status.textContent='Criando sua sala…';code=await createRoom(endpoint,objectiveFromSearch(location.search),{onRetry:()=>{status.textContent=CREATE_RETRY_TEXT;}});codeInput.value=formatRoomCode(code);}
      if(closed)return;
      if(!isRoomCode(code))throw new Error('O código tem 10 letras e números (com ou sem traço).');
      const nick=fitName(nickInput.value)||fitName(name);
      const cityRef=await within(manifest,manifestBy-performance.now());
      if(closed)return;
      client=new CoopClient(endpoint,code,nick,hero.id);client.cityRef=cityRef;client.cityManifest=manifestAgain;client.onStatus=m=>{status.textContent=m;};await client.join();
      if(closed){client.leave();return;}
      // In the room: a version reload from here comes back to it (update-toast.ts resumeOf reads it).
      dialog.dataset.room=code;
      const {openExploration}=await import('./explore.ts');dialog.close();dialog.remove();
      const joined=client;
      const opening=openExploration(hero,nick,joined);
      const layout=document.querySelector<HTMLElement>('dialog.explore-shell .explore-layout');
      if(layout)mountWaitingRoom(layout,joined);
      await opening;
    }catch(e){
      // The island's chunk is from an older deploy: the watch reloads and the resume rejoins this room. Leaving now
      // would give the seat away (leave() forgets the room's token), so nothing else happens here.
      // Only when the reload is really underway: otherwise (guard, offline) the joined client must leave as usual.
      if(chunkFailed(e)&&reloadUnderway()){status.textContent='Saiu versão nova do jogo.';return;}
      delete dialog.dataset.room;
      const fatal=client?.fatal;client?.leave();
      if(closed)return;
      // Page and rooms disagree on the version: trying again gives the same refusal, so the doors close and the
      // reason shows right under them, in view in landscape too, with the reload button (UX onda 4).
      const panel=fatal?await import('./net-fatal.ts').catch(error=>{chunkFailed(error);return undefined;}):undefined;
      if(fatal&&panel?.needsUpdate(fatal)){
        outdated=true;status.textContent='';
        panel.showFatal(dialog.querySelector<HTMLElement>('form')!,fatal,{inline:true}).scrollIntoView({block:'center'});
        return;
      }
      status.textContent=e instanceof Error?e.message:'A conexão falhou. Tente novamente.';
    }
    finally{busy=false;for(const b of dialog.querySelectorAll<HTMLButtonElement>('button'))b.disabled=outdated&&!b.matches('.coop-close,.net-fatal-reload');}
  }
  dialog.querySelector('#create-room')!.addEventListener('click',()=>void enter(true));
  dialog.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();void enter(false);});
  for(const b of actionButtons())b.disabled=false;
  status.textContent=endpoint?'':'As salas ainda não estão disponíveis neste endereço.';
  if(options.autoJoin&&endpoint&&codeInput.value)void enter(false);
}
/** How long "Jogar sozinho" waits for the city's manifest (a few bytes): the solo match is on the city, so it needs it. */
export const SOLO_MANIFEST_MS=8000;
export const SOLO_TEXT={noRooms:'As partidas ainda não estão disponíveis neste endereço.',noCity:'A cidade não baixou. Tente novamente.'} as const;
/**
 * What "Jogar sozinho" downloads before the room (cena-nasce-rapido; auditoria-ui-menus 5: started when the choice
 * popup opens, not on the tap, so the seconds the player spends looking at the popup are spent downloading): the game's
 * code (explore, scene, Phaser ~1.2 MB), the city's manifest and map (~1 MB, the room's join waits for it: loadCity
 * shares one download per hash), the rooms' address, and the own hero's first art (P0, the waiting room's gate). Once per
 * page; a failed part is asked again by the next call.
 */
interface SoloWarm {code:Promise<unknown>;manifest:Promise<(MapRef&{bytes?:number})|undefined>;city:Promise<unknown>;endpoint:Promise<string|undefined>;art?:string;
  /** The map's bytes so far (0..1) and who wants to know (the card's bar). */
  cityFraction:number;onCity:Set<(fraction:number)=>void>}
let soloWarm:SoloWarm|undefined;
function startWarm():SoloWarm{
  const manifest=import('./net/city-asset-loader.ts').then(m=>m.loadCityManifest()).catch(()=>undefined);
  const onCity=new Set<(fraction:number)=>void>();
  const warm:SoloWarm={
    cityFraction:0,onCity,
    code:Promise.all([import('./explore.ts'),import('./scene.ts'),import('./coop.css'),import('./net/client.ts')]),
    manifest,
    city:manifest.then(ref=>ref&&import('./net/city-asset-loader.ts').then(m=>m.loadCity(ref,f=>{warm.cityFraction=f;for(const l of onCity)l(f);}))).catch(()=>undefined),
    endpoint:fetch('/multiplayer.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>c?.endpoint as string|undefined).catch(()=>undefined),
  };
  // A part that failed is not kept: the next call (the tap after an error) asks again.
  const drop=()=>{if(soloWarm===warm)soloWarm=undefined;};
  warm.code.catch(drop);
  void Promise.all([manifest,warm.endpoint]).then(([m,e])=>{if(!m||!e)drop();});
  return warm;
}
export function warmSolo(heroId?:string):SoloWarm{
  const warm=soloWarm??=startWarm();
  // The hero's P0 (sheet, walk, the city's ground): the waiting room's own preloader then finds them in the cache.
  if(heroId&&warm.art!==heroId){
    warm.art=heroId;
    createPreloader().add(assetsParaPartida({self:heroId,others:[],map:SOLO_MAP,search:location.search}).filter(a=>a.priority==='P0'));
  }
  return warm;
}
/**
 * "Jogar sozinho" (BUG-20261013-ORQ-jogar-sozinho-abre-ilha): creates a room, joins it with the city in join.maps and
 * opens the match shell with the waiting room driving itself (setMap city, the bots, ready). `onJoined` closes the
 * confirmation dialog only once the room is joined, so an error before that shows under its buttons (the caller
 * catches it). The room's own countdown starts the match. `onStep`: each step done (the card's bar, solo-plan.ts).
 */
export async function openSolo(hero:HeroClass,name:string,options:{bots:number;onJoined?:()=>void;onStep?:(step:SoloStep,fraction:number)=>void}){
  // The menu track yields (the waiting room takes its own hold) while the match's files come down.
  let menuHold:(()=>void)|undefined=holdMenuDownload();
  const releaseMenu=()=>{menuHold?.();menuHold=undefined;};
  const warm=warmSolo(hero.id),step=(s:SoloStep,fraction=1)=>options.onStep?.(s,fraction);
  void warm.code.then(()=>step('code'),()=>undefined);
  const city=(f:number)=>step('city',f);warm.onCity.add(city);if(warm.cityFraction>0)city(warm.cityFraction);
  void warm.city.then(()=>{warm.onCity.delete(city);step('city');});
  const [{CoopClient}]=await Promise.all([import('./net/client.ts'),import('./coop.css')]);
  const loadManifest=()=>import('./net/city-asset-loader.ts').then(m=>m.loadCityManifest());
  const endpoint=await warm.endpoint;
  if(!endpoint){releaseMenu();throw new Error(SOLO_TEXT.noRooms);}
  const cityRef=await within(warm.manifest,SOLO_MANIFEST_MS);
  if(!cityRef){releaseMenu();throw new Error(SOLO_TEXT.noCity);}
  const plan=soloPlan(options.bots),nick=fitName(name)||'Capivara Veloz';
  let client:CoopClient|undefined;
  try{
    // sala-solo-privada: a room only for this person, already on the solo map (a plain-text body: no CORS preflight; a
    // room Worker from before reads none and opens the usual room, which the solo plan still switches to the city).
    const body:RoomCreateOptions={map:plan.map,solo:true,...objectiveFromSearch(location.search)};
    // The room and the join get one silent second try (a cold Worker, solo-plan.ts soloOneRetry): a new room each time.
    const joined=await soloOneRetry(async()=>{
      const r=await fetch(new URL('/rooms',endpoint),{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await r.json();
      if(!r.ok)throw new Error(data.error??'Não foi possível criar a sala.');
      step('room');
      const fresh=new CoopClient(endpoint,data.code,nick,hero.id);client=fresh;fresh.cityRef=cityRef;fresh.cityManifest=loadManifest;await fresh.join();
      return fresh;
    },()=>{const fatal=!!client?.fatal;if(!fatal){client?.leave();client=undefined;}return !fatal;});
    step('join');
    const {openExploration}=await import('./explore.ts');
    options.onJoined?.();
    const opening=openExploration(hero,nick,joined);
    const layout=document.querySelector<HTMLElement>('dialog.explore-shell .explore-layout');
    if(layout)mountWaitingRoom(layout,joined,{solo:plan});
    releaseMenu();
    await opening;
  }catch(e){
    releaseMenu();
    // A stale chunk with the reload underway: the resume comes back to this room (same rule as openLobby).
    if(chunkFailed(e)&&reloadUnderway())return;
    const fatal=client?.fatal;client?.leave();
    throw fatal?new Error(fatal):e;
  }
}
