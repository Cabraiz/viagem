/**
 * Edge arrows in the city (doc §3, B12): the island's layoutEdges on the useful area's inner rim, with the city's
 * targets and caps. Priority caído > chefe > grupo > boca > base; at most MAX_ARROWS, 2 grupo, 2 boca. A standing ally
 * and a chest never get an arrow here (team column and minimap). Until edges.ts learns a `grupo` kind (linking card,
 * doc §7), a group rides as kind 'spawn' with key 'grupo:<cell>', its critters in `groupCount` and their text in
 * `label`; an active mouth is 'spawn' with key 'boca:<id>'. Pure.
 */
import {layoutEdges,pointedTargets,railName,arrowHalf,crosses,bottom,right,MAX_ARROWS,MERGE_PX,MIN_PLAY_SIDE,type EdgeTarget,type EdgeArrow,type EdgeKind,type EdgeOptions,type Rect} from './deps.ts';
import {clusterEnemies,pickGroupArrows,groupCountText,type EnemyPoint} from './clusters.ts';
import type {CityMapInfo,MouthId} from './minimap.ts';

export interface CityEdgeInput {
  /** The followed hero (world units). */
  hero:{x:number;y:number};
  selfId:string;
  players:{id:string;x:number;y:number;downed?:boolean;name?:string;portrait?:string;seconds?:number;ping?:boolean}[];
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
}
/** Doc §3: the base's arrow shows in a wave only this long after the wall was hit. */
export const WALL_HIT_MS=3000;
/** A group this close to the hero, or this close to the wall, turns its ficha Cone (world units). */
export const GROUP_DANGER_HERO=8,GROUP_DANGER_WALL=12;
/** A group this close to an active mouth takes the mouth's arrow (never two arrows for one spot). */
export const MOUTH_GROUP_MERGE=10;
/** At most this many active-mouth arrows. */
export const MOUTH_ARROWS=2;

const isGroup=(t:EdgeTarget)=>t.key.startsWith('grupo:'),isMouth=(t:EdgeTarget)=>t.key.startsWith('boca:');
/** Doc §3 priority: caído 0 > chefe 1 > grupo 2 > boca 3 > base 4; anything else never gets an arrow in the city (9). */
export function cityEdgeRank(t:EdgeTarget):number{
  return t.kind==='caido'?0:t.kind==='chefe'?1:isGroup(t)?2:isMouth(t)?3:t.kind==='base'?4:9;
}

/** The city's targets for the arrows, and the group keys picked (feed them back as `previousGroups`). */
export function cityEdgeTargets(input:CityEdgeInput):{targets:CityEdgeTarget[];groupKeys:Set<string>}{
  const {hero,locate,isOnScreen,map}=input,dist=(p:{x:number;y:number})=>Math.hypot(p.x-hero.x,p.y-hero.y);
  const targets:CityEdgeTarget[]=[];
  // Caídos: always (layoutEdges keeps only those out of view, and MUST_POINT never lets one go without its arrow).
  for(const p of input.players)if(p.id!==input.selfId&&p.downed)targets.push({key:p.id,kind:'caido',screen:locate(p),distance:dist(p),
    ...(p.seconds!==undefined?{seconds:p.seconds}:{}),...(p.ping?{ping:true}:{}),...(p.portrait?{portrait:p.portrait}:{}),
    ...(p.name?{name:p.name,label:railName(p.name)}:{})});
  for(const e of input.enemies)if(e.boss&&!isOnScreen(e))targets.push({key:`chefe:${e.id}`,kind:'chefe',screen:locate(e),distance:dist(e),name:'Chefe'});
  // Groups: only the critters out of view count (alive, without the boss).
  const groups=pickGroupArrows(clusterEnemies(input.enemies.filter(e=>!e.boss&&!isOnScreen(e))),hero,isOnScreen,{previous:input.previousGroups});
  const wall=(g:{x:number;y:number})=>Math.hypot(g.x-map.plaza.x,g.y-map.plaza.y)-map.plaza.radius;
  for(const g of groups){
    const danger=dist(g)<=GROUP_DANGER_HERO||wall(g)<=GROUP_DANGER_WALL;
    targets.push({key:`grupo:${g.key}`,kind:'spawn',screen:locate(g),distance:dist(g),groupCount:g.count,label:groupCountText(g.count),name:`${groupCountText(g.count)} bichos`,...(danger?{danger}:{})});
  }
  // Active mouths out of view: the 2 nearest, unless a group already stands at the mouth.
  const active=new Set(input.activeMouths??[]);
  const mouths=map.mouths.filter(m=>active.has(m.id)&&!isOnScreen(m)&&!groups.some(g=>Math.hypot(g.x-m.x,g.y-m.y)<=MOUTH_GROUP_MERGE))
    .sort((a,b)=>dist(a)-dist(b)||(a.id<b.id?-1:1)).slice(0,MOUTH_ARROWS);
  for(const m of mouths)targets.push({key:`boca:${m.id}`,kind:'spawn',screen:locate(m),distance:dist(m),name:'Boca ativa'});
  // Base: in the intermission when the plaza is out of view (Cone with the seconds after the horn); in a wave only after a hit on the wall.
  const plaza={x:map.plaza.x,y:map.plaza.y};
  if((input.phase==='prepare'||input.wallHitRecently)&&!isOnScreen(plaza)){
    const horn=input.phase==='prepare'&&input.hornSeconds!==undefined;
    targets.push({key:'base',kind:'base',screen:locate(plaza),distance:dist(plaza),name:'Base',...(horn?{danger:true,seconds:input.hornSeconds}:{})});
  }
  return {targets,groupKeys:new Set(groups.map(g=>g.key))};
}

/** A city target: a group carries how many critters it holds (summed when two groups merge). */
export interface CityEdgeTarget extends EdgeTarget {groupCount?:number}
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

// layoutEdges folds a crowded arrow into one of the same kind ("+N"). Groups and mouths are both 'spawn' for the DOM,
// so during layout each city class rides a kind of its own with the same priority order (caído, chefe, grupo, boca, base).
const LAYOUT_KIND:Readonly<Record<number,EdgeKind>>={0:'caido',1:'chefe',2:'spawn',3:'base',4:'aliado'};

/**
 * The part of `area` left beside the open windows (the big minimap is one, doc §2): for each window over it, the largest
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
 * layoutEdges with the city's rules, on the useful area minus the open windows (besideWindows): the targets that need an
 * arrow (pointedTargets) are ranked by cityEdgeRank, groups
 * within MERGE_PX on screen merged (counts summed), capped at 2 grupo and 2 boca, cut at MAX_ARROWS, then laid out with a
 * layout kind per class, so a group and a mouth never fold into each other. A group that still folds into another group
 * hands it its critters. Returned arrows carry their real kind back.
 */
export function layoutCityEdges(targets:readonly CityEdgeTarget[],useful:Rect,hero?:Rect,options:CityEdgeOptions={}):CityEdgeArrow[]{
  const {textScale,...rest}=options,max=Math.min(MAX_ARROWS,options.max??MAX_ARROWS),area=besideWindows(useful,options.windows??[]);
  const ranked=mergeGroupTargets((pointedTargets(targets,area,options.seen) as CityEdgeTarget[]).filter(t=>cityEdgeRank(t)<9),options.merge??MERGE_PX)
    .sort((a,b)=>cityEdgeRank(a)-cityEdgeRank(b)||(a.seconds??Infinity)-(b.seconds??Infinity)||a.distance-b.distance||(a.key<b.key?-1:a.key>b.key?1:0));
  let groups=0,mouths=0;
  const kept=ranked.filter(t=>isGroup(t)?++groups<=GROUP_EDGE_ARROWS:isMouth(t)?++mouths<=MOUTH_ARROWS:true).slice(0,max);
  const real=new Map(kept.map(t=>[t.key,t]));
  const laid=layoutEdges(kept.map(t=>({...t,kind:LAYOUT_KIND[cityEdgeRank(t)]})),area,hero,{...rest,max,half:options.half??arrowHalf(textScale??1)}) as CityEdgeArrow[];
  const arrows:CityEdgeArrow[]=laid.map(a=>({...a,kind:real.get(a.key)!.kind}));
  // A group folded into another group's arrow: its critters join that arrow's count (there are at most two groups).
  const placed=new Set(arrows.map(a=>a.key));
  for(const lost of kept.filter(t=>isGroup(t)&&!placed.has(t.key))){
    const host=arrows.find(a=>isGroup(a)&&a.count>1);
    if(host){const n=(host.groupCount??0)+(lost.groupCount??0);host.groupCount=n;host.label=groupCountText(n);host.count--;}
  }
  for(const a of arrows)if(isGroup(a))a.count=1;
  return arrows;
}
