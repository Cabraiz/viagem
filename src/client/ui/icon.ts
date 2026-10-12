/**
 * Ícones-adesivo de sistema e status (NEW-20261009-DSG-icones-sistema): `icon('boia')` devolve o HTML de um
 * <svg><use href="#i-boia"/></svg>. O sprite (src/client/ui/icons.svg) entra no DOM uma vez por icon-sprite.ts; este módulo
 * não importa o SVG, para os testes do HUD rodarem no node.
 */
export const ICON_NAMES=['config','girar','bussola','agulha','aviao','fechar','pronto','relogio','boia','sem-linha','pipoca','saiu',
  'balao','sacola','risada','chamar','suor','dado','coracao','cadeado','voltar','som','mudo','vibrar','sem-vibrar','letra-n',
  // Fora da tela e minimapa (UX-bordas-fora-da-tela, ORQ-minimapa): base, chefe, bichos chegando e baú.
  'base','chefe','onda','bau',
  // Stonewards (VGM-046B): resources, the wall, the return horn and the forge's recipes.
  'coco','pedra','muralha','corneta','fita','chinelo',
  // First-run coach (VGM-056): the joystick (its knob Amarelo, like the stick while the hint shows) and the XP drop.
  'dedao','gota',
  // Dono da sala e bots (D-025): a coroa de papel do chefe e o robô dos bots da sala.
  'robo','coroa'] as const;
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
/**
 * Bússola da vista atual (0..3, 90° cada; o "1 / 4" saiu): a agulha aponta para o norte do mundo nesta vista e o N
 * anda pela borda sempre de pé, como num mapa de papel. Mudou a vista: troque o elemento inteiro (é só markup).
 */
export function compass(view:number,options:Omit<IconOptions,'className'>={}):string{
  const size=options.size??24,v=((view%4)+4)%4,angle=v*Math.PI/2;
  const nx=+(Math.sin(angle)*15).toFixed(2),ny=+(-Math.cos(angle)*15).toFixed(2);
  const a11y=options.label?`role="img" aria-label="${escape(options.label)}"`:'aria-hidden="true"';
  return `<svg class="ic${size===24?'':` ic-${size}`} ic-bussola" viewBox="0 0 48 48" ${a11y} focusable="false" data-icon="bussola" data-vista="${v}" style="--vista:${v*90}deg"><use href="#i-bussola"/><g class="ic-agulha"><use href="#i-agulha"/></g><use href="#i-letra-n" transform="translate(${nx} ${ny}) scale(.62)" transform-origin="24 24"/></svg>`;
}
