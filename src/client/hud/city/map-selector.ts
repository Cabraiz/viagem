/**
 * Map selector of the waiting room (doc §4): a segmented control (radiogroup "Mapa"), Cidade Nevada by default. The
 * owner picks; the server decides (nothing changes before its `{t:'map'}`), a request without answer in PENDING_MS goes
 * back to the server's map. Guests see the same control read-only. Locked in the countdown; off while the connection
 * is down (sem-linha); a reconnect or a new owner drops what was pending. Pure state machine and view first, the DOM below.
 */
import {icon,PROTOCOL_DEFAULT_MAP,type IconName,type MapId} from './deps.ts';
import type {Orientation} from './layout.ts';

let css:Promise<void>|undefined;
/**
 * Loads city-hud.css once (the selector and the city's edge arrows; a failed load is swallowed, as in
 * dev/ux-metrics.ts). The selector stays hidden until this settles, so nothing shows unstyled.
 */
export const cityHudCss=()=>css??=import('./city-hud.css').then(()=>undefined,()=>undefined);

/** Map ids are the protocol's (src/protocol/map-select.ts), so the selector and the room never disagree. */
export type {MapId};
/** Name (Londrina --t-16) and the joke (M PLUS 700 --t-13, ≤ 28 characters, portrait only). */
export const MAP_OPTIONS:readonly {id:MapId;name:string;subtitle:string}[]=[
  {id:'cidade-nevada',name:'Cidade Nevada',subtitle:'Leve casaco, a firma não deu'},
  {id:'infinito',name:'Mapa infinito',subtitle:'Praia sem fim, boleto também'},
];
/** Until the room confirms a map, show the protocol's default. */
export const DEFAULT_MAP:MapId=PROTOCOL_DEFAULT_MAP,PENDING_MS=3000;
/** How long the room's news strip shows "Mapa trocado: …" and how long a hint stays on the room's line in landscape. */
export const NEWS_MS=4000,GUEST_HINT_MS=1200;
export const SELECTOR_TEXT={
  label:'Mapa',
  guest:'Quem escolhe o mapa é o dono da sala.',
  locked:'Na contagem o mapa não muda.',
  failed:'Não chegou. Toca de novo.',
  /** Subtitle of a map that is wired but not open yet (D-035: the city until CITY_PLAYABLE). */
  soon:'em breve',
} as const;
/** The room's news after the server changed the map (the server resets everyone's ready). */
export const mapChangedNews=(map:MapId)=>`Mapa trocado: ${MAP_OPTIONS.find(o=>o.id===map)?.name??map}. Confirmem de novo.`;
/** The selected option's subtitle while the city downloads ("Baixando a cidade: 40%"); feed it as a 'download' event. */
export const downloadText=(fraction:number)=>`Baixando a cidade: ${Math.round(Math.min(1,Math.max(0,fraction))*100)}%`;

export interface SelectorState {confirmed:MapId;pending?:{map:MapId;sinceMs:number};canManage:boolean;locked:boolean;
  /** The connection is down (5 s reconnection): segments off with sem-linha, taps send nothing. */
  offline:boolean;
  /** The last request ran out (PENDING_MS): the hint says so until the next tap or confirmation. */
  failed?:boolean;
  /** Download progress text of the selected map ("Baixando a cidade: 40%"), shown instead of its subtitle. */
  download?:string;
  /**
   * Maps shown locked "em breve" (D-035: the city while CITY_PLAYABLE is false), each with the text an owner's tap on it
   * shows as the hint. A tap on one never sends; the room would refuse it anyway.
   */
  soon?:Partial<Record<MapId,string>>;
  /** The text of the owner's last tap on an "em breve" map: the hint until the next tap, confirmation or lock. */
  notice?:string}
export type SelectorEvent=
  |{type:'tap';map:MapId;nowMs:number}
  |{type:'confirm';map:MapId}
  |{type:'tick';nowMs:number}
  |{type:'countdown';on:boolean}
  |{type:'reconnect'}
  |{type:'owner';canManage:boolean}
  |{type:'offline';on:boolean}
  |{type:'download';text?:string};

export function initialSelector(canManage:boolean,confirmed:MapId=DEFAULT_MAP):SelectorState{
  return {confirmed,canManage,locked:false,offline:false};
}
const settle=(s:SelectorState,patch:Partial<SelectorState>={}):SelectorState=>{const {pending:_p,failed:_f,notice:_n,...rest}=s;return {...rest,...patch};};
/** An "em breve" map other than the room's own (the room's map always shows as the selected one). */
const soonText=(s:SelectorState,map:MapId)=>map!==s.confirmed?s.soon?.[map]:undefined;

/** One event; `send` is the map to ask the server for (an owner's tap on the other map: online, not locked, nothing pending). */
export function selectorReducer(s:SelectorState,e:SelectorEvent):{state:SelectorState;send?:MapId}{
  switch(e.type){
    case 'tap':{
      if(!s.canManage||s.locked||s.offline||s.pending||e.map===s.confirmed)return {state:s};
      // "em breve": the owner gets the reason as the hint, nothing goes to the room (no pending, no 3 s wait).
      const soon=soonText(s,e.map);
      if(soon!==undefined)return {state:settle(s,{notice:soon})};
      return {state:{...settle(s),pending:{map:e.map,sinceMs:e.nowMs}},send:e.map};
    }
    case 'confirm':return {state:settle(s,{confirmed:e.map})};
    case 'tick':return s.pending&&e.nowMs-s.pending.sinceMs>=PENDING_MS?{state:settle(s,{failed:true})}:{state:s};
    case 'countdown':return {state:e.on?settle(s,{locked:true}):{...s,locked:false}};
    case 'reconnect':return {state:s.pending?settle(s):s};
    case 'owner':return {state:e.canManage===s.canManage?s:settle(s,{canManage:e.canManage})};
    case 'offline':return {state:e.on?settle(s,{offline:true}):{...s,offline:false}};
    case 'download':{const {download:_d,...rest}=s;return {state:e.text?{...rest,download:e.text}:rest};}
  }
}

export type SelectorSticker=Extract<IconName,'pronto'|'relogio'|'cadeado'|'sem-linha'>;
export interface SelectorView {options:{id:MapId;name:string;subtitle?:string;selected:boolean;pending:boolean;disabled:boolean;
  /** The 20 px sticker on the segment: sem-linha (offline, both), cadeado (countdown, selected; "em breve"), relogio (pending), pronto (selected). */
  sticker?:SelectorSticker;
  /** Locked "em breve" (disabled: it never sends), yet an owner's tap on it still answers with the hint. */
  soon?:true}[];hint?:string}
/** What the control shows. Landscape drops the subtitles (the joke) but keeps the download text; hints are handed out there. */
export function selectorView(s:SelectorState,orientation:Orientation):SelectorView{
  const disabled=!s.canManage||s.locked||s.offline||!!s.pending;
  const options=MAP_OPTIONS.map(o=>{
    const selected=o.id===s.confirmed,pending=s.pending?.map===o.id,soon=soonText(s,o.id)!==undefined;
    // "em breve" stays in landscape too: it is information, not the joke.
    const subtitle=selected&&s.download?s.download:soon?SELECTOR_TEXT.soon:orientation==='portrait'?o.subtitle:undefined;
    const sticker:SelectorSticker|undefined=s.offline?'sem-linha':soon||s.locked&&selected?'cadeado':pending?'relogio':selected?'pronto':undefined;
    return {id:o.id,name:o.name,...(subtitle?{subtitle}:{}),selected,pending,disabled:disabled||soon,...(sticker?{sticker}:{}),...(soon?{soon:true as const}:{})};
  });
  const hint=s.locked?SELECTOR_TEXT.locked:s.failed?SELECTOR_TEXT.failed:s.notice??(!s.canManage&&orientation==='portrait'?SELECTOR_TEXT.guest:undefined);
  return hint?{options,hint}:{options};
}

// ---------- DOM (browser only) ----------
export interface MapSelectorOptions {
  state:SelectorState;orientation:Orientation;
  /** The owner tapped a map (feed it to the reducer as a 'tap' with this `nowMs`, the clock of `now`). */
  onPick:(map:MapId,nowMs:number)=>void;
  /** Events the control raises itself: the 'tick' when a pending request reaches PENDING_MS. */
  onEvent?:(event:SelectorEvent)=>void;
  /** Landscape has no hint line: a new hint (countdown, "Não chegou", a guest's tap) goes to the room's line. */
  onHint?:(text:string)=>void;
  /** Clock of the pending timer, the same one the 'tap' events use. Default performance.now(). */
  now?:()=>number;
}
/**
 * The control inside `host`. Owner: a radiogroup of buttons; guests: the same segments as read-only radios (no button,
 * aria-readonly). Landscape wraps it in the small Lilás window (the lobby places it with layout.selector). It owns the
 * pending timer, so a request never waits on the lobby's ticking. Hidden until city-hud.css has loaded.
 */
export function mountMapSelector(host:HTMLElement,opts:MapSelectorOptions):{update(s:SelectorState,orientation?:Orientation):void;destroy():void}{
  const doc=host.ownerDocument,root=doc.createElement('div'),now=opts.now??(()=>performance.now());
  root.className='ch-selector';root.hidden=true;
  void cityHudCss().then(()=>{root.hidden=false;});
  const group=doc.createElement('div');group.className='ch-selector-group';group.setAttribute('role','radiogroup');group.setAttribute('aria-label',SELECTOR_TEXT.label);
  const crown=doc.createElement('span');crown.className='ch-selector-crown';crown.innerHTML=icon('coroa');
  // The hint is a polite live region (the owner's tap on "em breve" says why there): it stays in the tree, empty and
  // collapsed when there is nothing to say, so a new text is announced; it is only rewritten when the text changes.
  const hint=doc.createElement('p');hint.className='ch-selector-hint is-empty';hint.setAttribute('aria-live','polite');hint.setAttribute('aria-atomic','true');
  root.append(crown,group,hint);host.append(root);
  let state=opts.state,orientation=opts.orientation,owner:boolean|undefined,lastHint:string|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,timerFor:number|undefined;
  const stopTimer=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;timerFor=undefined;};
  const segments=new Map<MapId,HTMLElement>();
  const build=()=>{
    owner=state.canManage;group.textContent='';segments.clear();
    for(const o of MAP_OPTIONS){
      const seg=doc.createElement(owner?'button':'div');seg.className='ch-segment';seg.dataset.map=o.id;seg.setAttribute('role','radio');
      if(seg instanceof HTMLButtonElement){seg.type='button';seg.addEventListener('click',()=>opts.onPick(o.id,now()));}
      else seg.addEventListener('click',()=>{if(orientation==='landscape')opts.onHint?.(SELECTOR_TEXT.guest);});
      seg.innerHTML='<span class="ch-segment-mark"></span><span class="ch-segment-text"><strong></strong><small></small></span>';
      group.append(seg);segments.set(o.id,seg);
    }
  };
  const update=(s:SelectorState,o:Orientation=orientation)=>{
    state=s;orientation=o;
    if(owner!==s.canManage)build();
    const view=selectorView(s,o);
    root.dataset.orientation=o;root.classList.toggle('is-owner',s.canManage);root.classList.toggle('is-locked',s.locked);root.classList.toggle('is-offline',s.offline);
    if(s.canManage)group.removeAttribute('aria-readonly');else group.setAttribute('aria-readonly','true');
    group.setAttribute('aria-busy',String(!!s.pending));
    crown.hidden=s.canManage||o==='portrait';
    for(const v of view.options){
      const seg=segments.get(v.id)!;
      seg.setAttribute('aria-checked',String(v.selected));seg.classList.toggle('is-selected',v.selected);seg.classList.toggle('is-pending',v.pending);seg.classList.toggle('is-soon',!!v.soon);
      // An "em breve" button stays tappable for the owner (aria-disabled), so the tap can say why; the reducer never sends it.
      if(seg instanceof HTMLButtonElement){
        seg.disabled=v.soon?!s.canManage||s.locked||s.offline||!!s.pending:v.disabled;
        if(v.soon)seg.setAttribute('aria-disabled','true');else seg.removeAttribute('aria-disabled');
      }else seg.setAttribute('aria-disabled','true');
      const mark=seg.querySelector<HTMLElement>('.ch-segment-mark')!,sticker=v.sticker??'';
      if(mark.dataset.icon!==sticker){mark.dataset.icon=sticker;mark.innerHTML=v.sticker?icon(v.sticker):'';}
      seg.querySelector('strong')!.textContent=v.name;
      const small=seg.querySelector('small')!;
      if(small.textContent!==(v.subtitle??''))small.textContent=v.subtitle??'';
      small.hidden=!v.subtitle;
    }
    const crowned=!!view.hint&&!s.canManage&&!s.locked&&!s.failed&&!s.notice,hintKey=view.hint?`${crowned?'+':'-'}${view.hint}`:'';
    if(hint.dataset.key!==hintKey){
      hint.dataset.key=hintKey;
      hint.innerHTML=view.hint?`${crowned?icon('coroa'):''}<span></span>`:'';
      hint.querySelector('span')?.append(view.hint??'');
    }
    hint.classList.toggle('is-empty',!view.hint);
    // Landscape: a new hint goes to the room's line (it has no line of its own).
    if(o==='landscape'&&view.hint&&view.hint!==lastHint)opts.onHint?.(view.hint);
    lastHint=view.hint;
    // The pending request's own clock: a 'tick' at PENDING_MS, whoever else ticks.
    if(!s.pending)stopTimer();
    else if(timerFor!==s.pending.sinceMs){
      stopTimer();timerFor=s.pending.sinceMs;
      const due=s.pending.sinceMs+PENDING_MS;
      // nowMs never below `due`: a timer that fires a hair early must not leave the request stuck.
      timer=setTimeout(()=>{timer=undefined;opts.onEvent?.({type:'tick',nowMs:Math.max(now(),due)});},Math.max(0,due-now()));
    }
  };
  update(state,orientation);
  return {update,destroy:()=>{stopTimer();root.remove();}};
}
