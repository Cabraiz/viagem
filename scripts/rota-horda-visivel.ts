/**
 * Route for scripts/prova-horda-visivel.mjs (card NEW-20261022-ORQ-horda-visivel-capacidade): the same walk in every
 * run. Builds the room's city plan for `--seed` with `--players` (the solo room: the person + 3 bots), then a
 * breadth-first path over 1 u walkable cells that keep KEEP_U from every sleeper (nobody wakes: WAKE_SIGHT is 5 u),
 * from the start to the reachable cell nearest each of the `--nests` nests nearest the start, in turn.
 * Prints JSON {seed, start, nests:[{id,x,y}], points:[[x,y],…]} (points every `--step` u along the path).
 *   node --experimental-strip-types scripts/rota-horda-visivel.ts [--seed 4242] [--players 4] [--nests 3] [--step 3.1] > rota.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {walkable} from '../src/maps/index.ts';
import {Simulation} from '../multiplayer/simulation.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','4242')),PLAYERS=Number(arg('players','4')),NESTS=Number(arg('nests','3')),STEP=Number(arg('step','3.1'));
const KEEP_U=6;

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const sim=new Simulation(SEED,{world:'cidade',terrain:city,cityStructures:true,objective:'chaveiro',mode:'ninhos'});
for(let i=0;i<PLAYERS;i++)sim.addBot(`p${i}`,`p${i}`,'cidadao-comum');
sim.resetRun();sim.step(sim.tick*50);
const start=[...sim.players.values()][0];
const plan=sim.run.nests!.plan();
const W=Math.ceil(city.asset.cells.w*city.asset.unitsPerCell),H=Math.ceil(city.asset.cells.h*city.asset.unitsPerCell);
const free=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++)free[y*W+x]=walkable({x:x+.5,y:y+.5},city)?1:0;
const sleepers=[...plan.nests.flatMap(n=>n.sleepers),...plan.loose.flatMap(b=>b.members)];
for(const s of sleepers)for(let y=Math.floor(s.y-KEEP_U);y<=Math.ceil(s.y+KEEP_U);y++)for(let x=Math.floor(s.x-KEEP_U);x<=Math.ceil(s.x+KEEP_U);x++)
  if(x>=0&&y>=0&&x<W&&y<H&&Math.hypot(x+.5-s.x,y+.5-s.y)<KEEP_U)free[y*W+x]=0;
/** BFS from `from` (a cell index): the parent of every reached cell. */
function bfs(from:number){
  const prev=new Int32Array(W*H).fill(-2);prev[from]=-1;const q=[from];
  for(let i=0;i<q.length;i++){const c=q[i],x=c%W,y=(c/W)|0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,n=ny*W+nx;if(nx>=0&&ny>=0&&nx<W&&ny<H&&free[n]&&prev[n]===-2){prev[n]=c;q.push(n);}}}
  return prev;
}
let at=Math.floor(start.y)*W+Math.floor(start.x);free[at]=1;
const order=[...plan.nests].sort((a,b)=>Math.hypot(a.x-start.x,a.y-start.y)-Math.hypot(b.x-start.x,b.y-start.y)).slice(0,NESTS);
const cells:number[]=[at];
for(const n of order){
  const prev=bfs(at);let best=-1,bd=Infinity;
  for(let c=0;c<W*H;c++)if(prev[c]!==-2){const d=Math.hypot((c%W)+.5-n.x,((c/W)|0)+.5-n.y);if(d<bd){bd=d;best=c;}}
  const leg:number[]=[];for(let c=best;c!==at&&c>=0;c=prev[c])leg.push(c);
  cells.push(...leg.reverse());at=best;
}
// Resample every STEP u along the cell path.
const pts:[number,number][]=[];let acc=0,last=cells[0];pts.push([(last%W)+.5,((last/W)|0)+.5]);
for(const c of cells.slice(1)){acc+=1;if(acc>=STEP){pts.push([(c%W)+.5,((c/W)|0)+.5]);acc=0;}last=c;}
console.log(JSON.stringify({seed:SEED,players:PLAYERS,start:{x:start.x,y:start.y},nests:order.map(n=>({id:n.id,x:n.x,y:n.y,size:n.size})),length:cells.length,points:pts}));
