/**
 * D-047 (card NEW-20261014-ORQ-chaveiro-hud): the chaveiro objective in the HUD, pure (no DOM), so node pins it down.
 * - the round chip: "Onda N" and the chaveiro's clock (ObjectiveView.etaS, "9:48") in place of "Round N/10";
 * - why he stopped (ObjectiveView.moto.mode): one short line for REASON_MS when he stops ("Moto morta: empurra!");
 * - the car's bar in the base ficha: the hits it still takes (car.limit − car.hits) over car.limit;
 * - Dona Cida: whether the hero is near the moto, her three sweets with price and stock against my wallet, and
 *   the room's refusals ({t:'bought'} reasons) as one line;
 * - the result: why it ended (RunState.objective.cause), the bill and "vitória com dívida", and the vaquinha (who put
 *   how much into the bill, carteira-e-pix: ObjectiveResult.share).
 * Every number comes from the room's view (protocol 15); nothing here decides the game.
 */
import {CIDA_ITEMS,SIM_HZ,type CidaItem,type CidaItemId,type MotoMode,type ObjectiveCause,type ObjectiveResult,type ObjectiveView,type VaquinhaShare} from '../../contract/index.ts';

/** Dona Cida sells within this many units of the moto (mirrors the sim's CIDA_REACH; tests/client/chaveiro-hud pins it). */
export const CIDA_REACH_U=3;
/** The button stays until the hero is this far (u): the predicted spot wobbles around the edge, the button must not blink. */
export const CIDA_LEAVE_U=3.4;
/** A stop's reason shows this long once he stops (card: 2–3 s). */
export const REASON_MS=2500;
/** The car's bar turns Cone under this share of hits left (render/chaveiro/rules.ts CAR_LOW, the base's 30%). */
export const CAR_BAR_LOW=.3;

/** The chaveiro's clock: whole seconds as "m:ss" ("10:00", "0:07"); never negative. */
export function etaClock(seconds:number){
  const s=Math.max(0,Math.ceil(Number.isFinite(seconds)?seconds:0));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
/** "R$ 120" (whole reais, never negative): the panel and the result write money this one way. */
export const reais=(value:number)=>`R$ ${Math.max(0,Math.round(Number.isFinite(value)?value:0))}`;

/** The objective while it runs (absent, or ended: the round chip goes back to its plain form). */
export const liveObjective=(view:{objective?:ObjectiveView}|undefined)=>view?.objective&&!view.objective.ended?view.objective:undefined;

/**
 * The round chip's chaveiro part: the clock and the words for the screen reader. `held`: the 1st wave's chefão stands
 * and the clock is stopped until he falls (card boss-fim-onda-1, ORQ 24/10; sim/ninhos/chefao.ts holdChaveiroClock):
 * the number goes grey behind a padlock.
 */
export interface ChaveiroClock {clock:string;seconds:number;aria:string;held:boolean}
export function chaveiroClock(objective:Pick<ObjectiveView,'etaS'|'moto'>,held=false):ChaveiroClock{
  const seconds=Math.max(0,Math.ceil(objective.etaS)),clock=etaClock(seconds);
  const aria=held?`Relógio do chaveiro parado até o chefão cair: ${clock}`:objective.moto.mode==='abrindo'?`Chaveiro abrindo o carro: ${clock}`:`Chaveiro chega em ${clock}`;
  return {clock,seconds,aria,held};
}

/**
 * Why he is stopped, in the card's words (one line, no wrap at 390 px). 'anda' has none (he rides); 'abrindo' tells he
 * arrived. The text always starts with a capital: it is a row of the announcement slot.
 */
export const MOTO_REASONS:Readonly<Record<MotoMode,string|undefined>>=Object.freeze({
  anda:undefined,
  volta:'Dando a volta no quarteirão',
  morta:'Moto morta: empurra!',
  entrega:'Entregando',
  lombada:'Lombada',
  tombo:'Tombou! Bicho na moto',
  abrindo:'Chegou! Abrindo o carro',
});
/** The modes where the team can do something: the row wears Cone (morta: 2 to push; tombo: clear the critter). */
export const reasonUrgent=(mode:MotoMode)=>mode==='morta'||mode==='tombo';
/**
 * Card objetivo-com-verbo: the stops that need the team say what to do, with a verb, in the mission line (hud/missao.ts,
 * with the moto's edge arrow) instead of the reason's row; one row on a 393 px phone at the band's size. Card
 * ordens-menos-e-claras (auditoria-primeiro-minuto item 5: "Uno" and "moto" read as one vehicle, only the Uno on
 * screen): the line names the chaveiro, as the top's clock and the moto's arrow ("Chaveiro parado") do; the Uno is the
 * team's car, the moto is his.
 */
export const MOTO_ACTIONS:Readonly<Partial<Record<MotoMode,string>>>=Object.freeze({
  morta:'Moto do chaveiro: vá empurrar',
  tombo:'Chaveiro caiu: tire os bichos',
});

/**
 * When the reason's row comes and goes (the row itself waits its turn in the announcement slot, RunHud.queueRow, and
 * leaves after REASON_MS on screen): `show` on the view where he stops (a new stop replaces the row at once), `drop`
 * when he rides again, the objective ends or goes away (a line still waiting in the queue would be stale).
 */
export class MotoReason {
  private mode?:MotoMode;
  step(mode:MotoMode|undefined):{show?:{text:string;urgent:boolean;mode:MotoMode};drop:boolean}{
    if(mode===this.mode)return {drop:false};
    const was=this.mode;this.mode=mode;
    // The team's stops are the mission line's (MOTO_ACTIONS): no second row with the same news.
    const text=mode&&!MOTO_ACTIONS[mode]?MOTO_REASONS[mode]:undefined;
    if(text&&mode)return {show:{text,urgent:reasonUrgent(mode),mode},drop:false};
    return {drop:!!was&&!!MOTO_REASONS[was]&&!MOTO_ACTIONS[was]};
  }
  reset(){this.mode=undefined;}
}

/**
 * Card chaveiro-chegou-e-relogio (auditoria fim-de-partida, item 3): the clock "lies" when the moto stops (it falls
 * 10–40 s per real minute and nobody knows why). While he is stopped, the clock wears the stop's colour and says how
 * much the stop has added so far ("Moto tombou: +4 s"). Only the HUD: the ETA is the room's, untouched.
 */
export const CLOCK_STOPS:Readonly<Partial<Record<MotoMode,string>>>=Object.freeze({
  tombo:'Moto tombou',morta:'Moto morta',lombada:'Lombada',volta:'Deu a volta',entrega:'Entregando',
});
/** The added time shows once it reaches this (s): the ETA comes in whole seconds, one is rounding noise. */
export const CLOCK_ADDED_MIN_S=2;
/** After he rides again, the last "+N s" stays this long (s) so it can be read. */
export const CLOCK_ADDED_HOLD_S=3;
export interface ClockStop {mode:MotoMode;label:string;text:string;added:number;urgent:boolean}
/**
 * The time a stop adds: from the tick he stopped, the clock should have fallen one second per second; what it did not
 * fall (or rose) is the stop's. Fed every view with the moto's mode, the ETA and the tick; undefined: nothing to say.
 */
export class ClockStopTracker {
  private start?:{mode:MotoMode;etaS:number;tick:number};
  private shown?:ClockStop;private until=-1;
  step(mode:MotoMode|undefined,etaS:number,tick:number):ClockStop|undefined{
    const label=mode&&CLOCK_STOPS[mode];
    if(!label||!mode){
      this.start=undefined;
      if(mode===undefined||mode==='abrindo'){this.shown=undefined;return undefined;}
      return this.shown&&tick<=this.until?this.shown:(this.shown=undefined);
    }
    if(this.start?.mode!==mode||tick<this.start.tick)this.start={mode,etaS,tick};
    const added=Math.floor(etaS-(this.start.etaS-(tick-this.start.tick)/SIM_HZ));
    if(added>=CLOCK_ADDED_MIN_S){
      this.shown={mode,label,text:`${label}: +${added} s`,added,urgent:reasonUrgent(mode)};
      this.until=tick+CLOCK_ADDED_HOLD_S*SIM_HZ;
    }
    return this.shown&&(this.shown.mode===mode||tick<=this.until)?this.shown:undefined;
  }
  reset(){this.start=this.shown=undefined;this.until=-1;}
}

/** Card missao-proteger-uno-tempo: the clock's say when an enemy's hit on the Uno pushed the unlocking back. */
export const CLOCK_HIT_LABEL='Batida no Uno';
/**
 * Each hit on the Uno adds time to the run's clock (the sim's CHAVEIRO_CLOCK): the clock says how much ("Batida no
 * Uno: +3 s"). A burst of hits within CLOCK_ADDED_HOLD_S adds into one number, from the clock before its first hit.
 * Fed every view with the mode, the ETA, the tick and the car's hits; a stop mode is ClockStopTracker's, not this.
 */
export class ClockHitTracker {
  private last?:{etaS:number;tick:number;hits:number};
  private base?:{etaS:number;tick:number};
  private shown?:ClockStop;private until=-1;
  step(mode:MotoMode|undefined,etaS:number,tick:number,hits:number):ClockStop|undefined{
    const last=this.last;this.last={etaS,tick,hits};
    if(!last||tick<last.tick||!mode||CLOCK_STOPS[mode]){this.base=this.shown=undefined;return undefined;}
    if(hits>last.hits){
      if(!this.base||tick>this.until)this.base={etaS:last.etaS,tick:last.tick};
      const added=Math.round(etaS-(this.base.etaS-(tick-this.base.tick)/SIM_HZ));
      if(added>=1){
        this.shown={mode,label:CLOCK_HIT_LABEL,text:`${CLOCK_HIT_LABEL}: +${added} s`,added,urgent:true};
        this.until=tick+CLOCK_ADDED_HOLD_S*SIM_HZ;
      }
    }
    return this.shown&&tick<=this.until?this.shown:(this.shown=this.base=undefined);
  }
  reset(){this.last=this.base=this.shown=undefined;this.until=-1;}
}
/**
 * What the clock says next to it, from both trackers: a stop's "+N s" first, else a hit's on the Uno. Fed every view
 * with the live objective (undefined: none, ended, or held by the chefão: nothing, and both start over).
 * The round chip (topbar.ts) and the phone's bar clock (camp.ts) each keep one.
 */
export class ClockTag {
  private stops=new ClockStopTracker();private hits=new ClockHitTracker();
  step(objective:Pick<ObjectiveView,'moto'|'etaS'|'car'>|undefined,tick:number):ClockStop|undefined{
    if(!objective){this.stops.reset();this.hits.reset();return undefined;}
    const stopped=this.stops.step(objective.moto.mode,objective.etaS,tick),hit=this.hits.step(objective.moto.mode,objective.etaS,tick,objective.car.hits);
    return stopped||hit||undefined;
  }
}

/**
 * Card chaveiro-chegou-e-relogio (item 4): "chegou" is a moment. While he opens the car ('abrindo', ABRINDO_SECONDS in
 * the sim) a big band says so with the seconds left and a bar filling up; victory comes when it is full.
 */
export const ARRIVAL_SECONDS=15;
export interface ArrivalBand {title:string;hold:string;seconds:number;fraction:number;aria:string}
export function arrivalBand(objective:Pick<ObjectiveView,'etaS'|'moto'>|undefined):ArrivalBand|undefined{
  if(objective?.moto.mode!=='abrindo')return undefined;
  const seconds=Math.max(0,Math.min(ARRIVAL_SECONDS,Math.ceil(Number.isFinite(objective.etaS)?objective.etaS:0)));
  const fraction=Math.max(0,Math.min(1,1-objective.etaS/ARRIVAL_SECONDS));
  return {title:'O chaveiro chegou!',hold:`Segurem ${seconds} s`,seconds,fraction:Number.isFinite(fraction)?fraction:0,
    aria:`O chaveiro chegou! Segurem o carro mais ${seconds} segundos`};
}

/** The car's bar of the base ficha (in place of the wall's life): hits it still takes over the limit. */
export interface CarBar {fraction:number;left:number;limit:number;low:boolean;label:string}
export function carBar(objective:Pick<ObjectiveView,'car'>|undefined):CarBar|undefined{
  const car=objective?.car;
  if(!car||!(car.limit>0))return undefined;
  const left=Math.max(0,Math.min(car.limit,Math.round(car.limit-car.hits))),fraction=left/car.limit;
  return {fraction,left,limit:car.limit,low:fraction<CAR_BAR_LOW,label:`O carro aguenta mais ${left} ${left===1?'pancada':'pancadas'} de ${car.limit}`};
}

/** Whether the hero is by the moto now: within CIDA_REACH_U to show, beyond CIDA_LEAVE_U to hide (hysteresis). */
export function nearMoto(hero:{x:number;y:number}|undefined,moto:{x:number;y:number}|undefined,shown:boolean){
  if(!hero||!moto)return false;
  const d=Math.hypot(hero.x-moto.x,hero.y-moto.y);
  return d<=(shown?CIDA_LEAVE_U:CIDA_REACH_U);
}

/**
 * Whether the button shows (pure, tested): the objective runs, the local hero stands (not caído, out or watching), is
 * by the moto, and no offer window holds the screen.
 */
export function cidaButtonShown(input:{live:boolean;standing:boolean;near:boolean;offerOpen:boolean;ended:boolean}){
  return input.live&&input.standing&&input.near&&!input.offerOpen&&!input.ended;
}
/** Short effect line of each sweet (the price tag's second line). */
export const CIDA_EFFECT:Readonly<Record<CidaItemId,string>>=Object.freeze({
  brigadeiro:'+25% de velocidade',pacoca:'+30% de dano',cocada:'Leva 30% menos dano',
});
/** One sweet as the panel shows it; `blocked`: why a tap cannot buy it now (stock first, then my wallet). */
export interface CidaOffer {id:CidaItemId;name:string;effect:string;seconds:number;price:number;stock:number;priceText:string;stockText:string;
  blocked?:'stock'|'grana';short:number;label:string}
export function cidaOffers(objective:Pick<ObjectiveView,'grana'|'stock'>):CidaOffer[]{
  const grana=Number.isFinite(objective.grana)?objective.grana:0;
  return CIDA_ITEMS.map((item:CidaItem,i)=>{
    const stock=Math.max(0,objective.stock[i]??0),short=Math.max(0,item.price-grana);
    const blocked=stock<=0?'stock' as const:short>0?'grana' as const:undefined;
    const stockText=stock<=0?'acabou':stock===1?'último':`sobram ${stock}`;
    const why=blocked==='stock'?' Acabou.':blocked==='grana'?` Falta ${reais(short)}.`:'';
    return {id:item.id,name:item.name,effect:CIDA_EFFECT[item.id],seconds:item.seconds,price:item.price,stock,priceText:reais(item.price),stockText,
      ...(blocked?{blocked}:{}),short,label:`${item.name}: ${CIDA_EFFECT[item.id]} por ${item.seconds} s. ${reais(item.price)}, ${stockText}.${why}`};
  });
}
/** Anything she could sell the team now (else the button is dim: no Grana for any sweet left, or the tray is empty). */
export const cidaSells=(offers:readonly CidaOffer[])=>offers.some(o=>!o.blocked);

/** The panel's one line for a refusal (the room's 'bought' reason, or a blocked tag tapped). */
export function cidaRefusal(reason:string|undefined,offer?:Pick<CidaOffer,'short'>){
  switch(reason){
    case 'grana':return offer&&offer.short>0?`Falta ${reais(offer.short)}.`:'Falta grana.';
    case 'stock':return 'Acabou esse doce.';
    case 'away':return 'Chega mais perto da moto.';
    case 'phase':return 'Agora não dá.';
    default:return 'Ela não entendeu. Tenta de novo.';
  }
}
/** The panel's line once the room says yes: the sweet's first word ("Brigadeiro na mão!"), two lines at most in the header. */
export const cidaBought=(name:string)=>`${name.trim().split(/\s+/)[0]} na mão!`;

/** Why the run ended, as the result screen says it (card: aberto / perda total / time caído / timeout). */
export const OBJECTIVE_CAUSE_TEXT:Readonly<Record<ObjectiveCause,string>>=Object.freeze({
  opened:'Abriu! O carregador era do conector errado.',
  car:'O Uno não aguentou. Perda total.',
  team:'O time caiu antes do chaveiro chegar.',
  timeout:'Acabou o tempo. O chaveiro não chegou.',
});
/** A win the team's Grana did not pay in full: he opened it anyway and took the steering wheel as a guarantee. */
export const DEBT_VICTORY_TEXT='Vitória com dívida: abriu e levou o volante.';
/** The result's bill: why it ended, the budget, the Grana and the debt (the steering wheel). */
export interface ObjectiveBill {cause:ObjectiveCause;reason:string;budget:string;grana:string;paid:string;debt?:string;
  /** Victory with debt: he opened it anyway and took the steering wheel as a guarantee. */
  debtVictory:boolean;wave:string;aria:string}
export function objectiveBill(result:ObjectiveResult):ObjectiveBill{
  const debtVictory=result.outcome==='victory'&&result.debt>0;
  const budget=reais(result.budget),grana=reais(result.grana),paid=reais(result.paid),debt=result.debt>0?reais(result.debt):undefined;
  const wave=`Onda ${Math.max(1,result.wave)}`;
  return {cause:result.cause,reason:debtVictory?DEBT_VICTORY_TEXT:OBJECTIVE_CAUSE_TEXT[result.cause],budget,grana,paid,...(debt?{debt}:{}),debtVictory,wave,
    aria:`Orçamento ${budget}, grana do time ${grana}.${debtVictory?` Vitória com dívida: faltou ${debt}, ele levou o volante.`:''}`};
}

/**
 * The jokes for whoever put R$ 0 into the vaquinha (board plans/carteira-pix-proposta.md §2: "Tio: R$ 0, pediu
 * recibo"), one per R$ 0 in the line's order, round the list.
 */
export const VAQUINHA_ZERO_JOKES:readonly string[]=['pediu o recibo','esqueceu a carteira no carro','vai pagar no PIX (mentira)'];
/**
 * The result's vaquinha line (carteira-e-pix, ObjectiveResult.share): each player's part of the bill, in the room's
 * order, "Vaquinha: Ana R$ 12; Bot R$ 8; Zé R$ 0, pediu o recibo"; me as "Você". Undefined with no share.
 */
export function vaquinhaLine(share:readonly VaquinhaShare[]|undefined,nameOf:(id:string)=>string){
  if(!share?.length)return undefined;
  let zeros=0;
  const parts=share.map(s=>{
    const paid=Math.max(0,Math.round(Number.isFinite(s.paid)?s.paid:0));
    return `${nameOf(s.id)} ${reais(paid)}${paid>0?'':`, ${VAQUINHA_ZERO_JOKES[zeros++%VAQUINHA_ZERO_JOKES.length]}`}`;
  });
  return {text:`Vaquinha: ${parts.join('; ')}`,aria:`Vaquinha da conta: ${parts.join('; ')}.`};
}
