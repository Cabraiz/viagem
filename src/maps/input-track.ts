/**
 * Input on the wire since input-10hz (free-plan budget: every 20 WebSocket messages the room receives bill one
 * Durable Object request). The client no longer sends one `{t:'input'}` per 50 ms step: it sends the steps where its
 * control state changed (quantized direction, skill held, tap target), at most every SEND_MIN_MS, plus a keepalive
 * every KEEPALIVE_MS while it keeps walking; a still joystick sends nothing.
 *
 * Steps keep their client sequence numbers, so prediction and reconciliation stay exact: the room applies one step
 * per tick, in order, holding the last state between changes (InputTrack), never faster than the client's own clock
 * allows (the time since its last report, LEAD_STEPS behind), and the owner's frames carry the position at the last
 * step it reported (`confirmed`), so its prediction never sees a guess. A change that arrives after the room already
 * guessed past it takes effect from the next step: nothing is ever rewound (review onda 5: a rewind let a forged
 * client move several steps in one tick), so one tick moves a player at most one step, whatever the client sends.
 * A skill tap is a separate one-shot message {t:'cast',round,id} (no held state, outside the 10 Hz slot), answered
 * with {t:'cast',seq:id,ok,readyTick} after the step that carried it.
 */
import type {Point} from './world.ts';
import type {TerrainField} from './terrain/field.ts';
import type {PlayerInput} from '../sim/systems/players.ts';
import type {SimPlayer} from '../contract/index.ts';
import {SIM_HZ} from '../contract/index.ts';

/** Joystick directions: 32 (11.25°); the client predicts with the very numbers it sends. */
export const DIRECTION_BUCKETS=32;
/** The held bucket survives until the stick is this many buckets away from its centre (no flicker on an edge). */
export const DIRECTION_HYSTERESIS=.75;
/** At most one input message per this long (10 Hz). */
export const SEND_MIN_MS=100;
/** While walking without changes, the room hears from the client this often (its guess horizon is longer). */
export const KEEPALIVE_MS=1000;
/** The room keeps applying the held state this many steps past the last step the client reported (1.5 s). */
export const HORIZON_STEPS=Math.round(1.5*SIM_HZ);
/** More than this many steps behind the client (the room ticks slower than 20 Hz): drop steps, never two per tick. */
export const MAX_LAG_STEPS=10;
/**
 * For batches the room stays this many steps behind the client's clock (its last report plus the time since):
 * changes that waited for the 10 Hz slot (up to SEND_MIN_MS) then still arrive before the room reaches them,
 * instead of being guessed and rewound. It also keeps a room whose ticks run fast (or a phone that lost steps in
 * a long frame) from walking ahead of the player.
 */
export const LEAD_STEPS=2;
/** Applied steps remembered for rewinds and for the owner's confirmed position (past the horizon). */
const HISTORY_STEPS=HORIZON_STEPS+16;
export const STEP_MS=1000/SIM_HZ;
/** Segments per message and segments waiting in the room per player. */
export const MAX_SEGMENTS=8;
const MAX_QUEUED=32;

const round4=(v:number)=>Math.round(v*1e4)/1e4||0;
export const DIRECTIONS:readonly Readonly<Point>[]=Object.freeze(Array.from({length:DIRECTION_BUCKETS},(_,i)=>{
  const a=i*2*Math.PI/DIRECTION_BUCKETS;return Object.freeze({x:round4(Math.cos(a)),y:round4(Math.sin(a))});
}));
/** Bucket of a direction (-1: stopped), keeping `held` while the stick stays near it. */
export function quantizeDirection(direction:Point,held=-1):number{
  const length=Math.hypot(direction.x,direction.y);
  if(!Number.isFinite(length)||length<.01)return -1;
  const step=2*Math.PI/DIRECTION_BUCKETS,angle=Math.atan2(direction.y,direction.x);
  if(held>=0){
    let diff=angle-held*step;diff-=Math.round(diff/(2*Math.PI))*2*Math.PI;
    if(Math.abs(diff)<=step*DIRECTION_HYSTERESIS)return held;
  }
  return ((Math.round(angle/step)%DIRECTION_BUCKETS)+DIRECTION_BUCKETS)%DIRECTION_BUCKETS;
}

/** From client step `from` on: direction (a DIRECTIONS vector, or 0,0 to stop), skill held, tap target (server id in the room). */
export interface InputSegment {from:number;x:number;y:number;skill:boolean;target?:string}
/** Wire form of a segment: [from, x, y, flags (1 = skill held), target?]. */
export type SegmentWire=[number,number,number,number,string?];
/** `seq`: the client's latest step when it sent this (a keepalive has no steps). */
export interface InputBatch {seq:number;steps:SegmentWire[]}
const TARGET=/^[a-zA-Z0-9-]{1,40}$/;
const validSeq=(n:unknown):n is number=>Number.isSafeInteger(n)&&(n as number)>0&&(n as number)<2**31;
const unit=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1;
export function segmentOf(w:unknown):InputSegment|undefined{
  if(!Array.isArray(w)||w.length<4||w.length>5)return undefined;
  const [from,x,y,flags,target]=w;
  if(!validSeq(from)||!unit(x)||!unit(y)||(flags!==0&&flags!==1)||(target!==undefined&&(typeof target!=='string'||!TARGET.test(target))))return undefined;
  return {from,x,y,skill:flags===1,...(target!==undefined?{target}:{})};
}
export const segmentWire=(s:InputSegment):SegmentWire=>s.target!==undefined?[s.from,s.x,s.y,s.skill?1:0,s.target]:[s.from,s.x,s.y,s.skill?1:0];
const moving=(s:{x:number;y:number})=>Math.hypot(s.x,s.y)>=.01;

/**
 * Client side: turns the scene's 50 ms steps into change segments and decides when a message goes. Pure (no socket),
 * so it is tested in node; CoopClient owns the socket, the prediction and the ack.
 */
export class InputBatcher {
  seq=0;
  private bucket=-1;private skill=false;private target?:string;
  private unsent:SegmentWire[]=[];
  private lastSend=-Infinity;
  /** Starts over at `seq` (welcome ack, new run), standing still like the room's fresh track. */
  reset(seq=0){this.seq=seq;this.bucket=-1;this.skill=false;this.target=undefined;this.unsent=[];this.lastSend=-Infinity;}

  /** The room is already past our steps (it held our last state longer than we stepped): continue from its ack. */
  catchUp(ack:number){if(ack>this.seq)this.seq=ack;}
  /** One fixed step: the input the prediction applies (quantized), and whether it moves or casts (pending until acked). */
  step(direction:Point,skill:boolean,target?:string):{input:PlayerInput;active:boolean}{
    const bucket=quantizeDirection(direction,this.bucket>=0?this.bucket:-1),seq=++this.seq;
    const d=bucket<0?{x:0,y:0}:DIRECTIONS[bucket];
    if(bucket!==this.bucket||skill!==this.skill||target!==this.target){
      this.bucket=bucket;this.skill=skill;this.target=target;
      this.unsent.push(target!==undefined?[seq,d.x,d.y,skill?1:0,target]:[seq,d.x,d.y,skill?1:0]);
    }
    return {input:{seq,x:d.x,y:d.y,attack:false,skill,target},active:bucket>=0||skill};
  }
  /** Whether the held state makes the room keep stepping us (walking or holding the skill). */
  get active(){return this.bucket>=0||this.skill;}
  /** The message to send now, if any: pending changes at most every SEND_MIN_MS, or a keepalive while active. */
  take(now:number):InputBatch|undefined{
    const changes=this.unsent.length>0;
    if(changes&&(now-this.lastSend>=SEND_MIN_MS||this.unsent.length>=MAX_SEGMENTS)||!changes&&this.active&&now-this.lastSend>=KEEPALIVE_MS){
      this.lastSend=now;return {seq:this.seq,steps:this.unsent.splice(0)};
    }
    return undefined;
  }
  /** When changes wait for the 10 Hz slot: the time it opens (the client flushes then even without a new step). */
  get waitingUntil():number|undefined{return this.unsent.length?this.lastSend+SEND_MIN_MS:undefined;}
}

/** One applied step: where the player stood before it (the owner's confirmed position is read from here). */
interface Applied {seq:number;x:number;y:number}
/** Serializable part of a track (stateHash; replay). */
export interface InputTrackState {applied:number;lastFrom:number;known:number;held:InputSegment;queue:InputSegment[];skillPress:boolean;batched:boolean;knownAt:number;casts:number[];lastCast:number;appliedTarget?:string}
const STOP:InputSegment=Object.freeze({from:0,x:0,y:0,skill:false});

/**
 * Room side, one per player: the client's change segments in step order and the state held between them.
 * `next()` is the players system's takeInput: one step per tick, the seq the client gave that step.
 */
export class InputTrack {
  /** Last step handed to the simulation (the player's ack). */
  applied=0;
  /** Latest segment start accepted: segments must come in increasing order (a replay or a forged old step is refused). */
  private lastFrom=0;
  /** Latest step the client said it had taken. */
  private known=0;
  private held:InputSegment={...STOP};
  private queue:InputSegment[]=[];
  /** A held-skill press that arrived after its steps were already applied: cast on the next step. */
  private skillPress=false;
  /** Target last handed to the simulation (a stop with a new target still needs one step to set it). */
  private appliedTarget?:string;
  private history:Applied[]=[];
  /** When `known` last grew (ms; the Room's clock, or tick × STEP_MS in tests): the client's clock since then. */
  private knownAt=0;
  /** Batches follow the client's clock; a legacy client sends every step unthrottled, so its steps go at once. */
  private batched=false;
  /** Skill taps waiting for the next steps (client tap ids, one per tick), and the last accepted (ids only grow). */
  private castQueue:number[]=[];
  private lastCast=0;
  /** Set by next() on the step that carries a tap: Simulation reads it after the step to answer the client. */
  tapped?:number;
  /** Starts over at `ack` (join, reconnect, new run): nothing held, nothing queued. */
  reset(ack=0){this.applied=this.lastFrom=this.known=ack;this.held={...STOP};this.queue=[];this.skillPress=false;this.appliedTarget=undefined;this.history=[];this.knownAt=0;this.batched=false;this.castQueue=[];this.lastCast=0;this.tapped=undefined;}
  /**
   * A batch from the client, or one legacy step `{seq,x,y,skill,target}` (protocol 4 before input-10hz, tests): the
   * whole message is refused when anything in it is malformed or out of order. A segment may only start after the
   * last step the client already reported (`known`): rewriting reported steps is a contradiction, so it is refused.
   */
  accept(value:unknown,_player?:SimPlayer,_terrain?:TerrainField,now=0):boolean{
    const batch=toBatch(value);
    if(!batch)return false;
    const batched=!!value&&Array.isArray((value as {steps?:unknown}).steps);
    const segments:InputSegment[]=[];
    let last=Math.max(this.lastFrom,this.known);
    for(const w of batch.steps){
      const s=segmentOf(w);
      if(!s||s.from<=last||s.from>batch.seq)return false;
      segments.push(s);last=s.from;
    }
    if(this.queue.length+segments.length>MAX_QUEUED)return false;
    if(batch.seq>this.known){this.known=batch.seq;this.knownAt=now;}
    this.batched=batched;
    for(const s of segments){
      this.lastFrom=s.from;
      if(s.from>this.applied){this.queue.push(s);continue;}
      // Late: the room already guessed past `from` with the old state. From the next step on, the new state; no rewind.
      if(s.skill&&!this.held.skill)this.skillPress=true;
      this.queue=[];this.held={...s,from:this.applied};
    }
    return true;
  }
  /** A skill tap (client tap id, increasing): carried by the next step, or cast in place while standing or waiting. */
  tap(id:unknown):boolean{
    if(!validSeq(id)||id<=this.lastCast||this.castQueue.length>=4)return false;
    this.castQueue.push(id);this.lastCast=id;return true;
  }
  /**
   * The next step for the players system (seq = the client's), or undefined when standing still, waiting for the
   * client's clock, or out of guesses. `now` is the same clock as accept's.
   */
  next(p:SimPlayer,now=0):PlayerInput|undefined{
    this.tapped=undefined;
    let seq=this.applied+1;
    while(this.queue.length&&this.queue[0].from<=seq)this.held=this.queue.shift()!;
    const press=this.skillPress||this.castQueue.length>0;
    if(this.inert()&&!press){
      // Standing still costs no steps: jump straight to the next change (the idle stretch moves nobody).
      if(!this.queue.length)return undefined;
      this.applied=this.queue[0].from-1;seq=this.applied+1;this.held=this.queue.shift()!;this.history=[];
    }
    if(this.owed()>MAX_LAG_STEPS){
      // The room fell behind the client (it ticks slower than 20 Hz): drop one step per tick until it is back within
      // MAX_LAG_STEPS (small corrections, like the old queue's drops), never two steps of walking in one tick.
      this.applied++;seq=this.applied+1;this.history=[];
      while(this.queue.length&&this.queue[0].from<=seq)this.held=this.queue.shift()!;
    }
    if(seq>this.known+HORIZON_STEPS||this.batched&&seq>this.known+Math.floor((now-this.knownAt)/STEP_MS)-LEAD_STEPS||this.inert()&&press){
      // Waiting for the client's clock (or standing): a skill press still casts now, in place, without spending a step.
      if(!press)return undefined;
      return this.press({seq:this.applied,x:0,y:0,attack:false,skill:true,...(this.appliedTarget!==undefined?{target:this.appliedTarget}:{})});
    }
    this.applied=seq;
    this.history.push({seq,x:p.x,y:p.y});
    if(this.history.length>HISTORY_STEPS)this.history.shift();
    this.appliedTarget=this.held.target;
    const input:PlayerInput={seq,x:this.held.x,y:this.held.y,attack:false,skill:this.held.skill,...(this.held.target!==undefined?{target:this.held.target}:{})};
    return press?this.press({...input,skill:true}):input;
  }
  /** Consumes the pending press (tap or late hold) on this step. */
  private press(input:PlayerInput){
    this.tapped=this.castQueue.shift();
    this.skillPress=false;
    return input;
  }
  /**
   * What the owner's frames carry for itself when the room walked past the last step the client reported: that
   * step and the position after it. Undefined: send the live position.
   */
  confirmed():{ack:number;x:number;y:number}|undefined{
    const c=Math.min(this.applied,this.known);
    if(c>=this.applied)return undefined;
    const after=this.history.find(h=>h.seq===c+1);
    return after?{ack:c,x:after.x,y:after.y}:undefined;
  }
  /** Steps the client reported that still move or cast (an idle stretch is jumped over, so it is not owed). */
  private owed(){
    let owed=0,from=this.applied+1,state:InputSegment=this.held;
    for(const q of this.queue){if(moving(state)||state.skill)owed+=Math.max(0,q.from-from);from=Math.max(from,q.from);state=q;}
    if(moving(state)||state.skill)owed+=Math.max(0,this.known+1-from);
    return owed;
  }
  private inert(){return !moving(this.held)&&!this.held.skill&&this.held.target===this.appliedTarget;}
  state():InputTrackState{
    return {applied:this.applied,lastFrom:this.lastFrom,known:this.known,held:{...this.held},queue:this.queue.map(s=>({...s})),skillPress:this.skillPress,batched:this.batched,knownAt:this.knownAt,lastCast:this.lastCast,casts:[...this.castQueue],
      ...(this.appliedTarget!==undefined?{appliedTarget:this.appliedTarget}:{})};
  }
}
const movable=(p:SimPlayer)=>!p.downed&&!p.eliminated&&p.hp>0&&!p.spectator;
/** A batch, or a legacy single step as a one-segment batch. */
function toBatch(value:unknown):InputBatch|undefined{
  if(!value||typeof value!=='object')return undefined;
  const v=value as Record<string,unknown>;
  if(Array.isArray(v.steps)){
    if(!validSeq(v.seq)||v.steps.length>MAX_SEGMENTS)return undefined;
    return {seq:v.seq,steps:v.steps as SegmentWire[]};
  }
  if(!validSeq(v.seq)||typeof v.attack!=='boolean'||(v.skill!==undefined&&typeof v.skill!=='boolean'))return undefined;
  const wire:SegmentWire=[v.seq,v.x as number,v.y as number,v.skill?1:0];
  if(v.target!==undefined)wire.push(v.target as string);
  return {seq:v.seq,steps:[wire]};
}
