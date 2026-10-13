/**
 * Round director (VGM-033): wave -> round-end -> intermission ('prepare') -> next wave, for ROUND_COUNT rounds.
 * Owns ctx.round. Enemy creation, the boss and offers come from other cards through injected callbacks,
 * so this module only depends on the shared contract, terrain and collision helpers.
 *
 * Where enemies appear depends on the world (spawn-em-volta):
 * - island: on the coastal band (coastalSpawnPoints), unchanged since VGM-033; timed-out hordes walk into the sea.
 * - endless: VS-style, on a ring just off the screen of an active player (offscreen.ts), each group going to the
 *   player with the fewest enemies around, so spread players each get a horde. Enemies that end up farther than
 *   RECYCLE_DISTANCE from every player are moved back onto a ring (same id and hp: no kill, no xp). Siege groups
 *   come from off screen around the base, on their way to it. Timed-out hordes flee off screen.
 * - city (cidade-05, with options.avenues): at the avenue tips through the AvenuePlanner (city/avenues.ts). The round is
 *   planned once at its start for the warning ticks; each group is planned again just in time at its warning, at
 *   exact hidden points (no jitter), and arrives at the plaza on the plan's cadence (first ≈ 12 s). The round's timer
 *   covers the slowest member's walk (CITY_ARRIVAL_SLACK). With the team away from the base (options.cityChase,
 *   cidade-05c) the mouths and spots are aimed at the team instead of the plaza. The boss lands in the plaza itself (D-026). Timed-out
 *   hordes walk back up the avenues (exit flow field) and vanish out of everyone's sight, at the avenue end or far
 *   from the plaza. With options.cityTutorial (cidade-08, city/tutorial.ts) round 1 is the walk from the crashed
 *   helicopter to the plaza: a few slow bêbados behind the team and at the plaza, held until a hero reached it.
 */
import type {TerrainField} from '../maps/index.ts';
import {FlowField,RADIUS,SPEED,STRAIGHT_COST,UNREACHABLE,clearSegment,isLand,walkable,worldBase,worldSpawn,type FlowGrid,type Point} from '../maps/index.ts';
import {MAX_ENEMIES} from '../rules/index.ts';
import {RECYCLE_DISTANCE,RING_INNER,RING_OUTER,RING_SLACK,offscreenDistance,visibleFrom,type CameraHint} from '../contract/index.ts';
import {SIEGE_FLAG} from './stonewards/wall.ts';
import {moveSafely} from './enemies/ai.ts';
import {Rng} from '../contract/index.ts';
import {SIM_HZ,ticks,type EnemyState,type RoundState,type SimPlayer} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {modeForModifier,type AvenuePlanner,type AvenueState,type GroupRequest,type Mouth} from './city/avenues.ts';
import {CITY_ENEMY_SPEED,cityTerrainOf,type CityFlowGrid} from './city/grid.ts';
import {CIDADE_TUTORIAL,CIDADE_TUTORIAL_SAY,CIDADE_VEHICLE,ELITE_SIZE,RETREAT_LINES,ROUND_COUNT,drawTheme,planRound,type RoundPlan,type RoundTheme,type SpawnGroup} from '../rules/index.ts';
import {TUTORIAL_BEHIND,TUTORIAL_MOUTHS,TUTORIAL_WELCOME,behindCandidates,behindSpots,plazaUnits,tutorialPlan,type BehindCandidate,type TutorialState} from './city/tutorial.ts';

/** Builds an enemy of a catalog kind at a point with an hp multiplier (VGM-031). May insert it into ctx.enemies itself. */
export type CreateEnemy=(ctx:SimContext,kind:string,point:Point,scale:number)=>EnemyState|undefined;
/** Spawns the final boss (VGM-038). The point is a suggestion on the coast; return the boss or let it be found by `boss: true`. */
export type SpawnBoss=(ctx:SimContext,point:Point)=>EnemyState|undefined|void;
export interface RoundSummary {
  index:number;total:number;name:string;modifier?:string;spawned:number;retreated:number;timedOut:boolean;
  /** Endless world: enemies moved back next to a player this round (never counted as kills). */
  recycled?:number;
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
  /**
   * Share (0..1) of regular groups that besiege the base: flagged memory.siege and, in the endless world, spawned
   * off screen around the base. Default 0 (no structures until 046B, D-017); a plan may also flag groups itself.
   */
  siegeShare?:number;
  /** First round whose groups may besiege through siegeShare (default 1). Groups a plan flags itself always do. */
  siegeFromRound?:number;
  /** Where siege enemies are going (the wall, VGM-046B); the world's base when absent or down. */
  siegeTarget?:(ctx:SimContext)=>Point|undefined;
  /** Endless world: the camera a client reported (042b/camera-segue). Without it every orientation and view counts. */
  cameraOf?:(ctx:SimContext,player:SimPlayer)=>CameraHint|undefined;
  /**
   * City world (cidade-05): the avenue planner. With it, a 'cidade' terrain spawns at the avenue tips (see the module
   * comment) instead of throwing; ignored on the island and in the endless world.
   */
  avenues?:AvenuePlanner;
  /**
   * City: base (catalog) speed (u/s) of an enemy kind, for the planner's arrival estimate: speedMap(it × plan.speed),
   * the speed the body will walk at. Planner default when absent.
   */
  enemySpeedOf?:(kind:string)=>number|undefined;
  /**
   * City (cidade-05c v2): the world's speed of an authored speed (city/speed.ts citySpeed). Applied once, to the
   * EFFECTIVE speed: every body the director spawns in the city gets speed = speedMap(catalog speed × plan.speed), so a
   * fast round never pushes a kind that was slower than the hero past it. Ignored outside the city.
   */
  speedMap?:(speed:number)=>number;
  /**
   * City (cidade-05c): path distance to the live players, from the AI's players field (CitySteer refresh/costTo).
   * With it, while no live player stands in the base, the round's mouths and every group are aimed at the team
   * instead of the plaza (planner openRound/planGroups chaseCost). Without it, or with someone in the base: the plaza.
   */
  cityChase?:{refresh(ctx:SimContext):void;costTo(p:Point):number};
  /**
   * City (cidade-08, city/tutorial.ts): round 1 is the guided walk from the crashed helicopter to the plaza: its name
   * and banner line from CIDADE_TUTORIAL, a few slow weak bêbados behind the team and at the plaza, the wave held until
   * a hero reached the plaza (or the cap), and the heroes' intro and arrival `say` lines. assemble.ts turns it on in the
   * city; ignored on the island and in the endless world.
   */
  cityTutorial?:boolean;
}

/**
 * side: angle the group must come from (single-side, alternating and surround modifiers); kept on re-warns.
 * Endless world: anchor is the player the group was sent to; retry marks a group that found no hidden spot yet.
 */
/**
 * City: group is the plan group's index (its cadence slot), points the exact member positions, warnTick the tick the
 * warning goes out when it is later than the planning (a cerco part released after the group's first part).
 */
interface PendingSpawn {members:string[];elite?:boolean;boss?:boolean;siege?:boolean;anchor?:string;retry?:boolean;side?:number;x:number;y:number;atTick:number;
  group?:number;points?:Point[];warnTick?:number}
type SpawnRequest=Omit<PendingSpawn,'x'|'y'|'atTick'|'retry'|'points'|'warnTick'>;
/** capTick (endless): hard end of a flight that keeps being extended while someone sees the enemy. */
interface Retreat {id:string;x:number;y:number;untilTick:number;capTick?:number}
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
  /** Endless world: enemies of this round moved back next to a player (VS recycling). */
  recycled?:number;
  /** Endless world: members sent to each player this round (tie-break of the horde split). */
  served?:Record<string,number>;
  /** Endless world: the round's last call started (every group is out); see LAST_CALL_SECONDS. */
  called?:boolean;
  /** City: the avenue planner's memory (open mouths, rotation, uses per mouth). */
  avenues?:AvenueState;
  /** City: per plan group, the tick after the round start when its warning goes out; groups go out in cityOrder. */
  cityWarn?:number[];
  cityOrder?:number[];
  /** City round-1 tutorial (cidade-08): who said the intro, who reached the plaza first and when. */
  tutorial?:TutorialState;
}

export interface Director extends SimSystem {
  readonly state:DirectorState;
  /** Highest active player count of the last minute (1..6), used for budget and hp. */
  scalePlayers(ctx:SimContext):number;
  /**
   * Moves the end of the current intermission later (the Stonewards horn, so the farthest hero gets back before the
   * round, VGM-046B). Ignored outside an intermission and for an earlier tick.
   */
  extendPrepare(ctx:SimContext,endsTick:number):void;
  /**
   * City: the flow field toward the live players that the round timer uses (cityLastArrival), brought up to the
   * current players and grid (barricades: CityFlowGrid version, cidade-05c v2) as when the director plans. Undefined
   * outside the city, without a planner grid or without a live player. Inspection only: no director state changes.
   */
  cityTeamField(ctx:SimContext):FlowField|undefined;
}

const BAND_MAX=2.2;
const LINE_GAP=ticks(.3);
const SURROUND_SIDES=4;
/** Endless world: tries per ring pick (each one a bit farther out), recycling cadence and cap. */
const RING_TRIES=24,RING_STEP=RING_SLACK/RING_TRIES;
export const RECYCLE_EVERY=ticks(.5),RECYCLE_PER_STEP=20;
/** Free disc a spawn needs in the endless world: the boss radius, so no body starts inside a tree or rock. */
export const SPAWN_CLEARANCE=.9;
/** Free disc around the other members of a group (the biggest regular enemy, tio-pavê .48, rounded up). */
export const MEMBER_CLEARANCE=.5;
/** Endless: every body is born at least this far past the edge of every legal screen (offscreenDistance + margin). */
export const SPAWN_MARGIN=.5;
/** Endless: a fleeing enemy still on someone's screen keeps fleeing; past this it is removed anyway (liveness). */
export const FLEE_CAP_SECONDS=60;
/**
 * Endless world: an enemy no one can see walks this much faster towards the nearest player, so a horde born on the
 * off-screen ring (25.5-41.4 u away, offscreen.ts) reaches the edge of the screen in a few seconds, as in VS,
 * instead of the ~21 s a bêbado needs at 1.4 u/s. On screen it is back to its own pace. Never siege enemies; the boss
 * only while walking.
 */
export const CATCH_UP_SPEED=2.5;
/**
 * Endless world, last call (NEW-ORQ-fim-de-round-no-infinito). A round ends when its whole horde is down (the HUD counts
 * the bichos left; the last kill gets the kill-cam), and only a timeout makes the rest flee. In the endless world the
 * last groups are born 25-41 u away on the off-screen ring at 65% of the round, a bêbado walks 1.4 u/s, and bodies stuck
 * behind a tree never arrive: with the team waiting by the base every round of the sim timed out with a third to half
 * of the horde fleeing (53-69 s). So once every group of the plan is out:
 *  - the round gets at least LAST_CALL_SECONDS more before its timeout (the HUD shows no wave clock, only bichos);
 *  - each enemy still farther than LAST_CALL_NEAR from the team (siege ones: from the wall they besiege) hurries in,
 *    sidestepping trees and rocks; inside LAST_CALL_NEAR it is back to its own pace, so nobody standing still is hit by
 *    a body that arrived faster than it could be seen. Off every screen it closes in at CATCH_UP_SPEED on top of its
 *    pace (as before the last call); where someone may see it, never faster than LAST_CALL_PACE × the hero's speed in
 *    all, so a team that runs away is never caught by the hurry (code review: 3.9 u/s outran the hero's 3.1).
 */
export const LAST_CALL_SECONDS=25,LAST_CALL_NEAR=7,LAST_CALL_PACE=.9;
/** The extra speed of a called enemy (u/s): full catch-up off screen, capped so its pace plus it stays ≤ 0.9 × SPEED on one. */
export const lastCallBoost=(pace:number,hidden:boolean)=>hidden?CATCH_UP_SPEED:Math.max(0,Math.min(CATCH_UP_SPEED,LAST_CALL_PACE*SPEED-pace));
/**
 * A called enemy that tried every sidestep and still could not move waits this many ticks (plus 0-7 by its id) before it
 * tries again: up to 7 moveSafely calls per blocked body per tick were ~5 ms per tick with 300 of them (code review).
 */
const BLOCKED_WAIT=6;
/** Sidesteps a called enemy tries when the straight step is blocked, in radians (its own side first, by memory.seed). */
const DETOUR_TURNS=[Math.PI/3,Math.PI/2,2*Math.PI/3];
/**
 * A called enemy that gained less than STUCK_UNITS in a second (a pocket of trees or rocks: the AI pulls it straight
 * back in) squeezes through trees and rocks, never water, for the next STUCK_SECONDS. Most of it happens off screen;
 * on screen it reads as a bicho pushing through the bushes, and it is still LAST_CALL_NEAR away from anyone.
 */
const STUCK_UNITS=.5,STUCK_SECONDS=2;
/** Endless retreat: fleeing is faster and may take longer than walking into the island's sea. */
const FLEE_SPEED=4.5,FLEE_TIME_FACTOR=3;
/**
 * City retreat (cidade-05): a body walking back up its avenue is gone within CITY_EXIT_REACH of the avenue end or
 * CITY_GONE_DISTANCE from the plaza, once hidden from everyone (v2); FLEE_CAP_SECONDS is the liveness cap.
 */
export const CITY_EXIT_REACH=2,CITY_GONE_DISTANCE=25;
/**
 * City round timer (v2): a wave that times out lasts at least until the slowest member of the last group could reach
 * the plaza (or the team, where it stood when the wave started, if that is farther), plus this many seconds to fight
 * it, so no group retreats before it arrived (planCity; it never shortens the plan's time; not the boss round).
 */
export const CITY_ARRIVAL_SLACK=10;
const retreatDir={x:0,y:0};

export function activePlayers(ctx:SimContext){
  let n=0;for(const p of ctx.players.values())if(p.online&&!p.spectator&&!p.eliminated)n++;
  return n;
}
const blocking=(p:SimPlayer)=>!p.spectator&&!p.eliminated;

const candidateCache=new WeakMap<TerrainField,Point[]>();
/**
 * Coastal spawn candidates: half-unit grid nodes that are walkable, lie within BAND_MAX of the shoreline
 * and connect to the island interior (SPAWN) through clear segments. Cached per terrain field.
 * The endless world has no coast: it spawns around the players (see the module comment) and gets [].
 */
export function coastalSpawnPoints(terrain:TerrainField):Point[]{
  const cached=candidateCache.get(terrain);if(cached)return cached;
  // Endless world and city (cidade-05 spawns at the avenue tips): no coastal band.
  if(terrain.chunks||terrain.world==='cidade'){const none:Point[]=[];candidateCache.set(terrain,none);return none;}
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
  const points=queue.map(at).filter(p=>terrain.coast(p.x,p.y)<=BAND_MAX);
  candidateCache.set(terrain,points);
  return points;
}

function nearestPlayer(ctx:SimContext,p:Point){
  let best=Infinity;
  for(const pl of ctx.players.values())if(blocking(pl))best=Math.min(best,Math.hypot(pl.x-p.x,pl.y-p.y));
  return best;
}

/** Round 1 crumbs (VGM-056): tries per drop, and the gap beyond a hero's magnet radius (world units). */
const CRUMB_TRIES=6,CRUMB_MAGNET_MARGIN=.4;

export function createDirector(options:DirectorOptions,restore?:DirectorState):Director{
  const maxEnemies=options.maxEnemies??MAX_ENEMIES;
  const intermission=ticks(options.intermissionSeconds??20),opening=ticks(options.openingSeconds??3);
  const warning=ticks(options.warningSeconds??1.5),minDistance=options.minPlayerDistance??4;
  const retreatTicks=ticks(options.retreatSeconds??3),total=Math.min(options.rounds??ROUND_COUNT,ROUND_COUNT);
  const state:DirectorState=restore?structuredClone(restore):{
    stage:'idle',rng:0,roundStart:0,nextGroup:0,pending:[],tracked:[],retreating:[],
    spawned:0,retreated:0,timedOut:false,samples:[],usedNames:[],round:{index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0},
  };
  const siegeShare=Math.max(0,Math.min(1,options.siegeShare??0));
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
    if(!all.length&&ctx.terrain.world==='cidade')throw new Error('cidade: rounds spawn at the avenue tips, which arrive with cidade-05');
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

  // ---------- Endless world (spawn-em-volta) ----------
  const endless=(ctx:SimContext)=>!!ctx.terrain.chunks;
  /** Players groups are sent to: online and standing; else online (all downed); else every body (all offline). */
  function anchorsOf(ctx:SimContext){
    const standing:SimPlayer[]=[],online:SimPlayer[]=[],bodies:SimPlayer[]=[];
    for(const p of ctx.players.values()){
      if(!blocking(p))continue;
      bodies.push(p);if(!p.online)continue;
      online.push(p);if(!p.downed)standing.push(p);
    }
    return standing.length?standing:online.length?online:bodies;
  }
  /** Off the screen of every player with a body (offline ones may reconnect any moment, D-011). */
  function hidden(ctx:SimContext,p:Point){
    for(const pl of ctx.players.values())if(blocking(pl)&&visibleFrom(pl,p,options.cameraOf?.(ctx,pl)))return false;
    return true;
  }
  /** Units a hero covers during the warning: a spot must stay hidden even if a player walks straight at it. */
  const lead=SPEED*warning/SIM_HZ;
  /**
   * Hidden from everyone with `margin` to spare: the spot moved `margin` units towards each player is hidden too.
   * Every legal screen is star-shaped around its player (convex rectangles that contain it), so that is the
   * closest the edge can be in that direction.
   */
  function hiddenBy(ctx:SimContext,p:Point,margin:number){
    for(const pl of ctx.players.values()){
      if(!blocking(pl))continue;
      const hint=options.cameraOf?.(ctx,pl),dx=pl.x-p.x,dy=pl.y-p.y,d=Math.hypot(dx,dy);
      if(visibleFrom(pl,p,hint))return false;
      if(d<=margin||visibleFrom(pl,{x:p.x+dx/d*margin,y:p.y+dy/d*margin},hint))return false;
    }
    return true;
  }
  const hiddenAhead=(ctx:SimContext,p:Point)=>hiddenBy(ctx,p,lead);
  const spawnable=(ctx:SimContext,p:Point)=>walkable(p,ctx.terrain)&&ctx.terrain.chunks!.clear(p.x,p.y,SPAWN_CLEARANCE);
  function nearestOf(list:readonly SimPlayer[],p:Point){
    let best:SimPlayer|undefined,d2=Infinity;
    for(const a of list){const dx=a.x-p.x,dy=a.y-p.y,d=dx*dx+dy*dy;if(d<d2){d2=d;best=a;}}
    return {player:best,d2};
  }
  /**
   * The anchor with the fewest enemies (alive and nearest to it, plus pending groups sent to it); ties go to the
   * one served least this round, then rng. A team that kills fast still splits the horde evenly.
   */
  function chooseAnchor(ctx:SimContext,anchors:readonly SimPlayer[]):SimPlayer{
    if(anchors.length===1)return anchors[0];
    const load=new Map(anchors.map(a=>[a.id,0]));
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);
      if(!e||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1)continue;
      const {player}=nearestOf(anchors,e);
      if(player)load.set(player.id,load.get(player.id)!+1);
    }
    for(const p of state.pending)if(p.anchor!==undefined&&load.has(p.anchor))load.set(p.anchor,load.get(p.anchor)!+p.members.length);
    let min=Infinity;for(const v of load.values())min=Math.min(min,v);
    const served=state.served??{};
    let tied=anchors.filter(a=>load.get(a.id)===min),least=Infinity;
    for(const a of tied)least=Math.min(least,served[a.id]??0);
    tied=tied.filter(a=>(served[a.id]??0)===least);
    return tied.length===1?tied[0]:random().pick(tied);
  }
  function serve(anchor:string|undefined,members:number){
    if(anchor===undefined)return;
    const served=state.served??={};served[anchor]=(served[anchor]??0)+members;
  }
  /** Point on the off-screen ring of `center` (optionally within ±60° of `side`), hidden from everyone. */
  function ringPoint(ctx:SimContext,center:Point,side?:number,hint?:CameraHint):Point|undefined{
    for(let attempt=0;attempt<RING_TRIES;attempt++){
      const a=side===undefined?random().range(0,Math.PI*2):side+random().range(-Math.PI/3,Math.PI/3);
      const ux=Math.cos(a),uy=Math.sin(a);
      const d=offscreenDistance(ux,uy,hint)+random().range(RING_INNER,RING_OUTER)+attempt*RING_STEP;
      const p={x:center.x+ux*d,y:center.y+uy*d};
      if(spawnable(ctx,p)&&hiddenAhead(ctx,p))return p;
    }
    return undefined;
  }
  /**
   * Endless spawn spot. Siege groups: around the base, off everyone's screen (no hint: the base has no camera).
   * Boss: around the player closest to the team's centre. Others: around the requested anchor if still valid,
   * else the least loaded one. Undefined when no hidden spot was found this time.
   */
  function locateEndless(ctx:SimContext,spawn:SpawnRequest):{point:Point;anchor?:string}|undefined{
    if(spawn.siege){const point=ringPoint(ctx,worldBase(ctx.terrain),spawn.side);return point&&{point};}
    const anchors=anchorsOf(ctx);
    if(!anchors.length){const point=ringPoint(ctx,worldBase(ctx.terrain),spawn.side);return point&&{point};}
    let anchor=spawn.anchor!==undefined?anchors.find(a=>a.id===spawn.anchor):undefined;
    if(!anchor&&spawn.boss){
      let cx=0,cy=0;for(const a of anchors){cx+=a.x;cy+=a.y;}
      anchor=nearestOf(anchors,{x:cx/anchors.length,y:cy/anchors.length}).player;
    }
    anchor??=chooseAnchor(ctx,anchors);
    const point=ringPoint(ctx,anchor,spawn.side,options.cameraOf?.(ctx,anchor));
    return point&&{point,anchor:anchor.id};
  }
  /** Hidden enemies close in faster (CATCH_UP_SPEED); in the last call, every far one (see LAST_CALL_SECONDS). */
  function catchUp(ctx:SimContext){
    const anchors=anchorsOf(ctx).filter(p=>p.online&&!p.downed&&p.hp>0);
    if(!anchors.length)return;
    const step=CATCH_UP_SPEED/SIM_HZ,called=!!state.called,base=called?options.siegeTarget?.(ctx)??worldBase(ctx.terrain):undefined;
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);
      if(!e||e.hp<=0||e.memory?.retreat===1||ctx.tick<e.readyTick)continue;
      const siege=e.memory?.[SIEGE_FLAG]===1;
      if(siege&&!called)continue;
      // The boss only while it walks (boss.ts ACT_IDLE = 0); its dash and sweep place it themselves.
      if(e.boss&&e.memory?.act!==0)continue;
      if(e.frozenUntil!==undefined&&ctx.tick<e.frozenUntil)continue;
      if(called){
        // Last call: towards the team (siege bodies: towards the wall they besiege), on screen too, until LAST_CALL_NEAR.
        const to=siege?base!:nearestOf(anchors,e).player!,dx=to.x-e.x,dy=to.y-e.y,d=Math.hypot(dx,dy);
        if(d<=LAST_CALL_NEAR)continue;
        const m=e.memory??={};
        if(ctx.tick<(m.blockedUntil??-1))continue;
        const boost=lastCallBoost(e.speed,hidden(ctx,e))/SIM_HZ;
        if(boost<=0)continue;
        // Once a second: a body that did not get anywhere squeezes through for a while (STUCK_SECONDS).
        if(m.callTick===undefined||ctx.tick-m.callTick>=SIM_HZ){
          if(m.callTick!==undefined&&Math.hypot(e.x-(m.callX??e.x),e.y-(m.callY??e.y))<STUCK_UNITS)m.squeezeUntil=ctx.tick+ticks(STUCK_SECONDS);
          m.callTick=ctx.tick;m.callX=e.x;m.callY=e.y;
        }
        if(!hurry(ctx,e,dx/d*boost,dy/d*boost,ctx.tick<(m.squeezeUntil??-1)))m.blockedUntil=ctx.tick+BLOCKED_WAIT+(Math.floor((m.seed??0)*8)&7);
        continue;
      }
      if(!hidden(ctx,e))continue;
      const {player,d2}=nearestOf(anchors,e);
      if(!player||d2<1)continue;
      const d=Math.sqrt(d2),x=e.x,y=e.y;
      moveSafely(e,(player.x-e.x)/d*step,(player.y-e.y)/d*step,ctx.terrain,e.radius);
      // The extra step never carries it onto a screen: the last stretch in is at its own pace.
      if(!hidden(ctx,e)){e.x=x;e.y=y;}
    }
  }
  /**
   * A called enemy's extra step; blocked straight ahead (a tree, a rock), it sidesteps (its own side first).
   * False when nothing moved it (the caller makes it wait BLOCKED_WAIT ticks before the next try).
   */
  function hurry(ctx:SimContext,e:EnemyState,dx:number,dy:number,squeeze:boolean){
    const x=e.x,y=e.y,want=Math.hypot(dx,dy);
    // Squeezing: straight through trees and rocks, on land only (moveSafely lets a body inside an obstacle walk out).
    if(squeeze&&isLand({x:x+dx,y:y+dy},RADIUS+.2,ctx.terrain)){e.x=x+dx;e.y=y+dy;return true;}
    moveSafely(e,dx,dy,ctx.terrain,e.radius);
    if(Math.hypot(e.x-x,e.y-y)>=want*.5)return true;
    const side=(e.memory?.seed??0)<.5?1:-1;
    for(const turn of DETOUR_TURNS)for(const sign of [side,-side]){
      const a=turn*sign,c=Math.cos(a),s=Math.sin(a);
      e.x=x;e.y=y;moveSafely(e,dx*c-dy*s,dx*s+dy*c,ctx.terrain,e.radius);
      if(Math.hypot(e.x-x,e.y-y)>=want*.5)return true;
    }
    e.x=x;e.y=y;return false;
  }
  /** VS recycling: enemies far from every player come back on a ring next to one, same id and hp, no kill. */
  function recycle(ctx:SimContext){
    if(ctx.tick%RECYCLE_EVERY!==0)return;
    const anchors=anchorsOf(ctx);if(!anchors.length)return;
    const far=RECYCLE_DISTANCE*RECYCLE_DISTANCE;
    let moved=0;
    for(const id of state.tracked){
      if(moved>=RECYCLE_PER_STEP)break;
      const e=ctx.enemies.get(id);
      // The boss keeps its own arena logic (VGM-038); siege enemies are supposed to be away from players.
      if(!e||e.boss||e.hp<=0||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1)continue;
      if(nearestOf(anchors,e).d2<=far)continue;
      // Far from everyone standing is not enough: a downed or offline player may still be looking at it.
      if(!hidden(ctx,e))continue;
      const anchor=chooseAnchor(ctx,anchors),p=ringPoint(ctx,anchor,undefined,options.cameraOf?.(ctx,anchor));
      if(!p)continue;
      e.x=p.x;e.y=p.y;delete e.knock;
      if(e.memory&&e.memory.state!==undefined)e.memory.state=0; // back to walking: no charge across the map
      state.recycled=(state.recycled??0)+1;moved++;
    }
  }

  // ---------- City (cidade-05): the avenue planner ----------
  const planner=options.avenues;
  const city=(ctx:SimContext)=>!!planner&&ctx.terrain.world==='cidade';
  const viewers=(ctx:SimContext)=>[...ctx.players.values()];
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
    if(tutorialRound(ctx)){planTutorial(ctx);return;}
    const plan=state.plan!,regular=plan.groups.filter(g=>!g.boss&&!g.elite);
    const siege=regular.length>0&&plan.groups.every((g,i)=>g.boss||g.elite||isSiege(g,i));
    const chaseCost=cityChaseCost(ctx),aim=chaseCost?{chaseCost}:{};
    const avenues=state.avenues=planner!.openRound(plan.index,modeForModifier(state.theme?.modifierId,siege),random(),state.avenues,aim);
    // The boss appears in the plaza (cityWarn), not on an avenue: an empty request keeps every other group's index.
    const requests=plan.groups.map((g,i)=>g.boss?{at:g.at,size:0}:cityRequest(g.members,g.at,!g.elite&&isSiege(g,i)));
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
      const siege=!group.elite&&isSiege(group,part.index);
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
    // Tutorial: the group behind the team comes out of the wreck (behindWarn); the other one is aimed at the plaza.
    const tutorial=tutorialRound(ctx);
    if(tutorial&&index===TUTORIAL_BEHIND){behindWarn(ctx,spawn,delay);return;}
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
      if(warnTick>ctx.tick)entry.warnTick=warnTick;
      else ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:members.length});
      state.pending.push(entry);
    }
    if(used<spawn.members.length)retryLater(ctx,{...spawn,members:spawn.members.slice(used)},delay);
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
    for(const p of plazaSpots)if(field.atGoal(p.x,p.y)&&walkable(p,ctx.terrain)&&nearestPlayer(ctx,p)>=minDistance)return {x:p.x,y:p.y};
    return {x:center.x,y:center.y};
  }
  /** Every member spot still hidden from every viewer and >= minPlayerDistance away (the planner's rule). */
  function cityHidden(ctx:SimContext,entry:PendingSpawn){
    const players=viewers(ctx);
    return (entry.points??[entry]).every(p=>planner!.hiddenFrom(players,p));
  }
  const requestOf=(entry:PendingSpawn):SpawnRequest=>({members:entry.members,elite:entry.elite,boss:entry.boss,side:entry.side,
    ...(entry.siege?{siege:true}:{}),...(entry.anchor!==undefined?{anchor:entry.anchor}:{}),...(entry.group!==undefined?{group:entry.group}:{})});
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
      planner!.retreatDirection(e,retreatDir);
      if(retreatDir.x||retreatDir.y)moveSafely(e,retreatDir.x*step,retreatDir.y*step,ctx.terrain,e.radius);
      const end=avenueEnd(ctx,planner!.retreatMouth(e));
      if(end){r.x=end.x;r.y=end.y;}
      // Never vanishes in sight (v2): every exit needs it hidden from every viewer; only the liveness cap ignores that.
      const out=!!end&&Math.hypot(end.x-e.x,end.y-e.y)<=CITY_EXIT_REACH||planner!.exitField.atGoal(e.x,e.y)
        ||Math.hypot(e.x-plaza.x,e.y-plaza.y)>=CITY_GONE_DISTANCE;
      const gone=out&&planner!.hiddenFrom(players,e)||ctx.tick>=r.untilTick;
      if(gone){ctx.enemies.delete(r.id);state.retreated++;return false;}
      return true;
    });
  }

  // ---------- City round 1: the tutorial walk (cidade-08, city/tutorial.ts) ----------
  /** Round `index` (default: the current one) is the city tutorial: round 1 of a city run that started it. */
  function tutorialRound(ctx:SimContext,index=ctx.round.index){return index===1&&!!state.tutorial&&city(ctx);}
  const standing=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
  /**
   * Round start of the tutorial: the plaza group's mouth (one of TUTORIAL_MOUTHS with a route, by rng; it counts as
   * used, so round 2 prefers another) and the warning ticks: the group behind at its `at`, the plaza group at the
   * planner's warning for an arrival welcomeArrival s into the wave. The wave lasts its cap (plan.durationTicks).
   */
  function planTutorial(ctx:SimContext){
    const plan=state.plan!,routes=TUTORIAL_MOUTHS.filter(m=>planner!.route(m));
    const mouth=routes.length?random().pick(routes):TUTORIAL_MOUTHS[0];
    const uses:Record<Mouth,number>={N:0,S:0,L:0,O:0};uses[mouth]=1;
    const avenues=state.avenues={round:plan.index,mode:'normal',open:[mouth],alternate:0,uses};
    const warnAt=plan.groups.map(g=>g.at),welcome=plan.groups[TUTORIAL_WELCOME];
    if(welcome){
      const parts=planner!.planGroups([cityRequest(welcome.members,welcome.at,true)],viewers(ctx),avenues,random(),{at0:cityAt0(),indexBase:TUTORIAL_WELCOME,nowTick:0});
      if(parts.length)warnAt[TUTORIAL_WELCOME]=Math.min(...parts.map(p=>p.warnTick));
    }
    const cityWarn=state.cityWarn=warnAt.map(w=>Math.max(0,w));
    state.cityOrder=plan.groups.map((_,i)=>i).sort((a,b)=>cityWarn[a]-cityWarn[b]||a-b);
  }
  /** Cells near the wreck for the group behind the team (city/tutorial.ts behindCandidates), read once. */
  let behind:BehindCandidate[]|undefined;
  /**
   * The group behind the team: hidden cells near the wreck farther from the plaza than every standing hero
   * (behindSpots), warned now and landing after the warning; members without a spot try again a second later.
   */
  function behindWarn(ctx:SimContext,spawn:SpawnRequest,delay:number){
    const field=planner!.plazaField,wreck=cityTerrainOf(ctx.terrain)?.asset.points.inicio??worldSpawn(ctx.terrain);
    behind??=behindCandidates(field,wreck,p=>planner!.insideBase(p));
    let team=0;
    for(const p of ctx.players.values()){
      if(!standing(p))continue;
      const c=field.costAt(p.x,p.y);
      if(c!==UNREACHABLE)team=Math.max(team,plazaUnits(field,c));
    }
    // Closest to the team by path (the round timer's team field), so the group trails the heroes it chases.
    const near=cityTeamField(ctx),toTeam=near?(p:Point)=>{const c=near.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*near.cellSize;}:undefined;
    const players=viewers(ctx),points=behindSpots(behind,spawn.members.length,team,p=>planner!.hiddenFrom(players,p),toTeam);
    if(points.length){
      const members=spawn.members.slice(0,points.length),p=points[0],atTick=ctx.tick+delay+warning;
      state.pending.push({...spawn,members,x:p.x,y:p.y,atTick,points});
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:members.length});
    }
    if(points.length<spawn.members.length)retryLater(ctx,{...spawn,members:spawn.members.slice(points.length)},delay);
  }
  /** Lines of the tutorial from their own streams (derived from the director's), so no spawn of the run moves. */
  const lineRng=(salt:number)=>new Rng((state.rng^salt)>>>0);
  /** Right after the crash (the run's first steps): one hero says a CIDADE_VEHICLE intro line. Once per run. */
  function tutorialIntro(ctx:SimContext){
    const speakers=[...ctx.players.values()].filter(standing);
    if(!speakers.length)return;
    const r=lineRng(0x0c1d0801),who=r.pick(speakers);
    state.tutorial!.intro=who.id;
    ctx.emit({type:'say',source:who.id,key:CIDADE_TUTORIAL_SAY.intro,line:r.pick(CIDADE_VEHICLE.intro)});
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

  /** Side of the n-th group: the plan's side, flipped every other group when the modifier alternates. */
  function sideFor(index:number){
    const plan=state.plan;
    if(plan?.side===undefined)return undefined;
    return plan.alternate&&index%2?plan.side+Math.PI:plan.side;
  }

  /** Where a group goes: the coast on the island; endless, a hidden ring spot (undefined: try again in a second). */
  function locate(ctx:SimContext,spawn:SpawnRequest):{point:Point;anchor?:string}|undefined{
    return endless(ctx)?locateEndless(ctx,spawn):{point:pickPoint(ctx,spawn.side)};
  }
  /** Retry entry for a group with no hidden spot yet: no warning (nothing to show), counted as pending. */
  function retryLater(ctx:SimContext,spawn:SpawnRequest,delay:number){
    const at=spawn.anchor!==undefined?ctx.players.get(spawn.anchor):undefined,base=at??worldBase(ctx.terrain);
    state.pending.push({...spawn,retry:true,x:base.x,y:base.y,atTick:ctx.tick+SIM_HZ+delay});
  }

  function warn(ctx:SimContext,spawn:SpawnRequest,delay=0){
    if(city(ctx)){cityWarn(ctx,spawn,delay);return;}
    const found=locate(ctx,spawn);
    if(!found){retryLater(ctx,spawn,delay);return;}
    const p=found.point;
    const entry:PendingSpawn={...spawn,...(found.anchor!==undefined?{anchor:found.anchor}:{}),x:p.x,y:p.y,atTick:ctx.tick+warning+delay};
    state.pending.push(entry);serve(found.anchor,spawn.members.length);
    ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:entry.atTick,count:spawn.members.length});
  }

  /** Regular groups flagged by the plan or picked by siegeShare (every 1/share-th group, no rng). */
  const siegeFrom=options.siegeFromRound??1;
  const isSiege=(group:SpawnGroup,index:number)=>!!group.siege||(siegeShare>0&&(state.plan?.index??0)>=siegeFrom&&Math.floor((index+1)*siegeShare)>Math.floor(index*siegeShare));

  function dispatch(ctx:SimContext,group:SpawnGroup,index:number){
    const side=sideFor(index),special=!group.boss&&!group.elite,siege=special&&isSiege(group,index);
    const flag=siege?{siege:true}:{};
    // City: one request per group; the planner lays it out along the avenue (cerco splits it over the 4 mouths).
    if(city(ctx)){warn(ctx,{members:[...group.members],elite:group.elite,boss:group.boss,group:index,...flag});return;}
    if(special&&group.formation==='surround'&&group.members.length>1){
      // Surround: the group splits and arrives from evenly spaced sides at once (endless: around one player).
      const parts=Math.min(SURROUND_SIDES,group.members.length),base=side??random().range(0,Math.PI*2);
      const anchors=endless(ctx)&&!siege?anchorsOf(ctx):[];
      const anchor=anchors.length?{anchor:chooseAnchor(ctx,anchors).id}:{};
      for(let i=0;i<parts;i++)warn(ctx,{members:group.members.filter((_,j)=>j%parts===i),side:base+i*Math.PI*2/parts,...flag,...anchor});
      return;
    }
    if(special&&group.formation==='line'){
      // Single file: the same point, one enemy every LINE_GAP ticks.
      const found=locate(ctx,{members:group.members,side,...flag});
      if(!found){retryLater(ctx,{members:[...group.members],side,...flag},0);return;}
      const p=found.point,anchor=found.anchor!==undefined?{anchor:found.anchor}:{};
      serve(found.anchor,group.members.length);
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
      const ok=endless(ctx)?ctx.terrain.chunks!.clear(p.x,p.y,MEMBER_CLEARANCE)&&hiddenBy(ctx,p,SPAWN_MARGIN):nearestPlayer(ctx,p)>=minDistance;
      if(walkable(p,ctx.terrain)&&clearSegment(center,p,ctx.terrain)&&ok)return p;
    }
    return center;
  }

  function spawnPending(ctx:SimContext,entry:PendingSpawn){
    const plan=state.plan!;
    const center={x:entry.x,y:entry.y};
    const request=requestOf(entry),isCity=city(ctx);
    // Endless: no hidden spot was found earlier, or a player now sees the warned one. Island: a player walked onto it.
    // City: a viewer now sees (or stands near) a member's spot. Either way, warn again somewhere else.
    // City boss (in the plaza, in sight by design): only a player standing on its spot moves it.
    if(entry.retry||(isCity?entry.boss?nearestPlayer(ctx,center)<minDistance:!cityHidden(ctx,entry):endless(ctx)?!hiddenBy(ctx,center,SPAWN_MARGIN):nearestPlayer(ctx,center)<minDistance)){warn(ctx,request);return;}
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
      const enemy=options.createEnemy(ctx,entry.members[i],p,entry.elite?plan.eliteHp:plan.hp);
      if(!enemy)continue;
      if(!ctx.enemies.has(enemy.id))ctx.enemies.set(enemy.id,enemy);
      enemy.speed*=plan.speed;enemy.radius*=plan.size*(entry.elite?ELITE_SIZE:1);
      // City (cidade-05c v2): the one conversion to the city's speeds, on the effective speed (after plan.speed).
      if(isCity)enemy.speed=citySpeedOf(enemy.speed);
      if(entry.elite)enemy.elite=true;
      enemy.memory={...enemy.memory,round:plan.index,...(entry.siege?{[SIEGE_FLAG]:1}:{})};
      state.tracked.push(enemy.id);state.spawned++;
    }
    // Enemy cap reached: the rest comes a second later, with a fresh warning.
    if(count<entry.members.length)warn(ctx,{...request,members:entry.members.slice(count)},SIM_HZ);
  }

  function startPrepare(ctx:SimContext,index:number,duration:number){
    state.stage='prepare';
    // cidade-08: the city's round 1 is the tutorial walk, with its own name and banner line (no draw).
    if(index===1&&options.cityTutorial&&city(ctx))state.tutorial??={};
    const theme=state.theme=tutorialRound(ctx,index)?{name:CIDADE_TUTORIAL.roundName,modifierLabel:CIDADE_TUTORIAL.modifier}:drawTheme(index,random(),state.usedNames);
    state.usedNames.push(theme.name);if(theme.modifierId)state.usedNames.push(theme.modifierId);
    save();
    Object.assign(ctx.round,{index,total,phase:'prepare',phaseEndsTick:ctx.tick+duration,remaining:0});
    ctx.emit({type:'round',index,phase:'prepare',name:theme.name,modifier:theme.modifierLabel});
  }

  function startWave(ctx:SimContext){
    const index=ctx.round.index,theme=state.theme!;
    const plan=tutorialRound(ctx)?tutorialPlan(scalePlayers(ctx),planner!.firstArrivalTicks):planRound(index,scalePlayers(ctx),theme,random());
    save();
    Object.assign(state,{stage:'wave',plan,roundStart:ctx.tick,nextGroup:0,pending:[],tracked:[],bossId:undefined,retreating:[],spawned:0,retreated:0,timedOut:false},
      endless(ctx)?{recycled:0,served:{},called:false}:{});
    Object.assign(ctx.round,{phase:'wave',phaseEndsTick:ctx.tick+plan.durationTicks,remaining:plan.total});
    if(city(ctx))planCity(ctx);
    ctx.emit({type:'round',index,phase:'wave',name:theme.name,modifier:theme.modifierLabel});
    // Only where the first bichos come from the off-screen ring (~25 s away): on the island they come from the coast in
    // a few seconds, and an early level there only lands on the first contact.
    if(plan.crumbs&&endless(ctx))layCrumbs(ctx,plan.crumbs);
  }

  /**
   * Round 1 (VGM-056, D-026: balance of the endless world's round 1, every run): a ring of XP drops around the team's
   * middle, evenly spread with a little jitter, each on walkable ground (a few tries farther out, else skipped), and
   * out of every hero's magnet (plus a margin), so a team standing still never gets them: the lesson needs a step.
   * Own id counter ("migalha") and own random stream: no other id or spawn of the run moves because of them.
   */
  function layCrumbs(ctx:SimContext,crumbs:NonNullable<RoundPlan['crumbs']>){
    const team=anchorsOf(ctx);
    const center=team.length?{x:team.reduce((s,p)=>s+p.x,0)/team.length,y:team.reduce((s,p)=>s+p.y,0)/team.length}:worldSpawn(ctx.terrain);
    const clear=(at:{x:number;y:number})=>team.every(p=>Math.hypot(at.x-p.x,at.y-p.y)>p.stats.magnet+CRUMB_MAGNET_MARGIN);
    // A stream of its own, derived from the director's: the crumbs never shift the spawn plan of any round.
    const r=new Rng((state.rng^0x056c0de5)>>>0);
    const turn=r.range(0,Math.PI*2),[min,max]=crumbs.radius;
    for(let i=0;i<crumbs.count;i++){
      for(let attempt=0;attempt<CRUMB_TRIES;attempt++){
        const a=turn+i*2*Math.PI/crumbs.count+r.range(-.25,.25),d=r.range(min,max)+attempt*.5;
        const at={x:center.x+Math.cos(a)*d,y:center.y+Math.sin(a)*d};
        if(!clear(at)||!walkable(at,ctx.terrain)||ctx.terrain.chunks&&!ctx.terrain.chunks.clear(at.x,at.y,MEMBER_CLEARANCE))continue;
        const id=ctx.nextId('migalha');
        ctx.pickups.set(id,{id,kind:'xp',value:crumbs.value,x:at.x,y:at.y,spawnTick:ctx.tick});
        break;
      }
    }
  }

  /** Cancels what has not spawned and walks the survivors back into the sea (endless: off screen, away from the nearest player). */
  function beginRetreat(ctx:SimContext,timedOut:boolean){
    state.timedOut=timedOut;state.nextGroup=state.plan!.groups.length;state.pending=[];
    let barked=false;
    const isEndless=endless(ctx),anchors=isEndless?anchorsOf(ctx):[],isCity=city(ctx);
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
      const from=isEndless?nearestOf(anchors,e).player??worldBase(ctx.terrain):worldBase(ctx.terrain);
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
    if(city(ctx)){moveCityRetreats(ctx);return;}
    const isEndless=endless(ctx);
    state.retreating=state.retreating.filter(r=>{
      const e=ctx.enemies.get(r.id);if(!e)return false;
      const speed=isEndless?Math.max(e.speed*2.5,FLEE_SPEED):Math.max(e.speed,1.5)*1.5;
      const step=speed/SIM_HZ,dx=r.x-e.x,dy=r.y-e.y,len=Math.hypot(dx,dy);
      if(len>step){e.x+=dx/len*step;e.y+=dy/len*step;}
      if(isEndless){
        if(hidden(ctx,e)||ctx.tick>=(r.capTick??r.untilTick)){ctx.enemies.delete(r.id);state.retreated++;return false;}
        // Out of time but on someone's screen: never vanish in view. Keep fleeing, with a fresh target once there.
        if(len<=step){
          const anchors=anchorsOf(ctx),from=nearestOf(anchors,e).player;
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
    if(plan.index>=total){state.stage='done';options.onRoundEnd?.(ctx,summary);return;}
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
    if(order)cityWarnings(ctx);
    const due=state.pending.filter(p=>p.atTick<=ctx.tick);
    state.pending=state.pending.filter(p=>p.atTick>ctx.tick);
    for(const entry of due)spawnPending(ctx,entry);
    if(endless(ctx)){
      // Last call (see LAST_CALL_SECONDS): every group of a regular round is out, nothing is waiting for a spot.
      if(!state.called&&plan.retreat&&!state.timedOut&&state.nextGroup>=plan.groups.length&&!state.pending.length){
        state.called=true;ctx.round.phaseEndsTick=Math.max(ctx.round.phaseEndsTick,ctx.tick+ticks(LAST_CALL_SECONDS));
      }
      recycle(ctx);catchUp(ctx);
    }
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
    if(tutorial)tutorialArrival(ctx);
    if(!ctx.round.remaining&&(!tutorial||state.tutorial!.arrived!==undefined||state.timedOut))endRound(ctx);
  }

  return {
    id:'director',state,scalePlayers,
    cityTeamField:ctx=>planner&&city(ctx)?cityTeamField(ctx):undefined,
    extendPrepare(ctx,endsTick){
      if(state.stage!=='prepare'||ctx.round.phase!=='prepare'||!Number.isSafeInteger(endsTick)||endsTick<=ctx.round.phaseEndsTick)return;
      ctx.round.phaseEndsTick=endsTick;state.round={...ctx.round};
    },
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
      if(state.tutorial&&state.tutorial.intro===undefined&&tutorialRound(ctx))tutorialIntro(ctx);
      state.round={...ctx.round};
    },
  };
}
