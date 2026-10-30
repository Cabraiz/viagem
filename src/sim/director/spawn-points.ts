/**
 * Where the director's groups appear outside the city (director.ts module doc): the island's coastal band
 * (coastalSpawnPoints, pickPoint) and the endless world's hidden ring around a player, with the catch-up and the
 * recycling of far enemies. Moved out of director.ts as is (corte C1).
 */
import type {SimContext} from '../context.ts';
import {type Point,RADIUS,type TerrainField,clearSegment,enemyTerrain,heroSpeed,isLand,walkable,worldBase,worldSpawn} from '../../maps/index.ts';
import {type CameraHint,type EnemyState,RECYCLE_DISTANCE,RING_INNER,RING_OUTER,SIM_HZ,type SimPlayer,offscreenDistance,ticks,visibleAtDefault,visibleFrom} from '../../contract/index.ts';
import {SIEGE_FLAG} from '../stonewards/wall.ts';
import {moveSafely} from '../enemies/ai.ts';
import {BAND_MAX,BLOCKED_WAIT,CATCH_UP_SPEED,DETOUR_TURNS,LAST_CALL_NEAR,RECYCLE_EVERY,RECYCLE_PER_STEP,RING_STEP,RING_TRIES,SPAWN_CLEARANCE,STUCK_SECONDS,STUCK_UNITS,lastCallBoost} from './tuning.ts';
import type {DirectorCtx,SpawnPart,SpawnRequest} from './types.ts';

export function activePlayers(ctx:SimContext){
  let n=0;for(const p of ctx.players.values())if(p.online&&!p.spectator&&!p.eliminated)n++;
  return n;
}
export const blocking=(p:SimPlayer)=>!p.spectator&&!p.eliminated;

export const candidateCache=new WeakMap<TerrainField,Point[]>();
/**
 * Coastal spawn candidates: half-unit grid nodes that are walkable, lie within BAND_MAX of the shoreline
 * and connect to the island interior (SPAWN) through clear segments. Cached per terrain field.
 * The endless world has no coast: it spawns around the players (see the module comment) and gets [].
 */
export function coastalSpawnPoints(terrain:TerrainField):Point[]{
  const cached=candidateCache.get(terrain);if(cached)return cached;
  // Endless world and city (cidade-05 spawns at the avenue tips): no coastal band.
  if(terrain.chunks||terrain.world==='cidade'){const none:Point[]=[];candidateCache.set(terrain,none);return none;}
  const base=worldBase(terrain),spawn=worldSpawn(terrain),half=12,ox=base.x-half,oy=base.y-half;
  const step=.5,size=49,at=(id:number):Point=>({x:ox+(id%size)*step,y:oy+Math.floor(id/size)*step});
  const open=new Uint8Array(size*size);
  for(let id=0;id<open.length;id++)open[id]=walkable(at(id),terrain)?1:0;
  const start=Math.round((spawn.y-oy)/step)*size+Math.round((spawn.x-ox)/step);
  const seen=new Uint8Array(size*size),queue=[start];seen[start]=1;
  for(let head=0;head<queue.length;head++){
    const id=queue[head],x=id%size,y=Math.floor(id/size);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy,next=ny*size+nx;
      if((!dx&&!dy)||nx<0||ny<0||nx>=size||ny>=size||seen[next]||!open[next])continue;
      if(!clearSegment(at(id),at(next),terrain))continue;
      seen[next]=1;queue.push(next);
    }
  }
  const points=queue.map(at).filter(p=>terrain.coast(p.x,p.y)<=BAND_MAX);
  candidateCache.set(terrain,points);
  return points;
}

export function nearestPlayer(ctx:SimContext,p:Point){
  let best=Infinity;
  for(const pl of ctx.players.values())if(blocking(pl))best=Math.min(best,Math.hypot(pl.x-p.x,pl.y-p.y));
  return best;
}

export function spawnPart(dir:DirectorCtx):SpawnPart{
  const {warning,minDistance,random,standing,options,state}=dir;
  function pickPoint(ctx:SimContext,side?:number):Point{
    const all=coastalSpawnPoints(ctx.terrain);
    if(!all.length&&ctx.terrain.world==='cidade')throw new Error('cidade: rounds spawn at the avenue tips, which arrive with cidade-05');
    if(!all.length)throw new Error('terrain has no coastal spawn point');
    const center=worldBase(ctx.terrain);
    const inSide=side===undefined?all:all.filter(p=>{
      const d=Math.atan2(p.y-center.y,p.x-center.x)-side;
      return Math.cos(d)>Math.cos(Math.PI/3);
    });
    const pool=inSide.length?inSide:all;
    const safe=pool.filter(p=>nearestPlayer(ctx,p)>=minDistance);
    if(safe.length)return random().pick(safe);
    const fallback=all.filter(p=>nearestPlayer(ctx,p)>=minDistance);
    if(fallback.length)return random().pick(fallback);
    // Players cover every coastal point: use the farthest one, never a point under a player.
    return all.reduce((a,b)=>nearestPlayer(ctx,b)>nearestPlayer(ctx,a)?b:a);
  }

  // ---------- Endless world (spawn-em-volta) ----------
  /** Players groups are sent to: online and standing; else online (all downed); else every body (all offline). */
  function anchorsOf(ctx:SimContext){
    const standing:SimPlayer[]=[],online:SimPlayer[]=[],bodies:SimPlayer[]=[];
    for(const p of ctx.players.values()){
      if(!blocking(p))continue;
      bodies.push(p);if(!p.online)continue;
      online.push(p);if(!p.downed)standing.push(p);
    }
    return standing.length?standing:online.length?online:bodies;
  }
  /** Off the screen of every player with a body (offline ones may reconnect any moment, D-011). */
  function hidden(ctx:SimContext,p:Point){
    for(const pl of ctx.players.values())if(blocking(pl)&&visibleFrom(pl,p,options.cameraOf?.(ctx,pl)))return false;
    return true;
  }
  /**
   * Pacing only (CATCH_UP_SPEED): off every player's screen at the DEFAULT zoom (contract visibleAtDefault). Spawns,
   * recycling and fleeing bodies vanishing keep `hidden` (the widest legal camera).
   */
  function hiddenAtDefault(ctx:SimContext,p:Point){
    for(const pl of ctx.players.values())if(blocking(pl)&&visibleAtDefault(pl,p,options.cameraOf?.(ctx,pl)))return false;
    return true;
  }
  /**
   * Units a hero covers during the warning at its real (2×, maps heroSpeed) walk: a spot must stay hidden even if a
   * player walks straight at it.
   */
  const lead=(ctx:SimContext)=>heroSpeed(ctx.terrain)*warning/SIM_HZ;
  /**
   * Hidden from everyone with `margin` to spare: the spot moved `margin` units towards each player is hidden too.
   * Every legal screen is star-shaped around its player (convex rectangles that contain it), so that is the
   * closest the edge can be in that direction.
   */
  function hiddenBy(ctx:SimContext,p:Point,margin:number){
    for(const pl of ctx.players.values()){
      if(!blocking(pl))continue;
      const hint=options.cameraOf?.(ctx,pl),dx=pl.x-p.x,dy=pl.y-p.y,d=Math.hypot(dx,dy);
      if(visibleFrom(pl,p,hint))return false;
      if(d<=margin||visibleFrom(pl,{x:p.x+dx/d*margin,y:p.y+dy/d*margin},hint))return false;
    }
    return true;
  }
  const hiddenAhead=(ctx:SimContext,p:Point)=>hiddenBy(ctx,p,lead(ctx));
  const spawnable=(ctx:SimContext,p:Point)=>walkable(p,ctx.terrain)&&ctx.terrain.chunks!.clear(p.x,p.y,SPAWN_CLEARANCE);
  function nearestOf(list:readonly SimPlayer[],p:Point){
    let best:SimPlayer|undefined,d2=Infinity;
    for(const a of list){const dx=a.x-p.x,dy=a.y-p.y,d=dx*dx+dy*dy;if(d<d2){d2=d;best=a;}}
    return {player:best,d2};
  }
  /**
   * The anchor with the fewest enemies (alive and nearest to it, plus pending groups sent to it); ties go to the
   * one served least this round, then rng. A team that kills fast still splits the horde evenly.
   */
  function chooseAnchor(ctx:SimContext,anchors:readonly SimPlayer[]):SimPlayer{
    if(anchors.length===1)return anchors[0];
    const load=new Map(anchors.map(a=>[a.id,0]));
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);
      if(!e||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1)continue;
      const {player}=nearestOf(anchors,e);
      if(player)load.set(player.id,load.get(player.id)!+1);
    }
    for(const p of state.pending)if(p.anchor!==undefined&&load.has(p.anchor))load.set(p.anchor,load.get(p.anchor)!+p.members.length);
    let min=Infinity;for(const v of load.values())min=Math.min(min,v);
    const served=state.served??{};
    let tied=anchors.filter(a=>load.get(a.id)===min),least=Infinity;
    for(const a of tied)least=Math.min(least,served[a.id]??0);
    tied=tied.filter(a=>(served[a.id]??0)===least);
    return tied.length===1?tied[0]:random().pick(tied);
  }
  function serve(anchor:string|undefined,members:number){
    if(anchor===undefined)return;
    const served=state.served??={};served[anchor]=(served[anchor]??0)+members;
  }
  /** Point on the off-screen ring of `center` (optionally within ±60° of `side`), hidden from everyone. */
  function ringPoint(ctx:SimContext,center:Point,side?:number,hint?:CameraHint):Point|undefined{
    for(let attempt=0;attempt<RING_TRIES;attempt++){
      const a=side===undefined?random().range(0,Math.PI*2):side+random().range(-Math.PI/3,Math.PI/3);
      const ux=Math.cos(a),uy=Math.sin(a);
      const d=offscreenDistance(ux,uy,hint)+random().range(RING_INNER,RING_OUTER)+attempt*RING_STEP;
      const p={x:center.x+ux*d,y:center.y+uy*d};
      if(spawnable(ctx,p)&&hiddenAhead(ctx,p))return p;
    }
    return undefined;
  }
  /**
   * Endless spawn spot. Siege groups: around the base, off everyone's screen (no hint: the base has no camera).
   * Boss: around the player closest to the team's centre. Others: around the requested anchor if still valid,
   * else the least loaded one. Undefined when no hidden spot was found this time.
   */
  function locateEndless(ctx:SimContext,spawn:SpawnRequest):{point:Point;anchor?:string}|undefined{
    if(spawn.siege){const point=ringPoint(ctx,worldBase(ctx.terrain),spawn.side);return point&&{point};}
    const anchors=anchorsOf(ctx);
    if(!anchors.length){const point=ringPoint(ctx,worldBase(ctx.terrain),spawn.side);return point&&{point};}
    let anchor=spawn.anchor!==undefined?anchors.find(a=>a.id===spawn.anchor):undefined;
    if(!anchor&&spawn.boss){
      let cx=0,cy=0;for(const a of anchors){cx+=a.x;cy+=a.y;}
      anchor=nearestOf(anchors,{x:cx/anchors.length,y:cy/anchors.length}).player;
    }
    anchor??=chooseAnchor(ctx,anchors);
    const point=ringPoint(ctx,anchor,spawn.side,options.cameraOf?.(ctx,anchor));
    return point&&{point,anchor:anchor.id};
  }
  /** Hidden enemies close in faster (CATCH_UP_SPEED); in the last call, every far one (see LAST_CALL_SECONDS). */
  function catchUp(ctx:SimContext){
    const anchors=anchorsOf(ctx).filter(p=>p.online&&!p.downed&&p.hp>0);
    if(!anchors.length)return;
    const step=CATCH_UP_SPEED/SIM_HZ,called=!!state.called,base=called?options.siegeTarget?.(ctx)??worldBase(ctx.terrain):undefined;
    for(const id of state.tracked){
      const e=ctx.enemies.get(id);
      if(!e||e.hp<=0||e.memory?.retreat===1||ctx.tick<e.readyTick)continue;
      const siege=e.memory?.[SIEGE_FLAG]===1;
      if(siege&&!called)continue;
      // The boss only while it walks (boss.ts ACT_IDLE = 0); its dash and sweep place it themselves.
      if(e.boss&&e.memory?.act!==0)continue;
      if(e.frozenUntil!==undefined&&ctx.tick<e.frozenUntil)continue;
      if(called){
        // Last call: towards the team (siege bodies: towards the wall they besiege), on screen too, until LAST_CALL_NEAR.
        const to=siege?base!:nearestOf(anchors,e).player!,dx=to.x-e.x,dy=to.y-e.y,d=Math.hypot(dx,dy);
        if(d<=LAST_CALL_NEAR)continue;
        const m=e.memory??={};
        if(ctx.tick<(m.blockedUntil??-1))continue;
        const boost=lastCallBoost(e.speed,hiddenAtDefault(ctx,e))/SIM_HZ;
        if(boost<=0)continue;
        // Once a second: a body that did not get anywhere squeezes through for a while (STUCK_SECONDS).
        if(m.callTick===undefined||ctx.tick-m.callTick>=SIM_HZ){
          if(m.callTick!==undefined&&Math.hypot(e.x-(m.callX??e.x),e.y-(m.callY??e.y))<STUCK_UNITS)m.squeezeUntil=ctx.tick+ticks(STUCK_SECONDS);
          m.callTick=ctx.tick;m.callX=e.x;m.callY=e.y;
        }
        if(!hurry(ctx,e,dx/d*boost,dy/d*boost,ctx.tick<(m.squeezeUntil??-1)))m.blockedUntil=ctx.tick+BLOCKED_WAIT+(Math.floor((m.seed??0)*8)&7);
        continue;
      }
      if(!hiddenAtDefault(ctx,e))continue;
      const {player,d2}=nearestOf(anchors,e);
      if(!player||d2<1)continue;
      const d=Math.sqrt(d2),x=e.x,y=e.y;
      moveSafely(e,(player.x-e.x)/d*step,(player.y-e.y)/d*step,enemyTerrain(ctx.terrain),e.radius);
      // The extra step never carries it onto a (default-zoom) screen: the last stretch in is at its own pace.
      if(!hiddenAtDefault(ctx,e)){e.x=x;e.y=y;}
    }
  }
  /**
   * A called enemy's extra step; blocked straight ahead (a tree, a rock), it sidesteps (its own side first).
   * False when nothing moved it (the caller makes it wait BLOCKED_WAIT ticks before the next try).
   */
  function hurry(ctx:SimContext,e:EnemyState,dx:number,dy:number,squeeze:boolean){
    const x=e.x,y=e.y,want=Math.hypot(dx,dy);
    // Squeezing: straight through trees and rocks, on land only (moveSafely lets a body inside an obstacle walk out).
    // City: never through a barricade (enemyTerrain).
    if(squeeze&&isLand({x:x+dx,y:y+dy},RADIUS+.2,enemyTerrain(ctx.terrain))){e.x=x+dx;e.y=y+dy;return true;}
    moveSafely(e,dx,dy,enemyTerrain(ctx.terrain),e.radius);
    if(Math.hypot(e.x-x,e.y-y)>=want*.5)return true;
    const side=(e.memory?.seed??0)<.5?1:-1;
    for(const turn of DETOUR_TURNS)for(const sign of [side,-side]){
      const a=turn*sign,c=Math.cos(a),s=Math.sin(a);
      e.x=x;e.y=y;moveSafely(e,dx*c-dy*s,dx*s+dy*c,enemyTerrain(ctx.terrain),e.radius);
      if(Math.hypot(e.x-x,e.y-y)>=want*.5)return true;
    }
    e.x=x;e.y=y;return false;
  }
  /** VS recycling: enemies far from every player come back on a ring next to one, same id and hp, no kill. */
  function recycle(ctx:SimContext){
    if(ctx.tick%RECYCLE_EVERY!==0)return;
    const anchors=anchorsOf(ctx);if(!anchors.length)return;
    const far=RECYCLE_DISTANCE*RECYCLE_DISTANCE;
    let moved=0;
    for(const id of state.tracked){
      if(moved>=RECYCLE_PER_STEP)break;
      const e=ctx.enemies.get(id);
      // The boss keeps its own arena logic (VGM-038); siege enemies are supposed to be away from players.
      if(!e||e.boss||e.hp<=0||e.memory?.retreat===1||e.memory?.[SIEGE_FLAG]===1)continue;
      if(nearestOf(anchors,e).d2<=far)continue;
      // Far from everyone standing is not enough: a downed or offline player may still be looking at it.
      if(!hidden(ctx,e))continue;
      const anchor=chooseAnchor(ctx,anchors),p=ringPoint(ctx,anchor,undefined,options.cameraOf?.(ctx,anchor));
      if(!p)continue;
      e.x=p.x;e.y=p.y;delete e.knock;
      if(e.memory&&e.memory.state!==undefined)e.memory.state=0; // back to walking: no charge across the map
      state.recycled=(state.recycled??0)+1;moved++;
    }
  }
  return {pickPoint,anchorsOf,hidden,hiddenBy,nearestOf,chooseAnchor,serve,locateEndless,catchUp,recycle};
}
