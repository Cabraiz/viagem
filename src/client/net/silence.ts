/**
 * NEW-20261013-E5-3g-socket-morto: how long a silence means the socket is dead, from the link itself.
 *
 * The room sends a frame every 100 ms in every phase, so a long silence is a dead socket, except that a lossy link
 * (3G) holds messages back while TCP resends a lost one, and the ones behind it wait (head-of-line blocking). The
 * fixed 8 s rule waited out those stalls but also turned a 3 s outage into ~9 s offline. This keeps the longest gaps
 * the link really had lately and calls the socket dead only past SAFETY times that, between DEAD_MIN_MS and
 * DEAD_MAX_MS (the old rule).
 */

/** Never sooner than this (ms): a few lost segments in a row on 3G are already ~2.4 s (3 round trips of 800 ms). */
export const DEAD_MIN_MS=3000;
/** Never later than this (ms): the rule before this card. */
export const DEAD_MAX_MS=8000;
/** The silence must be this many times the longest recent gap. */
export const SAFETY=2.5;
/** How fast an old long gap stops counting (its weight halves every this many ms of link time). */
export const GAP_HALF_LIFE_MS=60_000;
/** Gaps over this are not the link's own stalls but a drop (the socket closes before it ends): not learned. */
const LEARN_MAX_MS=DEAD_MAX_MS;

/**
 * The longest recent gap between two messages, decaying with GAP_HALF_LIFE_MS, and the silence limit it gives. One
 * per client: the stalls belong to the phone's network, not to a socket; a socket that ends cuts the count (cut()), so
 * the time offline before the next one is never learned as a stall.
 */
export class SilenceWatch {
  private last?:number;
  /** The decayed longest gap (ms) and when it was last updated. */
  private peak=0;private peakAt=0;
  /** A message arrived at `now` (performance.now ms). */
  heard(now:number){
    const last=this.last;this.last=now;
    if(last===undefined)return;
    const gap=now-last;
    if(!(gap>0)||gap>LEARN_MAX_MS)return;
    const decayed=this.decayed(now);
    if(gap>=decayed){this.peak=gap;this.peakAt=now;}
  }
  private decayed(now:number){return this.peak*2**(-(Math.max(0,now-this.peakAt))/GAP_HALF_LIFE_MS);}
  /** The silence (ms) past which the socket is called dead now. */
  limit(now:number){return Math.max(DEAD_MIN_MS,Math.min(DEAD_MAX_MS,SAFETY*this.decayed(now)));}
  /** The socket ended: the next message starts a new count (the gap across a reconnection is not the link's). */
  cut(){this.last=undefined;}
}
