/**
 * D-050 (NEW-20261014-ORQ-levelup-pausa-time): when the team levels up in a wave, the run PAUSES for everyone to pick
 * their card, like Stonewards, instead of holding the offer to the intermission (D-021's chip). The room simply does
 * not step the simulation while paused: every combat deadline is an absolute tick (telegraphs, the boss, bleed-outs,
 * statuses, towers, the chaveiro's alarm) and the tick only moves in SimWorld.step, so nothing has to be shifted.
 *
 *  - opens: in combat (anything but an intermission: D-051 drops the rounds, so it never asks for a 'wave'), when a human online or a room bot has an offer, and PAUSE_GAP_TICKS of combat went by since the
 *    last pause (levels in between wait for the next one); one pause takes every level queued;
 *  - waits for: humans online with an offer (downed ones too: a card does not need standing); room bots pick their
 *    defaults after BOT_PICK_MS (a reaction, so a pause with only bots still shows);
 *  - offline players are neither waited for nor settled: their offers stay held as before D-050 (a phone on 3G back in
 *    a few seconds keeps its pick, and a pause opens for it once back, after the gap);
 *  - ends: when nobody is left waiting, or at its deadline (PAUSE_FIRST_MS, + PAUSE_EXTRA_MS per extra level, at most
 *    PAUSE_MAX_MS): the humans online who did not pick and the bots get the defaults, then the sim steps again;
 *  - the intermission keeps today's rule (offers due at its end): the game is not running there anyway.
 * Wall clock (ms, the room's `now`), not ticks: the sim's tick is what stands still.
 */
import type {RunPause} from '../src/contract/index.ts';
import {SIM_HZ} from '../src/contract/index.ts';

export const PAUSE_FIRST_MS=12_000,PAUSE_EXTRA_MS=4_000,PAUSE_MAX_MS=20_000;
/**
 * Combat between two pauses (30 s): a busy late game would otherwise stop every few seconds. levelup-espalhado: was 20 s,
 * which in a nest burst (5-6 levels in ~100 s) opened a pause every 20 s; at 30 s the levels in between join the next
 * pause (one pause, "+2 escolhas").
 */
export const PAUSE_GAP_TICKS=30*SIM_HZ;
/** A room bot's reaction in a pause. */
export const BOT_PICK_MS=1_000;

/** What the pause needs of the room's simulation (Simulation implements it; tests use a fake). */
export interface PauseSim {
  readonly tick:number;
  readonly world:{round?:{phase:string};team:{level:number}};
  readonly players:ReadonlyMap<string,{online:boolean;spectator?:boolean;eliminated?:boolean}>;
  readonly bots:ReadonlySet<string>;
  pendingOffers():Map<string,number>;
  settleOffers(id:string):number;
}
/** Deadline of a pause whose longest queue is `levels` cards. */
export const pauseMs=(levels:number)=>Math.min(PAUSE_MAX_MS,PAUSE_FIRST_MS+PAUSE_EXTRA_MS*Math.max(0,levels-1));

interface Open {startedAt:number;totalMs:number;level:number}
export class LevelupPause {
  private open?:Open;
  /** Tick the last pause ended on (the gap counts combat ticks from there). */
  private lastEndTick=-Infinity;
  /** A new run: no pause, no gap. */
  reset(){this.open=undefined;this.lastEndTick=-Infinity;}
  get paused(){return !!this.open;}
  /**
   * Per room tick in combat, before the sim would step. Returns true when the sim must NOT step this tick. `now`: the
   * room's wall clock (ms).
   */
  update(sim:PauseSim,now:number):boolean{
    this.drop(sim);
    if(!this.open){
      if(sim.world.round?.phase==='prepare'||sim.tick-this.lastEndTick<PAUSE_GAP_TICKS)return false;
      const pending=[...sim.pendingOffers()].filter(([id])=>this.acts(sim,id));
      if(!pending.length)return false;
      this.open={startedAt:now,totalMs:pauseMs(Math.max(...pending.map(([,n])=>n))),level:sim.world.team.level};
    }
    const open=this.open;
    // Room bots pick their defaults after their reaction.
    if(now-open.startedAt>=BOT_PICK_MS)for(const id of [...sim.pendingOffers().keys()])if(sim.bots.has(id))sim.settleOffers(id);
    if(this.waiting(sim).length&&now-open.startedAt<open.totalMs)return true;
    if(this.waiting(sim).length===0&&[...sim.pendingOffers().keys()].some(id=>sim.bots.has(id)))return true; // bots still reacting
    this.close(sim);
    return false;
  }
  /** Humans online, in the game, with a card left: who the pause waits for. */
  waiting(sim:PauseSim):string[]{
    const out:string[]=[];
    for(const id of sim.pendingOffers().keys()){const p=sim.players.get(id);if(p&&p.online&&!p.spectator&&!p.eliminated&&!sim.bots.has(id))out.push(id);}
    return out.sort();
  }
  /** A player the pause acts on: a room bot, or a human online in the game (an offline one keeps its offers held). */
  private acts(sim:PauseSim,id:string){const p=sim.players.get(id);return !!p&&!p.spectator&&!p.eliminated&&(sim.bots.has(id)||p.online);}
  /**
   * Offers nobody can pick (a spectator, someone eliminated: progression runs before revive, so a level and a bleed-out
   * on one tick leave one that choose() refuses) are dropped (settle() does) rather than opening or holding a pause.
   */
  private drop(sim:PauseSim){for(const id of [...sim.pendingOffers().keys()]){const p=sim.players.get(id);if(p&&(p.spectator||p.eliminated))sim.settleOffers(id);}}
  /**
   * Ends the pause: the humans online who did not pick and the bots get the defaults. Input tracks stay as they are: the
   * tick did not move, so the steps queued before the pause are taken on the very ticks the phones predicted them for.
   */
  private close(sim:PauseSim){
    for(const id of [...sim.pendingOffers().keys()])if(this.acts(sim,id))sim.settleOffers(id);
    this.open=undefined;this.lastEndTick=sim.tick;
  }
  /** For RunState.pause (whole ms left, never negative); undefined when not paused. */
  view(sim:PauseSim,now:number):RunPause|undefined{
    const o=this.open;if(!o)return undefined;
    return {leftMs:Math.max(0,Math.round(o.totalMs-(now-o.startedAt))),totalMs:o.totalMs,level:o.level,waiting:this.waiting(sim)};
  }
}
