/**
 * Wires one horde run (VGM-042): fresh instances of every system, the kill/zero hooks and the outcome callbacks.
 * Called on every new run; dispose() removes this run's hooks before the next one registers.
 */
import type {SimWorld} from './core.ts';
import type {EnemyState,SimPlayer} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {MAX_ENEMIES,MAX_PICKUPS,MAX_PROJECTILES,hasRoom,mergeXpGems} from '../rules/index.ts';
import {createDirector,type Director,type DirectorState} from './director.ts';
import {ELITE,createEnemy,enemyDef,isEnemyKind} from './enemies/catalog.ts';
import {MINION_KINDS,createEnemyAi,type EnemyAi,type EnemyAiState} from './enemies/ai.ts';
import {BOSS_TUNING,createBoss,type BossController,type BossState} from './boss.ts';
import {createWeaponSystem} from './weapons/system.ts';
import {createProjectileSystem} from './projectiles.ts';
import {createTelegraphSystem} from './telegraphs.ts';
import {createProgression,type Progression,type ProgressionState} from './progression.ts';
import {createReviveSystem,downPlayer,type ReviveSystem} from './revive.ts';
import {refreshStats} from '../rules/index.ts';
import {ITEMS} from './items.ts';
import {playersSystem,type PlayerInput,type RunPlayer} from './systems/players.ts';
import {createStonewardsSystem,structureTargets,type StonewardsSystem} from './stonewards/system.ts';
import type {StonewardsState} from './stonewards/state.ts';
import {createZueira,type ZueiraLab,type ZueiraState,type ZueiraSystem} from './zueira.ts';
import type {AvenuePlanner} from './city/avenues.ts';
import {cityPlanner,citySteer,cityTerrainOf} from './city/grid.ts';
import {CityTerrain,baseHeroSpeed} from '../maps/index.ts';
import {citySpeed} from './city/speed.ts';
import {CITY_BALANCE,hasTeamBossHp,hasTeamDamage,teamBossHp,teamDamage,type CityBalance} from './city/balance.ts';

export type RunOutcomeKind='victory'|'defeat';
export const KILL_SCORE=10;
/**
 * Stonewards intermission (VGM-046B): 30 s instead of the director's 20. Measured in done/VGM-046B: the nearest pedra
 * of the endless map is ~17 units out (median of 20 seeds), so walking there and back (8.4 s), emptying it (7.2 s), the
 * round offer (~4 s) and a purchase at the forge (~2 s) already take ~22 s; 30 s leaves room for a second node or a
 * farther, richer one. The horn may stretch it further for a hero far away (stonewards/system.ts).
 */
export const STONEWARDS_INTERMISSION_SECONDS=30;
/**
 * Share of the regular groups that besiege the base (director siegeShare): one group in four goes for the wall, from
 * round 2 on. Round 1 teaches the fight (BUG-round1-letal) and the first intermission teaches gathering and the forge.
 */
export const SIEGE_SHARE=.25,SIEGE_FROM_ROUND=2;

export interface RunSystemsOptions {
  takeInput:(playerId:string)=>PlayerInput|undefined;
  /** An offline player the room plays meanwhile (multiplayer autopilot, 3g-rede-sem-teleporte): still walks. */
  autopilot?:(playerId:string)=>boolean;
  /** Called when the run is decided; may fire more than once (the owner keeps the first, victory wins a same-tick tie). */
  onOutcome:(outcome:RunOutcomeKind)=>void;
  /** Ticks the defeat waits for the last player standing who dropped (revive.ts default if omitted; the Room passes its seat grace, VGM-047). */
  reconnectGraceTicks?:number;
  /** Lab only (LAB_ZUEIRA): replaces the seed's plan of zueira events (VGM-053B). */
  zueiraLab?:ZueiraLab;
  /** City: the plaza barricades (cidade-06, default on). Off only for travel/reach measurements in tests. */
  barricades?:boolean;
  /**
   * City only (cidade-08): round 1 is the tutorial walk from the wreck to the plaza (DirectorOptions.cityTutorial).
   * Default true; false plays the round table's round 1 (the tests of the regular city round 1 opt out).
   */
  cityTutorial?:boolean;
  /**
   * City only (cidade-11, city/balance.ts): the run's balance knobs (a headless runner's override). Default
   * CITY_BALANCE; ignored on the island and in the endless world.
   */
  cityBalance?:CityBalance;
  /**
   * D-040: the run's rotation of 12-18 roster entries (DirectorOptions.rotation, rules/enemy-rotation.ts). Default true;
   * false plays the round table's nine kinds (tests that pin the old composition).
   */
  rotation?:boolean;
  /**
   * A room checkpoint (E5-checkpoint-por-round): the systems resume from this state (RunSystems.state() of the run that
   * was cut, taken at a round's intermission) instead of starting fresh. The world must already hold the checkpoint's
   * clock and round (SimWorld.load) before the first step. Deep-copied here; the caller's object is never kept.
   */
  checkpoint?:RunSystemsState;
}
/** JSON-safe state of the stateful systems (RunSystems.state()): what a room checkpoint stores. */
export interface RunSystemsState {
  director:DirectorState;progression:ProgressionState;boss:BossState;enemyAi:EnemyAiState;
  /** Completed revives per rescuer (ReviveSystem.revives), as entries. */
  revives:[string,number][];
  stonewards:StonewardsState;zueira:ZueiraState;
}
export interface RunSystems {
  director:Director;progression:Progression;boss:BossController;enemyAi:EnemyAi;revive:ReviveSystem;
  /** Gathering, forge, wall and towers (VGM-046B). */
  stonewards:StonewardsSystem;
  /** Zueira events in the middle of a round and the last critter's kill-cam (VGM-053B). */
  zueira:ZueiraSystem;
  /** City world (cidade-05): the avenue planner shared by the director and the enemy steer (cidade-06: barricades → invalidate). */
  avenues?:AvenuePlanner;
  /** JSON-safe state of the stateful systems, for stateHash and checkpoints (live references: copy before keeping). */
  state():RunSystemsState;
  dispose():void;
}

/** JSON-safe marker (D-002) so the elite extras are applied once per enemy. */
type EliteEnemy=EnemyState&{eliteExtras?:true};
/**
 * Plan §2 item 1: the director scales elite hp (×6) and radius (×1.35) itself (D-010); the catalog's damage and xp
 * extras (ELITE.damage, ELITE.xp) are applied here, once, right after the director spawns the elite.
 */
export function applyEliteExtras(ctx:SimContext){
  for(const e of ctx.enemies.values()){
    const elite=e as EliteEnemy;
    if(!e.elite||e.boss||elite.eliteExtras)continue;
    e.damage=Math.round(e.damage*ELITE.damage);e.xp*=ELITE.xp;elite.eliteExtras=true;
  }
}

/**
 * Clearance of a prize from the wall's centre and from a tower (units); see createZueira's `blocked`. A standing city
 * barricade keeps prizes off its disc plus PRIZE_BARRICADE_MARGIN (cidade-06).
 */
export const PRIZE_WALL_CLEAR=2,PRIZE_TOWER_CLEAR=1.2,PRIZE_BARRICADE_MARGIN=.3;
/** Discs no prize falls in: the standing wall, every tower, (city) every standing barricade and every defense. */
export function prizeBlocks(state:StonewardsState):{x:number;y:number;radius:number}[]{
  const {wall,wallDown,towers,barricades,defenses}=state;
  const blocks=[...(wallDown?[]:[{x:wall.x,y:wall.y,radius:PRIZE_WALL_CLEAR}]),...towers.map(t=>({x:t.x,y:t.y,radius:PRIZE_TOWER_CLEAR}))];
  for(const b of barricades??[])if(!b.down)blocks.push({x:b.x,y:b.y,radius:b.r+PRIZE_BARRICADE_MARGIN});
  // Tower defenses (torres-sim), ruins included (still rubble on the ground): their footprint disc.
  for(const d of defenses?.list??[])blocks.push({x:d.x,y:d.y,radius:d.r});
  return blocks;
}
export function createRunSystems(world:SimWorld,options:RunSystemsOptions):RunSystems{
  const {onOutcome}=options;
  // A checkpoint is copied once: every system below mutates the state it is handed.
  const cp=options.checkpoint?structuredClone(options.checkpoint):undefined;
  const progression=createProgression({catalog:ITEMS,seed:world.seed,onBuildChange:(_ctx,p)=>{refreshStats(p);}},cp?.progression);
  // Prizes never fall on the base (the wall's stone ring and tent are drawn ~1.3 u wide and ~3 u tall: 2 u around its
  // centre) nor on a tower (1.2 u): code review of pacote-bugs-ux. Read through `stonewards`, created just below.
  let structures:()=>{x:number;y:number;radius:number}[]=()=>[];
  const zueira=createZueira(world.seed,{lab:options.zueiraLab,blocked:()=>structures()});
  // Zueira has no restore of its own: its state is plain data, read (rng included) from the first step on.
  if(cp)Object.assign(zueira.state,cp.zueira);
  let director:Director|undefined;
  // D-016: once the director is done (boss down), a same-tick wipe is not a defeat. The director only reaches 'done'
  // on its next step, so the boss's killing blow also ends the run right away.
  let bossDown=false;
  const runEnded=()=>bossDown||director!.state.stage==='done';
  // City balance knobs (cidade-11): only on a city terrain; the island and the endless world never see them.
  const cityBalance=cityTerrainOf(world.terrain)?options.cityBalance??CITY_BALANCE:undefined;
  // D-017 (E8-wall-siege-single-path): the enemy-ai is the only path that hurts the wall. It walks siege enemies to it
  // and its contact hit goes to damageWall; the Stonewards contact siege (siegeStep) stays off.
  // City horn (BUG-20261013-E4): who walked (a non-zero stick) on this tick's players step, read by 'structures' later
  // in the same tick. Transient: rebuilt every tick from the inputs, never part of the state.
  const steered=new Set<string>(),cityWorld=!!cityTerrainOf(world.terrain);
  const takeInput=cityWorld?(id:string)=>{
    const input=options.takeInput(id);
    if(input&&Math.hypot(input.x,input.y)>=.01)steered.add(id);
    return input;
  }:options.takeInput;
  const stonewards=createStonewardsSystem({
    terrain:world.terrain,siegeContact:false,...(cityWorld?{steered:(id:string)=>steered.has(id)}:{}),barricades:options.barricades,...(cityBalance?{cityBalance}:{}),
    // cidade-08 x cidade-06: in the tutorial the plaza group walks into the open plaza; the barricades rise at the 1st intermission.
    barricadesLater:options.cityTutorial??true,
    onWallDestroyed:()=>{if(!runEnded())onOutcome('defeat');},
    // The horn stretched the intermission: the offers due at its old end (the round offer, level offers armed for it)
    // move with it, so nobody's default is picked while the intermission still runs.
    extendPrepare:(ctx,endsTick)=>{
      const before=ctx.round.phaseEndsTick;
      director!.extendPrepare(ctx,endsTick);
      const after=ctx.round.phaseEndsTick;
      if(after>before)for(const queue of ctx.offers.values())for(const offer of queue)if(offer.deadlineTick===before)offer.deadlineTick=after;
    },
    // cidade-06: a barricade fell or was rebuilt; the flow grid re-reads those cells, then the planner's fields.
    onTerrainChanged:rect=>{avenues?.grid.refresh(rect);avenues?.invalidate([rect]);},
  },cp?.stonewards);
  structures=()=>prizeBlocks(stonewards.state);
  // City (cidade-05): one avenue planner for the director's spawns and the AI's steer along the avenues.
  const cityTerrain=cityTerrainOf(world.terrain),avenues=cityTerrain?cityPlanner(cityTerrain):undefined;
  const steer=avenues?citySteer(avenues,{terrain:cityTerrain}):undefined;
  // The boss walks over the plaza barricades (cidade-06; it spawns inside the base and never bashes structures, D-010):
  // its steer runs on a barricade-free copy of the city, or with the four mouths closed it finds no way out of the plaza.
  const open=cityTerrain?new CityTerrain(cityTerrain.asset,cityTerrain.signature):undefined;
  const openPlanner=open?cityPlanner(open):undefined;
  const bossSteer=open&&openPlanner?citySteer(openPlanner,{terrain:open,heroOnly:true,blockers:false}):undefined;
  // City speeds (cidade-05c v2, city/speed.ts): converted once, on the EFFECTIVE speed. The director's bodies are
  // created at the catalog speed and the director converts catalog × plan.speed (DirectorOptions.speedMap); the boss
  // converts its walk after the phase and enrage multipliers (BossOptions.speedMap); its minions, which no multiplier
  // touches, here. Island and endless keep the catalog speeds untouched.
  const inCity=<E extends EnemyState|undefined>(e:E):E=>{if(steer&&e)e.speed=citySpeed(e.speed);return e;};
  const enemyAi=createEnemyAi({projectileCap:MAX_PROJECTILES,steer,
    // Caps every enemy-ai move (the Tio's charge included) at ACTION_PEAK_MAX × this world's hero: `steer` exists only in the city.
    // The city wiring (05c) converts enemy speeds to the city hero (1.994 u/s); this is the hero they are measured against.
    // The BASE hero walk on this terrain (maps baseHeroSpeed): the heroes walk HERO_SPEED_MULT × it, but the enemies
    // must not get faster with them (velocidade-heroi-e-projetil), so the cap stays on today's hero.
    heroSpeed:baseHeroSpeed(world.terrain),
    // City only: the crowd's separation push is clamped to the same peak (endless/island pacing stays as tuned).
    capPush:!!steer,
    // The wall, plus the standing city barricades (blocking); hits go by id to the wall or the barricade (D-017).
    structures:()=>structureTargets(stonewards.state),
    hitStructure:(ctx,id,amount)=>{stonewards.hit(ctx,id,amount);},
    // Invocador (D-040): the round's corredores and enxames, spawned and tracked by the director as round members.
    minionKinds:()=>director?.minionKinds()??MINION_KINDS,
    summon:(ctx,kind,at)=>isEnemyKind(kind)?director?.summon(ctx,kind,at):undefined,
  });
  if(cp)enemyAi.restore(cp.enemyAi);
  const boss=createBoss({
    summon:(ctx,kind,at)=>hasRoom(ctx.enemies,MAX_ENEMIES)&&isEnemyKind(kind)?inCity(createEnemy(ctx,kind,at,1)):undefined,
    minionKinds:()=>director?.bossMinionKinds(),
    // City (cidade-05c v2): the boss collides by the hero rule (clearSegment), so it walks the streets on the
    // hero-size players field (steer.hero: no size class, which would send it the long way round), at the city speed.
    ...(bossSteer?{steer:bossSteer.hero,speedMap:citySpeed}:{}),
    // City boss hp knob (cidade-11): the city controller's baseHp; neutral leaves BOSS_TUNING as it is.
    ...(cityBalance&&cityBalance.bossHp!==1?{tuning:{baseHp:BOSS_TUNING.baseHp*cityBalance.bossHp}}:{}),
    // × players[n].bossHp, n the director's plan count when the boss spawns (round 10's plan; scalePlayers without one).
    ...(cityBalance&&hasTeamBossHp(cityBalance)?{hpScale:(ctx:SimContext)=>teamBossHp(cityBalance,director?.state.plan?.players??director?.scalePlayers(ctx))}:{}),
    say:(ctx,enemy,lines,key)=>enemyAi.say(ctx,enemy,lines,key),
    scalePlayers:ctx=>director?.scalePlayers(ctx)??1,
    onDefeated:()=>onOutcome('victory'),
  });
  if(cp)boss.restore(cp.boss);
  director=createDirector({
    maxEnemies:MAX_ENEMIES,
    // Unknown kinds are skipped instead of throwing; elites are scaled by the director itself (D-010).
    createEnemy:(ctx,kind,point,scale)=>isEnemyKind(kind)?createEnemy(ctx,kind,point,scale):undefined,
    spawnBoss:(ctx,point)=>boss.spawnBoss(ctx,point),
    onRoundEnd:(ctx,summary)=>{
      progression.grantRoundOffers(ctx,summary.index,summary.intermissionEndsTick);
      zueira.roundEnded(ctx,summary,director!.state.roundStart);
    },
    intermissionSeconds:STONEWARDS_INTERMISSION_SECONDS,siegeShare:SIEGE_SHARE,siegeFromRound:SIEGE_FROM_ROUND,
    rotation:options.rotation??true,
    // The last call walks siege bodies to the wall they besiege (pacote-bugs-ux, code review).
    siegeTarget:()=>{const {wall,wallDown}=stonewards.state;return wallDown?undefined:wall;},
    // City: catalog speeds for the planner's estimates, converted with plan.speed by speedMap (the bodies' speeds);
    // groups aimed at a team away from the base.
    ...(avenues?{avenues,speedMap:citySpeed,enemySpeedOf:(kind:string)=>isEnemyKind(kind)?enemyDef(kind).speed:undefined,...(steer?{cityChase:steer}:{}),
      // Round 1 is the walk from the wreck to the plaza (cidade-08).
      cityTutorial:options.cityTutorial??true,...(cityBalance?{cityBalance}:{}),...(openPlanner?{cityOpenPlanner:openPlanner}:{})}:{}),
  },cp?.director);
  // City team damage (cidade-11, CityBalance.players[n].damage): × every hit a player takes, through the core's single
  // damage path; n is the director's plan count (the current round, kept through its intermission), neutral before
  // round 2. Set (or cleared) on every run; absent unless some team size has a damage knob, so damagePlayer is unchanged.
  const damageScale=cityBalance&&hasTeamDamage(cityBalance)?()=>teamDamage(cityBalance,director!.state.plan):undefined;
  world.playerDamageScale=damageScale;
  const revive=createReviveSystem({onTeamDefeated:()=>onOutcome('defeat'),runEnded,reconnectGraceTicks:options.reconnectGraceTicks,...(cp?{revives:cp.revives}:{})});

  world.clearSystems();
  for(const system of [
    ((players:SimSystem):SimSystem=>({id:players.id,step(ctx){steered.clear();players.step(ctx);}}))(playersSystem(takeInput,options.autopilot)),
    {id:'director',step(ctx:SimContext){director!.step(ctx);applyEliteExtras(ctx);}} satisfies SimSystem,
    zueira,enemyAi,boss,
    createWeaponSystem({cap:MAX_PROJECTILES}),createProjectileSystem({cap:MAX_PROJECTILES}),createTelegraphSystem(),
    // XP gems merge above the pickup cap without losing XP (VGM-032).
    {id:'pickups',step(ctx:SimContext){progression.pickups.step(ctx);mergeXpGems(ctx.pickups,MAX_PICKUPS);}},
    progression.progression,revive,stonewards,
  ])world.register(system);

  const offKill=world.onKill((enemy,by,ctx)=>{
    progression.dropLoot(ctx,enemy,by);
    // The anão's belt explodes (telegraphed; enemies it kills come back here as their own, queued kills: D-011).
    enemyAi.onKill(ctx,enemy);
    zueira.noteKill(enemy,by,ctx.tick);
    for(const ally of ctx.players.values())if(!ally.spectator)(ally as RunPlayer).score=((ally as RunPlayer).score??0)+KILL_SCORE;
    // Decide on the killing blow: the boss onDefeated hook only runs on the next step, after revive could call a defeat.
    if(enemy.boss){bossDown=true;onOutcome('victory');}
  });
  const offZero=world.onPlayerZero((player:SimPlayer,source,ctx)=>{downPlayer(ctx,player,source);});

  return {
    director,progression,boss,enemyAi,revive,stonewards,zueira,...(avenues?{avenues}:{}),
    state:()=>({director:director!.state,progression:progression.state,boss:boss.state,enemyAi:enemyAi.state(),revives:[...revive.revives],stonewards:stonewards.state,zueira:zueira.state}),
    dispose(){offKill();offZero();if(damageScale&&world.playerDamageScale===damageScale)world.playerDamageScale=undefined;},
  };
}
