/**
 * N27 · bytes per client with a high horde (lab): one Room with LAB_HORDE critters around the team, one person and five
 * room bots, in combat for `seconds` of room ticks (simulated clock, no network). The person's phone is a fake peer
 * that decodes every frame (FrameRunFeed, the client's own decoder) and acks the way the client does: standing still,
 * one {t:'ack'} a second (ACK_EVERY_MS); walking, the ack rides each input (about every 100 ms); lag, a slow
 * phone whose acks name frames it got 8 s earlier.
 *   node --experimental-strip-types scripts/bench-horde-bytes.ts [horde=300] [seconds=60] [still|walk|lag] [seed=4242]
 * Prints bytes/s split into frames (sections and events) and JSON, frame size percentiles and how many critters
 * the client holds, as JSON.
 */
import {Room,type Peer} from '../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../src/protocol/room.ts';
import {FrameRunFeed} from '../src/client/net/run-feed.ts';
import {ACK_EVERY_MS} from '../src/client/net/client.ts';

const horde=Number(process.argv[2]??300),seconds=Number(process.argv[3]??60),mode=process.argv[4]??'still',seed=Number(process.argv[5]??4242);
const feed=new FrameRunFeed();
let jsonBytes=0,frameBytes=0,frames=0,lastSeq=0,decodeErrors=0,inCombat=false,welcome:any;
const sizes:number[]=[],held:number[]=[];
const peer:Peer={send:data=>{
  if(typeof data==='string'){const m=JSON.parse(data);if(m.t==='welcome')welcome=m;if(inCombat)jsonBytes+=data.length;return;}
  const r=feed.decode(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer);
  if(!r.ok){decodeErrors++;say({t:'resync'});return;}
  lastSeq=r.seq;
  if(inCombat){frameBytes+=data.length;frames++;sizes.push(data.length);held.push(feed.enemies.size);}
},close:()=>{}};
let t=0;
const room=new Room(0,seed,{lab:true,labHorde:horde});
const say=(m:object)=>room.receive(peer,JSON.stringify(m),t);
room.connect(peer,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Pessoa do lab',classId:'cidadao-comum'});
for(let i=0;i<5;i++)say({t:'bot-add',round:1});
say({t:'ready',round:1,ready:true});
for(let i=0;i<20*30&&room.run.snapshot().phase!=='combat';i++){t+=50;room.advance(t);say({t:'ack',seq:lastSeq});}
// Let the horde fill up (25 a tick) before measuring.
for(let i=0;i<20*5;i++){t+=50;room.advance(t);if(i%20===0)say({t:'ack',seq:lastSeq});}
inCombat=true;
const start=t,startEvents=[...room.connections.values()][0].encoder!.stats.eventBytes;
let lastAck=t,seq=0,angle=0;
const seen:[number,number][]=[],LAG_MS=8000;
const round=()=>room.run.snapshot().round;
while(t-start<seconds*1000&&room.run.snapshot().phase==='combat'){
  t+=50;room.advance(t);
  if(mode==='walk'&&(t/50)%2===0){
    // The batcher sends at most every 100 ms; a slow circle changes the quantized direction every few steps.
    angle+=.08;seq+=2;
    const m={t:'input',round:round(),seq,steps:[[seq-1,Math.round(Math.cos(angle)*8)/8,Math.round(Math.sin(angle)*8)/8,0]],ack:lastSeq};
    say(m);jsonBytes;lastAck=t;
  }else if(t-lastAck>=ACK_EVERY_MS){say({t:'ack',seq:lastSeq});lastAck=t;}
}
const span=(t-start)/1000,enc=[...room.connections.values()][0].encoder!;
const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const eventBytes=enc.stats.eventBytes-startEvents;
console.log(JSON.stringify({horde,mode,seed,seconds:span,protocol:welcome?.protocol,
  KBps:+((frameBytes+jsonBytes)/span/1024).toFixed(2),frameKBps:+(frameBytes/span/1024).toFixed(2),eventKBps:+(eventBytes/span/1024).toFixed(2),
  sectionKBps:+((frameBytes-eventBytes)/span/1024).toFixed(2),jsonKBps:+(jsonBytes/span/1024).toFixed(2),framesPerS:+(frames/span).toFixed(1),
  frameBytes:{p50:pct(sizes,.5),p95:pct(sizes,.95),max:Math.max(...sizes)},critters:{room:room.sim.world.enemies.size,clientMin:Math.min(...held),clientMax:Math.max(...held)},
  fullFrames:enc.stats.fullFrames,decodeErrors,culledPerFrame:+(enc.stats.culled/Math.max(1,enc.stats.frames)).toFixed(1)},null,1));
