/**
 * Card danca-no-jogo (23/10): the user's dances play in the match, not in the menu. A hero that stands still for
 * DANCE_IDLE_MS (no walk, no swing, no push, no flinch) starts dancing on its own, facing the camera, until it moves;
 * any input of the local player cuts it at once. Each client decides it for every figure it draws (a remote hero's
 * stillness is seen from its moves and swings), so nothing goes on the wire. Pure (no Phaser).
 */

/** Standing still this long (ms of the scene clock) starts the dance. */
export const DANCE_IDLE_MS=5000;
/** The dance sheet starts downloading this long before it plays, so the first pose is usually there on time. */
export const DANCE_PREFETCH_MS=3000;
/**
 * The menu dance runs 128 poses over 36 s, read slowly on the podium; in the match it plays this much faster so the
 * move reads at a figure's size (≈ 7 poses a second).
 */
export const DANCE_RATE=2;

/** A cheer (round won, team level-up, a big enemy down near a bot) dances this long, whenever the figure stands still. */
export const CHEER_MS=6000;
/** A bot cheers a boss or an elite that falls within this many world units of it. */
export const CHEER_RADIUS=8;

/**
 * What the scene knows about one figure this frame. `allowed`: it may dance at all (alive, on its feet, not riding,
 * slipping or out of the run: see danceAllowed). `poke`: the scene-clock time of the local player's last input (own
 * hero only): an input restarts the wait and cuts a cheer. `idle: false`: standing still never starts it (the room's
 * bots dance only when they cheer). `cheer`: the scene-clock time of the figure's last cheer (Cheers.of).
 */
export interface DanceCue {allowed:boolean;poke?:number;idle?:boolean;cheer?:number}

/** The wait and the dance of one figure. */
export class DanceGate {
  private quietSince?:number;
  private start?:number;
  /**
   * `still`: the figure rests this frame (CharacterSprites: motion idle, not pushing, no flinch). Returns the dance's
   * start (scene clock) while it dances, else undefined; `prefetch` tells when to start downloading the sheet. A cheer
   * dances from the moment it is still within CHEER_MS of the cheer; a dance that goes on (a cheer that runs into the
   * idle wait) keeps its start, so the moves never jump back to the first pose.
   */
  prefetch=false;
  update(now:number,still:boolean,cue?:DanceCue):number|undefined{
    if(!cue||!cue.allowed||!still||this.quietSince===undefined||now<this.quietSince)this.quietSince=now;
    if(cue?.poke!==undefined&&cue.poke>this.quietSince)this.quietSince=Math.min(now,cue.poke);
    const quiet=now-this.quietSince,idle=cue?.idle!==false;
    const cheer=cue?.allowed&&cue.cheer!==undefined&&now>=cue.cheer&&now-cue.cheer<CHEER_MS&&!(cue.poke!==undefined&&cue.poke>cue.cheer)?cue.cheer:undefined;
    this.prefetch=cheer!==undefined||idle&&quiet>=DANCE_IDLE_MS-DANCE_PREFETCH_MS;
    const idleStart=idle&&quiet>=DANCE_IDLE_MS?this.quietSince+DANCE_IDLE_MS:undefined;
    const cheerStart=cheer!==undefined&&still&&cue?.allowed?Math.max(cheer,this.quietSince):undefined;
    if(idleStart===undefined&&cheerStart===undefined){this.start=undefined;return undefined;}
    if(this.start===undefined||this.start>now||this.start<this.quietSince)this.start=Math.min(idleStart??Infinity,cheerStart??Infinity);
    return this.start;
  }
}

/** One figure the cheers know of this tick (RunView.players). */
export interface CheerFigure {id:string;x:number;y:number;bot?:boolean}
/** The run's events the cheers read (contract SimEvent: round, levelup, kill). */
export type CheerEvent={type:string;phase?:unknown;enemy?:unknown;kind?:unknown;x?:unknown;y?:unknown};
const isBossKind=(kind:unknown)=>typeof kind==='string'&&(kind==='chefe'||kind.startsWith('chefe-'));

/**
 * Card danca-no-jogo, etapa 2: who cheers, from the events every client already gets (nothing new on the wire, each
 * client draws the same). A round that ends (the wave knocked down, the last one is the win): everyone. The team's
 * level-up: the bots. A boss or an elite that falls within CHEER_RADIUS of a bot: that bot. Pure (no Phaser).
 */
export class Cheers {
  private at=new Map<string,number>();
  private big=new Set<string>();
  /** One RunView: its events at scene time `now`, its players, and its enemies (the big ones are remembered for their kill). */
  push(now:number,events:readonly CheerEvent[],players:readonly CheerFigure[],enemies:readonly {id:string;elite?:boolean;boss?:boolean}[]=[]){
    for(const e of events){
      const round=e.type==='round'&&e.phase==='end',levelup=e.type==='levelup',big=e.type==='kill'&&(this.big.has(String(e.enemy))||isBossKind(e.kind));
      if(!round&&!levelup&&!big)continue;
      for(const p of players){
        if(round||p.bot&&(levelup||big&&Math.hypot(p.x-Number(e.x),p.y-Number(e.y))<=CHEER_RADIUS))this.at.set(p.id,now);
      }
    }
    this.big.clear();
    for(const e of enemies)if(e.elite||e.boss)this.big.add(e.id);
    for(const id of this.at.keys())if(!players.some(p=>p.id===id))this.at.delete(id);
  }
  /** The scene time of `id`'s last cheer, if any (DanceCue.cheer). */
  of(id:string):number|undefined{return this.at.get(id);}
}

/** The fields of a player's run state (PlayerRunView) that forbid dancing. */
export interface DanceState {
  hp:number;online?:boolean;spectator?:boolean;downed?:unknown;eliminated?:boolean;
  ride?:unknown;rideUntil?:number;slipUntil?:number;
  /** D-051 manual combat: the inventory and the slot in the hand (absent with the automatic weapons: nothing in the hand). */
  weapons?:readonly {id:string}[];hand?:number;
}
/**
 * Card dancas-5-herois-16q (28/10, "enquanto não tiver arma você pode dançar"): a hero with a weapon in the hand never
 * dances, from the wait or from a cheer. `isWeapon` tells a weapon from what else a slot holds (render/arsenal-rules.ts
 * isWeaponItem: a coxinha in slot 0 when no weapon is left is not one); without it any item in the hand counts.
 */
export function armed(p:Pick<DanceState,'weapons'|'hand'>,isWeapon:(id:string)=>boolean=()=>true):boolean{
  const item=p.hand===undefined?undefined:p.weapons?.[p.hand];
  return !!item&&isWeapon(item.id);
}
/**
 * A figure may dance only alive and on its feet, in the run, with its feet on the ground and its hands free: not downed
 * or out, not riding a vehicle (the moto, the burpee's leap), not sliding on pigeon poop, no weapon in the hand (armed).
 * `tick`: the run's current tick.
 */
export function danceAllowed(p:DanceState|undefined,tick:number,isWeapon?:(id:string)=>boolean):boolean{
  if(!p||!(p.hp>0)||p.online===false||p.spectator||p.downed||p.eliminated)return false;
  if(p.ride&&(p.rideUntil??Infinity)>tick)return false;
  if(armed(p,isWeapon))return false;
  return !((p.slipUntil??0)>tick);
}
