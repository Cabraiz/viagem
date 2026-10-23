/**
 * Bot walking speed bench (BUG-20261023-ORQ-bots-na-nossa-velocidade): in a headless city Room (the real asset, the
 * room's own bots, D-025) a person and three bots of the same class; the critters are cleared every tick, so only the
 * walk is measured. The person is moved by the bench at the hero speed (one step per tick, heroSpeed/SIM_HZ along a
 * string-pulled street route: a person who knows the way), like tests/rooms/city-room-bots.test.ts moves Ana.
 *
 * Scenarios (each from a fresh room, seed 4242):
 *  - escort: the person walks away from the plaza down an avenue (straight) and then on a city route, the roamer bot
 *    (slot 1) starting next to them. Reported: the person's u/s, the bot's u/s while the person walks (standing time
 *    counts), the gap at the end, and the bot's u/s over the whole time until it is back within the escort leash.
 *  - home: a bot dropped far from the base walks home on its own; its u/s = the ideal street route / the time it took
 *    to come within the leash (standing counts), against the person's u/s on the same route.
 *
 *   node --experimental-strip-types scripts/bench-bot-speed.ts [--json out.json]
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS} from '../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../src/protocol/room.ts';
import {clientCatalog} from '../src/protocol/map-catalog.ts';
import type {MapRef} from '../src/protocol/map-select.ts';
import {FlowField} from '../src/maps/flowfield.ts';
import {clearSegment,heroSpeed,walkable,type Point} from '../src/maps/world.ts';
import {SIM_HZ} from '../src/contract/types.ts';
import {cityFlowGrid,cityTerrainOf} from '../src/sim/city/grid.ts';
import {homeOf,ESCORT_LEASH,LEASH} from '../src/sim/bot-brain.ts';

const manifest=JSON.parse(readFileSync(new URL('../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const CLASS='cidadao-comum';
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const say=(room:Room,p:any,m:object,now:number)=>room.receive(p,JSON.stringify(m),now);
function peer(){const messages:any[]=[];return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};}

async function freshRoom(){
  let n=0;
  const room=new Room(1000,4242,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',newId:()=>`pessoa-${++n}`}),a=peer();
  await room.ready();
  let t=1000;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:CLASS,maps:clientCatalog(CITY)},t);
  const ana=a.messages.find(m=>m.t==='welcome')?.id as string;
  for(let i=0;i<3;i++)say(room,a,{t:'bot-add',round:room.run.snapshot().round,classId:CLASS},t+=OWNER_GAP_MS);
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t+=OWNER_GAP_MS);
  // The round's wave (round 1 opens with a 3 s countdown, round.phase 'prepare', inside the room's combat).
  for(;room.run.snapshot().phase!=='combat'||room.sim.botView().round?.phase!=='wave';t+=50)room.advance(t);
  const sim=room.sim,city=cityTerrainOf(sim.terrain)!;
  const bots=[...sim.bots];
  const slots=(room as any).bots as {slotOf(id:string):number};
  // The wave stays on (an empty wave would end the round): its critters are parked far west, out of every walk here.
  const park=city.asset.points.spawnO;
  const calm=()=>{const w=sim.world as any;for(const e of w.enemies.values()){e.x=park.x;e.y=park.y;}w.projectiles?.clear?.();w.telegraphs?.clear?.();};
  const step=()=>{calm();t+=50;if(sim.tick%SIM_HZ===0)say(room,a,{t:'ack',seq:0},t);room.advance(t);calm();};
  return {room,sim,city,ana,bots,slots,step,phase:()=>room.run.snapshot().phase,classes:bots.map(id=>sim.players.get(id)!.classId)};
}

/** A street route from `from` to `to` on the hero grid, string-pulled with the hero's clearSegment (a person's line). */
function route(city:any,from:Point,to:Point):Point[]{
  const field=new FlowField(cityFlowGrid(city),[to]),cells:Point[]=[from],d={x:0,y:0};
  let p={...from};
  for(let i=0;i<4000&&dist(p,to)>.6;i++){
    field.directionAt(p.x,p.y,d);
    if(!d.x&&!d.y)break;
    p={x:p.x+d.x*.25,y:p.y+d.y*.25};cells.push(p);
  }
  cells.push(to);
  const out:Point[]=[from];let at=0;
  while(at<cells.length-1){let next=cells.length-1;while(next>at+1&&!clearSegment(cells[at],cells[next],city))next--;out.push(cells[next]);at=next;}
  return out;
}
const length=(path:Point[])=>path.slice(1).reduce((s,p,i)=>s+dist(path[i],p),0);
/** The point `s` u along `path`. */
function along(path:Point[],s:number):Point{
  for(let i=1;i<path.length;i++){const l=dist(path[i-1],path[i]);if(s<=l){const k=l>0?s/l:0;return {x:path[i-1].x+(path[i].x-path[i-1].x)*k,y:path[i-1].y+(path[i].y-path[i-1].y)*k};}s-=l;}
  return path[path.length-1];
}
/** A walkable spot `r` u from `c` toward angle a (searching around). */
function spotNear(city:any,c:Point,r:number,a=0):Point{
  for(let k=0;k<64;k++){const b=a+k*Math.PI/32,p={x:c.x+Math.cos(b)*r,y:c.y+Math.sin(b)*r};if(walkable(p,city))return p;}
  return c;
}

interface Row {scenario:string;bot:string;person:number;botSpeed:number;ratio:number;extra:string}
const rows:Row[]=[];

async function escort(label:string,target:(city:any,home:Point)=>Point,seconds:number,from=LEASH+2){
  const r=await freshRoom(),{sim,city}=r,v=heroSpeed(city);
  const roamer=r.bots.find(id=>r.slots.slotOf(id)%2===1)!;
  const view=sim.botView(),home=homeOf(view,city.asset.points.praca);
  // The person starts out of the wall's leash on the way to the target (the escort starts there), next to the bot.
  const way=route(city,home,target(city,home)),start=along(way,from),path=route(city,start,target(city,home)),total=Math.min(length(path),v*seconds);
  const p=sim.players.get(r.ana)!,b=sim.players.get(roamer)!;
  p.x=start.x;p.y=start.y;const bs=spotNear(city,start,1.2,Math.PI);b.x=bs.x;b.y=bs.y;
  for(let i=0;i<8;i++)r.step(); // the bot sees the person out of the leash
  let s=0,botWalk=0,last={x:b.x,y:b.y},ticksWalk=0,moving=0;
  const gaps:number[]=[],modes=new Map<string,number>(),phases=new Set<string>();
  while(s<total){
    s=Math.min(total,s+v/SIM_HZ);const q=along(path,s);p.x=q.x;p.y=q.y;
    r.step();ticksWalk++;
    const m=dist(last,b);botWalk+=m;if(m>1e-6)moving++;last={x:b.x,y:b.y};gaps.push(dist(p,b));const md=String((r.room as any).bots.modes.get(roamer));modes.set(md,(modes.get(md)??0)+1);phases.add(String(sim.botView().round?.phase));
  }
  const gapEnd=dist(p,b),walkPhase=botWalk;let catchTicks=0;
  while(dist(p,b)>ESCORT_LEASH&&catchTicks<SIM_HZ*30){r.step();catchTicks++;botWalk+=dist(last,b);last={x:b.x,y:b.y};}
  const person=total/(ticksWalk/SIM_HZ),botSpeed=walkPhase/(ticksWalk/SIM_HZ),catchSpeed=(botWalk-walkPhase)/Math.max(1e-9,catchTicks/SIM_HZ);
  rows.push({scenario:`escort ${label}`,bot:`${roamer} (${sim.players.get(roamer)!.classId})`,person,botSpeed,ratio:botSpeed/person,
    extra:`walk ${total.toFixed(1)} u in ${(ticksWalk/SIM_HZ).toFixed(1)} s; bot moving ${(100*moving/ticksWalk).toFixed(0)} % of ticks; gap mean ${(gaps.reduce((x,y)=>x+y,0)/gaps.length).toFixed(2)} u, end ${gapEnd.toFixed(2)} u; modes ${[...modes].map(([k,n])=>k+' '+(100*n/ticksWalk).toFixed(0)+'%').join(' ')}; phases ${[...phases].join('/')}; back within ${ESCORT_LEASH} u ${(catchTicks/SIM_HZ).toFixed(1)} s later at ${catchSpeed.toFixed(2)} u/s`});
}

async function home(label:string,from:(city:any,home:Point)=>Point){
  const r=await freshRoom(),{sim,city}=r,v=heroSpeed(city);
  const view=sim.botView(),h=homeOf(view,city.asset.points.praca);
  const p=sim.players.get(r.ana)!;p.x=h.x+1;p.y=h.y+1;
  if(!walkable(p,city)){const q=spotNear(city,h,2);p.x=q.x;p.y=q.y;}
  for(const id of r.bots){
    const b=sim.players.get(id)!,f=from(city,h);
    // The person on the same street route (string-pulled) until within the same LEASH of home: the ideal walk.
    const path=route(city,f,h);let ideal=0;while(ideal<length(path)&&dist(along(path,ideal),h)>LEASH)ideal+=v/SIM_HZ;
    b.x=f.x;b.y=f.y;
    let t=0,walked=0,last={x:b.x,y:b.y};
    // Only this bot is far: the others are parked at home.
    for(const o of r.bots)if(o!==id){const ob=sim.players.get(o)!;const q=spotNear(city,h,2,1+r.bots.indexOf(o));ob.x=q.x;ob.y=q.y;}
    const modes=new Map<string,number>(),phases=new Set<string>();
    while(dist(b,h)>LEASH&&t<SIM_HZ*120){r.step();t++;const md=String((r.room as any).bots.modes.get(id));modes.set(md,(modes.get(md)??0)+1);phases.add(String(sim.botView().round?.phase));walked+=dist(last,b);last={x:b.x,y:b.y};}
    const botSpeed=ideal/(t/SIM_HZ);
    rows.push({scenario:`home ${label}`,bot:`${id} slot ${r.slots.slotOf(id)}`,person:v,botSpeed,ratio:botSpeed/v,
      extra:`ideal ${ideal.toFixed(1)} u, took ${(t/SIM_HZ).toFixed(1)} s (person ${(ideal/v).toFixed(1)} s), walked ${walked.toFixed(1)} u (${(walked/ideal*100).toFixed(0)} % of ideal); modes ${[...modes].map(([k,n])=>k+' '+(100*n/t).toFixed(0)+'%').join(' ')}; phases ${[...phases].join('/')}`});
  }
}

const N=(city:any)=>city.asset.points.spawnN,S=(city:any)=>city.asset.points.spawnS,L=(city:any)=>city.asset.points.spawnL;
await escort('to mouth N (avenue)',(c)=>c.asset.points.bocas.N,12);
await escort('to spawn S (route)',S,20);
await escort('to spawn L (route)',L,20);
// Leaving the base: the person starts inside the wall's leash (2 u out) and walks out.
await escort('from base to S',S,20,2);
await escort('from base to L',L,20,2);
await home('from mouth N',(c)=>c.asset.points.bocas.N);
await home('from spawn N',N);
const pad=(s:string,n:number)=>s.padEnd(n);
console.log(`${pad('scenario',24)} ${pad('bot',28)} person u/s  bot u/s  bot/person`);
for(const r of rows)console.log(`${pad(r.scenario,24)} ${pad(r.bot,28)} ${r.person.toFixed(3).padStart(10)} ${r.botSpeed.toFixed(3).padStart(8)} ${(r.ratio*100).toFixed(1).padStart(9)} %  ${r.extra}`);
const out=process.argv.indexOf('--json');
if(out>0)writeFileSync(process.argv[out+1],JSON.stringify(rows,null,1));
