/**
 * Sim events -> sounds (VGM-050; the files of NEW-20261022-ORQ-sons-ia-ace-step). Client integration (VGM-043) feeds
 * RunView.events here (hud/rescue.ts, once per authoritative view). Only the local player's own hits, shots, kills and
 * pickups make noise; team moments (falls, rescues, boss, rounds) play for everyone.
 * NEW-20261028-ORQ-sons-da-partida-ligados: each event is a cue (sound, level, pitch): the hits and the kill's plop
 * vary in pitch by target, a crit lands lower and louder, an elite's death is a smaller chefe-morte, and the team
 * hears a rescue quietly while the rescuer hears it full.
 */
import type {SimEvent} from '../../contract/index.ts';
import type {SoundId} from './types.ts';
import {WAVE_BOSS_IDS} from '../../rules/index.ts';
import {GemCombo} from './recipes.ts';

/**
 * Pack 12's weapons (sim/weapons/pack12.ts, which the client may not import) by type: the type's sound. The melee ones
 * slash like the faca; types without a take of their own borrow the nearest (tests/client/sons-ia.test.ts checks every
 * Pack 12 id and every arsenal and catalog weapon has a sound).
 */
const PACK12_TYPE_SOUND:Readonly<Record<string,SoundId>>={
  tiro:'p12-tiro',leque:'p12-leque',orbita:'p12-orbita',ricochete:'p12-ricochete',bumerangue:'p12-bumerangue',
  teleguiado:'p12-teleguiado',lancado:'p12-lancado',mina:'p12-mina',torreta:'p12-torreta',aura:'p12-aura',nuvem:'p12-nuvem',
  'corpo-a-corpo':'faca',armadilha:'p12-mina',onda:'p12-aura',feixe:'p12-tiro',mascote:'pombo',corrente:'p12-ricochete',
  investida:'empurrar',vortice:'p12-orbita',ceu:'p12-teleguiado',
};
export const PACK12_TYPES:Readonly<Record<string,string>>={
  baladeira:'tiro',espeto:'tiro',sacole:'tiro','tampa-voadora':'bumerangue',pandeiro:'orbita','colher-de-pau':'corpo-a-corpo',
  peixeira:'corpo-a-corpo','bola-murcha':'ricochete',traque:'lancado',buscape:'teleguiado',figa:'orbita','vela-esoterica':'orbita',
  facao:'corpo-a-corpo','sal-grosso':'armadilha','tijolo-baiano':'lancado','taro-vencido':'leque','nuvem-de-incenso':'nuvem',
  corneta:'onda',mangueira:'feixe','galho-de-arruda':'aura','pes-do-curupira':'armadilha','panela-de-pressao':'mina',
  'carro-de-som':'torreta','vira-lata':'mascote',ventilador:'aura','fogo-boitata':'corrente','olho-grego':'feixe',
  'uivo-do-lobisomem':'onda','mula-sem-cabeca':'investida',papagaio:'mascote','gorro-do-saci':'vortice','canto-da-iara':'aura',
  'bola-de-cristal':'ceu','cristal-quantico':'corrente',
};
/** Weapons with a take of their own: the manual arsenal (NEW_WEAPONS) and the automatic game's class weapons. */
const OWN_WEAPON_SOUND:ReadonlySet<string>=new Set(['faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao',
  'chinelo','boleto','cafe','guarda-chuva','pombo','audio']);

/**
 * The sound of a weapon's shot: its own take, its Pack 12 type's, or the pistol's (DEFAULT_NOISE's weapon). An
 * evolution (`-evo`) or a legendary (`-lendario`) sounds like the weapon it comes from; a class skill has none.
 */
export function weaponSound(weapon:string):SoundId|undefined{
  if(weapon.startsWith('skill:'))return undefined;
  const base=weapon.replace(/(-evo|-lendario)+$/,'');
  if(OWN_WEAPON_SOUND.has(base))return base as SoundId;
  const type=PACK12_TYPES[base];
  if(type)return PACK12_TYPE_SOUND[type];
  if(base.startsWith('torre-'))return undefined;
  return 'pistola';
}
const MELEE:ReadonlySet<string>=new Set(['faca','peixeira','facao','colher-de-pau']);
// The chefão of the 1st wave (boss-fim-onda-1) is a roster chefe: his kind is his roster id.
const isBoss=(kind:string)=>kind==='chefe'||kind.startsWith('chefe-')||WAVE_BOSS_IDS.includes(kind);
/** A crate's rarity (1 verde .. 5 lendária, contract PickupKind) to its chest's sound. */
export function chestSound(rarity:number):SoundId{
  return rarity>=5?'bau-lendario':rarity>=4?'bau-epico':rarity>=2?'bau-raro':'bau-comum';
}

/** A sound and how to play it: its level (1 = the file's) and its pitch (playback rate, files only). */
export interface EventCue {id:SoundId;gain?:number;rate?:number}
/** The hit's four pitches, drawn by the target (the same critter always sounds the same, the crowd varies). */
export const HIT_RATES:readonly number[]=[.9,.97,1.04,1.12];
/** A crit: lower and louder than any plain hit. */
export const CRIT_CUE={rate:.8,gain:1.25} as const;
/** The kill's plop, a little apart by critter. */
export const KILL_RATES:readonly number[]=[.94,1,1.07];
/** An elite's death: the chefe's, smaller and higher (it is never throttled, so a crowd of plops never eats it). */
export const ELITE_DEATH={rate:1.2,gain:.55} as const;
/** The team hears a rescue this low; the rescuer full (the rescued stands up with 'levantar'). */
export const TEAM_RESCUE_GAIN=.4;
/** A string's stable bucket in [0, n) (FNV-1a). */
export function bucket(id:string,n:number):number{
  let h=0x811c9dc5;
  for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),0x01000193);
  return (h>>>0)%n;
}

/**
 * The cue of one event for the local player, or undefined when it is silent for them. `elite` tells an elite enemy
 * by id (the kill event carries only the kind; the feed still holds the body on the kill's tick).
 */
export function cueForEvent(event:SimEvent,localPlayer?:string,elite?:(enemy:string)=>boolean):EventCue|undefined{
  const mine=(id:string|undefined)=>localPlayer!==undefined&&id===localPlayer;
  switch(event.type){
    case 'damage':{
      if(mine(event.target))return {id:'dano-heroi'};
      if(!mine(event.source))return undefined;
      // A slash lands with a thwack; a shot with the critter's splat.
      const id:SoundId=event.weapon&&MELEE.has(event.weapon.replace(/(-evo|-lendario)+$/,''))?'golpe':'bicho-acerto';
      return event.crit?{id,...CRIT_CUE}:{id,rate:HIT_RATES[bucket(event.target,HIT_RATES.length)]};
    }
    case 'kill':
      if(isBoss(event.kind))return {id:'chefe-morte'};
      if(!mine(event.by))return undefined;
      if(elite?.(event.enemy))return {id:'chefe-morte',...ELITE_DEATH};
      return {id:'bicho-morte',rate:KILL_RATES[bucket(event.enemy,KILL_RATES.length)]};
    case 'revived':
      if(mine(event.player))return {id:'levantar'};
      return mine(event.by)?{id:'resgate'}:{id:'resgate',gain:TEAM_RESCUE_GAIN};
    default:{const id=soundForEvent(event,localPlayer);return id?{id}:undefined;}
  }
}

export function soundForEvent(event:SimEvent,localPlayer?:string):SoundId|undefined{
  const mine=(id:string|undefined)=>localPlayer!==undefined&&id===localPlayer;
  switch(event.type){
    case 'damage':case 'kill':case 'revived':return cueForEvent(event,localPlayer)?.id;
    case 'fire':return mine(event.player)?weaponSound(event.weapon):undefined;
    case 'pickup':
      if(!mine(event.player))return undefined;
      switch(event.kind){
        case 'chest':return chestSound(event.value);
        case 'heal':return 'coxinha';
        // Zueira: a vehicle honks like a clown car.
        case 'vehicle':return 'buzina';
        case 'item':return 'ui-carta';
        // The kill's cédula (NEW-20261024-ORQ-tirar-drops-cedula-girando) and the resources clink like coins.
        default:return 'gema';
      }
    case 'levelup':return 'nivel';
    case 'upgrade':case 'evolve':return mine(event.player)?'upgrade':undefined;
    case 'skill':return mine(event.player)?'boing':undefined;
    // The level-up's cards are dealt.
    case 'offer':return mine(event.player)?'ui-carta':undefined;
    // The fall whistle once, for everyone, at the fall; the caído's "Me salva" later is the 'sos' ping (hud/rescue.ts).
    case 'downed':return 'queda';
    // Being eliminated earns a canned laugh from the studio audience.
    case 'eliminated':return 'risada';
    case 'boss-phase':return 'chefe';
    // uno-atravessa-tralha: a square of the map's tralha (ids tralha*) broken, run over by the Uno: a short thwack.
    case 'structure':return event.hp===0&&event.id.startsWith('tralha')?'golpe':undefined;
    // The intermission's end ("Fim do recreio!", sim/stonewards): the Uno honks (card som-alarme-gema-e-chefe).
    case 'horn':return 'buzina';
    // 'prepare' also opens the run (before round 1) and shares a tick with 'end', so only 'end' gets the ta-dá.
    case 'round':return event.phase==='wave'?'round-inicio':event.phase==='end'?'round-fim':undefined;
    default:return undefined;
  }
}

/** The local player's gem combo, shared by the room's pickups (playEvents) and the cédula caught on screen (hud/rescue.ts). */
export const GEMS=new GemCombo();
/** The gem combo and its clock (ms); tests pass their own. */
export interface GemClock {gems:GemCombo;now:()=>number}

/**
 * Plays every mapped event; per-sound throttling in the engine keeps hit storms in check. Returns sounds played.
 * `heard`: an event whose sound already played on the client (a cédula caught on screen, render/cedula-catch.ts).
 * `elite`: an elite enemy by id (cueForEvent).
 * Each of my gems climbs the combo's pitch (recipes.ts GemCombo); a heard one already did.
 */
export function playEvents(audio:{play(id:SoundId,opts?:{gain?:number;rate?:number}):boolean},events:Iterable<SimEvent>,localPlayer?:string,
  heard?:(event:SimEvent)=>boolean,elite?:(enemy:string)=>boolean,clock:GemClock={gems:GEMS,now:()=>performance.now()}):number{
  let played=0;
  for(const event of events){
    const cue=cueForEvent(event,localPlayer,elite);
    if(!cue||heard?.(event))continue;
    if(cue.id==='gema')cue.rate=clock.gems.next(clock.now());
    const {id,...opts}=cue;
    if(audio.play(id,opts))played++;
  }
  return played;
}
