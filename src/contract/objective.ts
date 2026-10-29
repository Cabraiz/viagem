/**
 * D-047, the match objective "esperar o chaveiro" (Cidade Nevada, card NEW-20261013-ORQ-objetivo-chaveiro): what the
 * client, the HUD and the room share about it. The simulation lives in src/sim/chaveiro/; the wire encoding of the
 * view is a later pass (only types and shared numbers here).
 */
import type {VaquinhaShare} from './wallet.ts';

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

/**
 * A bank (rules/bancos.ts, card bancos-e-veiculos): an ATM at a fixed point of the run. state: 'aberto' (full or
 * partly, nobody at it), 'sacando' (a hero holds it and it pays), 'bicho' (a critter is withdrawing), 'sem-cedulas'
 * (empty until `until`, a tick). saldo: R$ left in it. drawer: the critter withdrawing (state 'bicho'). id, x, y, name
 * are static per run (the protocol sends them on keyframes); saldo, state, until, drawer change. In the city, both
 * modes (chaveiro and the wall): RunView.banks, not the objective.
 */
export type BankState='aberto'|'sacando'|'bicho'|'sem-cedulas';
/** The banks' names (their text and numbers: rules/bancos.ts); never a real brand. */
export const BANK_IDS=['pao-duro','juros','posto'] as const;
export type BankName=typeof BANK_IDS[number];
/**
 * Bicos (card NEW-20261024-ORQ-bancos-viram-bicos; their names, lines and numbers: rules/bicos.ts BICOS): each bank's
 * place is a shop with a gig, drawn by the seed and drawn again (another one) every time the shop opens. With it the
 * states read: 'aberto' (open, nobody in), 'sacando' (heroes in the shift), 'bicho' (a critter takes the money),
 * 'sem-cedulas' (closed until `until`: the shift's money is gone).
 */
export const BICO_IDS=['telemarketing','aura-67','entregador','compro-ouro','colchao','coach','fiscal','curso','influencer','pesquisa'] as const;
export type BicoId=typeof BICO_IDS[number];
/**
 * bico: the gig the shop has now. workers: the players in the shift (PlayerInput.work; they are inside: no hits, no
 * shots), absent when nobody. fila: the critters in its queue (each cuts the pay; rules/bicos.ts), absent when none.
 */
export interface BankView {id:string;x:number;y:number;name:BankName;saldo:number;state:BankState;until?:number;drawer?:string;
  bico:BicoId;workers?:string[];fila?:number}

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
  /**
   * D-052 (the car moves): `movers` are the players pushing or pulling it now (absent: nobody; they do not attack while
   * they do), `rope` the one pulling it by the rope (one at a time). The position follows the car as it moves.
   * Card puxar-uno-corda: `heading` (radians, absent = 0) is where its nose points; the rope is tied to the front bumper
   * (carNose) and lies on the ground ahead of it (ropeTip) while nobody holds it.
   */
  car:{x:number;y:number;hits:number;limit:number;parts:number;movers?:string[];rope?:string;heading?:number};
  ended?:'victory'|'defeat';
}
/**
 * D-052, the movable car (card NEW-20261016-ORQ-carro-e-fortificacao-livre, approved proposal): its speed (u/s) by the
 * number of players moving it (index; 3 or more is the cap), how close a hero pushes it (to its body) or hooks the rope,
 * the rope's length, the car's body radius and how close to a living nest it may never go. The body is 1 u (the siege
 * radius it always had), not the proposal's 1.5: a 1.5 u disc does not fit the city's streets (from the wall's spot it
 * reaches 16 u², against the whole city at 1-1.2 u). Pushing: an input pointing at the car within CAR_PUSH_DOT (cos).
 * Card empurrar-uno (user, 22/10: "deixe empurrar 2x mais rápido o Uno"): twice the approved 0.8 / 1.4 / 1.8, the rope
 * too (one table); the cap stays under the city hero's walk (heroSpeed 3.99 u/s), so the movers keep up with it.
 */
export const CAR_SPEED:readonly number[]=Object.freeze([0,1.6,2.8,3.6]);
export const carSpeed=(movers:number)=>CAR_SPEED[Math.max(0,Math.min(CAR_SPEED.length-1,Math.floor(movers)))];
export const CAR_PUSH_REACH=1.2,CAR_PULL_REACH=1.5,CAR_ROPE=3,CAR_RADIUS=1,CAR_NEST_KEEP_OUT=6,CAR_PUSH_DOT=.5;
/**
 * Card puxar-uno-corda (user, 23/10: "ao empurrar o Uno deveria estar visível algum lugar para puxá-lo também"): the
 * rope is tied to the FRONT bumper, CAR_NOSE u ahead of the centre along the heading, and its free end lies
 * CAR_ROPE_REST u further ahead on the ground. A hero within CAR_PULL_REACH of that end walking away from the bumper
 * (cos ≥ CAR_PUSH_DOT) takes it, the way a pusher leans on the car: no button. Taut (CAR_ROPE from the bumper) it pulls
 * and counts as one mover (carSpeed). It is let go after CAR_ROPE_LET_GO_S without a stick pointing away from the
 * bumper (cos ≥ CAR_ROPE_KEEP_DOT: steering is fine, turning back or stopping lets it go). A pulled car turns its nose
 * toward the pull at CAR_ROPE_TURN rad/s at most (a towed car), a pushed one along the push's axis.
 */
export const CAR_NOSE=1.3,CAR_ROPE_REST=1.6,CAR_ROPE_LET_GO_S=.6,CAR_ROPE_KEEP_DOT=.3,CAR_ROPE_TURN=1.2;
const unitHeading=(heading=0)=>({x:Math.cos(heading),y:Math.sin(heading)});
/** The front bumper, where the rope is tied (world u). */
export const carNose=(car:{x:number;y:number;heading?:number})=>{const h=unitHeading(car.heading);return {x:car.x+h.x*CAR_NOSE,y:car.y+h.y*CAR_NOSE};};
/** The free end of the rope lying on the ground ahead of the bumper. */
export const ropeTip=(car:{x:number;y:number;heading?:number})=>{const h=unitHeading(car.heading),d=CAR_NOSE+CAR_ROPE_REST;return {x:car.x+h.x*d,y:car.y+h.y*d};};
/**
 * Card BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima (user, 24/10: "uma pessoa meio que flutua no Uno, tem que ter melhor
 * block nele"): the car's body is the Uno's footprint, a box CAR_HALF_LENGTH along the heading and CAR_HALF_WIDTH across
 * it (the renderer's CAR_HALF), not the CAR_RADIUS disc (which left 0.3 u of bumper outside it at each end). Heroes and
 * critters stand clear of the box (carPushOut), pushers lean on it and critters hit it from its edge (carGap). The
 * disc stays where the car itself meets the structures, nests and the build rules (the map's walls: carBodyDiscs).
 */
export const CAR_HALF_LENGTH=1.32,CAR_HALF_WIDTH=.58;
type CarPlace={x:number;y:number;heading?:number};
/** `p` in the car's frame: along the heading (l) and across it (w). */
function carLocal(car:CarPlace,p:{x:number;y:number}){
  const c=Math.cos(car.heading??0),s=Math.sin(car.heading??0),rx=p.x-car.x,ry=p.y-car.y;
  return {l:rx*c+ry*s,w:-rx*s+ry*c,c,s};
}
/** How far `p` is from the car's body (u, 0 on or inside it). */
export function carGap(car:CarPlace,p:{x:number;y:number}):number{
  const q=carLocal(car,p);
  return Math.hypot(Math.max(0,Math.abs(q.l)-CAR_HALF_LENGTH),Math.max(0,Math.abs(q.w)-CAR_HALF_WIDTH));
}
/**
 * Where a body of `radius` at `p` stands clear of the car: `p` itself when it already is, else the nearest point
 * `radius` off the box (out through the shallower side from inside it).
 */
export function carPushOut(car:CarPlace,p:{x:number;y:number},radius:number):{x:number;y:number}{
  const q=carLocal(car,p),ol=Math.abs(q.l)-CAR_HALF_LENGTH,ow=Math.abs(q.w)-CAR_HALF_WIDTH;
  let l=q.l,w=q.w;
  if(ol>0||ow>0){
    // Outside the box: off its nearest point, radius away.
    const dl=Math.max(0,ol)*Math.sign(q.l),dw=Math.max(0,ow)*Math.sign(q.w),d=Math.hypot(dl,dw);
    if(d>=radius)return p;
    l=q.l-dl+dl/d*radius;w=q.w-dw+dw/d*radius;
  }else if(ol>ow)l=(q.l<0?-1:1)*(CAR_HALF_LENGTH+radius);
  else w=(q.w<0?-1:1)*(CAR_HALF_WIDTH+radius);
  return {x:car.x+l*q.c-w*q.s,y:car.y+l*q.s+w*q.c};
}
/**
 * NEW-20261028-ORQ-uno-atravessa-tralha (the user, 28/10: "muitas tralhas que vão me atrapalhar a caminhar com o carro
 * pelo jogo todo"): where the car meets the map (the hero mask) it is its body, not the CAR_RADIUS disc (2 u wide: it
 * stayed out of every yard behind a one-cell door, 1.5 u). The body as CAR_BODY_DISCS.length discs of CAR_BODY_R along
 * the heading (a capsule over the box: its sides, its bumpers).
 */
export const CAR_BODY_R=CAR_HALF_WIDTH;
const CAR_BODY_STEP=CAR_HALF_LENGTH-CAR_BODY_R;
export const CAR_BODY_DISCS=[-CAR_BODY_STEP,0,CAR_BODY_STEP] as const;
/** The body's discs (centres, radius CAR_BODY_R) at (x, y) with the nose along `heading`. */
export function carBodyDiscs(x:number,y:number,heading=0):{x:number;y:number;r:number}[]{
  const h=unitHeading(heading);
  return CAR_BODY_DISCS.map(l=>({x:x+h.x*l,y:y+h.y*l,r:CAR_BODY_R}));
}
/** Players on the wire's movers list at most (the encoder keeps the first ones). */
export const MAX_CAR_MOVERS=8;
/**
 * {t:'puxar',round,req,on}: hook (on) or drop the rope. Refused when too far from the car ('longe'), someone else holds
 * the rope ('ocupado'), the team is picking cards (D-050 'pausa'), the run is not in combat ('fase') or the req was
 * already answered ('duplicate'). The answer is {t:'puxou',req,ok,reason?}.
 */
export type PullRefusal='longe'|'ocupado'|'pausa'|'fase'|'duplicate';
export type PullResult={ok:true}|{ok:false;reason:PullRefusal};
/** Seconds before the moto reaches a delivery stop when the HUD and the bots start marking it. */
export const DELIVERY_MARK_SECONDS=30;
/**
 * The end of a chaveiro run (RunState.objective in the result). budget = BUDGET_BASE + BUDGET_PER_HIT per hit (R$ 25 + R$ 3, chaveiro/system.ts); paid = min(Grana, budget);
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
  /** The vaquinha (contract wallet.ts): each player's wallet at the end and what they put into the bill. */
  share?:VaquinhaShare[];
}
