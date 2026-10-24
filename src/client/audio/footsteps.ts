/**
 * Footsteps as in games (NEW-20261022-ORQ-sons-ia-ace-step, explained to the user 23/10): no loop, one short step each
 * time a foot lands. BUG-20261024-ORQ-som-passos-fora-do-eixo: the steps counted a walk cycle of their own (the legacy
 * walk's stride, RUN_STRIDE for a run) while the M16 run is drawn at its phase table's stride (1.89 to 3.78 heights by
 * direction), so a run stepped 1.5 to 3× the drawn feet, off their beat. Now each step is the drawn walk's own
 * (CharacterSprites.gait): the cycles the sprite walked and the points where its sheet plants a foot, played the audio's
 * output latency ahead (the foot and the crunch land together on a phone too). Each step draws one of the 6 snow takes,
 * never the last one again (the engine, which starts each at its crunch and evens their level: sfx.ts alignTake), at
 * ±5 % of pitch and ±1.5 dB. The local hero at full volume and centred; allies lower, quieter with distance and from
 * their side of the screen; critters none (the horde would be noise), only the boss's heavy steps. A run is a bit louder.
 */
import type {Gait} from '../sprites/character-sprites.ts';
import {WALK_HOLD_MS} from '../sprites/sprite-motion.ts';
import type {PlayOptions} from './engine.ts';
import type {SoundId} from './types.ts';

/** ±5 % of pitch and ±1.5 dB of level per step (the takes themselves are evened by the engine). */
export const STEP_PITCH=.05,STEP_DB=1.5;
/** A run lands harder: this much over the walk's level. */
export const RUN_GAIN=1.25;
/** Allies under the local hero, and how their steps fade (world tiles): 1 / (1 + d / ALLY_FALLOFF), none past ALLY_RANGE. */
export const ALLY_GAIN=.4,ALLY_FALLOFF=5,ALLY_RANGE=14;
/** How far to the side an ally at the screen's edge sounds (the pan, -1..1). */
export const ALLY_PAN=.6;
/** The boss's step every this many ms while it moves, heard up to BOSS_RANGE tiles. */
export const BOSS_STEP_MS=520,BOSS_RANGE=18;
/** Never two steps of one figure closer than this (a stop-and-go on the stick). */
export const MIN_STEP_MS=140;
/** The latency is made up by playing ahead along the walk, at most this much of a cycle (a stop never owes a step). */
export const MAX_LEAD_CYCLES=.2;

/** Contacts the cycle crossed going from `from` to `to` cycles (each contact once per cycle; at most 2 a frame). */
export function contactsCrossed(from:number,to:number,contacts:readonly number[]){
  if(!(to>from))return 0;
  let n=0;
  for(const c of contacts)n+=Math.floor(to-c)-Math.floor(from-c);
  return Math.min(2,n);
}
/** The step's own pitch and level, drawn from rnd() in [0, 1). */
export function stepJitter(rnd:()=>number,gain=1):Required<Pick<PlayOptions,'rate'|'gain'>>{
  const db=(rnd()*2-1)*STEP_DB;
  return {rate:1+(rnd()*2-1)*STEP_PITCH,gain:gain*10**(db/20)};
}
/** An ally's level at `d` tiles from the hero; 0 out of earshot. */
export function allyGain(d:number){return d>ALLY_RANGE?0:ALLY_GAIN/(1+d/ALLY_FALLOFF);}

export interface StepFigure {
  id:string;
  /** The walk as this frame drew it (CharacterSprites.gait); undefined while the figure stands or is not drawn. */
  gait?:Gait;
  /** The local hero: full level, centred. */
  local?:boolean;
  /** Runs (run16, movement128 heroRuns): a louder step. */
  runs?:boolean;
  /** Level before the jitter (allyGain for an ally). */
  gain:number;
  alive:boolean;
  /** Where the figure is across the screen (-1 left … 1 right, Scene.screenSide): an ally's step comes from there. */
  side?:number;
}
interface Track {since:number;cycles:number;at:number;rate:number;ahead:number;lastStep:number}
interface StepAudio {play(id:SoundId,opts?:PlayOptions):boolean;readonly latencyMs?:number}

/** Plays a step each time a figure's drawn walk crosses a contact of its sheet (the latency ahead). */
export class Footsteps {
  private tracks=new Map<string,Track>();
  private bossAt=-Infinity;
  private bossPos:{x:number;y:number}|undefined;
  /** The boss walks until then (its view moves at the server's rate, so it is held a little between views). */
  private bossMoving=-Infinity;
  private readonly audio:StepAudio;
  private readonly rnd:()=>number;
  constructor(audio:StepAudio,rnd:()=>number=Math.random){this.audio=audio;this.rnd=rnd;}

  /** One frame (`now` in ms): each figure's drawn walk; a new `since` is a new walk. Returns the steps played. */
  update(now:number,figures:Iterable<StepFigure>):number{
    let played=0;
    const seen=new Set<string>(),lead=Math.max(0,this.audio.latencyMs??0);
    for(const f of figures){
      seen.add(f.id);
      const g=f.alive?f.gait:undefined;
      let t=this.tracks.get(f.id);
      if(!g){if(t)t.since=NaN;continue;}
      let crossed:number;
      if(!t||t.since!==g.since){
        // A walk starts on pose 0, a foot on the ground: its first step sounds at once.
        const lastStep=t?.lastStep??-Infinity;
        t={since:g.since,cycles:g.cycles,at:now,rate:0,ahead:g.cycles,lastStep};this.tracks.set(f.id,t);
        crossed=1;
      }else{
        const dt=now-t.at;
        if(dt>0&&g.cycles>=t.cycles){const rate=(g.cycles-t.cycles)/dt;t.rate=t.rate>0?t.rate*.6+rate*.4:rate;}
        t.cycles=g.cycles;t.at=now;
        const ahead=g.cycles+Math.min(MAX_LEAD_CYCLES,t.rate*lead);
        crossed=contactsCrossed(t.ahead,ahead,g.contacts);
        if(ahead>t.ahead)t.ahead=ahead;
      }
      if(crossed>0&&f.gain>0&&now-t.lastStep>=MIN_STEP_MS){
        t.lastStep=now;
        const pan=f.local?0:(f.side??0)*ALLY_PAN;
        if(this.audio.play('passo-neve',{...stepJitter(this.rnd,f.gain*(f.runs?RUN_GAIN:1)),...(pan?{pan}:{})}))played++;
      }
    }
    for(const id of this.tracks.keys())if(!seen.has(id))this.tracks.delete(id);
    return played;
  }

  /**
   * The boss's heavy step while it moves (`boss` undefined: none alive), quieter away from `hero`, none out of earshot,
   * from its side of the screen (`side`, -1..1).
   */
  boss(now:number,boss:{x:number;y:number}|undefined,hero:{x:number;y:number},side=0){
    const last=this.bossPos;
    this.bossPos=boss&&{x:boss.x,y:boss.y};
    if(!boss||!last)return false;
    if(Math.hypot(boss.x-last.x,boss.y-last.y)>.001)this.bossMoving=now+WALK_HOLD_MS*3;
    const distance=Math.hypot(boss.x-hero.x,boss.y-hero.y);
    if(now>=this.bossMoving||distance>BOSS_RANGE||now-this.bossAt<BOSS_STEP_MS)return false;
    this.bossAt=now;
    const pan=side*ALLY_PAN;
    return this.audio.play('chefe-passo',{gain:1/(1+distance/8),...(pan?{pan}:{})});
  }

  reset(){this.tracks.clear();this.bossAt=-Infinity;this.bossPos=undefined;this.bossMoving=-Infinity;}
}
