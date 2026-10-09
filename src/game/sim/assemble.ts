/**
 * Wires one horde run (VGM-042): fresh instances of every system, the kill/zero hooks and the outcome callbacks.
 * Called on every new run; dispose() removes this run's hooks before the next one registers.
 */
import type {SimWorld} from './core.ts';
import type {SimContext,SimPlayer} from './types.ts';
import {MAX_ENEMIES,MAX_PICKUPS,MAX_PROJECTILES,hasRoom,mergeXpGems} from './budget.ts';
import {createDirector,type Director} from './director.ts';
import {createEnemy,isEnemyKind} from './enemies/catalog.ts';
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

export type RunOutcomeKind='victory'|'defeat';
export const KILL_SCORE=10;

export interface RunSystemsOptions {
  takeInput:(playerId:string)=>PlayerInput|undefined;
  /** Called when the run is decided; may fire more than once (the owner keeps the first, victory wins a same-tick tie). */
  onOutcome:(outcome:RunOutcomeKind)=>void;
}
export interface RunSystems {
  director:Director;progression:Progression;boss:BossController;enemyAi:EnemyAi;revive:ReviveSystem;
  /** JSON-safe state of the stateful systems, for stateHash and checkpoints. */
  state():unknown;
  dispose():void;
}

export function createRunSystems(world:SimWorld,options:RunSystemsOptions):RunSystems{
  const {onOutcome}=options;
  const progression=createProgression({catalog:ITEMS,seed:world.seed,onBuildChange:(_ctx,p)=>{refreshStats(p);}});
  const enemyAi=createEnemyAi({projectileCap:MAX_PROJECTILES});
  let director:Director|undefined;
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
  });
  // D-016: once the director is done (boss down), a same-tick wipe is not a defeat. D-017: no structures until 046B.
  // The director only reaches 'done' on its next step, so the boss's killing blow also ends the run right away.
  let bossDown=false;
  const revive=createReviveSystem({onTeamDefeated:()=>onOutcome('defeat'),runEnded:()=>bossDown||director!.state.stage==='done'});

  world.clearSystems();
  for(const system of [
    playersSystem(options.takeInput),director,enemyAi,boss,
    createWeaponSystem({cap:MAX_PROJECTILES}),createProjectileSystem({cap:MAX_PROJECTILES}),createTelegraphSystem(),
    // XP gems merge above the pickup cap without losing XP (VGM-032).
    {id:'pickups',step(ctx:SimContext){progression.pickups.step(ctx);mergeXpGems(ctx.pickups,MAX_PICKUPS);}},
    progression.progression,revive,
  ])world.register(system);

  const offKill=world.onKill((enemy,by,ctx)=>{
    progression.dropLoot(ctx,enemy,by);
    for(const ally of ctx.players.values())if(!ally.spectator)(ally as RunPlayer).score=((ally as RunPlayer).score??0)+KILL_SCORE;
    // Decide on the killing blow: the boss onDefeated hook only runs on the next step, after revive could call a defeat.
    if(enemy.boss){bossDown=true;onOutcome('victory');}
  });
  const offZero=world.onPlayerZero((player:SimPlayer,source,ctx)=>{downPlayer(ctx,player,source);});

  return {
    director,progression,boss,enemyAi,revive,
    state:()=>({director:director!.state,progression:progression.state,boss:boss.state,enemyAi:enemyAi.state(),revives:[...revive.revives]}),
    dispose(){offKill();offZero();},
  };
}
