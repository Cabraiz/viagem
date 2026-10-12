/** Player names as the HUD shows them, shared with the room's bots (multiplayer/room-bots.ts names them the same way). */
/** The team rail's short name (first word, up to 9 letters): the same player has one name on the rail and on the map. */
export const railName=(name:string)=>[...(name.trim().split(/\s+/)[0]??'')].slice(0,9).join('');
