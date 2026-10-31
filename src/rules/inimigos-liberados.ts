/**
 * The enemies in the game (NEW-20261029-ORQ-so-3-inimigos, the user 29/10: "o jogo terá só o saci e o mendigo e o
 * arrasta-pé ... Foco com testes e tudo tem que ser só com eles por enquanto"). The rotation (rules/enemy-rotation.ts)
 * draws only these; the other roster entries are legacy: hidden, never deleted. Model: personagens-liberados.ts.
 *  - mendigo: the common enemy (role corredor: the bêbado's numbers, catalog.ts rosterDef);
 *  - aberracao-saci: the elite (round 5, rules/enemy-rotation.ts ELITE_ONLY);
 *  - sanfoneiro: the arrasta-pé (role brutamontes, sim/enemies/sanfoneiro.ts plays and drags), the wooden toy art
 *    (NEW-20261030-ORQ-sanfoneiro-brinquedo-no-jogo, public/art/enemies/sanfoneiro).
 * Chefões (the round-8 mini-chefe and the round-10 boss) stay as they are until the user answers.
 */
import {ROSTER} from './enemy-roster.ts';

export const INIMIGOS_LIBERADOS:readonly string[]=Object.freeze([
  'mendigo',
  'aberracao-saci',
  'sanfoneiro',
]);
/** The common enemy: a hidden or unknown kind asked by link or test (?inimigo=x) falls back to it. */
export const INIMIGO_PADRAO=INIMIGOS_LIBERADOS[0];
export const isInimigoLiberado=(id:unknown):id is string=>typeof id==='string'&&INIMIGOS_LIBERADOS.includes(id);
export const inimigoLiberadoId=(id:unknown):string=>isInimigoLiberado(id)?id:INIMIGO_PADRAO;
/** The liberated entries of a roster role (in INIMIGOS_LIBERADOS order). */
export const liberadosDoPapel=(role:string):string[]=>
  INIMIGOS_LIBERADOS.filter(id=>ROSTER.some(e=>e.id===id&&e.role===role));
