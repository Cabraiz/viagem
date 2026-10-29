/**
 * Downed, revive and team defeat (VGM-037).
 * The core calls downPlayer when a player's hp reaches 0. The 'revive' system advances rescue
 * progress, bleeds out downed players and reports the common defeat exactly once.
 */
import type {SimPlayer} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {hazardKind} from './enemies/catalog.ts';
import {clearMoveEffects} from './player-effects.ts';
import {floorOf} from '../maps/index.ts';
import {BLEED_OUT_TICKS,EXTRA_RESCUER_WEIGHT,RECONNECT_GRACE_TICKS,REVIVE_DECAY_PER_TICK,REVIVE_HP_FRACTION,REVIVE_INVULNERABLE_TICKS,REVIVE_PUSH_KNOCK,REVIVE_PUSH_RADIUS,REVIVE_RADIUS,REVIVE_TICKS,SOLO_SECOND_CHANCES,SOLO_SELF_REVIVE_TICKS} from '../rules/index.ts';
export {BLEED_OUT_TICKS,EXTRA_RESCUER_WEIGHT,RECONNECT_GRACE_TICKS,REVIVE_DECAY_PER_TICK,REVIVE_HP_FRACTION,REVIVE_INVULNERABLE_TICKS,REVIVE_PUSH_KNOCK,REVIVE_PUSH_RADIUS,REVIVE_RADIUS,REVIVE_TICKS,SOLO_SECOND_CHANCES,SOLO_SELF_REVIVE_TICKS};


/** Online, in the run, on their feet. */
export function isStanding(p:SimPlayer){
  return p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
}

/**
 * Puts a player down instead of respawning. Idempotent: returns false (and emits nothing)
 * for spectators or players already downed or eliminated.
 * Does not look at invulnerableUntil: the core's damagePlayer already applies invulnerability
 * (D-001, core.ts damagePlayer) before calling onPlayerZero, and this is the hp-0 transition itself.
 */
export function downPlayer(ctx:SimContext,player:SimPlayer,by?:string,cause?:string){
  if(player.spectator||player.downed||player.eliminated)return false;
  player.hp=0;
  player.target=undefined;
  player.invulnerableUntil=undefined;
  // D-036: a fallen player neither crawls slowed nor slides; getting up starts clean too (below).
  clearMoveEffects(player);
  player.downed={sinceTick:ctx.tick,bleedOutTick:ctx.tick+BLEED_OUT_TICKS,progress:0};
  // `by` is the enemy id that dealt the last hit (contact, telegraph owner or projectile owner); its kind names the cause.
  // A hazard that outlives its thrower (`env:molotov:<id>`, D-033) names the kind behind it. `cause` names a fall with
  // no enemy behind it (the fear's FEAR_SOURCE, sim/fear.ts).
  const source=cause??(by===undefined?undefined:ctx.enemies.get(by)?.kind??hazardKind(by));
  ctx.emit({type:'downed',player:player.id,...(by!==undefined?{by}:{}),...(source!==undefined?{source}:{})});
  return true;
}

/**
 * No active player standing (offline counts as out). Spectators are ignored; an empty or
 * spectator-only room is not a defeat. To end the run use the system's defeated/onTeamDefeated,
 * which add the reconnect grace and fire once.
 */
export function teamDefeated(ctx:SimContext){
  let participants=0;
  for(const p of ctx.players.values()){
    if(p.spectator)continue;
    if(isStanding(p))return false;
    participants++;
  }
  return participants>0;
}

export interface ReviveOptions {
  /** The run's defeat trigger. Called once, when the whole team is out (after the reconnect grace if someone only dropped). */
  onTeamDefeated?(ctx:SimContext):void;
  /** Ticks the defeat waits for a player who dropped while standing. Default RECONNECT_GRACE_TICKS; VGM-047 sets the mobile value. */
  reconnectGraceTicks?:number;
  /** True once the run is over (e.g. the director granted victory earlier this tick): no defeat, no bleed-out after that. */
  runEnded?():boolean;
  /** Freeze bleed-out during the intermission, which exists to pick up the fallen. Default true. */
  pauseBleedInPrepare?:boolean;
  /** A room checkpoint's revive credits (RunSystems.state().revives), so the run resumes with the rescues it had. */
  revives?:Iterable<[string,number]>;
  /** A room checkpoint's solo second chances left (RunSystems.state().soloChances), so a resumed room gives none back. */
  soloChances?:number;
}

export interface ReviveSystem extends SimSystem {
  readonly id:'revive';
  /** Completed revives credited to each rescuer in range at completion. */
  readonly revives:ReadonlyMap<string,number>;
  readonly defeated:boolean;
  /** Second chances left to a player alone in the run (SOLO_SECOND_CHANCES at the start). */
  readonly soloChances:number;
}

/**
 * Getting up (comeca-armado-e-levanta-seguro, item 3): every living critter within REVIVE_PUSH_RADIUS on the player's
 * floor is shoved away (bosses stand, as with any knockback), so the protection does not run out with them on top. One
 * right on the player goes the golden-angle way of its rank, so a pile spreads instead of sliding as one.
 */
export function shoveFromRise(ctx:SimContext,p:SimPlayer){
  const floor=floorOf(p);
  const near=ctx.enemyIndex.query(p.x,p.y,REVIVE_PUSH_RADIUS,[])
    .filter(e=>e.hp>0&&!e.boss&&ctx.enemies.get(e.id)===e&&floorOf(e)===floor&&Math.hypot(e.x-p.x,e.y-p.y)<=REVIVE_PUSH_RADIUS+EPS)
    .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  near.forEach((e,i)=>{
    const d=Math.hypot(e.x-p.x,e.y-p.y),a=i*2.399963;
    const dir=d>1e-6?{x:(e.x-p.x)/d,y:(e.y-p.y)/d}:{x:Math.cos(a),y:Math.sin(a)};
    e.knock={x:dir.x*REVIVE_PUSH_KNOCK,y:dir.y*REVIVE_PUSH_KNOCK};
  });
  return near.length;
}

/** Absorbs float drift so the boundary (exactly 1.2 away, exactly 3 s) counts. */
const EPS=1e-9;
const byId=(a:SimPlayer,b:SimPlayer)=>a.id<b.id?-1:a.id>b.id?1:0;
/** NaN, zero and negative cannot revive; Infinity revives instantly. */
const reviveRate=(p:SimPlayer)=>{const r=p.stats.revive;return r>0?r:0;};
const revivedHp=(p:SimPlayer)=>{const m=p.stats.maxHp;return Number.isFinite(m)&&m>0?Math.max(1,Math.ceil(m*REVIVE_HP_FRACTION)):1;};
const droppedStanding=(p:SimPlayer)=>!p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

export function createReviveSystem(options:ReviveOptions={}):ReviveSystem{
  const revives=new Map<string,number>(options.revives??[]);
  const pauseInPrepare=options.pauseBleedInPrepare??true;
  const grace=options.reconnectGraceTicks??RECONNECT_GRACE_TICKS;
  let defeated=false,outSince:number|undefined;
  // Junk from storage (not a whole number in 0..SOLO_SECOND_CHANCES) counts as a fresh run's.
  const stored=options.soloChances;
  let soloChances=Number.isInteger(stored)&&stored!>=0&&stored!<=SOLO_SECOND_CHANCES?stored!:SOLO_SECOND_CHANCES;
  const rise=(ctx:SimContext,p:SimPlayer)=>{
    p.downed=undefined;
    p.hp=revivedHp(p);
    p.invulnerableUntil=ctx.tick+REVIVE_INVULNERABLE_TICKS;
    clearMoveEffects(p);
    shoveFromRise(ctx,p);
  };
  return {
    id:'revive',
    get revives(){return revives;},
    get defeated(){return defeated;},
    get soloChances(){return soloChances;},
    step(ctx){
      if(defeated||options.runEnded?.())return;
      const players=[...ctx.players.values()].sort(byId);
      const rescuers=players.filter(isStanding);
      const paused=pauseInPrepare&&ctx.round.phase==='prepare';
      // Alone in the run (no teammate, no bot, spectators aside): nobody can come, so the fall is a second chance once.
      const alone=players.filter(p=>!p.spectator).length===1;
      let rising=false;
      for(const p of players){
        const d=p.downed;
        if(!d||p.eliminated)continue;
        // Turned spectator while down: they left the run, so drop the frozen downed state instead of
        // eliminating them when they come back.
        if(p.spectator){p.downed=undefined;continue;}
        if(paused)d.bleedOutTick++;
        // Alone: the ring fills by itself over SOLO_SELF_REVIVE_TICKS and the run waits (no defeat meanwhile).
        if(alone&&soloChances>0&&p.online){
          rising=true;
          const next=d.progress+1/SOLO_SELF_REVIVE_TICKS;
          d.progress=next>=1-EPS?1:next;
          if(d.progress>=1){
            rise(ctx,p);soloChances--;rising=false;
            ctx.emit({type:'revived',player:p.id});
          }
          continue;
        }
        // An offline downed player cannot be picked up; they still bleed out.
        // The viaduct (maps city/viaduct.ts): a rescuer on the other floor (over or under the deck) is not beside them.
        const near=p.online&&!p.spectator?rescuers.filter(r=>r.id!==p.id&&floorOf(r)===floorOf(p)&&Math.hypot(r.x-p.x,r.y-p.y)<=REVIVE_RADIUS+EPS):[];
        const rates=near.map(r=>({r,rate:reviveRate(r)})).filter(e=>e.rate>0).sort((a,b)=>b.rate-a.rate||byId(a.r,b.r));
        if(rates.length){
          const weight=rates.reduce((n,e,i)=>n+e.rate*(i?EXTRA_RESCUER_WEIGHT:1),0);
          const next=d.progress+weight/REVIVE_TICKS;
          d.progress=next>=1-EPS?1:next;
        }else d.progress=Math.max(0,d.progress-REVIVE_DECAY_PER_TICK);
        if(d.progress>=1){
          rise(ctx,p);
          for(const {r} of rates)revives.set(r.id,(revives.get(r.id)??0)+1);
          // Rescuers are fixed for this tick, so the revived player only helps others from the next one.
          ctx.emit({type:'revived',player:p.id,by:rates[0].r.id});
        }else if(ctx.tick>=d.bleedOutTick){
          p.downed=undefined;
          p.hp=0;
          p.eliminated=true;
          ctx.emit({type:'eliminated',player:p.id});
        }
      }
      if(rising||!teamDefeated(ctx)){outSince=undefined;return;}
      outSince??=ctx.tick;
      // The first out tick counts: with grace N the defeat fires on the Nth consecutive out tick.
      if(players.some(droppedStanding)&&ctx.tick-outSince+1<grace)return;
      defeated=true;
      options.onTeamDefeated?.(ctx);
    },
  };
}

// ---------- Zueira: pt-BR quips for HUD/render, picked from the event alone ----------
export const DOWNED_LINES=[
  'Caiu igual boleto no fim do mês!',
  'Deitou pra descansar… no meio da horda.',
  'Tropeçou num bêbado. Clássico.',
  'Cochilo estratégico, juro.',
  'Desmaiou de tanto ouvir piada de pavê.',
  'Cobrado pelo agiota da vida.',
] as const;
export const REVIVED_LINES=[
  'Levanta, que o pavê não acabou!',
  'Voltou mais forte que café requentado.',
  'Ressuscitou no capítulo final da novela.',
  'Resgate entregue, frete grátis!',
  'Acordou achando que era segunda-feira.',
  'Volta que o boleto vence hoje!',
] as const;
export const ELIMINATED_LINES=[
  'Foi assistir da arquibancada.',
  'Virou comentarista da partida.',
  'Saiu pra comprar pão. Volta na próxima.',
  'Agora é só torcida organizada.',
] as const;

/**
 * Deterministic quip for a downed/revived/eliminated event, keyed by the event's eventId from
 * RunView: every client shows the same line without text going over the wire.
 */
export function reviveQuip(kind:'downed'|'revived'|'eliminated',playerId:string,eventId:number){
  const lines=kind==='downed'?DOWNED_LINES:kind==='revived'?REVIVED_LINES:ELIMINATED_LINES;
  let h=0x811c9dc5^(eventId>>>0);
  for(const c of kind+':'+playerId)h=Math.imul(h^c.charCodeAt(0),0x01000193);
  h=Math.imul(h^h>>>16,0x7feb352d);h^=h>>>15;
  return lines[(h>>>0)%lines.length];
}
