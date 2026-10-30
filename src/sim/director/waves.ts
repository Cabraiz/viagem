/**
 * The director's round loop (director.ts module doc): groups dispatched and warned, spawned at their tick, the round
 * started and ended, the retreats on timeout and the D-047 waves after the last round. Moved out of director.ts as is
 * (corte C1).
 */
import type {SimContext} from '../context.ts';
import {type Point,clearSegment,enemyTerrain,walkable,worldBase} from '../../maps/index.ts';
import {RING_OUTER,Rng,SIM_HZ,offscreenDistance,ticks} from '../../contract/index.ts';
import {applyCityBalance,roundKnobs} from '../city/balance.ts';
import {CIDADE_TUTORIAL,ELITE_SIZE,RETREAT_LINES,ROUND_NAMES,type RoundPlan,type RoundTheme,type SpawnGroup,drawTheme,planRound,roleOf,roundRoster} from '../../rules/index.ts';
import {TUTORIAL_WELCOME,tutorialPlan} from '../city/tutorial.ts';
import {SIEGE_FLAG} from '../stonewards/wall.ts';
import {PLAZA_HOLD_FLAG} from '../city/grid.ts';
import {BAND_CADENCE,BAND_DAMAGE,enemyDef} from '../enemies/catalog.ts';
import type {DirectorCtx,PendingSpawn,RoundSummary,SpawnRequest,WavesPart} from './types.ts';
import {EXTRA_WAVE_COUNT,FLEE_CAP_SECONDS,FLEE_SPEED,FLEE_TIME_FACTOR,LAST_CALL_SECONDS,LINE_GAP,MEMBER_CLEARANCE,RUN_IN,SPAWN_MARGIN,SURROUND_SIDES} from './tuning.ts';
import {nearestPlayer} from './spawn-points.ts';

/** D-047 waves (DirectorOptions.endlessWaves): the plan of `table` without its boss group, as wave `index`; it retreats on timeout. */
function withoutBoss(plan:RoundPlan,index:number):RoundPlan{
  if(!plan.boss&&plan.index===index)return plan;
  const groups=plan.groups.filter(g=>!g.boss);
  return {...plan,index,groups,total:groups.reduce((n,g)=>n+g.members.length,0),boss:false,retreat:true};
}
/** D-047 waves from the last round on: a regular round name not used yet this run (any when all were), no modifier. */
function wavesTheme(rng:Rng,used:readonly string[]):RoundTheme{
  const names=ROUND_NAMES.filter(n=>!used.includes(n));
  return {name:rng.pick(names.length?names:ROUND_NAMES)};
}

export function wavesPart(dir:DirectorCtx):WavesPart{
  const {maxEnemies,intermission,warning,minDistance,retreatTicks,total,siegeShare,random,save,scalePlayers,endless,planner,city,tutorialRound,options,state}=dir;
  /** Side of the n-th group: the plan's side, flipped every other group when the modifier alternates. */
  function sideFor(index:number){
    const plan=state.plan;
    if(plan?.side===undefined)return undefined;
    return plan.alternate&&index%2?plan.side+Math.PI:plan.side;
  }

  /** Where a group goes: the coast on the island; endless, a hidden ring spot (undefined: try again in a second). */
  function locate(ctx:SimContext,spawn:SpawnRequest):{point:Point;anchor?:string}|undefined{
    return endless(ctx)?dir.locateEndless(ctx,spawn):{point:dir.pickPoint(ctx,spawn.side)};
  }
  /** Retry entry for a group with no hidden spot yet: no warning (nothing to show), counted as pending. */
  function retryLater(ctx:SimContext,spawn:SpawnRequest,delay:number){
    const at=spawn.anchor!==undefined?ctx.players.get(spawn.anchor):undefined,base=at??worldBase(ctx.terrain);
    state.pending.push({...spawn,retry:true,x:base.x,y:base.y,atTick:ctx.tick+SIM_HZ+delay});
  }

  function warn(ctx:SimContext,spawn:SpawnRequest,delay=0){
    if(city(ctx)){dir.cityWarn(ctx,spawn,delay);return;}
    const found=locate(ctx,spawn);
    if(!found){retryLater(ctx,spawn,delay);return;}
    const p=found.point;
    const entry:PendingSpawn={...spawn,...(found.anchor!==undefined?{anchor:found.anchor}:{}),x:p.x,y:p.y,atTick:ctx.tick+warning+delay};
    state.pending.push(entry);dir.serve(found.anchor,spawn.members.length);
    ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:entry.atTick,count:spawn.members.length});
  }

  /** Regular groups flagged by the plan or picked by siegeShare (every 1/share-th group, no rng). */
  const siegeFrom=options.siegeFromRound??1;
  // City (cidade-11): a round's siegeShare knob replaces the option's. state.avenues marks a city run (set from round 1
  // on, JSON-safe, never on the island or in the endless world even with a planner passed in); round 1 is neutral.
  // The team-size knobs read the count the round was planned with (state.plan.players), never a later sample.
  const shareOf=(round:number)=>options.cityBalance&&state.avenues?roundKnobs(options.cityBalance,round,state.plan?.players).siegeShare??siegeShare:siegeShare;
  const isSiege=(group:SpawnGroup,index:number)=>{
    if(group.siege)return true;
    const round=state.plan?.index??0,share=shareOf(round);
    return share>0&&round>=siegeFrom&&Math.floor((index+1)*share)>Math.floor(index*share);
  };

  function dispatch(ctx:SimContext,group:SpawnGroup,index:number){
    const side=sideFor(index),special=!group.boss&&!group.elite&&!group.solo,siege=special&&isSiege(group,index);
    const flag=siege?{siege:true}:group.solo?{solo:true}:{};
    // City: one request per group; the planner lays it out along the avenue (cerco splits it over the 4 mouths).
    if(city(ctx)){warn(ctx,{members:[...group.members],elite:group.elite,boss:group.boss,group:index,...flag});return;}
    if(special&&group.formation==='surround'&&group.members.length>1){
      // Surround: the group splits and arrives from evenly spaced sides at once (endless: around one player).
      const parts=Math.min(SURROUND_SIDES,group.members.length),base=side??random().range(0,Math.PI*2);
      const anchors=endless(ctx)&&!siege?dir.anchorsOf(ctx):[];
      const anchor=anchors.length?{anchor:dir.chooseAnchor(ctx,anchors).id}:{};
      for(let i=0;i<parts;i++)warn(ctx,{members:group.members.filter((_,j)=>j%parts===i),side:base+i*Math.PI*2/parts,...flag,...anchor});
      return;
    }
    if(special&&group.formation==='line'){
      // Single file: the same point, one enemy every LINE_GAP ticks.
      const found=locate(ctx,{members:group.members,side,...flag});
      if(!found){retryLater(ctx,{members:[...group.members],side,...flag},0);return;}
      const p=found.point,anchor=found.anchor!==undefined?{anchor:found.anchor}:{};
      dir.serve(found.anchor,group.members.length);
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:ctx.tick+warning,count:group.members.length});
      group.members.forEach((kind,i)=>state.pending.push({members:[kind],side,...flag,...anchor,x:p.x,y:p.y,atTick:ctx.tick+warning+i*LINE_GAP}));
      return;
    }
    warn(ctx,{members:[...group.members],elite:group.elite,boss:group.boss,side,...flag});
  }

  function placeInGroup(ctx:SimContext,center:Point,i:number):Point{
    if(i===0)return center;
    for(let attempt=0;attempt<4;attempt++){
      const r=.45*Math.sqrt(i+attempt*.5),a=i*2.39996+attempt*1.3;
      const p={x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r};
      const ok=endless(ctx)?ctx.terrain.chunks!.clear(p.x,p.y,MEMBER_CLEARANCE)&&dir.hiddenBy(ctx,p,SPAWN_MARGIN):nearestPlayer(ctx,p)>=minDistance;
      const ground=enemyTerrain(ctx.terrain);
      if(walkable(p,ground)&&clearSegment(center,p,ground)&&ok)return p;
    }
    return center;
  }

  function spawnPending(ctx:SimContext,entry:PendingSpawn){
    const plan=state.plan!;
    const center={x:entry.x,y:entry.y};
    const request=dir.requestOf(entry),isCity=city(ctx);
    // Endless: no hidden spot was found earlier, or a player now sees the warned one. Island: a player walked onto it.
    // City: a viewer now sees (or stands near) a member's spot. Either way, warn again somewhere else.
    // City boss (in the plaza, in sight by design): only a player standing on its spot moves it.
    if(entry.retry||(isCity?entry.boss?nearestPlayer(ctx,center)<minDistance:!dir.cityHidden(ctx,entry):endless(ctx)?!dir.hiddenBy(ctx,center,SPAWN_MARGIN):nearestPlayer(ctx,center)<minDistance)){warn(ctx,request);return;}
    if(entry.boss){
      const before=new Set(ctx.enemies.keys());
      // Without VGM-038 the catalog's 'chefe' stands in, so the final round still has a boss to beat.
      const boss=options.spawnBoss?options.spawnBoss(ctx,center):options.createEnemy(ctx,'chefe',center,plan.eliteHp);
      if(boss){
        if(!ctx.enemies.has(boss.id))ctx.enemies.set(boss.id,boss);
        boss.boss=true;state.bossId=boss.id;
      }
      for(const e of ctx.enemies.values())if(!before.has(e.id)&&(e.boss||e.id===boss?.id)){state.tracked.push(e.id);state.bossId??=e.id;state.spawned++;}
      return;
    }
    const room=Math.max(0,maxEnemies-ctx.enemies.size),count=Math.min(entry.members.length,room);
    for(let i=0;i<count;i++){
      // City: the planner's exact spot (walkable, hidden, outside the base); no jitter.
      const p=isCity&&entry.points?.[i]?entry.points[i]:placeInGroup(ctx,center,i);
      // A borrowed entry (art only, decision D) plays at its band's numbers: hp here, damage and cadence via its memory.
      const tune=!entry.elite&&!entry.solo&&plan.borrowed?.roles.includes(roleOf(entry.members[i])!)?plan.borrowed.tune:undefined;
      const enemy=options.createEnemy(ctx,entry.members[i],p,(entry.elite?plan.eliteHp:entry.solo?plan.miniHp??plan.eliteHp:plan.hp)*(tune?.hp??1));
      if(!enemy)continue;
      if(!ctx.enemies.has(enemy.id))ctx.enemies.set(enemy.id,enemy);
      if(entry.andar===1)enemy.andar=1;
      enemy.speed*=plan.speed;enemy.radius*=plan.size*(entry.elite?ELITE_SIZE:1);

      // City (cidade-05c v2): the one conversion to the city's speeds, on the effective speed (after plan.speed).
      if(isCity)enemy.speed=dir.citySpeedOf(enemy.speed);
      if(entry.elite)enemy.elite=true;
      // Tutorial (cidade-08): the plaza group holds the plaza until a hero comes (citySteer PLAZA_HOLD_FLAG).
      const holds=entry.group===TUTORIAL_WELCOME&&tutorialRound(ctx);
      enemy.memory={...enemy.memory,round:plan.index,...(entry.siege?{[SIEGE_FLAG]:1}:{}),...(holds?{[PLAZA_HOLD_FLAG]:1}:{}),
        // City run-in budget (u): what its own pace covers in the ticks the part is late (CITY_RUN_IN_SPEED).
        ...(isCity&&entry.late&&enemy.speed>0?{[RUN_IN]:entry.late/SIM_HZ*enemy.speed}:{}),
        ...(tune?{[BAND_DAMAGE]:tune.damage,[BAND_CADENCE]:tune.cadence}:{})};
      state.tracked.push(enemy.id);state.spawned++;
    }
    // Enemy cap reached: the rest comes a second later, with a fresh warning.
    if(count<entry.members.length)warn(ctx,{...request,members:entry.members.slice(count)},SIM_HZ);
  }

  function startPrepare(ctx:SimContext,index:number,duration:number){
    state.stage='prepare';
    // cidade-08: the city's round 1 is the tutorial walk, with its own name and banner line (no draw).
    if(index===1&&options.cityTutorial&&city(ctx))state.tutorial??={};
    const theme=state.theme=tutorialRound(ctx,index)?{name:CIDADE_TUTORIAL.roundName,modifierLabel:CIDADE_TUTORIAL.modifier}
      :options.endlessWaves&&index>=total?wavesTheme(random(),state.usedNames):drawTheme(index,random(),state.usedNames);
    state.usedNames.push(theme.name);if(theme.modifierId)state.usedNames.push(theme.modifierId);
    save();
    Object.assign(ctx.round,{index,total,phase:'prepare',phaseEndsTick:ctx.tick+duration,remaining:0});
    ctx.emit({type:'round',index,phase:'prepare',name:theme.name,modifier:theme.modifierLabel});
  }

  function startWave(ctx:SimContext){
    const index=ctx.round.index,theme=state.theme!;
    const tutorial=tutorialRound(ctx);
    // D-047 extra waves: the last round's table (its roster, plan and knobs), with the wave's own index.
    const table=options.endlessWaves?Math.min(index,total):index,extra=index-table;
    const roster=state.rotation?roundRoster(state.rotation,table):undefined;
    // Art only (a short rotation): the tutorial's slow group is the round's fodder with art (the rats), not the bêbado.
    const fodder=roster?.short?roster.roles.corredor??roster.roles.enxame:undefined;
    let plan=tutorial?tutorialPlan(scalePlayers(ctx),planner!.firstArrivalTicks,fodder):planRound(table,scalePlayers(ctx),theme,random(),roster,options.cityBalance?.roleCap&&city(ctx)?{roleCap:options.cityBalance.roleCap}:undefined);
    if(options.endlessWaves&&!tutorial)plan=withoutBoss(plan,index);
    // The tutorial's pace is the bêbado's (TUTORIAL_PLAN.speed on his catalog speed): other fodder walks at it too.
    if(tutorial&&fodder?.length)plan={...plan,speed:plan.speed*enemyDef('bebado').speed/enemyDef(fodder[0]).speed};
    // City knobs (cidade-11, city/balance.ts) on the table's plan: never the tutorial; neutral knobs keep `plan` itself.
    // The team-size knobs (CityBalance.players) are keyed by plan.players: the scalePlayers count planRound scaled with.
    if(!tutorial&&options.cityBalance&&city(ctx))plan=applyCityBalance(plan,roundKnobs(options.cityBalance,table,plan.players));
    if(extra>0)plan=applyCityBalance(plan,{count:EXTRA_WAVE_COUNT**extra,hp:1,cadence:1});
    save();
    Object.assign(state,{stage:'wave',plan,roundStart:ctx.tick,nextGroup:0,pending:[],tracked:[],bossId:undefined,retreating:[],spawned:0,retreated:0,timedOut:false},
      endless(ctx)?{recycled:0,served:{},called:false}:{});
    Object.assign(ctx.round,{phase:'wave',phaseEndsTick:ctx.tick+plan.durationTicks,remaining:plan.total});
    if(city(ctx))dir.planCity(ctx);
    ctx.emit({type:'round',index,phase:'wave',name:theme.name,modifier:theme.modifierLabel});
  }

  /** Cancels what has not spawned and walks the survivors back into the sea (endless: off screen, away from the nearest player). */
  function beginRetreat(ctx:SimContext,timedOut:boolean){
    state.timedOut=timedOut;state.nextGroup=state.plan!.groups.length;state.pending=[];
    let barked=false;
    const isEndless=endless(ctx),anchors=isEndless?dir.anchorsOf(ctx):[],isCity=city(ctx);
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);if(!e||state.retreating.some(r=>r.id===id))continue;
      if(isCity){
        // City: back up the avenues (moveCityRetreats), which keeps the avenue end it is heading to in x/y.
        e.memory={...e.memory,retreat:1};e.damage=0;
        state.retreating.push({id,x:e.x,y:e.y,untilTick:ctx.tick+ticks(FLEE_CAP_SECONDS)});
        if(!barked){barked=true;ctx.emit({type:'bark',enemy:id,line:random().pick(RETREAT_LINES)});save();}
        continue;
      }
      let target:Point,until=ctx.tick+retreatTicks;
      const from=isEndless?dir.nearestOf(anchors,e).player??worldBase(ctx.terrain):worldBase(ctx.terrain);
      const dx=e.x-from.x,dy=e.y-from.y,len=Math.hypot(dx,dy);
      if(isEndless){
        // Flee straight away from the nearest player to just past the edge of every screen.
        const ux=len>1e-6?dx/len:1,uy=len>1e-6?dy/len:0;
        const d=offscreenDistance(ux,uy)+RING_OUTER;
        target={x:from.x+ux*d,y:from.y+uy*d};until=ctx.tick+retreatTicks*FLEE_TIME_FACTOR;
      }else target={x:from.x+dx/(len||1)*14,y:from.y+dy/(len||1)*14};
      // Enemy AI (VGM-031) must leave enemies with memory.retreat alone; the director moves them.
      e.memory={...e.memory,retreat:1};e.damage=0;
      state.retreating.push({id,x:target.x,y:target.y,untilTick:until,...(isEndless?{capTick:ctx.tick+ticks(FLEE_CAP_SECONDS)}:{})});
      if(!barked){barked=true;ctx.emit({type:'bark',enemy:id,line:random().pick(RETREAT_LINES)});save();}
    }
  }

  function moveRetreats(ctx:SimContext){
    if(city(ctx)){dir.moveCityRetreats(ctx);return;}
    const isEndless=endless(ctx);
    state.retreating=state.retreating.filter(r=>{
      const e=ctx.enemies.get(r.id);if(!e)return false;
      const speed=isEndless?Math.max(e.speed*2.5,FLEE_SPEED):Math.max(e.speed,1.5)*1.5;
      const step=speed/SIM_HZ,dx=r.x-e.x,dy=r.y-e.y,len=Math.hypot(dx,dy);
      if(len>step){e.x+=dx/len*step;e.y+=dy/len*step;}
      if(isEndless){
        if(dir.hidden(ctx,e)||ctx.tick>=(r.capTick??r.untilTick)){ctx.enemies.delete(r.id);state.retreated++;return false;}
        // Out of time but on someone's screen: never vanish in view. Keep fleeing, with a fresh target once there.
        if(len<=step){
          const anchors=dir.anchorsOf(ctx),from=dir.nearestOf(anchors,e).player;
          const ax=from?e.x-from.x:1,ay=from?e.y-from.y:0,al=Math.hypot(ax,ay)||1,ux=ax/al,uy=ay/al;
          const d=offscreenDistance(ux,uy)+RING_OUTER;
          r.x=(from?.x??e.x)+ux*d;r.y=(from?.y??e.y)+uy*d;
        }
        return true;
      }
      if(ctx.tick>=r.untilTick||ctx.terrain.coast(e.x,e.y)<-.3){ctx.enemies.delete(r.id);state.retreated++;return false;}
      return true;
    });
  }

  function endRound(ctx:SimContext){
    const plan=state.plan!,theme=state.theme!;
    ctx.round.remaining=0;
    ctx.emit({type:'round',index:plan.index,phase:'end',name:theme.name,modifier:theme.modifierLabel});
    const summary:RoundSummary={index:plan.index,total,name:theme.name,modifier:theme.modifierLabel,spawned:state.spawned,retreated:state.retreated,timedOut:state.timedOut,
      ...(state.recycled!==undefined?{recycled:state.recycled}:{})};
    if(plan.index>=total&&!options.endlessWaves){state.stage='done';options.onRoundEnd?.(ctx,summary);return;}
    // Enter the intermission first, so the round-end offers see its deadline in ctx.round and the summary.
    startPrepare(ctx,plan.index+1,intermission);
    options.onRoundEnd?.(ctx,{...summary,intermissionEndsTick:ctx.round.phaseEndsTick});
    const next=state.theme!;
    options.onIntermission?.(ctx,{index:plan.index+1,name:next.name,modifier:next.modifierLabel,endsTick:ctx.round.phaseEndsTick});
  }

  function stepWave(ctx:SimContext){
    const plan=state.plan!,elapsed=ctx.tick-state.roundStart;
    // City: groups go out at their warning tick (planCity), in that order.
    const order=city(ctx)?state.cityOrder:undefined,slot=(i:number)=>order?.[i]??i;
    const dueAt=(i:number)=>order?state.cityWarn?.[i]??plan.groups[i].at:plan.groups[i].at;
    while(state.nextGroup<plan.groups.length&&dueAt(slot(state.nextGroup))<=elapsed){const i=slot(state.nextGroup);dispatch(ctx,plan.groups[i],i);state.nextGroup++;}
    if(order)dir.cityWarnings(ctx);
    const due=state.pending.filter(p=>p.atTick<=ctx.tick);
    state.pending=state.pending.filter(p=>p.atTick>ctx.tick);
    for(const entry of due)spawnPending(ctx,entry);
    if(endless(ctx)){
      // Last call (see LAST_CALL_SECONDS): every group of a regular round is out, nothing is waiting for a spot.
      if(!state.called&&plan.retreat&&!state.timedOut&&state.nextGroup>=plan.groups.length&&!state.pending.length){
        state.called=true;ctx.round.phaseEndsTick=Math.max(ctx.round.phaseEndsTick,ctx.tick+ticks(LAST_CALL_SECONDS));
      }
      dir.recycle(ctx);dir.catchUp(ctx);
    }
    if(order&&!tutorialRound(ctx))dir.cityRunIn(ctx);
    save();
    const alive=()=>{state.tracked=state.tracked.filter(id=>ctx.enemies.has(id));};
    alive();
    if(!state.timedOut&&plan.retreat&&ctx.tick>=ctx.round.phaseEndsTick)beginRetreat(ctx,true);
    // The boss fell: escorts give up.
    if(plan.boss&&state.bossId&&!ctx.enemies.has(state.bossId)&&state.tracked.length>state.retreating.length)beginRetreat(ctx,false);
    if(state.retreating.length){moveRetreats(ctx);alive();}
    let queued=0;
    for(let i=state.nextGroup;i<plan.groups.length;i++)queued+=plan.groups[slot(i)].members.length;
    for(const p of state.pending)queued+=p.members.length;
    ctx.round.remaining=queued+state.tracked.length;
    // Tutorial: the walk is the round; it ends with the horde down once a hero reached the plaza (or at the cap).
    const tutorial=tutorialRound(ctx);
    if(tutorial)dir.tutorialArrival(ctx);
    if(!ctx.round.remaining&&(!tutorial||state.tutorial!.arrived!==undefined||state.timedOut))endRound(ctx);
  }
  return {retryLater,isSiege,startPrepare,startWave,stepWave};
}
