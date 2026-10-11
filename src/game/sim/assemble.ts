/**
 * Wires one horde run (VGM-042): fresh instances of every system, the kill/zero hooks and the outcome callbacks.
 * Called on every new run; dispose() removes this run's hooks before the next one registers.
 */
import type {SimWorld} from './core.ts';
import type {EnemyState,SimContext,SimPlayer,SimSystem} from './types.ts';
import {MAX_ENEMIES,MAX_PICKUPS,MAX_PROJECTILES,hasRoom,mergeXpGems} from './budget.ts';
import {createDirector,type Director} from './director.ts';
import {ELITE,createEnemy,isEnemyKind} from './enemies/catalog.ts';
import {createEnemyAi,type EnemyAi} from './enemies/ai.ts';
import {createBoss,type BossController} from './boss.ts';
import {createWeaponSystem} from './weapons/system.ts';
import {createProjectileSystem} from './projectiles.ts';
import {createTelegraphSystem} from './telegraphs.ts';
import {createProgression,type Progression} from './progression.ts';
import {createReviveSystem,downPlayer,type ReviveSystem} from './revive.ts';
import {refreshStats} from './stats.ts';
import {ITEMS} from './items.ts';
import {playersSystem,type PlayerInput,type RunPlayer} from './systems/players.ts';
import {createStonewardsSystem,damageWall,type StonewardsSystem} from './stonewards/system.ts';
import {WALL_RADIUS} from './stonewards/wall.ts';

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
  /** Called when the run is decided; may fire more than once (the owner keeps the first, victory wins a same-tick tie). */
  onOutcome:(outcome:RunOutcomeKind)=>void;
  /** Ticks the defeat waits for the last player standing who dropped (revive.ts default if omitted; the Room passes its seat grace, VGM-047). */
  reconnectGraceTicks?:number;
}
export interface RunSystems {
  director:Director;progression:Progression;boss:BossController;enemyAi:EnemyAi;revive:ReviveSystem;
  /** Gathering, forge, wall and towers (VGM-046B). */
  stonewards:StonewardsSystem;
  /** JSON-safe state of the stateful systems, for stateHash and checkpoints. */
  state():unknown;
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

export function createRunSystems(world:SimWorld,options:RunSystemsOptions):RunSystems{
  const {onOutcome}=options;
  const progression=createProgression({catalog:ITEMS,seed:world.seed,onBuildChange:(_ctx,p)=>{refreshStats(p);}});
  let director:Director|undefined;
  // D-016: once the director is done (boss down), a same-tick wipe is not a defeat. The director only reaches 'done'
  // on its next step, so the boss's killing blow also ends the run right away.
  let bossDown=false;
  const runEnded=()=>bossDown||director!.state.stage==='done';
  // D-017 (E8-wall-siege-single-path): the enemy-ai is the only path that hurts the wall. It walks siege enemies to it
  // and its contact hit goes to damageWall; the Stonewards contact siege (siegeStep) stays off.
  const stonewards=createStonewardsSystem({
    terrain:world.terrain,siegeContact:false,
    onWallDestroyed:()=>{if(!runEnded())onOutcome('defeat');},
    // The horn stretched the intermission: the offers due at its old end (the round offer, level offers armed for it)
    // move with it, so nobody's default is picked while the intermission still runs.
    extendPrepare:(ctx,endsTick)=>{
      const before=ctx.round.phaseEndsTick;
      director!.extendPrepare(ctx,endsTick);
      const after=ctx.round.phaseEndsTick;
      if(after>before)for(const queue of ctx.offers.values())for(const offer of queue)if(offer.deadlineTick===before)offer.deadlineTick=after;
    },
  });
  const enemyAi=createEnemyAi({projectileCap:MAX_PROJECTILES,
    structures:()=>{const {wall,wallDown}=stonewards.state;return wallDown?[]:[{id:wall.id,x:wall.x,y:wall.y,radius:WALL_RADIUS}];},
    hitStructure:(ctx,id,amount)=>{if(id===stonewards.state.wall.id)damageWall(ctx,stonewards.state,amount);},
  });
  const boss=createBoss({
    summon:(ctx,kind,at)=>hasRoom(ctx.enemies,MAX_ENEMIES)&&isEnemyKind(kind)?createEnemy(ctx,kind,at,1):undefined,
    say:(ctx,enemy,lines,key)=>enemyAi.say(ctx,enemy,lines,key),
    scalePlayers:ctx=>director?.scalePlayers(ctx)??1,
    onDefeated:()=>onOutcome('victory'),
  });
  director=createDirector({
    maxEnemies:MAX_ENEMIES,
    // Unknown kinds are skipped instead of throwing; elites are scaled by the director itself (D-010).
    createEnemy:(ctx,kind,point,scale)=>isEnemyKind(kind)?createEnemy(ctx,kind,point,scale):undefined,
    spawnBoss:(ctx,point)=>boss.spawnBoss(ctx,point),
    onRoundEnd:(ctx,summary)=>{progression.grantRoundOffers(ctx,summary.index,summary.intermissionEndsTick);},
    intermissionSeconds:STONEWARDS_INTERMISSION_SECONDS,siegeShare:SIEGE_SHARE,siegeFromRound:SIEGE_FROM_ROUND,
  });
  const revive=createReviveSystem({onTeamDefeated:()=>onOutcome('defeat'),runEnded,reconnectGraceTicks:options.reconnectGraceTicks});

  world.clearSystems();
  for(const system of [
    playersSystem(options.takeInput),
    {id:'director',step(ctx:SimContext){director!.step(ctx);applyEliteExtras(ctx);}} satisfies SimSystem,
    enemyAi,boss,
    createWeaponSystem({cap:MAX_PROJECTILES}),createProjectileSystem({cap:MAX_PROJECTILES}),createTelegraphSystem(),
    // XP gems merge above the pickup cap without losing XP (VGM-032).
    {id:'pickups',step(ctx:SimContext){progression.pickups.step(ctx);mergeXpGems(ctx.pickups,MAX_PICKUPS);}},
    progression.progression,revive,stonewards,
  ])world.register(system);

  const offKill=world.onKill((enemy,by,ctx)=>{
    progression.dropLoot(ctx,enemy,by);
    for(const ally of ctx.players.values())if(!ally.spectator)(ally as RunPlayer).score=((ally as RunPlayer).score??0)+KILL_SCORE;
    // Decide on the killing blow: the boss onDefeated hook only runs on the next step, after revive could call a defeat.
    if(enemy.boss){bossDown=true;onOutcome('victory');}
  });
  const offZero=world.onPlayerZero((player:SimPlayer,source,ctx)=>{downPlayer(ctx,player,source);});

  return {
    director,progression,boss,enemyAi,revive,stonewards,
    state:()=>({director:director!.state,progression:progression.state,boss:boss.state,enemyAi:enemyAi.state(),revives:[...revive.revives],stonewards:stonewards.state}),
    dispose(){offKill();offZero();},
  };
}
