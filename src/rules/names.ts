/** Player names as the HUD shows them, shared with the room's bots (multiplayer/room-bots.ts names them the same way). */
/** Longest first word the team rail shows whole (NEW-20261009-N5-resultado-nomes-longos: "Concurseira", "Washington"). */
export const RAIL_MAX=11;
/** Letters kept before the dot when the first word is longer ("Constantino" fits; "Maximilianos" is "Maximil."). */
export const RAIL_CUT=7;
/**
 * The team rail's short name: the first word, whole up to RAIL_MAX letters, else RAIL_CUT letters and a dot, so a
 * name is never cut mid-word without a mark ("Concursei" was "Concurseira"). The same player has one name on the
 * rail and on the map.
 */
export const railName=(name:string)=>{
  const word=[...(name.trim().split(/\s+/)[0]??'')];
  return word.length<=RAIL_MAX?word.join(''):`${word.slice(0,RAIL_CUT).join('')}.`;
};
