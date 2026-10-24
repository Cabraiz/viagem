/**
 * Sim events -> sounds (VGM-050; the files of NEW-20261022-ORQ-sons-ia-ace-step). Client integration (VGM-043) feeds
 * RunView.events here. Only the local player's own hits, shots, kills and pickups make noise; team moments (falls,
 * rescues, boss, rounds) play for everyone.
 */
import type {SimEvent} from '../../contract/index.ts';
import type {SoundId} from './types.ts';

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
const isBoss=(kind:string)=>kind==='chefe'||kind.startsWith('chefe-');
/** A crate's rarity (1 verde .. 5 lendária, contract PickupKind) to its chest's sound. */
export function chestSound(rarity:number):SoundId{
  return rarity>=5?'bau-lendario':rarity>=4?'bau-epico':rarity>=2?'bau-raro':'bau-comum';
}

export function soundForEvent(event:SimEvent,localPlayer?:string):SoundId|undefined{
  const mine=(id:string|undefined)=>localPlayer!==undefined&&id===localPlayer;
  switch(event.type){
    case 'damage':
      if(mine(event.target))return 'dano-heroi';
      if(!mine(event.source))return undefined;
      // A slash lands with a thwack; a shot with the critter's splat.
      return event.weapon&&MELEE.has(event.weapon.replace(/(-evo|-lendario)+$/,''))?'golpe':'bicho-acerto';
    case 'kill':return mine(event.by)?isBoss(event.kind)?'chefe-morte':'bicho-morte':isBoss(event.kind)?'chefe-morte':undefined;
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
    case 'downed':return 'queda';
    case 'revived':return mine(event.player)?'levantar':'resgate';
    // Being eliminated earns a canned laugh from the studio audience.
    case 'eliminated':return 'risada';
    case 'boss-phase':return 'chefe';
    // 'prepare' also opens the run (before round 1) and shares a tick with 'end', so only 'end' gets the ta-dá.
    case 'round':return event.phase==='wave'?'round-inicio':event.phase==='end'?'round-fim':undefined;
    default:return undefined;
  }
}

/** Plays every mapped event; per-sound throttling in the engine keeps hit storms in check. Returns sounds played. */
export function playEvents(audio:{play(id:SoundId):boolean},events:Iterable<SimEvent>,localPlayer?:string):number{
  let played=0;
  for(const event of events){
    const id=soundForEvent(event,localPlayer);
    if(id&&audio.play(id))played++;
  }
  return played;
}
