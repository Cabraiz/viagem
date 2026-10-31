/**
 * The tree of today in the sim (card NEW-20261031-ORQ-torres-3-base-9-evolucoes-regras, rules towers.ts BichoId): a kit
 * builds one of the 3 initials (system.ts buildFree), which then evolves into one of its 3 or climbs in força, both
 * paid in R$ from the wallet of who orders it (system.ts `upgrade` hands a bicho here).
 * - When: any phase of the run (the kits are placed at any phase too), by a standing player while the wall stands,
 *   within KIT_PLACE_REACH of its footprint (a tap on the map, like placing the kit).
 * - Força (branch FORCA_BRANCH): a ready tower, below TOWER_LEVEL_MAX, pays levelPrice(level) and goes up one at once
 *   (no obra): its damage × levelDamage(level) (defensesStep through `leveled`), its maxHp the base × levelHp(level),
 *   the hp up by the same amount.
 * - Evolve (a child's id or label, or the branch letter: the first child): an initial only, ready, pays
 *   BICHO_EVOLVE_PRICE and starts the child's obra (its buildSeconds) at full hp for the força it keeps.
 * - The teto (TOWER_BUILT_LIMIT, per team): TowersState.built counts every bicho a kit built this run (ruins and
 *   evolutions included, an evolution is the same tower); buildFree refuses 'limite' at it, and the crates stop
 *   rolling tower kits once the built plus the ones in the heroes' bags reach it (crates.ts, kitsFull).
 * - State: DefenseState.level only once a tower climbs (absent = força 1) and TowersState.built only once a bicho is
 *   built, so a run without them keeps every hash it had.
 */
import type {SimContext} from '../context.ts';
import type {SimPlayer} from '../../contract/index.ts';
import {ticks} from '../../contract/index.ts';
import {isStanding} from '../revive.ts';
import {payFrom} from '../wallet.ts';
import type {StonewardsState} from '../stonewards/state.ts';
import {rectDistance,type Rect} from './sites.ts';
import {DEFENSES,pickChild,type DefenseDef} from './catalog.ts';
import {BICHO_EVOLVE_PRICE,FORCA_BRANCH,KIT_PLACE_REACH,TOWER_BUILT_LIMIT,TOWER_LEVEL_MAX,isBicho,kitPiece,levelDamage,levelHp,levelPrice} from '../../rules/index.ts';
import type {DefenseState,TowerResult,TowersState} from './system.ts';

/** A defense's numbers at its força: the catalog's own at força 1 (same object, so nothing else moves). */
export function leveled(d:Pick<DefenseState,'kind'|'level'>):DefenseDef{
  const def=DEFENSES[d.kind];
  return (d.level??1)>1?{...def,damage:def.damage*levelDamage(d.level)}:def;
}
/** The teto reached: no new bicho may be built (buildFree's 'limite'). */
export const builtFull=(towers:TowersState|undefined)=>(towers?.built??0)>=TOWER_BUILT_LIMIT;
/** Counts a defense just built from a kit against the teto (bichos only; the legacy towers never count). */
export function countBuilt(towers:TowersState,d:DefenseState){if(isBicho(d.kind))towers.built=(towers.built??0)+1;}
/** Tower kits in the players' bags (inventory items `kit:<one of the 3>`). */
export function kitsHeld(players:Iterable<SimPlayer>):number{
  let n=0;
  for(const p of players)for(const w of p.build.weapons){const piece=kitPiece(w.id);if(piece&&isBicho(piece))n++;}
  return n;
}
/** The crates' hook (CratesOptions.kitsFull): built + held bichos at the teto, so no more tower kits are rolled. */
export const kitsFull=(state:StonewardsState,players:Iterable<SimPlayer>)=>(state.defenses?.built??0)+kitsHeld(players)>=TOWER_BUILT_LIMIT;

/** Força or evolution of one of the 12 (system.ts `upgrade`, inside its `once`). `rect`: its footprint. */
export function bichoUpgrade(ctx:SimContext,state:StonewardsState,playerId:string,d:DefenseState,branch:string|undefined,rect:Rect):TowerResult{
  if(state.wallDown)return {ok:false,reason:'wall-down'};
  const p=ctx.players.get(playerId);
  if(!p||!isStanding(p))return {ok:false,reason:'player'};
  if(d.ruined)return {ok:false,reason:'ruined'};
  if(ctx.tick<d.readyTick)return {ok:false,reason:'building'};
  if(rectDistance(rect,p)>KIT_PLACE_REACH)return {ok:false,reason:'away'};
  const level=d.level??1,def=DEFENSES[d.kind];
  if(branch===FORCA_BRANCH){
    const price=levelPrice(level);
    if(price===undefined)return {ok:false,reason:'max'};
    if(!payFrom(p,price))return {ok:false,reason:'grana'};
    const maxHp=Math.round(def.hp*levelHp(level+1));
    d.hp=Math.min(maxHp,d.hp+maxHp-d.maxHp);d.maxHp=maxHp;d.level=level+1;
    return {ok:true,defense:d.id,kind:d.kind,cost:price};
  }
  if(def.from!==null)return {ok:false,reason:'max'};
  const next=branch===undefined?undefined:pickChild(d.kind,branch);
  if(!next||!isBicho(next.id))return {ok:false,reason:'branch'};
  if(!payFrom(p,BICHO_EVOLVE_PRICE))return {ok:false,reason:'grana'};
  d.kind=next.id;d.owner=playerId;d.hp=d.maxHp=Math.round(next.hp*levelHp(level));
  d.startTick=ctx.tick;d.readyTick=ctx.tick+ticks(next.buildSeconds);d.fireTick=d.readyTick;
  return {ok:true,defense:d.id,kind:d.kind,cost:BICHO_EVOLVE_PRICE};
}
