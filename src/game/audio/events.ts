/**
 * Sim events -> sounds (VGM-050). Client integration (VGM-043) feeds RunView.events here.
 * Only the local player's own hits and pickups make noise; team moments (falls, rescues, boss, rounds) play for everyone.
 */
import type {SimEvent} from '../sim/types.ts';
import type {SoundId} from './types.ts';

export function soundForEvent(event:SimEvent,localPlayer?:string):SoundId|undefined{
  switch(event.type){
    case 'damage':return localPlayer!==undefined&&(event.source===localPlayer||event.target===localPlayer)?'golpe':undefined;
    case 'pickup':
      if(event.player!==localPlayer)return undefined;
      // Zueira: the chest honks like a clown car, the magnet goes boing.
      return event.kind==='chest'?'buzina':event.kind==='magnet'?'boing':'gema';
    case 'levelup':return 'nivel';
    case 'upgrade':case 'evolve':return event.player===localPlayer?'upgrade':undefined;
    case 'downed':return 'queda';
    case 'revived':return 'resgate';
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
