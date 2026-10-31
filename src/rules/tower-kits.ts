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
import {BICHO_ROOTS,DEFENSES,DEFENSE_IDS,isBicho,type BuildPiece,type DefenseId} from './towers.ts';
import type {FreePiece} from '../contract/index.ts';
import {BARRICADA_OFF,towerShown} from './kits-off.ts';

export const KIT_PREFIX='kit:';
/** A crate gives a kit (of its rarity's tier) instead of its row's prize this often. */
export const KIT_CHANCE=.25;
/** Charges of a wall kit (each `place` lays one piece); a tower kit has one. */
export const KIT_CHARGES:Readonly<Record<Exclude<FreePiece,'barraca'>,number>>=Object.freeze({muro:6,barricada:2});
/** What a kit may build: every tower that stands on the grid (not the rail's Gustavão) and the wall pieces. */
export type KitPiece=Exclude<DefenseId,'gustavao'>|Exclude<FreePiece,'barraca'>;
/** The legacy tower kits (the 16 before the tree of today; the protocol's DICT holds their ids in this order). */
const TOWER_KITS=DEFENSE_IDS.filter(id=>DEFENSES[id].size!==null&&!isBicho(id)) as Exclude<DefenseId,'gustavao'>[];
/** The shown tower kits (kits-off TOWERS_SHOWN) of the tier nearest `t`: a tier with none takes the nearest shown. */
const tierKits=(t:number)=>{const on=TOWER_KITS.filter(towerShown),gap=(id:typeof on[number])=>Math.abs(DEFENSES[id].tier-t),min=Math.min(...on.map(gap));return on.filter(id=>gap(id)===min);};
/**
 * The kits a crate of each rarity rolls, even odds (verde adds the wall pieces, no barricada while BARRICADA_OFF).
 * torres-3-base-9-evolucoes: while the tree of today is shown, every rarity rolls its 3 initials (never one of the 9
 * evolutions); off (kits-off TOWERS_ONLY_SHOWN false at load), rarity 1..5 → the legacy tier as before.
 */
const rootsOn=BICHO_ROOTS.some(towerShown);
const poolOf=(t:number)=>rootsOn?BICHO_ROOTS:tierKits(t);
export const KIT_POOL:Readonly<Record<1|2|3|4|5,readonly KitPiece[]>>=Object.freeze({
  1:Object.freeze([...poolOf(1),'muro',...BARRICADA_OFF?[]:['barricada']] as KitPiece[]),
  2:Object.freeze(poolOf(2)),3:Object.freeze(poolOf(3)),4:Object.freeze(poolOf(4)),5:Object.freeze(poolOf(5)),
});
/** Every kit item id, in a fixed order (the protocol's DICT appends the legacy ones; the 3 initials come last). */
export const KIT_IDS:readonly string[]=Object.freeze([...TOWER_KITS,'muro','barricada',...BICHO_ROOTS].map(p=>`${KIT_PREFIX}${p}`));
const KIT_SET=new Set(KIT_IDS);

export const kitId=(piece:KitPiece)=>`${KIT_PREFIX}${piece}`;
export const isKitId=(id:unknown):id is string=>typeof id==='string'&&KIT_SET.has(id);
/** The piece a kit id builds, or undefined for anything else. */
export const kitPiece=(id:unknown):KitPiece|undefined=>isKitId(id)?id.slice(KIT_PREFIX.length) as KitPiece:undefined;
/** A fresh kit item: its charges as the level. */
export const kitItem=(piece:KitPiece)=>({id:kitId(piece),level:piece==='muro'||piece==='barricada'?KIT_CHARGES[piece]:1});
/** The rarity a kit shows (its tower's tier; the wall pieces verde). */
export const kitRarity=(piece:KitPiece):1|2|3|4|5=>piece==='muro'||piece==='barricada'?1:Math.min(5,DEFENSES[piece].tier) as 1|2|3|4|5;
/** A tower a kit may build: not the rail's Gustavão and never one of the 9 evolutions (only evolving makes them). */
export const isTowerKit=(piece:BuildPiece):piece is Exclude<DefenseId,'gustavao'>=>
  piece!=='muro'&&piece!=='barricada'&&piece!=='gustavao'&&(!isBicho(piece)||DEFENSES[piece].from===null);
