/**
 * The enemies in the game (NEW-20261029-ORQ-so-3-inimigos, the user 29/10: "o jogo terá só o saci e o mendigo e o
 * arrasta-pé ... Foco com testes e tudo tem que ser só com eles por enquanto"). The rotation (rules/enemy-rotation.ts)
 * draws only these; the other roster entries are legacy: hidden, never deleted. Model: personagens-liberados.ts.
 *  - mendigo: the common enemy (role corredor: the bêbado's numbers, catalog.ts rosterDef);
 *  - aberracao-saci: the elite (round 5, rules/enemy-rotation.ts ELITE_ONLY);
 *  - sanfoneiro: the arrasta-pé (role corredor, sim/enemies/sanfoneiro.ts plays and drags), the wooden toy art
 *    (NEW-20261030-ORQ-sanfoneiro-brinquedo-no-jogo, public/art/enemies/sanfoneiro); SANFONEIRO_TETO caps him.
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
/**
 * The sanfoneiro's ceiling (ORQ 31/10, card sanfoneiro-brinquedo-no-jogo; holds until the user asks otherwise): none
 * before `fromRound`, then at most `share` of a round's corredores (rules/waves.ts planRound swaps the rest for the other
 * corredores) and at most `alive` standing at once, `aliveEarly` through round `earlyUntil` (sim/director/waves.ts spawns
 * the other corredor in his place). fromRound 3, not 2: from round 2 the three room bots fell to his drag in round 3
 * even with 1 standing (tests/rooms/city-room-bots.test.ts, seed 4246), the case ORQ set for it. Mode ninhos:
 * the sleepers are round 1 (none) and the nest waves weigh him by pesosDoPapel (sim/assemble.ts, ninhos.ts).
 */
export const SANFONEIRO_TETO=Object.freeze({id:'sanfoneiro',fromRound:3,share:.25,alive:2,aliveEarly:1,earlyUntil:3});
/**
 * A role's draw weights (its weight `w` over its ids) under SANFONEIRO_TETO: before fromRound the sanfoneiro gets none,
 * from it at most share × w; the rest splits evenly among the role's other ids (none: the role loses his part).
 */
export function pesosDoPapel(ids:readonly string[],w:number,round:number):[string,number][]{
  const {id,fromRound,share}=SANFONEIRO_TETO;
  if(!ids.includes(id))return ids.map(k=>[k,w/ids.length]);
  const others=ids.filter(k=>k!==id),mine=round<fromRound?0:Math.min(w/ids.length,share*w);
  const out:[string,number][]=others.map(k=>[k,(w-mine)/others.length]);
  if(mine>0)out.push([id,mine]);
  return out;
}
/** SANFONEIRO_TETO's standing cap in a round. */
export const vivosNaRodada=(round:number)=>round<=SANFONEIRO_TETO.earlyUntil?SANFONEIRO_TETO.aliveEarly:SANFONEIRO_TETO.alive;
/** SANFONEIRO_TETO: the kind to spawn for `kind` in `round` with these bodies standing (the common enemy past the cap). */
export function tetoVivo(kind:string,standing:Iterable<{kind:string;hp:number}>,round:number):string{
  if(kind!==SANFONEIRO_TETO.id)return kind;
  const cap=vivosNaRodada(round);
  let n=0;for(const e of standing)if(e.kind===kind&&e.hp>0&&++n>=cap)return INIMIGO_PADRAO;
  return kind;
}
