import {HERO_SPEED_MULT} from '../../maps/index.ts';

export type Motion='idle'|'walk'|'attack';
// Idle drawings vary in pose in the candidate atlases. Hold a single pose so
// standing characters cannot appear to walk even when world coordinates stop.
export const SPRITE_CLIPS={
  idle:{frames:[0],frameRate:3,repeat:-1},
  // 5 fps at the base walk, × HERO_SPEED_MULT (velocidade-heroi-e-projetil): the steps keep up with the 2× walk (no foot slide).
  walk:{frames:[6,7,8,9,10,11],frameRate:5*HERO_SPEED_MULT,repeat:-1},
  attack:{frames:[12,13,14,15,16,17],frameRate:6,repeat:0},
} as const;
export const ATTACK_VISUAL_MS=SPRITE_CLIPS.attack.frames.length/SPRITE_CLIPS.attack.frameRate*1000;
export class SpriteMotion {
  private lastAttack=0;
  private attackUntil=0;
  update(now:number,moving:boolean,attackTick=0,alive=true):Motion{
    // A rematch resets authoritative ticks; old swings must not suppress new ones.
    if(attackTick<this.lastAttack){this.lastAttack=attackTick;this.attackUntil=0;}
    if(!alive){this.lastAttack=attackTick;this.attackUntil=0;return 'idle';}
    if(attackTick>this.lastAttack){
      this.lastAttack=attackTick;
      // Server hits may arrive faster than the slower visual cycle. Consume
      // overlapping events without restarting or extending the current swing.
      if(now>=this.attackUntil)this.attackUntil=now+ATTACK_VISUAL_MS;
    }
    return now<this.attackUntil?'attack':moving?'walk':'idle';
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
