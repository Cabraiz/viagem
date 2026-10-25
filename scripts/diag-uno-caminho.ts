/**
 * Diagnóstico (card NEW-20261025-ORQ-uno-caminho-caixas-vender, item 1; o usuário: "esses entulhos e essa barreira só
 * atrapalham na parte de mover o Uno"): onde o Uno (disco CAR_RADIUS na máscara dos heróis, chaveiro/car.ts) anda na
 * Cidade Nevada, a partir de onde ele começa.
 *  1. Mapa estático: área que o herói alcança × a que o carro alcança; pontos de interesse (praça, bocas, spawns,
 *     pontos de caixa) fora do alcance do carro; objetos sólidos do mapa (props) que, tirados, abrem caminho ao carro.
 *  2. A tralha (sim/towers/tralha.ts) de N seeds de partida real: quanto da área do carro ela fecha e quantos quadrados
 *     ficam no meio da rua (sem parede encostada).
 * Uso: node --experimental-strip-types scripts/diag-uno-caminho.ts [seeds] [--png saida.png]
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {cityAsField,type Point} from '../src/maps/index.ts';
import {RADIUS as HERO_R} from '../src/maps/world.ts';
import {CAR_RADIUS} from '../src/contract/index.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {placeWall} from '../src/sim/stonewards/wall.ts';
import {blockDisc,pieceRectOf,type PieceState} from '../src/sim/towers/free-build.ts';
import {BARRICADA_CELLS} from '../src/rules/index.ts';
import {TRALHA_OWNER} from '../src/sim/towers/tralha.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../${path}`,import.meta.url));
const cityText=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(cityText,manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,a=city.asset,{w:SW,h:SH,step:S}=a.samples;
const args=process.argv.slice(2),png=args.includes('--png')?args[args.indexOf('--png')+1]:undefined;
const seeds=Number(args.find(x=>/^\d+$/.test(x))??8);

/** The ground's samples (1 walkable), a copy we may open or shut. */
const base=new Uint8Array(SW*SH);
for(let y=0;y<SH;y++)for(let x=0;x<SW;x++)base[x+y*SW]=a.walkable(x,y)?1:0;
function disc(W:Uint8Array,x:number,y:number,r:number){
  const reach=r-1e-6,r2=reach*reach,sx0=Math.floor((x-reach)/S),sx1=Math.floor((x+reach)/S),sy0=Math.floor((y-reach)/S),sy1=Math.floor((y+reach)/S);
  if(sx0<0||sy0<0||sx1>=SW||sy1>=SH)return false;
  for(let sy=sy0;sy<=sy1;sy++){const dy=y<sy*S?sy*S-y:y>(sy+1)*S?y-(sy+1)*S:0;
    for(let sx=sx0;sx<=sx1;sx++){const dx=x<sx*S?sx*S-x:x>(sx+1)*S?x-(sx+1)*S:0;if(dx*dx+dy*dy<r2&&!W[sx+sy*SW])return false;}}
  return true;
}
/** Probe grid (G u): which probes a body of radius r reaches from `from` (8-neighbour flood). */
const G=.5,GW=Math.ceil(a.size.w/G),GH=Math.ceil(a.size.h/G);
function reach(W:Uint8Array,r:number,from:Point,box?:{x0:number;y0:number;x1:number;y1:number},seed?:Uint8Array){
  const ok=new Uint8Array(GW*GH),seen=new Uint8Array(GW*GH),q:number[]=[];
  const gx0=box?Math.max(0,Math.floor(box.x0/G)):0,gx1=box?Math.min(GW-1,Math.floor(box.x1/G)):GW-1,gy0=box?Math.max(0,Math.floor(box.y0/G)):0,gy1=box?Math.min(GH-1,Math.floor(box.y1/G)):GH-1;
  for(let gy=gy0;gy<=gy1;gy++)for(let gx=gx0;gx<=gx1;gx++)ok[gx+gy*GW]=disc(W,(gx+.5)*G,(gy+.5)*G,r)?1:0;
  const push=(i:number)=>{if(ok[i]&&!seen[i]){seen[i]=1;q.push(i);}};
  if(seed){for(let gy=gy0;gy<=gy1;gy++)for(let gx=gx0;gx<=gx1;gx++)if(seed[gx+gy*GW])push(gx+gy*GW);}
  else{
    // The nearest probe a body fits on, around `from`.
    let best=-1,bd=Infinity;
    for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++){const gx=Math.floor(from.x/G)+dx,gy=Math.floor(from.y/G)+dy,i=gx+gy*GW;if(ok[i]&&dx*dx+dy*dy<bd){bd=dx*dx+dy*dy;best=i;}}
    if(best>=0)push(best);
  }
  for(let h=0;h<q.length;h++){const i=q[h],gx=i%GW,gy=(i-gx)/GW;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=gx+dx,y=gy+dy;if(x>=gx0&&x<=gx1&&y>=gy0&&y<=gy1)push(x+y*GW);}}
  return seen;
}
const count=(m:Uint8Array)=>{let n=0;for(const v of m)n+=v;return n;};
const near=(m:Uint8Array,p:Point,d:number)=>{for(let dy=-d;dy<=d;dy++)for(let dx=-d;dx<=d;dx++){const i=Math.floor(p.x/G)+dx+(Math.floor(p.y/G)+dy)*GW;if(m[i])return true;}return false;};

const car=placeWall(city);
const hero=reach(base,HERO_R,car),carReach=reach(base,CAR_RADIUS,car);
const P=a.points;
const pois:[string,Point][]=[['praça',P.praca],['spawnN',P.spawnN],['spawnS',P.spawnS],['spawnL',P.spawnL],['spawnO',P.spawnO],
  ...Object.entries(P.bocas).map(([k,v])=>[`boca ${k}`,v] as [string,Point])];
console.log(`Uno em (${car.x.toFixed(1)},${car.y.toFixed(1)}); área (sondas de ${G} u): herói ${count(hero)}, carro ${count(carReach)} (${(100*count(carReach)/count(hero)).toFixed(0)} %)`);
for(const [name,p] of pois)console.log(`  ${name.padEnd(8)} herói ${near(hero,p,4)?'sim':'NÃO'} · carro ${near(carReach,p,6)?'sim':'NÃO'}`);
const lootOut=a.loot.filter(p=>near(hero,p,3)&&!near(carReach,p,6));
console.log(`  pontos de caixa: ${a.loot.length}; o carro não chega perto (3 u) de ${lootOut.length}`);

// Props: open the samples under a solid prop and see how much car area joins the reach within 10 u.
const props=a.props.map((p,i)=>({p,i})).filter(({p})=>p.solid&&p.kind!=='door');
const gains:{i:number;kind:string;x:number;y:number;gain:number}[]=[];
for(const {p,i} of props){
  const W=base.slice();let opened=0;
  const R=p.r+S;
  for(let sy=Math.floor((p.y-R)/S);sy<=Math.floor((p.y+R)/S);sy++)for(let sx=Math.floor((p.x-R)/S);sx<=Math.floor((p.x+R)/S);sx++){
    if(sx<0||sy<0||sx>=SW||sy>=SH||W[sx+sy*SW])continue;
    if(Math.hypot((sx+.5)*S-p.x,(sy+.5)*S-p.y)<=p.r+S*.75){W[sx+sy*SW]=1;opened++;}
  }
  if(!opened)continue;
  const box={x0:p.x-10,y0:p.y-10,x1:p.x+10,y1:p.y+10};
  const before=count(reach(base,CAR_RADIUS,car,box,carReach)),after=count(reach(W,CAR_RADIUS,car,box,carReach));
  if(after-before>=8)gains.push({i,kind:p.kind,x:p.x,y:p.y,gain:(after-before)*G*G});
}
gains.sort((x,y)=>y.gain-x.gain);
console.log(`props sólidos que, tirados, abrem área ao carro (≥ 2 u²): ${gains.length} de ${props.length}`);
for(const g of gains.slice(0,40))console.log(`  p${g.i} ${g.kind} (${g.x.toFixed(1)},${g.y.toFixed(1)}) +${g.gain.toFixed(0)} u²`);

// Rubble blocks ('entulho'): open their samples and see how much car area joins the reach within 12 u of the block.
const rubble:{id:string;x:number;y:number;w:number;h:number;gain:number;heroGain:number}[]=[];
for(const b of a.blocks){
  if(b.kind!=='rubble')continue;
  const W=base.slice();
  for(const [x,y,w,h] of b.rects)for(let sy=Math.floor(y/S);sy<Math.ceil((y+h)/S);sy++)for(let sx=Math.floor(x/S);sx<Math.ceil((x+w)/S);sx++)if(sx>=0&&sy>=0&&sx<SW&&sy<SH)W[sx+sy*SW]=1;
  const [x0,y0,x1,y1]=b.bbox.length===4?[b.bbox[0],b.bbox[1],b.bbox[0]+b.bbox[2],b.bbox[1]+b.bbox[3]]:[0,0,0,0];
  const box={x0:x0-12,y0:y0-12,x1:x1+12,y1:y1+12};
  const gain=count(reach(W,CAR_RADIUS,car,box,carReach))-count(reach(base,CAR_RADIUS,car,box,carReach));
  rubble.push({id:b.id,x:x0,y:y0,w:x1-x0,h:y1-y0,gain:gain*G*G,heroGain:0});
}
rubble.sort((x,y)=>y.gain-x.gain);
console.log(`blocos de entulho: ${rubble.length}; tirados um a um, abrem ao carro ≥ 4 u²: ${rubble.filter(r=>r.gain>=4).length}`);
for(const r of rubble.filter(r=>r.gain>=4).slice(0,30))console.log(`  ${r.id} (${r.x.toFixed(0)},${r.y.toFixed(0)}) ${r.w.toFixed(1)}×${r.h.toFixed(1)} u → +${r.gain.toFixed(0)} u²`);

// The tralha of real runs.
let shutTotal=0,squares=0,midStreet=0;
const lastPieces:PieceState[][]=[];
for(let seed=1;seed<=seeds;seed++){
  const s=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  s.add('p0','P0','cidadao-comum');s.resetRun();s.step(1000);
  const pieces=((s.run.stonewards.state as unknown as {defenses?:{pieces?:PieceState[]}}).defenses?.pieces??[]).filter(p=>p.owner===TRALHA_OWNER);
  lastPieces.push(pieces);
  const W=base.slice();
  for(const p of pieces){
    const r=pieceRectOf(p),d=blockDisc(p.cell,BARRICADA_CELLS,BARRICADA_CELLS);
    // To the car's body a square is its blocker disc (free-build blockDisc, chaveiro/car.ts blocks).
    for(let sy=Math.floor((d.y-d.r)/S);sy<=Math.floor((d.y+d.r)/S);sy++)for(let sx=Math.floor((d.x-d.r)/S);sx<=Math.floor((d.x+d.r)/S);sx++)
      if(Math.hypot((sx+.5)*S-d.x,(sy+.5)*S-d.y)<d.r)W[sx+sy*SW]=0;
    // In the middle of the street: no wall within 1 u of the square.
    let wall=false;
    for(let sy=Math.floor((r.y-1)/S);sy<Math.ceil((r.y+r.h+1)/S)&&!wall;sy++)for(let sx=Math.floor((r.x-1)/S);sx<Math.ceil((r.x+r.w+1)/S);sx++)if(!base[sx+sy*SW]){wall=true;break;}
    if(!wall)midStreet++;
  }
  squares+=pieces.length;
  const shut=count(carReach)-count(reach(W,CAR_RADIUS,car));
  shutTotal+=shut;
  console.log(`  seed ${seed}: ${pieces.length} quadrados de tralha; o carro perde ${(shut*G*G).toFixed(0)} u² (${(100*shut/count(carReach)).toFixed(1)} % da área dele)`);
}
console.log(`tralha: ${squares} quadrados em ${seeds} partidas, ${midStreet} no meio da rua (sem parede a 1 u); o carro perde em média ${(shutTotal*G*G/seeds).toFixed(0)} u²`);

if(png){
  // PPM-free PNG via a tiny encoder is overkill: write a PGM-like JSON the caller renders (scripts keep no image deps).
  const out={rubble:rubble.filter(r=>r.gain>=4),G,GW,GH,hero:[...hero].map((v,i)=>v+(carReach[i]?1:0)).join(''),gains,tralha:lastPieces.flatMap(ps=>ps.map(p=>pieceRectOf(p))).slice(0,lastPieces[0].length),car,pois};
  writeFileSync(png,JSON.stringify(out));
  console.log(`grade gravada em ${png}`);
}
