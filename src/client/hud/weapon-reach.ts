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
  boleto:[7,7,7.5,7.5,8,8,8.5,9],cafe:[6,6,6.5,6.5,7,7,7.5,8],
  'guarda-chuva':[.9,1,1,1.1,1.2,1.3,1.4,1.6],pombo:[8,8,8.5,8.5,9,9,9.5,10],audio:[2,2.3,2.3,2.5,2.7,3,3.2,3.5],
  'boleto-evo':[9],'cafe-evo':[2.2],
  faca:[2.6],pistola:[7],escopeta:[4],submetralhadora:[6],rifle:[11],macarico:[3.5],rojao:[9],
  'boleto-lendario':[9],'cafe-lendario':[2.2],'guarda-chuva-lendario':[1.6],'pombo-lendario':[10],'audio-lendario':[3.5],
  // Pack 12.
  baladeira:[8],espeto:[7],sacole:[7],'tampa-voadora':[5.4],'bola-murcha':[7],traque:[6],buscape:[9],
  'tijolo-baiano':[11],'taro-vencido':[6],'panela-de-pressao':[3],'carro-de-som':[8],
};

/**
 * The weapon's refire gap (ticks) at base stats by level, the last one repeating: the sim's cooldownTicks, plus the
 * duration for the weapons that linger (orbit, shield, zone; sim/weapons/system.ts). The attack's local prediction
 * (net/attack-predict.ts) does not draw a press inside it; a test keeps it equal (tests/client/attack-predict.test.ts).
 */
export const WEAPON_COOLDOWN_TICKS:Readonly<Record<string,readonly number[]>>={
  boleto:[26,26,26,26,24,24,22],cafe:[100,110,110,110,114,114,110],
  'guarda-chuva':[110,110,110,114,114,118,114,120],pombo:[32,32,32,32,30],audio:[40,40,40,40,38,38,36],
  'boleto-evo':[18],'cafe-evo':[90],faca:[10,10,9],pistola:[12,11,11,10],escopeta:[22,21,20,19],
  submetralhadora:[4],rifle:[22,21,20,19],macarico:[4],rojao:[62,59,56,54],baladeira:[11,10,10,9],
  espeto:[20,19,18,17],sacole:[12,11,11,10],'tampa-voadora':[22,21,20,19],
  'bola-murcha':[18,17,16,15],traque:[34,33,31,30],buscape:[20,19,18,17],
  'tijolo-baiano':[38,36,35,33],'taro-vencido':[20,19,18,17],
  'panela-de-pressao':[44,42,40,37],'carro-de-som':[200,190,180,170],'boleto-lendario':[18],
  'cafe-lendario':[90],'guarda-chuva-lendario':[120],'pombo-lendario':[30],'audio-lendario':[36],
};

/**
 * NEW-20261031-ORQ-tiro-rapido-e-local: the travelling shots' flight at base stats by level, the last one repeating:
 * [speed (u/s), flight (ticks)] of the sim's resolveWeapon (pierce, homing and ricochet; HERO_SHOT_SPEED_MULT counted).
 * The local hero's projectile is drawn on the press with it (render/own-shots.ts); a test keeps it equal
 * (tests/client/own-shots.test.ts). A passive that speeds the shot is learned from the room's copy.
 */
export const SHOT_FLIGHT:Readonly<Record<string,readonly (readonly [number,number])[]>>={
  boleto:[[3.375,64],[3.75,69],[3.75,69],[3.75,69],[4.125,75],[4.125,75],[4.5,80],[4.875,85]],
  pombo:[[1.875,160],[1.875,160],[2.0625,160],[2.0625,160],[2.25,160],[2.25,160],[2.4375,160],[2.625,160]],
  'boleto-evo':[[4.875,53]],pistola:[[3.75,37]],submetralhadora:[[4.125,29]],rifle:[[6,37]],
  baladeira:[[4.125,40]],espeto:[[3.375,43]],sacole:[[3.375,40]],'tampa-voadora':[[3.375,32]],'bola-murcha':[[3.375,64]],
  buscape:[[2.25,133]],'taro-vencido':[[3.75,32]],'boleto-lendario':[[4.875,53]],'pombo-lendario':[[2.625,160]],
};

/** The held weapon's flight at its level ([u/s, ticks]), undefined when it does not travel. */
export function heldFlight(owned:Owned|undefined):readonly [number,number]|undefined{
  const row=owned&&SHOT_FLIGHT[owned.id];
  return row?row[Math.max(0,Math.min(row.length-1,Math.floor(owned.level)-1))]:undefined;
}

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
