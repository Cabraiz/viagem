/**
 * Stonewards HUD (VGM-046B), three pieces in the zones of UX-zonas-tela:
 * - the base ficha (status, top band), one line, always in a run: the wall's life (.rh-camp-barra, the bar, and
 *   .rh-camp-num, the number), my wallet ("R$ 120", .rh-camp-grana; carteira-e-pix: CampView.grana is the viewer's
 *   own, the team has no pot any more) and the team's fichas de torre (D-048: the tower
 *   sticker in a ring filling to the next ficha, and the count, .rh-camp-token);
 * - the forge window (an intermission window, like the round offer): opens by itself while the hero stands in the camp
 *   during the intermission and no offer is open; three price tags in Grana (price.ts forgePriceLabel, "R$ N"), one tap
 *   buys for the team with my wallet. Tags my wallet cannot pay stay readable with a padlock and say why on tap ("Falta R$ 2.", no dead
 *   button);
 * - the horn notice (announcement slot): "Volta pra base" with the seconds left and an arrow to the base; inside the
 *   camp it says when the critters arrive. In a wave, the wall crossing 50% and 25% shows here for 3 s.
 * City barricades (card NEW-20261012-E5-cidade-barricadas-cliente): standing within CAMP_RADIUS of a barricade in the
 * intermission opens the same window, even away from the wall, with one more tag that repairs (or raises) THAT barricade
 * ({t:'forge',recipe:'reparo',target:'barricada-N'}); away from the wall the forge's own tags stay readable but refuse
 * with 'away', as the server would.
 * Pure DOM over RunView plus what explore.ts knows on the client (the hero's predicted spot, the base's direction on
 * screen); every number comes from the room. Names always through textContent.
 */
import {putAttr,putData,putHidden,putIconNumber,putText,putTextData} from './dom-put.ts';
import {CAR_ID} from '../../contract/index.ts';
import type {CampView,RunView,StructureView} from '../../contract/index.ts';
import {CAMP_RADIUS,FORGE_REFUSALS,RECIPES,RECIPE_IDS,canPay,forgePrice,tokenProgress,tokensOf,type RecipeId} from '../../rules/index.ts';
import {icon,type IconName} from '../ui/icon.ts';
import {sticker,type StickerName} from '../ui/sticker.ts';
import {exploraLeft,fallLine,type ExploraWindows,nestCount,roundInfo,secondsLeft,type HudContext,type HudPart} from './model.ts';
import {writeFallLine} from './offer.ts';
import {watchOverflow} from './overflow.ts';
import {fichasText,forgePriceLabel,granaText} from './price.ts';
import {barricadeAt,type BarricadeSpot,type CityBocas} from './city/index.ts';
import {carBar} from './chaveiro.ts';
import {effectivePhase,nestsRun} from '../calm-phase.ts';
import {HUD_SWITCH} from './arrows.ts';
import {getAudio} from '../audio/engine.ts';

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
/**
 * The short effect of a tag (one row on every screen, camp.css, cards forja-uma-linha-paisagem and
 * forja-cobre-heroi-retrato), next to the sticker that says what it acts on: a few characters, so the name keeps the row
 * (667 px landscape leaves ~130 px for both). The long one (RECIPES describe) stays in the tag's aria-label.
 */
export const RECIPE_SHORT:Readonly<Record<RecipeId,string>>={reparo:'+25%',gambiarra:'+1 nível','torre-chinelo':'45 s'};
const recipeArt=(art:IconName|{sticker:StickerName})=>typeof art==='string'?icon(art,{size:32}):sticker(art.sticker,{size:32});

export interface ForgeAnswer {req:number;recipe:string;ok:boolean;reason?:string}
export interface CampOptions {
  /**
   * Sends the purchase; returns the request id, or undefined when it cannot reach the room now. `target` names what a
   * 'reparo' repairs ('barricada-N'), only for a city barricade; the wall's tags never send one.
   */
  onForge(recipe:RecipeId,target?:string):number|undefined;
}
/** Where the hero is (client prediction) and where the base lies on screen (degrees, 0 = right, clockwise). */
export interface HeroSpot {x:number;y:number;bearing?:number}

/** A forge tower on the wire ('torre-chinelo'): the wall and the city barricades are structures too, never towers. */
export const isTower=(s:Pick<StructureView,'kind'>)=>s.kind.startsWith('torre-');
/**
 * Why a tag cannot be bought right now, or undefined when it can (pure, tested). `away`: the hero is out of the camp
 * (the window is open at a city barricade): the forge's own tags refuse like the server, after the wall-down check.
 */
export function blockedReason(recipe:RecipeId,view:Pick<RunView,'camp'|'structures'|'players'>,localId:string,away=false):string|undefined{
  const camp=view.camp;
  if(!camp)return 'phase';
  if(camp.wallDown)return 'wall-down';
  if(away)return 'away';
  if(!canPay(camp.grana,forgePrice(recipe,camp.forge)))return 'balance';
  if(recipe==='reparo'){const w=wallOf(view.structures);if(w&&w.hp>=w.maxHp)return 'full';}
  if(recipe==='torre-chinelo'&&view.structures.filter(isTower).length>=MAX_TOWERS)return 'full';
  if(recipe==='gambiarra'){
    const me=view.players.find(p=>p.id===localId);
    if(me&&!me.weapons.some(w=>!w.id.endsWith('-evo')&&w.level<MAX_WEAPON_LEVEL))return 'no-weapon';
  }
  return undefined;
}
/** What is missing for a recipe in Grana, "Falta R$ 2." (pure, tested; the price as the tag shows it, price.ts granaText). */
export function missing(camp:Pick<CampView,'grana'|'forge'>,recipe:RecipeId){
  const short=Math.ceil(forgePrice(recipe,camp.forge)-(Number.isFinite(camp.grana)?camp.grana:0)-1e-9);
  return short>0?`Falta ${granaText(short)}.`:'';
}
/**
 * The top bar's Grana (D-048, pure, tested): my wallet (carteira-e-pix, CampView.grana), "R$ 120" on screen, "Você tem
 * R$ 120" for the screen reader (never negative). A friend's balance shows only in the PIX balloon (hud/pix.ts).
 */
export function granaReadout(grana:number){
  const text=granaText(grana);
  return {text,label:`Você tem ${text}`};
}
/**
 * The top bar's fichas (D-048, pure, tested): the whole fichas in the pile, the ring's fill towards the next one and the
 * words for the screen reader. The percent rounds down: "próxima em 100%" would be a ficha the count does not show yet.
 */
export function tokenReadout(units:number){
  const u=Number.isFinite(units)?Math.max(0,units):0,tokens=tokensOf(u),progress=tokenProgress(u),percent=Math.floor(progress*100+1e-9);
  return {tokens,progress,percent,label:`${fichasText(tokens)}, próxima em ${percent}%`};
}
/**
 * Its markup, one line (pure, tested): the tower sticker inside a thin ring (a 0..100 dash, from the top, clockwise) and
 * the count. The ring's track always shows, so "0 and almost one" still reads as "falta pouco".
 */
export function tokenMarkup(units:number){
  const {tokens,progress}=tokenReadout(units);
  return `<span class="rh-camp-anel" aria-hidden="true">${icon('torre')}<svg class="rh-camp-anel-svg" viewBox="0 0 32 32" focusable="false">`
    +`<circle class="rh-camp-anel-fundo" cx="16" cy="16" r="14"/><circle class="rh-camp-anel-cheio" cx="16" cy="16" r="14" pathLength="100" stroke-dasharray="${+(progress*100).toFixed(1)} 100"/></svg></span><b>${tokens}</b>`;
}
export const wallOf=(structures:readonly StructureView[])=>structures.find(s=>s.kind==='muralha');
/**
 * The clock the phone's minimal top shows inside the team's bar (hud-mobile-minimo; the round chip that shows it on the
 * desktop is not on the phone), pure (tested): the chaveiro's while he rides (D-047: it wins, it is the objective), else
 * the intermission's countdown before the next wave ("12 s", urgent at 5 s and under, like the round chip); none in a
 * wave. `aria`: the same in words, for the screen reader (the bar's picture is aria-hidden).
 */
export interface BarClock {
  /** The sticker before the number: none on the chaveiro's clock nor the time to explore (the user 25/10: no moto there). */
  icon?:'relogio'|'cadeado';text:string;aria:string;urgent:boolean;
  /** The chaveiro's clock stopped by the chefão (hud/chaveiro.ts ChaveiroClock.held): the padlock, the number grey. */
  held?:boolean;
  /** D-051 nests mode: the nests still standing ("6/8") after the clock. */
  nests?:string}
export function barClock(view:RunView,windows?:ExploraWindows):BarClock|undefined{
  const round=roundInfo(view),nests=nestCount(view);
  // The time to explore (card topo-sem-icone-contagem-exploracao): the seconds left as a bare number, "120", "119"…
  const left=exploraLeft(view.tick,windows);
  if(left!==undefined)return {text:String(left),aria:`Exploração: faltam ${left} s`,urgent:false};
  if(round?.chaveiro){
    const c=round.chaveiro;
    return {...(c.held?{icon:'cadeado' as const,held:true}:{}),text:c.clock,aria:nests?`${c.aria}. ${nests.aria}`:c.aria,urgent:false,...(nests?{nests:nests.text}:{})};
  }
  // The nests mode has no intermission: no countdown to show.
  if(nests)return undefined;
  if(round?.phase==='prepare'&&round.countdown!==undefined)return {icon:'relogio',text:`${round.countdown} s`,aria:round.detail,urgent:round.countdown<=5};
  return undefined;
}
/**
 * What the base ficha's bar and number show (pure, tested): the wall's life, or, with the chaveiro objective (D-047),
 * the hits the car still takes (hud/chaveiro.ts carBar), the car standing where the wall stood. One shape for both, so
 * the swap is this function and paintBaseBar only (card chaveiro-hud; E6's .rh-camp-barra/.rh-camp-num keep it).
 */
export interface BaseBar {fraction:number;value:number;low:boolean;label:string;car:boolean}
export function baseBar(view:Pick<RunView,'structures'|'objective'>):BaseBar{
  const car=carBar(view.objective);
  if(car)return {fraction:car.fraction,value:car.left,low:car.low,label:car.label,car:true};
  const wall=wallOf(view.structures),fraction=wall&&wall.maxHp>0?Math.max(0,Math.min(1,wall.hp/wall.maxHp)):0;
  return {fraction,value:Math.max(0,Math.ceil(wall?.hp??0)),low:fraction>0&&fraction<.3,label:'Vida da muralha',car:false};
}
/** Whether the hero stands in the camp (the forge works there). */
export const inCamp=(hero:HeroSpot|undefined,wall:StructureView|undefined)=>!!hero&&!!wall&&Math.hypot(hero.x-wall.x,hero.y-wall.y)<=CAMP_RADIUS;

/** Why the barricade tag cannot be bought now, or undefined (pure, tested; the server's order: wall, balance, full). */
export function barricadeBlocked(spot:Pick<BarricadeSpot<StructureView>,'structure'|'down'>,camp:RunView['camp']):string|undefined{
  if(!camp)return 'phase';
  if(camp.wallDown)return 'wall-down';
  if(!canPay(camp.grana,RECIPES.reparo.cost))return 'balance';
  if(!spot.down&&spot.structure.hp>=spot.structure.maxHp)return 'full';
  return undefined;
}
/**
 * The barricade tag's texts: its name on the tag (the verb and the gate: "Reparar barricada Norte" lost the gate to the
 * ellipsis at 125%, and the tag's sticker already says barricade), the whole one for the aria-label, its line, the
 * one-line form's short effect (RECIPE_SHORT) and the stamp's note once the room says yes (pure, tested).
 */
export function barricadeText(spot:Pick<BarricadeSpot,'name'|'down'>){
  return spot.down
    ?{name:`Reerguer ${spot.name}`,full:`Reerguer barricada ${spot.name}`,describe:'Levanta de novo com 25% da vida',short:'Com 25%',done:`Barricada ${spot.name} de pé!`}
    :{name:`Reparar ${spot.name}`,full:`Reparar barricada ${spot.name}`,describe:'Conserta 25% da barricada',short:'+25%',done:`Barricada ${spot.name} consertada!`};
}
/**
 * Where the window stands (pure, tested): open in the camp or at a barricade; the title names the place; away from the
 * wall the barricade tag goes first and the forge's own tags refuse with 'away'.
 */
export function forgePlace(home:boolean,spot:BarricadeSpot|undefined){
  // The key names the place only: inside the camp it stays 'base' whichever barricade is in reach (boca S is ~2.4 u from
  // the wall, so its reach covers most of the camp and must not reopen a window the player closed there).
  return {open:home||!!spot,away:!home,title:home?'Forja':'Barricada',barricadeFirst:!home,key:home?'base':spot?.target??''};
}

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
  /** The city's 4 plaza mouths (the decoded asset's `bocas`), undefined off the city: barricade tags need them. */
  setBocas(bocas:CityBocas|undefined):void;
  /** The obra window is open (torres-ligar): the forge steps aside (hidden, not dismissed) and comes back when it closes. */
  yieldTo(obra:boolean):void;
}

export function createCamp(options:CampOptions):CampPart{
  // ---------- Base ficha ----------
  const readout=el('div','rh-camp');readout.hidden=true;readout.setAttribute('role','group');readout.setAttribute('aria-label','Base');
  const wallRow=el('span','rh-camp-wall',readout);
  // The base has one symbol everywhere (design onda 6 D10): the tent with its flag, as on the map, the arrows and the minimap.
  wallRow.insertAdjacentHTML('beforeend',icon('base',{label:'Base'}));
  // The bar and the number each in their own box (.rh-camp-barra, .rh-camp-num): the chaveiro's car bar takes these
  // places later (Executor-4), the order unchanged. The bar is what gives way on a narrow screen.
  const barra=el('span','rh-camp-barra',wallRow),num=el('span','rh-camp-num',wallRow);
  const track=el('span','rh-camp-track',barra),fill=el('i','rh-camp-fill',track),hp=el('b','rh-camp-hp',num);
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Vida da muralha');
  // The phone's minimal top (hud-mobile-minimo, fone.css): the life's number, or a clock (barClock: the chaveiro's, D-047,
  // or the intermission's countdown), rides over the bar, small; the round chip that carries them elsewhere is not on the
  // phone. Over the bar's box, not inside the track (its overflow would cut the clock at 125 %). Hidden on the desktop,
  // where the round chip says it; on the phone the words go to the screen reader (.rh-sr, as topbar.ts does).
  const clock=el('span','rh-camp-relogio',wallRow);clock.hidden=true;
  const clockWords=el('span','rh-sr',clock),clockPicture=el('span','rh-camp-relogio-ficha',clock);clockPicture.setAttribute('aria-hidden','true');
  let lastClock:string|undefined;
  const paintClock=(view:RunView,w:ExploraWindows)=>{
    const bar=barClock(view,w),key=bar?`${bar.icon??''}|${bar.text}|${bar.aria}|${bar.urgent}|${bar.held??''}|${bar.nests??''}`:'';
    if(key===lastClock)return;
    lastClock=key;putHidden(clock,!bar);readout.classList.toggle('rh-camp-com-relogio',!!bar);
    if(bar){putTextData(clockWords,bar.aria);putIconNumber(clockPicture,bar.icon?icon(bar.icon):'',bar.text);if(bar.urgent)clock.dataset.urgente='';else delete clock.dataset.urgente;
      if(bar.held)clock.dataset.parado='';else delete clock.dataset.parado;}
    else{putTextData(clockWords,'');putText(clockPicture,'');delete clock.dataset.urgente;delete clock.dataset.parado;}
  };
  /** The bar and the number (baseBar: the wall, or the chaveiro's car); the only DOM the car swap touches. */
  const paintBaseBar=(bar:BaseBar,down:boolean)=>{
    fill.style.transform=`scaleX(${bar.fraction})`;
    readout.classList.toggle('rh-camp-low',bar.low||down);
    if(readout.classList.contains('rh-camp-carro')!==bar.car)readout.classList.toggle('rh-camp-carro',bar.car);
    putText(hp,String(bar.value));
    if(track.getAttribute('aria-label')!==bar.label)track.setAttribute('aria-label',bar.label);
    putAttr(track,'aria-valuenow',String(Math.round(bar.fraction*100)));
  };
  // My wallet (D-048, carteira-e-pix), "R$ 120", always shown, before the fichas; rewritten only when it changes.
  const grana=el('span','rh-camp-grana',readout);grana.setAttribute('role','img');
  const granaValue=el('b','rh-camp-grana-valor',grana);granaValue.setAttribute('aria-hidden','true');
  let lastGrana:string|undefined;
  // The team's fichas de torre (D-048): one sticker in its ring and the count; rewritten only when the pile changes.
  const token=el('span','rh-camp-token',readout);token.setAttribute('role','img');
  let lastUnits:number|undefined;

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
  // The title's cell holds my wallet where it is spent (hud-mobile-minimo: the phone's top shows no R$): "R$ 120"
  // as a small second line under "Forja", so the head keeps its three cells (title, note, close) in a narrow window.
  const titleCell=el('div','rh-forge-titulo',head);
  const title=el('h2','rh-forge-title',titleCell);title.textContent='Forja';
  const wallet=el('b','rh-forge-grana',titleCell);wallet.setAttribute('role','img');
  let lastWallet:string|undefined;
  const close=el('button','rh-forge-close',head);close.type='button';close.setAttribute('aria-label','Fechar a forja');close.insertAdjacentHTML('beforeend',icon('fechar',{size:32}));
  const list=el('div','rh-forge-tags',forge);
  /** A tag of the window: the forge's three recipes, plus 'barricada' (a 'reparo' with the barricade as target). */
  type TagKey=RecipeId|'barricada';
  interface Tag {button:HTMLButtonElement;lock:HTMLElement;full:HTMLElement;name:HTMLElement;short:HTMLElement}
  const tags=new Map<TagKey,Tag>();
  const makeTag=(key:TagKey,art:IconName|{sticker:StickerName},recipe:RecipeId):Tag=>{
    const r=RECIPES[recipe],button=el('button','rh-forge-tag',list);button.type='button';button.dataset.recipe=recipe;
    button.insertAdjacentHTML('beforeend',`<span class="rh-forge-icon">${recipeArt(art)}</span>`);
    const body=el('span','rh-forge-body',button);
    const name=el('strong','rh-forge-name',body);name.textContent=r.name;
    // One row (camp.css): name, short effect and price; the long effect is in the aria-label.
    const short=el('span','rh-forge-curto',body);short.textContent=RECIPE_SHORT[recipe];
    const price=el('span','rh-forge-price',button);
    // "R$ N" (the tag's aria-label says the price in words); render() rewrites it when the inflação moves it.
    const cost=el('span','rh-forge-cost',price);cost.insertAdjacentHTML('beforeend',forgePriceLabel(r.cost).html);cost.dataset.price=String(r.cost);
    const lock=el('span','rh-forge-lock',price);lock.insertAdjacentHTML('beforeend',icon('cadeado',{label:'Sem grana'}));lock.hidden=true;
    // Nothing to do (wall already full, three towers up): a check, not only a paler tag (review onda 6, B8).
    const full=el('span','rh-forge-full',price);full.insertAdjacentHTML('beforeend',icon('pronto',{label:'Já tá no máximo'}));full.hidden=true;
    el('span','rh-forge-stamp',button).textContent='LEVEI';
    const tag={button,lock,full,name,short};tags.set(key,tag);return tag;
  };
  for(const id of RECIPE_IDS)makeTag(id,RECIPE_ICON[id],id);
  // The city barricade's repair: the wall repair's price (one recipe), hidden until the hero stands at a barricade.
  const fence=makeTag('barricada','muralha','reparo');fence.button.hidden=true;
  const note=el('p','rh-forge-note',head);note.setAttribute('aria-live','polite');
  // Someone fell while the forge is open: a Cone ficha in the note's place (the note comes back for a tap's answer).
  const fall=el('p','rh-window-fall rh-forge-fall',head);fall.hidden=true;fall.setAttribute('role','status');
  const overflow=watchOverflow(list);

  let last:RunView|undefined,ctxId='',windows:ExploraWindows={},hero:HeroSpot|undefined,bocas:CityBocas|undefined;
  let dismissed=false,stint=-1,lastPlace='',yielded=false;
  /** Where the hero stands now (render): in the camp, and the barricade he can repair (city only). */
  let home=false,spot:BarricadeSpot<StructureView>|undefined;
  let pending:{req:number;key:TagKey;recipe:RecipeId;done:string;timer:ReturnType<typeof setTimeout>}|undefined;
  let stampTimer:ReturnType<typeof setTimeout>|undefined,noteTimer:ReturnType<typeof setTimeout>|undefined;
  let lastFraction:number|undefined,warning:{text:string;until:number}|undefined,warnTimer:ReturnType<typeof setTimeout>|undefined;

  const say=(text:string,keep=false)=>{
    note.textContent=text;delete note.dataset.padrao;note.hidden=false;fall.hidden=true;clearTimeout(noteTimer);
    if(!keep)noteTimer=setTimeout(()=>{note.textContent=DEFAULT_NOTE;note.dataset.padrao='';},2600);
  };
  const DEFAULT_NOTE='Sai da sua grana. Toca pra comprar.';
  // data-padrao: the standing line, not an answer (the landscape window leaves it out, camp.css).
  note.textContent=DEFAULT_NOTE;note.dataset.padrao='';
  const refusal=(reason:string,recipe:RecipeId)=>reason==='balance'?(last?.camp&&missing(last.camp,recipe))||FORGE_REFUSALS.balance:FORGE_REFUSALS[reason]??'Agora não dá.';

  const tap=(key:TagKey)=>{
    if(!last||pending)return;
    const at=key==='barricada'?spot:undefined;
    if(key==='barricada'&&!at)return;
    const recipe:RecipeId=key==='barricada'?'reparo':key;
    const reason=at?barricadeBlocked(at,last.camp):blockedReason(recipe,last,ctxId,!home);
    if(reason){say(refusal(reason,recipe));return;}
    const req=at?options.onForge(recipe,at.target):options.onForge(recipe);
    if(req===undefined){say('Sem conexão com a sala. Tenta de novo.');return;}
    tags.get(key)!.button.classList.add('rh-forge-pending');tags.get(key)!.button.setAttribute('aria-busy','true');
    say('Forjando…',true);
    pending={req,key,recipe,done:at?barricadeText(at).done:`${RECIPES[recipe].name}: feito!`,
      timer:setTimeout(()=>{if(pending?.req===req){clearPending();say('Sem resposta da sala. Tenta de novo.');}},FORGE_TIMEOUT_MS)};
  };
  const clearPending=()=>{
    if(!pending)return;
    clearTimeout(pending.timer);
    const t=tags.get(pending.key)!;t.button.classList.remove('rh-forge-pending');t.button.removeAttribute('aria-busy');
    pending=undefined;
  };
  for(const [key,{button}] of tags){
    // Pointer down answers at once (the tap is the purchase); a keyboard click (detail 0) is the debug fallback (D-009).
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();tap(key);});
    button.addEventListener('click',e=>{if(e.detail===0)tap(key);});
  }
  close.addEventListener('click',()=>{dismissed=true;forge.hidden=true;});
  // The window holds its own taps (VGM-040): nothing leaks to the joystick or the map.
  for(const node of [forge,readout,notice])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)node.addEventListener(type,event=>event.stopPropagation());

  const label=(name:string,describe:string,cost:number,reason:string|undefined,recipe:RecipeId)=>
    `${name}: ${describe}. Custa ${forgePriceLabel(cost).speech}.${reason?` ${refusal(reason,recipe)}`:''}`;
  const render=()=>{
    const view=last;
    const camp=view?.camp;
    putHidden(readout,!camp);
    if(!view||!camp){putHidden(forge,true);putHidden(notice,true);return;}
    const wall=wallOf(view.structures),fraction=wall&&wall.maxHp>0?Math.max(0,Math.min(1,wall.hp/wall.maxHp)):0;
    paintBaseBar(baseBar(view),!!camp.wallDown);paintClock(view,windows);
    const money=granaReadout(camp.grana);
    if(money.text!==lastGrana){lastGrana=money.text;granaValue.textContent=money.text;grana.setAttribute('aria-label',money.label);}
    if(camp.units!==lastUnits){lastUnits=camp.units;token.innerHTML=tokenMarkup(camp.units);token.setAttribute('aria-label',tokenReadout(camp.units).label);}
    // Index 1 is the opening countdown before round 1: nothing to forge yet, the window stays shut.
    // D-051 nests: no intermission, the forge opens when the hero is calm (calm-phase.ts).
    const round=view.round,prepare=nestsRun(view)?effectivePhase(view,hero)==='prepare':round?.phase==='prepare'&&(round.index??0)>=2;
    // The wall crossing 50% and 25% in a wave: one notice each time (danger, 3 s).
    // (Only with a wall: with the chaveiro's car in its place, D-047, there is no wall to warn about.)
    if(lastFraction!==undefined&&round?.phase==='wave'&&!camp.wallDown&&wall)for(const mark of WALL_WARNINGS)if(lastFraction>=mark&&fraction<mark){
      warning={text:`Muralha em ${Math.round(mark*100)}%!`,until:performance.now()+WALL_WARNING_MS};
      clearTimeout(warnTimer);warnTimer=setTimeout(render,WALL_WARNING_MS+20);
    }
    lastFraction=fraction;
    // ---------- notice ----------
    const me=view.players.find(p=>p.id===ctxId),standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed;
    // Chaveiro mode (D-047): the car stands where the wall was (the sim's forge checks that spot), and there is no wall.
    home=inCamp(hero,wall??view.structures.find(s=>s.kind===CAR_ID));
    if(warning&&performance.now()<warning.until){
      putHidden(notice,false);putData(notice,'kind','wall');putText(noticeText,warning.text);putText(noticeTime,'');putHidden(arrow,true);putText(noticeJoke,'');
    }else if(prepare&&camp.hornEndsTick!==undefined&&standing){
      warning=undefined;
      const left=secondsLeft(camp.hornEndsTick,view.tick);
      putHidden(notice,false);putData(notice,'kind',home?'home':'horn');
      notice.classList.toggle('rh-horn-urgent',!home&&left<=5);
      putText(noticeText,home?'Bichos chegando':'Volta pra base');putText(noticeTime,`${left} s`);
      const bearing=hero?.bearing;
      putHidden(arrow,home||bearing===undefined);
      if(bearing!==undefined)arrow.style.setProperty('--rumo',`${Math.round(bearing)+180}deg`);
    }else{warning=undefined;putHidden(notice,true);}
    // ---------- forge ----------
    // A barricade within CAMP_RADIUS of the hero (city only): the window opens there too, even away from the wall.
    spot=barricadeAt(hero,view.structures,bocas,CAMP_RADIUS);
    const place=forgePlace(home,spot);
    if(!prepare||round?.index!==stint){stint=prepare?round!.index:-1;dismissed=false;}
    // Walking into a new place (the camp, another barricade) opens a window the player closed somewhere else.
    if(place.open&&place.key!==lastPlace)dismissed=false;
    lastPlace=place.open?place.key:'';
    const offerOpen=!!forge.parentElement?.querySelector('.rh-offer:not([hidden])');
    // Off the player's game for now (arrows.ts HUD_SWITCH.forge, user 18/10).
    const show=HUD_SWITCH.forge&&prepare&&place.open&&standing&&!camp.wallDown&&!offerOpen&&!dismissed&&!yielded;
    if(forge.hidden===show)forge.hidden=!show;
    if(!show){if(pending&&!prepare)clearPending();return;}
    if(money.text!==lastWallet){lastWallet=money.text;wallet.textContent=money.text;wallet.setAttribute('aria-label',money.label);}
    if(title.textContent!==place.title){title.textContent=place.title;forge.setAttribute('aria-label',place.title);close.setAttribute('aria-label',home?'Fechar a forja':'Fechar a barricada');}
    const line=fallLine(view,ctxId),quiet=note.textContent===DEFAULT_NOTE;
    if(fall.textContent!==line)writeFallLine(fall,line);
    fall.hidden=!line||!quiet;note.hidden=!!line&&quiet;
    for(const id of RECIPE_IDS){
      const {button,lock,full}=tags.get(id)!,reason=blockedReason(id,view,ctxId,place.away);
      button.classList.toggle('rh-forge-blocked',!!reason);
      lock.hidden=reason!=='balance';full.hidden=reason!=='full';
      const now=forgePrice(id,view.camp?.forge),cost=button.querySelector<HTMLElement>('.rh-forge-cost');
      if(cost&&cost.dataset.price!==String(now)){cost.dataset.price=String(now);cost.innerHTML=forgePriceLabel(now).html;}
      button.setAttribute('aria-label',label(RECIPES[id].name,RECIPES[id].describe,now,reason,id));
    }
    // ---------- barricade tag ----------
    if(fence.button.hidden===!!spot)fence.button.hidden=!spot;
    if(spot){
      const text=barricadeText(spot),reason=barricadeBlocked(spot,camp);
      if(fence.name.textContent!==text.name){fence.name.textContent=text.name;fence.short.textContent=text.short;}
      fence.button.dataset.target=spot.target;
      fence.button.classList.toggle('rh-forge-blocked',!!reason);
      fence.lock.hidden=reason!=='balance';fence.full.hidden=reason!=='full';
      fence.button.setAttribute('aria-label',label(text.full,text.describe,RECIPES.reparo.cost,reason,'reparo'));
      // Away from the wall it is why the window opened: first. In the camp it follows the forge's own tags.
      if(place.barricadeFirst&&list.firstElementChild!==fence.button)list.prepend(fence.button);
      else if(!place.barricadeFirst&&list.lastElementChild!==fence.button)list.append(fence.button);
    }
  };

  return {
    el:forge,readout,notice,forge,
    update(view:RunView,ctx:HudContext){last=view;ctxId=ctx.localId;windows={minervaAteTick:ctx.minervaAteTick,explora:ctx.explora};render();},
    setHero(at){hero=at;if(last)render();},
    setBocas(next){bocas=next;},
    yieldTo(obra){if(yielded===obra)return;yielded=obra;if(last)render();},
    forged(answer){
      if(!pending||answer.req!==pending.req)return;
      const {key,recipe,done}=pending;clearPending();
      if(answer.ok){
        const button=tags.get(key)!.button;
        button.classList.add('rh-forge-done');clearTimeout(stampTimer);
        stampTimer=setTimeout(()=>button.classList.remove('rh-forge-done'),FORGE_STAMP_MS);
        say(done);
        // The forge's hammering: a tower, a gambiarra or a repair stands (audio/sfx.ts torre-construir).
        const audio=getAudio();if(audio.unlocked)audio.play('torre-construir');
      }else{
        say(refusal(answer.reason??'',recipe));
        const audio=getAudio();if(audio.unlocked)audio.play('ui-erro');
      }
    },
    destroy(){overflow.destroy();clearTimeout(stampTimer);clearTimeout(noteTimer);clearTimeout(warnTimer);if(pending)clearTimeout(pending.timer);readout.remove();notice.remove();forge.remove();},
  };
}
