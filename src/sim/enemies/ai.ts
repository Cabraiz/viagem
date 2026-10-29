/**
 * enemy-ai system (VGM-031, cast of D-033): bêbado drunk chase + burp cone, pombos swarm zig-zag + poop, Tio do Pavê
 * joke + charge, agiota ranged boletos (the "devendo" mark), anão molotov throws with pulsing ground fire and a death
 * explosion; the P1 trio: coach lecture + ally buff (PALESTRA), motoboy warned charge + marmita blast (MOTOBOY),
 * influencer pose (POSE; the reflection itself is in projectiles.ts); the roster roles of D-040: the brutamontes' shove
 * (BRUTE) and stomp (BRUTE_SLAM), the invocador's call (SUMMON) and the mini-chefe's stomp (SLAM), every other role on the behavior of its base
 * kind; neighbor separation, terrain collision, contact damage and rare barks. EnemyState.phase of regular enemies (on
 * the wire, EnemyView.phase): 1 while the P1 trio acts (lecturing, aiming/charging, posing) and while an invocador
 * calls or a brutamontes or mini-chefe stomps, 2 while coached and not acting, absent otherwise. A roster entry acting like one of the
 * nine says its own (or its role's) reaction lines where the nine have their behavior's lists.
 * Every hazard is a telegraph (telegraphs.ts, ≥ MIN_TELEGRAPH_TICKS of warning) inside the enemies' telegraph budget.
 * Every step (walk, zig-zag, back-off, the Tio's charge; in the city the crowd's separation push too) is capped at
 * ACTION_PEAK_MAX × the world's hero speed, and the charge is warned by an 'investida' line and runs it without homing, so a hero can always step out of it.
 * Deterministic: own rng stream forked once from ctx.rng, no Date/Math.random, iteration in ctx.enemies order.
 */
import {RADIUS as PLAYER_RADIUS,SPEED as HERO_SPEED,enemyTerrain,floorOf,floorPortal,maskSurface,obstaclesNear,onFloor,settleFloor,walkable,type CityViaduct,type Floor,type Point} from '../../maps/index.ts';
import type {TerrainField} from '../../maps/index.ts';
import {Rng} from '../../contract/index.ts';
import {SIM_HZ,ticks,type EnemyState,type ProjectileState,type SimPlayer} from '../../contract/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {ACTION_PEAK_MAX,AGIOTA_SHOT,BRUTE,BRUTE_SLAM,BUFFED_LINES,BURP,DEVENDO,DEVENDO_LINES,ELITE,GENERIC_SHOT_SOURCE,HAZARD_OWNERS,MARMITA_BOOM_LINES,MOLOTOV,MOTOBOY,MOTOBOY_HONK_LINES,
  PALESTRA,PALESTRA_LINES,POOP,POSE,POSE_LINES,POSE_STATE,REFLECT_LINES,SLAM,SLAM_STATE,SUGAR,SUMMON,SUMMON_STATE,TIO_JOKE,bandCooldown,coachMult,createEnemy,enemyDef,hashUnit,
  hazardOwner,isCoached,isDevendo,isSugared,ENEMY_RADIUS_SCALE,type CoachedEnemy,type DevendoPlayer,type EnemyDef} from './catalog.ts';
import {addTelegraph,cancelTelegraphs,telegraphHits,type TelegraphSpec} from '../telegraphs.ts';
import {MAX_ENEMIES,MAX_TELEGRAPHS} from '../../rules/index.ts';
import type {Telegraph} from '../../contract/index.ts';
import type {TauntedEnemy} from '../skills.ts';
import {AGGRO,AGGRO_PER_PLAYER,AGGRO_SECONDS,FOCO,FOCO_CACADOR,FOCO_UNO,type ProvokedEnemy} from './foco.ts';

/**
 * Optional non-player target (wall/shelter, VGM-046). Only siege enemies (memory.siege === 1, set by the director)
 * consider it, and go for whichever is closer: a player or the structure's edge (NEW-20261006-E8-wall-siege-single-path).
 * Everyone else ignores structures. Against a structure every kind walks up and hits it (the agiota and the anão too: a boleto does
 * not hurt a wall, a molotov is not thrown at it), except the coach, who has no melee: a siege coach keeps his support logic
 * against the wall (PALESTRA.minRange..maxRange from its edge, lecturing the besiegers around him).
 */
export interface StructureTarget extends Point {
  id:string;radius:number;
  /**
   * A city barricade (cidade-06): not a siege target, but any body (siege or not, never a retreating one nor the boss)
   * in contact with it hits it on its contact cooldown, through hitStructure (D-017): the steer leads bodies the
   * barricades cut off the plaza to the mouth they must break.
   */
  blocking?:boolean;
  /**
   * D-047 (the chaveiro's moto): a siege body considers this target only while its edge is within `reach` (u) and
   * closer than every player; absent: any distance, as before.
   */
  reach?:number;
  /**
   * Card uno-bloqueio-corpo (the car): how far `p` is from the body's edge (u), for a body that is not a disc; absent:
   * the distance to the centre less `radius`.
   */
  gap?:(p:Point)=>number;
}
/** How far `p` is from structure `s`'s edge (its own gap, else its disc). */
const structureGap=(s:StructureTarget,p:Point)=>s.gap?s.gap(p):Math.hypot(s.x-p.x,s.y-p.y)-s.radius;
export interface EnemyAiOptions {
  /** Defaults to ctx.rng.fork('enemy-ai') on the first step. */
  rng?:Rng;
  structures?:(ctx:SimContext)=>readonly StructureTarget[];
  hitStructure?:(ctx:SimContext,structureId:string,amount:number,enemy:EnemyState)=>void;
  /**
   * NEW-20261021-ORQ-barricada-construir: whether a body pressed against blocking structure `id` bashes it (absent:
   * always). The built barricadas are bashed only by a body with no way to its target (assemble: free-build reachMap).
   */
  bashes?:(e:EnemyState,id:string)=>boolean;
  /** D-052: the ground's speed multiplier under a body (a free barricade slows; 1 or absent: none). */
  drag?:(e:EnemyState)=>number;
  /** Minimum ticks between two barks on screen (global). */
  barkGap?:number;
  /** Chance per tick of an ambient bark once its (longer) gap has passed. */
  barkChance?:number;
  /** Hostile projectiles are not created at or above this count (D-003; budget.ts MAX_PROJECTILES). */
  projectileCap?:number;
  /**
   * City flow field: returns true after writing the walking direction into out (unit vector); best/touching stay Euclidean.
   * out.fit > 0 (BUG-20261013-E1): the steer led the body along a field narrower than it (its own size does not reach);
   * this tick's walk then collides with the walls by that radius, so it squeezes through instead of standing at the gap.
   */
  steer?:(ctx:SimContext,e:EnemyState,target:Point,out:Point&{fit?:number})=>boolean;
  /** Enemy hazards (burp, molotov, fire, poop, explosion, the Tio's charge line) are not created at or above this many telegraphs. */
  telegraphCap?:number;
  /**
   * BASE walking speed (u/s) of the heroes in this world (maps baseHeroSpeed, not the 2× walk); no enemy step goes past ACTION_PEAK_MAX × it. Defaults to SPEED (maps/world.ts, 3.1: the endless world); the city passes its own hero's.
   */
  heroSpeed?:number;
  /**
   * Invocador (SUMMON): the kinds his minions are drawn from (the run's rotation: the round's corredores and enxames).
   * Default MINION_KINDS.
   */
  minionKinds?:(ctx:SimContext)=>readonly string[];
  /**
   * Invocador: creates one minion of `kind` at `at` and returns it (the director tracks it, scales it to the round and
   * converts its speed in the city); undefined when refused. Default: createEnemy at SUMMON.hp within MAX_ENEMIES.
   */
  summon?:(ctx:SimContext,kind:string,at:Point)=>EnemyState|undefined;
  /**
   * Also clamp the whole move (the capped walk plus the neighbours' separation push, up to SEPARATION_MAX a tick) to the
   * same peak, so a dense crowd never shoves a body past it (the city, where the peak is 2.29 u/s). Off by default: in
   * the endless/island worlds a crowd's push past 1.15 × 3.1 is part of the tuned pacing (the round-end and novice
   * balance and the boss digest change with it).
   */
  capPush?:boolean;
  /**
   * D-051 (ninhos/sono.ts Sono.goal): a body with a goal walks to that point at `pace` × its speed, along the steer,
   * instead of hunting (the alerta walking to a noise, the perdeu going home); it hits nobody on the way. A taunt still
   * wins. Absent, or undefined for a body: the hunt as always.
   */
  goal?:(ctx:SimContext,e:EnemyState)=>(Point&{pace:number})|undefined;
  /**
   * The minuto de Minerva (ninhos.ts MINERVA_S): while true for a body it stands still (no walk, no push, no charge
   * run), but its attacks go on against whoever is in its reach.
   */
  hold?:(ctx:SimContext,e:EnemyState)=>boolean;
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
/**
 * Mode 'ninhos' (ctx.sleepers; card ninhos-perto-ataca-20x, the user: no critter inside another, always a gap): the
 * spacing kept between two bodies on top of their radii, and the awake ones also step off the sleepers and the
 * standing players. The other worlds keep the tuned crowd as it was.
 */
export const SPACING_GAP=.15;
/**
 * The push off the sleepers, a tick, at most (u): under the slowest walk (1.21 u/s ≈ .06 a tick), so a body walking
 * always gets through a nest's ring of sleepers (card bichos-travados: at SEPARATION_MAX the ring held the nests' groups
 * at its edge for good) and only one standing still slides off them.
 */
export const SLEEPER_PUSH_MAX=.03;
/** Largest enemy radius a neighbor query must reach (the boss: 0.9 × ENEMY_RADIUS_SCALE, balanco-pos-1-7). */
const NEIGHBOR_REACH=.9*ENEMY_RADIUS_SCALE;
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
export const STATE={walk:0,joke:1,charge:2,aim:3,burp:4,lecture:5,pose:POSE_STATE,summon:SUMMON_STATE,slam:SLAM_STATE} as const;
/** Invocador minions when no rotation names them (EnemyAiOptions.minionKinds). */
export const MINION_KINDS:readonly string[]=Object.freeze(['bebado','pombos']);
/** memory flag of a summoned minion (SUMMON.maxGlobal counts them). */
export const MINION_FLAG='minion';
/**
 * Lines a roster entry says where one of the nine says its behavior's own list (the coach's lecture, the motoboy's honk,
 * the influencer's pose and reflection): the nine keep theirs and their keys, everyone else its reaction lines.
 */
const actLines=(e:EnemyState,def:EnemyDef,legacy:string,lines:readonly string[],what:string):[readonly string[],string]=>
  e.kind===legacy?[lines,`${legacy}:${what}`]:[def.reactionLines,`${e.kind}:${what}`];
/** EnemyView.phase values of regular enemies (the boss uses its own, boss.ts). */
export const ENEMY_PHASE={acting:1,coached:2} as const;
/**
 * A warned locked charge: the wind-up (`pause`, STATE.joke: the Tio's joke, the motoboy's honk and aim) draws the
 * 'investida' line, then STATE.charge runs it for `charge` ticks at `chargeSpeed` × his speed (capped).
 */
interface ChargeSpec {pause:number;charge:number;chargeSpeed:number}
const TIO_CHARGE:ChargeSpec={pause:TIO_JOKE.pause,charge:TIO_JOKE.charge,chargeSpeed:TIO_JOKE.chargeSpeed};
const MOTOBOY_CHARGE:ChargeSpec={pause:MOTOBOY.aim,charge:MOTOBOY.charge,chargeSpeed:MOTOBOY.chargeSpeed};

/**
 * Telegraph extras (D-002, JSON-safe; the wire only sends the shape fields): `pulses` left after this one lands
 * (molotov fire), `mult` the thrower's coach multiplier at the throw (PALESTRA.damageMult; absent = 1), which every
 * fire pulse of the chain keeps, `enemyDamage` dealt to enemies inside it when it fires (anão explosion).
 */
export interface HazardTelegraph extends Telegraph {pulses?:number;mult?:number;enemyDamage?:number}
type HazardSpec=TelegraphSpec&{pulses?:number;mult?:number;enemyDamage?:number};
/** Pending telegraphs whose owner starts with `prefix` (or equals it, when `exact`). */
const countOwned=(ctx:SimContext,prefix:string,exact=false)=>{
  let n=0;for(const t of ctx.telegraphs.values())if(exact?t.owner===prefix:t.owner.startsWith(prefix))n++;return n;
};

/**
 * Bancos (sim/bancos/system.ts): the ATM's beep lures a critter to (x, y) until `untilTick` (enemy memory baitX, baitY,
 * baitUntil: JSON-safe). While it lasts the critter goes for the nearer of the bait and its nearest live player, and the
 * structures (the wall, the car, the moto) wait; a taunt still wins. Nothing else reads these keys.
 */
export function baitEnemy(e:EnemyState,x:number,y:number,untilTick:number){
  const memory=e.memory??={};
  memory.baitX=x;memory.baitY=y;memory.baitUntil=Math.max(memory.baitUntil??-Infinity,untilTick);
}
/** The bait point of a lured critter while it lasts; an expired one is forgotten. */
function baitOf(memory:Record<string,number>,tick:number):Point|undefined{
  if(memory.baitUntil===undefined)return undefined;
  if(tick<memory.baitUntil&&Number.isFinite(memory.baitX)&&Number.isFinite(memory.baitY))return {x:memory.baitX,y:memory.baitY};
  delete memory.baitX;delete memory.baitY;delete memory.baitUntil;
  return undefined;
}
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
 * so once on land it never leaves it. In the city the barricades are solid (enemyTerrain: blockers stop enemies only).
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
  // City: the whole step lies where the walls (and blockers) leave the larger of the two discs clear for sure
  // (CityTerrain.clearReach), so every check below would pass; the same answer without reading the samples.
  const reach=(terrain as {clearReach?:(x:number,y:number,r:number)=>number}).clearReach;
  if(reach&&Math.hypot(dx,dy)<reach.call(terrain,a.x,a.y,Math.max(radius,PLAYER_RADIUS))-1e-6)return true;
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

/**
 * The viaducts (maps city/viaduct.ts) of the run's city and its cell size, or undefined off the city or without any.
 * A body chasing a hero on the other floor heads for the nearest viaduct's portal (its ramp: up past the switch line,
 * or down at its foot) and only hunts that hero from there, on the same floor.
 */
function decksOf(terrain:TerrainField):{viaducts:readonly CityViaduct[];unitsPerCell:number}|undefined{
  const a=(terrain as {asset?:{viaducts?:readonly CityViaduct[];unitsPerCell:number}}).asset;
  return a?.viaducts?.length?{viaducts:a.viaducts,unitsPerCell:a.unitsPerCell}:undefined;
}
/** The portal from `from` to floor `to` that makes the shortest straight detour to `p`, and that length (u). */
function crossing(decks:{viaducts:readonly CityViaduct[];unitsPerCell:number},from:Point,p:Point,to:Floor):{x:number;y:number;length:number}{
  let best={x:p.x,y:p.y,length:Infinity};
  for(const v of decks.viaducts){
    const q=floorPortal(v,decks.unitsPerCell,to),length=Math.hypot(q.x-from.x,q.y-from.y)+Math.hypot(p.x-q.x,p.y-q.y);
    if(length<best.length)best={x:q.x,y:q.y,length};
  }
  return best;
}
const keepsDistance=(def:EnemyDef)=>def.behavior==='ranged'||def.behavior==='thrower'||def.behavior==='coach'||def.behavior==='summoner';
/** No melee against players: the coach and the invocador (a siege invocador still hits the wall). */
const noMelee=(def:EnemyDef)=>def.behavior==='coach'||def.behavior==='summoner';
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
  private readonly steerOut={x:0,y:0,fit:0};
  private readonly detonate:EnemyState[]=[];
  /** BASE hero walking speed of this world (options.heroSpeed, SPEED when absent or not a positive number). */
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
    const detonate=this.detonate;detonate.length=0;
    // Foco (foco.ts): FOCO_UNO bodies turned on a player right now, against the cap for this tick.
    let aggro=0;
    for(const e of ctx.enemies.values())if(e.memory?.[AGGRO]===1&&(e as TauntedEnemy).taunt)aggro++;
    const aggroCap=AGGRO_PER_PLAYER*targets.length,openStructure=structures.some(s=>!s.blocking);
    for(const e of ctx.enemies.values()){
      // Bosses belong to VGM-038; retreating enemies are walked into the sea by the director (D-010).
      if(e.hp<=0||e.boss)continue;
      // A retreating enemy never comes back for a taunt; drop it so checkpoints stay clean.
      // Its pending burp is cancelled too (D-010: retreaters deal no damage), and so is the influencer's pose (a
      // retreater reflects nothing, catalog.ts isReflecting).
      if(e.memory?.retreat===1){
        delete (e as TauntedEnemy).taunt;cancelTelegraphs(ctx,e.id);
        if(e.memory.state===STATE.pose){e.memory.state=STATE.walk;delete e.memory.reflectSay;}
        continue;
      }
      const memory=e.memory??={};
      memory.seed??=hashUnit(e.id);memory.state??=STATE.walk;memory.until??=0;memory.hitReady??=0;memory.actReady??=0;
      if(e.knock){
        // The Tio plants his feet for the joke: a knockback then is shrugged off, so his warned line still starts at
        // him (any other displacement still calls the charge off, see chargeWarned).
        if(memory.state===STATE.joke)delete e.knock;
        else{
          moveSafely(e,e.knock.x,e.knock.y,onFloor(enemyTerrain(ctx.terrain),e.andar),e.radius);
          settleFloor(ctx.terrain,e);
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
      let player:SimPlayer|undefined,structure:StructureTarget|undefined,bait:Point|undefined,best=Infinity;
      const foco=memory[FOCO];
      if(foco===FOCO_UNO&&this.answerHit(ctx,e,memory,aggro<aggroCap))aggro++;
      const taunter=tauntTarget(ctx,e);
      if(!taunter&&memory[AGGRO]===1)delete memory[AGGRO];
      // FOCO_UNO walks past the players to the car; FOCO_CACADOR leaves the car alone while a player stands.
      const huntPlayers=!(foco===FOCO_UNO&&openStructure),huntStructures=!(foco===FOCO_CACADOR&&targets.length>0);
      let goal=taunter?undefined:this.options.goal?.(ctx,e);
      // The viaduct: a hero on the other floor is as far as the walk through the ramp (crossing); bait and structures
      // are on the ground (a deck body walks down to a structure, never to a bait).
      const floor=floorOf(e),decks=decksOf(ctx.terrain);
      const reach=(p:SimPlayer)=>decks&&floorOf(p)!==floor?crossing(decks,e,p,floorOf(p)).length:Math.hypot(p.x-e.x,p.y-e.y);
      if(taunter){player=taunter;best=reach(taunter);}
      else if(!goal){
        if(huntPlayers)for(const p of targets){const d=reach(p);if(d<best){best=d;player=p;}}
        // Bancos: a lured critter goes for the bait unless a player is nearer; the structures wait meanwhile.
        bait=floor===0?baitOf(memory,ctx.tick):undefined;
        if(bait){const d=Math.hypot(bait.x-e.x,bait.y-e.y);if(d<best){best=d;player=undefined;}else bait=undefined;}
        // A siege body on a deck (ritmo-morto-e-viaduto: it slept there, a recruit woke it) weighs a structure by the
        // walk down the ramp to it (its reach too), like a hero on the other floor.
        else if(memory[SIEGE]===1&&huntStructures)for(const s of structures){
          if(s.blocking)continue;
          const d=floor===0||!decks?structureGap(s,e):crossing(decks,e,s,0).length;
          if(d<best&&!(s.reach!==undefined&&d>s.reach)){best=d;structure=s;player=undefined;}
        }
      }
      // Its hero (or its structure, on the ground) is on the other floor: it walks to the ramp (a goal, hitting nobody
      // on the way) and hunts from there.
      if(player&&decks&&floorOf(player)!==floor){
        const q=crossing(decks,e,player,floorOf(player));
        goal={x:q.x,y:q.y,pace:1};player=undefined;best=Infinity;
      }else if(structure&&decks&&floor!==0){
        const q=crossing(decks,e,structure,0);
        goal={x:q.x,y:q.y,pace:1};structure=undefined;best=Infinity;
      }
      const target:Point|undefined=player??structure??bait??goal;
      // Joke, charge and aim only make sense against a live player; drop them when that player is gone
      // (an interrupted joke takes its charge line with it). A siege coach's lecture at a wall goes on.
      if(!player&&memory.state!==STATE.walk&&!(structure&&memory.state===STATE.lecture)){
        if(memory.state===STATE.joke||memory.state===STATE.charge){cancelTelegraphs(ctx,e.id);dropChargeLine(memory);}
        memory.state=STATE.walk;
      }
      let dirX=0,dirY=0,pace=1,fit=e.radius;
      // Motoboy: his charge is over this tick (full length, a player, off the line); a blocked step is found after the move.
      let boom=false;
      if(target&&!stunned){
        const tx=target.x-e.x,ty=target.y-e.y,d=Math.max(1e-6,Math.hypot(tx,ty));
        // (ax,ay): straight line to the target, for what is aimed (boleto, burp cone, Tio's shove); (ux,uy): walking
        // direction, which the city flow field may bend around corners (it can point away from the target there).
        const ax=tx/d,ay=ty/d;
        let ux=ax,uy=ay;
        this.steerOut.fit=0;
        // On a deck (a straight corridor with one ramp) there is no flow field: the straight line, sliding on its edges.
        if(floor===0&&this.options.steer?.(ctx,e,target,this.steerOut)){
          ux=this.steerOut.x;uy=this.steerOut.y;
          const f=this.steerOut.fit;if(f>0&&f<fit)fit=f;
        }
        const touching=best<=e.radius+PLAYER_RADIUS+CONTACT_MARGIN;
        const def=enemyDef(e.kind);
        // Against a structure every kind walks up and hits it; the coach (no melee) lectures the besiegers instead.
        switch(goal?'goal':structure&&def.behavior!=='coach'?'chase':def.behavior){
          case 'goal':{dirX=ux;dirY=uy;pace=goal!.pace;break;}
          case 'stagger':{
            // Burp wind-up: he stands still until the cone fires.
            if(memory.state===STATE.burp){
              if(ctx.tick>=memory.until)memory.state=STATE.walk;
              else break;
            }
            if(player&&ctx.round.index>=BURP.fromRound&&best<=BURP.trigger&&ctx.tick>=memory.actReady&&inFront(memory,ax,ay,BURP.angle/2)
              &&this.hazardRoom(ctx)&&rng.chance(BURP.chance)){
              addTelegraph(ctx,{shape:'cone',x:e.x,y:e.y,dx:ax,dy:ay,radius:BURP.range,width:BURP.angle,damage:BURP.damage*coachMult(e,ctx.tick),owner:e.id,kind:'arroto'},BURP.delay);
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
            if(player&&ctx.round.index>=POOP.fromRound&&best<=POOP.range&&ctx.tick>=memory.actReady&&this.hazardRoom(ctx)
              &&countOwned(ctx,HAZARD_OWNERS.poop)<POOP.maxGlobal&&rng.chance(POOP.chance)){
              addTelegraph(ctx,{shape:'circle',x:e.x,y:e.y,radius:POOP.radius,damage:POOP.damage*coachMult(e,ctx.tick),owner:hazardOwner(HAZARD_OWNERS.poop,e),kind:'coco'},POOP.delay);
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
                if(player&&this.throwMolotov(ctx,e,player)){memory.actReady=ctx.tick+bandCooldown(e,MOLOTOV.cooldown);this.react(ctx,rng,e,def,.6);}
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
                if(this.chargeWarned(ctx,e,memory)){memory.state=STATE.charge;memory.until=ctx.tick+TIO_CHARGE.charge;}
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
              this.warnCharge(ctx,e,memory,ax,ay,TIO_CHARGE);
            }else{dirX=ux;dirY=uy;}
            break;
          }
          case 'kamikaze':{
            if(memory.state===STATE.joke){
              // Honk and aim: he stands on the warned line; no line on screen at its end (annulled, displaced) → no charge.
              if(ctx.tick>=memory.until){
                if(this.chargeWarned(ctx,e,memory)){memory.state=STATE.charge;memory.until=ctx.tick+MOTOBOY_CHARGE.charge;}
                else{memory.state=STATE.walk;memory.actReady=ctx.tick+MOTOBOY.retry;dropChargeLine(memory);}
              }
            }else if(memory.state===STATE.charge){
              // Straight along the locked line at the cap; off it (knocked, slid on a wall) he crashes where he is.
              if(!this.onChargePath(e,memory))boom=true;
              else{
                dirX=memory.cx;dirY=memory.cy;pace=MOTOBOY_CHARGE.chargeSpeed;
                if(ctx.tick>=memory.until)boom=true;
              }
            }else if(player&&ctx.round.phase==='wave'&&best<=MOTOBOY.trigger&&ctx.tick>=memory.actReady&&this.hazardRoom(ctx)){
              memory.state=STATE.joke;memory.until=ctx.tick+MOTOBOY_CHARGE.pause;
              this.warnCharge(ctx,e,memory,ax,ay,MOTOBOY_CHARGE);
              this.bark(ctx,rng,e,...actLines(e,def,'motoboy',MOTOBOY_HONK_LINES,'honk'));
            }else{dirX=ux;dirY=uy;}
            break;
          }
          case 'coach':{
            if(memory.state===STATE.lecture){
              // He stands still for the lecture; the buff lands when it ends (killed mid-lecture: nothing).
              if(ctx.tick>=memory.until){memory.state=STATE.walk;memory.actReady=ctx.tick+PALESTRA.cooldown;this.palestra(ctx,e,memory);}
              break;
            }
            if((memory.cheer??-1)>ctx.tick&&this.canBark(ctx)){
              let ally:EnemyState|undefined;
              for(const o of ctx.enemies.values())if(o.hp>0&&!o.boss&&enemyDef(o.kind).behavior!=='coach'&&isCoached(o,ctx.tick)){ally=o;break;}
              if(ally)this.bark(ctx,rng,ally,BUFFED_LINES,'coach:buffed');
              delete memory.cheer;
            }
            // A player (or, for a siege coach, the wall he besieges) in reach: he lectures the allies around him.
            if(best<=PALESTRA.trigger&&ctx.tick>=memory.actReady){
              memory.state=STATE.lecture;memory.until=ctx.tick+PALESTRA.lecture;
              this.bark(ctx,rng,e,...actLines(e,def,'coach',PALESTRA_LINES,'palestra'));
            }else if(best>PALESTRA.maxRange){dirX=ux;dirY=uy;}
            else if(best<PALESTRA.minRange){dirX=-ux;dirY=-uy;}
            else{const side=memory.seed<.5?.4:-.4;dirX=-uy*side;dirY=ux*side;}
            break;
          }
          case 'poser':{
            // A reflection (projectiles.ts) asks for one line; it waits for the limiter while the pose lasts.
            if(memory.reflectSay===1&&this.canBark(ctx)){this.bark(ctx,rng,e,...actLines(e,def,'influencer',REFLECT_LINES,'reflect'));delete memory.reflectSay;}
            if(memory.state===STATE.pose){
              if(ctx.tick>=memory.until){memory.state=STATE.walk;memory.actReady=ctx.tick+POSE.cooldown;delete memory.reflectSay;}
            }else if(player&&best<=POSE.trigger&&ctx.tick>=memory.actReady){
              memory.state=STATE.pose;memory.until=ctx.tick+POSE.duration;
              this.bark(ctx,rng,e,...actLines(e,def,'influencer',POSE_LINES,'pose'));
            }else{dirX=ux;dirY=uy;}
            break;
          }
          case 'ranged':{
            if(memory.state===STATE.aim&&best>AGIOTA_SHOT.fireRange){memory.state=STATE.walk;dirX=ux;dirY=uy;}
            else if(memory.state===STATE.aim){
              if(ctx.tick>=memory.until){
                memory.state=STATE.walk;memory.actReady=ctx.tick+bandCooldown(e,AGIOTA_SHOT.cooldown);
                if(ctx.projectiles.size>=(this.options.projectileCap??PROJECTILE_CAP))break;
                const sx=e.x+ax*e.radius,sy=e.y+ay*e.radius;
                const id=ctx.nextId('p');
                // `marks` (D-002): projectiles.ts marks the player this boleto hurts as devendo. Only the agiota's boleto
                // marks (EnemyDef.marks); the other atiradores fire the generic shot.
                ctx.projectiles.set(id,{id,owner:e.id,source:def.shotSource??GENERIC_SHOT_SOURCE,x:sx,y:sy,vx:ax*AGIOTA_SHOT.speed,vy:ay*AGIOTA_SHOT.speed,radius:AGIOTA_SHOT.radius,damage:AGIOTA_SHOT.damage*coachMult(e,ctx.tick),pierce:0,untilTick:ctx.tick+AGIOTA_SHOT.life,hostile:true,hit:[],...(def.marks?{marks:def.marks}:{}),...(e.andar===1?{andar:1}:{})} as ProjectileState);
              }
            }else if(player&&best<=AGIOTA_SHOT.fireRange&&ctx.tick>=memory.actReady){
              memory.state=STATE.aim;memory.until=ctx.tick+AGIOTA_SHOT.aim;
              this.react(ctx,rng,e,def,.7);
            }else if(best>AGIOTA_SHOT.maxRange){dirX=ux;dirY=uy;}
            else if(best<AGIOTA_SHOT.minRange){dirX=-ux;dirY=-uy;}
            else{const side=memory.seed<.5?.4:-.4;dirX=-uy*side;dirY=ux*side;}
            break;
          }
          case 'summoner':{
            // The call: he stands still while the warned minions are on their way; they arrive when it ends.
            if(memory.state===STATE.summon){
              if(ctx.tick>=memory.until){memory.state=STATE.walk;memory.actReady=ctx.tick+SUMMON.cooldown;this.arriveMinions(ctx,rng,e,memory);}
              break;
            }
            if(player&&ctx.round.phase==='wave'&&best<=SUMMON.trigger&&ctx.tick>=memory.actReady){
              if(this.callMinions(ctx,rng,e,memory)){this.react(ctx,rng,e,def,1);break;}
              memory.actReady=ctx.tick+SUMMON.retry;
            }
            if(best>SUMMON.maxRange){dirX=ux;dirY=uy;}
            else if(best<SUMMON.minRange){dirX=-ux;dirY=-uy;}
            else{const side=memory.seed<.5?.4:-.4;dirX=-uy*side;dirY=ux*side;}
            break;
          }
          case 'brute':
          case 'minichefe':{
            // The stomp: warned circle around him; he stands still until it lands (plus a short recovery).
            const slam=def.behavior==='brute'?BRUTE_SLAM:SLAM;
            if(memory.state===STATE.slam){
              if(ctx.tick>=memory.until){memory.state=STATE.walk;memory.actReady=ctx.tick+slam.cooldown;}
              break;
            }
            if(player&&best<=slam.trigger&&ctx.tick>=memory.actReady&&this.hazardRoom(ctx)){
              addTelegraph(ctx,{shape:'circle',x:e.x,y:e.y,radius:slam.radius+e.radius,damage:slam.damage*coachMult(e,ctx.tick),owner:e.id,kind:'pancada'},slam.delay);
              memory.state=STATE.slam;memory.until=ctx.tick+slam.delay+slam.recover;
              this.react(ctx,rng,e,def,1);
              break;
            }
            dirX=ux;dirY=uy;
            break;
          }
          default:{dirX=ux;dirY=uy;}
        }
        // Melee kinds stop at contact; the agiota, the anão and the coach keep backing off (from players). Tio and motoboy
        // do not hit mid wind-up; the coach never hits (no melee). A coached enemy hits for PALESTRA.damageMult × damage.
        if(touching&&(!keepsDistance(def)||structure)){dirX=0;dirY=0;}
        // At a bait point (Bancos) there is nobody to hit.
        if(touching&&(player||structure)&&memory.state!==STATE.joke&&def.behavior!=='coach'&&!(player&&noMelee(def))&&ctx.tick>=memory.hitReady){
          memory.hitReady=ctx.tick+def.contactCooldown;
          const charging=memory.state===STATE.charge;
          const amount=(def.behavior==='kamikaze'&&charging?MOTOBOY.hitDamage:e.damage)*coachMult(e,ctx.tick);
          if(player){
            ctx.damagePlayer(player.id,amount,e.id);
            if(def.behavior==='joker'){
              if(live(player)){moveSafely(player,ax*(charging?TIO_JOKE.shove:TIO_JOKE.bump),ay*(charging?TIO_JOKE.shove:TIO_JOKE.bump),onFloor(ctx.terrain,player.andar));settleFloor(ctx.terrain,player);}
              if(charging)this.endCharge(ctx,memory);
            }else if(def.behavior==='kamikaze'){if(charging){boom=true;this.react(ctx,rng,e,def,1);}}
            else if(def.behavior==='brute'||def.behavior==='minichefe'){if(live(player)){moveSafely(player,ax*BRUTE.shove,ay*BRUTE.shove,onFloor(ctx.terrain,player.andar));settleFloor(ctx.terrain,player);}}
            else if(def.behavior==='stagger')this.react(ctx,rng,e,def,.5);
          }else if(structure)this.options.hitStructure?.(ctx,structure.id,amount,e);
        }
        // Barricades (cidade-06): pressed against a blocking structure, the body bashes it (one hit per contact cooldown).
        if(memory.state!==STATE.joke&&ctx.tick>=memory.hitReady)for(const s of structures){
          if(!s.blocking||!(Math.hypot(s.x-e.x,s.y-e.y)-s.radius<=e.radius+PLAYER_RADIUS+.05)||this.options.bashes?.(e,s.id)===false)continue;
          memory.hitReady=ctx.tick+def.contactCooldown;
          this.options.hitStructure?.(ctx,s.id,e.damage,e);
          break;
        }
      }
      // Separation from overlapping neighbors (order-stable: same index, same iteration).
      let pushX=0,pushY=0;
      const near=this.neighbors;near.length=0;
      const spaced=!!ctx.sleepers,gap=spaced?SPACING_GAP:0;
      const apart=(o:Point,radius:number)=>{
        const ox=e.x-o.x,oy=e.y-o.y,d=Math.hypot(ox,oy),overlap=e.radius+radius+gap-d;
        if(overlap<=0)return;
        if(d<1e-6){const a=memory.seed*TAU;pushX+=Math.cos(a)*overlap;pushY+=Math.sin(a)*overlap;}
        else{pushX+=ox/d*overlap;pushY+=oy/d*overlap;}
      };
      ctx.enemyIndex.query(e.x,e.y,e.radius+NEIGHBOR_REACH+gap,near);
      // Only bodies on its own floor (the viaduct: the deck's crowd and the street's under it never touch).
      for(const o of near){if(o!==e&&o.hp>0&&floorOf(o)===floor)apart(o,o.radius);}
      if(spaced){
        // The sleepers (they never move: the awake one steps off them) and the standing heroes (no gap there: it still
        // hits at contact range, CONTACT_MARGIN; it only never stands inside one).
        for(const p of ctx.players.values())if(!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0&&floorOf(p)===floor&&Math.abs(p.x-e.x)<2&&Math.abs(p.y-e.y)<2)apart(p,PLAYER_RADIUS-gap);
      }
      pushX*=SEPARATION;pushY*=SEPARATION;
      const push=Math.hypot(pushX,pushY);
      if(push>SEPARATION_MAX){pushX*=SEPARATION_MAX/push;pushY*=SEPARATION_MAX/push;}
      if(spaced){
        // Off the sleepers, on a cap of its own under the walk (SLEEPER_PUSH_MAX).
        const bx=pushX,by=pushY;pushX=0;pushY=0;
        near.length=0;if(floor===0)ctx.sleepers!.query(e.x,e.y,e.radius+NEIGHBOR_REACH+gap,near);
        for(const o of near)if(!ctx.sleepers!.isTarget(o.id))apart(o,o.radius);
        pushX*=SEPARATION;pushY*=SEPARATION;
        const off=Math.hypot(pushX,pushY);
        if(off>SLEEPER_PUSH_MAX){pushX*=SLEEPER_PUSH_MAX/off;pushY*=SLEEPER_PUSH_MAX/off;}
        pushX+=bx;pushY+=by;
      }
      // The Tio (and the motoboy) plants his feet for the wind-up and bulldozes through the crowd in the charge, so he
      // stays on the line he warned; the neighbors still step off him on their own turn. The motoboy is planted from the
      // tick his aim starts too: a push then would move him off the start of the line he just drew and call the charge
      // off. (The Tio still takes that first push, as tuned; in a crowd it often cancels his charge.)
      if(planted||memory.state===STATE.joke&&enemyDef(e.kind).behavior==='kamikaze'){pushX=0;pushY=0;}
      const dirLength=Math.hypot(dirX,dirY);
      const stepLength=dirLength>1e-6?this.paceSpeed(e,pace,ctx.tick)*(ctx.tick<(e.slowUntil??-1)?SLOW_FACTOR:1)*(this.options.drag?.(e)??1)/SIM_HZ/dirLength:0;
      // capPush (city): the peak rule holds for the whole move, the walk plus the separation push (a crowd must not
      // shove a body past the hero; knockback, above, is the players' doing and is not capped).
      let moveX=dirX*stepLength+pushX,moveY=dirY*stepLength+pushY;
      if(this.capPush){
        const moved=Math.hypot(moveX,moveY),peak=this.heroSpeed*ACTION_PEAK_MAX/SIM_HZ;
        if(moved>peak){moveX*=peak/moved;moveY*=peak/moved;}
      }
      if(this.options.hold?.(ctx,e)){moveX=0;moveY=0;}
      const fromX=e.x,fromY=e.y;
      // Enemy bodies move on the enemy view: the city barricades (cidade-06) stop them, heroes walk through.
      moveSafely(e,moveX,moveY,onFloor(enemyTerrain(ctx.terrain),e.andar),fit);
      settleFloor(ctx.terrain,e);
      // The motoboy crashes at the end of his run, on a player, off the line, or when a wall eats half of his step.
      if(memory.state===STATE.charge&&enemyDef(e.kind).behavior==='kamikaze'){
        const want=Math.hypot(moveX,moveY);
        if(boom||(want>1e-6&&Math.hypot(e.x-fromX,e.y-fromY)<want*.5))detonate.push(e);
      }
    }
    for(const e of detonate)this.crash(ctx,rng,e);
    this.updatePhases(ctx);
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
    addTelegraph(ctx,{shape:'circle',x:enemy.x,y:enemy.y,radius:MOLOTOV.deathRadius,damage:MOLOTOV.deathDamage*coachMult(enemy,ctx.tick),
      owner:hazardOwner(HAZARD_OWNERS.explosion,enemy),enemyDamage:MOLOTOV.deathEnemyDamage,kind:'explosao'} as HazardSpec,MOLOTOV.deathDelay);
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
   * The motoboy's charge is over: one MARMITA_BOOM_LINES line (limiter), the bag's blast (an 'explosao' circle owned by
   * env:marmita:<id>, warned MOTOBOY.blastDelay, only during the wave and inside the telegraph budget) and his death
   * through ctx.damageEnemy with no player credit (the kill hook drops XP and loot once).
   */
  private crash(ctx:SimContext,rng:Rng,e:EnemyState){
    if(!(e.hp>0)||ctx.enemies.get(e.id)!==e)return;
    const memory=e.memory??={};
    memory.state=STATE.walk;dropChargeLine(memory);cancelTelegraphs(ctx,e.id);
    // The marmita lines are the motoboy's; another kamikaze's crash is said by its death pop.
    if(e.kind==='motoboy')this.bark(ctx,rng,e,MARMITA_BOOM_LINES,'motoboy:boom');
    if(ctx.round.phase==='wave'&&this.hazardRoom(ctx)){
      addTelegraph(ctx,{shape:'circle',x:e.x,y:e.y,radius:MOTOBOY.blastRadius,damage:MOTOBOY.blastDamage*coachMult(e,ctx.tick),
        owner:hazardOwner(HAZARD_OWNERS.marmita,e),kind:'explosao'},MOTOBOY.blastDelay);
    }
    ctx.damageEnemy(e.id,e.hp,undefined,'env:marmita');
  }
  /**
   * End of a lecture: every live ally within PALESTRA.radius of the coach (not a coach, not the boss, not retreating) is
   * coached until tick + PALESTRA.duration (refreshed, never stacked); one of them may cheer while it lasts (memory.cheer).
   */
  private palestra(ctx:SimContext,coach:EnemyState,memory:Record<string,number>){
    const until=ctx.tick+PALESTRA.duration;
    let any=false;
    for(const o of ctx.enemies.values()){
      if(o===coach||!(o.hp>0)||o.boss||enemyDef(o.kind).behavior==='coach'||o.memory?.retreat===1)continue;
      if(Math.hypot(o.x-coach.x,o.y-coach.y)>PALESTRA.radius)continue;
      const held=o as EnemyState&CoachedEnemy;
      held.coachedUntil=Math.max(held.coachedUntil??0,until);any=true;
    }
    // BUFFED_LINES are the coach's mentees; another suporte's buff goes without the cheer.
    if(any&&coach.kind==='coach')memory.cheer=until;
  }
  /**
   * EnemyView.phase of the regular enemies (ENEMY_PHASE): acting (the coach lecturing, the motoboy aiming or charging,
   * the influencer posing) wins over coached; nothing otherwise. Expired or retreating buffs are dropped.
   */
  private updatePhases(ctx:SimContext){
    for(const e of ctx.enemies.values()){
      if(e.boss)continue;
      const held=e as EnemyState&CoachedEnemy,m=e.memory,retreat=m?.retreat===1;
      if(held.coachedUntil!==undefined&&(retreat||!isCoached(held,ctx.tick)))delete held.coachedUntil;
      const behavior=enemyDef(e.kind).behavior,state=m?.state;
      const acting=!retreat&&(behavior==='coach'&&state===STATE.lecture||behavior==='kamikaze'&&(state===STATE.joke||state===STATE.charge)
        ||behavior==='poser'&&state===STATE.pose||behavior==='summoner'&&state===STATE.summon||(behavior==='minichefe'||behavior==='brute')&&state===STATE.slam);
      const phase=acting?ENEMY_PHASE.acting:held.coachedUntil!==undefined?ENEMY_PHASE.coached:undefined;
      if(phase===undefined){if(e.phase!==undefined)delete e.phase;}
      else e.phase=phase;
    }
  }
  /**
   * Speed (u/s) of a step at `pace` × the enemy's speed, at most ACTION_PEAK_MAX × the hero speed (catalog.ts,
   * Orquestrador rule: walking included). Slows apply on top of this.
   */
  paceSpeed(e:Pick<EnemyState,'speed'>,pace:number,tick?:number){
    // D-047: an enemy Dona Cida sold a sweet to walks × SUGAR.speed (only when the caller passes the tick).
    const sugar=tick!==undefined&&isSugared(e,tick)?SUGAR.speed:1;
    return Math.min(sugar===1?e.speed*pace:e.speed*pace*sugar,this.heroSpeed*ACTION_PEAK_MAX);
  }
  /**
   * The joke starts: the charge locks on the player's position now (a, unit) and its whole sweep is drawn as an
   * 'investida' line that fires (0 damage, only a warning) when the joke ends. The line covers the band his body
   * crosses: from his back to his front at full reach, his radius plus the contact margin to each side, so a player
   * whose body stays out of it (telegraphHits with the player radius) is never touched by the charge.
   * No room in the telegraph budget: no line, and chargeWarned then skips the charge.
   */
  private warnCharge(ctx:SimContext,e:EnemyState,memory:Record<string,number>,ax:number,ay:number,spec:ChargeSpec){
    const aimed=Math.hypot(ax,ay)>.5,cx=aimed?ax:1,cy=aimed?ay:0;
    const reach=this.paceSpeed(e,spec.chargeSpeed)*spec.charge/SIM_HZ,body=e.radius+CONTACT_MARGIN;
    memory.cx=cx;memory.cy=cy;memory.ox=e.x;memory.oy=e.y;memory.reach=reach;
    // A line left behind by an earlier joke (the director's recycle resets his state) must not stand in for this one.
    cancelTelegraphs(ctx,e.id);
    if(!this.hazardRoom(ctx))return;
    addTelegraph(ctx,{shape:'line',x:e.x-cx*body,y:e.y-cy*body,dx:cx,dy:cy,radius:reach+2*body,width:2*body,damage:0,owner:e.id,kind:'investida'},spec.pause);
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

  /**
   * The invocador starts a call: SUMMON.count spots around him (walkable for an enemy, ≥ SUMMON.safe from every player
   * body), each announced by a 'spawn-warning' that lands SUMMON.warn ticks later; the spots wait in his memory
   * (s<i>x, s<i>y, JSON-safe). Refused (false, nothing announced) while SUMMON.maxGlobal minions live or the enemy cap is
   * near, or when no spot fits.
   */
  private callMinions(ctx:SimContext,rng:Rng,e:EnemyState,memory:Record<string,number>){
    // Spots of a call that never landed (he lost his target mid-call) go first.
    for(let i=0;i<SUMMON.count[1];i++){delete memory[`s${i}x`];delete memory[`s${i}y`];}
    let minions=0;for(const o of ctx.enemies.values())if(o.hp>0&&o.memory?.[MINION_FLAG]===1)minions++;
    const want=Math.min(rng.int(SUMMON.count[0],SUMMON.count[1]),SUMMON.maxGlobal-minions,MAX_ENEMIES-ctx.enemies.size);
    if(want<=0)return false;
    const terrain=enemyTerrain(ctx.terrain),start=rng.next()*TAU,atTick=ctx.tick+SUMMON.warn;
    let made=0;
    for(let i=0;i<8&&made<want;i++){
      const a=start+i/8*TAU,p={x:e.x+Math.cos(a)*SUMMON.radius,y:e.y+Math.sin(a)*SUMMON.radius};
      // Walkable and in the open from him (the enemy view: barricades are solid), so a minion never appears behind a
      // wall or a barricade he is not on the side of.
      if(!clearFrom(e,p.x-e.x,p.y-e.y,terrain,PLAYER_RADIUS))continue;
      let clear=true;for(const pl of ctx.players.values())if(!pl.spectator&&Math.hypot(pl.x-p.x,pl.y-p.y)<SUMMON.safe){clear=false;break;}
      if(!clear)continue;
      memory[`s${made}x`]=p.x;memory[`s${made}y`]=p.y;made++;
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:1});
    }
    if(!made)return false;
    memory.sn=made;memory.state=STATE.summon;memory.until=atTick;
    return true;
  }
  /** The call lands: one minion per announced spot nobody stands on (EnemyAiOptions.summon), flagged MINION_FLAG. */
  private arriveMinions(ctx:SimContext,rng:Rng,e:EnemyState,memory:Record<string,number>){
    const n=memory.sn??0,kinds=this.options.minionKinds?.(ctx)??MINION_KINDS;
    for(let i=0;i<n;i++){
      const p={x:memory[`s${i}x`],y:memory[`s${i}y`]};
      delete memory[`s${i}x`];delete memory[`s${i}y`];
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!kinds.length)continue;
      let clear=true;for(const pl of ctx.players.values())if(!pl.spectator&&Math.hypot(pl.x-p.x,pl.y-p.y)<PLAYER_RADIUS+.3){clear=false;break;}
      if(!clear||ctx.round.phase!=='wave')continue;
      const kind=kinds[rng.int(0,kinds.length-1)];
      const minion=this.options.summon?this.options.summon(ctx,kind,p)
        :ctx.enemies.size<MAX_ENEMIES?createEnemy(ctx,kind,p,SUMMON.hp,{readyIn:SUMMON.readyIn}):undefined;
      if(minion)minion.memory={...minion.memory,[MINION_FLAG]:1};
    }
    delete memory.sn;
  }

  /** Room for one more enemy hazard telegraph (budget.ts MAX_TELEGRAPHS minus the boss reserve). */
  private hazardRoom(ctx:SimContext){return ctx.telegraphs.size<(this.options.telegraphCap??ENEMY_TELEGRAPH_CAP);}

  /**
   * Lobs a molotov at `player`'s current position: the landing telegraph carries the fire pulses still to come.
   * Refused (false) when this anão already has MOLOTOV.maxActive chains burning, MOLOTOV.maxGlobal chains burn in all,
   * or the telegraph budget is full.
   */
  private throwMolotov(ctx:SimContext,e:EnemyState,player:SimPlayer){
    const owner=hazardOwner(HAZARD_OWNERS.molotov,e);
    if(!this.hazardRoom(ctx)||countOwned(ctx,owner,true)>=MOLOTOV.maxActive||countOwned(ctx,HAZARD_OWNERS.molotov)>=MOLOTOV.maxGlobal)return false;
    // A coached anão's fire burns coached too: the landing carries the multiplier for its pulses (`mult`, landHazards).
    const mult=coachMult(e,ctx.tick);
    addTelegraph(ctx,{shape:'circle',x:player.x,y:player.y,radius:MOLOTOV.radius,damage:MOLOTOV.damage*mult,owner,pulses:MOLOTOV.pulses,
      ...(mult!==1?{mult}:{}),kind:'molotov'} as HazardSpec,MOLOTOV.flight);
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
  /**
   * Foco (foco.ts): a FOCO_UNO body a player hurt since its last step turns on that player for AGGRO_SECONDS (its taunt),
   * if `room` (under the cap) or it is already turned (the new hit only refreshes it). A skill's taunt is left alone.
   * True when it took a new slot of the cap.
   */
  private answerHit(ctx:SimContext,e:EnemyState,memory:Record<string,number>,room:boolean){
    const held=e as ProvokedEnemy&TauntedEnemy,by=held.provokedBy;
    if(by===undefined)return false;
    delete held.provokedBy;
    const p=ctx.players.get(by);
    if(!p||!live(p)||(held.taunt&&memory[AGGRO]!==1))return false;
    const fresh=memory[AGGRO]!==1;
    if(fresh&&!room)return false;
    held.taunt={player:by,untilTick:ctx.tick+ticks(AGGRO_SECONDS)};memory[AGGRO]=1;
    return fresh;
  }

  private landHazards(ctx:SimContext){
    const due:HazardTelegraph[]=[];
    for(const t of ctx.telegraphs.values())if(t.fireTick<=ctx.tick&&t.owner.startsWith('env:'))due.push(t);
    for(const t of due){
      if((t.pulses??0)>0&&t.owner.startsWith(HAZARD_OWNERS.molotov)&&ctx.telegraphs.size<=(this.options.telegraphCap??ENEMY_TELEGRAPH_CAP)){
        const mult=t.mult??1;
        addTelegraph(ctx,{shape:'circle',x:t.x,y:t.y,radius:MOLOTOV.pulseRadius,damage:MOLOTOV.pulseDamage*mult,owner:t.owner,pulses:t.pulses!-1,
          ...(mult!==1?{mult}:{}),kind:'fogo',andar:t.andar} as HazardSpec,MOLOTOV.pulseEvery);
      }
      if((t.enemyDamage??0)>0){
        const victims:string[]=[];
        for(const e of ctx.enemies.values())if(e.hp>0&&!e.boss&&floorOf(e)===floorOf(t)&&telegraphHits(t,e,e.radius))victims.push(e.id);
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
