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

/**
 * The weapon's refire gap (ticks) at base stats by level, the last one repeating: the sim's cooldownTicks, plus the
 * duration for the weapons that linger (orbit, shield, zone; sim/weapons/system.ts). The attack's local prediction
 * (net/attack-predict.ts) does not draw a press inside it; a test keeps it equal (tests/client/attack-predict.test.ts).
 */
export const WEAPON_COOLDOWN_TICKS:Readonly<Record<string,readonly number[]>>={
  chinelo:[110,110,110,110,120,114,114,120],boleto:[26,26,26,26,24,24,22],cafe:[100,110,110,110,114,114,110],
  'guarda-chuva':[110,110,110,114,114,118,114,120],pombo:[32,32,32,32,30],audio:[40,40,40,40,38,38,36],
  'chinelo-evo':[110],'boleto-evo':[18],'cafe-evo':[90],faca:[10,10,9],pistola:[12,11,11,10],escopeta:[22,21,20,19],
  submetralhadora:[4],rifle:[22,21,20,19],macarico:[4],rojao:[62,59,56,54],baladeira:[11,10,10,9],
  espeto:[20,19,18,17],sacole:[12,11,11,10],'tampa-voadora':[22,21,20,19],pandeiro:[110,108,105,103],
  'bola-murcha':[18,17,16,15],traque:[34,33,31,30],buscape:[20,19,18,17],figa:[130,127,124,121],
  'vela-esoterica':[110,108,105,103],'tijolo-baiano':[38,36,35,33],'taro-vencido':[20,19,18,17],
  'panela-de-pressao':[44,42,40,37],'carro-de-som':[200,190,180,170],'chinelo-lendario':[110],'boleto-lendario':[18],
  'cafe-lendario':[90],'guarda-chuva-lendario':[120],'pombo-lendario':[30],'audio-lendario':[36],
};

/** The weapon's refire gap (ms) at base stats at its level, 0 when unknown. */
export function heldCooldownMs(owned:Owned|undefined):number{
  const row=owned&&WEAPON_COOLDOWN_TICKS[owned.id];
  return row?row[Math.max(0,Math.min(row.length-1,Math.floor(owned.level)-1))]*50:0;
}

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
