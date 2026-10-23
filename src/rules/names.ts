/** Player names as the HUD shows them, shared with the room's bots (multiplayer/room-bots.ts names them the same way). */
/** Longest first word the team rail shows whole (NEW-20261009-N5-resultado-nomes-longos: "Concurseira", "Washington"). */
export const RAIL_MAX=11;
/** Letters kept before the dot when the first word is longer ("Constantino" fits; "Maximilianos" is "Maximil."). */
export const RAIL_CUT=7;
/**
 * The team rail's short name: the first word, whole up to RAIL_MAX letters, else RAIL_CUT letters and a dot, so a
 * name is never cut mid-word without a mark ("Concursei" was "Concurseira"). The same player has one name on the
 * rail and on the map. A last word of one digit stays (bot-nome-do-personagem: "CLT 2", "Viciado em Bet 2" is
 * "Viciado 2"), and the first word then gives it room (RAIL_MAX in all: "Concurseira 2" is "Concurs. 2").
 */
export const railName=(name:string)=>{
  const words=name.trim().split(/\s+/),num=words.length>1&&/^\d$/.test(words.at(-1)!)?` ${words.at(-1)}`:'';
  const word=[...(words[0]??'')],max=RAIL_MAX-num.length;
  return (word.length<=max?word.join(''):`${word.slice(0,Math.min(RAIL_CUT,max-1)).join('')}.`)+num;
};
