/**
 * Minerva wake bench (BUG-20261022-ORQ-minerva-acordar-trava): the cost of one `Simulation.step()` in the Cidade
 * Nevada, mode 'ninhos', from the start of the run through the end of the minuto de Minerva and AFTER_S seconds past
 * it, with PLAYERS room bots. --tour walks bot-1 (teleported every TOUR_EVERY ticks) onto the next sleeper during the
 * minute, the worst case of a hero running through the city: every stop wakes a band that stands held until the end.
 * Nobody falls (hp refilled). Prints the tick cost during the minute, in the wake window (WAKE_S after its end) and
 * after it, the worst ticks with their awake counts, and the final state hash.
 *   node --experimental-strip-types scripts/bench-minerva.ts [--players 1] [--seed 4242] [--tour] [--after 30]
 *     [--out <file.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';
import {FlowField} from '../src/maps/index.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','4242')),PLAYERS=Number(arg('players','1')),AFTER_S=Number(arg('after','30')),OUT=arg('out','');
const TOUR=process.argv.includes('--tour'),HZ=20,WAKE_S=3,TOUR_EVERY=10;
const CLASSES=['cidadao-comum','clt-cansado','feirante','cidadao-comum','clt-cansado','feirante'];

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);

const sim=new Simulation(SEED,{world:'cidade',terrain:loaded.terrain,cityStructures:true,objective:'chaveiro',mode:'ninhos'}),bots=new RoomBots();
for(let i=0;i<PLAYERS;i++){sim.addBot(`bot-${i+1}`,`bot-${i+1}`,CLASSES[i%CLASSES.length]);bots.add(`bot-${i+1}`,i);}
sim.botState=()=>bots.state();
sim.resetRun();
// Flow fields (re)computed per tick: the pathfinding the tick pays (FlowField.recompute, constructor included).
let fields=0;
{const proto=FlowField.prototype as unknown as {recompute():void};const inner=proto.recompute;proto.recompute=function(this:FlowField){fields++;return inner.call(this);};}
const modes=()=>{const m=[0,0,0,0];for(const e of sim.world.enemies.values()){const s=e.memory?.sono;if(typeof s==='number')m[s]++;else m[0]++;}return m;};
const step=()=>{bots.think(sim);const t0=performance.now();sim.step(sim.tick*50);return performance.now()-t0;};
// The first step makes the sleepers and starts the nests (minervaUntil).
step();
const until=sim.run.nests?.state.minervaUntil;
if(until===undefined)throw new Error('no minuto de Minerva in this run');
const sleepersAt=()=>{const z=sim.world.sleepers;if(!z)return [];const all:{id:string;x:number;y:number}[]=[];z.query(0,0,1e6,all as never);return all.filter(e=>!z.isTarget(e.id));};
const stops=TOUR?sleepersAt():[];
const rows:{tick:number;ms:number;awake:number;fields:number;modes:number[]}[]=[];
let stop=0;
const end=until+AFTER_S*HZ;
while(sim.tick<end&&sim.outcome===undefined){
  for(const p of sim.players.values())if(!p.downed&&p.hp>0)p.hp=p.stats.maxHp;
  if(TOUR&&sim.tick<until&&sim.tick%TOUR_EVERY===0&&stops.length){
    // Next stop: the sleeper the farthest along the plan list from the last, so the tour crosses the city.
    const s=stops[(stop++*37)%stops.length],p=sim.players.get('bot-1');
    if(p){p.x=s.x+1;p.y=s.y;}
  }
  fields=0;
  const tick=sim.tick,ms=step();
  rows.push({tick,ms,awake:sim.world.enemies.size,fields,modes:modes()});
}
const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const r2=(v:number)=>+v.toFixed(2);
const stats=(list:typeof rows)=>{const ms=list.map(r=>r.ms);return {n:ms.length,p50:r2(pct(ms,.5)),p95:r2(pct(ms,.95)),max:r2(Math.max(0,...ms))};};
const during=rows.filter(r=>r.tick<until&&r.tick>=HZ*5),wake=rows.filter(r=>r.tick>=until&&r.tick<until+WAKE_S*HZ),after=rows.filter(r=>r.tick>=until+WAKE_S*HZ);
const worst=[...rows.filter(r=>r.tick>=until-HZ)].sort((a,b)=>b.ms-a.ms).slice(0,8).map(r=>({...r,ms:r2(r.ms),dt:r.tick-until}));
const at=(dt:number)=>rows.find(r=>r.tick===until+dt)?.awake;
const out={seed:SEED,players:PLAYERS,tour:TOUR,until,awake:{before:at(-1),at0:at(0),plus1s:at(HZ),plus3s:at(3*HZ),plus10s:at(10*HZ)},
  during:stats(during),wake:stats(wake),after:stats(after),worst,hash:sim.stateHash()};
console.log(JSON.stringify(out,null,1));
if(OUT){fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify({...out,rows:rows.map(r=>[r.tick-until,r2(r.ms),r.awake,r.fields,...r.modes])}));}
