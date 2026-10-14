/**
 * Sound settings v2 (NEW-20261014-ORQ-config-audio-musica-efeitos): two buses, "Música" (menu, theme, boss) and "Efeitos"
 * (the procedural sounds), each with its volume and mute, plus the vibration. Pure: parse, migrate, load, save, the mix.
 * - Stored as `viagem:audio:v2`. Missing: read the old `viagem:audio:v1` ({volume, muted, vibration}); both buses keep the
 *   player's level, and the v2 record is written at once. v1 stays where it is (an older tab can still read it).
 * - Every field falls back on its own default: garbage never resets the rest. Storage access never throws.
 */
export type Bus='music'|'effects';
export const BUSES:readonly Bus[]=Object.freeze(['music','effects']);
export interface BusSettings {volume:number;muted:boolean}
export interface AudioSettings {music:BusSettings;effects:BusSettings;vibration:boolean}
export const DEFAULT_VOLUME=.7;
export const DEFAULT_SETTINGS:Readonly<AudioSettings>=Object.freeze({
  music:Object.freeze({volume:DEFAULT_VOLUME,muted:false}),
  effects:Object.freeze({volume:DEFAULT_VOLUME,muted:false}),
  vibration:true,
}) as Readonly<AudioSettings>;
export const SETTINGS_KEY='viagem:audio:v2';
export const LEGACY_SETTINGS_KEY='viagem:audio:v1';
export type StorageLike=Pick<Storage,'getItem'|'setItem'>;

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const clampVolume=(value:unknown,fallback=DEFAULT_VOLUME)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
const bool=(value:unknown,fallback:boolean)=>typeof value==='boolean'?value:fallback;

export const copySettings=(s:Readonly<AudioSettings>):AudioSettings=>({music:{...s.music},effects:{...s.effects},vibration:s.vibration});

function parseBus(value:unknown):BusSettings{
  const bus=isObject(value)?value:{};
  return {volume:clampVolume(bus.volume),muted:bool(bus.muted,false)};
}

/** A v2 record (already JSON-parsed); garbage fields take their defaults. */
export function parseSettingsV2(value:unknown):AudioSettings{
  const saved=isObject(value)?value:{};
  return {music:parseBus(saved.music),effects:parseBus(saved.effects),vibration:bool(saved.vibration,DEFAULT_SETTINGS.vibration)};
}

/** A v1 record ({volume, muted, vibration}): its level and mute go to both buses. */
export function migrateV1(value:unknown):AudioSettings{
  const saved=isObject(value)?value:{};
  const bus=()=>({volume:clampVolume(saved.volume),muted:bool(saved.muted,false)});
  return {music:bus(),effects:bus(),vibration:bool(saved.vibration,DEFAULT_SETTINGS.vibration)};
}

const read=(storage:StorageLike|null|undefined,key:string):string|null=>{try{return storage?.getItem(key)??null;}catch{return null;}};
const json=(raw:string):unknown=>{try{return JSON.parse(raw);}catch{return undefined;}};

export function saveSettings(storage:StorageLike|null|undefined,settings:Readonly<AudioSettings>):boolean{
  try{if(!storage)return false;storage.setItem(SETTINGS_KEY,JSON.stringify(settings));return true;}catch{return false;}
}

/** v2, else v1 migrated (and saved as v2), else the defaults. `from` says which. */
export function loadSettings(storage:StorageLike|null|undefined):{settings:AudioSettings;from:'v2'|'v1'|'default'}{
  const v2=read(storage,SETTINGS_KEY);
  if(v2!==null)return {settings:parseSettingsV2(json(v2)),from:'v2'};
  const v1=read(storage,LEGACY_SETTINGS_KEY);
  if(v1!==null){
    const settings=migrateV1(json(v1));
    saveSettings(storage,settings);
    return {settings,from:'v1'};
  }
  return {settings:copySettings(DEFAULT_SETTINGS),from:'default'};
}

/** A bus's gain: 0 when muted, else volume squared (tracks loudness perception better on a 0..1 slider). */
export const busGain=(bus:Readonly<BusSettings>)=>bus.muted?0:bus.volume*bus.volume;
/** Silent: muted or at 0. */
export const busQuiet=(bus:Readonly<BusSettings>)=>bus.muted||bus.volume<=0;
/** What a music track at `level` (menu .35, theme .25, boss .6) reaches the master with. */
export const trackGain=(level:number,settings:Readonly<AudioSettings>)=>level*busGain(settings.music);

/** "60 %" (the slider's aria-valuetext and its visible number). */
export const percentText=(volume:number)=>`${Math.round(clampVolume(volume,0)*100)} %`;
/** The slider's aria-valuetext: "60 %", or "60 %, sem som" while that bus is muted. */
export const volumeValueText=(bus:Readonly<BusSettings>)=>bus.muted?`${percentText(bus.volume)}, sem som`:percentText(bus.volume);
export const BUS_LABELS:Readonly<Record<Bus,string>>=Object.freeze({music:'Música',effects:'Efeitos'});
