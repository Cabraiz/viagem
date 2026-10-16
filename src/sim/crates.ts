/**
 * D-051 crates (NEW-20261014-ORQ-armas-caixas-inventario, plans/armas-caixas-inventario-proposta.md §2), manual combat
 * only (assemble wires it then). A crate IS a 'chest' pickup whose `value` is its rarity (1 verde .. 5 lendária):
 *  - placed: at the first step up to MAX_CRATES crates on distinct random map points (the city's `loot` points),
 *    NEAR_START of them on the near third (the user, 16/10: "more crates early and near"). The rarity grows with the
 *    walk time from the plaza: the points are split in thirds by `seconds` (near / mid / far) and each third rolls its
 *    pair (TIER_ODDS), the crate's base. It also grows along the match: a placed crate shows its base shifted by the
 *    round's stage (stageShift: -1 in the first rounds .. +2 in the last, clamped verde..lendária), so an unopened
 *    crate turns better as the rounds go by ("from comum to lendária as the match goes"). An opened placed crate comes
 *    back RESPAWN_SECONDS later on a random free point at least RESPAWN_MIN_DIST from every player (retried on later
 *    ticks while none qualifies);
 *  - start: at the first step one verde crate a player (START_CRATES_MIN..START_CRATES_MAX) on `startPoints`, spread
 *    out (the city: just outside the plaza, cityLoot.aroundPlaza), so a firearm is a short walk away in the first rounds
 *    (the loot points are 18 s and more from the plaza, the intermission 20 s). Dropped crates: they never respawn;
 *  - dropped: the elites' and the boss's chests (other systems add them as plain 'chest' pickups) are adopted at the
 *    next step, and dropCrate (the D-051 nests) adds one of a given rarity. They never respawn nor count to the cap;
 *  - opening: a standing player (hasInventory) within OPEN_REACH who did not move this tick fills OPEN_SECONDS of its
 *    rarity, on the nearest crate; moving or losing hp starts over. From the roxa up, starting to open makes noise
 *    (hooks.onNoise, OPEN_NOISE_RADIUS): the lock creaks and calls the enemies around;
 *  - the prize (PRIZES) rolls on a per-crate stream (seed, crate id, tick), so no other draw shifts it; items go into
 *    the inventory (add) and what does not fit lands on the ground beside the crate (dropItem).
 * All the bookkeeping is the JSON-safe CratesState (a room checkpoint resumes the same placements and rolls).
 */
import type {OwnedItem,PickupState,Point,SimPlayer} from '../contract/index.ts';
import {Rng,ticks} from '../contract/index.ts';
import {UNITS_PER_TOKEN} from '../rules/index.ts';
import type {SimContext} from './context.ts';
import {add,dropItem,hasInventory} from './inventory.ts';
import {NEW_WEAPONS,isRarity,legendaryId,type ConsumableId,type Rarity} from './weapons/arsenal.ts';
import {WEAPON_IDS} from './weapons/catalog.ts';

/** Placed crates alive at once (proposal: "para o mapa não virar supermercado"). Dropped crates do not count. */
export const MAX_CRATES=12;
/** Of the initial MAX_CRATES, this many sit on the near third (the rest anywhere), so the first rounds have crates close. */
export const NEAR_START=8;
/** Start crates: one a player, up to START_CRATES_MAX (the 16/10 bench: a solo with three of them is too easy). */
export const START_CRATES_MIN=1,START_CRATES_MAX=6;
/** The match is split in this many stages by round (10 rounds: 1-3, 4-5, 6-8, 9-10); stage s shifts a placed crate by s-1. */
export const RARITY_STAGES=4;
/** An opened placed crate comes back this long after (no rounds: no refill in an intermission). */
export const RESPAWN_SECONDS=180;
/** A crate never (re)appears closer than this to a player (world units), so nobody sees it pop in at their feet. */
export const RESPAWN_MIN_DIST=8;
/** How close (world units) a player must stand to open a crate. */
export const OPEN_REACH=1;
/** Seconds of standing still to open, by rarity - 1 (verde 1 s .. lendária 3 s). */
export const OPEN_SECONDS:readonly number[]=[1,1.5,2,2.5,3];
/** From this rarity up (roxa) starting to open makes noise, heard within OPEN_NOISE_RADIUS world units. */
export const NOISY_RARITY=3,OPEN_NOISE_RADIUS=10;
/** Grana prizes (R$) and the team XP a lendária adds. */
export const GRANA_VERDE=5,GRANA_DOURADA=50,LEGENDARY_TEAM_XP=50;
/** Pickup id prefix of the crates this module places or drops (not CRATE_PREFIX 'caixa-': those are the gather nodes). */
export const CRATE_ID_PREFIX='bau';
/**
 * How a boss chest is told apart (both chests come with value 1): boss.ts's default drop takes ctx.nextId('pickup')
 * while progression's elite drop takes ctx.nextId('chest'). An unknown chest whose id has this prefix is the boss's
 * (lendária). The integrator should rather pass boss `dropChest:(ctx,at)=>crates.dropCrate(ctx,at,5)`, which needs no
 * guess; an unknown chest that already carries a rarity above verde (a system that knows it) keeps it.
 */
export const BOSS_CHEST_PREFIX='pickup-';

/**
 * Distance tiers' odds, the base of a placed crate: [rarity, chance] pairs that sum to 1 (near: verde/azul, mid:
 * azul/roxa, far: roxa/dourada). With stageShift: rounds 1-3 near is all verde, far azul/roxa; the last rounds far is
 * lendária.
 */
export const TIER_ODDS:readonly (readonly (readonly [Rarity,number])[])[]=[[[1,.7],[2,.3]],[[2,.6],[3,.4]],[[3,.65],[4,.35]]];
/** An elite's chest: azul or roxa. */
export const ELITE_ODDS:readonly (readonly [Rarity,number])[]=[[2,.6],[3,.4]];
const DOCES:readonly ConsumableId[]=['brigadeiro','pacoca','cocada'];

export interface CrateHooks {
  /** Grana of a crate, to the opener's wallet (E5); before the wallet, the team's pot. Absent: the Grana is lost. */
  addGrana?(ctx:SimContext,player:SimPlayer,amount:number):void;
  /** Tower units (fichas × UNITS_PER_TOKEN) for the team's balance. */
  addTowerUnits?(ctx:SimContext,units:number):void;
  /** A roxa+ crate starts to open: enemies and nests within radius hear it (E1). source = the crate id. */
  onNoise?(ctx:SimContext,at:Point,radius:number,source:string):void;
}

export interface CrateRecord {
  /** What it gives now (the pickup's value). */
  rarity:Rarity;
  /** A placed crate's distance roll (TIER_ODDS), which the round's stage shifts into `rarity`. */
  base?:Rarity;
  /** placed (a map point, respawns) or dropped (elite, boss, nest, dropCrate: never respawns). */
  origin:'placed'|'dropped';
  /** Index of the map point a placed crate sits on. */
  point?:number;
}
/** JSON-safe. */
export interface CratesState {
  /** The first step placed the initial crates. */
  placed:boolean;
  /** Live crates this module knows, by pickup id. */
  crates:Record<string,CrateRecord>;
  /** Ticks when an opened placed crate comes back (ascending). */
  respawns:number[];
  /** Per player: the crate being opened and the standing ticks so far. */
  opening:Record<string,{crate:string;ticks:number}>;
  /** Per player: position and hp seen at the last step (moved / hurt since). */
  seen:Record<string,{x:number;y:number;hp:number}>;
  /** The placement and adoption stream (prizes have their own per-crate stream). */
  rng:number;
}
export const createCratesState=(seed:number):CratesState=>({placed:false,crates:{},respawns:[],opening:{},seen:{},rng:new Rng(seed).fork('caixas').state});

export interface CratesOptions {
  /** Room seed: placements, adoptions and prizes all derive from it. */
  seed:number;
  /** Where placed crates sit, with the walk time from the plaza (city: cityLoot(terrain).crates). Empty: none placed. */
  points:readonly {x:number;y:number;seconds:number}[];
  /** Where the start crates may sit (city: cityLoot(terrain).aroundPlaza). Absent or empty: no start crates. */
  startPoints?:readonly Point[];
  hooks?:CrateHooks;
  /** A checkpoint to resume from. */
  state?:CratesState;
}
export interface Crates {
  readonly state:CratesState;
  step(ctx:SimContext):void;
  /** Adds a dropped crate of this rarity (D-051 nests; the boss's dropChest). */
  dropCrate(ctx:SimContext,at:Point,rarity:Rarity):PickupState;
  /** The crate this player is opening and how far along (0..1), for the HUD. */
  opening(playerId:string):{crate:string;progress:number}|undefined;
}

const openTicks=(rarity:Rarity)=>ticks(OPEN_SECONDS[rarity-1]);
/** The round's stage shift (-1 .. RARITY_STAGES-2): before the first round and in rounds 1-3 of 10, -1. */
export function stageShift(round:{index:number;total:number}){
  const total=Math.max(1,round.total||10),index=Math.min(total,Math.max(1,round.index));
  return Math.min(RARITY_STAGES-1,Math.floor((index-1)*RARITY_STAGES/total))-1;
}
export const shifted=(base:Rarity,shift:number)=>Math.min(5,Math.max(1,base+shift)) as Rarity;
const canOpen=(p:SimPlayer)=>hasInventory(p)&&!p.spectator&&!p.eliminated&&!p.downed&&p.hp>0;
/** Players a crate keeps away from on respawn: anyone on the map (the downed too). */
const onMap=(p:SimPlayer)=>!p.spectator&&!p.eliminated;
const roll=(rng:Rng,odds:readonly (readonly [Rarity,number])[]):Rarity=>{
  let u=rng.next();
  for(const [rarity,chance] of odds){if(u<chance)return rarity;u-=chance;}
  return odds[odds.length-1][0];
};
/** A weapon item at a crate's rarity, never below the weapon's own minimum. */
const weaponItem=(id:string,rarity:Rarity):OwnedItem=>({id,level:Math.max(rarity,NEW_WEAPONS.find(w=>w.id===id)?.minRarity??1)});

/** What a crate gives: items for the inventory plus side effects (Grana, fichas, team XP) through the hooks. */
export interface Prize {items:OwnedItem[];grana?:number;towerUnits?:number;teamXp?:number}
/** The prize table (proposal §2), one draw decides the row, the next ones the item. Pure: same stream, same prize. */
export function rollPrize(rng:Rng,rarity:Rarity):Prize{
  const u=rng.next();
  switch(rarity){
    // The user (16/10): a firearm early on, so the verde is mostly the pistol.
    case 1:return u<.75?{items:[weaponItem('pistola',1)]}:u<.95?{items:[{id:'coxinha',level:1}]}:{items:[],grana:GRANA_VERDE};
    case 2:return u<.65?{items:[weaponItem(rng.pick(['escopeta','submetralhadora']),2)]}
      :u<.85?{items:[{id:rng.pick(DOCES),level:1}]}:{items:[],towerUnits:UNITS_PER_TOKEN/2};
    // "rifle ou maçarico, roxo, ou uma azul virando roxa": the four weapons a roxa can hold, even odds.
    case 3:return u<.6?{items:[weaponItem(rng.pick(['rifle','macarico','escopeta','submetralhadora']),3)]}
      :u<.85?{items:[{id:rng.pick(DOCES),level:2}]}:{items:[],towerUnits:UNITS_PER_TOKEN};
    // "bazuca ou qualquer arma dourada": every new weapon but the starting faca, even odds (the dourada is the only
    // source of the rojão, whose minimum is dourada).
    case 4:return u<.7?{items:[weaponItem(rng.pick(NEW_WEAPONS.filter(w=>w.id!=='faca').map(w=>w.id)),4)]}
      :u<.9?{items:[{id:'kit-torre',level:1}]}:{items:[],grana:GRANA_DOURADA};
    case 5:return {items:[{id:legendaryId(rng.pick(WEAPON_IDS)),level:5}],teamXp:LEGENDARY_TEAM_XP};
  }
}

export function createCrates(options:CratesOptions):Crates{
  const {seed,points,startPoints=[],hooks={}}=options;
  const state=options.state??createCratesState(seed);
  // Distance tier of each point: thirds of the points sorted by walk time (ties: map order), 0 near .. 2 far.
  const tierOf:number[]=new Array(points.length).fill(0);
  points.map((p,i)=>({s:p.seconds,i})).sort((a,b)=>a.s-b.s||a.i-b.i).forEach(({i},rank)=>{tierOf[i]=Math.min(2,Math.floor(rank*3/points.length));});
  const scratch:string[]=[];

  function addCrate(ctx:SimContext,at:Point,record:CrateRecord):PickupState{
    const pickup:PickupState={id:ctx.nextId(CRATE_ID_PREFIX),kind:'chest',value:record.rarity,x:at.x,y:at.y,spawnTick:ctx.tick};
    ctx.pickups.set(pickup.id,pickup);
    state.crates[pickup.id]=record;
    return pickup;
  }
  const placedCount=()=>{let n=0;for(const id in state.crates)if(state.crates[id].origin==='placed')n++;return n;};
  const usedPoints=()=>{const used=new Set<number>();for(const id in state.crates){const p=state.crates[id].point;if(p!==undefined)used.add(p);}return used;};
  function place(ctx:SimContext,rng:Rng,point:number){
    const base=roll(rng,TIER_ODDS[tierOf[point]]);
    addCrate(ctx,points[point],{rarity:shifted(base,stageShift(ctx.round)),base,origin:'placed',point});
  }

  /** Initial placement: a seeded shuffle of the points, NEAR_START of the near third first, then the first of the rest. */
  function placeInitial(ctx:SimContext,rng:Rng){
    state.placed=true;
    const order=points.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=rng.int(0,i);[order[i],order[j]]=[order[j],order[i]];}
    const near=order.filter(i=>tierOf[i]===0).slice(0,NEAR_START),rest=order.filter(i=>!near.includes(i));
    for(const point of [...near,...rest].slice(0,MAX_CRATES))place(ctx,rng,point);
    // Start crates: a random first spot, then each next the candidate farthest from those taken (ties: list order).
    let players=0;for(const p of ctx.players.values())if(!p.spectator)players++;
    const want=Math.min(startPoints.length,Math.max(START_CRATES_MIN,Math.min(START_CRATES_MAX,players)));
    const taken:Point[]=[];
    if(want)taken.push(rng.pick(startPoints));
    while(taken.length<want){
      let best=startPoints[0],bestD=-1;
      for(const c of startPoints){const d=Math.min(...taken.map(t=>Math.hypot(t.x-c.x,t.y-c.y)));if(d>bestD){best=c;bestD=d;}}
      taken.push(best);
    }
    for(const at of taken)addCrate(ctx,at,{rarity:1,origin:'dropped'});
  }

  /** Placed crates follow the round's stage (the pickup's value is what the HUD and the bots see). */
  function restage(ctx:SimContext){
    const shift=stageShift(ctx.round);
    for(const id in state.crates){
      const record=state.crates[id];
      if(record.base===undefined)continue;
      const rarity=shifted(record.base,shift),pickup=ctx.pickups.get(id);
      if(rarity===record.rarity||!pickup)continue;
      record.rarity=rarity;pickup.value=rarity;
    }
  }

  /** Due respawns, oldest first: a random free point far enough from every player, else wait for a later tick. */
  function respawn(ctx:SimContext,rng:Rng){
    while(state.respawns.length&&state.respawns[0]<=ctx.tick){
      if(placedCount()>=MAX_CRATES){state.respawns.shift();continue;}
      const used=usedPoints(),players=[...ctx.players.values()].filter(onMap);
      const free=points.map((_,i)=>i).filter(i=>!used.has(i)&&players.every(p=>Math.hypot(p.x-points[i].x,p.y-points[i].y)>=RESPAWN_MIN_DIST));
      if(!free.length)return;
      state.respawns.shift();
      place(ctx,rng,rng.pick(free));
    }
  }

  /** Chests other systems added (elite, boss) become dropped crates; known crates gone some other way are forgotten. */
  function sync(ctx:SimContext,rng:Rng){
    for(const id in state.crates){
      if(ctx.pickups.get(id)?.kind==='chest')continue;
      if(state.crates[id].origin==='placed')state.respawns.push(ctx.tick+ticks(RESPAWN_SECONDS));
      delete state.crates[id];
    }
    for(const pickup of ctx.pickups.values()){
      if(pickup.kind!=='chest'||state.crates[pickup.id])continue;
      const rarity:Rarity=isRarity(pickup.value)&&pickup.value>1?pickup.value:pickup.id.startsWith(BOSS_CHEST_PREFIX)?5:roll(rng,ELITE_ODDS);
      pickup.value=rarity;
      state.crates[pickup.id]={rarity,origin:'dropped'};
    }
  }

  /** The nearest live crate within OPEN_REACH (ties: the first known). */
  function nearestCrate(ctx:SimContext,p:Point){
    let best:PickupState|undefined,bestD=Infinity;
    for(const id in state.crates){
      const c=ctx.pickups.get(id);
      if(!c)continue;
      const d=Math.hypot(c.x-p.x,c.y-p.y);
      if(d<=OPEN_REACH&&d<bestD){best=c;bestD=d;}
    }
    return best;
  }

  function open(ctx:SimContext,p:SimPlayer,crate:PickupState){
    const record=state.crates[crate.id];
    ctx.pickups.delete(crate.id);
    delete state.crates[crate.id];
    if(record.origin==='placed')state.respawns.push(ctx.tick+ticks(RESPAWN_SECONDS));
    const prize=rollPrize(new Rng(seed).fork(`premio:${crate.id}:${ctx.tick}`),record.rarity);
    for(const item of prize.items)if(!add(p,item))dropItem(ctx,crate,item);
    if(prize.grana)hooks.addGrana?.(ctx,p,prize.grana);
    if(prize.towerUnits)hooks.addTowerUnits?.(ctx,prize.towerUnits);
    if(prize.teamXp)ctx.team.xp+=prize.teamXp;
    ctx.emit({type:'pickup',player:p.id,pickup:crate.id,kind:'chest',value:record.rarity});
  }

  function openStep(ctx:SimContext){
    for(const p of ctx.players.values()){
      const last=state.seen[p.id];
      state.seen[p.id]={x:p.x,y:p.y,hp:p.hp};
      const still=!!last&&last.x===p.x&&last.y===p.y&&p.hp>=last.hp;
      if(!canOpen(p)||!still){delete state.opening[p.id];continue;}
      let doing=state.opening[p.id];
      const current=doing&&ctx.pickups.get(doing.crate);
      // Keep the crate being opened while it is there and in reach; else the nearest one starts from zero.
      const crate=current&&state.crates[current.id]&&Math.hypot(current.x-p.x,current.y-p.y)<=OPEN_REACH?current:nearestCrate(ctx,p);
      if(!crate){delete state.opening[p.id];continue;}
      if(!doing||doing.crate!==crate.id){
        doing=state.opening[p.id]={crate:crate.id,ticks:0};
        if(state.crates[crate.id].rarity>=NOISY_RARITY)hooks.onNoise?.(ctx,{x:crate.x,y:crate.y},OPEN_NOISE_RADIUS,crate.id);
      }
      if(++doing.ticks<openTicks(state.crates[crate.id].rarity))continue;
      open(ctx,p,crate);
      delete state.opening[p.id];
    }
    // Whoever was on a crate somebody else just opened (or a player who left) lets go.
    scratch.length=0;
    for(const id in state.opening)if(!ctx.players.has(id)||!state.crates[state.opening[id].crate])scratch.push(id);
    for(const id of scratch)delete state.opening[id];
    scratch.length=0;
    for(const id in state.seen)if(!ctx.players.has(id))scratch.push(id);
    for(const id of scratch)delete state.seen[id];
  }

  return {
    state,
    step(ctx){
      const rng=new Rng(0);rng.state=state.rng;
      if(!state.placed)placeInitial(ctx,rng);
      sync(ctx,rng);
      respawn(ctx,rng);
      restage(ctx);
      openStep(ctx);
      state.rng=rng.state;
    },
    dropCrate(ctx,at,rarity){return addCrate(ctx,{x:at.x,y:at.y},{rarity,origin:'dropped'});},
    opening(playerId){
      const doing=state.opening[playerId],record=doing&&state.crates[doing.crate];
      return record?{crate:doing.crate,progress:Math.min(1,doing.ticks/openTicks(record.rarity))}:undefined;
    },
  };
}
