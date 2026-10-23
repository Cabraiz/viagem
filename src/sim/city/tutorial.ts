/**
 * City round 1 as a tutorial (cidade-08, D-026): the run starts at the crashed "Helicóptero da Firma" (the asset's
 * `inicio`, where the heroes spawn) and round 1 is the guided walk to the plaza (≈ 36-40 s for a novice following the
 * route). The director (DirectorOptions.cityTutorial, on by default in the city through assemble.ts) reads this module:
 *
 *  - the round's name and banner line come from CIDADE_TUTORIAL (rules/zueira-cidade.ts) instead of the drawn theme;
 *  - two small groups of slow, weak bêbados (TUTORIAL_PLAN), never on the road ahead of the team:
 *    1. "rabeira" (group 0): warned TUTORIAL_PLAN.behindAt s into the wave, once the team had time to read the screen
 *       and start walking, at hidden cells near the wreck that are FARTHER from the plaza (path) than every live hero,
 *       the closest to the team first (`behindSpots`): they come out of the crash site behind the team and chase it
 *       (plan speed 0.9: ≈ 1.61 u/s, 0.81 × the city hero), a little tension on the walk (a novice who stops a lot gets
 *       caught and swats them) that a hero who keeps moving outpaces; the rest reach the plaza after the team. Members
 *       with no hidden spot after BEHIND_TRIES searches are dropped;
 *    2. "comitê de boas-vindas" (group 1): through the avenue planner from one mouth other than S (the team walks in
 *       through S), aimed at the plaza (not at the team), arriving there ≈ welcomeArrival s into the wave, after the
 *       walk; its bodies hold the plaza (memory PLAZA_HOLD_FLAG, city/grid.ts citySteer: they wait in it, facing the
 *       team) until a hero is inside the base or within PLAZA_HOLD_RADIUS of one of them: the first fight is at the
 *       plaza, where the team holds from round 2 on, never down the avenue the team walks up;
 *  - the wave ends once every critter is down AND a live hero reached the plaza (planner.insideBase), or at the cap
 *    (capSeconds; the rest retreats as in any timed-out city round);
 *  - one hero `say`s a CIDADE_TUTORIAL intro line when the run starts (within INTRO_WINDOW_SECONDS, else never) and
 *    the first hero in the plaza a CIDADE_TUTORIAL arrival line (each once per run; balloons, ≤ BARK_MAX).
 * Why this shape: the plain round 1 chased a team away from the base, so with the team at the wreck its first group
 * landed on the novice's road at ~1.5 s; here nothing appears between the team and the plaza, the walk has room
 * (cap 90 s), and the round's last fight happens where the next rounds are defended.
 * Everything is deterministic (lines from streams derived from the director's rng, spots in cell order) and the
 * director's TutorialState is JSON-safe.
 */
import {DIRS,FlowField,HERO_SPEED_MULT,RADIUS,STRAIGHT_COST,UNREACHABLE,floorPortal,onRamp,overDeck,rampFoot,type CityTerrain,type CityViaduct,type FlowPoint,type Point} from '../../maps/index.ts';

import {CITY_DISTANCE_SCALE,CITY_MAP_SCALE,ELITE_HP,playerScale,type RoundPlan} from '../../rules/index.ts';
import {ticks} from '../../contract/index.ts';
import type {Mouth} from './avenues.ts';

/** Balance of the tutorial round (one player; groups scale by the round table's count rule, hp by its hp rule). */
export const TUTORIAL_PLAN=Object.freeze({
  /** Bêbados of the group behind the team and of the plaza group, for one player. */
  behind:2,welcome:3,
  /** Wave seconds when the group behind is warned (the run's 3 s opening + this: the novice read ~4 s, then walked). */
  behindAt:6,
  /**
   * Wave seconds when the plaza group reaches the plaza, before a novice's walk ends: tuned 40 s for the base walk
   * (slow novice in the plaza at ~62 s, the group holding it from ~41 s), divided by maps HERO_SPEED_MULT so it keeps
   * the same share of the walk at the 2× walk (velocidade-heroi-e-projetil: 20 s; slow novice ~32 s). The 1.7× city
   * made it × CITY_MAP_SCALE (34 s) for its longer walk; since the run starts down the road (cityRunStart) the walk is
   * the tuned one again, and so is this (NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro: 20 s).
   */
  welcomeArrival:40/HERO_SPEED_MULT,
  /** hp multiplier (round 1 of the table is 0.35) and speed multiplier (city bêbado 1.79 → ≈ 1.61 u/s; hero 1.99). */
  hpScale:.3,speed:.9,
  /** Hard end of the wave (s): what is still out retreats, and the round ends even if nobody reached the plaza. */
  capSeconds:90,
});
/**
 * Spread (u) of the room's six spawn slots around the start (multiplayer/simulation.ts spawnSlot: three across, two
 * rows, this far apart): cityRunStart keeps all of them on open ground.
 */
export const START_SLOT_SPREAD=.7;
const startMemo=new WeakMap<object,Point&{andar?:1}>();
/**
 * Where a city run starts (NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro, part A): on the heroes' street route from the
 * wreck (asset `inicio`) to the plaza, at the point whose walk left is the whole route ÷ CITY_DISTANCE_SCALE, the walk this
 * tutorial was tuned for on the .w3x-sized city (≈ 76 of 129 u, ≈ 19 s at the city hero's walk). The 1.7× city made
 * the walk 1.7× longer (the tutorial went from 22 to 35 s and round 1, with the group behind chasing the team the whole
 * way, ran into its 90 s cap); the asset's points stay where they are: the wreck is still `inicio` (the minimap's start
 * mark, the search centre of the group behind), the team starts down the road from it. On asset v4 (the distances 1.75×
 * shorter, mapa-175-com-viaduto) the whole route (~83 u) is about that walk already, so the team starts by the wreck.
 * Route: a flow field to the plaza point on one cell per asset cell, walkable by the hero rule at the cell centre
 * (clearDisc, which the barricades never block for heroes). From the first route cell within that walk, the first one
 * where all six spawn slots (START_SLOT_SPREAD) stand on open ground. Once per asset; `inicio` when no route exists.
 * On a deck (the Uno on the viaduct, mapa-175-com-viaduto etapa 3): `inicio` itself, on floor 1 (andar), the deck and
 * the ramp down to the plaza being the tuned walk (~58 u).
 */
export function cityRunStart(city:CityTerrain):Point&{andar?:1}{
  const known=startMemo.get(city.asset);
  if(known)return {...known};
  const a=city.asset,cs=a.unitsPerCell,{inicio,praca}=a.points;
  if(a.viaducts.some(v=>overDeck(v,cs,inicio.x,inicio.y))){
    const start=Object.freeze({x:inicio.x,y:inicio.y,andar:1 as const});
    startMemo.set(a,start);
    return {...start};
  }
  const field=new FlowField({width:a.cells.w,height:a.cells.h,cellSize:cs,walkable:(cx,cy)=>city.clearDisc((cx+.5)*cs,(cy+.5)*cs,RADIUS)},[praca]);
  const slotsFit=(x:number,y:number)=>{
    for(let row=0;row<2;row++)for(let col=-1;col<=1;col++)if(!city.clearDisc(x+col*START_SLOT_SPREAD,y+row*START_SLOT_SPREAD,RADIUS))return false;
    return true;
  };
  let start:Point={x:inicio.x,y:inicio.y};
  const total=field.costAt(inicio.x,inicio.y);
  if(total!==UNREACHABLE){
    const walk=total/CITY_DISTANCE_SCALE;
    let cx=Math.floor(inicio.x/cs),cy=Math.floor(inicio.y/cs);
    for(let i=0;i<a.cells.w*a.cells.h;i++){
      const cost=field.cellCost(cx,cy),x=(cx+.5)*cs,y=(cy+.5)*cs;
      if(cost<=walk&&slotsFit(x,y)){start={x,y};break;}
      const d=cost===0?-1:field.nextCell(cx,cy);
      if(d<0)break;
      cx+=DIRS[d].dx;cy+=DIRS[d].dy;
    }
  }
  startMemo.set(city.asset,Object.freeze(start));
  return {...start};
}

/** Index of each tutorial group in the plan (the plan lists them in this order). */
export const TUTORIAL_BEHIND=0,TUTORIAL_WELCOME=1;
/**
 * Mouths the plaza group may use: never the avenue the team walks in by, the mouth nearest the start (S from the
 * helicopter by the south edge; N from the Uno on the viaduct, mapa-175-com-viaduto). In N, S, L, O order.
 */
export function tutorialMouths(city:CityTerrain):Mouth[]{
  const {inicio,bocas}=city.asset.points,all:Mouth[]=['N','S','L','O'];
  const team=all.reduce((a,b)=>Math.hypot(bocas[b].x-inicio.x,bocas[b].y-inicio.y)<Math.hypot(bocas[a].x-inicio.x,bocas[a].y-inicio.y)?b:a);
  return all.filter(m=>m!==team);
}
/**
 * A spot behind the team is at least this much farther from the plaza (path u) than the hero farthest from it: a few
 * steps behind a hero, not a map length (kept by NEW-20261013-ORQ-cidade-escala-1-7).
 */
export const BEHIND_MARGIN=2;
/**
 * Spots behind the team are searched within this radius (u) of the wreck (40 u on the .w3x-sized city, × CITY_MAP_SCALE,
 * NEW-20261013-ORQ-cidade-escala-1-7); members stand this far apart (u, bodies: kept). Not shortened with the city's
 * distances (mapa-175-com-viaduto): the spots must stay out of the camera, which kept its size, and at 39 u the wreck
 * by the south edge had almost none (round 1's first contact went from ~22 to ~43 s).
 */
export const BEHIND_RADIUS=40*CITY_MAP_SCALE,BEHIND_GAP=.8;
/**
 * Searches (one a second, from behindAt) for hidden spots behind the team before the members still without one are
 * dropped, so a team that keeps every candidate cell in sight does not hold the round to its cap.
 */
export const BEHIND_TRIES=20;
/** The intro line is said in the run's first INTRO_WINDOW_SECONDS (a hero standing); later it is skipped. */
export const INTRO_WINDOW_SECONDS=5;

/**
 * JSON-safe tutorial memory in DirectorState (present only on a city run with the tutorial).
 * intro: id of the hero who said the intro line; arrived/arrivedTick: the first live hero inside the plaza and when.
 */
export interface TutorialState {intro?:string;arrived?:string;arrivedTick?:number}

/**
 * The tutorial round's plan for `players` (1..6): the two groups, low hp, slow, the cap as its duration. `kinds` (art only,
 * director): who they are, in turn; the bêbado without it.
 */
export function tutorialPlan(players:number,firstArrivalTicks:number,kinds?:readonly string[]):RoundPlan{
  const scale=playerScale(players),n=Math.max(1,Math.min(6,Math.round(players)));
  const size=(base:number)=>Math.max(1,Math.round(base*scale.count));
  const behindAt=ticks(TUTORIAL_PLAN.behindAt);
  // The planner aims a group at the plaza firstArrivalTicks + (its at − the round's first at, the group behind's)
  // after the wave start: this `at` puts the plaza group there welcomeArrival s into the wave.
  const welcomeAt=behindAt+Math.max(0,ticks(TUTORIAL_PLAN.welcomeArrival)-firstArrivalTicks);
  const who=(i:number)=>kinds?.length?kinds[i%kinds.length]:'bebado';
  const groups=[
    {at:behindAt,members:Array.from({length:size(TUTORIAL_PLAN.behind)},(_,i)=>who(i))},
    {at:welcomeAt,members:Array.from({length:size(TUTORIAL_PLAN.welcome)},(_,i)=>who(i+1))},
  ];
  return {
    index:1,players:n,groups,total:groups.reduce((t,g)=>t+g.members.length,0),durationTicks:ticks(TUTORIAL_PLAN.capSeconds),
    hp:TUTORIAL_PLAN.hpScale*scale.hp,eliteHp:TUTORIAL_PLAN.hpScale*scale.solo*ELITE_HP,speed:TUTORIAL_PLAN.speed,size:1,
    retreat:true,boss:false,
  };
}

/** A candidate cell near the wreck: its centre, distance (u) to the wreck and path distance (u) to the plaza. */
export interface BehindCandidate {x:number;y:number;fromWreck:number;toPlaza:number}
/**
 * Plaza-connected cells (outside the base) within BEHIND_RADIUS of the wreck, nearest to the wreck first (ties: cell
 * order). Built once per planner (the plaza field's walls only change with barricades, which stay in the plaza).
 */
export function behindCandidates(plazaField:FlowField,wreck:Point,insideBase:(p:FlowPoint)=>boolean):BehindCandidate[]{
  const f=plazaField,cs=f.cellSize,out:BehindCandidate[]=[];
  const x0=Math.max(0,Math.floor((wreck.x-BEHIND_RADIUS-f.originX)/cs)),x1=Math.min(f.width-1,Math.floor((wreck.x+BEHIND_RADIUS-f.originX)/cs));
  const y0=Math.max(0,Math.floor((wreck.y-BEHIND_RADIUS-f.originY)/cs)),y1=Math.min(f.height-1,Math.floor((wreck.y+BEHIND_RADIUS-f.originY)/cs));
  for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
    const cost=f.cellCost(cx,cy);
    if(cost===UNREACHABLE||cost===0)continue;
    const x=f.originX+(cx+.5)*cs,y=f.originY+(cy+.5)*cs,d=Math.hypot(x-wreck.x,y-wreck.y);
    if(d>BEHIND_RADIUS||insideBase({x,y}))continue;
    out.push({x,y,fromWreck:d,toPlaza:plazaUnits(f,cost)});
  }
  return out.sort((a,b)=>a.fromWreck-b.fromWreck);
}
/** Path distance (u) of a plaza-field cost. */
export const plazaUnits=(f:FlowField,cost:number)=>cost/STRAIGHT_COST*f.cellSize;

/**
 * Up to `count` spots for the group behind the team: candidates farther from the plaza than `teamToPlaza` +
 * BEHIND_MARGIN, `hidden` from every viewer, BEHIND_GAP apart, the closest to the team first by `toTeam` (path u;
 * unreachable ones dropped; ties and no `toTeam`: behindCandidates order), so the group trails the team instead of
 * starting a whole walk behind it. Fewer (or none) when no such cell is hidden yet; the director tries the rest again a
 * second later.
 */
export function behindSpots(candidates:readonly BehindCandidate[],count:number,teamToPlaza:number,hidden:(p:Point)=>boolean,toTeam?:(p:Point)=>number):Point[]{
  const out:Point[]=[],gap2=BEHIND_GAP*BEHIND_GAP;
  let pool=candidates.filter(c=>c.toPlaza>teamToPlaza+BEHIND_MARGIN);
  if(toTeam){
    const cost=new Map(pool.map(c=>[c,toTeam(c)]));
    pool=pool.filter(c=>Number.isFinite(cost.get(c))).sort((a,b)=>cost.get(a)!-cost.get(b)!);
  }
  for(const c of pool){
    if(out.length>=count)break;
    if(out.some(q=>(q.x-c.x)**2+(q.y-c.y)**2<gap2))continue;
    if(!hidden(c))continue;
    out.push({x:c.x,y:c.y});
  }
  return out;
}

/**
 * The viaduct (mapa-175-com-viaduto etapa 3): the deck a point stands over (the run's start, the Uno), or undefined.
 * The group behind the team then comes over the pile-up at the deck's closed end: its spots are deck cells, on floor 1.
 */
export function deckOf(city:CityTerrain,p:Point):CityViaduct|undefined{
  return city.asset.viaducts.find(v=>overDeck(v,city.asset.unitsPerCell,p.x,p.y));
}
/** Walk (u) from a point on viaduct `v`'s deck or ramp to the plaza: down the ramp (straight, along its axis), then the plaza field from its foot. */
export function deckToPlaza(city:CityTerrain,v:CityViaduct,plazaField:FlowField,p:Point):number{
  const u=city.asset.unitsPerCell,foot=rampFoot(v,u),down=floorPortal(v,u,0),c=plazaField.costAt(down.x,down.y);
  return Math.hypot(p.x-foot.x,p.y-foot.y)+(c===UNREACHABLE?Infinity:plazaUnits(plazaField,c));
}
/**
 * Deck cells of `v` within BEHIND_RADIUS of the wreck (their centres, nearest to the wreck first; ties: cell order),
 * with their walk to the plaza down the ramp (deckToPlaza): the candidates of the group behind a team that starts on
 * the deck. Ramp cells are not candidates (the group comes from the closed end, behind the team).
 */
export function deckBehindCandidates(city:CityTerrain,v:CityViaduct,plazaField:FlowField,wreck:Point):BehindCandidate[]{
  const u=city.asset.unitsPerCell,[c0,r0,w,h]=v.deck,out:BehindCandidate[]=[];
  for(let r=r0;r<r0+h;r++)for(let c=c0;c<c0+w;c++){
    const x=(c+.5)*u,y=(r+.5)*u,d=Math.hypot(x-wreck.x,y-wreck.y);
    if(d>BEHIND_RADIUS)continue;
    out.push({x,y,fromWreck:d,toPlaza:deckToPlaza(city,v,plazaField,{x,y})});
  }
  return out.sort((a,b)=>a.fromWreck-b.fromWreck);
}
/**
 * The way to the plaza from `p` on its own floor, into `out` (a unit vector, or zero at the goal): the plaza field
 * `field` on the ground; on a viaduct's deck (andar 1), straight to the foot of its ramp (deck and ramp are one straight
 * corridor), the field from there. For walkers that follow the route (the judges and the scripted heroes of the tests,
 * the benches).
 */
export function floorRoute(city:CityTerrain,field:FlowField,p:Point&{andar?:number},out:Point):void{
  if(p.andar===1){
    const v=city.asset.viaducts.find(w=>overDeck(w,city.asset.unitsPerCell,p.x,p.y)||onRamp(w,city.asset.unitsPerCell,p.x,p.y))??city.asset.viaducts[0];
    if(v){
      const q=floorPortal(v,city.asset.unitsPerCell,0),dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy);
      out.x=d>1e-9?dx/d:0;out.y=d>1e-9?dy/d:0;
      return;
    }
  }
  field.directionAt(p.x,p.y,out);
}
/** Walk (u) from `p` to the plaza on its own floor: deckToPlaza on a deck, the plaza field's cost on the ground (Infinity unreachable). */
export function floorToPlaza(city:CityTerrain,field:FlowField,p:Point&{andar?:number}):number{
  if(p.andar===1){
    const v=city.asset.viaducts.find(w=>overDeck(w,city.asset.unitsPerCell,p.x,p.y)||onRamp(w,city.asset.unitsPerCell,p.x,p.y))??city.asset.viaducts[0];
    if(v)return deckToPlaza(city,v,field,p);
  }
  const c=field.costAt(p.x,p.y);
  return c===UNREACHABLE?Infinity:plazaUnits(field,c);
}
