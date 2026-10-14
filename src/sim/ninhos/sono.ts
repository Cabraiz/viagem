/**
 * Ninhos (D-051, NEW-20261014-ORQ-ninhos-sim, E2 part): the sleeping horde of the city. The bodies of the run's nest
 * plan (maps/nests.ts cityNestPlan, fixed at the start of the run with its player count) stand asleep at their spots,
 * out of ctx.enemies, the AI loop and the enemyIndex: they live here, in a static index of SLEEP_CELL u buckets that
 * the hits read through ctx.sleepers (A1 (a): a sleeper can be hit; the hit wakes it and its band).
 *
 * A body wakes into ctx.enemies with the same id (so a client that drew it asleep keeps it), and only through here:
 * damage (core damageEnemy → wakeBody 'dano', then its band within BAND_RADIUS), the nests (E1: wakeNest on a nest's
 * first hit) and wakeAround (noise, a call for help). Every wake that moves bodies emits one `acordou {x, y, n}`.
 *
 * Ids: `z-<index>`, the body's place in the plan order (nests first, in plan order, then the loose bands), never from
 * ctx.nextId: a checkpoint rebuilds the same bodies from the seed without moving the world's counters.
 */
import type {NestPlan,Point} from '../../maps/index.ts';
import type {EnemyState} from '../../contract/index.ts';
import type {SimContext,Sleepers} from '../context.ts';
import {SpatialHash} from '../spatial.ts';
import {createEnemy,type EnemyKind} from '../enemies/catalog.ts';

/** Bucket size of the sleepers' index (u): they never move, so big buckets keep a noise check to a few cells. */
export const SLEEP_CELL=16;
/** A woken body wakes its band: the sleepers within this distance (u). */
export const BAND_RADIUS=4;
/** Why a body woke (the `acordou` event does not carry it; tests and the bench read it from wakeAround's return). */
export type WakeCause='dano'|'bando'|'ruido'|'ninho'|'chamado';

/** One body of the plan: where it sleeps, its nest (absent for a loose band's member) and its band's index. */
export interface SleepBody {readonly id:string;readonly kind:EnemyKind;readonly home:Point;readonly nest?:string;readonly band?:number}
/**
 * JSON-safe state (checkpoint, A3): the player count the plan was made with and, per body in plan order, 0 dead,
 * 1 asleep, 2 awake, with its hp. The bodies themselves come back from the seed (sonoBodies).
 */
export interface SonoState {players:number;life:[0|1|2,number][]}

export interface SonoOptions {
  plan:NestPlan;
  /** The kind of the body at plan index `i` (the run's rotation; the caller's own deterministic stream). */
  kindOf:(i:number,body:{nest?:string;band?:number;home:Point})=>EnemyKind;
  /** × the catalog hp of every body (the player scale the director would give a wave body). Default 1. */
  hpScale?:number;
  /** Converts a body's catalog speed to the world's (city/speed.ts citySpeed), like the director's bodies. */
  speedMap?:(speed:number)=>number;
}

export interface Sono {
  readonly state:SonoState;
  readonly bodies:readonly SleepBody[];
  /** The index the hits read (SimContext.sleepers): only bodies still asleep. */
  readonly sleepers:Sleepers;
  /** Wakes every sleeper of nest `nestId`; returns how many woke. */
  wakeNest(ctx:SimContext,nestId:string,cause:WakeCause):number;
  /** Wakes every sleeper within r of (x, y); returns how many woke. */
  wakeAround(ctx:SimContext,x:number,y:number,r:number,cause:WakeCause):number;
  /** The ids of nest `nestId`'s bodies (asleep, awake or dead), in plan order. */
  bodiesOf(nestId:string):readonly string[];
  /** How many of nest `nestId`'s bodies are still asleep. */
  asleepIn(nestId:string):number;
  /** Puts the plan's bodies to sleep (first step of the run, or the checkpoint's life); idempotent. */
  ensure(ctx:SimContext):void;
  /** Once per tick, before the AI: re-indexes after wakes, notes the dead. */
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

export function createSono(options:SonoOptions,saved?:SonoState):Sono{
  const bodies=sonoBodies(options.plan,options.kindOf);
  const order=new Map(bodies.map((b,i)=>[b.id,i]));
  const byNest=new Map<string,string[]>();
  for(const b of bodies)if(b.nest!==undefined){const list=byNest.get(b.nest);if(list)list.push(b.id);else byNest.set(b.nest,[b.id]);}
  const state:SonoState=saved?structuredClone(saved):{players:options.plan.players,life:bodies.map(()=>[1,0] as [0|1|2,number])};
  if(state.life.length!==bodies.length)throw new Error(`sono: checkpoint has ${state.life.length} bodies, plan has ${bodies.length}`);
  const asleep=new Map<string,EnemyState>();
  const index=new SpatialHash<EnemyState>(SLEEP_CELL);
  let dirty=true,made=false;
  const scratch:EnemyState[]=[];

  /** A body as an EnemyState, out of any world (no counter, no map): the same object every load of the same seed. */
  function body(ctx:SimContext,b:SleepBody):EnemyState{
    const shell={tick:ctx.tick,enemies:new Map<string,EnemyState>(),nextId:()=>b.id} as unknown as SimContext;
    const e=createEnemy(shell,b.kind,b.home,options.hpScale??1);
    if(options.speedMap)e.speed=options.speedMap(e.speed);
    return e;
  }
  function reindex(){if(dirty){index.rebuild(asleep.values());dirty=false;}}

  const sleepers:Sleepers={
    get size(){return asleep.size;},
    has:id=>asleep.has(id),
    get:id=>asleep.get(id),
    rebuild(){/* the sono owns its index: re-indexed on wakes only */},
    query(x,y,radius,out=[]){
      reindex();
      index.query(x,y,radius,out);
      // The index does not know about wakes between rebuilds: keep only bodies still asleep.
      let k=0;for(const e of out)if(asleep.get(e.id)===e)out[k++]=e;
      out.length=k;
      return out;
    },
    nearest(x,y,radius,filter){reindex();return index.nearest(x,y,radius,e=>asleep.get(e.id)===e&&(!filter||filter(e)));},
    // Damage (core damageEnemy): the body and its band, in one `acordou`.
    wake(ctx,id,cause){
      const e=asleep.get(id);
      if(!e)return undefined;
      wakeAll(ctx,[id,...sleepers.query(e.x,e.y,BAND_RADIUS,[]).map(o=>o.id).filter(o=>o!==id)],cause);
      return e;
    },
  };

  /** Moves one sleeper into ctx.enemies (same id and object); undefined if it was not asleep. */
  function wakeBody(ctx:SimContext,id:string,_cause:WakeCause):EnemyState|undefined{
    const e=asleep.get(id);
    if(!e)return undefined;
    asleep.delete(id);dirty=true;
    e.readyTick=Math.max(e.readyTick,ctx.tick);
    ctx.enemies.set(id,e);
    const i=order.get(id)!;state.life[i]=[2,e.hp];
    return e;
  }
  /** Wakes a list (sorted by plan order, so the order never depends on the index) and emits one `acordou`. */
  function wakeAll(ctx:SimContext,ids:readonly string[],cause:WakeCause):number{
    let n=0,sx=0,sy=0;
    for(const id of [...ids].sort((a,b)=>order.get(a)!-order.get(b)!)){
      const e=wakeBody(ctx,id,cause);
      if(!e)continue;
      n++;sx+=e.x;sy+=e.y;
    }
    if(n)ctx.emit({type:'acordou',x:Math.round(sx/n*100)/100,y:Math.round(sy/n*100)/100,n});
    return n;
  }

  return {
    state,bodies,sleepers,
    wakeNest(ctx,nestId,cause){return wakeAll(ctx,(byNest.get(nestId)??[]).filter(id=>asleep.has(id)),cause);},
    wakeAround(ctx,x,y,r,cause){
      if(!asleep.size||!(r>=0))return 0;
      return wakeAll(ctx,sleepers.query(x,y,r,scratch).map(e=>e.id),cause);
    },
    bodiesOf:nestId=>byNest.get(nestId)??[],
    asleepIn(nestId){let n=0;for(const id of byNest.get(nestId)??[])if(asleep.has(id))n++;return n;},
    ensure(ctx){
      if(made)return;
      made=true;
      bodies.forEach((b,i)=>{
        const [life,hp]=state.life[i];
        if(life===0)return;
        const e=body(ctx,b);
        // A checkpoint keeps no live enemy: a body awake when it was taken sleeps again at its spot, with its hp.
        if(hp>0)e.hp=Math.min(e.maxHp,hp);
        state.life[i]=[1,e.hp];
        asleep.set(b.id,e);
      });
      dirty=true;
    },
    step(ctx){
      this.ensure(ctx);
      // Awake bodies: their hp for the checkpoint, and the dead (killed through damageEnemy, gone from ctx.enemies).
      for(let i=0;i<bodies.length;i++){
        const life=state.life[i];
        if(life[0]!==2)continue;
        const e=ctx.enemies.get(bodies[i].id);
        if(e&&e.hp>0)life[1]=e.hp;else state.life[i]=[0,0];
      }
      reindex();
    },
  };
}
