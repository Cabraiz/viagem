/**
 * D-047, the chaveiro objective as the render reads it (card NEW-20261013-ORQ-chaveiro-render). A mirror of
 * contract/objective.ts ObjectiveView (Executor-2, objetivo-chaveiro) until protocol 15 lands: the render is built and
 * checked on fake data (sandbox-cidade `objetivo=1`), then reads RunView.objective. Only what the drawing needs.
 */

/** contract/objective.ts MotoMode. 'volta': the alarm sounds and he rides around the block. */
export type MotoMode='anda'|'lombada'|'entrega'|'morta'|'tombo'|'volta'|'abrindo';
/** contract/objective.ts CAR_PARTS: bit i of ObjectiveView.car.parts = this part fell. */
export const CAR_PARTS=['para-choque','retrovisor','porta','capo'] as const;
export type CarPart=typeof CAR_PARTS[number];
export type StopKind='morta'|'lombada'|'entrega';

export interface ChaveiroView {
  moto:{x:number;y:number;mode:MotoMode;
    /** 0..1 of the push start ("no tranco"), present while mode is 'morta'. */
    push?:number};
  /** Seconds until the car is open. */
  etaS:number;
  /** Tick the car alarm stops (in the past when silent). */
  alarmUntil:number;
  /** The next delivery stop ahead, marked DELIVERY_MARK_SECONDS before the moto gets there. */
  delivery?:{x:number;y:number;etaS:number};
  car:{x:number;y:number;hits:number;limit:number;parts:number};
  /** The moto's route from its avenue end to the car (simplified polyline), and its stops in route order. */
  route?:readonly {x:number;y:number}[];
  stops?:readonly {kind:StopKind;x:number;y:number;s:number}[];
  ended?:'victory'|'defeat';
}
/**
 * The objective of a run view (RunView.objective, protocol 15), read loosely until the contract has the field; undefined
 * when the run has none.
 */
export function objectiveOf(view:object|undefined):ChaveiroView|undefined{
  return (view as {objective?:ChaveiroView}|undefined)?.objective;
}
