/**
 * Ícones-adesivo de sistema e status (NEW-20261009-DSG-icones-sistema): `icon('boia')` devolve o HTML de um
 * <svg><use href="#i-boia"/></svg>. O sprite (src/client/ui/icons.svg) entra no DOM uma vez por icon-sprite.ts; este módulo
 * não importa o SVG, para os testes do HUD rodarem no node.
 * Arte v2 (NEW-20261012-ORQ-importar-arte-b-ligacao): quando o importador entregou `ui/<id>` (src/client/art/manifest.ts,
 * carregado no boot por art-boot.ts), o ícone vira um <img> do WebP 128×128 com as mesmas classes e data-*; sem a peça,
 * o <svg><use> de sempre. Colisão de ids: ícones (#i-) e adesivos (#a-) vão juntos para o grupo `ui` com o mesmo nome,
 * então icon(id) e sticker(id) leem a mesma peça `ui/<id>`; hoje o único id nos dois conjuntos é `chinelo`
 * (a receita da forja e o item da oferta), que passa a ter uma arte só.
 */
import {artPiece,artUrl} from '../art/manifest.ts';

export const ICON_NAMES=['config','girar','bussola','agulha','aviao','fechar','pronto','relogio','boia','sem-linha','pipoca','saiu',
  'balao','sacola','risada','chamar','suor','dado','coracao','cadeado','voltar','som','mudo','vibrar','sem-vibrar','letra-n',
  // Fora da tela e minimapa (UX-bordas-fora-da-tela, ORQ-minimapa): base, chefe, bichos chegando e baú.
  'base','chefe','onda','bau',
  // Stonewards (VGM-046B): resources, the wall, the return horn and the forge's recipes.
  'coco','pedra','muralha','corneta','fita','chinelo',
  // First-run coach (VGM-056): the joystick (its knob Amarelo, like the stick while the hint shows) and the XP drop.
  'dedao','gota',
  // Dono da sala e bots (D-025): a coroa de papel do chefe e o robô dos bots da sala.
  'robo','coroa',
  // Objetivo do chaveiro (D-047): a moto 125 com a bag, na seta de borda (arte provisória até a arte do usuário).
  'moto'] as const;
export type IconName=typeof ICON_NAMES[number];
/** Tamanhos do adesivo (§2.4): 24, 32 e 48 px; 40 é o do botão de habilidade. */
export type IconSize=24|32|40|48;
export interface IconOptions {size?:IconSize;className?:string;/** Nome para leitor de tela; sem ele o ícone é decorativo. */label?:string}
const escape=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
/** URL of the imported WebP of `ui/<id>` (icons and stickers share the group), or undefined: the SVG sprite stays. */
export function uiArtUrl(id:string):string|undefined{
  const sheet=artPiece('ui',id)?.files.sheet;
  const file=sheet?.file??sheet?.pages?.[0]?.file;
  return file?artUrl('ui',file):undefined;
}
/** The <img> twin of an icon/sticker <svg>: same classes and data-*, decorative unless labelled (then alt + aria-label). */
export function artImg(cls:string,src:string,label:string|undefined,data:string):string{
  const a11y=label?`alt="${escape(label)}" role="img" aria-label="${escape(label)}"`:'alt="" aria-hidden="true"';
  return `<img class="${cls}" src="${escape(src)}" ${a11y} ${data} draggable="false" decoding="async">`;
}
export function icon(name:IconName,options:IconOptions={}):string{
  const size=options.size??24;
  const cls=['ic',size===24?'':`ic-${size}`,options.className??''].filter(Boolean).join(' ');
  const art=uiArtUrl(name);
  if(art)return artImg(cls,art,options.label,`data-icon="${name}"`);
  const a11y=options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 48 48" ${a11y} focusable="false" data-icon="${name}"><use href="#i-${name}"/></svg>`;
}
/**
 * Bússola da vista atual (0..3, 90° cada; o "1 / 4" saiu): a agulha aponta para o norte do mundo nesta vista e o N
 * anda pela borda sempre de pé, como num mapa de papel. Mudou a vista: troque o elemento inteiro (é só markup).
 * Arte v2: com `ui/bussola` E `ui/agulha` importadas, o mesmo <svg> desenha os WebP com <image> (a agulha segue no
 * <g class="ic-agulha"> que gira pelo --vista; o N usa `ui/letra-n` se houver, senão o símbolo); faltando uma, tudo SVG.
 */
export function compass(view:number,options:Omit<IconOptions,'className'>={}):string{
  const size=options.size??24,v=((view%4)+4)%4,angle=v*Math.PI/2;
  const nx=+(Math.sin(angle)*15).toFixed(2),ny=+(-Math.cos(angle)*15).toFixed(2);
  const a11y=options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"';
  const rose=uiArtUrl('bussola'),needle=uiArtUrl('agulha');
  const part=(name:IconName,src:string|undefined,extra='')=>rose&&needle&&src
    ?`<image href="${escape(src)}" width="48" height="48"${extra}/>`:`<use href="#i-${name}"${extra}/>`;
  return `<svg class="ic${size===24?'':` ic-${size}`} ic-bussola" viewBox="0 0 48 48" ${a11y} focusable="false" data-icon="bussola" data-vista="${v}" style="--vista:${v*90}deg">${part('bussola',rose)}<g class="ic-agulha">${part('agulha',needle)}</g>${part('letra-n',uiArtUrl('letra-n'),` transform="translate(${nx} ${ny}) scale(.62)" transform-origin="24 24"`)}</svg>`;
}
