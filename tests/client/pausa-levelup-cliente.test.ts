/**
 * D-050 (NEW-20261014-ORQ-levelup-pausa-time): the REAL CoopClient against a real Room through a level-up pause, on a
 * fake clock with latency both ways. The hero walks; the pause opens; the client hears RunState.pause, keeps calling
 * input() (the scene does) yet the hero stands, the skill is refused, and the N27 backlog stays at 0 although frames
 * of one frozen tick keep coming for seconds; the pick ends the pause and the walk goes on with no snap-back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import type {Point} from '../../src/contract/index.ts';

const store=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},configurable:true});
(globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
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

test('CoopClient through a level-up pause: stands, no cast, no backlog, then walks on without a snap-back',async()=>{
  (performance as any).now=()=>now;
  const room=new Room(now);
  const client=new CoopClient('http://sala','PAUSA00001','Ana','cidadao-comum');
  const heard:(number|undefined)[]=[];client.onRun=run=>heard.push(run.pause?.leftMs);
  try{
    const joined=client.join();
    socket!.readyState=1;room.connect(socket!.peer,now);socket!.onopen!();
    const snaps:number[]=[];
    let granted=false,pausedAt:Point|undefined,pausedTick=-1,picked=false,maxBacklog=0,pausedFrames=0,castInPause:number|undefined=-1;
    let after=0;
    const deliver=()=>{while(toRoom.length&&toRoom[0].at<=now){const m=toRoom.shift()!;room.receive(socket!.peer,m.data,m.at);}};
    const receive=()=>{
      while(toClient.length&&toClient[0].at<=now){
        const m=toClient.shift()!;
        const before={...client.predicted};
        socket!.onmessage!({data:m.data});
        if(typeof m.data!=='string'&&client.run?.phase==='combat')snaps.push(dist(before,client.predicted));
        if(typeof m.data!=='string'&&client.run?.pause)pausedFrames++;
      }
    };
    let readySent=false;
    for(let i=0;i<1200&&after<60;i++){
      now+=50;
      deliver();
      if(client.connected&&!readySent){client.ready(true);readySent=true;}
      const me=room.sim.players.get(client.id);
      if(me)me.hp=me.stats.maxHp;
      // 2 s into the wave: a team level-up.
      if(!granted&&room.run.snapshot().phase==='combat'&&room.sim.world.round.phase==='wave'&&room.sim.tick>40){room.sim.run.progression.grantLevelOffers(room.sim.world,2);granted=true;}
      room.advance(now);
      if(room.levelup.paused&&!pausedAt){pausedAt={x:me!.x,y:me!.y};pausedTick=room.sim.tick;}
      receive();
      if(client.run?.phase==='combat'){
        client.input({x:1,y:.25},false);
        maxBacklog=Math.max(maxBacklog,client.backlog.ms);
        if(client.run.pause){
          if(castInPause===-1)castInPause=client.cast();
          // 6 s of pause (60 frames of one tick), then the pick (the offer reaches the client by {t:'offers'}).
          const offer=client.feed.peek().offers[0];
          if(!picked&&offer&&pausedFrames>=60){client.choose(offer.id,offer.defaultIndex);picked=true;}
        }
        if(picked&&!room.levelup.paused)after++;
      }
    }
    await joined;
    assert.ok(granted&&pausedAt,'the pause opened');
    assert.ok(pausedFrames>=60,`frames kept coming in the pause (${pausedFrames})`);
    assert.ok(picked,'the client picked');assert.equal(room.levelup.paused,false,'and the pause ended');
    assert.ok(room.sim.tick>pausedTick+40,'the sim stepped again');
    const me=room.sim.players.get(client.id)!;
    assert.ok(me.x>pausedAt!.x+1,`the hero walks on after the pause (${pausedAt!.x} → ${me.x})`);
    assert.equal(castInPause,undefined,'no skill tap in the pause');
    assert.ok(maxBacklog<600,`no N27 backlog from the frozen tick (max ${maxBacklog} ms)`);
    assert.deepEqual(snaps.filter(s=>s>EPS),[],'no snap-back');
    // onRun (the HUD's only way to hear the pause: no frame brings it) fires once a second through the pause, then without.
    const lefts=heard.filter((v):v is number=>v!==undefined);
    assert.ok(lefts.length>=5&&lefts.every((v,i)=>!i||v<lefts[i-1]),`the clock counts down in onRun: ${lefts}`);
    assert.equal(heard.at(-1),undefined,'and the last run state has no pause');
  }finally{
    client.leave();
    (performance as any).now=realNow;
  }
});

test('CoopClient in a pause: the hero the room holds does not move while the phone keeps pushing the stick',async()=>{
  (performance as any).now=()=>now;
  toRoom.length=0;toClient.length=0;
  const room=new Room(now);
  const client=new CoopClient('http://sala','PAUSA00002','Bia','cidadao-comum');
  try{
    const joined=client.join();
    socket!.readyState=1;room.connect(socket!.peer,now);socket!.onopen!();
    let readySent=false,granted=false,at:Point|undefined,phone:Point|undefined,checked=0;
    for(let i=0;i<900&&checked<100;i++){
      now+=50;
      while(toRoom.length&&toRoom[0].at<=now){const m=toRoom.shift()!;room.receive(socket!.peer,m.data,m.at);}
      if(client.connected&&!readySent){client.ready(true);readySent=true;}
      if(!granted&&room.run.snapshot().phase==='combat'&&room.sim.world.round.phase==='wave'&&room.sim.tick>40){room.sim.run.progression.grantLevelOffers(room.sim.world,2);granted=true;}
      room.advance(now);
      while(toClient.length&&toClient[0].at<=now){const m=toClient.shift()!;socket!.onmessage!({data:m.data});}
      if(client.run?.phase==='combat')client.input({x:-1,y:0},false);
      const me=room.sim.players.get(client.id);
      // The phone stays where it predicted (the steps already on their way are taken right after the pause, on the ticks
      // it predicted them for): its position freezes too, a few steps ahead of the room's.
      if(client.run?.pause&&me){at??={x:me.x,y:me.y};phone??={...client.predicted};assert.ok(dist(at,me)<EPS,'the room holds the hero');assert.ok(dist(phone,client.predicted)<EPS,'and so does the phone');checked++;}
    }
    await joined;
    assert.equal(checked,100,'checked 5 s of pause');
  }finally{
    client.leave();
    (performance as any).now=realNow;
  }
});

test('production wiring: explore.ts hands every run state to Hud.setPause (the offer only opens in the pause)',async()=>{
  const fs=await import('node:fs');
  const explore=fs.readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.ok(explore.includes(`net.onRun=run=>hud?.setPause(run.phase==='combat'?run.pause:undefined);`),'every {t:run} (the pause ticks once a second with no frame)');
  assert.ok(explore.includes(`hud.setPause(phase==='combat'?net?.run?.pause:undefined);hud.update(`),'and every view');
});
