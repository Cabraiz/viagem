/**
 * cadeado-so-clt-viciado (the user, 22/10, "por questões de logística"; the maromba released 23/10, the vendedor and the aposentado 24/10): a person may only play these heroes.
 * herois-legados-escondidos (29/10): they are the playable classes themselves (classes.ts PLAYABLE_CLASS_IDS, one list,
 * not two); every other class is a hidden legacy, so the menu no longer shows any locked hero. The menu, index.html's
 * preload and the room (multiplayer/room.ts humanClass) read it.
 */
import { getClass, PLAYABLE_CLASS_IDS, type HeroClass } from './classes.ts';

export const PERSONAGENS_LIBERADOS: readonly string[] = PLAYABLE_CLASS_IDS;
/** Where the menu opens, and what a locked, hidden or unknown class becomes for a person. */
export const PERSONAGEM_PADRAO = PERSONAGENS_LIBERADOS[0];
export const isLiberado = (id: unknown): id is string => typeof id === 'string' && PERSONAGENS_LIBERADOS.includes(id);
/** `id` when a person may play it; otherwise the default (viciado). */
export const liberadoId = (id: unknown): string => isLiberado(id) ? id : PERSONAGEM_PADRAO;
export const heroiPadrao = (): HeroClass => getClass(PERSONAGEM_PADRAO)!;
