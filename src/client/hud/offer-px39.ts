/**
 * The level-up popup in 16-bit pixel art (card NEW-20261025-ORQ-popup-levelup-12-variacoes, var-39 chosen by the user):
 * the offer's own icons (public/art/ui-extra/px39/icones/<id>.webp, ChatGPT pixel art with snow), only in the popup;
 * the inventory and the crate keep the arte v2 stickers. Pure, so the icon set and the fan are unit-tested in node.
 */
import {sticker,isStickerName} from '../ui/sticker.ts';

/** Item icons redrawn in the var-39 style (groups A1 and B; the orbit weapons leaving the game were skipped). */
export const PX39_ICONS:ReadonlySet<string>=new Set([
  'arruda','audio','bola-de-cristal','bola-murcha','boleto-evo','boleto','bone','brigadeiro','buscape','cafe-evo',
  'cafe-forte','cafe','canto-da-iara','carregador-errado','carro-de-som','cartao','chinelo','cocada','colher-de-pau',
  'coxinha','cristal-quantico','defumador','escopeta','espeto','estilingue','faca','facao','fogo-boitata',
  'gorro-do-saci','guarda-chuva','ima','kit-torre','macarico','mangueira','marmita','megafone','misterio',
  'mula-sem-cabeca','oculos','olho-grego','pacoca','panela-de-pressao','papagaio','peixeira','pente','pes-do-curupira',
  'pistola','pombo','quadradao','rifle','rojao','sacole','sal-grosso','silenciador','submetralhadora','tampa-de-panela',
  'taro-vencido','tenis','tijolo-baiano','traque','uivo-do-lobisomem','vaquinha','ventilador','vira-lata']);

export const px39IconUrl=(id:string)=>PX39_ICONS.has(id)?`/art/ui-extra/px39/icones/${id}.webp`:undefined;

/** The card's icon: the pixel-art one when drawn, else the item's arte v2 sticker. */
export function px39Icon(id:string):string{
  const url=px39IconUrl(id);
  if(url)return `<img class="ic ic-px39" src="${url}" alt="" aria-hidden="true" data-sticker="${id}" draggable="false" decoding="async">`;
  return isStickerName(id)?sticker(id):sticker('misterio');
}

/**
 * The fan's slot of each card, left to right: the default pick stands in the middle with the gold frame, the others
 * open to the sides (3: l, m, r; 4: l2, l1, r1, r2 with the default at l1; 2: l1, r1; 1: m).
 */
export type FanSlot='l2'|'l'|'l1'|'m'|'r1'|'r'|'r2';
const FAN:Readonly<Record<number,readonly FanSlot[]>>={1:['m'],2:['l1','r1'],3:['l','m','r'],4:['l2','l1','r1','r2']};
const MIDDLE:Readonly<Record<number,number>>={1:0,2:0,3:1,4:1};
export function fanSlots(count:number,defaultIndex:number):FanSlot[]{
  const slots=FAN[count];
  if(!slots)return Array.from({length:count},()=>'m');
  const middle=MIDDLE[count],def=defaultIndex>=0&&defaultIndex<count?defaultIndex:0;
  const rest=slots.filter((_,i)=>i!==middle);
  return Array.from({length:count},(_,i)=>i===def?slots[middle]:rest.shift()!);
}

/** The gain in the box: the number big ("+40%", "+R$ 3", "Ataca 8%"), the words small under it. */
export function splitGain(gain:string):{big:string;small:string}{
  const words=gain.trim().split(/\s+/),at=words.findIndex(w=>/\d/.test(w));
  if(at<0)return {big:gain.trim(),small:''};
  return {big:words.slice(0,at+1).join(' '),small:words.slice(at+1).join(' ')};
}
