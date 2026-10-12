/**
 * N27 (slow phone): how far behind the room this page handles its frames, and when the scene should stop drawing to
 * catch up. Pure (no DOM), so the node tests drive it with fake clocks.
 *
 * A phone whose main thread is too slow for the scene (CPU 4–6× in the lab, SwiftShader) handles only a few of the
 * room's 10 frames a second: the rest wait in the page's task queue, and in the lab the queue reached 50 s. The phone
 * then plays a world almost a minute old, its inputs land that late, and the queue only grows. Drawing is what takes
 * the main thread (frames cost tens of ms to handle; a drawn frame, seconds), so while the backlog is big the scene
 * draws one frame every CATCH_UP_GATE_MS and the queue drains.
 */

/** Sim ticks per second of the room (RUN_HZ), as ms per tick. */
const TICK_MS=50;
/**
 * The backlog is measured against the least delayed frame of the last ANCHOR_WINDOW_MS ("arrival − tick time",
 * its smallest value). A queue that grows shows within the window; a step of the room's own clock (ticks dropped
 * under load, N17) or a slow drift of it is forgotten once the window passes it.
 */
export const ANCHOR_WINDOW_MS=20_000;
/** Start catching up at this backlog; stop below the lower one (hysteresis, so no flicker at the edge). */
export const CATCH_UP_ON_MS=3000,CATCH_UP_OFF_MS=600;
/** While catching up the scene draws at most once every this many ms (Phaser's frame gate). */
export const CATCH_UP_GATE_MS=2500;
/** A pong back within this long went through an empty queue (4G round trips are 0.1–0.5 s). */
export const SETTLE_RTT_MS=1000;

/** Backlog of a feed of frames: `frame(tick, now)` for each frame handled in combat; `reset()` on anything else. */
export class Backlog {
  /** Monotonic queue of (time, offset): offsets increase front to back, so the front is the window's minimum. */
  private window:{at:number;offset:number}[]=[];
  private lastTick=-1;private last?:number;
  /** Last estimate, ms (0 until a frame said otherwise). */
  ms=0;
  frame(tick:number,now:number){
    if(!Number.isFinite(tick)||!Number.isFinite(now))return this.ms;
    // A tick that went back (a new run, a restarted room) starts over.
    if(tick<this.lastTick)this.reset();
    this.lastTick=tick;
    const offset=this.last=now-tick*TICK_MS,w=this.window;
    while(w.length&&w[w.length-1].offset>=offset)w.pop();
    w.push({at:now,offset});
    while(w.length>1&&now-w[0].at>ANCHOR_WINDOW_MS)w.shift();
    return this.ms=offset-w[0].offset;
  }
  /**
   * Proof that nothing waits in the queue (a pong answered fast, see SETTLE_RTT_MS): the latest frame becomes the
   * only anchor.
   */
  settle(now:number){if(this.last===undefined)return;this.window=[{at:now,offset:this.last}];this.ms=0;}
  reset(){this.window=[];this.lastTick=-1;this.last=undefined;this.ms=0;}
}

/**
 * A backlog over CATCH_UP_ON_MS must last this long (every check in between over it) before the scene stops drawing:
 * a healthy phone after a 4G hiccup handles the burst of late frames in a few ms and never gets there.
 */
export const CATCH_UP_HOLD_MS=2000;
/** Whether the scene is catching up, with hysteresis. `update(backlogMs, now)` answers the state after this check. */
export class CatchUp {
  on=false;
  private above?:number;
  update(backlogMs:number,now:number){
    if(backlogMs>CATCH_UP_ON_MS)this.above??=now;else this.above=undefined;
    if(!this.on&&this.above!==undefined&&now-this.above>=CATCH_UP_HOLD_MS)this.on=true;
    else if(this.on&&backlogMs<CATCH_UP_OFF_MS)this.on=false;
    return this.on;
  }
}
