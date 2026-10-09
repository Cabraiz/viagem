/**
 * Spatial index benchmark (VGM-032): SpatialHash vs NaiveIndex on horde-sized sets.
 * Run: node --experimental-strip-types scripts/bench-sim.ts
 * Writes artifacts/bench/sim-<YYYY-MM-DD>.json next to the repo root. Local node timing only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Rng} from '../src/game/sim/rng.ts';
import {NaiveIndex,SpatialHash,DEFAULT_CELL_SIZE} from '../src/game/sim/spatial.ts';
import type {SpatialIndex} from '../src/game/sim/types.ts';

type Enemy={id:string;x:number;y:number;radius:number};
type Index=SpatialIndex<Enemy>;
type Result={n:number;index:string;cellSize?:number;metric:string;unit:'us'|'ms';median:number;p95:number;samples:number};

const SEED=0x032b3e7,WARMUP=200,ITER=3000;
/** Inner repetitions for sub-microsecond ops, so timer granularity does not dominate the sample. */
const REPS=10;
const COUNTS=[50,100,200,300,500],PLAYERS=6;
const MIN=2,MAX=22,JITTER=0.05;
const WEAPON_R=3,NEAREST_R=8,SEP_R=1;
const CELL_SIZES=[1,2,4],CELL_COUNTS=[300,500];

const clamp=(v:number)=>v<MIN?MIN:v>MAX?MAX:v;
let sink=0;// Keeps results observable so the JIT cannot drop the work.

function makeEnemies(rng:Rng,n:number):Enemy[]{
  const out:Enemy[]=[];
  for(let i=0;i<n;i++)out.push({id:`e${i}`,x:rng.range(MIN,MAX),y:rng.range(MIN,MAX),radius:rng.range(0.3,0.5)});
  return out;
}
function jitter(rng:Rng,enemies:Enemy[]){for(const e of enemies){e.x=clamp(e.x+rng.range(-JITTER,JITTER));e.y=clamp(e.y+rng.range(-JITTER,JITTER));}}

/** Full enemy-ai separation pass: neighbours within SEP_R push each enemy away, weighted by overlap. */
function separation(index:Index,enemies:Enemy[],out:Enemy[]){
  let acc=0;
  for(const e of enemies){
    index.query(e.x,e.y,SEP_R,out);
    let px=0,py=0;
    for(let i=0;i<out.length;i++){
      const o=out[i];if(o===e)continue;
      const dx=e.x-o.x,dy=e.y-o.y,d=Math.sqrt(dx*dx+dy*dy);
      if(d<1e-6){px+=1;continue;}
      const w=(SEP_R-d)/SEP_R;px+=dx/d*w;py+=dy/d*w;
    }
    acc+=px+py;
  }
  return acc;
}
function playerQueries(index:Index,players:{x:number;y:number}[],out:Enemy[]){
  let acc=0;
  for(const p of players)acc+=index.query(p.x,p.y,WEAPON_R,out).length;
  for(const p of players)acc+=index.nearest(p.x,p.y,NEAREST_R)?.radius??0;
  return acc;
}

const median=(s:Float64Array)=>s[Math.floor(s.length/2)];
const p95=(s:Float64Array)=>s[Math.min(s.length-1,Math.floor(s.length*0.95))];

/**
 * Times `run` ITER times after WARMUP. `prepare` (untimed) jitters positions and may rebuild.
 * Each call gets a fresh Rng with the same seed, so every index sees the same position sequence.
 */
function measure(n:number,prepare:(rng:Rng,enemies:Enemy[])=>void,run:(enemies:Enemy[])=>number,scale:number){
  const rng=new Rng(SEED^n),enemies=makeEnemies(rng,n),samples=new Float64Array(ITER);
  for(let i=0;i<WARMUP+ITER;i++){
    prepare(rng,enemies);
    const t0=performance.now();sink+=run(enemies);const dt=performance.now()-t0;
    if(i>=WARMUP)samples[i-WARMUP]=dt*scale;
  }
  samples.sort();
  return {median:median(samples),p95:p95(samples)};
}

function makePlayers(n:number){const rng=new Rng(SEED^0xbeef^n);return Array.from({length:PLAYERS},()=>({x:rng.range(MIN,MAX),y:rng.range(MIN,MAX)}));}

const idSet=(items:Enemy[])=>items.map(i=>i.id).sort().join(',');

/** Asserts hash and naive agree on query id sets and nearest ids for a sample of probes. */
function sanity(n:number,cellSize:number){
  const rng=new Rng(SEED^0x5a17^n^cellSize),enemies=makeEnemies(rng,n);
  const hash=new SpatialHash<Enemy>(cellSize),naive=new NaiveIndex<Enemy>();
  for(let round=0;round<5;round++){
    jitter(rng,enemies);hash.rebuild(enemies);naive.rebuild(enemies);
    const probes:[number,number,number][]=[];
    for(const p of makePlayers(n))probes.push([p.x,p.y,WEAPON_R],[p.x,p.y,NEAREST_R]);
    for(let i=0;i<40;i++){const e=enemies[rng.int(0,n-1)];probes.push([e.x,e.y,SEP_R]);}
    for(let i=0;i<40;i++)probes.push([rng.range(0,24),rng.range(0,24),rng.range(0,12)]);
    for(const [x,y,r] of probes){
      const a=idSet(hash.query(x,y,r)),b=idSet(naive.query(x,y,r));
      const na=hash.nearest(x,y,r)?.id,nb=naive.nearest(x,y,r)?.id;
      if(a!==b||na!==nb){
        console.error(`MISMATCH n=${n} cell=${cellSize} probe=(${x},${y},r=${r}) query ${a===b?'ok':'differs'} nearest hash=${na} naive=${nb}`);
        process.exit(1);
      }
    }
  }
}

const started=performance.now();
for(const n of COUNTS)for(const c of CELL_SIZES)sanity(n,c);

const results:Result[]=[];
const push=(n:number,index:string,metric:string,unit:'us'|'ms',r:{median:number;p95:number},cellSize?:number)=>
  results.push({n,index,...(cellSize!==undefined?{cellSize}:{}),metric,unit,median:+r.median.toFixed(4),p95:+r.p95.toFixed(4),samples:ITER});

const makers:[string,()=>Index][]=[['hash',()=>new SpatialHash<Enemy>()],['naive',()=>new NaiveIndex<Enemy>()]];
for(const n of COUNTS){
  const players=makePlayers(n);
  for(const [name,make] of makers){
    const idx=make(),out:Enemy[]=[];
    const rebuilt=(rng:Rng,e:Enemy[])=>{jitter(rng,e);idx.rebuild(e);};
    push(n,name,'rebuild','us',measure(n,jitter,e=>{for(let r=0;r<REPS;r++)idx.rebuild(e);return 0;},1000/REPS));
    push(n,name,'query r3 /op','us',measure(n,rebuilt,()=>{let a=0;for(let r=0;r<REPS;r++)for(const p of players)a+=idx.query(p.x,p.y,WEAPON_R,out).length;return a;},1000/PLAYERS/REPS));
    push(n,name,'nearest r8 /op','us',measure(n,rebuilt,()=>{let a=0;for(let r=0;r<REPS;r++)for(const p of players)a+=idx.nearest(p.x,p.y,NEAREST_R)?.radius??0;return a;},1000/PLAYERS/REPS));
    push(n,name,'separation','ms',measure(n,rebuilt,e=>separation(idx,e,out),1));
    push(n,name,'tick','ms',measure(n,jitter,e=>{idx.rebuild(e);return separation(idx,e,out)+playerQueries(idx,players,out);},1));
  }
}
for(const n of CELL_COUNTS)for(const c of CELL_SIZES){
  const idx=new SpatialHash<Enemy>(c),out:Enemy[]=[];
  push(n,'hash','separation','ms',measure(n,(rng,e)=>{jitter(rng,e);idx.rebuild(e);},e=>separation(idx,e,out),1),c);
}
const elapsed=(performance.now()-started)/1000;

// ---------- Output ----------
const get=(n:number,index:string,metric:string,cell?:number)=>results.find(r=>r.n===n&&r.index===index&&r.metric===metric&&r.cellSize===cell)!;
const fmt=(r:Result)=>`${r.median.toFixed(r.unit==='ms'?4:3)}/${r.p95.toFixed(r.unit==='ms'?4:3)}`;
const metrics=['rebuild','query r3 /op','nearest r8 /op','separation','tick'];
const header=['N','index','rebuild us','query us/op','nearest us/op','separation ms','tick ms'];
const rows:string[][]=[];
for(const n of COUNTS)for(const [name] of makers)rows.push([String(n),name,...metrics.map(m=>fmt(get(n,name,m)))]);
const widths=header.map((h,i)=>Math.max(h.length,...rows.map(r=>r[i].length)));
const line=(cells:string[])=>cells.map((c,i)=>c.padStart(widths[i])).join('  ');
console.log(`Spatial index bench (median/p95, ${ITER} iterations after ${WARMUP} warm-up, seed 0x${SEED.toString(16)})`);
console.log(line(header));
for(const r of rows)console.log(line(r));
console.log('\nSeparation pass by hash cell size (ms, median/p95)');
console.log(['N',...CELL_SIZES.map(c=>`cell ${c}${c===DEFAULT_CELL_SIZE?'*':''}`)].map(s=>s.padStart(16)).join(''));
for(const n of CELL_COUNTS)console.log([String(n),...CELL_SIZES.map(c=>fmt(get(n,'hash','separation',c)))].map(s=>s.padStart(16)).join(''));
console.log(`\nAll ${COUNTS.length*CELL_SIZES.length} sanity sets matched naive. Total ${elapsed.toFixed(1)} s.`);

const now=new Date(),pad2=(v:number)=>String(v).padStart(2,'0');
const day=`${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','artifacts','bench');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`sim-${day}.json`);
fs.writeFileSync(file,JSON.stringify({
  date:now.toISOString(),node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model??'unknown',
  iterations:ITER,warmup:WARMUP,innerReps:REPS,seed:SEED,defaultCellSize:DEFAULT_CELL_SIZE,elapsedSeconds:+elapsed.toFixed(2),
  note:'Medição local em node, não é capacidade de produção (Workers/Durable Objects têm CPU e limites diferentes).',
  results,
},null,2)+'\n');
console.log(`JSON: ${file}${sink===Infinity?' ':''}`);
