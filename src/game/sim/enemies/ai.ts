/**
 * enemy-ai system (VGM-031): chase, swarm zig-zag, Tio do Pavê joke + charge, fiscal ranged fines,
 * neighbor separation, terrain collision, contact damage and rare barks.
 * Deterministic: own rng stream forked once from ctx.rng, no Date/Math.random, iteration in ctx.enemies order.
 */
import {RADIUS as PLAYER_RADIUS,obstacles,walkable,type Point} from '../../world.ts';
import type {TerrainField} from '../../terrain/field.ts';
import {Rng} from '../rng.ts';
import {SIM_HZ,ticks,type EnemyState,type SimContext,type SimPlayer,type SimSystem} from '../types.ts';
import {ELITE,FISCAL_SHOT,TIO_JOKE,enemyDef,hashUnit,type EnemyDef} from './catalog.ts';
import type {TauntedEnemy} from '../skills.ts';

/** Optional non-player target (wall/shelter, VGM-046). Enemies go for whichever is closer: player or structure edge. */
export interface StructureTarget extends Point {id:string;radius:number}
export interface EnemyAiOptions {
  /** Defaults to ctx.rng.fork('enemy-ai') on the first step. */
  rng?:Rng;
  structures?:(ctx:SimContext)=>readonly StructureTarget[];
  hitStructure?:(ctx:SimContext,structureId:string,amount:number,enemy:EnemyState)=>void;
  /** Minimum ticks between two barks on screen (global). */
  barkGap?:number;
  /** Chance per tick of an ambient bark once its (longer) gap has passed. */
  barkChance?:number;
  /** Hostile projectiles are not created at or above this count (D-003; budget.ts MAX_PROJECTILES). */
  projectileCap?:number;
}
/** JSON-safe limiter and rng state, for checkpoints (VGM-047). */
export interface EnemyAiState {rng:number|null;lastBarkTick:number|null;lastLine:Record<string,string>}

/** Reactions (joke, fine, buzz, hug) need BARK_GAP of silence; ambient barks need AMBIENT_GAP_FACTOR times that, so reactions win. */
export const BARK_GAP=ticks(2.2),AMBIENT_GAP_FACTOR=2,BARK_CHANCE=.06,PROJECTILE_CAP=400;
export const SLOW_FACTOR=.5;
/** `knock` is a displacement per tick that decays by this factor; above KNOCK_STUN the enemy does not walk. */
export const KNOCK_DECAY=.6,KNOCK_STUN=.05;
/** Fraction of the overlap with a neighbor resolved per tick, and the cap of that push. */
export const SEPARATION=.5,SEPARATION_MAX=.12;
/** Largest enemy radius a neighbor query must reach (boss). */
const NEIGHBOR_REACH=.9;
const MAX_STEP=.25;
const TAU=Math.PI*2;
/** memory.state values. */
export const STATE={walk:0,joke:1,charge:2,aim:3} as const;

const live=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

/**
 * Hora Extra (CLT, skills.ts): the taunting player while the taunt lasts and they stand.
 * An expired, malformed or orphaned taunt (player down, offline, gone) is deleted so the enemy
 * goes back to the normal chase.
 */
function tauntTarget(ctx:SimContext,e:EnemyState):SimPlayer|undefined{
  const holder=e as TauntedEnemy,taunt=holder.taunt;
  if(taunt===undefined)return undefined;
  const p=typeof taunt?.player==='string'?ctx.players.get(taunt.player):undefined;
  if(p&&live(p)&&ctx.tick<taunt.untilTick)return p;
  delete holder.taunt;
  return undefined;
}

/**
 * Moves `body` by (dx,dy) without entering sea, rocks or trees (world.ts rules), sliding along blockers.
 * Bodies wider than a player also keep their own radius out of obstacles (they may only move away from one they overlap).
 * A body that starts off walkable ground (spawned in shallow water or inside a blocker) moves freely until it is walkable,
 * so once on land it never leaves it.
 */
export function moveSafely(body:Point,dx:number,dy:number,terrain:TerrainField,radius=PLAYER_RADIUS){
  const distance=Math.hypot(dx,dy);
  if(!(distance>1e-6))return;
  const parts=Math.ceil(distance/MAX_STEP),sx=dx/parts,sy=dy/parts;
  for(let i=0;i<parts;i++){
    if(!walkable(body,terrain)){body.x+=sx;body.y+=sy;continue;}
    if(clearFrom(body,sx,sy,terrain,radius)){body.x+=sx;body.y+=sy;continue;}
    if(Math.abs(sx)>1e-9&&clearFrom(body,sx,0,terrain,radius)){body.x+=sx;continue;}
    if(Math.abs(sy)>1e-9&&clearFrom(body,0,sy,terrain,radius)){body.y+=sy;continue;}
    return;
  }
}
const probe:Point={x:0,y:0};
/** Same sampling as world.ts clearSegment (every 0.08), skipping the start the caller already knows is walkable. */
function clearFrom(a:Point,dx:number,dy:number,terrain:TerrainField,radius:number){
  const n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.08));
  for(let i=1;i<=n;i++){probe.x=a.x+dx*i/n;probe.y=a.y+dy*i/n;if(!walkable(probe,terrain))return false;}
  if(radius>PLAYER_RADIUS)for(const o of obstacles){
    const after=Math.hypot(probe.x-o.x,probe.y-o.y);
    if(after<o.radius+radius&&after<Math.hypot(a.x-o.x,a.y-o.y))return false;
  }
  return true;
}

export class EnemyAi implements SimSystem {
  readonly id='enemy-ai';
  /** Tick of the last bark emitted (global limiter). */
  lastBarkTick=-Infinity;
  private rng:Rng|undefined;
  private readonly options:EnemyAiOptions;
  private lastLine:Record<string,string>={};
  private readonly targets:SimPlayer[]=[];
  private readonly neighbors:EnemyState[]=[];
  private readonly active:EnemyState[]=[];
  constructor(options:EnemyAiOptions={}){this.options=options;this.rng=options.rng;}

  step(ctx:SimContext){
    const rng=this.rng??=ctx.rng.fork('enemy-ai');
    const targets=this.targets,active=this.active;
    targets.length=0;active.length=0;
    for(const p of ctx.players.values())if(live(p))targets.push(p);
    const structures=this.options.structures?.(ctx)??[];
    // D-004: positions are snapshotted on rebuild; the core rebuilds again after enemy-ai for later systems.
    ctx.enemyIndex.rebuild(ctx.enemies.values());
    for(const e of ctx.enemies.values()){
      // Bosses belong to VGM-038; retreating enemies are walked into the sea by the director (D-010).
      if(e.hp<=0||e.boss)continue;
      // A retreating enemy never comes back for a taunt; drop it so checkpoints stay clean.
      if(e.memory?.retreat===1){delete (e as TauntedEnemy).taunt;continue;}
      const memory=e.memory??={};
      memory.seed??=hashUnit(e.id);memory.state??=STATE.walk;memory.until??=0;memory.hitReady??=0;memory.actReady??=0;
      if(e.knock){
        moveSafely(e,e.knock.x,e.knock.y,ctx.terrain,e.radius);
        e.knock.x*=KNOCK_DECAY;e.knock.y*=KNOCK_DECAY;
        if(Math.hypot(e.knock.x,e.knock.y)<.01)delete e.knock;
      }
      if(ctx.tick<(e.frozenUntil??-1)||ctx.tick<e.readyTick)continue;
      active.push(e);
      const stunned=!!e.knock&&Math.hypot(e.knock.x,e.knock.y)>KNOCK_STUN;
      // Nearest live player, or a structure if its edge is closer; a valid taunt overrides both.
      let player:SimPlayer|undefined,structure:StructureTarget|undefined,best=Infinity;
      const taunter=tauntTarget(ctx,e);
      if(taunter){player=taunter;best=Math.hypot(taunter.x-e.x,taunter.y-e.y);}
      else{
        for(const p of targets){const d=Math.hypot(p.x-e.x,p.y-e.y);if(d<best){best=d;player=p;}}
        for(const s of structures){const d=Math.hypot(s.x-e.x,s.y-e.y)-s.radius;if(d<best){best=d;structure=s;player=undefined;}}
      }
      const target:Point|undefined=player??structure;
      // Joke, charge and aim only make sense against a live player; drop them when that player is gone.
      if(!player&&memory.state!==STATE.walk)memory.state=STATE.walk;
      let dirX=0,dirY=0,pace=1;
      if(target&&!stunned){
        const tx=target.x-e.x,ty=target.y-e.y,d=Math.max(1e-6,Math.hypot(tx,ty)),ux=tx/d,uy=ty/d;
        const touching=best<=e.radius+PLAYER_RADIUS+.05;
        const def=enemyDef(e.kind);
        switch(def.behavior){
          case 'swarm':{
            const wave=Math.sin(ctx.tick*.45+memory.seed*TAU)*.9;
            dirX=ux-uy*wave;dirY=uy+ux*wave;
            if(best<3)this.react(ctx,rng,e,def,.02);
            break;
          }
          case 'joker':{
            if(memory.state===STATE.joke){
              if(ctx.tick>=memory.until){memory.state=STATE.charge;memory.until=ctx.tick+TIO_JOKE.charge;}
            }else if(memory.state===STATE.charge){
              dirX=ux;dirY=uy;pace=TIO_JOKE.chargeSpeed;
              if(ctx.tick>=memory.until)this.endCharge(ctx,memory);
            }else if(player&&best<=TIO_JOKE.range&&ctx.tick>=memory.actReady&&this.react(ctx,rng,e,def,1)){
              // He only stops when the joke is actually on screen; otherwise he keeps walking and tries next tick.
              memory.state=STATE.joke;memory.until=ctx.tick+TIO_JOKE.pause;
            }else{dirX=ux;dirY=uy;}
            break;
          }
          case 'ranged':{
            if(memory.state===STATE.aim&&best>FISCAL_SHOT.fireRange){memory.state=STATE.walk;dirX=ux;dirY=uy;}
            else if(memory.state===STATE.aim){
              if(ctx.tick>=memory.until){
                memory.state=STATE.walk;memory.actReady=ctx.tick+FISCAL_SHOT.cooldown;
                if(ctx.projectiles.size>=(this.options.projectileCap??PROJECTILE_CAP))break;
                const sx=e.x+ux*e.radius,sy=e.y+uy*e.radius;
                const id=ctx.nextId('p');
                ctx.projectiles.set(id,{id,owner:e.id,source:FISCAL_SHOT.source,x:sx,y:sy,vx:ux*FISCAL_SHOT.speed,vy:uy*FISCAL_SHOT.speed,radius:FISCAL_SHOT.radius,damage:FISCAL_SHOT.damage,pierce:0,untilTick:ctx.tick+FISCAL_SHOT.life,hostile:true,hit:[]});
              }
            }else if(player&&best<=FISCAL_SHOT.fireRange&&ctx.tick>=memory.actReady){
              memory.state=STATE.aim;memory.until=ctx.tick+FISCAL_SHOT.aim;
              this.react(ctx,rng,e,def,.7);
            }else if(best>FISCAL_SHOT.maxRange){dirX=ux;dirY=uy;}
            else if(best<FISCAL_SHOT.minRange){dirX=-ux;dirY=-uy;}
            else{const side=memory.seed<.5?.4:-.4;dirX=-uy*side;dirY=ux*side;}
            break;
          }
          default:{dirX=ux;dirY=uy;}
        }
        // Melee kinds stop at contact; the fiscal keeps backing off. Tio does not hit mid-joke.
        if(touching&&def.behavior!=='ranged'){dirX=0;dirY=0;}
        if(touching&&memory.state!==STATE.joke&&ctx.tick>=memory.hitReady){
          memory.hitReady=ctx.tick+def.contactCooldown;
          if(player){
            ctx.damagePlayer(player.id,e.damage,e.id);
            if(def.behavior==='joker'){
              const charging=memory.state===STATE.charge;
              if(live(player))moveSafely(player,ux*(charging?TIO_JOKE.shove:TIO_JOKE.bump),uy*(charging?TIO_JOKE.shove:TIO_JOKE.bump),ctx.terrain);
              if(charging)this.endCharge(ctx,memory);
            }else if(def.behavior==='chase')this.react(ctx,rng,e,def,.5);
          }else if(structure)this.options.hitStructure?.(ctx,structure.id,e.damage,e);
        }
      }
      // Separation from overlapping neighbors (order-stable: same index, same iteration).
      let pushX=0,pushY=0;
      const near=this.neighbors;near.length=0;
      ctx.enemyIndex.query(e.x,e.y,e.radius+NEIGHBOR_REACH,near);
      for(const o of near){
        if(o===e||o.hp<=0)continue;
        const ox=e.x-o.x,oy=e.y-o.y,d=Math.hypot(ox,oy),overlap=e.radius+o.radius-d;
        if(overlap<=0)continue;
        if(d<1e-6){const a=memory.seed*TAU;pushX+=Math.cos(a)*overlap;pushY+=Math.sin(a)*overlap;}
        else{pushX+=ox/d*overlap;pushY+=oy/d*overlap;}
      }
      pushX*=SEPARATION;pushY*=SEPARATION;
      const push=Math.hypot(pushX,pushY);
      if(push>SEPARATION_MAX){pushX*=SEPARATION_MAX/push;pushY*=SEPARATION_MAX/push;}
      const dirLength=Math.hypot(dirX,dirY);
      const stepLength=dirLength>1e-6?e.speed*pace*(ctx.tick<(e.slowUntil??-1)?SLOW_FACTOR:1)/SIM_HZ/dirLength:0;
      moveSafely(e,dirX*stepLength+pushX,dirY*stepLength+pushY,ctx.terrain,e.radius);
    }
    if(active.length&&this.canBark(ctx,AMBIENT_GAP_FACTOR)&&rng.chance(this.options.barkChance??BARK_CHANCE)){
      const e=active[rng.int(0,active.length-1)],elite=e.elite&&rng.chance(.5);
      this.bark(ctx,rng,e,elite?ELITE.barks:enemyDef(e.kind).barks,elite?'elite:barks':`${e.kind}:barks`);
    }
  }

  /** True when the global limiter allows a bark now (factor > 1 for low-priority ambient barks). */
  canBark(ctx:SimContext,factor=1){return ctx.tick-this.lastBarkTick>=(this.options.barkGap??BARK_GAP)*factor;}
  /**
   * Shared entry for other systems (e.g. the boss, VGM-038) so the "one balloon per ~2 s" limit holds globally.
   * `key` identifies the line list for the no-repeat rule. Returns true when the bark was emitted.
   */
  say(ctx:SimContext,enemy:EnemyState,lines:readonly string[],key:string){
    return this.bark(ctx,this.rng??=ctx.rng.fork('enemy-ai'),enemy,lines,key);
  }
  state():EnemyAiState{return {rng:this.rng?this.rng.state:null,lastBarkTick:Number.isFinite(this.lastBarkTick)?this.lastBarkTick:null,lastLine:{...this.lastLine}};}
  restore(state:EnemyAiState){
    this.rng=state.rng===null?undefined:new Rng(state.rng);
    this.lastBarkTick=state.lastBarkTick??-Infinity;this.lastLine={...state.lastLine};
  }

  /** Emits a bark if the global limiter allows; avoids repeating the previous line of the same list. */
  private bark(ctx:SimContext,rng:Rng,e:EnemyState,lines:readonly string[],key:string){
    if(!lines.length||!this.canBark(ctx))return false;
    let line=rng.pick(lines);
    if(lines.length>1&&line===this.lastLine[key])line=lines[(lines.indexOf(line)+1+rng.int(0,lines.length-2))%lines.length];
    this.lastLine[key]=line;
    this.lastBarkTick=ctx.tick;
    ctx.emit({type:'bark',enemy:e.id,line});
    return true;
  }
  /** Behavior reaction line; has priority over ambient barks. */
  private react(ctx:SimContext,rng:Rng,e:EnemyState,def:EnemyDef,chance:number){
    return this.canBark(ctx)&&rng.chance(chance)&&this.bark(ctx,rng,e,def.reactionLines,`${def.id}:react`);
  }
  private endCharge(ctx:SimContext,memory:Record<string,number>){memory.state=STATE.walk;memory.actReady=ctx.tick+TIO_JOKE.cooldown;}
}

export const createEnemyAi=(options:EnemyAiOptions={})=>new EnemyAi(options);
