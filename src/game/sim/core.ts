/**
 * SimWorld: the single authoritative SimContext of a run (VGM-030).
 * Owns entity maps, deterministic ids, the per-tick event queue, the central damage paths
 * and the ordered system registry. Systems never hurt anything except through damageEnemy/damagePlayer.
 */
import type {TerrainField} from '../terrain/field.ts';
import type {Point} from '../world.ts';
import {Rng} from './rng.ts';
import {SYSTEM_ORDER} from './types.ts';
import type {
  EnemyState,LevelOffer,PickupState,ProjectileState,RoundState,SimContext,SimEvent,SimPlayer,SimSystem,SpatialIndex,TeamProgress,Telegraph,
} from './types.ts';

export type StampedEvent=SimEvent&{eventId:number};
export type KillHandler=(enemy:EnemyState,by:string|undefined,ctx:SimWorld)=>void;
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

const tickRng=(seed:number,tick:number)=>new Rng(seed).fork(`tick:${tick}`);

export const initialTeam=():TeamProgress=>({xp:0,level:1,nextXp:5});
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
  private pendingKills:{enemy:EnemyState;by:string|undefined}[]=[];
  private dispatchingKills=false;
  private zeroHandlers:PlayerZeroHandler[]=[];

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
    return this.flush();
  }

  /** Moves queued events (including ones emitted between ticks by commands) into lastEvents. */
  flush(){this.lastEvents=this.queue;this.queue=[];return this.lastEvents;}

  damageEnemy(enemyId:string,amount:number,sourcePlayer?:string,weapon?:string){
    const enemy=this.enemies.get(enemyId);
    if(!enemy||!(enemy.hp>0)||!Number.isFinite(amount)||amount<=0)return false;
    const might=sourcePlayer?this.players.get(sourcePlayer)?.stats.might??1:1;
    let dealt=Math.min(enemy.hp,amount*might);
    if(!(dealt>0))return false;
    // Snap float dust to an exact kill so the event amount always equals the hp lost.
    if(enemy.hp-dealt<1e-9)dealt=enemy.hp;
    enemy.hp-=dealt;
    this.emit({type:'damage',target:enemy.id,amount:dealt,source:sourcePlayer,weapon});
    if(enemy.hp>0)return false;
    this.enemies.delete(enemyId);
    this.emit({type:'kill',enemy:enemy.id,kind:enemy.kind,by:sourcePlayer,x:enemy.x,y:enemy.y});
    this.pendingKills.push({enemy,by:sourcePlayer});
    if(!this.dispatchingKills){
      this.dispatchingKills=true;
      try{
        for(let kill=this.pendingKills.shift();kill;kill=this.pendingKills.shift())
          for(const handler of this.killHandlers)handler(kill.enemy,kill.by,this);
      }finally{this.dispatchingKills=false;this.pendingKills=[];}
    }
    return true;
  }

  damagePlayer(playerId:string,amount:number,source?:string){
    const player=this.players.get(playerId);
    if(!player||player.spectator||player.eliminated||player.downed||!(player.hp>0))return;
    if(!Number.isFinite(amount)||amount<=0||this.tick<(player.invulnerableUntil??0))return;
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
