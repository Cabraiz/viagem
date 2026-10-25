/**
 * The run as the room tells it to the phones (RunState on the wire, protocol 3 snapshots and protocol 4 control):
 * lobby → countdown → combat → result. The lifecycle that drives it is src/sim/run.ts (RunLifecycle); the shame
 * moment of the result is picked by src/sim/shame.ts (ShameTracker).
 */
import type {ObjectiveResult} from './objective.ts';
/** Shame moment kinds of the result (VGM-053B). */
export type ShameKey='recaida'|'apagao'|'coxinha'|'pombos'|'cedo'|'sem-boleto'|'coxinha-cheia'|'caiu';
/** The run's most embarrassing moment, shown in the result. */
export interface ShameMoment {
  player:string;key:ShameKey;round:number;tick:number;
  /** Critter kind behind a fall. */
  source?:string;
  /** recaida: seconds between the rescue and the new fall. */
  seconds?:number;
}

export type RunPhase='lobby'|'countdown'|'combat'|'result';
export type RunOutcome='victory'|'defeat'|'timeout';
/** `bot`: a room bot (D-025): played by the room itself, always online and ready, never holds the start. */
export interface RunMember {id:string;online:boolean;ready:boolean;spectator:boolean;bot?:true}
export interface RunState {
  round:number;phase:RunPhase;elapsed:number;remaining:number;
  members:RunMember[];outcome?:RunOutcome;resultId?:string;
  /** Result only (VGM-053B): the run's most embarrassing moment, from the simulation. */
  shame?:ShameMoment;
  /** The room's owner ("dono da sala", D-025; "chefe" is the boss of the game): the only one whose kick and bot commands the room accepts. */
  owner?:string;
  /** Result only, chaveiro objective (D-047): the bill (budget, paid, debt), the car and the chaveiro's ETA. */
  objective?:ObjectiveResult;
  /**
   * D-050, combat only: the run is paused for the team to pick its level-up cards (the room does not step the sim).
   * leftMs/totalMs: what is left of the pause's deadline and the whole of it (12 s, +4 s per extra level, at most 20 s);
   * level: the team level that opened it; waiting: the players the room still waits for (humans online with a card).
   * D-052: skips / rerolls, per player id, the "Pular" and "Rolar de novo" each one has left this run (absent from an
   * older room: the buttons stay off).
   */
  pause?:RunPause;
  /**
   * Result only (UX-resultado-revanche): who said "topa" to the rematch (people online; bots never vote). Absent from an
   * older room: the first tap starts the rematch, as before.
   */
  rematchVotes?:string[];
  /** Result only: ticks until the majority's rematch starts without the rest (present while the votes are a majority). */
  rematchLeft?:number;
  /**
   * Combat only, mode 'ninhos' (card monstros-espalhados, the user 22/10): the simulation tick the "minuto de Minerva"
   * ends at (no critter walks nor chases before it; sim/ninhos/ninhos.ts NestsState.minervaUntil). Present while the
   * {t:'run'} tick is before it; the HUD's clock reads (minervaAteTick − frame tick) / 20 s. Absent: no Minerva.
   */
  minervaAteTick?:number;
  /**
   * Combat only, mode 'ninhos' (card boss-fim-onda-1): the chefão's arrival scene. The room does not step the sim while
   * it lasts (like `pause`: nobody moves nor takes damage); every phone takes its camera to him and back
   * (rules/chefao-onda.ts CENA). Present while it lasts; sent when it opens and at each whole second of leftMs.
   */
  cena?:RunCena;
  /**
   * Combat only, mode 'ninhos' (card inicio-no-uno-caixas-120): the time to explore after a wave (sim/ninhos/ninhos.ts
   * NestsState.exploreFrom/exploreUntil, NEST_PACE.explore): its first tick and its end, when the next wave leaves.
   * Present while the {t:'run'} tick is inside it; the HUD shows the same clock and "Você tem 2 minutos…".
   */
  exploraDesdeTick?:number;exploraAteTick?:number;
}
/**
 * The chefão's arrival (RunState.cena): who (a WAVE_BOSSES roster id: the name and the subtitle are the client's, rules),
 * his enemy id and where he appeared, the scene's clock (ms) and the tick it froze on.
 */
export interface RunCena {who:string;enemy:string;x:number;y:number;leftMs:number;totalMs:number;tick:number}
export interface RunPause {leftMs:number;totalMs:number;level:number;waiting:string[];skips?:Record<string,number>;rerolls?:Record<string,number>}
