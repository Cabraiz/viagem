/**
 * BUG-20261023-ORQ-tiro-na-direcao-mobile: how far the equipped weapon reaches (u), for the aim stick's arrow on the
 * ground. The same numbers as the server's manualReach (sim/weapons/system.ts; a test keeps them equal), from the
 * weapon catalog and the player's stats (rules computeStats), without pulling the sim's systems into the client.
 */
import {SIM_HZ} from '../../contract/index.ts';
import {classBonusOf,computeStats} from '../../rules/index.ts';
import {getWeapon,resolveWeapon} from '../../sim/weapons/catalog.ts';

type Owned={id:string;level:number};
/** What the reach needs of a player's view (PlayerRunView fits). */
export interface ReachPlayer {classId:string;weapons:readonly Owned[];passives:readonly Owned[];hand?:number}

/** The weapon in the hand (equippedWeapon: the hand's slot; no hand: the first weapon), undefined for none. */
export function heldWeapon(p:ReachPlayer):Owned|undefined{
  if(p.hand!==undefined){const held=p.weapons[p.hand];return held&&getWeapon(held.id)?.pattern?held:undefined;}
  return p.weapons.find(o=>!!getWeapon(o.id)?.pattern);
}

/** The equipped weapon's reach (u) as the server counts it (manualReach, without the enemy's radius), or undefined. */
export function heldReach(p:ReachPlayer):number|undefined{
  const owned=heldWeapon(p),def=owned&&getWeapon(owned.id);
  if(!owned||!def?.pattern)return undefined;
  const w=resolveWeapon(def,owned.level,computeStats({weapons:[...p.weapons],passives:[...p.passives]},classBonusOf(p.classId)));
  switch(def.pattern){
    case 'pierce':return Math.min(w.range,w.speed*w.durationTicks/SIM_HZ+w.area);
    case 'homing':return w.range;
    case 'zone':return def.evolved?.followsOwner?w.area:w.range;
    case 'orbit':return w.area+Math.max(.25,.22*w.area);
    case 'shield':case 'cone':return w.area;
  }
}
