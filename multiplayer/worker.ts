import {randomSeed,DEFAULT_SEED} from '../src/maps/index.ts';
import { DurableObject } from 'cloudflare:workers';
import { Room, ROOM_LIFETIME_MS, type Peer, type RoomOptions, type RoomRoster } from './room.ts';
import {ROOM_DEFAULT_MAP,ROOM_PROTOCOL,readMapRef,type MapRef} from '../src/protocol/index.ts';
import { isAllowedOrigin } from './origins.ts';
import { TickLoop } from './tick-clock.ts';
import {parseZueiraLab} from '../src/sim/index.ts';
import {RoomIndex,type IndexRow} from './room-index.ts';
// wrangler binds the classes the main module exports.
export {RoomIndex};
/**
 * Lab vars, wrangler dev only (ignored unless ALLOW_LOCAL): LAB_WORLD 'ilha' opens rooms on the old island (internal test
 * world; every room is on the endless map otherwise); LAB_HORDE n keeps n critters on the players (stress measure, see
 * RoomOptions.labHorde); LAB_OFFSET "x,y" starts the runs that far from the base (map prints); LAB_ZUEIRA "apagao,boletos"
 * plays those zueira events one per round from round 2 (VGM-053B proofs).
 */
/** What the room needs of a server-side WebSocket (the tests pass a fake one). */
export type RoomSocket=Pick<WebSocket,'send'|'close'|'addEventListener'>;
interface Env { ROOMS:DurableObjectNamespace<GameRoom>; INDEX?:DurableObjectNamespace<RoomIndex>; ALLOW_LOCAL:string; CREATE_LIMIT:RateLimit; LAB_WORLD?:string; LAB_HORDE?:string; LAB_OFFSET?:string; LAB_ZUEIRA?:string; }
const local=(env:Env)=>env.ALLOW_LOCAL==='true';
/** LAB_OFFSET "x,y" (units): where the lab runs start, relative to the base. */
const labOffset=(value?:string)=>{const [x,y]=(value??'').split(',').map(Number);return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:undefined;};
/**
 * The city asset (D-034/D-035, design/cidade-protocolo.md §2): its exact text, bundled as a wrangler Text module
 * (wrangler.jsonc `rules`) so the sha256 is over the same bytes the client downloads, and the manifest's ref. Imported
 * once per isolate, on the first room built here (node tests that load worker.ts never reach it); undefined when it
 * cannot load or the manifest is not a valid ref: the room then has no city (it stays locked until cidade-10 anyway).
 */
type CityAsset={text:string;ref:MapRef};
let cityLoad:Promise<CityAsset|undefined>|undefined;
const loadCity=()=>cityLoad??=Promise.all([import('../public/maps/cidade-nevada.json'),import('../public/maps/cidade-nevada.manifest.json')]).then(([asset,manifest])=>{
  // tsc types any .json import as the parsed object; the Text rule makes this one the file's text, checked here.
  const text:unknown=asset.default,ref=readMapRef({id:manifest.default.id,version:manifest.default.version,hash:manifest.default.hash});
  if(typeof text!=='string'||ref?.id!=='cidade-nevada')throw new Error('invalid city asset');
  return {text,ref};
}).catch((error:unknown)=>{console.log(JSON.stringify({ev:'map',asset:'cidade-nevada',error:String(error).slice(0,120)}));return undefined;});
function allowed(request:Request,env:Env){return isAllowedOrigin(request.headers.get('Origin')??'',env.ALLOW_LOCAL==='true');}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return Response.json({status:'ok',service:'viagem-salas',protocol:ROOM_PROTOCOL});
    // deploy-worker-sem-derrubar: rooms in a match now (a deploy restarts them all), for scripts/deploy-rooms.mjs.
    if(url.pathname==='/health/rooms'&&request.method==='GET'){
      if(!env.INDEX)return Response.json({error:'sem índice'},{status:503});
      return Response.json(await env.INDEX.get(env.INDEX.idFromName('index')).summary(),{headers:{'Cache-Control':'no-store'}});
    }
    if(!allowed(request,env))return new Response('Origin not allowed',{status:403});
    const headers={'Access-Control-Allow-Origin':request.headers.get('Origin')!,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(url.pathname==='/rooms'&&request.method==='POST'){
      const limit=await env.CREATE_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'});
      if(!limit.success)return Response.json({error:'Aguarde um minuto antes de criar outra sala.'},{status:429,headers});
      const code=crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase();
      const stub=env.ROOMS.get(env.ROOMS.idFromName(code));
      await stub.init(code);return Response.json({code},{status:201,headers});
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
  /** The bundled city (loadCity), handed to every Room this object builds. */
  private city?:CityAsset;
  /**
   * The map new rooms open on (ROOM_DEFAULT_MAP, flipped in src/protocol/map-catalog.ts) and, when set, whether the
   * city is playable (Room's CITY_PLAYABLE otherwise). Only tests change it, to build the flipped Worker without
   * touching the constants.
   */
  private defaults:Pick<RoomOptions,'map'|'cityPlayable'>={map:ROOM_DEFAULT_MAP};
  /** The room code (stored at init) and creation time: this room's row in the RoomIndex. */
  private code?:string;
  private created=0;
  /** Whether the last row sent said "in a match" (rows go only when that changes). */
  private indexed?:boolean;
  /** The roster's last word: a match is on (the run is in combat). */
  private matchOn=false;
  private rosterPlayers=0;
  /**
   * The row says "in a match" while the run is in combat AND someone is connected: a match everybody left does not
   * tick (no socket, no clock) and a deploy costs it nothing more, so it must not hold a deploy back for 50 min.
   */
  private syncIndex(){
    const running=this.matchOn&&this.peers.size>0;
    if(running===this.indexed)return;
    this.indexed=running;
    this.index({running,players:this.rosterPlayers,until:this.created+ROOM_LIFETIME_MS});
  }
  /** Tells the RoomIndex (a match started or ended, or the room is gone: null). Never fails the room. */
  private index(row:IndexRow|null){
    const ns=this.env.INDEX,code=this.code??this.ctx.id?.toString?.();
    if(!ns||!code)return;
    const done=ns.get(ns.idFromName('index')).report(code,row).catch(()=>{});
    try{this.ctx.waitUntil?.(done);}catch{/* outside a request: the promise still runs */}
  }
  /**
   * A new room (POST /rooms). A room on the city waits for it to decode before anyone is seated (like load()): the
   * first welcome already names the city, with no {t:'map'} right after it. The code goes back only after this.
   */
  async init(code?:string){
    this.city??=await loadCity();
    if(await this.ctx.storage.get('created'))return;
    const now=Date.now(),seed=randomSeed();
    this.code=code;this.created=now;
    await this.ctx.storage.put({created:now,terrainSeed:seed,...(code?{code}:{})});
    const room=this.create(now,seed);
    await (this.loading=room.ready().then(()=>this.room=room));
    await this.ctx.storage.setAlarm(now+ROOM_LIFETIME_MS+60_000);
  }
  private create(created:number,seed:number){
    // VGM-047: the roster (one row) follows joins, leaves and the combat start/end, for a restart of this object.
    // deploy-worker-sem-derrubar: the RoomIndex hears when the match starts and ends (the roster says `running`).
    const onRoster=(roster:RoomRoster)=>{
      void this.ctx.storage.put('roster',roster);
      this.matchOn=roster.running===true;this.rosterPlayers=roster.players?.length??0;this.created||=created;
      this.syncIndex();
    };
    // BUG-20261012-ORQ-reconecta-round2: one JSON line per socket end (closeLogLine), read with `wrangler tail`.
    const log=(line:string)=>console.log(line);
    const city=this.city?{cityText:this.city.text,cityRef:this.city.ref}:{};
    if(!local(this.env))return new Room(created,seed,{onRoster,log,...city,...this.defaults});
    // LAB_WORLD 'ilha' is the endless map's slot on the island: those lab rooms stay on it whatever the default.
    return new Room(created,seed,{onRoster,log,...city,...this.defaults,lab:true,...(this.env.LAB_WORLD==='ilha'?{world:'ilha' as const,map:'infinito' as const}:{}),labHorde:Number(this.env.LAB_HORDE)||0,labOffset:labOffset(this.env.LAB_OFFSET),labZueira:parseZueiraLab(this.env.LAB_ZUEIRA)});
  }
  /** A restarted object (deploy, eviction): the same room seed, everyone seated again from the stored roster. */
  private load(created:number){
    return this.loading??=(async()=>{
      this.city??=await loadCity();
      this.code??=await this.ctx.storage.get<string>('code');this.created=created;
      const room=this.create(created,(await this.ctx.storage.get<number>('terrainSeed'))??DEFAULT_SEED);
      const roster=await this.ctx.storage.get<RoomRoster>('roster');
      if(roster)room.restore(roster);
      // A room restored on the city waits for it to decode before anyone is seated again.
      await room.ready();
      return this.room=room;
    })();
  }
  /** Lab report (RPC from the /lab route); null on the deployed Worker even if something calls it. */
  lab(){if(!local(this.env)||!this.room)return null;return {...this.room.lab(),clock:this.loop.clock.stats};}
  async fetch(_request:Request){
    const created=await this.ctx.storage.get<number>('created');
    if(!created||Date.now()-created>ROOM_LIFETIME_MS)return new Response('Sala inexistente ou encerrada.',{status:404});
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
    const ERROR_CLOSE_WAIT_MS=2000;
    const peer:Peer={send:data=>server.send(data),close:(code,reason)=>{this.drop(server);try{server.close(code,reason);}catch{/* already closed */}}};
    this.peers.set(server,peer);room.connect(peer);this.syncIndex();
    server.addEventListener('message',e=>{if(typeof e.data==='string')this.room?.receive(peer,e.data);else if(this.room)this.room.close(peer,1003,'Texto esperado.');else peer.close(1003,'Texto esperado.');});
    // An abnormal end may fire 'error' before 'close': the close event carries the code (1006) and wasClean the log
    // is for, so an error only marks the socket and waits; with no close event in ERROR_CLOSE_WAIT_MS it ends anyway.
    let errored=false,fallback:ReturnType<typeof setTimeout>|undefined;
    const close=(by:'client'|'error',e?:Partial<CloseEvent>)=>{
      clearTimeout(fallback);
      if(this.peers.has(server))this.room?.closed(peer,{by,code:e?.code,reason:e?.reason,clean:e?.wasClean});
      this.drop(server);
    };
    server.addEventListener('close',e=>close(errored?'error':'client',e));
    server.addEventListener('error',()=>{if(errored)return;errored=true;fallback=setTimeout(()=>close('error'),ERROR_CLOSE_WAIT_MS);});
    this.loop.start();
  }
  private drop(server:RoomSocket){this.peers.delete(server);if(!this.peers.size)this.loop.stop();this.syncIndex();}
  async alarm(){this.index(null);for(const peer of [...this.peers.values()])if(this.room)this.room.close(peer,4004,'Sala encerrada.');else peer.close(4004,'Sala encerrada.');this.loop.stop();this.room=undefined;this.loading=undefined;await this.ctx.storage.deleteAll();}
}
