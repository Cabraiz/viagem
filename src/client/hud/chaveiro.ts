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
import {CIDA_ITEMS,type CidaItem,type CidaItemId,type MotoMode,type ObjectiveCause,type ObjectiveResult,type ObjectiveView,type VaquinhaShare} from '../../contract/index.ts';

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

/** The round chip's chaveiro part: the clock and the words for the screen reader. */
export interface ChaveiroClock {clock:string;seconds:number;aria:string}
export function chaveiroClock(objective:Pick<ObjectiveView,'etaS'|'moto'>):ChaveiroClock{
  const seconds=Math.max(0,Math.ceil(objective.etaS)),clock=etaClock(seconds);
  return {clock,seconds,aria:objective.moto.mode==='abrindo'?`Chaveiro abrindo o carro: ${clock}`:`Chaveiro chega em ${clock}`};
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
 * When the reason's row comes and goes (the row itself waits its turn in the announcement slot, RunHud.queueRow, and
 * leaves after REASON_MS on screen): `show` on the view where he stops (a new stop replaces the row at once), `drop`
 * when he rides again, the objective ends or goes away (a line still waiting in the queue would be stale).
 */
export class MotoReason {
  private mode?:MotoMode;
  step(mode:MotoMode|undefined):{show?:{text:string;urgent:boolean;mode:MotoMode};drop:boolean}{
    if(mode===this.mode)return {drop:false};
    const was=this.mode;this.mode=mode;
    const text=mode?MOTO_REASONS[mode]:undefined;
    if(text&&mode)return {show:{text,urgent:reasonUrgent(mode),mode},drop:false};
    return {drop:!!was&&!!MOTO_REASONS[was]};
  }
  reset(){this.mode=undefined;}
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
  car:'Perda total. O motor segue ligado.',
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
 * order, "Vaquinha: Ana R$ 12 · Bot R$ 8 · Zé R$ 0, pediu o recibo"; me as "Você". Undefined with no share.
 */
export function vaquinhaLine(share:readonly VaquinhaShare[]|undefined,nameOf:(id:string)=>string){
  if(!share?.length)return undefined;
  let zeros=0;
  const parts=share.map(s=>{
    const paid=Math.max(0,Math.round(Number.isFinite(s.paid)?s.paid:0));
    return `${nameOf(s.id)} ${reais(paid)}${paid>0?'':`, ${VAQUINHA_ZERO_JOKES[zeros++%VAQUINHA_ZERO_JOKES.length]}`}`;
  });
  return {text:`Vaquinha: ${parts.join(' · ')}`,aria:`Vaquinha da conta: ${parts.join('; ')}.`};
}
