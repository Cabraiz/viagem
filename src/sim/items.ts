/**
 * Single item catalog of the run (VGM-042): weapons and evolutions (VGM-035) plus passives (VGM-036).
 * Offers, chests and the HUD read names, icons and max levels from here.
 */
import {WEAPON_CATALOG,weaponCatalog} from './weapons/catalog.ts';
import {AUTO_PASSIVE_IDS,MANUAL_PASSIVE_IDS,PASSIVES,PASSIVE_IDS} from '../rules/index.ts';
import {CONSUMABLES} from './weapons/arsenal.ts';
import type {ItemCatalog} from '../rules/index.ts';
import type {ItemDef} from '../contract/index.ts';

/** What the automatic game's offers roll: its weapons and evolutions, and the passives but the manual ones. */
const ALL:readonly ItemDef[]=Object.freeze([...weaponCatalog.all(),...AUTO_PASSIVE_IDS.map(id=>PASSIVES[id])]);
/** Every item by id (names and icons for the HUD): also the D-051 arsenal, its consumables and passives. */
const BY_ID:ReadonlyMap<string,ItemDef>=new Map([...WEAPON_CATALOG.values(),...Object.values(PASSIVES),...Object.values(CONSUMABLES)].map(def=>[def.id,def]));

export const ITEMS:ItemCatalog={get:id=>BY_ID.get(id),all:()=>ALL};
/**
 * D-051 manual combat's level cards (proposal §5, answer 5): the passives only (every one, the hand's reinforcements
 * Pente and the tomes included; no Silenciador since melee-alcance-2x) and the coxinha when all are maxed (rollChoices' HEAL_CHOICE). No weapon card:
 * weapons come from the crates.
 */
const MANUAL_ALL:readonly ItemDef[]=Object.freeze(PASSIVE_IDS.map(id=>PASSIVES[id]));
export const MANUAL_ITEMS:ItemCatalog={get:id=>BY_ID.get(id),all:()=>MANUAL_ALL};
export {MANUAL_PASSIVE_IDS};
