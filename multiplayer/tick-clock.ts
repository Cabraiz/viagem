/**
 * The room's wall clock (NEW-20261011-N17-relogio-da-sala): 20 ticks per second of real time, not "one tick per timer
 * fire". A plain setInterval(…,50) in workerd fired every ~52–53 ms and never caught up, so the room ran at 18.8–19.3
 * ticks/s: game time 3–6% slower than the clock, the phone (20 steps/s) ahead of the room, a full run ~1 min longer.
 *
 * TickClock keeps the instant of the next tick. Each fire runs the ticks that are due, at most MAX_TICKS_PER_FIRE of
 * them (the rest of a small debt goes on the next fires, scheduled with no delay); a room more than MAX_LAG_MS behind
 * (a long pause, a busy isolate) drops that debt instead of fast-forwarding the horde. TickLoop is the timer around it:
 * one setTimeout aimed at the next tick, so a late fire shortens the next wait instead of adding up.
 * Pure and timer-injected: tests/rooms/tick-clock.test.ts drives it with a fake clock.
 */
/** One room tick (RUN_HZ = 20). */
export const TICK_MS=50;
/** Ticks one fire may run back to back (a late fire catches up with 2, a very late one with 3). */
export const MAX_TICKS_PER_FIRE=3;
/** Behind by more than this (ms), the debt is dropped: one tick now and the clock starts over from here. */
export const MAX_LAG_MS=500;

export interface ClockStats {fires:number;
  /** Ticks really run (TickLoop counts them: a burst cut by stop() runs fewer than it was owed). */
  ticks:number;
  /** Fires that owed 0, 1, 2 and 3 ticks (index = ticks due in that fire). */
  bursts:number[];
  /** Ticks given up (debt over MAX_LAG_MS) and how many times that happened. */
  dropped:number;resets:number}

export class TickClock {
  private next=Number.NaN;
  readonly stats:ClockStats={fires:0,ticks:0,bursts:[0,0,0,0],dropped:0,resets:0};
  readonly stepMs:number;readonly maxPerFire:number;readonly maxLagMs:number;
  constructor(stepMs=TICK_MS,maxPerFire=MAX_TICKS_PER_FIRE,maxLagMs=MAX_LAG_MS){this.stepMs=stepMs;this.maxPerFire=maxPerFire;this.maxLagMs=maxLagMs;}
  /** The first tick is one step from now. */
  start(now:number){this.next=now+this.stepMs;}
  get started(){return Number.isFinite(this.next);}
  /** How many ticks to run at `now` (0 for an early fire); the next deadline moves past them. */
  due(now:number):number{
    if(!this.started)this.start(now);
    this.stats.fires++;
    let n=0;
    if(now>=this.next){
      const late=now-this.next;
      if(late>this.maxLagMs){
        // Too far behind to catch up honestly: drop the debt (one tick now) rather than run seconds of game at once.
        const owed=Math.floor(late/this.stepMs)+1;
        this.stats.dropped+=owed-1;this.stats.resets++;
        this.next=now+this.stepMs;n=1;
      }else{
        n=Math.min(this.maxPerFire,Math.floor(late/this.stepMs)+1);
        this.next+=n*this.stepMs;
      }
    }
    this.stats.bursts[n]++;
    return n;
  }
  /** Wait (ms, ≥ 0) until the next tick is due. */
  delay(now:number){return this.started?Math.max(0,this.next-now):this.stepMs;}
}

export interface Timers {now:()=>number;set:(fn:()=>void,ms:number)=>unknown;clear:(handle:unknown)=>void}

/** The room's timer: runs `tick(now)` on the wall clock while started; stop() cancels the pending fire. */
export class TickLoop {
  readonly clock:TickClock;
  private handle:unknown;
  private running=false;
  private readonly timers:Timers;
  private readonly tick:(now:number,last:boolean)=>void;
  /** `tick(now, last)`: `last` is false for the ticks of a catch-up burst before its final one (the room sends frames once, on the last). */
  constructor(tick:(now:number,last:boolean)=>void,timers:Timers,clock=new TickClock()){this.tick=tick;this.timers=timers;this.clock=clock;}
  get active(){return this.running;}
  start(){
    if(this.running)return;
    this.running=true;this.clock.start(this.timers.now());this.schedule();
  }
  stop(){
    this.running=false;
    if(this.handle!==undefined){this.timers.clear(this.handle);this.handle=undefined;}
  }
  private schedule(){this.handle=this.timers.set(()=>this.fire(),this.clock.delay(this.timers.now()));}
  private fire(){
    this.handle=undefined;
    if(!this.running)return;
    const now=this.timers.now();
    try{for(let n=this.clock.due(now);n>0&&this.running;n--){this.clock.stats.ticks++;this.tick(now,n===1);}}
    finally{if(this.running)this.schedule();}
  }
}
