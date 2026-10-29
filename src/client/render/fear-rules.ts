/**
 * Fear on the screen (card NEW-20261023-ORQ-fear-escuridao-sozinho, etapa 3; numbers of the sim in rules/fear.ts): the
 * client only draws the server's fear 0..1 (PlayerRunView.fear) of its own hero.
 * - the dark: from FEAR_SHOW_SECONDS alone a vignette closes in from the edges (the clear circle around the hero shrinks,
 *   the dark thickens); over the last FEAR_FINAL_SECONDS only a small circle is left and it throbs with a heartbeat;
 * - the safe spots: the allies on their feet and the Uno keep a warm light in the dark (their company radius);
 * - the way back: an arrow by the hero to the nearest safe spot, the notice "Não se afaste do bando" the first time
 *   (right at the start too: a solo hero is born away from the Uno), the allies' portraits dimmed while alone and, over
 *   the last stretch, the hero's own line in a balloon over the head (card heroi-fala-cade-amigos: no top notice then).
 * Pure (no Phaser, no DOM): node tests pin the curve, the beat, the company and the notices.
 */
import {FEAR_SECONDS,FEAR_SHOW_SECONDS,FEAR_FINAL_SECONDS,FEAR_ALLY_RADIUS,FEAR_BASE_RADIUS} from '../../rules/index.ts';

export interface Pt {x:number;y:number}

/**
 * The clear circle around the hero (fraction of the screen's half diagonal): first dark, start of the last stretch, end.
 * The dark is full a little over twice that far out (render/fear-dark.ts DARK_RAMP): at the start the corners already
 * read dark, at the end only a small circle is left.
 */
export const FEAR_HOLE={start:.42,final:.22,end:.11} as const;
/** The dark's opacity at the same three moments. */
export const FEAR_ALPHA={start:.55,final:.93,end:.985} as const;
/** The dark fades in over this long after FEAR_SHOW_SECONDS (s): no pop. */
export const FEAR_FADE_S=1;
/** Heartbeats per minute over the last stretch, first second → last. */
export const FEAR_BPM={from:72,to:140} as const;
/** How much a beat pulls the circle in (fraction of its radius). */
export const FEAR_BEAT_PULL=.1;
/** The received fear is eased with this time constant (s; a third of it backing off): the wire's 1/255 steps and the 2 s retreat stay smooth. */
export const FEAR_EASE_S=.2;
/** The arrow, the notice and the dimmed portraits come after this many seconds alone (before the dark itself). */
export const FEAR_ARROW_SECONDS=1;
/** The first notice stays this long (ms). */
export const FEAR_WARN_MS=5000;
export const FEAR_WARN_TEXT='Não se afaste do bando';
/** The hero's own line over the last stretch (card heroi-fala-cade-amigos), once per stretch alone; short (≤ ~20). */
export const FEAR_SAY_TEXT='Cadê meus amigos?';
/** The arrow steps aside this long after the line (ms; the balloon's life, layers.ts BUBBLE_MS): it would cross the text. */
export const FEAR_SAY_MS=2200;

const clamp01=(v:number)=>v<0?0:v>1?1:v;
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(t:number)=>t*t*(3-2*t);

export interface FearLook {
  /** Opacity of the dark, 0 = none. */
  alpha:number;
  /** The clear circle's radius, fraction of the screen's half diagonal (before the beat). */
  hole:number;
  /** Progress through the last stretch, 0..1 (0 before it). */
  final:number;
}
/** The dark for `seconds` alone (fear × FEAR_SECONDS). */
export function fearLook(seconds:number):FearLook{
  if(!(seconds>FEAR_SHOW_SECONDS))return {alpha:0,hole:FEAR_HOLE.start,final:0};
  const finalAt=FEAR_SECONDS-FEAR_FINAL_SECONDS;
  const fade=clamp01((seconds-FEAR_SHOW_SECONDS)/FEAR_FADE_S);
  if(seconds<finalAt){
    // Gentle at first (the edges only), then faster: the player has time to notice before it closes in.
    const t=smooth(clamp01((seconds-FEAR_SHOW_SECONDS)/(finalAt-FEAR_SHOW_SECONDS)));
    return {alpha:fade*lerp(FEAR_ALPHA.start,FEAR_ALPHA.final,t),hole:lerp(FEAR_HOLE.start,FEAR_HOLE.final,t),final:0};
  }
  const u=clamp01((seconds-finalAt)/FEAR_FINAL_SECONDS);
  return {alpha:fade*lerp(FEAR_ALPHA.final,FEAR_ALPHA.end,u),hole:lerp(FEAR_HOLE.final,FEAR_HOLE.end,u),final:u};
}
/** Beats per minute at `final` (0..1) through the last stretch. */
export const fearBpm=(final:number)=>lerp(FEAR_BPM.from,FEAR_BPM.to,clamp01(final));
/** The heartbeat's shape at phase p (0..1 of one beat): a strong "lub" at 0, a softer "dub" at .28, both fading fast. */
export function heartPulse(p:number):number{
  const q=p-Math.floor(p),lub=Math.exp(-q/.06),d=q-.28,dub=d<0?0:.6*Math.exp(-d/.07);
  return Math.min(1,lub+dub);
}

/** One body on the map (a wire player: PlayerWireView, or the interpolated Player). */
export interface FearBody {id:string;x?:number;y?:number;hp:number;downed?:unknown;eliminated?:boolean;spectator?:boolean}
/** A safe spot: an ally on their feet (FEAR_ALLY_RADIUS) or the Uno (FEAR_BASE_RADIUS); `gap` = distance to its edge. */
export interface SafeSpot {kind:'aliado'|'uno';id?:string;x:number;y:number;radius:number;gap:number}
/** Same company as the sim (sim/fear.ts): standing, not out, not watching. Offline ones may be on autopilot: they count. */
export const fearCompany=(p:FearBody)=>!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0&&p.x!==undefined&&p.y!==undefined;
/** Every safe spot around `self`, nearest edge first. */
export function safeSpots(selfId:string,self:Pt,players:Iterable<FearBody>,uno?:Pt):SafeSpot[]{
  const out:SafeSpot[]=[];
  for(const p of players){
    if(p.id===selfId||!fearCompany(p))continue;
    const x=p.x!,y=p.y!;
    out.push({kind:'aliado',id:p.id,x,y,radius:FEAR_ALLY_RADIUS,gap:Math.hypot(x-self.x,y-self.y)-FEAR_ALLY_RADIUS});
  }
  if(uno)out.push({kind:'uno',x:uno.x,y:uno.y,radius:FEAR_BASE_RADIUS,gap:Math.hypot(uno.x-self.x,uno.y-self.y)-FEAR_BASE_RADIUS});
  return out.sort((a,b)=>a.gap-b.gap);
}

export interface FearNotice {text:string}
export interface FearFrame {
  /** Seconds alone as drawn (eased). */
  seconds:number;
  look:FearLook;
  /** The heartbeat's pull now, 0..1 (0 outside the last stretch and with reduced motion). */
  beat:number;
  /** A new heartbeat starts this frame (the sound plays it). */
  thump:boolean;
  /** The dark is growing (alone): the arrow, the notice and the dimmed portraits show. */
  alone:boolean;
  notice?:FearNotice;
  /** The hero says this over the head, this frame only: once each time the last stretch is reached alone. */
  say?:string;
  /** The hero's line is on screen (FEAR_SAY_MS): the arrow waits, the balloon is the cue. */
  saying:boolean;
}

/**
 * The client's clock of the dark, one per run screen: eases the wire value, tells growing from backing off, runs the
 * heartbeat, the notice and the hero's line. `reset` for a new run (the first notice comes back).
 */
export class FearClock {
  private eased=0;
  private last=0;
  private rising=false;
  private phase=0;
  private warnedAt=-Infinity;
  private warned=false;
  /** The hero's line was said in this stretch alone: not again until company is found (the fear backs off). */
  private said=false;
  private saidAt=-Infinity;
  /** One frame: `raw` the server's fear 0..1 (0 when not in combat, down or out), `dtMs` since the last frame. */
  step(raw:number,dtMs:number,nowMs:number,reduced=false):FearFrame{
    // Up to 2 s a frame: a slow phone (a few frames a second) still catches up with the wire within a frame or two.
    const value=clamp01(Number.isFinite(raw)?raw:0),dt=Math.max(0,Math.min(dtMs,2000))/1000;
    if(value>this.last)this.rising=true;else if(value<this.last||value===0)this.rising=false;
    this.last=value;
    // Ease toward the wire, but never lag behind a fall to 0 by more than a moment (company found: the dark goes).
    const tau=value<this.eased?FEAR_EASE_S/3:FEAR_EASE_S;
    this.eased=dt>0?this.eased+(value-this.eased)*(1-Math.exp(-dt/tau)):value;
    if(value===0&&this.eased<.002)this.eased=0;
    const seconds=this.eased*FEAR_SECONDS,look=fearLook(seconds);
    let thump=false,beat=0;
    if(look.final>0){
      // The first beat lands as the last stretch starts, then one per period.
      const before=this.phase;
      this.phase+=Math.max(dt,1e-6)*fearBpm(look.final)/60;
      thump=before===0||Math.floor(this.phase)>Math.floor(before);
      beat=reduced?0:heartPulse(this.phase);
    }else this.phase=0;
    const alone=this.rising&&value*FEAR_SECONDS>=FEAR_ARROW_SECONDS;
    if(alone&&!this.warned){this.warned=true;this.warnedAt=nowMs;}
    const notice:FearNotice|undefined=value>0&&nowMs-this.warnedAt<FEAR_WARN_MS?{text:FEAR_WARN_TEXT}:undefined;
    if(!this.rising)this.said=false;
    const say=look.final>0&&this.rising&&!this.said?FEAR_SAY_TEXT:undefined;
    if(say){this.said=true;this.saidAt=nowMs;}
    const saying=nowMs-this.saidAt<FEAR_SAY_MS;
    return {seconds,look,beat,thump,alone,saying,...notice?{notice}:{},...say?{say}:{}};
  }
  reset(){this.eased=0;this.last=0;this.rising=false;this.phase=0;this.warned=false;this.warnedAt=-Infinity;this.said=false;this.saidAt=-Infinity;}
}
