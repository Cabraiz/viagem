/**
 * Bancos (card NEW-20261014-ORQ-bancos-e-veiculos, D-047; proposal viagem-board/plans/bancos-e-veiculos-proposta.md):
 * the "Caixa 24 h que só dá nota de 2". Fixed points of the city that pay the team's Grana while a hero holds them, and
 * that the critters rob. Every name, line and number lives here so the user can veto one by changing one line.
 * - The ATM only has R$ 2 notes: each withdrawal is BANCO.nota.
 * - Each note beeps "RETIRE SEU DINHEIRO", loud like the Quadradão's alarm: that beep lures the critters around (iscaR).
 * - A critter alone at the ATM withdraws too; every primeCada it took, it becomes a Cliente Prime (more life, a crown).
 * - Empty, it shows "SEM CÉDULAS" for recargaS, then it is full again ("24 h").
 */

import type {BankName} from '../contract/index.ts';

/** The banks' display names, by BankName (contract/objective.ts BANK_IDS; the sim gives one to each bank). */
export const BANK_NAMES:Readonly<Record<BankName,string>>=Object.freeze({
  'pao-duro':'Banco Pão-Duro S.A.',
  juros:'Banco Juros & Juros',
  posto:'Caixa do Posto (só nota de 2)',
});
/** Short names for the HUD's tags and rows ("Bicho sacando no Juros & Juros!"). */
export const BANK_SHORT:Readonly<Record<BankName,string>>=Object.freeze({
  'pao-duro':'Pão-Duro',
  juros:'Juros & Juros',
  posto:'Caixa do Posto',
});
/** What the ATM's screen says at a withdrawal (one at random), and the beep. */
export const BANK_LINES:readonly string[]=Object.freeze([
  'Tarifa de saque: sua dignidade.',
  'Deseja doar R$ 2 para o Instituto do Gerente?',
  'Sistema lento. Tente em 2009.',
]);
export const BANK_BEEP='RETIRE SEU DINHEIRO';
export const BANK_EMPTY='SEM CÉDULAS';

/**
 * The numbers (world units, seconds, R$). The sim reads them; the bench tunes them (target: the banks give 25–35 % of a
 * run's Grana).
 * - count: banks per run, drawn by the seed among the city's loot points, one per third of the map, at least distCarro
 *   from the car and desvio[0]..desvio[1] from the moto's route.
 * - saldo: R$ in a full ATM; nota: R$ per withdrawal; saqueS: seconds between withdrawals while a hero holds it.
 * - holdR: a hero standing this close holds it; filaR: a critter this close stops it ("tem gente na fila").
 * - iscaR, iscaS: each note lures the critters this close, for this long.
 * - bichoR, bichoSaqueS: a critter this close, with no hero within holdR, withdraws a note every bichoSaqueS.
 * - primeCada, primeVida: every primeCada R$ a critter took makes it a Cliente Prime (max life × primeVida).
 * - recargaS: an empty ATM is "SEM CÉDULAS" this long, then full again.
 */
export const BANCO=Object.freeze({
  count:3,saldo:40,nota:2,saqueS:3,
  holdR:4,filaR:3,
  iscaR:20,iscaS:4,
  bichoR:2,bichoSaqueS:2,primeCada:10,primeVida:1.5,
  recargaS:150,
  distCarro:35,desvio:Object.freeze([20,60] as const),
});
