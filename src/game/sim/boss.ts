/**
 * Final boss "Síndico Supremo" (VGM-038): the round 10 encounter.
 * Phase 1: telegraphed stamp slam (circle) and charge (line).
 * Phase 2 (hp <= 50%): faster, area fines on every player, rotating cone sweep and minion summons.
 * Phase 3 (enraged, round timer ran out): phase 2 behaviors with shorter cooldowns, more damage and speed.
 * Every hit the boss deals goes through a telegraph (>= 0.8 s warning); its contact damage is 0,
 * so enemy-ai must skip enemies with `boss` set (this system owns their movement).
 * Minions are announced with a spawn-warning SUMMON_WARNING_TICKS before they appear, away from players;
 * by default they come from the enemy catalog (createEnemy) within the MAX_ENEMIES budget.
 * Barks go through the injected `say` (enemyAi.say, D-012) so the global one-balloon limiter holds.
 * The boss counts as defeated when it leaves ctx.enemies (ctx.damageEnemy removes kills, D-011) or reaches hp 0;
 * anything else that removes it (cleanup, rematch) must call abort() or reset() instead.
 * State that must survive a checkpoint lives in `enemy.memory` (numbers only) and `controller.state`.
 */
import {clearSegment,walkable,type Point} from '../world.ts';
import type {Rng} from './rng.ts';
import {addTelegraph,cancelTelegraphs,canBeTargeted} from './telegraphs.ts';
import {MAX_ENEMIES,hasRoom} from './budget.ts';
import {createEnemy,type EnemyKind} from './enemies/catalog.ts';
import {SIM_HZ,ticks,type EnemyState,type SimContext,type SimPlayer,type SimSystem} from './types.ts';

export const BOSS_KIND='chefe';
export const BOSS_NAME='Síndico Supremo';
export const BOSS_ROUND=10;

export interface BossTuning {
  baseHp:number; hpPerExtraPlayer:number; speed:number; radius:number; xp:number;
  entranceTicks:number; phase2At:number;
  slamDamage:number; slamRadius:number; slamDelay:number;
  fineDamage:number; fineRadius:number; fineDelay:number; fineTargets:number;
  chargeDamage:number; chargeLength:number; chargeWidth:number; chargeDelay:number; chargeDelay2:number; dashTicks:number;
  coneDamage:number; coneRange:number; coneAngle:number; coneDelay:number; coneCount:number; coneEvery:number; coneTurn:number;
  recovery:number; recovery2:number; summonEvery:number; summonCount:number; minionCap:number;
  phase2Speed:number; enragedSpeed:number; enragedDamage:number; enragedCooldown:number; barkEvery:number;
}
/** Durations in ticks. Numbers are first-pass values; VGM-051 tunes them with bot runs. */
export const BOSS_TUNING:Readonly<BossTuning>=Object.freeze({
  baseHp:2400,hpPerExtraPlayer:.7,speed:1.6,radius:.9,xp:120,
  entranceTicks:ticks(2),phase2At:.5,
  slamDamage:28,slamRadius:2,slamDelay:ticks(1.2),
  fineDamage:22,fineRadius:1.8,fineDelay:ticks(1),fineTargets:3,
  chargeDamage:32,chargeLength:8,chargeWidth:1.6,chargeDelay:ticks(1),chargeDelay2:ticks(.85),dashTicks:ticks(.25),
  coneDamage:18,coneRange:5.5,coneAngle:1.1,coneDelay:ticks(.9),coneCount:5,coneEvery:ticks(.35),coneTurn:1,
  recovery:ticks(1.6),recovery2:ticks(1),summonEvery:ticks(12),summonCount:3,minionCap:6,
  phase2Speed:1.4,enragedSpeed:1.3,enragedDamage:1.5,enragedCooldown:.6,barkEvery:ticks(2),
});

/** pt-BR barks. Kept short so the speech bubble stays readable on a phone. */
export const BOSS_LINES={
  spawn:['Reunião de condomínio AGORA! Pauta: vocês.','Quem deixou o chinelo no corredor?!','Edital afixado no elevador: estão todos MULTADOS.','Cheguei! Trouxe a ata, o carimbo e a pauta de 47 itens.'],
  slam:['MULTA!','Proibido pisar na grama!','Carimbado e registrado!','Isso aqui não é área de lazer!','Barulho depois das 22h? MULTA!'],
  fine:['Multa coletiva pra todo mundo!','Rateio da multa entre os condôminos!','Multa em área! Tá no regimento!','Boleto extra pra cada unidade!'],
  charge:['Vaga de garagem é MINHA!','Correndo atrás do inadimplente!','Sai da frente que eu tô atrasado pro conselho!','Quem estacionou na minha vaga?!'],
  sweep:['Leitura da ata: item 1, item 2, item 3…','Ninguém sai antes de ler a ata!','Votação aberta: quem é contra apanha!','Item 38 da pauta: a cor do capacho.'],
  summon:['Convoquei os condôminos!','Quórum garantido!','Chamei o fiscal e o tio do pavê!','Subcomissão do salão de festas, ataquem!'],
  phase2:['ASSEMBLEIA EXTRAORDINÁRIA! Agora é pessoal.','Aprovado por unanimidade: vocês vão apanhar!'],
  enrage:['A taxa condominial SUBIU! Hora extra do síndico!','Estourou o horário da reunião! Agora é taxa extra!'],
  defeat:['Renuncio ao cargo… mas a multa continua!','Isso vai pra ata!','Convoco nova assembleia… semana que vem…'],
} as const;

export const MINION_KINDS=['fiscal','tio-pave','gosma'] as const satisfies readonly EnemyKind[];
export type BossLineKey=keyof typeof BOSS_LINES;
/** Grace after a minion appears (the spawn-warning already gave 1.5 s). */
export const MINION_READY_TICKS=ticks(.4);

/** Default minion factory: catalog enemy, refused when the enemy budget is full. */
export function summonFromCatalog(ctx:SimContext,kind:string,at:Point):EnemyState|undefined{
  if(!hasRoom(ctx.enemies,MAX_ENEMIES))return undefined;
  return createEnemy(ctx,kind,at,1,{readyIn:MINION_READY_TICKS});
}

/** Phase numbers carried by EnemyState.phase and the boss-phase event. */
export const PHASE_NORMAL=1,PHASE_ASSEMBLY=2,PHASE_ENRAGED=3;
const ACT_IDLE=0,ACT_WINDUP=1,ACT_DASH=2,ACT_SWEEP=3;
const ATTACK_SLAM=1,ATTACK_CHARGE=2,ATTACK_SWEEP=3;

export interface BossOptions {
  /** Creates one minion, adds it to ctx.enemies and returns it; undefined when refused (e.g. entity cap). Default: summonFromCatalog. */
  summon?:(ctx:SimContext,kind:string,at:Point)=>EnemyState|undefined;
  /**
   * Bark through the global limiter: wire `(ctx,e,lines,key)=>enemyAi.say(ctx,e,lines,key)` (D-012).
   * Returns true when emitted. Without it the boss stays silent (it never emits bark events itself).
   */
  say?:(ctx:SimContext,enemy:EnemyState,lines:readonly string[],key:string)=>boolean;
  /** Drops the boss chest; default adds a `chest` pickup. Called once. */
  dropChest?:(ctx:SimContext,at:Point)=>void;
  /** Called exactly once, on the first step after the boss dies. */
  onDefeated?:(ctx:SimContext,at:Point)=>void;
  /** Player count used for hp (1..6); pass the director's scalePlayers so leaving before round 10 does not shrink the boss. */
  scalePlayers?:(ctx:SimContext)=>number;
  tuning?:Partial<BossTuning>;
}
/** JSON-safe controller state, enough to resume after a checkpoint. */
export interface PendingSummon {kind:string;x:number;y:number;atTick:number}
/** A key line (spawn, phase, enrage, defeat) the global limiter refused; retried each tick until `until`. */
export interface QueuedLine {key:BossLineKey;until:number}
export interface BossState {bossId?:string;defeated:boolean;lastX:number;lastY:number;minions:string[];pending:PendingSummon[];queued?:QueuedLine;rng?:number}
export interface BossController extends SimSystem {
  readonly state:BossState;
  readonly tuning:Readonly<BossTuning>;
  /**
   * Director hook for round 10. One boss per controller (create one controller per run): returns the living boss
   * on repeated calls and undefined once it was beaten. Hp scales with players in the run (1..6).
   */
  spawnBoss(ctx:SimContext,at?:Point):EnemyState|undefined;
  /** Loads a checkpointed `state` (rng stream included). */
  restore(saved:BossState):void;
  /** Forgets the fight (rematch): the next spawnBoss starts a fresh boss. Does not touch ctx. */
  reset():void;
  /** Removes the boss, its pending telegraphs and summons without a victory or chest, then resets. */
  abort(ctx:SimContext):void;
  /** Victory check: a boss was spawned and is dead. Stays true afterwards. */
  bossDefeated(ctx:SimContext):boolean;
  /** Round timer ran out: phase 3. Also triggered by the system when the wave phase passes its end tick. */
  enrage(ctx:SimContext):void;
  boss(ctx:SimContext):EnemyState|undefined;
}

/** Players still in the run (downed ones count, they can be rescued). */
const inRun=(p:SimPlayer)=>p.online&&!p.spectator&&!p.eliminated;
/** Bodies on the island, online or not: nothing spawns on them, since offline players still get hit (D-011) and may reconnect. */
const bodyPresent=(p:SimPlayer)=>!p.spectator&&!p.eliminated;
/** How long a refused key line keeps retrying. */
export const KEY_LINE_RETRY_TICKS=ticks(3);
export const bossMaxHp=(players:number,tuning:Readonly<BossTuning>=BOSS_TUNING)=>
  Math.round(tuning.baseHp*(1+tuning.hpPerExtraPlayer*(Math.min(6,Math.max(1,Math.floor(players)||1))-1)));

const ISLAND_CENTER:Point={x:12,y:12};
const SAFE_SPAWN_DISTANCE=4;
/** Minions are placed this far from players and still need SAFE_SUMMON_DISTANCE when they appear. */
const SUMMON_PLACE_DISTANCE=2.5,SAFE_SUMMON_DISTANCE=1.5;
export const SUMMON_WARNING_TICKS=ticks(1.5);
const freshState=():BossState=>({defeated:false,lastX:0,lastY:0,minions:[],pending:[]});
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const minDistance=(p:Point,players:readonly Point[])=>players.reduce((m,q)=>Math.min(m,dist(p,q)),Infinity);

export function createBoss(options:BossOptions={}):BossController {
  const tuning:Readonly<BossTuning>=Object.freeze({...BOSS_TUNING,...options.tuning});
  const state:BossState=freshState();
  let rng:Rng|undefined;
  const stream=(ctx:SimContext)=>{
    if(!rng){rng=ctx.rng.fork('boss');if(state.rng!==undefined)rng.state=state.rng;}
    return rng;
  };
  const summonMinion=options.summon??summonFromCatalog;
  /**
   * Local throttle on top of the global limiter. Key lines (`force`: spawn, phase, enrage, defeat) skip the local
   * throttle and, if the global limiter refuses them, are queued and retried for KEY_LINE_RETRY_TICKS.
   */
  const say=(ctx:SimContext,boss:EnemyState,key:BossLineKey,force=false)=>{
    const m=boss.memory;
    if(!options.say||(!force&&m&&ctx.tick<m.barkAt))return;
    if(options.say(ctx,boss,BOSS_LINES[key],`${BOSS_KIND}:${key}`)){
      if(m)m.barkAt=ctx.tick+tuning.barkEvery;
      if(state.queued?.key===key)delete state.queued;
    }else if(force)state.queued={key,until:ctx.tick+KEY_LINE_RETRY_TICKS};
  };
  /** The bark only needs an id and a position, so a gone corpse is stood in for by a stub. */
  const speaker=(ctx:SimContext):EnemyState=>current(ctx)??{id:state.bossId!,kind:BOSS_KIND,x:state.lastX,y:state.lastY,
    hp:0,maxHp:1,speed:0,damage:0,radius:tuning.radius,xp:0,spawnTick:0,readyTick:0};
  function retryLine(ctx:SimContext){
    const queued=state.queued;
    if(!queued||!options.say)return;
    if(ctx.tick>queued.until){delete state.queued;return;}
    if(options.say(ctx,speaker(ctx),BOSS_LINES[queued.key],`${BOSS_KIND}:${queued.key}`))delete state.queued;
  }
  const current=(ctx:SimContext)=>state.bossId?ctx.enemies.get(state.bossId):undefined;
  const alive=(ctx:SimContext)=>{const b=current(ctx);return b&&b.hp>0?b:undefined;};
  const enraged=(b:EnemyState)=>b.phase===PHASE_ENRAGED;

  function setPhase(ctx:SimContext,boss:EnemyState,phase:number){
    if((boss.phase??PHASE_NORMAL)>=phase)return;
    boss.phase=phase;
    ctx.emit({type:'boss-phase',enemy:boss.id,phase});
    say(ctx,boss,phase===PHASE_ENRAGED?'enrage':'phase2',true);
    // Summon right away when the assembly starts; the next attack comes quickly but still telegraphed.
    boss.memory!.summonAt=ctx.tick;
    boss.memory!.next=Math.min(boss.memory!.next,ctx.tick+tuning.recovery2);
  }

  function spawnBoss(ctx:SimContext,at?:Point):EnemyState|undefined {
    if(state.bossId){
      const existing=alive(ctx);
      // Killed earlier this tick (weapons run after the director): settle the victory instead of a rematch.
      if(!existing&&!state.defeated)finish(ctx);
      return existing;
    }
    const players=[...ctx.players.values()].filter(inRun);
    const maxHp=bossMaxHp(Math.max(players.length,options.scalePlayers?.(ctx)??0),tuning);
    const bodies=[...ctx.players.values()].filter(bodyPresent);
    // The director passes a coastal point; fall back to a safe inland one if it is not walkable.
    const spot=at&&walkable(at,ctx.terrain)?{x:at.x,y:at.y}:spawnPoint(ctx,bodies);
    const boss:EnemyState={
      id:ctx.nextId('boss'),kind:BOSS_KIND,x:spot.x,y:spot.y,hp:maxHp,maxHp,
      speed:tuning.speed,damage:0,radius:tuning.radius,xp:tuning.xp,boss:true,
      spawnTick:ctx.tick,readyTick:ctx.tick+tuning.entranceTicks,phase:PHASE_NORMAL,
      memory:{act:ACT_IDLE,actUntil:0,next:ctx.tick+tuning.entranceTicks,last:0,barkAt:0,summonAt:0,
        dashAt:0,fromX:0,fromY:0,toX:0,toY:0,sweepLeft:0,sweepAngle:0,sweepTurn:0,sweepAt:0,sweepEnd:0},
    };
    ctx.enemies.set(boss.id,boss);
    delete state.queued;
    Object.assign(state,{bossId:boss.id,defeated:false,lastX:boss.x,lastY:boss.y,minions:[],pending:[]});
    ctx.emit({type:'boss-phase',enemy:boss.id,phase:PHASE_NORMAL});
    say(ctx,boss,'spawn',true);
    return boss;
  }

  /**
   * Walkable point near the island center (endless world: near the team's centre, spawn-em-volta), at least
   * SAFE_SPAWN_DISTANCE from every player when possible. Only a fallback: the director passes a spawn point.
   */
  function spawnPoint(ctx:SimContext,players:readonly Point[]):Point {
    let center:Point=ISLAND_CENTER;
    if(ctx.terrain.chunks&&players.length){
      let x=0,y=0;for(const p of players){x+=p.x;y+=p.y;}
      center={x:x/players.length,y:y/players.length};
    }
    let best:Point=center,bestDistance=-1;
    for(const r of [0,2,4,6,8])for(let i=0;i<(r?16:1);i++){
      const a=i/16*Math.PI*2,p={x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r};
      if(!walkable(p,ctx.terrain))continue;
      const d=minDistance(p,players);
      if(d>=SAFE_SPAWN_DISTANCE)return p;
      if(d>bestDistance){best=p;bestDistance=d;}
    }
    return best;
  }

  function finish(ctx:SimContext){
    const boss=current(ctx);
    const at={x:boss?.x??state.lastX,y:boss?.y??state.lastY};
    state.defeated=true;state.pending=[];
    cancelTelegraphs(ctx,state.bossId!);
    say(ctx,speaker(ctx),'defeat',true);
    if(options.dropChest)options.dropChest(ctx,at);
    else{const id=ctx.nextId('pickup');ctx.pickups.set(id,{id,kind:'chest',value:1,x:at.x,y:at.y,spawnTick:ctx.tick});}
    options.onDefeated?.(ctx,at);
    if(rng)state.rng=rng.state;
  }

  function step(ctx:SimContext){
    if(!state.bossId)return;
    retryLine(ctx);
    if(state.defeated){if(rng)state.rng=rng.state;return;}
    const boss=alive(ctx);
    if(!boss){finish(ctx);return;}
    delete boss.knock;delete boss.frozenUntil; // too heavy to push or freeze
    if(ctx.round.phase==='wave'&&ctx.tick>=ctx.round.phaseEndsTick)setPhase(ctx,boss,PHASE_ENRAGED);
    if(boss.hp<=boss.maxHp*tuning.phase2At)setPhase(ctx,boss,PHASE_ASSEMBLY);
    arrive(ctx);
    if(ctx.tick>=boss.readyTick){
      const targets=[...ctx.players.values()].filter(canBeTargeted);
      if((boss.phase??1)>=PHASE_ASSEMBLY)summon(ctx,boss);
      act(ctx,boss,targets);
    }
    state.lastX=boss.x;state.lastY=boss.y;
    if(rng)state.rng=rng.state;
  }

  /** Schedules minions around the boss with a spawn-warning; they appear SUMMON_WARNING_TICKS later (see arrive). */
  function summon(ctx:SimContext,boss:EnemyState){
    const m=boss.memory!;
    const present=[...ctx.players.values()].filter(bodyPresent); // downed and offline bodies too: never drop minions on them
    state.minions=state.minions.filter(id=>{const e=ctx.enemies.get(id);return !!e&&e.hp>0;});
    if(ctx.tick<m.summonAt)return;
    m.summonAt=ctx.tick+Math.round(tuning.summonEvery*(enraged(boss)?tuning.enragedCooldown:1));
    const r=stream(ctx);let made=0;
    const start=r.next()*Math.PI*2,atTick=ctx.tick+SUMMON_WARNING_TICKS;
    for(let i=0;i<12&&made<tuning.summonCount&&state.minions.length+state.pending.length<tuning.minionCap;i++){
      const a=start+i/12*Math.PI*2,p={x:boss.x+Math.cos(a)*2.5,y:boss.y+Math.sin(a)*2.5};
      if(!walkable(p,ctx.terrain)||minDistance(p,present)<SUMMON_PLACE_DISTANCE)continue;
      state.pending.push({kind:r.pick(MINION_KINDS),x:p.x,y:p.y,atTick});
      ctx.emit({type:'spawn-warning',x:p.x,y:p.y,atTick,count:1});
      made++;
    }
    if(made)say(ctx,boss,'summon');
  }

  /** Materializes due summons; a spot a player walked onto is skipped rather than spawning on them. */
  function arrive(ctx:SimContext){
    if(!state.pending.length)return;
    const present=[...ctx.players.values()].filter(bodyPresent);
    const due=state.pending.filter(s=>s.atTick<=ctx.tick);
    state.pending=state.pending.filter(s=>s.atTick>ctx.tick);
    for(const s of due){
      if(!walkable(s,ctx.terrain)||minDistance(s,present)<SAFE_SUMMON_DISTANCE)continue;
      const minion=summonMinion(ctx,s.kind,{x:s.x,y:s.y});
      if(minion)state.minions.push(minion.id);
    }
  }

  const scale=(boss:EnemyState,damage:number)=>Math.round(damage*(enraged(boss)?tuning.enragedDamage:1));
  const recovery=(boss:EnemyState)=>Math.round(((boss.phase??1)>=PHASE_ASSEMBLY?tuning.recovery2:tuning.recovery)*(enraged(boss)?tuning.enragedCooldown:1));

  function act(ctx:SimContext,boss:EnemyState,targets:readonly SimPlayer[]){
    const m=boss.memory!;
    if(m.act===ACT_WINDUP){if(ctx.tick>=m.actUntil)m.act=ACT_IDLE;return;}
    if(m.act===ACT_DASH){
      if(ctx.tick<m.dashAt)return;
      const t=Math.min(1,(ctx.tick-m.dashAt+1)/Math.max(1,tuning.dashTicks));
      boss.x=m.fromX+(m.toX-m.fromX)*t;boss.y=m.fromY+(m.toY-m.fromY)*t;
      if(t>=1){m.act=ACT_WINDUP;m.actUntil=ctx.tick+recovery(boss);}
      return;
    }
    if(m.act===ACT_SWEEP){sweep(ctx,boss);return;}
    if(!targets.length)return;
    const nearest=targets.reduce((a,b)=>dist(boss,b)<dist(boss,a)?b:a);
    if(ctx.tick<m.next){walk(ctx,boss,nearest);return;}
    const phase=boss.phase??1;
    const options=phase>=PHASE_ASSEMBLY?[ATTACK_SLAM,ATTACK_CHARGE,ATTACK_SWEEP]:[ATTACK_SLAM,ATTACK_CHARGE];
    // Halve the weight of the previous attack so the pattern varies without being fully random.
    const attack=stream(ctx).weighted(options,a=>a===m.last?.5:a===ATTACK_SWEEP?1.2:1);
    m.last=attack;
    if(attack===ATTACK_CHARGE&&charge(ctx,boss,nearest))return;
    if(attack===ATTACK_SWEEP){startSweep(ctx,boss,nearest);return;}
    slam(ctx,boss,targets);
  }

  function walk(ctx:SimContext,boss:EnemyState,target:Point){
    if(dist(boss,target)<=2.5)return;
    const slow=boss.slowUntil!==undefined&&ctx.tick<boss.slowUntil?.6:1;
    const mult=(boss.phase??1)>=PHASE_ASSEMBLY?tuning.phase2Speed*(enraged(boss)?tuning.enragedSpeed:1):1;
    const step=boss.speed*mult*slow/SIM_HZ;
    const dx=target.x-boss.x,dy=target.y-boss.y,l=Math.hypot(dx,dy);
    const next={x:boss.x+dx/l*step,y:boss.y+dy/l*step};
    for(const c of [next,{x:next.x,y:boss.y},{x:boss.x,y:next.y}])
      if(clearSegment(boss,c,ctx.terrain)){boss.x=c.x;boss.y=c.y;return;}
  }

  function windup(ctx:SimContext,boss:EnemyState,fireTick:number){
    const m=boss.memory!;
    m.act=ACT_WINDUP;m.actUntil=fireTick+ticks(.3);m.next=fireTick+recovery(boss);
  }

  /** Phase 1: one stamp on a random player. Phase 2+: "multa em área", a fine on several players plus the boss's own feet. */
  function slam(ctx:SimContext,boss:EnemyState,targets:readonly SimPlayer[]){
    const r=stream(ctx);
    if((boss.phase??1)<PHASE_ASSEMBLY){
      const t=r.pick(targets);
      const tg=addTelegraph(ctx,{shape:'circle',x:t.x,y:t.y,radius:tuning.slamRadius,damage:scale(boss,tuning.slamDamage),owner:boss.id},tuning.slamDelay);
      say(ctx,boss,'slam');windup(ctx,boss,tg.fireTick);return;
    }
    const pool=[...targets];let fireTick=ctx.tick;
    for(let i=0;i<tuning.fineTargets&&pool.length;i++){
      const t=pool.splice(r.int(0,pool.length-1),1)[0];
      fireTick=addTelegraph(ctx,{shape:'circle',x:t.x,y:t.y,radius:tuning.fineRadius,damage:scale(boss,tuning.fineDamage),owner:boss.id},tuning.fineDelay).fireTick;
    }
    addTelegraph(ctx,{shape:'circle',x:boss.x,y:boss.y,radius:tuning.fineRadius+.6,damage:scale(boss,tuning.fineDamage),owner:boss.id},tuning.fineDelay);
    say(ctx,boss,'fine');windup(ctx,boss,fireTick);
  }

  /** Line telegraph toward the nearest player, clipped where the island or an obstacle stops the dash. */
  function charge(ctx:SimContext,boss:EnemyState,target:Point):boolean {
    const dx=target.x-boss.x,dy=target.y-boss.y,l=Math.hypot(dx,dy);
    if(l<1e-6)return false;
    const ux=dx/l,uy=dy/l;
    let reach=0;
    while(reach+.25<=tuning.chargeLength&&clearSegment(boss,{x:boss.x+ux*(reach+.25),y:boss.y+uy*(reach+.25)},ctx.terrain))reach+=.25;
    if(reach<2)return false;
    const delay=(boss.phase??1)>=PHASE_ASSEMBLY?tuning.chargeDelay2:tuning.chargeDelay;
    const tg=addTelegraph(ctx,{shape:'line',x:boss.x,y:boss.y,dx:ux,dy:uy,radius:reach,width:tuning.chargeWidth,damage:scale(boss,tuning.chargeDamage),owner:boss.id},delay);
    const m=boss.memory!;
    Object.assign(m,{act:ACT_DASH,dashAt:tg.fireTick,fromX:boss.x,fromY:boss.y,toX:boss.x+ux*reach,toY:boss.y+uy*reach,next:tg.fireTick+tuning.dashTicks+recovery(boss)});
    say(ctx,boss,'charge');
    return true;
  }

  /** "Leitura da ata": cones fired one after another, turning around the boss. */
  function startSweep(ctx:SimContext,boss:EnemyState,target:Point){
    const m=boss.memory!;
    Object.assign(m,{act:ACT_SWEEP,sweepLeft:tuning.coneCount,sweepAngle:Math.atan2(target.y-boss.y,target.x-boss.x),
      sweepTurn:stream(ctx).chance(.5)?tuning.coneTurn:-tuning.coneTurn,sweepAt:ctx.tick,sweepEnd:ctx.tick});
    say(ctx,boss,'sweep');
    sweep(ctx,boss);
  }
  function sweep(ctx:SimContext,boss:EnemyState){
    const m=boss.memory!;
    if(m.sweepLeft>0&&ctx.tick>=m.sweepAt){
      const tg=addTelegraph(ctx,{shape:'cone',x:boss.x,y:boss.y,dx:Math.cos(m.sweepAngle),dy:Math.sin(m.sweepAngle),
        radius:tuning.coneRange,width:tuning.coneAngle,damage:scale(boss,tuning.coneDamage),owner:boss.id},tuning.coneDelay);
      m.sweepAngle+=m.sweepTurn;m.sweepLeft--;m.sweepAt=ctx.tick+tuning.coneEvery;m.sweepEnd=tg.fireTick;
    }
    if(m.sweepLeft<=0)windup(ctx,boss,m.sweepEnd);
  }

  function reset(){
    for(const key of Object.keys(state) as (keyof BossState)[])delete state[key];
    Object.assign(state,freshState());rng=undefined;
  }

  return {
    id:'boss',state,tuning,step,spawnBoss,
    boss:alive,
    restore(saved){Object.assign(state,freshState(),structuredClone(saved));rng=undefined;},
    reset,
    abort(ctx){
      if(state.bossId){cancelTelegraphs(ctx,state.bossId);ctx.enemies.delete(state.bossId);}
      reset();
    },
    bossDefeated:ctx=>!!state.bossId&&(state.defeated||!alive(ctx)),
    enrage(ctx){const b=alive(ctx);if(b)setPhase(ctx,b,PHASE_ENRAGED);},
  };
}
