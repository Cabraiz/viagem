/**
 * Ninhos (D-051, NEW-20261014-ORQ-ninhos-sim, E2 part): the sleeping horde of the city. The bodies of the run's nest
 * plan (maps/nests.ts cityNestPlan, fixed at the start of the run with its player count) stand asleep at their spots,
 * out of ctx.enemies, the AI loop and the enemyIndex: they live here, in a static index of SLEEP_CELL u buckets that
 * the hits read through ctx.sleepers (A1 (a): a sleeper can be hit; the hit wakes it and its band).
 *
 * A body wakes into ctx.enemies with the same id (so a client that drew it asleep keeps it), and only through here:
 * damage (core damageEnemy → Sleepers.wake 'dano', with its band within BAND_RADIUS), the nests (E1: wakeNest on a
 * nest's first hit), wakeAround (a call for help), the noise and a hero walking up to it (WAKE_SIGHT: card
 * NEW-20261017-ORQ-ninhos-perto-ataca-20x, caçando with its band; the car does not, it never walks up to a nest). Every wake that moves bodies emits one `acordou`.
 *
 * Noise (proposal §3, A2): `noise()` keeps the loudest noise of each source (a player, a nest, the car…) in a window of
 * NOISE_EVERY s; at the end of the window each source's noise rolls once per sleeper within its radius r, with chance
 * p × (1 − d/r), on the run rng's 'ruido' fork, sources by key and sleepers by plan order. A sleeper that wakes wakes its
 * band. The cap of awake bodies (maxAwake) stops the noise, never a hit.
 *
 * Awake states (proposal §2), in the body's memory (JSON-safe, so the state hash sees them): `sono` 1 alerta (stands
 * ALERT_PAUSE s, the "hã?", then walks to the noise at ALERT_PACE: Sono.goal, the enemy-ai's goal option), 2 caçando
 * (the AI's hunt), 3 perdeu (no player within SEE_RADIUS for LOST_AFTER s: walks home and sleeps there, or where it
 * stands after SLEEP_ANYWHERE s). A player within WANDER_SIGHT turns alerta and perdeu into caçando. A siege body (the
 * nests' groups, memory.siege) is never lost.
 *
 * Ids: `z-<index>`, the body's place in the plan order (nests first, in plan order, then the loose bands), never from
 * ctx.nextId: a checkpoint rebuilds the same bodies from the seed without moving the world's counters.
 */
import {routeDistance,type NestPlan,type Point} from '../../maps/index.ts';
import type {EnemyState,SimEvent,SimPlayer} from '../../contract/index.ts';
import {ticks} from '../../contract/index.ts';
import type {SimContext,Sleepers} from '../context.ts';
import {SpatialHash} from '../spatial.ts';
import {createEnemy,type EnemyKind} from '../enemies/catalog.ts';
import {cancelTelegraphs} from '../telegraphs.ts';
import {MAX_AWAKE} from '../../rules/index.ts';

/** Bucket size of the sleepers' index (u): they never move, so big buckets keep a noise check to a few cells. */
export const SLEEP_CELL=16;
/**
 * Card ninhos-perto-ataca-20x: a second index of FINE_CELL u buckets for the small queries (sight, bands, the awake
 * ones' spacing, a shot) up to FINE_MAX u, so thousands of sleepers keep them to a few bodies each.
 */
export const FINE_CELL=2,FINE_MAX=8;
/** A woken body wakes its band: the sleepers within this distance (u). */
export const BAND_RADIUS=4;
/**
 * A standing hero (a person or a bot) this close to a sleeper wakes it caçando, with its band (card
 * ninhos-perto-ataca-20x): it saw you. Under SEE_RADIUS (the awake ones' sight) and the knife's noise (6).
 * Card monstros-espalhados (the user, 22/10: "diminuir um pouco a visão deles, de quando passamos perto"): 5 → 3.75
 * (−25 %), so a walk between bodies a field gap apart (maps/nests.ts SPREAD.gap) can slip past.
 */
export const WAKE_SIGHT=3.75;
/** The noise window (s): one roll per source per window, with its loudest noise. */
export const NOISE_EVERY=.5;
/** A hunting body (caçando) keeps seeing a player within this distance (u): the chase as it was. */
export const SEE_RADIUS=14;
/**
 * A body walking to a noise (alerta) or back home (perdeu) spots a player within this distance (u) and hunts him.
 * Card monstros-espalhados: was SEE_RADIUS (14), now −25 %; the chase itself keeps SEE_RADIUS.
 */
export const WANDER_SIGHT=10.5;
/** The minuto de Minerva: a hero this close to a sleeper (u, a melee reach) wakes it; it stands and hits. */
export const MINERVA_REACH=1.5;
/** Caçando with no player within SEE_RADIUS for this long (s): perdeu. */
export const LOST_AFTER=8;
/** Perdeu for this long (s) without reaching home: sleeps where it stands. */
export const SLEEP_ANYWHERE=20;
/** The alerta's "hã?" (s, drawn per body) and its walk to the noise (× speed). */
export const ALERT_PAUSE:readonly [number,number]=[.6,1.2];
export const ALERT_PACE=.8;
/** Close enough to the noise (alerta) or home (perdeu), u. */
export const GOAL_REACH=1.5,HOME_REACH=1;
export const MODE={alerta:1,cacando:2,perdeu:3} as const;
/**
 * The safety net (card bichos-travados): an awake enemy (not the boss) that moved less than STUCK_MOVE u over STUCK_S s
 * with no standing hero within STUCK_FAR u leaves the world and frees its place under the nests' cap: a body of the
 * plan sleeps again where it stands; any other (a nest's group) is gone, quietly. Checked every STUCK_EVERY s, its
 * mark in the body's memory (sx, sy, st: JSON-safe).
 */
export const STUCK_S=20,STUCK_MOVE=1,STUCK_FAR=20,STUCK_EVERY=1;

/**
 * The noise table (proposal §3, with the radii of the decision in claims/NEW-20261014-ORQ-ninhos-sim: pistol 12,
 * shotgun 18, rifle 22, rocket 28, knife 6, a crate 10). p of a weapon follows its radius on WEAPON_P's points.
 */
export const NOISE={
  kill:{r:8,p:.2},
  /** The car alarm (D-047), every second while it rings, around the car (balanco-ninhos: r 40 p .3 woke ~12 at once). */
  alarm:{r:20,p:.1,every:1},
  /** The moto riding (every second; 2× p on a tranco). */
  moto:{r:10,p:.1,every:1},
  /** A bank being held (pays Grana), every 5 s. */
  bank:{r:30,p:.4,every:5},
  /** Hitting a nest: every other nest's sleepers within r (its own wakes whole: wakeNest). */
  nest:{r:25,p:.3},
  crate:{r:10},
} as const;
/** (radius, p) points of the weapons' noise: knife 6, pistol 12, shotgun 18, rifle 22, rocket 28. */
export const WEAPON_P:readonly (readonly [number,number])[]=[[6,.15],[12,.25],[18,.35],[22,.45],[28,.6]];
/** p for a noise of radius r (linear between WEAPON_P's points, clamped at the ends). */
export function noiseP(r:number):number{
  const pts=WEAPON_P;
  if(!(r>pts[0][0]))return pts[0][1];
  for(let i=1;i<pts.length;i++){
    const [r1,p1]=pts[i];
    if(r<=r1){const [r0,p0]=pts[i-1];return p0+(p1-p0)*(r-r0)/(r1-r0);}
  }
  return pts[pts.length-1][1];
}
/**
 * The automatic game's weapons (sim/weapons/catalog.ts) on the table: the melee ones (chinelo, guarda-chuva) as the
 * knife, boleto/pombo/café as the pistol, the áudio its own joke (the loudest of the light ones). Unknown: the pistol.
 * The arsenal of the manual attack (E6, weapons/arsenal.ts) brings its own radii: `weaponNoise` option.
 */
export const AUTO_WEAPON_NOISE:Readonly<Record<string,{r:number;p:number}>>=Object.freeze({
  chinelo:{r:6,p:.15},'chinelo-evo':{r:6,p:.15},'guarda-chuva':{r:6,p:.15},
  boleto:{r:12,p:.25},'boleto-evo':{r:12,p:.25},pombo:{r:12,p:.25},cafe:{r:12,p:.25},'cafe-evo':{r:12,p:.25},
  audio:{r:20,p:.3},
});
export const DEFAULT_WEAPON_NOISE={r:12,p:.25} as const;

/** Why a body woke: 'ruido' wakes it alerta, everything else caçando. */
export type WakeCause='dano'|'bando'|'ruido'|'ninho'|'chamado'|'perto';
export interface Noise {x:number;y:number;r:number;p:number}
/** A noise that repeats while it lasts (the car alarm, the moto, a bank): rolled every `every` s. */
export interface AmbientNoise extends Noise {key:string;every:number}

/**
 * Something that is not a body but takes the players' hits (E1: a nest, id `ninho:<id>`): registered by the run, it
 * stands in the sleepers' index, so shots, cones and tower blasts land on it (and a tap aims at it). hit() gets the
 * damage after the might (core damageEnemy) and returns true when it fell; it is then dropped.
 */
export interface HitTarget {readonly id:string;readonly x:number;readonly y:number;readonly radius:number;
  hit(ctx:SimContext,amount:number,source?:string,weapon?:string):boolean}

/** One body of the plan: where it sleeps, its nest (absent for a loose band's member) and its band's index. */
export interface SleepBody {readonly id:string;readonly kind:EnemyKind;readonly home:Point;readonly nest?:string;readonly band?:number}
/**
 * JSON-safe state (checkpoint, A3): the player count the plan was made with and, per body in plan order, 0 dead,
 * 1 asleep, 2 awake, with its hp; and the noise window (the loudest noise per source, keys sorted). The bodies
 * themselves come back from the seed (sonoBodies).
 */
export interface SonoState {players:number;life:[0|1|2,number][];heard:[string,Noise][]}

export interface SonoOptions {
  plan:NestPlan;
  /** The kind of the body at plan index `i` (the run's rotation; the caller's own deterministic stream). */
  kindOf:(i:number,body:{nest?:string;band?:number;home:Point})=>EnemyKind;
  /** × the catalog hp of every body (the player scale the director would give a wave body). Default 1. */
  hpScale?:number;
  /** Converts a body's catalog speed to the world's (city/speed.ts citySpeed), like the director's bodies. */
  speedMap?:(speed:number)=>number;
  /** The previous step's events (SimWorld.lastEvents): shots and kills are heard from them. */
  events?:()=>readonly SimEvent[];
  /** Radius and p of a shot of `weapon` by `player` (the arsenal's weaponNoise); default AUTO_WEAPON_NOISE. */
  weaponNoise?:(weapon:string,player:SimPlayer|undefined)=>{r:number;p:number};
  /** Noises that repeat while they last (alarm, moto, banks), asked every NOISE_EVERY s. */
  ambient?:(ctx:SimContext)=>readonly AmbientNoise[];
  /** Points the safety net never empties around (STUCK_FAR): the car a siege presses on (a coach lecturing it stands still). */
  keep?:(ctx:SimContext)=>readonly Point[];
  /** The noise and the sight wake nobody once ctx.enemies holds this many (proposal §7). Default MAX_AWAKE. */
  maxAwake?:number;
  /**
   * Card monstros-espalhados: where a wanderer stops instead of `p` when p lies in a safe place (maps/safe-places.ts:
   * its opening), undefined when p is outside every one. An alerta walks to the door of a safe place, never in; only
   * a hunt (caçando, it saw the player) follows him inside.
   */
  door?:(p:Point)=>Point|undefined;
  /**
   * The minuto de Minerva (ninhos.ts MINERVA_S): while true no noise wakes anyone (noises are dropped) and a hero wakes
   * only the sleepers within MINERVA_REACH (it walked into their reach: they hit it, standing, the enemy-ai's hold).
   */
  minerva?:(ctx:SimContext)=>boolean;
}

export interface Sono {
  readonly state:SonoState;
  readonly bodies:readonly SleepBody[];
  /** The index the hits read (SimContext.sleepers): only bodies still asleep. */
  readonly sleepers:Sleepers;
  /** Wakes every sleeper of nest `nestId` (caçando); returns how many woke. */
  wakeNest(ctx:SimContext,nestId:string,cause:WakeCause):number;
  /** Wakes every sleeper within r of (x, y); returns how many woke. */
  wakeAround(ctx:SimContext,x:number,y:number,r:number,cause:WakeCause):number;
  /** A noise of source `key` (a player id, a nest id…): the loudest of each key is rolled at the end of the window. */
  noise(key:string,n:Noise):void;
  /** Registers a hit target (a nest); a target with the same id is replaced. */
  addTarget(target:HitTarget):void;
  removeTarget(id:string):void;
  /** The ids of nest `nestId`'s bodies (asleep, awake or dead), in plan order. */
  bodiesOf(nestId:string):readonly string[];
  /** How many of nest `nestId`'s bodies are still asleep. */
  asleepIn(nestId:string):number;
  /** The enemy-ai's goal option: where an alerta or a perdeu walks, and how fast. */
  goal(ctx:SimContext,e:EnemyState):(Point&{pace:number})|undefined;
  /** Card monstros-espalhados: plan bodies dead so far (the waves' kill count). */
  dead():number;
  /**
   * Card monstros-espalhados (a wave's map share): wakes up to `count` sleepers nearest the polyline `route` (plan order
   * on ties), caçando and besieging the car (memory.siege), up to the cap of awake bodies; one `acordou`. Returns how many.
   */
  recruit(ctx:SimContext,route:readonly Point[],count:number,tune?:(e:EnemyState)=>void):number;
  /** Puts the plan's bodies to sleep (first step of the run, or the checkpoint's life); idempotent. */
  ensure(ctx:SimContext):void;
  /** Once per tick, before the AI: the dead, the noise, the awake states, the index. */
  step(ctx:SimContext):void;
}

/** The plan's bodies in plan order (ids z-0, z-1, …): every nest's sleepers, then every loose band's members. */
export function sonoBodies(plan:NestPlan,kindOf:SonoOptions['kindOf']):SleepBody[]{
  const out:SleepBody[]=[];
  const add=(home:Point,where:{nest?:string;band?:number})=>{
    const i=out.length;
    out.push(Object.freeze({id:`z-${i}`,kind:kindOf(i,{...where,home}),home:{x:home.x,y:home.y},...where}));
  };
  for(const n of plan.nests)for(const p of n.sleepers)add(p,{nest:n.id});
  plan.loose.forEach((b,band)=>{for(const p of b.members)add(p,{band});});
  return out;
}

const SIEGE='siege';
const standing=(p:SimPlayer)=>!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
const louder=(a:Noise,b:Noise)=>a.r>b.r||(a.r===b.r&&a.p>b.p);

export function createSono(options:SonoOptions,saved?:SonoState):Sono{
  const bodies=sonoBodies(options.plan,options.kindOf);
  const order=new Map(bodies.map((b,i)=>[b.id,i]));
  const byNest=new Map<string,string[]>();
  for(const b of bodies)if(b.nest!==undefined){const list=byNest.get(b.nest);if(list)list.push(b.id);else byNest.set(b.nest,[b.id]);}
  const state:SonoState=saved?structuredClone(saved):{players:options.plan.players,life:bodies.map(()=>[1,0] as [0|1|2,number]),heard:[]};
  state.heard??=[];
  if(state.life.length!==bodies.length)throw new Error(`sono: checkpoint has ${state.life.length} bodies, plan has ${bodies.length}`);
  const heard=new Map<string,Noise>(state.heard);
  const asleep=new Map<string,EnemyState>();
  /** Hit targets, each as a still EnemyState shell (what the hit tests read) and its hit(). */
  const targets=new Map<string,{shell:EnemyState;target:HitTarget}>();
  const index=new SpatialHash<EnemyState>(SLEEP_CELL),fine=new SpatialHash<EnemyState>(FINE_CELL);
  const pick=(radius:number)=>radius<=FINE_MAX?fine:index;
  // stale: bodies woke since the last rebuild (query filters them, so a rebuild can wait for the step);
  // missing: bodies fell asleep since (query must rebuild first).
  let stale=false,missing=true,made=false;
  const maxAwake=options.maxAwake??MAX_AWAKE;
  // Card ninhos-perto-ataca-20x: the plan indexes awake now (life 2), so a tick walks them, never the thousands asleep.
  const up=new Set<number>();

  /** A body as an EnemyState, out of any world (no counter, no map, no clock: spawnTick and readyTick 0, the waking sets
   * readyTick): the same object every load of the same seed, whatever the tick of the checkpoint. */
  function body(b:SleepBody):EnemyState{
    const shell={tick:0,enemies:new Map<string,EnemyState>(),nextId:()=>b.id} as unknown as SimContext;
    const e=createEnemy(shell,b.kind,b.home,options.hpScale??1);
    if(options.speedMap)e.speed=options.speedMap(e.speed);
    return e;
  }
  function reindex(force:boolean){
    if(missing||(force&&stale)){
      const all=targets.size?[...asleep.values(),...[...targets.values()].map(t=>t.shell)]:[...asleep.values()];
      index.rebuild(all);fine.rebuild(all);missing=false;stale=false;
    }
  }
  const current=(e:EnemyState)=>asleep.get(e.id)===e||targets.get(e.id)?.shell===e;
  /** Bodies still asleep within radius (never a target): what the noise and the bands read. */
  function queryAsleep(x:number,y:number,radius:number,out:EnemyState[]):EnemyState[]{
    sleepers.query(x,y,radius,out);
    let k=0;for(const e of out)if(asleep.has(e.id))out[k++]=e;
    out.length=k;
    return out;
  }

  const sleepers:Sleepers={
    get size(){return asleep.size+targets.size;},
    has:id=>asleep.has(id)||targets.has(id),
    get:id=>asleep.get(id)??targets.get(id)?.shell,
    rebuild(){/* the sono owns its index */},
    query(x,y,radius,out=[]){
      reindex(false);
      pick(radius).query(x,y,radius,out);
      // The index does not know about wakes between rebuilds: keep only bodies still asleep (and live targets).
      let k=0;for(const e of out)if(current(e))out[k++]=e;
      out.length=k;
      return out;
    },
    nearest(x,y,radius,filter){reindex(false);return pick(radius).nearest(x,y,radius,e=>current(e)&&(!filter||filter(e)));},
    isTarget:id=>targets.has(id),
    strike(ctx,id,amount,source,weapon){
      const t=targets.get(id);
      if(!t||!(amount>0))return false;
      const fell=t.target.hit(ctx,amount,source,weapon);
      if(fell)api.removeTarget(id);
      return fell;
    },
    // Damage (core damageEnemy): the body and its band, caçando, in one `acordou`.
    wake(ctx,id,cause){
      const e=asleep.get(id);
      if(!e)return undefined;
      wakeAll(ctx,withBands([id]),cause);
      return e;
    },
  };

  /** `ids` plus every sleeper within BAND_RADIUS of one of them (their bands), each once. */
  function withBands(ids:readonly string[]):string[]{
    const out=new Set(ids),near:EnemyState[]=[];
    for(const id of ids){const e=asleep.get(id);if(e)for(const o of queryAsleep(e.x,e.y,BAND_RADIUS,near))out.add(o.id);}
    return [...out];
  }
  /** Moves one sleeper into ctx.enemies (same id and object), alerta toward `heardAt` or caçando. */
  function wakeBody(ctx:SimContext,id:string,heardAt:Noise|undefined,pause:number):EnemyState|undefined{
    const e=asleep.get(id);
    if(!e)return undefined;
    asleep.delete(id);stale=true;
    const m=e.memory??={};
    if(heardAt){
      const at=options.door?.(heardAt)??heardAt;
      m.sono=MODE.alerta;m.gx=at.x;m.gy=at.y;e.readyTick=Math.max(e.readyTick,ctx.tick+pause);
    }
    else{m.sono=MODE.cacando;e.readyTick=Math.max(e.readyTick,ctx.tick);}
    m.seen=ctx.tick;
    ctx.enemies.set(id,e);
    const i=order.get(id)!;state.life[i]=[2,e.hp];up.add(i);
    return e;
  }
  /** Wakes a list in plan order (never the index's) and emits one `acordou` at their centre. */
  function wakeAll(ctx:SimContext,ids:readonly string[],_cause:WakeCause,heardAt?:Noise,pause?:(id:string)=>number):number{
    let n=0,sx=0,sy=0;
    for(const id of [...ids].sort((a,b)=>order.get(a)!-order.get(b)!)){
      const e=wakeBody(ctx,id,heardAt,pause?.(id)??0);
      if(!e)continue;
      n++;sx+=e.x;sy+=e.y;
    }
    if(n)ctx.emit({type:'acordou',x:Math.round(sx/n*100)/100,y:Math.round(sy/n*100)/100,n});
    return n;
  }
  /** Back to sleep where it stands (out of ctx.enemies, its awake memory dropped). */
  function sleepAgain(ctx:SimContext,i:number,e:EnemyState){
    ctx.enemies.delete(e.id);cancelTelegraphs(ctx,e.id);
    const m=e.memory;
    if(m){delete m.sono;delete m.gx;delete m.gy;delete m.seen;delete m.lost;delete m[SIEGE];}
    delete e.knock;
    asleep.set(e.id,e);missing=true;up.delete(i);
    state.life[i]=[1,e.hp];
  }

  function hear(ctx:SimContext,events:readonly SimEvent[]){
    for(const ev of events){
      if(ev.type==='fire'){
        const n=options.weaponNoise?.(ev.weapon,ctx.players.get(ev.player))??AUTO_WEAPON_NOISE[ev.weapon]??DEFAULT_WEAPON_NOISE;
        api.noise(ev.player,{x:ev.x,y:ev.y,r:n.r,p:n.p});
      }else if(ev.type==='kill')api.noise(ev.by??'kill',{x:ev.x,y:ev.y,...NOISE.kill});
    }
  }
  /** End of a window: each source rolls once (keys sorted), its sleepers by plan order, on the 'ruido' fork. */
  function resolve(ctx:SimContext){
    if(!heard.size)return;
    const keys=[...heard.keys()].sort(),rng=ctx.rng.fork('ruido'),near:EnemyState[]=[];
    for(const key of keys){
      const n=heard.get(key)!;
      if(!asleep.size||ctx.enemies.size>=maxAwake)break;
      const hits:string[]=[];
      const candidates=queryAsleep(n.x,n.y,n.r,near).sort((a,b)=>order.get(a.id)!-order.get(b.id)!);
      for(const e of candidates){
        const d=Math.hypot(e.x-n.x,e.y-n.y);
        if(rng.chance(n.p*(1-d/n.r)))hits.push(e.id);
      }
      if(!hits.length)continue;
      const room=Math.max(0,maxAwake-ctx.enemies.size);
      const woke=withBands(hits).sort((a,b)=>order.get(a)!-order.get(b)!).slice(0,room);
      const [lo,hi]=ALERT_PAUSE;
      wakeAll(ctx,woke,'ruido',n,()=>ticks(rng.range(lo,hi)));
    }
    heard.clear();
  }
  /**
   * A standing hero within WAKE_SIGHT of sleepers wakes them caçando with their bands (players by id; one `acordou`
   * per hero), up to the cap of awake bodies (maxAwake, MAX_AWAKE: the tick's budget; a hit still wakes past it).
   */
  function sight(ctx:SimContext,radius:number){
    if(!asleep.size)return;
    const near:EnemyState[]=[];
    for(const p of [...ctx.players.values()].filter(standing).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
      const room=maxAwake-ctx.enemies.size;
      if(room<=0)return;
      const seen=queryAsleep(p.x,p.y,radius,near);
      if(seen.length)wakeAll(ctx,withBands(seen.map(e=>e.id)).sort((a,b)=>order.get(a)!-order.get(b)!).slice(0,room),'perto');
    }
  }
  /** The awake bodies of the plan: dead ones noted, hp kept, alerta/caçando/perdeu moved on. */
  function awake(ctx:SimContext){
    const players=[...ctx.players.values()].filter(standing);
    for(const i of [...up].sort((a,b)=>a-b)){
      const life=state.life[i];
      if(life[0]!==2){up.delete(i);continue;}
      const e=ctx.enemies.get(bodies[i].id);
      if(!e||!(e.hp>0)){state.life[i]=[0,0];up.delete(i);continue;}
      life[1]=e.hp;
      const m=e.memory??={},mode=m.sono;
      if(mode===undefined)continue;
      let see=false;
      const sightR=mode===MODE.cacando?SEE_RADIUS:WANDER_SIGHT;
      for(const p of players)if(Math.hypot(p.x-e.x,p.y-e.y)<=sightR){see=true;break;}
      if(see){m.seen=ctx.tick;if(mode!==MODE.cacando){m.sono=MODE.cacando;delete m.lost;}continue;}
      if(mode===MODE.alerta){
        if(Math.hypot((m.gx??e.x)-e.x,(m.gy??e.y)-e.y)<=GOAL_REACH){m.sono=MODE.cacando;m.seen=ctx.tick;}
      }else if(mode===MODE.cacando){
        if(m[SIEGE]!==1&&ctx.tick-(m.seen??ctx.tick)>=ticks(LOST_AFTER)){m.sono=MODE.perdeu;m.lost=ctx.tick;}
      }else if(mode===MODE.perdeu){
        const home=bodies[i].home;
        if(Math.hypot(home.x-e.x,home.y-e.y)<=HOME_REACH||ctx.tick-(m.lost??ctx.tick)>=ticks(SLEEP_ANYWHERE))sleepAgain(ctx,i,e);
      }
    }
  }

  /** The safety net (STUCK_S): awake enemies stuck far from every hero leave the world (see the constant). */
  function unstick(ctx:SimContext){
    const near=[...ctx.players.values()].filter(standing),far2=STUCK_FAR*STUCK_FAR,gone:EnemyState[]=[];
    const players:readonly Point[]=[...near,...options.keep?.(ctx)??[]];
    for(const e of ctx.enemies.values()){
      if(e.boss||!(e.hp>0))continue;
      const m=e.memory??={};
      if(m.st===undefined||Math.hypot(e.x-(m.sx??e.x),e.y-(m.sy??e.y))>=STUCK_MOVE){m.sx=e.x;m.sy=e.y;m.st=ctx.tick;continue;}
      if(ctx.tick-m.st<ticks(STUCK_S))continue;
      if(players.some(p=>(p.x-e.x)**2+(p.y-e.y)**2<=far2)){m.st=ctx.tick;m.sx=e.x;m.sy=e.y;continue;}
      gone.push(e);
    }
    for(const e of gone){
      const m=e.memory!;delete m.sx;delete m.sy;delete m.st;
      const i=order.get(e.id);
      if(i!==undefined)sleepAgain(ctx,i,e);
      else{ctx.enemies.delete(e.id);cancelTelegraphs(ctx,e.id);}
    }
  }

  const api:Sono={
    state,bodies,sleepers,
    wakeNest(ctx,nestId,cause){return wakeAll(ctx,(byNest.get(nestId)??[]).filter(id=>asleep.has(id)),cause);},
    wakeAround(ctx,x,y,r,cause){
      if(!asleep.size||!(r>=0))return 0;
      return wakeAll(ctx,queryAsleep(x,y,r,[]).map(e=>e.id),cause);
    },
    addTarget(target){
      const shell:EnemyState={id:target.id,kind:'ninho',x:target.x,y:target.y,hp:1,maxHp:1,speed:0,damage:0,radius:target.radius,xp:0,spawnTick:0,readyTick:0};
      targets.set(target.id,{shell,target});missing=true;
    },
    removeTarget(id){const t=targets.get(id);if(t){t.shell.hp=0;targets.delete(id);stale=true;}},
    noise(key,n){
      if(!(n.r>0&&n.p>0)||!Number.isFinite(n.x)||!Number.isFinite(n.y))return;
      const old=heard.get(key);
      if(!old||louder(n,old))heard.set(key,{x:n.x,y:n.y,r:n.r,p:Math.min(1,n.p)});
    },
    dead(){let n=0;for(const [life] of state.life)if(life===0)n++;return n;},
    recruit(ctx,route,count,tune){
      const room=Math.min(count,maxAwake-ctx.enemies.size);
      if(room<=0||!asleep.size||!route.length)return 0;
      const near=[...asleep.values()].filter(e=>order.has(e.id)).map(e=>({e,d:routeDistance(e,route)}))
        .sort((a,b)=>a.d-b.d||order.get(a.e.id)!-order.get(b.e.id)!).slice(0,room).map(x=>x.e.id);
      const n=wakeAll(ctx,near,'chamado');
      for(const id of near){const e=ctx.enemies.get(id);if(e){(e.memory??={})[SIEGE]=1;tune?.(e);}}
      return n;
    },
    bodiesOf:nestId=>byNest.get(nestId)??[],
    asleepIn(nestId){let n=0;for(const id of byNest.get(nestId)??[])if(asleep.has(id))n++;return n;},
    goal(ctx,e){
      const m=e.memory;
      if(!m||!order.has(e.id))return undefined;
      if(m.sono===MODE.alerta&&m.gx!==undefined&&m.gy!==undefined)return {x:m.gx,y:m.gy,pace:ALERT_PACE};
      if(m.sono===MODE.perdeu){const home=bodies[order.get(e.id)!].home;return {x:home.x,y:home.y,pace:1};}
      return undefined;
    },
    ensure(ctx){
      if(made)return;
      made=true;
      bodies.forEach((b,i)=>{
        const [life,hp]=state.life[i];
        if(life===0)return;
        const e=body(b);
        // A checkpoint keeps no live enemy: a body awake when it was taken sleeps again at its spot, with its hp.
        if(hp>0)e.hp=Math.min(e.maxHp,hp);
        state.life[i]=[1,e.hp];
        asleep.set(b.id,e);
      });
      missing=true;
    },
    step(ctx){
      api.ensure(ctx);
      if(options.events)hear(ctx,options.events());
      const every=ticks(NOISE_EVERY);
      const minerva=!!options.minerva?.(ctx);
      if(minerva){heard.clear();}
      else if(ctx.tick%every===0){
        for(const a of options.ambient?.(ctx)??[])if(ctx.tick%Math.max(every,ticks(a.every))===0)api.noise(a.key,a);
        resolve(ctx);
      }
      sight(ctx,minerva?MINERVA_REACH:WAKE_SIGHT);
      awake(ctx);
      if(ctx.tick%ticks(STUCK_EVERY)===0)unstick(ctx);
      reindex(true);
      if(heard.size||state.heard.length)state.heard=[...heard].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    },
  };
  return api;
}
