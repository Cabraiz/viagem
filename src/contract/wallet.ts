/**
 * Each player's wallet and the PIX to a friend (NEW-20261014-ORQ-carteira-e-pix; board plans/carteira-pix-proposta.md,
 * decisions approved by the Orquestrador on 14/10/2026). The Grana (D-047) stops being the team's pot:
 *  - a kill pays whoever made it; a tower's kill pays the tower's owner (DefenseState.owner); a kill nobody made (an
 *    explosion, a tower with no owner) and the boss, always, are split among the players (WALLET_SPLIT);
 *  - each pays what they press: a tower's evolution and repair, the forge, Dona Cida's sweets;
 *  - the chaveiro's bill is a vaquinha at the end (chaveiro result `share`): equal parts, the richer cover the rest;
 *  - a player whose seat expires leaves their wallet split among those who stay;
 *  - PIX: a player sends R$ to a friend, checked by the room (wallet.ts PIX_* rules below).
 * The balance is SimPlayer.grana (absent = 0): on the wire with the players, in the checkpoint with them.
 */

/** Most R$ one PIX may carry. */
export const PIX_MAX=100;
/** One PIX per sender at most this often (ms of room time). */
export const PIX_GAP_MS=2000;
/** The amounts of the balloon's buttons (plus "tudo", the whole balance up to PIX_MAX). */
export const PIX_QUICK:readonly number[]=[5,10,25];
/** The balloon closes this long after it opened, untouched (ms). */
export const PIX_BALLOON_MS=4000;

/**
 * Why a PIX was refused: not a positive whole amount or over PIX_MAX; more than the sender has; to themselves; the
 * friend is not a seated player of this run; outside a run's combat or intermission; during the D-050 level-up pause;
 * sooner than PIX_GAP_MS after the last one; the same request twice.
 */
export type PixRefusal='amount'|'grana'|'self'|'target'|'phase'|'pause'|'rate'|'duplicate';
export type PixResult={ok:true;to:string;amount:number;grana:number}|{ok:false;reason:PixRefusal};
/** The refusals in the player's words (the balloon's line). */
export const PIX_REFUSALS:Readonly<Record<PixRefusal,string>>={
  amount:'Valor inválido.',grana:'Saldo insuficiente.',self:'PIX pra você mesmo não rola.',target:'Essa pessoa não tá na partida.',
  phase:'Agora não dá.',pause:'Espera todo mundo escolher a carta.',rate:'Calma, um PIX de cada vez.',duplicate:'Esse PIX já foi.',
};

/**
 * The PIX's description, drawn by the room from the run's random stream (the same on every client; design/HUMOR):
 * the toast shows "Ana te mandou um PIX de R$ 10 — 'pro pastel'".
 */
export const PIX_MEMOS:readonly string[]=[
  'pro pastel','não conta pra ninguém','devolve na sexta','é emprestado, hein','pra torre, não pra Cida',
  'por aquela vez','sem juros (por enquanto)','pix do bem','confia','tá me devendo uma',
];

/** One player's part of the chaveiro's vaquinha (chaveiro result `share`): what they had and what they put in. */
export interface VaquinhaShare {id:string;had:number;paid:number}
