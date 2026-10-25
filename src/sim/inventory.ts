/**
 * D-051 inventory (NEW-20261014-ORQ-armas-caixas-inventario, proposal §3), manual combat only. The 6 slots are the
 * player's `build.weapons` in slot order (no holes): weapons (level = rarity) and consumables (level = stack, up to
 * CONSUMABLE_STACK); `build.hand` is the slot of the weapon in the hand. Nobody loses the inventory on falling.
 *  - equip(slot): a weapon goes to the hand; swapping costs SWAP_TICKS without firing;
 *  - use(slot): a consumable takes effect and one leaves the stack;
 *  - drop(slot): the item goes to the ground as an 'item' pickup anyone takes (the last weapon stays once there is one);
 *  - add(item): stacks a consumable, else takes a free slot; false when the six are full;
 *  - take(pickup): an item on the ground within TAKE_REACH: added, or with the six full, swapped with the hand's
 *    weapon (a weapon) or the last consumable slot (a consumable), which lands where the taken one was;
 *  - place(slot, cell): a kit de torre (torre-pela-caixa, rules tower-kits.ts) builds its piece on the build grid
 *    through the hooks (towers/system.ts buildFree with `kit`: free, every other rule of the free build); an accepted
 *    one spends a charge (the slot empties at 0), a refused one keeps the kit;
 *  - the system picks up items walked over while a slot is free (a full inventory needs take, the "Trocar" button);
 *  - one of each (BUG-20261025-ORQ-caixa-sem-item-repetido, the user 25/10: "eu não deveria ver uma panela azul se peguei
 *    panela verde"): who owns a weapon or a kit (owns: itemKey, any rarity) neither takes nor sees it on the ground (the
 *    item pickup's server-only hiddenFor names him; take refuses 'owned'). Consumables stack as before.
 * Every command answers a refusal reason or ok; nothing changes on a refusal.
 */
import type {OwnedItem,PickupState,PlayerBuild,SimPlayer} from '../contract/index.ts';
import {CIDA_ITEMS,MAX_WEAPONS,ticks} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {CONSUMABLE_STACK,isConsumableId,type ConsumableId} from './weapons/arsenal.ts';
import {getWeapon} from './weapons/catalog.ts';
import {HEAL_AMOUNT,kitPiece,pieceCells,type KitPiece} from '../rules/index.ts';
import {CITY_BUILD_CELL} from '../maps/index.ts';
import type {TowerResult} from './towers/system.ts';

export const INVENTORY_SLOTS=MAX_WEAPONS;
/** Ticks without firing after a swap (0.3 s). */
export const SWAP_TICKS=ticks(.3);
/** How far a player reaches an item on the ground with "Trocar" (and walks over it to pick it up). */
export const TAKE_REACH=1.2,WALK_PICKUP=.6;
/** Ground items last this long (then they are gone, like an XP gem). */
export const ITEM_GROUND_SECONDS=120;
/**
 * The manual combat's starting inventory: empty hands (torre-limite-rebocar-sem-arma, the user, 25/10: "não deveríamos
 * começar com arma na mão"; it was the Faca de Pão for everyone). The hand is set (the inventory exists) on an empty
 * slot: Atacar fires nothing until the first crate's weapon (add → fixHand puts it in the hand).
 */
export const manualStartingBuild=():PlayerBuild=>({weapons:[],passives:[],hand:0});

export type InventoryRefusal='player'|'slot'|'not-weapon'|'not-consumable'|'last-weapon'|'full'|'far'|'pickup'|'unusable'|'owned';
export type InventoryResult={ok:true}|{ok:false;reason:InventoryRefusal};
const no=(reason:InventoryRefusal):InventoryResult=>({ok:false,reason});
const OK:InventoryResult={ok:true};

export const isWeaponItem=(item:OwnedItem|undefined)=>!!item&&!!getWeapon(item.id)?.pattern;
export const isConsumableItem=(item:OwnedItem|undefined)=>!!item&&isConsumableId(item.id);
/** Whether the player is in the manual combat's inventory (build.hand set). */
export const hasInventory=(p:{build:PlayerBuild})=>p.build.hand!==undefined;
const LEGENDARY_SUFFIX='-lendario';
/** What "the same item" compares (caixa-sem-item-repetido): the id, a legendary as the weapon it comes from. */
export const itemKey=(id:string)=>id.endsWith(LEGENDARY_SUFFIX)?id.slice(0,-LEGENDARY_SUFFIX.length):id;
/** The keys (itemKey) of the weapons and kits this player holds; consumables do not count (they stack). */
export function ownedKeys(p:{build:PlayerBuild},into=new Set<string>()):Set<string>{
  for(const item of p.build.weapons)if(!isConsumableId(item.id))into.add(itemKey(item.id));
  return into;
}
/** Whether this player already holds this weapon or kit in any rarity (a consumable never counts). */
export const owns=(p:{build:PlayerBuild},id:string)=>!isConsumableId(id)&&p.build.weapons.some(item=>itemKey(item.id)===itemKey(id));
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

/** Where a kit goes: the top-left cell of its footprint on the build grid (contract/build.ts), rot 1 turns it. */
export interface KitOrder {c:number;r:number;rot?:0|1}
/**
 * Hooks a consumable may need (the team's tower fichas: the old kit-torre) and the kits' obra (stonewards buildKit;
 * absent: every place is refused 'fora').
 */
export interface InventoryHooks {
  addTowerToken?(ctx:SimContext):boolean;
  buildKit?(ctx:SimContext,p:SimPlayer,piece:KitPiece,order:KitOrder,requestId?:string):TowerResult;
}
export type PlaceResult=TowerResult|{ok:false;reason:'slot'|'not-kit'};
export const isKitItem=(item:OwnedItem|undefined)=>!!item&&kitPiece(item.id)!==undefined;

/** A kit de torre in `slot` builds its piece at `order` (see the header). The tower's refusals come back as they are. */
export function place(ctx:SimContext,p:SimPlayer,slot:number,order:KitOrder,hooks:InventoryHooks={},requestId?:string):PlaceResult{
  if(!hasInventory(p)||!live(p))return {ok:false,reason:'player'};
  const item=p.build.weapons[slot];
  if(!item)return {ok:false,reason:'slot'};
  const piece=kitPiece(item.id);
  if(!piece)return {ok:false,reason:'not-kit'};
  const result=hooks.buildKit?.(ctx,p,piece,order,requestId)??{ok:false,reason:'fora'};
  if(result.ok&&--item.level<=0)removeSlot(p.build,slot);
  return result;
}

/** How far (cells, Chebyshev) placeNear looks around the hero for the footprint's centre. */
export const PLACE_NEAR_CELLS=4;
const NEAR_OFFSETS:readonly (readonly [number,number])[]=(()=>{
  const out:[number,number][]=[];
  for(let dr=-PLACE_NEAR_CELLS;dr<=PLACE_NEAR_CELLS;dr++)for(let dc=-PLACE_NEAR_CELLS;dc<=PLACE_NEAR_CELLS;dc++)out.push([dc,dr]);
  // Nearest first; ties in a fixed order (row, then column), so a bot's choice is deterministic.
  return out.sort((a,b)=>Math.hypot(a[0],a[1])-Math.hypot(b[0],b[1])||a[1]-b[1]||a[0]-b[0]);
})();
/**
 * A bot's kit (torre-pela-caixa): the kit in `slot` goes on the nearest cell around the hero where the free build takes
 * it (the footprint centred on the candidate cell, never over the hero's own cell). The last refusal when none does
 * (the kit stays); a refusal no other cell changes ('player', 'limite', 'wall-down') stops the search.
 */
export function placeNear(ctx:SimContext,p:SimPlayer,slot:number,hooks:InventoryHooks={}):PlaceResult{
  const piece=kitPiece(p.build.weapons[slot]?.id);
  if(!piece)return place(ctx,p,slot,{c:0,r:0},hooks);
  const [w,h]=pieceCells(piece),c0=Math.floor(p.x/CITY_BUILD_CELL),r0=Math.floor(p.y/CITY_BUILD_CELL);
  let last:PlaceResult={ok:false,reason:'fora'};
  for(const [dc,dr] of NEAR_OFFSETS){
    const c=c0+dc-Math.floor((w-1)/2),r=r0+dr-Math.floor((h-1)/2);
    if(c<=c0&&c0<c+w&&r<=r0&&r0<r+h)continue;
    last=place(ctx,p,slot,{c,r},hooks);
    if(last.ok||last.reason==='player'||last.reason==='limite'||last.reason==='wall-down')return last;
  }
  return last;
}

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
  if(owns(p,pickup.resource))return no('owned');
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

/** An item on the ground: its server-only hiddenFor names the players who already own it (absent when nobody). */
function hideOwned(ctx:SimContext,pickup:PickupState){
  let who:string[]|undefined;
  if(pickup.resource)for(const p of ctx.players.values())if(owns(p,pickup.resource))(who??=[]).push(p.id);
  const had=pickup.hiddenFor;
  if(!who){if(had)delete pickup.hiddenFor;return;}
  if(!had||had.length!==who.length||had.some((q,i)=>q!==who![i]))pickup.hiddenFor=who;
}

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
        if(owns(p,pickup.resource!))continue;
        const item={id:pickup.resource!,level:pickup.value};
        if(add(p,item)){scratch.push(pickup.id);emitTake(ctx,p,pickup);break;}
        pickup.value=item.level;
      }
    }
    for(const id of scratch)ctx.pickups.delete(id);
    for(const pickup of ctx.pickups.values())if(pickup.kind==='item')hideOwned(ctx,pickup);
  }};
}

