/**
 * Ninhos (D-051, NEW-20261014-ORQ-mapa-vivo-ninhos, slice 1): where the Cidade Nevada keeps its sleeping horde. A pool
 * of nest spots (enemy "infrastructure": a building or a yard of open ground), the per-seed draw of 8 of them, the
 * sleepers' spots around each, the loose bands over the city and the four training bands near the plaza. Data plus a
 * pure draw and validator; the sim (E2, slice 2) wakes them, nothing here moves or draws.
 *
 * Numbers from the approved proposal (claims/NEW-20261014-ORQ-mapa-vivo-ninhos/proposta.md): 8 nests (2 G, 3 M, 3 P,
 * at least one per quadrant around the car), 4 training bands of 3 at 25–35 u from the car, all ×(1 + 0.15(n − 1)) players.
 * Card NEW-20261022-ORQ-monstros-espalhados (the user, 22/10: They Are Billions, "um inimigo a cada x metros, e não juntos e
 * aglomerados"): the nests' rings and the loose bands of 2–4 (×POPULATION since ninhos-perto-ataca-20x) gave way to one
 * field spread evenly over the city, as many as today (FIELD_BODIES), none inside a safe place (maps/safe-places.ts).
 */
import {walkable,worldBase} from './world.ts';
import {FlowField,type FlowGrid} from './flowfield.ts';
import type {CityTerrain} from './city/terrain.ts';
import {naBoca} from './city/entradas.ts';
import {Rng,type Point} from '../contract/index.ts';
import {citySafePlaces,safePlaceAt} from './safe-places.ts';

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
/**
 * population: NestPlanOptions.population when not the reference POPULATION; gap: the field's spacing (u, spreadGap: no two
 * bodies closer; a zone may only widen it).
 */
export interface NestPlan {readonly seed:number;readonly players:number;readonly population?:number;readonly gap?:number;readonly nests:readonly Nest[];readonly loose:readonly LooseBand[]}
export interface NestProblem {readonly id:string;readonly reason:string}
export interface NestPlanOptions {
  /** Room size (1..6): scales the sleepers. */
  players?:number;
  /** Routes the moto may take (polylines): the field is sparser along them (SPREAD.route). */
  routes?:readonly (readonly Point[])[];
  /** Where the team starts (sim/city/tutorial.ts cityRunStart): no nest within NEST_FROM_START, no body within LOOSE_FROM_START. */
  start?:Point;
  /** The field's density against the reference POPULATION (the gap × √(POPULATION/population)); benches and tests. */
  population?:number;
}

/** NEW-20261023-ORQ-mapa-175-com-viaduto (ORQ decision 3): 5 nests on the city 1.75× shorter (was 8: 2 G, 3 M, 3 P). */
export const NEST_COUNT=5;
export const NEST_MIX:Readonly<Record<NestSize,number>>=Object.freeze({G:1,M:2,P:2});
/**
 * A yard of open ground must hold a disc this wide (u) to host a nest of that size: the yards of the 1.7× city
 * (6 / 9 / 12 u) ÷ CITY_COMPACT, as the yards shrank with the distances (mapa-175-com-viaduto).
 */
export const NEST_YARD_RADIUS:Readonly<Record<NestSize,number>>=Object.freeze({P:3.4,M:5,G:6.5});
export const TRAINING_BANDS=4,TRAINING_MEMBERS=3;
/** 25–35 u on the 1.7× city ÷ CITY_COMPACT (mapa-175-com-viaduto). */
export const TRAINING_FROM_CAR:readonly [number,number]=[14,20];
/** Sleepers for `players` (the proposal's ×(1 + 0.15(n − 1))). */
export const scaleSleepers=(count:number,players:number)=>Math.round(count*(1+.15*(Math.max(1,Math.min(6,players|0))-1)));
/**
 * Keep-outs (u): the 1.7× city's (60, 35, 30, 50, 25 / 40, 12) ÷ CITY_COMPACT since mapa-175-com-viaduto (the map's
 * distances are 1.75× shorter; maps may not import rules, so the values are written out).
 * NEST_FROM_START: beyond half the widest camera (48.9 u, D-046) of a team just spawned.
 */
export const NEST_FROM_CAR=34,NEST_FROM_ROUTE=20,NEST_SPACING=17,NEST_FROM_START=29,LOOSE_FROM_START=14;
export const LOOSE_FROM_CAR=23,LOOSE_NEAR_ROUTE=7;
/** The sleepers' own clearance (u): the widest body of the roster stands there. */
export const SLEEPER_CLEAR=.5;
/** The reference population (card ninhos-perto-ataca-20x's ×20): NestPlanOptions.population scales the field against it. */
export const POPULATION=20;
/*
 * The pool (u), measured on the asset v2 with the four possible chaveiro routes (scan of 14/10): each centre ≥ 60 u from
 * the car and ≥ 35 u from every route; a building is a nest by its bbox (buildingNestSize: its shorter side ≥ 14.5 u G, ≥ 8 u M, else P), a
 * yard by the disc it holds (NEST_YARD_RADIUS). Pairs closer than NEST_SPACING never come out together (the draw skips).
 * Asset v4 (mapa-175-com-viaduto): the spots taken to the compacted city (scripts/compactar-cidade.ts): a building's
 * row is its new bbox centre (the building kept its size, moved by its block; b-0016 and b-0047, shrunk 1.3–1.5×, are M
 * now), a yard's the open point of most clearance near its mapped point. The moto's routes run elsewhere on the
 * shorter streets: b-0146, b-0140 and three yards (SE, SO) fell within NEST_FROM_ROUTE and left the pool; one SO yard
 * (42.5, 147.5) joined it; the SO yard at (18, 134.5) left too, 13 u from the only G (always drawn), so never drawn.
 * The viaduct (etapa 3): the N avenue runs beside the ramp now, nearer the NO yard at (58.3, 21), which left too (it was
 * 21 u from the new start, the Uno on the deck, under NEST_FROM_START: never drawn).
 * NEW-20261030-ORQ-entradas-livres-de-tudo (the user, 30/10, 2nd time: "obstáculos em entradas são horríveis"): no
 * yard nest's drawn art (nestArte) on an entrance's free strip (maps/city/entradas.ts bocaFaixa). Two moved the least
 * that clears it: (47, 53.1) → (50, 52.1), (42.5, 147.5) → (41, 147.5). Three have no yard off the strips anywhere in
 * their quadrant (dense blocks, every corner a mouth; search of ±60 u) and are out of the draw (NEST_OFF), kept.
 * 11 spots, 8 drawn, every quadrant beyond NEST_FROM_START of the start.
 */
/** The ground square (u) a nest's art covers: 3×3 cells × the client's NEST_SCALE (render/city/live/nests.ts). */
export const nestArte=(unitsPerCell:number,p:Point,size:NestSize)=>{
  const h=1.5*unitsPerCell*({P:.85,M:1,G:1.25} as const)[size];
  return {x:p.x-h,y:p.y-h,w:2*h,h:2*h};
};
const POOL_ROWS:readonly (readonly [NestKind,number,number,NestSize,string?])[]=[
  // NO
  ['predio',37.4,32.9,'M','b-0016'],['predio',29.9,22.4,'P','b-0015'],['terreno',50,52.1,'P'],
  // NE
  ['predio',139.9,45.6,'M','b-0047'],['predio',136.1,63.6,'P','b-0087'],['terreno',101.7,52.9,'P'],['terreno',147.9,34.2,'P'],
  // SE
  ['predio',103.2,145.9,'M','b-0158'],['terreno',122.5,144.9,'M'],
  // SO
  ['terreno',19,147.7,'G'],['terreno',41,147.5,'M'],
];
/** Spots out of the draw, with the reason; never deleted (a map change may give them a yard again). */
const NEST_OFF:Readonly<Record<string,string>>={
  'ninho-06':'arte pega boca, sem pátio livre','ninho-07':'arte pega boca, sem pátio livre','ninho-09':'arte pega boca, sem pátio livre',
};
const ALL_SPOTS=POOL_ROWS.map(([kind,x,y,maxSize,block],i):NestSpot=>
  Object.freeze({id:`ninho-${String(i+1).padStart(2,'0')}`,kind,x,y,maxSize,...(block?{block}:{})}));
/** Where the map (v8) laid the yards before entradas-livres-de-tudo moved them: the asset is built around these. */
const MAP_YARD:Readonly<Record<string,readonly [number,number]>>={
  'ninho-03':[47,53.1],'ninho-06':[100.7,52.9],'ninho-09':[124.5,147.9],'ninho-11':[42.5,147.5],
};
/** Every spot as the map scripts keep it (becos-cidade, cenario-cidade): the ones out of the draw too, at the yard the
 *  map laid. Moving a nest or taking it out of the draw must not change the committed asset (mapa-175). */
export const CITY_NEST_SPOTS:readonly NestSpot[]=Object.freeze(ALL_SPOTS.map(s=>MAP_YARD[s.id]?Object.freeze({...s,x:MAP_YARD[s.id][0],y:MAP_YARD[s.id][1]}):s));
/** The spots a seed may draw. */
export const CITY_NEST_POOL:readonly NestSpot[]=Object.freeze(ALL_SPOTS.filter(s=>!NEST_OFF[s.id]));
/** The spots out of the draw (NEST_OFF), each with its reason. */
export const CITY_NEST_OFF:readonly (NestSpot&{readonly motivo:string})[]=Object.freeze(
  ALL_SPOTS.filter(s=>NEST_OFF[s.id]).map(s=>Object.freeze({...s,motivo:NEST_OFF[s.id]})));

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

/** NEST_COUNT spots of the pool with sizes: spaced, one per quadrant at least, NEST_MIX within each spot's maxSize. */
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
  throw new Error(`ninhos: pool cannot give ${NEST_COUNT} spaced nests over the quadrants`);
}

const half=(r:{w:number;h:number})=>Math.hypot(r.w,r.h)/2;

/**
 * The city's plan for a seed (card NEW-20261022-ORQ-monstros-espalhados, They Are Billions): the drawn nests, the four
 * training bands (one per mouth, out along its avenue at 25–35 u from the car) and ONE field of sleepers spread evenly
 * over the open ground, no two closer than the local gap (spreadGap × SPREAD's zone factors): a random-order
 * sequential draw (blue noise) over a jittered candidate per cell, so no clumps and no holes. Keep-offs: the car's
 * plaza (LOOSE_FROM_CAR), the team's start (LOOSE_FROM_START) and every safe place (maps/safe-places.ts); the moto's
 * routes and the plaza's surroundings only get sparser (SPREAD.route, SPREAD.nearCar). A body within a nest's
 * radius + SPREAD.yard sleeps in that nest (its wake, its groups' exits); the rest are loose, grouped by SPREAD.tile
 * squares into LooseBands (a tile is a place, not a band: they stand apart like everyone else).
 */
export function cityNestPlan(city:CityTerrain,seed:number,options:NestPlanOptions={}):NestPlan{
  const players=Math.max(1,Math.min(6,options.players??1)),car=worldBase(city),rng=new Rng(seed>>>0).fork('ninhos-corpos');
  const grid=cityGrid(city),reach=new FlowField(grid,[car],{wallPenalty:0}),pop=Math.max(1,options.population??POPULATION);
  let gap=spreadGap(players,pop);
  const drawn=drawNests(seed,car,options.start);
  const loose:LooseBand[]=[];
  // Training: from each mouth, follow the way out to its avenue end until 25–35 u from the car, then a band beside it,
  // its members a gap apart too.
  const P=city.asset.points,training:Point[]=[];
  for(const k of ['N','S','L','O'] as const){
    const far=rng.range(TRAINING_FROM_CAR[0],TRAINING_FROM_CAR[1]),out=new FlowField(grid,[P[`spawn${k}`]],{wallPenalty:0});
    const p={...P.bocas[k]},d={x:0,y:0};
    for(let step=0;step<400&&dist(p,car)<far;step++){out.directionAt(p.x,p.y,d);p.x+=d.x*.5;p.y+=d.y*.5;}
    const members=spaced(city,reach,rng,p,TRAINING_SPREAD*gap,scaleSleepers(TRAINING_MEMBERS,players),gap,training);
    training.push(...members);
    loose.push(Object.freeze({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,training:true,members:Object.freeze(members)}));
  }
  // The user (22/10): today's horde, spread ("1p ≈ 3400, 4p ≈ 4930"): the field holds fieldTarget bodies. The gap comes
  // from it (SPREAD.k / √target, a little under what the city holds); a city that holds fewer draws once more a bit
  // tighter, and the bodies past the target (the last kept: the shuffle's tail, spread like the rest) are dropped.
  const want=fieldTarget(players,pop)-training.length,keep={car,start:options.start,routes:options.routes??[],taken:training};
  let field=spreadField(city,reach,rng,gap,keep);
  if(!SPREAD.gap&&field.length<want){gap=Math.round(gap*Math.sqrt(field.length/want)*.97*1000)/1000;field=spreadField(city,reach,rng,gap,keep);}
  if(!SPREAD.gap&&field.length>want)field=field.slice(0,Math.max(0,want));
  // A body in a nest's yard sleeps in the nearest such nest; the others by tile.
  const nestRadius=drawn.map(({spot,size})=>{const box=bboxOf(city,spot.block);return box?half(box):NEST_YARD_RADIUS[size];});
  const sleepers=drawn.map(()=>[] as Point[]),tiles=new Map<number,Point[]>();
  for(const p of field){
    let best=-1,bd=Infinity;
    drawn.forEach(({spot},i)=>{const d=dist(p,spot);if(d<=nestRadius[i]+SPREAD.yard&&d<bd){bd=d;best=i;}});
    if(best>=0){sleepers[best].push(p);continue;}
    const key=Math.floor(p.y/SPREAD.tile)*4096+Math.floor(p.x/SPREAD.tile),list=tiles.get(key);
    if(list)list.push(p);else tiles.set(key,[p]);
  }
  const nests:Nest[]=drawn.map(({spot,size},i)=>Object.freeze({id:spot.id,kind:spot.kind,x:spot.x,y:spot.y,size,...(spot.block?{block:spot.block}:{}),
    radius:nestRadius[i],sleepers:Object.freeze(sleepers[i])}));
  for(const key of [...tiles.keys()].sort((a,b)=>a-b)){
    const members=tiles.get(key)!,x=members.reduce((s,m)=>s+m.x,0)/members.length,y=members.reduce((s,m)=>s+m.y,0)/members.length;
    loose.push(Object.freeze({x:Math.round(x*100)/100,y:Math.round(y*100)/100,training:false,members:Object.freeze(members)}));
  }
  return Object.freeze({seed,players,...(pop!==POPULATION?{population:pop}:{}),gap,nests:Object.freeze(nests),loose:Object.freeze(loose)});
}

/**
 * Card monstros-espalhados: the field's numbers. Mutable only for the bench and the top-view sheet (scripts/
 * mapa-bichos.ts --gap); the game never writes it.
 *  - k: the gap is k / √(the field's target) (fieldTarget: today's horde for the room), so the field holds it;
 *  - gap: a fixed gap for one player instead (the top-view sheet's --gap; 0: from k and the target, the game's);
 *  - sub: candidates per cell side (sub² per cell: a field tighter than a cell still fills);
 *  - nearCar: × the gap at LOOSE_FROM_CAR from the car, back to 1 at `ramp` u (sparser near the start, denser far);
 *  - route, routeNear: × the gap within routeNear u of a moto route (the moto rides by without a crowd to wake);
 *  - yard: a body within a nest's radius + yard u is that nest's sleeper;
 *  - tile: the loose bodies' grouping square (u).
 * mapa-175-com-viaduto: ramp 90, yard 10 and tile 24 ÷ CITY_COMPACT (51, 6, 14); k 148 → 73 with FIELD_BODIES (the
 * same gap as on the 1.7× city: 148 × √(820/3400)).
 */
export const SPREAD={k:73,gap:0,sub:2,nearCar:1.6,ramp:51,route:1.6,routeNear:LOOSE_NEAR_ROUTE,yard:6,tile:14};
/**
 * Today's horde for one player at the reference POPULATION (the 8 nests' rings, 110, and the 60 loose, × 20: card
 * ninhos-perto-ataca-20x), the field's size since monstros-espalhados (the user, 22/10: "mantendo o total de hoje"):
 * 3400 on the 1.7× city; 820 since mapa-175-com-viaduto, the same density: at today's gap (2.54 u for one player) the
 * city 1.75× shorter holds ~870 (its keep-offs, the car's and the start's discs and the safe places, take a bigger
 * share of it than the area's ÷ 3.06 says; the card's "~1.100" was the area alone), and 6 players need some slack.
 * SPREAD.k follows (148 × √(820/3400) ≈ 73), so the gap between two bodies stays today's.
 */
export const FIELD_BODIES=820;
/** The bodies of a room's plan (training bands included): FIELD_BODIES × the player scale × population / POPULATION. */
export const fieldTarget=(players:number,population:number=POPULATION)=>Math.round(scaleSleepers(FIELD_BODIES,players)*Math.max(1,population)/POPULATION);
/** Training band members stand within this × the gap of the band's spot. */
export const TRAINING_SPREAD=2.5;
/** The gap for a room (u): k / √target (or the fixed SPREAD.gap, tighter with the players the same way). */
export const spreadGap=(players:number,population:number=POPULATION)=>Math.round((SPREAD.gap
  ?SPREAD.gap*Math.sqrt(POPULATION/Math.max(1,population)/(1+.15*(Math.max(1,Math.min(6,players|0))-1)))
  :SPREAD.k/Math.sqrt(fieldTarget(players,population)))*1000)/1000;
/** The local gap at p: the field gap × its zone (the plaza ramp, the moto routes: a list, or a test of p). */
export function localGap(p:Point,gap:number,car:Point,routes:readonly (readonly Point[])[]|((p:Point)=>boolean)):number{
  const d=dist(p,car),near=Math.max(0,Math.min(1,(SPREAD.ramp-d)/(SPREAD.ramp-LOOSE_FROM_CAR)));
  const onRoute=typeof routes==='function'?routes(p):routes.some(r=>routeDistance(p,r)<SPREAD.routeNear);
  return gap*(1+(SPREAD.nearCar-1)*near)*(onRoute?SPREAD.route:1);
}
/** Whether p lies within SPREAD.routeNear of a route: the segments bucketed by that size, so a test reads a few. */
function routeTest(routes:readonly (readonly Point[])[]):(p:Point)=>boolean{
  const r=SPREAD.routeNear,cells=new Map<number,[Point,Point][]>(),key=(x:number,y:number)=>(x+4096)*8192+(y+4096);
  for(const route of routes)for(let i=0;i<route.length;i++){
    const a=route[Math.max(0,i-1)],b=route[i];
    for(let cy=Math.floor((Math.min(a.y,b.y)-r)/r);cy<=Math.floor((Math.max(a.y,b.y)+r)/r);cy++)
      for(let cx=Math.floor((Math.min(a.x,b.x)-r)/r);cx<=Math.floor((Math.max(a.x,b.x)+r)/r);cx++){
        const k=key(cx,cy),list=cells.get(k);if(list)list.push([a,b]);else cells.set(k,[[a,b]]);
      }
  }
  return p=>(cells.get(key(Math.floor(p.x/r),Math.floor(p.y/r)))??[]).some(([a,b])=>segmentDistance(p,a,b)<r);
}

/** The candidates: SPREAD.sub² jittered points per open cell; shuffled, then kept greedily when spaced and on ground that reaches the car. */
function spreadField(city:CityTerrain,reach:FlowField,rng:Rng,gap:number,
  keep:{car:Point;start?:Point;routes:readonly (readonly Point[])[];taken:readonly Point[]}):Point[]{
  const a=city.asset,cs=a.unitsPerCell,inSafe=new Set<number>();
  for(const s of citySafePlaces(city))for(const k of s.cells)inSafe.add(k);
  const cand:Point[]=[];
  const sub=Math.max(1,SPREAD.sub|0);
  for(let cy=0;cy<a.cells.h;cy++)for(let cx=0;cx<a.cells.w;cx++){
    if(inSafe.has(cy*a.cells.w+cx))continue;
    for(let j=0;j<sub;j++)for(let i=0;i<sub;i++)
      cand.push({x:Math.round((cx+(i+rng.range(.15,.85))/sub)*cs*100)/100,y:Math.round((cy+(j+rng.range(.15,.85))/sub)*cs*100)/100});
  }
  const hash=new Spaced(gap*Math.max(SPREAD.nearCar,1)*Math.max(SPREAD.route,1));
  for(const p of keep.taken)hash.add(p,gap);
  const out:Point[]=[],onRoute=routeTest(keep.routes);
  for(const p of shuffle(cand,rng)){
    if(dist(p,keep.car)<LOOSE_FROM_CAR||(keep.start&&dist(p,keep.start)<LOOSE_FROM_START))continue;
    const r=localGap(p,gap,keep.car,onRoute);
    if(hash.near(p,r))continue;
    if(!city.clearDisc(p.x,p.y,SLEEPER_CLEAR)||!walkable(p,city)||!reach.reachable(p.x,p.y))continue;
    hash.add(p,r);out.push(p);
  }
  return out;
}
/** `count` spots around `centre` within `outer` u, each at least `gap` from the others and from `taken`. */
function spaced(city:CityTerrain,reach:FlowField,rng:Rng,centre:Point,outer:number,count:number,gap:number,taken:readonly Point[]):Point[]{
  const out:Point[]=[];
  for(let tries=0;out.length<count&&tries<count*200;tries++){
    const ang=rng.range(0,Math.PI*2),r=rng.range(0,outer);
    const p={x:Math.round((centre.x+r*Math.cos(ang))*100)/100,y:Math.round((centre.y+r*Math.sin(ang))*100)/100};
    if(!city.clearDisc(p.x,p.y,SLEEPER_CLEAR)||!walkable(p,city)||!reach.reachable(p.x,p.y))continue;
    if(out.some(o=>dist(o,p)<gap)||taken.some(o=>dist(o,p)<gap)||safePlaceAt(city,p))continue;
    out.push(p);
  }
  return out;
}
/** Points with their own gap, bucketed: `near(p, r)` = some point q closer than max(r, q's gap). */
class Spaced {
  private cells=new Map<number,{p:Point;r:number}[]>();
  private cell:number;
  constructor(cell:number){this.cell=cell;}
  private key=(cx:number,cy:number)=>(cx+4096)*8192+(cy+4096);
  near(p:Point,r:number){
    const cx=Math.floor(p.x/this.cell),cy=Math.floor(p.y/this.cell);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const o of this.cells.get(this.key(cx+dx,cy+dy))??[])if(dist(o.p,p)<Math.max(r,o.r))return true;
    return false;
  }
  add(p:Point,r:number){const k=this.key(Math.floor(p.x/this.cell),Math.floor(p.y/this.cell)),list=this.cells.get(k);if(list)list.push({p,r});else this.cells.set(k,[{p,r}]);}
}

/** The asset grid with the hero rule at each cell centre (as validateBuildPlan's). */
function cityGrid(city:CityTerrain):FlowGrid{
  const cs=city.asset.unitsPerCell;
  return {width:city.asset.cells.w,height:city.asset.cells.h,cellSize:cs,walkable:(cx,cy)=>city.clearDisc((cx+.5)*cs,(cy+.5)*cs,SLEEPER_CLEAR)};
}

/**
 * Everything wrong with a plan (empty = valid): the nest count, mix, quadrants and spacing; each nest far from the car
 * and every route, on its building or a yard that holds its size; every body on open ground that reaches the car, out
 * of every safe place, no two closer than the plan's gap (card monstros-espalhados); a nest's sleepers in its yard; the
 * loose ones beyond LOOSE_FROM_CAR and LOOSE_FROM_START (training excepted); the four training bands.
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
    if(n.kind==='terreno'&&naBoca(city.asset,nestArte(city.asset.unitsPerCell,n,n.size)))bad(n.id,`na boca de uma entrada em (${n.x}, ${n.y})`);
    const box=n.kind==='predio'?bboxOf(city,n.block):undefined;
    if(n.kind==='predio'&&!box)bad(n.id,`prédio ${n.block} não existe`);
    if(box&&RANK[buildingNestSize(box.w,box.h)]<RANK[n.size])bad(n.id,`o prédio ${n.block} não cabe um ninho ${n.size}`);
    for(const p of n.sleepers)if(dist(p,n)>n.radius+SPREAD.yard+1e-6){bad(n.id,`dorminhoco fora do pátio em (${p.x}, ${p.y})`);break;}
  });
  const bodies=[...plan.nests.flatMap(n=>n.sleepers.map(p=>({id:n.id,p}))),...plan.loose.flatMap((b,i)=>b.members.map(p=>({id:`bando-${i+1}`,p})))];
  const gap=plan.gap??0,near=new Spaced(Math.max(gap,1));
  for(const {id,p} of bodies){
    if(!city.clearDisc(p.x,p.y,SLEEPER_CLEAR)||!walkable(p,city))bad(id,`corpo fora do chão em (${p.x}, ${p.y})`);
    else if(!reach.reachable(p.x,p.y))bad(id,`corpo sem caminho até o carro em (${p.x}, ${p.y})`);
    const safe=safePlaceAt(city,p);
    if(safe)bad(id,`corpo dentro do lugar seguro ${safe.id} em (${p.x}, ${p.y})`);
    if(gap>0&&near.near(p,gap*(1-1e-9)))bad(id,`corpo a menos de ${gap} u de outro em (${p.x}, ${p.y})`);
    near.add(p,0);
  }
  plan.loose.forEach((b,i)=>{
    const id=`bando-${i+1}`,d=dist(b,car);
    if(b.training&&(d<TRAINING_FROM_CAR[0]-1||d>TRAINING_FROM_CAR[1]+1))bad(id,`treino a ${d.toFixed(1)} u do carro`);
    if(b.training)return;
    for(const p of b.members){
      if(dist(p,car)<LOOSE_FROM_CAR){bad(id,`a ${dist(p,car).toFixed(1)} u do carro`);break;}
      if(start&&dist(p,start)<LOOSE_FROM_START){bad(id,'perto de onde o time nasce');break;}
    }
  });
  const training=plan.loose.filter(b=>b.training),wantTraining=scaleSleepers(TRAINING_MEMBERS,plan.players);
  if(training.length!==TRAINING_BANDS)bad('plano',`${training.length} bandos de treino (quero ${TRAINING_BANDS})`);
  training.forEach(b=>{if(b.members.length!==wantTraining)bad('treino',`${b.members.length} no bando de treino (quero ${wantTraining})`);});
  return problems;
}
