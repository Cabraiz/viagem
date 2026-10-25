/**
 * City HUD wiring (card cidade-04, design/cidade-hud.md §7): the pure glue between the run (terrain, RunView, the spawn
 * warnings, the scene's camera) and the city's arrows. The CityMapInfo of the decoded asset, which avenue mouths a round
 * opened (inferred from the spawn warnings), the world corners of what the screen shows (the WC3 minimap's camera
 * rectangle) and the horn's seconds. No DOM: rescue.ts and the HUD sandbox call these.
 */
import {CITY_DISTANCE_SCALE,SIM_HZ} from './deps.ts';
import type {CityMapInfo,MouthId} from './map-info.ts';

interface P {readonly x:number;readonly y:number}
/** The part of the decoded city asset (src/maps/city-asset.ts CityAsset) the HUD reads. */
export interface CityAssetLike {
  readonly size:{readonly w:number;readonly h:number};
  readonly points:{readonly praca:P;readonly inicio:P;readonly spawnN:P;readonly spawnS:P;readonly spawnL:P;readonly spawnO:P;
    /** The plaza's 4 entrances (barricade spots). */
    readonly bocas:{readonly N:P;readonly S:P;readonly L:P;readonly O:P}};
}
/** The city asset of a terrain, when the terrain is the city (CityTerrain carries it as `asset`). */
export function cityAssetOf(terrain:{world?:string}):CityAssetLike|undefined{
  if(terrain.world!=='cidade'||!('asset' in terrain))return undefined;
  const asset=(terrain as {asset?:CityAssetLike}).asset;
  return asset&&asset.points&&asset.size?asset:undefined;
}

export const MOUTH_IDS:readonly MouthId[]=['N','S','L','O'];
/**
 * The city's map info from the asset: the plaza at `praca` with the radius of its farthest entrance (the wall's ring),
 * the 4 avenue ends (spawnN/S/L/O) as its mouths (where the critters come in, doc §1), each with its entrance
 * on the plaza wall (`bocas`) as its gate, the start at `inicio`.
 */
export function cityMapInfo(asset:CityAssetLike):CityMapInfo{
  const p=asset.points,plaza=p.praca;
  const radius=Math.max(...MOUTH_IDS.map(id=>Math.hypot(p.bocas[id].x-plaza.x,p.bocas[id].y-plaza.y)));
  const end:Record<MouthId,P>={N:p.spawnN,S:p.spawnS,L:p.spawnL,O:p.spawnO};
  return {size:Math.max(asset.size.w,asset.size.h),plaza:{x:plaza.x,y:plaza.y,radius},
    mouths:MOUTH_IDS.map(id=>({id,x:end[id].x,y:end[id].y,gate:{x:p.bocas[id].x,y:p.bocas[id].y}})),start:{x:p.inicio.x,y:p.inicio.y}};
}

/**
 * A spawn warning this close (world units) to an avenue (its gate → its end) comes in through that avenue's mouth. A map
 * length: 10 u on the .w3x map × CITY_DISTANCE_SCALE (CITY_MAP_SCALE ÷ CITY_COMPACT, mapa-175-com-viaduto) (NEW-20261013-ORQ-cidade-escala-1-7).
 */
export const AVENUE_MATCH=10*CITY_DISTANCE_SCALE;
/**
 * A warning this close (world units) to a mouth's gate is at the plaza's entrance, not on the avenue: the planner's mouth
 * line radius (src/sim/city/avenues.ts mouthHalfWidth, 2.6 u × CITY_DISTANCE_SCALE = 2.53 u), whose groups stand past it; a
 * boss minion summoned 2.5 u from a boss at the gate is not a mouth.
 */
export const GATE_RADIUS=2.6*CITY_DISTANCE_SCALE;
/** Doc §3: a mouth stays active until 3 s after its critters come out (`atTick`). */
export const MOUTH_TAIL_TICKS=3*SIM_HZ;
const toSegment=(p:P,a:P,b:P)=>{
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,t=len>0?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
/**
 * The avenue a spawn warning stands on: the nearest avenue within AVENUE_MATCH whose side of the plaza wall it is on.
 * Each mouth is judged by its own entrance (gate): the point must lie past the gate, away from the plaza (on the far
 * side of the line through the gate square to the avenue) and more than GATE_RADIUS from it; its distance is to the
 * segment gate → avenue end. The plaza is not a circle: the south gate is 2.4 u from `praca` while the east and west
 * ones are 12 u away, so one radius for all dropped the south avenue's nearest spawns (cidade-04 review). The boss lands
 * inside the plaza (D-026) and its minions around it: no mouth. A mouth without a gate (DEFAULT_CITY) falls back to the
 * segment end → plaza centre outside `plaza.radius`. Undefined: not an avenue spawn.
 */
export function mouthOfWarning(p:P,map:CityMapInfo):MouthId|undefined{
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return undefined;
  const inPlaza=Math.hypot(p.x-map.plaza.x,p.y-map.plaza.y)<=map.plaza.radius;
  let best:MouthId|undefined,bestD=AVENUE_MATCH;
  for(const m of map.mouths){
    let d:number;
    if(m.gate){
      const g=m.gate,ax=m.x-g.x,ay=m.y-g.y,rx=p.x-g.x,ry=p.y-g.y;
      if(rx*ax+ry*ay<=0||Math.hypot(rx,ry)<=GATE_RADIUS)continue;
      d=toSegment(p,g,m);
    }else{
      if(inPlaza)continue;
      d=toSegment(p,m,map.plaza);
    }
    if(d<=bestD){bestD=d;best=m.id;}
  }
  return best;
}
/**
 * Active mouths (doc §3): every spawn warning in `events` lights the mouth of its avenue until MOUTH_TAIL_TICKS after
 * its critters come out; `state` (mouth → last tick it stays lit) is updated in place and the mouths still lit at `tick`
 * are returned in N, S, L, O order. Feed it each view's events; clear `state` between rounds.
 */
export function trackMouths(state:Map<MouthId,number>,events:readonly {type:string;x?:number;y?:number;atTick?:number}[],tick:number,map:CityMapInfo):MouthId[]{
  for(const e of events){
    if(e.type!=='spawn-warning'||!Number.isFinite(e.atTick))continue;
    const id=mouthOfWarning({x:e.x??NaN,y:e.y??NaN},map);
    if(id)state.set(id,Math.max(state.get(id)??-Infinity,e.atTick!+MOUTH_TAIL_TICKS));
  }
  for(const [id,until] of state)if(until<tick)state.delete(id);
  return MOUTH_IDS.filter(id=>state.has(id));
}

/**
 * The world corners of the viewport (the WC3 minimap's camera rectangle), from the scene's world → screen map:
 * that map is affine on flat ground, so three points give it and its inverse takes the 4 corners back (top-left,
 * top-right, bottom-right, bottom-left). Empty when the map is degenerate.
 */
export function screenCorners(locate:(p:{x:number;y:number})=>{x:number;y:number},focus:{x:number;y:number},viewport:{width:number;height:number}):{x:number;y:number}[]{
  const step=8,o=locate(focus),ax=locate({x:focus.x+step,y:focus.y}),ay=locate({x:focus.x,y:focus.y+step});
  const a=(ax.x-o.x)/step,c=(ax.y-o.y)/step,b=(ay.x-o.x)/step,d=(ay.y-o.y)/step,det=a*d-b*c;
  if(!Number.isFinite(det)||Math.abs(det)<1e-9)return [];
  const back=(s:{x:number;y:number})=>{const dx=s.x-o.x,dy=s.y-o.y;return {x:focus.x+(d*dx-b*dy)/det,y:focus.y+(a*dy-c*dx)/det};};
  const {width:w,height:h}=viewport;
  return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}].map(back);
}

/** Seconds left to get back to the base after the horn (doc §3: the base's arrow shows "5 s"); only in the intermission. */
export function hornSeconds(camp:{hornEndsTick?:number}|undefined,tick:number,phase:'wave'|'prepare'):number|undefined{
  if(phase!=='prepare'||camp?.hornEndsTick===undefined)return undefined;
  return Math.max(0,Math.ceil((camp.hornEndsTick-tick)/SIM_HZ));
}
