import {randomSeed,DEFAULT_SEED} from '../src/game/terrain/field.ts';
import { DurableObject } from 'cloudflare:workers';
import { Room, type Peer } from './room.ts';
interface Env { ROOMS:DurableObjectNamespace<GameRoom>; ALLOW_LOCAL:string; CREATE_LIMIT:RateLimit; }
const origins=new Set(['https://viagem.cyou','https://www.viagem.cyou']);
function allowed(request:Request,env:Env){const origin=request.headers.get('Origin')??'';return origins.has(origin)||(env.ALLOW_LOCAL==='true'&&origin==='http://127.0.0.1:4187');}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return Response.json({status:'ok',service:'viagem-salas',protocol:3});
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
    const match=url.pathname.match(/^\/room\/([A-F0-9]{10})$/);
    if(match&&request.method==='GET'&&request.headers.get('Upgrade')?.toLowerCase()==='websocket')return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    return new Response('Not found',{status:404,headers});
  }
};
export class GameRoom extends DurableObject<Env>{
  private room?:Room;
  private timer?:ReturnType<typeof setInterval>;
  private peers=new Map<WebSocket,Peer>();
  async init(){if(!(await this.ctx.storage.get('created'))){const now=Date.now();const seed=randomSeed();await this.ctx.storage.put({created:now,terrainSeed:seed});this.room=new Room(now,seed);await this.ctx.storage.setAlarm(now+31*60_000);}}
  async fetch(_request:Request){
    const created=await this.ctx.storage.get<number>('created');
    if(!created||Date.now()-created>30*60_000)return new Response('Sala inexistente ou encerrada.',{status:404});
    this.room??=new Room(created,(await this.ctx.storage.get<number>('terrainSeed'))??DEFAULT_SEED);
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();
    const peer:Peer={send:data=>server.send(data),close:(code,reason)=>server.close(code,reason)};
    this.peers.set(server,peer);this.room.connect(peer);
    server.addEventListener('message',e=>{if(typeof e.data==='string')this.room?.receive(peer,e.data);else server.close(1003,'Texto esperado.');});
    const close=()=>{this.room?.disconnect(peer);this.peers.delete(server);if(!this.peers.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}};
    server.addEventListener('close',close);server.addEventListener('error',close);
    this.timer??=setInterval(()=>this.room?.advance(),50);
    return new Response(null,{status:101,webSocket:client});
  }
  async alarm(){for(const ws of this.peers.keys())ws.close(4004,'Sala encerrada.');if(this.timer)clearInterval(this.timer);this.timer=undefined;this.room=undefined;await this.ctx.storage.deleteAll();}
}
