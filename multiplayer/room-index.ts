/**
 * NEW-20261013-ORQ-deploy-worker-sem-derrubar: which rooms are in a match right now, so a Worker deploy (which restarts
 * every Durable Object and sends the matches back to the lobby) can wait for them (scripts/deploy-rooms.mjs).
 *
 * One Durable Object (idFromName('index')) keeps one row per room: in a match or not, how many people, and until when the
 * row can be true at most (the room's end of life), so a room that never reports again (evicted, crashed) drops out on
 * its own. Rooms report only when their match starts or ends (a few requests per run, not per tick).
 */
import {DurableObject} from 'cloudflare:workers';

/** One room's row. `until`: the room's end of life (ms): past it the row is stale whatever it says. */
export interface IndexRow {running:boolean;players:number;until:number}
/** What /health/rooms answers. `endsBy`: the latest moment a running match can still be on (ms), 0 with none. */
export interface IndexSummary {rooms:number;running:number;players:number;endsBy:number}
/** The slice of Durable Object storage the index uses (a Map-backed fake in the tests). */
export interface IndexStorage {
  put(key:string,value:IndexRow):Promise<void>;
  delete(key:string|string[]):Promise<unknown>;
  list<T>(options:{prefix:string}):Promise<Map<string,T>>;
}
const KEY='r:';
const valid=(r:unknown):r is IndexRow=>!!r&&typeof (r as IndexRow).running==='boolean'&&Number.isFinite((r as IndexRow).until);

/** A room's report: its row, or null when it is gone (alarm). */
export async function report(storage:IndexStorage,code:string,row:IndexRow|null){
  if(typeof code!=='string'||!code||code.length>64)return;
  if(row&&valid(row))await storage.put(KEY+code,{running:row.running,players:Math.max(0,Math.floor(row.players)||0),until:row.until});
  else await storage.delete(KEY+code);
}
/** Counts the live rows and forgets the stale ones. */
export async function summary(storage:IndexStorage,now:number):Promise<IndexSummary>{
  const rows=await storage.list<IndexRow>({prefix:KEY}),stale:string[]=[];
  const out:IndexSummary={rooms:0,running:0,players:0,endsBy:0};
  for(const [key,row] of rows){
    if(!valid(row)||row.until<=now){stale.push(key);continue;}
    out.rooms++;
    if(row.running){out.running++;out.players+=row.players;out.endsBy=Math.max(out.endsBy,row.until);}
  }
  if(stale.length)await storage.delete(stale);
  return out;
}

export class RoomIndex extends DurableObject {
  report(code:string,row:IndexRow|null){return report(this.ctx.storage as unknown as IndexStorage,code,row);}
  summary(){return summary(this.ctx.storage as unknown as IndexStorage,Date.now());}
}
