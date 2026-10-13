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
 *       caught and swats them) that a hero who keeps moving outpaces; the rest reach the plaza after the team;
 *    2. "comitê de boas-vindas" (group 1): through the avenue planner from one mouth other than S (the team walks in
 *       through S), aimed at the plaza (not at the team), arriving there ≈ welcomeArrival s into the wave, after the
 *       walk: the first fight at the plaza, which is where the team holds from round 2 on;
 *  - the wave ends once every critter is down AND a live hero reached the plaza (planner.insideBase), or at the cap
 *    (capSeconds; the rest retreats as in any timed-out city round);
 *  - one hero `say`s a CIDADE_VEHICLE intro line when the run starts and the first hero in the plaza a
 *    CIDADE_TUTORIAL arrival line (each once per run).
 * Why this shape: the plain round 1 chased a team away from the base, so with the team at the wreck its first group
 * landed on the novice's road at ~1.5 s; here nothing appears between the team and the plaza, the walk has room
 * (cap 90 s), and the round's last fight happens where the next rounds are defended.
 * Everything is deterministic (lines from streams derived from the director's rng, spots in cell order) and the
 * director's TutorialState is JSON-safe.
 */
import {STRAIGHT_COST,UNREACHABLE,type FlowField,type FlowPoint,type Point} from '../../maps/index.ts';
import {ELITE_HP,playerScale,type RoundPlan} from '../../rules/index.ts';
import {ticks} from '../../contract/index.ts';
import type {Mouth} from './avenues.ts';

/** Balance of the tutorial round (one player; groups scale by the round table's count rule, hp by its hp rule). */
export const TUTORIAL_PLAN=Object.freeze({
  /** Bêbados of the group behind the team and of the plaza group, for one player. */
  behind:2,welcome:3,
  /** Wave seconds when the group behind is warned (the run's 3 s opening + this: the novice read ~4 s, then walked). */
  behindAt:6,
  /** Wave seconds when the plaza group reaches the plaza (after a novice's walk). */
  welcomeArrival:40,
  /** hp multiplier (round 1 of the table is 0.35) and speed multiplier (city bêbado 1.79 → ≈ 1.61 u/s; hero 1.99). */
  hpScale:.3,speed:.9,
  /** Hard end of the wave (s): what is still out retreats, and the round ends even if nobody reached the plaza. */
  capSeconds:90,
});
/** Index of each tutorial group in the plan (the plan lists them in this order). */
export const TUTORIAL_BEHIND=0,TUTORIAL_WELCOME=1;
/** Mouths the plaza group may use: never S, the avenue the team walks in by. */
export const TUTORIAL_MOUTHS:readonly Mouth[]=Object.freeze(['N','L','O'] as Mouth[]);
/** A spot behind the team is at least this much farther from the plaza (path u) than the hero farthest from it. */
export const BEHIND_MARGIN=2;
/** Spots behind the team are searched within this radius (u) of the wreck; members stand this far apart (u). */
export const BEHIND_RADIUS=40,BEHIND_GAP=.8;

/**
 * JSON-safe tutorial memory in DirectorState (present only on a city run with the tutorial).
 * intro: id of the hero who said the intro line; arrived/arrivedTick: the first live hero inside the plaza and when.
 */
export interface TutorialState {intro?:string;arrived?:string;arrivedTick?:number}

/** The tutorial round's plan for `players` (1..6): the two groups, low hp, slow, the cap as its duration. */
export function tutorialPlan(players:number,firstArrivalTicks:number):RoundPlan{
  const scale=playerScale(players),n=Math.max(1,Math.min(6,Math.round(players)));
  const size=(base:number)=>Math.max(1,Math.round(base*scale.count));
  const behindAt=ticks(TUTORIAL_PLAN.behindAt);
  // The planner aims a group at the plaza firstArrivalTicks + (its at − the round's first at, the group behind's)
  // after the wave start: this `at` puts the plaza group there welcomeArrival s into the wave.
  const welcomeAt=behindAt+Math.max(0,ticks(TUTORIAL_PLAN.welcomeArrival)-firstArrivalTicks);
  const groups=[
    {at:behindAt,members:Array<string>(size(TUTORIAL_PLAN.behind)).fill('bebado')},
    {at:welcomeAt,members:Array<string>(size(TUTORIAL_PLAN.welcome)).fill('bebado')},
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
