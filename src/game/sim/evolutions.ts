/**
 * Evolution recipes and chest opening (VGM-036).
 * Weapon ids, max levels and recipes come from the VGM-035 weapon catalog, so a new weapon or
 * evolution only needs a catalog entry.
 */
import {ticks,type OwnedItem,type PlayerBuild,type SimContext,type SimPlayer} from './types.ts';
import {PASSIVE_MAX_LEVEL,isPassiveId,type PassiveId} from './passives.ts';
import {refreshStats} from './stats.ts';
import {MAX_PICKUPS,hasRoom} from './budget.ts';
import {WEAPON_CATALOG,WEAPON_IDS,getWeapon} from './weapons/catalog.ts';
import type {Rng} from './rng.ts';

export {WEAPON_IDS};
/** Default base weapon max level (D-005); the catalog entry is authoritative. */
export const WEAPON_MAX_LEVEL=8;
/** Evolved weapons have a single level. */
export const EVOLUTION_MAX_LEVEL=1;
/** Chests opened before 2:00 of combat never evolve. */
export const EVOLUTION_MIN_TICKS=ticks(120);
/** Heal value of the coxinha dropped by a chest with nothing to give. */
export const CHEST_HEAL_VALUE=30;
/** Seconds the chest coxinha stays on the ground (same as regular drops). */
export const CHEST_HEAL_LIFETIME_SECONDS=30;

export interface EvolutionRecipe {
  /** Evolved weapon id. */
  id:string;
  name:string;
  weapon:string;
  passive:PassiveId;
}

export const EVOLUTIONS:readonly EvolutionRecipe[]=Object.freeze([...WEAPON_CATALOG.values()]
  // A recipe needs a real base weapon and passive; otherwise it is skipped instead of evolving a wrong slot.
  .filter(def=>def.kind==='evolution'&&!!def.base&&getWeapon(def.base)?.kind==='weapon'&&!!def.passive&&isPassiveId(def.passive))
  .map(def=>Object.freeze({id:def.id,name:def.name,weapon:def.base!,passive:def.passive as PassiveId})));

const EVOLUTION_ID_SET:ReadonlySet<string>=new Set(EVOLUTIONS.map(r=>r.id));
export const isEvolutionId=(id:string)=>EVOLUTION_ID_SET.has(id);

/** Max level for an owned item id, or 0 when the id is unknown. */
export function itemMaxLevel(id:string):number{
  if(isPassiveId(id))return PASSIVE_MAX_LEVEL;
  return getWeapon(id)?.maxLevel??0;
}

const levelOf=(items:readonly OwnedItem[],id:string)=>items.reduce((max,item)=>item.id===id?Math.max(max,item.level):max,0);

/** Recipes whose base weapon is at max level, whose passive is owned, and that are not evolved yet. */
export function eligibleEvolutions(build:PlayerBuild):EvolutionRecipe[]{
  return EVOLUTIONS.filter(recipe=>
    levelOf(build.weapons,recipe.weapon)>=itemMaxLevel(recipe.weapon)
    &&levelOf(build.passives,recipe.passive)>=1
    &&!build.weapons.some(w=>w.id===recipe.id));
}

export type ChestResult=
  | {kind:'evolve';from:string;to:string}
  | {kind:'upgrade';items:OwnedItem[]}
  /** pickup is null when the pickup budget is full: the player is healed directly instead. */
  | {kind:'heal';pickup:string|null};

/** The class bonus always comes from SimPlayer.classBonus (D-005/D-006). */
export interface ChestOptions {
  /** Tick when combat started; defaults to ctx.runStartTick. The 2:00 evolution gate counts from here. */
  runStartTick?:number;
  /**
   * Base stream that is never drawn from (progression passes one derived from the room seed), so each
   * chest roll depends only on that stream and the chest id. Defaults to ctx.rng (order-dependent).
   */
  rng?:Rng;
}

const canOpen=(player:SimPlayer)=>player.online&&!player.spectator&&!player.downed&&!player.eliminated&&player.hp>0;

/** Highest-level entry per id (first wins ties), so duplicated build entries never soak up upgrades. */
function primaryEntries(items:readonly OwnedItem[]):OwnedItem[]{
  const best=new Map<string,OwnedItem>();
  for(const item of items){const current=best.get(item.id);if(!current||item.level>current.level)best.set(item.id,item);}
  return [...best.values()];
}

/**
 * Consumes chest pickup `chestId` for `player` and applies its reward once.
 * Returns null (and changes nothing) if the chest is gone, is not a chest, or the player cannot open it,
 * so repeated or simultaneous opens of the same chest apply exactly one reward.
 * Reward: at most one evolution (base weapon becomes the evolved one, the passive stays); otherwise
 * 1 item level (3 with luck); with nothing to upgrade, a coxinha drops where the chest was.
 * Offline players cannot open chests. The coxinha emits no event: the pickups system reports it when collected.
 */
export function openChest(ctx:SimContext,player:SimPlayer,chestId:string,options:ChestOptions={}):ChestResult|null{
  const chest=ctx.pickups.get(chestId);
  if(!chest||chest.kind!=='chest'||!canOpen(player))return null;
  ctx.pickups.delete(chestId);
  // Per-chest stream: deterministic and independent of how many chests open this tick.
  const rng=(options.rng??ctx.rng).fork(`chest:${chestId}`);
  const build=player.build;

  const elapsed=ctx.tick-(options.runStartTick??ctx.runStartTick);
  const recipes=elapsed>=EVOLUTION_MIN_TICKS?eligibleEvolutions(build):[];
  if(recipes.length){
    const recipe=rng.pick(recipes);
    // Evolve the max-level copy in place (same array, so holders of build.weapons stay valid)
    // and drop any stray duplicates of the base weapon.
    const base=primaryEntries(build.weapons).find(w=>w.id===recipe.weapon)!;
    build.weapons.splice(build.weapons.indexOf(base),1,{id:recipe.id,level:EVOLUTION_MAX_LEVEL});
    for(let i=build.weapons.length-1;i>=0;i--)if(build.weapons[i].id===recipe.weapon)build.weapons.splice(i,1);
    // The evolution inherits the base cooldown and never fires on the tick it appears.
    player.weaponReady[recipe.id]=Math.max(player.weaponReady[recipe.weapon]??0,ctx.tick+1);
    delete player.weaponReady[recipe.weapon];
    ctx.emit({type:'evolve',player:player.id,from:recipe.weapon,to:recipe.id});
    return {kind:'evolve',from:recipe.weapon,to:recipe.id};
  }

  const upgradable=()=>[...primaryEntries(build.weapons),...primaryEntries(build.passives)].filter(item=>item.level<itemMaxLevel(item.id));
  const count=rng.chance(Math.min(0.5,0.08*player.stats.luck))?3:1;
  const items:OwnedItem[]=[];
  let passiveChanged=false;
  for(let i=0;i<count;i++){
    const candidates=upgradable();
    if(!candidates.length)break;
    const item=rng.pick(candidates);
    item.level++;
    if(isPassiveId(item.id))passiveChanged=true;
    items.push({id:item.id,level:item.level});
    ctx.emit({type:'upgrade',player:player.id,item:item.id,level:item.level});
  }
  if(items.length){
    if(passiveChanged)refreshStats(player);
    return {kind:'upgrade',items};
  }

  if(!hasRoom(ctx.pickups,MAX_PICKUPS)){
    player.hp=Math.min(player.stats.maxHp,player.hp+CHEST_HEAL_VALUE);
    return {kind:'heal',pickup:null};
  }
  const pickup=ctx.nextId('pickup');
  ctx.pickups.set(pickup,{id:pickup,kind:'heal',value:CHEST_HEAL_VALUE,x:chest.x,y:chest.y,
    spawnTick:ctx.tick,expiresTick:ctx.tick+ticks(CHEST_HEAL_LIFETIME_SECONDS)});
  return {kind:'heal',pickup};
}
