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
 * Card oferta-icone-do-poder: the card shows the POWER, not the object (ChatGPT pixel art with snow, the sheet the user
 * approved on 29/10, public/art/ui-extra/px39/efeitos/<id>.webp). A passive is its effect alone; a weapon keeps its
 * object (what shows in the game) with a seal of its main effect. The item's name lives in the label and the inventory.
 */
export const EFFECT_ICONS=['recarga','vida','regeneracao','armadura','velocidade','area','sorte','dano','grana','projetil',
  'velocidade-tiro','aura','lento','empurra','persegue','atravessa','ricochete','queima'] as const;
export type EffectIcon=typeof EFFECT_ICONS[number];

/** Each passive's gain (offer-card.ts offerGain) as its icon. */
export const PASSIVE_EFFECT:Readonly<Record<string,EffectIcon>>={
  'cafe-forte':'recarga',marmita:'vida',arruda:'regeneracao','tampa-de-panela':'armadura',tenis:'velocidade',megafone:'area',
  bone:'sorte',oculos:'dano',cartao:'grana',pente:'projetil',estilingue:'velocidade-tiro',defumador:'aura'};

/** Each weapon's main effect (its blurb in items.ts) as the seal on its icon; one with no clear effect has none. */
export const WEAPON_EFFECT:Readonly<Record<string,EffectIcon>>={
  boleto:'atravessa','boleto-evo':'atravessa','boleto-lendario':'atravessa',cafe:'queima','cafe-evo':'queima','cafe-lendario':'queima',
  'guarda-chuva':'empurra','guarda-chuva-lendario':'empurra',pombo:'persegue','pombo-lendario':'persegue',audio:'empurra',
  'audio-lendario':'empurra',faca:'dano',pistola:'dano',escopeta:'projetil',submetralhadora:'recarga',rifle:'atravessa',
  macarico:'queima',rojao:'area',baladeira:'velocidade-tiro',espeto:'atravessa',sacole:'lento','tampa-voadora':'atravessa',
  'colher-de-pau':'empurra',peixeira:'dano','bola-murcha':'ricochete',traque:'area',buscape:'persegue',facao:'area',
  'sal-grosso':'empurra','tijolo-baiano':'area','taro-vencido':'projetil','nuvem-de-incenso':'lento',corneta:'empurra',
  mangueira:'empurra','galho-de-arruda':'aura','pes-do-curupira':'lento','panela-de-pressao':'area','carro-de-som':'projetil',
  'vira-lata':'persegue',ventilador:'empurra','fogo-boitata':'ricochete','olho-grego':'atravessa','uivo-do-lobisomem':'lento',
  'mula-sem-cabeca':'atravessa','gorro-do-saci':'area','canto-da-iara':'lento','bola-de-cristal':'area','cristal-quantico':'ricochete'};

export const effectIconUrl=(fx:EffectIcon)=>`/art/ui-extra/px39/efeitos/${fx}.webp`;

/**
 * The offer card's icon by the item id: a passive's effect, a weapon's object with its effect's seal, anything else
 * (snacks, unknown ids) its own icon as before.
 */
export function offerIcon(itemId:string,icon:string):string{
  const own=PASSIVE_EFFECT[itemId];
  if(own)return `<img class="ic ic-px39 ic-efeito" src="${effectIconUrl(own)}" alt="" aria-hidden="true" data-efeito="${own}" draggable="false" decoding="async">`;
  const seal=WEAPON_EFFECT[itemId];
  if(!seal)return px39Icon(icon);
  return `${px39Icon(icon)}<img class="rh-card-selo" src="${effectIconUrl(seal)}" alt="" aria-hidden="true" data-efeito="${seal}" draggable="false" decoding="async">`;
}

/**
 * The fan's slot of each card, left to right: the default pick stands in the middle with the gold frame, the others
 * open to the sides, behind it (3: l, m, r; 2: l1, r1; 1: m). Never 4 since oferta-3-cartas (rules/offers.ts).
 */
export type FanSlot='l'|'l1'|'m'|'r1'|'r';
const FAN:Readonly<Record<number,readonly FanSlot[]>>={1:['m'],2:['l1','r1'],3:['l','m','r']};
const MIDDLE:Readonly<Record<number,number>>={1:0,2:0,3:1};
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
