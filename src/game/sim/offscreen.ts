/**
 * "Off screen" for the endless world (NEW-20261009-ORQ-spawn-em-volta): where a body is guaranteed out of
 * every legal phone camera centred on a player, so the director can spawn, recycle and retreat enemies
 * there without anyone seeing them pop. Pure math (no terrain, no rng), shared by the server and the wire.
 *
 * The server does not know each phone's orientation or which of the 4 views (D-019) it uses, so a point
 * counts as off screen only when it is outside the union of every camera a client may legally have:
 * portrait and landscape × the 4 views of 90°, at the widest zoom the camera card allows.
 *
 * Where the numbers come from (NEW-20261009-ORQ-camera-segue, D-009):
 *   - the hero is drawn 96 world px tall (character-sprites.ts: setScale(96 / frame height));
 *   - the floor says the hero is at least 56 CSS px on a 390 px short side, i.e. 56/390 = 14.4% of the short
 *     side. The camera may only zoom IN from that floor (VS ratio ±10% must still respect it), so the widest
 *     legal camera shows a short side of 96 × 390 / 56 = 668.6 world px;
 *   - the long side is the short side × MAX_ASPECT. 2.34 covers 21:9 phones (Xperia 1); the reference
 *     390×844 is 2.16, most phones are 2.16-2.22;
 *   - margins in world px: an enemy sprite rises SPRITE_UP_PX above its feet (boss hp bar 186 px; elite
 *     tio-pavê bar 96 × 1.35 = 130 px), spreads SPRITE_SIDE_PX to each side (boss 150 px wide) and its shadow
 *     hangs SPRITE_DOWN_PX below; the endless relief tops at ~31 px (measured over 10 seeds × 4000 points),
 *     so ELEVATION_PX = 40 bounds the screen-y shift between the player's ground and the enemy's;
 *   - the camera follows smoothly, so it may trail the player by up to CAMERA_LAG_UNITS.
 * Projection (projection.ts): screen x = 42·(x − y), screen y = 21·(x + y) − height, after rotating the
 * offset by the view. One unit along the screen's x axis is 42·√2 = 59.4 px, along its y axis 29.7 px.
 *
 * Result (tests print it): with no camera hint the off-screen distance goes from 21.6 units (near the world
 * axes, bound by landscape) to 35.9 units (the screen axes of the views, bound by the long side of a 21:9
 * portrait phone). With a camera hint (one orientation and view) a portrait phone gets 11.3 units sideways.
 */
import type {Point} from '../world.ts';

export const TILE_X=42,TILE_Y=21;
export const HERO_WORLD_PX=96;
export const HERO_MIN_SCREEN_PX=56,REFERENCE_SHORT_SIDE_PX=390;
export const MAX_ASPECT=2.34;
/** Widest legal camera, in world px. */
export const VISIBLE_SHORT_PX=HERO_WORLD_PX*REFERENCE_SHORT_SIDE_PX/HERO_MIN_SCREEN_PX;
export const VISIBLE_LONG_PX=VISIBLE_SHORT_PX*MAX_ASPECT;
export const SPRITE_UP_PX=190,SPRITE_DOWN_PX=12,SPRITE_SIDE_PX=80;
export const ELEVATION_PX=40;
export const CAMERA_LAG_UNITS=1;

const LAG_X=TILE_X*Math.SQRT2*CAMERA_LAG_UNITS,LAG_Y=TILE_Y*Math.SQRT2*CAMERA_LAG_UNITS;
/** [half width, bottom bound, top bound] of each orientation, margins included (screen y grows downwards). */
const RECTS:readonly (readonly [number,number,number])[]=[
  [VISIBLE_SHORT_PX/2,VISIBLE_LONG_PX/2,VISIBLE_LONG_PX/2],
  [VISIBLE_LONG_PX/2,VISIBLE_SHORT_PX/2,VISIBLE_SHORT_PX/2],
].map(([w,h])=>[w+SPRITE_SIDE_PX+LAG_X,h+SPRITE_UP_PX+ELEVATION_PX+LAG_Y,h+SPRITE_DOWN_PX+ELEVATION_PX+LAG_Y] as const);

/**
 * What a client says about its camera (optional; 042b/camera-segue may send it with the input). Without it the
 * director assumes the union of all orientations and views, which is safe but spawns farther away.
 */
export interface CameraHint {landscape:boolean;view:number}
const views=(hint?:CameraHint)=>hint?[Number.isFinite(hint.view)?((Math.round(hint.view)%4)+4)%4:0]:[0,1,2,3];
const rects=(hint?:CameraHint)=>hint?[RECTS[hint.landscape?1:0]]:RECTS;

/** The 4 views of projection.ts rotateVector, inlined so this module has no client imports. */
function rotated(dx:number,dy:number,view:number):[number,number]{
  switch(view){case 1:return [-dy,dx];case 2:return [-dx,-dy];case 3:return [dy,-dx];default:return [dx,dy];}
}

/** True when a body `dx, dy` units from a player may show on that player's screen, for some legal camera. */
export function visibleOffset(dx:number,dy:number,hint?:CameraHint):boolean{
  if(!(Number.isFinite(dx)&&Number.isFinite(dy)))return false;
  for(const view of views(hint)){
    const [x,y]=rotated(dx,dy,view),sx=TILE_X*(x-y),sy=TILE_Y*(x+y);
    for(const [w,bottom,top] of rects(hint))if(sx<w&&sx>-w&&sy<bottom&&sy>-top)return true;
  }
  return false;
}
export const visibleFrom=(viewer:Point,p:Point,hint?:CameraHint)=>visibleOffset(p.x-viewer.x,p.y-viewer.y,hint);

/** Distance along the unit direction (ux, uy) past which a body is off every legal screen (or the hinted one). */
export function offscreenDistance(ux:number,uy:number,hint?:CameraHint):number{
  let far=0;
  for(const view of views(hint)){
    const [x,y]=rotated(ux,uy,view),a=TILE_X*(x-y),b=TILE_Y*(x+y);
    for(const [w,bottom,top] of rects(hint)){
      let exit=Infinity;
      if(a>1e-12)exit=Math.min(exit,w/a);else if(a<-1e-12)exit=Math.min(exit,-w/a);
      if(b>1e-12)exit=Math.min(exit,bottom/b);else if(b<-1e-12)exit=Math.min(exit,-top/b);
      if(exit>far)far=exit;
    }
  }
  // The rectangles are open, so the exact edge still counts as visible: step a hair past it.
  return far+1e-6;
}

/** Largest off-screen distance over all directions (sampled every 0.25°, then a margin of 0.1). */
export const MAX_OFFSCREEN_DISTANCE=(()=>{
  let m=0;for(let i=0;i<1440;i++){const a=i/1440*Math.PI*2;m=Math.max(m,offscreenDistance(Math.cos(a),Math.sin(a)));}
  return Math.ceil((m+.1)*10)/10;
})();

/**
 * Ring the director spawns on: `offscreenDistance` plus RING_INNER..RING_OUTER units. RING_INNER is what a hero
 * covers during the 1.5 s spawn warning (3.1 u/s × 1.5 s = 4.65 u, world.ts SPEED), so the warned spot is still
 * off screen when the group lands even if a player walks straight at it; if not, the director warns elsewhere.
 * A spot that fails (lake, tree, someone else's screen) is retried up to RING_SLACK units farther out.
 */
export const RING_INNER=5,RING_OUTER=8,RING_SLACK=3;
/**
 * Protocol 4 area of interest (rede-mapa-grande): a client gets enemies, pickups, projectiles and telegraphs
 * within this radius of its player, so everything that can walk onto its screen is already there.
 * It covers the farthest visible point (35.9 u) and the whole spawn ring with its slack.
 */
export const INTEREST_RADIUS=Math.ceil(MAX_OFFSCREEN_DISTANCE+RING_OUTER+RING_SLACK+1);
/** Hysteresis: once sent, an entity stays until it is this much farther, so edge walkers do not flicker. */
export const INTEREST_HYSTERESIS=4;
/** An enemy farther than this from every player is recycled next to one of them (VS-style), beyond any interest area. */
export const RECYCLE_DISTANCE=INTEREST_RADIUS+INTEREST_HYSTERESIS+4;
