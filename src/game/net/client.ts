import {defaultTerrain} from '../terrain/field.ts';
import { STEP, ROOM_PROTOCOL, GRACE_MS, ROOM_RESTARTED_NOTICE, REPLACED_MESSAGE, reconcile, simulate, interpolate, terrainFor, UPDATE_NEEDED, type Input, type Player } from './shared.ts';
import type {RunState} from './run.ts';
import type { Point } from '../world.ts';
import {FrameRunFeed} from './run-feed.ts';
import type {PlayerWireView} from './protocol4.ts';
import {InputBatcher} from './input-track.ts';
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
  /** Bytes received on this client (frames + JSON), for the diagnostics line and the lab. */
  bytes=0;
  private socket?:WebSocket;
  private samples:Sample[]=[];
  private stopped=false;
  private attempts=0;
  /** Date.now() of the last message from the room (the reconnection window counts from it, across app switches). */
  private lastSeenAt=0;
  private wake?:()=>void;
  /**
   * Last room notice that belongs on the waiting room (the room restarted and the run was lost, VGM-047); cleared
   * when the next run starts.
   */
  roomNotice?:string;
  private retry?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private lastMessage=0;
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
  /** Non-fatal room notices (e.g. the room closing before another run fits); also shown by onStatus. */
  onNotice:(message:string)=>void=()=>{};
  readonly endpoint:string;readonly code:string;readonly name:string;readonly classId:string;
  // Plain fields, not parameter properties: node's type stripping loads this file, so the client has unit tests.
  constructor(endpoint:string,code:string,name:string,classId:string){this.endpoint=endpoint;this.code=code;this.name=name;this.classId=classId;}
  async join(){
    try{const saved=JSON.parse(sessionStorage.getItem(`viagem:room:${this.code}`)??'null');if(saved?.token&&saved.until>Date.now())this.token=saved.token;}catch{}
    // A phone back from another app: do not wait for the heartbeat to notice a dead socket (D-009, VGM-047).
    if(typeof document!=='undefined'&&!this.wake){this.wake=()=>{if(!document.hidden)this.resume();};document.addEventListener('visibilitychange',this.wake);}
    return new Promise<void>((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.connect();});
  }
  private connect(){
    if(this.stopped)return;
    this.onStatus(this.token?'Reconectando à turma…':'Entrando na sala…');
    const url=new URL(`/room/${this.code}`,this.endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=this.socket=new WebSocket(url);ws.binaryType='arraybuffer';
    const timeout=setTimeout(()=>ws.close(),8000);
    ws.onopen=()=>{ws.send(JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:this.name,classId:this.classId,...(this.token?{token:this.token}:{})}));};
    ws.onmessage=event=>{
      // A socket this client already replaced (or gave up on) says nothing any more.
      if(ws!==this.socket)return;
      this.lastMessage=performance.now();this.lastSeenAt=Date.now();
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
        clearTimeout(timeout);this.id=m.id;this.token=m.token;this.pending=[];this.samples=[];this.connected=true;this.attempts=0;
        // Reconnection: a fresh encoder on the room side, so the decoder starts over (D-018); the full frame follows.
        this.feed.reset();this.ackSeq=this.ackSent=0;this.badFullFrames=0;clearTimeout(this.ackTimer);this.ackTimer=undefined;
        this.setRun(m.run,m.tick);this.batcher.reset(Number.isSafeInteger(m.ack)?m.ack:0);this.initialized=true;
        this.onStatus('Conectado · até 6 amigos');this.resolveReady?.();this.resolveReady=undefined;this.rejectReady=undefined;
        this.saveToken();
        clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{const now=performance.now();if(now-this.lastMessage>8000){ws.close();return;}if(ws.readyState===WebSocket.OPEN&&now-this.pingAt>=PING_EVERY_MS){this.pingAt=now;ws.send(JSON.stringify({t:'ping',at:now}));}this.saveToken();},2000);
      }
      else if(m.t==='run'&&m.run)this.setRun(m.run,m.tick);
      else if(m.t==='pong')this.rtt=Math.round(performance.now()-m.at);
      else if(m.t==='notice'&&typeof m.message==='string'){if(m.message===ROOM_RESTARTED_NOTICE)this.roomNotice=m.message;this.onStatus(m.message);this.onNotice(m.message);}
      else if(m.t==='replaced')this.replaced(ws);
      else if(m.t==='offers'&&Array.isArray(m.offers))this.feed.setOffers(m.offers);
      else if(m.t==='error'){const message=typeof m.message==='string'?m.message:UPDATE_NEEDED;this.forgetToken();this.fail(ws,message);}
    };
    ws.onclose=event=>{
      if(ws!==this.socket)return;
      clearTimeout(timeout);clearInterval(this.heartbeat);clearTimeout(this.ackTimer);this.ackTimer=undefined;clearTimeout(this.flushTimer);this.flushTimer=undefined;this.connected=false;this.pending=[];
      if(this.stopped)return;
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
      if(now-this.resyncAt>=RESYNC_EVERY_MS&&ws.readyState===WebSocket.OPEN){this.resyncAt=now;ws.send(JSON.stringify({t:'resync'}));}
      return;
    }
    this.badFullFrames=0;
    if(result.world&&result.world.signature!==this.terrain.signature){this.fail(ws,UPDATE_NEEDED);return;}
    this.ackSeq=result.seq;
    this.ackTimer??=setTimeout(()=>{this.ackTimer=undefined;this.flushAck();},ACK_EVERY_MS);
    const view=result.view;
    this.tick=view.tick;
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
  /** Standalone ack when no input carried it (D-018: deltas go against the last frame the room knows we have). */
  private flushAck(){
    if(this.ackSeq<=this.ackSent||this.socket?.readyState!==WebSocket.OPEN)return;
    this.ackSent=this.ackSeq;this.socket.send(JSON.stringify({t:'ack',seq:this.ackSeq}));
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
  /** Sends what the batcher allows now; changes still waiting for the 10 Hz slot go out on a timer. */
  private flushInput(){
    const socket=this.socket;
    if(!socket||socket.readyState!==WebSocket.OPEN||!this.run)return;
    const batch=this.batcher.take(performance.now());
    if(batch){
      clearTimeout(this.flushTimer);this.flushTimer=undefined;
      const ack=this.ackSeq>this.ackSent?this.ackSeq:undefined;
      if(ack!==undefined){this.ackSent=ack;clearTimeout(this.ackTimer);this.ackTimer=undefined;}
      socket.send(JSON.stringify({t:'input',round:this.run.round,seq:batch.seq,steps:batch.steps,...(ack!==undefined?{ack}:{})}));
      return;
    }
    const until=this.batcher.waitingUntil;
    if(until!==undefined&&!this.flushTimer)this.flushTimer=setTimeout(()=>{this.flushTimer=undefined;this.flushInput();},Math.max(0,until-performance.now()));
  }
  ready(ready:boolean){this.runCommand({t:'ready',ready});}
  rematch(){this.runCommand({t:'rematch'});}
  /** Upgrade pick from the HUD offer panel; the room answers with the refreshed {t:'offers'}. */
  choose(offer:string,index:number){this.runCommand({t:'choose',offer,index});}
  private runCommand(command:object){if(this.connected&&this.run&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({...command,round:this.run.round}));}
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
  leave(){this.stopped=true;this.connected=false;clearTimeout(this.retry);if(this.wake){document.removeEventListener('visibilitychange',this.wake);this.wake=undefined;}clearInterval(this.heartbeat);clearTimeout(this.ackTimer);clearTimeout(this.flushTimer);this.forgetToken();if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({t:'leave'}));this.socket?.close(1000,'Saída');}
}
export { STEP };
