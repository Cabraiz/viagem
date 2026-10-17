/**
 * D-052 slice 5b (card NEW-20261016-ORQ-carro-e-fortificacao-livre, bots-obra): where the room bots build in the free
 * build, around the car wherever it is now. The bot brain's tower rule (bot-brain.ts pickTowerOrder) reads build
 * "sites"; with the car on the map those are these spots instead of the map's fixed obras (which the free build keeps
 * only as hints), and the bots' free-built defenses are sites of their own (`d:<defense id>`, their room to grow).
 *
 * - A spot is a root's cell (the 1×1 Vigia) `c:<c>,<r>` (botSpotOrder turns it into the FreeOrder), between
 *   BOT_SPOT_GAP u off the car's body and BOT_SPOT_REACH u from its centre, on free ground the free build takes: on the
 *   grid's walkable cells, CAR_BUILD_GAP off the body, CAR_NEST_KEEP_OUT off a living nest, over no standing defense,
 *   piece or forge tower. The transient things (heroes, critters, the moto) are the sim's to refuse ('ocupado').
 * - maxSize: the largest tier square that also fits there, grown the way the sim grows it (towers/system.ts
 *   grownCell: 2×2 from (c−1, r−1), 3×3 from (c−2, r−2)).
 * - Pick: the larger room first, then nearest to BOT_SPOT_RING u from the car, ties by row then column; at most
 *   BOT_SPOTS, each BOT_SPOT_SPREAD u from the others and from the standing defenses (a 3×3 apart). Deterministic.
 */
import {CAR_NEST_KEEP_OUT,type Point} from '../../contract/index.ts';
import {rectDistance,type CityTerrain,type Rect} from '../../maps/index.ts';
import {CAR_BUILD_GAP,DEFENSES,ROOT_DEFENSE} from '../../rules/index.ts';
import type {StonewardsState} from '../stonewards/state.ts';
import {FREE_CELL,defenseRectOf,discHits,onGround,pieceRect,pieceRectOf,piecesOf,rectsOverlap,type FreeOrder} from './free-build.ts';

/** Spots around the car: how many, how far (u from the body / from the centre), the ring they prefer, how far apart. */
export const BOT_SPOTS=6,BOT_SPOT_GAP=CAR_BUILD_GAP+.5,BOT_SPOT_REACH=8,BOT_SPOT_RING=4.5,BOT_SPOT_SPREAD=2.7;
/** The forge towers' disc (towers/system.ts FORGE_TOWER_R). */
const FORGE_TOWER_R=.6;

export interface BotSite {id:string;maxSize:number;x:number;y:number}
/** The sim's car (centre and body radius) and the living nests. */
export interface BotSpotWorld {car:{x:number;y:number;radius:number};nests:readonly Point[]}

/** The square a 1×1 root at `cell` takes at `size` (towers/system.ts grownCell from the root up). */
const grown=(cell:{c:number;r:number},size:number)=>{const shift=size===1?0:size===2?-1:-2;return {c:cell.c+shift,r:cell.r+shift};};

/** Free ground for a square; `skip` (a defense growing: the sim checks only the ground and the defenses and pieces then). */
function freeRect(city:CityTerrain,state:StonewardsState,world:BotSpotWorld,cell:{c:number;r:number},size:number,skip?:string):boolean{
  if(!onGround(city,cell,size,size))return false;
  const rect:Rect=pieceRect(cell,size,size);
  if(skip!==undefined){
    for(const d of state.defenses?.list??[])if(d.id!==skip&&!d.ruined&&rectsOverlap(defenseRectOf(d),rect))return false;
    for(const p of piecesOf(state))if(rectsOverlap(pieceRectOf(p),rect))return false;
    return true;
  }
  if(rectDistance(rect,world.car)<world.car.radius+CAR_BUILD_GAP)return false;
  for(const n of world.nests)if(rectDistance(rect,n)<CAR_NEST_KEEP_OUT)return false;
  for(const d of state.defenses?.list??[])if(!d.ruined&&rectsOverlap(defenseRectOf(d),rect))return false;
  for(const p of piecesOf(state))if(rectsOverlap(pieceRectOf(p),rect))return false;
  for(const t of state.towers)if(discHits(rect,t.x,t.y,FORGE_TOWER_R))return false;
  return true;
}
/** The largest tier (1..3) a root at `cell` grows to there (0: not even the root). */
function roomAt(city:CityTerrain,state:StonewardsState,world:BotSpotWorld,cell:{c:number;r:number}):number{
  let size=0;
  for(let s=1;s<=3;s++){if(!freeRect(city,state,world,grown(cell,s),s))break;size=s;}
  return size;
}
const centre=(cell:{c:number;r:number}):Point=>({x:(cell.c+.5)*FREE_CELL,y:(cell.r+.5)*FREE_CELL});

/**
 * The bots' build sites around the car: their own free-built defenses (`d:<id>`, maxSize the room they have to grow,
 * at least their size), then the new spots (`c:<c>,<r>`).
 */
export function botSites(city:CityTerrain,state:StonewardsState,world:BotSpotWorld):BotSite[]{
  const out:BotSite[]=[],live=(state.defenses?.list??[]).filter(d=>!d.ruined);
  for(const d of live){
    if(!d.cell)continue;
    const size:number=DEFENSES[d.kind].size??1;
    // Back to the root's cell from its square (the inverse of grown), then the room from its size up.
    const root={c:d.cell.c-(size===1?0:size===2?-1:-2),r:d.cell.r-(size===1?0:size===2?-1:-2)};
    let room:number=size;
    for(let s=size+1;s<=3&&freeRect(city,state,world,grown(root,s),s,d.id);s++)room=s;
    out.push({id:`d:${d.id}`,maxSize:room,x:d.x,y:d.y});
  }
  const car=world.car,span=Math.ceil(BOT_SPOT_REACH/FREE_CELL);
  const c0=Math.floor(car.x/FREE_CELL),r0=Math.floor(car.y/FREE_CELL);
  const found:{cell:{c:number;r:number};at:Point;size:number;score:number}[]=[];
  for(let r=r0-span;r<=r0+span;r++)for(let c=c0-span;c<=c0+span;c++){
    const cell={c,r},at=centre(cell),d=Math.hypot(at.x-car.x,at.y-car.y);
    if(d>BOT_SPOT_REACH||d-car.radius<BOT_SPOT_GAP)continue;
    const size=roomAt(city,state,world,cell);
    if(size)found.push({cell,at,size,score:Math.abs(d-BOT_SPOT_RING)});
  }
  found.sort((a,b)=>b.size-a.size||a.score-b.score||a.cell.r-b.cell.r||a.cell.c-b.cell.c);
  const taken:Point[]=live.map(d=>({x:d.x,y:d.y}));
  for(const f of found){
    if(out.length-live.filter(d=>d.cell).length>=BOT_SPOTS)break;
    if(taken.some(p=>Math.hypot(p.x-f.at.x,p.y-f.at.y)<BOT_SPOT_SPREAD))continue;
    taken.push(f.at);out.push({id:`c:${f.cell.c},${f.cell.r}`,maxSize:f.size,x:f.at.x,y:f.at.y});
  }
  return out;
}

/** A spot's build order: the root on its cell (FreeOrder); undefined for any other site id (a fixed obra, the rail). */
export function botSpotOrder(site:string):FreeOrder|undefined{
  const m=/^c:(\d+),(\d+)$/.exec(site);
  return m?{piece:ROOT_DEFENSE,c:Number(m[1]),r:Number(m[2])}:undefined;
}
/** The defense a `d:<id>` site stands for (the bots' own free-built defense), else undefined. */
export const botSiteDefense=(site:string)=>site.startsWith('d:')?site.slice(2):undefined;

/**
 * The tower view with the car's sites (botSites) in place of the map's obras: the bots' free-built defenses (on
 * `cells`) stand on their own `d:<id>` site, so the tower rule's taken/size/branch-by-index read them like before.
 */
export function withBotSites<V extends {sites:readonly {id:string;maxSize:number;x?:number;y?:number}[];defenses:readonly {id:string;site:string}[]}>(view:V,sites:readonly BotSite[]):V{
  const own=new Set(sites.map(s=>botSiteDefense(s.id)).filter((id):id is string=>!!id));
  return {...view,sites,defenses:view.defenses.map(d=>own.has(d.id)?{...d,site:`d:${d.id}`}:d)};
}
