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
 * NEW-20261029-ORQ-sons-novos-tangoflux (itens 21, 22, 23, 25 e 26, new TangoFlux files): the last critter's tcham, the
 * happenings' jingles, a car part's clank, the money (Cida's register, the bank's cash and its empty till) and a nest
 * waking up from its side of the screen.
 * NEW-20261030-ORQ-sons-nos-eventos (auditoria-sons-30-10, the new recipes): a bicho's hit on me and a melee wind-up
 * near me ('pancada', 'investida', 'varredura') are 'bicho-ataque', the saci's hit whistles ('saci-assobio'), the
 * sanfoneiro's playing is 'sanfona' from his side, the chaveiro's arrival is 'chaveiro-chega', my PIX (sent or got)
 * a short 'caca-niquel' (the gema already rings for every cédula and climbs the combo) and a magnet the 'ima'.
 * bicho-ataque and the PIX are capped per second (RateGate). Legacy hazards keep the old warning; legacy kinds never
 * whistle.
 */
import {CAR_ID,type HappeningKind,type SimEvent} from '../../contract/index.ts';
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
/** The last critter of the round (the kill-cam's slow motion): a short orchestral tcham, for everyone. */
export const LAST_BICHO_CUE={id:'ultimo-bicho'} as const;
/** A happening's jingle: the blackout winds down, the flash sale rings the register, the boleto rain stamps. */
export const HAPPENING_CUE:Readonly<Record<HappeningKind,EventCue>>={apagao:{id:'apagao'},promo:{id:'caixa-registradora'},boletos:{id:'carimbo'}};
/** Someone else's purchase at Cida's, and Cida selling a sweet to a critter: the register, quieter. */
export const TEAM_MONEY_GAIN=.4;
export const SALE_CUE={id:'caixa-registradora',rate:1.12,gain:TEAM_MONEY_GAIN} as const;
/** A hero cashing at a bank: the coin clink, high (never the gem combo's climb); a critter robbing it: a low tsc. */
export const BANK_CASH_CUE={id:'gema',rate:1.5,gain:.7} as const;
export const BANK_ROBBED_CUE={id:'tsc',rate:.85,gain:.7} as const;
/** A critter turned Cliente Prime at a bank: the register, slow and low; a bank run dry: the tsc, lower. */
export const BANK_PRIME_CUE={id:'caixa-registradora',rate:.75,gain:.5} as const;
export const BANK_EMPTY_CUE={id:'tsc',rate:.7} as const;
/** A nest's sleepers waking: the growl from its side of the screen, none past NEST_RANGE tiles, fading over WARN_FALLOFF. */
export const NEST_RANGE=24;
/** A short caca-niquel: a PIX sent or received (higher and quieter than the golden weapon's jackpot). */
export const PIX_CUE={id:'caca-niquel',rate:1.6,gain:.5} as const;
/** The telegraph kinds of a melee wind-up (the brute's and the sanfoneiro's slam, the charge, the sweep). */
export const MELEE_TELEGRAPHS:ReadonlySet<string>=new Set(['pancada','investida','varredura']);
/** The saci's roster kind (ELITE_ONLY): his hit whistles instead of the bicho's. */
export const SACI_KIND='aberracao-saci';
/** At most this many per second, whatever the crowd (playEvents' RateGate). */
export const PER_SECOND:Readonly<Partial<Record<SoundId,number>>>={'bicho-ataque':4,'caca-niquel':3};
/** A structure whose hp 0 is a break (a tower's hp 0 is its end of life, the tralha has its own thwack). */
const breaks=(id:string)=>id.startsWith('barricada')||id==='muralha'||id===CAR_ID;

interface Point {x:number;y:number}
/** An enemy the client sees (the feed's EnemyView). */
interface SeenEnemy extends Point {kind:string;boss?:boolean}
/** What the room's view knows besides the events (hud/rescue.ts); every part optional. */
export interface EventWorld {
  /** The local hero, for a warning's distance. */
  hero?:Point;
  /** A point's side of the screen, -1..1 (scene.screenSide). */
  side?:(p:Point)=>number;
  /** The boss by enemy id (the damage event has no kind). */
  boss?:(enemy:string)=>boolean;
  /** A telegraph's place (and kind) by id (view.telegraphs); undefined: not in this client's view. */
  telegraph?:(id:string)=>(Point&{kind?:string})|undefined;
  /** An enemy by id (the feed); undefined: gone or not in this client's view. */
  enemy?:(id:string)=>SeenEnemy|undefined;
}
/** The danger warning's level and side at `at`, or undefined when too far or out of view. */
export function warnCue(rate:number,at:Point|undefined,world?:EventWorld):EventCue|undefined{
  return placed({id:'chefe-passo',rate},at,!!world?.telegraph,world);
}
/**
 * `cue` from `at`: quieter with the distance to the hero and from its side, none past WARN_RANGE. No place: the plain
 * cue, or none when the world could have placed it (`known`) and did not (out of this client's view).
 */
export function placed(cue:EventCue,at:Point|undefined,known:boolean,world?:EventWorld):EventCue|undefined{
  if(!at)return known?undefined:cue;
  const d=world?.hero?Math.hypot(at.x-world.hero.x,at.y-world.hero.y):0;
  if(d>WARN_RANGE)return undefined;
  const pan=(world?.side?.(at)??0)*WARN_PAN;
  return {...cue,gain:(cue.gain??1)/(1+d/WARN_FALLOFF),...(pan?{pan}:{})};
}
/** At most `perSecond` in any second (a crowd's hits, a burst of PIX). */
export class RateGate {
  private times:number[]=[];
  readonly perSecond:number;
  constructor(perSecond:number){this.perSecond=perSecond;}
  open(now:number){
    this.times=this.times.filter(at=>now-at<1000);
    if(this.times.length>=this.perSecond)return false;
    this.times.push(now);return true;
  }
}
/** The growl of a nest waking at `at`, or undefined when too far (sfx.ts throttles it to one per 2 s). */
export function nestCue(at:Point,world?:EventWorld):EventCue|undefined{
  const d=world?.hero?Math.hypot(at.x-world.hero.x,at.y-world.hero.y):0;
  if(d>NEST_RANGE)return undefined;
  const pan=(world?.side?.(at)??0)*WARN_PAN;
  return {id:'ninho-acordou',gain:1/(1+d/WARN_FALLOFF),...(pan?{pan}:{})};
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
      if(mine(event.target)){
        // An enemy's hit (his body, his slam, his charge): the bicho's attack, or the saci's whistle.
        const by=event.source!==undefined?world?.enemy?.(event.source):undefined;
        if(!by||by.boss)return {id:'dano-heroi'};
        return {id:'dano-heroi',with:{id:by.kind===SACI_KIND?'saci-assobio':'bicho-ataque'}};
      }
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
    case 'telegraph':{
      const at=world?.telegraph?.(event.telegraph);
      if(at?.kind&&MELEE_TELEGRAPHS.has(at.kind))return placed({id:'bicho-ataque'},at,true,world);
      return warnCue(WARN_ATTACK_RATE,at,world);
    }
    // The sanfoneiro starts playing: the fole from his side (his warning and his stop are seen, not heard).
    case 'sanfona':return event.what==='toca'?placed({id:'sanfona'},world?.enemy?.(event.enemy),!!world?.enemy,world):undefined;
    case 'pix':return mine(event.from)||mine(event.to)?{...PIX_CUE}:undefined;
    case 'structure':if(event.hp===0&&breaks(event.id))return {...BREAK_CUE};break;
    case 'last-bicho':return {...LAST_BICHO_CUE};
    case 'happening':return {...HAPPENING_CUE[event.kind]};
    // A car part fell off the Uno (there is no event for picking one up or putting it back).
    case 'part':return {id:'peca-cai'};
    case 'buy':return mine(event.player)?{id:'caixa-registradora'}:{id:'caixa-registradora',gain:TEAM_MONEY_GAIN};
    case 'sale':return {...SALE_CUE};
    case 'bank-cash':return event.by==='hero'?{...BANK_CASH_CUE}:{...BANK_ROBBED_CUE};
    case 'bank-prime':return {...BANK_PRIME_CUE};
    case 'bank-empty':return {...BANK_EMPTY_CUE};
    case 'acordou':return nestCue(event,world);
  }
  const id=soundForEvent(event,localPlayer);return id?{id}:undefined;
}

export function soundForEvent(event:SimEvent,localPlayer?:string):SoundId|undefined{
  const mine=(id:string|undefined)=>localPlayer!==undefined&&id===localPlayer;
  switch(event.type){
    case 'damage':case 'kill':case 'revived':case 'last-bicho':case 'happening':case 'part':case 'buy':case 'sale':
    case 'bank-cash':case 'bank-prime':case 'bank-empty':case 'acordou':return cueForEvent(event,localPlayer)?.id;
    case 'fire':return mine(event.player)?weaponSound(event.weapon):undefined;
    case 'pickup':
      if(!mine(event.player))return undefined;
      // The magnet (protocol4's DICT keeps it; the sim has emitted none since D-054): its own take, never the gema.
      if((event.kind as string)==='magnet')return 'ima';
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
    // The chaveiro arrives (sim/chaveiro/system.ts): everyone hears it.
    case 'moto':return event.mode==='chegou'?'chaveiro-chega':undefined;
    case 'sanfona':case 'pix':return cueForEvent(event,localPlayer)?.id;
    // 'prepare' also opens the run (before round 1) and shares a tick with 'end', so only 'end' gets the ta-dá.
    case 'round':return event.phase==='wave'?'round-inicio':event.phase==='end'?'round-fim':undefined;
    default:return undefined;
  }
}

/** The local player's gem combo, shared by the room's pickups (playEvents) and the cédula caught on screen (hud/rescue.ts). */
export const GEMS=new GemCombo();
/** The match's danger warnings, one per WARN_MS. */
export const WARNINGS=new WarnGate();
/** The match's per-second caps (PER_SECOND). */
export const rateGates=()=>Object.fromEntries(Object.entries(PER_SECOND).map(([id,n])=>[id,new RateGate(n!)])) as Partial<Record<SoundId,RateGate>>;
export const RATES=rateGates();
/** The gem combo, the warnings' gate, the per-second caps and their clock (ms); tests pass their own. */
export interface GemClock {gems:GemCombo;warn?:WarnGate;rates?:Partial<Record<SoundId,RateGate>>;now:()=>number}
type Play=(id:SoundId,opts?:{gain?:number;rate?:number;pan?:number})=>boolean;

/**
 * Plays every mapped event; per-sound throttling in the engine keeps hit storms in check. Returns sounds played.
 * `heard`: an event whose sound already played on the client (a cédula caught on screen, render/cedula-catch.ts).
 * `elite`: an elite enemy by id (cueForEvent).
 * Each of my gems climbs the combo's pitch (recipes.ts GemCombo); a heard one already did.
 * `world`: the hero, the screen's sides, the boss, the telegraphs and the enemies (EventWorld); a danger warning passes
 * `clock.warn`, a capped sound (PER_SECOND) its `clock.rates` gate (the hit under it still plays).
 */
export function playEvents(audio:{play:Play},events:Iterable<SimEvent>,localPlayer?:string,
  heard?:(event:SimEvent)=>boolean,elite?:(enemy:string)=>boolean,clock:GemClock={gems:GEMS,now:()=>performance.now()},world?:EventWorld):number{
  let played=0;
  for(const event of events){
    const cue=cueForEvent(event,localPlayer,elite,world);
    if(!cue||heard?.(event))continue;
    // A pitched gema (a bank's cash) is not a pickup: it keeps its pitch and leaves the combo alone.
    if(cue.id==='gema'&&cue.rate===undefined)cue.rate=clock.gems.next(clock.now());
    if(cue.id==='chefe-passo'&&!(clock.warn??WARNINGS).open(clock.now()))continue;
    for(let c:EventCue|undefined=cue;c;c=c.with){
      const {id,with:_,...opts}=c;
      if((clock.rates??RATES)[id]?.open(clock.now())===false)continue;
      if(audio.play(id,opts))played++;
    }
  }
  return played;
}
