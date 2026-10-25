/**
 * Wires one horde run (VGM-042): fresh instances of every system, the kill/zero hooks and the outcome callbacks.
 * Called on every new run; dispose() removes this run's hooks before the next one registers.
 */
import type {SimWorld} from './core.ts';
import type {EnemyState,SimPlayer} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {MAX_ENEMIES,MAX_PROJECTILES,ROUNDS,granaPerKill,hasRoom,playerScale,type EnemyRole,type RoundRoster} from '../rules/index.ts';
import {createDirector,type Director,type DirectorState} from './director.ts';
import {ELITE,createEnemy,enemyDef,isEnemyKind,type EnemyKind} from './enemies/catalog.ts';
import {MINION_KINDS,createEnemyAi,type EnemyAi,type EnemyAiState} from './enemies/ai.ts';
import {BOSS_TUNING,createBoss,type BossController,type BossState} from './boss.ts';
import {createWeaponSystem} from './weapons/system.ts';
import {createProjectileSystem} from './projectiles.ts';
import {createTelegraphSystem} from './telegraphs.ts';
import {createProgression,type Progression,type ProgressionState} from './progression.ts';
import {createReviveSystem,downPlayer,type ReviveSystem} from './revive.ts';
import {createFearSystem} from './fear.ts';
import {UNITS_PER_TOKEN,kitId,refreshStats} from '../rules/index.ts';
import {ITEMS,MANUAL_ITEMS} from './items.ts';
import {createCrates,type Crates,type CratesState} from './crates.ts';
import {cityLoot} from './stonewards/loot.ts';
import {add as addItem,drop as dropSlot,equip as equipSlot,hasInventory,inventorySystem,manualStartingBuild,place as placeKit,placeNear as placeKitNear,take as takeItem,use as useSlot,type InventoryHooks,type InventoryResult,type KitOrder,type PlaceResult} from './inventory.ts';
import {playersSystem,type ManualCombat,type PlayerInput,type RunPlayer} from './systems/players.ts';
import {createStonewardsSystem,structureTargets,type StonewardsSystem} from './stonewards/system.ts';
import {MURO_BLOCK_R,bashedAlways,blockingPieces,heroSlow,isPiece,pieceDrag,reachMap} from './towers/free-build.ts';
import {holdsObra} from './towers/system.ts';
import type {StonewardsState} from './stonewards/state.ts';
import {createZueira,type ZueiraLab,type ZueiraState,type ZueiraSystem} from './zueira.ts';
import type {AvenuePlanner} from './city/avenues.ts';
import {cityPlanner,citySteer,cityTerrainOf} from './city/grid.ts';
import {CityTerrain,baseHeroSpeed,cityNestPlan,safePlaceAt,type NestPlan,type NestSize} from '../maps/index.ts';
import {citySpeed} from './city/speed.ts';
import {CHAVEIRO_PACE,ENTRANCES,createChaveiro,planChaveiro,type ChaveiroState,type ChaveiroSystem} from './chaveiro/system.ts';
import {CAR_ID,MOTO_ID,Rng,ticks,type CombatMode,type ObjectiveKind,type ObjectiveView} from '../contract/index.ts';
import {NEST_PACE,NEST_TARGET,ROLE_WEIGHT,createNests,type NestsState,type NestsSystem} from './ninhos/ninhos.ts';
import {NOISE,createSono,type AmbientNoise,type Sono,type SonoState} from './ninhos/sono.ts';
import {cityUnoStart} from './city/uno-start.ts';
import {addGrana,killPayee,payKill,seatedPlayers,splitAmong} from './wallet.ts';
import {createBanks,ringCandidates,type BanksState,type BanksSystem} from './bancos/system.ts';
import type {BankView} from '../contract/index.ts';
import {createVehicles,type VehiclesState,type VehiclesSystem} from './veiculos/system.ts';
import {calmGate} from './ninhos/calma.ts';
import {createChefao,holdChaveiroClock,holdWaveClock,type ChefaoState,type ChefaoSystem} from './ninhos/chefao.ts';
import {CALMA,WAVE_BOSS,calmAround} from '../rules/index.ts';
import {CITY_BALANCE,MANUAL_CITY_BALANCE,hasTeamBossHp,hasTeamDamage,teamBossHp,teamDamage,type CityBalance} from './city/balance.ts';

export type RunOutcomeKind='victory'|'defeat';
export const KILL_SCORE=10;
/**
 * Stonewards intermission (VGM-046B): 30 s instead of the director's 20. Measured in done/VGM-046B: the nearest pedra
 * of the endless map is ~17 units out (median of 20 seeds), so walking there and back (8.4 s), emptying it (7.2 s), the
 * round offer (~4 s) and a purchase at the forge (~2 s) already take ~22 s; 30 s leaves room for a second node or a
 * farther, richer one. The horn may stretch it further for a hero far away (stonewards/system.ts).
 */
export const STONEWARDS_INTERMISSION_SECONDS=30;
/**
 * Share of the regular groups that besiege the base (director siegeShare): one group in four goes for the wall, from
 * round 2 on. Round 1 teaches the fight (BUG-round1-letal) and the first intermission teaches gathering and the forge.
 */
export const SIEGE_SHARE=.25,SIEGE_FROM_ROUND=2;

export interface RunSystemsOptions {
  takeInput:(playerId:string)=>PlayerInput|undefined;
  /** An offline player the room plays meanwhile (multiplayer autopilot, 3g-rede-sem-teleporte): still walks. */
  autopilot?:(playerId:string)=>boolean;
  /** D-052: a room bot (with the autopiloted players: who moves the chaveiro's car only along with a person). */
  bot?:(playerId:string)=>boolean;
  /** Called when the run is decided; may fire more than once (the owner keeps the first, victory wins a same-tick tie). */
  onOutcome:(outcome:RunOutcomeKind)=>void;
  /** Ticks the defeat waits for the last player standing who dropped (revive.ts default if omitted; the Room passes its seat grace, VGM-047). */
  reconnectGraceTicks?:number;
  /** Lab only (LAB_ZUEIRA): replaces the seed's plan of zueira events (VGM-053B). */
  zueiraLab?:ZueiraLab;
  /** Mode 'ninhos': forces the chefão of the 1st wave (a WAVE_BOSSES roster id: labs, tests); default the seed's draw. */
  chefao?:string;
  /** Lab only (LAB_DOURADA): the caixa-gamble's hidden dourada chance instead of GOLD_HIDDEN_CHANCE (1 = always, for a video). */
  goldLab?:number;
  /** City: the plaza barricades (cidade-06, default on). Off only for travel/reach measurements in tests. */
  barricades?:boolean;
  /**
   * City only (cidade-08): round 1 is the tutorial walk from the wreck to the plaza (DirectorOptions.cityTutorial).
   * Default true; false plays the round table's round 1 (the tests of the regular city round 1 opt out).
   */
  cityTutorial?:boolean;
  /**
   * City only (cidade-11, city/balance.ts): the run's balance knobs (a headless runner's override). Default
   * CITY_BALANCE; ignored on the island and in the endless world.
   */
  cityBalance?:CityBalance;
  /**
   * D-040: the run's rotation of 12-18 roster entries (DirectorOptions.rotation, rules/enemy-rotation.ts). Default true;
   * false plays the round table's nine kinds (tests that pin the old composition).
   */
  rotation?:boolean;
  /**
   * A room checkpoint (E5-checkpoint-por-round): the systems resume from this state (RunSystems.state() of the run that
   * was cut, taken at a round's intermission) instead of starting fresh. The world must already hold the checkpoint's
   * clock and round (SimWorld.load) before the first step. Deep-copied here; the caller's object is never kept.
   */
  checkpoint?:RunSystemsState;
  /**
   * D-047: the match objective. 'chaveiro' (city only; ignored elsewhere): the car replaces the wall, the chaveiro's moto
   * rides to it (chaveiro/system.ts), the rounds become waves (DirectorOptions.endlessWaves) and the boss is called by
   * the chaveiro's ETA; victory when he opens the car, defeat when it is a total loss or the team falls. Default off.
   */
  objective?:ObjectiveKind;
  /**
   * D-051: 'ninhos' (only with the chaveiro objective in the city; ignored elsewhere) replaces the director's waves with
   * the nests (sim/ninhos/ninhos.ts): groups on each nest's timer, nests that fall, the boss out of the biggest live
   * nest. Default 'rounds' (today's waves) until the D-051 bars pass.
   */
  mode?:'rounds'|'ninhos';
  /** Mode 'ninhos': × the sleepers (maps/nests.ts NestPlanOptions.population; default POPULATION). Benches and tests. */
  nestPopulation?:number;
  /**
   * D-051: how heroes fight (CombatMode). 'manual': only the equipped weapon fires, while the attack is held, at the
   * auto aim (weapons/system.ts); no class skill; damagePlayer records SimPlayer.lastHitBy. Default 'auto' (every world):
   * the automatic weapons and the skills, exactly as before, until the E6 weapons and the balance pass.
   */
  combat?:CombatMode;
  /**
   * Fear (card NEW-20261023-ORQ-fear-escuridao-sozinho, sim/fear.ts): alone for 60 s, the dark takes the hero. Default:
   * on with the manual combat (the game the rooms play since D-051), off otherwise, so the old worlds' runs and digests stay.
   */
  fear?:boolean;
}
/** JSON-safe state of the stateful systems (RunSystems.state()): what a room checkpoint stores. */
export interface RunSystemsState {
  director:DirectorState;progression:ProgressionState;boss:BossState;enemyAi:EnemyAiState;
  /** Completed revives per rescuer (ReviveSystem.revives), as entries. */
  revives:[string,number][];
  stonewards:StonewardsState;zueira:ZueiraState;
  /** D-047, only when the run plays the chaveiro objective (absent otherwise, so no other state hash moves). */
  chaveiro?:ChaveiroState;
  /** D-051, manual combat only: the crates on the map (sim/crates.ts). */
  crates?:CratesState;
  /** Bancos: only in the city (both modes; absent elsewhere, so the island's and the endless world's hashes stay). */
  banks?:BanksState;
  /** Veículos: only in the city (both modes), like the banks. */
  veiculos?:VehiclesState;
  /** D-051, only in mode 'ninhos' (absent otherwise): the nests and their sleepers (absent until the first step). */
  ninhos?:NestsState;
  sono?:SonoState;
  /** Card boss-fim-onda-1, only in mode 'ninhos' (absent otherwise): the chefão at the end of the 1st wave. */
  chefao?:ChefaoState;
}
export interface RunSystems {
  director:Director;progression:Progression;boss:BossController;enemyAi:EnemyAi;revive:ReviveSystem;
  /** Gathering, forge, wall and towers (VGM-046B). */
  stonewards:StonewardsSystem;
  /** Zueira events in the middle of a round and the last critter's kill-cam (VGM-053B). */
  zueira:ZueiraSystem;
  /** City world (cidade-05): the avenue planner shared by the director and the enemy steer (cidade-06: barricades → invalidate). */
  avenues?:AvenuePlanner;
  /** D-047: the chaveiro objective of this run (city with RunSystemsOptions.objective 'chaveiro'), else absent. */
  chaveiro?:ChaveiroSystem;
  /** D-051: the nests of a run in mode 'ninhos', else absent. */
  nests?:NestsSystem;
  /** D-051: their sleepers (ninhos/sono.ts), from the first step of a run in mode 'ninhos'. */
  sono():Sono|undefined;
  /** Card boss-fim-onda-1: the chefão at the end of the 1st wave (ninhos/chefao.ts), mode 'ninhos' only. */
  chefao?:ChefaoSystem;
  /** D-047: the objective as the HUD and the bots see it; undefined without one. */
  objectiveView():ObjectiveView|undefined;
  /** D-051 manual combat's crates (sim/crates.ts): dropCrate for the nests, opening() for the HUD; absent otherwise. */
  crates?:Crates;
  /** D-051 manual combat's inventory commands (sim/inventory.ts); absent with the automatic weapons. */
  inventory?:{
    equip(playerId:string,slot:number):InventoryResult;use(playerId:string,slot:number):InventoryResult;
    drop(playerId:string,slot:number):InventoryResult;take(playerId:string,pickupId:string):InventoryResult;
    /** Kits de torre (torre-pela-caixa): the kit in `slot` built at `order` (free), or near the hero (the bots). */
    place(playerId:string,slot:number,order:KitOrder,requestId?:string):PlaceResult;
    placeNear(playerId:string,slot:number):PlaceResult;
  };
  /** Bancos (sim/bancos/system.ts): the city's ATMs, in both city modes; absent elsewhere. */
  banks?:BanksSystem;
  /** The banks as the HUD and the bots see them (RunView.banks); undefined outside the city. */
  bankViews():BankView[]|undefined;
  /** Veículos (sim/veiculos/system.ts): the city's parked vehicles and rides, in both city modes; absent elsewhere. */
  vehicles?:VehiclesSystem;
  /** JSON-safe state of the stateful systems, for stateHash and checkpoints (live references: copy before keeping). */
  state():RunSystemsState;
  dispose():void;
}

/** JSON-safe marker (D-002) so the elite extras are applied once per enemy. */
type EliteEnemy=EnemyState&{eliteExtras?:true};
/**
 * Plan §2 item 1: the director scales elite hp (×6) and radius (×1.35) itself (D-010); the catalog's damage and xp
 * extras (ELITE.damage, ELITE.xp) are applied here, once, right after the director spawns the elite.
 */
export function applyEliteExtras(ctx:SimContext){
  for(const e of ctx.enemies.values()){
    const elite=e as EliteEnemy;
    if(!e.elite||e.boss||elite.eliteExtras)continue;
    e.damage=Math.round(e.damage*ELITE.damage);e.xp*=ELITE.xp;elite.eliteExtras=true;
  }
}

/**
 * Clearance of a prize from the wall's centre and from a tower (units); see createZueira's `blocked`. A standing city
 * barricade keeps prizes off its disc plus PRIZE_BARRICADE_MARGIN (cidade-06).
 */
export const PRIZE_WALL_CLEAR=2,PRIZE_TOWER_CLEAR=1.2,PRIZE_BARRICADE_MARGIN=.3;
/** Discs no prize falls in: the standing wall, every tower, (city) every standing barricade and every defense. */
export function prizeBlocks(state:StonewardsState):{x:number;y:number;radius:number}[]{
  const {wall,wallDown,towers,barricades,defenses}=state;
  const blocks=[...(wallDown?[]:[{x:wall.x,y:wall.y,radius:PRIZE_WALL_CLEAR}]),...towers.map(t=>({x:t.x,y:t.y,radius:PRIZE_TOWER_CLEAR}))];
  for(const b of barricades??[])if(!b.down)blocks.push({x:b.x,y:b.y,radius:b.r+PRIZE_BARRICADE_MARGIN});
  // Tower defenses (torres-sim), ruins included (still rubble on the ground): their footprint disc.
  for(const d of defenses?.list??[])blocks.push({x:d.x,y:d.y,radius:d.r});
  return blocks;
}
/** Round row whose hp the sleepers carry (mid-early: they are the map's standing threat, not a late wave). */
export const SLEEPER_ROUND=3;
/** Round row whose roster a sleeper's kind is drawn from: loose bands and P nests early, M mid, G late. */
export const SLEEPER_ROSTER:Readonly<Record<NestSize|'solto',number>>={solto:2,P:3,M:5,G:7};
/**
 * The kinds of a plan's sleepers (SonoOptions.kindOf), in plan order: from the run's rotation by ROLE_WEIGHT (the round
 * table's kinds without one), on a stream of the seed of its own, so the director's and the nests' streams never move.
 */
export function sleeperKinds(plan:NestPlan,seed:number,roster:(round:number)=>RoundRoster|undefined):(i:number)=>EnemyKind{
  const rng=new Rng(seed>>>0).fork('sono-tipos'),kinds:EnemyKind[]=[];
  const draw=(round:number)=>{
    const r=roster(round),weighted:[string,number][]=[];
    if(r)for(const [role,w] of Object.entries(ROLE_WEIGHT) as [EnemyRole,number][]){const ids=r.roles[role];if(ids?.length)for(const id of ids)if(isEnemyKind(id))weighted.push([id,w/ids.length]);}
    if(!weighted.length)for(const [kind,w] of Object.entries(ROUNDS[round-1].weights))if(w>0&&isEnemyKind(kind))weighted.push([kind,w]);
    let x=rng.next()*weighted.reduce((t,[,w])=>t+w,0);
    for(const [k,w] of weighted)if((x-=w)<0)return k as EnemyKind;
    return weighted[weighted.length-1][0] as EnemyKind;
  };
  for(const n of plan.nests)for(let j=0;j<n.sleepers.length;j++)kinds.push(draw(SLEEPER_ROSTER[n.size]));
  for(const b of plan.loose)for(let j=0;j<b.members.length;j++)kinds.push(draw(SLEEPER_ROSTER.solto));
  return i=>kinds[i];
}
export function createRunSystems(world:SimWorld,options:RunSystemsOptions):RunSystems{
  const {onOutcome}=options;
  // A checkpoint is copied once: every system below mutates the state it is handed.
  const cp=options.checkpoint?structuredClone(options.checkpoint):undefined;
  // D-051 manual combat: the level cards are passives only (MANUAL_ITEMS) and chests are crates (no walking open).
  const progression=createProgression({catalog:options.combat==='manual'?MANUAL_ITEMS:ITEMS,seed:world.seed,onBuildChange:(_ctx,p)=>{refreshStats(p);},
    // A cédula with no room on the ground: paid like the kill would have been (read through `stonewards`, created below).
    payGrana:(ctx,amount,owner)=>{payKill(ctx.players,{},amount,stonewards.state,owner);},
    ...(options.combat==='manual'?{crates:true}:{})},cp?.progression);
  // Prizes never fall on the base (the wall's stone ring and tent are drawn ~1.3 u wide and ~3 u tall: 2 u around its
  // centre) nor on a tower (1.2 u): code review of pacote-bugs-ux. Read through `stonewards`, created just below.
  let structures:()=>{x:number;y:number;radius:number}[]=()=>[];
  // D-051 mode 'ninhos' (the nests' own test below, nestMode): the events on the clock, never with the boss up.
  const zueiraClock=!!cityTerrainOf(world.terrain)&&options.objective==='chaveiro'&&options.mode==='ninhos';
  const zueira=createZueira(world.seed,{lab:options.zueiraLab,blocked:()=>structures(),
    ...(zueiraClock?{clock:{bossUp:()=>!!boss.state.bossId&&!boss.state.defeated||!!chefao?.up()}}:{})});
  // Zueira has no restore of its own: its state is plain data, read (rng included) from the first step on.
  if(cp)Object.assign(zueira.state,cp.zueira);
  let director:Director|undefined;
  // D-016: once the director is done (boss down), a same-tick wipe is not a defeat. The director only reaches 'done'
  // on its next step, so the boss's killing blow also ends the run right away.
  let bossDown=false;
  // D-047: the chaveiro decides the run instead of the boss and the round count (created below, city only).
  let chaveiro:ChaveiroSystem|undefined;
  // Bancos: the city's ATMs (created below, after the chaveiro); the crates they stand on are not gathered (hiddenNodes).
  let banks:BanksSystem|undefined;
  // Veículos: the city's vehicles (created with the banks).
  let vehicles:VehiclesSystem|undefined;
  // D-051: the nests of mode 'ninhos' (created with the chaveiro, below).
  let nests:NestsSystem|undefined,sono:Sono|undefined;
  // Card boss-fim-onda-1: the chefão at the end of the 1st wave (created with the nests, below).
  let chefao:ChefaoSystem|undefined;
  const runEnded=()=>chaveiro?chaveiro.state.ended!==undefined:bossDown||director!.state.stage==='done';
  // City balance knobs (cidade-11): only on a city terrain; the island and the endless world never see them.
  const cityBalance=cityTerrainOf(world.terrain)?options.cityBalance??(options.combat==='manual'?MANUAL_CITY_BALANCE:CITY_BALANCE):undefined;
  // D-017 (E8-wall-siege-single-path): the enemy-ai is the only path that hurts the wall. It walks siege enemies to it
  // and its contact hit goes to damageWall; the Stonewards contact siege (siegeStep) stays off.
  // City horn (BUG-20261013-E4): who walked (a non-zero stick) on this tick's players step, read by 'structures' later
  // in the same tick. Transient: rebuilt every tick from the inputs, never part of the state.
  const steered=new Set<string>(),cityWorld=!!cityTerrainOf(world.terrain);
  // D-052: the sticks of this tick (who pushes the chaveiro's car, read by its step later in the same tick). Transient too.
  const sticks=new Map<string,{x:number;y:number}>();
  // Bicos: this tick's Trabalhar per player who sent an input (held and standing still), read by the banks' step. Transient.
  const work=new Map<string,boolean>();
  // D-051: who holds the attack on this tick (players → weapons, same tick); only in the manual combat.
  const manual:ManualCombat|undefined=options.combat==='manual'?{attacking:new Set<string>()}:undefined;
  world.recordLastHit=!!manual;
  const objective=cityWorld&&options.objective==='chaveiro'?options.objective:undefined;
  // D-051: the nests replace the waves only for the chaveiro in the city (A5: the wall, the island and the endless keep rounds).
  const nestMode=!!objective&&options.mode==='ninhos';
  const takeInput=cityWorld?(id:string)=>{
    const input=options.takeInput(id);
    const moving=!!input&&Math.hypot(input.x,input.y)>=.01;
    if(input&&moving){steered.add(id);sticks.set(id,{x:input.x,y:input.y});}
    if(input)work.set(id,!!input.work&&!moving);
    return input;
  }:options.takeInput;
  const stonewards=createStonewardsSystem({
    // D-051 mode 'ninhos' (card ninhos-rounds-fora): no intermission; the forge and the towers' orders wait for calm.
    ...(nestMode?{calm:{gate:calmGate(),refillTicks:ticks(CALMA.refillS)}}:{}),
    terrain:world.terrain,siegeContact:false,hiddenNodes:()=>banks?.crates,...(cityWorld?{steered:(id:string)=>steered.has(id)}:{}),barricades:options.barricades,...(cityBalance?{cityBalance}:{}),
    // cidade-08 x cidade-06: in the tutorial the plaza group walks into the open plaza; the barricades rise at the 1st intermission.
    barricadesLater:options.cityTutorial??true,
    onWallDestroyed:()=>{if(!runEnded())onOutcome('defeat');},
    // The horn stretched the intermission: the offers due at its old end (the round offer, level offers armed for it)
    // move with it, so nobody's default is picked while the intermission still runs.
    extendPrepare:(ctx,endsTick)=>{
      const before=ctx.round.phaseEndsTick;
      director!.extendPrepare(ctx,endsTick);
      const after=ctx.round.phaseEndsTick;
      if(after>before)for(const queue of ctx.offers.values())for(const offer of queue)if(offer.deadlineTick===before)offer.deadlineTick=after;
    },
    // cidade-06: a barricade fell or was rebuilt; the flow grid re-reads those cells, then the planner's fields.
    onTerrainChanged:rect=>{avenues?.grid.refresh(rect);avenues?.invalidate([rect]);},
    // D-052 free build in every city run: the car's body, the moto and the living nests (D-051) the pieces keep clear
    // of (the chaveiro and the nests, created below; the wall mode has none of them).
    // barricada-construir part 2: the map's barricadas, collected into the inventory's kit:barricada (manual combat).
    // NEW-20261023-ORQ-barracas-no-caminho: a barraca gives a kit:barraca; the hands hold one of either (CARREGA_MAX).
    ...(objective&&manual?{tralha:{
      carrying:(p:SimPlayer)=>p.build.weapons.reduce((n,w)=>n+(w.id===kitId('barricada')||w.id===kitId('barraca')?w.level:0),0),
      give:(p:SimPlayer,kind:'barricada'|'barraca')=>{const id=kitId(kind),own=p.build.weapons.find(w=>w.id===id);if(own){own.level++;return true;}return addItem(p,{id,level:1});},
    }}:{}),
    ...(cityWorld?{freeBuild:objective?{
      car:()=>{const t=chaveiro?.targets().find(o=>o.id===CAR_ID);return t?{x:t.x,y:t.y,radius:t.radius}:undefined;},
      moto:(tick:number)=>{if(!chaveiro||chaveiro.state.ended)return undefined;const m=chaveiro.view(tick).moto;return {x:m.x,y:m.y};},
      nests:()=>nests?nests.state.nests.filter(n=>!n.down):[],
    }:{}}:{}),
  },cp?.stonewards);
  structures=()=>prizeBlocks(stonewards.state);
  // City (cidade-05): one avenue planner for the director's spawns and the AI's steer along the avenues.
  const cityTerrain=cityTerrainOf(world.terrain),avenues=cityTerrain?cityPlanner(cityTerrain):undefined;
  const steer=avenues?citySteer(avenues,{terrain:cityTerrain}):undefined;
  const reach=avenues?reachMap(avenues.grid):undefined;
  // The boss walks over the plaza barricades (cidade-06; it spawns inside the base and never bashes structures, D-010):
  // its steer runs on a barricade-free copy of the city, or with the four mouths closed it finds no way out of the plaza.
  const open=cityTerrain?new CityTerrain(cityTerrain.asset,cityTerrain.signature):undefined;
  const openPlanner=open?cityPlanner(open):undefined;
  const bossSteer=open&&openPlanner?citySteer(openPlanner,{terrain:open,heroOnly:true,blockers:false}):undefined;
  // City speeds (cidade-05c v2, city/speed.ts): converted once, on the EFFECTIVE speed. The director's bodies are
  // created at the catalog speed and the director converts catalog × plan.speed (DirectorOptions.speedMap); the boss
  // converts its walk after the phase and enrage multipliers (BossOptions.speedMap); its minions, which no multiplier
  // touches, here. Island and endless keep the catalog speeds untouched.
  const inCity=<E extends EnemyState|undefined>(e:E):E=>{if(steer&&e)e.speed=citySpeed(e.speed);return e;};
  const enemyAi=createEnemyAi({projectileCap:MAX_PROJECTILES,steer,
    // D-051: where an alerta or a perdeu walks (the sleepers of a run in mode 'ninhos'; none otherwise).
    ...(nestMode?{goal:(ctx:SimContext,e:EnemyState)=>sono?.goal(ctx,e),
      // The minuto de Minerva (the user, 22/10): no critter walks nor chases; it still hits whoever comes into its reach.
      hold:(ctx:SimContext)=>!!nests?.minerva(ctx.tick)}:{}),
    // Caps every enemy-ai move (the Tio's charge included) at ACTION_PEAK_MAX × this world's hero: `steer` exists only in the city.
    // The city wiring (05c) converts enemy speeds to the city hero (1.994 u/s); this is the hero they are measured against.
    // The BASE hero walk on this terrain (maps baseHeroSpeed): the heroes walk HERO_SPEED_MULT × it, but the enemies
    // must not get faster with them (velocidade-heroi-e-projetil), so the cap stays on today's hero.
    heroSpeed:baseHeroSpeed(world.terrain),
    // City only: the crowd's separation push is clamped to the same peak (endless/island pacing stays as tuned).
    capPush:!!steer,
    // The wall, plus the standing city barricades (blocking); hits go by id to the wall or the barricade (D-017).
    // D-047: the car (and the riding moto) instead of the wall; the car's hits go to the chaveiro, the moto takes none.
    // D-052: an enemy on a free barricade walks slowed (towers/free-build.ts pieceDrag).
    drag:e=>pieceDrag(stonewards.state,e),
    // NEW-20261021-ORQ-barricada-construir: a built piece is bashed only by a body cut off from the car (the wall's
    // spot without one); with a way around, the bodies walk it (the flow fields already route around the blockers).
    // NEW-20261023-ORQ-barracas-no-caminho: a barraca is bashed by every body pressed against it (the field leads through).
    ...(reach?{bashes:(e:EnemyState,id:string)=>!isPiece(stonewards.state,id)||bashedAlways(stonewards.state,id)||!reach(e,chaveiro?.targets().find(o=>o.id===CAR_ID)??stonewards.state.wall)}:{}),
    structures:()=>chaveiro?[...chaveiro.targets(),...structureTargets(stonewards.state,false)]:structureTargets(stonewards.state),
    hitStructure:(ctx,id,amount,enemy)=>{
      if(chaveiro&&id===CAR_ID)chaveiro.hitCar(ctx,enemy);
      else if(!(chaveiro&&id===MOTO_ID))stonewards.hit(ctx,id,amount);
    },
    // Invocador (D-040): the round's corredores and enxames, spawned and tracked by the director as round members.
    minionKinds:()=>director?.minionKinds()??MINION_KINDS,
    summon:(ctx,kind,at)=>isEnemyKind(kind)?director?.summon(ctx,kind,at):undefined,
  });
  if(cp)enemyAi.restore(cp.enemyAi);
  // D-051 manual combat: crates on the city's loot points (none elsewhere: only drops), the boss's is a lendária. A crate
  // gives only a weapon or a kit de torre (bau-so-arma-ou-torre), straight into the opener's inventory.
  const crates:Crates|undefined=manual?createCrates({seed:world.seed,
    points:cityLoot(world.terrain)?.crates.map(c=>({x:c.node.x,y:c.node.y,seconds:c.seconds}))??[],
    // inicio-no-uno: in mode 'ninhos' the team spawns beside the Uno, so the first crates sit around it.
    startPoints:(nestMode?cityLoot(world.terrain)?.aroundUno:cityLoot(world.terrain)?.aroundStart)??[],
    // BUG-20261022-ORQ-caixas-sumiram: the first minute's trail crates, ahead of a hero behind the pace (city only).
    ...(cityLoot(world.terrain)?{trailSpot:(at:{x:number;y:number},heading:{x:number;y:number},ahead:number,rng:{next():number})=>cityLoot(world.terrain)!.spotAhead(at,heading,ahead,rng)}:{}),
    ...(options.goldLab!==undefined?{goldChance:options.goldLab}:{}),
    ...(cp?.crates?{state:cp.crates}:{})}):undefined;
  const boss=createBoss({
    ...(crates?{dropChest:(ctx:SimContext,at:{x:number;y:number})=>{crates.dropCrate(ctx,at,5);}}:{}),
    summon:(ctx,kind,at)=>hasRoom(ctx.enemies,MAX_ENEMIES)&&isEnemyKind(kind)?inCity(createEnemy(ctx,kind,at,1)):undefined,
    minionKinds:()=>director?.bossMinionKinds(),
    // City (cidade-05c v2): the boss collides by the hero rule (clearSegment), so it walks the streets on the
    // hero-size players field (steer.hero: no size class, which would send it the long way round), at the city speed.
    ...(bossSteer?{steer:bossSteer.hero,speedMap:citySpeed}:{}),
    // City boss hp knob (cidade-11): the city controller's baseHp; neutral leaves BOSS_TUNING as it is.
    ...(cityBalance&&cityBalance.bossHp!==1?{tuning:{baseHp:BOSS_TUNING.baseHp*cityBalance.bossHp}}:{}),
    // × players[n].bossHp, n the director's plan count when the boss spawns (round 10's plan; scalePlayers without one).
    ...(cityBalance&&hasTeamBossHp(cityBalance)?{hpScale:(ctx:SimContext)=>teamBossHp(cityBalance,director?.state.plan?.players??director?.scalePlayers(ctx))}:{}),
    say:(ctx,enemy,lines,key)=>enemyAi.say(ctx,enemy,lines,key),
    scalePlayers:ctx=>director?.scalePlayers(ctx)??1,
    // D-051 mode 'ninhos': no wave clock (the director holds one open wave), the boss's own enrage timer.
    ...(nestMode?{enrageAfterTicks:ticks(CALMA.bossEnrageS)}:{}),
    onDefeated:()=>{if(!objective)onOutcome('victory');},
    // D-047: the boss besieges the car (10 hits a blow) when no player is nearer.
    ...(objective?{siege:()=>chaveiro?.targets().find(t=>t.id===CAR_ID),hitSiege:(ctx:SimContext,id:string,b:EnemyState)=>{if(id===CAR_ID)chaveiro?.hitCar(ctx,b);}}:{}),
  });
  // D-047: a checkpoint keeps no live enemy, so a boss the chaveiro called that still stood at the intermission would
  // come back as beaten (its 'defeat' line and a free chest, never called again). Forget that fight instead (its rng
  // stream kept): the chaveiro calls it again on the first step, its ETA being under BOSS_ETA_SECONDS already.
  if(cp&&objective&&cp.boss.bossId!==undefined&&!cp.boss.defeated){
    cp.boss={defeated:false,lastX:0,lastY:0,minions:[],pending:[],...(cp.boss.rng!==undefined?{rng:cp.boss.rng}:{})};
    if(cp.chaveiro)cp.chaveiro.bossCalled=false;
  }
  if(cp)boss.restore(cp.boss);
  director=createDirector({
    maxEnemies:MAX_ENEMIES,
    // Unknown kinds are skipped instead of throwing; elites are scaled by the director itself (D-010).
    createEnemy:(ctx,kind,point,scale)=>isEnemyKind(kind)?createEnemy(ctx,kind,point,scale):undefined,
    spawnBoss:(ctx,point)=>boss.spawnBoss(ctx,point),
    onRoundEnd:(ctx,summary)=>{
      progression.grantRoundOffers(ctx,summary.index,summary.intermissionEndsTick);
      zueira.roundEnded(ctx,summary,director!.state.roundStart);
    },
    intermissionSeconds:STONEWARDS_INTERMISSION_SECONDS,siegeShare:SIEGE_SHARE,siegeFromRound:SIEGE_FROM_ROUND,
    rotation:options.rotation??true,
    // The last call walks siege bodies to the wall they besiege (pacote-bugs-ux, code review).
    siegeTarget:()=>{
      if(chaveiro)return chaveiro.state.car;
      const {wall,wallDown}=stonewards.state;return wallDown?undefined:wall;
    },
    ...(objective?{endlessWaves:true}:{}),...(nestMode?{waves:false}:{}),
    // City: catalog speeds for the planner's estimates, converted with plan.speed by speedMap (the bodies' speeds);
    // groups aimed at a team away from the base.
    ...(avenues?{avenues,speedMap:citySpeed,enemySpeedOf:(kind:string)=>isEnemyKind(kind)?enemyDef(kind).speed:undefined,...(steer?{cityChase:steer}:{}),
      // Round 1 is the walk from the wreck to the plaza (cidade-08).
      cityTutorial:options.cityTutorial??true,...(cityBalance?{cityBalance}:{}),...(openPlanner?{cityOpenPlanner:openPlanner}:{})}:{}),
  },cp?.director);
  // City team damage (cidade-11, CityBalance.players[n].damage): × every hit a player takes, through the core's single
  // damage path; n is the director's plan count (the current round, kept through its intermission), neutral before
  // round 2. Set (or cleared) on every run; absent unless some team size has a damage knob, so damagePlayer is unchanged.
  const damageScale=cityBalance&&hasTeamDamage(cityBalance)?()=>teamDamage(cityBalance,director!.state.plan):undefined;
  world.playerDamageScale=damageScale;
  if(objective&&openPlanner&&cityTerrain){
    const p=cityTerrain.asset.points,wall=stonewards.state.wall;
    chaveiro=createChaveiro({wallet:{seated:()=>seatedPlayers(world.players)},seed:world.seed,grid:openPlanner.grid,entrances:{N:p.spawnN,S:p.spawnS,L:p.spawnL,O:p.spawnO},car:{x:wall.x,y:wall.y},
      onOutcome,runEnded:()=>bossDown||director!.state.stage==='done',
      // D-051 (A4): the trigger stays the ETA; in mode 'ninhos' the boss leaves from the biggest live nest.
      spawnBoss:(ctx,at)=>{boss.spawnBoss(ctx,nests?.bossSpot()??at);},
      // chaveiro-no-final: in mode 'ninhos' the car opens only once the nests' ramp is over (the end at the peak).
      ...(nestMode?{finalNotBefore:NEST_PACE.ramp}:{}),
      // balanco-6p-facil: and his ride follows the room (a bigger one waits longer for him).
      ...(nestMode?{ride:CHAVEIRO_PACE.ride}:{}),
      // D-052: the car moves on the sticks of this tick, around the standing structures and the living nests (D-051).
      input:id=>sticks.get(id),blocks:()=>structureTargets(stonewards.state,false),
      nests:()=>nests?nests.state.nests.filter(n=>!n.down):[],
      helper:id=>!!options.bot?.(id)||!!options.autopilot?.(id),
      // D-052: the moto rides around a muro built across his way.
      muros:{radius:MURO_BLOCK_R,standing:()=>blockingPieces(stonewards.state)}},cp?.chaveiro);
    if(nestMode){
      const entrances={N:p.spawnN,S:p.spawnS,L:p.spawnL,O:p.spawnO},car={x:wall.x,y:wall.y},city=cityTerrain;
      // The plan's keep-offs: the moto's four possible routes (one per entrance) and the run's start.
      const routes=ENTRANCES.map(e=>planChaveiro(world.seed,openPlanner.grid,entrances,car,e).route.points);
      nests=createNests({
        // The plan is drawn once, for the room size of the first step (or the checkpoint's); its sleepers come with it.
        plan:players=>{
          const plan=cityNestPlan(city,world.seed,{players,routes,start:cityUnoStart(city),...(options.nestPopulation!==undefined?{population:options.nestPopulation}:{})});
          const sleep=sono=createSono({plan,kindOf:sleeperKinds(plan,world.seed,round=>director!.roster(round)),hpScale:playerScale(players).hp*(ROUNDS[SLEEPER_ROUND-1].hpNinhos??ROUNDS[SLEEPER_ROUND-1].hpScale),speedMap:citySpeed,
            // Shots and kills are heard from the previous step's events; the alarm and the riding moto while they last.
            events:()=>world.lastEvents,
            ambient:ctx=>{
              const c=chaveiro!.state,out:AmbientNoise[]=[];
              if(ctx.tick<c.car.alarmUntil)out.push({key:'alarme',x:c.car.x,y:c.car.y,...NOISE.alarm});
              if(c.startTick!==null&&c.ended===undefined&&c.moto.task==='anda')out.push({key:'moto',...chaveiro!.moto(),...NOISE.moto});
              return out;
            },
            // Card bichos-travados: the safety net never empties the car's surroundings (a siege on it stands still).
            keep:()=>{const c=chaveiro!.state.car;return [{x:c.x,y:c.y}];},
            // Card monstros-espalhados: a noise inside a safe place draws the alerta to its door, never in.
            door:at=>safePlaceAt(city,at)?.opening,
            // The minuto de Minerva: no noise wakes anyone, the sight only within MINERVA_REACH (the AI holds them still).
            minerva:ctx=>!!nests?.minerva(ctx.tick)},cp?.sono);
          world.sleepers=sleep.sleepers;
          // Every standing nest takes the players' hits (sono's index: shots, cones, tower blasts, a tap); a hit is
          // also a noise for the other nests. A fallen one leaves the index by itself (hit() true).
          for(const n of plan.nests)if(!cp?.ninhos?.nests.find(c=>c.id===n.id)?.down)sleep.addTarget({id:`${NEST_TARGET}${n.id}`,x:n.x,y:n.y,radius:n.radius,
            hit:(ctx,amount)=>{sleep.noise(n.id,{x:n.x,y:n.y,...NOISE.nest});return nests!.hit(ctx,n.id,amount);}});
          return plan;
        },
        wake:(ctx,id)=>{sono?.wakeNest(ctx,id,'ninho');},
        players:ctx=>director!.scalePlayers(ctx),
        maxEnemies:MAX_ENEMIES,
        createEnemy:(ctx,kind,point,scale)=>hasRoom(ctx.enemies,MAX_ENEMIES)&&isEnemyKind(kind)?inCity(createEnemy(ctx,kind,point,scale)):undefined,
        roster:round=>director!.roster(round),
        // Card monstros-espalhados: the waves walk in from the avenue ends (the moto's entrances, each with its route to
        // the car); the map's share wakes along that route; the map's dead count the kills against the quota.
        entrances:ENTRANCES.map((e,i)=>({id:e,x:entrances[e].x,y:entrances[e].y,route:routes[i]})),
        mapDead:()=>sono?.dead()??0,
        // inicio-no-uno-caixas-120: a wave is over (the time to explore opens) with calm at the car and no boss up
        // (boss-fim-onda-1: the boss at the end of wave 1 holds it until he falls).
        calm:ctx=>!(boss.state.bossId&&!boss.state.defeated)&&calmAround(ctx.enemies.values(),chaveiro!.state.car,CALMA.checkpointR),
        // inimigos-querem-o-uno: each time to explore gives the Uno back CAR_REPAIR_SHARE of its limit.
        onExplore:ctx=>{chaveiro!.repair(ctx);},
        recruit:(ctx,route,count,tune)=>sono?.recruit(ctx,route,count,tune)??0,
        clear:(x,y,r)=>city.clearDisc(x,y,r),
        // A fallen nest pays the team, split among the seated like the boss (carteira-e-pix).
        pay:n=>{splitAmong(seatedPlayers(world.players),n,stonewards.state);},
      },cp?.ninhos);
      // Card boss-fim-onda-1: the chefão when the 1st wave's last body leaves, its fight the final boss's (his own numbers).
      chefao=createChefao({seed:world.seed,...(options.chefao!==undefined?{who:options.chefao}:{}),
        nests:()=>nests?.state,entrances:ENTRANCES.map((e,i)=>({id:e,x:entrances[e].x,y:entrances[e].y,route:routes[i]})),car,
        ...(crates?{dropChest:(ctx:SimContext,at:{x:number;y:number})=>{crates.dropCrate(ctx,at,WAVE_BOSS.crate);}}:{}),
        summon:(ctx,kind,at)=>hasRoom(ctx.enemies,MAX_ENEMIES)&&isEnemyKind(kind)?inCity(createEnemy(ctx,kind,at,1)):undefined,
        minionKinds:()=>director?.bossMinionKinds(),
        ...(bossSteer?{steer:bossSteer.hero,speedMap:citySpeed}:{}),
        say:(ctx,enemy,lines,key)=>enemyAi.say(ctx,enemy,lines,key),
        scalePlayers:ctx=>director?.scalePlayers(ctx)??1,
        enrageAfterTicks:ticks(CALMA.bossEnrageS),
        siege:()=>chaveiro?.targets().find(t=>t.id===CAR_ID),hitSiege:(ctx:SimContext,id:string,b:EnemyState)=>{if(id===CAR_ID)chaveiro?.hitCar(ctx,b);},
      },cp?.chefao);
    }
  }
  // Bancos: the city's ATMs, in both modes (after the chaveiro: its route is their anchor), never on the island or the endless map.
  if(cityTerrain){
    const loot=cityLoot(world.terrain),wall=stonewards.state.wall;
    // The streets around the car first (an intermission trip away), the loot points as a fallback.
    const ring=ringCandidates({x:wall.x,y:wall.y},(x,y,r)=>cityTerrain.clearDisc(x,y,r));
    banks=createBanks({seed:world.seed,candidates:[...ring,...(loot?.crates??[]).map(c=>({id:c.node.id,x:c.node.x,y:c.node.y}))],car:{x:wall.x,y:wall.y},
      ...(chaveiro?{route:chaveiro.route.points}:{}),plaza:cityTerrain.asset.points.praca,
      wallet:{add:(n,to)=>{addGrana(to,n);}},work:id=>work.get(id)},cp?.banks);
    // Veículos: in both city modes too (a ride ends on moving the car).
    vehicles=createVehicles({seed:world.seed,clear:(x,y,r)=>cityTerrain.clearDisc(x,y,r),...(chaveiro?{busy:(id:string)=>chaveiro!.busy(id)}:{})},cp?.veiculos);
  }
  const revive=createReviveSystem({onTeamDefeated:()=>onOutcome('defeat'),runEnded,reconnectGraceTicks:options.reconnectGraceTicks,...(cp?{revives:cp.revives}:{})});
  // Fear: the Uno (the chaveiro's car) is company, else the base (the wall).
  const fear=(options.fear??options.combat==='manual')?createFearSystem({runEnded,bot:options.bot,autopilot:options.autopilot,
    base:()=>{const car=chaveiro?.targets().find(t=>t.id===CAR_ID);return car?{x:car.x,y:car.y}:{x:stonewards.state.wall.x,y:stonewards.state.wall.y};}}):undefined;

  // D-051 manual combat: the inventory (sim/inventory.ts); the old kit-torre is one team ficha, a kit de torre
  // (torre-pela-caixa) its piece built for free on the grid.
  const inventory=manual?inventorySystem():undefined;
  const inventoryHooks:InventoryHooks={addTowerToken:()=>{stonewards.state.balance.units+=UNITS_PER_TOKEN;return true;},
    buildKit:(ctx,p,piece,order,requestId)=>stonewards.buildKit(ctx,p.id,{piece,c:order.c,r:order.r,...(order.rot===1?{rot:1 as const}:{})},requestId)};

  world.clearSystems();
  for(const system of [
    ((players:SimSystem):SimSystem=>({id:players.id,step(ctx){steered.clear();sticks.clear();work.clear();players.step(ctx);}}))(
      // D-052: a hero holds still while their free obra is under way, else walks at the car's pace while moving it.
      // Card uno-bloqueio-corpo: and nobody stands inside the car's body.
      // NEW-20261023-ORQ-barracas-no-caminho: and at half the step while on a barraca.
      playersSystem(takeInput,options.autopilot,manual,id=>holdsObra(stonewards.state,id,world.tick)?0:chaveiro?.moverCap(id),()=>chaveiro?.state.car,
        at=>heroSlow(stonewards.state,at))),
    // D-051: the nests step in the director's slot (no new system id), right after it.
    // The sleepers right after (sono.step before the enemy-ai: re-index after the wakes, note the dead).
    // Card boss-fim-onda-1: the chefão stops the time; while he stands the nests hold their clock (no wave, no drip).
    {id:'director',step(ctx:SimContext){
      director!.step(ctx);
      if(nests&&chefao?.up())holdWaveClock(nests.state);else nests?.step(ctx);
      sono?.step(ctx);applyEliteExtras(ctx);
    }} satisfies SimSystem,
    zueira,enemyAi,
    // Card boss-fim-onda-1: the chefão of the 1st wave steps in the boss's slot (no new system id).
    chefao?{id:boss.id,step(ctx:SimContext){boss.step(ctx);chefao!.step(ctx);}} satisfies SimSystem:boss,
    createWeaponSystem({cap:MAX_PROJECTILES,...(manual?{manual:{attacking:(id:string)=>manual.attacking.has(id),
      // BUG-20261023-ORQ-tiro-na-direcao-mobile: a person's attack goes off toward the aim/facing even into the air; bots keep the target rule.
      free:(id:string)=>!options.bot?.(id)&&!options.autopilot?.(id)}}:{}),
      // Bicos: nobody fires from inside a shop.
      ...(chaveiro||banks?{busy:(id:string)=>!!chaveiro?.busy(id)||banks?.working(id)!==undefined}:{})}),createProjectileSystem({cap:MAX_PROJECTILES}),createTelegraphSystem(),
    {id:'pickups',step(ctx:SimContext){
      progression.pickups.step(ctx);
      // D-051 (same slot, no new system id): everyone gets the inventory (the Faca de Pão) on their first tick in the
      // run (a join, a rematch); items walked over go to it.
      if(inventory){for(const p of ctx.players.values())if(!hasInventory(p)&&!p.spectator){p.build=manualStartingBuild();refreshStats(p);}inventory.step(ctx);}
      crates?.step(ctx);
      // Veículos: the parked vehicles and the rides, in the same slot (no new system id).
      vehicles?.step(ctx);
    }},
    // Fear steps in the revive slot (no new system id), right before it: a hero the dark takes counts for the defeat now.
    progression.progression,fear?{id:revive.id,step(ctx:SimContext){fear.step(ctx);revive.step(ctx);}} satisfies SimSystem:revive,
    // D-047: the chaveiro steps right after the structures (same slot of the order, no new system id).
    // Bancos: the banks step in the same slot, after the chaveiro (no new system id).
    // Card boss-fim-onda-1: while the chefão stands the chaveiro's ETA holds too (holdChaveiroClock).
    chaveiro||banks?{id:stonewards.id,step(ctx:SimContext){
      stonewards.step(ctx);
      if(chaveiro&&chefao?.up())holdChaveiroClock(chaveiro.state);else chaveiro?.step(ctx);
      banks?.step(ctx);
    }} satisfies SimSystem:stonewards,
  ])world.register(system);

  const offKill=world.onKill((enemy,by,ctx,credit)=>{
    progression.dropLoot(ctx,enemy,by);
    // The anão's belt explodes (telegraphed; enemies it kills come back here as their own, queued kills: D-011).
    enemyAi.onKill(ctx,enemy);
    zueira.noteKill(enemy,by,ctx.tick);
    // D-047/D-048, NEW-20261014-ORQ-carteira-e-pix: every kill pays Grana into a wallet, in every world. Since
    // NEW-20261024-ORQ-tirar-drops-cedula-girando it falls as a cédula a second later (progression.ts dropGrana): whoever
    // walks by takes it, else it flies to the killer, a tower's owner (credit) or the nearest hero. The boss is still
    // split among every seat at once.
    if(enemy.boss)payKill(ctx.players,enemy,granaPerKill(enemy),stonewards.state,by,credit);
    else progression.dropGrana(ctx,enemy,granaPerKill(enemy),killPayee(ctx.players,by,credit));
    for(const ally of ctx.players.values())if(!ally.spectator)(ally as RunPlayer).score=((ally as RunPlayer).score??0)+KILL_SCORE;
    // Decide on the killing blow: the boss onDefeated hook only runs on the next step, after revive could call a defeat.
    if(enemy.boss&&!chaveiro){bossDown=true;onOutcome('victory');}
  });
  const offZero=world.onPlayerZero((player:SimPlayer,source,ctx)=>{downPlayer(ctx,player,source);});

  return {
    director,progression,boss,enemyAi,revive,stonewards,zueira,...(avenues?{avenues}:{}),...(chaveiro?{chaveiro}:{}),...(nests?{nests}:{}),...(chefao?{chefao}:{}),sono:()=>sono,...(banks?{banks}:{}),...(vehicles?{vehicles}:{}),
    objectiveView:()=>chaveiro?.view(world.tick),
    bankViews:()=>banks?.view(world.tick),
    ...(crates?{crates}:{}),
    ...(inventory?{inventory:{
      equip:(id,slot)=>{const p=world.players.get(id);return p?equipSlot(world,p,slot):{ok:false,reason:'player'};},
      use:(id,slot)=>{const p=world.players.get(id);return p?useSlot(world,p,slot,inventoryHooks):{ok:false,reason:'player'};},
      drop:(id,slot)=>{const p=world.players.get(id);return p?dropSlot(world,p,slot):{ok:false,reason:'player'};},
      take:(id,pickup)=>{const p=world.players.get(id);return p?takeItem(world,p,pickup):{ok:false,reason:'player'};},
      place:(id,slot,order,requestId)=>{const p=world.players.get(id);return p?placeKit(world,p,slot,order,inventoryHooks,requestId):{ok:false,reason:'player'};},
      placeNear:(id,slot)=>{const p=world.players.get(id);return p?placeKitNear(world,p,slot,inventoryHooks):{ok:false,reason:'player'};},
    } satisfies RunSystems['inventory']}:{}),
    state:()=>({director:director!.state,progression:progression.state,boss:boss.state,enemyAi:enemyAi.state(),revives:[...revive.revives],stonewards:stonewards.state,zueira:zueira.state,
      ...(chaveiro?{chaveiro:chaveiro.state}:{}),...(crates?{crates:crates.state}:{}),...(nests?{ninhos:nests.state}:{}),...(chefao?{chefao:chefao.state}:{}),...(sono?{sono:sono.state}:{}),...(banks?{banks:banks.state}:{}),...(vehicles?{veiculos:vehicles.state}:{})}),
    dispose(){offKill();offZero();if(sono&&world.sleepers===sono.sleepers)world.sleepers=undefined;if(damageScale&&world.playerDamageScale===damageScale)world.playerDamageScale=undefined;world.recordLastHit=false;},
  };
}
