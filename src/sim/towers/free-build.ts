/**
 * D-052, fortification anywhere (sim-fortificação, slice 2 of NEW-20261016-ORQ-carro-e-fortificacao-livre): the city's
 * build grid, what stands on it and the rules of a free build. towers/system.ts `buildFree` runs the order; this file
 * holds the geometry, the wall pieces (muro, barricada) and the "do not lock the chaveiro" check.
 *
 * - Grid: CITY_BUILD_CELL (0.88 u) cells, origin 0,0 of the city; (c,r) is a footprint's top-left cell (contract
 *   build.ts). A tower covers its size square (rules DefenseDef.size: the root 1×1), a piece its W×H (rules
 *   pieceCells, rot 1 turns it). City only: elsewhere the build sites stay (towers/system.ts `build`).
 * - Walls to the enemies: a standing muro is a blocker disc (MURO_BLOCK_R) on the room's CityTerrain fork, like a
 *   plaza barricade (stonewards/barricades.ts): solid to the enemies' movement and flow grid, walked through by the
 *   heroes. A body pressed against it bashes it (a `blocking` structure target), so a wall in the way is broken, not
 *   walked into forever. It blocks from the obra's first tick (nothing is inside: an occupied cell is refused).
 * - Tranca: a muro is refused when, with it, the car's cell no longer reaches every spawn's cell (the borda, where the
 *   critters come from) or the moto's cell on the city's flow grid (asset cells, 4-connected: the flow field's moves
 *   without corner cutting), with the muros as the enemies see them (a cell is shut when the hero disc at its centre
 *   overlaps a muro disc). Only the muros count (towers and barricades never block; the plaza barricades are bashed
 *   open anyway). A piece is only blamed for a lock it makes: when the city was already shut without it, it passes.
 * - Barricade: an enemy whose centre is on it walks at FREE_PIECE_DEFS.barricada.drag × its speed (enemy-ai `drag`);
 *   the siege groups bash it like a tower (a non-blocking target).
 * - State: JSON-safe, in TowersState.pieces (created on the first piece); a fallen piece leaves the list.
 */
import {RADIUS,walkable,CITY_BUILD_CELL,type CellRect,type CityTerrain,type FlowGrid,type Point,type Rect,type TerrainField} from '../../maps/index.ts';
import {carBodyDiscs,ticks,type FreePiece} from '../../contract/index.ts';
import {DEFENSES,FREE_PIECE_DEFS,UNO_ALERT_CELLS,UNO_ALERT_SECONDS,pieceCells,type BuildPiece} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import {blockingCity} from '../stonewards/barricades.ts';
import type {StonewardsState} from '../stonewards/state.ts';

export interface PieceState extends Point {
  id:string;kind:FreePiece;
  /** Top-left cell on the build grid; rot 1 turns the footprint (absent: 0). */
  cell:{c:number;r:number};rot?:1;
  owner:string;hp:number;maxHp:number;
  /** Its obra runs startTick → readyTick (a dragged wall's obras are queued one after the other). */
  startTick:number;readyTick:number;
  /** A barricada the car came within UNO_ALERT_CELLS of: the tick it falls unless the car leaves (unoAlertStep). */
  alertUntil?:number;
}
/** {t:'build'} on the grid: `piece` with its footprint's top-left cell at (c,r). */
export interface FreeOrder {piece:BuildPiece;c:number;r:number;rot?:0|1}
/** What the free build reads from the objective (assemble.ts wires the chaveiro); all optional. */
export interface FreeBuildHooks {
  /** The car's centre and body radius (D-047; absent: no car, e.g. the wall mode). */
  car?(tick:number):{x:number;y:number;radius:number;heading?:number}|undefined;
  /** Where the moto is now (the tranca check keeps it a way to the car). */
  moto?(tick:number):Point|undefined;
  /** Living nests (D-051): no piece within CAR_NEST_KEEP_OUT of one. */
  nests?(tick:number):readonly Point[];
  /** The banks' places (barracas-no-caminho: the feirinhas keep off their lots). */
  banks?(tick:number):readonly Point[];
}

/** The build grid's cell (u). */
export const FREE_CELL=CITY_BUILD_CELL;
/**
 * The muro's blocker disc (u): 0.85 of a cell, so the discs of a straight row of muros leave no gap a hero-size body
 * passes (midway between two discs the union is ±0.61 u) and shut a cell of the 1.496 u flow grid in every column the
 * row crosses (the band a hero disc cannot enter is ≥ 1.66 u wide, wider than a flow cell).
 */
export const MURO_BLOCK_R=.85*FREE_CELL;
/**
 * A blocking piece's disc for a W×H footprint (NEW-20261022-ORQ-barricada-2x: the 2×2 barricada): centred on the
 * footprint, MURO_BLOCK_R × its longer side, so a 2×2 square's corners are inside it and a row of them, side by side,
 * is shut as tightly as a row of 1-cell muros (the same geometry, twice the size).
 */
export const blockDisc=(cell:{c:number;r:number},w:number,h:number)=>({x:(cell.c+w/2)*FREE_CELL,y:(cell.r+h/2)*FREE_CELL,r:MURO_BLOCK_R*Math.max(w,h)});
/**
 * barricada-tocar-no-mapa (user, 25/10: the collision as big as the drawing): a barricada's blocker is BARRICADA_DISCS
 * discs of BARRICADA_BLOCK_R along its long axis, BARRICADA_DISC_STEP apart (centre one on the piece's centre), not
 * one disc 3 u wide. Sized so that, with a hero-size probe (RADIUS), the band the discs shut is wider than a 1.496 u flow
 * cell everywhere along a row of barricadas end to end (between two discs of a piece and across the joint of two
 * pieces, 2 cells apart): the flow grid sees the row shut (no gap, not even for the smallest body), and each piece
 * spans about its 2 cells (1.76 u, ±0.27 u past each end) and 1.2 u across (the art's wall and its rows: muralha.ts).
 */
export const BARRICADA_BLOCK_R=.6,BARRICADA_DISC_STEP=.545,BARRICADA_DISCS=3;
/** The blocker discs of a w×h piece at `cell` (the muro's one disc; a barricada's row along its long side). */
export function blockDiscs(piece:string,cell:{c:number;r:number},w:number,h:number):{x:number;y:number;r:number}[]{
  if(piece!=='barricada')return [blockDisc(cell,w,h)];
  const x=(cell.c+w/2)*FREE_CELL,y=(cell.r+h/2)*FREE_CELL,alongX=w>=h,out:{x:number;y:number;r:number}[]=[];
  for(let i=0;i<BARRICADA_DISCS;i++){
    const t=(i-(BARRICADA_DISCS-1)/2)*BARRICADA_DISC_STEP;
    out.push({x:alongX?x+t:x,y:alongX?y:y+t,r:BARRICADA_BLOCK_R});
  }
  return out;
}
/** How far (u) a piece's blocker reaches from its centre (its siege target's radius). */
export function blockReach(piece:string,w:number,h:number):number{
  return piece==='barricada'?(BARRICADA_DISCS-1)/2*BARRICADA_DISC_STEP+BARRICADA_BLOCK_R:MURO_BLOCK_R*Math.max(w,h);
}

export const pieceRect=(cell:{c:number;r:number},w:number,h:number):Rect=>({x:cell.c*FREE_CELL,y:cell.r*FREE_CELL,w:w*FREE_CELL,h:h*FREE_CELL});
/** The cells a piece covers. */
export function pieceRectOf(p:PieceState):Rect{const [w,h]=pieceCells(p.kind,p.rot??0);return pieceRect(p.cell,w,h);}
/** The cells a tower covers: its own cell and size, or (a defense from before the free build) the square of its disc. */
export function defenseRectOf(d:{kind:keyof typeof DEFENSES;x:number;y:number;r:number;cell?:{c:number;r:number}}):Rect{
  const s=DEFENSES[d.kind].size??1;
  return d.cell?pieceRect(d.cell,s,s):{x:d.x-d.r,y:d.y-d.r,w:2*d.r,h:2*d.r};
}
export const rectsOverlap=(a:Rect,b:Rect)=>a.x<b.x+b.w-1e-9&&b.x<a.x+a.w-1e-9&&a.y<b.y+b.h-1e-9&&b.y<a.y+a.h-1e-9;
/** True when a disc (a body) overlaps the rect. */
export const discHits=(rect:Rect,x:number,y:number,radius:number)=>{
  const dx=Math.max(rect.x-x,0,x-(rect.x+rect.w)),dy=Math.max(rect.y-y,0,y-(rect.y+rect.h));
  return dx*dx+dy*dy<radius*radius;
};

/** The city a free build stands on, or undefined (the island, the endless world: their build sites stay). */
export const freeCity=(terrain:TerrainField|undefined):CityTerrain|undefined=>blockingCity(terrain);

/** The grid's size in cells (the whole city). */
export function gridSize(city:CityTerrain):{cols:number;rows:number}{
  const a=city.asset;return {cols:Math.floor(a.cells.w*a.unitsPerCell/FREE_CELL),rows:Math.floor(a.cells.h*a.unitsPerCell/FREE_CELL)};
}
/** True when every cell of the rect is on the grid and its centre is walkable ground (the hero rule, blockers aside). */
export function onGround(city:CityTerrain,o:{c:number;r:number},w:number,h:number):boolean{
  const {cols,rows}=gridSize(city);
  if(!(Number.isSafeInteger(o.c)&&Number.isSafeInteger(o.r))||o.c<0||o.r<0||o.c+w>cols||o.r+h>rows)return false;
  const p={x:0,y:0};
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){p.x=(o.c+i+.5)*FREE_CELL;p.y=(o.r+j+.5)*FREE_CELL;if(!walkable(p,city))return false;}
  return true;
}

export const piecesOf=(state:StonewardsState):readonly PieceState[]=>state.defenses?.pieces??[];
/** The team's standing pieces of a kind (the map's own: the tralha, owner 'mapa', the feirinhas, 'feira'; never counted against the limit). */
export const standingPieces=(state:StonewardsState,kind:FreePiece)=>piecesOf(state).filter(p=>p.kind===kind&&p.owner!=='mapa'&&p.owner!=='feira').length;

/** NEW-20261021-ORQ-barricada-construir: the pieces that are walls to the enemies (rules FREE_PIECE_DEFS blocks: muro, barricada). */
export const blocksEnemies=(kind:FreePiece)=>FREE_PIECE_DEFS[kind].blocks;
/** The standing blocking pieces (the moto rides around them, the tranca check counts them). */
export const blockingPieces=(state:StonewardsState)=>piecesOf(state).filter(p=>blocksEnemies(p.kind));
/** A blocking piece's blocker disc (blockDisc of its footprint: a muro its cell's centre, MURO_BLOCK_R). */
const muroDiscs=(p:PieceState)=>{const [w,h]=pieceCells(p.kind,p.rot??0);return blockDiscs(p.kind,p.cell,w,h);};
/** The terrain's blocker id of a piece's i-th disc (the first keeps the piece's own id). */
const discId=(p:PieceState,i:number)=>i?`${p.id}~${i}`:p.id;
/** Flow-grid cells (asset.unitsPerCell, inclusive) a muro's blocker decides, one cell of margin. */
function muroCells(city:CityTerrain,p:PieceState):CellRect{
  const cs=city.asset.unitsPerCell,ds=muroDiscs(p);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const d of ds){const reach=d.r+RADIUS;x0=Math.min(x0,d.x-reach);y0=Math.min(y0,d.y-reach);x1=Math.max(x1,d.x+reach);y1=Math.max(y1,d.y+reach);}
  return {x0:Math.floor(x0/cs)-1,y0:Math.floor(y0/cs)-1,x1:Math.floor(x1/cs)+1,y1:Math.floor(y1/cs)+1};
}
/** Raises (or with `gone` removes) a muro's blocker and reports the flow cells when it changed. */
export function setMuro(terrain:TerrainField|undefined,p:PieceState,gone:boolean,onTerrainChanged?:(rect:CellRect)=>void){
  const city=blockingCity(terrain);
  if(!city||!blocksEnemies(p.kind))return;
  const before=city.blockerVersion;
  muroDiscs(p).forEach((d,i)=>city.setBlocker(discId(p,i),gone?undefined:d));
  if(city.blockerVersion!==before)onTerrainChanged?.(muroCells(city,p));
}
/** Makes the terrain hold a blocker for every standing muro (a system created from a checkpoint); returns the changed cells. */
export function syncPieces(terrain:TerrainField|undefined,state:StonewardsState):CellRect[]{
  const out:CellRect[]=[];
  for(const p of piecesOf(state))setMuro(terrain,p,false,rect=>out.push(rect));
  return out;
}
/** Removes every muro's blocker (a rematch reset drops the pieces); returns the changed cells. */
export function clearPieces(terrain:TerrainField|undefined,state:StonewardsState):CellRect[]{
  const out:CellRect[]=[];
  for(const p of piecesOf(state))setMuro(terrain,p,true,rect=>out.push(rect));
  return out;
}

/** The one damage path into a piece (stonewards `hit`, D-017). At 0 hp it is gone (its muro blocker too). False: no such piece. */
export function damagePiece(terrain:TerrainField|undefined,state:StonewardsState,id:string,amount:number,onTerrainChanged?:(rect:CellRect)=>void):boolean{
  const list=state.defenses?.pieces,i=list?list.findIndex(p=>p.id===id):-1;
  if(!list||i<0)return false;
  if(state.wallDown||!(amount>0))return true;
  const p=list[i];
  // barracas-no-caminho: the feirinhas' barracas are scenery (towers/barracas.ts), never hurt.
  if(p.kind==='barraca')return true;
  p.hp=Math.max(0,p.hp-amount);
  if(p.hp<=0){list.splice(i,1);setMuro(terrain,p,true,onTerrainChanged);}
  return true;
}
export const isPiece=(state:StonewardsState,id:string)=>piecesOf(state).some(p=>p.id===id);

/** Siege targets: a muro blocks (any body pressed against it bashes it), a barricade is a non-blocking target like a tower. */
export function pieceTargets(state:StonewardsState):{id:string;x:number;y:number;radius:number;blocking?:true}[]{
  return piecesOf(state).filter(p=>p.kind!=='barraca').map(p=>blocksEnemies(p.kind)?{id:p.id,x:p.x,y:p.y,radius:blockReach(p.kind,...pieceCells(p.kind,p.rot??0)),blocking:true as const}
    :{id:p.id,x:p.x,y:p.y,radius:Math.max(...pieceCells(p.kind,p.rot??0))*FREE_CELL/2});
}

/** An enemy's speed multiplier from the barricades it stands on (1 off them; the lowest when on several). */
export function pieceDrag(state:StonewardsState,e:Point):number{
  const list=state.defenses?.pieces;
  if(!list?.length)return 1;
  let drag=1;
  for(const p of list){
    const def=FREE_PIECE_DEFS[p.kind];
    if(def.drag>=drag)continue;
    const rect=pieceRectOf(p);
    if(e.x>=rect.x&&e.x<=rect.x+rect.w&&e.y>=rect.y&&e.y<=rect.y+rect.h)drag=def.drag;
  }
  return drag;
}

// ---------- Tranca ----------
const groundCache=new WeakMap<object,Uint8Array>();
/** The city's flow cells a hero-size body may stand on (hero rule at the centre, no blockers), once per asset. */
function ground(city:CityTerrain):Uint8Array{
  const known=groundCache.get(city.asset);
  if(known)return known;
  const a=city.asset,w=a.cells.w,h=a.cells.h,cs=a.unitsPerCell,out=new Uint8Array(w*h),p={x:0,y:0};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){p.x=(x+.5)*cs;p.y=(y+.5)*cs;if(walkable(p,city))out[x+y*w]=1;}
  groundCache.set(city.asset,out);
  return out;
}
const STEPS=[[1,0],[-1,0],[0,1],[0,-1]] as const;
/** The open cell nearest (x,y) within a 5×5 block, else -1 (a point at a wall's edge still has its cell). */
function seedCell(open:Uint8Array,w:number,h:number,cs:number,p:Point){
  const x=Math.floor(p.x/cs),y=Math.floor(p.y/cs);
  let best=-1,dist=Infinity;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const vx=x+dx,vy=y+dy;
    if(vx<0||vy<0||vx>=w||vy>=h||!open[vx+vy*w])continue;
    const d=dx*dx+dy*dy;
    if(d<dist){dist=d;best=vx+vy*w;}
  }
  return best;
}
/** Whether, with these blocker discs shutting cells, the car still reaches every spawn and the moto. */
function connected(city:CityTerrain,muros:readonly {x:number;y:number;r:number}[],car:Point,moto:Point|undefined):boolean{
  const a=city.asset,w=a.cells.w,h=a.cells.h,cs=a.unitsPerCell,open=ground(city).slice();
  for(const m of muros){
    const reach=m.r+RADIUS;
    const x0=Math.max(0,Math.floor((m.x-reach)/cs)),x1=Math.min(w-1,Math.floor((m.x+reach)/cs));
    const y0=Math.max(0,Math.floor((m.y-reach)/cs)),y1=Math.min(h-1,Math.floor((m.y+reach)/cs));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const dx=(x+.5)*cs-m.x,dy=(y+.5)*cs-m.y;
      if(dx*dx+dy*dy<reach*reach)open[x+y*w]=0;
    }
  }
  const start=seedCell(open,w,h,cs,car);
  if(start<0)return false;
  const P=a.points,goals=[P.spawnN,P.spawnS,P.spawnL,P.spawnO,...(moto?[moto]:[])].map(p=>seedCell(open,w,h,cs,p));
  if(goals.some(g=>g<0))return false;
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  let head=0,tail=0,left=new Set(goals).size;
  const wanted=new Set(goals);
  queue[tail++]=start;seen[start]=1;
  while(head<tail){
    const u=queue[head++];
    if(wanted.has(u)&&--left===0)return true;
    const ux=u%w,uy=(u-ux)/w;
    for(const [dx,dy] of STEPS){
      const vx=ux+dx,vy=uy+dy;
      if(vx<0||vy<0||vx>=w||vy>=h)continue;
      const v=vx+vy*w;
      if(seen[v]||!open[v])continue;
      seen[v]=1;queue[tail++]=v;
    }
  }
  return false;
}
/**
 * True when a blocking piece of w×h cells (a muro: 1×1) at `cell` would lock the chaveiro: the city stays open without
 * it and is shut with it (the car's cell cut off from a spawn's or the moto's). Without a car (the wall mode) the wall's
 * spot stands in for it.
 */
export function locks(city:CityTerrain,state:StonewardsState,cell:{c:number;r:number},car:Point,moto:Point|undefined,w=1,h=1,piece='muro'):boolean{
  const muros=blockingPieces(state).flatMap(muroDiscs);
  const extra=blockDiscs(piece,cell,w,h);
  if(connected(city,[...muros,...extra],car,moto))return false;
  return connected(city,muros,car,moto);
}

// ---------- Barricada construída (NEW-20261021-ORQ-barricada-construir) ----------
/** Distance (u) from a rect's edge to a point (0 inside). */
const rectGap=(r:Rect,p:Point)=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));

/**
 * The car near a barricada (user, 21/10): the car's body within UNO_ALERT_CELLS cells of a standing barricada sounds its
 * alert (alertUntil; the view's untilTick, the client glows it red); the car out of that range calls it off; still in
 * range at alertUntil, the barricada is destroyed (its blocker too; a 'structure' event at hp 0). Returns the ids destroyed this tick.
 * NEW-20261028-ORQ-uno-atravessa-tralha (the user, 28/10: "muitas tralhas que vão me atrapalhar a caminhar com o carro"):
 * the map's own tralha (owner 'mapa') never stops the car; the body (carBodyDiscs) on a square runs it over at once
 * (the same fall: the client's break and sound). The enemies and the heroes still meet it as before.
 */
export function unoAlertStep(ctx:SimContext,terrain:TerrainField|undefined,state:StonewardsState,car:{x:number;y:number;radius:number;heading?:number}|undefined,onTerrainChanged?:(rect:CellRect)=>void):string[]{
  const list=state.defenses?.pieces,gone:string[]=[];
  if(!list?.length)return gone;
  const reach=UNO_ALERT_CELLS*FREE_CELL,body=car?carBodyDiscs(car.x,car.y,car.heading):[];
  for(let i=list.length-1;i>=0;i--){
    const p=list[i];
    if(p.kind!=='barricada')continue;
    if(p.owner==='mapa'&&body.some(d=>rectGap(pieceRectOf(p),d)<d.r)){
      list.splice(i,1);setMuro(terrain,p,true,onTerrainChanged);gone.push(p.id);
      ctx.emit({type:'structure',id:p.id,hp:0,maxHp:p.maxHp});
      continue;
    }
    const near=!!car&&rectGap(pieceRectOf(p),car)<car.radius+reach;
    if(!near){delete p.alertUntil;continue;}
    if(p.alertUntil===undefined){p.alertUntil=ctx.tick+ticks(UNO_ALERT_SECONDS);continue;}
    if(ctx.tick<p.alertUntil)continue;
    list.splice(i,1);setMuro(terrain,p,true,onTerrainChanged);gone.push(p.id);
    ctx.emit({type:'structure',id:p.id,hp:0,maxHp:p.maxHp});
  }
  return gone;
}

/**
 * "Só quebra quando 100 % trancado" (user, 21/10): which enemy-grid cells still reach the target (the car; the wall's
 * spot without one), 4-connected on the enemies' flow grid (the blocking pieces shut). A body in a reached cell walks
 * around the barricadas and never bashes them; a body cut off from the target bashes the one it is pressed against.
 * Rebuilt only when the grid's version or the target's cell changed.
 */
export function reachMap(grid:FlowGrid&{readonly version:number}):(e:Point,target:Point)=>boolean{
  const w=grid.width,h=grid.height,cs=grid.cellSize,ox=grid.originX??0,oy=grid.originY??0;
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  let version=-1,from=-2;
  const cellOf=(p:Point)=>{const x=Math.floor((p.x-ox)/cs),y=Math.floor((p.y-oy)/cs);return x<0||y<0||x>=w||y>=h?-1:x+y*w;};
  /** The open cell nearest p within a 5×5 block (a body pressed on a wall has its centre's cell shut), else -1. */
  const openNear=(p:Point,mark?:Uint8Array)=>{
    const x=Math.floor((p.x-ox)/cs),y=Math.floor((p.y-oy)/cs);
    let best=-1,dist=Infinity;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const vx=x+dx,vy=y+dy;
      if(vx<0||vy<0||vx>=w||vy>=h||!grid.walkable(vx,vy))continue;
      if(mark&&!mark[vx+vy*w])continue;
      const d=dx*dx+dy*dy;
      if(d<dist){dist=d;best=vx+vy*w;}
    }
    return best;
  };
  const flood=(target:Point)=>{
    seen.fill(0);
    const start=openNear(target);
    if(start<0)return;
    let head=0,tail=0;
    queue[tail++]=start;seen[start]=1;
    while(head<tail){
      const u=queue[head++],ux=u%w,uy=(u-ux)/w;
      for(const [dx,dy] of STEPS){
        const vx=ux+dx,vy=uy+dy;
        if(vx<0||vy<0||vx>=w||vy>=h)continue;
        const v=vx+vy*w;
        if(seen[v]||!grid.walkable(vx,vy))continue;
        seen[v]=1;queue[tail++]=v;
      }
    }
  };
  return (e,target)=>{
    const t=cellOf(target);
    if(grid.version!==version||t!==from){version=grid.version;from=t;flood(target);}
    return openNear(e,seen)>=0;
  };
}
