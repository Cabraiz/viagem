/**
 * BUG-20261025-ORQ-ima-dinheiro-demora (the user: "o ímã do dinheiro [...] ao passar por cima ou chegar perto, ele demora
 * a ser processado"): the local hero takes a cédula on the client the moment he comes within the room's magnet
 * (sim/progression.ts CEDULA_PULL_RADIUS) of it and is the nearest standing hero: it flies into him in CATCH_FLY_MS and
 * its R$ go up in the top bar at once (pending()), with the clink. The room still pays: until its view says the note
 * is gone, the R$ are only shown, never spent (the forge, the Cida and the obra read the room's wallet).
 * Before this, the note waited for the room: the hero's position up, the 50 ms tick, the magnet's two ticks of flight,
 * the 100 ms broadcast and the way back (~200 ms on a local Worker, ~350 ms on a phone link; measured in the card).
 * The room settles each caught note: taken by me (its R$ are in my wallet now) or by someone else (never mine: the
 * count drops back), or still on the ground CATCH_GIVE_UP_MS later (the hero turned away at the edge): it comes back.
 * Pure (no Phaser): tested in tests/client/cedula-catch.test.ts.
 */

/** World units: the room's magnet for cédulas (sim/progression.ts CEDULA_PULL_RADIUS, held equal by the test). */
export const CATCH_RADIUS=1.6;
/** The caught note's flight into the hero (ms); reduced motion: gone at once. */
export const CATCH_FLY_MS=150;
/** A caught note the room has not taken by then comes back to the ground (and its R$ leave the count). */
export const CATCH_GIVE_UP_MS=1500;
/** How long a caught note's clink stands for the room's 'pickup' event of it (that event then plays nothing). */
const HEARD_MS=5000;

interface Pt {x:number;y:number}
export interface Caught {id:string;value:number;at:number;x:number;y:number}
type Note={id:string;kind:string;value:number;x:number;y:number};
type PickupEvent={type:string;player?:string;pickup?:string;kind?:string};

export class CedulaCatch{
  private readonly caught=new Map<string,Caught>();
  /** Ids whose clink played at the catch, and when: the room's own 'pickup' event of them stays silent. */
  private readonly heard=new Map<string,number>();
  /** Notes that came back (the room kept them) and when: not caught again for CATCH_GIVE_UP_MS (no catch-and-back loop). */
  private readonly refused=new Map<string,number>();
  private total=0;

  /**
   * A note drawn at (x, y) this frame: caught when the local hero stands within CATCH_RADIUS of it and no other standing
   * hero is nearer (the room gives it to the nearest). Returns the new catch (undefined: not caught now or before).
   */
  near(now:number,id:string,value:number,x:number,y:number,hero:Pt|undefined,others:readonly Pt[]):Caught|undefined{
    if(!hero||this.caught.has(id))return undefined;
    const back=this.refused.get(id);
    if(back!==undefined&&now-back<CATCH_GIVE_UP_MS)return undefined;
    const d=(p:Pt)=>(p.x-x)**2+(p.y-y)**2,mine=d(hero);
    if(mine>CATCH_RADIUS*CATCH_RADIUS)return undefined;
    for(const p of others)if(d(p)<mine)return undefined;
    const c={id,value,at:now,x,y};
    this.caught.set(id,c);this.heard.set(id,now);this.total+=value;
    return c;
  }
  get(id:string){return this.caught.get(id);}
  /** R$ caught on screen that the room has not paid yet (the top bar adds them to the wallet). */
  pending(){return this.total;}
  get size(){return this.caught.size;}

  /**
   * Each authoritative view's pickups. A caught note gone from the view is settled (its R$ are in the wallet of this
   * same view, or someone else took it); one still there follows the room's value (a cédula that joined it) and comes
   * back after CATCH_GIVE_UP_MS unless the hero stands within its magnet still (the room is about to pay it: giving it
   * back would blink the R$ down and up). Returns the ids that came back.
   */
  push(now:number,pickups:readonly Note[],hero?:Pt):string[]{
    if(!this.caught.size){this.forget(now);return [];}
    const back:string[]=[];
    const there=new Map<string,Note>();for(const p of pickups)if(p.kind==='grana'&&this.caught.has(p.id))there.set(p.id,p);
    for(const [id,c] of this.caught){
      const p=there.get(id);
      if(!p){this.caught.delete(id);continue;}
      c.value=p.value;
      const near=!!hero&&(hero.x-p.x)**2+(hero.y-p.y)**2<=CATCH_RADIUS*CATCH_RADIUS;
      if(now-c.at>=CATCH_GIVE_UP_MS&&!near){this.caught.delete(id);this.heard.delete(id);this.refused.set(id,now);back.push(id);}
    }
    this.recount();this.forget(now);
    return back;
  }
  /** The room's 'pickup' event of a note whose clink already played at the catch (audio/events.ts skips it). */
  heardBefore(event:PickupEvent){
    return event.type==='pickup'&&event.kind==='grana'&&event.pickup!==undefined&&this.heard.delete(event.pickup);
  }
  reset(){this.caught.clear();this.heard.clear();this.refused.clear();this.total=0;}
  private recount(){let t=0;for(const c of this.caught.values())t+=c.value;this.total=t;}
  private forget(now:number){
    for(const [id,at] of this.heard)if(now-at>HEARD_MS)this.heard.delete(id);
    for(const [id,at] of this.refused)if(now-at>=CATCH_GIVE_UP_MS)this.refused.delete(id);
  }
}

/** The caught note's flight (0 → 1 over CATCH_FLY_MS, ease-in: it leaves slowly and snaps into the hero); 1 = gone. */
export function catchFlight(age:number,reduced=false){
  if(reduced)return 1;
  const t=Math.max(0,Math.min(1,age/CATCH_FLY_MS));
  return t*t;
}
