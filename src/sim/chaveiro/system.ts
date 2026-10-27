/**
 * D-047, the match objective "esperar o chaveiro" (card NEW-20261013-ORQ-objetivo-chaveiro, approved proposal
 * viagem-board/plans/objetivo-chaveiro-proposta.md). City only, on with RunSystemsOptions.objective === 'chaveiro'.
 *
 * - The car (CAR_ID, 'quadradao') stands where the wall stands and replaces it as the siege target (D-017 path: the
 *   enemy-ai's hitStructure, the boss's siege). Each contact is CAR_HIT_UNITS hits (normal 1, elite 3, boss 2) and adds
 *   BUDGET_PER_HIT (R$ 3) per hit to the budget (the bill: BUDGET_BASE R$ 25 + those), and ALARM_PER_HIT of alarm per contact whatever its weight (at most ALARM_MAX
 *   ahead: the boss's blow every 3 s stalls the moto half the time, not for good); CAR_LIMIT hits = perda total
 *   (defeat). Parts fall at CAR_PART_AT of the limit.
 * - The moto rides a route built once from the run seed and the asset (route.ts): entrance = one avenue end drawn with
 *   the run's stream, length / MOTO_RIDE_SECONDS u/s. Stops in route order: 'morta' at MORTA_AT (two standing players
 *   within PUSH_RADIUS for PUSH_SECONDS accumulated, or MORTA_ALONE_SECONDS by itself), LOMBADAS speed bumps
 *   (LOMBADA_SECONDS at LOMBADA_PACE), ENTREGAS deliveries (ENTREGA_SECONDS, ENTREGA_CLEAN_SECONDS when no enemy is within ENTREGA_RADIUS
 *   on arrival). While the alarm sounds he rides around the block ('volta': nothing advances, except a dead moto). An
 *   enemy touching the riding moto knocks it over (TOMBO_SECONDS, then TOMBO_GAP_SECONDS without another). At the car:
 *   ABRINDO_SECONDS 'abrindo', then victory.
 * - Dona Cida sells her sweets (buy: from the buyer's wallet, sim/wallet.ts) and, every SALE_GAP_SECONDS, one to an enemy near the moto ("açucarado").
 * - Grana: GRANA_PER_KILL per kill into the players' wallets (NEW-20261014-ORQ-carteira-e-pix, sim/wallet.ts); the bill
 *   is the vaquinha at the end (result: equal parts from the seated players' wallets, the richest cover the rest, then
 *   debt; computed once and kept in ChaveiroState.vaquinha). The boss is called once when the ETA drops below BOSS_ETA_SECONDS.
 * - The ETA waits for the later of the alarm and a fall (they run out together), and counts a dead moto ahead as the
 *   push (PUSH_SECONDS) with PUSH_PLAYERS standing players, else as its by-itself time (MORTA_ALONE_SECONDS).
 * - D-052 (sim-carro, car.ts): the car moves (pushed, pulled by the rope) and the moto follows it: when the car is more
 *   than REPLAN_DRIFT u from where his route ends, at most once every REPLAN_GAP_SECONDS, the route is rebuilt from where
 *   he is to the car, the stops ahead keep their share of what is left of it (the one he is at stays under him) and he
 *   keeps his speed. Nobody moves the car while he opens it.
 * Map-relative (a scaled city keeps the timings): the route, the stops' places and gaps, the moto's speed, the bumps'
 * span and the boss's spawn are fractions of the route length; radii around bodies (push, Cida, lure, the delivery's
 * clean check, the car) stay in u.
 * Everything in ChaveiroState is JSON-safe (systems.state(), checkpoints, stateHash); the route is rebuilt.
 */
import type {FlowGrid,Point} from '../../maps/index.ts';
import {CAR_ID,CAR_PARTS,CAR_RADIUS,CIDA_ITEMS,MOTO_ID,Rng,carGap,ticks,type CidaBuyResult,type CidaItemId,type EnemyState,type MotoMode,
  type ObjectiveCause,type ObjectiveResult,type ObjectiveStopKind,type ObjectiveView,type PullResult,type SimPlayer,type VaquinhaShare} from '../../contract/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';
import {payFrom,vaquinha,walletOf} from '../wallet.ts';
import {SUGAR} from '../enemies/catalog.ts';
import {buildRoute,pointAt,routeCrosses,shutGrid,type Route} from './route.ts';
import {carBusy,moverCap,pullCar,stepCar} from './car.ts';

// ---------- Numbers (proposal §2; E6 calibrates) ----------
/** Riding time of the whole route without stops: speed = route length / this (time-based, not heroSpeed). */
export const MOTO_RIDE_SECONDS=420;
/**
 * balanco-6p-facil: the riding time by room size (1..6 players), mode 'ninhos' only (ChaveiroOptions.ride). Six bots
 * won 16/16, the Uno untouched (~0.3 hits of 224), with the car open after 2-3 waves at ~10 min; no wave knob took them
 * off it, so a bigger room waits longer for him (more waves before the car opens): 6p 900 s, with NEST_PACE.crowd
 * (6p 9/16 at ~17 min; the ride alone, even 1080 s, left 15/16). 1p-3p as before.
 * Mutable only for the bench's grid (bench-city-run --chaveiro-pace); the game never writes it.
 */
export const CHAVEIRO_PACE={ride:[420,420,420,580,740,900] as number[]};
/** The riding time (s) for a room of `players` in `ride` (seconds by room size, 1..6). */
export const rideSecondsFor=(ride:readonly number[],players:number)=>ride[Math.min(ride.length,Math.max(1,Math.round(players)))-1]??MOTO_RIDE_SECONDS;
/**
 * The car's hit limit and the bill (R$): BUDGET_BASE plus BUDGET_PER_HIT per hit taken (balanco-pos-1-7 eco-v9,
 * Executor-6: 25 + 3/hit, so a clean run's bill is paid from the kills and a battered car still leaves a debt to joke about).
 */
export const CAR_LIMIT=120,BUDGET_BASE=25,BUDGET_PER_HIT=3;
/**
 * The Uno's hit limit grows with the room like a group's reach (rules playerScale.group: 1p 120, 3p 170, 6p 224), set at
 * the first step from the players then in the run (inimigos-querem-o-uno: most of a wave now goes for the car; the step 5
 * bench: by .count, 420 at 6p, the car never fell to a room that left it). CAR_REPAIR_SHARE: share of
 * the limit given back by repair() (the 2-minute explore interval between waves, NEW-20261023-ORQ-inicio-no-uno-caixas-120).
 */
export const CAR_REPAIR_SHARE=.25;
export const carLimitFor=(players:number)=>Math.round(CAR_LIMIT*playerScale(players).group);
export const CAR_HIT_UNITS=Object.freeze({normal:1,elite:3,boss:2});
export const ALARM_PER_HIT_SECONDS=1.5,ALARM_MAX_SECONDS=8;
/** Fractions of the hit limit where a part falls (CAR_PARTS in order). */
export const CAR_PART_AT:readonly number[]=Object.freeze([.25,.5,.75,.9]);
/** The car's body (contract, D-052: also what it collides with as it moves). */
export {CAR_RADIUS};
export const MOTO_RADIUS=.5;
/** The moto stops this far (u) before the car's centre. */
export const CAR_STOP=CAR_RADIUS+MOTO_RADIUS+.3;
export const MORTA_AT:readonly number[]=Object.freeze([.25,.55,.8]);
export const PUSH_PLAYERS=2,PUSH_RADIUS=2.5,PUSH_SECONDS=4,MORTA_ALONE_SECONDS=75;
/**
 * Speed bumps, relative to the map (a scaled city keeps the same timings): crawled at LOMBADA_PACE × the moto's speed
 * for LOMBADA_SECONDS, so each spans LOMBADA_PACE × LOMBADA_SECONDS / MOTO_RIDE_SECONDS of the route. (The proposal's
 * "3 u at 0.28 u/s" was faster than the moto itself on the real city, whose route is 78-91 u: ~0.19-0.22 u/s.)
 */
export const LOMBADAS=3,LOMBADA_PACE=.5,LOMBADA_SECONDS=11;
export const ENTREGAS=3,ENTREGA_SECONDS=25,ENTREGA_CLEAN_SECONDS=6,ENTREGA_RADIUS=6;
export const TOMBO_SECONDS=4,TOMBO_GAP_SECONDS=6;
/** Siege enemies within this (u) of the riding moto, and nearer than every player, go for it (enemy-ai reach). */
export const MOTO_LURE_REACH=6;
export const ABRINDO_SECONDS=15;
export const CIDA_HANDLED_LIMIT=64;
export const CIDA_STOCK=4,CIDA_REACH=3,SALE_GAP_SECONDS=20,SALE_RADIUS=3;
/** Moved to rules/stonewards.ts (D-048: the Grana is the team's in every world); kept here for the chaveiro's readers. */
export {GRANA_PER_KILL} from '../../rules/index.ts';
import {playerScale} from '../../rules/index.ts';
export const BOSS_ETA_SECONDS=60;
/** The boss appears on the route this fraction of its length back from the car and marches to it. */
export const BOSS_SPAWN_BACK=.3;
/** Stops (and a bump's span) keep at least this fraction of the route from each other, when the route allows. */
export const STOP_GAP=.06;
/** D-052: the moto replans when the car is this far (u) from where his route ends, at most once every REPLAN_GAP_SECONDS. */
export const REPLAN_DRIFT=3,REPLAN_GAP_SECONDS=2;
/** Span (u) of a speed bump on a route of `length` u. */
export const lombadaLength=(length:number)=>length*LOMBADA_PACE*LOMBADA_SECONDS/MOTO_RIDE_SECONDS;

export type Entrance='N'|'S'|'L'|'O';
export const ENTRANCES:readonly Entrance[]=Object.freeze(['N','S','L','O']);
type Task='anda'|'lombada'|'entrega'|'morta'|'abrindo';
export interface ChaveiroStop {kind:ObjectiveStopKind;s:number}
/** JSON-safe objective state (RunSystemsState.chaveiro). */
export interface ChaveiroState {
  /**
   * movers, rope, ropeHp: D-052 (car.ts), who moves it now, who holds the rope and their hp at the last step; heading,
   * ropeIdle, ropeShy(Until): card puxar-uno-corda, the nose (radians, absent = 0), the ticks the holder went without
   * pulling, and who a hit knocked off it (no gesture until then).
   */
  car:{x:number;y:number;hits:number;limit:number;parts:number;alarmUntil:number;movers?:string[];rope?:string;ropeHp?:number;heading?:number;ropeIdle?:number;ropeShy?:string;ropeShyUntil?:number};
  /**
   * s: u along the route; mode: what is shown (MotoMode: 'volta' while the alarm sounds, 'tombo' while it is down, else
   * the task); task: what he is doing underneath; left: ticks left of a timed task (morta's by-itself, entrega,
   * abrindo); stop: index of the next stop; push: tranco ticks accumulated; tomboUntil / tomboReady: the fall's end and
   * the first tick another fall may happen.
   */
  moto:{s:number;mode:MotoMode;task:Task;left:number;stop:number;push:number;tomboUntil:number;tomboReady:number};
  /**
   * from: the entrance drawn. D-052, once the car moved or a muro shut the way: via, the last replan (from where the moto
   * was to where the car was, around the muros standing then; the route is rebuilt from it), at its tick, and `stops`
   * then holds the stops left on it (else they come from the plan). checked: the standing muros' ids (joined) the route
   * was last checked against, absent while there are none.
   */
  route:{from:Entrance;via?:{from:Point;to:Point;muros?:Point[]};at?:number;checked?:string};
  stops?:ChaveiroStop[];
  /** The bill (R$), paid at the end from the seated players' wallets (the vaquinha, ChaveiroOptions.wallet). */
  budget:number;
  cida:{stock:number[];nextSaleTick:number};
  /** `playerId:requestId` of purchases already applied (a resent {t:'cida'} applies once), the last CIDA_HANDLED_LIMIT. */
  handled:string[];
  /** Tick of the first step (the chaveiro left); null before it. */
  startTick:number|null;
  bossCalled:boolean;
  ended?:'victory'|'defeat';
  endTick?:number;
  /** Seconds he still needed when it ended. */
  endEta?:number;
  /** balanco-6p-facil: the riding time (s) set at the first step from the room, only when it is not MOTO_RIDE_SECONDS. */
  ride?:number;
  /** The vaquinha, once the result paid it (wallets already deducted): the result returns the same bill again. */
  vaquinha?:{grana:number;paid:number;debt:number;share:VaquinhaShare[]};
}

/** The run's seated players (sim/wallet.ts seatedPlayers, join order): whose wallets pay the bill at the end. */
export interface Wallet {seated():SimPlayer[]}
export interface ChaveiroOptions {
  wallet:Wallet;
  /** The run seed: the entrance and the stops are drawn from Rng(seed).fork('chaveiro'). */
  seed:number;
  /** Hero-walkability grid of the city without barricades (the moto rides through the plaza mouths). */
  grid:FlowGrid;
  /** The avenue ends (asset points spawnN/S/L/O). */
  entrances:Readonly<Record<Entrance,Point>>;
  /** Where the car stands (the wall's spot). */
  car:Point;
  onOutcome(outcome:'victory'|'defeat'):void;
  /** The run already ended some other way (the team fell): no outcome is reported then. */
  runEnded?():boolean;
  /** Calls the boss once, when the ETA drops below BOSS_ETA_SECONDS, at this point of the route. */
  spawnBoss?(ctx:SimContext,at:Point):void;
  /** D-052: a player's stick on this tick (who pushes the car); absent, nobody pushes. */
  input?(playerId:string):{x:number;y:number}|undefined;
  /** D-052: standing structures the car may not cross. */
  blocks?():readonly {x:number;y:number;radius:number}[];
  /** D-052: living nests (D-051) the car keeps CAR_NEST_KEEP_OUT from. */
  nests?():readonly Point[];
  /** D-052: a room bot or an autopiloted player (moves the car only along with a person). */
  helper?(playerId:string):boolean;
  /**
   * D-052 free build: the standing muros (id and blocker centre) and their blocker radius. A muro built across the moto's
   * way makes him replan around it (the tranca rule keeps a way from him to the car). Absent: he rides through them.
   */
  muros?:{radius:number;standing():readonly {id:string;x:number;y:number}[]};
  /**
   * chaveiro-no-final (the user, 21/10: "importante é o chaveiro vir no final"; option B'): the car opens no sooner than
   * this many seconds after the run started (mode 'ninhos': the nests' ramp, NEST_PACE.ramp). A team that pushes and
   * clears everything would bring him before the horde peaks: he waits at his LAST delivery's door just long enough
   * (holdTick); a slower run never waits. Absent: no wait.
   */
  finalNotBefore?:number;
  /**
   * balanco-6p-facil: the riding time (s) by room size 1..6 (mode 'ninhos': CHAVEIRO_PACE.ride), read at the first step
   * from the players then in the run, like the car's limit (a checkpoint keeps it in ChaveiroState.ride). Absent:
   * MOTO_RIDE_SECONDS for every room. A bump keeps the span planned at MOTO_RIDE_SECONDS, crawled at LOMBADA_PACE.
   */
  ride?:readonly number[];
}

export interface ChaveiroSystem {
  readonly state:ChaveiroState;
  readonly route:Route;
  readonly stops:readonly ChaveiroStop[];
  /** Runs once a tick (assemble.ts: right after the 'structures' system). */
  step(ctx:SimContext):void;
  /** Siege targets: the car until the end, the moto while it rides (with MOTO_LURE_REACH). */
  targets():{id:string;x:number;y:number;radius:number;reach?:number;gap?:(p:Point)=>number}[];
  /** An enemy's (or the boss's) contact with the car. */
  hitCar(ctx:SimContext,enemy:EnemyState):void;
  /** Gives back `share` of the car's limit in hits (not below 0); the parts that fell stay down. */
  repair(ctx:SimContext,share?:number):void;
  /** A team purchase from Dona Cida (room command). */
  buy(ctx:SimContext,playerId:string,item:string,requestId?:string):CidaBuyResult;
  /** D-052 {t:'puxar'} past the room's checks: hook (`on`) or drop the car's rope. A resent `requestId` is 'duplicate'. */
  pull(ctx:SimContext,playerId:string,on:boolean,requestId?:string):PullResult;
  /** D-052: whether `playerId` moves the car or holds its rope (no attack then). */
  busy(playerId:string):boolean;
  /** D-052: the step (u per tick) `playerId` may walk while moving the car; undefined when free. */
  moverCap(playerId:string):number|undefined;
  /** Seconds until the car is open at the planned stops. */
  eta(tick:number):number;
  view(tick:number):ObjectiveView;
  /**
   * The bill for the result screen: the chaveiro's own end (opened: victory; car: defeat) or, when the run ended some
   * other way, `outcome` (the room's: 'defeat' = the team fell, 'timeout' = the D-043 cap). Undefined while nothing ended.
   * The first call pays the bill (the vaquinha, sim/wallet.ts: deducts the seated players' wallets, `share`); later
   * calls return the same numbers.
   */
  result(tick:number,round:{index:number;total:number},outcome?:'victory'|'defeat'|'timeout'):ObjectiveResult|undefined;
  /** The moto's position now. */
  moto():Point;
}

const SALE_GAP=ticks(SALE_GAP_SECONDS),PUSH_TICKS=ticks(PUSH_SECONDS);
const unitsOf=(e:EnemyState)=>e.boss?'boss':e.elite?'elite':'normal';
const retreating=(e:EnemyState)=>e.memory?.retreat===1;

/** The entrance and the stops of a run: a pure function of the seed and the route (the entrance is drawn first). */
export function planChaveiro(seed:number,grid:FlowGrid,entrances:Readonly<Record<Entrance,Point>>,car:Point,from?:Entrance){
  const rng=new Rng(seed>>>0).fork('chaveiro');
  const drawn=rng.pick(ENTRANCES),entrance=from??drawn;
  const route=buildRoute(grid,entrances[entrance],car,CAR_STOP),L=route.length,bump=lombadaLength(L);
  const lengthOf=(k:ObjectiveStopKind)=>k==='lombada'?bump:0;
  const stops:ChaveiroStop[]=MORTA_AT.map(f=>({kind:'morta' as const,s:f*L}));
  const fits=(s:number,kind:ObjectiveStopKind,gap:number)=>stops.every(o=>s>=o.s+lengthOf(o.kind)+gap||s+lengthOf(kind)+gap<=o.s);
  const place=(kind:ObjectiveStopKind)=>{
    const lo=.08*L,hi=Math.max(lo,.92*L-lengthOf(kind));
    let s=lo;
    for(const gap of [STOP_GAP*L,STOP_GAP*L/2]){
      for(let t=0;t<40;t++){s=rng.range(lo,hi);if(fits(s,kind,gap)){stops.push({kind,s});return;}}
    }
    stops.push({kind,s});
  };
  for(let i=0;i<ENTREGAS;i++)place('entrega');
  for(let i=0;i<LOMBADAS;i++)place('lombada');
  stops.sort((a,b)=>a.s-b.s||(a.kind<b.kind?-1:a.kind>b.kind?1:0));
  return {from:entrance,route,stops};
}

export function createChaveiroState(car:Point,from:Entrance):ChaveiroState{
  return {
    car:{x:car.x,y:car.y,hits:0,limit:CAR_LIMIT,parts:0,alarmUntil:0},
    moto:{s:0,mode:'anda',task:'anda',left:0,stop:0,push:0,tomboUntil:0,tomboReady:0},
    route:{from},budget:BUDGET_BASE,
    cida:{stock:CIDA_ITEMS.map(()=>CIDA_STOCK),nextSaleTick:0},handled:[],
    startTick:null,bossCalled:false,
  };
}

/** `restore`: a checkpointed ChaveiroState (deep-copied by the caller); the route comes back from the seed and its `from`. */
export function createChaveiro(options:ChaveiroOptions,restore?:ChaveiroState):ChaveiroSystem{
  const plan=planChaveiro(options.seed,options.grid,options.entrances,options.car,restore?.route.from);
  const state=restore??createChaveiroState(options.car,plan.from);
  // The moto's pace and a bump's span come from the planned route; a replan (D-052) changes the way, not the pace.
  // The pace follows the room at the first step (ChaveiroOptions.ride, kept in state.ride).
  let speed=0,bumpSpeed=0;
  const pace=()=>{speed=plan.route.length/((state.ride??MOTO_RIDE_SECONDS)*SIM_HZ);bumpSpeed=speed*LOMBADA_PACE;};
  pace();
  const bump=lombadaLength(plan.route.length);
  let route=plan.route,stops=plan.stops;
  // The moto's body keeps off a muro's blocker disc: the cells within both radii are shut to him.
  const muroReach=(options.muros?.radius??0)+MOTO_RADIUS;
  const gridFor=(muros:readonly Point[]|undefined,ends:readonly Point[])=>muros?.length?shutGrid(options.grid,muros,muroReach,ends):options.grid;
  const via=state.route.via;
  if(via){route=buildRoute(gridFor(via.muros,[via.from,via.to]),via.from,via.to,CAR_STOP);stops=state.stops??stops;}
  let L=route.length;
  const pos:Point={x:0,y:0},at=(s:number)=>pointAt(route,s,pos);
  const near:EnemyState[]=[];
  const moto=state.moto,car=state.car;
  const carWorld={input:options.input??(()=>undefined),blocks:options.blocks,nests:options.nests,helper:options.helper};

  const alarmed=(tick:number)=>tick<car.alarmUntil&&moto.task!=='morta';
  const fallen=(tick:number)=>tick<moto.tomboUntil;
  const shown=(tick:number):MotoMode=>alarmed(tick)?'volta':fallen(tick)?'tombo':moto.task;
  const riding=()=>moto.task==='anda'||moto.task==='lombada';
  /**
   * Ticks the moto still stands still for the alarm and the fall. Both are deadlines on the same clock (alarmUntil,
   * tomboUntil) that run out together, so the wait is the later one, not their sum.
   */
  /**
   * Standing players at the last step (or car hit): a dead moto ahead takes PUSH_SECONDS with PUSH_PLAYERS of them, else
   * it starts by itself (MORTA_ALONE_SECONDS). Read from the context on every step and hit, so the ETA (and the boss's
   * call) is the same after a checkpoint; before the first one, the team is assumed big enough.
   */
  let crew=PUSH_PLAYERS;
  const countCrew=(ctx:SimContext)=>{crew=0;for(const p of ctx.players.values())if(isStanding(p))crew++;};
  /** Ticks a dead moto still needs: the push left with a crew, else its by-itself countdown. */
  const mortaLeft=()=>crew>=PUSH_PLAYERS?Math.min(moto.left,PUSH_TICKS-moto.push):moto.left;
  const mortaTicks=()=>crew>=PUSH_PLAYERS?PUSH_TICKS:ticks(MORTA_ALONE_SECONDS);
  const held=(tick:number)=>Math.max(0,alarmed(tick)?car.alarmUntil-tick:0,fallen(tick)?moto.tomboUntil-tick:0);

  function end(ctx:SimContext,outcome:'victory'|'defeat'){
    if(state.ended)return;
    state.endEta=outcome==='victory'?0:Math.ceil(eta(ctx.tick));
    state.ended=outcome;state.endTick=ctx.tick;
    if(!options.runEnded?.())options.onOutcome(outcome);
  }
  /** Ticks of riding from `s` to `to` (the end of the route by default; speed bumps ahead at their pace). */
  function rideTicks(s:number,from:number,to=L){
    let t=0,cur=s;
    for(let i=from;i<stops.length;i++){
      const o=stops[i];if(o.kind!=='lombada'||o.s+bump<=cur||o.s>=to)continue;
      const start=Math.max(cur,o.s),stop=Math.min(to,o.s+bump);
      t+=Math.max(0,start-cur)/speed+Math.max(0,stop-start)/bumpSpeed;cur=Math.max(cur,stop);
    }
    return t+Math.max(0,to-cur)/speed;
  }
  /** Ticks a stop ahead still takes (a dead moto by the crew now, a delivery as a dirty one); a bump is in rideTicks. */
  const stopTicks=(i:number)=>stops[i].kind==='morta'?mortaTicks():stops[i].kind==='entrega'?ticks(ENTREGA_SECONDS):0;
  /** The last delivery's index (where chaveiro-no-final holds him), -1 without one. */
  function lastEntrega(){for(let i=stops.length-1;i>=0;i--)if(stops[i].kind==='entrega')return i;return -1;}
  /**
   * The tick before which he does not leave the last delivery (options.finalNotBefore), or null: the run's start +
   * finalNotBefore less the fastest rest after it (the road, every dead moto pushed, abrindo), so the car opens no
   * sooner than finalNotBefore. Only a perfect team ever waits; a slower one is already later.
   */
  function holdTick(tick:number){
    const last=lastEntrega();
    if(options.finalNotBefore===undefined||last<0)return null;
    let rest=rideTicks(stops[last].s,last+1)+ticks(ABRINDO_SECONDS);
    for(let i=last+1;i<stops.length;i++)if(stops[i].kind==='morta')rest+=PUSH_TICKS;
    return (state.startTick??tick)+ticks(options.finalNotBefore)-Math.ceil(rest);
  }
  function eta(tick:number){
    if(state.ended)return 0;
    let t=held(tick);
    let next=moto.stop;
    switch(moto.task){
      case 'abrindo':return (t+moto.left)/SIM_HZ;
      case 'morta':t+=mortaLeft();next++;break;
      case 'entrega':t+=moto.left;next++;break;
      case 'lombada':next++;break;
    }
    // A bump being ridden counts in rideTicks (from its own index).
    const from=moto.task==='lombada'?moto.stop:next,last=lastEntrega(),hold=holdTick(tick);
    if(hold!==null&&last>=moto.stop){
      // Up to the end of the last delivery, then the wait at its door (chaveiro-no-final), then the rest.
      const se=stops[last].s;
      t+=rideTicks(moto.s,from,se);
      for(let i=next;i<=last;i++)t+=stopTicks(i);
      t=Math.max(t,hold-tick)+rideTicks(se,last+1);
      for(let i=last+1;i<stops.length;i++)t+=stopTicks(i);
    }else{
      t+=rideTicks(moto.s,from);
      for(let i=next;i<stops.length;i++)t+=stopTicks(i);
    }
    return (t+ticks(ABRINDO_SECONDS))/SIM_HZ;
  }
  /** The moto reaches stop `i`. */
  function begin(ctx:SimContext,stop:ChaveiroStop){
    if(stop.kind==='morta'){moto.task='morta';moto.left=ticks(MORTA_ALONE_SECONDS);moto.push=0;return;}
    if(stop.kind==='lombada'){moto.task='lombada';return;}
    const p=at(stop.s);
    ctx.enemyIndex.query(p.x,p.y,ENTREGA_RADIUS+1,near);
    const dirty=near.some(e=>e.hp>0&&ctx.enemies.has(e.id)&&!retreating(e)&&Math.hypot(e.x-p.x,e.y-p.y)<=ENTREGA_RADIUS);
    moto.task='entrega';moto.left=ticks(dirty?ENTREGA_SECONDS:ENTREGA_CLEAN_SECONDS);
  }
  function next(){moto.task='anda';moto.stop++;moto.left=0;moto.push=0;}
  function ride(ctx:SimContext){
    switch(moto.task){
      case 'anda':{
        moto.s+=speed;
        const stop=stops[moto.stop];
        if(stop&&moto.s>=stop.s){moto.s=stop.s;begin(ctx,stop);}
        else if(moto.s>=L){
          moto.s=L;moto.task='abrindo';moto.left=ticks(ABRINDO_SECONDS);
          ctx.emit({type:'moto',mode:'chegou'});
        }
        return;
      }
      case 'lombada':{
        const stop=stops[moto.stop];
        moto.s=Math.min(L,moto.s+bumpSpeed);
        if(moto.s>=stop.s+bump||moto.s>=L)next();
        return;
      }
      case 'morta':{
        const p=at(moto.s);let pushing=0;
        for(const player of ctx.players.values())if(isStanding(player)&&Math.hypot(player.x-p.x,player.y-p.y)<=PUSH_RADIUS)pushing++;
        if(pushing>=PUSH_PLAYERS)moto.push++;
        moto.left--;
        if(moto.push>=PUSH_TICKS){next();ctx.emit({type:'moto',mode:'tranco'});}
        else if(moto.left<=0){next();ctx.emit({type:'moto',mode:'tranco',alone:true});}
        return;
      }
      case 'entrega':{
        // chaveiro-no-final: the last delivery holds him until holdTick (left stays at 0 while he waits).
        if(moto.left>0)moto.left--;
        const hold=moto.stop===lastEntrega()?holdTick(ctx.tick):null;
        if(moto.left<=0&&(hold===null||ctx.tick>=hold))next();
        return;
      }
      case 'abrindo':if(--moto.left<=0)end(ctx,'victory');return;
    }
  }
  /** D-052: the muros' ids the route was checked against (absent with none). */
  function seen(key:string){if(key)state.route.checked=key;else delete state.route.checked;}
  /**
   * D-052: the car went more than REPLAN_DRIFT u from where the route ends, or a muro built since the last check stands
   * across the way ahead: the moto replans from where he is, around the standing muros.
   */
  function replan(ctx:SimContext){
    const to=state.route.via?.to??options.car;
    if(moto.task==='abrindo')return;
    const standing=options.muros?.standing()??[],key=standing.map(m=>m.id).join();
    let shut=false;
    if(key!==(state.route.checked??'')){
      shut=routeCrosses(route,moto.s,standing,muroReach);
      if(!shut)seen(key);
    }
    if(!shut&&Math.hypot(car.x-to.x,car.y-to.y)<=REPLAN_DRIFT)return;
    if(state.route.at!==undefined&&ctx.tick-state.route.at<ticks(REPLAN_GAP_SECONDS))return;
    const from={...at(moto.s)},goal={x:car.x,y:car.y},muros=standing.map(m=>({x:m.x,y:m.y}));
    const next=buildRoute(gridFor(muros,[from,goal]),from,goal,CAR_STOP);
    seen(key);
    const scale=next.length/Math.max(1e-9,L-moto.s),kept:ChaveiroStop[]=[];
    // The stop he is at stays under him (a bump being crawled keeps its span behind him); the ones ahead keep their share.
    for(let i=moto.stop;i<stops.length;i++)kept.push({kind:stops[i].kind,s:i===moto.stop&&moto.task!=='anda'?stops[i].s-moto.s:(stops[i].s-moto.s)*scale});
    route=next;L=next.length;stops=state.stops=kept;moto.stop=0;moto.s=0;
    state.route.via={from,to:goal,...(muros.length?{muros}:{})};state.route.at=ctx.tick;
  }
  /** `playerId:requestId` of a command applied (a resent one is 'duplicate'), the last CIDA_HANDLED_LIMIT. */
  function remember(key:string|undefined){
    if(key===undefined)return;
    state.handled.push(key);if(state.handled.length>CIDA_HANDLED_LIMIT)state.handled.splice(0,state.handled.length-CIDA_HANDLED_LIMIT);
  }
  function tombo(ctx:SimContext){
    if(!riding()||ctx.tick<moto.tomboReady)return;
    const p=at(moto.s);
    ctx.enemyIndex.query(p.x,p.y,MOTO_RADIUS+1.5,near);
    for(const e of near){
      if(!(e.hp>0)||!ctx.enemies.has(e.id)||retreating(e)||e.boss)continue;
      if(!(Math.hypot(e.x-p.x,e.y-p.y)<=e.radius+MOTO_RADIUS+.05))continue;
      moto.tomboUntil=ctx.tick+ticks(TOMBO_SECONDS);moto.tomboReady=moto.tomboUntil+ticks(TOMBO_GAP_SECONDS);
      return;
    }
  }
  function sale(ctx:SimContext){
    if(ctx.tick<state.cida.nextSaleTick)return;
    const p=at(moto.s);
    const buyer=ctx.enemyIndex.nearest(p.x,p.y,SALE_RADIUS,e=>e.hp>0&&ctx.enemies.has(e.id)&&!e.boss&&!retreating(e));
    if(!buyer)return;
    (buyer as EnemyState&{sugarUntil?:number}).sugarUntil=ctx.tick+SUGAR.duration;
    state.cida.nextSaleTick=ctx.tick+SALE_GAP;
    ctx.emit({type:'sale',enemy:buyer.id});
  }

  const system:ChaveiroSystem={
    state,eta,
    get route(){return route;},
    get stops(){return stops;},
    moto:()=>({...at(moto.s)}),
    step(ctx){
      if(state.ended)return;
      countCrew(ctx);
      if(state.startTick===null){
        state.startTick=ctx.tick;
        // The limit follows the room the run starts with (a checkpoint keeps it).
        let n=0;for(const p of ctx.players.values())if(!p.spectator)n++;
        if(car.hits===0)car.limit=carLimitFor(n);
        const ride=options.ride?rideSecondsFor(options.ride,n):MOTO_RIDE_SECONDS;
        if(ride!==MOTO_RIDE_SECONDS){state.ride=ride;pace();}
      }
      stepCar(ctx,car,carWorld,moto.task==='abrindo');
      replan(ctx);
      const before=moto.mode;
      if(!alarmed(ctx.tick)){
        if(!fallen(ctx.tick))tombo(ctx);
        if(!fallen(ctx.tick))ride(ctx);
      }
      if(state.ended)return;
      sale(ctx);
      if(!state.bossCalled&&eta(ctx.tick)<BOSS_ETA_SECONDS){
        state.bossCalled=true;
        options.spawnBoss?.(ctx,{...pointAt(route,L*(1-BOSS_SPAWN_BACK))});
      }
      moto.mode=shown(ctx.tick);
      if(moto.mode!==before&&moto.mode!=='anda')ctx.emit({type:'moto',mode:moto.mode});
    },
    targets(){
      if(state.ended)return [];
      // Card uno-bloqueio-corpo: the critters hit the car from its box's edge (carGap), not the old disc's.
      const out:{id:string;x:number;y:number;radius:number;reach?:number;gap?:(p:Point)=>number}[]=[{id:CAR_ID,x:car.x,y:car.y,radius:CAR_RADIUS,gap:p=>carGap(car,p)}];
      if(riding()){const p=at(moto.s);out.push({id:MOTO_ID,x:p.x,y:p.y,radius:MOTO_RADIUS,reach:MOTO_LURE_REACH});}
      return out;
    },
    hitCar(ctx,enemy){
      if(state.ended)return;
      countCrew(ctx);
      // The last blow counts only the hits left to the limit (the bill stays BUDGET_BASE + BUDGET_PER_HIT per hit taken).
      const units=Math.min(CAR_HIT_UNITS[unitsOf(enemy)],car.limit-car.hits);
      car.hits+=units;state.budget+=BUDGET_PER_HIT*units;
      const silent=ctx.tick>=car.alarmUntil;
      car.alarmUntil=Math.min(ctx.tick+ticks(ALARM_MAX_SECONDS),Math.max(car.alarmUntil,ctx.tick)+ticks(ALARM_PER_HIT_SECONDS));
      if(silent)ctx.emit({type:'alarm',untilTick:car.alarmUntil});
      ctx.emit({type:'structure',id:CAR_ID,hp:car.limit-car.hits,maxHp:car.limit});
      CAR_PART_AT.forEach((f,i)=>{
        if(car.parts&1<<i||car.hits<f*car.limit)return;
        car.parts|=1<<i;ctx.emit({type:'part',name:CAR_PARTS[i]});
      });
      if(car.hits>=car.limit)end(ctx,'defeat');
    },
    repair(ctx,share=CAR_REPAIR_SHARE){
      if(state.ended||car.hits<=0)return;
      car.hits=Math.max(0,car.hits-Math.round(share*car.limit));
      ctx.emit({type:'structure',id:CAR_ID,hp:car.limit-car.hits,maxHp:car.limit});
    },
    buy(ctx,playerId,itemId,requestId){
      const key=requestId===undefined?undefined:`${playerId}:${requestId}`;
      if(key!==undefined&&state.handled.includes(key))return {ok:false,reason:'duplicate'};
      const index=CIDA_ITEMS.findIndex(i=>i.id===itemId);
      if(index<0)return {ok:false,reason:'item'};
      const item=CIDA_ITEMS[index],player=ctx.players.get(playerId);
      if(state.ended||!player||!isStanding(player))return {ok:false,reason:'phase'};
      const p=at(moto.s);
      if(!(Math.hypot(player.x-p.x,player.y-p.y)<=CIDA_REACH))return {ok:false,reason:'away'};
      if(state.cida.stock[index]<=0)return {ok:false,reason:'stock'};
      if(!payFrom(player,item.price))return {ok:false,reason:'grana'};
      state.cida.stock[index]--;
      remember(key);
      const field=item.effect==='speed'?'fastUntil':item.effect==='damage'?'mightUntil':'guardUntil';
      const p2=player as SimPlayer;
      p2[field]=Math.max(p2[field]??0,ctx.tick+ticks(item.seconds));
      ctx.emit({type:'buy',player:playerId,item:item.id as CidaItemId});
      return {ok:true,item:item.id,grana:walletOf(player)};
    },
    pull(ctx,playerId,on,requestId){
      const key=requestId===undefined?undefined:`${playerId}:${requestId}`;
      if(key!==undefined&&state.handled.includes(key))return {ok:false,reason:'duplicate'};
      if(state.ended)return {ok:false,reason:'fase'};
      const result=pullCar(car,ctx.players.get(playerId),on,carWorld.helper);
      if(result.ok)remember(key);
      return result;
    },
    busy:id=>!state.ended&&carBusy(car,id),
    moverCap:id=>state.ended?undefined:moverCap(car,id),
    view(tick){
      const p=at(moto.s);
      let delivery:ObjectiveView['delivery'];
      const first=moto.task==='entrega'?moto.stop:stops.findIndex((o,i)=>i>=moto.stop&&o.kind==='entrega');
      if(first>=0&&stops[first]?.kind==='entrega'){
        const o=stops[first],q=pointAt(route,o.s);
        // The ride (with bumps) and the stops before it, as the ETA counts them.
        let t=held(tick);
        if(moto.task!=='entrega'){
          if(moto.task==='morta')t+=mortaLeft();
          t+=rideTicks(moto.s,moto.stop)-rideTicks(o.s,first);
          for(let i=moto.task==='morta'?moto.stop+1:moto.stop;i<first;i++)if(stops[i].kind==='morta')t+=mortaTicks();else if(stops[i].kind==='entrega')t+=ticks(ENTREGA_SECONDS);
        }
        delivery={x:q.x,y:q.y,etaS:Math.ceil(Math.max(0,t)/SIM_HZ)};
      }
      return {
        kind:'chaveiro',
        moto:{x:p.x,y:p.y,mode:moto.mode,...(moto.task==='morta'?{push:Math.min(1,moto.push/PUSH_TICKS)}:{})},
        route:route.points.map(q=>({x:q.x,y:q.y})),
        stops:stops.map(o=>{const q=pointAt(route,o.s);return {kind:o.kind,x:q.x,y:q.y,s:o.s};}),
        etaS:Math.ceil(eta(tick)),alarmUntil:car.alarmUntil,grana:options.wallet.seated().reduce((n,p)=>n+walletOf(p),0),budget:state.budget,stock:[...state.cida.stock],
        ...(delivery?{delivery}:{}),
        car:{x:car.x,y:car.y,hits:car.hits,limit:car.limit,parts:car.parts,...(car.movers?.length?{movers:[...car.movers]}:{}),...(car.rope!==undefined?{rope:car.rope}:{}),...(car.heading?{heading:car.heading}:{})},
        ...(state.ended?{ended:state.ended}:{}),
      };
    },
    result(tick,round,outcome){
      const own=state.ended;
      if(!own&&!outcome)return undefined;
      const out=own??outcome!,cause:ObjectiveCause=own?(own==='victory'?'opened':'car'):outcome==='timeout'?'timeout':'team';
      const endTick=state.endTick??tick;
      // The vaquinha: paid once (the wallets are deducted), the same bill on every later call.
      const bill=state.vaquinha??=vaquinha(options.wallet.seated(),state.budget);
      return {kind:'chaveiro',outcome:out,cause,wave:round.index,extraWaves:Math.max(0,round.index-round.total),
        eta:own?state.endEta??0:Math.ceil(eta(tick)),seconds:(endTick-(state.startTick??endTick))/SIM_HZ,
        hits:car.hits,limit:car.limit,budget:state.budget,grana:bill.grana,paid:bill.paid,debt:bill.debt,parts:car.parts,share:bill.share.map(s=>({...s}))};
    },
  };
  return system;
}
