/**
 * D-051 crates (NEW-20261014-ORQ-armas-caixas-inventario, plans/armas-caixas-inventario-proposta.md §2), manual combat
 * only (assemble wires it then). A crate IS a 'chest' pickup whose `value` is its rarity (1 verde .. 5 lendária):
 *  - placed: at the first step up to crateCap(players) crates on distinct random map points (the city's `loot` points),
 *    the cap kept for the run; NEAR_START of them on the near third (the user, 16/10: "more crates early and near"). The rarity grows with the
 *    walk time from the plaza: the points are split in thirds by `seconds` (near / mid / far) and each third rolls its
 *    pair (TIER_ODDS), the crate's base. It also grows along the match: a placed crate shows its base shifted by the
 *    round's stage (stageShift: -1 in the first rounds .. +2 in the last, clamped verde..lendária), so an unopened
 *    crate turns better as the rounds go by ("from comum to lendária as the match goes"). An opened placed crate comes
 *    back RESPAWN_SECONDS later on a random free point at least RESPAWN_MIN_DIST from every player (retried on later
 *    ticks while none qualifies);
 *  - start (the first minute's, BUG-20261022-ORQ-caixas-sumiram): at the first step START_CRATES_PER_PLAYER crates a
 *    player (1..START_PLAYERS_MAX players) on `startPoints` (the city: around where the heroes spawn, cityLoot.aroundStart;
 *    they used to sit by the plaza, ~76 u of walk from the spawn and out of the frames' interest radius, so a hero
 *    walking the first minute met none). Spread by walk: the k-th crate of each player's set in the k-th of
 *    START_CRATES_PER_PLAYER walk bands, the farthest candidate of its band from the crates taken. Verde and azul
 *    alternate; their prize is the starter table (rollStarter: no item dominates). Dropped crates: they never respawn;
 *  - trail (the first minute's, same bug): for FIRST_MINUTE_S from the first step, a hero who has passed (within
 *    PASS_DIST, about the PC camera's half view) fewer crates than the pace (one at the start, then one more every
 *    FIRST_MINUTE_S / (FIRST_MINUTE_CRATES + 2) s, inicio-no-uno: the last one due well before the end) and has none of his trail crates waiting gets one TRAIL_AHEAD u ahead of
 *    where he walks (options.trailSpot: open ground the heroes reach), never in another hero's view; one he leaves
 *    behind or TRAIL_MISS u away stops waiting (it stays on the map). Up to TRAIL_MAX a hero, start crates' prizes. So each
 *    hero who walks passes FIRST_MINUTE_CRATES in the first minute, whichever way he goes (static crates cannot: the
 *    camera shows ~8 u around the hero);
 *  - dropped: the elites' and the boss's chests (other systems add them as plain 'chest' pickups) are adopted at the
 *    next step, and dropCrate (the D-051 nests) adds one of a given rarity. They never respawn nor count to the cap;
 *  - opening: a standing player (hasInventory) within OPEN_REACH who did not move this tick fills OPEN_SECONDS of its
 *    rarity, on the nearest crate; moving or losing hp starts over. From the roxa up, starting to open makes noise
 *    (hooks.onNoise, OPEN_NOISE_RADIUS): the lock creaks and calls the enemies around;
 *  - the prize never repeats the opener's last crate prize (the user, 22/10: "sem repetir a mesma arma em sequência"):
 *    the same per-crate stream draws again, up to PRIZE_REDRAWS times, then the other kind (otherPrize);
 *  - the prize (rollCrate: a kit de torre of the crate's tier with KIT_CHANCE, else a weapon of its rarity, rollPrize) rolls on a per-crate stream (seed, crate id, tick), so no other draw shifts it; items go into
 *    the inventory (add) and what does not fit lands on the ground beside the crate (dropItem). A crate gives only a
 *    weapon or a kit (BUG-20261022-ORQ-bau-so-arma-ou-torre, the user: "os baús não deveriam dropar algo sem ser arma
 *    ou torre"): coxinha, doces and the ímã come from the critters (progression dropLoot), Grana from kills and banks.
 * All the bookkeeping is the JSON-safe CratesState (a room checkpoint resumes the same placements and rolls).
 */
import type {OwnedItem,PickupState,Point,SimPlayer} from '../contract/index.ts';
import {Rng,ticks} from '../contract/index.ts';
import {CRATE_OPEN_RADIUS,KIT_CHANCE,KIT_POOL,isKitId,kitItem} from '../rules/index.ts';
import type {SimContext} from './context.ts';
import {add,dropItem,hasInventory} from './inventory.ts';
import {ARSENAL_WEAPONS,isRarity,legendaryId,type Rarity} from './weapons/arsenal.ts';
import {WEAPON_IDS} from './weapons/catalog.ts';

/** Placed crates alive at once (proposal: "para o mapa não virar supermercado"). Dropped crates do not count. */
export const MAX_CRATES=16;
/**
 * Placed crates of a run with this many players (the 16/10 CI bench with 12 for all: a solo, who has them all to
 * itself, won 16/16, and 8/16 with 6; six players, who split them, 3/16): CRATES_BASE + CRATES_PER_PLAYER a player, up to
 * MAX_CRATES.
 */
export const CRATES_BASE=1,CRATES_PER_PLAYER=3;
export const crateCap=(players:number)=>Math.min(MAX_CRATES,CRATES_BASE+CRATES_PER_PLAYER*Math.max(1,players));
/** Of the initial crates, up to half sit on the near third (the rest anywhere), so the first rounds have crates close. */
export const NEAR_SHARE=.5;
/**
 * The first minute's crates: START_CRATES_PER_PLAYER a player, for 1..START_PLAYERS_MAX players (the user, 22/10: a
 * hero walking the first minute passes at least 4, each player his own; was one verde a player by the plaza).
 */
export const START_CRATES_PER_PLAYER=2,START_PLAYERS_MAX=6;
export const START_CRATES_MIN=START_CRATES_PER_PLAYER,START_CRATES_MAX=START_CRATES_PER_PLAYER*START_PLAYERS_MAX;
/**
 * The first minute's pace (trail crates): FIRST_MINUTE_CRATES passed a hero in FIRST_MINUTE_S seconds. Card
 * inicio-no-uno-caixas-120: the trail lasts the whole minuto de Minerva (120 s, ninhos.ts MINERVA_S) at the same pace
 * (4 a minute), the time the mission gives to "busque o máximo de caixas".
 */
export const FIRST_MINUTE_S=120,FIRST_MINUTE_CRATES=8;
/**
 * A hero passes a crate within PASS_DIST u (the PC camera shows ~8 u sideways, 9 up and down); a trail crate lands
 * TRAIL_AHEAD u ahead (out of his view, a few seconds at the 4 u/s walk), stops waiting TRAIL_MISS u away; TRAIL_MAX a hero.
 */
export const PASS_DIST=8,TRAIL_AHEAD:readonly [number,number]=[12,18],TRAIL_MISS=30,TRAIL_MAX=16;
/** A hero's heading follows his walk with this weight a tick (about a second's memory at 20 Hz). */
const HEADING_KEEP=.9;
/** A prize equal to the opener's last one is drawn again (same stream) up to this many times. */
export const PRIZE_REDRAWS=6;
/** The match is split in this many stages by round (10 rounds: 1-3, 4-5, 6-8, 9-10); stage s shifts a placed crate by s-1. */
export const RARITY_STAGES=4;
/** An opened placed crate comes back this long after (no rounds: no refill in an intermission). */
export const RESPAWN_SECONDS=180;
/** A crate never (re)appears closer than this to a player (world units), so nobody sees it pop in at their feet. */
export const RESPAWN_MIN_DIST=8;
/** How close (world units) a player must stand to open a crate: touching its edge (rules/crate-size.ts; was 1 before the 3× crate). */
export const OPEN_REACH=CRATE_OPEN_RADIUS;
/** Seconds of standing still to open, by rarity - 1 (verde 1 s .. lendária 3 s). */
export const OPEN_SECONDS:readonly number[]=[1,1.5,2,2.5,3];
/** From this rarity up (roxa) starting to open makes noise, heard within OPEN_NOISE_RADIUS world units. */
export const NOISY_RARITY=3,OPEN_NOISE_RADIUS=10;
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

export interface CrateHooks {
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
  /** A first-minute crate (dropped): its prize is the starter table (rollStarter). */
  start?:true;
  /** Index of the map point a placed crate sits on. */
  point?:number;
}
/** JSON-safe. */
export interface CratesState {
  /** The first step placed the initial crates. */
  placed:boolean;
  /** Placed crates alive at once for this run (crateCap of the players at the first step). */
  cap?:number;
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
  /** Per player: the key (prizeKey) of his last crate prize; absent in an older checkpoint. */
  last?:Record<string,string>;
  /** The first step's tick (the first minute's clock); absent in an older checkpoint: no trail. */
  startTick?:number;
  /** Per player, the first minute: crates passed (ids), his waiting trail crate, how many he got, his walk heading. */
  trail?:Record<string,{passed:string[];waiting?:string;placed:number;hx:number;hy:number}>;
}
export const createCratesState=(seed:number):CratesState=>({placed:false,crates:{},respawns:[],opening:{},seen:{},rng:new Rng(seed).fork('caixas').state});

export interface CratesOptions {
  /** Room seed: placements, adoptions and prizes all derive from it. */
  seed:number;
  /** Where placed crates sit, with the walk time from the plaza (city: cityLoot(terrain).crates). Empty: none placed. */
  points:readonly {x:number;y:number;seconds:number}[];
  /**
   * Where the first minute's crates may sit, with the walk (u) from the heroes' spawn (city: cityLoot(terrain).aroundStart).
   * Absent or empty: no start crates.
   */
  startPoints?:readonly StartPoint[];
  hooks?:CrateHooks;
  /**
   * A trail crate's spot about `ahead` u from `at` along the unit `heading` (the city: open ground for the crate's body
   * that the heroes reach, outside the base); undefined: none there. Absent: no trail crates.
   */
  trailSpot?(at:Point,heading:Point,ahead:number,rng:Rng):Point|undefined;
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
const weaponItem=(id:string,rarity:Rarity):OwnedItem=>({id,level:Math.max(rarity,ARSENAL_WEAPONS.find(w=>w.id===id)?.minRarity??1)});

/** What a crate gives: one weapon or one kit de torre, for the inventory. */
export interface Prize {items:OwnedItem[]}
/**
 * The weapons a crate of each rarity draws (bau-so-arma-ou-torre, the user: "tem várias torres e armas, ponha elas"):
 * verde..dourada every arsenal weapon that comes in that rarity (minRarity: the rojão only from the dourada), the
 * playable Pack 12 ones too (arsenal-completo-no-bau), never the starting faca; the lendária every legendary (the six
 * weapons of the automatic game) and the Pack 12 weapons that only come lendária. Even odds, but the verde's pistol
 * (VERDE_PISTOL).
 */
/**
 * The verde crate's share of the pistol among its weapons (arsenal-completo-no-bau, ORQ 23/10: the user's 16/10 "a
 * firearm early on", but "não sempre pistola"); the other verde weapons split the rest evenly.
 */
export const VERDE_PISTOL=.4;
const inCrates=(r:Rarity)=>ARSENAL_WEAPONS.filter(w=>w.id!=='faca'&&w.minRarity<=r).map(w=>w.id);
export const CRATE_WEAPONS:Readonly<Record<Rarity,readonly string[]>>=Object.freeze({
  1:inCrates(1),2:inCrates(2),3:inCrates(3),4:inCrates(4),
  5:[...WEAPON_IDS.map(legendaryId),...inCrates(5).filter(id=>ARSENAL_WEAPONS.find(w=>w.id===id)?.minRarity===5)],
});
/**
 * A crate's weapon: one of CRATE_WEAPONS[rarity] at that rarity (since bau-so-arma-ou-torre the coxinha, doces, Grana,
 * fichas and the lendária's team XP rows are gone). Pure: same stream, same prize.
 */
export function rollPrize(rng:Rng,rarity:Rarity):Prize{
  const pool=CRATE_WEAPONS[rarity];
  // The pistol keeps VERDE_PISTOL of the verde once other weapons come verde (the only one, it is the only draw).
  if(rarity===1&&pool.length>1)return {items:[weaponItem(rng.next()<VERDE_PISTOL?'pistola':rng.pick(pool.filter(id=>id!=='pistola')),1)]};
  return {items:[weaponItem(rng.pick(pool),rarity)]};
}

/**
 * What a crate gives (torre-pela-caixa): a kit de torre of its rarity's tier (rules KIT_POOL) with KIT_CHANCE, else a
 * weapon of its rarity (rollPrize). Nothing else. Pure: same stream, same prize.
 */
export function rollCrate(rng:Rng,rarity:Rarity):Prize{
  if(rng.next()<KIT_CHANCE)return {items:[kitItem(rng.pick(KIT_POOL[rarity]))]};
  return rollPrize(rng,rarity);
}

/** A first-minute crate spot: `walk` (u) from the heroes' spawn; absent, the distance from the first spot stands in. */
export type StartPoint=Point&{walk?:number};
/** The start points in START_CRATES_PER_PLAYER walk bands of equal width over their walk range, nearest first. */
export function startBands(points:readonly StartPoint[]):StartPoint[][]{
  const n=START_CRATES_PER_PLAYER,bands:StartPoint[][]=Array.from({length:n},()=>[]);
  if(!points.length)return bands;
  const walk=(p:StartPoint)=>p.walk??Math.hypot(p.x-points[0].x,p.y-points[0].y);
  let lo=Infinity,hi=-Infinity;
  for(const p of points){const w=walk(p);lo=Math.min(lo,w);hi=Math.max(hi,w);}
  for(const p of points)bands[hi>lo?Math.min(n-1,Math.floor((walk(p)-lo)/(hi-lo)*n)):0].push(p);
  return bands;
}

/**
 * The first minute's weapons (BUG-20261022-ORQ-caixas-sumiram, the user: "sorteio entre as armas/itens do jogo (não
 * sempre pistola)"): an azul crate's (pistola, escopeta, submetralhadora), even odds, at the crate's rarity (never below
 * the weapon's minimum).
 */
export const STARTER_WEAPONS:readonly string[]=CRATE_WEAPONS[2];
/**
 * The first minute's prize: a verde kit (KIT_POOL[1], even odds) with KIT_CHANCE, else one of STARTER_WEAPONS. With only
 * weapons and kits left (bau-so-arma-ou-torre: the coxinha, doce and Grana/fichas rows are gone) the old "no row above
 * 1/6" becomes "no prize above 1/4": each weapon (1-KIT_CHANCE)/3 = 1/4, each kit KIT_CHANCE/|KIT_POOL[1]|; with the
 * never-twice-in-a-row redraw the pistol is never the prize every time.
 */
export function rollStarter(rng:Rng,rarity:Rarity):Prize{
  if(rng.next()<KIT_CHANCE)return {items:[kitItem(rng.pick(KIT_POOL[1]))]};
  return {items:[weaponItem(rng.pick(STARTER_WEAPONS),rarity)]};
}
/**
 * The same prize still after PRIZE_REDRAWS (a verde is only the pistol or a kit, so redraws alone miss often): the other
 * kind, a weapon after a kit and a kit after a weapon, never equal to `last`.
 */
export function otherPrize(rng:Rng,rarity:Rarity,start:boolean,last:string):Prize{
  if(isKitId(last))return start?{items:[weaponItem(rng.pick(STARTER_WEAPONS),rarity)]}:rollPrize(rng,rarity);
  return {items:[kitItem(rng.pick(KIT_POOL[start?1:rarity]))]};
}
/** What a "the same prize again" check compares: the item's id. */
export const prizeKey=(prize:Prize)=>prize.items[0]?.id??'nada';

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

  /** Initial placement: a seeded shuffle of the points, NEAR_SHARE of the cap from the near third first, then the rest. */
  function placeInitial(ctx:SimContext,rng:Rng){
    state.placed=true;state.startTick=ctx.tick;
    let players=0;for(const p of ctx.players.values())if(!p.spectator)players++;
    const cap=state.cap=crateCap(players);
    const order=points.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=rng.int(0,i);[order[i],order[j]]=[order[j],order[i]];}
    const near=order.filter(i=>tierOf[i]===0).slice(0,Math.ceil(cap*NEAR_SHARE)),rest=order.filter(i=>!near.includes(i));
    for(const point of [...near,...rest].slice(0,cap))place(ctx,rng,point);
    // Start crates: the k-th of each player's set in the k-th walk band (startBands), the first one random, each next
    // the candidate of its band farthest from those taken (ties: list order; an empty band takes from every point).
    const want=Math.min(startPoints.length,START_CRATES_PER_PLAYER*Math.max(1,Math.min(START_PLAYERS_MAX,players)));
    const bands=startBands(startPoints),taken:StartPoint[]=[];
    while(taken.length<want){
      const band=bands[taken.length%bands.length].filter(c=>!taken.includes(c)),from=band.length?band:startPoints.filter(c=>!taken.includes(c));
      if(!taken.length){taken.push(rng.pick(from));continue;}
      let best=from[0],bestD=-1;
      for(const c of from){let d=Infinity;for(const t of taken)d=Math.min(d,Math.hypot(t.x-c.x,t.y-c.y));if(d>bestD){best=c;bestD=d;}}
      taken.push(best);
    }
    taken.forEach((at,i)=>{addCrate(ctx,{x:at.x,y:at.y},{rarity:i%2?2:1,origin:'dropped',start:true});});
  }

  /** The first minute: who passed which crate, and a trail crate ahead of a hero behind the pace. */
  function trailStep(ctx:SimContext,rng:Rng){
    if(state.startTick===undefined)return;
    const elapsed=ctx.tick-state.startTick;
    if(elapsed>=ticks(FIRST_MINUTE_S)){if(state.trail)delete state.trail;return;}
    const trail=state.trail??={},heroes=[...ctx.players.values()].filter(onMap);
    const due=1+Math.floor(elapsed/ticks(FIRST_MINUTE_S/(FIRST_MINUTE_CRATES+2)));
    for(const p of heroes){
      const t=trail[p.id]??={passed:[],placed:0,hx:0,hy:0},last=state.seen[p.id];
      if(last){t.hx=t.hx*HEADING_KEEP+(p.x-last.x)*(1-HEADING_KEEP);t.hy=t.hy*HEADING_KEEP+(p.y-last.y)*(1-HEADING_KEEP);}
      for(const id in state.crates){
        const c=ctx.pickups.get(id);
        if(c&&!t.passed.includes(id)&&Math.hypot(c.x-p.x,c.y-p.y)<=PASS_DIST)t.passed.push(id);
      }
      const waiting=t.waiting&&ctx.pickups.get(t.waiting);
      const speed=Math.hypot(t.hx,t.hy);
      // Missed: opened by someone, passed, left TRAIL_MISS u away or behind him (he turned).
      if(t.waiting&&(!waiting||t.passed.includes(t.waiting)||Math.hypot(waiting.x-p.x,waiting.y-p.y)>TRAIL_MISS
        ||(speed>1e-3&&(waiting.x-p.x)*t.hx+(waiting.y-p.y)*t.hy<0)))delete t.waiting;
      if(t.waiting||!options.trailSpot||t.placed>=TRAIL_MAX||t.passed.length>=Math.min(due,FIRST_MINUTE_CRATES)||speed<1e-3||!canOpen(p))continue;
      const heading={x:t.hx/speed,y:t.hy/speed},ahead=TRAIL_AHEAD[0]+rng.next()*(TRAIL_AHEAD[1]-TRAIL_AHEAD[0]);
      const at=options.trailSpot(p,heading,ahead,rng);
      if(!at||heroes.some(o=>o!==p&&Math.hypot(o.x-at.x,o.y-at.y)<TRAIL_AHEAD[0]))continue;
      t.waiting=addCrate(ctx,at,{rarity:t.placed++%2?2:1,origin:'dropped',start:true}).id;
    }
    for(const id in trail)if(!ctx.players.has(id))delete trail[id];
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
      if(placedCount()>=(state.cap??MAX_CRATES)){state.respawns.shift();continue;}
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
    // Never the opener's last prize again: the same stream draws again (up to PRIZE_REDRAWS times), then the other kind.
    const stream=new Rng(seed).fork(`premio:${crate.id}:${ctx.tick}`),draw=()=>record.start?rollStarter(stream,record.rarity):rollCrate(stream,record.rarity);
    const last=(state.last??={})[p.id];
    let prize=draw();
    for(let i=0;i<PRIZE_REDRAWS&&prizeKey(prize)===last;i++)prize=draw();
    if(prizeKey(prize)===last)prize=otherPrize(stream,record.rarity,!!record.start,last);
    state.last[p.id]=prizeKey(prize);
    for(const item of prize.items)if(!add(p,item))dropItem(ctx,crate,item);
    ctx.emit({type:'pickup',player:p.id,pickup:crate.id,kind:'chest',value:record.rarity});
  }

  function openStep(ctx:SimContext){
    const done:{p:SimPlayer;crate:PickupState;d:number}[]=[];
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
      done.push({p,crate,d:Math.hypot(crate.x-p.x,crate.y-p.y)});
      delete state.opening[p.id];
    }
    // Two heroes done with the same crate in one tick (the 3× crate fits a crowd): the nearest one opens it, ties by id.
    done.sort((a,b)=>a.d-b.d||(a.p.id<b.p.id?-1:a.p.id>b.p.id?1:0));
    for(const {p,crate} of done)if(state.crates[crate.id])open(ctx,p,crate);
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
      trailStep(ctx,rng);
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
