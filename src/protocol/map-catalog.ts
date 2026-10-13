/**
 * Which maps a room may play and how the lobby offers them (D-035). Shared by the room (multiplayer/) and the client.
 * The city is wired end to end but stays off until it is playable: the director spawns at the avenue tips (cidade-05)
 * and the client draws the city (cidade-03/04). Flipping CITY_PLAYABLE is card cidade-10.
 */
import {DEFAULT_MAP,type MapCatalog,type MapId,type MapRef} from './map-select.ts';

/** D-035: false until cidade-10. Rooms and tests may override it (Room option `cityPlayable`). */
export const CITY_PLAYABLE=true;
/** The generated endless map has no asset bytes, so no hash (map-select GENERATED). */
export const INFINITO_REF:MapRef=Object.freeze({id:'infinito',version:1,hash:null});
/** The lobby default stays the endless map until the city is playable (D-035). */
export const ROOM_DEFAULT_MAP:MapId='cidade-nevada';
/** Refusal shown to an owner who taps the locked city. */
export const CITY_SOON='Em breve: a Cidade Nevada abre quando os bichos aprenderem as avenidas.';

/** The maps a room accepts: always the endless map, plus the city when it is playable and its ref is known. */
export function roomCatalog(city:MapRef|undefined,cityPlayable=CITY_PLAYABLE):MapCatalog{
  const catalog=new Map<MapId,MapRef>([['infinito',INFINITO_REF]]);
  if(cityPlayable&&city&&city.id==='cidade-nevada')catalog.set('cidade-nevada',city);
  return catalog;
}
/** What a client build can load (sent in `join.maps`): the endless map, plus the city when its manifest was read. */
export function clientCatalog(city:MapRef|undefined):MapRef[]{
  return city&&city.id==='cidade-nevada'?[INFINITO_REF,city]:[INFINITO_REF];
}
