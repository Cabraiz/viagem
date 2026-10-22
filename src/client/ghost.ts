/**
 * Out of the run, the player walks the map as a ghost (NEW-20261022-ORQ-morto-anda-pelo-mapa): the stick, WASD or a
 * click move a free camera from where the hero fell, a bit faster than the walk, through walls and critters (no
 * collision, no target, no pickup), kept inside the map. Client only: nothing reaches the room, the team never sees
 * it. The torcida's ‹ › (hud/spectator.ts) pins the camera on a friend; moving again lets go. Pure (node tests).
 */
import {FIELD_MIN,FIELD_SIZE,FIELD_STEP,heroSpeed,type Point,type TerrainField} from '../maps/index.ts';

/** The ghost walks this much faster than the hero (the map is big and nothing can hurt it). */
export const GHOST_SPEED_MULT=1.25;
/** A click closer than this (world units) to the ghost is already there. */
export const GHOST_ARRIVE=.1;
export interface GhostRect {x:number;y:number;w:number;h:number}
/** 'free': the ghost walks; 'follow': the camera is pinned on a friend (‹ › or a portrait tap). */
export type GhostMode='free'|'follow';

export const ghostSpeed=(terrain?:TerrainField)=>heroSpeed(terrain)*GHOST_SPEED_MULT;

/**
 * Where the ghost may go: the city's playable rectangle, the island's height grid; undefined in the endless world
 * (no edge to keep to).
 */
export function ghostBounds(terrain?:TerrainField):GhostRect|undefined{
  const t=terrain as (TerrainField&{asset?:{playable?:GhostRect};chunks?:unknown})|undefined;
  const p=t?.asset?.playable;
  if(p)return {x:p.x,y:p.y,w:p.w,h:p.h};
  if(t?.chunks)return undefined;
  const side=(FIELD_SIZE-1)*FIELD_STEP;
  return {x:FIELD_MIN,y:FIELD_MIN,w:side,h:side};
}

export function clampGhost(p:Point,bounds?:GhostRect):Point{
  if(!bounds)return p;
  return {x:Math.min(bounds.x+bounds.w,Math.max(bounds.x,p.x)),y:Math.min(bounds.y+bounds.h,Math.max(bounds.y,p.y))};
}

/**
 * One frame of the ghost: along `direction` (world, any length) when it is held, else toward `target` (a click),
 * at `speed` u/s; straight through everything, clamped to `bounds`. `arrived` once the target is reached.
 */
export function ghostStep(at:Point,input:{direction?:Point;target?:Point},seconds:number,speed:number,bounds?:GhostRect):{at:Point;arrived:boolean}{
  const dt=Math.min(.1,Math.max(0,seconds)),reach=speed*dt;
  const d=input.direction,len=d?Math.hypot(d.x,d.y):0;
  if(d&&len>=.01)return {at:clampGhost({x:at.x+d.x/len*reach,y:at.y+d.y/len*reach},bounds),arrived:false};
  const t=input.target;
  if(!t)return {at,arrived:false};
  const goal=clampGhost(t,bounds),dx=goal.x-at.x,dy=goal.y-at.y,far=Math.hypot(dx,dy);
  if(far<=Math.max(reach,GHOST_ARRIVE))return {at:goal,arrived:true};
  return {at:{x:at.x+dx/far*reach,y:at.y+dy/far*reach},arrived:false};
}

/** The ghost's look: the hero see-through and cold (a soul, not a second hero). */
export const GHOST_ALPHA=.78;
export const GHOST_TINT=0xcfe0ff;

/** One frame of what the scene knows (scene.ts updateWatch). */
export interface GhostFrame {
  /** Out of the run (bled out) or watching mid-run, in a round. */
  out:boolean;
  /** Out by a fall (eliminated), not joined mid-run: the ghost starts free where the hero fell. */
  fell:boolean;
  /** Where the camera is now (the friend watched, the ghost, or the body on the first frame). */
  from:Point;
  /** The stick and the keys as a world direction; {0,0} when let go. */
  steer:Point;
  seconds:number;speed:number;bounds?:GhostRect;
}
/**
 * The ghost's state: free (walks) or follow (the scene pins a friend). A fall starts free; ‹ › or a portrait tap pins
 * (pin); the stick, the keys or a click (goTo) let go again; back in the run it all resets.
 */
export class GhostCam {
  mode:GhostMode='follow';
  out=false;
  target?:Point;
  /** A tap or click while out: the ghost goes there. False when not out (the hero walks instead). */
  goTo(target:Point){if(!this.out)return false;this.target=target;return true;}
  /** ‹ › or a portrait: the camera follows that friend until the thumbs move again. */
  pin(){this.mode='follow';this.target=undefined;}
  /** The ghost's point this frame while free; undefined while following a friend or back in the run. */
  update(f:GhostFrame):Point|undefined{
    if(!f.out){this.out=false;this.mode='follow';this.target=undefined;return undefined;}
    if(!this.out){this.out=true;this.target=undefined;this.mode=f.fell?'free':'follow';}
    const steering=f.steer.x!==0||f.steer.y!==0;
    if(steering||this.target)this.mode='free';
    if(this.mode!=='free')return undefined;
    if(steering)this.target=undefined;
    const step=ghostStep(f.from,{direction:steering?f.steer:undefined,target:this.target},f.seconds,f.speed,f.bounds);
    if(step.arrived)this.target=undefined;
    return step.at;
  }
}
