/**
 * Browser-like WebSocket for the protocol bots (VGM-045), on top of `ws`, with a lab network in the middle.
 *
 * The bots run the real CoopClient (src/game/net/client.ts) under node: it builds `new WebSocket(url)` and uses the
 * browser API (onopen/onmessage/onclose, binaryType, readyState, WebSocket.OPEN). This class gives it that API, sends
 * the Origin the rooms Worker checks, and puts a `Link` between the client and the room:
 * - delay: added round trip in ms (half each way) plus jitter, order kept (TCP never reorders);
 * - outage(ms): the network is gone (a phone in the elevator, an app switch that killed the socket). Nothing goes
 *   through either way on the open socket, which stays "open" for the client until its own heartbeat (8 s of
 *   silence) or the wake-up gives up on it; the room only notices by its 12 s silence rule. New connections fail
 *   while the outage lasts. When it ends, the dead socket is cut for good (the room sees it close then, if it has not
 *   already dropped it) and the client's own retry takes the seat back with its token;
 * - drop(): the connection breaks for real (both sides see it close at once) and the client reconnects at once.
 * Every message and byte that crosses is counted (per second too) for the artifacts.
 */
import WebSocket from 'ws';

export interface SecondSample {second:number;up:number;down:number;upBytes:number;downBytes:number;frames:number}
export interface LinkStats {
  sentMessages:number;sentBytes:number;recvMessages:number;recvBytes:number;recvFrames:number;recvJson:number;
  connects:number;opened:number;failedConnects:number;closes:{code:number;reason:string;at:number}[];
  /** Messages per type the client sent (input, ack, ping, ready, choose, forge, cast, sos...). */
  sentByType:Record<string,number>;
}
export const emptyStats=():LinkStats=>({sentMessages:0,sentBytes:0,recvMessages:0,recvBytes:0,recvFrames:0,recvJson:0,
  connects:0,opened:0,failedConnects:0,closes:[],sentByType:{}});

/** How long a connection attempt takes to fail while the network is down (a phone without signal fails fast). */
export const OUTAGE_CONNECT_FAIL_MS=1000;

/** Delivery queue that keeps order: each item goes no earlier than the previous one. */
export class OrderedDelay {
  private last=0;
  private readonly now:()=>number;
  /** Items waiting, in hand-in order, and the one timer that delivers them. */
  private items:{at:number;fn:()=>void}[]=[];
  private timer?:ReturnType<typeof setTimeout>;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}
  /** When an item handed in now with this delay is due (ms, same clock as `now`). */
  due(delayMs:number){const at=Math.max(this.last,this.now()+Math.max(0,delayMs));this.last=at;return at;}
  /**
   * Runs `fn` after `delayMs`, never before the items handed in earlier. One timer drains the queue in order: a
   * timer per item could fire two items due on the same millisecond in the wrong order (N27: the chained frames
   * caught the lab reordering what TCP never reorders).
   */
  schedule(delayMs:number,fn:()=>void){
    this.items.push({at:this.due(delayMs),fn});
    if(!this.timer&&!this.draining)this.arm();
  }
  private arm(){
    const head=this.items[0];
    this.timer=head?setTimeout(()=>this.drain(),Math.max(0,head.at-this.now())):undefined;
  }
  private draining=false;
  private drain(){
    this.timer=undefined;this.draining=true;
    const now=this.now();
    try{while(this.items.length&&this.items[0].at<=now+.5)this.items.shift()!.fn();}
    finally{this.draining=false;this.arm();}
  }
  reset(){this.last=0;}
}

export class Link {
  /** Added round trip (ms): half on the way out, half on the way back. */
  rttMs=0;
  /** Up to this much extra per message and direction (uniform), still in order. */
  jitterMs=0;
  readonly stats:LinkStats=emptyStats();
  /** Per-second counters since `epoch` (index = whole seconds since the link was made). */
  readonly seconds:SecondSample[]=[];
  readonly epoch=performance.now();
  readonly sockets=new Set<LabSocket>();
  private downUntil=0;
  private readonly origin:string;
  private rng:()=>number;
  constructor(origin:string,options:{rttMs?:number;jitterMs?:number;rng?:()=>number}={}){
    this.origin=origin;this.rttMs=options.rttMs??0;this.jitterMs=options.jitterMs??0;this.rng=options.rng??Math.random;
  }
  get down(){return performance.now()<this.downUntil;}
  /** One-way delay for the next message. */
  oneWay(){return this.rttMs/2+(this.jitterMs>0?this.rng()*this.jitterMs:0);}
  /** The network goes away for `ms` (see the module comment). Resolves when it is back. */
  async outage(ms:number){
    this.downUntil=performance.now()+ms;
    const dead=[...this.sockets];
    for(const s of dead)s.blackhole();
    await new Promise(r=>setTimeout(r,ms));
    for(const s of dead)s.cut();
  }
  /** The connection breaks now (RST): both ends see the close. */
  drop(){for(const s of this.sockets)s.terminate();}
  sample(field:'up'|'down',bytes:number,frame=false){
    const second=Math.floor((performance.now()-this.epoch)/1000);
    while(this.seconds.length<=second)this.seconds.push({second:this.seconds.length,up:0,down:0,upBytes:0,downBytes:0,frames:0});
    const s=this.seconds[second];
    if(field==='up'){s.up++;s.upBytes+=bytes;}else{s.down++;s.downBytes+=bytes;if(frame)s.frames++;}
  }
  /** The browser-like class CoopClient instantiates (global WebSocket while this bot connects). */
  socketClass(){
    const link=this;
    return class extends LabSocket{constructor(url:string|URL){super(url,link,link.origin);}};
  }
}

type Handler<E>=((event:E)=>void)|null;
export class LabSocket {
  static readonly CONNECTING=0;static readonly OPEN=1;static readonly CLOSING=2;static readonly CLOSED=3;
  readonly CONNECTING=0;readonly OPEN=1;readonly CLOSING=2;readonly CLOSED=3;
  readyState=0;
  binaryType:'arraybuffer'|'blob'='blob';
  onopen:Handler<{}>=null;
  onmessage:Handler<{data:string|ArrayBuffer}>=null;
  onclose:Handler<{code:number;reason:string}>=null;
  onerror:Handler<{}>=null;
  readonly url:string;
  private inner?:WebSocket;
  private readonly link:Link;
  /** Blackholed by an outage: nothing crosses any more; cut() closes the real socket afterwards. */
  private dead=false;
  private closedFired=false;
  private readonly outQueue=new OrderedDelay();
  private readonly inQueue=new OrderedDelay();
  constructor(url:string|URL,link:Link,origin:string){
    this.url=String(url);this.link=link;link.sockets.add(this);link.stats.connects++;
    if(link.down){
      // No network: the attempt fails (the client's backoff decides when to try again).
      this.dead=true;link.stats.failedConnects++;
      setTimeout(()=>{this.onerror?.({});this.fireClose(1006,'network down');},OUTAGE_CONNECT_FAIL_MS);
      return;
    }
    const inner=this.inner=new WebSocket(this.url,{origin,perMessageDeflate:false});
    inner.binaryType='arraybuffer';
    inner.on('open',()=>this.later(this.inQueue,()=>{if(this.dead||this.readyState!==0)return;this.readyState=1;link.stats.opened++;this.onopen?.({});}));
    inner.on('message',(data:ArrayBuffer|Buffer,isBinary:boolean)=>{
      if(this.dead)return;
      const size=isBinary?(data as ArrayBuffer).byteLength:(data as Buffer).length;
      const payload:string|ArrayBuffer=isBinary?data as ArrayBuffer:data.toString();
      this.later(this.inQueue,()=>{
        if(this.dead||this.readyState!==1)return;
        link.stats.recvMessages++;link.stats.recvBytes+=size;if(isBinary)link.stats.recvFrames++;else link.stats.recvJson++;
        link.sample('down',size,isBinary);
        this.onmessage?.({data:payload});
      });
    });
    inner.on('close',(code:number,reason:Buffer)=>{if(this.dead)return;this.later(this.inQueue,()=>this.fireClose(code,reason.toString()));});
    inner.on('error',()=>{if(this.dead)return;this.later(this.inQueue,()=>this.onerror?.({}));});
  }
  private later(queue:OrderedDelay,fn:()=>void){
    const delay=this.link.oneWay();
    if(delay<=0){fn();return;}
    queue.schedule(delay,fn);
  }
  send(data:string|ArrayBufferLike|Uint8Array){
    if(this.readyState===0)throw new Error('InvalidStateError: still connecting');
    if(this.readyState!==1)return;
    const size=typeof data==='string'?Buffer.byteLength(data):(data as ArrayBuffer).byteLength;
    const s=this.link.stats;s.sentMessages++;s.sentBytes+=size;this.link.sample('up',size);
    if(typeof data==='string'){const type=/^\{"t":"([a-z-]+)"/.exec(data)?.[1]??'other';s.sentByType[type]=(s.sentByType[type]??0)+1;}
    if(this.dead)return;
    this.later(this.outQueue,()=>{if(!this.dead&&this.inner?.readyState===WebSocket.OPEN)this.inner.send(data as string);});
  }
  close(code=1000,reason=''){
    if(this.readyState>=2)return;
    this.readyState=2;
    // A dead socket closes only on this side (the room never hears it); the client sees its close event at once.
    if(this.dead||!this.inner){setTimeout(()=>this.fireClose(1006,'closed while offline'),0);return;}
    const inner=this.inner;
    this.later(this.outQueue,()=>{try{inner.close(code,reason);}catch{inner.terminate();}});
  }
  /** Outage: from now on nothing crosses this socket. */
  blackhole(){if(this.readyState<3)this.dead=true;}
  /** End of the outage: the dead socket is gone for good (the room sees it close now, if it was still holding it). */
  cut(){
    this.inner?.terminate();
    this.link.sockets.delete(this);
    if(this.readyState===2)this.fireClose(1006,'network down');
  }
  /** Connection broken (RST): the room sees it at once; the client one way later. */
  terminate(){
    if(this.dead||!this.inner)return;
    this.inner.terminate();
  }
  private fireClose(code:number,reason:string){
    if(this.closedFired)return;
    this.closedFired=true;this.readyState=3;this.link.sockets.delete(this);
    this.link.stats.closes.push({code,reason,at:Math.round(performance.now()-this.link.epoch)});
    this.onclose?.({code,reason});
  }
}
