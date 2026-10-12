/**
 * Numbers for the VGM-045 artifacts: percentiles, per-second rates over a window, tick samples stitched from the
 * room's /lab polls, and the free-plan arithmetic (D-024). Pure, tested in tests/tools/bots.test.ts.
 */
import type {SecondSample} from './lab-socket.ts';

export function percentile(list:readonly number[],q:number){
  if(!list.length)return 0;
  const sorted=[...list].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(q*sorted.length)-1))];
}
export const mean=(list:readonly number[])=>list.length?list.reduce((a,b)=>a+b,0)/list.length:0;
const r2=(n:number)=>Math.round(n*100)/100;

/** Per-second link counters between two seconds (inclusive start, exclusive end): mean, p95 and peak of each. */
export function rates(seconds:readonly SecondSample[],from:number,to:number){
  const window:SecondSample[]=[];
  for(let s=Math.max(0,from);s<to;s++)window.push(seconds[s]??{second:s,up:0,down:0,upBytes:0,downBytes:0,frames:0});
  const stat=(f:(s:SecondSample)=>number)=>{const v=window.map(f);return {mean:r2(mean(v)),p95:r2(percentile(v,.95)),max:r2(Math.max(0,...v))};};
  return {seconds:window.length,upMsgs:stat(s=>s.up),downMsgs:stat(s=>s.down),downFrames:stat(s=>s.frames),upBytes:stat(s=>s.upBytes),downBytes:stat(s=>s.downBytes),
    totalUp:window.reduce((a,s)=>a+s.up,0),totalDown:window.reduce((a,s)=>a+s.down,0),totalDownBytes:window.reduce((a,s)=>a+s.downBytes,0)};
}

/**
 * Stitches the room's per-tick samples from successive /lab polls: each poll has the last ≤1200 ticks (`samples`,
 * newest last) and the running tick count; only the ticks after the previous poll are new. Polls further apart than
 * the window lose the ticks in between (counted in `missed`).
 */
export class TickStitcher {
  samples:number[]=[];missed=0;private last=-1;
  add(ticks:number,samples:readonly number[]){
    if(this.last<0){this.last=ticks;return;}
    const fresh=ticks-this.last;this.last=ticks;
    if(fresh<=0)return;
    const take=Math.min(fresh,samples.length);
    this.missed+=fresh-take;
    for(const s of samples.slice(samples.length-take))this.samples.push(s);
  }
  summary(){
    const s=this.samples;
    return {ticks:s.length,missed:this.missed,p50:percentile(s,.5),p95:percentile(s,.95),p99:percentile(s,.99),max:Math.max(0,...s),mean:Math.round(mean(s)*1000)/1000,
      over50ms:s.filter(x=>x>50).length};
  }
}

/**
 * Free plan (Cloudflare Durable Objects pricing, D-024): 100 000 requests/day, where each WebSocket connection is a
 * request and every 20 incoming WebSocket messages bill as 1 (outgoing are free); 13 000 GB-s/day of duration, billed
 * on the object's 128 MB for as long as a WebSocket is connected (no hibernation: the room ticks); 100 000 SQLite
 * rows written/day. https://developers.cloudflare.com/durable-objects/platform/pricing/
 */
export const FREE_PLAN={requestsPerDay:100_000,messagesPerRequest:20,gbSecondsPerDay:13_000,memoryGb:128/1024,rowsWrittenPerDay:100_000} as const;
export interface MatchCost {
  /** WebSocket messages the room received in the match (all players, lobby to leave). */
  incomingMessages:number;
  /** WebSocket connections (joins and reconnections): one request each. */
  connections:number;
  /** Other requests to the object: the create RPC and the closing alarm. */
  otherRequests:number;
  /** Seconds the room had a socket connected (lobby, run, result). */
  activeSeconds:number;
  /** SQLite rows written (roster, creation, the final delete). */
  rowsWritten:number;
}
export function freePlan(cost:MatchCost){
  const requests=cost.connections+cost.otherRequests+Math.ceil(cost.incomingMessages/FREE_PLAN.messagesPerRequest);
  const gbSeconds=cost.activeSeconds*FREE_PLAN.memoryGb;
  const byRequests=Math.floor(FREE_PLAN.requestsPerDay/Math.max(1,requests));
  const byDuration=Math.floor(FREE_PLAN.gbSecondsPerDay/Math.max(1e-9,gbSeconds));
  const byRows=Math.floor(FREE_PLAN.rowsWrittenPerDay/Math.max(1,cost.rowsWritten));
  const matches=Math.min(byRequests,byDuration,byRows);
  const limit=matches===byDuration?'duration':matches===byRequests?'requests':'rows';
  return {requests,gbSeconds:Math.round(gbSeconds),byRequests,byDuration,byRows,matchesPerDay:matches,limit};
}
