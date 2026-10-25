/**
 * NEW-20261023-ORQ-barracas-no-caminho, etapa 4: the room bots and the map's barracas (manual combat, the car on the map).
 * Pure over the bot's view; bot-brain.ts decide() calls it after the vehicles and before the loot.
 *  - Holding a kit:barraca, in a lull (no critter within LOOT_SAFE, nobody down): walk to this bot's drop point near the
 *    car and set it there ({t:'kit',slot}: the room places it on the nearest cell that takes it, inventory placeNear).
 *    The drop point is on the streets a critter takes to the car (free-build wayCells from a source: the living nests
 *    nearest the car, else the spawns; the bot's index picks which), the first cell BARRACA_DROP_RING u or more from
 *    the car's centre: just past UNO_BUILD_CELLS, in the critters' way. Kept in BrainMemory.barracaDrop while the car
 *    stays within BARRACA_DROP_MOVED of where it was.
 *  - Hands free, in a lull, fewer than BARRACA_HOME_MAX barracas within BARRACA_HOME u of the car: the nearest barraca
 *    out of that circle within `radius` that this bot is the nearest free bot to (ties by id); stand within
 *    BARRACA_STAND u of its centre and start the coleta ({t:'coletar',piece}), again only once the last one would have
 *    ended (BrainMemory.coletaUntil). A hit cancels it in the sim (the lull rule keeps the bot off it then).
 */
import type {PlayerRunView,RunView,StructureView} from '../contract/index.ts';
import {CAR_ID} from '../contract/index.ts';
import {COLETAR_SECONDS,kitId} from '../rules/index.ts';
import type {Point,TerrainField} from '../maps/index.ts';
import {cityTerrainOf} from './city/grid.ts';
import {wayCells} from './towers/free-build.ts';
import {LOOT_SAFE} from './bot-loot.ts';

/** u from the car's centre: the drop ring (UNO_BUILD_CELLS keep-out plus the barraca's half and a margin), the circle
 * whose barracas count as the Uno's own (none collected from it), how many of them are enough, and when the car moved. */
export const BARRACA_DROP_RING=5.6,BARRACA_HOME=9,BARRACA_HOME_MAX=8,BARRACA_DROP_MOVED=2;
/** u from the drop point the bot sets the kit within, and from a barraca's centre it collects from (TRALHA_REACH is 3 u from the edge). */
export const BARRACA_DROP_STAND=1.2,BARRACA_STAND=2.2;
/**
 * u a barraca is worth the walk from in a lull (planBarraca's `radius` there): the rows lie .35–.7 of the way from a nest to
 * the car, 30–65 u on the compact map (mapa-175-com-viaduto), past the loot's LOOT_RADIUS_CALM (23 u); at heroSpeed (~4 u/s)
 * the trip there and back by the streets fits a 60 s lull (bot-brain CALM_WINDOW_S).
 */
export const BARRACA_REACH_CALM=70;
/**
 * The haul is one bot's job, in a team of BARRACA_TEAM or more living heroes: the last of `teamBots` (the bench at 0/3/6
 * rows, 25/10: with every free bot hauling, the 1p and 3p teams worked the bicos for 31 % / 23 % of their Grana with no
 * rows, 9 % / 10 % with 3, 0 % / 3 % with 6). A kit:barraca already in hand is set by whoever holds it.
 */
export const BARRACA_TEAM=3;
/** How many sources (nearest living nests) the bots' drop points spread over. */
const DROP_SOURCES=3;
const HZ=20;

export type BarracaCommand={t:'kit';slot:number}|{t:'coletar';piece:string};
/** `goal.reach`: the bot stands still within this of `goal.at` (BARRACA_DROP_STAND at the drop, BARRACA_STAND at a barraca). */
export interface BarracaPlan {command?:BarracaCommand;goal:{at:Point;reach:number;id:string};mode:'barraca'}
/** What the plan keeps between decisions (BrainMemory, JSON). */
export interface BarracaMemory {barracaDrop?:{x:number;y:number;carX:number;carY:number};coletaUntil?:number}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const at=(p:PlayerRunView):Point|undefined=>{const q=p as PlayerRunView&Partial<Point>;return Number.isFinite(q.x)&&Number.isFinite(q.y)?{x:q.x!,y:q.y!}:undefined;};
const KIT=kitId('barraca'),TRALHA_KITS=new Set([kitId('barricada'),KIT]);
const living=(s:StructureView)=>s.kind==='barraca'&&s.hp>0;

/** Whether a bot (or anyone) is in a lull for the barracas: no critter within LOOT_SAFE, nobody down. */
function lull(view:Pick<RunView,'players'|'enemies'>,me:PlayerRunView,from:Point){
  if(view.enemies.some(e=>e.hp>0&&dist(e,from)<LOOT_SAFE))return false;
  return !view.players.some(p=>p.id!==me.id&&p.downed&&!p.eliminated);
}

/** This bot's drop point near the car: on the critters' way from its source, BARRACA_DROP_RING u out (see the header). */
export function barracaDrop(view:Pick<RunView,'structures'>,car:Point,index:number,terrain:TerrainField|undefined):Point{
  const nests=view.structures.filter(s=>s.kind==='ninho'&&s.phase!=='destruido').sort((a,b)=>dist(a,car)-dist(b,car)||(a.id<b.id?-1:1)).slice(0,DROP_SOURCES);
  const city=cityTerrainOf(terrain),P=city?.asset.points;
  const sources:Point[]=nests.length?nests:P?[P.spawnN,P.spawnS,P.spawnL,P.spawnO]:[];
  const source=sources[index%Math.max(1,sources.length)];
  // Off the streets (no city, no source): straight out toward the source, or east.
  const straight=()=>{const d=source?dist(source,car):0,u=d>1e-6?{x:(source!.x-car.x)/d,y:(source!.y-car.y)/d}:{x:1,y:0};
    return {x:car.x+u.x*BARRACA_DROP_RING,y:car.y+u.y*BARRACA_DROP_RING};};
  if(!city||!source)return straight();
  // wayCells runs source → car; from the car's end, the first cell at the ring.
  const way=wayCells(city,source,car);
  for(let i=way.length-1;i>=0;i--)if(dist(way[i],car)>=BARRACA_DROP_RING)return way[i];
  return straight();
}

/**
 * The bot's barraca plan this decision, or undefined (nothing to do with barracas: the loot and the rest go on).
 * `teamBots`: the room's bots (who else may go for a barraca); `radius`: how far a barraca is worth the walk.
 */
export function planBarraca(view:Pick<RunView,'tick'|'players'|'enemies'|'structures'>,me:PlayerRunView,from:Point,index:number,
  memory:BarracaMemory,terrain:TerrainField|undefined,teamBots:readonly string[]|undefined,radius:number):BarracaPlan|undefined{
  const car=view.structures.find(s=>s.kind===CAR_ID);
  if(!car||!lull(view,me,from))return undefined;
  const inv=me.weapons,slot=inv.findIndex(i=>i.id===KIT);
  if(slot>=0){
    let drop=memory.barracaDrop;
    if(!drop||Math.hypot(drop.carX-car.x,drop.carY-car.y)>BARRACA_DROP_MOVED){
      const p=barracaDrop(view,car,index,terrain);
      drop=memory.barracaDrop={x:p.x,y:p.y,carX:car.x,carY:car.y};
    }
    const there={x:drop.x,y:drop.y};
    return {mode:'barraca',goal:{at:there,reach:BARRACA_DROP_STAND,id:'barraca-drop'},...(dist(from,there)<=BARRACA_DROP_STAND?{command:{t:'kit',slot}}:{})};
  }
  delete memory.barracaDrop;
  const team=view.players.filter(p=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0).length;
  if(team<BARRACA_TEAM||!teamBots?.length||teamBots[teamBots.length-1]!==me.id)return undefined;
  // The hands hold one tralha kit at most (CARREGA_MAX): a kit:barricada goes first (bot-loot places it).
  if(inv.some(i=>TRALHA_KITS.has(i.id)))return undefined;
  const barracas=view.structures.filter(living);
  if(barracas.filter(b=>dist(b,car)<=BARRACA_HOME).length>=BARRACA_HOME_MAX)return undefined;
  // The other free bots: a barraca goes to the nearest of them (ties by id).
  const others:{id:string;at:Point}[]=[];
  for(const p of view.players){
    if(p.id===me.id||!teamBots?.includes(p.id)||!p.online||p.spectator||p.downed||p.eliminated||p.hp<=0)continue;
    if(p.weapons.some(i=>TRALHA_KITS.has(i.id)))continue;
    const q=at(p);if(q)others.push({id:p.id,at:q});
  }
  let best:StructureView|undefined,bestD=radius;
  for(const b of barracas){
    const d=dist(b,from);
    if(d>=bestD||dist(b,car)<=BARRACA_HOME)continue;
    if(others.some(o=>{const e=dist(b,o.at);return e<d||e===d&&o.id<me.id;}))continue;
    best=b;bestD=d;
  }
  if(!best)return undefined;
  const plan:BarracaPlan={mode:'barraca',goal:{at:{x:best.x,y:best.y},reach:BARRACA_STAND,id:best.id}};
  if(bestD<=BARRACA_STAND&&view.tick>=(memory.coletaUntil??-Infinity)){
    plan.command={t:'coletar',piece:best.id};
    memory.coletaUntil=view.tick+Math.ceil(COLETAR_SECONDS*HZ)+HZ/2;
  }
  return plan;
}
