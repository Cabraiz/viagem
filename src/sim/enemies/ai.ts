/**
 * enemy-ai system (VGM-031, cast of D-033): bêbado drunk chase + burp cone, pombos swarm zig-zag + poop, Tio do Pavê
 * joke + charge, agiota ranged boletos (the "devendo" mark), anão molotov throws with pulsing ground fire and a death
 * explosion, neighbor separation, terrain collision, contact damage and rare barks.
 * Every hazard is a telegraph (telegraphs.ts, ≥ MIN_TELEGRAPH_TICKS of warning) inside the enemies' telegraph budget.
 * Every step (walk, zig-zag, back-off, the Tio's charge; in the city the crowd's separation push too) is capped at
 * ACTION_PEAK_MAX × the world's hero speed, and the charge is warned by an 'investida' line and runs it without homing, so a hero can always step out of it.
 * Deterministic: own rng stream forked once from ctx.rng, no Date/Math.random, iteration in ctx.enemies order.
 */
import {RADIUS as PLAYER_RADIUS,SPEED as HERO_SPEED,maskSurface,obstaclesNear,walkable,type Point} from '../../maps/index.ts';
import type {TerrainField} from '../../maps/index.ts';
import {Rng} from '../../contract/index.ts';
import {SIM_HZ,ticks,type EnemyState,type ProjectileState,type SimPlayer} from '../../contract/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {ACTION_PEAK_MAX,AGIOTA_SHOT,BURP,DEVENDO,DEVENDO_LINES,ELITE,HAZARD_OWNERS,MOLOTOV,POOP,TIO_JOKE,enemyDef,hashUnit,isDevendo,type DevendoPlayer,type EnemyDef} from './catalog.ts';
import {addTelegraph,cancelTelegraphs,telegraphHits,type TelegraphSpec} from '../telegraphs.ts';
import {MAX_TELEGRAPHS} from '../../rules/index.ts';
import type {Telegraph} from '../../contract/index.ts';
import type {TauntedEnemy} from '../skills.ts';

/**
 * Optional non-player target (wall/shelter, VGM-046). Only siege enemies (memory.siege === 1, set by the director)
 * consider it, and go for whichever is closer: a player or the structure's edge (NEW-20261006-E8-wall-siege-single-path).
 * Everyone else ignores structures. Against a structure every kind walks up and hits it (the agiota and the anão too: a boleto does
 * not hurt a wall, a molotov is not thrown at it).
 */
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
  /** City flow field: returns true after writing the walking direction into out (unit vector); best/touching stay Euclidean. */
  steer?:(ctx:SimContext,e:EnemyState,target:Point,out:Point)=>boolean;
  /** Enemy hazards (burp, molotov, fire, poop, explosion, the Tio's charge line) are not created at or above this many telegraphs. */
  telegraphCap?:number;
  /**
   * Walking speed (u/s) of the heroes in this world; no enemy step goes past ACTION_PEAK_MAX × it. Defaults to SPEED (maps/world.ts, 3.1: the endless world); the city passes its own hero's.
   */
  heroSpeed?:number;
  /**
   * Also clamp the whole move (the capped walk plus the neighbours' separation push, up to SEPARATION_MAX a tick) to the
   * same peak, so a dense crowd never shoves a body past it (the city, where the peak is 2.29 u/s). Off by default: in
   * the endless/island worlds a crowd's push past 1.15 × 3.1 is part of the tuned pacing (the round-end and novice
   * balance and the boss digest change with it).
   */
  capPush?:boolean;
}
/** JSON-safe limiter and rng state, for checkpoints (VGM-047). */
export interface EnemyAiState {rng:number|null;lastBarkTick:number|null;lastLine:Record<string,string>}

/** Reactions (joke, fine, buzz, hug) need BARK_GAP of silence; ambient barks need AMBIENT_GAP_FACTOR times that, so reactions win. */
export const BARK_GAP=ticks(2.2),AMBIENT_GAP_FACTOR=2,BARK_CHANCE=.06,PROJECTILE_CAP=400;
/** Telegraph slots kept free for the boss (its multi-target fine plus a sweep); enemy hazards use the rest. */
export const BOSS_TELEGRAPH_RESERVE=8,ENEMY_TELEGRAPH_CAP=MAX_TELEGRAPHS-BOSS_TELEGRAPH_RESERVE;
export const SLOW_FACTOR=.5;
/** `knock` is a displacement per tick that decays by this factor; above KNOCK_STUN the enemy does not walk. */
export const KNOCK_DECAY=.6,KNOCK_STUN=.05;
/** Fraction of the overlap with a neighbor resolved per tick, and the cap of that push. */
export const SEPARATION=.5,SEPARATION_MAX=.12;
/** Largest enemy radius a neighbor query must reach (boss). */
const NEIGHBOR_REACH=.9;
const MAX_STEP=.25;
/** An enemy touches a player when their bodies are this close (u): contact hits and the Tio's shove. */
const CONTACT_MARGIN=.05;
/** How far (u) the Tio may stray from his warned line and still be charging (float noise only: any real push ends it). */
const PATH_EPS=1e-6;
const TAU=Math.PI*2;
/** Enemy memory flag of the besiegers (stonewards/wall.ts SIEGE_FLAG; not imported, to keep this module off Stonewards). */
const SIEGE='siege';
/**
 * memory.state values. The Tio's joke/charge also keep, JSON-safe in memory: the locked charge direction (cx, cy, unit),
 * where it starts (ox, oy: where he stands for the joke) and how far it can go (reach, u).
 */
export const STATE={walk:0,joke:1,charge:2,aim:3,burp:4} as const;

/**
 * Telegraph extras (D-002, JSON-safe; the wire only sends the shape fields): `pulses` left after this one lands
 * (molotov fire), `enemyDamage` dealt to enemies inside it when it fires (anão explosion).
 */
export interface HazardTelegraph extends Telegraph {pulses?:number;enemyDamage?:number}
type HazardSpec=TelegraphSpec&{pulses?:number;enemyDamage?:number};
/** Pending telegraphs whose owner starts with `prefix` (or equals it, when `exact`). */
const countOwned=(ctx:SimContext,prefix:string,exact=false)=>{
  let n=0;for(const t of ctx.telegraphs.values())if(exact?t.owner===prefix:t.owner.startsWith(prefix))n++;return n;
};

/** Forgets the Tio's locked charge line (see STATE). */
const dropChargeLine=(memory:Record<string,number>)=>{delete memory.cx;delete memory.cy;delete memory.ox;delete memory.oy;delete memory.reach;};

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
  // City (mask terrain): the body's own disc must clear the walls, unless it already overlapped them at the start
  // (spawned against a wall), in which case it may move like the obstacle rule below lets it leave an overlap.
  const mask=radius>PLAYER_RADIUS?maskSurface(terrain):undefined;
  if(mask&&!mask.clearDisc(probe.x,probe.y,radius)&&mask.clearDisc(a.x,a.y,radius))return false;
  if(radius>PLAYER_RADIUS)for(const o of obstaclesNear(probe,radius,terrain)){
    const after=Math.hypot(probe.x-o.x,probe.y-o.y);
    if(after<o.radius+radius&&after<Math.hypot(a.x-o.x,a.y-o.y))return false;
  }
  return true;
}

const keepsDistance=(def:EnemyDef)=>def.behavior==='ranged'||def.behavior==='thrower';
/** Zig-zag direction (not normalized) toward (ux,uy), from the kind's zigzag (stagger, swarm). */
function zigzag(ctx:SimContext,e:EnemyState,def:EnemyDef,ux:number,uy:number):[number,number]{
  const z=def.zigzag;
  if(!z)return [ux,uy];
  const wave=Math.sin(ctx.tick*z.freq+(e.memory?.seed??0)*TAU)*z.amp;
  return [ux-uy*wave,uy+ux*wave];
}
/** True when (ux,uy) is within `half` radians of the facing kept in memory (fx, fy); no facing yet means not in front. */
function inFront(memory:Record<string,number>,ux:number,uy:number,half:number){
  const fx=memory.fx,fy=memory.fy;
  if(!Number.isFinite(fx)||!Number.isFinite(fy))return false;
  return fx*ux+fy*uy>=Math.cos(half)-1e-9;
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
  private readonly steerOut={x:0,y:0};
  /** Hero walking speed of this world (options.heroSpeed, SPEED when absent or not a positive number). */
  readonly heroSpeed:number;
  /** options.capPush: the walk plus the crowd's push is clamped to the peak too (the city). */
  readonly capPush:boolean;
  constructor(options:EnemyAiOptions={}){
    this.options=options;this.rng=options.rng;this.capPush=options.capPush===true;
    const hero=options.heroSpeed;
    this.heroSpeed=hero!==undefined&&Number.isFinite(hero)&&hero>0?hero:HERO_SPEED;
  }

  step(ctx:SimContext){
    const rng=this.rng??=ctx.rng.fork('enemy-ai');
    const targets=this.targets,active=this.active;
    targets.length=0;active.length=0;
    for(const p of ctx.players.values())if(live(p))targets.push(p);
    const structures=this.options.structures?.(ctx)??[];
    // The intermission is safe: hazards that outlive the round (molotov fire, a death explosion, poop) are dropped.
    if(ctx.round.phase!=='wave')this.clearHazards(ctx);
    // Hazards landing this tick (enemy-ai runs before the telegraph system, which resolves and removes them).
    this.landHazards(ctx);
    this.announceDevendo(ctx,rng);
    // D-004: positions are snapshotted on rebuild; the core rebuilds again after enemy-ai for later systems.
    ctx.enemyIndex.rebuild(ctx.enemies.values());
    for(const e of ctx.enemies.values()){
      // Bosses belong to VGM-038; retreating enemies are walked into the sea by the director (D-010).
      if(e.hp<=0||e.boss)continue;
      // A retreating enemy never comes back for a taunt; drop it so checkpoints stay clean.
      // Its pending burp is cancelled too (D-010: retreaters deal no damage).
      if(e.memory?.retreat===1){delete (e as TauntedEnemy).taunt;cancelTelegraphs(ctx,e.id);continue;}
      const memory=e.memory??={};
      memory.seed??=hashUnit(e.id);memory.state??=STATE.walk;memory.until??=0;memory.hitReady??=0;memory.actReady??=0;
      if(e.knock){
        // The Tio plants his feet for the joke: a knockback then is shrugged off, so his warned line still starts at
        // him (any other displacement still calls the charge off, see chargeWarned).
        if(memory.state===STATE.joke)delete e.knock;
        else{
          moveSafely(e,e.knock.x,e.knock.y,ctx.terrain,e.radius);
          e.knock.x*=KNOCK_DECAY;e.knock.y*=KNOCK_DECAY;
          if(Math.hypot(e.knock.x,e.knock.y)<.01)delete e.knock;
        }
      }
      if(ctx.tick<(e.frozenUntil??-1)||ctx.tick<e.readyTick)continue;
      active.push(e);
      const stunned=!!e.knock&&Math.hypot(e.knock.x,e.knock.y)>KNOCK_STUN;
      // Joking or charging as this tick starts (the charge's last step still runs after endCharge below).
      const planted=memory.state===STATE.joke||memory.state===STATE.charge;
      // Nearest live player, or a structure if its edge is closer; a valid taunt overrides both.
      let player:SimPlayer|undefined,structure:StructureTarget|undefined,best=Infinity;
      const taunter=tauntTarget(ctx,e);
      if(taunter){player=taunter;best=Math.hypot(taunter.x-e.x,taunter.y-e.y);}
      else{
        for(const p of targets){const d=Math.hypot(p.x-e.x,p.y-e.y);if(d<best){best=d;player=p;}}
        if(memory[SIEGE]===1)for(const s of structures){const d=Math.hypot(s.x-e.x,s.y-e.y)-s.radius;if(d<best){best=d;structure=s;player=undefined;}}
      }
      const target:Point|undefined=player??structure;
      // Joke, charge and aim only make sense against a live player; drop them when that player is gone
      // (an interrupted joke takes its charge line with it).
      if(!player&&memory.state!==STATE.walk){
        if(memory.state===STATE.joke||memory.state===STATE.charge){cancelTelegraphs(ctx,e.id);dropChargeLine(memory);}
        memory.state=STATE.walk;
      }
      let dirX=0,dirY=0,pace=1;
      if(target&&!stunned){
        const tx=target.x-e.x,ty=target.y-e.y,d=Math.max(1e-6,Math.hypot(tx,ty));
        // (ax,ay): straight line to the target, for what is aimed (boleto, burp cone, Tio's shove); (ux,uy): walking
        // direction, which the city flow field may bend around corners (it can point away from the target there).
        const ax=tx/d,ay=ty/d;
        let ux=ax,uy=ay;
        if(this.options.steer?.(ctx,e,target,this.steerOut)){ux=this.steerOut.x;uy=this.steerOut.y;}
        const touching=best<=e.radius+PLAYER_RADIUS+CONTACT_MARGIN;
        const def=enemyDef(e.kind);
        switch(structure?'chase':def.behavior){
          case 'stagger':{
            // Burp wind-up: he stands still until the cone fires.
            if(memory.state===STATE.burp){
              if(ctx.tick>=memory.until)memory.state=STATE.walk;
              else break;
            }
            if(player&&ctx.round.index>=BURP.fromRound&&best<=BURP.trigger&&ctx.tick>=memory.actReady&&inFront(memory,ax,ay,BURP.angle/2)
              &&this.hazardRoom(ctx)&&rng.chance(BURP.chance)){
              addTelegraph(ctx,{shape:'cone',x:e.x,y:e.y,dx:ax,dy:ay,radius:BURP.range,width:BURP.angle,damage:BURP.damage,owner:e.id,kind:'arroto'},BURP.delay);
              memory.state=STATE.burp;memory.until=ctx.tick+BURP.delay;memory.actReady=ctx.tick+BURP.cooldown;
              this.react(ctx,rng,e,def,1);
              break;
            }
            [dirX,dirY]=zigzag(ctx,e,def,ux,uy);
            // The wobble is on top of the walk: he still closes at his own speed (like the VGM-031 chaser, so rounds end
            // on time), the sideways sway adds up to √(1+amp²) to the step (1.04 × at amp 0.3, far under a hero; 0.5 made round 1-2 balance tests flaky).
            const length=Math.hypot(dirX,dirY);pace=length;
            // Facing for the next burp check: where he is trying to walk (kept while he stands at contact or on a
            // zero direction, e.g. holding the plaza: dividing by a zero length would store NaN).
            if(length>1e-9){memory.fx=dirX/length;memory.fy=dirY/length;}
            break;
          }
          case 'swarm':{
            [dirX,dirY]=zigzag(ctx,e,def,ux,uy);
            if(player&&best<=POOP.range&&ctx.tick>=memory.actReady&&this.hazardRoom(ctx)
              &&countOwned(ctx,HAZARD_OWNERS.poop)<POOP.maxGlobal&&rng.chance(POOP.chance)){
              addTelegraph(ctx,{shape:'circle',x:e.x,y:e.y,radius:POOP.radius,damage:POOP.damage,owner:HAZARD_OWNERS.poop+e.id,kind:'coco'},POOP.delay);
              memory.actReady=ctx.tick+POOP.cooldown;
              this.react(ctx,rng,e,def,.3);
            }
            break;
          }
          case 'thrower':{
            if(memory.state===STATE.aim&&best>MOLOTOV.fireRange){memory.state=STATE.walk;dirX=ux;dirY=uy;}
            else if(memory.state===STATE.aim){
              if(ctx.tick>=memory.until){
                memory.state=STATE.walk;
                if(player&&this.throwMolotov(ctx,e,player)){memory.actReady=ctx.tick+MOLOTOV.cooldown;this.react(ctx,rng,e,def,.6);}
                else memory.actReady=ctx.tick+MOLOTOV.retry;
              }
            }else if(player&&best<=MOLOTOV.fireRange&&ctx.tick>=memory.actReady){
              memory.state=STATE.aim;memory.until=ctx.tick+MOLOTOV.aim;
            }else if(best>MOLOTOV.maxRange){dirX=ux;dirY=uy;}
            else if(best<MOLOTOV.minRange){dirX=-ux;dirY=-uy;}
            else{const side=memory.seed<.5?.4:-.4;dirX=-uy*side;dirY=ux*side;}
            break;
          }
          case 'joker':{
            if(memory.state===STATE.joke){
              // A charge is never unwarned: no line (budget full, annulled) or knocked off its start → no charge.
              if(ctx.tick>=memory.until){
                if(this.chargeWarned(ctx,e,memory)){memory.state=STATE.charge;memory.until=ctx.tick+TIO_JOKE.charge;}
                else this.endCharge(ctx,memory);
              }
            }else if(memory.state===STATE.charge){
              // Along the locked line, no homing; knocked or slid off it (a wall), the charge is over.
              if(!this.onChargePath(e,memory))this.endCharge(ctx,memory);
              else{
                dirX=memory.cx;dirY=memory.cy;pace=TIO_JOKE.chargeSpeed;
                if(ctx.tick>=memory.until)this.endCharge(ctx,memory);
              }
            }else if(player&&best<=TIO_JOKE.range&&ctx.tick>=memory.actReady&&this.react(ctx,rng,e,def,1)){
              // He only stops when the joke is actually on screen; otherwise he keeps walking and tries next tick.
              memory.state=STATE.joke;memory.until=ctx.tick+TIO_JOKE.pause;
              this.warnCharge(ctx,e,memory,ax,ay);
            }else{dirX=ux;dirY=uy;}
            break;
          }
          case 'ranged':{
            if(memory.state===STATE.aim&&best>AGIOTA_SHOT.fireRange){memory.state=STATE.walk;dirX=ux;dirY=uy;}
            else if(memory.state===STATE.aim){
              if(ctx.tick>=memory.until){
                memory.state=STATE.walk;memory.actReady=ctx.tick+AGIOTA_SHOT.cooldown;
                if(ctx.projectiles.size>=(this.options.projectileCap??PROJECTILE_CAP))break;
                const sx=e.x+ax*e.radius,sy=e.y+ay*e.radius;
                const id=ctx.nextId('p');
                // `marks` (D-002): projectiles.ts marks the player this boleto hurts as devendo.
                ctx.projectiles.set(id,{id,owner:e.id,source:AGIOTA_SHOT.source,x:sx,y:sy,vx:ax*AGIOTA_SHOT.speed,vy:ay*AGIOTA_SHOT.speed,radius:AGIOTA_SHOT.radius,damage:AGIOTA_SHOT.damage,pierce:0,untilTick:ctx.tick+AGIOTA_SHOT.life,hostile:true,hit:[],marks:AGIOTA_SHOT.marks} as ProjectileState);
              }
            }else if(player&&best<=AGIOTA_SHOT.fireRange&&ctx.tick>=memory.actReady){
              memory.state=STATE.aim;memory.until=ctx.tick+AGIOTA_SHOT.aim;
              this.react(ctx,rng,e,def,.7);
            }else if(best>AGIOTA_SHOT.maxRange){dirX=ux;dirY=uy;}
            else if(best<AGIOTA_SHOT.minRange){dirX=-ux;dirY=-uy;}
            else{const side=memory.seed<.5?.4:-.4;dirX=-uy*side;dirY=ux*side;}
            break;
          }
          default:{dirX=ux;dirY=uy;}
        }
        // Melee kinds stop at contact; the agiota and the anão keep backing off (from players). Tio does not hit mid-joke.
        if(touching&&(!keepsDistance(def)||structure)){dirX=0;dirY=0;}
        if(touching&&memory.state!==STATE.joke&&ctx.tick>=memory.hitReady){
          memory.hitReady=ctx.tick+def.contactCooldown;
          if(player){
            ctx.damagePlayer(player.id,e.damage,e.id);
            if(def.behavior==='joker'){
              const charging=memory.state===STATE.charge;
              if(live(player))moveSafely(player,ax*(charging?TIO_JOKE.shove:TIO_JOKE.bump),ay*(charging?TIO_JOKE.shove:TIO_JOKE.bump),ctx.terrain);
              if(charging)this.endCharge(ctx,memory);
            }else if(def.behavior==='stagger')this.react(ctx,rng,e,def,.5);
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
      // The Tio plants his feet for the joke and bulldozes through the crowd in the charge, so he stays on the line he
      // warned; the neighbors still step off him on their own turn.
      if(planted){pushX=0;pushY=0;}
      const dirLength=Math.hypot(dirX,dirY);
      const stepLength=dirLength>1e-6?this.paceSpeed(e,pace)*(ctx.tick<(e.slowUntil??-1)?SLOW_FACTOR:1)/SIM_HZ/dirLength:0;
      // capPush (city): the peak rule holds for the whole move, the walk plus the separation push (a crowd must not
      // shove a body past the hero; knockback, above, is the players' doing and is not capped).
      let moveX=dirX*stepLength+pushX,moveY=dirY*stepLength+pushY;
      if(this.capPush){
        const moved=Math.hypot(moveX,moveY),peak=this.heroSpeed*ACTION_PEAK_MAX/SIM_HZ;
        if(moved>peak){moveX*=peak/moved;moveY*=peak/moved;}
      }
      moveSafely(e,moveX,moveY,ctx.terrain,e.radius);
    }
    if(active.length&&this.canBark(ctx,AMBIENT_GAP_FACTOR)&&rng.chance(this.options.barkChance??BARK_CHANCE)){
      const e=active[rng.int(0,active.length-1)],elite=e.elite&&rng.chance(.5);
      this.bark(ctx,rng,e,elite?ELITE.barks:enemyDef(e.kind).barks,elite?'elite:barks':`${e.kind}:barks`);
    }
  }

  /**
   * Kill hook (the run wires it into world.onKill, assemble.ts): the anão explodes his own belt. A circle telegraph owned
   * by `env:explosion:<id>` (it outlives him) hurts players when it fires, and landHazards deals MOLOTOV.deathEnemyDamage
   * to the enemies inside it then. Skipped when the enemies' telegraph budget is full.
   */
  onKill(ctx:SimContext,enemy:EnemyState){
    if(enemy.boss||enemyDef(enemy.kind).behavior!=='thrower'||!this.hazardRoom(ctx))return;
    addTelegraph(ctx,{shape:'circle',x:enemy.x,y:enemy.y,radius:MOLOTOV.deathRadius,damage:MOLOTOV.deathDamage,
      owner:HAZARD_OWNERS.explosion+enemy.id,enemyDamage:MOLOTOV.deathEnemyDamage,kind:'explosao'} as HazardSpec,MOLOTOV.deathDelay);
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
    const line=this.pickLine(rng,lines,key);
    this.lastBarkTick=ctx.tick;
    ctx.emit({type:'bark',enemy:e.id,line});
    return true;
  }
  /** Picks a line of a non-empty list, never the previous line picked for the same `key`. */
  private pickLine(rng:Rng,lines:readonly string[],key:string){
    let line=rng.pick(lines);
    if(lines.length>1&&line===this.lastLine[key])line=lines[(lines.indexOf(line)+1+rng.int(0,lines.length-2))%lines.length];
    this.lastLine[key]=line;
    return line;
  }
  /** Behavior reaction line; has priority over ambient barks. */
  private react(ctx:SimContext,rng:Rng,e:EnemyState,def:EnemyDef,chance:number){
    return this.canBark(ctx)&&rng.chance(chance)&&this.bark(ctx,rng,e,def.reactionLines,`${def.id}:react`);
  }
  private endCharge(ctx:SimContext,memory:Record<string,number>){
    memory.state=STATE.walk;memory.actReady=ctx.tick+TIO_JOKE.cooldown;dropChargeLine(memory);
  }
  /**
   * Speed (u/s) of a step at `pace` × the enemy's speed, at most ACTION_PEAK_MAX × the hero speed (catalog.ts,
   * Orquestrador rule: walking included). Slows apply on top of this.
   */
  paceSpeed(e:Pick<EnemyState,'speed'>,pace:number){return Math.min(e.speed*pace,this.heroSpeed*ACTION_PEAK_MAX);}
  /**
   * The joke starts: the charge locks on the player's position now (a, unit) and its whole sweep is drawn as an
   * 'investida' line that fires (0 damage, only a warning) when the joke ends. The line covers the band his body
   * crosses: from his back to his front at full reach, his radius plus the contact margin to each side, so a player
   * whose body stays out of it (telegraphHits with the player radius) is never touched by the charge.
   * No room in the telegraph budget: no line, and chargeWarned then skips the charge.
   */
  private warnCharge(ctx:SimContext,e:EnemyState,memory:Record<string,number>,ax:number,ay:number){
    const aimed=Math.hypot(ax,ay)>.5,cx=aimed?ax:1,cy=aimed?ay:0;
    const reach=this.paceSpeed(e,TIO_JOKE.chargeSpeed)*TIO_JOKE.charge/SIM_HZ,body=e.radius+CONTACT_MARGIN;
    memory.cx=cx;memory.cy=cy;memory.ox=e.x;memory.oy=e.y;memory.reach=reach;
    // A line left behind by an earlier joke (the director's recycle resets his state) must not stand in for this one.
    cancelTelegraphs(ctx,e.id);
    if(!this.hazardRoom(ctx))return;
    addTelegraph(ctx,{shape:'line',x:e.x-cx*body,y:e.y-cy*body,dx:cx,dy:cy,radius:reach+2*body,width:2*body,damage:0,owner:e.id,kind:'investida'},TIO_JOKE.pause);
  }
  /** The joke's line is on screen until this very tick (not annulled, not refused) and he still stands where it starts. */
  private chargeWarned(ctx:SimContext,e:EnemyState,memory:Record<string,number>){
    if(!Number.isFinite(memory.ox)||!Number.isFinite(memory.oy)||Math.hypot(e.x-memory.ox,e.y-memory.oy)>PATH_EPS)return false;
    for(const t of ctx.telegraphs.values())if(t.owner===e.id&&t.kind==='investida'&&t.fireTick===ctx.tick)return true;
    return false;
  }
  /** He is on the warned line: on its axis, between where he stood and his full reach. */
  private onChargePath(e:EnemyState,memory:Record<string,number>){
    const {cx,cy,ox,oy,reach}=memory;
    if(![cx,cy,ox,oy,reach].every(Number.isFinite))return false;
    const along=(e.x-ox)*cx+(e.y-oy)*cy,off=Math.abs((e.x-ox)*cy-(e.y-oy)*cx);
    return off<=PATH_EPS&&along>=-PATH_EPS&&along<=reach+PATH_EPS;
  }

  /** Room for one more enemy hazard telegraph (budget.ts MAX_TELEGRAPHS minus the boss reserve). */
  private hazardRoom(ctx:SimContext){return ctx.telegraphs.size<(this.options.telegraphCap??ENEMY_TELEGRAPH_CAP);}

  /**
   * Lobs a molotov at `player`'s current position: the landing telegraph carries the fire pulses still to come.
   * Refused (false) when this anão already has MOLOTOV.maxActive chains burning, MOLOTOV.maxGlobal chains burn in all,
   * or the telegraph budget is full.
   */
  private throwMolotov(ctx:SimContext,e:EnemyState,player:SimPlayer){
    const owner=HAZARD_OWNERS.molotov+e.id;
    if(!this.hazardRoom(ctx)||countOwned(ctx,owner,true)>=MOLOTOV.maxActive||countOwned(ctx,HAZARD_OWNERS.molotov)>=MOLOTOV.maxGlobal)return false;
    addTelegraph(ctx,{shape:'circle',x:player.x,y:player.y,radius:MOLOTOV.radius,damage:MOLOTOV.damage,owner,pulses:MOLOTOV.pulses,kind:'molotov'} as HazardSpec,MOLOTOV.flight);
    return true;
  }

  /** Removes the pending enemy hazards this AI created (env-owned: molotov, fire pulses, explosions, poop). */
  private clearHazards(ctx:SimContext){
    const prefixes=Object.values(HAZARD_OWNERS);
    for(const t of [...ctx.telegraphs.values()])if(prefixes.some(p=>t.owner.startsWith(p)))ctx.telegraphs.delete(t.id);
  }

  /**
   * Hazard telegraphs due this tick (the telegraph system resolves their player damage right after enemy-ai):
   * a molotov landing or pulse schedules the next, smaller pulse at the same spot (the fire goes out early when the
   * budget is full); an explosion hurts the enemies inside it once, through ctx.damageEnemy (no player credit), which
   * ignores the dead, so a kill never counts twice; a neighbor anão it kills explodes in turn on a later tick.
   */
  private landHazards(ctx:SimContext){
    const due:HazardTelegraph[]=[];
    for(const t of ctx.telegraphs.values())if(t.fireTick<=ctx.tick&&t.owner.startsWith('env:'))due.push(t);
    for(const t of due){
      if((t.pulses??0)>0&&t.owner.startsWith(HAZARD_OWNERS.molotov)&&ctx.telegraphs.size<=(this.options.telegraphCap??ENEMY_TELEGRAPH_CAP)){
        addTelegraph(ctx,{shape:'circle',x:t.x,y:t.y,radius:MOLOTOV.pulseRadius,damage:MOLOTOV.pulseDamage,owner:t.owner,pulses:t.pulses!-1,kind:'fogo'} as HazardSpec,MOLOTOV.pulseEvery);
      }
      if((t.enemyDamage??0)>0){
        const victims:string[]=[];
        for(const e of ctx.enemies.values())if(e.hp>0&&!e.boss&&telegraphHits(t,e,e.radius))victims.push(e.id);
        for(const id of victims)ctx.damageEnemy(id,t.enemyDamage!,undefined,'env:explosion');
      }
    }
  }

  /**
   * D-013 `say` for a fresh devendo mark (projectiles.ts sets devendoSay): one line per mark, through the same global
   * limiter as the barks with reaction priority; it waits while the limiter is busy and is dropped if the mark expires.
   */
  private announceDevendo(ctx:SimContext,rng:Rng){
    for(const p of ctx.players.values()){
      const marked=p as SimPlayer&DevendoPlayer;
      if(marked.devendoSay!==1)continue;
      if(!isDevendo(marked,ctx.tick)){delete marked.devendoSay;continue;}
      if(!this.canBark(ctx))return;
      const line=this.pickLine(rng,DEVENDO_LINES,DEVENDO.key);
      this.lastBarkTick=ctx.tick;
      ctx.emit({type:'say',source:p.id,key:DEVENDO.key,line});
      delete marked.devendoSay;
    }
  }
}

export const createEnemyAi=(options:EnemyAiOptions={})=>new EnemyAi(options);
