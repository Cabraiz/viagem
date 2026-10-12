/**
 * Map selection in the room (D-026): the owner (D-025) picks Cidade Nevada or the infinite map in the lobby, the
 * welcome carries the chosen map, and clients refuse a map their build does not ship. Pure and self-contained: no
 * imports, never throws, plain JSON in and out. The catalog (real hashes from the importer manifest) is injected.
 */

export const MAP_IDS=['cidade-nevada','infinito'] as const;
export type MapId=typeof MAP_IDS[number];
/** Today's behavior until the lobby selector is wired. */
export const DEFAULT_MAP:MapId='infinito';
/** Maps built by code (no asset bytes): their ref carries hash null. */
const GENERATED:readonly MapId[]=['infinito'];

/** Own-list check, never `in` on an object ('__proto__', 'constructor', 'toString' are not ids). */
export const isMapId=(v:unknown):v is MapId=>typeof v==='string'&&(MAP_IDS as readonly string[]).includes(v);

/** sha256 of the asset bytes, lowercase hex (64 chars). Generated maps (infinito) have no asset: hash null. */
export interface MapRef {id:MapId;version:number;hash:string|null}
/** Injected by the server/client build (real hashes come from the importer manifest). */
export type MapCatalog=ReadonlyMap<MapId,MapRef>;

const HASH=/^[0-9a-f]{64}$/;
const REF_KEYS=['id','version','hash'] as const;
const SET_MAP_KEYS=['t','map'] as const;

/**
 * Own data fields of an object with exactly `keys` (no arrays, getters, symbols, extra or missing keys), read without
 * running any accessor; undefined otherwise. Proxies that throw are caught.
 */
function fields<K extends string>(v:unknown,keys:readonly K[]):Record<K,unknown>|undefined{
  if(typeof v!=='object'||v===null||Array.isArray(v))return undefined;
  try{
    if(Reflect.ownKeys(v).length!==keys.length)return undefined;
    const out=Object.create(null) as Record<K,unknown>;
    for(const key of keys){
      const desc=Object.getOwnPropertyDescriptor(v,key);
      if(!desc||!('value' in desc))return undefined;
      out[key]=desc.value;
    }
    return out;
  }catch{return undefined;}
}

/** A fresh ref from loose values, or undefined: version a safe integer >= 1; asset maps a lowercase sha256, generated maps null. */
function refOf(id:unknown,version:unknown,hash:unknown):MapRef|undefined{
  if(!isMapId(id)||typeof version!=='number'||!Number.isSafeInteger(version)||version<1)return undefined;
  if(GENERATED.includes(id)?hash!==null:typeof hash!=='string'||!HASH.test(hash))return undefined;
  return {id,version,hash:hash as string|null};
}
/**
 * Wire input: exactly {id,version,hash}, each field read once into a fresh copy that is validated and returned, so an
 * object that changes or throws on a second read can neither pass nor crash later comparisons.
 */
export function readMapRef(v:unknown):MapRef|undefined{
  const f=fields(v,REF_KEYS);
  return f?refOf(f.id,f.version,f.hash):undefined;
}
export const isMapRef=(v:unknown):v is MapRef=>readMapRef(v)!==undefined;

/** Same id, version and hash. */
export function sameMap(a:MapRef,b:MapRef):boolean{
  try{return !!a&&!!b&&a.id===b.id&&a.version===b.version&&a.hash===b.hash;}catch{return false;}
}

/** Raw JSON chars of a setMap message; far below the room's 1024 cap. */
export const MAX_SET_MAP_LENGTH=128;
/** Visible texts (pt-BR, phone-sized). */
export const MAP_TEXT={
  ownerOnly:'Só quem criou a sala escolhe o mapa.',
  lobbyOnly:'O mapa só muda antes da partida começar.',
  unknown:'Mapa desconhecido.',
  update:'Atualize a página para jogar neste mapa.',
} as const;

export type RoomPhase='lobby'|'countdown'|'combat'|'result';
export interface SetMapContext {rawLength:number;senderId:string|undefined;ownerId:string|undefined;phase:RoomPhase;current:MapRef;catalog:MapCatalog}
export type SetMapFailure='too-big'|'shape'|'unknown-map'|'not-joined'|'not-owner'|'not-lobby';

/**
 * Catalog entry for an id as a fresh {id,version,hash} copy. The catalog is trusted build data, so extra keys (e.g. a
 * manifest's file name) are fine; an invalid entry or one stored under another id never leaks out.
 */
function lookup(catalog:MapCatalog,id:MapId):MapRef|undefined{
  try{
    const entry=catalog.get(id) as Partial<MapRef>|undefined;
    if(typeof entry!=='object'||entry===null)return undefined;
    const ref=refOf(entry.id,entry.version,entry.hash);
    return ref&&ref.id===id?ref:undefined;
  }catch{return undefined;}
}

const fail=(reason:SetMapFailure,text:string)=>({ok:false as const,reason,text});

/**
 * Message shape: {t:'setMap', map:MapId}. Any other key, wrong type, or extra/missing field -> 'shape'.
 * Order of checks: too-big, shape, unknown-map, not-joined, not-owner, not-lobby. On success `map` is a copy of the
 * catalog entry (never data from the message) and changed=false when it equals the current map (no broadcast needed).
 * rawLength is the received string's length (room.ts already caps frames at 1024). The room must still throttle
 * accepted switches like its other owner commands (OWNER_GAP_MS), since each one resets readies and writes storage.
 */
export function validateSetMap(message:unknown,ctx:SetMapContext):{ok:true;map:MapRef;changed:boolean}|{ok:false;reason:SetMapFailure;text:string}{
  const len=ctx?.rawLength;
  if(typeof len!=='number'||!(len>=0&&len<=MAX_SET_MAP_LENGTH))return fail('too-big',MAP_TEXT.unknown);
  const f=fields(message,SET_MAP_KEYS);
  if(!f||f.t!=='setMap'||typeof f.map!=='string')return fail('shape',MAP_TEXT.unknown);
  const ref=isMapId(f.map)?lookup(ctx.catalog,f.map):undefined;
  if(!ref)return fail('unknown-map',MAP_TEXT.unknown);
  const {senderId,ownerId}=ctx;
  if(typeof senderId!=='string'||!senderId)return fail('not-joined',MAP_TEXT.ownerOnly);
  if(typeof ownerId!=='string'||senderId!==ownerId)return fail('not-owner',MAP_TEXT.ownerOnly);
  if(ctx.phase!=='lobby')return fail('not-lobby',MAP_TEXT.lobbyOnly);
  return {ok:true,map:ref,changed:!sameMap(ref,ctx.current)};
}

/** Welcome field {map:MapRef} next to world: a plain JSON-safe copy. */
export function welcomeMap(ref:MapRef):{id:MapId;version:number;hash:string|null}{
  return {id:ref.id,version:ref.version,hash:ref.hash};
}

/** Client side of the welcome field: strict, a fresh copy on success. */
export function parseWelcomeMap(value:unknown):{ok:true;map:MapRef}|{ok:false;text:string}{
  const map=readMapRef(value);
  return map?{ok:true,map}:{ok:false,text:MAP_TEXT.update};
}

/** Client side: the room's map vs what this build ships. Unknown id, older/newer version or different hash -> refuse. */
export function checkClientMap(room:MapRef,local:MapCatalog):{ok:true}|{ok:false;reason:'unknown-map'|'version'|'hash';text:string}{
  const theirs=readMapRef(room);
  const mine=theirs?lookup(local,theirs.id):undefined;
  if(!theirs||!mine)return {ok:false,reason:'unknown-map',text:MAP_TEXT.update};
  if(mine.version!==theirs.version)return {ok:false,reason:'version',text:MAP_TEXT.update};
  if(mine.hash!==theirs.hash)return {ok:false,reason:'hash',text:MAP_TEXT.update};
  return {ok:true};
}

/**
 * The maps a client ships, sent at join as `maps:[{id,version,hash},...]`: at most one ref per known id, no duplicates.
 * The room keeps the result per player, to check the current map now and every later setMap.
 */
export function parseClientMaps(value:unknown):{ok:true;maps:MapCatalog}|{ok:false;text:string}{
  try{
    if(!Array.isArray(value)||value.length<1||value.length>MAP_IDS.length)return {ok:false,text:MAP_TEXT.update};
    const maps=new Map<MapId,MapRef>();
    for(let i=0;i<value.length;i++){
      const ref=readMapRef(value[i]);
      if(!ref||maps.has(ref.id))return {ok:false,text:MAP_TEXT.update};
      maps.set(ref.id,ref);
    }
    return {ok:true,maps};
  }catch{return {ok:false,text:MAP_TEXT.update};}
}

/**
 * Server side at join: the room's current map must be one the client ships with the same version and hash, so a stale
 * build is refused before it reaches the lobby. Absent `maps` (older client) is accepted with no catalog; the
 * PROTOCOL_VERSION bump that ships this refuses those clients anyway.
 */
export function checkJoinMaps(clientMaps:unknown,room:MapRef):{ok:true;maps:MapCatalog|undefined}|{ok:false;reason:'shape'|'unknown-map'|'version'|'hash';text:string}{
  if(clientMaps===undefined)return {ok:true,maps:undefined};
  const parsed=parseClientMaps(clientMaps);
  if(!parsed.ok)return {ok:false,reason:'shape',text:parsed.text};
  const check=checkClientMap(room,parsed.maps);
  return check.ok?{ok:true,maps:parsed.maps}:check;
}

/**
 * Before applying a setMap: ids of seated players whose build cannot load `map` (no catalog sent, or a different
 * version/hash). The room can refuse the switch or warn the owner; sorted for deterministic messages.
 */
export function playersMissingMap(map:MapRef,players:Iterable<readonly [string,MapCatalog|undefined]>):string[]{
  const out:string[]=[];
  for(const [id,maps] of players)if(!maps||!checkClientMap(map,maps).ok)out.push(id);
  return out.sort();
}
