/**
 * Minerva wake bench, the whole room (BUG-20261022-ORQ-minerva-acordar-trava): what `Room.advance()` costs per tick in
 * a solo ninhos city room (combat 'manual', the room the user played), sim plus the frames to the one person, from the
 * start of combat through the end of the minuto de Minerva and AFTER_S seconds past it. The person acks every frame
 * (binary frames are decoded only for their seq); --tour walks the hero onto the next sleeper every TOUR_EVERY ticks
 * during the minute (the worst case: a band woken and held at every stop). Same tables as scripts/bench-minerva.ts.
 *   node --experimental-strip-types scripts/bench-minerva-room.ts [--seed 7] [--tour] [--after 30] [--out <file.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {register} from 'node:module';
import {performance} from 'node:perf_hooks';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {Room,OWNER_GAP_MS}=await import('../multiplayer/room.ts');
const {ROOM_PROTOCOL}=await import('../src/protocol/room.ts');
const {clientCatalog}=await import('../src/protocol/map-catalog.ts');

const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','7')),AFTER_S=Number(arg('after','30')),OUT=arg('out','');
const TOUR=process.argv.includes('--tour'),HZ=20,WAKE_S=3,TOUR_EVERY=10;

const manifest=JSON.parse(fs.readFileSync(new URL('../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=fs.readFileSync(new URL('../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
let t=1000,frames=0,bytes=0;
const room=new Room(t,SEED,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true,mode:'ninhos',combat:'manual'});
await room.ready();
const messages:any[]=[];
const peer={send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else{frames++;bytes+=s.byteLength;}},close:()=>{}};
const say=(m:object)=>room.receive(peer,JSON.stringify(m),t);
room.connect(peer,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)});
t+=OWNER_GAP_MS;say({t:'ready',round:room.run.snapshot().round,ready:true});
for(let i=0;i<2000&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
room.advance(t+=50);
const until=room.sim.run.nests?.state.minervaUntil;
if(until===undefined)throw new Error('no minuto de Minerva in this room');
const id=messages.find(m=>m.t==='welcome').id as string;
const z=room.sim.world.sleepers!,all:{id:string;x:number;y:number}[]=[];
z.query(0,0,1e6,all as never);
const stops=TOUR?all.filter(e=>!z.isTarget(e.id)):[];
const rows:{tick:number;ms:number;awake:number;bytes:number}[]=[];
let stop=0;
while(room.sim.tick<until+AFTER_S*HZ&&room.run.snapshot().phase==='combat'){
  const p=room.sim.players.get(id)!;
  if(p.hp>0&&!p.downed)p.hp=p.stats.maxHp;
  if(TOUR&&room.sim.tick<until&&room.sim.tick%TOUR_EVERY===0&&stops.length){const s=stops[(stop++*37)%stops.length];p.x=s.x+1;p.y=s.y;}
  // The person acks what it got (the encoder's chain stays short, as with a live client).
  say({t:'ack',seq:room.sim.tick});
  const b0=bytes,tick=room.sim.tick,t0=performance.now();
  room.advance(t+=50);
  rows.push({tick,ms:performance.now()-t0,awake:room.sim.world.enemies.size,bytes:bytes-b0});
}
const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const r2=(v:number)=>+v.toFixed(2);
const stats=(list:typeof rows)=>{const ms=list.map(r=>r.ms);return {n:ms.length,p50:r2(pct(ms,.5)),p95:r2(pct(ms,.95)),max:r2(Math.max(0,...ms))};};
const during=rows.filter(r=>r.tick<until&&r.tick>=until-ticksOf(50)),wake=rows.filter(r=>r.tick>=until&&r.tick<until+WAKE_S*HZ),after=rows.filter(r=>r.tick>=until+WAKE_S*HZ);
function ticksOf(s:number){return s*HZ;}
const worst=[...rows.filter(r=>r.tick>=until-HZ)].sort((a,b)=>b.ms-a.ms).slice(0,8).map(r=>({dt:r.tick-until,ms:r2(r.ms),awake:r.awake,bytes:r.bytes}));
const at=(dt:number)=>rows.find(r=>r.tick===until+dt)?.awake;
const out={seed:SEED,tour:TOUR,until,awake:{before:at(-1),at0:at(0),plus1s:at(HZ),plus3s:at(3*HZ),plus10s:at(10*HZ)},
  during:stats(during),wake:stats(wake),after:stats(after),worst,frames,kb:Math.round(bytes/1024)};
console.log(JSON.stringify(out,null,1));
if(OUT){fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify({...out,rows:rows.map(r=>[r.tick-until,r2(r.ms),r.awake,r.bytes])}));}
