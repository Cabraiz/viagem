/**
 * Lab measure of the room bots (D-025): one Room, one person who never touches the screen (acks only) and five bots,
 * from the lobby to the result, at the room's 20 ticks/s on the wall clock of this machine (not the Cloudflare one).
 * Prints the tick cost with and without the bots' thinking, the outcome, rescues and what the bots gathered and forged.
 *   node --experimental-strip-types scripts/bench-room-bots.ts [seed] [bots]
 */
import {Room,type Peer} from '../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../src/protocol/room.ts';
import {readFileSync} from 'node:fs';
import {clientCatalog} from '../src/protocol/map-catalog.ts';
import {readMapRef} from '../src/protocol/map-select.ts';
import {HEROI_PADRAO} from './elenco-ativo.ts';

/** join.maps of a current build (D-026): the endless map and the city of this checkout's manifest. */
const manifest=JSON.parse(readFileSync(new URL('../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const maps=clientCatalog(readMapRef({id:manifest.id,version:manifest.version,hash:manifest.hash}));
const seed=Number(process.argv[2]??4242),count=Math.max(0,Math.min(5,Number(process.argv[3]??5)));
const messages:any[]=[];
const peer:Peer={send:s=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
const say=(m:object,now:number)=>room.receive(peer,JSON.stringify(m),now);
// The endless map, explicitly: the measure stays comparable whatever ROOM_DEFAULT_MAP becomes (cidade-10).
const room=new Room(0,seed,{lab:true,map:'infinito'});
let t=0;
room.connect(peer,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Pessoa parada',classId:HEROI_PADRAO,maps},t);
for(let i=0;i<count;i++)say({t:'bot-add',round:1},t);
say({t:'ready',round:1,ready:true},t);
const ticks:number[]=[],thinks:number[]=[];
const events={revivedByBot:0,revivedPerson:0,downs:0};
const human=messages.find(m=>m.t==='welcome').id as string;
let lastThink=0;
for(let i=0;i<20*60*25&&room.run.snapshot().phase!=='result';i++){
  t+=50;
  if(i%20===0)say({t:'ack',seq:0},t);
  const started=performance.now();room.advance(t);const ms=performance.now()-started;
  if(room.run.snapshot().phase==='combat'){ticks.push(ms);thinks.push(room.bots.thinkMs-lastThink);}
  lastThink=room.bots.thinkMs;
  for(const e of room.sim.world.lastEvents){
    if(e.type==='revived'&&e.by&&room.sim.bots.has(e.by)){events.revivedByBot++;if(e.player===human)events.revivedPerson++;}
    if(e.type==='downed')events.downs++;
  }
}
const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const mean=(list:number[])=>list.reduce((a,b)=>a+b,0)/Math.max(1,list.length);
const st=room.sim.run.stonewards.state,run=room.run.snapshot(),w=room.sim.world;
const gathered=Object.fromEntries(Object.entries(st.gathered).map(([id,v])=>[room.sim.players.get(id)?.name??id,Math.round(v as number)]));
console.log(JSON.stringify({seed,bots:count,outcome:run.outcome,round:w.round.index,level:w.team.level,combatTicks:ticks.length,combatMinutes:+(ticks.length/20/60).toFixed(2),
  tickMs:{mean:+mean(ticks).toFixed(3),p50:+pct(ticks,.5).toFixed(3),p95:+pct(ticks,.95).toFixed(3),p99:+pct(ticks,.99).toFixed(3),max:+Math.max(...ticks).toFixed(2)},
  botsThinkMs:{meanPerTick:+mean(thinks).toFixed(4),p95:+pct(thinks,.95).toFixed(3),max:+Math.max(...thinks).toFixed(2),share:+(mean(thinks)/Math.max(1e-9,mean(ticks))).toFixed(3)},
  revivedByBot:events.revivedByBot,personRevivedByBot:events.revivedPerson,downs:events.downs,gathered,balance:st.balance,botForges:room.bots.forged,towers:st.towers.length,wallHp:Math.round(st.wall.hp),
  messagesReceivedByRoom:[...room.connections.values()].reduce((s,c)=>s+c.received,0)},null,1));
