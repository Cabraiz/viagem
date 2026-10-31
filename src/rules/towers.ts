/**
 * Moved from src/sim/towers/catalog.ts (torres-hud) so the client's build menu can read it; the sim re-exports it.
 *
 * Defense tree (torres-sim, D-041; design/proximos/08-TORRES.md §3): every defense is born as the Guarita (id vigia-do-predio) and
 * evolves in place. At tier 2 it picks a branch: A (more people shooting), B (structures that explode, up to the
 * Gustavão on the rail) or C (control and support). After A3 the A line forks: A4 → A5, or the alternative A4b → A5b.
 *
 * Costs (card): T1 6, T2 10, T3 16, T4 24, T5 36, Gustavão 60 + the rail 12, in crate material units. The team pays a
 * cost from its two piles (coco + pedra) in any mix, by `payUnits`: always from the larger pile, so the piles even out
 * and the forge's mixed recipes stay buyable.
 *
 * Construction: obra-1 → obra-2 → obra-3 → pronta, three equal thirds of `buildSeconds` (6 s at T1 up to 15 s at T5,
 * 24 s for the Gustavão). It runs on its own once paid (no worker needed); a defense under construction does not fire.
 * Life: hp → danificada at ≤ 50 % (still fires, the client draws it hurt) → ruina at 0 (stops for good; its site may be
 * built again). Rows of the art: obra-1, obra-2, obra-3, pronta, danificada, ruina.
 *
 * Combat (proposed numbers, balance tunes them): `damage` per hit, `shots` distinct targets per volley, `cooldown`
 * between volleys, `range` (× the radar bonus), `area` (radius around each impact; 0 = single target), `minRange`
 * (artillery cannot shoot at its own feet), `hits` which enemies it reaches (EnemyDef.flying: 'air' only the flyers,
 * 'ground' never them), `target` (nearest; strongest = the highest hp; cluster = where the most enemies stand; aura =
 * everything around the defense itself), `slow` (slowUntil, ticks), `dazzle` (frozenUntil on the main target, with a
 * chance per volley) and `radar` (every other ready defense within `reach` gets +bonus range; bonuses do not stack).
 * Control effects (slow, dazzle) never touch the boss.
 *
 * Size: the art's footprint mapped to a BuildSize by its larger side (3×2 → 3, 1×2 → 2), except the root, which takes
 * size 1 (the orchestrator's site rule: "T1 may use 1"; the art keeps its 2×2 drawing), so every site, the endless
 * camp's 1×1 ones included, can hold a Vigia; a tier larger than its site's maxSize is refused (on a 1×1 site the root
 * can only become a Rojão or a Holofote). The Gustavão is not built on a site: it moves onto the laid rail (RailSite).
 */
import {ticks,type FreePiece} from '../contract/index.ts';
import {CITY_DISTANCE_SCALE} from './scale.ts';
import {UNITS_PER_TOKEN} from './stonewards.ts';
/** Site size a defense needs (structurally the maps port's BuildSize; rules may not import maps). */
export type DefenseSize=1|2|3;

export type DefenseId=
  | 'vigia-do-predio'
  | 'vigias-armados'|'atiradores-do-telhado'|'ninho-de-metralhadora'|'guarnicao-do-predio'|'ninho-do-sniper'|'equipe-antimaterial'
  | 'rojao-de-festa'|'morteiro'|'lanca-foguetes'|'obuseiro'|'gustavao'
  | 'holofote'|'arame-e-sirene'|'antiaerea-quadrupla'|'posto-de-radar';
export type Branch='A'|'B'|'C';
export type Hits='ground'|'air'|'all';
export type TargetMode='nearest'|'strongest'|'cluster'|'aura'|'none';
/** Art rows of a defense's base (08-TORRES.md §2). */
export type DefensePhase='obra-1'|'obra-2'|'obra-3'|'pronta'|'danificada'|'ruina';
export const DEFENSE_PHASES:readonly DefensePhase[]=Object.freeze(['obra-1','obra-2','obra-3','pronta','danificada','ruina'] as DefensePhase[]);

export interface DefenseDef {
  id:DefenseId;name:string;
  /** Tree label: T1, A2…A5, A4b, A5b, B2…B6, C2…C5. */
  label:string;tier:1|2|3|4|5|6;branch:Branch|null;
  /** The tier it evolves from (null: the root). */
  from:DefenseId|null;
  /** Main line or the alternative (A4b/A5b) when a tier has two children. */
  alt?:true;
  /** Art footprint in cells (08-TORRES.md) and the BuildSize it needs (null: built on the rail). */
  footprint:readonly [number,number];size:DefenseSize|null;
  cost:number;buildSeconds:number;hp:number;
  range:number;minRange:number;cooldown:number;damage:number;shots:number;area:number;hits:Hits;target:TargetMode;
  slow?:number;dazzle?:{ticks:number;chance:number};radar?:{reach:number;bonus:number};
  /** Needs the laid rail (the Gustavão). */
  rail?:true;
}

/**
 * D-048 (ficha de torre): building a root costs 1 ficha, the Gustavão 3 (its rail included); TOWER_TOKENS × UNITS_PER_TOKEN
 * units. An evolution (tiers 2-5) is paid in Grana (EVOLVE_PRICE); TIER_COST[2..5] is only the old material scale it came from.
 */
export const TOWER_TOKENS=Object.freeze({root:1,gustavao:3});
export const TIER_COST:Readonly<Record<1|2|3|4|5,number>>=Object.freeze({1:TOWER_TOKENS.root*UNITS_PER_TOKEN,2:10,3:16,4:24,5:36});
export const GUSTAVAO_COST=TOWER_TOKENS.gustavao*UNITS_PER_TOKEN;
/**
 * D-048: an evolution is paid in Grana, R$ by the tier it reaches (approved by the Orquestrador, 13/10/2026: k ≈ 1 R$ per
 * old material unit; the Gustavão is the exception, 3 fichas). A tower repair is TOWER_REPAIR_PRICE.
 */
export const EVOLVE_PRICE:Readonly<Record<2|3|4|5,number>>=Object.freeze({2:10,3:16,4:25,5:35});
export const TOWER_REPAIR_PRICE=5;
/** What building or evolving into `d` takes: fichas (the root, the Gustavão) or Grana (every other evolution). */
export const priceOf=(d:{id:string;tier:number}):{tokens:number}|{grana:number}=>
  d.id==='gustavao'?{tokens:TOWER_TOKENS.gustavao}:d.tier<=1?{tokens:TOWER_TOKENS.root}:{grana:EVOLVE_PRICE[d.tier as 2|3|4|5]};
/** Build time per tier (s), split in three equal obra phases. */
export const TIER_BUILD_SECONDS:Readonly<Record<1|2|3|4|5|6,number>>=Object.freeze({1:6,2:8,3:10,4:12,5:15,6:24});
/** The Gustavão's rail ('linha-ferrea'): laid once per run on the plan's RailSite; free (D-048: in the Gustavão's 3 fichas). */
export const RAIL=Object.freeze({id:'linha-ferrea' as const,siteId:'trilho' as const,cost:0,buildSeconds:8});
/** Match limits (D-041): defenses standing per team (ruins do not count) and Gustavões per run (a ruined one counts). */
export const DEFENSE_LIMIT=12,GUSTAVAO_LIMIT=1;
/** Share of maxHp at or under which a defense is `danificada`. */
export const DAMAGED_AT=.5;

type Spec=Omit<DefenseDef,'cost'|'buildSeconds'|'size'|'minRange'|'shots'|'area'|'hits'|'target'>&Partial<Pick<DefenseDef,'minRange'|'shots'|'area'|'hits'|'target'>>;
const sizeOf=(f:readonly [number,number]):DefenseSize=>Math.max(1,Math.min(3,Math.max(f[0],f[1]))) as DefenseSize;
function def(s:Spec):DefenseDef{
  return Object.freeze({minRange:0,shots:1,area:0,hits:'all',target:'nearest',...s,
    cost:s.id==='gustavao'?GUSTAVAO_COST:TIER_COST[s.tier as 1|2|3|4|5],buildSeconds:TIER_BUILD_SECONDS[s.tier],
    size:s.rail?null:s.from===null?1:sizeOf(s.footprint),footprint:Object.freeze([...s.footprint]) as unknown as readonly [number,number]}) as DefenseDef;
}
const s=(seconds:number)=>ticks(seconds);

export const DEFENSES:Readonly<Record<DefenseId,DefenseDef>>=Object.freeze({
  // T1: one sleepy guard with a revolver.
  'vigia-do-predio':def({id:'vigia-do-predio',name:'Guarita',label:'T1',tier:1,branch:null,from:null,footprint:[2,2],hp:400,
    range:6,cooldown:s(1),damage:8}),
  // A: more people spreading bullets (more targets per volley).
  'vigias-armados':def({id:'vigias-armados',name:'Mirante',label:'A2',tier:2,branch:'A',from:'vigia-do-predio',footprint:[2,2],hp:550,
    range:6.5,cooldown:s(.9),damage:7,shots:2}),
  'atiradores-do-telhado':def({id:'atiradores-do-telhado',name:'Andaime',label:'A3',tier:3,branch:'A',from:'vigias-armados',footprint:[2,2],hp:700,
    range:7,cooldown:s(.8),damage:9,shots:3}),
  'ninho-de-metralhadora':def({id:'ninho-de-metralhadora',name:'Ninho',label:'A4',tier:4,branch:'A',from:'atiradores-do-telhado',footprint:[3,3],hp:900,
    range:7.5,cooldown:s(.5),damage:9,shots:4}),
  'guarnicao-do-predio':def({id:'guarnicao-do-predio',name:'Trincheira',label:'A5',tier:5,branch:'A',from:'ninho-de-metralhadora',footprint:[3,3],hp:1200,
    range:8.5,cooldown:s(.45),damage:11,shots:6}),
  'ninho-do-sniper':def({id:'ninho-do-sniper',name:'Tocaia',label:'A4b',tier:4,branch:'A',from:'atiradores-do-telhado',alt:true,footprint:[2,2],hp:700,
    range:13,cooldown:s(1.6),damage:70,target:'strongest'}),
  'equipe-antimaterial':def({id:'equipe-antimaterial',name:'Casamata',label:'A5b',tier:5,branch:'A',from:'ninho-do-sniper',alt:true,footprint:[2,2],hp:900,
    range:15,cooldown:s(2.2),damage:200,target:'strongest'}),
  // B: explosives (area, slow cadence, never the flyers). NEW-20261030-ORQ-ramo-b-e-6p-facil: counted with its area
  // (≈ 1 + 0.1·π·area² enemies per impact), each B tier from B3 gives ≥ ~60 % of the A tier's DPS per R$, never more.
  'rojao-de-festa':def({id:'rojao-de-festa',name:'Rojão de Festa',label:'B2',tier:2,branch:'B',from:'vigia-do-predio',footprint:[1,1],hp:350,
    range:7,cooldown:s(1.6),damage:14,area:1.2,hits:'ground'}),
  'morteiro':def({id:'morteiro',name:'Morteiro',label:'B3',tier:3,branch:'B',from:'rojao-de-festa',footprint:[2,2],hp:600,
    range:9,minRange:2,cooldown:s(2.2),damage:30,area:1.6,hits:'ground',target:'cluster'}),
  'lanca-foguetes':def({id:'lanca-foguetes',name:'Lança-Foguetes',label:'B4',tier:4,branch:'B',from:'morteiro',footprint:[3,2],hp:800,
    range:10,minRange:2,cooldown:s(3),damage:22,shots:4,area:1.6,hits:'ground'}),
  'obuseiro':def({id:'obuseiro',name:'Obuseiro Pesado',label:'B5',tier:5,branch:'B',from:'lanca-foguetes',footprint:[3,3],hp:1000,
    range:12,minRange:3,cooldown:s(3.5),damage:140,area:2.4,hits:'ground',target:'cluster'}),
  // B6: fires once in a long while, with a huge area, from the rail; reaches most of the map. City only (the rail): its
  // range is a map length, 60 u × CITY_DISTANCE_SCALE (CITY_MAP_SCALE ÷ CITY_COMPACT, mapa-175-com-viaduto) since the city grew 1.7× (NEW-20261013-ORQ-cidade-escala-1-7).
  'gustavao':def({id:'gustavao',name:'Gustavão',label:'B6',tier:6,branch:'B',from:'obuseiro',footprint:[12,4],hp:3000,rail:true,
    range:60*CITY_DISTANCE_SCALE,minRange:6,cooldown:s(20),damage:600,area:6,hits:'ground',target:'cluster'}),
  // C: control and support.
  'holofote':def({id:'holofote',name:'Holofote',label:'C2',tier:2,branch:'C',from:'vigia-do-predio',footprint:[1,1],hp:400,
    range:6,cooldown:s(.5),damage:0,area:2,slow:s(1.5),dazzle:{ticks:s(.6),chance:.3}}),
  'arame-e-sirene':def({id:'arame-e-sirene',name:'Arame e Sirene',label:'C3',tier:3,branch:'C',from:'holofote',footprint:[1,2],hp:600,
    range:4,cooldown:s(.5),damage:5,hits:'ground',target:'aura',slow:s(1.2)}),
  'antiaerea-quadrupla':def({id:'antiaerea-quadrupla',name:'Antiaérea Quádrupla',label:'C4',tier:4,branch:'C',from:'arame-e-sirene',footprint:[2,2],hp:700,
    range:9,cooldown:s(.3),damage:12,shots:4,hits:'air'}),
  'posto-de-radar':def({id:'posto-de-radar',name:'Posto de Radar',label:'C5',tier:5,branch:'C',from:'antiaerea-quadrupla',footprint:[2,2],hp:800,
    // torres-animacao-idle-tiro (the user, 25/10: "Radar ganha ataque"): it keeps the range bonus and sends a pulse at the
    // densest group (ground and air), control like the rest of branch C: ~12 dps to each enemy in it (C4: 160, air only).
    range:8,cooldown:s(1.5),damage:18,area:1.6,target:'cluster',slow:s(1),radar:{reach:9,bonus:.3}}),
});
export const DEFENSE_IDS=Object.keys(DEFENSES) as DefenseId[];
/** D-052, free build: what {t:'build'} may name (contract/build.ts): a tower (the root) or a wall piece. */
export type BuildPiece=DefenseId|FreePiece;

/**
 * D-052, free build (sim-fortificação): the wall pieces beside the towers, on the build grid (CITY_BUILD_CELL cells).
 * - muro: one cell, R$ 4, 250 hp, 40 standing per team, 1 s of obra. A wall to the enemies (a blocker on the terrain:
 *   the flow field routes around it, a body pressed against it bashes it); the heroes walk through it like the plaza
 *   barricades. A dragged wall is one {t:'build'} per cell: the sim queues each hero's obras one after the other.
 * - barricada: 2×1 cells (rot 1: 1×2), R$ 5, 200 hp, 40 standing per team, 1 s of obra. A wall to the enemies like the
 *   muro (blocks, drag 1: the history is beside FREE_PIECE_DEFS.barricada). It comes from the map's tralha as a kit
 *   (TRALHA_GROUPS below) and is never bought; its price is the kit's worth.
 * Paid in Grana from the builder's wallet (sim/wallet.ts). A fallen piece is gone and frees its cells.
 */
export interface FreePieceDef {
  id:FreePiece;name:string;
  /** Cells W×H at rot 0. */
  footprint:readonly [number,number];
  /** R$, from the builder's wallet. */
  price:number;hp:number;
  /** Standing per team. */
  limit:number;
  buildSeconds:number;
  /** True: solid to the enemies (the muro); false: they walk over it, slowed by `drag`. */
  blocks:boolean;
  /** Speed multiplier of an enemy standing on it (1: none). */
  drag:number;
}
export const FREE_PIECE_DEFS:Readonly<Record<FreePiece,FreePieceDef>>=Object.freeze({
  muro:Object.freeze({id:'muro',name:'Muro',footprint:Object.freeze([1,1]) as readonly [number,number],price:4,hp:250,limit:40,buildSeconds:1,blocks:true,drag:1}),
  // NEW-20261021-ORQ-barricada-construir (user, 21/10): the muralha de tralha, built square by square; a wall to the
  // enemies (they walk around it and bash it only when it shuts them off the car). R$ 5 a square: the old 2×1's price per cell.
  // NEW-20261022-ORQ-barricada-2x (user, 22/10): a square is BARRICADA_CELLS × BARRICADA_CELLS cells (2×2, twice as wide,
  // long and tall as before); its life stays 200 (one square, just bigger).
  // NEW-20261025-ORQ-barricada-tocar-no-mapa (user, 25/10: "o cubo laranja está maior do que a barricada"): the piece is
  // what the art is, a wall 2 cells long and 1 thick, turned by rot (0 along x, 1 along y).
  barricada:Object.freeze({id:'barricada',name:'Barricada',footprint:Object.freeze([2,1]) as readonly [number,number],price:5,hp:200,limit:40,buildSeconds:1,blocks:true,drag:1}),
  // NEW-20261023-ORQ-barracas-no-caminho (user, 28/10): the feira's barraca, scenery the map lays in feirinhas
  // (sim/towers/barracas.ts). Solid to the enemies, never built, bought, collected or hit (price/limit unused).
  barraca:Object.freeze({id:'barraca',name:'Barraca',footprint:Object.freeze([2,2]) as readonly [number,number],price:0,hp:1,limit:0,buildSeconds:0,blocks:true,drag:1}),
});
/**
 * NEW-20261021-ORQ-barricada-construir, in build-grid cells (FREE_CELL): no barricada within UNO_BUILD_CELLS of the
 * car's body; the car within UNO_ALERT_CELLS of a standing barricada sounds its alert, and a barricada still that close
 * UNO_ALERT_SECONDS later is destroyed (the team moves the car, or loses the square).
 */
export const UNO_BUILD_CELLS=3,UNO_ALERT_CELLS=2,UNO_ALERT_SECONDS=6;
/**
 * NEW-20261021-ORQ-barricada-construir part 2 (user, 21/10 ~00h10): the map already has barricadas de tralha.
 * TRALHA_GROUPS groups of TRALHA_GROUP_CELLS squares are laid from the run's rng at the start; a hero taps one square:
 * DESTRUIR (at once, DESTRUIR_PIX R$ to the wallet) or COLETAR (COLETAR_SECONDS standing by it, a hit cancels; the
 * square becomes a kit:barricada in the inventory, CARREGA_MAX at most: 1 = one in the hands at a time). Building is the
 * kit's place (free); a barricada is never bought.
 */
export const TRALHA_GROUPS=6,TRALHA_GROUP_CELLS=5,COLETAR_SECONDS=1.5,DESTRUIR_PIX=2,CARREGA_MAX=1;
/** How far (u, from the square's edge) a hero reaches a barricada square to collect or destroy it. */
export const TRALHA_REACH=3;
/**
 * NEW-20261025-ORQ-barricada-tocar-no-mapa (user, 25/10: "não gostei de eu ter que me mexer para pôr a barricada"): a kit
 * from the inventory (a barricada, a kit de torre) is placed by a tap on the map, this far (u) from the hero to the
 * footprint's edge, not BUILD_REACH. The nest keep-out (CAR_NEST_KEEP_OUT) still holds, so no nest is shut from afar.
 * NEW-20261031-ORQ-construir-andando-ate-a-obra: the tap stays, but the hero now walks to the obra (client
 * hud/kit-place/walk.ts) and the order is the sim's BUILD_REACH (src/sim/towers/system.ts) again, so build16 shows.
 */
export const KIT_PLACE_REACH=3;
/** A piece a hero may build (the barraca is the map's own: never). */
export const isFreePiece=(v:unknown):v is FreePiece=>v==='muro'||v==='barricada';
/**
 * NEW-20261023-ORQ-barracas-no-caminho (user, 28/10: "ponha essas barracas espalhadas em 4 a 5 lugares do mundo e bem
 * distante uma das outras, talvez no futuro elas vendam algo"): FEIRA_COUNT feirinhas of FEIRA_BARRACAS barracas (2×2
 * cells, FEIRA_STEP cells apart along one axis) are laid from the run's rng at the start, on open ground (a praça, a
 * wide calçada: FEIRA_MARGIN free cells all around), at least FEIRA_GAP u from each other, FEIRA_SPAWN_GAP u from a
 * spawn and FEIRA_CAR_GAP u from the car, never shutting the car off a spawn or the moto. Each keeps an id and a
 * centre (TowersState.feirinhas) for the shop to come.
 */
export const FEIRA_COUNT:readonly [number,number]=Object.freeze([4,5]) as readonly [number,number];
export const FEIRA_BARRACAS:readonly [number,number]=Object.freeze([2,4]) as readonly [number,number];
export const FEIRA_STEP=3,FEIRA_MARGIN=2,FEIRA_GAP=45,FEIRA_SPAWN_GAP=18,FEIRA_CAR_GAP=14;
/** A feirinha keeps this far (u) from a bank's place: the bank's lot (rules/bicos.ts lote) and room around it. */
export const FEIRA_BANK_GAP=8;
/** The lonas the art has (public/art/city/base/barraca.webp rows lona-1..3): a barraca's lona from its id. */
export const BARRACA_LONAS=3;
/** NEW-20261022-ORQ-barricada-2x: a barricada's length in build-grid cells (barricada-tocar-no-mapa: 1 cell thick). */
export const BARRICADA_CELLS=FREE_PIECE_DEFS.barricada.footprint[0];
/** A piece's cells W×H at `rot` (towers: their size square, whatever the rot). */
export function pieceCells(piece:BuildPiece,rot:0|1=0):readonly [number,number]{
  if(Object.hasOwn(FREE_PIECE_DEFS,piece)){const [w,h]=FREE_PIECE_DEFS[piece as FreePiece].footprint;return rot?[h,w]:[w,h];}
  const s=DEFENSES[piece as DefenseId].size??1;return [s,s];
}
/**
 * D-052: no piece within this of the car's body (u): room to push it and to defend it. Measured from the footprint's
 * edge to the car's centre, less the car's radius (contract CAR_RADIUS).
 */
export const CAR_BUILD_GAP=1.5;
export const ROOT_DEFENSE:DefenseId='vigia-do-predio';
export const isDefenseId=(id:unknown):id is DefenseId=>typeof id==='string'&&Object.hasOwn(DEFENSES,id);

/** What a defense may evolve into, main line first. */
export function childrenOf(id:DefenseId):DefenseDef[]{
  return DEFENSE_IDS.map(k=>DEFENSES[k]).filter(d=>d.from===id).sort((a,b)=>(a.alt?1:0)-(b.alt?1:0));
}

/**
 * The child an `upgrade` names: by id or label exactly (e.g. 'ninho-do-sniper' or 'A4b'), else by branch letter (at
 * the root 'A'|'B'|'C'; past it the letter of the line, which takes the main line when there is an alternative).
 * Without `branch`: the only child; undefined when there are several (the root, A3) or none.
 */
export function pickChild(id:DefenseId,branch?:string):DefenseDef|undefined{
  const kids=childrenOf(id);
  if(branch===undefined)return kids.length===1?kids[0]:undefined;
  return kids.find(k=>k.id===branch||k.label===branch)??kids.find(k=>k.branch===branch);
}

/** Art row of a defense at `tick`: obra thirds while building, then pronta/danificada, ruina at 0 hp. */
export function phaseOf(d:{hp:number;maxHp:number;startTick:number;readyTick:number;ruined?:boolean},tick:number):DefensePhase{
  if(d.ruined)return 'ruina';
  if(tick<d.readyTick){
    const span=Math.max(1,d.readyTick-d.startTick),done=(tick-d.startTick)/span;
    return done<1/3?'obra-1':done<2/3?'obra-2':'obra-3';
  }
  return d.hp<=d.maxHp*DAMAGED_AT?'danificada':'pronta';
}

/** Material units in a balance (D-048: one pile). */
export const unitsOf=(b:{units:number})=>b.units;
/** Pays `units` from the pile; false (and charges nothing) when it is short. */
export function payUnits(b:{units:number},units:number):boolean{
  if(!(units>=0)||b.units<units)return false;
  b.units=Math.max(0,b.units-units);
  return true;
}
