// Player names (NEW-20261009-N5-resultado-nomes-longos): the rooms take at most NAME_MAX characters (multiplayer/room.ts
// join), and a longer name used to be cut mid-word ("Concurseira Eterna d"). Pure and import-free: main.ts reads it
// statically.

/** Longest name a room accepts (multiplayer/room.ts rejects more). */
export const NAME_MAX=20;

/**
 * The name as the room will show it: spaces tidied, and a longer one cut at the last whole word with an ellipsis
 * ("Concurseira Eterna da Silva" → "Concurseira Eterna…"). A first word too long, or one that would leave little, is
 * cut inside it, but always marked with the ellipsis. Never longer than `max`.
 */
export function fitName(raw:string,max=NAME_MAX){
  const t=raw.trim().replace(/\s+/g,' ');
  if(t.length<=max)return t;
  const room=max-1,space=t.lastIndexOf(' ',room);
  let head=space>=room/2?t.slice(0,space):t.slice(0,room);
  // Never half an emoji (a lone high surrogate), nor a dangling comma or dash before the ellipsis.
  if(/[\uD800-\uDBFF]$/.test(head))head=head.slice(0,-1);
  return `${head.replace(/[\s,.;:\-–—]+$/,'')}…`;
}
