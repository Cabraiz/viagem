/**
 * Edge arrows in the city (doc §3, B12): the island's layoutEdges on the useful area's inner rim, with the city's
 * targets and caps. Priority caído > chefe > grupo > boca > base; at most MAX_ARROWS, 2 grupo, 2 boca. A standing ally
 * and a chest never get an arrow here (team column and minimap). A group is kind 'grupo' (edges.ts, doc §7) with key
 * 'grupo:<cell>', its critters in `groupCount` and their text in `label` (the ficha's body; the distance rides the tag);
 * an active mouth is 'spawn' with key 'boca:<id>'. Pure.
 */
import {layoutEdges,pointedTargets,railName,arrowHalf,crosses,bottom,right,MUST_POINT,MAX_ARROWS,MERGE_PX,MIN_PLAY_SIDE,type EdgeTarget,type EdgeArrow,type EdgeKind,type EdgeOptions,type Rect} from './deps.ts';
import {clusterEnemies,pickGroupArrows,groupCountText,type EnemyPoint} from './clusters.ts';
import type {CityMapInfo,MouthId} from './map-info.ts';
import {motoNeedsTeam,BANK_SHORT,type MotoMode,type BankName,type BankState} from './deps.ts';

export interface CityEdgeInput {
  /** The followed hero (world units). */
  hero:{x:number;y:number};
  selfId:string;
  players:readonly CityPerson[];
  enemies:readonly EnemyPoint[];
  activeMouths?:readonly MouthId[];
  map:CityMapInfo;
  phase:'wave'|'prepare';
  /** The wall took a hit in the last WALL_HIT_MS: the base gets its arrow in a wave too. */
  wallHitRecently?:boolean;
  /** After the horn: seconds left to get back (the base's arrow turns Cone with "5 s"). */
  hornSeconds?:number;
  /** World → screen (CSS px, viewport). */
  locate:(p:{x:number;y:number})=>{x:number;y:number};
  /** Whether a world point is in plain view on screen. */
  isOnScreen:(p:{x:number;y:number})=>boolean;
  /** The group keys that had an arrow last time (hysteresis). */
  previousGroups?:ReadonlySet<string>;
  /** D-047: the chaveiro's moto while the objective runs (undefined once it ended or at the car). */
  moto?:{x:number;y:number;mode:MotoMode};
  /** Bancos (card bancos-e-veiculos): the run's ATMs (ObjectiveView.banks). */
  banks?:readonly CityBank[];
}
/** A bank as the city's arrows and minimap read it. */
export interface CityBank {id:string;x:number;y:number;name:BankName;state:BankState;saldo:number}
/** Someone of the team as the city's arrows and minimap read them (world units; a caído with its clock and ping). */
export interface CityPerson {id:string;x:number;y:number;downed?:boolean;name?:string;portrait?:string;seconds?:number;ping?:boolean}
/** Doc §3: the base's arrow shows in a wave only this long after the wall was hit. */
export const WALL_HIT_MS=3000;
/** A group this close to the hero, or this close to the wall, turns its ficha Cone (world units). */
export const GROUP_DANGER_HERO=8,GROUP_DANGER_WALL=12;
/** A group this close to an active mouth takes the mouth's arrow (never two arrows for one spot). */
export const MOUTH_GROUP_MERGE=10;
/** At most this many active-mouth arrows. */
export const MOUTH_ARROWS=2;

const isGroup=(t:EdgeTarget)=>t.kind==='grupo'||t.key.startsWith('grupo:'),isMouth=(t:EdgeTarget)=>t.key.startsWith('boca:');
/**
 * Doc §3 priority: caído 0 > chefe 1 > grupo 2 > boca 3 > the chaveiro's moto 3.5 (D-047) > a bank 3.8 (bancos) >
 * base 4; anything else never gets an arrow in the city (9).
 */
export function cityEdgeRank(t:EdgeTarget):number{
  return t.kind==='caido'?0:t.kind==='chefe'?1:isGroup(t)?2:isMouth(t)?3:t.kind==='moto'?3.5:t.kind==='banco'?3.8:t.kind==='base'?4:9;
}
/**
 * The bank that gets an arrow (one at most, out of view): the one a critter robs (Cone: "corre lá"), else the nearest
 * with notes in it; an empty one ("SEM CÉDULAS") never.
 */
export function bankForArrow(banks:readonly CityBank[]|undefined,hero:{x:number;y:number},isOnScreen:(p:{x:number;y:number})=>boolean):CityBank|undefined{
  const out=(banks??[]).filter(b=>b.state!=='sem-cedulas'&&b.saldo>0&&!isOnScreen(b));
  const d=(b:CityBank)=>Math.hypot(b.x-hero.x,b.y-hero.y);
  return out.filter(b=>b.state==='bicho').sort((a,b)=>d(a)-d(b))[0]??out.sort((a,b)=>d(a)-d(b))[0];
}
export {motoNeedsTeam};

/** The city's targets for the arrows, and the group keys picked (feed them back as `previousGroups`). */
export function cityEdgeTargets(input:CityEdgeInput):{targets:CityEdgeTarget[];groupKeys:Set<string>}{
  const {hero,locate,isOnScreen,map}=input,dist=(p:{x:number;y:number})=>Math.hypot(p.x-hero.x,p.y-hero.y);
  const targets:CityEdgeTarget[]=[];
  // Caídos: always (layoutEdges keeps only those out of view, and MUST_POINT never lets one go without its arrow).
  for(const p of input.players)if(p.id!==input.selfId&&p.downed)targets.push({key:p.id,kind:'caido',screen:locate(p),world:{x:p.x,y:p.y},distance:dist(p),
    ...(p.seconds!==undefined?{seconds:p.seconds}:{}),...(p.ping?{ping:true}:{}),...(p.portrait?{portrait:p.portrait}:{}),
    ...(p.name?{name:p.name,label:railName(p.name)}:{})});
  for(const e of input.enemies)if(e.boss&&!isOnScreen(e))targets.push({key:`chefe:${e.id}`,kind:'chefe',screen:locate(e),world:{x:e.x,y:e.y},distance:dist(e),name:'Chefe'});
  // Groups: only the critters out of view count (alive, without the boss).
  const groups=pickGroupArrows(clusterEnemies(input.enemies.filter(e=>!e.boss&&!isOnScreen(e))),hero,isOnScreen,{previous:input.previousGroups});
  const wall=(g:{x:number;y:number})=>Math.hypot(g.x-map.plaza.x,g.y-map.plaza.y)-map.plaza.radius;
  for(const g of groups){
    const danger=dist(g)<=GROUP_DANGER_HERO||wall(g)<=GROUP_DANGER_WALL;
    targets.push({key:`grupo:${g.key}`,kind:'grupo',screen:locate(g),world:{x:g.x,y:g.y},distance:dist(g),groupCount:g.count,label:groupCountText(g.count),name:`${groupCountText(g.count)} bichos`,...(danger?{danger}:{})});
  }
  // Active mouths out of view: the 2 nearest, unless a group already stands at the mouth.
  const active=new Set(input.activeMouths??[]);
  const mouths=map.mouths.filter(m=>active.has(m.id)&&!isOnScreen(m)&&!groups.some(g=>Math.hypot(g.x-m.x,g.y-m.y)<=MOUTH_GROUP_MERGE))
    .sort((a,b)=>dist(a)-dist(b)||(a.id<b.id?-1:1)).slice(0,MOUTH_ARROWS);
  for(const m of mouths)targets.push({key:`boca:${m.id}`,kind:'spawn',screen:locate(m),world:{x:m.x,y:m.y},distance:dist(m),name:'Boca ativa'});
  // D-047: the chaveiro's moto, whenever it is out of view (until he reaches the car).
  const moto=input.moto;
  if(moto&&moto.mode!=='abrindo'&&!isOnScreen(moto))targets.push({key:'moto',kind:'moto',screen:locate(moto),world:{x:moto.x,y:moto.y},distance:dist(moto),
    name:motoNeedsTeam(moto.mode)?'Chaveiro parado':'Chaveiro',...(motoNeedsTeam(moto.mode)?{danger:true}:{})});
  // Bancos: one bank, the robbed one first (rules/bancos.ts BANK_SHORT names it for the screen reader).
  const bank=bankForArrow(input.banks,hero,isOnScreen);
  if(bank)targets.push({key:`banco:${bank.id}`,kind:'banco',screen:locate(bank),world:{x:bank.x,y:bank.y},distance:dist(bank),
    name:bank.state==='bicho'?`Bicho sacando no ${BANK_SHORT[bank.name]}`:`Banco ${BANK_SHORT[bank.name]} · R$ ${bank.saldo}`,...(bank.state==='bicho'?{danger:true}:{})});
  // Base: in the intermission when the plaza is out of view (Cone with the seconds after the horn); in a wave only after a hit on the wall.
  const plaza={x:map.plaza.x,y:map.plaza.y};
  if((input.phase==='prepare'||input.wallHitRecently)&&!isOnScreen(plaza)){
    const horn=input.phase==='prepare'&&input.hornSeconds!==undefined;
    targets.push({key:'base',kind:'base',screen:locate(plaza),world:plaza,distance:dist(plaza),name:'Base',...(horn?{danger:true,seconds:input.hornSeconds}:{})});
  }
  return {targets,groupKeys:new Set(groups.map(g=>g.key))};
}

/**
 * A city target: a group carries how many critters it holds (summed when two groups merge); `world` is where it stands
 * (world units), so a frame between two rebuilds only re-locates it (relocateCityTargets).
 */
export interface CityEdgeTarget extends EdgeTarget {groupCount?:number;world?:{x:number;y:number}}
/**
 * The targets of the last rebuild (cityEdgeTargets) moved to this frame: each one's screen point from its world point
 * and its distance from the hero now. In place, allocation-free but for `locate`'s point; one without `world` stays.
 */
export function relocateCityTargets(targets:readonly CityEdgeTarget[],hero:{x:number;y:number},locate:(p:{x:number;y:number})=>{x:number;y:number}){
  for(const t of targets){
    if(!t.world)continue;
    t.screen=locate(t.world);t.distance=Math.hypot(t.world.x-hero.x,t.world.y-hero.y);
  }
}
/** A city arrow: `groupCount` (critters) and `label` (its text, "99+" at the ceiling) on a group's arrow; its `count` stays 1. */
export interface CityEdgeArrow extends EdgeArrow {groupCount?:number}
export interface CityEdgeOptions extends EdgeOptions {
  /** --t-escala: the arrows' half size is arrowHalf(textScale) unless `half` is given. */
  textScale?:number}
/** At most this many group arrows. */
export const GROUP_EDGE_ARROWS=2;

/**
 * Groups whose screen points lie within `merge` px of each other become one target with the counts summed (doc §3:
 * never "+1"), keyed and placed as the nearest of them. Order-independent; other targets pass through.
 */
export function mergeGroupTargets<T extends CityEdgeTarget>(targets:readonly T[],merge=MERGE_PX):T[]{
  const groups=targets.filter(isGroup).sort((a,b)=>a.distance-b.distance||(a.key<b.key?-1:a.key>b.key?1:0)),out:T[]=[];
  for(const g of groups){
    const into=out.find(o=>Math.hypot(o.screen.x-g.screen.x,o.screen.y-g.screen.y)<merge);
    if(!into){out.push({...g,groupCount:g.groupCount??0});continue;}
    const n=(into.groupCount??0)+(g.groupCount??0);into.groupCount=n;into.label=groupCountText(n);into.name=`${groupCountText(n)} bichos`;
    if(g.danger)into.danger=true;
  }
  return [...targets.filter(t=>!isGroup(t)),...out];
}

// layoutEdges folds a crowded arrow into one of the same kind ("+N"): during layout each city class rides the kind of
// its rank (caído, chefe, grupo, boca as 'spawn', base), in edges.ts's priority order, so a group and a mouth never fold
// into each other.
const LAYOUT_KIND:Readonly<Record<number,EdgeKind>>={0:'caido',1:'chefe',2:'grupo',3:'spawn',3.5:'moto',3.8:'banco',4:'base'};

/**
 * The part of `area` left beside the open windows (the offer, the forge, the minimap): for each window over it, the largest
 * band above, below, left or right of it, preferring one that holds the hero ± margin (zones.ts does the same for the
 * offer). A target behind a window then lies outside the arrows' area, so it gets its arrow glued to the window's edge.
 */
export function besideWindows(area:Rect,windows:readonly (Rect|undefined)[]):Rect{
  const fits=(r:Rect)=>r.width>=MIN_PLAY_SIDE&&r.height>=MIN_PLAY_SIDE;
  let out=area;
  for(const w of windows){
    if(!w||w.width<=0||w.height<=0||!crosses(out,w))continue;
    const a=out,bands:Rect[]=[
      {x:a.x,y:a.y,width:a.width,height:Math.max(0,w.y-a.y)},
      {x:a.x,y:bottom(w),width:a.width,height:Math.max(0,bottom(a)-bottom(w))},
      {x:a.x,y:a.y,width:Math.max(0,w.x-a.x),height:a.height},
      {x:right(w),y:a.y,width:Math.max(0,right(a)-right(w)),height:a.height},
    ];
    out=bands.reduce((best,r)=>fits(r)!==fits(best)?(fits(r)?r:best):r.width*r.height>best.width*best.height?r:best);
  }
  return out;
}

/**
 * The city's arrows that are never dropped while they need one (layoutEdges' last resort on the rim): the caído and
 * the boss, as on the island, and the base after the horn (Cone, the seconds to get back on its tag, doc §3): a short
 * landscape field used to crowd it out while "Volta pra base" ran (visual review cidade-04).
 */
export const cityMustPoint=(t:EdgeTarget)=>MUST_POINT.includes(t.kind)||t.kind==='base'&&(t.seconds!==undefined||!!t.danger);
/**
 * The order the city's arrows are placed in: cityEdgeRank, except the base after the horn (its seconds on the tag), which
 * goes before the mouths: with "Volta pra base" running, a mouth used to take the base's side of a short landscape field
 * and push its arrow to the far corner, beak across the screen (visual review cidade-04). Only the placing order: the
 * caps and the kind stay the doc's.
 */
export const cityPlaceRank=(t:EdgeTarget)=>t.kind==='base'&&t.seconds!==undefined?2.5:cityEdgeRank(t);

/**
 * layoutEdges with the city's rules, on the useful area minus the open windows (besideWindows): the targets that need an
 * arrow (pointedTargets) are ranked by cityEdgeRank, groups
 * within MERGE_PX on screen merged (counts summed), capped at 2 grupo and 2 boca, cut at MAX_ARROWS, then laid out with a
 * layout kind per class, so a group and a mouth never fold into each other. A group that still folds into another group
 * hands it its critters. Returned arrows carry their class's kind (a group is always 'grupo').
 */
export function layoutCityEdges(targets:readonly CityEdgeTarget[],useful:Rect,hero?:Rect,options:CityEdgeOptions={}):CityEdgeArrow[]{
  const {textScale,...rest}=options,max=Math.min(MAX_ARROWS,options.max??MAX_ARROWS),area=besideWindows(useful,options.windows??[]);
  const ranked=mergeGroupTargets((pointedTargets(targets,area,options.seen) as CityEdgeTarget[]).filter(t=>cityEdgeRank(t)<9),options.merge??MERGE_PX)
    .sort((a,b)=>cityPlaceRank(a)-cityPlaceRank(b)||(a.seconds??Infinity)-(b.seconds??Infinity)||a.distance-b.distance||(a.key<b.key?-1:a.key>b.key?1:0));
  let groups=0,mouths=0;
  const kept=ranked.filter(t=>isGroup(t)?++groups<=GROUP_EDGE_ARROWS:isMouth(t)?++mouths<=MOUTH_ARROWS:true).slice(0,max);
  const real=new Map(kept.map(t=>[t.key,t]));
  const laid=layoutEdges(kept.map(t=>({...t,kind:LAYOUT_KIND[cityEdgeRank(t)]})),area,hero,{city:true,mustPoint:cityMustPoint,rank:cityPlaceRank,...rest,max,half:options.half??arrowHalf(textScale??1)}) as CityEdgeArrow[];
  const arrows:CityEdgeArrow[]=laid.map(a=>({...a,kind:LAYOUT_KIND[cityEdgeRank(real.get(a.key)!)]}));
  // A group folded into another group's arrow: its critters join that arrow's count (there are at most two groups).
  const placed=new Set(arrows.map(a=>a.key));
  for(const lost of kept.filter(t=>isGroup(t)&&!placed.has(t.key))){
    const host=arrows.find(a=>isGroup(a)&&a.count>1);
    if(host){const n=(host.groupCount??0)+(lost.groupCount??0);host.groupCount=n;host.label=groupCountText(n);host.count--;}
  }
  for(const a of arrows)if(isGroup(a))a.count=1;
  return arrows;
}
