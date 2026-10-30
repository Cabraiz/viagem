/** The director's options, state and types (director.ts), moved out as is (corte C1). */
import type {SimContext,SimSystem} from '../context.ts';
import {FlowField,type Point} from '../../maps/index.ts';
import {type CameraHint,type EnemyState,Rng,type RoundState,type SimPlayer} from '../../contract/index.ts';
import type {AvenuePlanner,AvenueState,GroupRequest} from '../city/avenues.ts';
import type {CityBalance} from '../city/balance.ts';
import type {Rotation,RoundPlan,RoundRoster,RoundTheme,SpawnGroup} from '../../rules/index.ts';
import type {TutorialState} from '../city/tutorial.ts';

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
   * City: a planner on a barricade-free copy of the city (assemble shares the boss's). A retreating body the exit field
   * cannot route (inside the plaza with the mouths' barricades up, BUG-…-recuo-parado-na-praca) walks out over them on it.
   */
  cityOpenPlanner?:AvenuePlanner;
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
  /**
   * City (cidade-11, city/balance.ts): the round knobs applied after planRound (count, hp, cadence) and the per-round
   * siegeShare, rounds 2..10 only (round 1, the tutorial, is never touched), including the team-size ones
   * (CityBalance.players) for the plan's player count (RoundPlan.players, i.e. scalePlayers at the wave start). assemble.ts passes CITY_BALANCE (or the
   * run's override) in the city; ignored on the island and in the endless world. Absent: the round table as it is.
   */
  cityBalance?:CityBalance;
  /**
   * The run's rotation (D-040, rules/enemy-rotation.ts): drawn once when the run starts, from the director's stream
   * salted with the world kind (so the same seed rotates differently per map), and every regular round composes its
   * members from it by role (planRound with roundRoster). Off by default here (the round table's nine kinds); the run
   * (assemble.ts) turns it on. The city's tutorial round 1 never uses it.
   */
  rotation?:boolean;
  /**
   * D-047 (the chaveiro objective; assemble.ts sets it with RunSystemsOptions.objective): the rounds are waves and the
   * count is no victory. No plan has the boss (the objective calls it when the chaveiro is near), the last round never
   * ends the run, and every wave after it repeats the last round's plan (its regular names, no modifier) with the
   * regular count × EXTRA_WAVE_COUNT per extra wave. Absent: the round table as it is.
   */
  endlessWaves?:boolean;
  /**
   * D-051 (mode 'ninhos', sim/ninhos/ninhos.ts): false sends no round at all; the nests send the groups. The director
   * still draws the rotation and samples the players, and holds ctx.round in one open 'wave' (towers fire, the boss
   * is the chaveiro's). Default true.
   */
  waves?:boolean;
}

/**
 * side: angle the group must come from (single-side, alternating and surround modifiers); kept on re-warns.
 * Endless world: anchor is the player the group was sent to; retry marks a group that found no hidden spot yet.
 */
/**
 * City: group is the plan group's index (its cadence slot), points the exact member positions, warnTick the tick the
 * warning goes out when it is later than the planning (a cerco part released after the group's first part).
 */
export interface PendingSpawn {members:string[];elite?:boolean;boss?:boolean;solo?:boolean;siege?:boolean;anchor?:string;retry?:boolean;side?:number;x:number;y:number;atTick:number;
  group?:number;points?:Point[];warnTick?:number;
  /** City: ticks this part lands behind its group's cadence slot (cityWarn); its bodies run in by that much (CITY_RUN_IN_SPEED). */
  late?:number;
  /** City tutorial (cidade-08): searches the group behind the team already made without a hidden spot (BEHIND_TRIES). */
  tries?:number;
  /** The viaduct (mapa-175-com-viaduto): its bodies land on a deck (floor 1), the tutorial's group behind a team that starts there. */
  andar?:1}
export type SpawnRequest=Omit<PendingSpawn,'x'|'y'|'atTick'|'retry'|'points'|'warnTick'|'late'>;
/** capTick (endless): hard end of a flight that keeps being extended while someone sees the enemy. */
export interface Retreat {id:string;x:number;y:number;untilTick:number;capTick?:number}
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
  /** The run's rotation (DirectorOptions.rotation, D-040), drawn on the first step. */
  rotation?:Rotation;
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
  /**
   * Invocador (D-040): one minion of `kind` at `at`, as a member of the current round: SUMMON.hp × the round's hp, the
   * round's speed and size (and the city's speed), tracked (it counts in `remaining`, retreats with the horde) and ready
   * after SUMMON.readyIn. Undefined outside a wave or at the enemy cap.
   */
  summon(ctx:SimContext,kind:string,at:Point):EnemyState|undefined;
  /** D-051: what round `index` of the run's rotation draws from (the nests' groups); undefined without a rotation. */
  roster(index:number):RoundRoster|undefined;
  /** Kinds an invocador calls this round: the rotation's corredores and enxames of the round; undefined without a rotation. */
  minionKinds():readonly string[]|undefined;
  /** The chefe's summons when the rotation is art only (short): its shooters, rats and brutamontes; undefined otherwise. */
  bossMinionKinds():readonly string[]|undefined;
}

/** What createDirector's parts share (director/create.ts builds it): its settings, state and helpers. */
export interface DirectorBase {
  readonly maxEnemies:number;
  readonly intermission:number;
  readonly opening:number;
  readonly warning:number;
  readonly minDistance:number;
  readonly retreatTicks:number;
  readonly total:number;
  readonly siegeShare:number;
  readonly random:()=>Rng;
  readonly save:()=>void;
  readonly scalePlayers:(ctx:SimContext)=>number;
  readonly sample:(ctx:SimContext)=>void;
  readonly endless:(ctx:SimContext)=>boolean;
  readonly planner:AvenuePlanner|undefined;
  readonly city:(ctx:SimContext)=>boolean;
  readonly viewers:(ctx:SimContext)=>SimPlayer[];
  readonly tutorialRound:(ctx:SimContext,index?:number)=>boolean;
  readonly standing:(p:SimPlayer)=>boolean;
  readonly options:DirectorOptions;
  readonly state:DirectorState;
}
/** What director/spawn-points.ts gives the other parts and createDirector. */
export interface SpawnPart {
  readonly pickPoint:(ctx:SimContext,side?:number)=>Point;
  readonly anchorsOf:(ctx:SimContext)=>SimPlayer[];
  readonly hidden:(ctx:SimContext,p:Point)=>boolean;
  readonly hiddenBy:(ctx:SimContext,p:Point,margin:number)=>boolean;
  readonly nearestOf:(list:readonly SimPlayer[],p:Point)=>{player:SimPlayer|undefined;d2:number};
  readonly chooseAnchor:(ctx:SimContext,anchors:readonly SimPlayer[])=>SimPlayer;
  readonly serve:(anchor:string|undefined,members:number)=>void;
  readonly locateEndless:(ctx:SimContext,spawn:SpawnRequest)=>{point:Point;anchor?:string}|undefined;
  readonly catchUp:(ctx:SimContext)=>void;
  readonly recycle:(ctx:SimContext)=>void;
}
/** What director/city.ts gives the other parts and createDirector. */
export interface CityPart {
  readonly cityRunIn:(ctx:SimContext)=>void;
  readonly cityAt0:()=>number;
  readonly cityRequest:(members:readonly string[],at:number,siege?:boolean)=>GroupRequest;
  readonly citySpeedOf:(speed:number)=>number;
  readonly planCity:(ctx:SimContext)=>void;
  readonly cityTeamField:(ctx:SimContext)=>FlowField|undefined;
  readonly cityWarn:(ctx:SimContext,spawn:SpawnRequest,delay:number)=>void;
  readonly cityHidden:(ctx:SimContext,entry:PendingSpawn)=>boolean;
  readonly requestOf:(entry:PendingSpawn)=>SpawnRequest;
  readonly cityWarnings:(ctx:SimContext)=>void;
  readonly moveCityRetreats:(ctx:SimContext)=>void;
}
/** What director/tutorial.ts gives the other parts and createDirector. */
export interface TutorialPart {
  readonly planTutorial:(ctx:SimContext)=>void;
  readonly behindWarn:(ctx:SimContext,spawn:SpawnRequest,delay:number)=>void;
  readonly tutorialIntro:(ctx:SimContext)=>void;
  readonly tutorialArrival:(ctx:SimContext)=>void;
}
/** What director/waves.ts gives the other parts and createDirector. */
export interface WavesPart {
  readonly retryLater:(ctx:SimContext,spawn:SpawnRequest,delay:number)=>void;
  readonly isSiege:(group:SpawnGroup,index:number)=>boolean;
  readonly startPrepare:(ctx:SimContext,index:number,duration:number)=>void;
  readonly startWave:(ctx:SimContext)=>void;
  readonly stepWave:(ctx:SimContext)=>void;
}
export type DirectorCtx=DirectorBase&SpawnPart&CityPart&TutorialPart&WavesPart;
