/**
 * City barricades (cidade-06): the Stonewards base in the Cidade Nevada is the fountain plaza, closed by a barricade at
 * each of its 4 mouths (asset points.bocas). A standing barricade is a blocker disc on the room's own CityTerrain fork
 * (maps city/terrain.ts setBlocker). It stops ENEMIES only: their movement (moveSafely) and the flow-field grid read the
 * terrain through `enemyTerrain`, which treats the mouth as a wall; heroes and room bots walk through it (so they reach
 * the forge at the fountain and leave the plaza to loot, and the client prediction needs no blockers).
 *
 * - Size: the disc of each mouth is centred on the mouth point and its radius is the smallest r in
 *   [BARRICADE_MIN_R, BARRICADE_MAX_R] (step BARRICADE_R_STEP) that seals it (see `sealRadii`), computed once per asset.
 *   A mouth no such disc seals gets no barricade and is recorded in `state.unsealed`.
 * - Damage (D-017): only the enemy-ai hits a barricade, through hitStructure → the system's `hit` → damageBarricade.
 *   At hp 0 it falls: its blocker goes away and `onTerrainChanged(rect)` tells the flow grid and the planner. A fallen
 *   barricade is never a defeat; only the wall is (system.ts).
 * - Repair: the forge's 'reparo' with a barricade id (forge.ts). A fallen one is rebuilt only when no body overlaps it.
 */
import {RADIUS,walkable,type CellRect,type CityTerrain,type Point,type TerrainField} from '../../maps/index.ts';
import type {SimContext} from '../context.ts';
import type {BarricadeState,StonewardsState} from './state.ts';

export type BarricadeMouth=BarricadeState['mouth'];
export const BARRICADE_MOUTHS:readonly BarricadeMouth[]=Object.freeze(['N','S','L','O'] as BarricadeMouth[]);
export const BARRICADE_MAX_HP=300;
/** Search range of the seal radius (u). */
export const BARRICADE_MIN_R=1,BARRICADE_MAX_R=4,BARRICADE_R_STEP=.25;
/**
 * While sizing one mouth, the other three count as closed by their "mouth line": the cells within this distance of
 * their mouth point, the planner's own base wall (city/avenues.ts mouthHalfWidth default).
 */
export const OTHER_MOUTH_LINE=2.6;
/** Lattice step (u) of the fine seal check: half a walkable sample, finer than any gap a hero fits through. */
const FINE_STEP=.11;
/** The fine check floods this far (u) around the box of the 4 mouths; a point 1 u past that box has left the plaza. */
const FINE_MARGIN=2,FINE_OUTSIDE=1;

export const barricadeId=(mouth:BarricadeMouth)=>`barricada-${mouth}`;

/** The city behind a TerrainField when it can hold blockers and has the plaza's mouths; else undefined. */
export function blockingCity(terrain:TerrainField|undefined):CityTerrain|undefined{
  const t=terrain as Partial<CityTerrain>|undefined;
  return t&&t.world==='cidade'&&t.asset?.points?.bocas&&typeof t.setBlocker==='function'&&typeof t.fork==='function'?t as CityTerrain:undefined;
}

type Radii=Readonly<Record<BarricadeMouth,number|null>>;
const radiiCache=new WeakMap<object,Radii>();

/**
 * Seal radius per mouth (null: none up to BARRICADE_MAX_R), once per asset. A disc of radius r at mouth m seals it when,
 * on a scratch fork holding only that disc (read as the enemies see it: forEnemies) and with the other mouths closed by their mouth lines (OTHER_MOUTH_LINE):
 *  1. the flow grid (one cell per asset cell, walkable = the hero rule at the cell centre, as city/grid.ts) has no
 *     4-connected path from the plaza point's cell to any spawn's cell (8-connected without corner cutting, the flow
 *     field's moves, connects the same cells); and
 *  2. the hero rule on a FINE_STEP lattice has no path from the plaza point to FINE_OUTSIDE past the box of the mouths
 *     (what moveSafely could squeeze through between two cell centres).
 */
export function sealRadii(city:CityTerrain):Radii{
  const known=radiiCache.get(city.asset);
  if(known)return known;
  const scratch=city.fork(),view=scratch.forEnemies();
  for(const b of scratch.blockers())scratch.setBlocker(b.id,undefined);
  const out={} as Record<BarricadeMouth,number|null>;
  for(const m of BARRICADE_MOUTHS){
    out[m]=null;
    const at=city.asset.points.bocas[m];
    for(let i=0;;i++){
      const r=BARRICADE_MIN_R+i*BARRICADE_R_STEP;
      if(r>BARRICADE_MAX_R+1e-9)break;
      scratch.setBlocker('seal',{x:at.x,y:at.y,r});
      if(!cellLeak(view,m)&&!fineLeak(view,m)){out[m]=r;break;}
    }
    scratch.setBlocker('seal',undefined);
  }
  const frozen=Object.freeze(out);
  radiiCache.set(city.asset,frozen);
  return frozen;
}

const others=(city:CityTerrain,m:BarricadeMouth)=>BARRICADE_MOUTHS.filter(o=>o!==m).map(o=>city.asset.points.bocas[o]);
const nearAny=(x:number,y:number,points:readonly Point[],d:number)=>points.some(p=>(p.x-x)**2+(p.y-y)**2<=d*d);
/**
 * Where both floods start: the walkable spot nearest the centroid of the 4 mouths (the planner's plaza centre) off
 * every mouth line, searched on rings of SEED_STEP up to SEED_REACH u. The plaza point itself may sit on a mouth line
 * (the real praca is 2.4 u from mouth S). Undefined when there is none.
 */
const SEED_STEP=.11,SEED_REACH=8;
function plazaSeed(city:CityTerrain):Point|undefined{
  const b=city.asset.points.bocas,mouths=[b.N,b.S,b.L,b.O],c={x:(b.N.x+b.S.x+b.L.x+b.O.x)/4,y:(b.N.y+b.S.y+b.L.y+b.O.y)/4};
  for(let r=0;r<=SEED_REACH;r+=SEED_STEP){
    const n=r?Math.max(8,Math.ceil(2*Math.PI*r/SEED_STEP)):1;
    for(let i=0;i<n;i++){
      const p={x:c.x+Math.cos(i/n*2*Math.PI)*r,y:c.y+Math.sin(i/n*2*Math.PI)*r};
      if(!nearAny(p.x,p.y,mouths,OTHER_MOUTH_LINE)&&walkable(p,city))return p;
    }
  }
  return undefined;
}

function cellLeak(city:CityTerrain,m:BarricadeMouth):boolean{
  const a=city.asset,w=a.cells.w,h=a.cells.h,cs=a.unitsPerCell,closed=others(city,m),probe={x:0,y:0};
  const open=(cx:number,cy:number)=>{
    probe.x=(cx+.5)*cs;probe.y=(cy+.5)*cs;
    return !nearAny(probe.x,probe.y,closed,OTHER_MOUTH_LINE)&&walkable(probe,city);
  };
  const cellOf=(p:Point)=>{const cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs);return cx>=0&&cy>=0&&cx<w&&cy<h?cx+cy*w:-1;};
  const from=plazaSeed(city),c=from?cellOf(from):-1;
  const seed=c<0?-1:nearOpen(c%w,(c-c%w)/w,w,h,open);
  if(seed<0)return true; // no plaza to seal: never "sealed"
  const spawns=new Set([a.points.spawnN,a.points.spawnS,a.points.spawnL,a.points.spawnO].map(cellOf));
  const seen=new Uint8Array(w*h),queue=[seed];seen[seed]=1;
  while(queue.length){
    const u=queue.pop()!,ux=u%w,uy=(u-ux)/w;
    if(spawns.has(u))return true;
    for(const [dx,dy] of STEPS){
      const vx=ux+dx,vy=uy+dy,v=vx+vy*w;
      if(vx<0||vy<0||vx>=w||vy>=h||seen[v])continue;
      seen[v]=1;
      if(open(vx,vy))queue.push(v);
    }
  }
  return false;
}
const STEPS=[[1,0],[-1,0],[0,1],[0,-1]] as const;
/** Index of the first open node in the 5×5 block around (x,y) (rows then columns), else -1. */
function nearOpen(x:number,y:number,w:number,h:number,open:(x:number,y:number)=>boolean){
  for(let dy=0;dy<=2;dy++)for(const sy of dy?[-1,1]:[1])for(let dx=0;dx<=2;dx++)for(const sx of dx?[-1,1]:[1]){
    const vx=x+dx*sx,vy=y+dy*sy;
    if(vx>=0&&vy>=0&&vx<w&&vy<h&&open(vx,vy))return vx+vy*w;
  }
  return -1;
}

function fineLeak(city:CityTerrain,m:BarricadeMouth):boolean{
  const b=city.asset.points.bocas,closed=others(city,m);
  const bx0=Math.min(b.N.x,b.S.x,b.L.x,b.O.x),bx1=Math.max(b.N.x,b.S.x,b.L.x,b.O.x);
  const by0=Math.min(b.N.y,b.S.y,b.L.y,b.O.y),by1=Math.max(b.N.y,b.S.y,b.L.y,b.O.y);
  const x0=bx0-FINE_MARGIN,y0=by0-FINE_MARGIN;
  const nw=Math.ceil((bx1-bx0+2*FINE_MARGIN)/FINE_STEP)+1,nh=Math.ceil((by1-by0+2*FINE_MARGIN)/FINE_STEP)+1;
  const probe={x:0,y:0};
  const open=(ix:number,iy:number)=>{
    probe.x=x0+ix*FINE_STEP;probe.y=y0+iy*FINE_STEP;
    return !nearAny(probe.x,probe.y,closed,OTHER_MOUTH_LINE)&&walkable(probe,city);
  };
  const p=plazaSeed(city);
  if(!p)return true;
  const start=nearOpen(Math.round((p.x-x0)/FINE_STEP),Math.round((p.y-y0)/FINE_STEP),nw,nh,open);
  if(start<0)return true;
  const seen=new Uint8Array(nw*nh),queue=[start];seen[start]=1;
  while(queue.length){
    const u=queue.pop()!,ux=u%nw,uy=(u-ux)/nw;
    const x=x0+ux*FINE_STEP,y=y0+uy*FINE_STEP;
    if(x<bx0-FINE_OUTSIDE||x>bx1+FINE_OUTSIDE||y<by0-FINE_OUTSIDE||y>by1+FINE_OUTSIDE)return true;
    for(const [dx,dy] of STEPS){
      const vx=ux+dx,vy=uy+dy,v=vx+vy*nw;
      if(vx<0||vy<0||vx>=nw||vy>=nh||seen[v])continue;
      seen[v]=1;
      if(open(vx,vy))queue.push(v);
    }
  }
  return false;
}

/** The city's barricades at full hp (one per sealed mouth) and the mouths left open; undefined off the city. */
export function createBarricades(terrain:TerrainField|undefined,maxHp=BARRICADE_MAX_HP):{barricades:BarricadeState[];unsealed:BarricadeMouth[]}|undefined{
  const city=blockingCity(terrain);
  if(!city)return undefined;
  const radii=sealRadii(city),barricades:BarricadeState[]=[],unsealed:BarricadeMouth[]=[];
  for(const mouth of BARRICADE_MOUTHS){
    const r=radii[mouth],at=city.asset.points.bocas[mouth];
    if(r===null)unsealed.push(mouth);
    else barricades.push({id:barricadeId(mouth),mouth,x:at.x,y:at.y,hp:maxHp,maxHp,r,down:false});
  }
  return {barricades,unsealed};
}

/**
 * Cells (flow grid: asset.unitsPerCell, origin 0, inclusive) whose walkability a barricade decides: every cell whose
 * centre a hero disc there would overlap the barricade disc, plus one cell around.
 */
export function barricadeCells(city:CityTerrain,b:Pick<BarricadeState,'x'|'y'|'r'>):CellRect{
  const cs=city.asset.unitsPerCell,reach=b.r+RADIUS;
  return {x0:Math.floor((b.x-reach)/cs)-1,y0:Math.floor((b.y-reach)/cs)-1,x1:Math.floor((b.x+reach)/cs)+1,y1:Math.floor((b.y+reach)/cs)+1};
}

/**
 * Makes the terrain's barricade blockers match the state (standing → disc, fallen → none) and returns the cell rects
 * of those that changed. Used when a system is created (a new run or a checkpoint restore) and on a rematch reset.
 */
export function syncBarricades(terrain:TerrainField|undefined,state:StonewardsState):CellRect[]{
  const city=blockingCity(terrain),changed:CellRect[]=[];
  if(!city)return changed;
  for(const b of state.barricades??[]){
    const before=city.blockerVersion;
    city.setBlocker(b.id,b.down?undefined:{x:b.x,y:b.y,r:b.r});
    if(city.blockerVersion!==before)changed.push(barricadeCells(city,b));
  }
  return changed;
}

export function findBarricade(state:StonewardsState,id:string):BarricadeState|undefined{
  return state.barricades?.find(b=>b.id===id);
}

/**
 * Hits a standing barricade (D-017: the enemy-ai through hitStructure). Returns true when this hit brought it down: the
 * blocker goes away and `onTerrainChanged` gets the cells it freed. Never a defeat.
 */
export function damageBarricade(ctx:SimContext,state:StonewardsState,id:string,amount:number,onTerrainChanged?:(rect:CellRect)=>void):boolean{
  const b=findBarricade(state,id);
  if(!b||b.down||state.wallDown||!(amount>0))return false;
  b.hp=Math.max(0,b.hp-amount);
  ctx.emit({type:'structure',id:b.id,hp:b.hp,maxHp:b.maxHp});
  if(b.hp>0)return false;
  b.down=true;
  setBlocking(ctx.terrain,b,onTerrainChanged);
  return true;
}

/**
 * True when a live enemy body overlaps the barricade's disc: rebuilding then would trap it inside. Heroes do not count,
 * because barricades only block enemies (they walk through their own barricades).
 */
export function barricadeOccupied(ctx:SimContext,b:Pick<BarricadeState,'x'|'y'|'r'>):boolean{
  for(const e of ctx.enemies.values())if(e.hp>0&&Math.hypot(e.x-b.x,e.y-b.y)<b.r+e.radius)return true;
  return false;
}

/** Raises (standing) or removes (fallen) the barricade's blocker on the terrain and reports the cells if it changed. */
export function setBlocking(terrain:TerrainField|undefined,b:BarricadeState,onTerrainChanged?:(rect:CellRect)=>void){
  const city=blockingCity(terrain);
  if(!city)return;
  const before=city.blockerVersion;
  city.setBlocker(b.id,b.down?undefined:{x:b.x,y:b.y,r:b.r});
  if(city.blockerVersion!==before)onTerrainChanged?.(barricadeCells(city,b));
}
