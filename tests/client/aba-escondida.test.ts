// N27 review · app hidden: the client leaves the room on its own after AWAY_MS and comes back when visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';

const store=new Map<string,string>();
(globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
/** The network: which room answers, and whether new connections fail (phone without signal). */
const net={room:undefined as Room|undefined,down:false,opened:0,sent:[] as {at:number;t:string}[]};
class FakeSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;binaryType='blob';
  onopen?:()=>void;onmessage?:(e:{data:unknown})=>void;onclose?:(e:{code:number})=>void;onerror?:()=>void;
  readonly peer:Peer;
  constructor(_url:unknown){
    net.opened++;
    this.peer={send:d=>{const data=typeof d==='string'?d:d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength);setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data});},0);},
      close:code=>{if(this.readyState===3)return;this.readyState=3;setTimeout(()=>this.onclose?.({code}),0);}};
    setTimeout(()=>{
      if(net.down||!net.room){this.readyState=3;this.onclose?.({code:1006});return;}
      this.readyState=1;net.room.connect(this.peer,Date.now());this.onopen?.();
    },0);
  }
  send(data:string){
    if(this.readyState!==1)throw new Error('not open');
    let t='?';try{t=JSON.parse(data).t;}catch{}
    net.sent.push({at:Date.now(),t});
    net.room?.receive(this.peer,data,Date.now());
  }
  close(code=1000){if(this.readyState===3)return;this.readyState=3;net.room?.disconnect(this.peer,Date.now());setTimeout(()=>this.onclose?.({code}),0);}
  /** The link dies without the room noticing (a phone that changed networks): only this end sees a close. */
  vanish(){this.readyState=3;setTimeout(()=>this.onclose?.({code:1006}),0);}
}
(globalThis as any).WebSocket=FakeSocket;
const {CoopClient}=await import('../../src/client/net/client.ts');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function ticking(room:Room){const timer=setInterval(()=>room.advance(Date.now()),50);return ()=>clearInterval(timer);}

test('app hidden for AWAY_MS: the client closes (4010), sends nothing and does not retry; visible again it takes its seat back',async()=>{
  const {AWAY_CLOSE,AWAY_MS}=await import('../../src/client/net/client.ts');
  assert.equal(AWAY_MS,60_000);
  store.clear();net.room=new Room(Date.now());net.down=false;net.sent=[];const stop=ticking(net.room);
  const ana=new CoopClient('http://sala','ABCDEF1234','Ana','cidadao-comum');
  try{
    await ana.join();const id=ana.id,first=(ana as any).socket as FakeSocket;
    ana.addBot();await sleep(200);
    let hidden=false;ana.hidden=()=>hidden;ana.awayMs=400;
    let closedWith:number|undefined;const close=first.close.bind(first);first.close=(code?:number)=>{closedWith=code;close(code);};
    hidden=true;ana.visibility();
    // Still handling the room's frames (a hidden page does), but gone once awayMs passed.
    await sleep(900);
    assert.equal(closedWith,AWAY_CLOSE);assert.equal(ana.away,true);assert.equal(ana.connected,false);
    assert.equal(net.room.connections.size,0,'the room has no socket of a person left: the Durable Object stops its clock (room-loop test)');
    assert.equal(net.room.sim.players.get(id)!.online,false,'the seat waits (GRACE_MS)');
    const opened=net.opened,sent=net.sent.length;
    await sleep(1500);
    assert.equal(net.opened,opened,'no retry while hidden');assert.equal(net.sent.length,sent,'nothing sent while hidden');
    hidden=false;ana.visibility();
    for(let i=0;i<60&&!ana.connected;i++)await sleep(50);
    assert.equal(ana.connected,true);assert.equal(ana.id,id,'same character');assert.equal(ana.away,false);
  }finally{stop();ana.leave();}
});

test('app hidden briefly (less than AWAY_MS): nothing changes',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  const ana=new CoopClient('http://sala','ABCDEF1234','Ana','cidadao-comum');
  try{
    await ana.join();const first=(ana as any).socket;
    let hidden=true;ana.hidden=()=>hidden;ana.awayMs=1500;ana.visibility();
    await sleep(700);hidden=false;ana.visibility();await sleep(1500);
    assert.equal((ana as any).socket,first);assert.equal(ana.away,false);assert.equal(net.room.connections.size,1);
  }finally{stop();ana.leave();}
});
