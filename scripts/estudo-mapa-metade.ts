/**
 * Estudo E5 (card NEW-20261022-ORQ-estudo-escala-mapa, the user 22/10: "diminuir o mapa em 2x, height e width"): the
 * Cidade Nevada cut to half its width and half its height (¼ of the area) around the plaza, at today's drawing scale.
 * A study, nothing in the game changes: the top view of today's map with the cut marked, the cut alone at the same
 * pixels per unit, and the numbers of what falls inside it (ground, bodies, crates, nests, safe places, walks).
 * Local tool (sharp), never in npm test.
 *
 *   node --experimental-strip-types scripts/estudo-mapa-metade.ts --out <dir> [--seed 4242] [--players 1] [--scale 4]
 * Writes <dir>/e5-antes.png, <dir>/e5-depois.png and <dir>/e5-numeros.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {heroSpeed,worldBase} from '../src/maps/world.ts';
import {FlowField,STRAIGHT_COST,UNREACHABLE} from '../src/maps/flowfield.ts';
import {CITY_NEST_POOL,FIELD_BODIES,SPREAD,fieldTarget,spreadGap} from '../src/maps/nests.ts';
import {citySafePlaces} from '../src/maps/safe-places.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {cityRunStart} from '../src/sim/city/tutorial.ts';
import {MINERVA_S} from '../src/sim/ninhos/ninhos.ts';
import {crateCap} from '../src/sim/crates.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','4242')),PLAYERS=Number(arg('players','1')),OUT=arg('out','.'),S=Number(arg('scale','4'));
fs.mkdirSync(OUT,{recursive:true});

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,a=city.asset,cs=a.unitsPerCell;
const sim=new Simulation(SEED,{world:'cidade',terrain:city,objective:'chaveiro',mode:'ninhos',combat:'manual'});
for(let i=0;i<PLAYERS;i++)sim.addBot(`bot-${i+1}`,`bot-${i+1}`,'cidadao-comum');
sim.resetRun();sim.step(sim.tick*50);
const plan=sim.run.nests!.plan()!;

// The cut: half the playable side in cells, centred on the plaza, kept inside the playable square.
const P=a.playable,side=Math.round(P.w/cs/2),praca=a.points.praca;
const c0x=Math.max(Math.round(P.x/cs),Math.min(Math.round((P.x+P.w)/cs)-side,Math.round(praca.x/cs-side/2)));
const c0y=Math.max(Math.round(P.y/cs),Math.min(Math.round((P.y+P.h)/cs)-side,Math.round(praca.y/cs-side/2)));
const cut={x:c0x*cs,y:c0y*cs,w:side*cs,h:side*cs};
const inside=(p:{x:number;y:number})=>p.x>=cut.x&&p.x<cut.x+cut.w&&p.y>=cut.y&&p.y<cut.y+cut.h;

// Ground and walks: open cells (the hero's clearDisc), the flow field from the car (the walk cost).
const car=worldBase(city),start=cityRunStart(city),speed=heroSpeed(city);
const flow=new FlowField({width:a.cells.w,height:a.cells.h,cellSize:cs,walkable:(cx,cy)=>city.clearDisc((cx+.5)*cs,(cy+.5)*cs,.22)},[car]);
const walkU=(p:{x:number;y:number})=>{const c=flow.costAt(p.x,p.y);return c===UNREACHABLE?NaN:c/STRAIGHT_COST*cs;};
let openAll=0,openCut=0,farAll=0,farCut=0;
const open=new Uint8Array(a.cells.w*a.cells.h);
for(let cy=0;cy<a.cells.h;cy++)for(let cx=0;cx<a.cells.w;cx++){
  const p={x:(cx+.5)*cs,y:(cy+.5)*cs};
  if(!city.clearDisc(p.x,p.y,.5))continue;
  open[cy*a.cells.w+cx]=1;openAll++;
  const w=walkU(p);
  if(Number.isFinite(w))farAll=Math.max(farAll,w);
  if(inside(p)){openCut++;if(Number.isFinite(w))farCut=Math.max(farCut,w);}
}
const bodies=[...plan.nests.flatMap(n=>n.sleepers),...plan.loose.flatMap(b=>b.members)];
const safe=citySafePlaces(city);
const s1=(v:number)=>Math.round(v*10)/10;
const spawns=(['spawnN','spawnS','spawnL','spawnO'] as const).map(k=>({k,...a.points[k]}));
const numbers={
  seed:SEED,players:PLAYERS,
  mapa:{ladoU:s1(P.w),areaU2:Math.round(openAll*cs*cs),corte:{ladoU:s1(cut.w),areaU2:Math.round(openCut*cs*cs),x:s1(cut.x),y:s1(cut.y)}},
  andar:{heroiUs:s1(speed),
    atravessarHojeS:s1(P.w/speed),atravessarDepoisS:s1(cut.w/speed),
    maisLongeDoUnoHojeS:s1(farAll/speed),maisLongeDoUnoDepoisS:s1(farCut/speed),
    inicioAoUnoS:s1(walkU(start)/speed),inicioDentro:inside(start),
    spawnsAoUnoS:Object.fromEntries(spawns.map(s=>[s.k,s1(walkU(s)/speed)])),spawnsDentro:spawns.filter(inside).map(s=>s.k),
    minervaS:MINERVA_S,
    minervaCobreHoje:s1(Math.min(1,MINERVA_S*speed/farAll)),minervaCobreDepois:s1(Math.min(1,MINERVA_S*speed/farCut))},
  bichos:{total:bodies.length,dentroDoCorte:bodies.filter(inside).length,fieldBodies:FIELD_BODIES,alvo:fieldTarget(PLAYERS),
    gapHoje:spreadGap(PLAYERS),gapDepoisMesmoTotal:s1(spreadGap(PLAYERS)*Math.sqrt(openCut/openAll)*100)/100,k:SPREAD.k},
  caixas:{pontos:a.loot.length,dentro:a.loot.filter(inside).length,teto:crateCap(PLAYERS)},
  ninhos:{pool:CITY_NEST_POOL.length,poolDentro:CITY_NEST_POOL.filter(inside).map(n=>n.id),sorteados:plan.nests.length,sorteadosDentro:plan.nests.filter(inside).length},
  seguros:{total:safe.length,dentro:safe.filter(s=>inside(s.opening)).length},
};

// Top views: today's map with the cut (yellow), and the cut alone, same pixels per unit.
const W=a.cells.w*S,H=a.cells.h*S,px=Buffer.alloc(W*H*4);
const put=(x:number,y:number,c:readonly number[])=>{if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;px[o]=c[0];px[o+1]=c[1];px[o+2]=c[2];px[o+3]=255;};
const disc=(ux:number,uy:number,r:number,c:readonly number[])=>{const cx=ux/cs*S,cy=uy/cs*S;for(let y=Math.floor(cy-r);y<=cy+r;y++)for(let x=Math.floor(cx-r);x<=cx+r;x++)if((x-cx)**2+(y-cy)**2<=r*r)put(x,y,c);};
const ring=(ux:number,uy:number,ru:number,c:readonly number[])=>{const cx=ux/cs*S,cy=uy/cs*S,r=ru/cs*S;for(let t=0;t<Math.PI*2;t+=.5/r)put(Math.round(cx+r*Math.cos(t)),Math.round(cy+r*Math.sin(t)),c);};
const safeCells=new Set<number>();for(const s of safe)for(const k of s.cells)safeCells.add(k);
for(let cy=0;cy<a.cells.h;cy++)for(let cx=0;cx<a.cells.w;cx++){
  const i=cy*a.cells.w+cx,c=safeCells.has(i)?[150,220,150]:open[i]?[236,232,224]:[90,96,110];
  for(let y=0;y<S;y++)for(let x=0;x<S;x++)put(cx*S+x,cy*S+y,c);
}
for(const n of plan.nests){ring(n.x,n.y,n.radius,[150,40,160]);ring(n.x,n.y,n.radius+.4,[150,40,160]);}
for(const n of plan.nests)for(const p of n.sleepers)disc(p.x,p.y,Math.max(1.2,S*.35),[160,40,170]);
for(const b of plan.loose)for(const p of b.members)disc(p.x,p.y,Math.max(1.2,S*.35),b.training?[230,140,0]:[210,30,30]);
for(const l of a.loot)disc(l.x,l.y,S*.9,[200,150,0]);
for(const s of spawns)disc(s.x,s.y,S*1.4,[0,0,0]);
disc(car.x,car.y,S*1.6,[30,90,220]);disc(start.x,start.y,S*1.2,[20,170,60]);
const frame=(c:readonly number[])=>{const x0=Math.round(cut.x/cs*S),y0=Math.round(cut.y/cs*S),x1=Math.round((cut.x+cut.w)/cs*S),y1=Math.round((cut.y+cut.h)/cs*S);
  for(let t=0;t<3;t++){for(let x=x0;x<=x1;x++){put(x,y0+t,c);put(x,y1-t,c);}for(let y=y0;y<=y1;y++){put(x0+t,y,c);put(x1-t,y,c);}}};
const raw={raw:{width:W,height:H,channels:4 as const}};
const head=(w:number,label:string)=>Buffer.from(`<svg width="${w}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="23" font-family="Arial" font-size="18">${label}</text></svg>`);
const cutPx={left:Math.round(cut.x/cs*S),top:Math.round(cut.y/cs*S),width:Math.round(cut.w/cs*S),height:Math.round(cut.h/cs*S)};
const after=await sharp(Buffer.from(px),raw).extract(cutPx).png().toBuffer();
frame([250,200,0]);
const n=numbers;
const before=`HOJE: ${n.mapa.ladoU} u de lado · ${n.bichos.total} bichos · ${n.caixas.pontos} pontos de caixa · atravessar ${n.andar.atravessarHojeS} s`;
const afterLabel=`E5 (corte amarelo): ${n.mapa.corte.ladoU} u · ${n.bichos.dentroDoCorte} bichos dentro · ${n.caixas.dentro} caixas · ${n.andar.atravessarDepoisS} s`;
await sharp({create:{width:W,height:H+34,channels:4,background:'#ffffff'}}).composite([{input:head(W,before),top:0,left:0},{input:Buffer.from(px),...raw,top:34,left:0}]).png().toFile(path.join(OUT,'e5-antes.png'));
await sharp({create:{width:W,height:H+34,channels:4,background:'#ffffff'}}).composite([{input:head(W,afterLabel),top:0,left:0},{input:after,top:34+Math.round((H-cutPx.height)/2),left:Math.round((W-cutPx.width)/2)}]).png().toFile(path.join(OUT,'e5-depois.png'));
fs.writeFileSync(path.join(OUT,'e5-numeros.json'),JSON.stringify(numbers,null,1));
console.log(JSON.stringify(numbers,null,1));
