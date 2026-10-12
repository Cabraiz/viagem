/**
 * Single item catalog of the run (VGM-042): weapons and evolutions (VGM-035) plus passives (VGM-036).
 * Offers, chests and the HUD read names, icons and max levels from here.
 */
import {WEAPON_CATALOG} from './weapons/catalog.ts';
import {PASSIVES} from '../rules/index.ts';
import type {ItemCatalog} from '../rules/index.ts';
import type {ItemDef} from '../contract/index.ts';

const ALL:readonly ItemDef[]=Object.freeze([...WEAPON_CATALOG.values(),...Object.values(PASSIVES)]);
const BY_ID:ReadonlyMap<string,ItemDef>=new Map(ALL.map(def=>[def.id,def]));

export const ITEMS:ItemCatalog={get:id=>BY_ID.get(id),all:()=>ALL};
