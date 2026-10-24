/**
 * Room load bench for bigger rooms (NEW-20261024-ORQ-sala-ate-10-jogadores): one real Room (multiplayer/room.ts) with
 * N seats, `people` of them fake phones and the rest room bots, from the lobby to the result, on the simulated clock
 * (20 ticks/s, no network, no sleeping), on this machine's CPU.
 *
 * A fake phone is a Peer that decodes every binary frame with the client's own FrameRunFeed (a frame that fails to
 * decode is counted and answered with {t:'resync'}, like the client), acks the last frame every `ackMs` (a walking
 * phone acks on each input, ~100 ms) and picks the first card of every level-up offer. Its hero is played by the
 * room's autopilot (the same RoomBots that plays a person whose phone dropped), so the people walk, fight and
 * revive like the bots and the run lasts a real match; the room still encodes one frame stream per phone.
 *
 * The room plays what production plays (worker.ts createOptions): the city, the chaveiro, the nests and the manual
 * combat. --map infinito / --waves (no nests) / --auto (automatic weapons) change that.
 *
 * Per combat tick: the room tick (Room.advance wall time), split into encode (Room.perf.encodeMs delta), bots'
 * thinking (room bots + autopilots) and the rest (sim step, lifecycle, JSON); per frame: encode ms and bytes for each
 * phone. Percentiles over the whole combat and per 2-minute window (the worst window is where a match peaks: the
 * horde, the boss), the heap at the end, decode errors, and the room's out-bound KB/s.
 *
 *   node --experimental-strip-types scripts/bench-sala-n.ts [--players 10] [--people 10] [--seed 4242] [--cap-min 25]
 *     [--ack-ms 100] [--map infinito] [--waves] [--auto] [--out evidence/.../sala-10.json]
 */
import {Room,type Peer} from '../multiplayer/room.ts';
import {MAX_PLAYERS,ROOM_PROTOCOL} from '../src/protocol/room.ts';
import {FrameRunFeed} from '../src/client/net/run-feed.ts';
import {clientCatalog} from '../src/protocol/map-catalog.ts';
import type {MapRef} from '../src/protocol/map-select.ts';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const argv=process.argv.slice(2);
const get=(name:string)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};
const players=Math.max(1,Math.min(MAX_PLAYERS,Number(get('--players')??6)));
const people=Math.max(1,Math.min(players,Number(get('--people')??players)));
const seed=Number(get('--seed')??4242),capMin=Number(get('--cap-min')??25),ackMs=Number(get('--ack-ms')??100);
const city=get('--map')!=='infinito',waves=argv.includes('--waves'),auto=argv.includes('--auto'),out=get('--out');

const manifest=JSON.parse(readFileSync(new URL('../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const maps=clientCatalog(CITY);
let ids=0;
const room=new Room(0,seed,{lab:true,newId:()=>`pessoa-${++ids}`,
  ...(city?{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada' as const,objective:'chaveiro' as const,...(waves?{}:{mode:'ninhos' as const}),...(auto?{}:{combat:'manual' as const})}:{map:'infinito' as const})});
await room.ready();

type Phone={peer:Peer;feed:FrameRunFeed;id?:string;lastSeq:number;ackAt:number;bytes:number;frames:number;decodeErrors:number;sizes:number[];offers:any[]};
const phones:Phone[]=[];
let t=0,inCombat=false;
const say=(p:Phone,m:object)=>room.receive(p.peer,JSON.stringify(m),t);
for(let i=0;i<people;i++){
  const p:Phone={feed:new FrameRunFeed(),lastSeq:0,ackAt:0,bytes:0,frames:0,decodeErrors:0,sizes:[],offers:[],peer:undefined as unknown as Peer};
  p.peer={send:data=>{
    if(typeof data==='string'){const m=JSON.parse(data);if(m.t==='welcome')p.id=m.id;if(m.t==='offers')p.offers=m.offers;return;}
    const r=p.feed.decode(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer);
    if(!r.ok){p.decodeErrors++;say(p,{t:'resync'});return;}
    p.lastSeq=r.seq;
    if(inCombat){p.bytes+=data.length;p.frames++;p.sizes.push(data.length);}
  },close:()=>{}};
  phones.push(p);room.connect(p.peer,t);
  say(p,{t:'join',protocol:ROOM_PROTOCOL,name:`Pessoa ${i+1}`,classId:'cidadao-comum',maps});
}
// Owner commands are throttled (OWNER_GAP_MS): one bot per simulated second.
for(let i=people;i<players;i++){t+=1000;say(phones[0],{t:'bot-add',round:room.run.snapshot().round});}
if(room.sim.players.size!==players)throw new Error(`seated ${room.sim.players.size} of ${players}`);
for(const p of phones)say(p,{t:'ready',round:room.run.snapshot().round,ready:true});
for(let i=0;i<20*60&&room.run.snapshot().phase!=='combat';i++){t+=50;room.advance(t);for(const p of phones)say(p,{t:'ack',seq:p.lastSeq});}
if(room.run.snapshot().phase!=='combat')throw new Error('the run never started');
// The people's heroes: the room's autopilot plays them (harness only), while their phones stay connected.
for(const p of phones){room.sim.autopilot.add(p.id!);room.autopilots.add(p.id!,room.autopilots.freeSlot(7,2));}
inCombat=true;

const tickMs:number[]=[],encodeMs:number[]=[],thinkMs:number[]=[],restMs:number[]=[],frameEncodeMs:number[]=[];
const windows:{tick:number[];encode:number[]}[]=[];
const WINDOW=20*120;
let ticks=0,lastEncode=room.perf.encodeMs,lastFrames=room.perf.frames,lastThink=room.bots.thinkMs+room.autopilots.thinkMs,pauses=0,maxEnemies=0;
const startT=t,WARMUP=40,walked=new Map(phones.map(p=>{const h=room.sim.players.get(p.id!)!;return [p.id!,{x:h.x,y:h.y}];}));
let warmupMax=0,walkedU=0;
const heap0=process.memoryUsage().heapUsed;
while(room.run.snapshot().phase==='combat'&&t-startT<capMin*60_000){
  t+=50;
  const started=performance.now();room.advance(t);const ms=performance.now()-started;
  const enc=room.perf.encodeMs-lastEncode,frames=room.perf.frames-lastFrames,think=room.bots.thinkMs+room.autopilots.thinkMs-lastThink;
  lastEncode=room.perf.encodeMs;lastFrames=room.perf.frames;lastThink=room.bots.thinkMs+room.autopilots.thinkMs;
  if(room.levelup.paused)pauses++;
  for(const p of phones){const h=room.sim.players.get(p.id!),at=walked.get(p.id!);if(h&&at){walkedU+=Math.hypot(h.x-at.x,h.y-at.y);at.x=h.x;at.y=h.y;}}
  for(const p of phones){
    if(p.offers.length){const o=p.offers[0];say(p,{t:'choose',round:room.run.snapshot().round,offer:o.id,index:0});p.offers=[];}
    if(t-p.ackAt>=ackMs){say(p,{t:'ack',seq:p.lastSeq});p.ackAt=t;}
  }
  // JIT and the first chunk lattices: the first WARMUP ticks go to warmupMaxMs, not to the distributions.
  if(ticks<WARMUP){warmupMax=Math.max(warmupMax,ms);ticks++;continue;}
  tickMs.push(ms);encodeMs.push(enc);thinkMs.push(think);restMs.push(Math.max(0,ms-enc-think));
  if(frames>0)frameEncodeMs.push(enc/frames);
  const w=windows[Math.floor(ticks/WINDOW)]??={tick:[],encode:[]};w.tick.push(ms);w.encode.push(enc);
  maxEnemies=Math.max(maxEnemies,room.sim.world.enemies.size);
  ticks++;
}
const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const mean=(list:number[])=>list.reduce((a,b)=>a+b,0)/Math.max(1,list.length);
const r3=(n:number)=>+n.toFixed(3);
const dist=(list:number[])=>({mean:r3(mean(list)),p50:r3(pct(list,.5)),p95:r3(pct(list,.95)),p99:r3(pct(list,.99)),max:r3(Math.max(0,...list))});
const seconds=(t-startT)/1000,run=room.run.snapshot(),allSizes=phones.flatMap(p=>p.sizes);
const result={card:'NEW-20261024-ORQ-sala-ate-10-jogadores',players,people,bots:players-people,seed,ackMs,
  room:city?{map:'cidade-nevada',objective:'chaveiro',mode:waves?'rounds':'ninhos',combat:auto?'auto':'manual'}:{map:'infinito'},
  outcome:run.outcome??'cap',combatMinutes:+(seconds/60).toFixed(2),ticks,levelupPauseTicks:pauses,maxEnemies,warmupMaxMs:r3(warmupMax),peopleWalkedU:Math.round(walkedU/people),
  tickMs:dist(tickMs),encodeMsPerTick:dist(encodeMs),thinkMsPerTick:dist(thinkMs),restMsPerTick:dist(restMs),encodeMsPerFrame:dist(frameEncodeMs),
  worstWindow:windows.map((w,i)=>({fromMin:i*2,tickP99:r3(pct(w.tick,.99)),tickMax:r3(Math.max(...w.tick)),encodeP99:r3(pct(w.encode,.99))}))
    .reduce((a,b)=>b.tickP99>a.tickP99?b:a,{fromMin:0,tickP99:0,tickMax:0,encodeP99:0}),
  windows:windows.map((w,i)=>({fromMin:i*2,tickP50:r3(pct(w.tick,.5)),tickP99:r3(pct(w.tick,.99)),encodeP99:r3(pct(w.encode,.99))})),
  framePerPhone:{bytes:{p50:pct(allSizes,.5),p95:pct(allSizes,.95),p99:pct(allSizes,.99),max:Math.max(0,...allSizes)},
    KBpsMean:r3(mean(phones.map(p=>p.bytes/seconds/1024))),KBpsMax:r3(Math.max(...phones.map(p=>p.bytes/seconds/1024))),framesPerS:r3(mean(phones.map(p=>p.frames/seconds)))},
  roomOutKBps:r3(phones.reduce((s,p)=>s+p.bytes,0)/seconds/1024),
  decodeErrors:phones.reduce((s,p)=>s+p.decodeErrors,0),
  heapMB:{start:+(heap0/2**20).toFixed(1),end:+(process.memoryUsage().heapUsed/2**20).toFixed(1)}};
console.log(JSON.stringify(result,null,1));
if(out){const file=path.resolve(out);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(result,null,1)+'\n');}
