/**
 * Ícones-adesivo de sistema e status (NEW-20261009-DSG-icones-sistema): `icon('boia')` devolve o HTML de um
 * <svg><use href="#i-boia"/></svg>. O sprite (src/ui/icons.svg) entra no DOM uma vez por icon-sprite.ts; este módulo
 * não importa o SVG, para os testes do HUD rodarem no node.
 */
export const ICON_NAMES=['config','girar','bussola','agulha','aviao','fechar','pronto','relogio','boia','orelhao','pipoca','curativo',
  'balao','sacola','dado','coracao','cadeado','voltar','som','mudo','vibrar','sem-vibrar'] as const;
export type IconName=typeof ICON_NAMES[number];
/** Tamanhos do adesivo (§2.4): 24, 32 e 48 px; 40 é o do botão de habilidade. */
export type IconSize=24|32|40|48;
export interface IconOptions {size?:IconSize;className?:string;/** Nome para leitor de tela; sem ele o ícone é decorativo. */label?:string}
const escape=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
export function icon(name:IconName,options:IconOptions={}):string{
  const size=options.size??24;
  const cls=['ic',size===24?'':`ic-${size}`,options.className??''].filter(Boolean).join(' ');
  const a11y=options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 48 48" ${a11y} focusable="false" data-icon="${name}"><use href="#i-${name}"/></svg>`;
}
/** Bússola da vista atual (0..3, 90° cada): a agulha aponta para onde a câmera olha (o "1 / 4" saiu). */
export function compass(view:number,options:Omit<IconOptions,'className'>={}):string{
  const size=options.size??24;
  return `<svg class="ic${size===24?'':` ic-${size}`} ic-bussola" viewBox="0 0 48 48" ${options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"'} focusable="false" data-icon="bussola" style="--vista:${(((view%4)+4)%4)*90}deg"><use href="#i-bussola"/><g class="ic-agulha"><use href="#i-agulha"/></g></svg>`;
}
