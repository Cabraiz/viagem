/**
 * D-047, the match objective "esperar o chaveiro" (Cidade Nevada, card NEW-20261013-ORQ-objetivo-chaveiro): what the
 * client, the HUD and the room share about it. The simulation lives in src/sim/chaveiro/; the wire encoding of the
 * view is a later pass (only types and shared numbers here).
 */

/** Objectives a run may play; absent = the round-count run (survive 10 rounds, boss). */
export type ObjectiveKind='chaveiro';
/** Structure id of the car (it replaces the wall, 'muralha', when the objective is on). */
export const CAR_ID='quadradao';
/** Structure-target id of the moto (siege enemies nearby may go for it; touching it makes it fall, no damage). */
export const MOTO_ID='moto';
/** What the chaveiro is doing (the moto's displayed mode). 'volta': the alarm sounds and he rides around the block. */
export type MotoMode='anda'|'lombada'|'entrega'|'morta'|'tombo'|'volta'|'abrindo';
/** Moments of the moto, for lines and HUD ('moto' event). 'tranco': it started again ('alone': na base do tapa). */
export type MotoMoment='morta'|'tranco'|'lombada'|'entrega'|'tombo'|'volta'|'abrindo'|'chegou';
/** Parts the car loses at 25/50/75/90 % of its hit limit (ObjectiveView.car.parts bit i = CAR_PARTS[i] fell). */
export const CAR_PARTS=['para-choque','retrovisor','porta','capo'] as const;
export type CarPart=typeof CAR_PARTS[number];

/** Planned stops on the moto's route. */
export type ObjectiveStopKind='morta'|'lombada'|'entrega';
/** Dona Cida's sweets (team buys with the team's Grana near the moto). */
export type CidaItemId='brigadeiro'|'pacoca'|'cocada';
export interface CidaItem {id:CidaItemId;name:string;price:number;seconds:number;effect:'speed'|'damage'|'guard';mult:number}
export const CIDA_ITEMS:readonly CidaItem[]=Object.freeze([
  Object.freeze({id:'brigadeiro',name:'Brigadeiro de Panela',price:15,seconds:30,effect:'speed',mult:1.25} as const),
  Object.freeze({id:'pacoca',name:'Paçoca Prensada',price:25,seconds:30,effect:'damage',mult:1.3} as const),
  Object.freeze({id:'cocada',name:'Cocada Dura',price:20,seconds:30,effect:'guard',mult:.7} as const),
]);
export const CIDA_ITEM_IDS:readonly CidaItemId[]=CIDA_ITEMS.map(i=>i.id);
/**
 * Player buffs (SimPlayer extras fastUntil / mightUntil / guardUntil): walking speed × FAST_MULT (shared with the
 * client's prediction, maps/prediction.ts), damage dealt × MIGHT_MULT, damage taken × GUARD_MULT (before armor).
 */
export const CIDA_FAST_MULT=1.25,CIDA_MIGHT_MULT=1.3,CIDA_GUARD_MULT=.7;
/** A refused purchase: too far from the moto, out of stock, not enough Grana, not now (run over, player down), unknown item, or a resent request. */
export type CidaRefusal='away'|'stock'|'grana'|'phase'|'item'|'duplicate';
export type CidaBuyResult={ok:true;item:CidaItemId;grana:number}|{ok:false;reason:CidaRefusal};

/** The objective as the HUD and the bots see it (ObjectiveView; seconds rounded up, ticks absolute). */
export interface ObjectiveView {
  kind:ObjectiveKind;
  /** push: tranco progress 0..1 (push ticks accumulated ÷ the push needed), present only while mode is 'morta'. */
  moto:{x:number;y:number;mode:MotoMode;push?:number};
  /**
   * Static per run (the protocol sends it on keyframes and when it changes): the simplified polyline from the avenue
   * entrance to where the moto stops at the car, and the stops on it in route order (s: u along the route).
   */
  route:{x:number;y:number}[];
  stops:{kind:ObjectiveStopKind;x:number;y:number;s:number}[];
  /** Seconds until the car is open, at the planned stops (the HUD's "chaveiro em mm:ss"). */
  etaS:number;
  /** Tick the car alarm stops (in the past when silent). */
  alarmUntil:number;
  grana:number;budget:number;
  /** Dona Cida's stock, in CIDA_ITEMS order. */
  stock:number[];
  /** The next delivery stop ahead (DELIVERY_MARK_SECONDS: when the HUD and the bots mark it), with the moto's ETA to it. */
  delivery?:{x:number;y:number;etaS:number};
  car:{x:number;y:number;hits:number;limit:number;parts:number};
  ended?:'victory'|'defeat';
}
/** Seconds before the moto reaches a delivery stop when the HUD and the bots start marking it. */
export const DELIVERY_MARK_SECONDS=30;
/**
 * The end of a chaveiro run (RunState.objective in the result). budget = base + R$ 8 per hit; paid = min(Grana, budget);
 * debt > 0: he opened it anyway and took the steering wheel as a guarantee.
 */
/**
 * Why a chaveiro run ended: he opened the car, the car was a total loss, the team fell, the D-043 combat cap (or the
 * room closing) ran out.
 */
export type ObjectiveCause='opened'|'car'|'team'|'timeout';
export interface ObjectiveResult {
  kind:ObjectiveKind;outcome:'victory'|'defeat'|'timeout';cause:ObjectiveCause;
  /** Waves played (the round index when it ended) and how many of them came after the last round (extra waves). */
  wave:number;extraWaves:number;
  /** Seconds the chaveiro still needed when it ended (0 on victory). */
  eta:number;
  /** Seconds from the run's start to the end. */
  seconds:number;
  hits:number;limit:number;budget:number;grana:number;paid:number;debt:number;parts:number;
}
