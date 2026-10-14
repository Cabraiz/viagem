/**
 * Minimap pings (card NEW-20261013-ORQ-minimapa-wc3), shared by the room and the client: a tap on the minimap marks a world point for the whole team. It
 * rides the emote relay as the id 'marca' with x and y, tolerant both ways without a protocol bump: an old room drops the
 * unknown id (no relay, the ping stays local), an old client drops the relayed 'marca' (not an emote id it knows).
 * The room relays {t:'emote',player,id:'marca',round,x,y} at most once per MARK_COOLDOWN_MS per player.
 */
export const MARK_ID='marca';
export const MARK_COOLDOWN_MS=900;
/** World units: a mark beyond this from the origin is refused (no real map is this large). */
export const MARK_LIMIT=10_000;
export interface MarkNote {player:string;x:number;y:number}

const coord=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=MARK_LIMIT;
/** The mark of a relayed message, or null (anything else, malformed, or an old room's plain emote). */
export function parseMark(m:unknown):MarkNote|null{
  if(m===null||typeof m!=='object')return null;
  const {t,player,id,x,y}=m as Record<string,unknown>;
  if(t!=='emote'||id!==MARK_ID||typeof player!=='string'||player.length===0||player.length>64||!coord(x)||!coord(y))return null;
  return {player,x:x as number,y:y as number};
}
/** What the room relays for a mark it accepts (2 decimals: centimetres are plenty), or null to drop the message. */
export function relayMark(m:{x?:unknown;y?:unknown}):{x:number;y:number}|null{
  if(!coord(m.x)||!coord(m.y))return null;
  return {x:Math.round((m.x as number)*100)/100,y:Math.round((m.y as number)*100)/100};
}
