/**
 * Top view of the city's sleeping horde (card NEW-20261022-ORQ-monstros-espalhados): the walkable ground, the buildings,
 * the safe places, the nests and every body of the run's plan, as one PNG. Local tool (sharp), never in npm test.
 *
 *   node --experimental-strip-types scripts/mapa-bichos.ts --out <file.png> [--seed 4242] [--players 1] [--pop N]
 *     [--gap D] [--scale 4]
 * --gap overrides the plan's spacing (SPREAD.gap) for the "pick a density" sheet.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {worldBase} from '../src/maps/world.ts';
import * as nestsMod from '../src/maps/nests.ts';
import {citySafePlaces} from '../src/maps/safe-places.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {cityRunStart} from '../src/sim/city/tutorial.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','4242')),PLAYERS=Number(arg('players','1')),OUT=arg('out','mapa-bichos.png'),S=Number(arg('scale','4'));
const pop=arg('pop',''),gap=arg('gap','');
const spread=(nestsMod as unknown as {SPREAD?:{gap:number}}).SPREAD;
if(gap&&spread)spread.gap=Number(gap);

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const sim=new Simulation(SEED,{world:'cidade',terrain:city,objective:'chaveiro',mode:'ninhos',combat:'manual',...(pop?{nestPopulation:Number(pop)}:{})});
for(let i=0;i<PLAYERS;i++)sim.addBot(`bot-${i+1}`,`bot-${i+1}`,'cidadao-comum');
sim.resetRun();sim.step(sim.tick*50);
const plan=sim.run.nests!.plan()!;
const a=city.asset,cs=a.unitsPerCell,W=a.cells.w*S,H=a.cells.h*S,px=Buffer.alloc(W*H*4);
const put=(x:number,y:number,c:readonly number[])=>{if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;px[o]=c[0];px[o+1]=c[1];px[o+2]=c[2];px[o+3]=255;};
const disc=(ux:number,uy:number,r:number,c:readonly number[])=>{const cx=ux/cs*S,cy=uy/cs*S;for(let y=Math.floor(cy-r);y<=cy+r;y++)for(let x=Math.floor(cx-r);x<=cx+r;x++)if((x-cx)**2+(y-cy)**2<=r*r)put(x,y,c);};
const ring=(ux:number,uy:number,ru:number,c:readonly number[])=>{const cx=ux/cs*S,cy=uy/cs*S,r=ru/cs*S;for(let t=0;t<Math.PI*2;t+=.5/r){put(Math.round(cx+r*Math.cos(t)),Math.round(cy+r*Math.sin(t)),c);}};
const safe=citySafePlaces(city);
const safeCells=new Set<number>();for(const s of safe)for(const k of s.cells)safeCells.add(k);
for(let cy=0;cy<a.cells.h;cy++)for(let cx=0;cx<a.cells.w;cx++){
  const ux=(cx+.5)*cs,uy=(cy+.5)*cs,open=city.clearDisc(ux,uy,.5);
  const c=safeCells.has(cy*a.cells.w+cx)?[150,220,150]:open?[236,232,224]:[90,96,110];
  for(let y=0;y<S;y++)for(let x=0;x<S;x++)put(cx*S+x,cy*S+y,c);
}
const car=worldBase(city),start=cityRunStart(city);
for(const n of plan.nests){ring(n.x,n.y,n.radius,[150,40,160]);ring(n.x,n.y,n.radius+.4,[150,40,160]);}
let count=0;
for(const n of plan.nests)for(const p of n.sleepers){disc(p.x,p.y,Math.max(1.2,S*.35),[160,40,170]);count++;}
for(const b of plan.loose)for(const p of b.members){disc(p.x,p.y,Math.max(1.2,S*.35),b.training?[230,140,0]:[210,30,30]);count++;}
for(const s of safe){disc(s.opening.x,s.opening.y,S*.9,[0,120,0]);}
disc(car.x,car.y,S*1.6,[30,90,220]);disc(start.x,start.y,S*1.2,[20,170,60]);
const label=`seed ${SEED} · ${PLAYERS} jogador(es) · ${count} bichos${plan.gap?` · 1 a cada ${plan.gap} u`:''} · ${safe.length} lugar(es) seguro(s)`;
const svg=Buffer.from(`<svg width="${W}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="23" font-family="Arial" font-size="18">${label}</text></svg>`);
await sharp({create:{width:W,height:H+34,channels:4,background:'#ffffff'}}).composite([{input:svg,top:0,left:0},{input:px,raw:{width:W,height:H,channels:4},top:34,left:0}]).png().toFile(OUT);
console.log(OUT,label);
