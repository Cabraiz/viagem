/**
 * Bicos (card NEW-20261024-ORQ-bancos-viram-bicos; user, 24/10: "um pseudotrabalho temporário em que aparece um botão no
 * lugar de atacar, se chama trabalhar, e você fica meio que farmando dinheiro parado até você andar para fora do círculo
 * dele"). The banks' places (rules/bancos.ts BANCO: count, holdR, the ring around the car) are now shops with a gig: a
 * standing hero in the ring taps Trabalhar (PlayerInput.work) and goes in; inside he earns R$/s, does not fire and takes
 * no hit; moving (or letting go of Trabalhar) is quitting. Every name, line and number lives here so the user can veto
 * one by changing one line.
 * - A shift has no limit (card NEW-20261029-ORQ-bico-sem-limite-pix-voando; user, 29/10: "E trabalhar não deveria ter
 *   limite, foco é que quando trabalha aparece dinheiros (pix) em volta"): the shop never runs out nor closes; the brakes
 *   are the queue, the manager, not firing and leaving when moving. The PIX fly around whoever works (render/bancos/pix.ts).
 * - Each critter in the queue (within BANCO.filaR of the door) cuts the pay by BICO.filaCorte; at BICO.filaExpulsa the
 *   manager throws everyone out, slowed for BICO.expulsoS and kept out for BICO.banidoS.
 * - A critter alone at the shop withdraws like at the ATM (BANCO.bichoR, bichoSaqueS, Cliente Prime); the shop stays open.
 */

import type {BicoId} from '../contract/index.ts';

export interface BicoDef {
  /** Short name (the HUD's tag, the shop's sign). */
  nome:string;
  /** The line under it (humor D-047: a petty cause, a cosmic consequence). */
  frase:string;
  /** The shop front it opens in (public/art/city/bicos/bico-<arte>.webp; the client's bico-art.ts SHOP_IDS). */
  arte:'24-7'|'call-center'|'aura-67'|'compro-ouro'|'colchoes'|'curso';
  /** Pay cut per critter in the queue, when not BICO.filaCorte (the Fiscal de Fila's). */
  filaCorte?:number;
}

export const BICOS:Readonly<Record<BicoId,BicoDef>>=Object.freeze({
  telemarketing:{nome:'Telemarketing',frase:'Oferecendo cartão de crédito pra quem está sendo devorado. Meta: 40 ligações.',arte:'call-center'},
  'aura-67':{nome:'Farmar Aura 67',frase:'Fica parado de óculos escuros. Cada segundo vale +67 de aura e R$ 2.',arte:'aura-67'},
  entregador:{nome:'Entregador de App',frase:'Entrega um lanche frio a 3 quarteirões. Avaliação: 1 estrela, "demorou".',arte:'24-7'},
  'compro-ouro':{nome:'Plaquinha Compro Ouro',frase:'Segura a placa no fim do mundo. Ninguém vende ouro, todo mundo grita.',arte:'compro-ouro'},
  colchao:{nome:'Testador de Colchão',frase:'Dorme em serviço com carteira assinada. Os bichos respeitam quem está deitado.',arte:'colchoes'},
  coach:{nome:'Coach de LinkedIn',frase:'Posta "o apocalipse me ensinou sobre liderança". 4 mil curtidas, R$ 0,50.',arte:'24-7'},
  fiscal:{nome:'Fiscal de Fila',frase:'Garante que ninguém fure a fila do fim do mundo.',arte:'24-7',filaCorte:.15},
  curso:{nome:'Revendedor de Curso',frase:'Vende o curso "Como sair da cidade". Ele mesmo nunca saiu.',arte:'curso'},
  influencer:{nome:'Influencer de Cupom',frase:'Grava "link na bio" pra 3 seguidores. Dois são bichos.',arte:'24-7'},
  pesquisa:{nome:'Pesquisa de Satisfação',frase:'De 0 a 10, quanto você recomendaria ser mordido?',arte:'call-center'},
});
export const BICO_EXPULSO='O gerente te botou pra fora';

/**
 * The numbers (R$, seconds; places and radii are BANCO's). The bench (etapa 5) tunes them: target, the gigs give 25–35 %
 * of a run's Grana, like the ATMs did.
 * Etapa 5 (bench-city-run, 16 seeds × 1,3,6, main dfae424): the ATM paid whoever walked by, a gig pays only who stops,
 * so porSegundo went 1 → 2 (dupla .6 → 1.2). Production mode (chaveiro + ninhos + manual) 31.4/23.2/23.8 % of the Grana
 * (1p/3p/6p) against the ATMs' 25/21/28.3 %; the default flags 13.5/34.7/27.6 % against 9.2/18.5/20.7 %
 * (evidence/NEW-20261024-ORQ-bancos-viram-bicos/bench-bicos*.json; 1, 1.5 and 1.8 R$/s beside it).
 * No limit (bico-sem-limite-pix-voando, same bench, default flags): 15.9/31.8/40.6 % (was 16.1/19.6/17.1 %), wins
 * 5/15/6 of 16 (was 5/14/4). 6p is over only in the runs it loses by round ~5 (55 %; the won ones 31 %), and a lower
 * rate does not bring it down: 2/.9 gave 41.1 % (3p wins 13), 1.6/1 gave 45.3 % (6p wins 2). So 2/1.2 stays.
 * - porSegundo: R$/s of one hero alone in a shift; dupla: R$/s EACH when two or more work it ("o chefe divide o salário").
 * - nota: the pay goes into the wallet in notes of this much (and each note lures the critters around, BANCO.iscaR).
 * - filaCorte: pay × (1 − filaCorte × critters in the queue); filaExpulsa critters in it throw everyone out.
 * - expulsoS: an expelled hero walks slowed (PLAYER_SLOW_MULT) this long; banidoS: he cannot clock in again this long.
 * - lote: the shop needs this clear (u, a disc around the ring: the building stands behind it, door to the camera, in
 *   any of its 4 turns); the ring points with it come first (sim/bancos planBanks), the others only as a fallback.
 */
export const BICO=Object.freeze({
  porSegundo:2,dupla:1.2,nota:5,
  filaCorte:.25,filaExpulsa:3,
  expulsoS:1,banidoS:3,
  lote:4,
});
