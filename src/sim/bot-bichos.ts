/**
 * The bots on the tree of today (card NEW-20261031-ORQ-torres-3-base-9-evolucoes-regras): the 12 bichos are built
 * only from a kit in the bag (room-bots places it), so pickTowerOrder hands the towers here once the Guarita is out of
 * the tree, and the bot only spends R$ on the bichos it has (never the fichas):
 *  1. repair its most hurt one at or under BOT_TOWER_REPAIR_BELOW, when the wallet pays TOWER_REPAIR_COST;
 *  2. evolve a ready initial (BICHO_EVOLVE_PRICE): the child cycled by the tower's index, so 3 initials take 3 lines;
 *  3. força for the lowest ready one below TOWER_LEVEL_MAX (ties: the first built), when it pays levelPrice;
 *  4. else 'save' for the cheapest of those steps, or undefined with no bicho to spend on.
 * A person's bicho is theirs (bot-gasta-material). `reach`: as pickTowerOrder's.
 */
import {BICHO_EVOLVE_PRICE,FORCA_BRANCH,isBicho,levelPrice} from '../rules/index.ts';
import {DEFENSES,childrenOf} from './towers/catalog.ts';
import {TOWER_REPAIR_COST} from './towers/system.ts';
import {BOT_TOWER_REPAIR_BELOW,type TowerBrainView,type TowerOrder,type TowerReach} from './bot-brain.ts';

export function pickBichoOrder(v:TowerBrainView,reach:TowerReach=()=>true):TowerOrder|'save'|undefined{
  const near=(d:{x?:number;y?:number})=>!Number.isFinite(d.x)||!Number.isFinite(d.y)||reach({x:d.x!,y:d.y!});
  const mine=v.defenses.map((d,i)=>({d,i})).filter(({d})=>!d.ruined&&!d.person&&isBicho(d.kind)&&near(d));
  const grana=v.grana-(v.granaKeep??0);
  const share=(d:TowerBrainView['defenses'][number])=>d.maxHp!==undefined&&d.hp!==undefined&&d.maxHp>0?d.hp/d.maxHp:1;
  const hurt=mine.filter(({d})=>share(d)<=BOT_TOWER_REPAIR_BELOW).sort((a,b)=>share(a.d)-share(b.d))[0];
  if(hurt&&grana>=TOWER_REPAIR_COST)return {repair:hurt.d.id};
  const ready=mine.filter(({d})=>d.ready);
  const steps:{cost:number;order:TowerOrder}[]=[];
  const root=ready.find(({d})=>DEFENSES[d.kind].from===null&&childrenOf(d.kind).length>0);
  if(root){const kids=childrenOf(root.d.kind);steps.push({cost:BICHO_EVOLVE_PRICE,order:{upgrade:root.d.id,branch:kids[root.i%kids.length]!.id}});}
  const low=ready.filter(({d})=>levelPrice(d.level)!==undefined).sort((a,b)=>(a.d.level??1)-(b.d.level??1)||a.i-b.i)[0];
  if(low)steps.push({cost:levelPrice(low.d.level)!,order:{upgrade:low.d.id,branch:FORCA_BRANCH}});
  const paid=steps.find(s=>grana>=s.cost);
  if(paid)return paid.order;
  return steps.length?'save':undefined;
}
