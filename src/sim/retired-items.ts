/**
 * Items that left the game, and how an old checkpoint loses them (NEW-20261027-ORQ-sem-arma-girando-no-chao, the user
 * 28/10: "remover armas que giram ao nosso redor como 'aura'"): the Chinelo da Mãe (orbit), its evolution Havaianas do
 * Caos and the legendary made from them, and the Pack 12 rings (Pandeiro do Pagode, Figa de Madeira, Vela Aromática:
 * sim/weapons/pack12.ts). The protocol's id table keeps their names (the wire indexes stay put).
 *
 * scrubRetired(cp), on the raw checkpoint before it is checked (idempotent, the shape untouched):
 *  - a seat's build loses them (the manual inventory's hand goes to its first weapon, sim/inventory.ts fixHand) and
 *    their weapon timers; an automatic build left with no weapon gets its class's starting one back on resume;
 *  - an offer loses those choices (none left: the offer goes; the default stays on the same item or the first);
 *  - an item on the ground holding one goes; a crate showing one shows nothing and rolls its prize when opened (an
 *    older checkpoint's crate, sim/crates.ts CrateRecord.item); the crates' "last prize" memories forget it.
 */
import type {PlayerBuild} from '../contract/index.ts';
import {fixHand} from './inventory.ts';

export const RETIRED_ITEM_IDS:ReadonlySet<string>=new Set(['chinelo','chinelo-evo','chinelo-lendario','pandeiro','figa','vela-esoterica']);
export const isRetired=(id:unknown)=>typeof id==='string'&&RETIRED_ITEM_IDS.has(id);

const isObject=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);

/** The build without retired items (in place); true when something went. */
export function scrubBuild(build:PlayerBuild):boolean{
  const before=build.weapons.length;
  build.weapons=build.weapons.filter(w=>!isRetired(w.id));
  build.passives=build.passives.filter(p=>!isRetired(p.id));
  if(build.weapons.length===before)return false;
  if(build.hand!==undefined)fixHand(build);
  return true;
}

export function scrubRetired(cp:unknown):void{
  if(!isObject(cp))return;
  if(Array.isArray(cp.players))for(const seat of cp.players){
    const run=isObject(seat)?seat.run:undefined;
    if(!isObject(run))continue;
    const build=run.build as PlayerBuild|undefined;
    if(isObject(build)&&Array.isArray(build.weapons)&&Array.isArray(build.passives))scrubBuild(build);
    if(isObject(run.weaponReady))for(const id of Object.keys(run.weaponReady))if(isRetired(id))delete run.weaponReady[id];
  }
  const world=cp.world;
  if(isObject(world)){
    if(Array.isArray(world.offers))for(const entry of world.offers){
      if(!Array.isArray(entry)||!Array.isArray(entry[1]))continue;
      entry[1]=entry[1].filter((offer:unknown)=>{
        if(!isObject(offer)||!Array.isArray(offer.choices))return true;
        const choices=offer.choices as {itemId:unknown}[];
        if(!choices.some(c=>isRetired(c.itemId)))return true;
        const kept=choices.filter(c=>!isRetired(c.itemId));
        if(!kept.length)return false;
        const def=choices[offer.defaultIndex as number];
        offer.choices=kept;offer.defaultIndex=Math.max(0,kept.indexOf(def));
        return true;
      });
    }
    if(Array.isArray(world.pickups)){
      const pickups=world.pickups.filter((p:unknown)=>!(isObject(p)&&p.kind==='item'&&isRetired(p.resource)));
      world.pickups=pickups;
      for(const p of pickups)if(isObject(p)&&p.kind==='chest'&&isRetired(p.resource))delete p.resource;
    }
  }
  const crates=isObject(cp.systems)?cp.systems.crates:undefined;
  if(isObject(crates)){
    if(isObject(crates.crates))for(const rec of Object.values(crates.crates))if(isObject(rec)&&isRetired(rec.item))delete rec.item;
    if(isRetired(crates.lastItem))delete crates.lastItem;
    if(isObject(crates.last))for(const [id,key] of Object.entries(crates.last))if(isRetired(key))delete crates.last[id];
  }
}
