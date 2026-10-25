/**
 * Card NEW-20261025-ORQ-heroi-empurra-inimigos, etapa 2: the REAL CoopClient against a real Room (in-memory socket,
 * LATENCY each way, the room ticking every 50 ms), the hero walking into a crowd of critters. With the bodies in the
 * replay (EnemyView.radius, maps bodyBlock) a frame barely pulls the prediction (the critters' own moves since the
 * frame are all it misses); a replay that walked through them (the ghost below, the old prediction) snaps back by
 * about the pending steps' push every frame: the "tremor" the card asks to avoid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {createEnemy} from '../../src/sim/index.ts';
import {reconcile,simulate,type FloorPoint} from '../../src/maps/index.ts';
import type {Point} from '../../src/contract/index.ts';

Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},configurable:true});
const store=new Map<string,string>();
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
/** Steps before measuring: the start of combat queues a backlog of inputs (the pending window settles). */
const WARM=20,CROWD=160;

test('walking into a strip of critters, the frames pull the prediction less than a walk-through replay would, and mostly a little',async()=>{
  (performance as any).now=()=>now;
  const room=new Room(now);
  const client=new CoopClient('http://sala','CORPOS0001','Ana','cidadao-comum');
  try{
    const joined=client.join();
    socket!.readyState=1;room.connect(socket!.peer,now);socket!.onopen!();
    const snaps:number[]=[],ghostSnaps:number[]=[];
    let ghost:FloorPoint|undefined,step=-1,readySent=false,placed=false,pushing=0;
    const deliver=()=>{while(toRoom.length&&toRoom[0].at<=now){const m=toRoom.shift()!;room.receive(socket!.peer,m.data,m.at);}};
    const receive=()=>{
      while(toClient.length&&toClient[0].at<=now){
        const m=toClient.shift()!;
        if(typeof m.data==='string'){socket!.onmessage!({data:m.data});continue;}
        const before={...client.predicted};
        socket!.onmessage!({data:m.data});
        const self=client.players.get(client.id);
        if(client.run?.phase!=='combat'||step<WARM||!self||!placed){ghost=undefined;continue;}
        snaps.push(dist(before,client.predicted));
        // The old prediction: the same replay without the bodies.
        const was=ghost??{...before};
        ghost=reconcile(self,client.pending,client.terrain,{tick:client.tick,effects:client.effects});
        ghostSnaps.push(dist(was,ghost));
      }
    };
    for(let i=0;i<500&&step<160;i++){
      now+=50;
      deliver();
      if(client.connected&&!readySent){client.ready(true);readySent=true;}
      const me=room.sim.players.get(client.id);
      if(me&&room.run.snapshot().phase==='combat'){
        for(const p of room.sim.players.values())p.hp=p.stats.maxHp;
        const w=room.sim.world;
        if(!placed){
          // Clear the field, then a line of harmless critters right ahead (+x) of the hero.
          for(const e of [...w.enemies.values()])w.enemies.delete(e.id);
          for(let k=0;k<CROWD;k++){
            // A dense strip of critters ahead (+x, 4 rows across the hero's line), immortal and harmless.
            const e=createEnemy(w,'bebado',{x:me.x+1.5+Math.floor(k/4)*.7,y:me.y+(k%4-1.5)*.7});e.damage=0;e.hp=e.maxHp=1e9;
          }
          placed=true;
        }
        for(const e of w.enemies.values())e.damage=0;
        let near=false;for(const e of w.enemies.values())if(dist(e,me)<=e.radius+.22+.02)near=true;
        if(near&&step>=WARM)pushing++;
      }
      room.advance(now);
      receive();
      if(client.run?.phase==='combat'&&placed){
        step++;
        client.input({x:1,y:0},false);
        if(ghost)ghost=simulate(ghost,{seq:client.seq,x:1,y:0} as never,client.terrain,client.tick+client.pending.length,client.effects);
      }
    }
    await joined;
    const max=(a:number[])=>Math.max(0,...a),mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
    console.log(`[corpos] snap with bodies: max ${max(snaps).toFixed(3)} mean ${mean(snaps).toFixed(4)} u; walk-through replay: max ${max(ghostSnaps).toFixed(3)} mean ${mean(ghostSnaps).toFixed(4)} u (${snaps.length} frames, ${pushing} ticks pushing)`);
    assert.ok(step>=160,'played the scripted steps');
    assert.ok(pushing>40,`the hero pushed bodies for ${pushing} ticks`);
    const p95=(a:number[])=>[...a].sort((x,y)=>x-y)[Math.floor(a.length*.95)]??0;
    console.log(`[corpos] p95 with bodies ${p95(snaps).toFixed(3)} u, walk-through ${p95(ghostSnaps).toFixed(3)} u`);
    // Measured (island, the hero's 2× walk, 0.3 u a step; 4 rows of 40 immortal critters, 60 ms each way; BODY_MASS
    // common .08): with the bodies mean 0.010 u, p95 0.031; walking through 0.019 / 0.049 (at common .35 it was 0.049 /
    // 0.17). What is left is the critters' own walk toward the hero since the frame (the copies stand still).
    assert.ok(mean(snaps)<.65*mean(ghostSnaps),`the bodies' replay pulls less than walking through (${mean(snaps)} vs ${mean(ghostSnaps)})`);
    assert.ok(p95(snaps)<=p95(ghostSnaps)&&p95(snaps)<=.08,`95 % of the frames pull the hero at most ${p95(snaps)} u`);
  }finally{
    client.leave();
    (performance as any).now=realNow;
  }
});
