/**
 * Footsteps as in games (NEW-20261022-ORQ-sons-ia-ace-step, explained to the user 23/10): no loop, one short step each
 * time a foot lands, on the walk's contact poses: pose 0 and the middle one of SPRITE_CLIPS.walk (the run16 and M16
 * cycles plant the feet on the same halves). The cycle is counted as the sprites count it (sprite-motion.ts walkCycles:
 * the ground walked on screen over the drawn stride), so the steps keep the drawn feet's pace at any speed and a hero
 * standing still never treads. Each step draws one of the 6 snow takes, never the last one again (the engine), at ±5 %
 * of pitch and ±2 dB. The local hero at full volume; allies lower and quieter with distance; critters none (the horde
 * would be noise), only the boss's heavy steps. A run is the same step, a bit louder.
 */
import {RUN_STRIDE,SPRITE_CLIPS,WALK_HOLD_MS,WALK_STRIDE,WALK_TUNE,walkCycles} from '../sprites/sprite-motion.ts';
import type {PlayOptions} from './engine.ts';
import type {SoundId} from './types.ts';

/** Where in the walk cycle (0..1) a foot lands: pose 0 and the middle pose of the walk clip. */
export const STEP_CONTACTS:readonly number[]=[0,Math.floor(SPRITE_CLIPS.walk.frames.length/2)/SPRITE_CLIPS.walk.frames.length];
/** ±5 % of pitch and ±2 dB of level per step. */
export const STEP_PITCH=.05,STEP_DB=2;
/** A run lands harder: this much over the walk's level. */
export const RUN_GAIN=1.25;
/** Allies under the local hero, and how their steps fade (world tiles): 1 / (1 + d / ALLY_FALLOFF), none past ALLY_RANGE. */
export const ALLY_GAIN=.4,ALLY_FALLOFF=5,ALLY_RANGE=14;
/** The boss's step every this many ms while it moves, heard up to BOSS_RANGE tiles. */
export const BOSS_STEP_MS=520,BOSS_RANGE=18;
/** Never two steps of one figure closer than this (a stop-and-go on the stick). */
export const MIN_STEP_MS=140;

/** Contacts the cycle crossed going from `from` to `to` cycles (each contact once per cycle; at most 2 a frame). */
export function contactsCrossed(from:number,to:number,contacts:readonly number[]=STEP_CONTACTS){
  if(!(to>from))return 0;
  let n=0;
  for(const c of contacts)n+=Math.floor(to-c)-Math.floor(from-c);
  return Math.min(2,n);
}
/** The step's own pitch and level, drawn from rnd() in [0, 1). */
export function stepJitter(rnd:()=>number,gain=1):Required<PlayOptions>{
  const db=(rnd()*2-1)*STEP_DB;
  return {rate:1+(rnd()*2-1)*STEP_PITCH,gain:gain*10**(db/20)};
}
/** An ally's level at `d` tiles from the hero; 0 out of earshot. */
export function allyGain(d:number){return d>ALLY_RANGE?0:ALLY_GAIN/(1+d/ALLY_FALLOFF);}

export interface StepFigure {
  id:string;x:number;y:number;
  /** The local hero: full level, and it walks only while its input asks to (sprite-motion WalkGate). */
  local?:boolean;
  /** Runs (run16, movement128 heroRuns): the foot locked to the ground at the run's stride, a louder step. */
  runs?:boolean;
  /** Level before the jitter (allyGain for an ally). */
  gain:number;
  alive:boolean;
}
interface Track {x:number;y:number;cycles:number;until:number;lastStep:number}

/** Counts each figure's walk cycle frame by frame and plays a step on each contact. */
export class Footsteps {
  private tracks=new Map<string,Track>();
  private bossAt=-Infinity;
  private bossPos:{x:number;y:number}|undefined;
  /** The boss walks until then (its view moves at the server's rate, so it is held a little between views). */
  private bossMoving=-Infinity;
  private readonly audio:{play(id:SoundId,opts?:PlayOptions):boolean};
  private readonly rnd:()=>number;
  constructor(audio:{play(id:SoundId,opts?:PlayOptions):boolean},rnd:()=>number=Math.random){this.audio=audio;this.rnd=rnd;}

  /**
   * One frame: `figurePx` the heroes' drawn height in world px (96 × the actor scale × HERO_DRAW_SCALE), `view` the
   * camera's quarter turns. `intent`: whether the local hero's input asks to walk. Returns the steps played.
   */
  update(now:number,figures:Iterable<StepFigure>,view:number,figurePx:number,intent=true):number{
    let played=0;
    const seen=new Set<string>();
    for(const f of figures){
      seen.add(f.id);
      let t=this.tracks.get(f.id);
      if(!t){this.tracks.set(f.id,{x:f.x,y:f.y,cycles:0,until:-Infinity,lastStep:-Infinity});continue;}
      const dx=f.x-t.x,dy=f.y-t.y;t.x=f.x;t.y=f.y;
      const moved=Math.hypot(dx,dy)>.001;
      const wasWalking=now<t.until;
      if(moved)t.until=now+WALK_HOLD_MS;
      const walking=f.alive&&now<t.until&&(!f.local||intent);
      if(!walking){t.cycles=0;continue;}
      const step=f.runs?walkCycles(dx,dy,view,figurePx,RUN_STRIDE,1):walkCycles(dx,dy,view,figurePx,WALK_STRIDE,WALK_TUNE.lock);
      // The walk starts on pose 0, a foot on the ground: the first step sounds at once.
      const crossed=wasWalking?contactsCrossed(t.cycles,t.cycles+step):1;
      t.cycles=wasWalking?t.cycles+step:step;
      if(crossed>0&&f.gain>0&&now-t.lastStep>=MIN_STEP_MS){
        t.lastStep=now;
        if(this.audio.play('passo-neve',stepJitter(this.rnd,f.gain*(f.runs?RUN_GAIN:1))))played++;
      }
    }
    for(const id of this.tracks.keys())if(!seen.has(id))this.tracks.delete(id);
    return played;
  }

  /** The boss's heavy step while it moves (`boss` undefined: none alive), quieter away from `hero`, none out of earshot. */
  boss(now:number,boss:{x:number;y:number}|undefined,hero:{x:number;y:number}){
    const last=this.bossPos;
    this.bossPos=boss&&{x:boss.x,y:boss.y};
    if(!boss||!last)return false;
    if(Math.hypot(boss.x-last.x,boss.y-last.y)>.001)this.bossMoving=now+WALK_HOLD_MS*3;
    const distance=Math.hypot(boss.x-hero.x,boss.y-hero.y);
    if(now>=this.bossMoving||distance>BOSS_RANGE||now-this.bossAt<BOSS_STEP_MS)return false;
    this.bossAt=now;
    return this.audio.play('chefe-passo',{gain:1/(1+distance/8)});
  }

  reset(){this.tracks.clear();this.bossAt=-Infinity;this.bossPos=undefined;this.bossMoving=-Infinity;}
}
