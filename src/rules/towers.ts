/**
 * Moved from src/sim/towers/catalog.ts (torres-hud) so the client's build menu can read it; the sim re-exports it.
 *
 * Defense tree (torres-sim, D-041; design/proximos/08-TORRES.md §3): every defense is born as the Vigia do Prédio and
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
import {ticks} from '../contract/index.ts';
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

/** Card costs per tier (material units); the Gustavão has its own (GUSTAVAO_COST) plus the rail (RAIL.cost). */
export const TIER_COST:Readonly<Record<1|2|3|4|5,number>>=Object.freeze({1:6,2:10,3:16,4:24,5:36});
export const GUSTAVAO_COST=60;
/** Build time per tier (s), split in three equal obra phases. */
export const TIER_BUILD_SECONDS:Readonly<Record<1|2|3|4|5|6,number>>=Object.freeze({1:6,2:8,3:10,4:12,5:15,6:24});
/** The Gustavão's rail ('linha-ferrea'): laid once per run on the plan's RailSite, `cost` units, `buildSeconds`. */
export const RAIL=Object.freeze({id:'linha-ferrea' as const,siteId:'trilho' as const,cost:12,buildSeconds:8});
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
  'vigia-do-predio':def({id:'vigia-do-predio',name:'Vigia do Prédio',label:'T1',tier:1,branch:null,from:null,footprint:[2,2],hp:400,
    range:6,cooldown:s(1),damage:8}),
  // A: more people spreading bullets (more targets per volley).
  'vigias-armados':def({id:'vigias-armados',name:'Vigias Armados',label:'A2',tier:2,branch:'A',from:'vigia-do-predio',footprint:[2,2],hp:550,
    range:6.5,cooldown:s(.9),damage:7,shots:2}),
  'atiradores-do-telhado':def({id:'atiradores-do-telhado',name:'Atiradores do Telhado',label:'A3',tier:3,branch:'A',from:'vigias-armados',footprint:[2,2],hp:700,
    range:7,cooldown:s(.8),damage:9,shots:3}),
  'ninho-de-metralhadora':def({id:'ninho-de-metralhadora',name:'Ninho de Metralhadora',label:'A4',tier:4,branch:'A',from:'atiradores-do-telhado',footprint:[3,3],hp:900,
    range:7.5,cooldown:s(.5),damage:9,shots:4}),
  'guarnicao-do-predio':def({id:'guarnicao-do-predio',name:'Guarnição do Prédio',label:'A5',tier:5,branch:'A',from:'ninho-de-metralhadora',footprint:[3,3],hp:1200,
    range:8.5,cooldown:s(.45),damage:11,shots:6}),
  'ninho-do-sniper':def({id:'ninho-do-sniper',name:'Ninho do Sniper',label:'A4b',tier:4,branch:'A',from:'atiradores-do-telhado',alt:true,footprint:[2,2],hp:700,
    range:13,cooldown:s(1.6),damage:70,target:'strongest'}),
  'equipe-antimaterial':def({id:'equipe-antimaterial',name:'Equipe Antimaterial',label:'A5b',tier:5,branch:'A',from:'ninho-do-sniper',alt:true,footprint:[2,2],hp:900,
    range:15,cooldown:s(2.2),damage:200,target:'strongest'}),
  // B: explosives (area, slow cadence, never the flyers).
  'rojao-de-festa':def({id:'rojao-de-festa',name:'Rojão de Festa',label:'B2',tier:2,branch:'B',from:'vigia-do-predio',footprint:[1,1],hp:350,
    range:7,cooldown:s(1.6),damage:14,area:1.2,hits:'ground'}),
  'morteiro':def({id:'morteiro',name:'Morteiro',label:'B3',tier:3,branch:'B',from:'rojao-de-festa',footprint:[2,2],hp:600,
    range:9,minRange:2,cooldown:s(2.2),damage:30,area:1.6,hits:'ground',target:'cluster'}),
  'lanca-foguetes':def({id:'lanca-foguetes',name:'Lança-Foguetes',label:'B4',tier:4,branch:'B',from:'morteiro',footprint:[3,2],hp:800,
    range:10,minRange:2,cooldown:s(3),damage:22,shots:4,area:1.6,hits:'ground'}),
  'obuseiro':def({id:'obuseiro',name:'Obuseiro Pesado',label:'B5',tier:5,branch:'B',from:'lanca-foguetes',footprint:[3,3],hp:1000,
    range:12,minRange:3,cooldown:s(3.5),damage:90,area:2.4,hits:'ground',target:'cluster'}),
  // B6: fires once in a long while, with a huge area, from the rail; reaches most of the map.
  'gustavao':def({id:'gustavao',name:'Gustavão',label:'B6',tier:6,branch:'B',from:'obuseiro',footprint:[12,4],hp:3000,rail:true,
    range:60,minRange:6,cooldown:s(20),damage:600,area:6,hits:'ground',target:'cluster'}),
  // C: control and support.
  'holofote':def({id:'holofote',name:'Holofote',label:'C2',tier:2,branch:'C',from:'vigia-do-predio',footprint:[1,1],hp:400,
    range:6,cooldown:s(.5),damage:0,area:2,slow:s(1.5),dazzle:{ticks:s(.6),chance:.3}}),
  'arame-e-sirene':def({id:'arame-e-sirene',name:'Arame e Sirene',label:'C3',tier:3,branch:'C',from:'holofote',footprint:[1,2],hp:600,
    range:4,cooldown:s(.5),damage:5,hits:'ground',target:'aura',slow:s(1.2)}),
  'antiaerea-quadrupla':def({id:'antiaerea-quadrupla',name:'Antiaérea Quádrupla',label:'C4',tier:4,branch:'C',from:'arame-e-sirene',footprint:[2,2],hp:700,
    range:9,cooldown:s(.3),damage:12,shots:4,hits:'air'}),
  'posto-de-radar':def({id:'posto-de-radar',name:'Posto de Radar',label:'C5',tier:5,branch:'C',from:'antiaerea-quadrupla',footprint:[2,2],hp:800,
    range:0,cooldown:s(1),damage:0,target:'none',radar:{reach:9,bonus:.3}}),
});
export const DEFENSE_IDS=Object.keys(DEFENSES) as DefenseId[];
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

/** Total material units in a balance. */
export const unitsOf=(b:{coco:number;pedra:number})=>b.coco+b.pedra;
/**
 * Pays `units` from the two piles, one unit at a time from the larger pile (coco on a tie): the piles even out, so the
 * forge's mixed recipes stay buyable. Returns false (and charges nothing) when the piles do not add up to it.
 */
export function payUnits(b:{coco:number;pedra:number},units:number):boolean{
  if(!(units>=0)||unitsOf(b)<units)return false;
  // Closed form of the unit-by-unit rule: drain the gap first, then split the rest (coco takes the odd unit).
  let left=units;
  const gap=Math.min(left,Math.abs(b.coco-b.pedra));
  if(b.coco>=b.pedra)b.coco-=gap;else b.pedra-=gap;
  left-=gap;
  const half=Math.floor(left/2),odd=left-half*2;
  b.coco-=half+odd;b.pedra-=half;
  // Float piles (a tuned crate value) never go below zero from rounding.
  if(b.coco<0){b.pedra+=b.coco;b.coco=0;}
  if(b.pedra<0){b.coco+=b.pedra;b.pedra=0;}
  return true;
}
