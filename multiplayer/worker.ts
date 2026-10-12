import {randomSeed,DEFAULT_SEED} from '../src/maps/index.ts';
import { DurableObject } from 'cloudflare:workers';
import { Room, type Peer, type RoomRoster } from './room.ts';
import {ROOM_PROTOCOL} from '../src/protocol/index.ts';
import { isAllowedOrigin } from './origins.ts';
import { TickLoop } from './tick-clock.ts';
import {parseZueiraLab} from '../src/sim/index.ts';
/**
 * Lab vars, wrangler dev only (ignored unless ALLOW_LOCAL): LAB_WORLD 'ilha' opens rooms on the old island (internal test
 * world; every room is on the endless map otherwise); LAB_HORDE n keeps n critters on the players (stress measure, see
 * RoomOptions.labHorde); LAB_OFFSET "x,y" starts the runs that far from the base (map prints); LAB_ZUEIRA "apagao,boletos"
 * plays those zueira events one per round from round 2 (VGM-053B proofs).
 */
/** What the room needs of a server-side WebSocket (the tests pass a fake one). */
export type RoomSocket=Pick<WebSocket,'send'|'close'|'addEventListener'>;
interface Env { ROOMS:DurableObjectNamespace<GameRoom>; ALLOW_LOCAL:string; CREATE_LIMIT:RateLimit; LAB_WORLD?:string; LAB_HORDE?:string; LAB_OFFSET?:string; LAB_ZUEIRA?:string; }
const local=(env:Env)=>env.ALLOW_LOCAL==='true';
/** LAB_OFFSET "x,y" (units): where the lab runs start, relative to the base. */
const labOffset=(value?:string)=>{const [x,y]=(value??'').split(',').map(Number);return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:undefined;};
function allowed(request:Request,env:Env){return isAllowedOrigin(request.headers.get('Origin')??'',env.ALLOW_LOCAL==='true');}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return Response.json({status:'ok',service:'viagem-salas',protocol:ROOM_PROTOCOL});
    if(!allowed(request,env))return new Response('Origin not allowed',{status:403});
    const headers={'Access-Control-Allow-Origin':request.headers.get('Origin')!,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(url.pathname==='/rooms'&&request.method==='POST'){
      const limit=await env.CREATE_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'});
      if(!limit.success)return Response.json({error:'Aguarde um minuto antes de criar outra sala.'},{status:429,headers});
      const code=crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase();
      const stub=env.ROOMS.get(env.ROOMS.idFromName(code));
      await stub.init();return Response.json({code},{status:201,headers});
    }
    // Lab report of a room (tick/encode cost, bytes per client): local dev only, never on the deployed Worker.
    const lab=url.pathname.match(/^\/lab\/([A-F0-9]{10})$/);
    if(lab&&local(env)&&request.method==='GET')return Response.json(await env.ROOMS.get(env.ROOMS.idFromName(lab[1])).lab(),{headers});
    const match=url.pathname.match(/^\/room\/([A-F0-9]{10})$/);
    if(match&&request.method==='GET'&&request.headers.get('Upgrade')?.toLowerCase()==='websocket')return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    return new Response('Not found',{status:404,headers});
  }
};
export class GameRoom extends DurableObject<Env>{
  private room?:Room;
  /** The room being built from storage (a restarted object): concurrent reconnects wait for the same one. */
  private loading?:Promise<Room>;
  /** Wall clock with catch-up (N17): 20 ticks/s of real time while someone is connected. */
  private loop=new TickLoop((now,last)=>this.room?.advance(now,last),{now:()=>Date.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:h=>clearTimeout(h as ReturnType<typeof setTimeout>)});
  private peers=new Map<RoomSocket,Peer>();
  async init(){if(!(await this.ctx.storage.get('created'))){const now=Date.now();const seed=randomSeed();await this.ctx.storage.put({created:now,terrainSeed:seed});this.room=this.create(now,seed);this.loading=Promise.resolve(this.room);await this.ctx.storage.setAlarm(now+31*60_000);}}
  private create(created:number,seed:number){
    // VGM-047: the roster (one row) follows joins, leaves and the combat start/end, for a restart of this object.
    const onRoster=(roster:RoomRoster)=>{void this.ctx.storage.put('roster',roster);};
    // BUG-20261012-ORQ-reconecta-round2: one JSON line per socket end (closeLogLine), read with `wrangler tail`.
    const log=(line:string)=>console.log(line);
    if(!local(this.env))return new Room(created,seed,{onRoster,log});
    return new Room(created,seed,{onRoster,log,lab:true,...(this.env.LAB_WORLD==='ilha'?{world:'ilha' as const}:{}),labHorde:Number(this.env.LAB_HORDE)||0,labOffset:labOffset(this.env.LAB_OFFSET),labZueira:parseZueiraLab(this.env.LAB_ZUEIRA)});
  }
  /** A restarted object (deploy, eviction): the same room seed, everyone seated again from the stored roster. */
  private load(created:number){
    return this.loading??=(async()=>{
      const room=this.create(created,(await this.ctx.storage.get<number>('terrainSeed'))??DEFAULT_SEED);
      const roster=await this.ctx.storage.get<RoomRoster>('roster');
      if(roster)room.restore(roster);
      return this.room=room;
    })();
  }
  /** Lab report (RPC from the /lab route); null on the deployed Worker even if something calls it. */
  lab(){if(!local(this.env)||!this.room)return null;return {...this.room.lab(),clock:this.loop.clock.stats};}
  async fetch(_request:Request){
    const created=await this.ctx.storage.get<number>('created');
    if(!created||Date.now()-created>30*60_000)return new Response('Sala inexistente ou encerrada.',{status:404});
    const room=this.room??await this.load(created);
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();
    this.attach(server,room);
    return new Response(null,{status:101,webSocket:client});
  }
  /**
   * Wires one accepted socket to the room. Closing from the room's side (a phone gone silent, a refused join) takes
   * the socket out at once: with no network the close handshake never ends and no 'close' event would come, so the
   * room would tick (and bill duration) until the alarm. No socket left (room bots have none): the clock stops.
   * Every socket end is logged once by the room (Room.closed for the socket's events, the room's own closes otherwise):
   * a close event after the room already closed the socket finds it gone from `peers` and logs nothing.
   */
  attach(server:RoomSocket,room:Room){
    const peer:Peer={send:data=>server.send(data),close:(code,reason)=>{this.drop(server);try{server.close(code,reason);}catch{/* already closed */}}};
    this.peers.set(server,peer);room.connect(peer);
    server.addEventListener('message',e=>{if(typeof e.data==='string')this.room?.receive(peer,e.data);else if(this.room)this.room.close(peer,1003,'Texto esperado.');else peer.close(1003,'Texto esperado.');});
    const close=(by:'client'|'error',e?:Partial<CloseEvent>)=>{
      if(this.peers.has(server))this.room?.closed(peer,by==='error'?{by}:{by,code:e?.code,reason:e?.reason,clean:e?.wasClean});
      this.drop(server);
    };
    server.addEventListener('close',e=>close('client',e));server.addEventListener('error',()=>close('error'));
    this.loop.start();
  }
  private drop(server:RoomSocket){this.peers.delete(server);if(!this.peers.size)this.loop.stop();}
  async alarm(){for(const peer of [...this.peers.values()])if(this.room)this.room.close(peer,4004,'Sala encerrada.');else peer.close(4004,'Sala encerrada.');this.loop.stop();this.room=undefined;this.loading=undefined;await this.ctx.storage.deleteAll();}
}
