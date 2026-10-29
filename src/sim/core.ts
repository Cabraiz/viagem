/**
 * SimWorld: the single authoritative SimContext of a run (VGM-030).
 * Owns entity maps, deterministic ids, the per-tick event queue, the central damage paths
 * and the ordered system registry. Systems never hurt anything except through damageEnemy/damagePlayer.
 */
import type {TerrainField} from '../maps/index.ts';
import type {Point} from '../maps/index.ts';
import {floorOf} from '../maps/index.ts';
import {Rng} from '../contract/index.ts';
import {CIDA_GUARD_MULT,CIDA_MIGHT_MULT,SYSTEM_ORDER} from '../contract/index.ts';
import type {EnemyState,LevelOffer,PickupState,ProjectileState,RoundState,SimEvent,StampedEvent,SimPlayer,SpatialIndex,TeamProgress,Telegraph} from '../contract/index.ts';
import type {SimContext,SimSystem,Sleepers} from './context.ts';
import {DEVENDO,isDevendo} from './enemies/catalog.ts';
import {provoke} from './enemies/foco.ts';
import {xpToNext} from './progression.ts';

export type {StampedEvent};
/**
 * `credit` (sim/wallet.ts): who the kill's Grana goes to when nobody killed it with their own weapon (`by` absent): a
 * tower defense's owner. It never counts as that player's kill or damage.
 */
export type KillHandler=(enemy:EnemyState,by:string|undefined,ctx:SimWorld,credit?:string)=>void;
export type PlayerZeroHandler=(player:SimPlayer,source:string|undefined,ctx:SimWorld)=>void;

/** Reference index: linear scan; nearest breaks distance ties by smallest id (D-004). VGM-032 injects SpatialHash. */
export class NaiveIndex<T extends Point&{id:string}> implements SpatialIndex<T> {
  private items:T[]=[];
  rebuild(items:Iterable<T>){this.items=[...items];}
  query(x:number,y:number,radius:number,out:T[]=[]){
    out.length=0;
    for(const item of this.items)if((item.x-x)**2+(item.y-y)**2<=radius*radius)out.push(item);
    return out;
  }
  nearest(x:number,y:number,radius:number,filter?:(item:T)=>boolean){
    let best:T|undefined,bestD=radius*radius;
    for(const item of this.items){
      const d=(item.x-x)**2+(item.y-y)**2;
      if(d<=bestD&&(!best||d<bestD||item.id<best.id)&&(!filter||filter(item))){best=item;bestD=d;}
    }
    return best;
  }
}

/** Ticks between chunk-cache prunes (1 s). */
const RETAIN_EVERY=20;
const tickRng=(seed:number,tick:number)=>new Rng(seed).fork(`tick:${tick}`);

export const initialTeam=():TeamProgress=>({xp:0,level:1,nextXp:xpToNext(1)});
/**
 * What a room checkpoint keeps of the world (E5-checkpoint-por-round): the clock, ids, team, round and offers, plus the
 * pickups on the ground (the round's chest). Live enemies, projectiles and telegraphs are dropped: a checkpoint is taken
 * at a round's intermission, when the round's horde is gone. JSON-safe.
 */
export interface WorldCheckpoint {
  seed:number;tick:number;runStartTick:number;eventSeq:number;counters:[string,number][];
  team:TeamProgress;round:RoundState;offers:[string,LevelOffer[]][];pickups:PickupState[];
}
export const initialRound=():RoundState=>({index:0,total:10,phase:'prepare',phaseEndsTick:0,remaining:0});

export interface SimWorldOptions {
  terrain:TerrainField;
  seed:number;
  /** Shared with the owner (Simulation) so players added outside a tick are visible to systems. */
  players?:Map<string,SimPlayer>;
  enemyIndex?:SpatialIndex<EnemyState>;
  /** Run order of system ids. Defaults to SYSTEM_ORDER; the run prepends 'players' (RUN_ORDER). */
  order?:readonly string[];
}

/**
 * The index snapshots positions on rebuild (D-004). It is rebuilt at the start of each tick and after
 * every system that spawns or moves enemies. It does not track deaths: readers skip hp<=0 or !ctx.enemies.has(id).
 */
export const REINDEX_AFTER:ReadonlySet<string>=new Set(['director','enemy-ai','boss']);

export class SimWorld implements SimContext {
  tick=0;
  runStartTick=0;
  readonly terrain:TerrainField;
  /** Run seed; the per-tick rng derives from it, so (seed, tick, rng.state) fully describe randomness. */
  seed:number;
  /** Fresh stream each tick (seed + tick), so ctx.rng.fork('<id>') inside a step differs every tick. */
  rng:Rng;
  readonly players:Map<string,SimPlayer>;
  readonly enemies=new Map<string,EnemyState>();
  readonly pickups=new Map<string,PickupState>();
  readonly projectiles=new Map<string,ProjectileState>();
  readonly telegraphs=new Map<string,Telegraph>();
  readonly team=initialTeam();
  readonly offers=new Map<string,LevelOffer[]>();
  readonly round=initialRound();
  readonly enemyIndex:SpatialIndex<EnemyState>;
  readonly order:readonly string[];
  /** Events of the last completed step, oldest first. Replaced every step, never appended across ticks. */
  lastEvents:StampedEvent[]=[];
  private queue:StampedEvent[]=[];
  private eventSeq=0;
  private counters=new Map<string,number>();
  private systems=new Map<string,SimSystem>();
  private killHandlers:KillHandler[]=[];
  private pendingKills:{enemy:EnemyState;by:string|undefined;credit?:string}[]=[];
  private dispatchingKills=false;
  private zeroHandlers:PlayerZeroHandler[]=[];
  /**
   * City only (cidade-11, city/balance.ts CityBalance.players[n].damage): × the raw damage of every hit a player takes
   * (contact, hostile projectiles, telegraphs: all of them come through damagePlayer, D-001), before armor. Set by
   * createRunSystems (assemble.ts) for the run it wires, and only when some team size has a damage knob; absent (island,
   * endless, a neutral city) damagePlayer is exactly as before. A result that is not a finite number > 0, or 1, is ignored.
   */
  playerDamageScale?:(ctx:SimContext)=>number;
  /** D-051 (SimContext.sleepers): set by createRunSystems for a ninhos run, cleared by its dispose; absent otherwise. */
  sleepers?:Sleepers;
  /**
   * D-051, manual combat only (createRunSystems sets it for the run it wires): damagePlayer records the enemy behind
   * each hit in SimPlayer.lastHitBy, for the auto aim. Off (the automatic weapons), players never get the field, so
   * every state digest stays as before.
   */
  recordLastHit=false;

  constructor(options:SimWorldOptions){
    this.terrain=options.terrain;
    this.seed=options.seed>>>0;
    this.rng=tickRng(this.seed,0);
    this.players=options.players??new Map();
    this.enemyIndex=options.enemyIndex??new NaiveIndex<EnemyState>();
    this.order=options.order??SYSTEM_ORDER;
    if(new Set(this.order).size!==this.order.length)throw new Error('Duplicate system id in order');
  }

  /**
   * Clears run state for a rematch. Players, systems and hooks stay; the rng is reseeded.
   * eventId keeps growing on purpose: clients de-duplicate by eventId, so restarting it would hide new events.
   */
  reset(seed:number){
    this.seed=seed>>>0;this.tick=0;this.runStartTick=0;this.rng=tickRng(this.seed,0);
    this.enemies.clear();this.pickups.clear();this.projectiles.clear();this.telegraphs.clear();this.offers.clear();
    Object.assign(this.team,initialTeam());Object.assign(this.round,initialRound());
    this.queue=[];this.lastEvents=[];this.counters.clear();
    this.enemyIndex.rebuild([]);
  }

  /** The world part of a room checkpoint (WorldCheckpoint): a deep copy, nothing live. */
  checkpoint():WorldCheckpoint{
    return structuredClone({seed:this.seed,tick:this.tick,runStartTick:this.runStartTick,eventSeq:this.eventSeq,counters:[...this.counters],
      team:this.team,round:this.round,offers:[...this.offers],pickups:[...this.pickups.values()]});
  }
  /**
   * Resumes a checkpointed run (E5-checkpoint-por-round): reset(seed), then the clock (ticks stay absolute, so every
   * stored deadline still means the same moment), ids, team, round, offers and pickups. eventId never goes back (reset).
   * Systems and players are the owner's (createRunSystems' checkpoint option, Simulation.resume).
   */
  load(cp:WorldCheckpoint){
    this.reset(cp.seed);
    this.tick=cp.tick;this.runStartTick=cp.runStartTick;this.rng=tickRng(this.seed,this.tick);this.eventSeq=Math.max(this.eventSeq,cp.eventSeq);
    for(const [prefix,n] of cp.counters)this.counters.set(prefix,n);
    Object.assign(this.team,structuredClone(cp.team));Object.assign(this.round,structuredClone(cp.round));
    for(const [id,queue] of cp.offers)this.offers.set(id,structuredClone(queue));
    for(const pickup of cp.pickups)this.pickups.set(pickup.id,structuredClone(pickup));
    return this;
  }

  register(system:SimSystem){
    if(!this.order.includes(system.id))throw new Error(`Unknown system id: ${system.id}`);
    if(this.systems.has(system.id))throw new Error(`System already registered: ${system.id}`);
    this.systems.set(system.id,system);
    return this;
  }
  /** Drops every registered system so a new run can register fresh instances (hooks are disposed by their owners). */
  clearSystems(){this.systems.clear();return this;}
  /** Ids that actually run, in execution order. */
  registered(){return this.order.filter(id=>this.systems.has(id));}

  /**
   * Called after an enemy reaches 0 hp through damageEnemy, exactly once per enemy. Kills caused inside a handler
   * are queued, so every handler sees kills in the order they happened.
   */
  onKill(handler:KillHandler){this.killHandlers.push(handler);return ()=>{this.killHandlers=this.killHandlers.filter(h=>h!==handler);};}
  /** Called when a player's hp reaches 0 through damagePlayer. Revive (VGM-037) decides what happens next. */
  onPlayerZero(handler:PlayerZeroHandler){this.zeroHandlers.push(handler);return ()=>{this.zeroHandlers=this.zeroHandlers.filter(h=>h!==handler);};}

  nextId(prefix:string){
    const n=(this.counters.get(prefix)??0)+1;
    this.counters.set(prefix,n);
    return `${prefix}-${n}`;
  }

  emit(event:SimEvent){this.queue.push({...event,eventId:++this.eventSeq});}
  /** The last event id handed out (a new Simulation carries it on, so phones never see an id again). */
  get lastEventId(){return this.eventSeq;}
  /**
   * Event ids from here on start above `min` (checkpoint-por-round review): a restarted room cannot know the last id
   * the crashed process handed out, and phones drop any id they saw (FrameDecoder keeps them across a welcome).
   */
  raiseEventSeq(min:number){if(Number.isFinite(min))this.eventSeq=Math.max(this.eventSeq,Math.floor(min));}

  /** Advances one tick: runs registered systems in order and returns this tick's events. */
  step(){
    this.tick++;
    this.rng=tickRng(this.seed,this.tick);
    this.enemyIndex.rebuild(this.enemies.values());
    for(const id of this.order){
      const system=this.systems.get(id);
      if(!system)continue;
      system.step(this);
      if(REINDEX_AFTER.has(id))this.enemyIndex.rebuild(this.enemies.values());
    }
    // Endless world (pure cache, so neither call ever changes the simulation): build a couple of height
    // lattices ahead of the players, and drop chunks far from players, base and live enemies.
    this.terrain.prefetch?.(this.players.values());
    if(this.tick%RETAIN_EVERY===0)this.terrain.retain?.(this.players.values(),this.enemies.values());
    return this.flush();
  }

  /** Moves queued events (including ones emitted between ticks by commands) into lastEvents. */
  flush(){this.lastEvents=this.queue;this.queue=[];return this.lastEvents;}

  damageEnemy(enemyId:string,amount:number,sourcePlayer?:string,weapon?:string,credit?:string){
    if(!Number.isFinite(amount)||amount<=0)return false;
    // D-051: a nest (a hit target of the sleepers' index) takes the hit through its own path, after the might.
    if(!this.enemies.has(enemyId)&&this.sleepers?.isTarget(enemyId))return this.sleepers.strike(this,enemyId,amount*this.mightOf(sourcePlayer),sourcePlayer,weapon);
    // The viaduct (maps city/viaduct.ts): a hero only hurts bodies on its own floor (before waking a sleeper).
    const src=sourcePlayer!==undefined?this.players.get(sourcePlayer):undefined;
    if(src){const body=this.enemies.get(enemyId)??this.sleepers?.get(enemyId);if(body&&floorOf(body)!==floorOf(src))return false;}
    // D-051: a hit on a sleeper wakes it and its band first (ninhos/sono.ts), then lands like any other.
    const enemy=this.enemies.get(enemyId)??this.sleepers?.wake(this,enemyId,'dano');
    if(!enemy||!(enemy.hp>0))return false;
    const might=this.mightOf(sourcePlayer);
    let dealt=Math.min(enemy.hp,amount*might);
    if(!(dealt>0))return false;
    // Snap float dust to an exact kill so the event amount always equals the hp lost.
    if(enemy.hp-dealt<1e-9)dealt=enemy.hp;
    enemy.hp-=dealt;
    this.emit({type:'damage',target:enemy.id,amount:dealt,source:sourcePlayer,weapon});
    // Foco (enemies/foco.ts): a hit a FOCO_UNO body survives may turn it on the hitter (the enemy-ai decides).
    if(enemy.hp>0){if(sourcePlayer!==undefined&&this.players.has(sourcePlayer))provoke(enemy,sourcePlayer);return false;}
    this.enemies.delete(enemyId);
    this.emit({type:'kill',enemy:enemy.id,kind:enemy.kind,by:sourcePlayer,x:enemy.x,y:enemy.y});
    this.pendingKills.push({enemy,by:sourcePlayer,...(credit!==undefined?{credit}:{})});
    if(!this.dispatchingKills){
      this.dispatchingKills=true;
      try{
        for(let kill=this.pendingKills.shift();kill;kill=this.pendingKills.shift())
          for(const handler of this.killHandlers)handler(kill.enemy,kill.by,this,kill.credit);
      }finally{this.dispatchingKills=false;this.pendingKills=[];}
    }
    return true;
  }

  /** × of a player's hits: stats.might (D-001) and Dona Cida's paçoca (D-047 SimPlayer.mightUntil, absent elsewhere). */
  private mightOf(sourcePlayer:string|undefined){
    const source=sourcePlayer?this.players.get(sourcePlayer):undefined;
    let might=sourcePlayer?source?.stats.might??1:1;
    if(source?.mightUntil!==undefined&&this.tick<source.mightUntil)might*=CIDA_MIGHT_MULT;
    return might;
  }

  damagePlayer(playerId:string,amount:number,source?:string){
    const player=this.players.get(playerId);
    if(!player||player.spectator||player.eliminated||player.downed||!(player.hp>0))return;
    if(!Number.isFinite(amount)||amount<=0||this.tick<(player.invulnerableUntil??0))return;
    // The viaduct (maps city/viaduct.ts): a body only hurts heroes on its own floor.
    const by=source!==undefined?this.enemies.get(source):undefined;
    if(by&&floorOf(by)!==floorOf(player))return;

    // D-051: who is hitting me (an enemy; hazards that outlive their thrower are not anyone to shoot back at), even when
    // the armor takes the whole hit.
    if(this.recordLastHit&&source!==undefined&&this.enemies.has(source))player.lastHitBy={id:source,tick:this.tick};
    // D-033 agiota: a player marked "devendo" (SimPlayer extra devendoUntil, D-002) takes DEVENDO.mult × damage, before armor.
    if(isDevendo(player,this.tick))amount*=DEVENDO.mult;
    // D-047 Dona Cida's cocada (SimPlayer.guardUntil), before armor like the agiota's mark.
    if(player.guardUntil!==undefined&&this.tick<player.guardUntil)amount*=CIDA_GUARD_MULT;
    if(this.playerDamageScale){
      const scale=this.playerDamageScale(this);
      if(scale!==1&&scale>0&&Number.isFinite(scale))amount*=scale;
    }
    let dealt=Math.min(player.hp,Math.max(0,amount-player.stats.armor));
    if(!(dealt>0))return;
    if(player.hp-dealt<1e-9)dealt=player.hp;
    player.hp-=dealt;
    this.emit({type:'damage',target:player.id,amount:dealt,source});
    if(player.hp===0)for(const handler of this.zeroHandlers)handler(player,source,this);
  }

  /** JSON-safe authoritative state, in deterministic (insertion) order. Hooks, systems and the event queue are excluded. */
  state(){
    return {
      seed:this.seed,tick:this.tick,runStartTick:this.runStartTick,rng:this.rng.state,eventSeq:this.eventSeq,counters:[...this.counters],
      players:[...this.players.values()],enemies:[...this.enemies.values()],pickups:[...this.pickups.values()],
      projectiles:[...this.projectiles.values()],telegraphs:[...this.telegraphs.values()],
      team:this.team,offers:[...this.offers],round:this.round,
    };
  }
}

/** FNV-1a over canonical JSON (object keys sorted). Same seed + same commands must give the same hash. */
export function stateHash(value:unknown){
  const json=JSON.stringify(value,(_key,v)=>{
    if(v&&typeof v==='object'&&!Array.isArray(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]]));
    return v;
  });
  let h=0x811c9dc5;
  for(let i=0;i<json.length;i++)h=Math.imul(h^json.charCodeAt(i),0x01000193);
  return (h>>>0).toString(16).padStart(8,'0');
}
