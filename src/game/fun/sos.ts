/**
 * "Me salva" ping with position (UX-resgate-e-ping): shared by the room (anti-spam, relay) and the client (board).
 * Pure, no DOM, so the Worker can import it.
 */
/** "Me salva" ping with position (UX-resgate-e-ping): one per caído every 3 s, on the button and in the room. */
export const SOS_COOLDOWN_MS=3000;
/** How long a ping lights the caído's edge arrow and minimap dot on every phone. */
export const SOS_SHOW_MS=4000;
/** A ping as the room relays it: who, where (room position, world units) and the tick it was sent. */
export interface SosPing {id:string;x:number;y:number;tick:number}
/** Validates a {t:'sos'} relay from the room (anything malformed is dropped, never thrown). */
export function parseSos(m:unknown):SosPing|undefined{
  const v=m as Partial<SosPing>&{t?:unknown};
  if(!v||v.t!=='sos'||typeof v.id!=='string'||!v.id||v.id.length>64)return undefined;
  if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||!Number.isSafeInteger(v.tick))return undefined;
  return {id:v.id,x:v.x!,y:v.y!,tick:v.tick!};
}
/**
 * Pings each phone shows: one per caído (a newer one replaces it), each lit for SOS_SHOW_MS, the same ping relayed
 * twice (a resend after a reconnection) counted once. `add` returns true for a new ping (sound, vibration, balloon).
 */
export class SosBoard {
  private readonly pings=new Map<string,SosPing&{at:number}>();
  readonly showMs:number;
  constructor(showMs=SOS_SHOW_MS){this.showMs=showMs;}
  add(ping:SosPing,now:number){
    const old=this.pings.get(ping.id);
    if(old&&old.tick===ping.tick)return false;
    this.pings.set(ping.id,{...ping,at:now});return true;
  }
  /** The ping of a player still lit at `now`, if any. */
  get(id:string,now:number){const p=this.pings.get(id);if(!p)return undefined;if(now-p.at>=this.showMs){this.pings.delete(id);return undefined;}return p;}
  forget(id:string){this.pings.delete(id);}
  clear(){this.pings.clear();}
}
