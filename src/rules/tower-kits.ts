/**
 * Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa, user 20/10: "a caixa pode ter a arma ou a torre, como no WC3,
 * normal, raro, épico e lendário; não tem botão Construir, clica no item da caixa para construir"). Tables only: the
 * crates roll them (sim/crates.ts), the inventory holds them (sim/inventory.ts) and `place` builds them (sim
 * towers/system.ts buildFree with a kit: no fichas, no Grana).
 * - One item a piece: `kit:<piece>` (KIT_PREFIX), a tower of the tree or a wall piece; it takes one inventory slot. Its
 *   `level` is the charges left: 1 for a tower, KIT_CHARGES for the wall pieces (a muro kit lays a short wall).
 * - Rarity = tier (KIT_POOL): verde the T1 Vigia and the wall pieces, azul tier 2, roxa tier 3, dourada tier 4,
 *   lendária tier 5. A kit of tier N builds that tower straight away (no walk up the tree). The Gustavão is left out:
 *   it rides the rail, and the free build has none.
 * - A crate gives a kit instead of its row's prize with KIT_CHANCE, the one knob of the mix.
 */
import {DEFENSES,DEFENSE_IDS,type BuildPiece,type DefenseId} from './towers.ts';
import type {FreePiece} from '../contract/index.ts';

export const KIT_PREFIX='kit:';
/** A crate gives a kit (of its rarity's tier) instead of its row's prize this often. */
export const KIT_CHANCE=.25;
/** Charges of a wall kit (each `place` lays one piece); a tower kit has one. */
export const KIT_CHARGES:Readonly<Record<FreePiece,number>>=Object.freeze({muro:6,barricada:2});
/** What a kit may build: every tower that stands on the grid (not the rail's Gustavão) and the wall pieces. */
export type KitPiece=Exclude<DefenseId,'gustavao'>|FreePiece;
const TOWER_KITS=DEFENSE_IDS.filter(id=>DEFENSES[id].size!==null) as Exclude<DefenseId,'gustavao'>[];
/**
 * Towers no crate gives (torre-limite-rebocar-sem-arma, the user, 25/10: "as torres são para defender"): the Posto de
 * Radar fires nothing (it only lends range). Its kit id stays in KIT_IDS (the protocol's DICT, older checkpoints).
 */
export const KIT_NOT_IN_CRATES:readonly KitPiece[]=Object.freeze(['posto-de-radar']);
const inPool=(tier:number)=>TOWER_KITS.filter(id=>DEFENSES[id].tier===tier&&!KIT_NOT_IN_CRATES.includes(id));
/** The kits a crate of each rarity rolls, even odds (rarity 1..5 → tier; verde adds the wall pieces). */
export const KIT_POOL:Readonly<Record<1|2|3|4|5,readonly KitPiece[]>>=Object.freeze({
  1:Object.freeze([...inPool(1),'muro','barricada'] as KitPiece[]),
  2:Object.freeze(inPool(2)),
  3:Object.freeze(inPool(3)),
  4:Object.freeze(inPool(4)),
  5:Object.freeze(inPool(5)),
});
/** Every kit item id, in a fixed order (the protocol's DICT appends them). */
export const KIT_IDS:readonly string[]=Object.freeze([...TOWER_KITS,'muro','barricada'].map(p=>`${KIT_PREFIX}${p}`));
const KIT_SET=new Set(KIT_IDS);

export const kitId=(piece:KitPiece)=>`${KIT_PREFIX}${piece}`;
export const isKitId=(id:unknown):id is string=>typeof id==='string'&&KIT_SET.has(id);
/** The piece a kit id builds, or undefined for anything else. */
export const kitPiece=(id:unknown):KitPiece|undefined=>isKitId(id)?id.slice(KIT_PREFIX.length) as KitPiece:undefined;
/** A fresh kit item: its charges as the level. */
export const kitItem=(piece:KitPiece)=>({id:kitId(piece),level:piece==='muro'||piece==='barricada'?KIT_CHARGES[piece]:1});
/** The rarity a kit shows (its tower's tier; the wall pieces verde). */
export const kitRarity=(piece:KitPiece):1|2|3|4|5=>piece==='muro'||piece==='barricada'?1:Math.min(5,DEFENSES[piece].tier) as 1|2|3|4|5;
export const isTowerKit=(piece:BuildPiece):piece is Exclude<DefenseId,'gustavao'>=>piece!=='muro'&&piece!=='barricada'&&piece!=='gustavao';
