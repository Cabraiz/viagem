import {HERO_SPEED_MULT} from '../../maps/index.ts';

export type Motion='idle'|'walk'|'attack';
/**
 * Hero animation speed (NEW-20261018-ORQ-animacao-heroi-70, the user's ask): the clock-driven hero clips play at 0.7 of
 * their drawn rate (the rests and the legacy clips' frameRate × 0.7). The attack is not slowed (ATTACK_MS). The walk is
 * not clock-driven any more: it follows the ground walked (walkCycles, card passo-sem-deslizar).
 */
export const HERO_ANIM_RATE=.7;
/**
 * A whole swing on screen (NEW-20261022-ORQ-ataque-1s, the user's ask: ~1 s, "extremely fast"; at 0.7 it took ~1429 ms
 * and back-to-back swings ran together for 2–3 s). Every attack sheet (legacy, R06, M16) plays its frames in this time,
 * or faster when the weapon swings again sooner (SpriteMotion).
 */
export const ATTACK_MS=800;
/** The shortest a swing is squeezed to when hits come very fast (or bunched by the network). */
export const ATTACK_MIN_MS=250;
// Idle drawings vary in pose in the candidate atlases. Hold a single pose so
// standing characters cannot appear to walk even when world coordinates stop.
export const SPRITE_CLIPS={
  idle:{frames:[0],frameRate:3*HERO_ANIM_RATE,repeat:-1},
  // Legacy walk: its frames are set by the ground walked (walkCycles); the frameRate only matters for a clip left playing.
  walk:{frames:[6,7,8,9,10,11],frameRate:5*HERO_SPEED_MULT*HERO_ANIM_RATE,repeat:-1},
  attack:{frames:[12,13,14,15,16,17],frameRate:6/ATTACK_MS*1000,repeat:0},
} as const;
/**
 * Feet on the ground (NEW-20261021-ORQ-passo-sem-deslizar): a walk cycle advances with the distance the figure walks on
 * screen, not with the clock, so the planted foot keeps pace with the ground at any speed (a wall, a slowdown, the
 * reconcile easing) and a figure standing still never treads. WALK_STRIDE is the drawn travel of the planted foot per
 * cycle, in heights of the figure (the median of the 29 M16 and R06 side walks; scripts/passada.mjs). The
 * screen distance carries the isometric foreshortening, as the drawings do (a walk N or S travels half the pixels).
 */
export const WALK_STRIDE=.68;
/**
 * Share of the stride the cycle keeps up with (1 = the foot locked to the ground). Under 1 the cycle plays slower than
 * the ground goes by. The hero covers ~5.7 heights a second across the screen, a sprint for a walk drawn at 0.68 heights
 * a cycle: locked, that is ~8 cycles a second, too fast for the user (NEW-20261021-ORQ-passo-3x-mais-lento). The hero's
 * speed stays, so the walk plays at half (~4 cycles/s) and the foot slides back half the ground, until a run with a
 * longer drawn stride brings the lock back to 1. Mutable for the sandbox's proofs.
 */
export const WALK_TUNE={lock:.5};
/**
 * The hero's gait when moving (card passo-3x-mais-lento, the user's ask): a class with a drawn run (run16) runs, the foot
 * locked to the ground, since its stride is drawn for the hero's speed; `run:false` brings the walk back (WALK_TUNE).
 */
export const HERO_GAIT={run:true};
/**
 * Drawn run stride, heights of the figure per cycle: the viciado's run16-W opens its feet 1.82× the walk's (widest minus
 * narrowest feet span over the figure, 0.65 against 0.35), so 0.68 × 1.82. Locked, ~4.6 cycles a second across the screen.
 */
export const RUN_STRIDE=1.24;
/**
 * Walk cycles a step of (dx, dy) world units adds, for a figure drawn `figurePx` world px tall, at `stride` heights a
 * cycle and `lock` of it (the walk's by default; a run passes RUN_STRIDE, 1); 0 on a teleport.
 */
export function walkCycles(dx:number,dy:number,view:number,figurePx:number,stride=WALK_STRIDE,lock=WALK_TUNE.lock){
  const step=Math.hypot(dx,dy);
  if(!(figurePx>0)||!(stride>0)||step>FACING_TELEPORT)return 0;
  const s=screenMotion(dx,dy,view);
  return Math.hypot(s.x,s.y)*lock/(stride*figurePx);
}
/** The frame of a looping clip of `frames` after `cycles` cycles. */
export const cycleFrame=(cycles:number,frames:number)=>Math.min(frames-1,Math.floor((cycles-Math.floor(cycles))*frames));
/** How long a lone swing shows (legacy clip, R06 and M16 alike). */
export const ATTACK_VISUAL_MS=SPRITE_CLIPS.attack.frames.length/SPRITE_CLIPS.attack.frameRate*1000;
/** How long a flinch shows (card animacao-receber-dano: the hurt16 clip, ~0.3 s). */
export const HURT_MS=300;
/** The least time between two flinches: a damage over time (gás, fogo) ticking every few frames shows one, not a stutter. */
export const HURT_GAP_MS=600;
/**
 * When a hit shows a flinch (card animacao-receber-dano): the hp went down while the hero rests. It never holds the
 * controls: a hero walking, running, swinging or pushing keeps that clip (the hit shows only on the HUD and the numbers),
 * and one that starts to move in the middle of a flinch drops it at once. Two flinches are HURT_GAP_MS apart at least.
 */
export class HurtGate {
  private hp?:number;
  private start=-Infinity;
  private shown=false;
  /** The flinch's progress (0..1) now, undefined when none shows. */
  update(now:number,hp:number|undefined,resting:boolean):number|undefined{
    const hit=hp!==undefined&&this.hp!==undefined&&hp<this.hp;this.hp=hp;
    if(now<this.start)this.start=-Infinity;
    if(hit&&resting&&now-this.start>=HURT_GAP_MS){this.start=now;this.shown=true;}
    if(!resting)this.shown=false;
    const t=(now-this.start)/HURT_MS;
    if(!this.shown||t>=1){this.shown=false;return undefined;}
    return t;
  }
}
/** A figure without an input (teammates, enemies' riders) keeps walking this long after its drawing last moved. */
export const WALK_HOLD_MS=120;
/**
 * Walking or resting, steady frame to frame (heroi-tremendo, 20/10): a figure walks while its drawing moved in the
 * last WALK_HOLD_MS (a still frame or two in between keeps the walk); the local hero also needs its input to ask for a
 * walk (`intent`: keys, stick or route), so a server reconcile nudging a standing hero's drawing never walks it (that
 * flipped the drawing between the walk clip and the rest pose at every reconcile once the clip was loaded), and a
 * hero pushing into a wall rests facing it.
 */
export class WalkGate {
  private until=-Infinity;
  update(now:number,moved:boolean,intent?:{x:number;y:number}):boolean{
    if(moved)this.until=now+WALK_HOLD_MS;
    const recent=now<this.until;
    return intent?recent&&Math.hypot(intent.x,intent.y)>1e-6:recent;
  }
}

export class SpriteMotion {
  private lastAttack=0;
  private attackUntil=0;
  private lastSwingAt=-Infinity;
  /** The current swing: when it started and how long it plays (its frames are spread over `ms`). */
  readonly swing={start:-Infinity,ms:ATTACK_VISUAL_MS};
  update(now:number,moving:boolean,attackTick=0,alive=true):Motion{
    // A rematch resets authoritative ticks; old swings must not suppress new ones.
    if(attackTick<this.lastAttack){this.lastAttack=attackTick;this.attackUntil=0;this.lastSwingAt=-Infinity;}
    if(!alive){this.lastAttack=attackTick;this.attackUntil=0;return 'idle';}
    if(attackTick>this.lastAttack){
      this.lastAttack=attackTick;
      // Every hit is a clean swing from its first frame (ataque-1s). One that comes before the last one ended plays in
      // the time between them, so holding Atacar shows one swing per hit instead of one long movement over several.
      const gap=now-this.lastSwingAt;
      this.swing.ms=Math.max(ATTACK_MIN_MS,Math.min(ATTACK_VISUAL_MS,gap));
      this.swing.start=now;this.lastSwingAt=now;
      this.attackUntil=now+this.swing.ms;
    }
    // NEW-20261028-ORQ-atirar-andando (the user: "toda arma, ao atirar, eu posso andar"): a hero walking while it fires
    // keeps its walk (feet on the ground, the weapon in the hand fires: flash, shot, sound); the whole swing only shows
    // standing. The swing is still timed, so a hero that stops in the middle of one shows its rest.
    return moving?'walk':now<this.attackUntil?'attack':'idle';
  }
}

/**
 * Four-direction sheets (Trickster look, NEW-20261009-ORQ-sprites-4-direcoes). A directional atlas stacks one
 * 6×3 block (idle, walk, attack rows) per facing, in this order; docs/sprite-directions.md is the artists' contract.
 * The unflipped single-direction sheets of today draw `front-right`.
 */
export type Facing='front-right'|'front-left'|'back-right'|'back-left';
export const FACINGS:readonly Facing[]=['front-right','front-left','back-right','back-left'];
/** Frames per facing block (3 rows × 6 columns). */
export const FACING_FRAMES=18;
/** Hysteresis band, as the sine of the angle (15°) the screen motion must clear past a diagonal's border to switch. */
export const FACING_HYSTERESIS=Math.sin(15*Math.PI/180);
/** World tiles of motion gathered before the heading is read again (filters interpolation jitter). */
export const FACING_STEP=.04;
/** A jump longer than this (respawn, reconnect snap) is a teleport, not a heading. */
export const FACING_TELEPORT=3;

const rotate=(x:number,y:number,view:number)=>{
  switch(((view%4)+4)%4){case 1:return {x:-y,y:x};case 2:return {x:-x,y:-y};case 3:return {x:y,y:-x};default:return {x,y};}
};
/** Screen motion (projected px, y down) of a world step under one of the 4 camera views (projection.ts). */
export function screenMotion(dx:number,dy:number,view:number){const q=rotate(dx,dy,view);return {x:(q.x-q.y)*42,y:(q.x+q.y)*21};}
/** The diagonals in the order one quarter turn of the camera (view + 1) carries them. */
const TURN:readonly Facing[]=['front-right','front-left','back-left','back-right'];
/** The facing a figure standing still shows after the camera turns `views` quarter turns. */
export function turnFacing(facing:Facing,views:number):Facing{return TURN[(TURN.indexOf(facing)+(((views%4)+4)%4))%4];}
const facingOf=(front:boolean,right:boolean):Facing=>front?right?'front-right':'front-left':right?'back-right':'back-left';
/**
 * Picks the diagonal from where the figure walks on screen, with hysteresis: the side (left/right) and the depth
 * (front/back) each change only when the motion clears its border by FACING_HYSTERESIS, so a thumb held along a
 * border or a remote ally's interpolated wobble cannot make the figure blink between two drawings. The heading is
 * kept in world terms, so a figure standing still turns with the camera like the ground under it.
 *
 * Two sources: a remote figure turns by its (interpolated) displacement; the LOCAL hero passes its `intent` (the
 * joystick or route step it sends), because a prediction/reconciliation snap of 0.5–1 tile backwards is a real
 * on-screen motion that would otherwise show its back for several frames. With an intent, displacement is ignored:
 * a zero intent (thumb off, down, paused) holds the drawing.
 */
export class FacingTracker {
  /** Facing as seen from view 0. */
  private base:Facing='front-right';
  private ax=0;
  private ay=0;
  update(dx:number,dy:number,view:number,intent?:{x:number;y:number}):Facing{
    if(intent){
      this.ax=this.ay=0;
      return Math.hypot(intent.x,intent.y)<1e-6?turnFacing(this.base,view):this.turn(intent.x,intent.y,view);
    }
    const step=Math.hypot(dx,dy);
    if(step<.001||step>FACING_TELEPORT){this.ax=this.ay=0;return turnFacing(this.base,view);}
    this.ax+=dx;this.ay+=dy;
    if(Math.hypot(this.ax,this.ay)<FACING_STEP)return turnFacing(this.base,view);
    const x=this.ax,y=this.ay;this.ax=this.ay=0;
    return this.turn(x,y,view);
  }
  private turn(dx:number,dy:number,view:number):Facing{
    const s=screenMotion(dx,dy,view),length=Math.hypot(s.x,s.y),ux=s.x/length,uy=s.y/length;
    const now=turnFacing(this.base,view);
    let right=now.endsWith('right'),front=now.startsWith('front');
    if(ux>FACING_HYSTERESIS)right=true;else if(ux< -FACING_HYSTERESIS)right=false;
    if(uy>FACING_HYSTERESIS)front=true;else if(uy< -FACING_HYSTERESIS)front=false;
    this.base=turnFacing(facingOf(front,right),-view);
    return turnFacing(this.base,view);
  }
}
/**
 * The single-direction sheets (no 4-direction batch yet): exactly the flip rule shipped before this card. The drawing
 * looks front-right; it mirrors when the latest move goes left on screen, and keeps its side on a vertical move.
 */
export function legacyFlip(flipped:boolean,dx:number,dy:number,view:number){
  const q=rotate(dx,dy,view);
  return Math.abs(q.x-q.y)>.001?q.x-q.y<0:flipped;
}

/** Source compass order. The two 4096-safe atlases retain their existing block order. */
export const HERO_DIRECTIONS=['S','SW','W','NW','N','NE','E','SE'] as const;
export type HeroDirection=typeof HERO_DIRECTIONS[number];
export const HERO_DIRECTION_PAGE:Record<HeroDirection,{page:'dir4'|'dir4c';block:number}>={
  S:{page:'dir4c',block:0},SW:{page:'dir4',block:1},W:{page:'dir4c',block:1},NW:{page:'dir4',block:3},
  N:{page:'dir4c',block:2},NE:{page:'dir4',block:2},E:{page:'dir4c',block:3},SE:{page:'dir4',block:0},
};
const DEG=Math.PI/180;
const angleDistance=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const compass=(angle:number):HeroDirection=>HERO_DIRECTIONS[((Math.round((angle-Math.PI/2)/(Math.PI/4))%8)+8)%8];
const compassAngle=(direction:HeroDirection)=>Math.PI/2+HERO_DIRECTIONS.indexOf(direction)*Math.PI/4;

/** Eight screen headings after isometric projection; world heading survives camera turns and idle. */
export class Facing8Tracker {
  private heading={x:1,y:0};
  private facing:HeroDirection='SE';
  private view=0;
  private ax=0;
  private ay=0;
  update(dx:number,dy:number,view:number,intent?:{x:number;y:number}):HeroDirection{
    const changedView=view!==this.view;
    this.view=view;
    let next:{x:number;y:number}|undefined;
    if(intent){
      this.ax=this.ay=0;
      if(Math.hypot(intent.x,intent.y)>1e-6)next=intent;
    }else{
      const step=Math.hypot(dx,dy);
      if(step<.001||step>FACING_TELEPORT)this.ax=this.ay=0;
      else{
        this.ax+=dx;this.ay+=dy;
        if(Math.hypot(this.ax,this.ay)>=FACING_STEP){next={x:this.ax,y:this.ay};this.ax=this.ay=0;}
      }
    }
    if(next)this.heading={x:next.x,y:next.y};
    if(next||changedView){
      const s=screenMotion(this.heading.x,this.heading.y,view),angle=Math.atan2(s.y,s.x);
      // A 7.5° band beyond a sector's 22.5° edge prevents joystick/interpolation flicker.
      if(changedView||angleDistance(angle,compassAngle(this.facing))>(22.5+7.5)*DEG)this.facing=compass(angle);
    }
    return this.facing;
  }
}
