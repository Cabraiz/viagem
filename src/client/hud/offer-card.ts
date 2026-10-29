/**
 * The centred upgrade window (D-052, card NEW-20261016-ORQ-oferta-melhoria-centro; the reference is the board's
 * design/ref-ofertas-de-melhoria.png): what each card says beyond its sticker and name. Pure (no DOM): node-tested.
 * - The rarity in the corner: the D-051 palette (verde, azul, roxa, dourada) by the level the card reaches; a first copy
 *   is "Nova", an evolution "Lendária". Offers carry no rarity of their own (the crates' rarity is the inventory's).
 * - "Niv N": the level the card gives.
 * - The value line "Velocidade: 1,10x > 1,20x" (the new value in green): a passive's stat before and after, from the
 *   rules port (rules/passives.ts perLevel over contract BASE_STATS). A weapon's per-level table lives in the sim, out of
 *   the client's reach, so a weapon card shows its blurb instead.
 */
import {BASE_STATS,type PlayerStats} from '../../contract/index.ts';
import {AURA,cartaoCashback,passiveDef} from '../../rules/index.ts';
import {itemDisplay} from './items.ts';

export const OFFER_WINDOW_TITLE='Escolha uma melhoria';
export const WAIT_LINE='Esperando os outros jogadores…';
export const SKIP_LABEL='Pular',REROLL_LABEL='Rolar de novo';

export type OfferRarity='nova'|'comum'|'rara'|'epica'|'lendaria';
export const RARITY_LABEL:Readonly<Record<OfferRarity,string>>={nova:'Nova',comum:'Comum',rara:'Rara',epica:'Épica',lendaria:'Lendária'};
/** Rarity of a card from the level it reaches: 1 nova, 2–3 comum, 4–5 rara, 6–7 épica, 8+ (or an evolution) lendária. */
export function offerRarity(itemId:string,level:number):OfferRarity{
  if(itemDisplay(itemId).kind==='evolution')return 'lendaria';
  const l=Math.floor(level)||1;
  return l<=1?'nova':l<=3?'comum':l<=5?'rara':l<=7?'epica':'lendaria';
}
export const levelLabel=(level:number)=>`Nív. ${Math.max(1,Math.floor(level)||1)}`;

/** pt-BR label and format of each stat a passive moves ("x": a multiplier, "n": a plain number). */
const STAT_TEXT:Partial<Record<keyof PlayerStats,{label:string;format:'x'|'n'}>>={
  maxHp:{label:'Vida máxima',format:'n'},moveSpeed:{label:'Velocidade',format:'x'},might:{label:'Dano',format:'x'},
  area:{label:'Área',format:'x'},cooldown:{label:'Recarga',format:'x'},
  luck:{label:'Sorte',format:'x'},growth:{label:'XP',format:'x'},amount:{label:'Projéteis',format:'n'},
  regen:{label:'Regeneração',format:'n'},armor:{label:'Armadura',format:'n'},duration:{label:'Duração',format:'x'},
  speed:{label:'Velocidade dos tiros',format:'x'},revive:{label:'Resgate',format:'x'},
};
const num=(x:number)=>String(Number(x.toFixed(2))).replace('.',',');
const show=(x:number,format:'x'|'n')=>format==='x'?`${num(x)}x`:num(x);

export interface OfferValue {label:string;from:string;to:string}
/**
 * "label: from > to" of a passive card reaching `level` (its first stat; base stats plus perLevel × owned levels), or
 * undefined: a weapon, a snack, an unknown id, or a passive that moves no stat.
 */
export function offerValue(itemId:string,level:number):OfferValue|undefined{
  const def=passiveDef(itemId);
  if(!def)return undefined;
  const key=(Object.keys(def.perLevel) as (keyof PlayerStats)[]).find(k=>STAT_TEXT[k]&&def.perLevel[k]!==undefined);
  if(!key)return undefined;
  const text=STAT_TEXT[key]!,delta=def.perLevel[key]!,l=Math.max(1,Math.floor(level)||1),base=BASE_STATS[key];
  return {label:text.label,from:show(base+delta*(l-1),text.format),to:show(base+delta*l,text.format)};
}

/**
 * Card upgrades-megabonk: the short gain of a tome card, the big line under its name ("+1 projétil", "+10% dano",
 * "Aura: 7 de dano"), from the rules port's perLevel (one level's step). Undefined: a weapon, a snack, an unknown id.
 */
export function offerGain(itemId:string,level:number):string|undefined{
  const def=passiveDef(itemId);
  if(!def)return undefined;
  const l=Math.max(1,Math.floor(level)||1);
  if(itemId==='cartao')return `+R$ ${cartaoCashback(l)-cartaoCashback(l-1)} por caixa`;
  if(itemId==='defumador')return l<=1?`Aura: ${AURA.damage(1)} de dano`:`Aura: +${AURA.damage(l)-AURA.damage(l-1)} de dano, +${num(AURA.radius(l)-AURA.radius(l-1))} m`;
  const p=def.perLevel,pct=(x:number)=>`${Math.round(Math.abs(x)*100)}%`;
  if(p.amount)return `+${p.amount} projétil`;
  if(p.might)return `+${pct(p.might)} dano`;
  if(p.speed)return `+${pct(p.speed)} velocidade do tiro`;
  if(p.area)return `+${pct(p.area)} área`;
  if(p.cooldown)return `Ataca ${pct(p.cooldown)} mais rápido`;
  if(p.maxHp)return `+${p.maxHp} de vida`;
  if(p.regen)return `+${num(p.regen)} de vida/s`;
  if(p.armor)return `-${p.armor} de dano tomado`;
  if(p.moveSpeed)return `+${pct(p.moveSpeed)} velocidade`;
  if(p.luck)return `+${pct(p.luck)} sorte`;
  return undefined;
}
