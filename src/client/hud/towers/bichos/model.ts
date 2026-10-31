/**
 * Card NEW-20261031-ORQ-torres-3-base-9-evolucoes-regras, the panel of a bicho tower (pure, node-tested):
 * - a tap on the map hits a standing bicho (its 2×2 footprint around x,y);
 * - the panel: an initial shows its 3 evolutions (BICHO_EVOLVE_PRICE each), every one shows Força N→N+1 at
 *   levelPrice(N) until TOWER_LEVEL_MAX; a card the wallet does not pay says how much is missing;
 * - the orders go out as net.upgrade(defense, child id | FORCA_BRANCH); the room answers {t:'built'}.
 * Anyone in the team may pay, from their own wallet (the sim keeps who evolved it last as the owner).
 */
import {BICHO_EVOLVE_PRICE,DEFENSES,FORCA_BRANCH,TOWER_LEVEL_MAX,childrenOf,isBicho,levelPrice,type DefenseId} from '../../../../rules/index.ts';
import type {StructureView} from '../../../../contract/index.ts';
import {EFFECT} from '../model.ts';
import {refusalText} from '../wiring.ts';

/** A tap this close (u) to a bicho's centre picks it: its 2×2 footprint and a finger's slack. */
export const BICHO_TAP_REACH=1.3;

export interface BichoCard {id:string;name:string;effect:string;price:number;missing:number}
export interface BichoPanelView {
  id:string;name:string;level:number;building:boolean;
  /** The 3 evolutions (an initial, ready), else empty. */
  cards:BichoCard[];
  /** The next força (undefined at TOWER_LEVEL_MAX). */
  forca?:{to:number;price:number;missing:number};
}

const standing=(s:StructureView)=>isBicho(s.kind)&&s.phase!=='ruina'&&s.hp>0;
/** The standing bicho under world point p (the nearest within BICHO_TAP_REACH), or undefined. */
export function bichoAt(structures:readonly StructureView[],p:{x:number;y:number}):StructureView|undefined{
  let best:StructureView|undefined,bd=BICHO_TAP_REACH;
  for(const s of structures){if(!standing(s))continue;const d=Math.hypot(s.x-p.x,s.y-p.y);if(d<=bd){best=s;bd=d;}}
  return best;
}

export function bichoPanel(s:StructureView,grana:number):BichoPanelView{
  const def=DEFENSES[s.kind as DefenseId],level=s.level??1,building=!!s.phase?.startsWith('obra');
  const missing=(price:number)=>Math.max(0,price-grana);
  const cards=building||def.from!==null?[]:childrenOf(def.id).map(k=>({id:k.id,name:k.name,effect:EFFECT[k.id],price:BICHO_EVOLVE_PRICE,missing:missing(BICHO_EVOLVE_PRICE)}));
  const price=levelPrice(level);
  return {id:s.id,name:def.name,level,building,cards,...(price!==undefined&&level<TOWER_LEVEL_MAX?{forca:{to:level+1,price,missing:missing(price)}}:{})};
}

export interface BichoNet {upgrade(defense:string,branch?:string):number|undefined}
export interface BuiltAnswer {req:number;ok:boolean;kind?:string;reason?:string}

/** The selected bicho and the orders this client sent for it. */
export class BichoPick {
  selected?:string;
  private readonly sent=new Set<number>();
  /** A tap on the map: selects the bicho under it (true: the tap was ours) or clears the selection. */
  tap(structures:readonly StructureView[],p:{x:number;y:number}):boolean{this.selected=bichoAt(structures,p)?.id;return this.selected!==undefined;}
  /** A gone (or ruined) bicho loses its selection. */
  sync(structures:readonly StructureView[]){if(this.selected!==undefined&&!structures.some(s=>s.id===this.selected&&standing(s)))this.selected=undefined;}
  /** An evolution (a child's id) or the força: 'offline' when it could not leave this phone. */
  order(branch:string,net:BichoNet):'sent'|'none'|'offline'{
    if(this.selected===undefined)return 'none';
    const req=net.upgrade(this.selected,branch);
    if(req===undefined)return 'offline';
    this.sent.add(req);
    if(branch!==FORCA_BRANCH)this.selected=undefined; // an evolution starts its obra: the panel closes
    return 'sent';
  }
  owns(req:number){return this.sent.has(req);}
  /** The room's answer: the words to show (undefined: nothing to say). */
  answer(a:BuiltAnswer):string|undefined{
    if(!this.sent.delete(a.req))return undefined;
    if(!a.ok)return refusalText(a.reason);
    return a.kind&&isBicho(a.kind)?`${DEFENSES[a.kind].name}: feito!`:undefined;
  }
  reset(){this.selected=undefined;this.sent.clear();}
}
