/**
 * Round director (VGM-033): wave -> round-end -> intermission ('prepare') -> next wave, for ROUND_COUNT rounds.
 * Owns ctx.round. Enemy creation, the boss and offers come from other cards through injected callbacks,
 * so this module only depends on the shared contract, terrain and collision helpers.
 */
import type {TerrainField} from '../terrain/field.ts';
import {clearSegment,walkable,worldBase,worldSpawn,type Point} from '../world.ts';
import {MAX_ENEMIES} from './budget.ts';
import {Rng} from './rng.ts';
import {SIM_HZ,ticks,type EnemyState,type RoundState,type SimContext,type SimPlayer,type SimSystem} from './types.ts';
import {ELITE_SIZE,RETREAT_LINES,ROUND_COUNT,drawTheme,planRound,type RoundPlan,type RoundTheme,type SpawnGroup} from './waves.ts';

/** Builds an enemy of a catalog kind at a point with an hp multiplier (VGM-031). May insert it into ctx.enemies itself. */
export type CreateEnemy=(ctx:SimContext,kind:string,point:Point,scale:number)=>EnemyState|undefined;
/** Spawns the final boss (VGM-038). The point is a suggestion on the coast; return the boss or let it be found by `boss: true`. */
export type SpawnBoss=(ctx:SimContext,point:Point)=>EnemyState|undefined|void;
export interface RoundSummary {
  index:number;total:number;name:string;modifier?:string;spawned:number;retreated:number;timedOut:boolean;
  /** End of the intermission that follows (offer deadline); absent after the final round. */
  intermissionEndsTick?:number;
}
export interface DirectorOptions {
  createEnemy:CreateEnemy;
  spawnBoss?:SpawnBoss;
  /** Fired exactly once when a round's horde is gone; wire to grantRoundOffers(ctx, round, summary.intermissionEndsTick) (D-008). */
  onRoundEnd?:(ctx:SimContext,round:RoundSummary)=>void;
  /** Fired when the intermission before `next` starts (not before round 1). */
  onIntermission?:(ctx:SimContext,next:{index:number;name:string;modifier?:string;endsTick:number})=>void;
  maxEnemies?:number;
  intermissionSeconds?:number;
  openingSeconds?:number;
  warningSeconds?:number;
  /** Minimum distance between a spawn point and any player in the world. */
  minPlayerDistance?:number;
  /** Longest a timed-out enemy keeps walking to the sea before it is removed. */
  retreatSeconds?:number;
  rounds?:number;
}

/** side: angle the group must come from (single-side, alternating and surround modifiers); kept on re-warns. */
interface PendingSpawn {members:string[];elite?:boolean;boss?:boolean;side?:number;x:number;y:number;atTick:number}
interface Retreat {id:string;x:number;y:number;untilTick:number}
/** JSON-safe director state, so a room checkpoint (VGM-047) can store and restore it. */
export interface DirectorState {
  stage:'idle'|'prepare'|'wave'|'done';
  rng:number;
  roundStart:number;
  theme?:RoundTheme;
  plan?:RoundPlan;
  nextGroup:number;
  pending:PendingSpawn[];
  tracked:string[];
  bossId?:string;
  retreating:Retreat[];
  spawned:number;
  retreated:number;
  timedOut:boolean;
  /** Active player count sampled once per second, newest last, at most 60 samples. */
  samples:number[];
  usedNames:string[];
  /** Copy of ctx.round after the last step; written back into a fresh context after a restore. */
  round:RoundState;
}

export interface Director extends SimSystem {
  readonly state:DirectorState;
  /** Highest active player count of the last minute (1..6), used for budget and hp. */
  scalePlayers(ctx:SimContext):number;
}

const BAND_MAX=2.2;
const LINE_GAP=ticks(.3);
const SURROUND_SIDES=4;

export function activePlayers(ctx:SimContext){
  let n=0;for(const p of ctx.players.values())if(p.online&&!p.spectator&&!p.eliminated)n++;
  return n;
}
const blocking=(p:SimPlayer)=>!p.spectator&&!p.eliminated;

/** True while the endless world spawns on the fixed ring by the base (see coastalSpawnPoints): not playable. */
export const ENDLESS_SPAWN_STOPGAP=true;

const candidateCache=new WeakMap<TerrainField,Point[]>();
/**
 * Coastal spawn candidates: half-unit grid nodes that are walkable, lie within BAND_MAX of the shoreline
 * and connect to the island interior (SPAWN) through clear segments. Cached per terrain field.
 * Endless world (stopgap until NEW-20261009-ORQ-spawn-em-volta): the same 24×24 grid around the base,
 * and the "coastal band" is the outer BAND_MAX of the ring of radius 12 around it.
 * **This makes the endless world NOT playable**: enemies only ever spawn by the base, so a player who runs
 * away is never reached. `Simulation` refuses 'infinito' unless `experimental: true` (ENDLESS_SPAWN_STOPGAP).
 */
export function coastalSpawnPoints(terrain:TerrainField):Point[]{
  const cached=candidateCache.get(terrain);if(cached)return cached;
  const base=worldBase(terrain),spawn=worldSpawn(terrain),half=12,ox=base.x-half,oy=base.y-half;
  const step=.5,size=49,at=(id:number):Point=>({x:ox+(id%size)*step,y:oy+Math.floor(id/size)*step});
  const open=new Uint8Array(size*size);
  for(let id=0;id<open.length;id++)open[id]=walkable(at(id),terrain)?1:0;
  const start=Math.round((spawn.y-oy)/step)*size+Math.round((spawn.x-ox)/step);
  const seen=new Uint8Array(size*size),queue=[start];seen[start]=1;
  for(let head=0;head<queue.length;head++){
    const id=queue[head],x=id%size,y=Math.floor(id/size);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy,next=ny*size+nx;
      if((!dx&&!dy)||nx<0||ny<0||nx>=size||ny>=size||seen[next]||!open[next])continue;
      if(!clearSegment(at(id),at(next),terrain))continue;
      seen[next]=1;queue.push(next);
    }
  }
  // ENDLESS_SPAWN_STOPGAP: a fixed ring around the base, so whoever runs away is never reached.
  const inner=(half-BAND_MAX)*(half-BAND_MAX),outer=half*half;
  const band=terrain.chunks?(p:Point)=>{const dx=p.x-base.x,dy=p.y-base.y,d2=dx*dx+dy*dy;return d2>=inner&&d2<=outer;}:(p:Point)=>terrain.coast(p.x,p.y)<=BAND_MAX;
  const points=queue.map(at).filter(band);
  candidateCache.set(terrain,points);
  return points;
}

function nearestPlayer(ctx:SimContext,p:Point){
  let best=Infinity;
  for(const pl of ctx.players.values())if(blocking(pl))best=Math.min(best,Math.hypot(pl.x-p.x,pl.y-p.y));
  return best;
}

export function createDirector(options:DirectorOptions,restore?:DirectorState):Director{
  const maxEnemies=options.maxEnemies??MAX_ENEMIES;
  const intermission=ticks(options.intermissionSeconds??20),opening=ticks(options.openingSeconds??3);
  const warning=ticks(options.warningSeconds??1.5),minDistance=options.minPlayerDistance??4;
  const retreatTicks=ticks(options.retreatSeconds??3),total=Math.min(options.rounds??ROUND_COUNT,ROUND_COUNT);
  const state:DirectorState=restore?structuredClone(restore):{
    stage:'idle',rng:0,roundStart:0,nextGroup:0,pending:[],tracked:[],retreating:[],
    spawned:0,retreated:0,timedOut:false,samples:[],usedNames:[],round:{index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0},
  };
  let rng:Rng|undefined=restore&&restore.stage!=='idle'?new Rng(restore.rng):undefined;
  let restored=!!restore;
  const random=()=>rng!;
  const save=()=>{state.rng=rng!.state;};

  const scalePlayers=(ctx:SimContext)=>Math.max(1,Math.min(6,Math.max(activePlayers(ctx),...state.samples)));

  function sample(ctx:SimContext){
    if(ctx.tick%SIM_HZ!==0)return;
    state.samples.push(activePlayers(ctx));
    if(state.samples.length>60)state.samples.shift();
  }

  function pickPoint(ctx:SimContext,side?:number):Point{
    const all=coastalSpawnPoints(ctx.terrain);
    if(!all.length)throw new Error('terrain has no coastal spawn point');
    const center=worldBase(ctx.terrain);
    const inSide=side===undefined?all:all.filter(p=>{
      const d=Math.atan2(p.y-center.y,p.x-center.x)-side;
      return Math.cos(d)>Math.cos(Math.PI/3);
    });
    const pool=inSide.length?inSide:all;
    const safe=pool.filter(p=>nearestPlayer(ctx,p)>=minDistance);
    if(safe.length)return random().pick(safe);
    const fallback=all.filter(p=>nearestPlayer(ctx,p)>=minDistance);
    if(fallback.length)return random().pick(fallback);
    // Players cover every coastal point: use the farthest one, never a point under a player.
    return all.reduce((a,b)=>nearestPlayer(ctx,b)>nearestPlayer(ctx,a)?b:a);
  }

  /** Side of the n-th group: the plan's side, flipped every other group when the modifier alternates. */
  function sideFor(index:number){
    const plan=state.plan;
    if(plan?.side===undefined)return undefined;
    return plan.alternate&&index%2?plan.side+Math.PI:plan.side;
  }

  function warn(ctx:SimContext,spawn:Omit<PendingSpawn,'x'|'y'|'atTick'>,delay=0){
    const p=pickPoint(ctx,spawn.side);
    const entry:PendingSpawn={...spawn,x:p.x,y:p.y,atTick:ctx.tick+warning+delay};
    state.pending.push(entry);
    ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:entry.atTick,count:spawn.members.length});
  }

  function dispatch(ctx:SimContext,group:SpawnGroup,index:number){
    const side=sideFor(index),special=!group.boss&&!group.elite;
    if(special&&group.formation==='surround'&&group.members.length>1){
      // Surround: the group splits and arrives from evenly spaced sides at once.
      const parts=Math.min(SURROUND_SIDES,group.members.length),base=side??random().range(0,Math.PI*2);
      for(let i=0;i<parts;i++)warn(ctx,{members:group.members.filter((_,j)=>j%parts===i),side:base+i*Math.PI*2/parts});
      return;
    }
    if(special&&group.formation==='line'){
      // Single file: the same point, one enemy every LINE_GAP ticks.
      const p=pickPoint(ctx,side);
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:ctx.tick+warning,count:group.members.length});
      group.members.forEach((kind,i)=>state.pending.push({members:[kind],side,x:p.x,y:p.y,atTick:ctx.tick+warning+i*LINE_GAP}));
      return;
    }
    warn(ctx,{members:[...group.members],elite:group.elite,boss:group.boss,side});
  }

  function placeInGroup(ctx:SimContext,center:Point,i:number):Point{
    if(i===0)return center;
    for(let attempt=0;attempt<4;attempt++){
      const r=.45*Math.sqrt(i+attempt*.5),a=i*2.39996+attempt*1.3;
      const p={x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r};
      if(walkable(p,ctx.terrain)&&clearSegment(center,p,ctx.terrain)&&nearestPlayer(ctx,p)>=minDistance)return p;
    }
    return center;
  }

  function spawnPending(ctx:SimContext,entry:PendingSpawn){
    const plan=state.plan!;
    const center={x:entry.x,y:entry.y};
    // A player walked onto the warned point: warn again somewhere else.
    if(nearestPlayer(ctx,center)<minDistance){warn(ctx,{members:entry.members,elite:entry.elite,boss:entry.boss,side:entry.side});return;}
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
      const p=placeInGroup(ctx,center,i);
      const enemy=options.createEnemy(ctx,entry.members[i],p,entry.elite?plan.eliteHp:plan.hp);
      if(!enemy)continue;
      if(!ctx.enemies.has(enemy.id))ctx.enemies.set(enemy.id,enemy);
      enemy.speed*=plan.speed;enemy.radius*=plan.size*(entry.elite?ELITE_SIZE:1);
      if(entry.elite)enemy.elite=true;
      enemy.memory={...enemy.memory,round:plan.index};
      state.tracked.push(enemy.id);state.spawned++;
    }
    // Enemy cap reached: the rest comes a second later, with a fresh warning.
    if(count<entry.members.length)warn(ctx,{members:entry.members.slice(count),elite:entry.elite,side:entry.side},SIM_HZ);
  }

  function startPrepare(ctx:SimContext,index:number,duration:number){
    state.stage='prepare';
    const theme=state.theme=drawTheme(index,random(),state.usedNames);
    state.usedNames.push(theme.name);if(theme.modifierId)state.usedNames.push(theme.modifierId);
    save();
    Object.assign(ctx.round,{index,total,phase:'prepare',phaseEndsTick:ctx.tick+duration,remaining:0});
    ctx.emit({type:'round',index,phase:'prepare',name:theme.name,modifier:theme.modifierLabel});
  }

  function startWave(ctx:SimContext){
    const index=ctx.round.index,theme=state.theme!;
    const plan=planRound(index,scalePlayers(ctx),theme,random());
    save();
    Object.assign(state,{stage:'wave',plan,roundStart:ctx.tick,nextGroup:0,pending:[],tracked:[],bossId:undefined,retreating:[],spawned:0,retreated:0,timedOut:false});
    Object.assign(ctx.round,{phase:'wave',phaseEndsTick:ctx.tick+plan.durationTicks,remaining:plan.total});
    ctx.emit({type:'round',index,phase:'wave',name:theme.name,modifier:theme.modifierLabel});
  }

  /** Cancels what has not spawned and walks the survivors back into the sea. */
  function beginRetreat(ctx:SimContext,timedOut:boolean){
    state.timedOut=timedOut;state.nextGroup=state.plan!.groups.length;state.pending=[];
    let barked=false;
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);if(!e||state.retreating.some(r=>r.id===id))continue;
      const center=worldBase(ctx.terrain),dx=e.x-center.x,dy=e.y-center.y,len=Math.hypot(dx,dy)||1;
      // Enemy AI (VGM-031) must leave enemies with memory.retreat alone; the director moves them.
      e.memory={...e.memory,retreat:1};e.damage=0;
      state.retreating.push({id,x:center.x+dx/len*14,y:center.y+dy/len*14,untilTick:ctx.tick+retreatTicks});
      if(!barked){barked=true;ctx.emit({type:'bark',enemy:id,line:random().pick(RETREAT_LINES)});save();}
    }
  }

  function moveRetreats(ctx:SimContext){
    state.retreating=state.retreating.filter(r=>{
      const e=ctx.enemies.get(r.id);if(!e)return false;
      const step=Math.max(e.speed,1.5)*1.5/SIM_HZ,dx=r.x-e.x,dy=r.y-e.y,len=Math.hypot(dx,dy);
      if(len>step){e.x+=dx/len*step;e.y+=dy/len*step;}
      if(ctx.tick>=r.untilTick||ctx.terrain.coast(e.x,e.y)<-.3){ctx.enemies.delete(r.id);state.retreated++;return false;}
      return true;
    });
  }

  function endRound(ctx:SimContext){
    const plan=state.plan!,theme=state.theme!;
    ctx.round.remaining=0;
    ctx.emit({type:'round',index:plan.index,phase:'end',name:theme.name,modifier:theme.modifierLabel});
    const summary:RoundSummary={index:plan.index,total,name:theme.name,modifier:theme.modifierLabel,spawned:state.spawned,retreated:state.retreated,timedOut:state.timedOut};
    if(plan.index>=total){state.stage='done';options.onRoundEnd?.(ctx,summary);return;}
    // Enter the intermission first, so the round-end offers see its deadline in ctx.round and the summary.
    startPrepare(ctx,plan.index+1,intermission);
    options.onRoundEnd?.(ctx,{...summary,intermissionEndsTick:ctx.round.phaseEndsTick});
    const next=state.theme!;
    options.onIntermission?.(ctx,{index:plan.index+1,name:next.name,modifier:next.modifierLabel,endsTick:ctx.round.phaseEndsTick});
  }

  function stepWave(ctx:SimContext){
    const plan=state.plan!,elapsed=ctx.tick-state.roundStart;
    while(state.nextGroup<plan.groups.length&&plan.groups[state.nextGroup].at<=elapsed){dispatch(ctx,plan.groups[state.nextGroup],state.nextGroup);state.nextGroup++;}
    const due=state.pending.filter(p=>p.atTick<=ctx.tick);
    state.pending=state.pending.filter(p=>p.atTick>ctx.tick);
    for(const entry of due)spawnPending(ctx,entry);
    save();
    const alive=()=>{state.tracked=state.tracked.filter(id=>ctx.enemies.has(id));};
    alive();
    if(!state.timedOut&&plan.retreat&&ctx.tick>=ctx.round.phaseEndsTick)beginRetreat(ctx,true);
    // The boss fell: escorts give up.
    if(plan.boss&&state.bossId&&!ctx.enemies.has(state.bossId)&&state.tracked.length>state.retreating.length)beginRetreat(ctx,false);
    if(state.retreating.length){moveRetreats(ctx);alive();}
    let queued=0;
    for(let i=state.nextGroup;i<plan.groups.length;i++)queued+=plan.groups[i].members.length;
    for(const p of state.pending)queued+=p.members.length;
    ctx.round.remaining=queued+state.tracked.length;
    if(!ctx.round.remaining)endRound(ctx);
  }

  return {
    id:'director',state,scalePlayers,
    step(ctx){
      if(restored){restored=false;Object.assign(ctx.round,state.round);}
      if(state.stage==='done')return;
      if(!rng){rng=ctx.rng.fork('director');save();}
      sample(ctx);
      if(state.stage==='idle')startPrepare(ctx,1,opening);
      else if(state.stage==='wave'||ctx.tick>=ctx.round.phaseEndsTick){
        if(state.stage==='prepare')startWave(ctx);
        stepWave(ctx);
      }
      state.round={...ctx.round};
    },
  };
}
