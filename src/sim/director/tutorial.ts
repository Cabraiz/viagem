/**
 * The director's city round 1, the tutorial walk (cidade-08, city/tutorial.ts): the plaza group's mouth, the group
 * behind the team and the welcome lines. Moved out of director.ts as is (corte C1).
 */
import type {SimContext} from '../context.ts';
import {BEHIND_TRIES,type BehindCandidate,INTRO_WINDOW_SECONDS,TUTORIAL_WELCOME,behindCandidates,behindSpots,deckBehindCandidates,deckOf,deckToPlaza,plazaUnits,tutorialMouths} from '../city/tutorial.ts';
import {cityTerrainOf} from '../city/grid.ts';
import type {Mouth} from '../city/avenues.ts';
import {type Point,STRAIGHT_COST,UNREACHABLE,worldSpawn} from '../../maps/index.ts';
import {Rng,ticks} from '../../contract/index.ts';
import {CIDADE_TUTORIAL,CIDADE_TUTORIAL_SAY} from '../../rules/index.ts';
import type {DirectorCtx,SpawnRequest,TutorialPart} from './types.ts';

export function tutorialPart(dir:DirectorCtx):TutorialPart{
  const {warning,random,planner,viewers,standing,state}=dir;
  /**
   * Round start of the tutorial: the plaza group's mouth (one of tutorialMouths with a route, by rng; it counts as
   * used, so round 2 prefers another) and the warning ticks: the group behind at its `at`, the plaza group at the
   * planner's warning for an arrival welcomeArrival s into the wave. The wave lasts its cap (plan.durationTicks).
   */
  function planTutorial(ctx:SimContext){
    const mouths=tutorialMouths(cityTerrainOf(ctx.terrain)!),plan=state.plan!,routes=mouths.filter(m=>planner!.route(m));
    const mouth=routes.length?random().pick(routes):mouths[0];
    const uses:Record<Mouth,number>={N:0,S:0,L:0,O:0};uses[mouth]=1;
    const avenues=state.avenues={round:plan.index,mode:'normal',open:[mouth],alternate:0,uses};
    const warnAt=plan.groups.map(g=>g.at),welcome=plan.groups[TUTORIAL_WELCOME];
    if(welcome){
      const parts=planner!.planGroups([dir.cityRequest(welcome.members,welcome.at,true)],viewers(ctx),avenues,random(),{at0:dir.cityAt0(),indexBase:TUTORIAL_WELCOME,nowTick:0});
      if(parts.length)warnAt[TUTORIAL_WELCOME]=Math.min(...parts.map(p=>p.warnTick));
    }
    const cityWarn=state.cityWarn=warnAt.map(w=>Math.max(0,w));
    state.cityOrder=plan.groups.map((_,i)=>i).sort((a,b)=>cityWarn[a]-cityWarn[b]||a-b);
  }
  /** Cells near the wreck for the group behind the team (city/tutorial.ts behindCandidates), read once. */
  let behind:BehindCandidate[]|undefined;
  /**
   * The group behind the team: hidden cells near the wreck farther from the plaza than every standing hero
   * (behindSpots), warned now and landing after the warning; members without a spot try again a second later, up to
   * BEHIND_TRIES searches in all, then they are dropped (the round no longer waits for them until the cap).
   */
  function behindWarn(ctx:SimContext,spawn:SpawnRequest,delay:number){
    const field=planner!.plazaField,cityT=cityTerrainOf(ctx.terrain),wreck=cityT?.asset.points.inicio??worldSpawn(ctx.terrain);
    // The viaduct: a team that starts on the deck (the Uno) is trailed by a group that comes over the pile-up at the
    // deck's closed end, on the deck (floor 1); the walks to the plaza on the deck go down its ramp (deckToPlaza).
    const deck=cityT?deckOf(cityT,wreck):undefined;
    behind??=deck?deckBehindCandidates(cityT!,deck,field,wreck):behindCandidates(field,wreck,p=>planner!.insideBase(p));
    let team=0;
    for(const p of ctx.players.values()){
      if(!standing(p))continue;
      if(deck&&p.andar===1){team=Math.max(team,deckToPlaza(cityT!,deck,field,p));continue;}
      const c=field.costAt(p.x,p.y);
      if(c!==UNREACHABLE)team=Math.max(team,plazaUnits(field,c));
    }
    // Closest to the team by path (the round timer's team field), so the group trails the heroes it chases; on the deck
    // (a straight corridor) the straight line.
    const near=dir.cityTeamField(ctx),toTeam=deck?undefined:near?(p:Point)=>{const c=near.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*near.cellSize;}:undefined;
    const players=viewers(ctx),points=behindSpots(behind,spawn.members.length,team,p=>planner!.hiddenFrom(players,p),toTeam);
    if(points.length){
      const members=spawn.members.slice(0,points.length),p=points[0],atTick=ctx.tick+delay+warning;
      state.pending.push({...spawn,members,x:p.x,y:p.y,atTick,points,...(deck?{andar:1 as const}:{})});
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:members.length});
    }
    const tries=(spawn.tries??0)+1;
    if(points.length<spawn.members.length&&tries<BEHIND_TRIES)dir.retryLater(ctx,{...spawn,members:spawn.members.slice(points.length),tries},delay);
  }
  /** Lines of the tutorial from their own streams (derived from the director's), so no spawn of the run moves. */
  const lineRng=(salt:number)=>new Rng((state.rng^salt)>>>0);
  /**
   * Right after the crash (the run's first steps): one standing hero says a CIDADE_TUTORIAL intro line (a balloon,
   * ≤ BARK_MAX). Once per run; when nobody stands during the first INTRO_WINDOW_SECONDS of the run, skipped.
   */
  function tutorialIntro(ctx:SimContext){
    if(ctx.tick-ctx.runStartTick>ticks(INTRO_WINDOW_SECONDS))return;
    const speakers=[...ctx.players.values()].filter(standing);
    if(!speakers.length)return;
    const r=lineRng(0x0c1d0801),who=r.pick(speakers);
    state.tutorial!.intro=who.id;
    ctx.emit({type:'say',source:who.id,key:CIDADE_TUTORIAL_SAY.intro,line:r.pick(CIDADE_TUTORIAL.intro)});
  }
  /** The first standing hero inside the base (planner.insideBase) says an arrival line; the wave may end from now on. */
  function tutorialArrival(ctx:SimContext){
    const t=state.tutorial!;
    if(t.arrived!==undefined)return;
    for(const p of ctx.players.values()){
      if(!standing(p)||!planner!.insideBase(p))continue;
      t.arrived=p.id;t.arrivedTick=ctx.tick;
      ctx.emit({type:'say',source:p.id,key:CIDADE_TUTORIAL_SAY.arrival,line:lineRng(0x0c1d0802).pick(CIDADE_TUTORIAL.arrival)});
      return;
    }
  }
  return {planTutorial,behindWarn,tutorialIntro,tutorialArrival};
}
