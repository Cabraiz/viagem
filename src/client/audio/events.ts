/**
 * Sim events -> sounds (VGM-050; the files of NEW-20261022-ORQ-sons-ia-ace-step). Client integration (VGM-043) feeds
 * RunView.events here (hud/rescue.ts, once per authoritative view). Only the local player's own hits, shots, kills and
 * pickups make noise; team moments (falls, rescues, boss, rounds) play for everyone.
 * NEW-20261028-ORQ-sons-da-partida-ligados: each event is a cue (sound, level, pitch): the hits and the kill's plop
 * vary in pitch by target, a crit lands lower and louder, an elite's death is a smaller chefe-morte, and the team
 * hears a rescue quietly while the rescuer hears it full.
 * NEW-20261029-ORQ-som-eventos-que-faltam (auditoria de som, itens 15, 16, 19 e 24, only files that already exist): a hit
 * on the boss or an elite lands with chefe-acerto, the rescued hero gets up ('levantar' with the 'ufa'), a danger warning
 * (horde about to spawn, an attack telegraphed) thumps low from its side of the screen, and a barricade, the wall or the
 * Uno breaking lands a heavy golpe. The 'wave' event the audit asked for (item 20) is never emitted by the sim.
 */
import {CAR_ID,type SimEvent} from '../../contract/index.ts';
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

/**
 * A sound and how to play it: its level (1 = the file's), its pitch (playback rate, files only), its side (-1..1) and
 * a second sound played with it.
 */
export interface EventCue {id:SoundId;gain?:number;rate?:number;pan?:number;with?:EventCue}
/** The hit's four pitches, drawn by the target (the same critter always sounds the same, the crowd varies). */
export const HIT_RATES:readonly number[]=[.9,.97,1.04,1.12];
/** A crit: lower and louder than any plain hit. */
export const CRIT_CUE={rate:.8,gain:1.25} as const;
/** The kill's plop, a little apart by critter. */
export const KILL_RATES:readonly number[]=[.94,1,1.07];
/** An elite's death: the chefe's, smaller and higher (it is never throttled, so a crowd of plops never eats it). */
export const ELITE_DEATH={rate:1.2,gain:.55} as const;
/** The team hears a rescue this low; the rescuer full (the rescued sighs 'ufa', NEW-20261029-ORQ-som-golpe-e-resgate). */
export const TEAM_RESCUE_GAIN=.4;
/** The rescued hero gets up: 'levantar' under the 'ufa'. */
export const GET_UP_CUE={id:'levantar'} as const;
/** A barricade, the wall or the Uno breaking: the golpe, lower and heavier than the tralha's. */
export const BREAK_CUE={id:'golpe',rate:.7,gain:1.2} as const;
/** The danger warning: the boss's step, slowed to a low thump (a horde lower than an attack). */
export const WARN_SPAWN_RATE=.7,WARN_ATTACK_RATE=.85;
/** One warning per this many ms (a wave's spawns come in bursts); none past WARN_RANGE tiles, fading over WARN_FALLOFF. */
export const WARN_MS=1200,WARN_RANGE=20,WARN_FALLOFF=8;
/** How far to the side a warning at the screen's edge sounds (footsteps' ALLY_PAN). */
export const WARN_PAN=.6;
/** A structure whose hp 0 is a break (a tower's hp 0 is its end of life, the tralha has its own thwack). */
const breaks=(id:string)=>id.startsWith('barricada')||id==='muralha'||id===CAR_ID;

interface Point {x:number;y:number}
/** What the room's view knows besides the events (hud/rescue.ts); every part optional. */
export interface EventWorld {
  /** The local hero, for a warning's distance. */
  hero?:Point;
  /** A point's side of the screen, -1..1 (scene.screenSide). */
  side?:(p:Point)=>number;
  /** The boss by enemy id (the damage event has no kind). */
  boss?:(enemy:string)=>boolean;
  /** A telegraph's place by id (view.telegraphs); undefined: not in this client's view. */
  telegraph?:(id:string)=>Point|undefined;
}
/** The danger warning's level and side at `at`, or undefined when too far or out of view. */
export function warnCue(rate:number,at:Point|undefined,world?:EventWorld):EventCue|undefined{
  if(!at)return world?.telegraph?undefined:{id:'chefe-passo',rate};
  const d=world?.hero?Math.hypot(at.x-world.hero.x,at.y-world.hero.y):0;
  if(d>WARN_RANGE)return undefined;
  const pan=(world?.side?.(at)??0)*WARN_PAN;
  return {id:'chefe-passo',rate,gain:1/(1+d/WARN_FALLOFF),...(pan?{pan}:{})};
}
/** One warning per WARN_MS, for the whole match (spawns, telegraphs). */
export class WarnGate {
  private at=-Infinity;
  open(now:number){if(now-this.at<WARN_MS)return false;this.at=now;return true;}
}

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
export function cueForEvent(event:SimEvent,localPlayer?:string,elite?:(enemy:string)=>boolean,world?:EventWorld):EventCue|undefined{
  const mine=(id:string|undefined)=>localPlayer!==undefined&&id===localPlayer;
  switch(event.type){
    case 'damage':{
      if(mine(event.target))return {id:'dano-heroi'};
      if(!mine(event.source))return undefined;
      // The boss or an elite takes the heavy hit; a slash lands with a thwack; a shot with the critter's splat.
      const id:SoundId=elite?.(event.target)||world?.boss?.(event.target)?'chefe-acerto'
        :event.weapon&&MELEE.has(event.weapon.replace(/(-evo|-lendario)+$/,''))?'golpe':'bicho-acerto';
      return event.crit?{id,...CRIT_CUE}:{id,rate:HIT_RATES[bucket(event.target,HIT_RATES.length)]};
    }
    case 'kill':
      if(isBoss(event.kind))return {id:'chefe-morte'};
      if(!mine(event.by))return undefined;
      if(elite?.(event.enemy))return {id:'chefe-morte',...ELITE_DEATH};
      return {id:'bicho-morte',rate:KILL_RATES[bucket(event.enemy,KILL_RATES.length)]};
    case 'revived':
      if(mine(event.player))return {id:'ufa',with:GET_UP_CUE};
      return mine(event.by)?{id:'resgate'}:{id:'resgate',gain:TEAM_RESCUE_GAIN};
    case 'spawn-warning':return warnCue(WARN_SPAWN_RATE,event,world);
    case 'telegraph':return warnCue(WARN_ATTACK_RATE,world?.telegraph?.(event.telegraph),world);
    case 'structure':if(event.hp===0&&breaks(event.id))return {...BREAK_CUE};break;
  }
  const id=soundForEvent(event,localPlayer);return id?{id}:undefined;
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
    // A barricade, the wall or the Uno: the same golpe, heavier (cueForEvent).
    case 'structure':return event.hp===0&&(event.id.startsWith('tralha')||breaks(event.id))?'golpe':undefined;
    // A danger warning: the boss's step, slowed (cueForEvent places it).
    case 'spawn-warning':case 'telegraph':return 'chefe-passo';
    // The intermission's end ("Fim do recreio!", sim/stonewards): the Uno honks (card som-alarme-gema-e-chefe).
    case 'horn':return 'buzina';
    // 'prepare' also opens the run (before round 1) and shares a tick with 'end', so only 'end' gets the ta-dá.
    case 'round':return event.phase==='wave'?'round-inicio':event.phase==='end'?'round-fim':undefined;
    default:return undefined;
  }
}

/** The local player's gem combo, shared by the room's pickups (playEvents) and the cédula caught on screen (hud/rescue.ts). */
export const GEMS=new GemCombo();
/** The match's danger warnings, one per WARN_MS. */
export const WARNINGS=new WarnGate();
/** The gem combo, the warnings' gate and their clock (ms); tests pass their own. */
export interface GemClock {gems:GemCombo;warn?:WarnGate;now:()=>number}
type Play=(id:SoundId,opts?:{gain?:number;rate?:number;pan?:number})=>boolean;

/**
 * Plays every mapped event; per-sound throttling in the engine keeps hit storms in check. Returns sounds played.
 * `heard`: an event whose sound already played on the client (a cédula caught on screen, render/cedula-catch.ts).
 * `elite`: an elite enemy by id (cueForEvent).
 * Each of my gems climbs the combo's pitch (recipes.ts GemCombo); a heard one already did.
 * `world`: the hero, the screen's sides, the boss and the telegraphs (EventWorld); a danger warning passes `clock.warn`.
 */
export function playEvents(audio:{play:Play},events:Iterable<SimEvent>,localPlayer?:string,
  heard?:(event:SimEvent)=>boolean,elite?:(enemy:string)=>boolean,clock:GemClock={gems:GEMS,now:()=>performance.now()},world?:EventWorld):number{
  let played=0;
  for(const event of events){
    const cue=cueForEvent(event,localPlayer,elite,world);
    if(!cue||heard?.(event))continue;
    if(cue.id==='gema')cue.rate=clock.gems.next(clock.now());
    if((event.type==='spawn-warning'||event.type==='telegraph')&&!(clock.warn??WARNINGS).open(clock.now()))continue;
    for(let c:EventCue|undefined=cue;c;c=c.with){
      const {id,with:_,...opts}=c;
      if(audio.play(id,opts))played++;
    }
  }
  return played;
}
