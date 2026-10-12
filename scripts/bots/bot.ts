/**
 * One protocol bot (VGM-045): the real CoopClient (src/client/net/client.ts, the phone's own network code: input-10hz
 * batches, acks, ping, reconnection with the token) on a lab Link, driven by brain.ts every DECISION_MS like a thumb,
 * stepping 20 times per second like the scene. What it sees and what crossed the wire is kept for the artifacts.
 */
import {Link,LabSocket} from './lab-socket.ts';
import {decide,newMemory,type BrainMemory,type Decision} from './brain.ts';
import type {RunView} from '../../src/contract/view.ts';
import type {Point} from '../../src/maps/world.ts';

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
  constructor(o:BotOptions){
    this.index=o.index;this.name=o.name;this.link=o.link;this.memory=newMemory(o.index);this.log=o.log??(()=>{});
    const client=this.client=new CoopClient(o.endpoint,o.code,o.name,o.classId);
    // Each connection attempt (first join and every retry) goes through this bot's Link.
    const connect=Object.getPrototypeOf(client).connect as ()=>void,socketClass=o.link.socketClass();
    (client as any).connect=function(){const before=g.WebSocket;g.WebSocket=socketClass;try{connect.call(this);}finally{g.WebSocket=before;}};
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
  async join(){await this.client.join();this.timer=setInterval(()=>{try{this.step();}catch(e){this.errors.push(String((e as Error)?.stack??e));}},STEP_MS);}
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
  stop(leave=true){clearInterval(this.timer);this.timer=undefined;if(leave)this.client.leave();else{for(const s of [...this.link.sockets])s.terminate();}}
}
