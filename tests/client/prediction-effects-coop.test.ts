/**
 * D-036 review R2: the REAL CoopClient (src/client/net/client.ts input() and frame()) against a real Room, with a burp
 * slow and a poop slip, on a fake clock: an in-memory socket with latency both ways, the room ticking every 50 ms and
 * the scene's 50 ms input step. Every step the client predicted after it heard of a hit lands where the room put it,
 * and no frame pulls the prediction back unless it brings news of a hit.
 * (prediction-effects.test.ts models the same logic with jitter; this one guards the client code itself.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {addTelegraph} from '../../src/sim/index.ts';
import type {Point,TelegraphKind} from '../../src/contract/index.ts';

const store=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},configurable:true});
(globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
/** The fake clock: performance.now (the client's batcher, keepalive and backlog) and the room's `now`. */
let now=1000;
const realNow=performance.now.bind(performance);
const LATENCY=60;
const toRoom:{at:number;data:string}[]=[],toClient:{at:number;data:string|ArrayBuffer}[]=[];
let socket:FakeSocket|undefined;
class FakeSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;binaryType='blob';
  onopen?:()=>void;onmessage?:(e:{data:unknown})=>void;onclose?:(e:{code:number})=>void;onerror?:()=>void;
  readonly peer:Peer={
    send:d=>{toClient.push({at:now+LATENCY,data:typeof d==='string'?d:d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength) as ArrayBuffer});},
    close:()=>{},
  };
  constructor(_url:unknown){socket=this;}
  send(data:string){if(this.readyState!==1)throw new Error('not open');toRoom.push({at:now+LATENCY,data});}
  close(){this.readyState=3;}
}
(globalThis as any).WebSocket=FakeSocket;
const {CoopClient}=await import('../../src/client/net/client.ts');
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const EPS=2/512;

test('CoopClient predicts the burp slow and the poop slip exactly: no snap-back, steps where the room puts them',async()=>{
  (performance as any).now=()=>now;
  const room=new Room(now);
  const client=new CoopClient('http://sala','EFEITO0001','Ana','cidadao-comum');
  try{
    const joined=client.join();
    socket!.readyState=1;room.connect(socket!.peer,now);socket!.onopen!();
    const hits:{atStep:number;kind:TelegraphKind}[]=[{atStep:40,kind:'arroto'},{atStep:60,kind:'coco'},{atStep:120,kind:'arroto'},{atStep:125,kind:'coco'}];
    let heard=0,fired=0,step=-1,readySent=false;
    const snaps:{snap:number;news:boolean}[]=[];
    const mine=new Map<number,{at:Point;heard:number}>(),taken=new Map<number,{at:Point;fired:number}>();
    const fresh=(next:number|undefined,old:number|undefined)=>next!==undefined&&next!==old?1:0;
    const deliver=()=>{
      while(toRoom.length&&toRoom[0].at<=now){const m=toRoom.shift()!;room.receive(socket!.peer,m.data,m.at);}
    };
    const receive=()=>{
      while(toClient.length&&toClient[0].at<=now){
        const m=toClient.shift()!;
        if(typeof m.data==='string'){socket!.onmessage!({data:m.data});continue;}
        const before={...client.predicted},old={...client.effects};
        socket!.onmessage!({data:m.data});
        const news=fresh(client.effects.slowUntil,old.slowUntil)+fresh(client.effects.slipUntil,old.slipUntil);
        heard+=news;
        if(client.run?.phase==='combat'&&step>=0)snaps.push({snap:dist(before,client.predicted),news:news>0});
      }
    };
    for(let i=0;i<400&&step<220;i++){
      now+=50;
      deliver();
      if(client.connected&&!readySent){client.ready(true);readySent=true;}
      const me=room.sim.players.get(client.id);
      if(me&&room.run.snapshot().phase==='combat'){
        for(const p of room.sim.players.values())p.hp=p.stats.maxHp;
        for(const h of hits)if(h.atStep===step)addTelegraph(room.sim.world,{shape:'circle',x:me.x,y:me.y,radius:8,damage:0,owner:'env:test',kind:h.kind},0);
      }
      const slow=me?.slowUntil,slip=me?.slipUntil,ack=me?.ack;
      room.advance(now);
      if(me&&room.run.snapshot().phase==='combat'){
        fired+=fresh(me.slowUntil,slow)+fresh(me.slipUntil,slip);
        if(me.ack!==ack)taken.set(me.ack,{at:{x:me.x,y:me.y},fired});
      }
      receive();
      if(client.run?.phase==='combat'){
        step++;
        client.input({x:1,y:.25},false);
        mine.set(client.seq,{at:{...client.predicted},heard});
      }
    }
    await joined;
    assert.ok(step>=220,'played the scripted steps');
    assert.equal(fired,hits.length,'the room applied every hit');assert.equal(heard,hits.length,'the client heard every hit');
    assert.deepEqual(snaps.filter(x=>!x.news&&x.snap>EPS),[],'no snap-back without news');
    let compared=0,effected=0;
    for(const [seq,p] of mine){
      const at=taken.get(seq);
      if(!at||p.heard<at.fired)continue;
      compared++;if(at.fired>0)effected++;
      assert.ok(dist(at.at,p.at)<=EPS,`step ${seq}: client ${p.at.x},${p.at.y}, room ${at.at.x},${at.at.y}`);
    }
    assert.ok(compared>100&&effected>40,`steps compared ${compared} (${effected} after a hit)`);
  }finally{
    client.leave();
    (performance as any).now=realNow;
  }
});
