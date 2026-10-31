/**
 * Playing-card suit per class role (NEW-20261013-ORQ-classes-cartas-e-nomes): ♠ Linha de frente, ♦ Dano, ♥ Suporte,
 * ♣ Controle. Drawn as inline SVG, never the text glyph, so every phone shows the same shape (the glyphs vary by font
 * and some fonts draw them as emoji). Colors come from CSS (.suit-*), so only tokens paint them.
 */
export type SuitRole='Linha de frente'|'Dano'|'Suporte'|'Controle';
const PATHS:Record<SuitRole,{name:string;cls:string;d:string}>={
  'Linha de frente':{name:'espadas',cls:'suit-espadas',d:'M12 2.5C9.2 6.3 4.5 9 4.5 13.2a3.9 3.9 0 0 0 6.6 2.9V18l-2 3.5h5.8l-2-3.5v-1.9a3.9 3.9 0 0 0 6.6-2.9C19.5 9 14.8 6.3 12 2.5z'},
  Dano:{name:'ouros',cls:'suit-ouros',d:'M12 2.5l6.6 9.5L12 21.5 5.4 12z'},
  Suporte:{name:'copas',cls:'suit-copas',d:'M12 20.5s-8-5-8-10.6a4.3 4.3 0 0 1 8-2.4 4.3 4.3 0 0 1 8 2.4c0 5.6-8 10.6-8 10.6z'},
  Controle:{name:'paus',cls:'suit-paus',d:'M12 3a3.5 3.5 0 0 1 3.1 5.2 3.5 3.5 0 1 1-2.3 6.3V18l2 3.5H9.2l2-3.5v-3.5a3.5 3.5 0 1 1-2.3-6.3A3.5 3.5 0 0 1 12 3z'},
};
export const isSuitRole=(role:string):role is SuitRole=>Object.hasOwn(PATHS,role);
/** The suit's SVG; decorative by default (the role name is on screen or in the label next to it). */
export function suit(role:string,options:{label?:boolean}={}):string{
  if(!isSuitRole(role))return '';
  const p=PATHS[role];
  const a11y=options.label?`role="img" aria-label="${role}"`:'aria-hidden="true"';
  return `<svg class="suit ${p.cls}" viewBox="0 0 24 24" ${a11y} focusable="false"><path d="${p.d}"/></svg>`;
}
/** What each role does, in a few words (menu-diz-o-jogo-e-convite #9): the chosen hero's badge says it, as its title
 *  and in a line under it. */
export const ROLE_LINE:Readonly<Record<SuitRole,string>>=Object.freeze({
  'Linha de frente':'Aguenta pancada pela turma.',
  Dano:'Bate forte, aguenta pouco.',
  Suporte:'Cura e ajuda a turma.',
  Controle:'Segura e atrapalha os bichos.',
});
