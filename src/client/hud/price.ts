/**
 * Prices as the player sees them (D-048, ficha de torre and Grana). The team has one pile of material, shown only as
 * fichas de torre (🗼, UNITS_PER_TOKEN units each): building the Vigia costs 1 and the Gustavão 3. Everything else is
 * paid in the team's Grana (R$): the evolutions ("🗼⬆ R$ N": the tower sticker and an up arrow, then the price) and the
 * forge's recipes ("R$ N"). The player never reads "unidades" nor material. Every tag, card, button and aria-label
 * reads its price through these helpers. Pure (markup strings), node-tested.
 */
import {icon} from '../ui/icon.ts';

/** `html`: the price on one line (decorative stickers); `speech`: the same price in words, for aria-labels. */
export interface PriceLabel {html:string;speech:string}

/** "1 ficha de torre", "3 fichas de torre". */
export const fichasText=(n:number)=>`${n} ${n===1?'ficha':'fichas'} de torre`;
/** "R$ 12" on screen (a whole, non-negative number). */
export const granaText=(n:number)=>`R$ ${Math.max(0,Math.round(Number.isFinite(n)?n:0))}`;
/** "1 real", "12 reais": a Grana amount in words. */
export const reaisText=(n:number)=>{const r=Math.max(0,Math.round(Number.isFinite(n)?n:0));return `${r} ${r===1?'real':'reais'}`;};
/** What a Grana shortfall says: "Falta R$ 3" on screen, "Faltam 3 reais" (or "Falta 1 real") in words. */
export const granaShort=(n:number):PriceLabel=>({html:`Falta ${granaText(n)}`,speech:`${n===1?'Falta':'Faltam'} ${reaisText(n)}`});
/** A price in fichas de torre (building the Vigia, the Gustavão). */
export const tokenPriceLabel=(tokens:number):PriceLabel=>({html:`<b>${tokens}</b>${icon('torre')}`,speech:fichasText(tokens)});
/** A forge recipe's price (Recipe.cost, R$): "R$ N", "N reais". */
export const forgePriceLabel=(cost:number):PriceLabel=>({html:`<b>${granaText(cost)}</b>`,speech:reaisText(cost)});
/** The up arrow after the tower sticker in an evolution's price (the obra marker's evolve arrow, drawn small). */
export const EVOLVE_ARROW='<svg class="rh-preco-sobe" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 21 12h-5.5v10h-7V12H3z"/></svg>';
/**
 * An evolution's price in Grana (rules priceOf / EVOLVE_PRICE by the tier it reaches): "🗼⬆ R$ N", spoken "Evoluir por
 * N reais" (the whole phrase: the evolve button reads only this). The Gustavão is the exception, in fichas (tokenPriceLabel).
 */
export const evolvePriceLabel=(grana:number):PriceLabel=>({html:`<span class="rh-preco-evoluir">${icon('torre')}${EVOLVE_ARROW}</span><b>${granaText(grana)}</b>`,speech:`Evoluir por ${reaisText(grana)}`});
/** The rail is laid for free (D-048: it comes with the Gustavão's 3 fichas). */
export const FREE_PRICE:PriceLabel={html:'<b>Grátis</b>',speech:'grátis'};
