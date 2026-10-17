/**
 * Sleepers of the nests (card NEW-20261016-ORQ-ninhos-arte-render, D-051 A1), pure: which enemies loop `sleep` and
 * which play `wake` once (the imported `inimigos` sheets; art/horde-art.ts plays them, a piece without them keeps
 * its idle/walk).
 *
 * - Asleep: an enemy sent with `asleep:true` (E2, ninhos-sim: sleepers in RunView.enemies within the interest radius,
 *   at most 48 per player) loops `sleep`; read by its field (isAsleep) until the contract on main has it.
 * - Waking: sono.ts moves the woken bodies into the enemies and emits ONE `acordou {x, y, n}` at their centre, so in
 *   that view they are new actors around (x, y): the n nearest new ones within WAKE_RADIUS play `wake`. An actor
 *   that was asleep in the previous view and is awake now also plays it (the same moment seen from inside the view).
 */

/** How far from the event's centre a woken body may stand (world units): a band within sono.ts BAND_RADIUS (4) of
 * each other, the centre in the middle; a nest's sleepers spread over its radius (≤ 3.5), so 8 covers both. */
export const WAKE_RADIUS=8;
/** The `acordou` event (contract SimEvent on the ninhos branch; read by its fields so main's contract compiles). */
export interface WakeEvent {type:'acordou';x:number;y:number;n:number}
export const isAsleep=(e:object)=>(e as {asleep?:unknown}).asleep===true;
/** The loop of an enemy: `sleep` while asleep, else its acting pose (phase-look.ts actAnim) or none. */
export const sleepOrAct=(asleep:boolean,act:string|undefined)=>asleep?'sleep':act;
export const isWakeEvent=(e:{type:string}):e is WakeEvent=>e.type==='acordou'&&typeof (e as WakeEvent).n==='number';

/**
 * The ids that play `wake` for one `acordou`: among `fresh` (actors new in this view), the `n` nearest to (x, y) within
 * WAKE_RADIUS, nearest first (ties by id, so every client picks the same).
 */
export function wakeTargets(e:WakeEvent,fresh:readonly {id:string;x:number;y:number}[]):string[]{
  const near=fresh.map(a=>({id:a.id,d:Math.hypot(a.x-e.x,a.y-e.y)})).filter(a=>a.d<=WAKE_RADIUS)
    .sort((a,b)=>a.d-b.d||(a.id<b.id?-1:a.id>b.id?1:0));
  return near.slice(0,Math.max(0,Math.floor(e.n))).map(a=>a.id);
}
