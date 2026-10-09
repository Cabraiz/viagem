/**
 * Upgrade offers (VGM-034): candidate rolling, eligibility and build application.
 * The item catalog is injected so this module does not depend on the weapon/passive cards.
 */
import type {Rng} from './rng.ts';
import {MAX_PASSIVES,MAX_WEAPONS} from './types.ts';
import type {ItemDef,OfferChoice,OwnedItem,PlayerBuild,SimPlayer} from './types.ts';

export interface ItemCatalog {get(id:string):ItemDef|undefined; all():readonly ItemDef[]}

/** Seconds a player has to choose once an offer reaches the head of the queue. */
export const OFFER_SECONDS=10;
/** Choice offered when the build is full: a coxinha that heals. */
export const HEAL_CHOICE='heal';
export const HEAL_AMOUNT=30;
export const BASE_CHOICES=3,MAX_CHOICES=4;

const EVO_SUFFIX='-evo';
/** Base weapon of an evolution (chinelo-evo -> chinelo); other ids map to themselves. */
export const baseItemId=(id:string)=>id.endsWith(EVO_SUFFIX)?id.slice(0,-EVO_SUFFIX.length):id;

const slotsOf=(build:PlayerBuild,def:ItemDef):{list:OwnedItem[];max:number}=>
  def.kind==='passive'?{list:build.passives,max:MAX_PASSIVES}:{list:build.weapons,max:MAX_WEAPONS};

/** Level the item would reach if picked now, or undefined when it cannot be offered. */
export function nextLevel(catalog:ItemCatalog,build:PlayerBuild,itemId:string):number|undefined{
  const def=catalog.get(itemId);
  if(!def||def.kind==='evolution')return undefined;
  const {list,max}=slotsOf(build,def);
  const owned=list.find(item=>item.id===itemId);
  if(owned)return owned.level<def.maxLevel?owned.level+1:undefined;
  if(def.kind==='weapon'&&list.some(item=>baseItemId(item.id)===itemId))return undefined;
  return list.length<max?1:undefined;
}

export function isEligible(catalog:ItemCatalog,build:PlayerBuild,choice:OfferChoice){
  return choice.itemId===HEAL_CHOICE||nextLevel(catalog,build,choice.itemId)===choice.level;
}

/** Up to 3 distinct choices, a 4th with probability 1 - 1/luck; a full build gets the coxinha. */
export function rollChoices(catalog:ItemCatalog,build:PlayerBuild,luck:number,rng:Rng):OfferChoice[]{
  const want=BASE_CHOICES+(rng.chance(1-1/Math.max(1,luck))?1:0);
  const candidates:OfferChoice[]=[];
  for(const def of catalog.all()){
    const level=nextLevel(catalog,build,def.id);
    if(level!==undefined)candidates.push({itemId:def.id,level});
  }
  if(!candidates.length)return [{itemId:HEAL_CHOICE,level:1}];
  const count=Math.min(want,candidates.length);
  for(let i=0;i<count;i++){
    const j=rng.int(i,candidates.length-1);
    [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
  }
  return candidates.slice(0,count);
}

/** Visible default: the first upgrade of an owned item, else the first card. */
export function defaultIndexFor(build:PlayerBuild,choices:readonly OfferChoice[]){
  const owned=(id:string)=>build.weapons.some(item=>item.id===id)||build.passives.some(item=>item.id===id);
  return Math.max(0,choices.findIndex(choice=>owned(choice.itemId)));
}

/** Applies an eligible choice to the player's build; returns false and changes nothing otherwise. */
export function applyChoice(catalog:ItemCatalog,player:SimPlayer,choice:OfferChoice){
  if(choice.itemId===HEAL_CHOICE){
    if(!player.downed&&!player.eliminated)player.hp=Math.min(player.stats.maxHp,player.hp+HEAL_AMOUNT);
    return true;
  }
  const def=catalog.get(choice.itemId);
  if(!def||nextLevel(catalog,player.build,choice.itemId)!==choice.level)return false;
  const {list}=slotsOf(player.build,def);
  const owned=list.find(item=>item.id===choice.itemId);
  if(owned)owned.level=choice.level;else list.push({id:choice.itemId,level:1});
  return true;
}
