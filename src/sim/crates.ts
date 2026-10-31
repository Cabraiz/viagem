/**
 * D-051 crates (NEW-20261014-ORQ-armas-caixas-inventario, plans/armas-caixas-inventario-proposta.md §2), manual combat
 * only (assemble wires it then). A crate IS a 'chest' pickup whose `value` is its rarity (1 verde .. 5 lendária):
 *  - placed: at the first step up to crateCap(players) crates on distinct map points (the city's `loot` points), the cap
 *    kept for the run, spread (spreadPick: each one on a point among the farthest from the crates already placed; the
 *    user, 23/10: "bem mais caixas pelo mapa e mais espalhadas, estão muito aglomeradas"). The rarity grows with the
 *    walk time from the plaza: the points are split in thirds by `seconds` (near / mid / far) and each third rolls its
 *    pair (TIER_ODDS), the crate's base. It also grows along the match: a placed crate shows its base shifted by the
 *    round's stage (stageShift: -1 in the first rounds .. +2 in the last, clamped verde..lendária), so an unopened
 *    crate turns better as the rounds go by ("from comum to lendária as the match goes"). An opened placed crate comes
 *    back RESPAWN_SECONDS later on a free point at least RESPAWN_MIN_DIST from every player, spread the same way
 *    (retried on later ticks while none qualifies);
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
 *  - the prize is rolled when the crate appears (card caixa-icone-torre-arma, the user 23/10: "vamos pôr o item
 *    flutuando e girando"): its item id is the record's `item` and the pickup's `resource`, which the client shows
 *    spinning over the spot; opening gives that item, a weapon at the crate's rarity of that moment. It avoids repeating
 *    (the user, 22/10: "sem repetir a mesma arma em sequência"): a trail crate its hero's last prize, any other the last
 *    item that appeared; the same per-crate stream draws again, up to PRIZE_REDRAWS times, then the other kind (otherPrize);
 *  - the prize (rollCrate: a kit de torre of the crate's tier with KIT_CHANCE, else a weapon of its rarity, rollPrize) rolls on a per-crate stream (seed, crate id, tick), so no other draw shifts it; items go into
 *    the inventory (add) and what does not fit lands on the ground beside the crate (dropItem). A crate gives only a
 *    weapon or a kit (BUG-20261022-ORQ-bau-so-arma-ou-torre, the user: "os baús não deveriam dropar algo sem ser arma
 *    ou torre"): coxinha, doces and the ímã come from the critters (progression dropLoot), Grana from kills and banks;
 *  - the gamble (NEW-20261023-ORQ-caixa-gamble-raridade, the user 24/10): a WEAPON crate that shows verde, azul or roxa
 *    (GOLD_HIDDEN_FROM) gives its weapon DOURADA with GOLD_HIDDEN_CHANCE (rarityAtOpen, a per-crate stream): the map keeps
 *    the crate's colour, the surprise comes on opening (the pickup event's value is 4). Kits never turn;
 *  - per player (same card): who opened a weapon crate that SHOWED a colour in HIDE_AFTER_TAKEN (verde, azul) no longer
 *    sees nor opens weapon crates of that colour (state.took; the pickup's server-only `hiddenFor`, which the encoder
 *    and the bots skip); the others still do. Kit crates (the towers) stay for everyone; a trail crate for such a hero
 *    comes at the next colour up;
 *  - one of each (BUG-20261025-ORQ-caixa-sem-item-repetido, the user 25/10: "eu não deveria ver uma panela azul se peguei
 *    panela verde, e nem ao contrário"): a crate's item is drawn among those no player on the map holds in any rarity
 *    (inventory owns/itemKey; a kit is its tower), the same stream redrawing, then any free item of its rarity, then of
 *    the nearest other rarities (prizePools), so a crate never jams; a live crate whose item somebody just got draws
 *    another one (restock). Only when every item is held by someone (several players) does a crate keep a held item,
 *    and then its holders neither see nor open it (hiddenTo, the same hiddenFor). Items on the ground: inventory.ts.
 *  - the floor (NEW-20261025-ORQ-uno-caminho-caixas-vender, the user 25/10: "rodei pelo mapa e só achei 3 caixas"; with
 *    the hiding above a player who had opened 4-6 crates saw 9-24 of the 50-60 alive): every VISIBLE_FLOOR_S a player on
 *    the map who sees fewer than VISIBLE_FLOOR crates gets the ones he lacks, on a free map point at least
 *    RESPAWN_MIN_DIST from every player (spreadPick), its colour bumped past the ones he took (a dropped crate: it never
 *    respawns nor counts to the cap), while the map holds fewer than FLOOR_LIVE_MAX crates;
 *  - the trail also runs in every exploration interval (round phase 'prepare', after the first minute): one crate passed
 *    every EXPLORE_PACE_S of the interval, counted afresh in each one.
 *  - comeca-armado-e-levanta-seguro (auditoria-jogabilidade-28-10 item 2; the heroes still start empty-handed, the user
 *    25/10): at the first step each hero gets one verde start crate NEAR_START_REACH u from where he spawned (open
 *    ground he reaches, NEAR_START_SPACING from the other near crates), and is untouchable (invulnerableUntil) until he
 *    opens his first crate or START_GRACE_S pass, whichever comes first (state.grace);
 *  - item 5: every crate (placed, start, near, trail, floor, respawn) sits where a hero walking from the spawn can stand
 *    within OPEN_REACH of it (heroReach: a flood fill of the hero's walkable cells from where the heroes stood at the
 *    first step; outside the city every point counts).
 * All the bookkeeping is the JSON-safe CratesState (a room checkpoint resumes the same placements and rolls).
 */
import type {OwnedItem,PickupState,Point,SimPlayer} from '../contract/index.ts';
import {Rng,carGap,ticks} from '../contract/index.ts';
import {RADIUS,walkable,type CarPlace,type CityTerrain,type TerrainField} from '../maps/index.ts';
import {cityTerrainOf} from './city/grid.ts';
import {CRATE_BODY_RADIUS,CRATE_OPEN_RADIUS,START_GRACE_S,KIT_CHANCE,KIT_POOL,cartaoCashback,isKitId,kitId,kitItem,kitPiece} from '../rules/index.ts';
import type {SimContext} from './context.ts';
import {add,dropItem,hasInventory,isWeaponItem,itemKey,ownedKeys,owns} from './inventory.ts';
import {addGrana} from './wallet.ts';
import {ITEM_MIN_GAP,crateInMouth,crateSpot,gapFree,roomy} from './crates-gap.ts';
export {crateInMouth};
import {ARSENAL_WEAPONS,isRarity,legendaryId,type Rarity} from './weapons/arsenal.ts';
import {WEAPON_IDS} from './weapons/catalog.ts';

/** Placed crates alive at once (proposal: "para o mapa não virar supermercado"). Dropped crates do not count. */
export const MAX_CRATES=40;
/**
 * Placed crates of a run with this many players: CRATES_BASE + CRATES_PER_PLAYER a player, up to MAX_CRATES. Was
 * 1 + 3 (a solo 4, six 16; the 16/10 CI bench); the user, 23/10 ("bem mais caixas pelo mapa e mais espalhadas"), with
 * the city 1.75× shorter and its loot points doubled (asset v4, scripts/compactar-cidade.ts spreadLoot): a solo 16,
 * six 36.
 */
export const CRATES_BASE=12,CRATES_PER_PLAYER=4;
export const crateCap=(players:number)=>Math.min(MAX_CRATES,CRATES_BASE+CRATES_PER_PLAYER*Math.max(1,players));
/**
 * spreadPick: a placed crate goes to a free point whose distance to the nearest live placed crate is at least this share
 * of the best such distance (the stream picks among them), so the crates cover the map instead of clumping.
 */
export const SPREAD_SLACK=.85;
/**
 * The point (index into `points`) of the next placed crate among `free`: the first one at random, then one of those
 * farthest from the live placed crates (within SPREAD_SLACK of the farthest). Pure: same stream, same pick.
 */
export function spreadPick(rng:Rng,points:readonly Point[],free:readonly number[],live:readonly Point[]):number{
  if(!live.length)return rng.pick(free);
  const far=free.map(i=>{let d=Infinity;for(const q of live)d=Math.min(d,Math.hypot(points[i].x-q.x,points[i].y-q.y));return d;});
  const best=Math.max(...far);
  return rng.pick(free.filter((_,k)=>far[k]>=best*SPREAD_SLACK));
}
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
/** Item 2: the near start crate sits at most NEAR_START_REACH u from its hero (tried at NEAR_START_RADII, NEAR_START_ANGLES around). */
/** placeNear's passes: [room for the crate's body, a mouth's strip allowed]. */
const NEAR_PASSES:readonly (readonly [boolean,boolean])[]=[[true,false],[false,false],[true,true],[false,true]];
export const NEAR_START_REACH=3,NEAR_START_RADII:readonly number[]=[2.5,2.25,2.75,2,3],NEAR_START_ANGLES=32;
/** Near crates keep ITEM_MIN_GAP apart (itens-sem-nascer-colados); a hero boxed in gets his NEAR_START_WIDE out to NEAR_START_WIDE_REACH u. */
export const NEAR_START_SPACING=ITEM_MIN_GAP,NEAR_START_WIDE:readonly number[]=[3.5,4,4.5,5,5.5,6,6.5,7,7.5,8],NEAR_START_WIDE_REACH=8;
export {START_GRACE_S};
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
/** The gamble: a weapon crate showing one of these colours gives the weapon DOURADA (4) with this chance. */
export const GOLD_HIDDEN_CHANCE=.05,GOLD_HIDDEN_FROM:readonly Rarity[]=[1,2,3],GOLD_RARITY:Rarity=4;
/** Colours of weapon crates a player stops seeing after opening one that showed that colour (the user 24/10: verde and azul). */
export const HIDE_AFTER_TAKEN:readonly Rarity[]=[1,2];
/** The floor (see the header): crates each player sees on the map at least, checked this often (s), up to this many alive. */
export const VISIBLE_FLOOR=16,VISIBLE_FLOOR_S=1,FLOOR_LIVE_MAX=60;
/** The exploration intervals' trail: one crate passed every this many seconds of the interval (the ORQ, 25/10). */
export const EXPLORE_PACE_S=20;
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
  /** The item it gives and shows (the pickup's resource); absent in an older checkpoint: rolled when opened. */
  item?:string;
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
  /** The tick the current exploration interval's trail started (absent outside one). */
  exploreTick?:number;
  /** Per player: the crate being opened and the standing ticks so far. */
  opening:Record<string,{crate:string;ticks:number}>;
  /** Per player: position and hp seen at the last step (moved / hurt since). */
  seen:Record<string,{x:number;y:number;hp:number}>;
  /** The placement and adoption stream (prizes have their own per-crate stream). */
  rng:number;
  /** Per player: the key (prizeKey) of his last crate prize; absent in an older checkpoint. */
  last?:Record<string,string>;
  /** The item of the last crate that appeared (the next one avoids it). */
  lastItem?:string;
  /** The first step's tick (the first minute's clock); absent in an older checkpoint: no trail. */
  startTick?:number;
  /** Per player, the first minute: crates passed (ids), his waiting trail crate, how many he got, his walk heading. */
  trail?:Record<string,{passed:string[];waiting?:string;placed:number;hx:number;hy:number}>;
  /** Per player: the colours (HIDE_AFTER_TAKEN) of weapon crates he opened, as shown; absent in an older checkpoint. */
  took?:Record<string,Rarity[]>;
  /** Per player: the tick his start grace (START_GRACE_S) ends, while it runs; absent in an older checkpoint. */
  grace?:Record<string,number>;
}
export const createCratesState=(seed:number):CratesState=>({placed:false,crates:{},respawns:[],opening:{},seen:{},rng:new Rng(seed).fork('caixas').state});

export interface CratesOptions {
  /** Room seed: placements, adoptions and prizes all derive from it. */
  seed:number;
  /** The floor (see the header): crates each player sees at least; absent or 0: none (assemble passes VISIBLE_FLOOR). */
  visibleFloor?:number;
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
  /** The chaveiro's car (uno-bloqueio-corpo): a near start crate never sits on its body. Absent: no car. */
  car?():CarPlace|undefined;
  /** A checkpoint to resume from. */
  state?:CratesState;
  /** The gamble's knobs (tests): GOLD_HIDDEN_CHANCE and HIDE_AFTER_TAKEN by default. */
  goldChance?:number;
  hideAfterTaken?:readonly Rarity[];
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
/**
 * Every item a crate may fall back to (caixa-sem-item-repetido), pool by pool: its own (a first-minute crate's the
 * starter weapons and the verde kits), then the other rarities' weapons and kits, nearest first (ties: the higher);
 * the legendaries only in a lendária's own pool.
 */
export function prizePools(rarity:Rarity,start:boolean):string[][]{
  const pool=(r:Rarity)=>[...CRATE_WEAPONS[r],...KIT_POOL[r].map(kitId)];
  const own=start?[...STARTER_WEAPONS,...KIT_POOL[1].map(kitId)]:pool(rarity);
  const others=([1,2,3,4,5] as Rarity[]).filter(r=>start||r!==rarity).sort((a,b)=>Math.abs(a-rarity)-Math.abs(b-rarity)||b-a);
  return [own,...others.map(r=>r===5?KIT_POOL[5].map(kitId):pool(r))];
}
/**
 * A crate's prize item (rollCrate, or rollStarter for a first-minute crate) on `stream`, other than `avoid` and than
 * the items in `held` (itemKey): up to PRIZE_REDRAWS redraws, then the other kind (otherPrize), then the first of
 * prizePools with a free item. Every item held: the last draw (its holders do not see the crate).
 */
export function drawPrize(stream:Rng,rarity:Rarity,start:boolean,avoid?:string,held?:ReadonlySet<string>):Prize{
  const draw=()=>start?rollStarter(stream,rarity):rollCrate(stream,rarity);
  const taken=(id:string)=>!!held?.has(itemKey(id)),bad=(prize:Prize)=>prizeKey(prize)===avoid||taken(prizeKey(prize));
  let prize=draw();
  for(let i=0;i<PRIZE_REDRAWS&&bad(prize);i++)prize=draw();
  if(!bad(prize))return prize;
  if(avoid!==undefined){
    const other=otherPrize(stream,rarity,start,avoid);
    if(!taken(prizeKey(other)))return other;
  }
  const pools=prizePools(rarity,start);
  for(const keep of [(id:string)=>id!==avoid&&!taken(id),(id:string)=>!taken(id)])for(const pool of pools){
    const free=pool.filter(keep);
    if(free.length)return {items:[prizeItem(stream.pick(free),rarity)]};
  }
  return prize;
}
/** The item a crate shows, given at `rarity` (the crate's when opened): a kit as it comes, a weapon at that rarity. */
export function prizeItem(id:string,rarity:Rarity):OwnedItem{
  const kit=kitPiece(id);
  return kit?kitItem(kit):weaponItem(id,rarity);
}

/** A crate whose item is a weapon (not a kit de torre); an older checkpoint's crate without item counts as none. */
const weaponCrate=(record:CrateRecord)=>record.item!==undefined&&!kitPiece(record.item);
/** Whether the player `took` (CratesState.took) no longer sees this crate. */
export const hiddenFor=(took:readonly Rarity[]|undefined,record:CrateRecord)=>!!took?.includes(record.rarity)&&weaponCrate(record);

/**
 * Item 5: whether a hero walking from `from` can stand within OPEN_REACH of a point. The city: a flood fill of the hero's
 * walkable cells (asset cells, the hero rule walkable() at each centre, 8 neighbours, a diagonal only past two open
 * sides) from the cells under `from`; a point counts when a reached cell centre lies within OPEN_REACH - RADIUS of it.
 * Undefined outside the city or with no seed cell open (no filter: every point counts).
 */
export function heroReach(terrain:TerrainField|undefined,from:readonly Point[]):((p:Point)=>boolean)|undefined{
  const city=cityTerrainOf(terrain);
  if(!city)return undefined;
  const w=city.asset.cells.w,h=city.asset.cells.h,cs=city.asset.unitsPerCell,probe={x:0,y:0};
  // 0 unknown, 1 blocked, 2 open, 3 reached.
  const cell=new Uint8Array(w*h),queue:number[]=[];
  const open=(cx:number,cy:number)=>{
    if(cx<0||cy<0||cx>=w||cy>=h)return false;
    const i=cx+cy*w;
    if(!cell[i]){probe.x=(cx+.5)*cs;probe.y=(cy+.5)*cs;cell[i]=walkable(probe,city)?2:1;}
    return cell[i]>=2;
  };
  for(const p of from){
    const cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs);
    // The hero's own cell, else the nearest open one around it (a hero standing on a cell edge).
    let best:number|undefined,bestD=Infinity;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(open(cx+dx,cy+dy)){
      const d=Math.hypot((cx+dx+.5)*cs-p.x,(cy+dy+.5)*cs-p.y);
      if(d<bestD){bestD=d;best=cx+dx+(cy+dy)*w;}
    }
    if(best!==undefined&&cell[best]!==3){cell[best]=3;queue.push(best);}
  }
  if(!queue.length)return undefined;
  for(let q=0;q<queue.length;q++){
    const i=queue[q],cx=i%w,cy=(i-cx)/w;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy||!open(cx+dx,cy+dy))continue;
      if(dx&&dy&&!(open(cx+dx,cy)&&open(cx,cy+dy)))continue;
      const j=cx+dx+(cy+dy)*w;
      if(cell[j]===3)continue;
      cell[j]=3;queue.push(j);
    }
  }
  const reach=OPEN_REACH-RADIUS,span=Math.ceil(reach/cs);
  return (p:Point)=>{
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return false;
    const cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs);
    for(let dy=-span;dy<=span;dy++)for(let dx=-span;dx<=span;dx++){
      const x=cx+dx,y=cy+dy;
      if(x<0||y<0||x>=w||y>=h||cell[x+y*w]!==3)continue;
      if(Math.hypot((x+.5)*cs-p.x,(y+.5)*cs-p.y)<=reach)return true;
    }
    return false;
  };
}

/**
 * Crates off the street mouths (NEW-20261030-ORQ-bocas-sem-loot-e-caixas; auditoria-bocas 30/10: 75 of the 104 loot
 * points touch an entrance's free strip, maps/city/entradas.ts bocaFaixa, so 11-15 of a run's 18 crates stood in one).
 * A crate body (CRATE_BODY_RADIUS) overlapping a strip moves to the nearest clear spot outside every strip: rings
 * MOUTH_STEP u apart out to MOUTH_REACH u, MOUTH_ANGLES each, MOUTH_SPACING u from the other spots when it can. The spot keeps its
 * index (the cap needs every point: the 29 outside are fewer than six players' 36); none found, it stays.
 */
export const MOUTH_REACH=24,MOUTH_STEP=.5,MOUTH_ANGLES=48,MOUTH_SPACING=4;
/** The points with every crate in a mouth's strip moved out of it (see MOUTH_REACH); the others as they were. */
export function foraDasBocas<T extends Point>(city:CityTerrain,points:readonly T[],spacing=MOUTH_SPACING):T[]{
  const out=points.map(p=>({...p})),taken=out.filter(p=>!crateInMouth(city,p.x,p.y));
  for(const p of out){
    if(!crateInMouth(city,p.x,p.y))continue;
    // The nearest spot MOUTH_SPACING from the others, else the nearest at all (a crowded corner: crates may stand close).
    let near:Point|undefined;
    search:for(let n=1;n*MOUTH_STEP<=MOUTH_REACH;n++)for(let k=0;k<MOUTH_ANGLES;k++){
      const r=n*MOUTH_STEP,a=k*2*Math.PI/MOUTH_ANGLES;
      const x=Math.round((p.x+Math.cos(a)*r)*100)/100,y=Math.round((p.y+Math.sin(a)*r)*100)/100;
      if(crateInMouth(city,x,y)||!city.clearDisc(x,y,CRATE_BODY_RADIUS))continue;
      near??={x,y};
      if(taken.some(q=>Math.hypot(q.x-x,q.y-y)<spacing))continue;
      near={x,y};break search;
    }
    if(near){p.x=near.x;p.y=near.y;taken.push(p);}
  }
  return out;
}

export function createCrates(options:CratesOptions):Crates{
  const {seed,hooks={},goldChance=GOLD_HIDDEN_CHANCE,hideAfterTaken=HIDE_AFTER_TAKEN}=options;
  const state=options.state??createCratesState(seed);
  // The city's spots off the street mouths (foraDasBocas), moved once the terrain is known (the first step).
  let points=options.points,startPoints=options.startPoints??[],offMouths=false;
  function moveOffMouths(ctx:SimContext){
    if(offMouths)return;
    offMouths=true;
    const city=cityTerrainOf(ctx.terrain);
    if(city){points=foraDasBocas(city,points);startPoints=foraDasBocas(city,startPoints,0);}
  }
  // Distance tier of each point: thirds of the points sorted by walk time (ties: map order), 0 near .. 2 far.
  const tierOf:number[]=new Array(points.length).fill(0);
  points.map((p,i)=>({s:p.seconds,i})).sort((a,b)=>a.s-b.s||a.i-b.i).forEach(({i},rank)=>{tierOf[i]=Math.min(2,Math.floor(rank*3/points.length));});
  const scratch:string[]=[];
  /**
   * Item 5 (heroReach), built once from where the heroes stand at the first step that needs it (the ground floor; after
   * a checkpoint, where they stand then), and each map point's answer.
   */
  let reach:((p:Point)=>boolean)|undefined,reachBuilt=false;
  const pointOk:(boolean|undefined)[]=[];
  function reachable(ctx:SimContext,p:Point){
    if(!reachBuilt){reachBuilt=true;reach=heroReach(ctx.terrain,[...ctx.players.values()].filter(q=>onMap(q)&&q.andar!==1));}
    return !reach||reach(p);
  }
  const pointReachable=(ctx:SimContext,i:number)=>pointOk[i]??=reachable(ctx,points[i]);

  /** The items (itemKey) somebody on the map holds: no crate shows one (caixa-sem-item-repetido). */
  function heldKeys(ctx:SimContext){
    const held=new Set<string>();
    for(const p of ctx.players.values())if(onMap(p)&&hasInventory(p))ownedKeys(p,held);
    return held;
  }
  /** Whether this player no longer sees (nor opens) this crate: a colour he took, or an item he already holds. */
  const hiddenTo=(p:SimPlayer,record:CrateRecord)=>hiddenFor(state.took?.[p.id],record)||record.item!==undefined&&owns(p,record.item);
  /**
   * Rolls the item a new crate gives and shows (on its own stream: no other draw shifts it), other than `avoid` and
   * than what anybody holds.
   */
  function stock(ctx:SimContext,pickup:PickupState,record:CrateRecord,avoid=state.lastItem){
    const item=prizeKey(drawPrize(new Rng(seed).fork(`premio:${pickup.id}`),record.rarity,!!record.start,avoid,heldKeys(ctx)));
    record.item=item;pickup.resource=item;state.lastItem=item;
  }
  /** A live crate showing an item somebody now holds shows another one (its own stream), when one is free. */
  function restock(ctx:SimContext){
    let held:Set<string>|undefined;
    for(const id in state.crates){
      const record=state.crates[id],pickup=ctx.pickups.get(id);
      if(!pickup||record.item===undefined)continue;
      held??=heldKeys(ctx);
      if(!held.size)return;
      if(!held.has(itemKey(record.item)))continue;
      const item=prizeKey(drawPrize(new Rng(seed).fork(`premio:${id}:troca:${record.item}`),record.rarity,!!record.start,record.item,held));
      if(held.has(itemKey(item)))continue;
      record.item=item;pickup.resource=item;
    }
  }
  /** A crate's spot ITEM_MIN_GAP from every ground item, reached on foot (crates-gap.ts crateSpot). */
  const settle=(ctx:SimContext,at:Point,except?:string)=>crateSpot(ctx,at,p=>reachable(ctx,p),except);
  function addCrate(ctx:SimContext,to:Point,record:CrateRecord,avoid?:string):PickupState{
    const at=settle(ctx,to),pickup:PickupState={id:ctx.nextId(CRATE_ID_PREFIX),kind:'chest',value:record.rarity,x:at.x,y:at.y,spawnTick:ctx.tick};
    stock(ctx,pickup,record,avoid??state.lastItem);
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

  /** Where the live placed crates stand. */
  const livePlaced=(ctx:SimContext)=>{const out:Point[]=[];for(const id in state.crates){const c=ctx.pickups.get(id);if(c&&state.crates[id].origin==='placed')out.push(c);}return out;};
  /** Initial placement: the cap, one by one, spread over the points (spreadPick). */
  function placeInitial(ctx:SimContext,rng:Rng){
    state.placed=true;state.startTick=ctx.tick;
    let players=0;for(const p of ctx.players.values())if(!p.spectator)players++;
    const cap=state.cap=crateCap(players);
    const free=points.map((_,i)=>i).filter(i=>pointReachable(ctx,i)),live:Point[]=[];
    for(let n=0;n<cap&&free.length;n++){
      const point=spreadPick(rng,points,roomy(ctx.pickups,free,i=>points[i]),live);
      free.splice(free.indexOf(point),1);live.push(points[point]);
      place(ctx,rng,point);
    }
    // With start crates only (startPoints: the city's run, never a bare test or the old island).
    const near=startPoints.length?placeNear(ctx,rng):0;
    // Start crates: the k-th of each player's set in the k-th walk band (startBands), the first one random, each next
    // the candidate of its band farthest from those taken (ties: list order; an empty band takes from every point).
    // (the near crates count to each player's set).
    const starts=startPoints.filter(p=>reachable(ctx,p));
    const want=Math.min(starts.length,START_CRATES_PER_PLAYER*Math.max(1,Math.min(START_PLAYERS_MAX,players))-near);
    const bands=startBands(starts),taken:StartPoint[]=[];
    while(taken.length<want){
      const band=bands[taken.length%bands.length].filter(c=>!taken.includes(c)),from=roomy(ctx.pickups,band.length?band:starts.filter(c=>!taken.includes(c)),c=>c);
      if(!taken.length){taken.push(rng.pick(from));continue;}
      let best=from[0],bestD=-1;
      for(const c of from){let d=Infinity;for(const t of taken)d=Math.min(d,Math.hypot(t.x-c.x,t.y-c.y));if(d>bestD){best=c;bestD=d;}}
      taken.push(best);
    }
    // Verde and azul alternate; next to the near (verde) crates they are all azul (each player: one of each).
    taken.forEach((at,i)=>{addCrate(ctx,{x:at.x,y:at.y},{rarity:near||i%2?2:1,origin:'dropped',start:true});});
  }

  /**
   * Item 2: a verde start crate NEAR_START_REACH u from each hero (START_PLAYERS_MAX at most): open ground for its body
   * (else for a hero, the second pass), off the street mouths (crateInMouth) unless the hero spawned with none free
   * within reach (the last passes), reached on foot, NEAR_START_SPACING from the other near crates and never on a
   * hero nor on the Uno's body (the heroes spawn beside it, six of them in a tight block); and every hero's start grace.
   * Heroes in list order, else in another (a rotation, either way) when that leaves one without: the block's last ones
   * get boxed in by the others' crates. Returns how many crates it placed. Outside the city any spot counts.
   */
  function placeNear(ctx:SimContext,rng:Rng){
    const heroes=[...ctx.players.values()].filter(onMap),city=cityTerrainOf(ctx.terrain),car=options.car?.();
    const end=ctx.tick+ticks(START_GRACE_S),grace=state.grace??={};
    for(const p of heroes){grace[p.id]=end;p.invulnerableUntil=Math.max(p.invulnerableUntil??0,end);}
    // Outside the city (no mask) any spot counts, like heroReach.
    const fits=(at:Point,body:boolean,mouth:boolean,near:readonly Point[])=>(!city||(city.clearDisc(at.x,at.y,body?CRATE_BODY_RADIUS:RADIUS)&&(mouth||!crateInMouth(city,at.x,at.y))))
      &&(!car||carGap(car,at)>=(body?CRATE_BODY_RADIUS:RADIUS))
      &&reachable(ctx,at)&&gapFree(ctx.pickups,at)&&near.every(c=>Math.hypot(c.x-at.x,c.y-at.y)>=NEAR_START_SPACING)
      &&heroes.every(o=>Math.hypot(o.x-at.x,o.y-at.y)>=CRATE_BODY_RADIUS+RADIUS);
    const owners=heroes.slice(0,START_PLAYERS_MAX),a0=owners.map(()=>rng.next()*2*Math.PI);
    const plan=(order:readonly number[])=>{
      const near:Point[]=[];
      for(const i of order){
        const p=owners[i];
        search:for(const [radii,reach] of [[NEAR_START_RADII,NEAR_START_REACH],[NEAR_START_WIDE,NEAR_START_WIDE_REACH]] as const)
          for(const [body,mouth] of NEAR_PASSES)for(const r of radii)for(let k=0;k<NEAR_START_ANGLES;k++){
          const a=a0[i]+k*2*Math.PI/NEAR_START_ANGLES;
          const c={x:Math.round((p.x+Math.cos(a)*r)*100)/100,y:Math.round((p.y+Math.sin(a)*r)*100)/100};
          if(Math.hypot(c.x-p.x,c.y-p.y)<=reach&&fits(c,body,mouth,near)){near.push(c);break search;}
        }
      }
      return near;
    };
    // The list order, then each rotation of it both ways, until every owner has his (else the plan that placed most).
    const n=owners.length;
    let near:Point[]=[];
    for(let k=0;k<2*n&&near.length<n;k++){
      const order=owners.map((_,i)=>k<n?(i+k)%n:(2*n-1-k+n-i)%n);
      const next=plan(order);
      if(next.length>near.length)near=next;
    }
    for(const at of near)addCrate(ctx,at,{rarity:1,origin:'dropped',start:true});
    return near.length;
  }
  /** Item 2: the start grace ends for good when it runs out or its hero leaves. */
  function graceStep(ctx:SimContext){
    if(!state.grace)return;
    for(const id in state.grace)if(ctx.tick>=state.grace[id]||!ctx.players.has(id))delete state.grace[id];
    if(!Object.keys(state.grace).length)delete state.grace;
  }

  /** The first minute: who passed which crate, and a trail crate ahead of a hero behind the pace. */
  function trailStep(ctx:SimContext,rng:Rng){
    if(state.startTick===undefined)return;
    const first=ctx.tick-state.startTick<ticks(FIRST_MINUTE_S),explore=!first&&ctx.round.phase==='prepare';
    if(!explore&&state.exploreTick!==undefined){delete state.exploreTick;delete state.trail;}
    if(!first&&!explore){if(state.trail)delete state.trail;return;}
    // A new exploration interval: its own count (the first minute's trail is over).
    if(explore&&state.exploreTick===undefined){state.exploreTick=ctx.tick;delete state.trail;}
    const elapsed=ctx.tick-(first?state.startTick:state.exploreTick!);
    const trail=state.trail??={},heroes=[...ctx.players.values()].filter(onMap);
    const due=first?Math.min(FIRST_MINUTE_CRATES,1+Math.floor(elapsed/ticks(FIRST_MINUTE_S/(FIRST_MINUTE_CRATES+2)))):1+Math.floor(elapsed/ticks(EXPLORE_PACE_S));
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
      if(t.waiting||!options.trailSpot||t.placed>=TRAIL_MAX||t.passed.length>=due||speed<1e-3||!canOpen(p))continue;
      const heading={x:t.hx/speed,y:t.hy/speed},ahead=TRAIL_AHEAD[0]+rng.next()*(TRAIL_AHEAD[1]-TRAIL_AHEAD[0]);
      const spot=options.trailSpot(p,heading,ahead,rng),city=cityTerrainOf(ctx.terrain);
      const at=spot&&city&&crateInMouth(city,spot.x,spot.y)?foraDasBocas(city,[spot])[0]:spot;
      if(!at||(city&&crateInMouth(city,at.x,at.y))||!reachable(ctx,at)||heroes.some(o=>o!==p&&Math.hypot(o.x-at.x,o.y-at.y)<TRAIL_AHEAD[0]))continue;
      let rarity:Rarity=t.placed++%2?2:1;
      while(rarity<GOLD_RARITY&&state.took?.[p.id]?.includes(rarity))rarity=rarity+1 as Rarity;
      t.waiting=addCrate(ctx,at,{rarity,origin:'dropped',start:true},state.last?.[p.id]).id;
    }
    for(const id in trail)if(!ctx.players.has(id))delete trail[id];
  }

  /** The floor (see the header): one more crate for each player who sees fewer than VISIBLE_FLOOR. */
  function floorStep(ctx:SimContext,rng:Rng){
    const floor=options.visibleFloor??0;
    if(!floor||state.startTick===undefined||(ctx.tick-state.startTick)%ticks(VISIBLE_FLOOR_S)!==0)return;
    const players=[...ctx.players.values()].filter(onMap);
    for(const p of players)for(;;){
      let live=0,seen=0;
      for(const id in state.crates)if(ctx.pickups.has(id)){live++;if(!hiddenTo(p,state.crates[id]))seen++;}
      if(live>=FLOOR_LIVE_MAX)return;
      if(seen>=floor)break;
      const used=usedPoints();
      const free=points.map((_,i)=>i).filter(i=>!used.has(i)&&pointReachable(ctx,i)&&players.every(o=>Math.hypot(o.x-points[i].x,o.y-points[i].y)>=RESPAWN_MIN_DIST));
      if(!free.length)return;
      const point=spreadPick(rng,points,roomy(ctx.pickups,free,i=>points[i]),livePlaced(ctx));
      let rarity=shifted(roll(rng,TIER_ODDS[tierOf[point]]),stageShift(ctx.round));
      while(rarity<GOLD_RARITY&&state.took?.[p.id]?.includes(rarity))rarity=rarity+1 as Rarity;
      addCrate(ctx,points[point],{rarity,origin:'dropped',point});
    }
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

  /** Due respawns, oldest first: a free point far enough from every player, spread (spreadPick), else wait for a later tick. */
  function respawn(ctx:SimContext,rng:Rng){
    while(state.respawns.length&&state.respawns[0]<=ctx.tick){
      if(placedCount()>=(state.cap??MAX_CRATES)){state.respawns.shift();continue;}
      const used=usedPoints(),players=[...ctx.players.values()].filter(onMap);
      const free=points.map((_,i)=>i).filter(i=>!used.has(i)&&pointReachable(ctx,i)&&players.every(p=>Math.hypot(p.x-points[i].x,p.y-points[i].y)>=RESPAWN_MIN_DIST));
      if(!free.length)return;
      state.respawns.shift();
      place(ctx,rng,spreadPick(rng,points,roomy(ctx.pickups,free,i=>points[i]),livePlaced(ctx)));
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
      // A drop beside another item opens in a fan around the body (settle's rings).
      const at=settle(ctx,pickup,pickup.id);pickup.x=at.x;pickup.y=at.y;pickup.value=rarity;
      const record:CrateRecord=state.crates[pickup.id]={rarity,origin:'dropped'};
      stock(ctx,pickup,record);
    }
  }

  /** The nearest live crate within OPEN_REACH (ties: the first known). */
  function nearestCrate(ctx:SimContext,p:SimPlayer){
    let best:PickupState|undefined,bestD=Infinity;
    for(const id in state.crates){
      const c=ctx.pickups.get(id);
      if(!c||hiddenTo(p,state.crates[id]))continue;
      const d=Math.hypot(c.x-p.x,c.y-p.y);
      if(d<=OPEN_REACH&&d<bestD){best=c;bestD=d;}
    }
    return best;
  }

  /**
   * The rarity a crate gives when opened: the one it shows, except a weapon crate showing GOLD_HIDDEN_FROM, which turns
   * DOURADA with GOLD_HIDDEN_CHANCE on its own stream (seed, crate id): no other draw shifts it.
   */
  function rarityAtOpen(id:string,record:CrateRecord):Rarity{
    if(!GOLD_HIDDEN_FROM.includes(record.rarity)||!weaponCrate(record))return record.rarity;
    return new Rng(seed).fork(`dourada:${id}`).next()<goldChance?GOLD_RARITY:record.rarity;
  }

  /** Who opened a weapon crate of a HIDE_AFTER_TAKEN colour stops seeing that colour. */
  function remember(p:SimPlayer,record:CrateRecord){
    if(!hideAfterTaken.includes(record.rarity)||!weaponCrate(record))return;
    const took=(state.took??={})[p.id]??=[];
    if(!took.includes(record.rarity))took.push(record.rarity);
  }

  /** The pickups' server-only hiddenFor: the players who no longer see each crate (absent when nobody). */
  function hide(ctx:SimContext){
    for(const id in state.crates){
      const pickup=ctx.pickups.get(id);
      if(!pickup)continue;
      let who:string[]|undefined;
      for(const p of ctx.players.values())if(hiddenTo(p,state.crates[id]))(who??=[]).push(p.id);
      const had=pickup.hiddenFor;
      if(!who){if(had)delete pickup.hiddenFor;continue;}
      if(!had||had.length!==who.length||had.some((q,i)=>q!==who![i]))pickup.hiddenFor=who;
    }
  }

  function open(ctx:SimContext,p:SimPlayer,crate:PickupState){
    const record=state.crates[crate.id],rarity=rarityAtOpen(crate.id,record);
    remember(p,record);
    // Item 2: the first crate he opens ends his start grace (unless something else made him untouchable longer).
    const graceEnd=state.grace?.[p.id];
    if(graceEnd!==undefined){delete state.grace![p.id];if(p.invulnerableUntil===graceEnd)p.invulnerableUntil=ctx.tick;}
    ctx.pickups.delete(crate.id);
    delete state.crates[crate.id];
    if(record.origin==='placed')state.respawns.push(ctx.tick+ticks(RESPAWN_SECONDS));
    // The item it showed; a crate from an older checkpoint rolls now, never the opener's last prize.
    const last=(state.last??={})[p.id];
    let prize:Prize=record.item?{items:[prizeItem(record.item,rarity)]}
      :drawPrize(new Rng(seed).fork(`premio:${crate.id}:${ctx.tick}`),rarity,!!record.start,last,ownedKeys(p));
    // torre-limite-rebocar-sem-arma (ORQ 25/10): who opens a crate with no weapon (the heroes start empty-handed) always
    // gets a weapon: a kit turns into a weapon of the crate's rarity (the first minute's from STARTER_WEAPONS).
    if(!p.build.weapons.some(isWeaponItem)&&prize.items.every(i=>!isWeaponItem(i))){
      const rng=new Rng(seed).fork(`sem-arma:${crate.id}`);
      prize=record.start?{items:[weaponItem(rng.pick(STARTER_WEAPONS),rarity)]}:rollPrize(rng,rarity);
    }
    state.last[p.id]=prizeKey(prize);
    for(const item of prize.items)if(!add(p,item))dropItem(ctx,settle(ctx,crate),item);
    // The Cartão Fidelidade's cashback (rules/passives.ts CARTAO_CASHBACK): Grana into the opener's wallet.
    const cashback=cartaoCashback(p.build.passives.find(i=>i.id==='cartao')?.level??0);
    if(cashback)addGrana(p,cashback);
    ctx.emit({type:'pickup',player:p.id,pickup:crate.id,kind:'chest',value:rarity});
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
      const crate=current&&state.crates[current.id]&&!hiddenTo(p,state.crates[current.id])
        &&Math.hypot(current.x-p.x,current.y-p.y)<=OPEN_REACH?current:nearestCrate(ctx,p);
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
      moveOffMouths(ctx);
      if(!state.placed)placeInitial(ctx,rng);
      sync(ctx,rng);
      respawn(ctx,rng);
      restage(ctx);
      trailStep(ctx,rng);
      openStep(ctx);
      graceStep(ctx);
      restock(ctx);
      // After the opens and the restock: both hide crates at once (a colour taken; kit crates turned weapon when a bot
      // took the kit), and the floor counts what the player sees at the end of this tick, not a second late.
      floorStep(ctx,rng);
      hide(ctx);
      state.rng=rng.state;
    },
    dropCrate(ctx,at,rarity){return addCrate(ctx,{x:at.x,y:at.y},{rarity,origin:'dropped'});},
    opening(playerId){
      const doing=state.opening[playerId],record=doing&&state.crates[doing.crate];
      return record?{crate:doing.crate,progress:Math.min(1,doing.ticks/openTicks(record.rarity))}:undefined;
    },
  };
}
