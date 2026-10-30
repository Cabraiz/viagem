/**
 * NEW-20261023-ORQ-barracas-no-caminho (user, 28/10: "ponha essas barracas que voce fez espalhadas em 4 a 5 lugares do
 * mundo e bem distante uma das outras, talvez no futuro elas vendam algo"): the map's feirinhas. The rows of barracas
 * "de ponta a ponta" are gone; the barracas stand in a few small feiras instead, scenery.
 * - Laid once (TowersState.feirinhas), on the first step of a city run with the car, after the tralha (so the tralha
 *   lays as before): FEIRA_COUNT feirinhas (the run's rng), each FEIRA_BARRACAS barracas (2×2 cells, PieceState kind
 *   'barraca', owner FEIRA_OWNER) FEIRA_STEP cells apart in a row along x or y.
 * - Where: open ground, a praça or a wide calçada (the row and FEIRA_MARGIN cells all around it walkable), off the
 *   streets the car drives (carStillPasses with the car's margin: no stretch of street cut off), never locking the car
 *   off a spawn or the moto (free-build locks), FEIRA_SPAWN_GAP u from every spawn, FEIRA_CAR_GAP u from the car,
 *   CAR_NEST_KEEP_OUT from a nest, FEIRA_BANK_GAP u from a bank (its lot), off every piece already laid, and
 *   FEIRA_ENTRADA_FOLGA off every entrance's free strip (bocaFaixa, maps/city/entradas.ts, NEW-20261030-ORQ-entradas-livres-de-tudo).
 * - Far apart: each feirinha is drawn among the spots at least FEIRA_GAP u from every feirinha already laid; when none
 *   of those fits, the spots farthest from them first (so the feirinhas still spread, a small map or a crowded one).
 *   One such draw paints itself into a corner on most seeds (Cidade Nevada: 21 of 30 seeds had two feirinhas < 45 u
 *   apart), so up to FEIRA_LAYOUTS whole layouts are drawn (each from its own rng fork) until one keeps every pair
 *   FEIRA_GAP apart (30 of 30); the open spots of each row shape are scanned once for all of them.
 * - Solid scenery: a barraca blocks the enemies like a muro (its blocker disc), is never a siege target
 *   (free-build pieceTargets), never takes damage (damagePiece), is never collected (tralha reachable: barricada only)
 *   and never slows anyone (drag 1). The heroes walk through it, as through every blocker.
 * - The shop to come: each feirinha keeps an id (FEIRA_PREFIX-N), its centre and its barracas' ids (feirinhasOf).
 * Everything here is JSON-safe in TowersState.feirinhas (checkpoints, stateHash).
 */
import {naBoca,type CellRect,type CityTerrain,type Point} from '../../maps/index.ts';
import {CAR_NEST_KEEP_OUT} from '../../contract/index.ts';
import {FEIRA_BANK_GAP,FEIRA_BARRACAS,FEIRA_CAR_GAP,FEIRA_COUNT,FEIRA_GAP,FEIRA_MARGIN,FEIRA_SPAWN_GAP,FEIRA_STEP,FREE_PIECE_DEFS,pieceCells} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import type {StonewardsState} from '../stonewards/state.ts';
import {towersOf} from './system.ts';
import {FREE_CELL,blockDiscs,gridSize,locks,onGround,pieceRect,pieceRectOf,rectsOverlap,setMuro,type PieceState} from './free-build.ts';
import {carStillPasses} from './tralha.ts';

export const FEIRA_PREFIX='feira',BARRACA_PREFIX='barraca',FEIRA_OWNER='feira';
/** A feirinha: its id, its centre (u) and the ids of its barracas (in the row's order). */
export interface Feirinha {id:string;x:number;y:number;barracas:string[]}
export interface FeirinhasWorld {
  city:CityTerrain;car:{x:number;y:number;radius:number};moto?:Point;nests?:readonly Point[];
  /** The banks' places (their lots stay clear). */
  banks?:readonly Point[];
  onTerrainChanged?:(rect:CellRect)=>void;
}
/** A barraca row keeps this far (u) off an entrance's free strip (maps/city/entradas.ts bocaFaixa). */
export const FEIRA_ENTRADA_FOLGA=0;
/** The candidate scan's stride (build cells). */
const STRIDE=2;
const gap=(r:{x:number;y:number;w:number;h:number},p:Point)=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));

/** The feirinhas laid (empty before they are). */
export const feirinhasOf=(state:StonewardsState):readonly Feirinha[]=>state.defenses?.feirinhas??[];

/** The barracas' top-left cells of a row of `n` from `o` (along x or y). */
const rowCells=(o:{c:number;r:number},n:number,alongX:boolean)=>Array.from({length:n},(_,i)=>({c:o.c+(alongX?i*FEIRA_STEP:0),r:o.r+(alongX?0:i*FEIRA_STEP)}));

/** Layouts drawn per run (each from its own fork of the run's rng); the most spread one is laid. */
export const FEIRA_LAYOUTS=40;

/** Lays the map's feirinhas once (see the header); returns the barracas laid (0 when already done). */
export function placeFeirinhas(ctx:SimContext,state:StonewardsState,world:FeirinhasWorld):number{
  const towers=towersOf(state);
  if(towers.feirinhas)return 0;
  const pieces=towers.pieces??=[];
  // Up to FEIRA_LAYOUTS layouts, until one has its feirinhas all FEIRA_GAP apart; else the one with the most
  // feirinhas, then the widest smallest gap between two of them.
  let best:ReturnType<typeof drawLayout>|undefined;
  const better=(a:readonly number[],b:readonly number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];return false;};
  const open=openSpots(world,pieces);
  for(let t=0;t<FEIRA_LAYOUTS;t++){
    const layout=drawLayout(ctx,state,world,pieces,open,t);
    if(!best||better(layout.score,best.score))best=layout;
    if(best.score[0])break;
  }
const feiras:Feirinha[]=towers.feirinhas=[];
  let laid=0;
  for(const [i,row] of best!.rows.entries()){
    for(const p of row){p.id=ctx.nextId(BARRACA_PREFIX);pieces.push(p);setMuro(world.city,p,false,world.onTerrainChanged);laid++;}
    feiras.push({id:`${FEIRA_PREFIX}-${feiras.length+1}`,x:best!.centres[i].x,y:best!.centres[i].y,barracas:row.map(p=>p.id)});
  }
  return laid;
}

type Spot={o:{c:number;r:number};rect:{x:number;y:number;w:number;h:number};x:number;y:number};
/**
 * The spots of a row shape (n barracas, along x or y) on the stride where the row and its margin are open ground, clear
 * of the spawns, the car, the nests, the banks and the pieces laid before the feirinhas: the same for every layout, so
 * scanned once per shape.
 */
function openSpots(world:FeirinhasWorld,pieces:readonly PieceState[]){
  const {city,car}=world,P=city.asset.points,spawns=[P.spawnN,P.spawnS,P.spawnL,P.spawnO];
  const [bw,bh]=pieceCells('barraca'),{cols,rows}=gridSize(city),cache=new Map<string,Spot[]>();
  return (n:number,alongX:boolean):Spot[]=>{
    const key=`${n}${alongX?'x':'y'}`,hit=cache.get(key);
    if(hit)return hit;
    const span=(n-1)*FEIRA_STEP,w=alongX?span+bw:bw,h=alongX?bh:span+bh,spots:Spot[]=[];
    for(let r=FEIRA_MARGIN;r+h+FEIRA_MARGIN<=rows;r+=STRIDE)for(let c=FEIRA_MARGIN;c+w+FEIRA_MARGIN<=cols;c+=STRIDE){
      if(!onGround(city,{c:c-FEIRA_MARGIN,r:r-FEIRA_MARGIN},w+2*FEIRA_MARGIN,h+2*FEIRA_MARGIN))continue;
      const rect=pieceRect({c,r},w,h);
      if(spawns.some(s=>gap(rect,s)<FEIRA_SPAWN_GAP)||gap(rect,car)<car.radius+FEIRA_CAR_GAP)continue;
      if((world.nests??[]).some(p=>gap(rect,p)<CAR_NEST_KEEP_OUT)||(world.banks??[]).some(p=>gap(rect,p)<FEIRA_BANK_GAP))continue;
      if(pieces.some(p=>rectsOverlap(pieceRectOf(p),rect)))continue;
      if(naBoca(city.asset,rect,FEIRA_ENTRADA_FOLGA))continue;
      spots.push({o:{c,r},rect,x:rect.x+rect.w/2,y:rect.y+rect.h/2});
    }
    cache.set(key,spots);
    return spots;
  };
}

/** One layout (the rows and their centres), drawn from the rng fork `t`; `pieces` is left as it came. */
function drawLayout(ctx:SimContext,state:StonewardsState,world:FeirinhasWorld,pieces:PieceState[],open:ReturnType<typeof openSpots>,t:number){
  const {city,car}=world;
  const rng=ctx.rng.fork(t?`feirinhas-${t}`:'feirinhas'),def=FREE_PIECE_DEFS.barraca,[bw,bh]=pieceCells('barraca');
  const count=rng.int(FEIRA_COUNT[0],FEIRA_COUNT[1]),base=pieces.length;
  const discsOf=(list:readonly PieceState[])=>list.flatMap(p=>{const [w,h]=pieceCells(p.kind,p.rot??0);return blockDiscs(p.kind,p.cell,w,h);});
  const out:PieceState[][]=[],centres:Point[]=[],M=FEIRA_MARGIN*FREE_CELL;
  for(let f=0;f<count;f++){
    const n=rng.int(FEIRA_BARRACAS[0],FEIRA_BARRACAS[1]),alongX=rng.chance(.5);
    // The shape's open spots off this layout's rows (with their margin), ranked by distance to its feirinhas.
    const spots=open(n,alongX).filter(s=>{const wide={x:s.rect.x-M,y:s.rect.y-M,w:s.rect.w+2*M,h:s.rect.h+2*M};
      return !out.some(row=>row.some(p=>rectsOverlap(pieceRectOf(p),wide)));})
      .map(s=>({...s,d:Math.min(Infinity,...centres.map(q=>Math.hypot(q.x-s.x,q.y-s.y)))}));
    // The far ones drawn at random, then (only while under FEIRA_COUNT's least) the rest, the farthest first: past it a
    // feirinha too near the others is left out (the city is mostly entrances, NEW-20261030-ORQ-entradas-livres-de-tudo).
    // A spot that would cut the car's street or lock it is passed over for the next.
    const far=spots.filter(s=>s.d>=FEIRA_GAP),near=f<FEIRA_COUNT[0]?spots.filter(s=>s.d<FEIRA_GAP).sort((a,b)=>b.d-a.d):[];
    for(let i=far.length-1;i>0;i--){const j=rng.int(0,i);[far[i],far[j]]=[far[j],far[i]];}
    for(const s of [...far,...near]){
      const cells=rowCells(s.o,n,alongX),discs=discsOf(pieces),extra=cells.flatMap(cell=>blockDiscs('barraca',cell,bw,bh));
      if(!carStillPasses(city,discs,extra))continue;
      // locks() sees the standing blocking pieces: lay the row, then take it back if it shuts the car off.
      const row:PieceState[]=cells.map(cell=>{const rect=pieceRect(cell,bw,bh);
        return {id:'',kind:'barraca',cell,owner:FEIRA_OWNER,x:rect.x+rect.w/2,y:rect.y+rect.h/2,hp:def.hp,maxHp:def.hp,startTick:ctx.tick,readyTick:ctx.tick};});
      const last=row.pop()!;
      pieces.push(...row);
      const shut=locks(city,state,last.cell,car,world.moto,bw,bh,'barraca');
      pieces.splice(pieces.length-row.length,row.length);
      if(shut)continue;
      row.push(last);
      pieces.push(...row);out.push(row);centres.push({x:s.x,y:s.y});
      break;
    }
  }
  pieces.splice(base);
  let min=Infinity;
  for(let i=0;i<centres.length;i++)for(let j=i+1;j<centres.length;j++)min=Math.min(min,Math.hypot(centres[i].x-centres[j].x,centres[i].y-centres[j].y));
  // Spread only counts with at least FEIRA_COUNT's least laid (an empty draw has no pair, min Infinity).
  return {rows:out,centres,score:[out.length>=FEIRA_COUNT[0]&&min>=FEIRA_GAP?1:0,out.length,min] as const};
}
