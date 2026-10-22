import {randomSeed,DEFAULT_SEED} from '../src/maps/index.ts';
import { DurableObject } from 'cloudflare:workers';
import { Room, ROOM_LIFETIME_MS, type Peer, type RoomCheckpoint, type RoomOptions, type RoomRoster } from './room.ts';
import {ROOM_DEFAULT_MAP,ROOM_PROTOCOL,isMapId,readMapRef,type MapRef,type RoomCreateOptions} from '../src/protocol/index.ts';
/** The largest create body read (bytes): {"map":"cidade-nevada","solo":true,"objective":"chaveiro","combat":"manual"} is 78. */
const CREATE_BODY_MAX=256;
/**
 * A stored row's options as they were created (sala-solo-privada; anything else is dropped). Only for a room restored
 * after a deploy: one created before rodada-legado keeps its waves, wall or automatic weapons to its end.
 */
export function storedOptions(v:unknown):RoomCreateOptions{
  const o=v as {map?:unknown;solo?:unknown;objective?:unknown;combat?:unknown;mode?:unknown}|null;
  if(!o||typeof o!=='object')return {};
  return {...(isMapId(o.map)?{map:o.map}:{}),...(o.solo===true?{solo:true as const}:{}),...(o.objective==='chaveiro'||o.objective==='muralha'?{objective:o.objective}:{}),
    ...(o.combat==='manual'?{combat:'manual' as const}:{}),...(o.mode==='ninhos'?{mode:o.mode}:{})};
}
/**
 * What a new room is created with, from an optional small JSON body: its map and solo (sala-solo-privada), and always the
 * nests with the manual combat (D-051, rodada-legado: the waves, the wall and the automatic weapons stay only in the code;
 * a body asking for them, or none at all from a cached old site, plays the nests). Anything else is dropped.
 */
export function createOptions(v:unknown):RoomCreateOptions{
  const o=storedOptions(v);
  return {...(o.map?{map:o.map}:{}),...(o.solo?{solo:true as const}:{}),...(o.objective==='chaveiro'?{objective:'chaveiro' as const}:{}),mode:'ninhos',combat:'manual'};
}
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
 * plays those zueira events one per round from round 2 (VGM-053B proofs); LAB_SEED n gives every new room that seed (the
 * same city plan in each run of a before/after); LAB_ASLEEP n caps each client's sleeping bodies at n, 'sem' = no cap
 * (card horda-visivel-capacidade).
 */
/** What the room needs of a server-side WebSocket (the tests pass a fake one). */
export type RoomSocket=Pick<WebSocket,'send'|'close'|'addEventListener'>;
/**
 * BUILD_SHA: the commit this Worker was published from (scripts/deploy-rooms.mjs passes it with `--var`); /health answers
 * it, so a deploy from a stale checkout shows at once (after 4e771dc went up from the lote's worktree without it).
 */
interface Env { ROOMS:DurableObjectNamespace<GameRoom>; INDEX?:DurableObjectNamespace<RoomIndex>; ALLOW_LOCAL:string; BUILD_SHA?:string; CREATE_LIMIT:RateLimit; LAB_WORLD?:string; LAB_HORDE?:string; LAB_OFFSET?:string; LAB_ZUEIRA?:string; LAB_SEED?:string; LAB_ASLEEP?:string; }
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
/**
 * The maps this Worker serves, as /health tells them (fila-deploy-seguro): pages.yml's gate (scripts/health-gate.mjs)
 * checks them against the site's public/maps/*.manifest.json, with the protocol, before it publishes the site. Only the
 * manifest (a few bytes), never the asset; {} when it cannot load.
 */
let mapsLoad:Promise<Record<string,{version:number;hash:string}>>|undefined;
const loadMaps=()=>mapsLoad??=import('../public/maps/cidade-nevada.manifest.json')
  .then(m=>({[m.default.id]:{version:m.default.version,hash:m.default.hash}})).catch(()=>({}));
function allowed(request:Request,env:Env){return isAllowedOrigin(request.headers.get('Origin')??'',env.ALLOW_LOCAL==='true');}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return Response.json({status:'ok',service:'viagem-salas',protocol:ROOM_PROTOCOL,maps:await loadMaps(),build:env.BUILD_SHA||'desconhecido'},{headers:{'Cache-Control':'no-store'}});
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
      // An optional JSON body (sent as plain text, so no CORS preflight): {map, solo} (sala-solo-privada).
      // None or junk (an old cached site): createOptions' own default, the nests with the manual combat.
      let asked:RoomCreateOptions=createOptions(null);
      // Read only a small declared body (review: a huge one is never buffered); none, chunked or junk: a plain room.
      const length=Number(request.headers.get('content-length')??'0');
      if(length>0&&length<=CREATE_BODY_MAX)try{asked=createOptions(JSON.parse(await request.text()));}catch{/* junk: a plain room */}
      await stub.init(code,asked);return Response.json({code},{status:201,headers});
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
  /** sala-solo-privada: what this room was created with (map, solo), kept in storage for a restart. */
  private asked:RoomCreateOptions={};
  /** The room code (stored at init) and creation time: this room's row in the RoomIndex. */
  private code?:string;
  private created=0;
  /** Whether the last row sent said "in a match" (rows go only when that changes). */
  private indexed?:boolean;
  /** The roster's last word: a match is on (the run is in combat). */
  private matchOn=false;
  private rosterPlayers=0;
  /** A 'checkpoint' row may be in storage (E5-checkpoint-por-round): deleted once a roster no longer links one. */
  private checkpointStored=false;
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
  /** One stub for the index (calls on the same stub arrive in order) and the chain of reports in flight. */
  private indexStub?:DurableObjectStub<RoomIndex>;
  private reports:Promise<unknown>=Promise.resolve();
  /**
   * Tells the RoomIndex (a match started or ended). Reports go one after the other, so a quick false-true (a phone that
   * drops and comes back at once) lands in order; a failed one forgets what was sent, so the next change resends.
   * Never fails the room.
   */
  private index(row:IndexRow){
    const ns=this.env.INDEX,code=this.code??this.ctx.id?.toString?.();
    if(!ns||!code)return;
    const stub=this.indexStub??=ns.get(ns.idFromName('index'));
    this.reports=this.reports.then(()=>stub.report(code,row)).catch(()=>{if(this.indexed===row.running)this.indexed=undefined;});
    try{this.ctx.waitUntil?.(this.reports);}catch{/* outside a request: the promise still runs */}
  }
  /**
   * A new room (POST /rooms). A room on the city waits for it to decode before anyone is seated (like load()): the
   * first welcome already names the city, with no {t:'map'} right after it. The code goes back only after this.
   */
  async init(code?:string,asked:RoomCreateOptions={}){
    this.city??=await loadCity();
    if(await this.ctx.storage.get('created'))return;
    const now=Date.now(),seed=local(this.env)&&Number.isInteger(Number(this.env.LAB_SEED))&&this.env.LAB_SEED?Number(this.env.LAB_SEED)>>>0:randomSeed();
    this.code=code;this.created=now;this.asked=createOptions(asked);
    const row:Record<string,unknown>={created:now,terrainSeed:seed};
    if(code)row.code=code;
    if(Object.keys(this.asked).length)row.options=this.asked;
    await this.ctx.storage.put(row);
    const room=this.create(now,seed);
    await (this.loading=room.ready().then(()=>this.room=room));
    await this.ctx.storage.setAlarm(now+ROOM_LIFETIME_MS+60_000);
  }
  private create(created:number,seed:number){
    // VGM-047: the roster (one row) follows joins, leaves and the combat start/end, for a restart of this object.
    // deploy-worker-sem-derrubar: the RoomIndex hears when the match starts and ends (the roster says `running`).
    const onRoster=(roster:RoomRoster)=>{
      void this.ctx.storage.put('roster',roster);
      // The run that checkpointed is over (result, rematch, everyone gone): its row goes, once.
      if(!roster.checkpoint&&this.checkpointStored){this.checkpointStored=false;void this.ctx.storage.delete('checkpoint');}
      this.matchOn=roster.running===true;this.rosterPlayers=roster.players?.length??0;this.created||=created;
      this.syncIndex();
    };
    // BUG-20261012-ORQ-reconecta-round2: one JSON line per socket end (closeLogLine), read with `wrangler tail`.
    const log=(line:string)=>console.log(line);
    // E5-checkpoint-por-round: the run at each round's intermission, in its own row (the roster links it).
    const onCheckpoint=(checkpoint:RoomCheckpoint)=>{void this.ctx.storage.put('checkpoint',checkpoint);this.checkpointStored=true;};
    const city=this.city?{cityText:this.city.text,cityRef:this.city.ref}:{};
    // sala-solo-privada: the map it was opened on and a solo room, as created (the defaults otherwise); D-047: the
    // objective the creator asked for: ?modo=chaveiro (the city's default anyway) or ?modo=muralha (the old wall mode).
    const objective=this.asked.objective==='muralha'?false as const:this.asked.objective;
    // D-051: ?combate=manual, the attack button (RoomOptions.combat); absent: the automatic weapons. ?modo=ninhos, the
    // nests instead of the waves (the room plays them only with the chaveiro in the city).
    const asked={...(this.asked.map?{map:this.asked.map}:{}),...(this.asked.solo?{solo:true}:{}),...(objective!==undefined?{objective}:{}),...(this.asked.combat?{combat:this.asked.combat}:{}),
      ...(this.asked.mode?{mode:this.asked.mode}:{})};
    if(!local(this.env))return new Room(created,seed,{onRoster,onCheckpoint,log,...city,...this.defaults,...asked});
    // LAB_WORLD 'ilha' is the endless map's slot on the island: those lab rooms stay on it whatever the default.
    return new Room(created,seed,{onRoster,onCheckpoint,log,...city,...this.defaults,...asked,lab:true,...(this.env.LAB_WORLD==='ilha'?{world:'ilha' as const,map:'infinito' as const}:{}),labHorde:Number(this.env.LAB_HORDE)||0,labOffset:labOffset(this.env.LAB_OFFSET),labZueira:parseZueiraLab(this.env.LAB_ZUEIRA),
      labAsleep:this.env.LAB_ASLEEP==='sem'?Number.MAX_SAFE_INTEGER:Number(this.env.LAB_ASLEEP)||undefined});
  }
  /**
   * A restarted object (deploy, eviction): the same room seed, everyone seated again from the stored roster. A run that
   * was in combat comes back from its checkpoint (E5-checkpoint-por-round) once the map is in (ready): the room checks
   * it is the one the roster links, of this version and map; otherwise the room stays in the lobby with the notice.
   */
  private load(created:number){
    return this.loading??=(async()=>{
      this.city??=await loadCity();
      this.code??=await this.ctx.storage.get<string>('code');this.created=created;
      this.asked=storedOptions(await this.ctx.storage.get('options'));
      const room=this.create(created,(await this.ctx.storage.get<number>('terrainSeed'))??DEFAULT_SEED);
      const roster=await this.ctx.storage.get<RoomRoster>('roster');
      if(roster)room.restore(roster);
      // A room restored on the city waits for it to decode before anyone is seated again.
      await room.ready();
      if(roster?.running===true){
        try{
          const checkpoint=await this.ctx.storage.get<RoomCheckpoint>('checkpoint');
          this.checkpointStored=checkpoint!==undefined;
          if(roster.checkpoint)room.resume(checkpoint);
        }catch{/* storage failed: today's lobby (room.resume never throws) */}
      }
      if(roster)room.afterRestart();
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
  async alarm(){for(const peer of [...this.peers.values()])if(this.room)this.room.close(peer,4004,'Sala encerrada.');else peer.close(4004,'Sala encerrada.');this.loop.stop();this.room=undefined;this.loading=undefined;await this.ctx.storage.deleteAll();}
}
