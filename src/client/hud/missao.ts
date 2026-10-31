/**
 * The mission line (card NEW-20261023-ORQ-inicio-no-uno-caixas-120, the user 23/10: "começa o jogo, a pessoa não sabe
 * o que fazer"): one short sentence at a time, in a big band for MISSION_BIG_MS when it changes, then small and fixed
 * while it holds; both are rows of the announcement slot right under the clock (never over it, whatever the slot's top).
 *  - The minuto de Minerva: "Junte caixas e volte ao Uno.";
 *  - each time to explore after a wave: "Junte mais caixas, em dupla." (the Fear runs then too, the user 24/10: explore
 *    in pairs or come back to the Uno, card fear-escuridao-sozinho);
 *  Each line fits one row on a 393 px phone at the band's size (card topo-sem-icone-contagem-exploracao item 6): the top's
 *  clock counts the seconds (120, 119…), so the lines no longer say the time;
 *  - the last RETURN_SECONDS of either: "Volte ao Uno." (urgent; the Uno's edge arrow too, hud/rescue.ts);
 *  - after the Minerva, once a run, only while the player has not done it: "Ponha as torres perto do Uno." while a kit
 *    de torre is in the inventory (at most TOWERS_MAX_S), then "Eles vão atrás do Uno. Defenda." (big, DEFEND_MS, then gone).
 * Card objetivo-com-verbo (auditoria-jogabilidade item 8, "Chaveiro chega em 9:55. 5 de 5 ninhos de pé" said nothing
 * to do): one sentence with a verb at a time, from the run's view (missionFacts), each with its edge arrow (arrow):
 *  - the dark pressing on the hero (fear >= DARK_PRESS): "Volte ao Uno!" (urgent, over everything, the Uno's arrow);
 *  - the crates the team opened this window in the Minerva's and the explore's lines: "Junte caixas (2)";
 *  - the moto stopped for the team (morta, tombo): "Moto morta: vá empurrar" / "A moto tombou: tire os bichos" (urgent,
 *    the moto's arrow; hud/chaveiro.ts MotoReason leaves these two to the line);
 *  - the objective (card missao-proteger-uno-tempo, the user 29/10: the nests are NOT needed to win; protect the Uno
 *    while the clock runs): "Proteja o Uno até o chaveiro" (the Uno's arrow), and with nests standing it takes turns
 *    every ROTATE_S with "Opcional: derrube ninhos (5)" (the nearest nest's arrow). Both calm: never the big band, so no
 *    line sounds like an obligation to knock the nests down. Without the objective the nests' line is alone.
 * Card ordens-menos-e-claras (auditoria-primeiro-minuto item 5: seven orders in ~3 min, "A moto tombou" 1.4 s after
 * "Derrube os ninhos"): a new order at most every ORDER_GAP_S, the most important one wanted when the gap opens wins;
 * meanwhile the line keeps the order it shows while that still holds, else it is empty. Only the dark's "Volte ao Uno!"
 * goes over the gap (it does not count as an order). "Volte ao Uno." is not shown with the hero at the Uno (UNO_NEAR_U).
 * Card celular-objetivo-e-grana (auditoria-primeira-partida-30-10 item 1: the Minerva is 30 s, sim ninhos.ts MINERVA_S,
 * so its line held 10 s and the rest was a quiet "Volte ao Uno." at the Uno: a novato saw no objective): the line is not
 * left empty while a calm line is wanted. With the objective, the quiet "Volte ao Uno." of a window gives way to
 * "Proteja o Uno até o chaveiro"; a calm line fills an empty line at once (small, the gap untouched); and a calm order
 * that no longer holds (the objective seen a frame before the Minerva's tick) does not hold back the next order, nor
 * the Minerva's line its own "Volte ao Uno." (the gap was longer than the whole Minerva: the hero away never heard it).
 * Time comes from the sim tick (the clock's), so a phone and a PC agree. The tracker is pure (tests); createMission
 * paints the two elements.
 */
import {SIM_HZ,type MotoMode,type RunView} from '../../contract/index.ts';
import {MOTO_ACTIONS} from './chaveiro.ts';

export const MISSION_BIG_MS=4000;
/** "Volte ao Uno." shows (and the Uno gets its arrow) in the last seconds of a window. */
export const RETURN_SECONDS=20;
/** "Ponha as torres perto do Uno." holds at most this long. */
export const TOWERS_MAX_S=30;
/** "Eles vão atrás do Uno. Defenda." shows this long (big all the time). */
export const DEFEND_MS=4000;
/** The dark presses (rules/fear.ts: 0 alone in light, 1 consumed): from half of it the line says come back to the Uno. */
export const DARK_PRESS=.5;
/** A new order at most this often (s): the first minutes said seven things in three minutes (ordens-menos-e-claras). */
export const ORDER_GAP_S=30;
/** "Volte ao Uno." is not shown with the hero this close to the Uno (u); it comes back past UNO_LEAVE_U (no blink). */
export const UNO_NEAR_U=4;
export const UNO_LEAVE_U=5;
/** The objective's line and the optional nests' take turns this long each: the order gap, so each turn is a new order. */
export const ROTATE_S=ORDER_GAP_S;
/** "Eles vão atrás do Uno. Defenda." is about the wave's start: kept back by the gap longer than this (s), it is dropped. */
export const DEFEND_LATE_S=15;

export const MISSION_TEXT=Object.freeze({
  minerva:'Junte caixas e volte ao Uno.',
  explora:'Junte mais caixas, em dupla.',
  volta:'Volte ao Uno.',
  torres:'Ponha as torres perto do Uno.',
  defenda:'Eles vão atrás do Uno. Defenda.',
  escuro:'Volte ao Uno!',
  proteja:'Proteja o Uno até o chaveiro',
});
/** The lines that carry a count: the crates the team opened this window, the nests standing (optional). */
export const missionCount={
  minerva:(n:number)=>n>0?`Junte caixas (${n})`:MISSION_TEXT.minerva,
  explora:(n:number)=>n>0?`Junte caixas em dupla (${n})`:MISSION_TEXT.explora,
  ninhos:(n:number)=>`Opcional: derrube ninhos (${n})`,
};

export type MissionKey='minerva'|'explora'|'volta'|'torres'|'defenda'|'escuro'|'moto'|'proteja'|'ninhos';
/** The calm lines: always the small row (never the big band), so they never read as an order. */
const CALM:ReadonlySet<MissionKey>=new Set(['proteja','ninhos']);
/** What the line's edge arrow points at (rescue.ts; the arrow shows only while the target is off screen). */
export type MissionArrow={kind:'uno';urgent:boolean}|{kind:'moto'}|{kind:'ninho';id:string;x:number;y:number};
/** The run's view as the line reads it (missionFacts); every field optional, absent = not in this run. */
export interface MissionFacts {
  /** The team's crates opened in the run so far (PlayerStatsView.chests). */
  crates?:number;
  /** The nests mode: how many stand, and the standing one nearest the hero. */
  nests?:{alive:number;nearest?:{id:string;x:number;y:number}};
  /** The chaveiro's moto while the objective runs. */
  moto?:MotoMode;
  /** The local hero's dark (PlayerView.fear, 0..1). */
  dark?:number;
  /** The hero's distance to the Uno (the objective's car, u) while the objective runs. */
  uno?:number;
}
export interface MissionInput {
  tick:number;
  /** RunState.minervaAteTick (the Minerva's end tick) while it lasts. */
  minervaAte?:number;
  /** The time to explore while it lasts. */
  explora?:{from:number;until:number};
  /** A kit de torre in the local player's inventory. */
  towerKit:boolean;
  /** The local player is in the run (not spectating, not out). */
  playing:boolean;
  /** Card objetivo-com-verbo: what the view says (missionFacts); absent = the lines above only. */
  facts?:MissionFacts;
}
export interface MissionLine {
  key:MissionKey;text:string;
  /** The big band in the middle (the first MISSION_BIG_MS of a line); else the small row at the top. */
  big:boolean;
  urgent:boolean;
}
export interface MissionOutput {
  line?:MissionLine;
  /** The Uno gets its edge arrow when off screen: the whole Minerva and the last RETURN_SECONDS of a time to explore. */
  pointUno:boolean;
  /** The line's target: the Uno (as pointUno says), the moto, the nearest nest. */
  arrow?:MissionArrow;
}

/** The facts of a view for the local hero (pure): crates, nests, the moto, the dark; `hero`: where it stands (world u). */
export function missionFacts(view:Pick<RunView,'players'|'structures'|'objective'>,localId:string,hero?:{x:number;y:number}):MissionFacts{
  const me=view.players.find(p=>p.id===localId),out:MissionFacts={};
  let crates=0,stats=false;
  for(const p of view.players)if(p.stats?.chests!==undefined){crates+=p.stats.chests;stats=true;}
  if(stats)out.crates=crates;
  const nests=view.structures.filter(s=>s.kind==='ninho');
  if(nests.length){
    const up=nests.filter(s=>s.hp>0&&s.phase!=='destruido');
    const d=(s:{x:number;y:number})=>hero?Math.hypot(s.x-hero.x,s.y-hero.y):0;
    const near=up.reduce<typeof up[number]|undefined>((a,b)=>!a||d(b)<d(a)?b:a,undefined);
    out.nests={alive:up.length,...(near?{nearest:{id:near.id,x:near.x,y:near.y}}:{})};
  }
  const o=view.objective;
  if(o&&!o.ended){out.moto=o.moto.mode;if(hero)out.uno=Math.hypot(o.car.x-hero.x,o.car.y-hero.y);}
  if(me?.fear!==undefined)out.dark=me.fear;
  return out;
}

const ms=(n:number)=>Math.round(n/1000*SIM_HZ);

/** A line the run wants now (wants() lists them most important first); `quiet`: wanted, but not written (the hero is there). */
interface Want {key:MissionKey;pointUno:boolean;windowEnd?:number;text?:string;arrow?:MissionArrow;quiet?:boolean}
/** What makes an order new: its key, the moto's two verbs apart, and the window it belongs to. */
const orderId=(w:Want)=>`${w.key}|${w.key==='moto'?w.text:''}|${w.windowEnd??''}`;

export class MissionTracker {
  private lastTick=-1;private sawMinerva=false;private nearUno=false;
  /** The order on the line now (or last, if it went quiet) and the tick it began: the gap counts from there. */
  private order:{id:string;at:number;calm:boolean;window?:number}|undefined;
  /** The dark's line began here (it goes over the orders, big for MISSION_BIG_MS). */
  private darkSince:number|undefined;
  /** The team's crates when the current window opened (its count starts at 0). */
  private cratesFrom:number|undefined;private cratesWindow:number|undefined;
  /** After the Minerva: 'torres' → 'defenda' → 'feito' (once a run); `defendAt`: when "Defenda." got on the line. */
  private after:'antes'|'torres'|'defenda'|'feito'='antes';private afterSince=0;private defendAt:number|undefined;
  reset(){this.lastTick=-1;this.sawMinerva=false;this.nearUno=false;this.order=this.darkSince=this.defendAt=undefined;this.after='antes';this.cratesFrom=this.cratesWindow=undefined;}
  /** Ticks since the line's order began (Infinity before the first): the fear's notice waits for the gap too (hud.ts). */
  orderAge(tick:number){return this.order?tick-this.order.at:Infinity;}
  /** An order began less than ORDER_GAP_S ago: another notice (the fear's) would be a second order inside the gap. */
  orderRecent(tick:number){return this.orderAge(tick)<ms(ORDER_GAP_S*1000);}
  /** The crates opened since the window that ends at `end` opened. */
  private crates(end:number,now:number|undefined){
    if(now===undefined)return 0;
    if(this.cratesWindow!==end){this.cratesWindow=end;this.cratesFrom=now;}
    return Math.max(0,now-(this.cratesFrom??now));
  }
  step(input:MissionInput):MissionOutput{
    const {tick}=input;
    // A new run (rematch) starts the tick again.
    if(tick<this.lastTick)this.reset();
    this.lastTick=tick;
    if(!input.playing){this.darkSince=undefined;return {pointUno:false};}
    const facts=input.facts??{};
    const minerva=input.minervaAte!==undefined&&tick<input.minervaAte?input.minervaAte:undefined;
    const explora=input.explora&&tick>=input.explora.from&&tick<input.explora.until?input.explora:undefined;
    if(minerva!==undefined)this.sawMinerva=true;
    this.nearUno=facts.uno!==undefined&&facts.uno<=(this.nearUno?UNO_LEAVE_U:UNO_NEAR_U);
    // The dark pressing: come back to the Uno, over every other line and over the gap.
    if((facts.dark??0)>=DARK_PRESS){
      this.darkSince??=tick;
      const line:MissionLine={key:'escuro',text:MISSION_TEXT.escuro,big:tick-this.darkSince<ms(MISSION_BIG_MS),urgent:true};
      return {pointUno:true,arrow:{kind:'uno',urgent:true},line};
    }
    this.darkSince=undefined;
    return this.pick(this.wants(input,facts,minerva,explora),tick);
  }
  /** Every line the run wants now, most important first. */
  private wants(input:MissionInput,facts:MissionFacts,minerva:number|undefined,explora:{from:number;until:number}|undefined):Want[]{
    const {tick}=input,objective=facts.moto!==undefined;
    const proteja:Want={key:'proteja',pointUno:false,arrow:{kind:'uno',urgent:false}};
    // At the Uno, "Volte ao Uno." is quiet: the objective says what the Uno is for instead (calm).
    const back=(end:number):Want[]=>[{key:'volta',pointUno:true,windowEnd:end,arrow:{kind:'uno',urgent:true},quiet:this.nearUno},...(this.nearUno&&objective?[proteja]:[])];
    if(minerva!==undefined)return (minerva-tick)/SIM_HZ<=RETURN_SECONDS?back(minerva)
      :[{key:'minerva',pointUno:true,windowEnd:minerva,text:missionCount.minerva(this.crates(minerva,facts.crates)),arrow:{kind:'uno',urgent:false}}];
    if(explora)return (explora.until-tick)/SIM_HZ<=RETURN_SECONDS?back(explora.until)
      :[{key:'explora',pointUno:false,windowEnd:explora.until,text:missionCount.explora(this.crates(explora.until,facts.crates))}];
    const out:Want[]=[];
    // The moto stopped for the team: go there.
    const action=facts.moto?MOTO_ACTIONS[facts.moto]:undefined;
    if(action)out.push({key:'moto',pointUno:false,text:action,arrow:{kind:'moto'}});
    // After the Minerva, once: the towers (only with a kit in hand), then "Eles vão atrás do Uno. Defenda.".
    if(this.sawMinerva&&this.after==='antes'){this.after=input.towerKit?'torres':'defenda';this.afterSince=tick;}
    if(this.after==='torres'&&(!input.towerKit||tick-this.afterSince>=ms(TOWERS_MAX_S*1000))){this.after='defenda';this.afterSince=tick;}
    if(this.after==='defenda'&&(this.defendAt!==undefined?tick-this.defendAt>=ms(DEFEND_MS):tick-this.afterSince>=ms(DEFEND_LATE_S*1000)))this.after='feito';
    if(this.after==='torres'||this.after==='defenda')out.push({key:this.after,pointUno:false});
    // The objective: protect the Uno; the nests standing are optional, in turns with it (alone without the objective).
    const nests=facts.nests;
    const ninhos:Want|undefined=nests&&nests.alive>0?{key:'ninhos',pointUno:false,text:missionCount.ninhos(nests.alive),...(nests.nearest?{arrow:{kind:'ninho' as const,...nests.nearest}}:{})}:undefined;
    const nestTurn=Math.floor(tick/ms(ROTATE_S*1000))%2===1;
    if(objective)out.push(...(ninhos&&nestTurn?[ninhos,proteja]:ninhos?[proteja,ninhos]:[proteja]));
    else if(ninhos)out.push(ninhos);
    return out;
  }
  /**
   * The gap: the most important line said (not quiet) starts a new order once ORDER_GAP_S went by, or at once over a calm
   * order that no longer holds, or as "Volte ao Uno." after its own window's line (the 30 s Minerva is shorter than the
   * gap); until then the line keeps its order, else the first calm line wanted (small, no order).
   */
  private pick(wants:readonly Want[],tick:number):MissionOutput{
    const top=wants[0],lead=wants.find(w=>!w.quiet);
    if(!top)return {pointUno:false};
    const held=(id:string|undefined)=>wants.find(w=>!w.quiet&&orderId(w)===id);
    if(lead){
      const id=orderId(lead),now=this.order;
      const free=this.orderAge(tick)>=ms(ORDER_GAP_S*1000)||!!now?.calm&&!held(now.id)||lead.key==='volta'&&now?.window===lead.windowEnd;
      if(id!==now?.id&&free)this.order={id,at:tick,calm:CALM.has(lead.key),...(lead.windowEnd!==undefined?{window:lead.windowEnd}:{})};
    }
    const order=this.order,shown=order&&held(order.id)||wants.find(w=>!w.quiet&&CALM.has(w.key));
    // Nothing on the line: the Uno's arrow still says where to go (the Minerva, the last seconds of a window).
    if(!shown)return {pointUno:top.pointUno,...(top.arrow?.kind==='uno'?{arrow:top.arrow}:{})};
    if(shown.key==='defenda')this.defendAt??=tick;
    const big=shown.key==='defenda'||!CALM.has(shown.key)&&!!order&&tick-order.at<ms(MISSION_BIG_MS);
    return {pointUno:top.pointUno,...(shown.arrow?{arrow:shown.arrow}:{}),
      line:{key:shown.key,text:shown.text??MISSION_TEXT[shown.key as keyof typeof MISSION_TEXT],big,urgent:shown.key==='volta'||shown.key==='moto'}};
  }
}

export interface MissionPart {
  /** The small row (in the announcement slot). */
  readonly row:HTMLElement;
  /** The big band (the same slot, right under the clock). */
  readonly band:HTMLElement;
  render(line:MissionLine|undefined):void;
}
export function createMission(doc:Document=document):MissionPart{
  const row=doc.createElement('div');row.className='rh-missao';row.hidden=true;row.setAttribute('role','status');row.lang='pt-BR';
  const band=doc.createElement('div');band.className='rh-missao-grande';band.hidden=true;band.setAttribute('aria-hidden','true');band.lang='pt-BR';
  let drawn='';
  return {row,band,render(line){
    const key=line?`${line.big?1:0}|${line.urgent?1:0}|${line.text}`:'';
    if(key===drawn)return;
    drawn=key;
    row.hidden=!line||line.big;band.hidden=!line||!line.big;
    if(!line)return;
    const target=line.big?band:row;
    target.textContent=line.text;
    row.classList.toggle('rh-missao-urgente',line.urgent);band.classList.toggle('rh-missao-urgente',line.urgent);
    // The screen reader hears the line once, from the row (the band is the same words, big).
    if(line.big)row.textContent=line.text;
  }};
}
