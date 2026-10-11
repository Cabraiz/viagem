import {randomSeed,DEFAULT_SEED} from '../src/game/terrain/field.ts';
import { DurableObject } from 'cloudflare:workers';
import { Room, type Peer, type RoomRoster } from './room.ts';
import { ROOM_PROTOCOL } from '../src/game/net/shared.ts';
import { isAllowedOrigin } from './origins.ts';
/**
 * Lab vars, wrangler dev only (ignored unless ALLOW_LOCAL): LAB_WORLD 'infinito' opens rooms in the endless world before it
 * ships; LAB_HORDE n keeps n critters on the players (stress measure, see RoomOptions.labHorde).
 */
interface Env { ROOMS:DurableObjectNamespace<GameRoom>; ALLOW_LOCAL:string; CREATE_LIMIT:RateLimit; LAB_WORLD?:string; LAB_HORDE?:string; }
const local=(env:Env)=>env.ALLOW_LOCAL==='true';
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
  private timer?:ReturnType<typeof setInterval>;
  private peers=new Map<WebSocket,Peer>();
  async init(){if(!(await this.ctx.storage.get('created'))){const now=Date.now();const seed=randomSeed();await this.ctx.storage.put({created:now,terrainSeed:seed});this.room=this.create(now,seed);this.loading=Promise.resolve(this.room);await this.ctx.storage.setAlarm(now+31*60_000);}}
  private create(created:number,seed:number){
    // VGM-047: the roster (one row) follows joins, leaves and the combat start/end, for a restart of this object.
    const onRoster=(roster:RoomRoster)=>{void this.ctx.storage.put('roster',roster);};
    if(!local(this.env))return new Room(created,seed,{onRoster});
    return new Room(created,seed,{onRoster,lab:true,...(this.env.LAB_WORLD==='infinito'?{world:'infinito' as const}:{}),labHorde:Number(this.env.LAB_HORDE)||0});
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
  lab(){return local(this.env)?this.room?.lab()??null:null;}
  async fetch(_request:Request){
    const created=await this.ctx.storage.get<number>('created');
    if(!created||Date.now()-created>30*60_000)return new Response('Sala inexistente ou encerrada.',{status:404});
    const room=this.room??await this.load(created);
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();
    const peer:Peer={send:data=>server.send(data),close:(code,reason)=>server.close(code,reason)};
    this.peers.set(server,peer);room.connect(peer);
    server.addEventListener('message',e=>{if(typeof e.data==='string')this.room?.receive(peer,e.data);else server.close(1003,'Texto esperado.');});
    const close=()=>{this.room?.disconnect(peer);this.peers.delete(server);if(!this.peers.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}};
    server.addEventListener('close',close);server.addEventListener('error',close);
    this.timer??=setInterval(()=>this.room?.advance(),50);
    return new Response(null,{status:101,webSocket:client});
  }
  async alarm(){for(const ws of this.peers.keys())ws.close(4004,'Sala encerrada.');if(this.timer)clearInterval(this.timer);this.timer=undefined;this.room=undefined;this.loading=undefined;await this.ctx.storage.deleteAll();}
}
