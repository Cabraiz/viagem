/**
 * cadeado-so-clt-viciado (the user, 22/10, "por questões de logística"; the maromba released 23/10): a person may only play these heroes; every other
 * playable one shows in the menu with a lock and cannot be confirmed. Room bots still draw from all the playable classes
 * (classes.ts PLAYABLE_CLASS_IDS): the lock is for people only. The one list: the menu, index.html's preload and the
 * room (multiplayer/room.ts humanClass) read it.
 */
import { getClass, type HeroClass } from './classes.ts';

export const PERSONAGENS_LIBERADOS: readonly string[] = Object.freeze(['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba']);
/** Where the menu opens, and what a locked, hidden or unknown class becomes for a person. */
export const PERSONAGEM_PADRAO = PERSONAGENS_LIBERADOS[0];
export const isLiberado = (id: unknown): id is string => typeof id === 'string' && PERSONAGENS_LIBERADOS.includes(id);
/** `id` when a person may play it; otherwise the default (viciado). */
export const liberadoId = (id: unknown): string => isLiberado(id) ? id : PERSONAGEM_PADRAO;
export const heroiPadrao = (): HeroClass => getClass(PERSONAGEM_PADRAO)!;
