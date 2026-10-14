/**
 * City run balance bench (NEW-20261012-ORQ-cidade-11-balanco-run): whole Cidade Nevada runs played by room bots, from
 * the wreck to the boss (or the wipe), headless, forcing world 'cidade' (no CITY_PLAYABLE flag needed).
 *
 * One run = `new Simulation(seed,{world:'cidade',terrain})` over the real asset (public/maps/cidade-nevada.json +
 * manifest hash, cityTerrainFrom, loaded once), N bots (`addBot`, classes from a fixed varied rotation of real class
 * ids), `resetRun()`, and the Room's bot driver (multiplayer/room.ts advance: `bots.think(sim)` before `sim.step()`,
 * `sim.botState=()=>bots.state()`). Between think and step the city navigation wrapper below re-aims the sticks.
 *
 * City navigation wrapper (harness only; src/sim/bot-brain.ts is untouched). The brain steers in straight lines with a
 * short wall dodge (clearPath), built for the open island; in the city a straight line to the plaza or to a crate
 * usually runs into a block of buildings. The wrapper models "a human who knows the way": it keeps the brain's choices
 * (what to do, fights, dodges, offers, skill, forge taps) and only replaces the stick direction with a walking
 * direction on a flow field when the brain's goal is far or the straight line is blocked:
 *  - grid: cityFlowGrid(city), the hero rule at each cell centre with the doors closed (the same cells the heroes'
 *    moveSafely accepts); heroes ignore the enemy-only barricades, so the fields are static (built once per process);
 *  - plaza field: goals = the plaza cells of the avenue planner (cityPlanner(city).plazaField cost 0), default wall
 *    penalty (keeps the walk off the walls);
 *  - crate fields: one FlowField per crate (goal = the crate's cell), built on first use and kept in a small LRU;
 *  - opening countdown (prepare of round 1, 3 s): stand still (a person reads the screen; the tutorial times the walk
 *    from the wave start); round 1 (tutorial walk): after READ_SECONDS, plaza field until inside the base, then the brain;
 *  - intermission (round ≥ 2): the brain's intent is recomputed with its own exported rules (homeOf, forger = first
 *    standing bot by slot once BOT_FORGE_LEFT is left, pickRecipe with the bot's refusals; the horn and the
 *    straight-line return estimate send it home) plus two human rules: head home when the time left is the real walk
 *    to the plaza (+ HOME_MARGIN s), and pick crates by WALKING distance (crateFor) instead of the brain's nodeFor
 *    (straight distance from the wall: in this city the straight-nearest crate is a 51 s walk, the next ones 15–16 s,
 *    so the brain's pick never comes back). A crate is kept while open and while the trip (there on its field +
 *    COLLECT_SECONDS + its walk back + HOME_MARGIN) fits in the time left; the next one is the first open crate no
 *    other bot targets that fits (walk order from the plaza when inside the base, so the team fans out over the
 *    nearest crates; straight distance from where it stands otherwise). Gathering itself is the sim's (standing at
 *    the crate). Home → plaza field until inside the base, then toward the wall (the forger: the brain's stick, which
 *    walks to the forge and taps it). Crate → its crate field until within CRATE_NEAR u with a clear segment, then
 *    straight onto it (stop within the brain's 0.9 u);
 *  - combat (round ≥ 2): the brain's stick, except (a) outside the base and farther than FAR u from the wall
 *    (stragglers after an intermission, a roamer pulled home) → plaza field, and (b) stuck (moved < STUCK_MOVE u in
 *    STUCK_TICKS while pushing) → plaza field for UNSTICK_TICKS when outside the base;
 *  - stuck anywhere else (crate walks, round 1): a perpendicular nudge for UNSTICK_TICKS, alternating sides;
 *  - downed / eliminated bots: untouched (the brain asks for help).
 * The stick is re-aimed every tick (the brain decides every BOT_THINK_EVERY ticks; its last direction is kept).
 *
 * Per run it records: outcome and cause, round reached / died, ticks, per round (wave start, first enemy of the round
 * inside the base → first arrival s, downs, eliminations, wall hp, barricades fallen when the stonewards state has
 * `barricades` (cidade-06), else null), per intermission (balance, gathered units in all and by player, spent, crates
 * emptied, purchases; D-048: one pile of units, a ficha de torre every UNITS_PER_TOKEN), forge purchases, the boss (spawn − wave start, first time inside the base, first hit on a
 * player, first wall hit, kill) and the navigation counters. The JSON is rewritten after EVERY run (tmp + rename).
 *
 * Tower defense (torres-sim, default on; --no-towers turns it off): the room bots build themselves since torres-fio
 * (RoomBots hands the builder the tower view; bot-brain pickTowerOrder), and since torres-ajustes the sim takes an
 * order only next to the obra (BUILD_REACH), so the builder walks there (Decision.mode 'build', RoomBots.modes): the
 * wrapper then leaves it the brain's stick (its street route). The harness only counts what went through
 * Simulation.build/upgrade/repair. Per run: orders, repairs, units spent, refusals, the defenses at the end, the
 * Gustavão, and the fichas de torre spent (D-048: a root is TOWER_TOKENS.root, the Gustavão TOWER_TOKENS.gustavao). --no-towers hides the tower view from the bots (RoomBots.towersOff).
 *
 * D-031: nothing here runs in npm test; tests/tools/city-run-summary.test.ts checks only the pure helpers below.
 *
 *   node --experimental-strip-types scripts/bench-city-run.ts [--seeds 1-16] [--players 1,3,6]
 *     [--out evidence/NEW-20261012-ORQ-cidade-11-balanco-run/balanco.json] [--resume] [--cap-min 30]
 *     [--knobs <city-balance.json>] [--priority low|normal]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {FlowField,STRAIGHT_COST,UNREACHABLE,clearSegment,heroSpeed,type Point} from '../src/maps/index.ts';
import {cityFlowGrid,cityPlanner} from '../src/sim/city/grid.ts';
import {cityLoot,type Crate} from '../src/sim/stonewards/loot.ts';
import {remainingOf} from '../src/sim/stonewards/resources.ts';
import {createRunSystems,type RunSystemsOptions} from '../src/sim/assemble.ts';
import {homeOf,pickRecipe,type BrainMemory} from '../src/sim/bot-brain.ts';
import {isStanding} from '../src/sim/revive.ts';
import {RECIPES,ROOT_DEFENSE,TOWER_TOKENS,classes,returnTicks,type RecipeId} from '../src/rules/index.ts';
import type {CityTerrain} from '../src/maps/index.ts';
import type {SimEvent} from '../src/contract/index.ts';
import {GRACE_MS,STEP_MS} from '../src/protocol/index.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {BOT_FORGE_LEFT,BOT_NAMES,RoomBots} from '../multiplayer/room-bots.ts';

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in tests/tools/city-run-summary.test.ts)
// ---------------------------------------------------------------------------------------------------------------

export const CARD='NEW-20261012-ORQ-cidade-11-balanco-run';
export const HZ=20;
/** Units of the three recipes (rules RECIPES: reparo 5, gambiarra 6, torre-chinelo 7). */
export const RECIPE_UNITS:Readonly<Record<string,number>>=Object.freeze(Object.fromEntries(Object.values(RECIPES).map(r=>[r.id,r.cost])));
export const RECIPE_MEAN_UNITS=Object.values(RECIPE_UNITS).reduce((a,b)=>a+b,0)/Object.values(RECIPE_UNITS).length;
/** Card targets: wins out of 16 per team size, and round 1 (tutorial) without deaths. */
export const WIN_TARGETS:Readonly<Record<number,readonly [number,number]>>=Object.freeze({6:[7,11],1:[2,6]});
export const TARGET_SEEDS=16;

export type Outcome='victory'|'defeat'|'timeout';
export type Cause='boss'|'team'|'wall'|'timeout';
/** Material (D-048: one pile of units since the coco/pedra piles merged; older JSON files had coco and pedra too). */
export interface Units {units:number}
export interface RoundRecord {
  round:number;
  waveStartTick:number|null;endTick:number|null;
  /** First tick an enemy of this round (memory.round) stood inside the base (planner insideBase); s after the wave start. */
  firstInsideBaseTick:number|null;firstArrivalS:number|null;
  downed:number;eliminated:number;revived:number;
  wallHpStart:number|null;wallHpEnd:number|null;
  /** Barricades fallen in this round; null while the stonewards state has no `barricades` (before cidade-06). */
  barricadesFallen:number|null;
}
export interface IntermissionRecord {
  /** The round this intermission comes before. */
  round:number;
  startTick:number;endTick:number|null;seconds:number|null;
  balanceStart:Units;balanceEnd:Units|null;
  /** What came out of the crates (balance end − start + spent), in units. */
  gathered:Units;
  /** What the forge (`forge`) and the tower orders (towerUnits) spent, in units. */
  spent:Units&{forge:number};
  /** Units gathered per player (stonewards `gathered` delta, rounded to 0.01). */
  perPlayer:Record<string,number>;
  cratesEmptied:number;
  purchases:RecipeId[];
  /** Units the tower orders spent in this intermission (torres-sim; absent with --no-towers). */
  towerUnits?:number;
}
export interface BossRecord {
  spawnTick:number;spawnAfterWaveS:number|null;maxHp:number;hpEnd:number|null;
  firstInsideBaseTick:number|null;firstInsideBaseS:number|null;
  firstPlayerHitTick:number|null;firstPlayerHitS:number|null;
  firstWallHitTick:number|null;firstWallHitS:number|null;
  killTick:number|null;killAfterSpawnS:number|null;
}
export interface RunRecord {
  key:string;seed:number;players:number;classes:string[];
  outcome:Outcome;cause:Cause;
  roundReached:number;diedRound:number|null;
  ticks:number;simMinutes:number;
  wallHpEnd:number;wallMaxHp:number;
  rounds:RoundRecord[];intermissions:IntermissionRecord[];
  forge:{count:number;byRecipe:Record<string,number>;list:{tick:number;round:number;recipe:RecipeId;by:string}[]};
  boss:BossRecord|null;
  nav:{
    /** Round 1: seconds after the wave start each bot first stood inside the base (null: never). */
    round1ArrivalS:Record<string,number|null>;
    /** Round 1: the director's tutorial arrival (first hero in the plaza), s after the wave start. */
    tutorialArrivalS:number|null;
    modeTicks:Record<string,number>;stuck:number;
    /** Crate targets picked by the wrapper (trips started). */
    crateTrips:number;
  };
  perf:{wallSeconds:number;msPerTick:number;thinkMsPerTick:number;navMsPerTick:number};
  knobsApplied:boolean;
  /**
   * Tower defense (torres-sim): orders applied, units spent, refusals by reason, standing defenses by kind at the end.
   * D-048: `roots` built and `tokens`, the fichas de torre they and the Gustavão took (absent in older JSON files).
   */
  towers?:{orders:number;repairs?:number;units:number;refused:Record<string,number>;final:Record<string,number>;ruined:number;gustavao:boolean;rail?:boolean;
    roots?:number;tokens?:number};
}
export interface NumStats {n:number;mean:number;min:number;median:number;max:number}

const r2=(v:number)=>Math.round(v*100)/100;
/** "1-16", "3", "1-4,9,12-13" → sorted unique integers. */
export function parseSeeds(spec:string):number[]{
  const out=new Set<number>();
  for(const part of spec.split(',').map(s=>s.trim()).filter(Boolean)){
    const m=/^(-?\d+)(?:-(-?\d+))?$/.exec(part);
    if(!m)throw new Error(`bad seed list: ${spec}`);
    const a=Number(m[1]),b=m[2]===undefined?a:Number(m[2]);
    for(let s=Math.min(a,b);s<=Math.max(a,b);s++)out.add(s);
  }
  return [...out].sort((a,b)=>a-b);
}
/** "1,3,6" → [1,3,6] (team sizes 1..6). */
export function parsePlayers(spec:string):number[]{
  const list=parseSeeds(spec);
  if(!list.length||list.some(n=>n<1||n>6))throw new Error(`players must be 1..6: ${spec}`);
  return list;
}
export const runKey=(seed:number,players:number)=>`${seed}:${players}`;
export function numStats(list:readonly number[]):NumStats|null{
  const s=list.filter(Number.isFinite).sort((a,b)=>a-b),n=s.length;
  if(!n)return null;
  return {n,mean:r2(s.reduce((a,b)=>a+b,0)/n),min:r2(s[0]),median:r2(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2),max:r2(s[n-1])};
}
/** Win range for `players` scaled to `seeds` runs (card targets are out of 16); undefined when the card sets none. */
export function winTarget(players:number,seeds:number):{min:number;max:number}|undefined{
  const t=WIN_TARGETS[players];
  return t&&{min:t[0]*seeds/TARGET_SEEDS,max:t[1]*seeds/TARGET_SEEDS};
}
export interface TeamSummary {
  players:number;runs:number;wins:number;winRate:number;
  causes:Record<Cause,number>;
  /** Defeats and timeouts by the round they ended in. */
  deathRounds:Record<string,number>;
  roundReached:NumStats|null;
  firstArrivalS:{all:NumStats|null;byRound:Record<string,NumStats|null>};
  loot:{unitsPerIntermission:NumStats|null;recipesPerIntermission:number|null;byRound:Record<string,NumStats|null>;purchasesPerRun:NumStats|null};
  round1:{downed:number;eliminated:number;defeats:number;tutorialArrivalS:NumStats|null};
  /** Barricades fallen per round (rounds ≥ 2, null when no run recorded barricades). */
  barricadesFallen:{perRound:NumStats|null;byRound:Record<string,NumStats|null>};
  boss:{spawnAfterWaveS:NumStats|null;firstInsideBaseS:NumStats|null;firstPlayerHitS:NumStats|null;killAfterSpawnS:NumStats|null;kills:number;reached:number};
  /** Runs with towers: roots built and fichas de torre spent per run (D-048; runs from older files without them are left out), Gustavões. */
  towers:{runs:number;rootsPerRun:NumStats|null;tokensPerRun:NumStats|null;gustavoes:number}|null;
  verdict:{wins:'ok'|'too-easy'|'too-hard'|'no-target';target:{min:number;max:number}|null;round1:'ok'|'deaths'};
}
export interface Summary {runs:number;byPlayers:Record<string,TeamSummary>;verdict:{ok:boolean;notes:string[]}}

/** Aggregates finished runs per team size (pure: records in, numbers out). */
export function summarize(runs:readonly RunRecord[]):Summary{
  const sizes=[...new Set(runs.map(r=>r.players))].sort((a,b)=>a-b),byPlayers:Record<string,TeamSummary>={},notes:string[]=[];
  for(const n of sizes){
    const list=runs.filter(r=>r.players===n),wins=list.filter(r=>r.outcome==='victory').length;
    const causes:Record<Cause,number>={boss:0,team:0,wall:0,timeout:0};
    const deathRounds:Record<string,number>={};
    for(const r of list){causes[r.cause]++;if(r.outcome!=='victory')deathRounds[r.roundReached]=(deathRounds[r.roundReached]??0)+1;}
    const rounds=list.flatMap(r=>r.rounds),roundIds=[...new Set(rounds.map(x=>x.round))].sort((a,b)=>a-b);
    const arrivals=rounds.filter(x=>x.round>1);
    const byRound:Record<string,NumStats|null>={};
    for(const id of roundIds)byRound[id]=numStats(rounds.filter(x=>x.round===id).map(x=>x.firstArrivalS??NaN));
    const inter=list.flatMap(r=>r.intermissions).filter(i=>i.endTick!==null),lootByRound:Record<string,NumStats|null>={};
    for(const id of [...new Set(inter.map(i=>i.round))].sort((a,b)=>a-b))lootByRound[id]=numStats(inter.filter(i=>i.round===id).map(i=>i.gathered.units));
    const units=numStats(inter.map(i=>i.gathered.units));
    const r1=rounds.filter(x=>x.round===1);
    const bosses=list.map(r=>r.boss).filter((b):b is BossRecord=>!!b);
    const target=winTarget(n,list.length)??null;
    const winsVerdict=!target?'no-target':wins<target.min?'too-hard':wins>target.max?'too-easy':'ok';
    const r1Deaths=r1.reduce((s,x)=>s+x.eliminated,0)+list.filter(r=>r.outcome!=='victory'&&r.roundReached<=1).length;
    const towered=list.map(r=>r.towers).filter((t):t is NonNullable<RunRecord['towers']>=>!!t);
    byPlayers[n]={
      players:n,runs:list.length,wins,winRate:list.length?r2(wins/list.length):0,causes,deathRounds,
      roundReached:numStats(list.map(r=>r.roundReached)),
      firstArrivalS:{all:numStats(arrivals.map(x=>x.firstArrivalS??NaN)),byRound},
      loot:{unitsPerIntermission:units,recipesPerIntermission:units?r2(units.mean/RECIPE_MEAN_UNITS):null,byRound:lootByRound,purchasesPerRun:numStats(list.map(r=>r.forge.count))},
      round1:{downed:r1.reduce((s,x)=>s+x.downed,0),eliminated:r1.reduce((s,x)=>s+x.eliminated,0),defeats:list.filter(r=>r.outcome!=='victory'&&r.roundReached<=1).length,
        tutorialArrivalS:numStats(list.map(r=>r.nav.tutorialArrivalS??NaN))},
      barricadesFallen:{perRound:numStats(arrivals.map(x=>x.barricadesFallen??NaN)),
        byRound:Object.fromEntries(roundIds.filter(id=>id>1).map(id=>[id,numStats(rounds.filter(x=>x.round===id).map(x=>x.barricadesFallen??NaN))]))},
      boss:{spawnAfterWaveS:numStats(bosses.map(b=>b.spawnAfterWaveS??NaN)),firstInsideBaseS:numStats(bosses.map(b=>b.firstInsideBaseS??NaN)),
        firstPlayerHitS:numStats(bosses.map(b=>b.firstPlayerHitS??NaN)),killAfterSpawnS:numStats(bosses.map(b=>b.killAfterSpawnS??NaN)),
        kills:bosses.filter(b=>b.killTick!==null).length,reached:bosses.length},
      towers:towered.length?{runs:towered.length,rootsPerRun:numStats(towered.map(t=>t.roots??NaN)),tokensPerRun:numStats(towered.map(t=>t.tokens??NaN)),
        gustavoes:towered.filter(t=>t.gustavao).length}:null,
      verdict:{wins:winsVerdict,target,round1:r1Deaths?'deaths':'ok'},
    };
    if(target&&winsVerdict!=='ok')notes.push(`${n}p: ${wins}/${list.length} wins, target ${r2(target.min)}–${r2(target.max)} (${winsVerdict})`);
    if(r1Deaths)notes.push(`${n}p: ${r1Deaths} death(s) in round 1`);
  }
  return {runs:runs.length,byPlayers,verdict:{ok:!notes.length,notes}};
}
/** One line per run for the console. */
export function runLine(r:RunRecord):string{
  const arrivals=r.rounds.filter(x=>x.round>1).map(x=>x.firstArrivalS).filter((v):v is number=>v!==null);
  const loot=r.intermissions.map(i=>i.gathered.units);
  return `seed ${r.seed} ${r.players}p: ${r.outcome}/${r.cause} round ${r.roundReached} | ${r.simMinutes} min sim | arrival ${arrivals.length?r2(Math.min(...arrivals)):'-'}s min | `+
    `loot/int ${loot.length?r2(loot.reduce((a,b)=>a+b,0)/loot.length):'-'}u | forge ${r.forge.count} | boss ${r.boss?`+${r.boss.spawnAfterWaveS}s kill ${r.boss.killAfterSpawnS??'-'}s`:'-'} | `+
    `${r.towers?`towers ${r.towers.orders} orders ${r.towers.units}u ${r.towers.roots??'-'} roots ${r.towers.tokens??'-'} fichas end ${Object.values(r.towers.final).reduce((a,b)=>a+b,0)}${r.towers.gustavao?' +Gustavão':''} ruined ${r.towers.ruined} | `:''}`+
    `${r.perf.msPerTick} ms/tick ${r.perf.wallSeconds}s`;
}

// ---------------------------------------------------------------------------------------------------------------
// City navigation wrapper (see the module doc)
// ---------------------------------------------------------------------------------------------------------------

/** Round 1: seconds a person reads the banner before walking (TUTORIAL_PLAN.behindAt's note: read ~4 s, then walk). */
export const READ_SECONDS=4;
/** Extra seconds over the real walk home at which a person leaves the crates. */
export const HOME_MARGIN=4;
/** Within this (u) of the crate, with a clear segment, the bot walks straight onto it. */
export const CRATE_NEAR=2.5;
/** Combat: farther than this (u) from the wall and outside the base, the bot takes the plaza field. */
export const FAR=12;
export const STUCK_TICKS=30,STUCK_MOVE=.3,UNSTICK_TICKS=16;
const CRATE_CACHE=24;
/** Seconds counted for standing at a crate (gather of one unit, 0.8–1.2 s, plus slack). */
export const COLLECT_SECONDS=1.5;
const PICK_TRIES=6;

type Mode='hold'|'plaza'|'crate'|'crate-near'|'brain'|'home-wall'|'unstick'|'build';
interface NavBot {brain:Point;anchor:Point;anchorTick:number;pushing:number;unstickUntil:number;unstickDir:Point;side:1|-1}

const norm=(v:Point):Point=>{const l=Math.hypot(v.x,v.y);return l>1e-6?{x:v.x/l,y:v.y/l}:{x:0,y:0};};
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

export class CityNavigator {
  readonly grid:ReturnType<typeof cityFlowGrid>;
  readonly plaza:FlowField;
  readonly insideBase:(p:Point)=>boolean;
  private crates=new Map<string,FlowField>();
  constructor(city:CityTerrain){
    this.grid=cityFlowGrid(city);
    const planner=cityPlanner(city),goals:Point[]=[],cs=this.grid.cellSize;
    for(let cy=0;cy<this.grid.height;cy++)for(let cx=0;cx<this.grid.width;cx++)if(planner.plazaField.cellCost(cx,cy)===0)goals.push({x:(cx+.5)*cs,y:(cy+.5)*cs});
    this.plaza=new FlowField(this.grid,goals);
    this.insideBase=p=>planner.insideBase(p);
  }
  crateField(id:string,at:Point):FlowField{
    let f=this.crates.get(id);
    if(f){this.crates.delete(id);this.crates.set(id,f);return f;}
    f=new FlowField(this.grid,[at]);
    this.crates.set(id,f);
    if(this.crates.size>CRATE_CACHE)this.crates.delete(this.crates.keys().next().value!);
    return f;
  }
}

/** Per tick, after bots.think: re-aims every bot's stick (see the module doc). Returns the mode per bot. */
export class NavDriver {
  readonly bots=new Map<string,NavBot>();
  readonly modeTicks:Record<string,number>={};
  stuck=0;
  /** Crate trips started (a crate picked as the bot's target). */
  trips=0;
  private targets=new Map<string,Crate>();
  private targetsRound=-1;
  private readonly loot:NonNullable<ReturnType<typeof cityLoot>>;
  private readonly speed:number;
  readonly nav:CityNavigator;readonly sim:Simulation;readonly room:RoomBots;
  private readonly setStick:(id:string,d:Point)=>void;
  constructor(nav:CityNavigator,sim:Simulation,room:RoomBots,setStick:(id:string,d:Point)=>void){
    this.nav=nav;this.sim=sim;this.room=room;this.setStick=setStick;
    this.loot=cityLoot(sim.terrain)!;this.speed=heroSpeed(sim.terrain);
  }
  /** The brain's last stick for a bot (captured from setBotInput during think). */
  brainSaid(id:string,d:Point){const b=this.bot(id);b.brain={x:d.x,y:d.y};}
  private bot(id:string):NavBot{
    let b=this.bots.get(id);
    if(!b){const p=this.sim.players.get(id)!;b={brain:{x:0,y:0},anchor:{x:p.x,y:p.y},anchorTick:this.sim.tick,pushing:0,unstickUntil:-1,unstickDir:{x:0,y:0},side:1};this.bots.set(id,b);}
    return b;
  }
  step(waveStartTick:number|null){
    const sim=this.sim,w=sim.world,round=w.round,tick=w.tick;
    const minds=this.room.state() as {id:string;slot:number;memory:BrainMemory}[];
    let view:ReturnType<Simulation['botView']>|undefined,forger:string|null|undefined;
    for(const mind of minds){
      const p=sim.players.get(mind.id);
      if(!p)continue;
      const b=this.bot(mind.id);
      if(!isStanding(p)){this.count('down');continue;}
      let mode:Mode='brain',dir:Point=b.brain;
      const inside=this.nav.insideBase(p),wall=sim.run.stonewards.state.wall;
      if(round.phase==='prepare'&&round.index<=1){mode='hold';dir={x:0,y:0};}
      else if(round.index<=1){
        const reading=waveStartTick!==null&&tick-waveStartTick<READ_SECONDS*HZ;
        if(reading){mode='hold';dir={x:0,y:0};}
        else if(!inside){mode='plaza';dir=this.field(this.nav.plaza,p,b.brain);}
      }else if(round.phase==='prepare'&&this.room.modes.get(mind.id)==='build'){mode='build';dir=b.brain;}
      else if(round.phase==='prepare'){
        view??=sim.botView();
        if(forger===undefined)forger=this.forger(view,minds);
        const home=homeOf(view,p),toHome=dist(p,home),left=round.phaseEndsTick-tick;
        const recipe=forger===mind.id?pickRecipe(view,mind.memory.refused):undefined;
        const walk=this.loot.distanceToPlaza(p);
        const goHome=view.camp?.hornEndsTick!==undefined||left<=returnTicks(toHome,this.speed)+4*HZ||
          walk!==undefined&&left<=Math.ceil((walk/this.speed+HOME_MARGIN)*HZ);
        const node=recipe||goHome?undefined:this.crateFor(mind.id,p,inside,left)?.node;
        if(!node){
          if(!inside){mode='plaza';dir=this.field(this.nav.plaza,p,b.brain);}
          else if(recipe)mode='brain';
          else{mode='home-wall';dir=toHome>4?norm({x:home.x-p.x,y:home.y-p.y}):{x:0,y:0};}
        }else{
          const d=dist(p,node);
          if(d<=CRATE_NEAR&&clearSegment(p,node,sim.terrain)){mode='crate-near';dir=d>.9?norm({x:node.x-p.x,y:node.y-p.y}):{x:0,y:0};}
          else{mode='crate';dir=this.field(this.nav.crateField(node.id,node),p,b.brain);}
        }
      }else if(!inside&&dist(p,wall)>FAR){mode='plaza';dir=this.field(this.nav.plaza,p,b.brain);}
      // Stuck: pushing without moving.
      const pushing=Math.hypot(dir.x,dir.y)>.15;
      if(tick<b.unstickUntil&&pushing){mode='unstick';dir=b.unstickDir;}
      else if(pushing){
        if(dist(p,b.anchor)>STUCK_MOVE){b.anchor={x:p.x,y:p.y};b.anchorTick=tick;}
        else if(tick-b.anchorTick>=STUCK_TICKS){
          this.stuck++;b.side=b.side===1?-1:1;b.anchor={x:p.x,y:p.y};b.anchorTick=tick;b.unstickUntil=tick+UNSTICK_TICKS;
          const combat=round.phase!=='prepare'&&round.index>1;
          b.unstickDir=combat&&!inside?this.field(this.nav.plaza,p,dir):norm({x:-dir.y*b.side+dir.x*.2,y:dir.x*b.side+dir.y*.2});
          mode='unstick';dir=b.unstickDir;
        }
      }else{b.anchor={x:p.x,y:p.y};b.anchorTick=tick;}
      this.count(mode);
      this.setStick(mind.id,dir);
    }
  }
  /**
   * The crate a person who knows the way walks to: the bot keeps its crate while it has something left and the trip
   * (walk there on the crate's field + COLLECT_SECONDS + its walk back to the plaza + HOME_MARGIN) fits in the time
   * left; else it takes the first open crate nobody else is heading for that fits, in walking order from the plaza
   * when inside the base (bots pick in slot order, so a team fans out over the nearest crates), by straight distance
   * from where it stands otherwise. At most PICK_TRIES candidates are measured per pick. Undefined: none fits.
   */
  private crateFor(id:string,p:Point,inside:boolean,left:number){
    const round=this.sim.world.round.index,st=this.sim.run.stonewards.state;
    if(this.targetsRound!==round){this.targets.clear();this.targetsRound=round;}
    const open=(c:Crate)=>remainingOf(st,c.node)>0;
    const fits=(c:Crate)=>{
      const cost=this.nav.crateField(c.node.id,c.node).costAt(p.x,p.y);
      if(cost===UNREACHABLE)return false;
      const there=cost/STRAIGHT_COST*this.nav.grid.cellSize/this.speed;
      return (there+COLLECT_SECONDS+c.seconds+HOME_MARGIN)*HZ<=left;
    };
    const mine=this.targets.get(id);
    if(mine&&open(mine)&&fits(mine))return mine;
    this.targets.delete(id);
    const taken=new Set([...this.targets.values()].map(c=>c.node.id));
    const list=this.loot.crates.filter(c=>open(c)&&!taken.has(c.node.id))
      .sort(inside?(a,b)=>a.seconds-b.seconds||a.node.id.localeCompare(b.node.id):(a,b)=>dist(a.node,p)-dist(b.node,p)||a.node.id.localeCompare(b.node.id));
    for(const c of list.slice(0,PICK_TRIES))if(fits(c)){this.targets.set(id,c);this.trips++;return c;}
    return undefined;
  }
  private field(f:FlowField,p:Point,fallback:Point):Point{
    const d=f.directionAt(p.x,p.y);
    return Math.hypot(d.x,d.y)>1e-6?{x:d.x,y:d.y}:fallback;
  }
  /** RoomBots.forger: the first standing bot by slot, only once BOT_FORGE_LEFT is left in the intermission. */
  private forger(view:ReturnType<Simulation['botView']>,minds:readonly {id:string;slot:number}[]):string|null{
    const round=view.round;
    if(round?.phase!=='prepare'||round.phaseEndsTick-view.tick>BOT_FORGE_LEFT)return null;
    for(const m of [...minds].sort((a,b)=>a.slot-b.slot)){
      const p=view.players.find(q=>q.id===m.id);
      if(p&&p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0)return m.id;
    }
    return null;
  }
  private count(mode:string){this.modeTicks[mode]=(this.modeTicks[mode]??0)+1;}
}

// ---------------------------------------------------------------------------------------------------------------
// Knobs (part B: src/sim/city/balance.ts, `cityBalance` option); a no-op with a warning until it lands
// ---------------------------------------------------------------------------------------------------------------

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
type KnobRoute='simulation'|'assemble'|'none';
/** Where `cityBalance` can be injected in this checkout (B adds the option; until then the knobs are ignored). */
function knobRoute():KnobRoute{
  const read=(rel:string)=>{try{return fs.readFileSync(path.join(ROOT,rel),'utf8');}catch{return '';}};
  if(!fs.existsSync(path.join(ROOT,'src/sim/city/balance.ts')))return 'none';
  if(/cityBalance/.test(read('multiplayer/simulation.ts')))return 'simulation';
  if(/cityBalance/.test(read('src/sim/assemble.ts')))return 'assemble';
  return 'none';
}
/**
 * Assembles this Simulation's runs with `cityBalance` (Simulation without the option, B in createRunSystems only):
 * the same options Simulation.assemble passes (bot sticks; no people in the bench), plus the knobs.
 */
function injectAssemble(sim:Simulation,cityBalance:unknown){
  const s=sim as unknown as {assemble:()=>unknown;world:Simulation['world'];botInputs:Map<string,{seq:number;x:number;y:number;attack:boolean;skill?:boolean}>;
    botSeq:number;result?:string;pending?:Record<string,boolean>;zueiraLab?:Simulation['zueiraLab']};
  s.assemble=function(){
    const options={
      takeInput:(id:string)=>{const bot=s.botInputs.get(id);if(!bot)return undefined;const step={...bot,seq:++s.botSeq};if(bot.skill)bot.skill=false;return step;},
      onOutcome:(outcome:string)=>{if(s.result)return;if(s.pending)s.pending[outcome]=true;else s.result=outcome;},
      reconnectGraceTicks:Math.round(GRACE_MS/STEP_MS),zueiraLab:s.zueiraLab,...({cityBalance} as object),
    } as RunSystemsOptions;
    return createRunSystems(s.world,options);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------------------------

/** Fixed varied rotation of real class ids (every sixth of the roster, from the first). */
export function classRotation(ids:readonly string[],count=6):string[]{
  const step=Math.max(1,Math.floor(ids.length/count));
  return Array.from({length:count},(_,i)=>ids[(i*step)%ids.length]);
}
const CLASS_ROTATION=classRotation(classes.map(c=>c.id));

interface RunOptions {seed:number;players:number;capTicks:number;city:CityTerrain;nav:CityNavigator;knobs?:unknown;route:KnobRoute;towers:boolean}

/**
 * Barricades (cidade-06) read generically from the stonewards state: id → down, or null when the state has no
 * `barricades` (before cidade-06). Down = `down`/`fallen`/`broken` true or hp ≤ 0. Detected at runtime.
 */
export function barricadeStates(st:unknown):Map<string,boolean>|null{
  const list=(st as {barricades?:unknown}).barricades;
  if(list===undefined||list===null||typeof list!=='object')return null;
  const items=Array.isArray(list)?list:Object.values(list as object),out=new Map<string,boolean>();
  items.forEach((b,i)=>{
    const x=b as {id?:unknown;hp?:number;down?:boolean;fallen?:boolean;broken?:boolean};
    out.set(typeof x.id==='string'?x.id:String(i),x.down===true||x.fallen===true||x.broken===true||(typeof x.hp==='number'&&x.hp<=0));
  });
  return out;
}
/** Barricades that went from up to down between two reads (a barricade raised again and felled again counts twice). */
export function barricadesFell(before:ReadonlyMap<string,boolean>|null,after:ReadonlyMap<string,boolean>|null):number{
  if(!after)return 0;
  let n=0;
  for(const [id,down] of after)if(down&&before?.get(id)===false)n++;
  return n;
}

function playRun(o:RunOptions):RunRecord{
  const knobsApplied=o.knobs!==undefined&&o.route!=='none';
  const sim=new Simulation(o.seed,{world:'cidade',terrain:o.city,...(knobsApplied&&o.route==='simulation'?{cityBalance:o.knobs}:{})} as ConstructorParameters<typeof Simulation>[1]);
  if(knobsApplied&&o.route==='assemble')injectAssemble(sim,o.knobs);
  const room=new RoomBots();
  const ids:string[]=[],cls:string[]=[];
  for(let i=0;i<o.players;i++){
    const id=`bot${i+1}`,classId=CLASS_ROTATION[i%CLASS_ROTATION.length];
    sim.addBot(id,BOT_NAMES[i%BOT_NAMES.length],classId);room.add(id,i);ids.push(id);cls.push(classId);
  }
  sim.botState=()=>room.state();
  sim.resetRun();room.reset();
  // Capture the brain's sticks (think → setBotInput) and the forge buys; the wrapper sets the final stick.
  const setStick=sim.setBotInput.bind(sim),forge=sim.forge.bind(sim);
  const driver=new NavDriver(o.nav,sim,room,(id,d)=>setStick(id,d));
  sim.setBotInput=(id,d,skill=false)=>{driver.brainSaid(id,d);setStick(id,d,skill);};
  const purchases:RunRecord['forge']['list']=[];
  const rounds:RoundRecord[]=[],inter:IntermissionRecord[]=[];
  let cur:RoundRecord|undefined,curInter:IntermissionRecord|undefined;
  // A buy goes into the open intermission (the one before round r has round index r).
  // Tower defense (see the module doc): the room bots order through the Simulation; count what goes through.
  const tw={orders:0,repairs:0,units:0,roots:0,gustavoes:0,refused:{} as Record<string,number>};
  if(!o.towers)room.towersOff=true;
  const count=(run:()=>ReturnType<Simulation['build']>,repair=false)=>{
    const s=sim.run.stonewards,before=s.state.balance.units,r=run();
    if(r.ok){
      const spent=before-s.state.balance.units;
      tw.orders++;if(repair)tw.repairs++;tw.units+=spent;if(curInter)curInter.towerUnits=(curInter.towerUnits??0)+spent;
      if(!repair&&r.kind===ROOT_DEFENSE)tw.roots++;else if(!repair&&r.kind==='gustavao')tw.gustavoes++;
    }else tw.refused[r.reason]=(tw.refused[r.reason]??0)+1;
    return r;
  };
  const build=sim.build.bind(sim),upgrade=sim.upgrade.bind(sim),repair=sim.repair.bind(sim);
  sim.build=(id,site,req)=>count(()=>build(id,site,req));
  sim.upgrade=(id,defense,branch,req)=>count(()=>upgrade(id,defense,branch,req));
  sim.repair=(id,defense,req)=>count(()=>repair(id,defense,req),true);
  sim.forge=(id,recipe,req)=>{
    const r=forge(id,recipe,req);
    if(r.ok){purchases.push({tick:sim.tick,round:sim.world.round.index,recipe:r.recipe as RecipeId,by:id});curInter?.purchases.push(r.recipe as RecipeId);}
    return r;
  };
  let interGathered:Record<string,number>={},boss:BossRecord|undefined,bossId:string|undefined;
  let waveStart:number|null=null,barricades=barricadeStates(sim.run.stonewards.state);
  const r1Arrival:Record<string,number|null>=Object.fromEntries(ids.map(id=>[id,null]));
  const st=()=>sim.run.stonewards.state;
  const closeInter=(tick:number)=>{
    if(!curInter)return;
    const s=st(),forged=curInter.purchases.reduce((a,r)=>a+RECIPES[r].cost,0),towerUnits=curInter.towerUnits??0;
    curInter.endTick=tick;curInter.seconds=r2((tick-curInter.startTick)/HZ);curInter.balanceEnd={units:r2(s.balance.units)};
    curInter.gathered={units:r2(s.balance.units-curInter.balanceStart.units+forged+towerUnits)};
    curInter.spent={units:r2(forged+towerUnits),forge:forged};
    for(const id of ids)curInter.perPlayer[id]=r2((s.gathered[id]??0)-(interGathered[id]??0));
    curInter.cratesEmptied=s.nodes.filter(n=>n.remaining<=0).length;
    curInter=undefined;
  };
  const closeRound=(tick:number)=>{
    if(!cur)return;
    cur.endTick=tick;cur.wallHpEnd=Math.round(st().wall.hp);
    cur=undefined;
  };

  const started=performance.now();
  let navMs=0,ticks=0;
  const thinkBefore=room.thinkMs;
  while(!sim.outcome&&sim.tick<o.capTicks){
    room.think(sim);
    const n0=performance.now();driver.step(waveStart);navMs+=performance.now()-n0;
    const events=sim.step();ticks++;
    const w=sim.world,tick=w.tick;
    for(const e of events as readonly SimEvent[]){
      if(e.type==='round'){
        if(e.phase==='prepare'&&e.index>1){
          closeRound(tick);
          curInter={round:e.index,startTick:tick,endTick:null,seconds:null,balanceStart:{units:r2(st().balance.units)},balanceEnd:null,gathered:{units:0},spent:{units:0,forge:0},perPlayer:{},cratesEmptied:0,purchases:[]};
          interGathered={...st().gathered};inter.push(curInter);
        }else if(e.phase==='wave'){
          closeInter(tick);closeRound(tick);waveStart=tick;
          cur={round:e.index,waveStartTick:tick,endTick:null,firstInsideBaseTick:null,firstArrivalS:null,downed:0,eliminated:0,revived:0,wallHpStart:Math.round(st().wall.hp),wallHpEnd:null,barricadesFallen:barricades?0:null};
          rounds.push(cur);
        }else if(e.phase==='end')closeRound(tick);
      }else if(cur&&e.type==='downed')cur.downed++;
      else if(cur&&e.type==='eliminated')cur.eliminated++;
      else if(cur&&e.type==='revived')cur.revived++;
      else if(e.type==='damage'&&boss&&bossId&&e.source===bossId&&sim.players.has(e.target)&&boss.firstPlayerHitTick===null){boss.firstPlayerHitTick=tick;}
      else if(e.type==='kill'&&bossId&&e.enemy===bossId&&boss&&boss.killTick===null)boss.killTick=tick;
      else if(e.type==='structure'&&e.id==='muralha'&&boss&&bossId&&boss.firstWallHitTick===null){
        const b=w.enemies.get(bossId),wall=st().wall;
        if(b&&dist(b,wall)<=b.radius+.8+.6)boss.firstWallHitTick=tick;
      }
    }
    // Barricades: every up → down while a round is open counts for that round (they start down in round 1 and go
    // up in round 2's prepare, cidade-06: going up is not a fall).
    const nowBarricades=barricadeStates(st());
    if(nowBarricades){const fell=barricadesFell(barricades,nowBarricades);if(cur)cur.barricadesFallen=(cur.barricadesFallen??0)+fell;}
    barricades=nowBarricades;
    if(cur&&w.round.phase==='wave'){
      if(cur.firstInsideBaseTick===null){
        for(const e of w.enemies.values())if((e.memory as {round?:number}|undefined)?.round===cur.round&&!e.boss&&o.nav.insideBase(e)){
          cur.firstInsideBaseTick=tick;cur.firstArrivalS=r2((tick-(cur.waveStartTick??tick))/HZ);break;
        }
      }
      if(cur.round===1)for(const id of ids){const p=sim.players.get(id);if(r1Arrival[id]===null&&p&&o.nav.insideBase(p))r1Arrival[id]=r2((tick-(cur.waveStartTick??tick))/HZ);}
      if(!bossId){
        for(const e of w.enemies.values())if(e.boss){
          bossId=e.id;
          boss={spawnTick:tick,spawnAfterWaveS:cur.waveStartTick===null?null:r2((tick-cur.waveStartTick)/HZ),maxHp:Math.round(e.maxHp),hpEnd:null,
            firstInsideBaseTick:null,firstInsideBaseS:null,firstPlayerHitTick:null,firstPlayerHitS:null,firstWallHitTick:null,firstWallHitS:null,killTick:null,killAfterSpawnS:null};
          break;
        }
      }
      if(boss&&bossId&&boss.firstInsideBaseTick===null){const b=w.enemies.get(bossId);if(b&&o.nav.insideBase(b))boss.firstInsideBaseTick=tick;}
    }
  }
  const end=sim.tick;
  closeInter(end);closeRound(end);
  if(boss&&bossId){
    const b=sim.world.enemies.get(bossId);boss.hpEnd=b?Math.round(b.hp):0;
    const since=(t:number|null)=>t===null?null:r2((t-boss!.spawnTick)/HZ);
    boss.firstInsideBaseS=since(boss.firstInsideBaseTick);boss.firstPlayerHitS=since(boss.firstPlayerHitTick);
    boss.firstWallHitS=since(boss.firstWallHitTick);boss.killAfterSpawnS=since(boss.killTick);
  }
  const outcome:Outcome=sim.outcome==='victory'?'victory':sim.outcome==='defeat'?'defeat':'timeout';
  const cause:Cause=outcome==='victory'?'boss':outcome==='timeout'?'timeout':st().wallDown?'wall':'team';
  const wallSeconds=(performance.now()-started)/1000;
  const byRecipe:Record<string,number>={};for(const p of purchases)byRecipe[p.recipe]=(byRecipe[p.recipe]??0)+1;
  const tut=sim.run.director.state.tutorial,r1=rounds.find(x=>x.round===1);
  return {
    key:runKey(o.seed,o.players),seed:o.seed,players:o.players,classes:cls,outcome,cause,
    roundReached:sim.world.round.index,diedRound:outcome==='victory'?null:sim.world.round.index,
    ticks:end,simMinutes:r2(end/HZ/60),wallHpEnd:Math.round(st().wall.hp),wallMaxHp:st().wall.maxHp,
    rounds,intermissions:inter,forge:{count:purchases.length,byRecipe,list:purchases},boss:boss??null,
    nav:{round1ArrivalS:r1Arrival,tutorialArrivalS:tut?.arrivedTick!==undefined&&r1?.waveStartTick!=null?r2((tut.arrivedTick-r1.waveStartTick)/HZ):null,modeTicks:driver.modeTicks,stuck:driver.stuck,crateTrips:driver.trips},
    perf:{wallSeconds:r2(wallSeconds),msPerTick:Math.round(wallSeconds*1e3/Math.max(1,ticks)*1000)/1000,
      thinkMsPerTick:Math.round((room.thinkMs-thinkBefore)/Math.max(1,ticks)*1000)/1000,navMsPerTick:Math.round(navMs/Math.max(1,ticks)*1000)/1000},
    knobsApplied,
    ...(o.towers?{towers:towerSummary()}:{}),
  };
  function towerSummary(){
    const list=st().defenses?.list??[],final:Record<string,number>={};
    for(const d of list)if(!d.ruined)final[d.kind]=(final[d.kind]??0)+1;
    return {orders:tw.orders,repairs:tw.repairs,units:r2(tw.units),refused:tw.refused,final,ruined:list.filter(d=>d.ruined).length,gustavao:(st().defenses?.gustavoes??0)>0,
      rail:!!st().defenses?.rail,roots:tw.roots,tokens:tw.roots*TOWER_TOKENS.root+tw.gustavoes*TOWER_TOKENS.gustavao};
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

interface OutFile {card:string;version:1;startedAt:string;updatedAt:string;
  config:{seeds:number[];players:number[];capMin:number;knobs:unknown;knobsFile:string|null;knobRoute:KnobRoute;classes:string[];nav:Record<string,number>};
  runs:RunRecord[];summary:Summary|null}

function args(argv:readonly string[]){
  const get=(name:string)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};
  return {
    seeds:parseSeeds(get('--seeds')??'1-16'),players:parsePlayers(get('--players')??'1,3,6'),
    out:path.resolve(get('--out')??path.join(ROOT,'evidence',CARD,'balanco.json')),
    resume:argv.includes('--resume'),capMin:Number(get('--cap-min')??30),knobs:get('--knobs'),priority:get('--priority')??'low',
    towers:!argv.includes('--no-towers'),
  };
}
function writeAtomic(file:string,data:unknown){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(data,null,1));
  fs.renameSync(tmp,file);
}

async function main(){
  const a=args(process.argv.slice(2));
  if(a.priority!=='normal')try{os.setPriority(0,os.constants.priority.PRIORITY_LOW);}catch{console.warn('could not lower the process priority');}
  if(!(a.capMin>0))throw new Error('--cap-min must be > 0');
  let knobs:unknown;
  const route=knobRoute();
  if(a.knobs){
    knobs=JSON.parse(fs.readFileSync(path.resolve(a.knobs),'utf8'));
    // Part B's reader validates the file and fills the rest from CITY_BALANCE (when it exists in this checkout).
    if(route!=='none'){
      const balance=await import(pathToFileURL(path.join(ROOT,'src/sim/city/balance.ts')).href) as {cityBalanceFrom?:(input:unknown)=>unknown};
      if(typeof balance.cityBalanceFrom==='function')knobs=balance.cityBalanceFrom(knobs);
    }
    if(route==='none')console.warn(`WARNING: --knobs ${a.knobs} ignored: this checkout has no cityBalance option yet (src/sim/city/balance.ts + createRunSystems/Simulation). Runs use today's city.`);
    else console.log(`knobs ${a.knobs} → cityBalance via ${route}`);
  }
  const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
  const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
  const loaded=await cityTerrainFrom(text,hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const city=loaded.terrain,nav=new CityNavigator(city);
  const config:OutFile['config']={seeds:a.seeds,players:a.players,capMin:a.capMin,knobs:knobs??null,knobsFile:a.knobs??null,knobRoute:a.knobs?route:'none',classes:CLASS_ROTATION,
    nav:{READ_SECONDS,HOME_MARGIN,CRATE_NEAR,FAR,STUCK_TICKS,STUCK_MOVE,UNSTICK_TICKS}};
  let file:OutFile={card:CARD,version:1,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),config,runs:[],summary:null};
  if(a.resume&&fs.existsSync(a.out)){
    const old=JSON.parse(fs.readFileSync(a.out,'utf8')) as OutFile;
    if(JSON.stringify(old.config?.knobs??null)!==JSON.stringify(config.knobs))console.warn('WARNING: resuming a file written with other knobs');
    file={...old,config:{...config,seeds:[...new Set([...old.config.seeds,...config.seeds])].sort((x,y)=>x-y),players:[...new Set([...old.config.players,...config.players])].sort((x,y)=>x-y)}};
    console.log(`resume: ${file.runs.length} run(s) already in ${a.out}`);
  }
  const done=new Set(file.runs.map(r=>r.key)),capTicks=Math.round(a.capMin*60*HZ);
  for(const seed of a.seeds)for(const players of a.players){
    if(done.has(runKey(seed,players)))continue;
    const run=playRun({seed,players,capTicks,city,nav,knobs,route,towers:a.towers});
    file.runs=[...file.runs.filter(r=>r.key!==run.key),run];
    file.updatedAt=new Date().toISOString();file.summary=summarize(file.runs);
    writeAtomic(a.out,file);
    console.log(runLine(run));
  }
  const s=summarize(file.runs);
  console.log('\n== summary ==');
  for(const t of Object.values(s.byPlayers)){
    console.log(`${t.players}p: ${t.wins}/${t.runs} wins (${t.verdict.wins}${t.verdict.target?` ${r2(t.verdict.target.min)}–${r2(t.verdict.target.max)}`:''}) causes ${JSON.stringify(t.causes)} deaths by round ${JSON.stringify(t.deathRounds)}`);
    console.log(`   first arrival s ${JSON.stringify(t.firstArrivalS.all)} | loot/intermission ${JSON.stringify(t.loot.unitsPerIntermission)} ≈ ${t.loot.recipesPerIntermission} recipes (mean ${r2(RECIPE_MEAN_UNITS)} u) | forge/run ${t.loot.purchasesPerRun?.mean??'-'}`);
    console.log(`   round 1: downed ${t.round1.downed} eliminated ${t.round1.eliminated} defeats ${t.round1.defeats} (${t.verdict.round1}) tutorial arrival ${JSON.stringify(t.round1.tutorialArrivalS)} | boss reached ${t.boss.reached} killed ${t.boss.kills}`);
  }
  for(const n of a.players){
    const rs=file.runs.filter(r=>r.players===n&&r.towers);
    if(!rs.length)continue;
    const mean=(f:(r:RunRecord)=>number)=>r2(rs.reduce((x,r)=>x+f(r),0)/rs.length);
    console.log(`towers ${n}p: orders/run ${mean(r=>r.towers!.orders)} units/run ${mean(r=>r.towers!.units)} standing at end ${mean(r=>Object.values(r.towers!.final).reduce((a,b)=>a+b,0))} ruined ${mean(r=>r.towers!.ruined)} gustavão ${rs.filter(r=>r.towers!.gustavao).length}/${rs.length}`+
      ` | roots/run ${s.byPlayers[n]?.towers?.rootsPerRun?.mean??'-'} fichas/run ${s.byPlayers[n]?.towers?.tokensPerRun?.mean??'-'}`);
  }
  console.log(s.verdict.ok?'verdict: on target':`verdict: ${s.verdict.notes.join('; ')}`);
  console.log(`written: ${a.out}`);
}

const entry=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(entry===import.meta.url)await main();
