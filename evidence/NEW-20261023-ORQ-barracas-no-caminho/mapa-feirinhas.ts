/**
 * NEW-20261023-ORQ-barracas-no-caminho etapa 2: o mapa todo da Cidade Nevada de cima, com as feirinhas de uma partida
 * real (Simulation, cidade/chaveiro/ninhos) marcadas, mais o Uno, os spawns, os ninhos e a tralha. Ferramenta local.
 *   node --experimental-strip-types evidence/NEW-20261023-ORQ-barracas-no-caminho/mapa-feirinhas.ts --seed 7 --out x.png
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {pieceRectOf,type PieceState} from '../../src/sim/towers/free-build.ts';
import {feirinhasOf} from '../../src/sim/towers/barracas.ts';
import {TRALHA_OWNER} from '../../src/sim/towers/tralha.ts';
import {FEIRA_GAP} from '../../src/rules/index.ts';
import type {StonewardsState} from '../../src/sim/stonewards/state.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';

const fromRoot=(p:string)=>fileURLToPath(new URL(`../../${p}`,import.meta.url));
const arg=(n:string,d:string)=>{const i=process.argv.indexOf(`--${n}`);return i>0&&process.argv[i+1]?process.argv[i+1]:d;};
const SEED=Number(arg('seed','7')),OUT=arg('out','mapa-feirinhas.png'),K=Number(arg('scale','6'));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,a=city.asset,cs=a.unitsPerCell;
const sim=new Simulation(SEED,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
sim.add('p0','P0','cidadao-comum');sim.resetRun();sim.step(1000);
const st=sim.run.stonewards.state as unknown as StonewardsState,pieces=(st.defenses?.pieces??[]) as PieceState[];
const feiras=feirinhasOf(st),nests=sim.run.nests?.plan()?.nests??[];

const S=K/cs*1,W=Math.ceil(a.cells.w*cs*S),H=Math.ceil(a.cells.h*cs*S),px=Buffer.alloc(W*H*4);
const put=(x:number,y:number,c:readonly number[])=>{if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;px[o]=c[0];px[o+1]=c[1];px[o+2]=c[2];px[o+3]=255;};
for(let y=0;y<H;y++)for(let x=0;x<W;x++)put(x,y,city.clearDisc((x+.5)/S,(y+.5)/S,.05)?[236,232,224]:[92,98,112]);
const rect=(ux:number,uy:number,uw:number,uh:number,c:readonly number[])=>{for(let y=Math.floor(uy*S);y<Math.ceil((uy+uh)*S);y++)for(let x=Math.floor(ux*S);x<Math.ceil((ux+uw)*S);x++)put(x,y,c);};
for(const p of pieces.filter(p=>p.owner===TRALHA_OWNER)){const r=pieceRectOf(p);rect(r.x,r.y,r.w,r.h,[150,110,70]);}
for(const p of pieces.filter(p=>p.kind==='barraca')){const r=pieceRectOf(p);rect(r.x,r.y,r.w,r.h,[230,90,20]);}
const P=a.points,car=placeWall(city);
const svg:string[]=[];
const X=(u:number)=>(u*S).toFixed(1);
for(const n of nests)svg.push(`<circle cx="${X(n.x)}" cy="${X(n.y)}" r="${X(n.radius)}" fill="none" stroke="#9a2aa8" stroke-width="2"/>`);
for(const [k,s] of Object.entries({N:P.spawnN,S:P.spawnS,L:P.spawnL,O:P.spawnO}))svg.push(`<rect x="${X(s.x)}" y="${X(s.y)}" width="14" height="14" transform="translate(-7 -7)" fill="#d22"/><text x="${X(s.x)}" y="${(s.y*S-10).toFixed(1)}" font-family="Arial" font-size="14" font-weight="bold" fill="#d22" text-anchor="middle">spawn ${k}</text>`);
const carPt=car;
if(carPt)svg.push(`<circle cx="${X(carPt.x)}" cy="${X(carPt.y)}" r="9" fill="#1e5ad8" stroke="#fff" stroke-width="2"/><text x="${X(carPt.x)}" y="${(carPt.y*S+26).toFixed(1)}" font-family="Arial" font-size="15" font-weight="bold" fill="#1e5ad8" text-anchor="middle">Uno</text>`);
let minD=Infinity;
for(let i=0;i<feiras.length;i++)for(let j=i+1;j<feiras.length;j++)minD=Math.min(minD,Math.hypot(feiras[i].x-feiras[j].x,feiras[i].y-feiras[j].y));
for(const f of feiras){svg.push(`<circle cx="${X(f.x)}" cy="${X(f.y)}" r="${X(10)}" fill="none" stroke="#e65a14" stroke-width="3"/><text x="${X(f.x)}" y="${(f.y*S-10*S-6).toFixed(1)}" font-family="Arial" font-size="16" font-weight="bold" fill="#b03c00" stroke="#fff" stroke-width="3" paint-order="stroke" text-anchor="middle">${f.id} (${f.barracas.length})</text>`);}
const label=`semente ${SEED} · ${feiras.length} feirinhas · ${feiras.reduce((n,f)=>n+f.barracas.length,0)} barracas · menor distância entre elas ${minD.toFixed(0)} u (mín. ${FEIRA_GAP})`,legend='laranja = barraca · marrom = tralha · roxo = ninho · azul = Uno';
const over=Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg.join('')}</svg>`);
const head=Buffer.from(`<svg width="${W}" height="52" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="21" font-family="Arial" font-size="16" font-weight="bold">${label}</text><text x="8" y="44" font-family="Arial" font-size="14">${legend}</text></svg>`);
await sharp({create:{width:W,height:H+52,channels:4,background:'#ffffff'}}).composite([{input:head,top:0,left:0},{input:px,raw:{width:W,height:H,channels:4},top:52,left:0},{input:over,top:52,left:0}]).png().toFile(OUT);
console.log(OUT,label,JSON.stringify(feiras.map(f=>({id:f.id,x:+f.x.toFixed(1),y:+f.y.toFixed(1),n:f.barracas.length}))));
