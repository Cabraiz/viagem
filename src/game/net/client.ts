import {defaultTerrain} from '../terrain/field.ts';
import { STEP, ROOM_PROTOCOL, reconcile, simulate, interpolate, terrainFor, UPDATE_NEEDED, type Input, type Player } from './shared.ts';
import type {RunState} from './run.ts';
import type { Point } from '../world.ts';
import {FrameRunFeed} from './run-feed.ts';
import type {PlayerWireView} from './protocol4.ts';
/** Enemies live in `feed` (the horde renderer interpolates them itself); samples only smooth remote players. */
type Sample={at:number;players:Map<string,Player>};
/** A frame not acked by an input within this long gets a standalone {t:'ack'} (lobby, spectator, fallen player). */
const ACK_FALLBACK_MS=120;
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
  id='';token='';seq=0;tick=0;rtt=0;connected=false;victory=false;
  players=new Map<string,Player>();
  predicted:Point={x:12,y:17};
  pending:Input[]=[];
  /** RunView source for the horde renderer and the HUD: protocol 4 frames (VGM-042b). */
  readonly feed=new FrameRunFeed();
  /** Bytes received on this client (frames + JSON), for the diagnostics line and the lab. */
  bytes=0;
  private socket?:WebSocket;
  private samples:Sample[]=[];
  private stopped=false;
  private attempts=0;
  private lostAt=0;
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
  constructor(readonly endpoint:string,readonly code:string,readonly name:string,readonly classId:string){}
  async join(){
    try{const saved=JSON.parse(sessionStorage.getItem(`viagem:room:${this.code}`)??'null');if(saved?.token&&saved.until>Date.now())this.token=saved.token;}catch{}
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
      this.lastMessage=performance.now();
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
        clearTimeout(timeout);this.id=m.id;this.token=m.token;this.pending=[];this.samples=[];this.connected=true;this.attempts=0;this.lostAt=0;
        // Reconnection: a fresh encoder on the room side, so the decoder starts over (D-018); the full frame follows.
        this.feed.reset();this.ackSeq=this.ackSent=0;this.badFullFrames=0;clearTimeout(this.ackTimer);this.ackTimer=undefined;
        this.setRun(m.run,m.tick);this.seq=Number.isSafeInteger(m.ack)?m.ack:0;this.initialized=true;
        this.onStatus('Conectado · até 6 amigos');this.resolveReady?.();this.resolveReady=undefined;this.rejectReady=undefined;
        this.saveToken();
        clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{if(performance.now()-this.lastMessage>8000){ws.close();return;}if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({t:'ping',at:performance.now()}));this.saveToken();},2000);
      }
      else if(m.t==='run'&&m.run)this.setRun(m.run,m.tick);
      else if(m.t==='pong')this.rtt=Math.round(performance.now()-m.at);
      else if(m.t==='notice'&&typeof m.message==='string'){this.onStatus(m.message);this.onNotice(m.message);}
      else if(m.t==='offers'&&Array.isArray(m.offers))this.feed.setOffers(m.offers);
      else if(m.t==='error'){const message=typeof m.message==='string'?m.message:UPDATE_NEEDED;this.forgetToken();this.fail(ws,message);}
    };
    ws.onclose=()=>{
      clearTimeout(timeout);clearInterval(this.heartbeat);clearTimeout(this.ackTimer);this.ackTimer=undefined;this.connected=false;this.pending=[];
      if(this.stopped)return;
      this.lostAt ||= Date.now();
      if(Date.now()-this.lostAt>25_000||(!this.initialized&&this.attempts>=2)){
        this.stopped=true;this.forgetToken();
        // In a match this is terminal too (the HUD shows it with a reload button); before joining, the lobby shows it.
        if(this.initialized)this.fatal='Conexão indisponível. Atualiza a página pra voltar pra turma.';
        this.onStatus(this.fatal??'Conexão indisponível. Volte às classes e entre novamente.');this.rejectReady?.(new Error('Não foi possível conectar à sala.'));return;
      }
      this.onStatus('Conexão caiu. Tentando voltar à mesma sala…');
      this.retry=setTimeout(()=>this.connect(),Math.min(3000,500*2**this.attempts++));
    };
    ws.onerror=()=>{};
  }
  /** Something the client cannot play past (version, terrain, frames, an error from the room): stop for good, say why. */
  private fail(ws:WebSocket,message:string){
    this.stopped=true;this.connected=false;this.fatal=message;clearTimeout(this.retry);
    this.onStatus(message);this.rejectReady?.(new Error(message));ws.close();
  }
  private saveToken(){try{sessionStorage.setItem(`viagem:room:${this.code}`,JSON.stringify({token:this.token,until:Date.now()+30_000}));}catch{}}
  private forgetToken(){try{sessionStorage.removeItem(`viagem:room:${this.code}`);}catch{}}
  private setRun(run:RunState,tick:unknown){
    if(this.run&&run.round!==this.run.round){this.pending=[];this.samples=[];this.seq=0;this.feed.setOffers([]);}
    this.runBase={run,tick:Number.isSafeInteger(tick)?tick as number:this.tick};
    this.run={...run,members:run.members.map(m=>({...m}))};
    this.victory=run.outcome==='victory';
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
    this.ackTimer??=setTimeout(()=>{this.ackTimer=undefined;this.flushAck();},ACK_FALLBACK_MS);
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
    if(self){this.pending=this.pending.filter(i=>i.seq>self.ack);this.predicted=self.hp?reconcile(self,this.pending,this.terrain):{x:self.x,y:self.y};}
    this.samples.push({at:performance.now(),players:new Map(this.players)});
    if(this.samples.length>12)this.samples.shift();
  }
  /** Standalone ack when no input carried it (D-018: deltas go against the last frame the room knows we have). */
  private flushAck(){
    if(this.ackSeq<=this.ackSent||this.socket?.readyState!==WebSocket.OPEN)return;
    this.ackSent=this.ackSeq;this.socket.send(JSON.stringify({t:'ack',seq:this.ackSeq}));
  }
  input(direction:Point,skill:boolean,target?:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN||this.pending.length>=20)return;
    const length=Math.max(1,Math.hypot(direction.x,direction.y));
    const input:Input={seq:++this.seq,x:direction.x/length,y:direction.y/length,attack:false,skill,target};
    this.pending.push(input);if(this.players.get(this.id)?.hp)this.predicted=simulate(this.predicted,input,this.terrain);
    const ack=this.ackSeq>this.ackSent?this.ackSeq:undefined;
    if(ack!==undefined){this.ackSent=ack;clearTimeout(this.ackTimer);this.ackTimer=undefined;}
    this.socket.send(JSON.stringify({t:'input',round:this.run.round,...input,...(ack!==undefined?{ack}:{})}));
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
  leave(){this.stopped=true;this.connected=false;clearTimeout(this.retry);clearInterval(this.heartbeat);clearTimeout(this.ackTimer);this.forgetToken();if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({t:'leave'}));this.socket?.close(1000,'Saída');}
}
export { STEP };
