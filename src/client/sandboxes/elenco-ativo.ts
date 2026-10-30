/**
 * `?sandbox=horda&elenco=1` with today's cast (NEW-20261029-E3-sandbox-elenco-ativo): the liberated enemies
 * (rules/inimigos-liberados.ts, in that order) standing around the first player, each with its own telegraph, the
 * default hero (PERSONAGEM_PADRAO) and, with `aliado=1`, a second liberated hero beside him. The old D-033 line-up
 * (coach, influencer, motoboy, agiota and the "DEVENDO" boletos) stays behind `elenco=legado`.
 * Pure (no Phaser, no location) so node tests can pin it to the lists.
 */
import {ELITE_ONLY,INIMIGOS_LIBERADOS,PERSONAGENS_LIBERADOS} from '../../rules/index.ts';
import type {TelegraphKind,TelegraphView} from '../../contract/index.ts';

export type ElencoMode='ativo'|'legado';
/** `elenco=1` → today's cast, `elenco=legado` → the D-033 line-up, anything else → the stress run. */
export const elencoMode=(param:string|null):ElencoMode|undefined=>param==='1'?'ativo':param==='legado'?'legado':undefined;

/**
 * Each enemy's warning, a copy of the sim's (the client never imports the sim): [kind, shape, radius, width, fire
 * delay in ticks]. Circles are the move's radius plus about his body's. Mendigo: a corredor, the bêbado's burp cone
 * (sim/enemies/catalog.ts BURP); saci: the mini-chefe's stomp (SLAM 1.6 + body); sanfoneiro: the bellows hit (FOLE 1 +
 * body, sim/enemies/sanfoneiro.ts), ready for when he joins INIMIGOS_LIBERADOS.
 */
export const AVISO:Readonly<Record<string,readonly [TelegraphKind,TelegraphView['shape'],number,number|undefined,number]>>={
  mendigo:['arroto','cone',2.5,Math.PI/2,70],
  'aberracao-saci':['pancada','circle',2.2,undefined,85],
  sanfoneiro:['pancada','circle',1.6,undefined,75],
};

/** Screen offsets (world px at view 0, x right, y down) of each slot's feet from the first player's, so 3 fit a phone. */
const SLOTS:readonly (readonly [number,number])[]=[[175,25],[0,-215],[-190,-110],[205,-150]];

export type ElencoSlot={id:string;elite:boolean;sx:number;sy:number};
/** The line-up: one slot per liberated enemy, in INIMIGOS_LIBERADOS order; the elite-only ones (the saci) are elite. */
export const elencoAtivo=():ElencoSlot[]=>INIMIGOS_LIBERADOS.map((id,i)=>{
  const [sx,sy]=SLOTS[i%SLOTS.length];
  return {id,elite:ELITE_ONLY.includes(id),sx,sy};
});
/** Where `aliado=1` puts the second hero (screen offset from the first player). */
export const ALIADO_SLOT=[-95,15] as const;
/** The fake players' heroes: the liberated ones from PERSONAGEM_PADRAO on (player i wears the i-th). */
export const heroiDoJogador=(i:number):string=>PERSONAGENS_LIBERADOS[i%PERSONAGENS_LIBERADOS.length];
