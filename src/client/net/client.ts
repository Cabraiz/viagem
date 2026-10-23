import {perfNow,perfSpan} from '../dev/perf-flag.ts';
import {defaultTerrain,cityTerrainFor} from '../../maps/index.ts';
import {terrainFor} from './terrain.ts';
import {loadCity} from './city-asset-loader.ts';
import {STEP,carStepCap,reconcile,simulate,type FloorPoint} from '../../maps/index.ts';
import {ROOM_PROTOCOL,GRACE_MS,REPLACED_MESSAGE,UPDATE_NEEDED,INFINITO_REF,MAP_TEXT,PIX_ANSWER_MS,clientCatalog,parseWelcomeMap,parsePixed,checkClientMap,readMapRef,
  type Input,type Player,type MapRef,type MapId,type MapCatalog} from '../../protocol/index.ts';
import type {BuildRot,CombatMode,PixResult,RunState} from '../../contract/index.ts';
import type { Point,MoveEffects } from '../../maps/index.ts';
import {FrameRunFeed} from './run-feed.ts';
import {ObraHold} from './obra-hold.ts';
import type {PlayerWireView} from '../../protocol/index.ts';
import {InputBatcher,parseElenco} from '../../protocol/index.ts';
import {parseEmote,parseSos,type EmoteNote,type SosPing} from '../fun/emotes.ts';
import {MARK_ID,ROOT_DEFENSE,parseMark,type MarkNote} from '../../rules/index.ts';
import {Backlog,SETTLE_RTT_MS} from './backlog.ts';
import {ArrivalJitter,RemoteClock,remoteAt,tickTime} from './smoothing.ts';
import {SilenceWatch,DEAD_MAX_MS} from './silence.ts';
/** Enemies live in `feed` (the horde renderer interpolates them itself); samples only smooth remote players. */
type Sample={at:number;tick:number;players:Map<string,Player>};
/**
 * A frame not acked by an input within this long gets a standalone {t:'ack'} (lobby, standing still, fallen, watching).
 * input-10hz: every message the room receives counts toward the free plan (20 messages = 1 request), and a still
 * player sends no input any more, so the ack goes on its own at most this often (deltas stay against a baseline at
 * most ~1 s old, well inside the encoder's 64-frame history).
 */
export const ACK_EVERY_MS=1000;
/** RTT ping (diagnostics line); the acks already keep the connection alive (the room drops a peer silent for 12 s). */
const PING_EVERY_MS=5000;
/** Heartbeat timer period; a beat this much later than due means the page itself was stalled. */
const HEARTBEAT_MS=2000,STALLED_BEAT_MS=2*HEARTBEAT_MS;
/**
 * Nothing heard for this long: the socket is dead, reconnect (judged on a heartbeat that came on time, see beat()).
 * 3g-socket-morto: no longer a fixed 8 s but SilenceWatch's limit (3-8 s, from the link's own longest recent gaps);
 * this is its ceiling, for the stalled-page rule.
 */
const DEAD_SILENCE_MS=DEAD_MAX_MS;
/** A page whose heartbeats keep coming late still calls the socket dead past this much silence. */
const STALLED_DEAD_MS=3*DEAD_SILENCE_MS;
/**
 * N27 review: the app hidden this long (another app, screen off) leaves the room on its own (close 4010, no retry
 * while hidden): the keepalive rides received messages, and a hidden page still handles them, so without this a
 * room of bots with one hidden tab would tick (and bill) for its 30 minutes. The seat waits GRACE_MS; visible again,
 * the client reconnects with its token.
 */
export const AWAY_MS=60_000;
/** Close code of a client that left because its app was hidden for AWAY_MS (never retried while hidden). */
export const AWAY_CLOSE=4010;
/**
 * N27 (slow phone): with nothing sent for this long, the next message handled answers with an ack. A slow phone's
 * timers starve (20 s late at CPU 6× in the lab, the room cut it at 12 s), but its WebSocket messages are still
 * handled every few hundred ms: the keepalive rides them. A phone that sends anything (input, the 1 s ack) never
 * needs it, so the free plan's message count does not move.
 */
export const KEEPALIVE_MS=4000;
/** Steps predicted without an ack before the client stops stepping (a stalled link: 2 s). */
const MAX_PENDING=40;
/** The room closes a connection whose character went to a newer one (another tab or network) with this code: never retried. */
export const REPLACED_CLOSE=4009;
/**
 * Reconnection keeps trying while the seat can still be there (VGM-047): the room's grace since the last message heard,
 * plus a margin (a restarted room seats everyone again with a fresh grace). Backoff up to RETRY_MAX_MS.
 */
/** 3g-rede-sem-teleporte: the backoff tops at 2 s (was 4 s), so a phone whose network is back retries within ~2 s (±25%). */
const RETRY_WINDOW_MS=GRACE_MS+10_000,RETRY_MAX_MS=2000;
/**
 * 3g-rede-sem-teleporte: in a match the room holds the seat for the whole run while anyone is still playing (the hero
 * plays on its own meanwhile), so the client keeps knocking that long (the room's lifetime, D-043: 50 min) instead of RETRY_WINDOW_MS;
 * the room says when the seat is really gone ('Sua sessão expirou').
 */
export const RUN_RETRY_WINDOW_MS=50*60_000;
/** A page reloaded with a saved token (mid-match, or Wi-Fi → 4G) tries this many times before giving up the first join. */
export const TOKEN_JOIN_ATTEMPTS=8;
/** Retry delays are spread by ±RETRY_JITTER (share) so six phones dropped by the same hiccup do not knock together. */
export const RETRY_JITTER=.25;
/** retryDelay spread by ±RETRY_JITTER with `random` in [0,1). */
export function jittered(delay:number,random=Math.random()){return Math.round(delay*(1+RETRY_JITTER*(2*random-1)));}
/** How long a dropped client keeps retrying since the last message heard: the whole run when one is on. */
export function retryWindow(phase:string|undefined){return phase==='combat'||phase==='countdown'?RUN_RETRY_WINDOW_MS:RETRY_WINDOW_MS;}
/**
 * First retry after a joined connection drops (BUG-20261012 reconecta-round2): an edge drop (close 1006, room still up)
 * usually comes back on the first try, so it goes at once-ish and the whole drop stays under a second.
 */
export const FIRST_RETRY_MS=150;
/** Only a connection that lived this long gets the fast first retry, so a join that keeps dying cannot loop every 150 ms. */
export const FAST_RETRY_AFTER_MS=5000;
/**
 * In a match (3g-socket-morto), for the first FAST_RETRY_WINDOW_MS offline, the retries cap at this instead: a phone
 * whose network is back is back sooner. Past that (the room itself refusing, a long outage) the 2 s pace again.
 */
export const RUN_RETRY_MAX_MS=1000,FAST_RETRY_WINDOW_MS=10_000;
/**
 * Retry delay after `attempts` failed tries: FIRST_RETRY_MS once joined, then 1000, 2000 (cap); 500 first before joining.
 * `fast`: a match is on and the drop is younger than FAST_RETRY_WINDOW_MS: the cap is RUN_RETRY_MAX_MS.
 */
export function retryDelay(attempts:number,joined:boolean,fast=false){
  // joined: the dropped connection had been up for FAST_RETRY_AFTER_MS (a socket dying right after welcome keeps the 500 ms pace).
  return attempts===0&&joined?FIRST_RETRY_MS:Math.min(fast?RUN_RETRY_MAX_MS:RETRY_MAX_MS,500*2**attempts);
}
/** The big "Reconectando à turma…" banner waits this long: a drop that heals sooner shows nothing in the middle. */
export const RECONNECT_BANNER_MS=1500;
/** Whether the center reconnecting banner shows now: down, not terminal, and offline for at least RECONNECT_BANNER_MS. */
export function reconnectBanner(net:{connected:boolean;fatal?:string;offlineMs(now?:number):number},now=Date.now()){
  return !net.connected&&!net.fatal&&net.offlineMs(now)>=RECONNECT_BANNER_MS;
}
/**
 * A join that went without the city (its manifest came after the lobby's MANIFEST_BUDGET_MS on a slow phone) and found
 * the room on the city waits at most this long for the manifest, then knocks once more with the full catalog (cidade-10).
 */
export const CITY_RETRY_WAIT_MS=6000;
/**
 * Terminal drop in a match (the retry window ran out, the seat token is gone): the HUD shows it with "Voltar pra sala",
 * which opens the room's invite link (NEW-20261009-UX-menu-e-conexao); a reload would land on the start screen.
 */
export const LINK_LOST='Conexão indisponível. Toca em Voltar pra sala pra entrar de novo.';
/** Lobby status while that join waits for the city's manifest. */
export const CITY_RETRY_STATUS='A sala está na Cidade Nevada. Buscando o mapa…';
/** `promise`'s value if it settles within `ms`, else undefined (a rejection is undefined too). Never rejects. */
function settleWithin<T>(promise:Promise<T>,ms:number):Promise<T|undefined>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const late=new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),Math.max(0,ms));});
  return Promise.race([promise.catch(()=>undefined),late]).finally(()=>clearTimeout(timer));
}
/** Back on screen with nothing heard for this long: the socket is probably dead (network changed), reconnect now. */
const WAKE_SILENCE_MS=3000;
/** Full frames (base 0) that fail to decode in a row before the client gives up: the page and the room disagree. */
const MAX_BAD_FULL_FRAMES=3;
/** At most one resync request this often (frames already in flight fail the same way). */
const RESYNC_EVERY_MS=500;
/** baseSeq of a protocol 4 header (magic, version, uvar seq, uvar baseSeq); -1 when it cannot be read. */
function frameBase(bytes:Uint8Array){
  let pos=2;
  const uvar=()=>{let v=0,mul=1;for(let i=0;i<8;i++){if(pos>=bytes.length)return -1;const b=bytes[pos++];v+=(b&127)*mul;if(b<128)return v;mul*=128;}return -1;};
  return uvar()<0?-1:uvar();
}
const toPlayer=(p:PlayerWireView):Player=>({id:p.id,name:p.name,classId:p.classId,x:p.x??0,y:p.y??0,hp:p.hp,ack:p.ack??0,online:p.online,score:0,
  spectator:p.spectator,attackTick:p.attackTick??0,skillTick:p.skillTick??0,skillReadyTick:p.skillReadyTick??0,...(p.andar===1?{andar:1 as const}:{})});
/**
 * A map switch (welcome or {t:'map'}) waiting for the city download: what arrives meanwhile is replayed after it, in
 * order. `welcome`: the held message is a welcome (first join or reconnection), so the seat is not applied yet.
 */
type MapWait={ws:WebSocket;queue:(object|ArrayBuffer)[];failed:boolean;welcome:boolean};
/** barricada-construir part 2: the room's answer to a destruir / coletar tap (client.tralha). */
export interface TralhaAnswer {t:'destruiu'|'coleta';req:number;ok:boolean;reason?:string;pix?:number;until?:number;done?:true}
export class CoopClient {
  terrain=defaultTerrain;
  /**
   * The Cidade Nevada this build ships ({id,version,hash} from public/maps/cidade-nevada.manifest.json), set before
   * join() (lobby.ts); undefined when the manifest could not be read: the join then offers the endless map only.
   */
  cityRef?:MapRef&{bytes?:number};
  /**
   * Reads the city manifest again (lobby.ts: loadCityManifest, which refetches after a failure). Set: a join refused
   * because the room is on the city and cityRef was missing (the manifest was late) waits for it, at most cityWaitMs,
   * and retries once with the full catalog and the same seat token. Unset: such a join ends with the update text.
   */
  cityManifest?:()=>Promise<(MapRef&{bytes?:number})|undefined>;
  /** CITY_RETRY_WAIT_MS by default (tests shorten it). */
  cityWaitMs=CITY_RETRY_WAIT_MS;
  /** The one retry for a late manifest was used (never two: a build that really lacks the city stops at the second refusal). */
  private cityRetried=false;
  /** That retry is waiting for the manifest: no socket, and nothing else may connect meanwhile. */
  private cityWaiting=false;
  /** The room's map as applied (welcome or {t:'map'}); an older room that does not say plays the endless map. */
  map:MapRef=INFINITO_REF;
  /** A map the room switched to whose asset is still downloading (progress 0..1), or did not arrive (`failed`, the text). */
  mapLoad?:{ref:MapRef;progress:number;failed?:string};
  /** Map switches applied after the welcome. */
  mapSwitches=0;
  /** Called when a {t:'map'} has been applied (terrain swapped). */
  onMap:(map:MapRef)=>void=()=>{};
  /** Downloads and decodes a city asset (city-asset-loader.ts); injectable for tests. Resolves undefined or the error text. */
  loadCity:(ref:MapRef&{bytes?:number},onProgress:(fraction:number)=>void)=>Promise<string|undefined>=(ref,onProgress)=>loadCity(ref,onProgress);
  private mapWait?:MapWait;
  /** What this build can load, as sent in join.maps. */
  get mapCatalog():MapCatalog{return new Map(clientCatalog(this.cityRef).map(r=>[r.id,{id:r.id,version:r.version,hash:r.hash}]));}
  run?:RunState;
  id='';token='';tick=0;rtt=0;connected=false;victory=false;
  players=new Map<string,Player>();
  /** The hero's predicted position and floor (maps prediction.ts FloorPoint: andar 1 on a viaduct's deck). */
  predicted:FloorPoint={x:12,y:17};
  /**
   * The prediction moved outside a step (a frame reconciled it with the room): from → to. The scene keeps the drawing
   * where it was and fades the difference (smoothing.ts SelfCorrection); the bot lab measures it.
   */
  onReconcile?:(from:Point,to:Point,skill:boolean)=>void;
  /** Frame arrival jitter: the render delay of the other players (smoothing.ts). */
  readonly arrivals=new ArrivalJitter();
  /** Room time the other players are drawn at (smoothing.ts RemoteClock, BUG bots-ainda-mais-rapidos). */
  readonly remoteClock=new RemoteClock();
  /** A frame has placed the hero once (predicted is no longer the constructor placeholder). */
  private placed=false;
  /** The own skill's last tick: a frame that moves it brings a real move (a dash), not a prediction error. */
  private lastSkillTick=0;
  pending:Input[]=[];
  /**
   * D-036 slow and slip of this player, as the latest frame (tick `this.tick`) carried them: the prediction steps the
   * k-th pending input on tick this.tick+1+k with them (maps/prediction.ts), exactly like the room, so no snap-back.
   */
  effects:MoveEffects={};
  /** D-052: the most this hero walks per tick while moving the car (latest frame's car.movers), else undefined. */
  stepCap:number|undefined;
  /** D-052: on the car's rope or among its movers (latest frame): the hands are busy, no attack. */
  handsBusy=false;
  /** D-052: this hero's accepted free obras; while one is building the hero holds still (stepCap 0, obra-hold.ts). */
  private readonly obraHold=new ObraHold();
  /** Change segments and the 10 Hz send slot (input-10hz). */
  private readonly batcher=new InputBatcher();
  private flushTimer?:ReturnType<typeof setTimeout>;
  private pingAt=-Infinity;
  /** Client step counter (the room acks these). */
  get seq(){return this.batcher.seq;}
  /** RunView source for the horde renderer and the HUD: protocol 4 frames (VGM-042b). */
  readonly feed=new FrameRunFeed();
  /** How far behind the room this page handles frames, ms (N27, slow phone): the scene stops drawing to catch up. */
  readonly backlog=new Backlog();
  /** Bytes received on this client (frames + JSON), for the diagnostics line and the lab. */
  bytes=0;
  private socket?:WebSocket;
  private samples:Sample[]=[];
  private stopped=false;
  private attempts=0;
  /** Date.now() of the last message from the room (the reconnection window counts from it, across app switches). */
  private lastSeenAt=0;
  /** Date.now() of the last welcome: how long the current connection has lived. */
  private welcomedAt=0;
  /** Date.now() when the joined connection dropped (0 while connected). */
  private droppedAt=0;
  /** How long this client has been trying to get back (0 while connected or before joining). */
  offlineMs(now=Date.now()){return this.connected||!this.initialized||this.stopped||!this.droppedAt?0:now-this.droppedAt;}
  /** The center "Reconectando…" banner (reconnectBanner): only for a drop that lasts RECONNECT_BANNER_MS. */
  showReconnecting(now=Date.now()){return reconnectBanner(this,now);}
  /** "Tentar de novo" (UX onda 5): a fresh attempt now, backoff reset. */
  retryNow(){
    if(this.stopped||this.connected||this.cityWaiting)return;
    this.attempts=0;
    const ws=this.socket;
    // An attempt already on its way (connecting, or open and joining): let it finish.
    if(ws&&(ws.readyState===WebSocket.CONNECTING||ws.readyState===WebSocket.OPEN))return;
    clearTimeout(this.retry);this.retry=undefined;this.connect();
  }
  private wake?:()=>void;
  /**
   * News for the waiting room: the room restarted and the run was lost (VGM-047), title and body; cleared when the
   * next run starts.
   */
  roomNotice?:{title:string;body:string};
  /**
   * The room restarted and the run came back at the start of its round (E5-checkpoint-por-round), title and body: news
   * over the match, not the waiting room, so the next combat does not clear it; it goes when the run changes (rematch).
   */
  resumedNotice?:{title:string;body:string};
  private retry?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private lastMessage=0;
  /** The link's own longest recent gaps, so a dead socket is called sooner than 8 s (silence.ts, 3g-socket-morto). */
  private readonly silence=new SilenceWatch();
  /** The window 'online' listener (the network came back). */
  private online?:()=>void;
  /** The silence limit now (ms), for diagnostics and the lab. */
  silenceLimit(now=performance.now()){return this.silence.limit(now);}
  /** performance.now() of the last message sent on the current socket, of the last heartbeat, and of the last beat that came late. */
  private sentAt=0;private beatAt=0;
  /** performance.now() when the app went to the background (undefined while visible); AWAY_MS by default (tests shorten it). */
  private hiddenAt?:number;
  awayMs=AWAY_MS;
  /** Left the room because the app stayed hidden (AWAY_MS): reconnects when visible again. */
  away=false;
  /** Whether the page is hidden (a stand-in in node tests). */
  hidden:()=>boolean=()=>typeof document!=='undefined'&&document.hidden;
  private initialized=false;
  private resolveReady?:()=>void;
  private rejectReady?:(error:Error)=>void;
  /** Run state as the room last pushed it, with the simulation tick it was taken at (elapsed counts from there). */
  private runBase?:{run:RunState;tick:number};
  /** Last decoded frame seq, and the last one the room was told about. */
  private ackSeq=0;private ackSent=0;
  private ackTimer?:ReturnType<typeof setTimeout>;
  /**
   * Set once the client stopped for good (refused version, other terrain, frames that never decode, error from the
   * room, gave up reconnecting): the screen shows it with a reload button instead of "Reconectando…" forever.
   */
  fatal?:string;
  private badFullFrames=0;
  private resyncAt=-Infinity;
  /** Every run state from the room (welcome, {t:'run'}): D-050's pause changes once a second with no new frame. */
  onRun:(run:RunState)=>void=()=>{};
  onStatus:(message:string)=>void=()=>{};
  /** The room's answer to a skill tap (cast): `ok` false = not cast (cooldown, fallen, no target...). */
  onCast:(result:{seq:number;ok:boolean;readyTick:number})=>void=()=>{};
  /** Last answer to a skill tap. */
  lastCast?:{seq:number;ok:boolean;readyTick:number};
  /** "Me salva" pings relayed by the room (UX-resgate-e-ping), the local player's own included. */
  onSos:(ping:SosPing)=>void=()=>{};
  /** Quick emotes relayed by the room (rostos-kkkk), the local player's own included: the team strip's KKKK face. */
  onEmote:(e:EmoteNote)=>void=()=>{};
  /** Minimap pings relayed by the room (minimapa-wc3, rules/marks.ts), this phone's own included. */
  onMark:(m:MarkNote)=>void=()=>{};
  /** The run's drawn enemies ({t:'elenco'}, arte-do-roster-no-render): a new array per message; the scene fetches their art. */
  elenco:readonly string[]=[];
  /** The room's answer to a forge tap (VGM-046B): `reason` says why not (FORGE_REFUSALS in stonewards/rules.ts). */
  onForged:(result:{req:number;recipe:string;ok:boolean;reason?:string})=>void=()=>{};
  /** The room's answer to a build, upgrade or repair (torres-fio, torres-ajustes): the kind, or why not ('away': too far). */
  /** defense (D-052): the structure's id as the frames carry it, on an accepted order (the hero's own obra). */
  onBuilt:(result:{req:number;ok:boolean;kind?:string;reason?:string;defense?:string})=>void=()=>{};
  /**
   * Forge request ids only grow (the room applies a repeated one once), across reconnections too. They start at a random
   * point: a reloaded page keeps its seat (token) but not this counter, and a restarted count would read as a resend.
   */
  private forgeId=Math.floor(Math.random()*2**30);
  /**
   * Forge tap (VGM-046B): {t:'forge',round,recipe,req} at once; the room answers {t:'forged'} (onForged). Returns the
   * request id, or undefined when the tap cannot reach the room (offline, not in a run). `target` (cidade-06): what a
   * 'reparo' repairs ('barricada-N'); sent only when given, so the wall's taps stay exactly as before.
   */
  forge(recipe:string,target?:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'forge',round:this.run.round,recipe,req,...(target===undefined?{}:{target})});return req;
  }
  /**
   * Tower defense (torres-fio): builds the root on a build site ('obra-NN', maps buildPlanFor) or lays the rail
   * ('trilho'); the room answers {t:'built'} (onBuilt). Same request ids and reach rules as forge().
   */
  build(site:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'build',round:this.run.round,req,site});return req;
  }
  /**
   * D-052 free build (contract/build.ts): builds `piece` with the top-left cell of its footprint at (c,r) of the build
   * grid, turned when rot is 1; the room answers {t:'built'} (onBuilt). Same request ids as forge().
   */
  buildAt(piece:string,c:number,r:number,rot?:BuildRot){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'build',round:this.run.round,req,piece,c,r,...(rot?{rot}:{})});
    this.obraHold.order(req,{piece,c,r,...(rot?{rot}:{})});return req;
  }
  /**
   * Kits de torre (torre-pela-caixa): puts the kit in inventory `slot` (its `piece`) with the top-left cell of its
   * footprint at (c,r) of the build grid, for free; the room answers {t:'built'} (onBuilt), like buildAt. The hero holds
   * on the obra the way the room does (sim holdsObra): a wall piece or the root, never a higher tier.
   */
  place(slot:number,piece:string,c:number,r:number,rot?:BuildRot){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'place',round:this.run.round,req,slot,c,r,...(rot?{rot}:{})});
    if(piece==='muro'||piece==='barricada'||piece===ROOT_DEFENSE)this.obraHold.order(req,{piece,c,r,...(rot?{rot}:{})});
    return req;
  }
  /** D-052: the room's answer to a rope tap ({t:'puxou'}): ok, or why not (contract PullRefusal). */
  onPulled:(result:{req:number;ok:boolean;reason?:string})=>void=()=>{};
  /** D-052, the car's rope: {t:'puxar',round,req,on} hooks (on) or drops it; the room answers {t:'puxou'} (onPulled). */
  /**
   * barricada-construir part 2: {t:'destruir'|'coletar'} on a barricada square (its structure's wire id). The room
   * answers onTralha: {t:'destruiu',req,ok,pix?|reason?}, {t:'coleta',req,ok,until?|reason?} and, when a coleta ends,
   * {t:'coleta',req,ok,done?|reason?}.
   */
  tralha(kind:'destruir'|'coletar',id:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:kind,round:this.run.round,req,id});return req;
  }
  onTralha:(answer:TralhaAnswer)=>void=()=>{};
  pull(on:boolean){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'puxar',round:this.run.round,req,on});return req;
  }
  /** Upgrades a ready defense (its structure's wire id) to the next tier; `branch` A/B/C at tier 2, or 'A4b'/'A5b'. */
  upgrade(defense:string,branch?:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'upgrade',round:this.run.round,req,defense,...(branch===undefined?{}:{branch})});return req;
  }
  /** torres-ajustes: repairs a hurt defense (its structure's wire id) in the intermission, from next to it; answer in onBuilt. */
  repair(defense:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'repair',round:this.run.round,req,defense});return req;
  }
  /** D-047: the room's answer to a Dona Cida purchase: the buyer's wallet left (carteira-e-pix), or why not ('away' from the moto, 'stock', 'grana', 'phase'). */
  onBought:(result:{req:number;item:string;ok:boolean;grana?:number;reason?:string})=>void=()=>{};
  /**
   * D-047 Dona Cida (the chaveiro objective): buys `item` ('brigadeiro' | 'pacoca' | 'cocada') with this player's wallet from
   * next to the moto; the room answers {t:'bought'} (onBought). Same request ids as forge().
   */
  buyCida(item:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'cida',round:this.run.round,req,item});return req;
  }
  /** D-051: the room's answer to an inventory tap ({t:'inv'}): why nothing happened ('far', 'last-weapon', 'full', …). */
  onInventory:(result:{cmd:string;ok:boolean;reason?:string})=>void=()=>{};
  /**
   * D-051 inventory (manual combat; the HUD's 6 slots): the slot to the hand, a consumable eaten, an item to the ground,
   * or an item from the ground (its pickup id as the frames carry it). The room answers {t:'inv'} (onInventory); the
   * frames bring the inventory. False when there is nothing to send it on.
   */
  inventory(command:{t:'equip'|'use'|'drop';slot:number}|{t:'take';pickup:string}){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.out(this.socket,{...command,round:this.run.round});return true;
  }
  /** PIX answers still awaited, by request id (carteira-e-pix): settled by {t:'pixed'} or after PIX_ANSWER_MS. */
  private pixWaits=new Map<number,(result:PixResult)=>void>();
  /**
   * PIX to a friend (NEW-20261014-ORQ-carteira-e-pix): {t:'pix',round,req,to,amount} with a fresh request id; the
   * promise settles with the room's answer ({t:'pixed'}: ok with the sender's new wallet, or the refusal). It never
   * rejects: offline, outside a run or as a spectator it says 'phase' at once, and an answer that never comes (a drop)
   * says 'phase' after PIX_ANSWER_MS. The money and the `pix` event come with the next frames.
   */
  pix(to:string,amount:number):Promise<PixResult>{
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return Promise.resolve({ok:false,reason:'phase'});
    const req=++this.forgeId;
    return new Promise<PixResult>(resolve=>{
      const timer=setTimeout(()=>settle({ok:false,reason:'phase'}),PIX_ANSWER_MS);
      const settle=(result:PixResult)=>{clearTimeout(timer);if(this.pixWaits.delete(req))resolve(result);};
      this.pixWaits.set(req,settle);
      this.out(this.socket!,{t:'pix',round:this.run!.round,req,to,amount});
    });
  }
  /** Non-fatal room notices (e.g. the room closing before another run fits); also shown by onStatus. */
  onNotice:(message:string)=>void=()=>{};
  /** The run came back after a restart of the room (E5-checkpoint-por-round): the match shows it once (resumedNotice keeps it). */
  onResumed:(news:{title:string;body:string})=>void=()=>{};
  readonly endpoint:string;readonly code:string;readonly name:string;readonly classId:string;
  // Plain fields, not parameter properties: node's type stripping loads this file, so the client has unit tests.
  constructor(endpoint:string,code:string,name:string,classId:string){this.endpoint=endpoint;this.code=code;this.name=name;this.classId=classId;}
  /** Kicked from this room (D-025): the room's text; the screen offers the way out instead of a reload. */
  kicked=false;
  /** The seat token of a kick still running in this room (kept on this device), presented on join so the room says why. */
  private kickedToken():string|undefined{
    try{const ban=JSON.parse(localStorage.getItem(KICKED_KEY+this.code)??'null');if(ban?.token&&ban.until>Date.now())return String(ban.token);localStorage.removeItem(KICKED_KEY+this.code);}catch{}
    return undefined;
  }
  async join(){
    try{const saved=JSON.parse(sessionStorage.getItem(`viagem:room:${this.code}`)??'null');if(saved?.token&&saved.until>Date.now())this.token=saved.token;}catch{}
    // A phone back from another app: do not wait for the heartbeat to notice a dead socket (D-009, VGM-047).
    if(typeof document!=='undefined'&&!this.wake){this.wake=()=>this.visibility();document.addEventListener('visibilitychange',this.wake);}
    // The phone's network is back (3g-socket-morto): a waiting retry goes now, a silent socket is dropped now.
    if(typeof window!=='undefined'&&typeof window.addEventListener==='function'&&!this.online){this.online=()=>this.resume();window.addEventListener('online',this.online);}
    return new Promise<void>((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.connect();});
  }
  private connect(){
    if(this.stopped)return;
    this.onStatus(this.token?'Reconectando à turma…':'Entrando na sala…');
    const url=new URL(`/room/${this.code}`,this.endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=this.socket=new WebSocket(url);ws.binaryType='arraybuffer';
    const timeout=this.joinTimer=setTimeout(()=>ws.close(),8000);
    ws.onopen=()=>{
      // The silence of this socket counts from now, not from the previous one's last message.
      if(ws===this.socket)this.lastMessage=performance.now();
      const kicked=this.token?undefined:this.kickedToken();
      const maps=clientCatalog(this.cityRef).map(r=>({id:r.id,version:r.version,hash:r.hash}));
      this.out(ws,{t:'join',protocol:ROOM_PROTOCOL,name:this.name,classId:this.classId,maps,...(this.token?{token:this.token}:{}),...(kicked?{kicked}:{})});
    };
    ws.onmessage=event=>{
      // A socket this client already replaced (or gave up on) says nothing any more.
      if(ws!==this.socket)return;
      this.lastMessage=performance.now();this.lastSeenAt=Date.now();this.silence.heard(this.lastMessage);
      if(this.initialized&&this.goneAway(ws,this.lastMessage))return;
      // A welcome held for the city download keeps the socket alive too (the room drops a seat silent for 12 s).
      if((this.initialized||this.mapWait?.ws===ws)&&this.lastMessage-this.sentAt>=KEEPALIVE_MS)this.keepalive(ws);
      if(typeof event.data!=='string'){
        const data=event.data as ArrayBuffer;this.bytes+=data.byteLength;
        // Waiting for the city: frames wait too (they are of the new map); a failed wait drops them (resync later).
        if(this.mapWait?.ws===ws){if(!this.mapWait.failed)this.mapWait.queue.push(data);return;}
        if(this.initialized&&ws===this.socket){const t0=perfNow();this.frame(ws,data);perfSpan('rede',t0);}
        return;
      }
      this.bytes+=event.data.length;
      let m:any;try{m=JSON.parse(event.data);}catch{return;}
      if(m===null||typeof m!=='object')return;
      if(this.mapWait?.ws===ws&&!this.mapWait.failed){this.mapWait.queue.push(m);return;}
      this.message(ws,m);
    };
    ws.onclose=event=>{
      if(ws!==this.socket)return;
      clearTimeout(timeout);clearInterval(this.heartbeat);clearTimeout(this.ackTimer);this.ackTimer=undefined;clearTimeout(this.flushTimer);this.flushTimer=undefined;this.connected=false;this.pending=[];
      this.silence.cut();
      // A city download for this socket goes on (the loader keeps it), but what it held belongs to a dead connection.
      if(this.mapWait?.ws===ws){this.mapWait=undefined;this.mapLoad=undefined;}
      if(this.stopped)return;
      if(this.initialized&&!this.droppedAt)this.droppedAt=Date.now();
      // Left on purpose while hidden: back when the app is (visibility()).
      if(this.away)return;
      // A newer connection took the character: stop here, keep the token (the reload button takes it back on purpose).
      if(event?.code===REPLACED_CLOSE){this.replaced(ws);return;}
      if(this.initialized&&Date.now()-this.lastSeenAt>retryWindow(this.run?.phase)||(!this.initialized&&this.attempts>=(this.token?TOKEN_JOIN_ATTEMPTS:2))){
        this.stopped=true;this.forgetToken();
        // In a match this is terminal too (the HUD shows it with "Voltar pra sala"); before joining, the lobby shows it.
        if(this.initialized)this.fatal=LINK_LOST;
        this.onStatus(this.fatal??'Conexão indisponível. Volte às classes e entre novamente.');this.rejectReady?.(new Error('Não foi possível conectar à sala.'));return;
      }
      this.onStatus('Conexão caiu. Tentando voltar à mesma sala…');
      const fast=(this.run?.phase==='combat'||this.run?.phase==='countdown')&&Date.now()-(this.droppedAt||Date.now())<FAST_RETRY_WINDOW_MS;
      this.retry=setTimeout(()=>this.connect(),jittered(retryDelay(this.attempts++,this.initialized&&Date.now()-this.welcomedAt>=FAST_RETRY_AFTER_MS,fast)));
    };
    ws.onerror=()=>{};
  }
  /** The connect timer of the current socket (cleared by the welcome, or when the welcome waits for the city). */
  private joinTimer?:ReturnType<typeof setTimeout>;
  /**
   * The room's map from a welcome or a {t:'map'}, checked against what this build ships (map-select.ts), or the text
   * why not. A welcome without `map` comes from an older room: the endless map, accepted.
   */
  private roomMap(m:{map?:unknown},welcome:boolean):MapRef|string{
    if(welcome&&m.map===undefined)return INFINITO_REF;
    const parsed=parseWelcomeMap(m.map);
    if(!parsed.ok)return welcome?parsed.text:UPDATE_NEEDED;
    const check=checkClientMap(parsed.map,this.mapCatalog);
    return check.ok?parsed.map:welcome?check.text:UPDATE_NEEDED;
  }
  /** The city ref to download before `world` can be built: a city this build ships but has not decoded yet. */
  private cityToLoad(world:unknown):(MapRef&{bytes?:number})|undefined{
    const w=world as {kind?:unknown;signature?:unknown}|undefined;
    if(w?.kind!=='cidade'||typeof w.signature!=='string'||cityTerrainFor(w.signature))return undefined;
    return this.cityRef?.hash===w.signature?this.cityRef:undefined;
  }
  /**
   * Holds `m` (a welcome or a {t:'map'} of the city) and everything after it on this socket until the city is decoded,
   * then handles them in order: the terrain is swapped before the next frame is read. A failed {t:'map'} download keeps
   * the seat (the selector and the news strip say so) and drops frames; the next switch tries again. A failed download
   * under a held welcome (first join or reconnection) ends here, with the download's text: there is no seat to keep.
   *
   * While a welcome waits (review cidade-09 F1) the heartbeat already runs (pings, so the room does not drop the seat
   * at 12 s of silence) and the seat's id and token are kept at once: a socket lost meanwhile comes back to this seat
   * with its token instead of joining as someone new.
   */
  private waitForCity(ws:WebSocket,m:{t?:unknown;id?:unknown;token?:unknown},ref:MapRef&{bytes?:number}){
    const welcome=m.t==='welcome';
    const wait:MapWait={ws,queue:[],failed:false,welcome};this.mapWait=wait;this.mapLoad={ref,progress:0};
    if(welcome){
      if(typeof m.id==='string'&&m.id)this.id=m.id;
      if(typeof m.token==='string'&&m.token){this.token=m.token;this.saveToken();}
      clearInterval(this.heartbeat);this.beatAt=performance.now();
      this.heartbeat=setInterval(()=>this.beat(ws),HEARTBEAT_MS);
    }
    void this.loadCity(ref,progress=>{if(this.mapWait===wait&&!wait.failed)this.mapLoad={ref,progress};}).then(error=>{
      if(this.mapWait!==wait||ws!==this.socket||this.stopped)return;
      if(error){
        wait.failed=true;wait.queue=[];this.mapLoad={ref,progress:0,failed:error};
        // A welcome (first join or reconnection): not in the room, nothing to keep; the lobby or the HUD says why.
        if(welcome){this.mapWait=undefined;this.fail(ws,error);return;}
        this.onStatus(error);this.onNotice(error);return;
      }
      this.mapWait=undefined;this.mapLoad=undefined;
      this.message(ws,m);
      const rest=wait.queue;
      for(let i=0;i<rest.length;i++){
        if(ws!==this.socket||this.stopped)return;
        // Another switch started while replaying: the rest waits for it.
        const next=this.mapWait as MapWait|undefined;
        if(next?.ws===ws&&!next.failed){next.queue.push(...rest.slice(i));return;}
        const item=rest[i];
        if(item instanceof ArrayBuffer){if(this.initialized&&!next){const t0=perfNow();this.frame(ws,item);perfSpan('rede',t0);}}
        else this.message(ws,item);
      }
    });
  }
  /** {t:'map'} (cidade-09): the room switched maps in the lobby; the new terrain replaces the old before the next frame. */
  private switchMap(ws:WebSocket,m:{t?:unknown;map?:unknown;world?:unknown}){
    const map=this.roomMap(m,false);
    if(typeof map==='string'){this.fail(ws,map);return;}
    const city=this.cityToLoad(m.world);
    if(city){this.waitForCity(ws,m,city);return;}
    const terrain=terrainFor(m.world as Parameters<typeof terrainFor>[0]);
    if(typeof terrain==='string'){this.fail(ws,terrain);return;}
    this.terrain=terrain;this.map=map;this.mapLoad=undefined;this.mapWait=undefined;
    this.pending=[];this.samples=[];this.remoteClock.reset();this.mapSwitches++;
    this.onMap(map);
  }
  /** One JSON message from the room (after any city wait). */
  private message(ws:WebSocket,m:any){
    if(m.t==='welcome'){
      if(m.protocol!==ROOM_PROTOCOL||!m.run){this.fail(ws,UPDATE_NEEDED);return;}
      const map=this.roomMap(m,true);
      if(typeof map==='string'){if(readMapRef(m.map)?.id==='cidade-nevada'&&this.retryWithCity(ws,m))return;this.fail(ws,map);return;}
      const city=this.cityToLoad(m.world);
      // The download may outlast the 8 s connect timer: the loader has its own timeout.
      if(city){clearTimeout(this.joinTimer);this.waitForCity(ws,m,city);return;}
      const terrain=terrainFor(m.world);
      if(typeof terrain==='string'){this.fail(ws,terrain);return;}
      this.terrain=terrain;this.map=map;this.mapLoad=undefined;this.mapWait=undefined;
      clearTimeout(this.joinTimer);this.id=m.id;this.token=m.token;this.pending=[];this.samples=[];this.remoteClock.reset();this.effects={};this.tick=0;this.connected=true;this.attempts=0;this.droppedAt=0;this.welcomedAt=Date.now();
      // Reconnection: a fresh encoder on the room side, so the decoder starts over (D-018); the full frame follows.
      this.feed.reset();this.backlog.reset();this.ackSeq=this.ackSent=0;this.badFullFrames=0;clearTimeout(this.ackTimer);this.ackTimer=undefined;
      this.setRun(m.run,m.tick);this.batcher.reset(Number.isSafeInteger(m.ack)?m.ack:0);this.initialized=true;
      this.combat=m.combat==='manual'?'manual':'auto';
      // Consent for the result's embarrassing moment (VGM-053B): only an opt-out needs saying (the room's default is on).
      if(!this.shamePref)this.out(ws,{t:'pref',shame:false});
      this.onStatus('Conectado. Cabe até seis na sala.');this.resolveReady?.();this.resolveReady=undefined;this.rejectReady=undefined;
      this.saveToken();
      clearInterval(this.heartbeat);this.beatAt=performance.now();
      this.heartbeat=setInterval(()=>this.beat(ws),HEARTBEAT_MS);
    }
    else if(m.t==='map'){if(this.initialized)this.switchMap(ws,m);}
    else if(m.t==='run'&&m.run){
      this.setRun(m.run,m.tick);
      // The city never arrived and the round starts there: this phone cannot play it.
      if(this.mapLoad?.failed&&this.run?.phase==='combat')this.fail(ws,this.mapLoad.failed);
    }
    else if(m.t==='pong'){this.rtt=Math.round(performance.now()-m.at);if(this.rtt<SETTLE_RTT_MS)this.backlog.settle(performance.now());}
    else if(m.t==='notice'&&typeof m.message==='string'){
      const news=typeof m.title==='string'&&typeof m.body==='string'?{title:m.title,body:m.body}:undefined;
      if(news&&m.kind==='restarted')this.roomNotice=news;
      // The run resumed: no lobby news (an older 'restarted' one is stale now).
      else if(news&&m.kind==='resumed'){this.resumedNotice=news;this.roomNotice=undefined;this.onResumed(news);}
      this.onStatus(m.message);this.onNotice(m.message);
    }
    else if(m.t==='replaced')this.replaced(ws);
    else if(m.t==='cast'&&Number.isSafeInteger(m.seq)&&typeof m.ok==='boolean'){this.lastCast={seq:m.seq,ok:m.ok,readyTick:Number(m.readyTick)||0};this.onCast(this.lastCast);}
    else if(m.t==='sos'){const ping=parseSos(m);if(ping)this.onSos(ping);}
    else if(m.t==='emote'){const mark=parseMark(m);if(mark)this.onMark(mark);else{const note=parseEmote(m);if(note)this.onEmote(note);}}
    else if(m.t==='elenco'){const ids=parseElenco(m);if(ids)this.elenco=ids;}
    else if(m.t==='built'&&Number.isSafeInteger(m.req)&&typeof m.ok==='boolean'){
      // D-052: the hero's own accepted free obra holds them (obra-hold.ts); `defense` is its wire id when the room sends it.
      this.obraHold.answer({req:m.req,ok:m.ok,...(typeof m.defense==='string'?{defense:m.defense}:{})});
      this.onBuilt({req:m.req,ok:m.ok,...(typeof m.kind==='string'?{kind:m.kind}:{}),...(typeof m.reason==='string'?{reason:m.reason}:{}),...(typeof m.defense==='string'?{defense:m.defense}:{})});
    }
    else if((m.t==='destruiu'||m.t==='coleta')&&Number.isSafeInteger(m.req)&&typeof m.ok==='boolean'){
      this.onTralha({t:m.t,req:m.req,ok:m.ok,...(typeof m.reason==='string'?{reason:m.reason}:{}),...(Number.isFinite(m.pix)?{pix:m.pix}:{}),
        ...(Number.isFinite(m.until)?{until:m.until}:{}),...(m.done===true?{done:true}:{})});
    }
    else if(m.t==='puxou'&&Number.isSafeInteger(m.req)&&typeof m.ok==='boolean')this.onPulled({req:m.req,ok:m.ok,...(typeof m.reason==='string'?{reason:m.reason}:{})});
    else if(m.t==='bought'&&Number.isSafeInteger(m.req)&&typeof m.ok==='boolean')this.onBought({req:m.req,item:String(m.item??''),ok:m.ok,
      ...(Number.isSafeInteger(m.grana)?{grana:m.grana}:{}),...(typeof m.reason==='string'?{reason:m.reason}:{})});
    else if(m.t==='inv'&&typeof m.cmd==='string'&&typeof m.ok==='boolean')this.onInventory({cmd:m.cmd,ok:m.ok,...(typeof m.reason==='string'?{reason:m.reason}:{})});
    else if(m.t==='pixed'){const answer=parsePixed(m);if(answer)this.pixWaits.get(answer.req)?.(answer.result);}
    else if(m.t==='forged'&&Number.isSafeInteger(m.req)&&typeof m.ok==='boolean')this.onForged({req:m.req,recipe:String(m.recipe??''),ok:m.ok,...(typeof m.reason==='string'?{reason:m.reason}:{})});
    else if(m.t==='offers'&&Array.isArray(m.offers))this.feed.setOffers(m.offers);
    // Kicked by the owner (D-025): the seat token stays on this device until the ban ends, so a knock gets the same answer.
    else if(m.t==='kicked'&&typeof m.message==='string'){
      const token=this.token||this.kickedToken();
      try{if(token)localStorage.setItem(KICKED_KEY+this.code,JSON.stringify({token,until:Number(m.until)||Date.now()}));}catch{}
      this.kicked=true;this.forgetToken();this.fail(ws,m.message);
    }
    else if(m.t==='error'){
      const message=typeof m.message==='string'?m.message:UPDATE_NEEDED;
      // The room checks join.maps before any seat or token (D-026): refused for the map, the seat token is still good.
      if(message===MAP_TEXT.update&&this.retryWithCity(ws))return;
      this.forgetToken();this.fail(ws,message);
    }
  }
  /**
   * The room is on the city and this join went without it (cityRef missing: the manifest came after the lobby's budget
   * on a slow phone). Once per client: drop this socket (its close is not a drop), wait for the manifest (at most
   * cityWaitMs) and join again with the full catalog. The seat token is kept: the room refused before touching it, or
   * (`seat`, a welcome that already seated this phone) the retry takes that same seat back, so no ghost. No manifest
   * in time: the join ends with the room's update text, as before. False when there is no retry to make.
   */
  private retryWithCity(ws:WebSocket,seat?:{id?:unknown;token?:unknown}){
    if(this.cityRef||this.cityRetried||!this.cityManifest||this.stopped)return false;
    this.cityRetried=true;this.cityWaiting=true;
    if(seat){
      if(typeof seat.id==='string'&&seat.id)this.id=seat.id;
      if(typeof seat.token==='string'&&seat.token){this.token=seat.token;this.saveToken();}
    }
    clearTimeout(this.joinTimer);clearInterval(this.heartbeat);clearTimeout(this.retry);this.retry=undefined;
    this.socket=undefined;this.silence.cut();
    try{ws.close();}catch{}
    this.onStatus(CITY_RETRY_STATUS);
    const manifest=this.cityManifest;
    void settleWithin(Promise.resolve().then(manifest),this.cityWaitMs).then(ref=>{
      this.cityWaiting=false;
      if(this.stopped)return;
      if(ref?.id!=='cidade-nevada'){
        // Never came: the room's answer stands (the lobby shows the update panel). A held seat waits out its grace.
        if(!seat)this.forgetToken();
        this.fail(ws,MAP_TEXT.update);return;
      }
      this.cityRef=ref;this.connect();
    });
    return true;
  }
  /** The character went to a newer connection (REPLACED_CLOSE): terminal here, token kept, no retry, so no tab ping-pong. */
  private replaced(ws:WebSocket){
    if(this.stopped)return;
    this.stopped=true;this.connected=false;this.fatal=REPLACED_MESSAGE;clearTimeout(this.retry);
    this.onStatus(REPLACED_MESSAGE);this.rejectReady?.(new Error(REPLACED_MESSAGE));
    try{ws.close();}catch{}
  }
  /**
   * One heartbeat. A beat that comes late (the page was stalled: slow phone, long task) does not judge the silence:
   * messages that came meanwhile may still be queued behind this timer, so the next beat does. Past STALLED_DEAD_MS of
   * silence it judges anyway, so a page stalled beat after beat still finds a dead socket.
   */
  private beat(ws:WebSocket,now=performance.now()){
    // 3g-socket-morto: the limit can be 3 s now, so a beat a little late (a 3.5 s long task) is not "on time" for it:
    // how late this beat came is taken off the silence (messages may be queued behind it), on top of the N27 rule.
    const lateBy=Math.max(0,now-this.beatAt-HEARTBEAT_MS),late=now-this.beatAt>STALLED_BEAT_MS;this.beatAt=now;
    if(this.goneAway(ws,now))return;
    const silent=now-this.lastMessage;
    // A city download shares the phone's link with the frames: the old 8 s while it runs (no history covers it).
    const limit=this.mapLoad&&!this.mapLoad.failed?DEAD_SILENCE_MS:this.silence.limit(now);
    if(silent-lateBy>limit&&(!late||silent>STALLED_DEAD_MS)){ws.close();return;}
    if(ws.readyState===WebSocket.OPEN&&now-this.pingAt>=PING_EVERY_MS){this.pingAt=now;this.out(ws,{t:'ping',at:now});}
    this.saveToken();
  }
  /** Hidden for awayMs: leave the room (AWAY_CLOSE) and send nothing more until visible. True when gone. */
  private goneAway(ws:WebSocket,now:number){
    if(this.away)return true;
    if(this.hiddenAt===undefined&&this.hidden())this.hiddenAt=now;
    if(this.hiddenAt===undefined||now-this.hiddenAt<this.awayMs||ws!==this.socket)return false;
    this.away=true;clearTimeout(this.retry);this.retry=undefined;
    try{ws.close(AWAY_CLOSE,'App em segundo plano.');}catch{}
    return true;
  }
  /** The app went to the background or came back (visibilitychange). */
  visibility(now=performance.now()){
    if(this.hidden()){this.hiddenAt??=now;return;}
    this.hiddenAt=undefined;
    if(!this.away){this.resume();return;}
    this.away=false;this.attempts=0;if(this.droppedAt)this.droppedAt=Date.now();
    if(!this.stopped&&!this.connected&&!this.cityWaiting&&(!this.socket||this.socket.readyState>=WebSocket.CLOSING))this.connect();
  }
  /** Visible again: a socket silent for WAKE_SILENCE_MS is dropped now, and a waiting retry goes at once. */
  private resume(){
    if(this.stopped)return;
    const ws=this.socket;
    if(ws?.readyState===WebSocket.OPEN&&(this.connected||this.mapWait?.ws===ws)&&performance.now()-this.lastMessage>WAKE_SILENCE_MS){ws.close();return;}
    if(this.retry&&!this.connected&&(!ws||ws.readyState===WebSocket.CLOSED)){clearTimeout(this.retry);this.retry=undefined;this.connect();}
  }
  /** Something the client cannot play past (version, terrain, frames, an error from the room): stop for good, say why. */
  private fail(ws:WebSocket,message:string){
    this.stopped=true;this.connected=false;this.fatal=message;clearTimeout(this.retry);
    this.onStatus(message);this.rejectReady?.(new Error(message));ws.close();
  }
  /** The seat token survives a reload (sessionStorage): for the grace, or for the whole run while one is on. */
  private saveToken(){try{sessionStorage.setItem(`viagem:room:${this.code}`,JSON.stringify({token:this.token,until:Date.now()+retryWindow(this.run?.phase)}));}catch{}}
  private forgetToken(){try{sessionStorage.removeItem(`viagem:room:${this.code}`);}catch{}}
  private setRun(run:RunState,tick:unknown){
    // A new run (rematch): its clock starts over, so the old tick and D-036 effects would mislead the prediction.
    if(this.run&&run.round!==this.run.round){this.pending=[];this.samples=[];this.remoteClock.reset();this.batcher.reset(0);this.feed.setOffers([]);this.effects={};this.obraHold.reset();this.tick=0;this.resumedNotice=undefined;}
    this.runBase={run,tick:Number.isSafeInteger(tick)?tick as number:this.tick};
    const was=this.run?.phase;
    this.run={...run,members:run.members.map(m=>({...m}))};
    // A run starting (or over): the saved token now lasts as long as the room will hold the seat.
    if(this.token&&retryWindow(was)!==retryWindow(run.phase))this.saveToken();
    this.feed.setBots(run.members.filter(m=>m.bot).map(m=>m.id));
    this.victory=run.outcome==='victory';
    if(run.phase==='combat')this.roomNotice=undefined;
    try{this.onRun(this.run);}catch(e){console.error('onRun',e);}
  }
  /** One protocol 4 frame: decode, ack, then players, prediction and the run clock. */
  private frame(ws:WebSocket,data:ArrayBuffer){
    const result=this.feed.decode(data);
    if(!result.ok){
      if(result.error==='stale frame')return;
      // Even a full frame does not decode, again and again: the page and the room speak different formats.
      if(frameBase(new Uint8Array(data))===0&&++this.badFullFrames>=MAX_BAD_FULL_FRAMES){this.fail(ws,UPDATE_NEEDED);return;}
      // A frame we cannot place (lost baseline, garbage): ask for a full one, once per RESYNC_EVERY_MS.
      const now=performance.now();
      if(now-this.resyncAt>=RESYNC_EVERY_MS&&ws.readyState===WebSocket.OPEN){this.resyncAt=now;this.out(ws,{t:'resync'});}
      return;
    }
    this.badFullFrames=0;
    if(result.world&&result.world.signature!==this.terrain.signature){this.fail(ws,UPDATE_NEEDED);return;}
    this.ackSeq=result.seq;
    this.ackTimer??=setTimeout(()=>{this.ackTimer=undefined;this.flushAck();},ACK_EVERY_MS);
    const view=result.view;
    this.tick=view.tick;
    // D-050: in a level-up pause the tick stands still while the frames keep coming; measured, that would read as a
    // backlog of the whole pause (N27 catch-up drawing one frame every 2.5 s).
    if(this.run?.phase==='combat'&&!this.run.pause)this.backlog.frame(view.tick,performance.now());else this.backlog.reset();
    this.players.clear();
    for(const p of view.players)this.players.set(p.id,toPlayer(p as PlayerWireView));
    // In combat elapsed/remaining move one per simulation tick; the room only pushes the run when something else changes.
    const base=this.runBase;
    if(base&&this.run&&base.run.phase==='combat'){
      const d=Math.max(0,view.tick-base.tick);
      this.run.elapsed=base.run.elapsed+d;this.run.remaining=Math.max(0,base.run.remaining-d);
    }
    const self=this.players.get(this.id);
    const wire=view.players.find(p=>p.id===this.id) as PlayerWireView|undefined;
    this.effects=wire?{slowUntil:wire.slowUntil,slipUntil:wire.slipUntil,slip:wire.slip,fastUntil:wire.fastUntil,ride:wire.ride,rideUntil:wire.rideUntil}:{};
    // D-052: moving the car (car.movers) this hero walks at the car's speed, as the room cuts it; on the rope or among the
    // movers the hands are busy (no attack).
    const car=view.objective?.car;
    this.stepCap=this.obraHold.holding(view.structures)?0:carStepCap(car,this.id);this.handsBusy=!!car&&(car.rope===this.id||!!car.movers?.includes(this.id));
    if(self){
      const from=this.predicted,cast=(self.skillTick??0)!==this.lastSkillTick;this.lastSkillTick=self.skillTick??0;
      this.batcher.catchUp(self.ack);this.pending=this.pending.filter(i=>i.seq>self.ack);this.predicted=self.hp?reconcile(self,this.pending,this.terrain,{tick:view.tick,effects:this.effects,cap:this.stepCap}):{x:self.x,y:self.y,...(self.andar===1?{andar:1 as const}:{})};
      // Only in combat (the hero walks only then) and not on the first frame of this client (the start point is a placeholder).
      if(this.placed&&this.run?.phase==='combat'&&(from.x!==this.predicted.x||from.y!==this.predicted.y))this.onReconcile?.(from,this.predicted,cast);
      this.placed=true;
    }
    const at=performance.now();this.arrivals.push(at);this.remoteClock.push(at,view.tick);
    // Ticks only go forward within a round; a frame older than the newest (a resync) is not drawn back to.
    if(view.tick>=(this.samples.at(-1)?.tick??-Infinity))this.samples.push({at,tick:view.tick,players:new Map(this.players)});
    if(this.samples.length>12)this.samples.shift();
  }
  /** Sends one JSON message; the current socket's send time feeds the keepalive. */
  private out(ws:WebSocket,message:object){
    ws.send(JSON.stringify(message));
    if(ws===this.socket)this.sentAt=performance.now();
  }
  /**
   * Nothing sent for KEEPALIVE_MS: an ack (or a ping before the first frame, or while a welcome waits for the city: the
   * last frame seq belongs to the previous connection) from the message handler itself.
   */
  private keepalive(ws:WebSocket){
    if(ws.readyState!==WebSocket.OPEN)return;
    const heldWelcome=this.mapWait?.ws===ws&&this.mapWait.welcome;
    if(this.ackSeq>0&&!heldWelcome){this.ackSent=Math.max(this.ackSent,this.ackSeq);this.out(ws,{t:'ack',seq:this.ackSeq});}
    else this.out(ws,{t:'ping',at:performance.now()});
  }
  /** Standalone ack when no input carried it (events retire with it; frames are chained on the room side, N27). */
  private flushAck(){
    if(this.ackSeq<=this.ackSent||this.socket?.readyState!==WebSocket.OPEN)return;
    this.ackSent=this.ackSeq;this.out(this.socket,{t:'ack',seq:this.ackSeq});
  }
  /**
   * One fixed 50 ms step from the scene (input-10hz): predicted at once, sent only as a change of the quantized
   * direction, skill or target, at most every SEND_MIN_MS, plus a keepalive each KEEPALIVE_MS while walking.
   * `attack` (D-051, manual combat): the attack button held on this step (segment bit 1, with its target). `aim`: the
   * mouse's direction from the hero on a PC (sent only while attacking; the melee swing goes there).
   */
  input(direction:Point,skill:boolean,target?:string,attack=false,aim?:Point){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN||this.pending.length>=MAX_PENDING)return;
    // D-050: in a level-up pause the hero stands (the room does not step; a held direction would walk on after it).
    if(this.run?.pause){direction={x:0,y:0};skill=false;target=undefined;attack=false;}
    // D-052: pushing or pulling the car, the hands are busy (the room does not fire either).
    if(this.handsBusy)attack=false;
    const {input,active}=this.batcher.step(direction,skill,target,attack,aim);
    // Standing still moves nobody and the room does not step it: only moving or casting steps wait for an ack.
    // The k-th pending input lands on tick this.tick+1+k (D-036 effects; see reconcile).
    if(active){this.pending.push(input);if(this.players.get(this.id)?.hp)this.predicted=simulate(this.predicted,input,this.terrain,this.tick+this.pending.length,this.effects,this.stepCap);}
    this.flushInput();
  }
  /**
   * Skill tap (one-shot, no held state): {t:'cast',round,id} at once, outside the 10 Hz slot. The room answers
   * {t:'cast',seq:id,ok,readyTick} (onCast). Returns the tap id, or undefined when there is nothing to tap into.
   */
  cast(){
    if(!this.connected||this.run?.phase!=='combat'||this.run.pause||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const id=++this.castId;this.out(this.socket,{t:'cast',round:this.run.round,id});return id;
  }
  /** Tap ids only grow (the room refuses a repeated one), across reconnections too. */
  private castId=0;
  /** Sends what the batcher allows now; changes still waiting for the 10 Hz slot go out on a timer. */
  private flushInput(){
    const socket=this.socket;
    if(!socket||socket.readyState!==WebSocket.OPEN||!this.run)return;
    const batch=this.batcher.take(performance.now());
    if(batch){
      clearTimeout(this.flushTimer);this.flushTimer=undefined;
      const ack=this.ackSeq>this.ackSent?this.ackSeq:undefined;
      if(ack!==undefined){this.ackSent=ack;clearTimeout(this.ackTimer);this.ackTimer=undefined;}
      this.out(socket,{t:'input',round:this.run.round,seq:batch.seq,steps:batch.steps,...(ack!==undefined?{ack}:{})});
      return;
    }
    const until=this.batcher.waitingUntil;
    if(until!==undefined&&!this.flushTimer)this.flushTimer=setTimeout(()=>{this.flushTimer=undefined;this.flushInput();},Math.max(0,until-performance.now()));
  }
  /**
   * "Me salva" from a caído (UX-resgate-e-ping): {t:'sos',round}. The room checks the fall and the 3 s anti-spam and
   * relays the position to everyone. False when there is nothing to send it on (offline, out of combat).
   */
  /** Whether this player's embarrassing moment may show on the result (settings, saved on this device). */
  private shamePref=readShamePref();
  /** D-051: how this room fights, from its welcome ('manual': the attack button; the automatic weapons otherwise). */
  combat:CombatMode='auto';
  setShamePref(allow:boolean){
    this.shamePref=allow;writeShamePref(allow);
    if(this.socket?.readyState===WebSocket.OPEN&&this.connected)this.out(this.socket,{t:'pref',shame:allow});
  }
  get allowsShame(){return this.shamePref;}
  sos(){
    if(!this.connected||this.run?.phase!=='combat'||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.out(this.socket,{t:'sos',round:this.run.round});return true;
  }
  /** Quick emote (emote-relay-sala): {t:'emote',round,id}; the room relays it to everyone, this phone included (onEmote). */
  emote(id:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.out(this.socket,{t:'emote',round:this.run.round,id});return true;
  }
  /** Minimap ping (minimapa-wc3): {t:'emote',round,id:'marca',x,y}; an old room drops it (the ping stays local). */
  mark(x:number,y:number){
    if(!this.connected||this.run?.phase!=='combat'||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.out(this.socket,{t:'emote',round:this.run.round,id:MARK_ID,x:Math.round(x*100)/100,y:Math.round(y*100)/100});return true;
  }
  ready(ready:boolean){this.runCommand({t:'ready',ready});}
  /** Owner commands (D-025): the room checks owner, phase and round; a refusal comes back as a notice. */
  kick(id:string){this.runCommand({t:'kick',id});}
  addBot(){this.runCommand({t:'bot-add'});}
  removeBot(id?:string){this.runCommand({t:'bot-remove',...(id?{id}:{})});}
  /** Whether this player owns the room (the post moves when the owner leaves for good). */
  get isOwner(){return !!this.id&&this.run?.owner===this.id;}
  rematch(){this.runCommand({t:'rematch'});}
  /**
   * Owner's map pick in the lobby (cidade-09): exactly {t:'setMap',map} (no round: map-select validateSetMap). The room
   * answers everyone with {t:'map'}, or the owner with a notice. False when there is no open connection to send it on.
   */
  setMap(map:MapId){
    const ws=this.socket;
    if(!this.connected||ws?.readyState!==WebSocket.OPEN)return false;
    this.out(ws,{t:'setMap',map});this.onCommand?.({t:'setMap'},true);return true;
  }
  /** Upgrade pick from the HUD offer panel; the room answers with the refreshed {t:'offers'}. */
  choose(offer:string,index:number){this.runCommand({t:'choose',offer,index});}
  /** D-052 "Pular" / "Rolar de novo" on the head offer; the room answers with {t:'offers'} and the run's counters. */
  skipOffer(offer:string){this.runCommand({t:'skip',offer});}
  rerollOffer(offer:string){this.runCommand({t:'reroll',offer});}
  /** Playtest metrics only (dev/ux-metrics.ts, ?dev=1): every run command the player taps, and whether it left. Unset otherwise. */
  onCommand?:(command:{t:string;offer?:string;index?:number},sent:boolean)=>void;
  private runCommand(command:{t:string;[key:string]:unknown}){
    const sent=this.connected&&!!this.run&&this.socket?.readyState===WebSocket.OPEN;
    if(sent)this.out(this.socket!,{...command,round:this.run!.round});
    this.onCommand?.(command,sent);
  }
  /**
   * A render buffer smooths remote players without delaying local controls: they are drawn at a room time (tick ×
   * 50 ms) that follows the frames' arrival at the phone's own pace (smoothing.ts RemoteClock), so frames landing in a
   * burst never speed them up (BUG bots-ainda-mais-rapidos); a late frame does not freeze them, they go on along their
   * last motion for at most EXTRAPOLATE_MAX_MS (3g-rede-sem-teleporte).
   */
  view(now=performance.now()):{players:Player[]}{
    const target=this.remoteClock.time(now)??-Infinity,s=this.samples;
    return {players:[...this.players.values()].map(p=>{
      if(p.id===this.id)return {...p,...this.predicted,andar:this.predicted.andar};
      return {...p,...(remoteAt(s,target,p.id,tickTime)??p)};
    })};
  }
  /** Exposed as a visible diagnostic control; closes the actual socket, then normal retry takes over. */
  reconnect(){this.socket?.close(4000,'Teste de reconexão');}
  leave(){this.stopped=true;this.connected=false;clearTimeout(this.retry);if(this.wake){document.removeEventListener('visibilitychange',this.wake);this.wake=undefined;}if(this.online){window.removeEventListener('online',this.online);this.online=undefined;}clearInterval(this.heartbeat);clearTimeout(this.ackTimer);clearTimeout(this.flushTimer);this.forgetToken();if(this.socket?.readyState===WebSocket.OPEN)this.out(this.socket,{t:'leave'});this.socket?.close(1000,'Saída');}
}
export { STEP };

/** localStorage key (+ room code) of a kick still running: {token,until} (D-025). */
export const KICKED_KEY='viagem:expulso:';
/** "Meu momento vergonhoso pode aparecer" (VGM-053B, D7): on unless the player turned it off on this device. */
const SHAME_KEY='viagem:momento-vergonhoso';
function readShamePref(){try{return localStorage.getItem(SHAME_KEY)!=='off';}catch{return true;}}
function writeShamePref(allow:boolean){try{localStorage.setItem(SHAME_KEY,allow?'on':'off');}catch{/* private window: this session only */}}
