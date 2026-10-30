/**
 * The director in the city (cidade-05, director.ts module doc): the round planned on the AvenuePlanner, the warnings at
 * the avenue tips, the team field the round timer uses, the boss spot in the plaza, the run-in and the retreats back up
 * the avenues. Moved out of director.ts as is (corte C1).
 */
import type {SimContext} from '../context.ts';
import {FlowField,type FlowGrid,type Point,RADIUS,STRAIGHT_COST,type TerrainField,UNREACHABLE,enemyTerrain,walkable} from '../../maps/index.ts';
import {SIM_HZ,ticks} from '../../contract/index.ts';
import {moveSafely} from '../enemies/ai.ts';
import {type AvenuePlanner,type GroupRequest,type Mouth,modeForModifier} from '../city/avenues.ts';
import {CITY_ENEMY_SPEED,type CityFlowGrid,cityTerrainOf} from '../city/grid.ts';
import {TUTORIAL_BEHIND} from '../city/tutorial.ts';
import {CITY_ARRIVAL_SLACK,CITY_EXIT_REACH,CITY_GONE_DISTANCE,CITY_RUN_IN_SPEED,RUN_IN,retreatDir} from './tuning.ts';
import type {CityPart,DirectorCtx,PendingSpawn,SpawnRequest} from './types.ts';
import {nearestPlayer} from './spawn-points.ts';

export function cityPart(dir:DirectorCtx):CityPart{
  const {warning,minDistance,random,planner,viewers,tutorialRound,options,state}=dir;
  /** City run-in (CITY_RUN_IN_SPEED): late bodies off every default-zoom screen make up their lateness along the planner's flow. */
  const runInDir={x:0,y:0};
  function cityRunIn(ctx:SimContext){
    let team=0;
    for(const p of ctx.players.values()){
      if(!(p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0))continue;
      if(!planner!.insideBase(p))return;
      team++;
    }
    if(!team)return;
    const players=viewers(ctx),terrain=enemyTerrain(ctx.terrain),most=CITY_RUN_IN_SPEED/SIM_HZ;
    for(const id of state.tracked){
      const e=ctx.enemies.get(id),m=e?.memory,budget=m?.[RUN_IN];
      if(!e||!m||budget===undefined)continue;
      if(e.hp<=0||e.boss||m.retreat===1||ctx.tick<e.readyTick||e.frozenUntil!==undefined&&ctx.tick<e.frozenUntil)continue;
      if(!(budget>1e-6)||!planner!.hiddenAtDefault(players,e)){delete m[RUN_IN];continue;}
      planner!.directionFor(e,planner!.targetFor(e),runInDir);
      if(runInDir.x===0&&runInDir.y===0)continue;
      const x=e.x,y=e.y,step=Math.min(most,budget);
      moveSafely(e,runInDir.x*step,runInDir.y*step,terrain,e.radius);
      // Never onto a default-zoom screen: from its edge on, its own pace.
      if(!planner!.hiddenAtDefault(players,e)){e.x=x;e.y=y;delete m[RUN_IN];continue;}
      m[RUN_IN]=budget-Math.hypot(e.x-x,e.y-y);
    }
  }
  /** The round's first nominal dispatch tick (the planner's at0). */
  function cityAt0(){
    let at0=Infinity;for(const g of state.plan!.groups)at0=Math.min(at0,g.at);
    return Number.isFinite(at0)?at0:0;
  }
  /**
   * Planner request of a group: its members, nominal tick and, when known, its fastest member's speed this round, so
   * no member reaches the plaza before the group's slot (slower ones trail behind). A siege group (cidade-05c v2)
   * aims at the plaza (aim 'plaza'): it besieges the base, it does not chase a team away from it.
   */
  function cityRequest(members:readonly string[],at:number,siege=false):GroupRequest{
    const aim:Partial<GroupRequest>=siege?{aim:'plaza'}:{};
    let fastest=0;
    for(const kind of members){const v=options.enemySpeedOf?.(kind);if(v!==undefined&&Number.isFinite(v)&&v>fastest)fastest=v;}
    // speedMap is monotone: the fastest member's mapped speed is the largest mapped one.
    return fastest>0?{at,size:members.length,speed:citySpeedOf(fastest*state.plan!.speed),...aim}:{at,size:members.length,...aim};
  }
  /** City: the speed a body of authored effective speed `speed` walks at (options.speedMap; identity without it). */
  function citySpeedOf(speed:number){return options.speedMap?options.speedMap(speed):speed;}
  /**
   * cidade-05c: the planner's chaseCost while the team is away from the base (some live player, none of them in the
   * base) and options.cityChase is wired; the players field is brought up to this tick first. Else undefined (plaza).
   */
  function cityChaseCost(ctx:SimContext):((p:Point)=>number)|undefined{
    const chase=options.cityChase;
    if(!chase)return undefined;
    let any=false;
    for(const p of ctx.players.values()){
      if(!(p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0))continue;
      if(planner!.insideBase(p))return undefined;
      any=true;
    }
    if(!any)return undefined;
    chase.refresh(ctx);
    return p=>chase.costTo(p);
  }
  /**
   * Round start: open the round's mouths and plan every group once, only for the tick each group's warning goes out
   * (its earliest part); groups are dispatched in that order. A round of siege groups only (every regular group
   * besieges) is a cerco; a modifier wins over it (modeForModifier). With the team away from the base the mouths and
   * groups are aimed at it (cityChaseCost).
   */
  function planCity(ctx:SimContext){
    if(tutorialRound(ctx)){dir.planTutorial(ctx);return;}
    const plan=state.plan!,regular=plan.groups.filter(g=>!g.boss&&!g.elite&&!g.solo);
    const siege=regular.length>0&&plan.groups.every((g,i)=>g.boss||g.elite||g.solo||dir.isSiege(g,i));
    const chaseCost=cityChaseCost(ctx),aim=chaseCost?{chaseCost}:{};
    const avenues=state.avenues=planner!.openRound(plan.index,modeForModifier(state.theme?.modifierId,siege),random(),state.avenues,aim);
    // The boss appears in the plaza (cityWarn), not on an avenue: an empty request keeps every other group's index.
    const requests=plan.groups.map((g,i)=>g.boss?{at:g.at,size:0}:cityRequest(g.members,g.at,!g.elite&&!g.solo&&dir.isSiege(g,i)));
    const parts=planner!.planGroups(requests,viewers(ctx),avenues,random(),{at0:cityAt0(),indexBase:0,nowTick:0,...aim});
    const warnAt=plan.groups.map(()=>Infinity);
    for(const part of parts)if(part.index<warnAt.length)warnAt[part.index]=Math.min(warnAt[part.index],part.warnTick);
    const cityWarn=state.cityWarn=warnAt.map((w,i)=>plan.groups[i].boss?plan.groups[i].at:Math.max(0,Number.isFinite(w)?w:plan.groups[i].at));
    state.cityOrder=plan.groups.map((_,i)=>i).sort((a,b)=>cityWarn[a]-cityWarn[b]||a-b);
    // A round that times out lasts until the slowest member of the last group could have walked in, plus
    // CITY_ARRIVAL_SLACK. Not the boss round: it never retreats, and its end tick is the boss's enrage (boss.ts).
    const arrival=plan.retreat?cityLastArrival(ctx,parts,!!chaseCost):undefined;
    if(arrival!==undefined)ctx.round.phaseEndsTick=Math.max(ctx.round.phaseEndsTick,state.roundStart+arrival+ticks(CITY_ARRIVAL_SLACK));
  }
  /**
   * City: flow field toward the team (the players at the wave's start), for the round timer; on the planner's grid.
   * Barricades (cidade-06; cidade-05c v2): when the CityFlowGrid's version moved since the field last read it, the
   * field re-reads the changed cells first (changedSince; the whole grid when the grid cannot tell), lazily on its next
   * use, like citySteer's fields. Only the round timer reads it, at the round's start.
   */
  let teamField:FlowField|undefined,teamVersion=0;
  function cityTeamField(ctx:SimContext){
    const grid=(planner as {grid?:FlowGrid&Partial<CityFlowGrid>}|undefined)?.grid;
    if(!grid)return undefined;
    const team:Point[]=[];
    for(const p of ctx.players.values())if(p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0)team.push({x:p.x,y:p.y});
    if(!team.length)return undefined;
    const version=grid.version??0;
    if(teamField&&version!==teamVersion){
      const r=grid.changedSince?.(teamVersion);
      teamField.invalidate(r??{x0:0,y0:0,x1:teamField.width-1,y1:teamField.height-1});
    }
    teamVersion=version;
    if(teamField)teamField.setTargets(team);else teamField=new FlowField(grid,team);
    return teamField;
  }
  /**
   * Latest arrival (ticks after the round start) of any member of the planned parts: each member walks from its spot
   * at its own kind's speed × plan.speed (CITY_ENEMY_SPEED × plan.speed when unknown) to the plaza or, when the team
   * stands farther away, to the team where it is now (the steer chases the players, citySteer); distances are
   * flow-field costs (STRAIGHT_COST per cell, wall penalties included, so they never under-estimate the walk). The
   * release is the fastest member's (first contact), so slower kinds trail behind.
   * `aimed` (cidade-05c: the groups were placed toward a team away from the base): the walk is to the team only (the
   * plaza when the team field does not reach the spot), the same arrival the planner aimed at.
   * Siege members (cidade-05c v2) walk to the plaza, aimed or not: they besiege the base wherever the team is.
   * Member speeds are the ones the bodies get: speedMap(catalog × plan.speed).
   */
  function cityLastArrival(ctx:SimContext,parts:readonly {index:number;points:readonly Point[];releaseTick:number;arrivalTick:number}[],aimed=false){
    const plan=state.plan!,field=planner!.plazaField,team=cityTeamField(ctx),used=plan.groups.map(()=>0);
    const units=(f:FlowField,p:Point)=>{const c=f.costAt(p.x,p.y);return c===UNREACHABLE?-1:c/STRAIGHT_COST*f.cellSize;};
    let last:number|undefined;
    for(const part of parts){
      const group=plan.groups[part.index];
      if(!group||group.boss)continue;
      const siege=!group.elite&&!group.solo&&dir.isSiege(group,part.index);
      part.points.forEach((p,j)=>{
        const kind=group.members[used[part.index]+j],known=kind===undefined?undefined:options.enemySpeedOf?.(kind);
        const speed=known!==undefined&&Number.isFinite(known)&&known>0?citySpeedOf(known*plan.speed):CITY_ENEMY_SPEED*plan.speed;
        const toTeam=siege||!team?-1:units(team,p),d=siege?units(field,p):aimed&&toTeam>=0?toTeam:Math.max(units(field,p),toTeam);
        const walk=d<0?part.arrivalTick-part.releaseTick:ticks(d/speed);
        last=Math.max(last??0,part.releaseTick+walk);
      });
      used[part.index]+=part.points.length;
    }
    return last;
  }
  /**
   * Just in time: plans this group alone (its cadence slot `spawn.group`, released no earlier than `delay` + the
   * warning from now) at fresh hidden points, warns at the first point of each part (later parts warn at their own
   * time, see cityWarnings) and queues the exact positions. Members without a spot try again a second later (retryLater).
   */
  function cityWarn(ctx:SimContext,spawn:SpawnRequest,delay:number){
    if(spawn.boss){
      // D-026: the boss lands in the plaza, warned like any group (spawnPending re-warns if a player stepped onto it).
      const p=cityBossSpot(ctx),atTick=ctx.tick+delay+warning;
      state.pending.push({...spawn,x:p.x,y:p.y,atTick});
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:spawn.members.length});
      return;
    }
    const index=spawn.group??0,at=state.plan!.groups[index]?.at??cityAt0(),now=ctx.tick-state.roundStart;
    // The group's cadence slot: the arrival the planner aims at (firstArrivalSeconds after the round's first nominal at).
    const slotArrival=planner!.firstArrivalTicks+Math.round(at-cityAt0());
    // Tutorial: the group behind the team comes out of the wreck (behindWarn); the other one is aimed at the plaza.
    const tutorial=tutorialRound(ctx);
    if(tutorial&&index===TUTORIAL_BEHIND){dir.behindWarn(ctx,spawn,delay);return;}
    const chaseCost=cityChaseCost(ctx);
    const parts=planner!.planGroups([cityRequest(spawn.members,at,!!spawn.siege||tutorial)],viewers(ctx),state.avenues!,random(),
      {at0:cityAt0(),indexBase:index,nowTick:now+delay+warning,...(chaseCost?{chaseCost}:{})});
    let used=0;
    for(const part of parts){
      const members=spawn.members.slice(used,used+part.points.length);
      if(!members.length)continue;
      used+=members.length;
      const p=part.points[0],atTick=Math.max(state.roundStart+part.releaseTick,ctx.tick+delay+warning),warnTick=atTick-warning;
      const entry:PendingSpawn={...spawn,members,x:p.x,y:p.y,atTick,points:part.points.slice(0,members.length).map(q=>({x:q.x,y:q.y}))};
      // Behind its slot (released at the earliest tick and still late): its bodies run in (CITY_RUN_IN_SPEED).
      const late=atTick-state.roundStart+part.arrivalTick-part.releaseTick-slotArrival;
      if(late>0&&!chaseCost&&!tutorial)entry.late=late;
      if(warnTick>ctx.tick)entry.warnTick=warnTick;
      else ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:members.length});
      state.pending.push(entry);
    }
    if(used<spawn.members.length)dir.retryLater(ctx,{...spawn,members:spawn.members.slice(used)},delay);
  }
  /** Centers of the plaza goal cells, nearest to planner.plazaCenter first (ties: cell order); read once. */
  let plazaSpots:Point[]|undefined;
  /** Boss spot: the walkable plaza goal cell nearest the plaza center >= minPlayerDistance from every body, else the center. */
  function cityBossSpot(ctx:SimContext):Point{
    const field=planner!.plazaField,center=planner!.plazaCenter;
    if(!plazaSpots){
      const cells:{p:Point;d:number}[]=[];
      for(let cy=0;cy<field.height;cy++)for(let cx=0;cx<field.width;cx++){
        if(field.cellCost(cx,cy)!==0)continue;
        const p={x:field.originX+(cx+.5)*field.cellSize,y:field.originY+(cy+.5)*field.cellSize};
        cells.push({p,d:Math.hypot(p.x-center.x,p.y-center.y)});
      }
      plazaSpots=cells.sort((a,b)=>a.d-b.d).map(c=>c.p);
    }
    for(const p of plazaSpots)if(field.atGoal(p.x,p.y)&&walkable(p,enemyTerrain(ctx.terrain))&&nearestPlayer(ctx,p)>=minDistance)return {x:p.x,y:p.y};
    return {x:center.x,y:center.y};
  }
  /** Every member spot still hidden from every viewer and >= minPlayerDistance away (the planner's rule). */
  function cityHidden(ctx:SimContext,entry:PendingSpawn){
    const players=viewers(ctx);
    return (entry.points??[entry]).every(p=>planner!.hiddenFrom(players,p));
  }
  const requestOf=(entry:PendingSpawn):SpawnRequest=>({members:entry.members,elite:entry.elite,boss:entry.boss,side:entry.side,
    ...(entry.siege?{siege:true}:{}),...(entry.solo?{solo:true}:{}),...(entry.anchor!==undefined?{anchor:entry.anchor}:{}),...(entry.group!==undefined?{group:entry.group}:{}),
    ...(entry.tries!==undefined?{tries:entry.tries}:{})});
  const warnDue=(ctx:SimContext,p:PendingSpawn)=>p.warnTick!==undefined&&p.warnTick<=ctx.tick;
  /** Deferred warnings that are due: still hidden, the warning goes out; seen meanwhile, the part is planned again. */
  function cityWarnings(ctx:SimContext){
    if(!state.pending.some(p=>warnDue(ctx,p)))return;
    const due=state.pending.filter(p=>warnDue(ctx,p));
    state.pending=state.pending.filter(p=>!warnDue(ctx,p));
    for(const entry of due){
      if(!cityHidden(ctx,entry)){cityWarn(ctx,requestOf(entry),0);continue;}
      delete entry.warnTick;state.pending.push(entry);
      ctx.emit({type:'spawn-warning',x:entry.x,y:entry.y,atTick:entry.atTick,count:entry.members.length});
    }
  }
  /** The avenue end (the asset's spawn point) of a mouth. */
  function avenueEnd(ctx:SimContext,mouth:Mouth|undefined):Point|undefined{
    const points=mouth?cityTerrainOf(ctx.terrain)?.asset.points:undefined;
    return points&&mouth?points[`spawn${mouth}` as const]:undefined;
  }
  /**
   * City retreat: back up the avenues along the exit flow field (moveSafely: never through a building) at the island's
   * retreat pace; gone near the avenue end, at the field's goal or CITY_GONE_DISTANCE from the plaza, but only while
   * hidden from every viewer (planner.hiddenFrom); the FLEE_CAP_SECONDS cap removes it regardless (liveness: a player
   * camping at an avenue end must not keep a body alive forever).
   */
  function moveCityRetreats(ctx:SimContext){
    const players=viewers(ctx),plaza=planner!.plazaCenter;
    state.retreating=state.retreating.filter(r=>{
      const e=ctx.enemies.get(r.id);if(!e)return false;
      const step=Math.max(e.speed,1.5)*1.5/SIM_HZ;
      let via=planner!;
      const x0=e.x,y0=e.y;
      const stuck=()=>Math.hypot(e.x-x0,e.y-y0)<step*.25;
      /** One try: back to where it stood this tick, then a step along `p`'s exit field, its disc of radius `r`. */
      const tryWith=(p:AvenuePlanner,terrain:TerrainField,r:number)=>{
        e.x=x0;e.y=y0;p.retreatDirection(e,retreatDir);via=p;
        if(retreatDir.x||retreatDir.y)moveSafely(e,retreatDir.x*step,retreatDir.y*step,terrain,r);
        return !stuck();
      };
      // BUG-20261013-E8: the exit fields are hero-size; a body wider than the hero (an elite tio-pavê, 0.78) whose own
      // disc does not fit their way out (the strip north of mouth N) stood there until the liveness cap and held the
      // round open. Still stuck, it squeezes by the hero rule (like the steer's `fit`, E1).
      // Trapped (BUG-…-recuo-parado-na-praca): no exit on the enemy grid, or the way out is a standing barricade the body
      // cannot pass. It walks out over the barricades (harmless, damage 0) on the barricade-free planner and the base
      // terrain, instead of standing in the plaza until the cap.
      // Order (balanco-pos-1-7 part B, the elite Trio Elétrico, 1.03, stuck in the plaza): the planner's own field first,
      // at the body's radius and then squeezed, and only then the barricade-free planner. That planner may lead to
      // ANOTHER mouth, so a wide body that grazed a planter for one tick on its way (its own disc blocked, the hero's
      // not) was sent back the other way, then forth again: a 3-tick shuffle in place until the 60 s cap.
      const wide=e.radius>RADIUS,open=options.cityOpenPlanner,enemies=enemyTerrain(ctx.terrain);
      if(!tryWith(planner!,enemies,e.radius)&&!(wide&&tryWith(planner!,enemies,RADIUS))&&open
        &&!tryWith(open,ctx.terrain,e.radius)&&wide)tryWith(open,ctx.terrain,RADIUS);
      const end=avenueEnd(ctx,via.retreatMouth(e));
      if(end){r.x=end.x;r.y=end.y;}
      // Never vanishes in sight (v2): every exit needs it hidden from every viewer; only the liveness cap ignores that.
      const out=!!end&&Math.hypot(end.x-e.x,end.y-e.y)<=CITY_EXIT_REACH||via.exitField.atGoal(e.x,e.y)
        ||Math.hypot(e.x-plaza.x,e.y-plaza.y)>=CITY_GONE_DISTANCE;
      const gone=out&&planner!.hiddenFrom(players,e)||ctx.tick>=r.untilTick;
      if(gone){ctx.enemies.delete(r.id);state.retreated++;return false;}
      return true;
    });
  }
  return {cityRunIn,cityAt0,cityRequest,citySpeedOf,planCity,cityTeamField,cityWarn,cityHidden,requestOf,cityWarnings,moveCityRetreats};
}
