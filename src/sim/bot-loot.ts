/**
 * D-051 bots and the arsenal (proposal §6), manual combat only: what a bot does with crates, ground items and its
 * inventory. Pure over the bot's view; bot-brain.ts decide() calls it and keeps the walking (the streets, unstick).
 *  - eat a coxinha under EAT_BELOW of max hp;
 *  - hold the inventory's best weapon (weaponScore: damage per second, more for the patterns that hit a crowd);
 *  - with no critter within LOOT_SAFE and nobody down in sight: go to the nearest crate (stand by it until it opens)
 *    or the nearest better weapon on the ground within LOOT_RADIUS (walk over it; with the six full, "Trocar" it). A
 *    bot that holds a firearm leaves the verde crates (mostly a pistol) to the ones still with the faca (the 16/10
 *    bench: one bot opened them all while four fought with the knife).
 *  - a kit de torre (torre-pela-caixa) in a lull: build it where it stands ({t:'kit',slot}: the room's bots place it on
 *    the nearest cell that takes it, sim/inventory.ts placeNear).
 */
import type {OwnedItem,PickupState,PickupView,PlayerRunView,RunView,VehicleKind} from '../contract/index.ts';
import {BASE_STATS} from '../contract/index.ts';
import {getWeapon,resolveWeapon} from './weapons/catalog.ts';
import {OPEN_REACH} from './crates.ts';
import {INVENTORY_SLOTS,TAKE_REACH,isKitItem} from './inventory.ts';
import type {Point} from '../maps/index.ts';

/**
 * LOOT_RADIUS in combat; LOOT_RADIUS_CALM in an intermission (the bots walk to the same loot points to gather): 40 u on the
 * 1.7× city, 23 since mapa-175-com-viaduto (the distances ÷ CITY_COMPACT).
 */
export const EAT_BELOW=.4,LOOT_SAFE=6,LOOT_RADIUS=14,LOOT_RADIUS_CALM=23;
const VERDE_PISTOL={id:'pistola',level:1};
/** Crowd patterns (a cone, a zone, an orbit) count this much more than one target at a time. */
const CROWD=1.5;

/**
 * How good a weapon item is to hold (0 for anything that is not a weapon): damage per second, more for a crowd pattern
 * or a piercing shot, and for reach (a faca's arc means walking into the horde).
 */
export function weaponScore(item:OwnedItem|{id:string;level:number}|undefined){
  const def=item?getWeapon(item.id):undefined;
  if(!item||!def?.pattern)return 0;
  const w=resolveWeapon(def,item.level,BASE_STATS),perSecond=w.damage*w.amount*20/Math.max(1,w.cooldownTicks);
  const reach=def.pattern==='cone'||def.pattern==='orbit'||def.pattern==='shield'?w.area:w.range;
  return perSecond*(def.pattern==='pierce'||def.pattern==='homing'?1+Math.min(w.pierce,3)*.15:CROWD)*Math.min(2,.5+reach/6);
}

export type LootCommand={t:'equip'|'use';slot:number}|{t:'kit';slot:number}|{t:'take';pickup:string};
export interface LootPlan {
  /** An inventory command this tick (the walking goes on). */
  command?:LootCommand;
  /** Where to go, and whether to stand still there (a crate opens only for who does not move). */
  goal?:{at:Point;stand:boolean;id:string};
}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

export function planLoot(view:Pick<RunView,'players'|'pickups'|'enemies'>,me:PlayerRunView,at:Point,radius=LOOT_RADIUS):LootPlan{
  const plan:LootPlan={};
  const inv=me.weapons,hand=me.hand??0;
  // 1. Eat when hurt.
  const cox=inv.findIndex(i=>i.id==='coxinha');
  if(cox>=0&&me.hp<me.maxHp*EAT_BELOW){plan.command={t:'use',slot:cox};}
  else{
    // 2. The best weapon in the hand.
    let best=hand,bestScore=weaponScore(inv[hand]);
    inv.forEach((item,i)=>{const s=weaponScore(item);if(s>bestScore){best=i;bestScore=s;}});
    if(best!==hand)plan.command={t:'equip',slot:best};
  }
  // 3. Loot only in a lull.
  if(view.enemies.some(e=>e.hp>0&&dist(e,at)<LOOT_SAFE))return plan;
  if(view.players.some(p=>p.id!==me.id&&p.downed&&!p.eliminated))return plan;
  const kit=inv.findIndex(isKitItem);
  if(kit>=0&&!plan.command)plan.command={t:'kit',slot:kit};
  const handScore=Math.max(...inv.map(i=>weaponScore(i)),0),armed=handScore>=weaponScore(VERDE_PISTOL);
  const pickups=view.pickups as readonly (PickupState|RunView['pickups'][number])[];
  let goal:LootPlan['goal'],goalDist=radius;
  for(const k of pickups){
    const d=dist(k,at);
    if(d>=goalDist)continue;
    if(k.kind==='chest'){if(armed&&k.value<=1||(k as PickupState).hiddenFor?.includes(me.id))continue;goal={at:{x:k.x,y:k.y},stand:true,id:k.id};goalDist=d;}
    else if(k.kind==='item'&&k.resource&&!(k as PickupState).hiddenFor?.includes(me.id)&&weaponScore({id:k.resource,level:k.value})>handScore){goal={at:{x:k.x,y:k.y},stand:false,id:k.id};goalDist=d;}
  }
  if(!goal)return plan;
  plan.goal=goal;
  // Next to a better weapon with the six full: "Trocar" (walking over it would not pick it up).
  if(!goal.stand&&!plan.command&&inv.length>=INVENTORY_SLOTS&&goalDist<=TAKE_REACH)plan.command={t:'take',pickup:goal.id};
  return plan;
}
/** How close a bot stands to a crate it opens (inside OPEN_REACH, with room for the sim's float). */
export const CRATE_STAND=OPEN_REACH*.7;

/**
 * Veículos (card bancos-e-veiculos, part 2): the parked vehicle a bot walks over, in a lull (no critter within
 * LOOT_SAFE, nobody down), when it rides nothing: the nearest within VEHICLE_BOT_REACH (ties by id) of the kinds in
 * BOT_VEHICLES (the Orq, 17/10: the bots take them all but the skates, whose missing brake ruins a bot's route).
 */
export const VEHICLE_BOT_REACH=8;
export const BOT_VEHICLES:ReadonlySet<string>=new Set<VehicleKind>(['patinete','carrinho','crossfiteiro']);
export function vehicleGoal(view:Pick<RunView,'tick'|'players'|'pickups'|'enemies'>,me:PlayerRunView,at:Point):PickupView|undefined{
  if(me.ride!==undefined&&view.tick<(me.rideUntil??-Infinity))return undefined;
  if(view.enemies.some(e=>e.hp>0&&dist(e,at)<LOOT_SAFE))return undefined;
  if(view.players.some(p=>p.id!==me.id&&p.downed&&!p.eliminated))return undefined;
  let best:PickupView|undefined,bestD=Infinity;
  for(const k of view.pickups){
    if(k.kind!=='vehicle'||!BOT_VEHICLES.has(k.resource??''))continue;
    const d=dist(k,at);
    if(d<=VEHICLE_BOT_REACH&&(d<bestD||d===bestD&&best!==undefined&&k.id<best.id)){best=k;bestD=d;}
  }
  return best;
}
