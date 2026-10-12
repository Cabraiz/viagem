import {defaultTerrain} from '../../maps/index.ts';
import { STEP, ROOM_PROTOCOL, GRACE_MS, REPLACED_MESSAGE, reconcile, simulate, interpolate, terrainFor, UPDATE_NEEDED, type Input, type Player } from '../../../multiplayer/simulation.ts';
import type {RunState} from '../../sim/run.ts';
import type { Point } from '../../maps/index.ts';
import {FrameRunFeed} from './run-feed.ts';
import type {PlayerWireView} from '../../protocol/index.ts';
import {InputBatcher} from '../../maps/index.ts';
import {parseSos,type SosPing} from '../fun/emotes.ts';
import {Backlog,SETTLE_RTT_MS} from './backlog.ts';
/** Enemies live in `feed` (the horde renderer interpolates them itself); samples only smooth remote players. */
type Sample={at:number;players:Map<string,Player>};
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
/** Nothing heard for this long: the socket is dead, reconnect (judged on a heartbeat that came on time, see beat()). */
const DEAD_SILENCE_MS=8000;
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
const RETRY_WINDOW_MS=GRACE_MS+10_000,RETRY_MAX_MS=4000;
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
  spectator:p.spectator,attackTick:p.attackTick??0,skillTick:p.skillTick??0,skillReadyTick:p.skillReadyTick??0});
export class CoopClient {
  terrain=defaultTerrain;
  run?:RunState;
  id='';token='';tick=0;rtt=0;connected=false;victory=false;
  players=new Map<string,Player>();
  predicted:Point={x:12,y:17};
  pending:Input[]=[];
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
  /** Date.now() when the joined connection dropped (0 while connected). */
  private droppedAt=0;
  /** How long this client has been trying to get back (0 while connected or before joining). */
  offlineMs(now=Date.now()){return this.connected||!this.initialized||this.stopped||!this.droppedAt?0:now-this.droppedAt;}
  /** "Tentar de novo" (UX onda 5): a fresh attempt now, backoff reset. */
  retryNow(){
    if(this.stopped||this.connected)return;
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
  private retry?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private lastMessage=0;
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
  onStatus:(message:string)=>void=()=>{};
  /** The room's answer to a skill tap (cast): `ok` false = not cast (cooldown, fallen, no target...). */
  onCast:(result:{seq:number;ok:boolean;readyTick:number})=>void=()=>{};
  /** Last answer to a skill tap. */
  lastCast?:{seq:number;ok:boolean;readyTick:number};
  /** "Me salva" pings relayed by the room (UX-resgate-e-ping), the local player's own included. */
  onSos:(ping:SosPing)=>void=()=>{};
  /** The room's answer to a forge tap (VGM-046B): `reason` says why not (FORGE_REFUSALS in stonewards/rules.ts). */
  onForged:(result:{req:number;recipe:string;ok:boolean;reason?:string})=>void=()=>{};
  /**
   * Forge request ids only grow (the room applies a repeated one once), across reconnections too. They start at a random
   * point: a reloaded page keeps its seat (token) but not this counter, and a restarted count would read as a resend.
   */
  private forgeId=Math.floor(Math.random()*2**30);
  /**
   * Forge tap (VGM-046B): {t:'forge',round,recipe,req} at once; the room answers {t:'forged'} (onForged). Returns the
   * request id, or undefined when the tap cannot reach the room (offline, not in a run).
   */
  forge(recipe:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
    const req=++this.forgeId;this.out(this.socket,{t:'forge',round:this.run.round,recipe,req});return req;
  }
  /** Non-fatal room notices (e.g. the room closing before another run fits); also shown by onStatus. */
  onNotice:(message:string)=>void=()=>{};
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
    return new Promise<void>((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.connect();});
  }
  private connect(){
    if(this.stopped)return;
    this.onStatus(this.token?'Reconectando à turma…':'Entrando na sala…');
    const url=new URL(`/room/${this.code}`,this.endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=this.socket=new WebSocket(url);ws.binaryType='arraybuffer';
    const timeout=setTimeout(()=>ws.close(),8000);
    ws.onopen=()=>{const kicked=this.token?undefined:this.kickedToken();this.out(ws,{t:'join',protocol:ROOM_PROTOCOL,name:this.name,classId:this.classId,...(this.token?{token:this.token}:{}),...(kicked?{kicked}:{})});};
    ws.onmessage=event=>{
      // A socket this client already replaced (or gave up on) says nothing any more.
      if(ws!==this.socket)return;
      this.lastMessage=performance.now();this.lastSeenAt=Date.now();
      if(this.initialized&&this.goneAway(ws,this.lastMessage))return;
      if(this.initialized&&this.lastMessage-this.sentAt>=KEEPALIVE_MS)this.keepalive(ws);
      if(typeof event.data!=='string'){
        const data=event.data as ArrayBuffer;this.bytes+=data.byteLength;
        if(this.initialized&&ws===this.socket)this.frame(ws,data);
        return;
      }
      this.bytes+=event.data.length;
      let m:any;try{m=JSON.parse(event.data);}catch{return;}
      if(m.t==='welcome'){
        const terrain=terrainFor(m.world);
        if(m.protocol!==ROOM_PROTOCOL||!m.run||typeof terrain==='string'){this.fail(ws,typeof terrain==='string'?terrain:UPDATE_NEEDED);return;}
        this.terrain=terrain;
        clearTimeout(timeout);this.id=m.id;this.token=m.token;this.pending=[];this.samples=[];this.connected=true;this.attempts=0;this.droppedAt=0;
        // Reconnection: a fresh encoder on the room side, so the decoder starts over (D-018); the full frame follows.
        this.feed.reset();this.backlog.reset();this.ackSeq=this.ackSent=0;this.badFullFrames=0;clearTimeout(this.ackTimer);this.ackTimer=undefined;
        this.setRun(m.run,m.tick);this.batcher.reset(Number.isSafeInteger(m.ack)?m.ack:0);this.initialized=true;
        // Consent for the result's embarrassing moment (VGM-053B): only an opt-out needs saying (the room's default is on).
        if(!this.shamePref)this.out(ws,{t:'pref',shame:false});
        this.onStatus('Conectado · até 6 amigos');this.resolveReady?.();this.resolveReady=undefined;this.rejectReady=undefined;
        this.saveToken();
        clearInterval(this.heartbeat);this.beatAt=performance.now();
        this.heartbeat=setInterval(()=>this.beat(ws),HEARTBEAT_MS);
      }
      else if(m.t==='run'&&m.run)this.setRun(m.run,m.tick);
      else if(m.t==='pong'){this.rtt=Math.round(performance.now()-m.at);if(this.rtt<SETTLE_RTT_MS)this.backlog.settle(performance.now());}
      else if(m.t==='notice'&&typeof m.message==='string'){if(m.kind==='restarted'&&typeof m.title==='string'&&typeof m.body==='string')this.roomNotice={title:m.title,body:m.body};this.onStatus(m.message);this.onNotice(m.message);}
      else if(m.t==='replaced')this.replaced(ws);
      else if(m.t==='cast'&&Number.isSafeInteger(m.seq)&&typeof m.ok==='boolean'){this.lastCast={seq:m.seq,ok:m.ok,readyTick:Number(m.readyTick)||0};this.onCast(this.lastCast);}
      else if(m.t==='sos'){const ping=parseSos(m);if(ping)this.onSos(ping);}
      else if(m.t==='forged'&&Number.isSafeInteger(m.req)&&typeof m.ok==='boolean')this.onForged({req:m.req,recipe:String(m.recipe??''),ok:m.ok,...(typeof m.reason==='string'?{reason:m.reason}:{})});
      else if(m.t==='offers'&&Array.isArray(m.offers))this.feed.setOffers(m.offers);
      // Kicked by the owner (D-025): the seat token stays on this device until the ban ends, so a knock gets the same answer.
      else if(m.t==='kicked'&&typeof m.message==='string'){
        const token=this.token||this.kickedToken();
        try{if(token)localStorage.setItem(KICKED_KEY+this.code,JSON.stringify({token,until:Number(m.until)||Date.now()}));}catch{}
        this.kicked=true;this.forgetToken();this.fail(ws,m.message);
      }
      else if(m.t==='error'){const message=typeof m.message==='string'?m.message:UPDATE_NEEDED;this.forgetToken();this.fail(ws,message);}
    };
    ws.onclose=event=>{
      if(ws!==this.socket)return;
      clearTimeout(timeout);clearInterval(this.heartbeat);clearTimeout(this.ackTimer);this.ackTimer=undefined;clearTimeout(this.flushTimer);this.flushTimer=undefined;this.connected=false;this.pending=[];
      if(this.stopped)return;
      if(this.initialized&&!this.droppedAt)this.droppedAt=Date.now();
      // Left on purpose while hidden: back when the app is (visibility()).
      if(this.away)return;
      // A newer connection took the character: stop here, keep the token (the reload button takes it back on purpose).
      if(event?.code===REPLACED_CLOSE){this.replaced(ws);return;}
      if(this.initialized&&Date.now()-this.lastSeenAt>RETRY_WINDOW_MS||(!this.initialized&&this.attempts>=2)){
        this.stopped=true;this.forgetToken();
        // In a match this is terminal too (the HUD shows it with a reload button); before joining, the lobby shows it.
        if(this.initialized)this.fatal='Conexão indisponível. Atualiza a página pra voltar pra turma.';
        this.onStatus(this.fatal??'Conexão indisponível. Volte às classes e entre novamente.');this.rejectReady?.(new Error('Não foi possível conectar à sala.'));return;
      }
      this.onStatus('Conexão caiu. Tentando voltar à mesma sala…');
      this.retry=setTimeout(()=>this.connect(),Math.min(RETRY_MAX_MS,500*2**this.attempts++));
    };
    ws.onerror=()=>{};
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
    const late=now-this.beatAt>STALLED_BEAT_MS;this.beatAt=now;
    if(this.goneAway(ws,now))return;
    const silent=now-this.lastMessage;
    if(silent>DEAD_SILENCE_MS&&(!late||silent>STALLED_DEAD_MS)){ws.close();return;}
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
    this.away=false;this.attempts=0;
    if(!this.stopped&&!this.connected&&(!this.socket||this.socket.readyState>=WebSocket.CLOSING))this.connect();
  }
  /** Visible again: a socket silent for WAKE_SILENCE_MS is dropped now, and a waiting retry goes at once. */
  private resume(){
    if(this.stopped)return;
    const ws=this.socket;
    if(ws?.readyState===WebSocket.OPEN&&performance.now()-this.lastMessage>WAKE_SILENCE_MS){ws.close();return;}
    if(this.retry&&!this.connected&&(!ws||ws.readyState===WebSocket.CLOSED)){clearTimeout(this.retry);this.retry=undefined;this.connect();}
  }
  /** Something the client cannot play past (version, terrain, frames, an error from the room): stop for good, say why. */
  private fail(ws:WebSocket,message:string){
    this.stopped=true;this.connected=false;this.fatal=message;clearTimeout(this.retry);
    this.onStatus(message);this.rejectReady?.(new Error(message));ws.close();
  }
  private saveToken(){try{sessionStorage.setItem(`viagem:room:${this.code}`,JSON.stringify({token:this.token,until:Date.now()+GRACE_MS}));}catch{}}
  private forgetToken(){try{sessionStorage.removeItem(`viagem:room:${this.code}`);}catch{}}
  private setRun(run:RunState,tick:unknown){
    if(this.run&&run.round!==this.run.round){this.pending=[];this.samples=[];this.batcher.reset(0);this.feed.setOffers([]);}
    this.runBase={run,tick:Number.isSafeInteger(tick)?tick as number:this.tick};
    this.run={...run,members:run.members.map(m=>({...m}))};
    this.feed.setBots(run.members.filter(m=>m.bot).map(m=>m.id));
    this.victory=run.outcome==='victory';
    if(run.phase==='combat')this.roomNotice=undefined;
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
    if(this.run?.phase==='combat')this.backlog.frame(view.tick,performance.now());else this.backlog.reset();
    this.players.clear();
    for(const p of view.players)this.players.set(p.id,toPlayer(p as PlayerWireView));
    // In combat elapsed/remaining move one per simulation tick; the room only pushes the run when something else changes.
    const base=this.runBase;
    if(base&&this.run&&base.run.phase==='combat'){
      const d=Math.max(0,view.tick-base.tick);
      this.run.elapsed=base.run.elapsed+d;this.run.remaining=Math.max(0,base.run.remaining-d);
    }
    const self=this.players.get(this.id);
    if(self){this.batcher.catchUp(self.ack);this.pending=this.pending.filter(i=>i.seq>self.ack);this.predicted=self.hp?reconcile(self,this.pending,this.terrain):{x:self.x,y:self.y};}
    this.samples.push({at:performance.now(),players:new Map(this.players)});
    if(this.samples.length>12)this.samples.shift();
  }
  /** Sends one JSON message; the current socket's send time feeds the keepalive. */
  private out(ws:WebSocket,message:object){
    ws.send(JSON.stringify(message));
    if(ws===this.socket)this.sentAt=performance.now();
  }
  /** Nothing sent for KEEPALIVE_MS: an ack (or a ping before the first frame) from the message handler itself. */
  private keepalive(ws:WebSocket){
    if(ws.readyState!==WebSocket.OPEN)return;
    if(this.ackSeq>0){this.ackSent=Math.max(this.ackSent,this.ackSeq);this.out(ws,{t:'ack',seq:this.ackSeq});}
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
   */
  input(direction:Point,skill:boolean,target?:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN||this.pending.length>=MAX_PENDING)return;
    const {input,active}=this.batcher.step(direction,skill,target);
    // Standing still moves nobody and the room does not step it: only moving or casting steps wait for an ack.
    if(active){this.pending.push(input);if(this.players.get(this.id)?.hp)this.predicted=simulate(this.predicted,input,this.terrain);}
    this.flushInput();
  }
  /**
   * Skill tap (one-shot, no held state): {t:'cast',round,id} at once, outside the 10 Hz slot. The room answers
   * {t:'cast',seq:id,ok,readyTick} (onCast). Returns the tap id, or undefined when there is nothing to tap into.
   */
  cast(){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN)return undefined;
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
  setShamePref(allow:boolean){
    this.shamePref=allow;writeShamePref(allow);
    if(this.socket?.readyState===WebSocket.OPEN&&this.connected)this.out(this.socket,{t:'pref',shame:allow});
  }
  get allowsShame(){return this.shamePref;}
  sos(){
    if(!this.connected||this.run?.phase!=='combat'||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.out(this.socket,{t:'sos',round:this.run.round});return true;
  }
  ready(ready:boolean){this.runCommand({t:'ready',ready});}
  /** Owner commands (D-025): the room checks owner, phase and round; a refusal comes back as a notice. */
  kick(id:string){this.runCommand({t:'kick',id});}
  addBot(){this.runCommand({t:'bot-add'});}
  removeBot(id?:string){this.runCommand({t:'bot-remove',...(id?{id}:{})});}
  /** Whether this player owns the room (the post moves when the owner leaves for good). */
  get isOwner(){return !!this.id&&this.run?.owner===this.id;}
  rematch(){this.runCommand({t:'rematch'});}
  /** Upgrade pick from the HUD offer panel; the room answers with the refreshed {t:'offers'}. */
  choose(offer:string,index:number){this.runCommand({t:'choose',offer,index});}
  /** Playtest metrics only (dev/ux-metrics.ts, ?dev=1): every run command the player taps, and whether it left. Unset otherwise. */
  onCommand?:(command:{t:string;offer?:string;index?:number},sent:boolean)=>void;
  private runCommand(command:{t:string;[key:string]:unknown}){
    const sent=this.connected&&!!this.run&&this.socket?.readyState===WebSocket.OPEN;
    if(sent)this.out(this.socket!,{...command,round:this.run!.round});
    this.onCommand?.(command,sent);
  }
  /** A short render buffer smooths remote entities without delaying local controls. */
  view(now=performance.now()):{players:Player[]}{
    const target=now-120;
    let a=this.samples[0],b=a;
    for(const sample of this.samples){b=sample;if(sample.at>=target)break;a=sample;}
    const t=a&&b&&a!==b?(target-a.at)/(b.at-a.at):1;
    return {players:[...this.players.values()].map(p=>p.id===this.id?{...p,...this.predicted}:{...p,...interpolate(a?.players.get(p.id)??p,b?.players.get(p.id)??p,t)})};
  }
  /** Exposed as a visible diagnostic control; closes the actual socket, then normal retry takes over. */
  reconnect(){this.socket?.close(4000,'Teste de reconexão');}
  leave(){this.stopped=true;this.connected=false;clearTimeout(this.retry);if(this.wake){document.removeEventListener('visibilitychange',this.wake);this.wake=undefined;}clearInterval(this.heartbeat);clearTimeout(this.ackTimer);clearTimeout(this.flushTimer);this.forgetToken();if(this.socket?.readyState===WebSocket.OPEN)this.out(this.socket,{t:'leave'});this.socket?.close(1000,'Saída');}
}
export { STEP };

/** localStorage key (+ room code) of a kick still running: {token,until} (D-025). */
export const KICKED_KEY='viagem:expulso:';
/** "Meu momento vergonhoso pode aparecer" (VGM-053B, D7): on unless the player turned it off on this device. */
const SHAME_KEY='viagem:momento-vergonhoso';
function readShamePref(){try{return localStorage.getItem(SHAME_KEY)!=='off';}catch{return true;}}
function writeShamePref(allow:boolean){try{localStorage.setItem(SHAME_KEY,allow?'on':'off');}catch{/* private window: this session only */}}
