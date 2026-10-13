/**
 * Quick emotes (VGM-053A, emote-relay-sala): the ids and the cooldown shared by the room (relay, anti-spam) and the
 * client (the bar, the balloons, the laughing face). Pure, no DOM, so the Worker can import it.
 */
export const EMOTE_IDS=Object.freeze(['kkkk','salva','vem','foimal'] as const);
export type EmoteId=typeof EMOTE_IDS[number];
export const isEmoteId=(value:unknown):value is EmoteId=>typeof value==='string'&&(EMOTE_IDS as readonly string[]).includes(value);
/** One emote per player every 2 s, on the bar and in the room. */
export const EMOTE_COOLDOWN_MS=2000;
/** The room's gate is this much shorter than the bar's (network jitter between two honest taps, like the sos). */
export const EMOTE_SLACK_MS=300;
