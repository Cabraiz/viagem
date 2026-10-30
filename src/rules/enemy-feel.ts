/**
 * A read of its own for the clones (NEW-20261029-ORQ-inimigos-variedade H; evidence/auditoria-inimigos-29-10.md §4):
 * the corredores, enxames and palhaços with art all walk on their role's numbers, so they only differ in the art. Each
 * one here gets a feel on top of its role (sim/enemies/catalog.ts rosterDef): faster and frailer, slower and sturdier,
 * a wider sway or a straighter line. speed × hp stays about 1, so the director's threat per role still holds.
 * Hand-written (enemy-roster.ts is generated); the legacy bêbado, pombos and Tio do Pavê stay the baseline.
 */
import type {EnemyRole} from './enemy-roles.ts';

/** Multipliers on the role-built def; `sway` scales the zig-zag (amp × sway, freq × √sway), stagger and swarm only. */
export interface EnemyFeel {readonly speed:number;readonly hp:number;readonly radius:number;readonly sway:number}
export const FEELS=Object.freeze({
  rapido:Object.freeze({speed:1.25,hp:.8,radius:.9,sway:1}),
  tanque:Object.freeze({speed:.8,hp:1.25,radius:1.15,sway:1}),
  zigue:Object.freeze({speed:1.05,hp:.95,radius:1,sway:1.8}),
  reto:Object.freeze({speed:1.1,hp:.9,radius:1,sway:.3}),
}) satisfies Readonly<Record<string,EnemyFeel>>;
export type FeelId=keyof typeof FEELS;
/** The roles that have clones; `zigue` and `reto` only change something on the ones that sway. */
export const FEEL_ROLES=['corredor','enxame','palhaco'] as const satisfies readonly EnemyRole[];

export const ENEMY_FEEL:Readonly<Record<string,FeelId>>=Object.freeze({
  // corredores (base: bêbado)
  'estagiario-imortal':'rapido','ressaca-ambulante':'zigue','furry-de-convencao':'tanque',
  // enxames (base: pombos)
  'cachorro-de-madame':'rapido','boleto-vivo':'tanque','rato-de-boteco':'zigue','bot-de-curtida':'reto',
  // palhaços (base: Tio do Pavê; no sway, the joke and the charge read the speed)
  'bebado-do-karaoke':'tanque','chefe-pizza':'tanque','cliente-do-gerente':'rapido','cunhado-sabe-tudo':'rapido',
  quadrilheiro:'rapido',
});
/** The feel of a roster id, if it has one. */
export const enemyFeel=(kind:string):EnemyFeel|undefined=>Object.hasOwn(ENEMY_FEEL,kind)?FEELS[ENEMY_FEEL[kind]!]:undefined;
