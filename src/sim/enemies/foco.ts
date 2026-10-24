/**
 * Foco dos inimigos (NEW-20261023-ORQ-inimigos-querem-o-uno; o usuário, 23/10: "todos os inimigos querem quebrar o Uno
 * pelo barulho; somente uma parte vai pensar em nos atacar").
 *
 * Each wave body (ninhos.ts tune: born in a nest, from outside or recruited from the map) gets a foco once, a pure
 * function of its id (no stream draw, so the waves stay the same):
 *  - FOCO_UNO (UNO_FOCUS_SHARE of them): walks to the car (or the moto in its lure reach) and ignores the players, unless
 *    a player hurts it (core damageEnemy marks `provokedBy`); then the enemy-ai turns it on that player for AGGRO_SECONDS
 *    after the last hit (the skills' taunt), while fewer than AGGRO_PER_PLAYER × the live players are provoked at once.
 *  - FOCO_CACADOR: hunts the players as before and ignores the car (it hits the car only when no player stands).
 * Bodies without a foco (other modes, the boss) keep the old rule: the nearest of a player and, for a besieger, a structure.
 */
import type {EnemyState} from '../../contract/index.ts';
import {hashUnit} from './catalog.ts';

/** Enemy memory key of the foco (JSON-safe number). */
export const FOCO='foco';
export const FOCO_UNO=1,FOCO_CACADOR=2;
/** Enemy memory key: 1 while a FOCO_UNO body is turned on a player by a hit (its taunt). */
export const AGGRO='aggro';
/** Share of the wave bodies that go for the Uno (balance: the card's step 5). */
export const UNO_FOCUS_SHARE=.75;
/** Seconds a hit keeps a FOCO_UNO body on the player who hit it (refreshed by every hit). */
export const AGGRO_SECONDS=6;
/** At most this many FOCO_UNO bodies × live players are turned on players at once. */
export const AGGRO_PER_PLAYER=3;

/** A body as the core and the enemy-ai see it: the player whose hit it has not answered yet (transient, JSON-safe). */
export type ProvokedEnemy=EnemyState&{provokedBy?:string};

/** The foco of a body: a pure function of its id. */
export const focoOf=(id:string)=>hashUnit(id+'#foco')<UNO_FOCUS_SHARE?FOCO_UNO:FOCO_CACADOR;

/** Gives `e` its foco once (a recruit that slept and comes back keeps it). */
export function assignFoco(e:EnemyState){
  const memory=e.memory??={};
  if(memory[FOCO]===undefined)memory[FOCO]=focoOf(e.id);
}

/** core damageEnemy: a player's hit on a FOCO_UNO body that survived it. */
export function provoke(e:EnemyState,player:string){
  if(e.memory?.[FOCO]===FOCO_UNO)(e as ProvokedEnemy).provokedBy=player;
}
