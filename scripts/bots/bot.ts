/**
 * One protocol bot (VGM-045): the real CoopClient (src/client/net/client.ts, the phone's own network code: input-10hz
 * batches, acks, ping, reconnection with the token) on a lab Link, driven by brain.ts every DECISION_MS like a thumb,
 * stepping 20 times per second like the scene. What it sees and what crossed the wire is kept for the artifacts.
 */
import {Link,LabSocket} from './lab-socket.ts';
import {decide,newMemory,type BrainMemory,type Decision} from './brain.ts';
import type {RunView} from '../../src/contract/view.ts';
import type {Point} from '../../src/maps/world.ts';
import {SelfCorrection} from '../../src/client/net/smoothing.ts';

/** Screen px of one world unit at the endless map's zoom 1 (42·√2 world px): the px of the lab's correction numbers. */
export const LAB_UNIT_PX=42*Math.SQRT2;
/**
 * The drawing before 3g-rede-sem-teleporte (scene.ts until 13/10): the hero lerped 35/s toward the reconciled
 * prediction and snapped (one visible jump) past 3 units. Fed the same reconciles, it gives the "before" column.
 */
export class LegacyCorrection {
  x=0;y=0;
  /** Returns the px of a visible snap (0 when it glides). */
  absorb(from:Point,to:Point){
    this.x+=from.x-to.x;this.y+=from.y-to.y;
    const size=Math.hypot(this.x,this.y);
    if(size>3){this.x=0;this.y=0;return size*LAB_UNIT_PX;}
    return 0;
  }
  step(dtMs:number){
    const size=Math.hypot(this.x,this.y),k=Math.exp(-Math.min(dtMs/1000,.1)*35);
    this.x*=k;this.y*=k;return size*(1-k)*LAB_UNIT_PX;
  }
}
/** Per-frame visible correction of the local hero (px), peak and mean over the frames that had any. */
export interface CorrectionStats {reconciles:number;jumpPeak:number;jumpSum:number;hides:number;
  before:{peak:number;sum:number;frames:number;snaps:number};after:{peak:number;sum:number;frames:number}}

// The page keeps the seat token in sessionStorage; each bot keeps it in its CoopClient (no shared storage, or six
// bots in one process would take each other's seats). Always replaced: Node ≥ 25 has a real, process-wide
// sessionStorage (and a localStorage that warns without --localstorage-file), which a `??=` stub left in place.
const g=globalThis as any;
const noStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
for(const name of ['sessionStorage','localStorage'])Object.defineProperty(g,name,{value:noStorage,configurable:true,writable:true});
// CoopClient reads WebSocket.OPEN/CLOSED; the class itself is swapped per bot while it connects (see Bot).
g.WebSocket=LabSocket;
const {CoopClient}=await import('../../src/client/net/client.ts');

/** How often the thumb changes its mind (ms): the stick is still sampled every 50 ms step. */
export const DECISION_MS=200;
export const STEP_MS=50;

export interface BotEvent {at:number;kind:string;detail?:unknown}
export interface BotOptions {endpoint:string;code:string;name:string;classId:string;index:number;link:Link;log?:(line:string)=>void}

export class Bot {
  readonly client:InstanceType<typeof CoopClient>;
  readonly link:Link;
  readonly index:number;
  readonly name:string;
  readonly events:BotEvent[]=[];
  readonly memory:BrainMemory;
  /** Stand ready in the lobby / ask for the rematch on the result screen. */
  wantReady=false;wantRematch=false;
  /** Paused bots stand still (and still ack): used while a check needs a quiet room. */
  paused=false;
  decision?:Decision;
  last?:RunView;
  /** Forge answers, cast answers, notices, status lines (errors are what a person would read on screen). */
  forged:{req:number;recipe:string;ok:boolean;reason?:string}[]=[];
  casts={ok:0,refused:0};
  notices:string[]=[];
  rtts:number[]=[];
  modes:Record<string,number>={};
  errors:string[]=[];
  private timer?:ReturnType<typeof setInterval>;
  private nextDecision=0;
  private lastReady=0;
  private lastRematch=0;
  private lastRtt=0;
  private readonly started=performance.now();
  private readonly log:(line:string)=>void;
  /** 3g-rede-sem-teleporte: the hero's reconciles drawn both ways at 60 frames per second (see LegacyCorrection). */
  readonly corrections:CorrectionStats={reconciles:0,jumpPeak:0,jumpSum:0,hides:0,before:{peak:0,sum:0,frames:0,snaps:0},after:{peak:0,sum:0,frames:0}};
  private legacy=new LegacyCorrection();
  private smooth=new SelfCorrection();
  private display?:ReturnType<typeof setInterval>;
  private reconciled(from:Point,to:Point){
    const c=this.corrections,jump=Math.hypot(from.x-to.x,from.y-to.y)*LAB_UNIT_PX;
    c.reconciles++;c.jumpSum+=jump;c.jumpPeak=Math.max(c.jumpPeak,jump);
    const snap=this.legacy.absorb(from,to);
    if(snap>0){c.before.snaps++;c.before.peak=Math.max(c.before.peak,snap);c.before.sum+=snap;c.before.frames++;}
    if(this.smooth.absorb(from,to)==='hide')c.hides++;
  }
  private drawFrame(dt:number){
    const c=this.corrections,old=this.legacy.step(dt),now=this.smooth.step(dt,LAB_UNIT_PX);
    if(old>.05){c.before.peak=Math.max(c.before.peak,old);c.before.sum+=old;c.before.frames++;}
    if(now>.05){c.after.peak=Math.max(c.after.peak,now);c.after.sum+=now;c.after.frames++;}
  }
  constructor(o:BotOptions){
    this.index=o.index;this.name=o.name;this.link=o.link;this.memory=newMemory(o.index);this.log=o.log??(()=>{});
    const client=this.client=new CoopClient(o.endpoint,o.code,o.name,o.classId);
    // Each connection attempt (first join and every retry) goes through this bot's Link.
    const connect=Object.getPrototypeOf(client).connect as ()=>void,socketClass=o.link.socketClass();
    (client as any).connect=function(){const before=g.WebSocket;g.WebSocket=socketClass;try{connect.call(this);}finally{g.WebSocket=before;}};
    // Every frame's reconcile of the hero (the same hook on the old client and the new one): from → to, in combat only,
    // not the first frame (the placeholder start).
    const frame=Object.getPrototypeOf(client).frame as (ws:unknown,data:ArrayBuffer)=>void,bot=this;let placed=false;
    (client as any).frame=function(ws:unknown,data:ArrayBuffer){
      const from={...this.predicted},was=this.run?.phase;frame.call(this,ws,data);const to=this.predicted;
      if(placed&&was==='combat'&&this.run?.phase==='combat'&&(from.x!==to.x||from.y!==to.y))bot.reconciled(from,to);
      placed=true;
    };
    client.onForged=r=>{
      this.forged.push(r);this.event('forged',r);
      // Refusals about the recipe itself wait for the next intermission; 'away', 'phase' or 'player' do not.
      if(!r.ok&&['no-weapon','full','balance','recipe'].includes(r.reason??''))this.memory.refused[r.recipe as keyof BrainMemory['refused']]=client.feed.peek().round?.index??0;
    };
    client.onCast=r=>{if(r.ok)this.casts.ok++;else this.casts.refused++;};
    client.onNotice=m=>{this.notices.push(m);this.event('notice',m);};
    client.onStatus=m=>{if(client.fatal&&!this.errors.includes(client.fatal)){this.errors.push(client.fatal);this.event('fatal',client.fatal);}else this.event('status',m);};
  }
  event(kind:string,detail?:unknown){this.events.push({at:Math.round(performance.now()-this.started),kind,detail});if(kind!=='status')this.log(`${this.name} ${kind} ${detail===undefined?'':JSON.stringify(detail)}`);}
  async join(){
    await this.client.join();this.timer=setInterval(()=>{try{this.step();}catch(e){this.errors.push(String((e as Error)?.stack??e));}},STEP_MS);
    let last=performance.now();
    this.display=setInterval(()=>{const t=performance.now();this.drawFrame(t-last);last=t;},1000/60);
  }
  get id(){return this.client.id;}
  get run(){return this.client.run;}
  /** The view the brain sees (also after the run: stats, wall, level). */
  view(){return this.client.feed.peek();}
  private step(){
    const c=this.client,run=c.run,now=performance.now();
    if(c.rtt&&c.rtt!==this.lastRtt){this.lastRtt=c.rtt;this.rtts.push(c.rtt);}
    if(!c.connected||!run)return;
    if(run.phase==='lobby'&&this.wantReady&&now-this.lastReady>1500){
      const me=run.members.find(m=>m.id===c.id);
      if(me&&!me.ready&&!me.spectator){this.lastReady=now;c.ready(true);}
    }
    if(run.phase==='result'&&this.wantRematch&&now-this.lastRematch>3000){this.lastRematch=now;c.rematch();}
    if(run.phase!=='combat')return;
    const view=c.feed.take();this.last=view;
    if(this.paused){c.input({x:0,y:0},false);return;}
    if(now>=this.nextDecision){
      // A little spread so six thumbs do not change their minds on the same tick.
      this.nextDecision=now+DECISION_MS+((this.index*37)%60);
      const d=this.decision=decide({view,selfId:c.id,at:c.predicted as Point,index:this.index,terrain:c.terrain,memory:this.memory});
      this.modes[d.mode]=(this.modes[d.mode]??0)+1;
      if(d.choose){c.choose(d.choose.offer,d.choose.index);this.event('choose',d.choose.offer);}
      if(d.cast)c.cast();
      if(d.sos)c.sos();
      if(d.forge){const req=c.forge(d.forge);this.event('forge',{recipe:d.forge,req});}
    }
    c.input(this.decision?.direction??{x:0,y:0},false);
  }
  stop(leave=true){clearInterval(this.timer);this.timer=undefined;clearInterval(this.display);this.display=undefined;if(leave)this.client.leave();else{for(const s of [...this.link.sockets])s.terminate();}}
}
