import {TerrainField,DEFAULT_SEED,TERRAIN_VERSION,CityTerrain,type WorldKind} from '../src/maps/index.ts';
import {CHUNK_VERSION} from '../src/maps/index.ts';
import type {FrameInput,WorldDescriptor} from '../src/protocol/index.ts';
import {GRACE_MS,MAX_PLAYERS,emptyStats,packEnemy,packPlayer,packStats,wireHp,wireRound as round,type EnemyWire,type Player,type PlayerExtraWire,type RunStats,type Snapshot} from '../src/protocol/index.ts';
import { worldSpawn, type Point } from '../src/maps/index.ts';
import {SimWorld,stateHash,cityRunStart,type StampedEvent} from '../src/sim/index.ts';
import {SpatialHash} from '../src/sim/index.ts';
import {coastalSpawnPoints} from '../src/sim/index.ts';
import {createRunSystems,type RunOutcomeKind,type RunSystems,type RunSystemsOptions,type RunSystemsState,type WorldCheckpoint} from '../src/sim/index.ts';
import {ITEMS} from '../src/sim/index.ts';
import {RUN_ORDER,DEFAULT_FACING,type PlayerInput,type RunPlayer} from '../src/sim/index.ts';
import {classBonusOf,rotationIds,startingBuild} from '../src/rules/index.ts';
import {resetSkill,skillReadyTick,clearMoveEffects,activeMoveEffects,isSugared,isPrime} from '../src/sim/index.ts';
import {refreshStats} from '../src/rules/index.ts';
import type {ChooseResult} from '../src/sim/index.ts';
import {BASE_STATS,CAR_ID,MAX_PASSIVES,MAX_WEAPONS} from '../src/contract/index.ts';
import type {CidaBuyResult,CombatMode,ObjectiveKind,ObjectiveResult,ObjectiveView,PixResult,SimPlayer} from '../src/contract/index.ts';
import {PIX_MAX} from '../src/contract/index.ts';
import {addGrana,drawMemo,seatedPlayers,splitAmong,walletOf} from '../src/sim/index.ts';
import type {EnemyState,LevelOffer,RoundState,SimEvent,Telegraph} from '../src/contract/index.ts';
import type {CampView,NodeView,RunView,StructureView,TelegraphView} from '../src/contract/index.ts';
import {INTEREST_HYSTERESIS,INTEREST_RADIUS} from '../src/contract/index.ts';
import {nodesNear,remainingOf,touchedNode,WORK_PER_UNIT} from '../src/sim/index.ts';
import type {BuyResult} from '../src/sim/index.ts';
import {DEFENSES,RAIL,phaseOf,type DefenseState,type TowerResult} from '../src/sim/index.ts';
import type {RunState} from '../src/sim/index.ts';
import {InputTrack,STEP_MS} from '../src/protocol/index.ts';
import {ShameTracker} from '../src/sim/index.ts';
import type {ZueiraLab} from '../src/sim/index.ts';
/**
 * The room's simulation (was src/game/net/shared.ts): seats, input tracks, bots and the run systems, plus the frames it
 * hands the encoders (protocol 3 snapshots, protocol 4 FrameInput). It speaks the wire, so it lives with the room and
 * not in src/sim/ (sim never imports protocol). Room texts and the protocol 3 format are src/protocol/room.ts;
 * movement prediction is src/maps/prediction.ts.
 */
/**
 * The world every room plays on (D-019: rounds on a giant map). The endless world shipped once the room spoke protocol
 * 4+ with areas of interest (VGM-042b), the camera followed the hero (camera-segue) and the ground was drawn in tiles
 * around the camera (terreno-em-blocos). The island stays as an internal test world (Simulation default, LAB_WORLD=ilha).
 */
export const DEFAULT_WORLD:WorldKind='infinito';
/** What protocol 4 frames say about the terrain (FrameInput.world); the client rebuilds the same TerrainField from it. */
export function worldDescriptor(terrain:TerrainField):WorldDescriptor{
  const kind=terrain.world==='cidade'?'cidade':terrain.chunks?'infinito':'ilha';
  return {kind,terrainVersion:TERRAIN_VERSION,generatorVersion:terrain.chunks?CHUNK_VERSION:0,seed:terrain.seed,signature:terrain.signature};
}
/** PIX request ids remembered (stonewards `handled`, shared with the forge and the towers under their own prefixes). */
const PIX_HANDLED_LIMIT=256;
/** Revive progress moves every tick while someone helps; two decimals are plenty for a ring and keep deltas small. */
const progress=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*100)/100;
export const packPlayerExtra=(p:ServerPlayer,stats?:RunStats):PlayerExtraWire=>{
  const wire:PlayerExtraWire=[p.id,wireHp(p.stats.maxHp),(p.downed?1:0)|(p.eliminated?2:0),p.downed?progress(p.downed.progress):0,p.downed?.bleedOutTick??0,
    p.build.weapons.map(i=>[i.id,i.level]),p.build.passives.map(i=>[i.id,i.level])];
  if(stats)wire.push(packStats(stats));
  return wire;
};

/** Server player: protocol 3 wire fields plus the contract's combat state (build, stats, facing, weaponReady). */
export type ServerPlayer = Player & RunPlayer & { spectator:boolean };
export type SimOutcome=RunOutcomeKind;
const runSeed=(seed:number,run:number)=>(seed^Math.imul(run+1,0x9e3779b9))>>>0;
/** Ticks a dead enemy keeps being sent as a tombstone, and the event window of RunExtras. */
const TOMBSTONE_TICKS=10;
/** Events kept for snapshots; the Room's cursor sends each once, this only bounds memory between broadcasts. */
const EVENT_BUFFER_TICKS=40;
/** Client view of a telegraph (VGM-039, D-036 kind): the shape, its timing and what it is; owner and damage stay on the server. */
export function telegraphView(t:Telegraph):TelegraphView{
  return {id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick,...(t.kind?{kind:t.kind}:{})};
}
/** Shallow copy of an event with its non-integer numbers rounded like the rest of the wire (15.600000000000001 → 15.6). */
export function wireEvent(event:StampedEvent):StampedEvent{
  const out:Record<string,unknown>={};
  for(const [k,v] of Object.entries(event))out[k]=typeof v==='number'&&!Number.isInteger(v)?round(v):v;
  return out as StampedEvent;
}
/** Client steps whose tick the room remembers (D-036 confirmed check): past InputTrack's history (1.5 s + 16 steps). */
const STEP_TICKS_KEPT=64;
/** Player attack animation is refreshed at most this often by automatic weapon fire. */
const ATTACK_ANIMATION_TICKS=12;
const spawnSlot=(slot:number,at:Point)=>({x:at.x+(slot%3-1)*.7,y:at.y+Math.floor(slot/3)*.7});
/**
 * Seat fields a checkpoint never carries (E5-checkpoint-por-round): who sits there and its connection (the restored
 * seat's own), the tap target (an enemy id of the cut round) and what equip/refreshStats derive from class and build.
 * D-051: neither who hit me last nor the auto aim's target (enemy ids of the cut round, manual combat only).
 */
const SEAT_FIELDS:ReadonlySet<string>=new Set(['id','name','classId','online','ack','spectator','target','stats','classBonus','lastHitBy','autoTarget']);
/** A player's run in a checkpoint: the class it was played with (checked on resume) and every other own field. */
export interface PlayerCheckpoint {id:string;classId:string;run:Record<string,unknown>}
/**
 * The simulation part of a room checkpoint (E5-checkpoint-por-round), taken at a round's intermission: the run's seed
 * and number (runSeed(seed, runs) must give the world's seed back), the world without live entities, every system's
 * state, each player's run (position, hp, build, absolute ticks...) and the prize counters. JSON-safe.
 */
export interface SimCheckpoint {seed:number;runs:number;world:WorldCheckpoint;systems:RunSystemsState;players:PlayerCheckpoint[];stats:[string,RunStats][];
  /** checkpointShape of the writing code's fresh run on this world (Simulation.checkpointShape): see CheckpointShape. */
  shape:string}
/**
 * The shape of a JSON value (E5-checkpoint-por-round): its type, an object's keys (undefined values left out, sorted
 * when hashed) and an array's FIRST element (cheap and deterministic; tuples such as [id, value] keep their head's type).
 */
export type CheckpointShape={t:'number'|'string'|'boolean'|'null'}|{t:'array';of?:CheckpointShape}|{t:'object';keys:Record<string,CheckpointShape>};
export function shapeOf(v:unknown):CheckpointShape|undefined{
  if(v===null)return {t:'null'};
  if(Array.isArray(v)){const of=v.length?shapeOf(v[0]):undefined;return of?{t:'array',of}:{t:'array'};}
  if(typeof v==='object'){
    const keys:Record<string,CheckpointShape>={};
    for(const k of Object.keys(v as object).sort()){const shape=shapeOf((v as Record<string,unknown>)[k]);if(shape)Object.defineProperty(keys,k,{value:shape,enumerable:true,writable:true,configurable:true});}
    return {t:'object',keys};
  }
  return typeof v==='number'||typeof v==='string'||typeof v==='boolean'?{t:typeof v as 'number'|'string'|'boolean'}:undefined;
}
/** The fingerprint of a value's shape (stateHash of shapeOf): what a checkpoint stores of its code's fresh run. */
export const shapeFingerprint=(v:unknown)=>stateHash(shapeOf(v)??null);
/**
 * Fields a fresh run holds and a run deletes later (path from the capture's root, `[]` for an array's head), so a
 * stored checkpoint may lack them: the city's "raise the barricades" flag, gone once they rose (round 2). Found by
 * playing whole runs (tests/sim/checkpoint-cidade.test.ts plays the city into round 2 and resumes it).
 */
const DROPPED_LATER:ReadonlySet<string>=new Set(['systems.stonewards.raiseBarricades']);
/**
 * `stored` has everything `fresh` (the current code's fresh run) has, DROPPED_LATER aside: every key with the same
 * type, an array's head against the fresh head when both have one. Extra keys are fine: what only appears later in a
 * run (a plan, the defenses, a downed mark) is not in a fresh run. A fresh null takes anything (rng states start null).
 */
function conforms(fresh:CheckpointShape,stored:unknown,path=''):boolean{
  if(fresh.t==='null')return true;
  if(fresh.t==='array')return Array.isArray(stored)&&(!fresh.of||!stored.length||conforms(fresh.of,stored[0],`${path}[]`));
  if(fresh.t==='object')return isObject(stored)&&Object.entries(fresh.keys).every(([k,shape])=>{
    const at=path?`${path}.${k}`:k;
    return Object.hasOwn(stored,k)&&stored[k]!==undefined?conforms(shape,stored[k],at):DROPPED_LATER.has(at);
  });
  return typeof stored===fresh.t;
}
/** The class of the throwaway seat whose fresh run gives the code's shape (any class: equip writes the same fields). */
const SHAPE_CLASS='cidadao-comum';
/** Per world kind (and city signature), the current code's fresh-run shape and its fingerprint; built once per process. */
/** pot/legacy: the older builds' fingerprints; preBanks/banks (city): this code's without the banks, and a fresh run's bank state (migrateCheckpoint). */
const SHAPES=new Map<string,{shape:CheckpointShape;fingerprint:string;pot:string;legacy:string;preBanks?:string;banks?:unknown}>();
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const tickOk=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const pointOk=(v:unknown)=>isObject(v)&&finite(v.x)&&finite(v.y);
/** Owned items of one kind: known ids of that kind, levels 1..maxLevel, no duplicates, at most `max`. */
function itemsOk(list:unknown,kind:'weapon'|'passive',max:number){
  if(!Array.isArray(list)||list.length>max)return false;
  const seen=new Set<string>();
  for(const item of list){
    const def=isObject(item)&&typeof item.id==='string'?ITEMS.get(item.id):undefined;
    if(!def||(kind==='passive')!==(def.kind==='passive')||seen.has(def.id)||!Number.isSafeInteger(item.level)||(item.level as number)<1||(item.level as number)>def.maxLevel)return false;
    seen.add(def.id);
  }
  return true;
}
/** A player's stored run: a body where it can be, a build of this game's items, finite ticks. */
function playerRunOk(run:unknown){
  if(!isObject(run)||!finite(run.x)||!finite(run.y)||!finite(run.hp)||run.hp<0||!pointOk(run.facing))return false;
  const build=run.build;
  if(!isObject(build)||!itemsOk(build.weapons,'weapon',MAX_WEAPONS)||!itemsOk(build.passives,'passive',MAX_PASSIVES))return false;
  if(!isObject(run.weaponReady)||!Object.values(run.weaponReady).every(finite))return false;
  for(const key of ['score','attackTick','skillTick','skillReadyTick','invulnerableUntil','slowUntil','slipUntil','fastUntil','mightUntil','guardUntil'])if(run[key]!==undefined&&!finite(run[key]))return false;
  // The wallet (NEW-20261014-ORQ-carteira-e-pix): whole R$, never negative.
  if(run.grana!==undefined&&!(Number.isSafeInteger(run.grana)&&(run.grana as number)>=0))return false;
  return run.downed===undefined||isObject(run.downed)&&finite(run.downed.bleedOutTick)&&finite(run.downed.progress);
}
/** Shape of a stored SimCheckpoint (it came from storage: an older build or junk must not reach the systems). */
function simCheckpointOk(cp:unknown,seed:number):cp is SimCheckpoint{
  if(!isObject(cp)||!tickOk(cp.runs)||cp.seed!==runSeed(seed,cp.runs))return false;
  const w=cp.world,sys=cp.systems;
  if(!isObject(w)||w.seed!==cp.seed||!tickOk(w.tick)||!tickOk(w.runStartTick)||w.runStartTick>w.tick||!tickOk(w.eventSeq))return false;
  if(!Array.isArray(w.counters)||!w.counters.every(c=>Array.isArray(c)&&typeof c[0]==='string'&&tickOk(c[1])))return false;
  if(!isObject(w.team)||!finite(w.team.xp)||!finite(w.team.level)||!finite(w.team.nextXp))return false;
  const r=w.round;
  if(!isObject(r)||!Number.isSafeInteger(r.index)||!Number.isSafeInteger(r.total)||(r.phase!=='prepare'&&r.phase!=='wave')||!tickOk(r.phaseEndsTick))return false;
  if(!Array.isArray(w.offers)||!w.offers.every(o=>Array.isArray(o)&&typeof o[0]==='string'&&Array.isArray(o[1])))return false;
  if(!Array.isArray(w.pickups)||!w.pickups.every(p=>isObject(p)&&typeof p.id==='string'&&finite(p.x)&&finite(p.y)))return false;
  if(!isObject(sys)||!isObject(sys.director)||typeof sys.director.stage!=='string'||!isObject(sys.director.round)||!isObject(sys.progression)||!isObject(sys.boss)||!isObject(sys.enemyAi))return false;
  if(!Array.isArray(sys.revives)||!sys.revives.every(e=>Array.isArray(e)&&typeof e[0]==='string'&&finite(e[1])))return false;
  if(!isObject(sys.stonewards)||!isObject(sys.stonewards.wall)||!isObject(sys.stonewards.balance)||!isObject(sys.zueira)||!Array.isArray(sys.zueira.plan))return false;
  if(!Array.isArray(cp.players)||!cp.players.every(p=>isObject(p)&&typeof p.id==='string'&&typeof p.classId==='string'&&playerRunOk(p.run)))return false;
  return Array.isArray(cp.stats)&&cp.stats.every(e=>Array.isArray(e)&&typeof e[0]==='string'&&isObject(e[1]))&&typeof cp.shape==='string';
}
/** A city barricade as the stonewards state keeps it (cidade-06); read structurally so rooms do not pin its whole type. */
interface BarricadeRow {id:string;x:number;y:number;hp:number;maxHp:number;down?:boolean}

export class Simulation {
  readonly terrain:TerrainField;
  readonly seed:number;
  readonly players=new Map<string,ServerPlayer>();
  /** Authoritative SimContext with every horde system registered (VGM-042). */
  readonly world:SimWorld;
  private systems:RunSystems;
  private runs=0;
  private result?:SimOutcome;
  private pending?:{victory:boolean;defeat:boolean};
  /** Per player: the client's change segments and the held state, one step per tick (input-10hz). */
  private tracks=new Map<string,InputTrack>();
  /** Enemies after the last step plus any added since (references; a removed one keeps its final position). */
  private alive=new Map<string,EnemyState>();
  private tombs=new Map<string,{wire:EnemyWire;tick:number}>();
  private recent:{tick:number;event:StampedEvent}[]=[];
  /** Per-run counters for the prizes; outside stateHash on purpose (they never decide a future tick). */
  private counters=new Map<string,RunStats>();
  /** "Momento mais vergonhoso" of the run (VGM-053B); outside stateHash too (it never decides a future tick). */
  private shame=new ShameTracker();
  /** Lab only (LAB_ZUEIRA): the zueira plan every run of this simulation uses instead of the seed's. */
  zueiraLab?:ZueiraLab;
  /** This room's own fork of the decoded city (cidade-06): its blockers (barricades) never leak into other rooms. */
  private readonly city?:CityTerrain;
  /**
   * cidade-06 (E5): the city barricades go into the frames' structures as kind 'barricada' only when true. The city room
   * turns it on (barricadas-cliente: the client draws them and repairs them from the camp window); default off.
   */
  cityStructures:boolean;
  /**
   * City balance knobs of every run of this simulation (cidade-11, src/sim/city/balance.ts): headless benches only;
   * rooms never pass it (the city plays CITY_BALANCE). Ignored outside the city.
   */
  private readonly cityBalance?:RunSystemsOptions['cityBalance'];
  /** D-040 rotation override (undefined: the run's default, on). */
  private readonly rotation?:boolean;
  /**
   * D-047: the match objective of every run (RunSystemsOptions.objective; 'chaveiro' only matters in the city). The
   * Room turns it on for its city rooms (RoomOptions.objective); a Simulation built directly (tests, tools) has none.
   */
  readonly objective?:ObjectiveKind;
  /**
   * D-051: how the heroes of every run fight (RunSystemsOptions.combat). 'manual': the attack button and the equipped
   * weapon, no skill (tap() refuses). Absent: the automatic weapons, as before. The Room passes RoomOptions.combat.
   */
  readonly combat?:CombatMode;
  /**
   * `world` defaults to the island here (the deterministic lab most sim tests were written on); rooms pass
   * DEFAULT_WORLD, the endless world (D-019): spawn around the players (spawn-em-volta), wide positions and areas of
   * interest in the frames (rede-mapa-grande), base at the origin.
   */
  /**
   * `terrain` injects a prebuilt surface (the decoded city, D-034); otherwise the seed builds the island or endless world.
   * A CityTerrain is forked (cidade-06): the decoded city is shared by the process, the barricade blockers are this room's.
   */
  constructor(seed=DEFAULT_SEED,options:{world?:WorldKind;terrain?:TerrainField;cityStructures?:boolean;cityBalance?:RunSystemsOptions['cityBalance'];
    /** D-040 rotation (RunSystemsOptions.rotation, default on); false plays the round table's nine kinds. */
    rotation?:boolean;
    /** D-047: the match objective (city only; default none). */
    objective?:ObjectiveKind;
    /** D-051: the manual combat ('manual'); default the automatic weapons. */
    combat?:CombatMode}={}){
    if(options.world==='cidade'&&options.terrain?.world!=='cidade')throw new Error("world 'cidade' needs the decoded city terrain");
    const generated=options.world==='cidade'?undefined:options.world;
    this.city=options.terrain instanceof CityTerrain?options.terrain.fork():undefined;
    this.cityStructures=options.cityStructures??false;
    this.cityBalance=options.cityBalance;this.rotation=options.rotation;this.objective=options.objective;if(options.combat==='manual')this.combat='manual';
    this.seed=seed;this.terrain=this.city??options.terrain??new TerrainField(seed,{world:generated});
    this.world=new SimWorld({terrain:this.terrain,seed:runSeed(seed,0),players:this.players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    this.systems=this.assemble();
  }
  get tick(){return this.world.tick;}
  /** Events of the last step, with monotonic eventId. */
  get events(){return this.world.lastEvents;}
  get enemies():EnemyState[]{return [...this.world.enemies.values()];}
  /** Decided once per run; a victory beats a defeat decided in the same tick. */
  get outcome():SimOutcome|undefined{return this.result;}
  get victory(){return this.result==='victory';}
  /** Systems of the current run (director, progression, boss, enemyAi, revive). */
  get run():RunSystems{return this.systems;}
  /** The current run's rotation (D-040) as roster ids; [] until the director draws it on the run's first step. */
  rotationIds():string[]{const r=this.systems.director.state.rotation;return r?rotationIds(r):[];}
  /** Room bots (D-025): played by the room, no socket; their stick goes through setBotInput, one step per tick. */
  readonly bots=new Set<string>();
  /**
   * 3g-rede-sem-teleporte: people whose connection is gone; the room's light bot plays their hero (setBotInput) until
   * they are back, so a drop does not leave a statue in the horde.
   */
  readonly autopilot=new Set<string>();
  private botInputs=new Map<string,PlayerInput>();
  private botSeq=0;
  private assemble(checkpoint?:RunSystemsState){
    return createRunSystems(this.world,{
      takeInput:id=>{
        const bot=this.botInputs.get(id);
        if(bot){const step={...bot,seq:++this.botSeq};if(bot.skill)bot.skill=false;return step;}
        const p=this.players.get(id),step=p?this.tracks.get(id)?.next(p,this.clock):undefined;
        if(step)this.recordStep(id,step.seq);
        return step;
      },
      autopilot:id=>this.autopilot.has(id),
      // Inside a step the tick decides (victory beats a same-tick defeat); between ticks (commands) the first outcome stands.
      onOutcome:outcome=>{if(this.result)return;if(this.pending)this.pending[outcome]=true;else this.result=outcome;},
      // The run waits GRACE_MS for its last player standing who dropped (VGM-047), then it is a defeat (042a R1). The
      // seat itself may be held longer (the whole run while someone is connected, 3g-rede-sem-teleporte).
      reconnectGraceTicks:Math.round(GRACE_MS/STEP_MS),
      zueiraLab:this.zueiraLab,
      ...(this.cityBalance?{cityBalance:this.cityBalance}:{}),
      ...(this.rotation!==undefined?{rotation:this.rotation}:{}),
      ...(this.objective?{objective:this.objective}:{}),
      ...(this.combat?{combat:this.combat}:{}),
      ...(checkpoint?{checkpoint}:{}),
    });
  }
  /**
   * The run as it stands at a round's intermission, for a restart of the room (E5-checkpoint-por-round): see
   * SimCheckpoint. Deep copies only; live enemies, projectiles and telegraphs are left out (WorldCheckpoint).
   */
  checkpoint():SimCheckpoint{return {...this.capture(),shape:this.freshShape().fingerprint};}
  /**
   * What this code's fresh run on this world captures, and its fingerprint (E5-checkpoint-por-round): a throwaway
   * simulation on the same world kind (the city on this room's decoded city), one seat, never stepped. Any change to
   * a field a system, the world or a seat holds from the start changes it, so a checkpoint written by another build
   * is refused without a manual CHECKPOINT_V bump. Fields that only appear later in a run are not in it (see conforms).
   */
  freshShape(){
    const kind=worldDescriptor(this.terrain).kind,key=(kind==='cidade'?`cidade:${this.terrain.signature}`:kind)+(this.objective?`:${this.objective}`:'');
    let entry=SHAPES.get(key);
    if(!entry){
      const objective=this.objective?{objective:this.objective}:{};
      const sim=kind==='cidade'?new Simulation(DEFAULT_SEED,{world:'cidade',terrain:this.city,...objective}):new Simulation(DEFAULT_SEED,{world:kind,...objective});
      sim.add('shape',SHAPE_CLASS,SHAPE_CLASS);
      const capture=sim.capture();sim.systems.dispose();
      // pot: the same run written before the wallets (NEW-20261014-ORQ-carteira-e-pix): the team's Grana in the
      // stonewards state, no split cursor. legacy: before the single pile of material (D-048), balance {coco, pedra},
      // and the Grana in the chaveiro's state (when the run has one; none at all before D-047). migrateCheckpoint.
      const pot=structuredClone(capture),potStw=pot.systems.stonewards as unknown as {grana?:number;splitCursor?:number};
      potStw.grana=0;delete potStw.splitCursor;
      const before=structuredClone(pot),stw=before.systems.stonewards as unknown as {balance:unknown;grana?:number};
      stw.balance={coco:0,pedra:0};delete stw.grana;
      if(before.systems.chaveiro)(before.systems.chaveiro as unknown as {grana:number}).grana=0;
      // Bancos: no build before them had the banks (city only): pot and legacy without them, preBanks this code's without them.
      delete pot.systems.banks;delete before.systems.banks;
      const noBanks=structuredClone(capture);delete noBanks.systems.banks;
      entry={shape:shapeOf(capture)!,fingerprint:shapeFingerprint(capture),pot:shapeFingerprint(pot),legacy:shapeFingerprint(before),
        ...(capture.systems.banks?{preBanks:shapeFingerprint(noBanks),banks:structuredClone(capture.systems.banks)}:{})};SHAPES.set(key,entry);
    }
    return entry;
  }
  /**
   * Old checkpoints, in place (idempotent), so a room restarted across those deploys resumes its run; anything else
   * is untouched:
   * - D-048 (ficha de torre): written before the single pile (this code's pot fingerprint with balance {coco, pedra},
   *   no team Grana, the chaveiro's Grana in its own state): {units: coco + pedra}, the Grana to the team's state;
   * - NEW-20261014-ORQ-carteira-e-pix: written with the team's pot (stonewards.grana, no splitCursor): the pot is split
   *   equally among the checkpoint's players (in order, the remainder from the first), and this code's fingerprint;
   * - Bancos: a city checkpoint written before the banks (this code's fingerprint without them, or reached through the
   *   steps above) gets a fresh run's bank state (every ATM full; the places come back from the seed).
   */
  migrateCheckpoint(cp:unknown){
    if(!isObject(cp))return;
    const sys=(cp as {systems?:{stonewards?:{balance?:Record<string,unknown>;grana?:unknown;splitCursor?:unknown};chaveiro?:{grana?:unknown};banks?:unknown}}).systems;
    const b=sys?.stonewards?.balance,fresh=this.freshShape(),current=fresh.preBanks??fresh.fingerprint;
    if(cp.shape===fresh.legacy&&sys?.stonewards&&b&&typeof b.coco==='number'&&typeof b.pedra==='number'&&b.units===undefined){
      const units=b.coco+b.pedra;delete b.coco;delete b.pedra;b.units=units;
      // The Grana moved from the chaveiro's state to the team's (D-048); a run without the objective had none.
      const grana=sys.chaveiro&&typeof sys.chaveiro.grana==='number'?sys.chaveiro.grana:0;
      if(sys.chaveiro)delete sys.chaveiro.grana;
      sys.stonewards.grana=grana;cp.shape=fresh.pot;
    }
    const stw=sys?.stonewards;
    if(cp.shape===fresh.pot&&stw&&typeof stw.grana==='number'&&stw.splitCursor===undefined){
      const pot=Math.max(0,Math.floor(stw.grana)),cursor={splitCursor:0};
      const runs=Array.isArray(cp.players)?cp.players.filter(isObject).map(p=>p.run).filter(isObject):[];
      const got=runs.length?splitAmong(runs.map(()=>({grana:0}) as SimPlayer),pot,cursor):[];
      runs.forEach((run,i)=>{const had=typeof run.grana==='number'?run.grana:0;if(got[i]||run.grana!==undefined)run.grana=had+got[i];});
      delete stw.grana;stw.splitCursor=cursor.splitCursor;cp.shape=current;
    }
    if(fresh.preBanks&&cp.shape===fresh.preBanks&&isObject(sys)&&sys.banks===undefined){sys.banks=structuredClone(fresh.banks);cp.shape=fresh.fingerprint;}
  }
  /** A stored checkpoint was written by code with this code's fresh shape, and its data has every field of it. */
  checkpointShapeOk(cp:unknown){
    this.migrateCheckpoint(cp);
    if(!isObject(cp))return false;
    const fresh=this.freshShape();
    const {shape,...rest}=cp;
    return shape===fresh.fingerprint&&conforms(fresh.shape,rest);
  }
  private capture():Omit<SimCheckpoint,'shape'>{
    return {seed:this.world.seed,runs:this.runs,world:this.world.checkpoint(),systems:structuredClone(this.systems.state()),
      players:[...this.players.values()].map(p=>({id:p.id,classId:p.classId,
        run:structuredClone(Object.fromEntries(Object.entries(p).filter(([k,v])=>!SEAT_FIELDS.has(k)&&v!==undefined)))})),
      stats:[...this.counters].map(([id,s])=>[id,{...s}])};
  }
  /**
   * Resumes a checkpointed run on this simulation (a restarted room, its seats already added): the systems are rebuilt
   * from the checkpoint (the city's barricade blockers too), the world gets its clock, round, offers and pickups back,
   * and each seat its run (equip, then the stored fields, stats from class and build, hp within them). A seat the
   * checkpoint does not know starts fresh at the spawn (the room makes it a spectator). False, with nothing changed,
   * when the checkpoint is malformed, from another room seed or names another class for a seat; false after a fresh
   * run (resetRun) when a system cannot take its stored state.
   */
  resume(cp:unknown):boolean{
    this.migrateCheckpoint(cp);
    if(!simCheckpointOk(cp,this.seed)||!this.checkpointShapeOk(cp))return false;
    const saved=new Map(cp.players.map(p=>[p.id,p]));
    for(const p of this.players.values()){const s=saved.get(p.id);if(s&&s.classId!==p.classId)return false;}
    this.systems.dispose();
    if(this.city)for(const b of this.city.blockers())this.city.setBlocker(b.id,undefined);
    this.world.load(cp.world);this.runs=cp.runs;
    // A state this build cannot run (a system throws on it): a fresh run instead, and the room falls back to the lobby.
    try{this.systems=this.assemble(cp.systems);}catch{this.resetRun();return false;}
    this.result=undefined;this.alive.clear();this.tombs.clear();this.recent=[];this.shame.reset();this.botInputs.clear();this.effectEnd.clear();
    this.counters.clear();for(const [id,stats] of cp.stats)if(this.players.has(id))this.counters.set(id,{...emptyStats(),...stats});
    coastalSpawnPoints(this.terrain);
    let slot=0;
    for(const p of this.players.values()){
      const s=saved.get(p.id);this.equip(p);
      if(s){
        // hp after the stats: refreshStats would add the build's extra max hp on top of the stored hp.
        const {hp,...run}=structuredClone(s.run);
        Object.assign(p,run);refreshStats(p);
        p.hp=p.eliminated?0:Math.min(hp as number,p.stats.maxHp);
      }else Object.assign(p,spawnSlot(slot++,this.start()),{score:0,attackTick:0,skillTick:0,skillReadyTick:0});
      p.ack=0;this.track(p.id).reset(0);this.trackReset(p.id);
    }
    return true;
  }
  /**
   * Where heroes spawn: in the city, the run's start down the road from the wreck (sim/city/tutorial.ts cityRunStart,
   * NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro); elsewhere the world's spawn point.
   */
  private start():Point{return this.city?cityRunStart(this.city):worldSpawn(this.terrain);}
  resetRun(){
    this.systems.dispose();
    // The old run's barricades go with it; the new run's stonewards raises its own.
    if(this.city)for(const b of this.city.blockers())this.city.setBlocker(b.id,undefined);
    this.world.reset(runSeed(this.seed,++this.runs));
    this.world.runStartTick=this.world.tick;
    this.systems=this.assemble();
    this.result=undefined;this.alive.clear();this.tombs.clear();this.recent=[];this.counters.clear();this.shame.reset();this.botInputs.clear();
    // D-036: the new run's clock starts over; an old effect end would hold the owner's frames live.
    this.effectEnd.clear();
    // Spawn points are cached per terrain; computing them now avoids a 60–120 ms hitch at round 1 (D-010).
    coastalSpawnPoints(this.terrain); // [] at once in the endless world
    let slot=0;
    for(const p of this.players.values()){
      this.equip(p);Object.assign(p,spawnSlot(slot++,this.start()),{score:0,ack:0,attackTick:0,skillTick:0,skillReadyTick:0});
      this.track(p.id).reset(0);this.trackReset(p.id);
    }
  }
  /** Fresh run kit: class bonus and starting weapon (VGM-044A), stats, full hp, cleared fall/skill state. */
  private equip(p:ServerPlayer){
    p.classBonus=classBonusOf(p.classId);p.build=startingBuild(p.classId);p.weaponReady={};p.facing={...DEFAULT_FACING};
    delete p.target;delete p.downed;delete p.eliminated;delete p.invulnerableUntil;resetSkill(p);
    // D-051 (manual combat): who hit me and the auto aim's pick belong to the run that ended.
    delete p.lastHitBy;delete p.autoTarget;
    // The agiota's devendo mark holds an absolute tick (D-002 extra field); a rematch restarts the clock at 0.
    delete (p as {devendoUntil?:number}).devendoUntil;delete (p as {devendoSay?:number}).devendoSay;
    // D-036 slow and slip hold absolute ticks too.
    clearMoveEffects(p);
    // A fresh run's wallet is empty (NEW-20261014-ORQ-carteira-e-pix); a resumed one gets its stored balance back.
    delete p.grana;
    refreshStats(p);p.hp=p.stats.maxHp;
  }
  add(id:string,name:string,classId:string){
    if(this.players.size>=MAX_PLAYERS)throw new Error('Sala cheia. Máximo de seis jogadores.');
    const slots=Array.from({length:6},(_,i)=>spawnSlot(i,this.start()));
    const spawn=slots.find(s=>[...this.players.values()].every(p=>Math.hypot(p.x-s.x,p.y-s.y)>.3))??this.start();
    const p={...spawn,id,name,classId,hp:0,ack:0,online:true,score:0,spectator:false,stats:{...BASE_STATS}} as ServerPlayer;
    this.equip(p);
    this.players.set(id,p);this.track(id).reset(0);this.trackReset(id);return p;
  }
  /**
   * Out of the room for good. The opt-out goes too (a later seat is a new id), and so do their moments: someone who
   * said no and left mid-run must not become the "momento mais vergonhoso" once the opt-out is gone.
   */
  remove(id:string){this.inherit(id);this.autopilot.delete(id);this.players.delete(id);this.tracks.delete(id);this.trackReset(id);this.effectEnd.delete(id);this.bots.delete(id);this.botInputs.delete(id);this.shameOptOut.delete(id);this.shame.forget(id);}
  /**
   * The inheritance (NEW-20261014-ORQ-carteira-e-pix): the wallet of a player who leaves for good (remove) is split
   * among the seated players who stay (sim/wallet.ts splitAmong: equal parts, the remainder from the run's cursor).
   * With nobody seated left it is simply gone. Called by remove; the seat's wallet stays while the seat is held.
   */
  private inherit(id:string){
    const p=this.players.get(id),grana=walletOf(p);
    if(!p||!(grana>0))return;
    const heirs=seatedPlayers(this.players).filter(q=>q.id!==id);
    if(!heirs.length)return;
    p.grana=0;
    splitAmong(heirs,grana,this.systems.stonewards.state);
  }
  /**
   * PIX (NEW-20261014-ORQ-carteira-e-pix, contract wallet.ts): `amount` R$ from `from`'s wallet to `to`'s. Refused
   * with a reason: 'duplicate' (this `req` of this sender already went), 'phase' (the run is decided, or the sender
   * has no seat), 'amount' (not a whole 1..PIX_MAX), 'self', 'target' (`to` is no seated player of this run), 'grana'
   * (more than the sender has). The room checks what it alone knows before calling: its phase (only in combat: the
   * lobby, the countdown and the result say 'phase'), the D-050 level-up pause ('pause') and PIX_GAP_MS per sender
   * ('rate'). On success the money moves at once and a {type:'pix',from,to,amount,memo} event goes out with the next
   * step's events (memo: an index into PIX_MEMOS from the run's own PIX stream). `grana` in the result: the sender's
   * new balance.
   */
  pix(from:string,to:string,amount:number,req?:string|number):PixResult{
    const st=this.systems.stonewards.state,key=req===undefined?undefined:`pix:${from}:${req}`;
    if(key!==undefined&&st.handled.includes(key))return {ok:false,reason:'duplicate'};
    const sender=this.players.get(from),target=this.players.get(to);
    if(this.result||!sender||sender.spectator)return {ok:false,reason:'phase'};
    if(!Number.isSafeInteger(amount)||amount<1||amount>PIX_MAX)return {ok:false,reason:'amount'};
    if(to===from)return {ok:false,reason:'self'};
    if(!target||target.spectator)return {ok:false,reason:'target'};
    if(walletOf(sender)<amount)return {ok:false,reason:'grana'};
    addGrana(sender,-amount);addGrana(target,amount);
    if(key!==undefined){st.handled.push(key);if(st.handled.length>PIX_HANDLED_LIMIT)st.handled.splice(0,st.handled.length-PIX_HANDLED_LIMIT);}
    this.world.emit({type:'pix',from,to,amount,memo:drawMemo(this.world,st)});
    return {ok:true,to,amount,grana:walletOf(sender)};
  }
  /** A player's wallet in R$ (absent player: 0). */
  granaOf(id:string){return walletOf(this.players.get(id));}
  /** What `viewer` sees as their Grana (CampView/ObjectiveView.grana): their wallet; 0 for a spectator or a stranger. */
  viewerGrana(viewer:string){const p=this.players.get(viewer);return p&&!p.spectator?walletOf(p):0;}
  /** The seated players' wallets together (the shared views' placeholder; the bench's team total). */
  teamGrana(){return seatedPlayers(this.players).reduce((n,p)=>n+walletOf(p),0);}
  /**
   * A room bot (D-025): a player like the others (counts toward the six, takes hits, falls, gets rescued), always
   * online, and out of the "momento mais vergonhoso" (a person's consent thing).
   */
  addBot(id:string,name:string,classId:string){
    const p=this.add(id,name,classId);this.bots.add(id);this.shameOptOut.add(id);return p;
  }
  /**
   * The bot's stick for the next steps (held until changed), a one-shot skill tap and (D-051, manual combat) the attack
   * button, held until changed like the stick.
   */
  setBotInput(id:string,direction:Point,skill=false,attack=false){
    if(!this.bots.has(id)&&!this.autopilot.has(id))return;
    const held=this.botInputs.get(id);
    this.botInputs.set(id,{seq:0,x:direction.x,y:direction.y,attack,skill:skill||!!held?.skill});
  }
  private track(id:string){let t=this.tracks.get(id);if(!t){t=new InputTrack();this.tracks.set(id,t);}return t;}
  /** Going offline or coming back: nothing held or queued survives, and the client restarts its steps at the ack. */
  setOnline(id:string,online:boolean){
    const p=this.players.get(id);if(!p)return;
    p.online=online;this.track(id).reset(p.ack);this.trackReset(id);delete p.target;
    // Away: the room's light bot plays the hero (autopilot); back: the person's own inputs again, nothing of the bot held.
    if(online){this.autopilot.delete(id);this.botInputs.delete(id);}else if(!this.bots.has(id))this.autopilot.add(id);
  }
  /**
   * A batch of change segments `{seq,steps}` (input-10hz) or one legacy step `{seq,x,y,attack,skill?,target?}`.
   * Refused (false) for offline or spectating players and for anything malformed or out of order; see InputTrack.
   */
  input(id:string,value:unknown,now=this.tick*STEP_MS){
    const p=this.players.get(id),t=this.tracks.get(id);
    if(!p?.online||p.spectator||!t)return false;
    return t.accept(value,now);
  }
  /**
   * Skill tap from the client (see InputTrack.tap); false when refused (offline, spectator, stale or repeated id, or
   * D-051's manual combat, which has no skill).
   */
  tap(id:string,tapId:unknown){const p=this.players.get(id),t=this.tracks.get(id);return this.combat!=='manual'&&!!p?.online&&!p.spectator&&!!t&&t.tap(tapId);}
  /**
   * Owner's own position and ack for its frames (InputTrack.confirmed), or undefined for the live ones.
   * D-036: the phone replays its pending steps on ticks frameTick+1+k (maps/prediction.ts). The confirmed position
   * sits before steps the room already took on earlier ticks, so while a slow or a slip touches those steps (the
   * latest effect end, effectEnd, is after the first of them) the replay would put the effect on the wrong steps: the
   * frame goes live instead (ack = the step taken this tick), where the mapping is exact.
   * The owner's ack never goes back (review B1): after a live frame, confirmed stays live until the client's report
   * passes that ack (liveAck), or the phone, which already dropped its pending steps up to it, would replay from an
   * older position without them and snap back.
   */
  confirmed(id:string){
    const own=this.tracks.get(id)?.confirmed();
    if(!own)return undefined;
    const p=this.players.get(id);
    if(!p)return own;
    const from=this.stepTicks.get(id)?.find(s=>s.seq===own.ack+1)?.tick;
    const end=Math.max(this.effectEnd.get(id)??-Infinity,p.slowUntil??-Infinity,p.slipUntil??-Infinity,p.fastUntil??-Infinity);
    const touched=end>-Infinity&&(from===undefined||end>from);
    const liveAck=this.liveAck.get(id);
    if(touched||liveAck!==undefined&&own.ack<liveAck){this.liveAck.set(id,Math.max(liveAck??0,p.ack));return undefined;}
    this.liveAck.delete(id);
    return own;
  }
  /** Per player: the highest ack a live frame carried while confirmed was held back (D-036, review B1). */
  private liveAck=new Map<string,number>();
  /** Per player: the latest tick a slow or slip of this run ran until (kept after the players system drops it). */
  private effectEnd=new Map<string,number>();
  /** The input track starts over (join, reconnect, rematch): acks restart, so does the monotone guard. */
  private trackReset(id:string){this.liveAck.delete(id);this.stepTicks.delete(id);}
  /** Per player: the tick each recent client step was taken on (D-036 confirmed check); a seq going back starts it over. */
  private stepTicks=new Map<string,{seq:number;tick:number}[]>();
  private recordStep(id:string,seq:number){
    let list=this.stepTicks.get(id);
    const last=list?.[list.length-1]?.seq;
    // A press cast in place repeats the last seq (InputTrack.next): same step, nothing to add.
    if(last===seq)return;
    if(!list||last!==undefined&&last>seq)this.stepTicks.set(id,list=[]);
    list.push({seq,tick:this.world.tick});
    if(list.length>STEP_TICKS_KEPT)list.shift();
  }
  /** Skill taps answered by the last step: seq is the client's, ok whether it was cast, readyTick the next ready tick. */
  casts:{id:string;seq:number;ok:boolean;readyTick:number}[]=[];
  /** Clock of the step being taken (ms): the Room's wall clock, or tick × STEP_MS (tests, replays). */
  private clock=0;
  /** D-050: how many level/round offers each player has waiting (the room's level-up pause reads it). */
  pendingOffers():Map<string,number>{const out=new Map<string,number>();for(const [id,queue] of this.world.offers)if(queue.length)out.set(id,queue.length);return out;}
  /** D-050: every offer of `id` gets its default now (the pause ended, or the room does not wait for this player). */
  settleOffers(id:string){return this.systems.progression.settle(this.world,id);}
  /** Upgrade pick from the offer panel; forged, repeated and out-of-order picks are refused by progression. */
  choose(id:string,offerId:string,index:number):ChooseResult{
    if(this.result)return {ok:false,reason:'no-offer'};
    return this.systems.progression.choose(this.world,id,offerId,index);
  }
  offers(id:string):LevelOffer[]{return this.world.offers.get(id)??[];}
  /**
   * Forge purchase (VGM-046B): the recipe for the team balance, validated on the server (phase, standing, in the camp,
   * balance). `requestId` makes a resent tap apply once. `targetId` (cidade-06): what 'reparo' repairs, the wall when
   * omitted or a city barricade id (the room checks its shape, stonewards whether it exists). Refused once the run is decided.
   */
  forge(id:string,recipeId:string,requestId?:string,targetId?:string):BuyResult{
    const p=this.players.get(id);
    if(this.result||!p?.online||p.spectator)return {ok:false,reason:'player'};
    return this.systems.stonewards.buy(this.world,id,recipeId,requestId,targetId);
  }
  /**
   * D-047 Dona Cida (the chaveiro objective): a team purchase for `id`, validated by the sim (near the moto, stock,
   * Grana, standing). `requestId` makes a resent tap apply once. Refused once the run is decided, without the
   * objective, or for an offline or spectating player ('phase').
   */
  buyCida(id:string,item:string,requestId?:string):CidaBuyResult{
    const p=this.players.get(id),chaveiro=this.systems.chaveiro;
    if(this.result||!p?.online||p.spectator||!chaveiro)return {ok:false,reason:'phase'};
    return chaveiro.buy(this.world,id,item,requestId);
  }
  /** D-047: the objective as the HUD sees it (undefined without one). */
  objectiveView():ObjectiveView|undefined{return this.systems.objectiveView();}
  /** D-047: the objective's bill for a run that ended with `outcome` (the room's), or undefined without the objective. */
  objectiveResult(outcome?:'victory'|'defeat'|'timeout'):ObjectiveResult|undefined{
    return this.systems.chaveiro?.result(this.world.tick,this.world.round,outcome);
  }
  /** Node ids of the last frame (the Room prunes the wire ids of the rest). */
  nodeIds:string[]=[];
  /** The wall and the towers as the client sees them, plus the city barricades (hp 0 once down) behind `cityStructures`. */
  private structureViews():StructureView[]{
    const st=this.systems.stonewards.state,w=st.wall,car=this.systems.chaveiro?.state.car;
    // D-047: with the chaveiro objective the car stands where the wall stood (hp = limit − hits, its fallen parts).
    const base:StructureView=car?{id:CAR_ID,kind:CAR_ID,x:car.x,y:car.y,hp:car.limit-car.hits,maxHp:car.limit,...(car.parts?{parts:car.parts}:{})}
      :{id:w.id,kind:'muralha',x:w.x,y:w.y,hp:w.hp,maxHp:w.maxHp};
    const out:StructureView[]=[base,...st.towers.map(t=>({id:t.id,kind:t.kind,x:t.x,y:t.y,hp:t.hp,maxHp:t.maxHp,untilTick:t.untilTick}))];
    if(this.cityStructures&&this.city){
      const rows=(st as {barricades?:readonly BarricadeRow[]}).barricades??[];
      for(const b of rows)out.push({id:b.id,kind:'barricada',x:b.x,y:b.y,hp:b.down?0:b.hp,maxHp:b.maxHp});
    }
    // torres-fio: the tower defenses (a ruin stays, hp 0, until a new root is built on its site).
    for(const d of this.defenses())out.push(defenseView(d,this.world.tick));
    // trilho-no-snapshot: the Gustavão's rail once laid (kind 'linha-ferrea', on the plan's rail spot; its building phase).
    const rail=this.railView();if(rail)out.push(rail);
    return out;
  }
  /** The laid rail as a structure (the plan's rail id), or undefined while there is none. */
  railView():StructureView|undefined{
    const st=this.systems.stonewards,laid=st.state.defenses?.rail,site=st.plan.rail;
    if(!laid||!site)return undefined;
    return {id:site.id,kind:RAIL.id,x:site.x,y:site.y,hp:1,maxHp:1,phase:phaseOf({hp:1,maxHp:1,startTick:laid.startTick,readyTick:laid.readyTick},this.world.tick)};
  }
  /** The run's tower defenses (none until the first build). */
  defenses():readonly DefenseState[]{return this.systems.stonewards.state.defenses?.list??[];}
  /**
   * Tower defense (torres-fio): the root on a free build site, or the Gustavão's rail ('trilho'), validated by the sim
   * (intermission, standing, wall, balance, limits). `requestId` makes a resent tap apply once. Refused once the run
   * is decided, or for an offline or spectating player.
   */
  build(id:string,siteId:string,requestId?:string):TowerResult{
    const p=this.players.get(id);
    if(this.result||!p?.online||p.spectator)return {ok:false,reason:'player'};
    return this.systems.stonewards.build(this.world,id,siteId,requestId);
  }
  /** Upgrades a ready defense to its next tier (`branch`: A/B/C at tier 2, or a label like 'A4b' for the alternative). */
  upgrade(id:string,defenseId:string,branch?:string,requestId?:string):TowerResult{
    const p=this.players.get(id);
    if(this.result||!p?.online||p.spectator)return {ok:false,reason:'player'};
    return this.systems.stonewards.upgrade(this.world,id,defenseId,branch,requestId);
  }
  /** torres-ajustes: repairs a standing defense below its maxHp (the sim's rule: reach, intermission, material). */
  repair(id:string,defenseId:string,requestId?:string):TowerResult{
    const p=this.players.get(id);
    if(this.result||!p?.online||p.spectator)return {ok:false,reason:'player'};
    return this.systems.stonewards.repair(this.world,id,defenseId,requestId);
  }
  /**
   * Gather nodes near any player with a body, only in a real intermission (round 1+): the union of every client's area
   * of interest (each encoder keeps its own part). Untouched nodes are full.
   */
  private nodeViews(record=true):NodeView[]{
    const w=this.world,st=this.systems.stonewards.state;
    if(w.round.phase!=='prepare'||w.round.index<1||st.wallDown){if(record)this.nodeIds=[];return [];}
    const out=new Map<string,NodeView>(),reach=INTEREST_RADIUS+INTEREST_HYSTERESIS;
    for(const p of this.players.values()){
      if(p.spectator||p.eliminated)continue;
      // Bancos: the crates a bank replaced are not there.
      for(const n of nodesNear(this.terrain,p,reach,undefined,this.systems.banks?.crates)){
        if(out.has(n.id))continue;
        const touched=touchedNode(st,n.id);
        out.set(n.id,{id:n.id,kind:n.kind,x:n.x,y:n.y,remaining:remainingOf(st,n),capacity:n.capacity,value:n.value,
          progress:touched?Math.min(1,touched.work/WORK_PER_UNIT[n.kind]):0});
      }
    }
    if(record)this.nodeIds=[...out.keys()];
    return [...out.values()];
  }
  /**
   * `viewer` (NEW-20261014-ORQ-carteira-e-pix): CampView.grana is that player's wallet (0 for a spectator); without
   * one (the shared frame, the bots' view) it is the seated players' total, which each viewer's encoding replaces.
   */
  private campView(viewer?:string):CampView{
    const st=this.systems.stonewards.state,grana=viewer===undefined?this.teamGrana():this.viewerGrana(viewer);
    const bought=st.forgeBought,forge=bought&&(bought.gambiarra||bought['torre-chinelo'])?{forge:{...(bought.gambiarra?{gambiarra:bought.gambiarra}:{}),...(bought['torre-chinelo']?{'torre-chinelo':bought['torre-chinelo']}:{})}}:{};
    return {units:st.balance.units,grana,...forge,...(st.hornEndsTick>=0&&this.world.round.phase==='prepare'?{hornEndsTick:st.hornEndsTick}:{}),...(st.wallDown?{wallDown:true}:{})};
  }
  /** One server tick; returns its events. */
  step(now=this.tick*STEP_MS){
    this.clock=now;
    this.pending={victory:false,defeat:false};
    // Enemies added between ticks (tests, future checkpoints) join the set too, so they also get a tombstone.
    for(const e of this.world.enemies.values())if(!this.alive.has(e.id))this.alive.set(e.id,e);
    const castBefore=new Map([...this.players.values()].map(p=>[p.id,p.skillTick]));
    const events=this.world.step();
    // D-036: remember how far each slow or slip ran (the players system drops it once it is over; confirmed needs it).
    for(const p of this.players.values()){
      const end=Math.max(p.slowUntil??-Infinity,p.slipUntil??-Infinity,p.fastUntil??-Infinity);
      if(end>(this.effectEnd.get(p.id)??-Infinity))this.effectEnd.set(p.id,end);
    }
    // Skill taps carried by this step (input-10hz `cast`): the room tells each client whether it went off.
    this.casts=[];
    for(const [id,t] of this.tracks)if(t.tapped!==undefined){const p=this.players.get(id);if(p)this.casts.push({id,seq:t.tapped,ok:p.skillTick!==castBefore.get(id),readyTick:skillReadyTick(p)});}
    if(!this.result)this.result=this.pending.victory?'victory':this.pending.defeat?'defeat':undefined;
    this.pending=undefined;
    // Refunds (pagodeiro, caça-promoção) move the cooldown after the cast; the wire follows the skill state.
    for(const p of this.players.values())p.skillReadyTick=skillReadyTick(p);
    for(const e of events)if(e.type==='fire'&&!e.weapon.startsWith('skill:')){
      const p=this.players.get(e.player);
      if(p&&this.tick-(p.attackTick??0)>=ATTACK_ANIMATION_TICKS)p.attackTick=this.tick;
    }
    this.countStats(events);
    this.shame.observe(this.world,events,this.systems.zueira.activeAt(this.tick));
    this.trackRemovals();
    this.recent=this.recent.filter(r=>r.tick>this.tick-EVENT_BUFFER_TICKS);
    for(const event of events)this.recent.push({tick:this.tick,event});
    return events;
  }
  /** The run's most embarrassing moment so far (VGM-053B), for the result; undefined when nobody did anything silly. */
  shameMoment(){return this.shame.momentWithout(this.shameOptOut);}
  /** Players who turned "my embarrassing moment" off (a preference: it survives rematches). */
  readonly shameOptOut=new Set<string>();
  /** The player's choice from the settings ({t:'pref',shame}); false = never pick their moment. */
  setShamePref(id:string,allow:boolean){if(allow)this.shameOptOut.delete(id);else this.shameOptOut.add(id);}
  /** Run counters of a player (award-stats-server); zeros before anything happened. */
  statsOf(id:string):RunStats{
    let s=this.counters.get(id);
    if(!s){s=emptyStats();this.counters.set(id,s);}
    return s;
  }
  /** Same rules the HUD tally used on events (hud/model.ts applyEvents, DamageTally), now once, on the server. */
  private countStats(events:readonly SimEvent[]){
    const mine=(id:string|undefined)=>id!==undefined&&this.players.has(id)?this.statsOf(id):undefined;
    for(const e of events){
      switch(e.type){
        case 'damage':{const s=mine(e.source);if(s&&!this.players.has(e.target)&&Number.isFinite(e.amount))s.damage+=e.amount;break;}
        case 'kill':{const s=mine(e.by);if(s)s.kills++;break;}
        case 'revived':{const s=mine(e.by);if(s)s.revives++;break;}
        case 'downed':{const s=mine(e.player);if(s)s.downs++;break;}
        case 'evolve':{const s=mine(e.player);if(s)s.evolves++;break;}
        case 'pickup':{
          const s=mine(e.player);if(!s)break;
          s.pickups++;
          if(e.kind==='heal')s.heals++;else if(e.kind==='magnet')s.magnets++;else if(e.kind==='chest')s.chests++;
          break;
        }
      }
    }
  }
  /** Enemies gone since the last step become tombstones (hp 0, kind kept for the death poof) for a few ticks, so protocol 3 clients hide them. */
  private trackRemovals(){
    for(const [id,e] of this.alive)if(!this.world.enemies.has(id))this.tombs.set(id,{wire:packEnemy({...e,hp:0}),tick:this.tick});
    this.alive.clear();
    for(const e of this.world.enemies.values())this.alive.set(e.id,e);
    for(const [id,tomb] of this.tombs)if(tomb.tick<=this.tick-TOMBSTONE_TICKS)this.tombs.delete(id);
  }
  /** Hash of everything that decides future ticks (world, run systems, pending inputs, the bots' sticks, counter and minds, outcome). */
  stateHash(){return stateHash({world:this.world.state(),systems:this.systems.state(),inputs:[...this.tracks].map(([id,t])=>[id,t.state()]),
    // D-051: a bot's held attack (manual combat only) joins its stick; without it the stick hashes as before.
    bots:{sticks:[...this.botInputs].map(([id,b])=>b.attack?[id,b.x,b.y,!!b.skill,true]:[id,b.x,b.y,!!b.skill]),seq:this.botSeq,minds:this.botState?.()??null},outcome:this.result??null});}
  /** The room bots' minds (RoomBots.state: memories and forge requests), which decide their next sticks (set by the room). */
  botState?:()=>unknown;
  /**
   * What a room bot sees (D-025): the same RunView shape the protocol bots read (bot-brain.ts), built from the live
   * world without copying the horde (read-only for the brain). Players carry x/y, like the frames. `offers` per bot.
   */
  botView():RunView{
    const w=this.world;
    return {
      tick:w.tick,team:w.team,round:w.round,
      enemies:[...w.enemies.values()],pickups:[...w.pickups.values()],projectiles:[...w.projectiles.values()],telegraphs:[...w.telegraphs.values()],
      structures:this.structureViews(),nodes:this.nodeViews(false),camp:this.campView(),
      players:[...this.players.values()].map(p=>({id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
        downed:p.downed,eliminated:p.eliminated,weapons:p.build.weapons,passives:p.build.passives,skillReadyTick:p.skillReadyTick,x:p.x,y:p.y,grana:walletOf(p)})),
      ...(this.systems.chaveiro?{objective:this.systems.chaveiro.view(w.tick)}:{}),
      ...(this.systems.banks?{banks:this.systems.banks.view(w.tick)}:{}),
      offers:[],events:[],
    } as unknown as RunView;
  }
  /** Pure client view for one player (protocol 4 encodes this in VGM-042b). */
  view(playerId:string):RunView{
    const w=this.world;
    return {
      tick:w.tick,team:{...w.team},round:{...w.round},
      enemies:[...w.enemies.values()].map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,elite:e.elite,boss:e.boss,phase:e.phase,...(isSugared(e,w.tick)?{sugar:true as const}:{}),...(isPrime(e)?{prime:true as const}:{})})),
      pickups:[...w.pickups.values()].map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y,value:p.value,resource:p.resource})),
      projectiles:[...w.projectiles.values()].map(p=>({id:p.id,source:p.source,x:p.x,y:p.y,vx:p.vx,vy:p.vy,radius:p.radius,hostile:p.hostile})),
      telegraphs:[...w.telegraphs.values()].map(telegraphView),
      structures:this.structureViews(),nodes:this.nodeViews(),camp:this.campView(playerId),
      players:[...this.players.values()].map(p=>({
        id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
        downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated,
        weapons:p.build.weapons.map(i=>({...i})),passives:p.build.passives.map(i=>({...i})),
        skillTick:p.skillTick||undefined,skillReadyTick:p.skillReadyTick||undefined,
        stats:{...this.statsOf(p.id),damage:Math.round(this.statsOf(p.id).damage)},
        ...activeMoveEffects(p,w.tick),...activeBuffs(p,w.tick),...(p.grana!==undefined?{grana:p.grana}:{}),
      })),
      ...(this.systems.chaveiro?{objective:{...this.systems.chaveiro.view(w.tick),grana:this.viewerGrana(playerId)}}:{}),
      ...(this.systems.banks?{banks:this.systems.banks.view(w.tick)}:{}),
      offers:this.offers(playerId).map(o=>({id:o.id,source:o.source,level:o.level,choices:o.choices.map(c=>({...c})),deadlineTick:o.deadlineTick,defaultIndex:o.defaultIndex})),
      events:[...w.lastEvents],
    };
  }
  private descriptor?:WorldDescriptor;
  /**
   * What every protocol 4 encoder of the room gets this tick (VGM-042b): build it once per tick and hand the same
   * object to each encoder that is due (their live-id cache is shared through it). Server ids; offers go as JSON.
   */
  frame():FrameInput{
    const w=this.world;
    this.descriptor??=worldDescriptor(this.terrain);
    return {
      tick:w.tick,team:{...w.team},round:{...w.round},world:this.descriptor,
      enemies:[...w.enemies.values()].map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,elite:e.elite,boss:e.boss,phase:e.phase,...(isSugared(e,w.tick)?{sugar:true as const}:{}),...(isPrime(e)?{prime:true as const}:{})})),
      pickups:[...w.pickups.values()].map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y,value:p.value,resource:p.resource})),
      projectiles:[...w.projectiles.values()].map(p=>({id:p.id,source:p.source,x:p.x,y:p.y,vx:p.vx,vy:p.vy,radius:p.radius,hostile:p.hostile})),
      telegraphs:[...w.telegraphs.values()].map(telegraphView),
      structures:this.structureViews(),nodes:this.nodeViews(),camp:this.campView(),
      players:[...this.players.values()].map(p=>{
        const stats=this.statsOf(p.id);
        return {
          id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
          downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated||undefined,
          weapons:p.build.weapons,passives:p.build.passives,stats:{...stats,damage:Math.round(stats.damage)},
          x:p.x,y:p.y,ack:p.ack,attackTick:p.attackTick||undefined,skillTick:p.skillTick||undefined,skillReadyTick:p.skillReadyTick||undefined,
          ...activeMoveEffects(p,w.tick),...activeBuffs(p,w.tick),
          // carteira-e-pix: everyone's wallet (the encoder makes the camp's Grana each viewer's own).
          ...(p.grana!==undefined?{grana:p.grana}:{}),
        };
      }),
      ...(this.systems.chaveiro?{objective:this.systems.chaveiro.view(w.tick)}:{}),
      ...(this.systems.banks?{banks:this.systems.banks.view(w.tick)}:{}),
    };
  }
  /** sinceEventId: only events after it (the Room's broadcast cursor); omitted, the whole buffer. */
  snapshot(sinceEventId=-1):Snapshot{
    const w=this.world;
    const enemies:EnemyWire[]=[...w.enemies.values()].map(packEnemy);
    for(const tomb of this.tombs.values())if(!w.enemies.has(tomb.wire[0]))enemies.push(tomb.wire);
    return {terrain:{seed:this.terrain.seed,version:TERRAIN_VERSION,signature:this.terrain.signature,
      ...(this.terrain.chunks?{world:'infinito' as const,generator:CHUNK_VERSION}:this.terrain.world==='cidade'?{world:'cidade' as const}:{})},t:'state',tick:this.tick,full:true,
      players:[...this.players.values()].map(packPlayer),enemies,removed:[],victory:this.victory,
      x:{round:{...w.round},team:{...w.team},players:[...this.players.values()].map(p=>packPlayerExtra(p,this.statsOf(p.id))),
        pickups:[...w.pickups.values()].map(p=>[p.id,p.kind,round(p.x),round(p.y),p.value]),
        projectiles:[...w.projectiles.values()].map(p=>[p.id,p.source,round(p.x),round(p.y),round(p.vx),round(p.vy),p.radius,p.hostile]),
        telegraphs:[...w.telegraphs.values()].map(telegraphView),
        events:this.recent.filter(r=>r.event.eventId>sinceEventId).map(r=>wireEvent(r.event))}};
  }
}

export type {SimEvent};

/** D-047 Dona Cida's sweets still running on `tick` (a finished one costs no bytes). */
export function activeBuffs(p:SimPlayer,tick:number):{fastUntil?:number;mightUntil?:number;guardUntil?:number}{
  const out:{fastUntil?:number;mightUntil?:number;guardUntil?:number}={};
  if(tick<(p.fastUntil??-Infinity))out.fastUntil=p.fastUntil;
  if(tick<(p.mightUntil??-Infinity))out.mightUntil=p.mightUntil;
  if(tick<(p.guardUntil??-Infinity))out.guardUntil=p.guardUntil;
  return out;
}

/** A tower defense as the client sees it (torres-fio): its kind, tier, branch, building phase and aim in turns. */
export function defenseView(d:DefenseState,tick:number):StructureView{
  const def=DEFENSES[d.kind],turn=d.aim===undefined?undefined:((d.aim/(2*Math.PI))%1+1)%1;
  return {id:d.id,kind:d.kind,x:d.x,y:d.y,hp:d.ruined?0:d.hp,maxHp:d.maxHp,tier:def.tier,...(def.branch?{branch:def.branch}:{}),
    phase:phaseOf(d,tick),...(turn===undefined?{}:{aim:turn}),...(d.shots===undefined?{}:{shots:d.shots})};
}
