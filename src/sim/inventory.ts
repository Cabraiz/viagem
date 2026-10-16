/**
 * D-051 inventory (NEW-20261014-ORQ-armas-caixas-inventario, proposal §3), manual combat only. The 6 slots are the
 * player's `build.weapons` in slot order (no holes): weapons (level = rarity) and consumables (level = stack, up to
 * CONSUMABLE_STACK); `build.hand` is the slot of the weapon in the hand. Nobody loses the inventory on falling.
 *  - equip(slot): a weapon goes to the hand; swapping costs SWAP_TICKS without firing;
 *  - use(slot): a consumable takes effect and one leaves the stack;
 *  - drop(slot): the item goes to the ground as an 'item' pickup anyone takes (the last weapon stays: no empty hands);
 *  - add(item): stacks a consumable, else takes a free slot; false when the six are full;
 *  - take(pickup): an item on the ground within TAKE_REACH: added, or with the six full, swapped with the hand's
 *    weapon (a weapon) or the last consumable slot (a consumable), which lands where the taken one was;
 *  - the system picks up items walked over while a slot is free (a full inventory needs take, the "Trocar" button).
 * Every command answers a refusal reason or ok; nothing changes on a refusal.
 */
import type {OwnedItem,PickupState,PlayerBuild,SimPlayer} from '../contract/index.ts';
import {CIDA_ITEMS,MAX_WEAPONS,ticks} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {CONSUMABLE_STACK,isConsumableId,type ConsumableId} from './weapons/arsenal.ts';
import {getWeapon} from './weapons/catalog.ts';
import {HEAL_AMOUNT} from '../rules/index.ts';

export const INVENTORY_SLOTS=MAX_WEAPONS;
/** Ticks without firing after a swap (0.3 s). */
export const SWAP_TICKS=ticks(.3);
/** How far a player reaches an item on the ground with "Trocar" (and walks over it to pick it up). */
export const TAKE_REACH=1.2,WALK_PICKUP=.6;
/** Ground items last this long (then they are gone, like an XP gem). */
export const ITEM_GROUND_SECONDS=120;
/** The manual combat's starting inventory (answer 3: the Faca de Pão for everyone). */
export const MANUAL_START_WEAPON='faca';
export const manualStartingBuild=():PlayerBuild=>({weapons:[{id:MANUAL_START_WEAPON,level:1}],passives:[],hand:0});

export type InventoryRefusal='player'|'slot'|'not-weapon'|'not-consumable'|'last-weapon'|'full'|'far'|'pickup'|'unusable';
export type InventoryResult={ok:true}|{ok:false;reason:InventoryRefusal};
const no=(reason:InventoryRefusal):InventoryResult=>({ok:false,reason});
const OK:InventoryResult={ok:true};

export const isWeaponItem=(item:OwnedItem|undefined)=>!!item&&!!getWeapon(item.id)?.pattern;
export const isConsumableItem=(item:OwnedItem|undefined)=>!!item&&isConsumableId(item.id);
/** Whether the player is in the manual combat's inventory (build.hand set). */
export const hasInventory=(p:{build:PlayerBuild})=>p.build.hand!==undefined;
const live=(p:SimPlayer)=>!p.spectator&&!p.eliminated&&!p.downed&&p.hp>0;

/** The hand's slot made valid: a weapon slot (the current one if still a weapon, else the first weapon), or 0. */
export function fixHand(build:PlayerBuild){
  if(build.hand===undefined)return;
  if(isWeaponItem(build.weapons[build.hand]))return;
  const first=build.weapons.findIndex(isWeaponItem);
  build.hand=first>=0?first:0;
}

export function equip(ctx:SimContext,p:SimPlayer,slot:number):InventoryResult{
  if(!hasInventory(p)||p.spectator||p.eliminated)return no('player');
  const item=p.build.weapons[slot];
  if(!item)return no('slot');
  if(!isWeaponItem(item))return no('not-weapon');
  if(p.build.hand===slot)return OK;
  p.build.hand=slot;
  p.weaponReady[item.id]=Math.max(p.weaponReady[item.id]??0,ctx.tick+SWAP_TICKS);
  return OK;
}

/** Hooks a consumable may need (the team's tower fichas: kit de torre). */
export interface InventoryHooks {addTowerToken?(ctx:SimContext):boolean}

export function use(ctx:SimContext,p:SimPlayer,slot:number,hooks:InventoryHooks={}):InventoryResult{
  if(!hasInventory(p)||!live(p))return no('player');
  const item=p.build.weapons[slot];
  if(!item)return no('slot');
  if(!isConsumableId(item.id))return no('not-consumable');
  if(!applyConsumable(ctx,p,item.id,hooks))return no('unusable');
  ctx.emit({type:'pickup',player:p.id,pickup:`use-${item.id}`,kind:'item',value:1});
  if(--item.level<=0)removeSlot(p.build,slot);
  return OK;
}

function applyConsumable(ctx:SimContext,p:SimPlayer,id:ConsumableId,hooks:InventoryHooks){
  const cida=(k:'brigadeiro'|'pacoca'|'cocada')=>ctx.tick+ticks(CIDA_ITEMS.find(i=>i.id===k)!.seconds);
  switch(id){
    case 'coxinha':
      if(p.hp>=p.stats.maxHp)return false;
      p.hp=Math.min(p.stats.maxHp,p.hp+HEAL_AMOUNT);return true;
    case 'brigadeiro':p.fastUntil=cida('brigadeiro');return true;
    case 'pacoca':p.mightUntil=cida('pacoca');return true;
    case 'cocada':p.guardUntil=cida('cocada');return true;
    case 'kit-torre':return !!hooks.addTowerToken?.(ctx);
  }
}

function removeSlot(build:PlayerBuild,slot:number){
  build.weapons.splice(slot,1);
  if(build.hand!==undefined&&build.hand>slot)build.hand--;
  fixHand(build);
}

/** Puts an item in the inventory: a consumable stacks first, else a free slot. Returns false (nothing changed) when full. */
export function add(p:SimPlayer,item:OwnedItem):boolean{
  const inv=p.build.weapons;
  if(isConsumableId(item.id)){
    let left=item.level;
    for(const own of inv)if(own.id===item.id&&own.level<CONSUMABLE_STACK&&left>0){const put=Math.min(left,CONSUMABLE_STACK-own.level);own.level+=put;left-=put;}
    if(left<=0)return true;
    if(inv.length>=INVENTORY_SLOTS){item.level=left;return false;}
    inv.push({id:item.id,level:left});return true;
  }
  if(inv.length>=INVENTORY_SLOTS)return false;
  inv.push({id:item.id,level:item.level});
  // Empty-handed (only consumables were left): the new weapon goes to the hand.
  if(!isWeaponItem(inv[p.build.hand??0]))fixHand(p.build);
  return true;
}

/** An item on the ground (drop, a crate's prize that did not fit). */
export function dropItem(ctx:SimContext,at:{x:number;y:number},item:OwnedItem,dropper?:string):PickupState{
  const pickup:PickupState={id:ctx.nextId('item'),kind:'item',resource:item.id,value:item.level,x:at.x,y:at.y,
    spawnTick:ctx.tick,expiresTick:ctx.tick+ticks(ITEM_GROUND_SECONDS),...(dropper?{dropper}:{})};
  ctx.pickups.set(pickup.id,pickup);
  return pickup;
}

export function drop(ctx:SimContext,p:SimPlayer,slot:number):InventoryResult{
  if(!hasInventory(p)||p.spectator||p.eliminated)return no('player');
  const item=p.build.weapons[slot];
  if(!item)return no('slot');
  if(isWeaponItem(item)&&p.build.weapons.filter(isWeaponItem).length<=1)return no('last-weapon');
  removeSlot(p.build,slot);
  dropItem(ctx,p,item,p.id);
  return OK;
}

export function take(ctx:SimContext,p:SimPlayer,pickupId:string):InventoryResult{
  if(!hasInventory(p)||!live(p))return no('player');
  const pickup=ctx.pickups.get(pickupId);
  if(!pickup||pickup.kind!=='item'||!pickup.resource)return no('pickup');
  if(Math.hypot(pickup.x-p.x,pickup.y-p.y)>TAKE_REACH)return no('far');
  const item={id:pickup.resource,level:pickup.value};
  if(add(p,item)){ctx.pickups.delete(pickupId);emitTake(ctx,p,pickup);return OK;}
  // A stack that fitted in part: what is left stays on the ground (and swaps below like a whole one).
  pickup.value=item.level;
  // Full: swap. A weapon takes the hand's slot; a consumable the last consumable slot (with none, the last slot that is
  // not the hand: the six are weapons then, so the hand keeps firing).
  const inv=p.build.weapons,hand=p.build.hand??0;
  const lastConsumable=inv.map(isConsumableItem).lastIndexOf(true);
  const slot=isWeaponItem(item)?hand:lastConsumable>=0?lastConsumable:(hand===inv.length-1?inv.length-2:inv.length-1);
  const out=inv[slot];
  inv[slot]={id:item.id,level:item.level};
  ctx.pickups.delete(pickupId);
  if(out)dropItem(ctx,pickup,out,p.id);
  fixHand(p.build);
  emitTake(ctx,p,pickup);
  return OK;
}
const emitTake=(ctx:SimContext,p:SimPlayer,pickup:PickupState)=>ctx.emit({type:'pickup',player:p.id,pickup:pickup.id,kind:'item',value:pickup.value});

/**
 * Picks up the items players walk over while they have room, and clears items past their time. Manual combat only
 * (assemble wires it). Stats do not depend on the inventory (the passives of the level cards make them).
 */
export function inventorySystem():SimSystem{
  const scratch:string[]=[];
  return {id:'inventory',step(ctx){
    scratch.length=0;
    for(const pickup of ctx.pickups.values()){
      if(pickup.kind!=='item')continue;
      if(pickup.expiresTick!==undefined&&ctx.tick>=pickup.expiresTick){scratch.push(pickup.id);continue;}
      // The one who dropped it walks clear of it once before walking over it picks it back up.
      const dropper=pickup.dropper!==undefined?ctx.players.get(pickup.dropper):undefined;
      if(pickup.dropper!==undefined&&(!dropper||Math.hypot(pickup.x-dropper.x,pickup.y-dropper.y)>WALK_PICKUP*2))delete pickup.dropper;
      for(const p of ctx.players.values()){
        if(p.id===pickup.dropper||!hasInventory(p)||!live(p)||Math.hypot(pickup.x-p.x,pickup.y-p.y)>WALK_PICKUP)continue;
        const item={id:pickup.resource!,level:pickup.value};
        if(add(p,item)){scratch.push(pickup.id);emitTake(ctx,p,pickup);break;}
        pickup.value=item.level;
      }
    }
    for(const id of scratch)ctx.pickups.delete(id);
  }};
}

