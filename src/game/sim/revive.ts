/**
 * Downed, revive and team defeat (VGM-037).
 * The core calls downPlayer when a player's hp reaches 0. The 'revive' system advances rescue
 * progress, bleeds out downed players and reports the common defeat exactly once.
 */
import type {SimContext,SimPlayer,SimSystem} from './types.ts';
import {ticks} from './types.ts';

export const BLEED_OUT_TICKS=ticks(30);
export const REVIVE_RADIUS=1.2;
export const REVIVE_TICKS=ticks(3);
export const REVIVE_HP_FRACTION=.4;
export const REVIVE_INVULNERABLE_TICKS=ticks(2);
/** Without a rescuer in range, progress falls back at the base revive speed. */
export const REVIVE_DECAY_PER_TICK=1/REVIVE_TICKS;
/**
 * A player who dropped while on their feet may be back soon (VGM-047). While one of them is
 * missing and nobody else stands, the defeat waits this long instead of latching on a 1-tick lag.
 */
export const RECONNECT_GRACE_TICKS=ticks(5);
/** Weight of each rescuer after the strongest one: more allies speed it up, with diminishing returns. */
export const EXTRA_RESCUER_WEIGHT=.5;

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
export function downPlayer(ctx:SimContext,player:SimPlayer,by?:string){
  if(player.spectator||player.downed||player.eliminated)return false;
  player.hp=0;
  player.target=undefined;
  player.invulnerableUntil=undefined;
  player.downed={sinceTick:ctx.tick,bleedOutTick:ctx.tick+BLEED_OUT_TICKS,progress:0};
  ctx.emit(by===undefined?{type:'downed',player:player.id}:{type:'downed',player:player.id,by});
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
}

export interface ReviveSystem extends SimSystem {
  readonly id:'revive';
  /** Completed revives credited to each rescuer in range at completion. */
  readonly revives:ReadonlyMap<string,number>;
  readonly defeated:boolean;
}

/** Absorbs float drift so the boundary (exactly 1.2 away, exactly 3 s) counts. */
const EPS=1e-9;
const byId=(a:SimPlayer,b:SimPlayer)=>a.id<b.id?-1:a.id>b.id?1:0;
/** NaN, zero and negative cannot revive; Infinity revives instantly. */
const reviveRate=(p:SimPlayer)=>{const r=p.stats.revive;return r>0?r:0;};
const revivedHp=(p:SimPlayer)=>{const m=p.stats.maxHp;return Number.isFinite(m)&&m>0?Math.max(1,Math.ceil(m*REVIVE_HP_FRACTION)):1;};
const droppedStanding=(p:SimPlayer)=>!p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

export function createReviveSystem(options:ReviveOptions={}):ReviveSystem{
  const revives=new Map<string,number>();
  const pauseInPrepare=options.pauseBleedInPrepare??true;
  const grace=options.reconnectGraceTicks??RECONNECT_GRACE_TICKS;
  let defeated=false,outSince:number|undefined;
  return {
    id:'revive',
    get revives(){return revives;},
    get defeated(){return defeated;},
    step(ctx){
      if(defeated||options.runEnded?.())return;
      const players=[...ctx.players.values()].sort(byId);
      const rescuers=players.filter(isStanding);
      const paused=pauseInPrepare&&ctx.round.phase==='prepare';
      for(const p of players){
        const d=p.downed;
        if(!d||p.eliminated)continue;
        // Turned spectator while down: they left the run, so drop the frozen downed state instead of
        // eliminating them when they come back.
        if(p.spectator){p.downed=undefined;continue;}
        if(paused)d.bleedOutTick++;
        // An offline downed player cannot be picked up; they still bleed out.
        const near=p.online&&!p.spectator?rescuers.filter(r=>r.id!==p.id&&Math.hypot(r.x-p.x,r.y-p.y)<=REVIVE_RADIUS+EPS):[];
        const rates=near.map(r=>({r,rate:reviveRate(r)})).filter(e=>e.rate>0).sort((a,b)=>b.rate-a.rate||byId(a.r,b.r));
        if(rates.length){
          const weight=rates.reduce((n,e,i)=>n+e.rate*(i?EXTRA_RESCUER_WEIGHT:1),0);
          const next=d.progress+weight/REVIVE_TICKS;
          d.progress=next>=1-EPS?1:next;
        }else d.progress=Math.max(0,d.progress-REVIVE_DECAY_PER_TICK);
        if(d.progress>=1){
          p.downed=undefined;
          p.hp=revivedHp(p);
          p.invulnerableUntil=ctx.tick+REVIVE_INVULNERABLE_TICKS;
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
      if(!teamDefeated(ctx)){outSince=undefined;return;}
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
  'Escorregou na gosma. Clássico.',
  'Cochilo estratégico, juro.',
  'Desmaiou de tanto ouvir piada de pavê.',
  'Foi multado pelo fiscal da vida.',
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
