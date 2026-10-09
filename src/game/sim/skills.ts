/**
 * Active class skills (VGM-044A). castSkill is a pure server step over SimContext:
 * damage goes through ctx.damageEnemy with base values (might is applied by the core, D-001),
 * randomness comes from a per-player/per-tick fork, and cooldowns are stored on the player (D-002).
 * Mobile only (D-009): one tap on the skill button casts; there is no aim input. Targets come from
 * player.target (tapped enemy) or the nearest enemy/ally, and direction from player.facing (joystick).
 */
import {ticks,type EnemyState,type PickupKind,type SimContext,type SimPlayer} from './types.ts';
import {clearSegment,moveDirection,type Point} from '../world.ts';
import {kitFor,type ClassKit} from './kits.ts';
import type {Rng} from './rng.ts';
import {BLEED_OUT_TICKS,REVIVE_RADIUS} from './revive.ts';

/** Local pickup cap for skill drops (D-003); integration swaps in budget.ts MAX_PICKUPS. */
export const SKILL_PICKUP_CAP=250;

/** Extra JSON-safe player field (D-002): tick when the class skill is ready again. */
/** Extra JSON-safe player fields (D-002): skillReady = tick the skill is ready; skillFloor = earliest tick a refund can bring it to. */
export type SkillPlayer=SimPlayer&{skillReady?:number;skillFloor?:number};
/** Refunds never bring a skill back before this share of the cooldown the player actually paid. */
export const REFUND_FLOOR_SHARE=0.5;
/** Extra JSON-safe enemy field (D-002) set by Hora Extra; enemy-ai should chase `player` until `untilTick`. */
export type TauntedEnemy=EnemyState&{taunt?:{player:string;untilTick:number}};

/** Magic dice result: flop (base only), hit (+15), miracle (+45). */
export type DiceOutcome='flop'|'hit'|'miracle';
export interface SkillCast {
  player:string; classId:string; skill:string;
  /** Funny pt-BR line for the HUD/speech bubble. */
  line:string;
  readyTick:number;
  /** Enemy ids hit, in hit order. */
  hits:string[];
  /** Player ids healed or shielded. */
  helped:string[];
  outcome?:DiceOutcome; pickup?:string;
  /** Where the caster landed when the skill moved them. */
  movedTo?:Point;
  /** Ally moved by the skill (Salva-Vidas) and where they landed. */
  pulled?:{player:string;x:number;y:number};
  /** Hostile projectiles swatted (cone skills with clearShots). */
  blocked?:number;
}

const canAct=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

/** Living enemies within radius, nearest first, ties by id (deterministic, D-004 death filter). */
function enemiesNear(ctx:SimContext,at:Point,radius:number):EnemyState[]{
  return ctx.enemyIndex.query(at.x,at.y,radius,[])
    .filter(e=>e.hp>0&&ctx.enemies.get(e.id)===e&&dist(e,at)<=radius)
    .sort((a,b)=>dist(a,at)-dist(b,at)||(a.id<b.id?-1:a.id>b.id?1:0));
}
/** Standing players within radius (the caster included), sorted by id. */
function alliesNear(ctx:SimContext,at:Point,radius:number):SimPlayer[]{
  return [...ctx.players.values()].filter(p=>canAct(p)&&dist(p,at)<=radius).sort((a,b)=>a.id<b.id?-1:1);
}
const heal=(p:SimPlayer,amount:number)=>{p.hp=Math.min(p.stats.maxHp,p.hp+amount);};
/** Invulnerability is never scaled by stats.duration, so short cooldowns cannot chain it into immortality. */
const shield=(ctx:SimContext,p:SimPlayer,seconds:number)=>{
  p.invulnerableUntil=Math.max(p.invulnerableUntil??0,ctx.tick+ticks(seconds));
};
/** Skill radii scale with stats.area and debuff durations with stats.duration (D-001). */
const area=(p:SimPlayer,radius:number)=>radius*p.stats.area;
const lasting=(p:SimPlayer,seconds:number)=>seconds*p.stats.duration;
/** Seconds a found coxinha/magnet stays on the ground. */
export const FOUND_PICKUP_SECONDS=10;

interface Effect {hits:string[];helped:string[];outcome?:DiceOutcome;pickup?:string;movedTo?:Point;pulled?:{player:string;x:number;y:number};blocked?:number}
/** Returns null when the skill has nothing to act on: no cooldown is spent. */
type SkillFn=(ctx:SimContext,player:SimPlayer,source:string,rng:Rng)=>Effect|null;

// ---------- Shared helpers ----------
/** Tapped enemy if alive and within range, else the nearest living enemy in range. */
function targetOf(ctx:SimContext,player:SimPlayer,range:number):EnemyState|undefined{
  const preferred=player.target?ctx.enemies.get(player.target):undefined;
  return preferred&&preferred.hp>0&&dist(preferred,player)<=range?preferred:enemiesNear(ctx,player,range)[0];
}
/** Pushes an enemy away from `from` (or along `fallback` when on top). knock is a per-tick displacement that enemy-ai decays. */
function knockAway(enemy:EnemyState,from:Point,fallback:Point,strength:number){
  const d=dist(enemy,from);
  const dir=d>1e-6?{x:(enemy.x-from.x)/d,y:(enemy.y-from.y)/d}:fallback;
  enemy.knock={x:dir.x*strength,y:dir.y*strength};
}
const slowFor=(ctx:SimContext,enemy:EnemyState,player:SimPlayer,seconds:number)=>{
  enemy.slowUntil=Math.max(enemy.slowUntil??0,ctx.tick+ticks(lasting(player,seconds)));
};
const freezeFor=(ctx:SimContext,enemy:EnemyState,player:SimPlayer,seconds:number)=>{
  enemy.frozenUntil=Math.max(enemy.frozenUntil??0,ctx.tick+ticks(lasting(player,seconds)));
};
/** Every owned weapon fires on the next weapons step ("energia", "próximo ataque"). */
const refreshWeapons=(ctx:SimContext,p:SimPlayer)=>{
  for(const w of p.build.weapons)p.weaponReady[w.id]=Math.min(p.weaponReady[w.id]??ctx.tick,ctx.tick);
};
/** Removes the hostile projectiles accepted by `inside`; returns how many. */
function clearShots(ctx:SimContext,inside:(p:Point)=>boolean){
  const ids=[...ctx.projectiles.values()].filter(p=>p.hostile&&inside(p)).map(p=>p.id);
  for(const id of ids)ctx.projectiles.delete(id);
  return ids.length;
}
const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
const hpRatio=(p:SimPlayer)=>p.hp/Math.max(1,p.stats.maxHp);

// ---------- Effects from VGM-044A, now parameterized and reused ----------
interface AdvanceSpec {steps:number;pushRadius:number;damage:number;knock:number;shield:{radius:number;base:number;perEnemy:number;max:number}}
/** Steps along facing (walkable only), hits and pushes the enemies around the landing spot, shields allies; more enemies = longer shield. */
const advance=(spec:AdvanceSpec):SkillFn=>(ctx,player,source)=>{
  let at:Point={x:player.x,y:player.y};
  for(let i=0;i<spec.steps;i++){const next=moveDirection(at,player.facing,0.1,ctx.terrain);if(next===at)break;at=next;}
  const moved=at.x!==player.x||at.y!==player.y;
  player.x=at.x;player.y=at.y;
  const enemies=enemiesNear(ctx,player,area(player,spec.pushRadius)),hits:string[]=[];
  for(const enemy of enemies){
    hits.push(enemy.id);
    if(ctx.damageEnemy(enemy.id,spec.damage,player.id,source))continue;
    // An enemy exactly on top is pushed along the walking direction.
    knockAway(enemy,player,player.facing,spec.knock);
  }
  const seconds=Math.min(spec.shield.max,spec.shield.base+spec.shield.perEnemy*enemies.length);
  const allies=alliesNear(ctx,player,area(player,spec.shield.radius));
  for(const ally of allies)shield(ctx,ally,seconds);
  return {hits,helped:allies.map(a=>a.id),movedTo:moved?{...at}:undefined};
};
interface ShelterSpec {radius:number;heal:number;shield:number;findsPickup:boolean}
/** Heals (and briefly shields) nearby allies; optionally finds a coxinha or a magnet during a wave (never XP, never between rounds). */
const shelter=(spec:ShelterSpec):SkillFn=>(ctx,player,_source,rng)=>{
  const allies=alliesNear(ctx,player,area(player,spec.radius));
  for(const ally of allies){heal(ally,spec.heal);if(spec.shield>0)shield(ctx,ally,spec.shield);}
  let pickup:string|undefined;
  if(spec.findsPickup&&ctx.round.phase==='wave'&&ctx.pickups.size<SKILL_PICKUP_CAP){
    const kind:PickupKind=rng.chance(0.7)?'heal':'magnet';
    pickup=ctx.nextId('pickup');
    const angle=rng.range(0,Math.PI*2);
    ctx.pickups.set(pickup,{id:pickup,kind,value:kind==='heal'?30:1,
      x:player.x+Math.cos(angle)*0.6,y:player.y+Math.sin(angle)*0.6,
      spawnTick:ctx.tick,expiresTick:ctx.tick+ticks(FOUND_PICKUP_SECONDS)});
  }
  return {hits:[],helped:allies.map(a=>a.id),pickup};
};
interface TauntSpec {shield:number;radius:number;taunt:number;slow:number}
/** Invulnerable for a moment; the enemies around chase the caster (and are optionally slowed). */
const taunt=(spec:TauntSpec):SkillFn=>(ctx,player)=>{
  shield(ctx,player,spec.shield);
  const hits:string[]=[];
  for(const enemy of enemiesNear(ctx,player,area(player,spec.radius))){
    (enemy as TauntedEnemy).taunt={player:player.id,untilTick:ctx.tick+ticks(lasting(player,spec.taunt))};
    if(spec.slow>0)slowFor(ctx,enemy,player,spec.slow);
    hits.push(enemy.id);
  }
  return {hits,helped:[player.id]};
};
interface SlowNearestSpec {radius:number;count:number;slow:number;damage:number}
/** Slows and lightly damages the nearest enemies. */
const slowNearest=(spec:SlowNearestSpec):SkillFn=>(ctx,player,source)=>{
  const enemies=enemiesNear(ctx,player,area(player,spec.radius)).slice(0,spec.count);
  if(!enemies.length)return null;
  const hits:string[]=[];
  for(const enemy of enemies){
    hits.push(enemy.id);
    slowFor(ctx,enemy,player,spec.slow);
    ctx.damageEnemy(enemy.id,spec.damage,player.id,source);
  }
  return {hits,helped:[]};
};

// ---------- New effects (VGM-044B: 6 of the 8 allowed) ----------
interface ConeSpec {range:number;angle:number;damage:number;knock:number;slow?:number;clearShots?:boolean;shieldSelf?:number;shieldAllies?:{radius:number;seconds:number}}
/** Arc in front of the caster (facing): damage, push and optional slow; can swat hostile shots and shield. angle >= 2π is a full circle. */
const cone=(spec:ConeSpec):SkillFn=>(ctx,player,source)=>{
  const range=area(player,spec.range),half=spec.angle/2;
  const fl=Math.hypot(player.facing.x,player.facing.y)||1,fx=player.facing.x/fl,fy=player.facing.y/fl;
  const inside=(p:Point)=>{
    const vx=p.x-player.x,vy=p.y-player.y,d=Math.hypot(vx,vy);
    if(d>range)return false;
    if(d<1e-6||spec.angle>=Math.PI*2)return true;
    return Math.acos(Math.max(-1,Math.min(1,(vx*fx+vy*fy)/d)))<=half;
  };
  const hits:string[]=[];
  for(const enemy of enemiesNear(ctx,player,range).filter(inside)){
    hits.push(enemy.id);
    if(ctx.damageEnemy(enemy.id,spec.damage,player.id,source))continue;
    knockAway(enemy,player,{x:fx,y:fy},spec.knock);
    if(spec.slow)slowFor(ctx,enemy,player,spec.slow);
  }
  const blocked=spec.clearShots?clearShots(ctx,inside):0;
  const helped:string[]=[];
  if(spec.shieldSelf){shield(ctx,player,spec.shieldSelf);helped.push(player.id);}
  if(spec.shieldAllies)for(const ally of alliesNear(ctx,player,area(player,spec.shieldAllies.radius))){
    shield(ctx,ally,spec.shieldAllies.seconds);
    if(!helped.includes(ally.id))helped.push(ally.id);
  }
  if(!hits.length&&!blocked&&!helped.length)return null;
  return spec.clearShots?{hits,helped,blocked}:{hits,helped};
};
interface BurstSpec {radius:number;at:'self'|'target';range?:number;damage:number;maxTargets?:number;slow?:number;freeze?:number;knock?:number;annul?:boolean}
/** Extra JSON-safe enemy field (D-002): an annulled enemy cannot be annulled again before this tick. */
export type AnnulledEnemy=EnemyState&{annulImmuneUntil?:number};
/** One annulled attack per enemy per this many seconds (the boss cannot be locked down by several players). */
export const ANNUL_IMMUNITY_SECONDS=6;
/** Cancels the enemy's soonest pending telegraph (fireTick, then id) unless it is immune; returns true if one was cancelled. */
function annul(ctx:SimContext,enemy:EnemyState){
  const e=enemy as AnnulledEnemy;
  if(ctx.tick<(e.annulImmuneUntil??-1))return false;
  const next=[...ctx.telegraphs.values()].filter(t=>t.owner===enemy.id).sort((a,b)=>a.fireTick-b.fireTick||(a.id<b.id?-1:a.id>b.id?1:0))[0];
  if(!next)return false;
  ctx.telegraphs.delete(next.id);
  e.annulImmuneUntil=ctx.tick+ticks(ANNUL_IMMUNITY_SECONDS);
  return true;
}
/** Circle around the caster or around the tapped/nearest enemy: damage, then slow/freeze/push the survivors. */
const burst=(spec:BurstSpec):SkillFn=>(ctx,player,source)=>{
  let center:Point={x:player.x,y:player.y};
  if(spec.at==='target'){
    const target=targetOf(ctx,player,area(player,spec.range??7));
    if(!target)return null;
    center={x:target.x,y:target.y};
  }
  let candidates=enemiesNear(ctx,center,area(player,spec.radius));
  // Bosses ignore freezes (boss.ts), so freeze traps spend their limited targets on the others first.
  if(spec.freeze&&spec.maxTargets)candidates=[...candidates.filter(e=>!e.boss),...candidates.filter(e=>e.boss)];
  const enemies=candidates.slice(0,spec.maxTargets??Infinity);
  if(!enemies.length)return null;
  const hits:string[]=[];
  for(const enemy of enemies){
    hits.push(enemy.id);
    // Interrupts the enemy's next telegraphed attack (the boss included) before the hit can kill it.
    if(spec.annul)annul(ctx,enemy);
    if(ctx.damageEnemy(enemy.id,spec.damage,player.id,source))continue;
    if(spec.slow)slowFor(ctx,enemy,player,spec.slow);
    if(spec.freeze)freezeFor(ctx,enemy,player,spec.freeze);
    if(spec.knock)knockAway(enemy,player,player.facing,spec.knock);
  }
  return {hits,helped:[]};
};
/** Classes whose own skill refunds others; they are never refunded themselves (no refund loops). */
export const REFUNDERS:ReadonlySet<string>=new Set(['pagodeiro','caca-promocao']);
interface RallySpec {radius:number;heal?:number;shield?:number;refreshWeapons?:boolean;skillRefund?:number;reviveBoost?:number;bleedBonus?:number;mostHurt?:boolean}
/**
 * Team support around the caster (caster included): heal, shield, weapons ready now, skill cooldown refund
 * for the others, and help for downed allies (rescue progress and extra bleed-out time).
 * mostHurt: only the single most hurt standing ally (caster included); nobody hurt = nothing happens.
 */
const rally=(spec:RallySpec):SkillFn=>(ctx,player)=>{
  const radius=area(player,spec.radius);
  let allies=alliesNear(ctx,player,radius);
  if(spec.mostHurt){
    const hurt=allies.filter(a=>a.hp<a.stats.maxHp).sort((a,b)=>hpRatio(a)-hpRatio(b)||byId(a,b));
    if(!hurt.length)return null;
    allies=[hurt[0]];
  }
  const helped:string[]=[];
  for(const ally of allies){
    if(spec.heal)heal(ally,spec.heal);
    if(spec.shield)shield(ctx,ally,spec.shield);
    if(spec.refreshWeapons)refreshWeapons(ctx,ally);
    // Refunders never refund each other and never go below their floor, so refunds cannot chain into spam.
    if(spec.skillRefund&&ally!==player&&!REFUNDERS.has(ally.classId)){
      const s=ally as SkillPlayer;
      if(s.skillReady!==undefined)s.skillReady=Math.max(ctx.tick,s.skillFloor??0,s.skillReady-ticks(spec.skillRefund));
    }
    helped.push(ally.id);
  }
  if(spec.reviveBoost||spec.bleedBonus){
    // Offline downed players cannot be picked up, so they get no help.
    const downed=[...ctx.players.values()].filter(p=>p.downed&&p.online&&!p.eliminated&&!p.spectator&&dist(p,player)<=radius).sort(byId);
    for(const p of downed){
      const d=p.downed!;
      // Capped below 1: the revive system still finishes the rescue, which needs a rescuer in range.
      if(spec.reviveBoost)d.progress=Math.max(d.progress,Math.min(0.95,d.progress+spec.reviveBoost));
      // Never more than twice the normal bleed-out since the fall, so stacking casts cannot keep someone down forever.
      if(spec.bleedBonus)d.bleedOutTick=Math.max(d.bleedOutTick,Math.min(d.bleedOutTick+ticks(spec.bleedBonus),d.sinceTick+2*BLEED_OUT_TICKS));
      helped.push(p.id);
    }
  }
  return helped.length?{hits:[],helped}:null;
};
interface VolleySpec {targets:number;range:number;hits:number;damage:number;refreshWeapons?:boolean;freezeAfterCombo?:number}
/** Quick hits on the tapped enemy first, then the nearest ones; can ready the caster's weapons or stun after a full combo. */
const volley=(spec:VolleySpec):SkillFn=>(ctx,player,source)=>{
  const range=area(player,spec.range);
  const first=targetOf(ctx,player,range);
  if(!first)return null;
  const targets=[first,...enemiesNear(ctx,player,range).filter(e=>e!==first)].slice(0,spec.targets);
  const hits:string[]=[];
  for(const enemy of targets){
    let landed=0,killed=false;
    for(let i=0;i<spec.hits&&!killed;i++){hits.push(enemy.id);landed++;killed=ctx.damageEnemy(enemy.id,spec.damage,player.id,source);}
    if(!killed&&spec.freezeAfterCombo&&landed===spec.hits)freezeFor(ctx,enemy,player,spec.freezeAfterCombo);
  }
  if(spec.refreshWeapons)refreshWeapons(ctx,player);
  return {hits,helped:spec.refreshWeapons?[player.id]:[]};
};
interface RescueSpec {range:number;pull:number;heal:number;shield:number}
/**
 * Buoy to the most hurt standing ally in range (farthest on ties): pulls them toward the caster over walkable ground,
 * heals and shields. Nobody hurt = nothing happens. An ally rescuing a downed player is healed but not pulled away.
 */
const rescue=(spec:RescueSpec):SkillFn=>(ctx,player)=>{
  const ally=[...ctx.players.values()]
    .filter(p=>p!==player&&canAct(p)&&p.hp<p.stats.maxHp&&dist(p,player)<=spec.range)
    .sort((a,b)=>hpRatio(a)-hpRatio(b)||dist(b,player)-dist(a,player)||byId(a,b))[0];
  if(!ally)return null;
  const rescuing=[...ctx.players.values()].some(p=>p.downed&&!p.eliminated&&dist(p,ally)<=REVIVE_RADIUS);
  const d=dist(ally,player),pull=rescuing?0:Math.min(spec.pull,Math.max(0,d-0.8));
  if(pull>0){
    const ux=(player.x-ally.x)/d,uy=(player.y-ally.y)/d;
    for(let moved=0;moved+0.1<=pull+1e-9;moved+=0.1){
      const next={x:ally.x+ux*0.1,y:ally.y+uy*0.1};
      if(!clearSegment(ally,next,ctx.terrain))break;
      ally.x=next.x;ally.y=next.y;
    }
  }
  heal(ally,spec.heal);shield(ctx,ally,spec.shield);
  return {hits:[],helped:[ally.id],pulled:{player:ally.id,x:ally.x,y:ally.y}};
};
interface FetchSpec {range:number;heal:number}
/** The pet fetches a coxinha next to the most hurt ally in range (caster included). Only during a wave, so it cannot be farmed. */
const fetchFood=(spec:FetchSpec):SkillFn=>(ctx,player)=>{
  if(ctx.round.phase!=='wave'||ctx.pickups.size>=SKILL_PICKUP_CAP)return null;
  const ally=alliesNear(ctx,player,spec.range).filter(a=>a.hp<a.stats.maxHp).sort((a,b)=>hpRatio(a)-hpRatio(b)||byId(a,b))[0];
  if(!ally)return null;
  // Lands half a step from the ally toward the caster when walkable, else on the ally.
  const d=dist(ally,player);
  const spot=d>1e-6?{x:ally.x+(player.x-ally.x)/d*0.5,y:ally.y+(player.y-ally.y)/d*0.5}:{x:ally.x,y:ally.y};
  const at=clearSegment(ally,spot,ctx.terrain)?spot:{x:ally.x,y:ally.y};
  const pickup=ctx.nextId('pickup');
  ctx.pickups.set(pickup,{id:pickup,kind:'heal',value:spec.heal,x:at.x,y:at.y,spawnTick:ctx.tick,expiresTick:ctx.tick+ticks(FOUND_PICKUP_SECONDS)});
  return {hits:[],helped:[ally.id],pickup};
};

const SKILLS:Readonly<Record<string,SkillFn>>={
  // ----- VGM-044A -----
  'cidadao-comum':advance({steps:4,pushRadius:2.5,damage:8,knock:0.8,shield:{radius:3,base:0.8,perEnemy:0.1,max:1.5}}),
  mendigo:shelter({radius:3.5,heal:20,shield:1,findsPickup:true}),
  // Magic dice on the tapped/nearest enemy: guaranteed base damage plus a rolled bonus. Costs nothing but the cooldown.
  'viciado-em-bet'(ctx,player,source,rng){
    const target=targetOf(ctx,player,area(player,7));
    if(!target)return null;
    const roll=rng.next();
    const outcome:DiceOutcome=roll<0.5?'flop':roll<0.85?'hit':'miracle';
    const bonus=outcome==='flop'?0:outcome==='hit'?15:45;
    ctx.damageEnemy(target.id,15+bonus,player.id,source);
    return {hits:[target.id],helped:[],outcome};
  },
  'clt-cansado':taunt({shield:2.5,radius:5,taunt:4,slow:0}),
  // Dashes to the most hurt ally in range, runs over enemies on the way and heals them.
  // Nobody hurt nearby: eats the order herself (heals self) if hurt, otherwise nothing happens and no cooldown is spent.
  // Range 8 and hit width 0.8 are travel, not area, so they ignore stats.area on purpose.
  motogirl(ctx,player,source){
    const ally=[...ctx.players.values()]
      .filter(p=>p!==player&&canAct(p)&&p.hp<p.stats.maxHp&&dist(p,player)<=8)
      .sort((a,b)=>a.hp/a.stats.maxHp-b.hp/b.stats.maxHp||(a.id<b.id?-1:1))[0];
    if(!ally){
      if(player.hp>=player.stats.maxHp)return null;
      heal(player,15);return {hits:[],helped:[player.id]};
    }
    const from={x:player.x,y:player.y},to={x:ally.x,y:ally.y};
    const length=dist(from,to),hits:string[]=[];
    // Land just short of the ally (not on top of them) when that spot is clear; the ally's own spot is the fallback.
    const back=Math.min(0.5,length);
    const landing=length>1e-6?{x:to.x-(to.x-from.x)/length*back,y:to.y-(to.y-from.y)/length*back}:to;
    const end=clearSegment(to,landing,ctx.terrain)?landing:to;
    const mid={x:(from.x+to.x)/2,y:(from.y+to.y)/2};
    for(const enemy of enemiesNear(ctx,mid,length/2+0.8)){
      // Distance from the enemy to the dash segment.
      const t=length?Math.max(0,Math.min(1,((enemy.x-from.x)*(to.x-from.x)+(enemy.y-from.y)*(to.y-from.y))/(length*length))):0;
      if(dist(enemy,{x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t})>0.8)continue;
      hits.push(enemy.id);
      ctx.damageEnemy(enemy.id,12,player.id,source);
    }
    player.x=end.x;player.y=end.y;
    if(length>1e-6)player.facing={x:(to.x-from.x)/length,y:(to.y-from.y)/length};
    heal(ally,25);
    return {hits,helped:[ally.id],movedTo:{...end}};
  },
  'vizinha-fofoqueira':slowNearest({radius:6,count:5,slow:3,damage:5}),

  // ----- VGM-044B · Linha de frente -----
  pedreiro:cone({range:2.5,angle:2.2,damage:6,knock:0.7,clearShots:true,shieldSelf:1.5}),
  passageira:advance({steps:10,pushRadius:1.6,damage:6,knock:0.6,shield:{radius:0,base:1.2,perEnemy:0,max:1.2}}),
  porteiro:taunt({shield:1.5,radius:4.5,taunt:3.5,slow:3}),
  goleira:cone({range:3,angle:2.6,damage:4,knock:0.5,clearShots:true,shieldAllies:{radius:3.5,seconds:1.2}}),
  // ----- Dano -----
  maromba:cone({range:2,angle:1.6,damage:40,knock:0.9}),
  streamer:volley({targets:4,range:7,hits:1,damage:14,refreshWeapons:true}),
  roqueira:cone({range:5,angle:1,damage:22,knock:0.3}),
  universitario:volley({targets:6,range:6,hits:1,damage:8,refreshWeapons:true}),
  sensei:volley({targets:1,range:3,hits:3,damage:12,freezeAfterCombo:1.2}),
  'rei-pastel':burst({at:'target',range:7,radius:2,damage:20,slow:3}),
  'gamer-mobile':volley({targets:2,range:6,hits:2,damage:9,refreshWeapons:true}),
  'rainha-bateria':burst({at:'self',radius:3.2,damage:16,knock:0.3}),
  // ----- Suporte -----
  'tio-do-churrasco':shelter({radius:4,heal:25,shield:0,findsPickup:false}),
  feirante:rally({radius:4,heal:10,refreshWeapons:true}),
  coach:rally({radius:5,heal:5,shield:1.5}),
  'vendedor-praia':rally({radius:5,heal:18}),
  'tia-festa':rally({radius:5,heal:12,reviveBoost:0.35,bleedBonus:5}),
  pagodeiro:rally({radius:5,heal:8,skillRefund:3}),
  merendeira:rally({radius:6,heal:35,shield:1,mostHurt:true}),
  'mae-pet':fetchFood({range:8,heal:30}),
  'salva-vidas':rescue({range:9,pull:3,heal:10,shield:1.5}),
  // ----- Controle -----
  'tecnico-ti':burst({at:'self',radius:3.5,damage:4,freeze:0.8,slow:2.5}),
  faxineira:cone({range:3,angle:3.2,damage:10,knock:0.5,clearShots:true}),
  concurseira:burst({at:'target',range:7,radius:0.01,maxTargets:1,damage:10,freeze:1.5,annul:true}),
  'caca-promocao':rally({radius:5,refreshWeapons:true,skillRefund:4}),
  gambiarreiro:burst({at:'self',radius:4,maxTargets:4,damage:3,freeze:2.5}),
  astrologa:slowNearest({radius:6,count:10,slow:4,damage:3}),
  'rei-arraia':cone({range:3,angle:Math.PI*2,damage:5,knock:0.7}),
  aposentado:burst({at:'target',range:8,radius:0.01,maxTargets:1,damage:12,knock:0.8,freeze:1}),
  conspiracionista:slowNearest({radius:8,count:6,slow:2,damage:4}),
};

export const hasSkill=(classId:string)=>!!kitFor(classId)&&classId in SKILLS;

/** Clears the skill cooldown, e.g. on rematch when ticks restart. */
export const resetSkill=(player:SimPlayer)=>{delete (player as SkillPlayer).skillReady;delete (player as SkillPlayer).skillFloor;};

/** Tick when the player's skill is ready (0 if never cast). */
export const skillReadyTick=(player:SimPlayer)=>(player as SkillPlayer).skillReady??0;

/**
 * Casts the player's class skill. Returns null (spending no cooldown) when the class has no skill,
 * the player cannot act, the skill is on cooldown, or it has no valid target.
 * Cooldown = kit cooldown × stats.cooldown. Emits one `fire` event with weapon `skill:<classId>`.
 */
export function castSkill(ctx:SimContext,player:SimPlayer):SkillCast|null{
  const kit:ClassKit|undefined=kitFor(player.classId);
  const run=SKILLS[player.classId];
  if(!kit||!run||!canAct(player)||ctx.tick<skillReadyTick(player))return null;
  const source=`skill:${kit.classId}`;
  const rng=ctx.rng.fork(`${source}:${player.id}:${ctx.tick}`);
  const origin={x:player.x,y:player.y};
  const effect=run(ctx,player,source,rng);
  if(!effect)return null;
  const cooldown=Math.max(1,ticks(kit.skill.cooldown*player.stats.cooldown));
  const readyTick=ctx.tick+cooldown;
  (player as SkillPlayer).skillReady=readyTick;
  (player as SkillPlayer).skillFloor=ctx.tick+Math.ceil(cooldown*REFUND_FLOOR_SHARE);
  ctx.emit({type:'fire',player:player.id,weapon:source,x:origin.x,y:origin.y,dx:player.facing.x,dy:player.facing.y});
  return {player:player.id,classId:kit.classId,skill:kit.skill.name,line:rng.pick(kit.lines),readyTick,...effect};
}
