/**
 * Prices as the player sees them (D-048, ficha de torre). The team has one pile of material: building pays in fichas
 * de torre (🗼, UNITS_PER_TOKEN units each), the forge and the evolutions still pay in material units. The player never
 * reads "unidades": a unit price is the number and the material sticker (a crate), spoken "N de material".
 * The Grana step (R$) swaps forgePriceLabel and evolvePriceLabel only; every tag, card, button and aria-label reads
 * its price through them. Pure (markup strings), node-tested.
 */
import {icon} from '../ui/icon.ts';

/** `html`: the number and its sticker (one line, decorative sticker); `speech`: the same price in words, for aria-labels. */
export interface PriceLabel {html:string;speech:string}

/** "1 ficha de torre", "3 fichas de torre". */
export const fichasText=(n:number)=>`${n} ${n===1?'ficha':'fichas'} de torre`;
/** A price in fichas de torre (building the Vigia, the Gustavão). */
export const tokenPriceLabel=(tokens:number):PriceLabel=>({html:`<b>${tokens}</b>${icon('torre')}`,speech:fichasText(tokens)});
/** A price in material units: the number and the crate sticker. */
const materialPrice=(units:number):PriceLabel=>({html:`<b>${units}</b>${icon('material')}`,speech:`${units} de material`});
/** A forge recipe's price (Recipe.cost). Grana step: `R$ N` here. */
export const forgePriceLabel=(cost:number):PriceLabel=>materialPrice(cost);
/** An evolution's price (DefenseDef.cost of tiers 2-5), and what is missing for one. Grana step: `🗼⬆ R$ N` here. */
export const evolvePriceLabel=(def:{cost:number}):PriceLabel=>materialPrice(def.cost);
/** The rail is laid for free (D-048: it comes with the Gustavão's 3 fichas). */
export const FREE_PRICE:PriceLabel={html:'<b>Grátis</b>',speech:'grátis'};
