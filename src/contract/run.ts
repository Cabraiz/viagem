/**
 * The run as the room tells it to the phones (RunState on the wire, protocol 3 snapshots and protocol 4 control):
 * lobby → countdown → combat → result. The lifecycle that drives it is src/sim/run.ts (RunLifecycle); the shame
 * moment of the result is picked by src/sim/shame.ts (ShameTracker).
 */
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
}
