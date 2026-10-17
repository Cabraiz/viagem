/**
 * Ninhos (D-051, NEW-20261014-ORQ-mapa-vivo-ninhos, slice 1): where the Cidade Nevada keeps its sleeping horde. A pool
 * of nest spots (enemy "infrastructure": a building or a yard of open ground), the per-seed draw of 8 of them, the
 * sleepers' spots around each, the loose bands over the city and the four training bands near the plaza. Data plus a
 * pure draw and validator; the sim (E2, slice 2) wakes them, nothing here moves or draws.
 *
 * Numbers from the approved proposal (claims/NEW-20261014-ORQ-mapa-vivo-ninhos/proposta.md): 8 nests (2 G, 3 M, 3 P,
 * at least one per quadrant around the car), sleepers P 8 · M 14 · G 22, 60 loose (4 training bands of 3 at 25–35 u
 * from the car, the rest in bands of 2–4 beyond 40 u), all ×(1 + 0.15(n − 1)) players.
 * Card NEW-20261017-ORQ-ninhos-perto-ataca-20x (the user, 17/10): × POPULATION bodies in the nests and the loose bands
 * (the four training bands stay as they are: the first contact is a choice), on rings and in bands grown to hold them.
 */
import {walkable,worldBase} from './world.ts';
import {FlowField,type FlowGrid} from './flowfield.ts';
import type {CityTerrain} from './city/terrain.ts';
import {Rng,type Point} from '../contract/index.ts';

export type NestSize='P'|'M'|'G';
export type NestKind='predio'|'terreno';
/** A pool spot: the centre of a building's bbox (`block`) or of a yard of open ground that fits `maxSize`. */
export interface NestSpot {readonly id:string;readonly kind:NestKind;readonly x:number;readonly y:number;readonly maxSize:NestSize;readonly block?:string}
export interface Nest {
  readonly id:string;readonly kind:NestKind;readonly x:number;readonly y:number;readonly size:NestSize;readonly block?:string;
  /** Distance from the centre that counts as the nest (a building's half-diagonal, a yard's disc). */
  readonly radius:number;
  /** Where its sleepers stand, one per sleeper (already scaled by the player count). */
  readonly sleepers:readonly Point[];
}
/** A band of sleepers loose in the city; `training` = one of the four near the plaza (the first contact, a choice). */
export interface LooseBand {readonly x:number;readonly y:number;readonly training:boolean;readonly members:readonly Point[]}
export interface NestPlan {readonly seed:number;readonly players:number;readonly nests:readonly Nest[];readonly loose:readonly LooseBand[]}
export interface NestProblem {readonly id:string;readonly reason:string}
export interface NestPlanOptions {
  /** Room size (1..6): scales the sleepers. */
  players?:number;
  /** Routes the moto may take (polylines): the loose bands keep off them (at most one band near each). */
  routes?:readonly (readonly Point[])[];
  /** Where the team starts (sim/city/tutorial.ts cityRunStart): no nest within NEST_FROM_START, no band within LOOSE_FROM_START. */
  start?:Point;
  /** × the nests' sleepers and the loose bodies (default POPULATION; 1 is the slice-1 city). */
  population?:number;
}

export const NEST_COUNT=8;
export const NEST_MIX:Readonly<Record<NestSize,number>>=Object.freeze({G:2,M:3,P:3});
export const NEST_SLEEPERS:Readonly<Record<NestSize,number>>=Object.freeze({P:8,M:14,G:22});
/** A yard of open ground must hold a disc this wide (u) to host a nest of that size. */
export const NEST_YARD_RADIUS:Readonly<Record<NestSize,number>>=Object.freeze({P:6,M:9,G:12});
export const LOOSE_TOTAL=60,TRAINING_BANDS=4,TRAINING_MEMBERS=3;
export const TRAINING_FROM_CAR:readonly [number,number]=[25,35];
/** Sleepers for `players` (the proposal's ×(1 + 0.15(n − 1))). */
export const scaleSleepers=(count:number,players:number)=>Math.round(count*(1+.15*(Math.max(1,Math.min(6,players|0))-1)));
/** Keep-outs (u). */
/** NEST_FROM_START: beyond the widest camera (48.9 u, D-046) of a team just spawned. */
export const NEST_FROM_CAR=60,NEST_FROM_ROUTE=35,NEST_SPACING=30,NEST_FROM_START=50,LOOSE_FROM_START=25;
export const LOOSE_FROM_CAR=40,LOOSE_FROM_NEST=12,LOOSE_SPACING=10,LOOSE_NEAR_ROUTE=12;
/** The sleepers' own clearance (u): the widest body of the roster stands there. */
export const SLEEPER_CLEAR=.5;
const SLEEPER_GAP=1.2;
/** Card ninhos-perto-ataca-20x: × this many sleepers in the nests and loose (not the training bands). */
export const POPULATION=20;
/** The ground a body takes in a random scatter at SLEEPER_GAP (u²): a ring or a band grows to hold its count. */
export const BODY_AREA=2.5;
/** The outer radius of a ring from `inner` that holds `count` bodies (never under `atLeast`). */
export const ringOuter=(inner:number,count:number,atLeast:number)=>Math.max(atLeast,Math.sqrt(inner*inner+count*BODY_AREA/Math.PI));
/** A ring short of room widens by RING_GROW, at most RING_GROWTHS times (pop 1 never needs it). */
export const RING_GROW=1.25,RING_GROWTHS=4;
/** Loose bands: 2–4 bodies × this share of the population (a bigger city crowd in the same spots). */
export const looseBandScale=(population:number)=>Math.max(1,Math.round(population/4));
/** The spots already taken, bucketed by SLEEPER_GAP (the gap test stays local with thousands of bodies). */
class Taken {
  private cells=new Map<number,Point[]>();
  private key=(cx:number,cy:number)=>(cx+4096)*8192+(cy+4096);
  near(p:Point){
    const cx=Math.floor(p.x/SLEEPER_GAP),cy=Math.floor(p.y/SLEEPER_GAP);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const o of this.cells.get(this.key(cx+dx,cy+dy))??[])if(dist(o,p)<SLEEPER_GAP)return true;
    return false;
  }
  add(p:Point){const k=this.key(Math.floor(p.x/SLEEPER_GAP),Math.floor(p.y/SLEEPER_GAP)),list=this.cells.get(k);if(list)list.push(p);else this.cells.set(k,[p]);}
}

/*
 * The pool (u), measured on the asset v2 with the four possible chaveiro routes (scan of 14/10): each centre ≥ 60 u from
 * the car and ≥ 35 u from every route; a building is a nest by its bbox (buildingNestSize: its shorter side ≥ 14.5 u G, ≥ 8 u M, else P), a
 * yard by the disc it holds (NEST_YARD_RADIUS). Pairs closer than NEST_SPACING never come out together (the draw skips).
 */
const POOL_ROWS:readonly (readonly [NestKind,number,number,NestSize,string?])[]=[
  // NO
  ['predio',65.8,56.8,'G','b-0016'],['predio',52.4,38.9,'P','b-0015'],['terreno',100,34,'P'],['terreno',82,91,'P'],
  // NE
  ['predio',244.6,80,'G','b-0047'],['predio',236.4,110,'P','b-0087'],['terreno',181,94,'P'],['terreno',259,58,'P'],
  // SE
  ['predio',198.2,225.9,'G','b-0146'],['predio',176.5,255.1,'M','b-0158'],['predio',262.4,201.2,'P','b-0140'],
  ['terreno',220,259,'M'],['terreno',244,208,'M'],
  // SO
  ['terreno',34,256,'G'],['terreno',94,238,'G'],['terreno',94,208,'G'],['terreno',31,226,'M'],
];
export const CITY_NEST_POOL:readonly NestSpot[]=Object.freeze(POOL_ROWS.map(([kind,x,y,maxSize,block],i)=>
  Object.freeze({id:`ninho-${String(i+1).padStart(2,'0')}`,kind,x,y,maxSize,...(block?{block}:{})})));

const RANK:Readonly<Record<NestSize,number>>={P:0,M:1,G:2};
/** A building hosts a nest of up to this size by its bbox's shorter side (u): ≥ 14.5 G (10 asset cells), ≥ 8 M, else P. */
export const buildingNestSize=(w:number,h:number):NestSize=>Math.min(w,h)>=14.5?'G':Math.min(w,h)>=8?'M':'P';
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/** The quadrant of `p` around the car: N/S by y, O/E (oeste/leste) by x. */
export const quadrantOf=(p:Point,car:Point)=>`${p.y<car.y?'N':'S'}${p.x<car.x?'O':'E'}` as 'NO'|'NE'|'SO'|'SE';
function segmentDistance(p:Point,a:Point,b:Point){
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** Distance from `p` to a polyline. */
export function routeDistance(p:Point,route:readonly Point[]){
  if(route.length===1)return dist(p,route[0]);
  let best=Infinity;for(let i=1;i<route.length;i++)best=Math.min(best,segmentDistance(p,route[i-1],route[i]));
  return best;
}
const bboxOf=(city:CityTerrain,block:string|undefined)=>{
  const b=block?city.asset.blocks.find(k=>k.id===block):undefined;
  return b?{x:b.bbox[0],y:b.bbox[1],w:b.bbox[2],h:b.bbox[3]}:undefined;
};
function shuffle<T>(items:readonly T[],rng:Rng):T[]{
  const out=[...items];
  for(let i=out.length-1;i>0;i--){const j=rng.int(0,i);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}

/** 8 spots of the pool with sizes: spaced, one per quadrant at least, 2 G + 3 M + 3 P within each spot's maxSize. */
export function drawNests(seed:number,car:Point,start?:Point,all:readonly NestSpot[]=CITY_NEST_POOL):{spot:NestSpot;size:NestSize}[]{
  // The whole pool is shuffled and the spots too near the start skipped while picking: the start never changes the dice.
  const rng=new Rng(seed>>>0).fork('ninhos'),pool=all,eligible=(s:NestSpot)=>!start||dist(s,start)>=NEST_FROM_START;
  // Every quadrant that still has an eligible spot gets a nest (all four with today's start).
  const quads=(['NO','NE','SO','SE'] as const).filter(q=>pool.some(s=>eligible(s)&&quadrantOf(s,car)===q));
  for(let attempt=0;attempt<256;attempt++){
    const order=shuffle(pool,rng),chosen:NestSpot[]=[];
    // One per quadrant first (in the shuffled order), then the rest.
    for(const q of quads){
      const s=order.find(o=>eligible(o)&&quadrantOf(o,car)===q&&chosen.every(c=>dist(c,o)>=NEST_SPACING));
      if(s)chosen.push(s);
    }
    for(const s of order)if(eligible(s)&&chosen.length<NEST_COUNT&&!chosen.includes(s)&&chosen.every(c=>dist(c,s)>=NEST_SPACING))chosen.push(s);
    if(chosen.length<NEST_COUNT||new Set(chosen.map(c=>quadrantOf(c,car))).size<quads.length)continue;
    // Sizes: G to G-capable spots, M to M-or-better, P to the rest (shuffled picks).
    const sized=new Map<NestSpot,NestSize>(),free=shuffle(chosen,rng);
    for(const size of ['G','M','P'] as const)for(let k=0;k<NEST_MIX[size];k++){
      const s=free.find(f=>!sized.has(f)&&RANK[f.maxSize]>=RANK[size]);
      if(s)sized.set(s,size);
    }
    if(sized.size<NEST_COUNT)continue;
    return chosen.map(spot=>({spot,size:sized.get(spot)!}));
  }
  throw new Error('ninhos: pool cannot give 8 spaced nests over the quadrants');
}

/** `count` spots for bodies around `centre` within [inner, outer] u, on ground that fits a body and reaches the car, spaced. */
function scatter(city:CityTerrain,reach:FlowField,rng:Rng,centre:Point,inner:number,outer:number,count:number,taken:Taken):Point[]{
  const out:Point[]=[];
  for(let tries=0;out.length<count&&tries<count*80;tries++){
    const a=rng.range(0,Math.PI*2),r=rng.range(inner,outer);
    const p={x:Math.round((centre.x+r*Math.cos(a))*100)/100,y:Math.round((centre.y+r*Math.sin(a))*100)/100};
    if(!city.clearDisc(p.x,p.y,SLEEPER_CLEAR)||!walkable(p,city)||!reach.reachable(p.x,p.y))continue;
    if(taken.near(p))continue;
    out.push(p);taken.add(p);
  }
  return out;
}
const half=(r:{w:number;h:number})=>Math.hypot(r.w,r.h)/2;

/**
 * The city's plan for a seed: the drawn nests with their sleepers' spots, the four training bands (one per mouth, out
 * along its avenue at 25–35 u from the car) and the loose bands (on the asset's loot points, beyond 40 u, off the routes).
 */
export function cityNestPlan(city:CityTerrain,seed:number,options:NestPlanOptions={}):NestPlan{
  const players=Math.max(1,Math.min(6,options.players??1)),car=worldBase(city),rng=new Rng(seed>>>0).fork('ninhos-corpos');
  const grid=cityGrid(city),reach=new FlowField(grid,[car],{wallPenalty:0}),taken=new Taken(),pop=Math.max(1,options.population??POPULATION);
  const nests:Nest[]=drawNests(seed,car,options.start).map(({spot,size})=>{
    const box=bboxOf(city,spot.block),count=scaleSleepers(NEST_SLEEPERS[size]*pop,players);
    const radius=box?half(box):NEST_YARD_RADIUS[size];
    // A building's sleepers lie around its walls (1.5–6 u out); a yard's inside its disc.
    // ×POPULATION: the ring (or the yard's disc) grows to hold them (ringOuter).
    const inner=box?radius+1.5:1;
    let outer=box?ringOuter(inner,count,radius+6):ringOuter(inner,count,radius-1);
    const sleepers=scatter(city,reach,rng,spot,inner,outer,count,taken);
    // Walls and streets eat part of a ring: it widens (RING_GROW, up to RING_GROWTHS times) until they all lie down.
    for(let g=0;g<RING_GROWTHS&&sleepers.length<count;g++){
      const from=outer;outer*=RING_GROW;
      sleepers.push(...scatter(city,reach,rng,spot,from,outer,count-sleepers.length,taken));
    }
    return Object.freeze({id:spot.id,kind:spot.kind,x:spot.x,y:spot.y,size,...(spot.block?{block:spot.block}:{}),radius,sleepers:Object.freeze(sleepers)});
  });
  const loose:LooseBand[]=[];
  // Training: from each mouth, follow the way out to its avenue end until 25–35 u from the car, then a band beside it.
  const P=city.asset.points;
  for(const k of ['N','S','L','O'] as const){
    const far=rng.range(TRAINING_FROM_CAR[0],TRAINING_FROM_CAR[1]),out=new FlowField(grid,[P[`spawn${k}`]],{wallPenalty:0});
    const p={...P.bocas[k]},d={x:0,y:0};
    for(let step=0;step<400&&dist(p,car)<far;step++){out.directionAt(p.x,p.y,d);p.x+=d.x*.5;p.y+=d.y*.5;}
    const members=scatter(city,reach,rng,p,0,2.5,scaleSleepers(TRAINING_MEMBERS,players),taken);
    loose.push(Object.freeze({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,training:true,members:Object.freeze(members)}));
  }
  // The rest on the loot points first, then on open ground (every LOOSE_SCAN u): far from the car, the nests and each
  // other; at most one band near each route.
  let left=scaleSleepers(LOOSE_TOTAL*pop,players)-loose.reduce((n,b)=>n+b.members.length,0);
  const bandScale=looseBandScale(pop);
  const routes=options.routes??[],nearRoute=new Array(routes.length).fill(0);
  for(const p of [...shuffle(city.asset.loot,rng),...shuffle(openGround(city,reach),rng)]){
    if(left<=0)break;
    if(dist(p,car)<LOOSE_FROM_CAR||!city.clearDisc(p.x,p.y,1))continue;
    if(options.start&&dist(p,options.start)<LOOSE_FROM_START)continue;
    if(nests.some(n=>dist(p,n)<n.radius+LOOSE_FROM_NEST)||loose.some(b=>dist(p,b)<LOOSE_SPACING))continue;
    const near=routes.map((r,i)=>routeDistance(p,r)<LOOSE_NEAR_ROUTE?i:-1).filter(i=>i>=0);
    if(near.some(i=>nearRoute[i]>=1))continue;
    // Bands of 2–4: never leave a last band of one behind.
    let want=Math.min(left,rng.int(2,4)*bandScale);if(left-want===1)want+=want<4*bandScale?1:-1;
    const members=scatter(city,reach,rng,p,0,ringOuter(0,want,2.5),want,taken);
    if(!members.length)continue;
    near.forEach(i=>nearRoute[i]++);left-=members.length;
    loose.push(Object.freeze({x:p.x,y:p.y,training:false,members:Object.freeze(members)}));
  }
  return Object.freeze({seed,players,nests:Object.freeze(nests),loose:Object.freeze(loose)});
}

export const LOOSE_SCAN=6;
const openMemo=new WeakMap<object,readonly Point[]>();
/** Points of open ground (a 2 u disc) that reach the car, every LOOSE_SCAN u over the playable area; once per asset. */
function openGround(city:CityTerrain,reach:FlowField):readonly Point[]{
  const known=openMemo.get(city.asset);if(known)return known;
  const pl=city.asset.playable,out:Point[]=[];
  for(let y=pl.y+LOOSE_SCAN/2;y<pl.y+pl.h;y+=LOOSE_SCAN)for(let x=pl.x+LOOSE_SCAN/2;x<pl.x+pl.w;x+=LOOSE_SCAN)
    if(city.clearDisc(x,y,2)&&reach.reachable(x,y))out.push({x:Math.round(x*100)/100,y:Math.round(y*100)/100});
  openMemo.set(city.asset,out);return out;
}

/** The asset grid with the hero rule at each cell centre (as validateBuildPlan's). */
function cityGrid(city:CityTerrain):FlowGrid{
  const cs=city.asset.unitsPerCell;
  return {width:city.asset.cells.w,height:city.asset.cells.h,cellSize:cs,walkable:(cx,cy)=>city.clearDisc((cx+.5)*cs,(cy+.5)*cs,SLEEPER_CLEAR)};
}

/**
 * Everything wrong with a plan (empty = valid): the nest count, mix, quadrants and spacing; each nest far from the car
 * and every route, on its building or a yard that holds its size; every sleeper and band member on open ground that
 * reaches the car; loose bands beyond 40 u (training excepted) and off the nests; nests and bands clear of the team's start.
 */
export function validateNestPlan(plan:NestPlan,city:CityTerrain,{routes=[],start}:{routes?:readonly (readonly Point[])[];start?:Point}={}):NestProblem[]{
  const problems:NestProblem[]=[],bad=(id:string,reason:string)=>problems.push({id,reason});
  const car=worldBase(city),reach=new FlowField(cityGrid(city),[car],{wallPenalty:0});
  if(plan.nests.length!==NEST_COUNT)bad('plano',`${plan.nests.length} ninhos (quero ${NEST_COUNT})`);
  for(const size of ['G','M','P'] as const){
    const n=plan.nests.filter(x=>x.size===size).length;
    if(n!==NEST_MIX[size])bad('plano',`${n} ninhos ${size} (quero ${NEST_MIX[size]})`);
  }
  if(new Set(plan.nests.map(n=>quadrantOf(n,car))).size<4)bad('plano','falta ninho num quadrante');
  plan.nests.forEach((n,i)=>{
    if(dist(n,car)<NEST_FROM_CAR)bad(n.id,`a ${dist(n,car).toFixed(1)} u do carro`);
    if(start&&dist(n,start)<NEST_FROM_START)bad(n.id,`a ${dist(n,start).toFixed(1)} u de onde o time nasce`);
    for(const r of routes)if(routeDistance(n,r)<NEST_FROM_ROUTE)bad(n.id,`a ${routeDistance(n,r).toFixed(1)} u de uma rota da moto`);
    for(let j=i+1;j<plan.nests.length;j++)if(dist(n,plan.nests[j])<NEST_SPACING)bad(n.id,`perto de ${plan.nests[j].id}`);
    if(n.kind==='terreno'&&!city.clearDisc(n.x,n.y,NEST_YARD_RADIUS[n.size]))bad(n.id,`o pátio não cabe um ninho ${n.size}`);
    const box=n.kind==='predio'?bboxOf(city,n.block):undefined;
    if(n.kind==='predio'&&!box)bad(n.id,`prédio ${n.block} não existe`);
    if(box&&RANK[buildingNestSize(box.w,box.h)]<RANK[n.size])bad(n.id,`o prédio ${n.block} não cabe um ninho ${n.size}`);
    const want=scaleSleepers(NEST_SLEEPERS[n.size],plan.players);
    if(n.sleepers.length!==want)bad(n.id,`${n.sleepers.length} dormindo (quero ${want})`);
  });
  const bodies=[...plan.nests.flatMap(n=>n.sleepers.map(p=>({id:n.id,p}))),...plan.loose.flatMap((b,i)=>b.members.map(p=>({id:`bando-${i+1}`,p})))];
  for(const {id,p} of bodies){
    if(!city.clearDisc(p.x,p.y,SLEEPER_CLEAR)||!walkable(p,city))bad(id,`corpo fora do chão em (${p.x}, ${p.y})`);
    else if(!reach.reachable(p.x,p.y))bad(id,`corpo sem caminho até o carro em (${p.x}, ${p.y})`);
  }
  plan.loose.forEach((b,i)=>{
    const id=`bando-${i+1}`,d=dist(b,car);
    if(b.training&&(d<TRAINING_FROM_CAR[0]-1||d>TRAINING_FROM_CAR[1]+1))bad(id,`treino a ${d.toFixed(1)} u do carro`);
    if(!b.training&&d<LOOSE_FROM_CAR)bad(id,`a ${d.toFixed(1)} u do carro`);
    if(plan.nests.some(n=>dist(b,n)<n.radius+LOOSE_FROM_NEST))bad(id,'em cima de um ninho');
  });
  const loose=plan.loose.reduce((k,b)=>k+b.members.length,0),wantLoose=scaleSleepers(LOOSE_TOTAL,plan.players);
  if(loose!==wantLoose)bad('plano',`${loose} soltos (quero ${wantLoose})`);
  const training=plan.loose.filter(b=>b.training),wantTraining=scaleSleepers(TRAINING_MEMBERS,plan.players);
  if(training.length!==TRAINING_BANDS)bad('plano',`${training.length} bandos de treino (quero ${TRAINING_BANDS})`);
  training.forEach(b=>{if(b.members.length!==wantTraining)bad('treino',`${b.members.length} no bando de treino (quero ${wantTraining})`);});
  plan.loose.forEach((b,i)=>{if(!b.training&&b.members.length<2)bad(`bando-${i+1}`,'bando de um só');});
  routes.forEach((r,k)=>{
    const near=plan.loose.filter(b=>!b.training&&routeDistance(b,r)<LOOSE_NEAR_ROUTE).length;
    if(near>1)bad('plano',`${near} bandos perto da rota ${k+1} (quero ≤ 1)`);
  });
  if(start)plan.loose.forEach((b,i)=>{if(!b.training&&dist(b,start)<LOOSE_FROM_START)bad(`bando-${i+1}`,'perto de onde o time nasce');});
  return problems;
}
