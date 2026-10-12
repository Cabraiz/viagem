/**
 * Adesivos ilustrados de itens, prêmios e sons (NEW-20261009-DSG-adesivos-itens): `sticker('coxinha')` devolve o HTML de
 * um <svg><use href="#a-coxinha"/></svg>. O sprite (src/ui/stickers.svg, gerado por scripts/make-stickers.mjs) entra no
 * DOM uma vez por icon-sprite.ts, junto com o de sistema; este módulo não importa o SVG, para rodar no node.
 * Pixel art de 24×24 (a cor real de cada objeto); tamanhos 24, 32 e 48 px (pixel inteiro no celular de DPR 3),
 * decorativo sem `label`.
 */
import type {IconOptions} from './icon.ts';

export const STICKER_NAMES=[
  // Itens (src/game/hud/items.ts): armas, evoluções, passivas, o lanche e o item que o cliente não conhece.
  'chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo',
  'cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao','coxinha','misterio',
  // Prêmios (src/game/hud/awards.ts), o figurante e os vices (balança do desempate, pódio de caixote 2 e 3, a trave).
  'banana','ambulancia','mochila','rodo','antena','ima-ferradura','camera','coxinhas','bau-aberto','galo',
  'borboleta','halter','foto','balanca','podio-2','podio-3','trave'] as const;
export type StickerName=typeof STICKER_NAMES[number];
const KNOWN=new Set<string>(STICKER_NAMES);
export const isStickerName=(name:string):name is StickerName=>KNOWN.has(name);

const escape=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
export function sticker(name:StickerName,options:IconOptions={}):string{
  const size=options.size??24;
  const cls=['ic','ic-adesivo',size===24?'':`ic-${size}`,options.className??''].filter(Boolean).join(' ');
  const a11y=options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 24 24" ${a11y} focusable="false" data-sticker="${name}"><use href="#a-${name}"/></svg>`;
}
