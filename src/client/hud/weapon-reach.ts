/**
 * BUG-20261023-ORQ-tiro-na-direcao-mobile: how far the equipped weapon reaches (u), for the aim stick's arrow on the
 * ground. The client has no weapon catalog (that lives in the sim, and the client may not import it, OWNERS.md), so
 * this is the server's manualReach (sim/weapons/system.ts) per level with the base stats, a table a test keeps equal
 * (tests/client/mira-joystick.test.ts). A passive that grows the area or the range is not counted: the arrow is a guide.
 */

type Owned={id:string;level:number};
/** What the reach needs of a player's view (PlayerRunView fits). */
export interface ReachPlayer {weapons:readonly Owned[];hand?:number}

/** manualReach (u) by weapon id, one entry per level (the last one repeats past it). */
export const WEAPON_REACH:Readonly<Record<string,readonly number[]>>={
  chinelo:[1.95,1.95,2.2,2.2,2.2,2.32,2.32,2.44],boleto:[7,7,7.5,7.5,8,8,8.5,9],cafe:[6,6,6.5,6.5,7,7,7.5,8],
  'guarda-chuva':[.9,1,1,1.1,1.2,1.3,1.4,1.6],pombo:[8,8,8.5,8.5,9,9,9.5,10],audio:[2,2.3,2.3,2.5,2.7,3,3.2,3.5],
  'chinelo-evo':[2.68],'boleto-evo':[9],'cafe-evo':[2.2],
  faca:[2.6],pistola:[7],escopeta:[4],submetralhadora:[6],rifle:[11],macarico:[3.5],rojao:[9],
  'chinelo-lendario':[2.68],'boleto-lendario':[9],'cafe-lendario':[2.2],'guarda-chuva-lendario':[1.6],'pombo-lendario':[10],'audio-lendario':[3.5],
  // Pack 12.
  baladeira:[8],espeto:[7],sacole:[7],'tampa-voadora':[5.4],pandeiro:[1.952],'bola-murcha':[7],traque:[6],buscape:[9],figa:[1.464],
  'vela-esoterica':[2.44],'tijolo-baiano':[11],'taro-vencido':[6],'panela-de-pressao':[3],'carro-de-som':[8],
};

/** The weapon in the hand (equippedWeapon: the hand's slot; no hand: the first weapon), undefined for none. */
export function heldWeapon(p:ReachPlayer):Owned|undefined{
  if(p.hand!==undefined){const held=p.weapons[p.hand];return held&&WEAPON_REACH[held.id]?held:undefined;}
  return p.weapons.find(o=>!!WEAPON_REACH[o.id]);
}

/** The equipped weapon's reach (u) at its level, or undefined (nothing in the hand). */
export function heldReach(p:ReachPlayer):number|undefined{
  const owned=heldWeapon(p),row=owned&&WEAPON_REACH[owned.id];
  return row?row[Math.max(0,Math.min(row.length-1,Math.floor(owned.level)-1))]:undefined;
}
