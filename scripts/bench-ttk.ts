/**
 * TTK bench of the first minutes (card NEW-20261022-ORQ-upgrades-megabonk): plays the room's city run with bots
 * (scripts/bench-city-run.ts playRun, the same navigation wrapper, chaveiro + manual combat + ninhos by default) and,
 * by patching Simulation.step, reads every step's events: for each enemy, the tick of its first hit and of its kill.
 * TTK = kill − first hit (s). Per minute of the run: kills, median and p75 TTK, the damage to enemies by weapon, the
 * team level and the downs. A checkout is given with --root (default: this one), so the same script measures
 * origin/main (a worktree of it) before and this branch after.
 *   node --experimental-strip-types scripts/bench-ttk.ts [--root <checkout>] [--seeds 1-4] [--players 1,4] [--minutes 8]
 *     [--out evidence/<card>/ttk-<name>.json] [--legacy] (--legacy: the default auto weapons, waves and no chaveiro)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const argv=process.argv.slice(2);
const get=(name:string)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};
const HERE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROOT=path.resolve(get('--root')??HERE);
const range=(s:string)=>s.split(',').flatMap(p=>{const [a,b]=p.split('-').map(Number);return b===undefined?[a]:Array.from({length:b-a+1},(_,i)=>a+i);});
const seeds=range(get('--seeds')??'1-4'),players=range(get('--players')??'1,4'),minutes=Number(get('--minutes')??8);
const out=path.resolve(get('--out')??path.join(HERE,'evidence','upgrades-megabonk',`ttk-${path.basename(ROOT)}.json`));
const legacy=argv.includes('--legacy');
try{os.setPriority(0,os.constants.priority.PRIORITY_LOW);}catch{/* best effort */}

const imp=(p:string)=>import(pathToFileURL(path.join(ROOT,p)).href);
const bench=await imp('scripts/bench-city-run.ts');
const {Simulation}=await imp('multiplayer/simulation.ts');
const {cityTerrainFrom}=await imp('src/maps/city/terrain.ts');
const HZ=20;

interface Minute {kills:number;ttk:number[];hits:number[];damage:Record<string,number>;level:number;downs:number}
interface Run {seed:number;players:number;minutes:Minute[];outcome:string;endMin:number}
const hooks:{each?:(sim:{events:readonly {type:string;[k:string]:unknown}[];tick:number;world?:unknown})=>void}={};
const step=Simulation.prototype.step;
Simulation.prototype.step=function(this:{events:readonly {type:string;[k:string]:unknown}[];tick:number},...a:unknown[]){
  const r=step.apply(this,a);hooks.each?.(this);return r;
};

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,nav=new bench.CityNavigator(city);
const runs:Run[]=[];
const median=(xs:number[],q=.5)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return Math.round(s[Math.min(s.length-1,Math.floor(q*s.length))]*100)/100;};
for(const seed of seeds)for(const n of players){
  const first=new Map<string,number>(),count=new Map<string,number>(),mins:Minute[]=Array.from({length:minutes},()=>({kills:0,ttk:[],hits:[],damage:{},level:1,downs:0}));
  let start:number|undefined;
  hooks.each=sim=>{
    start??=sim.tick;
    const m=mins[Math.min(minutes-1,Math.floor((sim.tick-start)/(60*HZ)))];
    for(const e of sim.events){
      if(e.type==='damage'){
        // A hero's damage event names the bot (bot1…); everything else is an enemy (or a nest).
        const t=String(e.target);
        if(t.startsWith('bot'))continue;
        if(!first.has(t))first.set(t,sim.tick);
        count.set(t,(count.get(t)??0)+1);
        const w=String(e.weapon??'?');m.damage[w]=(m.damage[w]??0)+Number(e.amount);
      }else if(e.type==='kill'){
        const t=String(e.enemy),f=first.get(t);
        m.kills++;if(f!==undefined)m.ttk.push((sim.tick-f)/HZ);m.hits.push(count.get(t)??1);first.delete(t);count.delete(t);
      }else if(e.type==='levelup')m.level=Number(e.level);
      else if(e.type==='down')m.downs++;
    }
  };
  const t0=Date.now();
  const run=bench.playRun({seed,players:n,capTicks:minutes*60*HZ,city,nav,route:'none',towers:true,
    ...(legacy?{}:{objective:'chaveiro',combat:'manual',mode:'ninhos'})});
  for(let i=1;i<minutes;i++)if(mins[i].level<mins[i-1].level)mins[i].level=mins[i-1].level;
  runs.push({seed,players:n,minutes:mins,outcome:`${run.outcome}/${run.cause}`,endMin:Math.round(run.ticks/HZ/6)/10});
  const row=mins.map((m,i)=>`m${i+1}:${m.kills}k ttk${median(m.ttk)} L${m.level}`).join(' ');
  console.log(`seed ${seed} ${n}p ${run.outcome}/${run.cause} @${(run.ticks/HZ/60).toFixed(1)}min (${((Date.now()-t0)/1000).toFixed(0)} s) | ${row}`);
}
hooks.each=undefined;
// Summary per team size and minute: kills (mean), TTK median and p75 over all kills, level (mean).
const summary:Record<string,unknown>={};
for(const n of players){
  const rs=runs.filter(r=>r.players===n);
  summary[`${n}p`]=Array.from({length:minutes},(_,i)=>{
    const ttk=rs.flatMap(r=>r.minutes[i].ttk),dmg:Record<string,number>={};
    for(const r of rs)for(const [w,d] of Object.entries(r.minutes[i].damage))dmg[w]=Math.round((dmg[w]??0)+d/rs.length);
    const hits=rs.flatMap(r=>r.minutes[i].hits);
    return {min:i+1,hitsMedian:median(hits),hitsMean:hits.length?Math.round(hits.reduce((a,b)=>a+b,0)/hits.length*100)/100:null,kills:Math.round(rs.reduce((s,r)=>s+r.minutes[i].kills,0)/rs.length*10)/10,ttkMedian:median(ttk),ttkP75:median(ttk,.75),
      level:Math.round(rs.reduce((s,r)=>s+r.minutes[i].level,0)/rs.length*10)/10,downs:rs.reduce((s,r)=>s+r.minutes[i].downs,0),damageByWeapon:dmg};
  });
}
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({root:ROOT,seeds,players,minutes,legacy,summary,runs:runs.map(r=>({...r,minutes:r.minutes.map(m=>({...m,ttk:undefined,hits:undefined,ttkMedian:median(m.ttk),hitsMedian:median(m.hits)}))}))},null,1));
for(const [k,v] of Object.entries(summary))console.log(k,(v as {min:number;kills:number;ttkMedian:number|null;hitsMean:number|null;level:number}[]).map(m=>`m${m.min} ${m.kills}k ttk ${m.ttkMedian}s ${m.hitsMean}golpes L${m.level}`).join(' | '));
console.log('→',out);
