/**
 * The row's faces (NEW-20261023-ORQ-selecao-miniatura-rosto, the user 23/10: "sabe onde tem o '?'? Seria thumbnail do
 * rosto com background dos personagens"): a released hero's tile in the stadium's row (PC and the phone on its side)
 * shows his face over his own screen's background, the same picture as his Instagram profile photo (ui/insta.ts), cut
 * small by scripts/miniatura-rosto.mjs. A locked hero keeps the "?" under the lock: his face never downloads, even when
 * the file exists (the maromba's waits for him to be released). Pure over strings (node tests, no DOM).
 */
/** The heroes with a face file (public/art/menu/rosto/<id>.webp and its lite copy). */
export const ROSTOS:ReadonlySet<string>=new Set(['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado']);
export const rostoUrl=(id:string)=>`/art/lite/menu/rosto/${id}.webp`;
/** The face a tile shows: only a released hero's, and only when he has one. */
export const miniaturaOf=(id:string,liberado:boolean):string|undefined=>liberado&&ROSTOS.has(id)?rostoUrl(id):undefined;
