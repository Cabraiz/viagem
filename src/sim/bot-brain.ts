/**
 * What a bot does each decision: the protocol bots of VGM-045 (scripts/bots, a real CoopClient each) and the room's own
 * bots of D-025 (room-bots.ts, inside the Durable Object, no socket). Pure: a RunView in, a stick direction and the taps out, so the
 * choices are unit-tested (tests/tools/bots.test.ts) and the bots stay a fair stand-in for a phone:
 * - combat: weapons fire on their own (the room decides), so the bot only walks: away from what is close, after
 *   pickups, toward the critters near the wall, back home when it strays, to a fallen friend within reach, and out of
 *   any telegraph; it taps the skill when something is close and it is ready;
 * - intermission (Stonewards): walks to a gather node (its own, spread by bot index), comes back on the horn (not in
 *   the city) or when the time left is the walk back; the team's forger (first standing bot) spends the balance at the camp:
 *   repair when the wall is hurt, else a chinelo tower, else a gambiarra;
 * - towers (torres-sim): when the caller passes `towers` (the sim-side TowerBrainView: towerBrainView), that bot
 *   spends on the tower defense first (pickTowerOrder: repair a hurt one, grow the count, push the Gustavão's line,
 *   evolve the rest from what is left), keeping only a needed wall repair ahead of it, and a person's defense is
 *   theirs. The sim takes an order only within BUILD_REACH of the obra (torres-ajustes), so the bot walks there first
 *   (mode 'build') and orders on arrival (with a person here: from `orderFrom`, their last seconds), but only on a trip
 *   there and back into the base that ends TOWER_MARGIN before the round; then it heads home like everyone. Saving for
 *   the Gustavão's line holds only that reserve from the forge; without `towers` (the protocol bots) nothing changes;
 * - money (D-048): roots and the Gustavão are paid in material (fichas de torre: CampView.units), evolutions, tower
 *   repairs and the forge in Grana: since NEW-20261014-ORQ-carteira-e-pix the bot's OWN wallet (CampView.grana is the
 *   viewer's; the room bots get theirs in the view). With the chaveiro objective the wallets also pay his bill at the
 *   end (the vaquinha), so no Grana is spent below granaReserve (each bot's part: CHAVEIRO_KEEP_SHARE = 1.3 × the bill
 *   ÷ the seated players; the CHAVEIRO_SAVE_ETA "whole bill near the end" branch is off at −1). The room bots that
 *   do not buy send what is above their part to the forger by PIX (room-bots.ts; never to a person);
 * - offers: picks the default card after a human-ish reaction (longer in combat, where the offer is a chip);
 * - fallen: asks for help ("Me salva") every few seconds.
 * In the city (cidade-10, terrain.world === 'cidade') the long walks (home, the crate, a fallen friend, the person
 * walked with) follow the streets (city/bot-routes.ts: a flow field per goal cell, small shared LRU) instead of a
 * straight line, the walk home is timed by the street distance and the crates are ranked by it. The plaza is a maze of
 * planters, so in combat the bot also: walks back all the way to HOME_SLACK inside its leash once pulled, is lured only
 * by critters and pickups in plain sight that it can answer from well inside the leash (ROAM_IN), circles only where that side is open, holds still
 * when its pulls cancel out (HOLD_BELOW), and a roamer hunts the wave's last few critters (HUNT_LEFT). Everywhere else
 * the bot is the same as before, byte for byte.
 * Chaveiro objective (D-047, the room bots: BrainInput.teamBots, view.objective): home is the car ('quadradao'); with
 * the moto dead ('morta') and at least PUSH_BOTS players standing, the PUSH_BOTS standing bots nearest to it walk over
 * and stand by it (the tranco; a bot alone keeps the car, the moto starts by itself; in the intermission only on a
 * trip that is back before the wave, PUSH_TRIP_SECONDS); with a
 * delivery DELIVERY_MARK_SECONDS ahead or less, the freest bot (nearest to it, not pushing, not the forger) fights
 * around the delivery point instead of the car. Without an objective (or without teamBots) nothing changes.
 * Bancos (card bancos-e-veiculos, view.banks: the city, both modes; the room bots, BrainInput.teamBots): in the
 * intermission, while the team's Grana is under bankTarget (the chaveiro's granaReserve, CHAVEIRO_KEEP_SHARE × his bill;
 * BANK_GRANA_TARGET in the wall mode), the bots with no objective task go to the nearest open ATM when it is within
 * BANK_REACH (straight) and the trip (there, BANK_MIN_NOTES notes, back home; along the streets in the city) ends
 * before the wave, unless the crate it would work (nodeFor, by its index in teamBots) is nearer than the ATM: the crate
 * first, the ATM on the way back; at most BANK_BOTS per ATM (the nearest ones, ties by id). With more than one bot standing,
 * the first one (by teamBots order: the room's forger and tower builder) stays on the forge and the towers. In the wave
 * (a full team): with BANK_WAVE_MIN_UP standing, one bot per BANK_WAVE_PER (one per ATM, within
 * BANK_WAVE_REACH) holds an ATM while the Grana is short. Mode 'bank'. Without banks nothing changes.
 * D-052, the car moves (objectiveTask 'carro'): while a person pushes or pulls it (view.objective.car.movers), the
 * CAR_HELP_BOTS standing bots nearest to it (within CAR_HELP_RANGE, none on another task) lean on it and push the same
 * way (carHeading: the people's pull). The bot never picks where the car goes; with nobody moving it, nobody helps
 * (the sim also counts a bot only along with a person). The other bots fight around the car as before.
 * Card puxar-uno-corda: the first helper takes the rope instead (task rope) when it is free, the car goes nose first
 * (the heading within CAR_ROPE_BOT_DOT of the nose) and the rope's end is nearer to it than its spot behind the car:
 * it walks to the end and on along the heading, the way a person takes it (the sim's gesture). The others push.
 * D-051 manual combat (BrainInput.combat 'manual'): the bot holds the attack (Decision.attack) whenever a critter is
 * within its equipped weapon's reach (attackReach) and never taps the skill; the room's auto aim picks the target. It
 * walks exactly as before. Without it (the automatic weapons) the decisions are the same as before, byte for byte.
 */
import type {CombatMode,RunView,EnemyView,NodeView,StructureView,PlayerRunView} from '../contract/index.ts';
import {BASE_STATS,CAR_ID,CAR_PULL_REACH,CAR_PUSH_REACH,CAR_RADIUS,CAR_ROPE,DELIVERY_MARK_SECONDS,carNose,ropeTip} from '../contract/index.ts';
import {equippedWeapon,manualReach} from './weapons/system.ts';
import {resolveWeapon,weaponCatalog,weaponLevel} from './weapons/catalog.ts';
import {telegraphHits} from './telegraphs.ts';
import {RECIPES,CAMP_RADIUS,TOWER_TOKENS,UNITS_PER_TOKEN,canPay,forgePrice,priceOf,returnTicks,tokensOf,type RecipeId} from '../rules/index.ts';
import {MAX_TOWERS} from './stonewards/forge.ts';
import {floorPortal,heroSpeed,onFloor,walkable,type Point} from '../maps/index.ts';
import type {TerrainField} from '../maps/index.ts';
import {cityTerrainOf} from './city/grid.ts';
import type {StonewardsState} from './stonewards/state.ts';
import {DEFENSES,DEFENSE_LIMIT,GUSTAVAO_LIMIT,ROOT_DEFENSE,childrenOf,pickChild,unitsOf,type Branch,type DefenseId} from './towers/catalog.ts';
import type {BuildPlan} from './towers/sites.ts';
import {BUILD_REACH,TOWER_REPAIR_COST} from './towers/system.ts';
import {PUSH_RADIUS,PUSH_SECONDS} from './chaveiro/system.ts';
import {BANCO,BICO,CALMA,REVIVE_TICKS,calmAround} from '../rules/index.ts';
import {botRoute,botRouteDistance,straightClear} from './city/bot-routes.ts';
import {CRATE_STAND,LOOT_RADIUS,LOOT_RADIUS_CALM,planLoot,vehicleGoal,type LootCommand} from './bot-loot.ts';

export const HZ=20;
/** Combat: how far from the wall the bot is happy to roam (units). Farther, home pulls harder. */
export const LEASH=6.5,BOSS_LEASH=9;
/** Critters closer than this push the bot away. */
export const DANGER=2.6;
/** Critters within this are worth walking toward (weapons need range), if they are near home. */
export const ENGAGE=9;
/** A fallen friend within this is worth the walk. */
export const RESCUE_REACH=14;
/**
 * A fallen friend farther than RESCUE_REACH, up to RESCUE_FAR (u): the nearest standing bot goes, when its walk (along
 * the streets in the city) leaves RESCUE_SPARE seconds of the bleed-out for the revive itself and the fight on the way
 * (varredura-celular P1-2: a person who fell 15 u out bled out every time, in both combats, and watched the match).
 */
export const RESCUE_FAR=60,RESCUE_SPARE=REVIVE_TICKS/HZ+4;
/** Ticks between two skill taps, two "Me salva", two forge taps, two picks of the same offer. */
export const CAST_GAP=HZ,SOS_GAP=4*HZ,FORGE_GAP=HZ,CHOOSE_RETRY=2*HZ;
/** Reaction before a pick (ticks): the offer chip in combat waits longer than the intermission panel. */
export const PICK_DELAY_COMBAT=3*HZ,PICK_DELAY_PREPARE=HZ;
/** Wall health share under which the forger repairs first (a scratch is left for later, towers first). */
export const REPAIR_BELOW=.95;
/** The forger taps the forge this close to the wall (well inside CAMP_RADIUS, which counts from the base). */
export const FORGE_REACH=Math.min(2.5,CAMP_RADIUS-1);
/** Critters this close to the wall are besieging it: the guards go for them first. */
export const SIEGE_REACH=4;
/** Mode 'ninhos': a critter this close to the car keeps the bots from a delivery-clearing trip (objectiveTask). */
export const NEST_THREAT_RADIUS=40;
/**
 * Mode 'ninhos' with the car (inicio-no-uno-caixas-120 bench): a critter this close to the car keeps the bots off the
 * crates (planLoot's lull only looks around the bot: with the start and its crates beside the Uno, six bots stood at
 * crates 8-25 u off while the first wave took the car in 60 s).
 */
export const LOOT_CAR_THREAT=12;
/**
 * How close the bot walks to a critter at the car (the chaveiro; at the wall it stays DANGER+.2): DANGER+.2, or, with
 * only orbit weapons (the chinelo the run starts with: it hits within its `area`), inside that ring (ninhos-padrao:
 * at 2.8 u a lone bot's chinelo never reached the siege at the car, so it got no kill and no XP). With other weapons,
 * within the longest `range` of them (carro-cedo-1p: a solo with only the faca, range 1.3, stood at 2.8 u from the
 * two critters at the car and never cut one; they took the car's 120 hits by minute 5 in ~1/5 of the 1p runs).
 */
export function siegeStand(weapons:readonly {id:string;level:number}[]):number{
  let ring=0,reach=0;
  for(const w of weapons){
    const def=weaponCatalog.get(w.id);if(!def)continue;
    const row=weaponLevel(def,w.level);
    if(def.pattern==='orbit')ring=Math.max(ring,row.area);else reach=Math.max(reach,row.range);
  }
  if(reach>0)return Math.min(DANGER+.2,Math.max(.8,Math.max(reach,ring)-.2));
  return ring>0?Math.max(.8,ring-.2):DANGER+.2;
}
/** Bots with an even index guard the wall (shorter leash); the others roam. */
export const GUARD_LEASH=3.5;
/** A roamer walking with a person (room bots) stays this close to them. */
export const ESCORT_LEASH=3;
/**
 * BUG-20261023-ORQ-bots-na-nossa-velocidade: a person whose last decisions apart (at most ESCORT_PACE_GAP s) show them
 * walking at ESCORT_WALKING × the hero speed or more is walking, and the roamer with them walks too, at the full speed:
 * out of the leash straight along the way to them (no circling: its 0.35 sideways cost the walk ~18 %), inside it along
 * their heading, nudged toward them. Before, inside the leash it circled or stood (lures, pulls that cancel out) until
 * the person was out of it again: stop-and-go at 81–91 % of the person's speed (scripts/bench-bot-speed.ts).
 */
export const ESCORT_WALKING=.5,ESCORT_PACE_GAP=1;
/** A person inside the wall's leash walking out (their heading within ~60° of straight away from home) is followed already. */
export const ESCORT_OUTWARD_COS=.5;
/** City: a bot pulled back to its anchor walks until this far (u) inside the leash. */
export const HOME_SLACK=2;
/** City: critters and pickups lure the bot only this far (u) inside its leash, and only those it can answer from there. */
export const ROAM_IN=1;
/** City: a roamer hunts when the wave is down to this many critters and none is near the wall; it closes to HUNT_LEASH (u). */
export const HUNT_LEFT=4,HUNT_LEASH=DANGER+.5;
/**
 * City: how far from the wall (u) a critter still lures a roamer on its LEASH (ROAM_IN inside it, plus the stand-off
 * DANGER+.6). The hunt starts where this ends (bot-caca-ultimo-na-borda: between it and the old LEASH+3 a last critter
 * neither lured nor was hunted, and two bots held at their leash's edge 6 u from it for ~7 s).
 */
export const LURE_REACH=LEASH-ROAM_IN+DANGER+.6;
/** City, combat: a wanted move shorter than this (the pulls cancel out) is no move. */
export const HOLD_BELOW=.15;
type Chase='rescueGoal'|'escortGoal'|'huntGoal'|'motoGoal'|'carGoal';
/** D-047: bots that push a dead moto, and how close (u) they stand to it (inside the sim's PUSH_RADIUS, 2.5). */
export const PUSH_BOTS=2,PUSH_STAND=1.5;
/**
 * D-052 (the car moves, Orq's answer to slice 5): at most CAR_HELP_BOTS bots help a person move the car, from up to
 * CAR_HELP_RANGE u away (a longer walk would mostly find the push over). A helper leans CAR_LEAN u off the body behind
 * it (inside CAR_PUSH_REACH), CAR_SIDE u to one side of the person's line, and pushes once its line to the car is
 * within CAR_LEAN_DOT (cos) of the heading (the sim takes CAR_PUSH_DOT, .5).
 */
export const CAR_HELP_BOTS=2,CAR_HELP_RANGE=20,CAR_LEAN=.5,CAR_SIDE=.6,CAR_LEAN_DOT=.8;
/** puxar-uno-corda: a helper takes the rope only when the people take the car within this (cos) of its nose. */
export const CAR_ROPE_BOT_DOT=.7;
/**
 * D-047, a dead moto in the intermission (NEW-20261014-E2-chaveiro-time-cai-onda-4): the pushers go only when the trip
 * (to the moto, PUSH_TRIP_SECONDS there, back to the car; along the streets in the city) ends before the wave. The
 * first moto dies far out, a few seconds before wave 2, and the two pushers were still ~50 u out when it started. CI,
 * chaveiro 6p, 16 seeds: 10/16 → 12/16, and seeds 3, 7, 8, 11, 16 no longer lose the whole team in wave 4. In the wave
 * the push stays as it was (the moto would start by itself only after 75 s).
 */
export const PUSH_TRIP_SECONDS=10;
/**
 * D-048, the chaveiro's bill (the vaquinha at the end since NEW-20261014-ORQ-carteira-e-pix: equal parts from every
 * seat's wallet, the richest cover the rest, then debt): each bot always keeps its part of CHAVEIRO_KEEP_SHARE × the
 * bill (÷ the seated players), from the start (1.3: the bill itself plus a margin for the hits still to come, 33 R$
 * of a fresh R$ 25 bill; balanco-pos-1-7 eco-v9, Executor-6). CHAVEIRO_SAVE_ETA is the ETA (s) from which the reserve
 * would be the whole bill instead; −1 turns that branch off (an ETA is never negative), since the share already holds
 * more than the bill.
 */
export const CHAVEIRO_KEEP_SHARE=1.3,CHAVEIRO_SAVE_ETA=-1;

export interface BrainMemory {
  lastPos?:Point;lastMoveTick:number;unstickUntil:number;unstick?:Point;
  lastCastTick:number;lastSosTick:number;lastForgeTick:number;
  offerSeen?:{id:string;tick:number};lastChoose?:{id:string;tick:number};
  orbit:1|-1;
  /** Recipes the forge refused, by round index (Bot fills it from {t:'forged'}): not asked again this intermission. */
  refused:Partial<Record<RecipeId,number>>;
  /** City only: the goal cells of the moving targets (fallen friend, person walked with, critter hunted) last routed to (bot-routes keep). */
  rescueGoal?:number;escortGoal?:number;huntGoal?:number;motoGoal?:number;carGoal?:number;
  /** City only: walking back to the anchor until HOME_SLACK inside the leash. */
  homing?:boolean;
  /** Where the person walked with was at the last decision (escortPace): their walk is read from it. */
  escortSeen?:{x:number;y:number;tick:number};
}
export const newMemory=(index=0):BrainMemory=>({lastMoveTick:0,unstickUntil:-1,lastCastTick:-1e9,lastSosTick:-1e9,lastForgeTick:-1e9,orbit:index%2?-1:1,refused:{}});

export interface BrainInput {
  view:RunView;selfId:string;
  /**
   * Where the client predicts it is (CoopClient.predicted), like the scene's camera; `andar` 1 on a viaduct's deck
   * (maps city/viaduct.ts): the bot walks the deck straight and leaves it by the ramp.
   */
  at:Point&{andar?:1};
  /** Bot index in the room (spreads the gather nodes and the orbit). */
  index:number;
  terrain?:TerrainField;
  memory:BrainMemory;
  /**
   * Who spends the balance at the forge. Unset: the first standing player by id (the protocol bots, all bots). The
   * room bots (D-025) pass their own pick (a bot, never a person) or null when no bot may buy now.
   */
  forger?:string|null;
  /**
   * Tower defense (torres-sim): the sites, defenses and balance as the simulation keeps them (towerBrainView). When
   * set, the forger spends on towers before the forge (pickTowerOrder); unset: the brain is exactly as before.
   */
  towers?:TowerBrainView;
  /**
   * The person this bot walks with (room bots, D-025: the nearest standing person). In combat a roamer (odd index)
   * follows them once they leave the wall's leash; guards (even index) keep the wall. Unset: wall only (protocol bots).
   */
  escort?:Point;
  /**
   * D-047 (the chaveiro objective): the room's bots, so each one knows whether it is one of the pushers of a dead moto
   * or the one clearing the next delivery (objectiveTask). Unset (the protocol bots): no objective tasks.
   */
  teamBots?:readonly string[];
  /** D-051: the room's combat. 'manual': hold the attack with a critter in reach, no skill. Unset: the automatic weapons. */
  combat?:CombatMode;
  /** D-051 mode 'ninhos' (room bots): at the car a bot walks into its orbit ring to hit the siege (siegeStand). Unset: DANGER+.2. */
  nests?:true;
}
export interface Decision {
  direction:Point;cast:boolean;sos:boolean;forge?:RecipeId;choose?:{offer:string;index:number};
  /** D-051 manual combat only: hold the attack button (a critter is within the equipped weapon's reach). */
  attack?:boolean;
  /** Bicos: hold Trabalhar (standing still in a shop's ring, mode 'bank'). */
  work?:boolean;
  /** D-051 manual combat only: an inventory command (bot-loot.ts: eat, the best weapon to the hand, "Trocar"). */
  inventory?:LootCommand;
  /** Tower defense order for the structures system's build/upgrade (only with BrainInput.towers). */
  build?:TowerOrder;
  /** What the bot is up to (logs and tests). */
  mode:'idle'|'down'|'fight'|'rescue'|'home'|'gather'|'forge'|'build'|'dodge'|'unstick'|'escort'|'push'|'clear'|'loot'|'carro'|'bank'|'veiculo';
}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const norm=(v:Point):Point=>{const l=Math.hypot(v.x,v.y);return l>1e-6?{x:v.x/l,y:v.y/l}:{x:0,y:0};};
const toward=(from:Point,to:Point,weight=1):Point=>{const n=norm({x:to.x-from.x,y:to.y-from.y});return {x:n.x*weight,y:n.y*weight};};
const standing=(p:PlayerRunView)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

/**
 * D-051: whether a critter is within reach of the equipped weapon (weapons/system.ts manualReach, at the weapon's level
 * with base stats: the room's aim decides the real shot). The enemy's radius counts for the patterns that touch, when
 * the view carries it (the room bots see the live enemies).
 */
/** D-051 bots: a loot trip in the intermission counts the streets as this × the straight line, plus these seconds. */
export const LOOT_DETOUR=1.4,LOOT_SPARE_SECONDS=7;
/**
 * D-051 runner: with at least RUNNER_TEAM standing, the bot of index RUNNER_INDEX (a roamer) fetches crates within
 * LOOT_RADIUS_RUN during the wave too, like a person whose friends hold the wall (the 16/10 bench: the far dourada and
 * lendária crates stayed shut while six bots fought with verde pistols). A solo never runs. 60 u on the 1.7× city, 34 since
 * mapa-175-com-viaduto (the distances ÷ CITY_COMPACT).
 */
export const RUNNER_INDEX=1,RUNNER_TEAM=3,LOOT_RADIUS_RUN=34;
export function attackReach(me:Pick<PlayerRunView,'weapons'|'hand'>,at:Point,enemies:readonly EnemyView[]):boolean{
  const owned=equippedWeapon({weapons:me.weapons,passives:[],...(me.hand!==undefined?{hand:me.hand}:{})}),def=owned?weaponCatalog.get(owned.id):undefined;
  if(!owned||!def)return false;
  const {reach,pad}=manualReach(resolveWeapon(def,owned.level,BASE_STATS));
  return enemies.some(e=>e.hp>0&&dist(e,at)<=reach+(pad?(e as EnemyView&{radius?:number}).radius??0:0));
}

export function wallOf(view:RunView):StructureView|undefined{return view.structures.find(s=>s.kind==='muralha');}
/**
 * Home: the wall (the camp is around it), or the car where it stands instead (D-047, kind 'quadradao'); before the
 * first frame with structures, where the run spawned us.
 */
export function homeOf(view:RunView,fallback:Point):Point{
  const w=view.structures.find(s=>s.kind==='muralha'||s.kind===CAR_ID);return w?{x:w.x,y:w.y}:fallback;
}
/** An objective task: 'carro' (D-052) also carries where the people take the car and the side this helper leans on. */
export type ObjectiveTask={kind:'push'|'clear';at:Point}|{kind:'carro';at:Point;heading:Point;side:1|-1;rope?:{nose:Point;tip:Point;held:boolean}};
/**
 * D-047: this bot's objective task, or none. 'push': the moto is dead and this is one of the PUSH_BOTS standing bots
 * nearest to it (ties by id); 'clear': a delivery is DELIVERY_MARK_SECONDS ahead or less and this is the freest bot
 * (nearest to the point among the standing bots that do not push and do not forge); 'carro' (D-052): a person moves
 * the car and this is one of the CAR_HELP_BOTS free bots nearest to it (those already leaning behind it first). `at`:
 * where to go.
 */
export function objectiveTask(view:RunView,selfId:string,bots:readonly string[],forger?:string|null,terrain?:TerrainField,nests?:boolean):ObjectiveTask|undefined{
  const o=view.objective;
  if(!o||o.ended)return undefined;
  const ready=bots.map(id=>view.players.find(p=>p.id===id)).filter((p):p is PlayerRunView=>!!p&&standing(p)&&!!positionOf(p));
  const byDistance=(to:Point,list:readonly PlayerRunView[])=>[...list].sort((a,b)=>dist(positionOf(a)!,to)-dist(positionOf(b)!,to)||(a.id<b.id?-1:a.id>b.id?1:0));
  const moto={x:o.moto.x,y:o.moto.y};
  // Only a crew can push (PUSH_BOTS standing players, people included): a bot alone would leave the car for nothing
  // while the moto starts by itself anyway (balanco-pos-1-7 part B: a solo bot stood ~75 s at each dead moto).
  const crew=view.players.filter(standing).length>=PUSH_BOTS;
  let pushers=crew&&o.moto.mode==='morta'?byDistance(moto,ready).slice(0,PUSH_BOTS).map(p=>p.id):[];
  // In the intermission, only a trip that is back at the car before the wave (PUSH_TRIP_SECONDS).
  const round=view.round;
  if(pushers.length&&round?.phase==='prepare'){
    const city=cityTerrainOf(terrain),car=homeOf(view,moto),speed=heroSpeed(terrain),left=round.phaseEndsTick-view.tick;
    const walk=(a:Point,b:Point)=>city?botRouteDistance(city,a,b):dist(a,b);
    const back=walk(moto,car);
    // A bot already at the moto owes only what is left of the push (o.moto.push, 0..1) plus the margin: the 10 s are the
    // allowance to set out, not a toll charged again every tick (else a pair that set out with little spare gave up
    // mid-push and walked back empty-handed).
    const there=PUSH_TRIP_SECONDS-PUSH_SECONDS,owed=(at:Point)=>dist(at,moto)<=PUSH_RADIUS?(1-(o.moto.push??0))*PUSH_SECONDS+there:PUSH_TRIP_SECONDS;
    const fits=(id:string)=>{const at=positionOf(ready.find(p=>p.id===id)!)!;return ((walk(at,moto)+back)/speed+owed(at))*HZ<=left;};
    if(!pushers.every(fits))pushers=[];
  }
  if(pushers.includes(selfId))return {kind:'push',at:moto};
  const d=o.delivery;
  let clearer:string|undefined;
  // Mode 'ninhos' (balanco-ninhos): no clearing trip while a critter is within NEST_THREAT_RADIUS of the car (a lone bot
  // walked 60-80 u off to clear while a siege group came in, and the car took 64 hits in 10 s).
  if(d&&d.etaS<=DELIVERY_MARK_SECONDS&&!(nests&&view.enemies.some(e=>dist(e,o.car)<NEST_THREAT_RADIUS))){
    clearer=byDistance(d,ready.filter(p=>!pushers.includes(p.id)&&p.id!==forger))[0]?.id;
    if(clearer===selfId)return {kind:'clear',at:{x:d.x,y:d.y}};
  }
  // D-052: a person moves the car: the nearest free bots push along (the sim counts them only with that person).
  const heading=carHeading(view,bots);
  if(heading){
    const car={x:o.car.x,y:o.car.y};
    // A bot already leaning behind the car (carHelp's push zone) keeps its place before one nearer to the body: the car
    // rolling toward a free bot ahead made it the nearer one, and the helper pushing went off while it circled to the back.
    const behind=(p:PlayerRunView)=>{const at=positionOf(p)!,d=dist(at,car);return d<=CAR_HELP_NEAR&&d>1e-6&&-((at.x-car.x)*heading.x+(at.y-car.y)*heading.y)/d>=CAR_LEAN_DOT;};
    const free=byDistance(car,ready.filter(p=>!pushers.includes(p.id)&&p.id!==clearer&&dist(positionOf(p)!,car)<=CAR_HELP_RANGE));
    const helpers=[...free.filter(behind),...free.filter(p=>!behind(p))].slice(0,CAR_HELP_BOTS).map(p=>p.id);
    const i=helpers.indexOf(selfId);
    if(i>=0){
      const task:ObjectiveTask={kind:'carro',at:car,heading,side:i===0?1:-1};
      // puxar-uno-corda: one helper pulls when the rope is free (or on a helper already) and the car goes nose first:
      // the helper holding it, else the one nearest to the rope's end among those it is nearer to than their spot
      // behind the car.
      const c=o.car,h=c.heading??0;
      const forward=Math.cos(h)*heading.x+Math.sin(h)*heading.y>=CAR_ROPE_BOT_DOT;
      if(forward&&(c.rope===undefined||helpers.includes(c.rope))){
        const tip=ropeTip(c),behind={x:car.x-heading.x*(CAR_RADIUS+CAR_LEAN),y:car.y-heading.y*(CAR_RADIUS+CAR_LEAN)};
        const at=(id:string)=>positionOf(ready.find(p=>p.id===id)!)!;
        const puller=c.rope??helpers.filter(id=>dist(at(id),tip)<dist(at(id),behind)).sort((a,b)=>dist(at(a),tip)-dist(at(b),tip)||(a<b?-1:1))[0];
        if(puller===selfId)task.rope={nose:carNose(c),tip,held:c.rope===selfId};
        else if(puller!==undefined)task.side=helpers.filter(id=>id!==puller).indexOf(selfId)===0?1:-1;
      }
      return task;
    }
  }
  return undefined;
}

/** Bancos: a bot goes to an ATM at most this far (u, straight), and at most BANK_BOTS of them to one ATM. */
export const BANK_REACH=40,BANK_BOTS=2;
/** Bancos, wall mode (no chaveiro's bill): the Grana (R$) under which the bots go to an ATM. */
export const BANK_GRANA_TARGET=30;
/**
 * A trip to a shop is worth it for this many notes (bicos: BICO.nota at BICO.porSegundo, 5 s each); a bot already there
 * stays while one more fits.
 */
export const BANK_MIN_NOTES=1;
/**
 * Bicos: a bot in the ring works (Trabalhar, standing still) while no critter is within BICO_BOT_CLEAR (u) and the
 * queue is under BICO_BOT_FILA; else it steps out (moving clocks out) and fights or dodges like before.
 */
export const BICO_BOT_CLEAR=12,BICO_BOT_FILA=2;
/**
 * Bancos in the wave: the ATMs stand ≥ 35 u from the car (≈ 63 u by the streets), a trip no 30 s intermission holds, so
 * the decision "banco ou moto?" is also made in combat. With at least BANK_WAVE_MIN_UP standing players, a bot (never
 * the builder, never one with an objective task) goes to the nearest open ATM within BANK_WAVE_REACH
 * (straight) and holds it, one bot per BANK_WAVE_PER standing (a full team of six: one bot). A smaller team keeps the car
 * (CI: one bot in three left the car too thin, 6p 12/16 → 7/16).
 */
export const BANK_WAVE_MIN_UP=6,BANK_WAVE_PER=6,BANK_WAVE_REACH=80;
/** How close (u) a bot stands to the ATM (inside BANCO.holdR), and the seconds it keeps for the walk back. */
export const BANK_STAND=BANCO.holdR-1.5,BANK_MARGIN_SECONDS=2;

/**
 * The team's Grana goal for the ATMs: the chaveiro's whole reserve while he runs (granaReserve for one seat: the team's,
 * not a bot's part; bankTask compares it with the team's Grana, the room bots' camp), else BANK_GRANA_TARGET.
 */
export function bankTarget(view:Pick<RunView,'objective'>):number{
  if(view.objective)return view.objective.ended?0:granaReserve({objective:view.objective});
  return BANK_GRANA_TARGET;
}
/**
 * Bancos: whether this bot goes to an ATM now, and which (see the module doc). Deterministic: every bot computes the
 * same assignment from the view. The bots busy with an objective task (objectiveTask) are left out.
 */
export function bankTask(view:RunView,selfId:string,bots:readonly string[],forger?:string|null,terrain?:TerrainField):{kind:'bank';at:Point;bank:string}|undefined{
  const round=view.round,wave=round?.phase==='wave';
  if(!view.banks?.length||!round||round.phase!=='prepare'&&!wave)return undefined;
  const grana=view.camp?.grana??view.objective?.grana??0;
  if(grana>=bankTarget(view))return undefined;
  const open=view.banks.filter(b=>b.state!=='sem-cedulas'&&b.saldo>0);
  if(!open.length)return undefined;
  const city=cityTerrainOf(terrain),speed=heroSpeed(terrain),left=round.phaseEndsTick-view.tick;
  const walk=(a:Point,b:Point)=>city?botRouteDistance(city,a,b):dist(a,b);
  const ready=bots.map(id=>view.players.find(p=>p.id===id)).filter((p):p is PlayerRunView=>!!p&&standing(p)&&!!positionOf(p))
    .filter(p=>!objectiveTask(view,p.id,bots,forger,terrain));
  // The team's builder (the first standing bot, RoomBots' forger) keeps the forge and the towers when it is not alone.
  const up=bots.filter(id=>{const p=view.players.find(q=>q.id===id);return !!p&&standing(p);});
  if(up.length>1)ready.splice(0,ready.length,...ready.filter(p=>p.id!==up[0]));
  if(wave&&up.length<BANK_WAVE_MIN_UP)return undefined;
  const picks:{id:string;bank:string;d:number}[]=[];
  for(const p of ready){
    const at=positionOf(p)!,home=homeOf(view,at);
    let bank=open[0],d=Infinity;
    for(const b of open){const x=dist(at,b);if(x<d||x===d&&b.id<bank.id){d=x;bank=b;}}
    if(d>(wave?BANK_WAVE_REACH:BANK_REACH))continue;
    if(wave){picks.push({id:p.id,bank:bank.id,d});continue;}
    // A lone bot alternates: the crate in the even rounds' intermissions (the material for the towers), the ATM in the
    // odd ones (the ATMs are near the car now, nearer than any crate). With a team, the crate it would work comes first
    // when it is nearer (straight) than the ATM.
    if(up.length===1){if(round.index%2===0)continue;}
    else{
      const crate=nodeFor(view.nodes??[],home,bots.indexOf(p.id),city&&(q=>botRouteDistance(city,q,home)));
      if(crate&&dist(at,crate)<d)continue;
    }
    const there=d<=BANCO.holdR?0:walk(at,bank),back=walk(bank,home);
    const stay=(d<=BANCO.holdR?1:BANK_MIN_NOTES)*BICO.nota/BICO.porSegundo;
    if(!Number.isFinite(there+back)||((there+back)/speed+stay+BANK_MARGIN_SECONDS)*HZ>left)continue;
    picks.push({id:p.id,bank:bank.id,d});
  }
  const order=(a:{id:string;d:number},b:{id:string;d:number})=>a.d-b.d||(a.id<b.id?-1:a.id>b.id?1:0);
  // In the wave: one bot per ATM, and at most one bot in three of those standing (the nearest first).
  if(wave){
    const one=new Map<string,{id:string;bank:string;d:number}>();
    for(const x of [...picks].sort(order))if(!one.has(x.bank))one.set(x.bank,x);
    const chosen=[...one.values()].sort(order).slice(0,Math.floor(up.length/BANK_WAVE_PER));
    picks.splice(0,picks.length,...chosen);
  }
  const mine=picks.find(x=>x.id===selfId);
  if(!mine)return undefined;
  const rivals=picks.filter(x=>x.bank===mine.bank).sort(order);
  if(rivals.findIndex(x=>x.id===selfId)>=BANK_BOTS)return undefined;
  const b=open.find(x=>x.id===mine.bank)!;
  return {kind:'bank',at:{x:b.x,y:b.y},bank:b.id};
}

/**
 * D-052: where the people moving the car (view.objective.car.movers, the bots left out) take it, as a unit vector: a
 * pusher leans from its side toward the body, the rope pulls toward its holder. Undefined when no person moves it.
 */
export function carHeading(view:Pick<RunView,'objective'|'players'>,bots:readonly string[]):Point|undefined{
  const car=view.objective?.car;
  if(!car?.movers?.length)return undefined;
  let x=0,y=0;const nose=carNose(car);
  for(const id of car.movers){
    if(bots.includes(id))continue;
    const p=view.players.find(q=>q.id===id),at=p&&positionOf(p);
    if(!at)continue;
    // The rope pulls from the front bumper toward its holder (puxar-uno-corda); a pusher leans toward the centre.
    const from=id===car.rope?nose:car,d=dist(at,from);if(d<1e-6)continue;
    const sign=id===car.rope?1:-1;
    x+=sign*(at.x-from.x)/d;y+=sign*(at.y-from.y)/d;
  }
  const n=norm({x,y});
  return n.x||n.y?n:undefined;
}

/** The standing bot that spends the balance: the first standing player by id (every bot computes the same one). */
export function forgerId(view:RunView):string|undefined{
  return view.players.filter(standing).map(p=>p.id).sort()[0];
}

/**
 * The Grana (R$) a bot never spends its wallet below (D-048): with the chaveiro objective running, its part of
 * CHAVEIRO_KEEP_SHARE × his bill (÷ the seated players of `view.players`, at least 1; rounded up), or of the whole bill
 * once his ETA is CHAVEIRO_SAVE_ETA or less (off at −1); the bill grows with the car's hits (budget), the reserve
 * with it. 0 without the objective (no bill in the other worlds) or once it ended. Deterministic: the view only.
 */
export function granaReserve(view:Pick<RunView,'objective'>&{players?:readonly Pick<PlayerRunView,'spectator'>[]}):number{
  const o=view.objective;
  if(!o||o.ended)return 0;
  const seats=Math.max(1,view.players?.filter(p=>!p.spectator).length??1);
  return Math.ceil((o.etaS<=CHAVEIRO_SAVE_ETA?o.budget:o.budget*CHAVEIRO_KEEP_SHARE)/seats);
}

/** Wall share under which the forger repairs it even out of the chaveiro's reserve (review: the bill never beats a defeat). */
export const WALL_CRITICAL=.5;
/**
 * What the forger buys with its wallet (view.camp.grana; D-048: the forge is paid in R$, never material), or nothing: repair a
 * hurt wall, then towers up to the forge's cap, then gambiarras. A recipe the forge refused this round (`refused`:
 * recipe -> round index) is skipped; `keep` (default granaReserve: the chaveiro's bill) is never spent.
 */
export function pickRecipe(view:RunView,refused:Partial<Record<RecipeId,number>>={},keep=granaReserve(view)):RecipeId|undefined{
  const camp=view.camp;if(!camp||camp.wallDown)return undefined;
  const wall=wallOf(view),round=view.round?.index??0;
  const ok=(id:RecipeId,reserve=keep)=>refused[id]!==round&&canPay((camp.grana??0)-reserve,forgePrice(id,camp.forge));
  // A wall under WALL_CRITICAL is repaired whatever the chaveiro's bill: a fallen wall ends the run, a debt only the joke.
  if(wall&&wall.hp<wall.maxHp*WALL_CRITICAL&&ok('reparo',0))return 'reparo';
  if(wall&&wall.hp<wall.maxHp*REPAIR_BELOW&&ok('reparo'))return 'reparo';
  // Only forge towers ('torre-*') count: the city barricades are structures too (cidade-06), never towers.
  const towers=view.structures.filter(s=>s.kind.startsWith('torre-')&&(s.untilTick===undefined||s.untilTick>view.tick)).length;
  if(towers<MAX_TOWERS&&ok('torre-chinelo'))return 'torre-chinelo';
  if(ok('gambiarra'))return 'gambiarra';
  if(wall&&wall.hp<wall.maxHp&&ok('reparo'))return 'reparo';
  return undefined;
}

/**
 * The node this bot works: the nodes in sight with something left, nearest to home first, one per bot index.
 * `measure`: distance from a node to home (default straight; the city passes the street distance, and a node it
 * cannot reach is left out).
 */
export function nodeFor(nodes:readonly NodeView[],home:Point,index:number,measure?:(p:Point)=>number):NodeView|undefined{
  if(measure){
    const far=new Map(nodes.filter(n=>n.remaining>0).map(n=>[n,measure(n)] as const));
    const open=[...far.keys()].filter(n=>far.get(n)!<Infinity).sort((a,b)=>far.get(a)!-far.get(b)!||a.id.localeCompare(b.id));
    return open.length?open[index%Math.min(open.length,6)]:undefined;
  }
  const open=nodes.filter(n=>n.remaining>0).sort((a,b)=>dist(a,home)-dist(b,home)||a.id.localeCompare(b.id));
  if(!open.length)return undefined;
  return open[index%Math.min(open.length,6)];
}

/** The first of these directions (rotations of `want`) whose next ~meter is walkable; `want` itself when none is. */
export function clearPath(at:Point,want:Point,terrain?:TerrainField):Point{
  if(!terrain||Math.hypot(want.x,want.y)<1e-6)return want;
  for(const turn of [0,.5,-.5,1,-1,1.6,-1.6]){
    const c=Math.cos(turn),s=Math.sin(turn),d={x:want.x*c-want.y*s,y:want.x*s+want.y*c};
    if(walkable({x:at.x+d.x*.8,y:at.y+d.y*.8},terrain))return d;
  }
  return want;
}

/**
 * D-051 mode 'ninhos' (card ninhos-rounds-fora): no intermission, the director holds one open wave. Each bot reads its
 * own round instead: "calmo" (no critter awake within CALMA.botR of it, rules/calma.ts) is a 'prepare' of
 * CALM_WINDOW_S (its old intermission: gather, forge, towers, trips there and back within that), else a 'wave' whose
 * clock never runs out (nobody retreats: the nests' groups do not). Pure over the view.
 */
export const CALM_WINDOW_S=60;
export function calmRound(view:RunView,at:Point):RunView{
  const round=view.round;
  if(!round)return view;
  const calm=calmAround(view.enemies,at,CALMA.botR);
  return {...view,round:{...round,phase:calm?'prepare':'wave',phaseEndsTick:view.tick+(calm?CALM_WINDOW_S*HZ:HZ*3600)}};
}
export function decide(input:BrainInput):Decision{
  if(input.nests&&input.view.round)input={...input,view:calmRound(input.view,input.at)};
  const {view,selfId,at,index,terrain,memory}=input,tick=view.tick;
  const me=view.players.find(p=>p.id===selfId);
  const decision:Decision={direction:{x:0,y:0},cast:false,sos:false,mode:'idle'};
  // Offers first: a fallen player can still pick (the panel stays).
  const offer=view.offers[0];
  if(offer){
    if(memory.offerSeen?.id!==offer.id)memory.offerSeen={id:offer.id,tick};
    const wait=view.round?.phase==='prepare'?PICK_DELAY_PREPARE:PICK_DELAY_COMBAT;
    const again=memory.lastChoose?.id===offer.id&&tick-memory.lastChoose.tick<CHOOSE_RETRY;
    if(tick-memory.offerSeen.tick>=wait+index*3&&!again){
      const pick=Math.max(0,Math.min(offer.choices.length-1,offer.defaultIndex));
      decision.choose={offer:offer.id,index:pick};memory.lastChoose={id:offer.id,tick};
    }
  }
  if(!me||me.spectator||me.eliminated)return decision;
  if(me.downed){
    decision.mode='down';
    if(tick-memory.lastSosTick>=SOS_GAP){decision.sos=true;memory.lastSosTick=tick;}
    return decision;
  }
  // D-051 manual combat: hold the attack whenever a critter is in reach, whatever the bot is walking to.
  if(input.combat==='manual')decision.attack=attackReach(me,at,view.enemies);
  const task=input.teamBots?objectiveTask(view,selfId,input.teamBots,input.forger===undefined?forgerId(view):input.forger,terrain,input.nests):undefined;
  // D-047: the bot clearing a delivery fights around its point (its anchor) instead of the car.
  const home=task?.kind==='clear'?task.at:homeOf(view,at),round=view.round,prepare=round?.phase==='prepare';
  // The way to a place (unit): straight, or along the streets in the city; undefined when the streets do not lead
  // there. `chase`: a moving target, whose goal cell is kept in memory (BrainMemory.rescueGoal and the like).
  const city=cityTerrainOf(terrain);
  const way=(to:Point&{andar?:number},chase?:Chase):Point|undefined=>{
    // The viaduct (mapa-175-com-viaduto): the streets' fields are the ground's. On the deck the bot walks straight (a
    // corridor with one ramp); to the other floor it goes to the ramp first (straight down it, along the streets up).
    const decks=city?.asset.viaducts;
    if(city&&decks?.length){
      const from=at.andar===1?1:0,goalFloor=to.andar===1?1:0;
      if(goalFloor!==from){
        const u=city.asset.unitsPerCell,v=decks.reduce((a,b)=>dist(floorPortal(a,u,goalFloor),at)<=dist(floorPortal(b,u,goalFloor),at)?a:b);
        const portal=floorPortal(v,u,goalFloor);
        if(from===1)return toward(at,portal);
        const out={x:0,y:0},goal=botRoute(city,at,portal,out);
        return goal===-2?undefined:goal<0?toward(at,portal):out;
      }
      if(from===1)return toward(at,to);
    }
    const out={x:0,y:0},goal=city?botRoute(city,at,to,out,chase?memory[chase]??-1:-1):-1;
    if(goal===-2)return undefined;
    if(goal<0)return toward(at,to);
    if(chase)memory[chase]=goal;
    return out;
  };
  const go=(to:Point,weight=1,chase?:Chase):Point=>{
    if(!city)return toward(at,to,weight);
    const w=way(to,chase)??toward(at,to);return {x:w.x*weight,y:w.y*weight};
  };
  /** City: the nearest of these with a clear straight line from `from` (the hero rule). */
  const nearestSeen=<T extends Point>(list:readonly T[],from:Point):T|undefined=>
    city?[...list].sort((a,b)=>dist(a,from)-dist(b,from)).find(p=>straightClear(city,from,p)):nearest(list,from);
  let want:Point={x:0,y:0};
  // Telegraphs: step out of any area about to fire (the nearest safe direction of eight).
  const danger=view.telegraphs.filter(t=>telegraphHits(t,at,.4));
  if(danger.length){
    let best:Point|undefined,bestScore=-Infinity;
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,d={x:Math.cos(a),y:Math.sin(a)},p={x:at.x+d.x*1.6,y:at.y+d.y*1.6};
      if(terrain&&!walkable(p,terrain))continue;
      const hits=view.telegraphs.filter(t=>telegraphHits(t,p,.4)).length;
      const score=-hits*10-dist(p,home)*.05;
      if(score>bestScore){bestScore=score;best=d;}
    }
    if(best){decision.direction=best;decision.mode='dodge';return finish(decision,input);}
  }
  // D-047: a dead moto: walk over and stand by it until it starts (the sim counts two standing within PUSH_RADIUS).
  if(task?.kind==='push'){
    decision.mode='push';
    if(dist(at,task.at)>PUSH_STAND)want=go(task.at,1,'motoGoal');
    want=add(want,repel(view.enemies,at,.8));
    decision.direction=norm(want);
    return finish(decision,input);
  }
  // D-052: a person moves the car: lean on it from behind (one side of the person's line) and push the same way.
  if(task?.kind==='carro'){
    decision.mode='carro';
    decision.direction=carHelp(at,task,go);
    return finish(decision,input);
  }
  // Veículos (bot-loot.ts vehicleGoal): in a lull, a parked vehicle a few steps away is worth the detour (the sim takes
  // it as the bot walks over it); with an objective task (the moto, the car) the task goes first.
  const vehicle=!task?vehicleGoal(view,me,at):undefined;
  if(vehicle){
    decision.mode='veiculo';
    decision.direction=norm(go(vehicle));
    return finish(decision,input);
  }
  // D-051 manual combat (bot-loot.ts): eat, hold the best weapon, and in a lull open the nearest crate (standing by it)
  // or walk over a better weapon. A crate or a weapon nearby goes before gathering and the forge; a fight or a fallen
  // friend before them all (planLoot only loots in a lull).
  const carThreat=!!input.nests&&!!view.objective&&!prepare&&view.enemies.some(e=>e.hp>0&&dist(e,view.objective!.car)<LOOT_CAR_THREAT);
  if(input.combat==='manual'&&!carThreat){
    const runner=index===RUNNER_INDEX&&view.players.filter(p=>!p.downed&&!p.eliminated).length>=RUNNER_TEAM;
    const loot=planLoot(view,me,at,prepare?LOOT_RADIUS_CALM:runner?LOOT_RADIUS_RUN:LOOT_RADIUS);
    if(loot.command)decision.inventory=loot.command;
    // In the intermission only a trip that is back home before the wave (the streets ~LOOT_DETOUR × the straight line,
    // the opening and a margin: LOOT_SPARE_SECONDS).
    const late=prepare&&!!round&&!!loot.goal&&round.phaseEndsTick-tick<=
      ((dist(at,loot.goal.at)+dist(loot.goal.at,home))*LOOT_DETOUR/heroSpeed(input.terrain)+LOOT_SPARE_SECONDS)*HZ;
    if(loot.goal&&!late){
      decision.mode='loot';
      const close=dist(at,loot.goal.at)<=(loot.goal.stand?CRATE_STAND:.25);
      if(!close)want=go(loot.goal.at);
      decision.direction=close?{x:0,y:0}:norm(want);
      return finish(decision,input);
    }
  }
  // In the intermission the bot clearing a delivery walks to the point (nothing to gather there).
  if(task?.kind==='clear'&&prepare){
    decision.mode='clear';
    if(dist(at,task.at)>2)want=go(task.at);
    want=add(want,repel(view.enemies,at,.8));
    decision.direction=norm(want);
    return finish(decision,input);
  }
  // Bancos: a bot with no objective task may go and hold an ATM (bankTask: in the intermission when the trip fits; in
  // the wave one bot per BANK_WAVE_PER, when the team is at least BANK_WAVE_MIN_UP).
  const bank=!task&&input.teamBots?bankTask(view,selfId,input.teamBots,input.forger===undefined?forgerId(view):input.forger,terrain):undefined;
  if(bank){
    decision.mode='bank';
    // Bicos: in the ring with the street clear and a short queue, it clocks in and stands still (the shift pays).
    const shop=view.banks?.find(b=>b.id===bank.bank);
    if(dist(at,bank.at)<=BANK_STAND&&(shop?.fila??0)<BICO_BOT_FILA&&!view.enemies.some(e=>dist(at,e)<=BICO_BOT_CLEAR)){
      decision.direction={x:0,y:0};decision.work=true;
      return finish(decision,input);
    }
    if(dist(at,bank.at)>BANK_STAND)want=go(bank.at);
    want=add(want,repel(view.enemies,at,.8));
    decision.direction=norm(want);
    return finish(decision,input);
  }
  if(prepare&&round){
    const toHome=dist(at,home),left=round.phaseEndsTick-tick,walkHome=city?botRouteDistance(city,at,home):toHome;
    const forger=(input.forger===undefined?forgerId(view):input.forger)===selfId;
    // D-048: the chaveiro's bill is kept out of every Grana buy (the forge here, the towers' evolutions and repairs below).
    const keep=granaReserve(view);
    let recipe=forger?pickRecipe(view,memory.refused,keep):undefined;
    // Towers first (torres-sim): only a needed wall repair goes ahead. The caller hands `towers` to the bot that builds
    // (the room bots: the forger, or the forger-to-be). torres-ajustes: the sim takes an order only next to the obra, so
    // the bot goes there, and only on a trip (there, the order, back into the base) that ends TOWER_MARGIN before the
    // round; an obra out of time or with no street there is left out of the pick (pickTowerOrder `reach`).
    const towers=input.towers&&{...input.towers,granaKeep:input.towers.granaKeep??keep},wall=wallOf(view);
    // Only a needed repair (under REPAIR_BELOW) goes ahead of the towers; pickRecipe's top-up reparo waits like the rest
    // (D-048: it would otherwise eat into the Grana of the line's next evolution, 5 R$ a tap).
    const needed=recipe==='reparo'&&!!wall&&wall.hp<wall.maxHp*REPAIR_BELOW;
    let site:Point|undefined,building=false;
    if(towers&&!needed){
      const speed=heroSpeed(input.terrain),end=round.phaseEndsTick,from=Math.max(tick,towers.orderFrom??tick);
      const back=(p:Point)=>returnTicks(city?botRouteDistance(city,p,home):dist(p,home),speed);
      // The estimate: the straight line × TOWER_DETOUR, or through the base (both from the cached field home), the shorter.
      const walk=(p:Point,exact:boolean)=>{
        if(dist(at,p)<=TOWER_STAND)return 0;
        const d=!city?dist(at,p):exact?botRouteDistance(city,at,p):Math.min(dist(at,p)*TOWER_DETOUR,walkHome+botRouteDistance(city,p,home));
        return Number.isFinite(d)?Math.ceil(d/speed*1.1*HZ):Infinity;
      };
      const trip=(p:Point,exact:boolean)=>{const w=walk(p,exact);return w<Infinity&&Math.max(tick+w,from)+back(p)+TOWER_MARGIN<=end;};
      // Candidates by an estimate of the walk there; the pick is checked on the streets, and left out if that fails.
      const out=new Set<string>(),key=(p:Point)=>`${p.x},${p.y}`;
      let order:TowerOrder|'save'|undefined,spot:Point|undefined;
      for(let tries=0;tries<3;tries++){
        order=pickTowerOrder(towers,p=>!out.has(key(p))&&trip(p,false));
        spot=order&&order!=='save'?orderSpot(towers,order):undefined;
        if(!spot||trip(spot,true))break;
        out.add(key(spot));order=undefined;spot=undefined;
      }
      if(order&&order!=='save'){
        recipe=undefined;
        // With an orderFrom (a person here) the bot keeps gathering until the walk there ends about then.
        const w=spot?walk(spot,true):0;
        if(!spot||w===0||tick+w>=from-TOWER_EARLY){
          building=true;
          if(w>0)site=spot;
          else if(tick>=from&&tick-memory.lastForgeTick>=FORGE_GAP){decision.build=order;memory.lastForgeTick=tick;}
        }
      }else if(recipe&&(view.camp?.grana??0)-forgePrice(recipe,view.camp?.forge)<keep+towerReserve(towers).grana)
        recipe=undefined; // saving holds only the Grana reserve (the line's next evolution, the bill): the forge spends what is above it (never material, D-048)
    }
    // Home on the horn (island), or on its own walk back. City (BUG-20261013-E4-corneta-jogador-longe): the bot keeps
    // gathering until its own walk home (+4 s) is all the intermission has left; a horn sized by someone else's walk
    // (a far teammate) would call it home with the crates still out. A builder's trip ('build') goes first either way.
    const goHome=(!city&&view.camp?.hornEndsTick!==undefined)||left<=returnTicks(walkHome,heroSpeed(input.terrain))+4*HZ||!view.nodes?.length;
    if(building){
      decision.mode='build';
      if(site)want=go(site);
    }else if(recipe){
      // The forge measures the camp from the base, the bot from the wall next to it: tap from close to the wall.
      if(toHome<FORGE_REACH){
        decision.mode='forge';
        if(tick-memory.lastForgeTick>=FORGE_GAP){decision.forge=recipe;memory.lastForgeTick=tick;}
      }else{decision.mode='forge';want=go(home);}
    }else if(goHome){
      decision.mode='home';
      if(toHome>CAMP_RADIUS-2)want=go(home);
    }else{
      const node=nodeFor(view.nodes??[],home,index,city&&(p=>botRouteDistance(city,p,home)));
      decision.mode='gather';
      if(node){
        // Stand just outside the node's edge, on our side of it (the room gathers within its radius + 0.9).
        const d=dist(at,node);
        if(d>.9)want=go(node);
      }
    }
    // Leftover critters of the wave still bite: keep a little distance while gathering.
    want=add(want,repel(view.enemies,at,.8));
    decision.direction=norm(want);
    return finish(decision,input);
  }
  // Combat.
  const boss=view.enemies.some(e=>e.boss),guard=index%2===0;
  // City: past the wave's timer its survivors walk back up the avenues (director beginRetreat, harmless), faster than a
  // bot, and vanish only out of everyone's sight: hunting one kept it in sight up to the 60 s cap, 120 u away (city-bots
  // seed 1, rounds 1, 2 and 5). Nobody hunts a retreating wave.
  const retreating=city&&view.round?.phase==='wave'&&view.tick>=view.round.phaseEndsTick;
  // City: the wave's very last critter, not at the wall, takes the guards out to the roamers' leash too (bot-caca:
  // both guards held at their short leash 6 u from it while the roamer walked with a person).
  const last=city&&guard&&!boss&&!retreating&&view.enemies.length===1;
  // The person's walk, read from where they were at the last decision (kept up to date whether escorting or not).
  const pace=escortPace(memory,input.escort,tick,terrain);
  // Walk with the team (room bots): a roamer goes with the nearest person who left the wall's leash, guards stay home.
  // bots-na-nossa-velocidade: also with one walking out of it (away from home), so it leaves with them, not 6 u behind.
  const escorting=!guard&&!!input.escort&&(dist(input.escort,home)>LEASH||!!pace&&outward(pace,input.escort,home));
  // City: a roamer with nobody to walk with hunts the wave's last few critters when none is near the wall (one stuck
  // between the plaza's planters or far down an avenue would hold the round until its cap), if the streets lead there.
  let prey=city&&!guard&&!escorting&&!boss&&!retreating&&view.enemies.length<=HUNT_LEFT&&!view.enemies.some(e=>dist(e,home)<LURE_REACH)?nearest(view.enemies,at):undefined;
  if(prey&&!way(prey,'huntGoal'))prey=undefined;
  const anchor=escorting?input.escort!:prey?{x:prey.x,y:prey.y}:home,chase:Chase|undefined=escorting?'escortGoal':prey?'huntGoal':undefined;
  const leash=escorting?ESCORT_LEASH:prey?HUNT_LEASH:boss?BOSS_LEASH:guard&&!last?GUARD_LEASH:LEASH;
  // City: the way to the anchor along the streets (undefined elsewhere: the straight line below).
  const b=city?way(anchor,chase)??toward(at,anchor):undefined;
  // How far out of the leash. City: once pulled back, all the way to HOME_SLACK inside the leash (no pacing on its edge
  // between planters), and nothing lures the bot out again on the way.
  const out=dist(at,anchor)-leash,homing=!!b&&(out>0||memory.homing===true&&out>-HOME_SLACK);
  if(b)memory.homing=homing;
  const close=view.enemies.filter(e=>dist(e,at)<DANGER);
  // Skill: something close and it is ready (the room answers whether it went off).
  // D-051: no skill in the manual combat.
  if(input.combat!=='manual'&&close.length&&(me.skillReadyTick??0)<=tick&&tick-memory.lastCastTick>=CAST_GAP){decision.cast=true;memory.lastCastTick=tick;}
  const fallen=rescueOf(view,selfId,at,terrain);
  const hpShare=me.maxHp>0?me.hp/me.maxHp:1;
  want=add(want,repel(view.enemies,at,hpShare<.4?2.2:1.4));
  // Hostile shots heading our way: sidestep.
  for(const s of view.projectiles){
    if(!s.hostile)continue;
    const rx=at.x-s.x,ry=at.y-s.y,d=Math.hypot(rx,ry),speed=Math.hypot(s.vx,s.vy);
    if(d>4||speed<1e-3)continue;
    const along=(rx*s.vx+ry*s.vy)/speed;
    if(along<=0)continue;
    const side=Math.sign(rx*s.vy-ry*s.vx)||1;
    want=add(want,{x:-s.vy/speed*side*1.2,y:s.vx/speed*side*1.2});
  }
  const walking=escorting&&!!pace&&!task;
  if(fallen?.at&&close.length<4){
    decision.mode='rescue';
    if(dist(fallen.at,at)>.7)want=add(want,go(fallen.at,2.2,'rescueGoal'));
  }else if(walking){
    // Walk with the person at their speed (ESCORT_WALKING): the way to them out of the leash, their heading inside it.
    decision.mode='escort';
    const r=dist(at,anchor),w=b??toward(at,anchor);
    want=add(want,r>leash?{x:w.x*3,y:w.y*3}:add({x:pace!.x*2,y:pace!.y*2},{x:w.x*r/leash,y:w.y*r/leash}));
  }else{
    decision.mode='fight';
    // Critters at the wall first (it falls for good), else one near home and not on top of us: weapons have range.
    const siege=nearest(view.enemies.filter(e=>dist(e,home)<SIEGE_REACH&&dist(e,at)<ENGAGE+4),at);
    // City: only what is in plain sight (a critter or a pickup behind a planter would pin the bot against it).
    // City: a lure the bot can answer without leaving the band where lures count (out < -ROAM_IN): a critter whose
    // stand-off point (DANGER+.6 short of it) or a pickup that lies there. One past it (a gem 7 u from the wall, before D-054) pulled the
    // bot out to the band's edge, where the lure stopped and the circle pulled it back in: pacing in place for seconds.
    const target=siege??nearestSeen(view.enemies.filter(e=>dist(e,anchor)<(b?leash-ROAM_IN+DANGER+.6:leash+3)&&dist(e,at)<ENGAGE),at);
    // City: a critter or a pickup lures the bot only well inside the leash; at its edge it holds (weapons have range).
    const roam=!b||!homing&&out<-ROAM_IN;
    if(target&&(siege||roam)&&dist(target,at)>(siege?input.nests&&view.objective?siegeStand(me.weapons):DANGER+.2:DANGER+.6))want=add(want,toward(at,target,siege?1.2:.7));
    // Pickups: hearts when hurt, everything else when nothing is close.
    const pickup=nearestSeen(view.pickups.filter(p=>dist(p,at)<6&&(p.kind!=='heal'||hpShare<.8)&&dist(p,anchor)<(b?leash-ROAM_IN:leash+4)),at);
    if(pickup&&roam&&close.length<2)want=add(want,toward(at,pickup,hpShare<.5&&pickup.kind==='heal'?1.6:.9));
    // Keep moving around the wall, or the person walked with (a still target gets surrounded).
    // City: across the way back along the streets, and only where that side is open (between the plaza's planters a
    // turn into one would have the bot pace against it, looking stuck: it holds its place instead).
    const r=dist(at,anchor);
    if(b&&r>.5){
      const t={x:b.y*memory.orbit,y:-b.x*memory.orbit};
      if(walkable({x:at.x+t.x*.8,y:at.y+t.y*.8},terrain))want=add(want,{x:t.x*.35,y:t.y*.35});
    }else if(r>.5){const t={x:-(at.y-anchor.y)/r*memory.orbit,y:(at.x-anchor.x)/r*memory.orbit};want=add(want,{x:t.x*.35,y:t.y*.35});}
    else want=add(want,{x:.3*memory.orbit,y:0});
  }
  // Home pulls harder the farther out we are (not on the way to a fallen friend: it held the rescuer back).
  if(decision.mode!=='rescue'&&!walking&&(out>0||homing)){const pull=Math.min(3,.5+Math.max(0,out)*.6);want=add(want,b?{x:b.x*pull,y:b.y*pull}:toward(at,anchor,pull));}
  if(decision.mode==='fight'&&task?.kind==='clear')decision.mode='clear';
  else if(decision.mode==='fight'&&escorting)decision.mode='escort';
  else if(decision.mode==='fight'&&!prey&&dist(at,home)>leash+2)decision.mode='home';
  // City: pulls that cancel out (a critter past the leash against the walk back, in a lane with no room to circle) hold
  // the bot where it stands, instead of a full step one way and the other each think.
  decision.direction=city&&Math.hypot(want.x,want.y)<HOLD_BELOW?{x:0,y:0}:norm(want);
  return finish(decision,input);
}

/**
 * D-052: the stick of a bot helping move the car. The sim counts a stick that points at the car from within
 * CAR_PUSH_REACH of its body, so the bot only ever does that with the heading itself:
 * - behind the car (its line to the car within CAR_LEAN_DOT of the heading), up to CAR_HELP_NEAR: the heading (it
 *   catches up, then pushes);
 * - farther: along the streets to its spot behind the car (CAR_LEAN off the body, CAR_SIDE to its side);
 * - near, inside the ring (CAR_RING u from the body: reach and a margin): around the body, the stick tangent to it
 *   (never at it) toward the back;
 * - near, outside the ring: to the ring's flank on its side, a little behind the body.
 */
function carHelp(at:Point,task:Extract<ObjectiveTask,{kind:'carro'}>,go:(to:Point,weight?:number,chase?:Chase)=>Point):Point{
  const car=task.at,h=task.heading,d=dist(at,car);
  if(task.rope){
    // puxar-uno-corda: to the rope's end, then on along the heading past the rope's length (the sim takes it then).
    const {nose,tip,held}=task.rope,ahead={x:nose.x+h.x*(CAR_ROPE+.6),y:nose.y+h.y*(CAR_ROPE+.6)};
    if(held||dist(at,tip)<=CAR_PULL_REACH*.6)return norm({x:ahead.x-at.x+h.x,y:ahead.y-at.y+h.y});
    return dist(at,tip)>CAR_HELP_NEAR?norm(go(tip,1,'carGoal')):toward(at,tip);
  }
  const rx=at.x-car.x,ry=at.y-car.y,lean=d>1e-6?-(rx*h.x+ry*h.y)/d:0;
  if(d<=CAR_HELP_NEAR&&lean>=CAR_LEAN_DOT)return h;
  // Its side of the car's line (the task's side when on the line): left of the heading is (−h.y, h.x).
  const cross=h.x*ry-h.y*rx,sign=Math.abs(cross)>.05?Math.sign(cross):task.side,side={x:-h.y*sign,y:h.x*sign};
  if(d>CAR_HELP_NEAR){
    const back=CAR_RADIUS+CAR_LEAN;
    return norm(go({x:car.x-h.x*back+side.x*CAR_SIDE,y:car.y-h.y*back+side.y*CAR_SIDE},1,'carGoal'));
  }
  if(d-CAR_RADIUS<=CAR_RING&&d>1e-6){
    // Tangent, turning toward the back: of the two, the one against the heading.
    const t={x:-ry/d,y:rx/d};
    return t.x*h.x+t.y*h.y<=0?t:{x:-t.x,y:-t.y};
  }
  return toward(at,{x:car.x+side.x*(CAR_RADIUS+CAR_RING+.2)-h.x*CAR_LEAN,y:car.y+side.y*(CAR_RADIUS+CAR_RING+.2)-h.y*CAR_LEAN});
}
/**
 * D-052: from this close (u) to the car a helper walks straight (farther: along the streets in the city); inside
 * CAR_RING u of the body it only circles (CAR_PUSH_REACH and a margin).
 */
const CAR_HELP_NEAR=4,CAR_RING=CAR_PUSH_REACH+.4;
/** Players carry positions on the wire (PlayerWireView); the view type does not say so. */
/**
 * The fallen friend this bot goes to: the nearest within RESCUE_REACH; else, up to RESCUE_FAR, one this bot is the
 * nearest standing bot to (ties: the lower id) and can reach in time (rescueFits).
 */
function rescueOf(view:RunView,selfId:string,at:Point,terrain:TerrainField|undefined):{p:PlayerRunView;at:Point}|undefined{
  const downs:{p:PlayerRunView;at:Point;d:number}[]=[];
  for(const p of view.players){
    if(p.id===selfId||!p.downed||p.eliminated||p.online===undefined)continue;
    const q=positionOf(p);if(q)downs.push({p,at:q,d:dist(q,at)});
  }
  if(!downs.length)return undefined;
  downs.sort((a,b)=>a.d-b.d);
  if(downs[0].d<RESCUE_REACH)return downs[0];
  const bots:{id:string;at:Point}[]=[];
  for(const p of view.players){
    if(p.id===selfId||!p.bot||p.downed||p.eliminated||p.spectator)continue;
    const q=positionOf(p);if(q)bots.push({id:p.id,at:q});
  }
  for(const f of downs){
    if(f.d>RESCUE_FAR)break;
    if(bots.some(b=>{const d=dist(b.at,f.at);return d<f.d||d===f.d&&b.id<selfId;}))continue;
    if(rescueFits(at,f.at,f.p.downed!.bleedOutTick-view.tick,terrain))return f;
  }
  return undefined;
}
/** A walk from `at` to a fallen friend (along the streets in the city) that leaves RESCUE_SPARE s of its `ticksLeft`. */
export function rescueFits(at:Point,to:Point,ticksLeft:number,terrain:TerrainField|undefined){
  const city=cityTerrainOf(terrain),walk=city?botRouteDistance(city,at,to):dist(at,to);
  return Number.isFinite(walk)&&walk/heroSpeed(terrain)+RESCUE_SPARE<=ticksLeft/HZ;
}
function positionOf(p:PlayerRunView):Point|undefined{const q=p as PlayerRunView&Partial<Point>;return Number.isFinite(q.x)&&Number.isFinite(q.y)?{x:q.x!,y:q.y!}:undefined;}
function add(a:Point,b:Point):Point{return {x:a.x+b.x,y:a.y+b.y};}
/** Walking away from home: the heading points away from it (from where they stand, at least ESCORT_OUTWARD_COS). */
const outward=(pace:Point,at:Point,home:Point)=>{
  const d=dist(at,home);
  return d>1e-6&&(pace.x*(at.x-home.x)+pace.y*(at.y-home.y))/d>=ESCORT_OUTWARD_COS;
};
/**
 * The heading (unit) of the person walked with, when they are walking (ESCORT_WALKING × the hero speed or more between
 * this decision and the last one, at most ESCORT_PACE_GAP s apart), else undefined. Notes where they are now.
 */
function escortPace(memory:BrainMemory,escort:Point|undefined,tick:number,terrain?:TerrainField):Point|undefined{
  const seen=memory.escortSeen;
  if(!escort){delete memory.escortSeen;return undefined;}
  memory.escortSeen={x:escort.x,y:escort.y,tick};
  if(!seen||!(tick>seen.tick)||tick-seen.tick>ESCORT_PACE_GAP*HZ)return undefined;
  const dx=escort.x-seen.x,dy=escort.y-seen.y,d=Math.hypot(dx,dy);
  return d>=ESCORT_WALKING*heroSpeed(terrain)*(tick-seen.tick)/HZ?{x:dx/d,y:dy/d}:undefined;
}
function nearest<T extends Point>(list:readonly T[],at:Point):T|undefined{let best:T|undefined,d=Infinity;for(const e of list){const x=dist(e,at);if(x<d){d=x;best=e;}}return best;}
function repel(enemies:readonly EnemyView[],at:Point,weight:number):Point{
  let x=0,y=0;
  for(const e of enemies){
    const d=dist(e,at),reach=DANGER*(e.boss?1.8:e.elite?1.3:1);
    if(d>=reach)continue;
    const w=((reach-d)/reach)**2*weight*(e.boss?2:1),n=d>1e-6?{x:(at.x-e.x)/d,y:(at.y-e.y)/d}:{x:1,y:0};
    x+=n.x*w*3;y+=n.y*w*3;
  }
  return {x,y};
}

/** Walls of trees and rocks: steer around them, and shake loose when the bot has not moved for a while. */
function finish(decision:Decision,input:BrainInput):Decision{
  const {at,terrain,memory,view}=input,tick=view.tick;
  const moving=Math.hypot(decision.direction.x,decision.direction.y)>.15;
  if(!moving){decision.direction={x:0,y:0};memory.lastPos=at;memory.lastMoveTick=tick;return decision;}
  if(tick<memory.unstickUntil&&memory.unstick){decision.direction=memory.unstick;decision.mode='unstick';return decision;}
  if(!memory.lastPos||dist(memory.lastPos,at)>.4){memory.lastPos=at;memory.lastMoveTick=tick;}
  else if(tick-memory.lastMoveTick>1.5*HZ){
    // Stuck against something: a perpendicular for a moment, alternating sides.
    memory.orbit=memory.orbit===1?-1:1;
    memory.unstick=norm({x:-decision.direction.y*memory.orbit+decision.direction.x*.2,y:decision.direction.x*memory.orbit+decision.direction.y*.2});
    memory.unstickUntil=tick+.8*HZ;memory.lastMoveTick=tick;memory.lastPos=at;
    decision.direction=memory.unstick;decision.mode='unstick';return decision;
  }
  decision.direction=clearPath(at,decision.direction,onFloor(terrain,at.andar));
  return decision;
}

// ---------------------------------------------------------------------------------------------------------------
// Tower defense (torres-sim)
// ---------------------------------------------------------------------------------------------------------------

/** What the forger knows of the tower defense (sim side: towerBrainView). */
export interface TowerBrainView {
  tick:number;
  /** The round the intermission comes before (round.index in 'prepare'). */
  round:number;
  /** The team's material (D-048: one pile; every UNITS_PER_TOKEN units are a ficha de torre): roots and the Gustavão. */
  units:number;
  /** The builder's own wallet, R$ (D-048; NEW-20261014-ORQ-carteira-e-pix): every other evolution and the tower repairs. */
  grana:number;
  /** Grana the towers never spend (decide fills it with granaReserve: the chaveiro's bill); unset: 0. */
  granaKeep?:number;
  /** x/y: the site's centre, where the bot walks to give the order (absent: the order goes out from anywhere). */
  sites:readonly {id:string;maxSize:number;x?:number;y?:number}[];
  /** The plan's rail id, or null (no Gustavão on this map); railAt: the rail's centre. */
  rail:string|null;railAt?:Point;railLaid:boolean;railReady:boolean;gustavoes:number;
  /** `person`: built (last paid) by a person who is here (bot-gasta-material): the bot never evolves nor repairs it. */
  defenses:readonly {id:string;kind:DefenseId;site:string;ready:boolean;ruined:boolean;person?:boolean;hp?:number;maxHp?:number;x?:number;y?:number}[];
  /** First tick an order may go out (room bots with a person here: their last seconds); unset: as soon as the bot is there. */
  orderFrom?:number;
}
/** A build (a site id, or the rail id to lay it), an upgrade (a defense id and the branch/child to take) or a repair. */
export type TowerOrder={build:string}|{upgrade:string;branch?:string}|{repair:string};

/** The bot gives a tower order this close to the obra's centre (u), inside the sim's BUILD_REACH (counted from its edge). */
export const TOWER_STAND=BUILD_REACH-.5;
/** With an orderFrom, the bot leaves its crate to reach the obra about this many ticks before it (it waits there). */
export const TOWER_EARLY=2*HZ;
/** A trip (there, the order, back into the base) is taken only when it ends at least this long before the round. */
export const TOWER_MARGIN=3*HZ;
/** City: the walk to a candidate obra is at most the straight line × this, or the walk through the base (the pick is checked on the streets). */
export const TOWER_DETOUR=1.6;

/**
 * The bot's view of the towers from the structures state and its build plan. `isPerson(owner)` (rooms): whether a
 * defense's owner is a person who is here, so the bot leaves it to them (bot-gasta-material). `orderFrom`: see the field.
 * `grana`: the builder's own wallet (NEW-20261014-ORQ-carteira-e-pix; default 0).
 */
export function towerBrainView(state:StonewardsState,plan:BuildPlan,tick:number,round:number,isPerson?:(owner:string)=>boolean,orderFrom?:number,grana=0):TowerBrainView{
  const t=state.defenses;
  return {tick,round,units:unitsOf(state.balance),grana,sites:plan.sites.map(s=>({id:s.id,maxSize:s.maxSize,x:s.x,y:s.y})),rail:plan.rail?.id??null,
    ...(plan.rail?{railAt:{x:plan.rail.x,y:plan.rail.y}}:{}),
    railLaid:!!t?.rail,railReady:!!t?.rail&&tick>=t.rail.readyTick,gustavoes:t?.gustavoes??0,
    defenses:(t?.list??[]).map(d=>({id:d.id,kind:d.kind,site:d.site,ready:tick>=d.readyTick,ruined:!!d.ruined,
      ...(isPerson?.(d.owner)?{person:true}:{}),hp:d.hp,maxHp:d.maxHp,x:d.x,y:d.y})),
    ...(orderFrom===undefined?{}:{orderFrom})};
}

const pointOf=(p:{x?:number;y?:number}|undefined)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x!,y:p.y!}:undefined;
/** Where the bot stands to give `order`: the site's or the rail's centre, the defense's own point; undefined: anywhere. */
export function orderSpot(v:TowerBrainView,order:TowerOrder):Point|undefined{
  if('build' in order)return order.build===v.rail?v.railAt:pointOf(v.sites.find(s=>s.id===order.build));
  const id='upgrade' in order?order.upgrade:order.repair;
  return pointOf(v.defenses.find(d=>d.id===id));
}

/** Branch a bot picks for the root on the n-th site of the plan (cycled): twice A, then B and C. */
export const BOT_BRANCHES:readonly Branch[]=Object.freeze(['A','B','A','C'] as Branch[]);
/** The forger keeps at least this many defenses standing before it evolves any. */
export const BOT_MIN_DEFENSES=2;
/** A defense of the bots at or under this share of its maxHp is repaired first, when the Grana pays it. */
export const BOT_TOWER_REPAIR_BELOW=.8;
/**
 * The Gustavão's line (torres-ajustes): the forger keeps this share of the next step of its B line (B2 → B5, the
 * Gustavão) aside (towerReserve) and evolves, builds or forges anything else only from what is left over, in that
 * step's own money (D-048): the evolutions B3–B5 in Grana (EVOLVE_PRICE), from the Obuseiro on the Gustavão's 3 fichas
 * (GUSTAVAO_COST units, its rail free, laid or not) out of the material the roots take: a 6-player team (~10 fichas a run)
 * still affords it, a smaller one never gets that far up the line.
 */
export const BOT_GUSTAVAO_SAVE=1;

type BrainDefense=TowerBrainView['defenses'][number];
/** Whether the bot can go and give an order at this point now (decide: there, the order, back into the base in time). */
export type TowerReach=(spot:Point)=>boolean;
/**
 * What a step takes (D-048, rules priceOf): material units (a root, the Gustavão: whole fichas) or Grana (every other
 * evolution); laying the rail is free. The two never mix, so neither money stands in for the other.
 */
export interface TowerCost {units:number;grana:number}
const FREE:TowerCost=Object.freeze({units:0,grana:0});
const costOf=(d:{id:string;tier:number}):TowerCost=>{const p=priceOf(d);return 'tokens' in p?{units:p.tokens*UNITS_PER_TOKEN,grana:0}:{units:0,grana:p.grana};};
const pays=(c:TowerCost,units:number,grana:number)=>units>=c.units&&grana>=c.grana;
const scaled=(c:TowerCost,k:number):TowerCost=>({units:Math.ceil(c.units*k),grana:Math.ceil(c.grana*k)});

/** The Gustavão's line: the bots' most advanced B defense (ties: plan order), while no Gustavão was built. */
function gustavaoLine(v:TowerBrainView,live:readonly BrainDefense[],at:(d:BrainDefense)=>number){
  if(v.gustavoes>=GUSTAVAO_LIMIT)return undefined;
  return live.filter(d=>!d.person&&DEFENSES[d.kind].branch==='B').sort((a,b)=>DEFENSES[b.kind].tier-DEFENSES[a.kind].tier||at(a)-at(b))[0];
}
const siteIndex=(v:TowerBrainView)=>{const index=new Map(v.sites.map((s,i)=>[s.id,i]));return (d:BrainDefense)=>index.get(d.site)??v.sites.length;};
const sizeAt=(v:TowerBrainView,i:number)=>v.sites[i]?.maxSize??3;

/** What the tower rule keeps aside for the Gustavão's line: BOT_GUSTAVAO_SAVE of its next step, in its money; FREE without one. */
function lineReserve(v:TowerBrainView):TowerCost{
  const at=siteIndex(v),line=gustavaoLine(v,v.defenses.filter(d=>!d.ruined),at);
  return line?scaled(lineCost(v,line,sizeAt(v,at(line))),BOT_GUSTAVAO_SAVE):FREE;
}
/** A root costs one whole ficha (D-048: TIER_COST[1] = TOWER_TOKENS.root × UNITS_PER_TOKEN); the sim pays its units. */
const ROOT_COST=DEFENSES[ROOT_DEFENSE].cost;
const wholeFicha=(units:number)=>tokensOf(units)>=TOWER_TOKENS.root&&units>=ROOT_COST;
/**
 * What the towers keep aside, in each money (decide: the forge spends only the Grana above `grana`):
 *  - units: a root's ficha while fewer than BOT_MIN_DEFENSES stand and a site is free; the Gustavão's 120 from the
 *    Obuseiro on; before the bots have a line (a map with a rail, no Gustavão yet) and a 3×3 root, the root that
 *    starts it;
 *  - grana: the line's next evolution, or before the bots have a line the B2 on their 3×3 root that starts it (the
 *    builder spends at the start of an intermission, the forge at its end).
 * Nothing when there is neither. D-048: the forge never takes material, so only `grana` holds it back.
 */
export function towerReserve(v:TowerBrainView):TowerCost{
  const at=siteIndex(v),live=v.defenses.filter(d=>!d.ruined),line=gustavaoLine(v,live,at),taken=new Set(live.map(d=>d.site));
  const rootSize=DEFENSES[ROOT_DEFENSE].size??1;
  const roots=live.length<BOT_MIN_DEFENSES&&v.sites.some(s=>!taken.has(s.id)&&s.maxSize>=rootSize)?ROOT_COST:0;
  if(line){const l=lineReserve(v);return {units:Math.max(roots,l.units),grana:l.grana};}
  if(!v.rail||v.gustavoes>=GUSTAVAO_LIMIT)return {units:roots,grana:0};
  const root=live.some(d=>!d.person&&d.kind===ROOT_DEFENSE&&sizeAt(v,at(d))>=3);
  const start=scaled(costOf(root?pickChild(ROOT_DEFENSE,'B')!:DEFENSES[ROOT_DEFENSE]),BOT_GUSTAVAO_SAVE);
  return {units:Math.max(roots,start.units),grana:start.grana};
}

/**
 * The forger's tower rule (deterministic, no randomness). `reach` (decide) leaves out the orders whose obra the bot
 * cannot go to and come back from in time (or at all: no street there); a person's defense is never the bots' to evolve
 * or repair (bot-gasta-material). D-048: roots and the Gustavão are paid in material (whole fichas), every other
 * evolution and a repair in Grana (`grana` less `granaKeep`, the chaveiro's bill), each step checked in its own money:
 *  1. repair the bots' most hurt defense at or under BOT_TOWER_REPAIR_BELOW, when the Grana pays it (TOWER_REPAIR_COST);
 *  2. fewer than BOT_MIN_DEFENSES standing and a free site: build the root on the largest free one (then plan order; a
 *     ruin's site counts as free) once the material holds a whole ficha;
 *  3. the Gustavão's line (the bots' most advanced B defense) takes its next step (the rail, free, is laid at the
 *     Obuseiro) when its money pays it; towerReserve keeps that step aside for the rest of the rule;
 *  4. the cheapest-tier evolution among the bots' other ready defenses, when what is left pays it (ties: plan order).
 *     Branch at the root: B on a 3×3 site while the bots have no line (on a map with a rail), else BOT_BRANCHES by the
 *     site's index (the next one that fits the site's size); at A3 the main line
 *     when the site fits A4, else A4b; at the Obuseiro the Gustavão (laying the rail first), while none was built;
 *  5. else fewer standing than min(DEFENSE_LIMIT, round + 1) and a free site: another root, when the material left
 *     over is a whole ficha;
 *  6. else save for one of those steps, or, with nothing to evolve, another root up to DEFENSE_LIMIT.
 * Returns the order, 'save' when the chosen step costs more than there is, or undefined when there is nothing to do
 * with towers now. Saving holds only the reserve: decide lets the forge spend the Grana above it.
 */
export function pickTowerOrder(v:TowerBrainView,reach:TowerReach=()=>true):TowerOrder|'save'|undefined{
  const live=v.defenses.filter(d=>!d.ruined),taken=new Set(live.map(d=>d.site));
  const near=(p:{x?:number;y?:number}|undefined)=>{const q=pointOf(p);return !q||reach(q);};
  const ok=(order:TowerOrder)=>{const q=orderSpot(v,order);return !q||reach(q);};
  const rootSize=DEFENSES[ROOT_DEFENSE].size??1;
  // The Grana the towers may spend: the chaveiro's bill (granaKeep) is never theirs.
  const grana=v.grana-(v.granaKeep??0);
  const share=(d:BrainDefense)=>d.maxHp!==undefined&&d.hp!==undefined&&d.maxHp>0?d.hp/d.maxHp:1;
  const hurt=live.filter(d=>!d.person&&share(d)<=BOT_TOWER_REPAIR_BELOW&&near(d)).sort((a,b)=>share(a)-share(b))[0];
  if(hurt&&grana>=TOWER_REPAIR_COST)return {repair:hurt.id};
  // The largest free site within reach first (room for the 3×3 tiers), then plan order.
  const free=v.sites.filter(s=>!taken.has(s.id)&&s.maxSize>=rootSize&&near(s)).sort((a,b)=>b.maxSize-a.maxSize)[0];
  const root=(order:TowerOrder)=>wholeFicha(v.units)?order:'save' as const;
  if(free&&live.length<BOT_MIN_DEFENSES)return root({build:free.id});
  const at=siteIndex(v),line=gustavaoLine(v,live,at);
  // No line yet on a map with a rail: the next root evolved on a 3×3 site starts it (B), whatever its site's index.
  const startLine=!line&&!!v.rail&&v.gustavoes<GUSTAVAO_LIMIT;
  const step=(d:BrainDefense)=>nextStep(v,d,at(d),sizeAt(v,at(d)),startLine);
  const next=line?.ready?step(line):undefined,lineStep=next&&ok(next.order)?next:undefined;
  if(lineStep&&pays(lineStep.cost,v.units,grana))return lineStep.order;
  // What is left over after the line's next step, in each money (the roots' material, the evolutions' Grana).
  const keep=lineReserve(v),units=v.units-keep.units,spare=grana-keep.grana;
  let best:{tier:number;at:number;cost:TowerCost;order:TowerOrder}|undefined;
  for(const d of live){
    // A person's defense is theirs to evolve (bot-gasta-material): the bot builds and evolves its own.
    if(!d.ready||d.person||d===line)continue;
    const s=step(d);
    if(!s||!ok(s.order))continue;
    const tier=DEFENSES[d.kind].tier;
    if(!best||tier<best.tier||tier===best.tier&&at(d)<best.at)best={tier,at:at(d),...s};
  }
  if(best&&pays(best.cost,units,spare))return best.order;
  if(free&&live.length<Math.min(DEFENSE_LIMIT,v.round+1)&&wholeFicha(units))return {build:free.id};
  if(best||lineStep||keep.units>0||keep.grana>0)return 'save';
  if(free&&live.length<DEFENSE_LIMIT)return root({build:free.id});
  return undefined;
}

/**
 * What the Gustavão's line saves for: its next tier that fits (R$), or the Gustavão (ready or not) whether its rail is
 * laid or not (D-048: the rail is free, so saving only for it would keep nothing back for the 3 fichas); FREE: nothing left.
 */
function lineCost(v:TowerBrainView,d:BrainDefense,size:number):TowerCost{
  const child=childrenOf(d.kind).find(c=>c.rail||(c.size??1)<=size);
  if(!child)return FREE;
  if(child.rail&&(!v.rail||v.gustavoes>=GUSTAVAO_LIMIT))return FREE;
  return costOf(child);
}

function nextStep(v:TowerBrainView,d:BrainDefense,at:number,size:number,startLine=false):{cost:TowerCost;order:TowerOrder}|undefined{
  const fits=(id:DefenseId)=>{const c=DEFENSES[id];return c.rail?true:(c.size??1)<=size;};
  const kids=childrenOf(d.kind);
  if(!kids.length)return undefined;
  if(d.kind===ROOT_DEFENSE){
    // The Gustavão's line needs a 3×3 site (the Lança-Foguetes and the Obuseiro).
    if(startLine&&size>=3)return {cost:costOf(pickChild(d.kind,'B')!),order:{upgrade:d.id,branch:'B'}};
    for(let k=0;k<BOT_BRANCHES.length;k++){
      const branch=BOT_BRANCHES[(at+k)%BOT_BRANCHES.length],child=pickChild(d.kind,branch);
      if(child&&fits(child.id))return {cost:costOf(child),order:{upgrade:d.id,branch}};
    }
    return undefined;
  }
  const child=kids.find(k=>fits(k.id));
  if(!child)return undefined;
  if(child.rail){
    if(!v.rail||v.gustavoes>=GUSTAVAO_LIMIT)return undefined;
    // Laying the rail is free (D-048: it is in the Gustavão's 3 fichas).
    if(!v.railLaid)return {cost:FREE,order:{build:v.rail}};
    if(!v.railReady)return undefined;
  }
  return {cost:costOf(child),order:{upgrade:d.id,...(kids.length>1?{branch:child.id}:{})}};
}
