/**
 * Adesivos ilustrados de itens, prêmios e sons (NEW-20261009-DSG-adesivos-itens): `sticker('coxinha')` devolve o HTML de
 * um <svg><use href="#a-coxinha"/></svg>. O sprite (src/client/ui/stickers.svg, gerado por scripts/make-stickers.mjs) entra no
 * DOM uma vez por icon-sprite.ts, junto com o de sistema; este módulo não importa o SVG, para rodar no node.
 * Pixel art de 24×24 (a cor real de cada objeto); tamanhos 24, 32 e 48 px (pixel inteiro no celular de DPR 3),
 * decorativo sem `label`.
 * Arte v2: com a peça `ui/<id>` importada vira <img> do WebP (mesmas classes e data-sticker); a regra de colisão com os
 * ícones (mesmo id = mesma peça, hoje só `chinelo`) está em icon.ts.
 */
import {artImg,icon,uiArtUrl,type IconName,type IconOptions} from './icon.ts';

export const STICKER_NAMES=[
  // Itens (src/client/hud/items.ts): armas, evoluções, passivas, o lanche e o item que o cliente não conhece.
  'chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo',
  'cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao','coxinha','misterio',
  // Prêmios (src/client/hud/awards.ts), o figurante e os vices (balança do desempate, pódio de caixote 2 e 3, a trave).
  'banana','ambulancia','mochila','rodo','antena','ima-ferradura','camera','coxinhas','bau-aberto','galo',
  'borboleta','halter','foto','balanca','podio-2','podio-3','trave'] as const;
/**
 * Art-only stickers (arte v2, card NEW-20261016-ORQ-importar-ui-itens-efeitos): `ui/<id>` pieces with no pixel-art twin
 * in stickers.svg. Without their WebP (an index that failed to load, a test) they draw the "mistério" box.
 */
export const ART_STICKER_NAMES=[
  // D-051 arsenal: the 7 weapons, the snacks, the tower kit, the hand's passives and the legendary slot's frame.
  'faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao','brigadeiro','pacoca','cocada','kit-torre',
  'pente','silenciador','moldura-lendaria',
  // Controls and places: attack/push buttons, the nest, the crate, the bank, the wallet, PIX, Dona Cida, the chaveiro.
  'atacar','empurrar','ninho','caixa','banco','carteira','pix-envio','cida','chaveiro',
  // The weapons and charms of the next arsenal (pedido 12): imported, not yet in the game.
  'arruda','bola-de-cristal','bola-murcha','buscape','canto-da-iara','carregador-errado','carro-de-som','colher-de-pau',
  'cristal-quantico','defumador','espeto','estilingue','facao','figa','fogo-boitata','gorro-do-saci','mangueira',
  'mula-sem-cabeca','olho-grego','pandeiro','panela-de-pressao','papagaio','peixeira','pes-do-curupira','quadradao',
  'sacole','sal-grosso','tampa-de-panela','taro-vencido','tijolo-baiano','traque','uivo-do-lobisomem','vaquinha',
  'vela-esoterica','ventilador','vira-lata',
  // Tower defenses (torres-fio): one icon per DefenseId.
  'torre-antiaerea-quadrupla','torre-arame-e-sirene','torre-atiradores-do-telhado','torre-equipe-antimaterial',
  'torre-guarnicao-do-predio','torre-gustavao','torre-holofote','torre-lanca-foguetes','torre-morteiro',
  'torre-ninho-de-metralhadora','torre-ninho-do-sniper','torre-obuseiro','torre-posto-de-radar','torre-rojao-de-festa',
  'torre-vigia-do-predio','torre-vigias-armados',
  // The dourada edition of each arsenal weapon (caixa-gamble-raridade, the user 24/10: "crie as armas sendo douradas
  // pelo chatgpt"): `<weapon sticker>-dourada`, worn by a weapon at level 4 (goldSticker).
  'pistola-dourada','escopeta-dourada','submetralhadora-dourada','rifle-dourada','macarico-dourada','rojao-dourada','estilingue-dourada','espeto-dourada','sacole-dourada','tampa-de-panela-dourada','pandeiro-dourada','bola-murcha-dourada','traque-dourada','buscape-dourada','figa-dourada','vela-esoterica-dourada','tijolo-baiano-dourada','taro-vencido-dourada','panela-de-pressao-dourada','carro-de-som-dourada'] as const;
export type StickerName=typeof STICKER_NAMES[number]|typeof ART_STICKER_NAMES[number];
const KNOWN=new Set<string>([...STICKER_NAMES,...ART_STICKER_NAMES]);
const SVG=new Set<string>(STICKER_NAMES);
export const isStickerName=(name:string):name is StickerName=>KNOWN.has(name);
/** The level a weapon wears its dourada sticker at (sim/weapons/arsenal.ts: 4 = dourada). */
export const GOLD_LEVEL=4;
/** A weapon's sticker at this level: its `-dourada` edition at GOLD_LEVEL when that art is in, else its own. */
export function goldSticker(name:StickerName,level:number):StickerName{
  if(level!==GOLD_LEVEL)return name;
  const gold=`${name}-dourada`;
  return isStickerName(gold)&&uiArtUrl(gold)?gold:name;
}

const escape=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
export function sticker(name:StickerName,options:IconOptions={}):string{
  const size=options.size??24;
  const cls=['ic','ic-adesivo',size===24?'':`ic-${size}`,options.className??''].filter(Boolean).join(' ');
  const art=uiArtUrl(name);
  if(art)return artImg(cls,art,options.label,`data-sticker="${name}"`);
  const a11y=options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 24 24" ${a11y} focusable="false" data-sticker="${name}"><use href="#a-${SVG.has(name)?name:'misterio'}"/></svg>`;
}
/**
 * The imported sticker `name` where its WebP is loaded, else the system icon `fallback` (icones-no-hud: a control that
 * only wears its art-v2 sticker once the art is in, never the "mistério" box).
 */
export const stickerOrIcon=(name:StickerName,fallback:IconName,options:IconOptions={})=>uiArtUrl(name)?sticker(name,options):icon(fallback,options);
