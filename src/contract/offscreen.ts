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
 *   - D-046 (NEW-20261013-ORQ-camera-zoom-out-e-roda): the player may zoom out by wheel or pinch down to a hero of
 *     HERO_WIDEST_SCREEN_PX = 44 CSS px on a 390 px short side (11.3% of it; the smallest critter, bebado 62 world
 *     px, still draws at 28.4 CSS px), never farther. So the widest legal camera shows a short side of
 *     96 × 390 / 44 = 850.9 world px (it was 668.6 with the 56 px floor of D-009/D-030, HERO_MIN_SCREEN_PX, which
 *     stays the closest zoom);
 *   - the long side is the short side × MAX_ASPECT. 2.34 covers 21:9 phones (Xperia 1); the reference
 *     390×844 is 2.16, most phones are 2.16-2.22;
 *   - margins in world px: an enemy sprite rises SPRITE_UP_PX above its feet (boss hp bar 186 px; elite
 *     tio-pavê bar 96 × 1.35 = 130 px), spreads SPRITE_SIDE_PX to each side (boss 150 px wide) and its shadow
 *     hangs SPRITE_DOWN_PX below; the endless relief tops at ~31 px (measured over 10 seeds × 4000 points),
 *     so ELEVATION_PX = 40 bounds the screen-y shift between the player's ground and the enemy's;
 *   - the camera follows smoothly, so it may trail the player by up to CAMERA_LAG_UNITS;
 *   - in the round the camera centres the hero's body on the screen with no look-ahead (camera-centro-heroi);
 *     only in the lobby, the countdown and while the obra window is open does it frame the hero in the HUD's
 *     useful area (UX-zonas-tela), beside the panel or window. There the hero's feet may sit up to
 *     CAMERA_OFFSET_SHORT_PX off the screen centre along the screen's short axis and CAMERA_OFFSET_LONG_PX along
 *     its long axis (framing.ts followTarget clamps to these). The budget is kept for that framing, and both sides
 *     of each rectangle grow by it, since the offset can go either way.
 * Projection (projection.ts): screen x = 42·(x − y), screen y = 21·(x + y) − height, after rotating the
 * offset by the view. One unit along the screen's x axis is 42·√2 = 59.4 px, along its y axis 29.7 px.
 *
 * Result (tests print it): with no camera hint the off-screen distance goes from 31.5 units (near the world
 * axes, bound by the computer's landscape camera, HERO_DESKTOP_SCREEN_PX; 29.9 before zoom-fixo-pc) to 48.7 units
 * (the screen axes of the views, bound by the long side of a 21:9 portrait phone), camera offset budget included (25.5..41.4 before D-046). MAX_OFFSCREEN_DISTANCE 48.9,
 * INTEREST_RADIUS 61, RECYCLE_DISTANCE 69 (were 41.5, 54, 62). With a camera hint (one orientation and view) a
 * portrait phone gets 11.7 units sideways.
 */
import type {Point} from './types.ts';

export const TILE_X=42,TILE_Y=21;
export const HERO_WORLD_PX=96;
/**
 * Hero size of the D-009/D-030 framing: 56 CSS px on a 390 px short side. Since D-046 it is the closest the player's
 * zoom goes (wheel/pinch between 44 and 56 px, default ~47), no longer the widest camera: that is HERO_WIDEST_SCREEN_PX.
 */
export const HERO_MIN_SCREEN_PX=56,REFERENCE_SHORT_SIDE_PX=390;
/**
 * Hero size at the widest legal camera (D-046, zoom-out by wheel or pinch): 44 CSS px on a 390 px short side, so the
 * smallest critter (ENEMY_ART bebado, 62 world px) still draws at 62 × 44 / 96 = 28.4 ≥ 28 CSS px.
 */
export const HERO_WIDEST_SCREEN_PX=44;
export const MAX_ASPECT=2.34;
/** Widest legal camera, in world px. */
export const VISIBLE_SHORT_PX=HERO_WORLD_PX*REFERENCE_SHORT_SIDE_PX/HERO_WIDEST_SCREEN_PX;
export const VISIBLE_LONG_PX=VISIBLE_SHORT_PX*MAX_ASPECT;
export const SPRITE_UP_PX=190,SPRITE_DOWN_PX=12,SPRITE_SIDE_PX=80;
export const ELEVATION_PX=40;
export const CAMERA_LAG_UNITS=1;
/** Hero-to-camera-centre offset budget, world px (useful-area centring + look-ahead), see the header. */
export const CAMERA_OFFSET_SHORT_PX=130,CAMERA_OFFSET_LONG_PX=150;

/**
 * Hero size of the player's DEFAULT zoom (D-046: ~1.4× the area of the 56 px framing; client camera-zoom.ts
 * HERO_ZOOM_PX.default reads it). Never a spawn or pop rule: everything the director places or removes "off screen"
 * stays off the WIDEST camera (HERO_WIDEST_SCREEN_PX). Only pacing reads it (NEW-20261013-ORQ-camera-zoom-out-e-roda,
 * Orquestrador's option A): a body off every DEFAULT screen may run in faster (director.ts CATCH_UP_SPEED and the city
 * run-in), so the round's pace at the default camera is the one of the 56 px framing. Such a body may be seen walking
 * fast only by a player who zoomed out past the default (the thin 44..47 px band).
 */
export const HERO_DEFAULT_SCREEN_PX=47;
/**
 * Hero size of the computer's camera (NEW-20261020-ORQ-zoom-fixo-pc): a fine-pointer screen shows the map ~20% farther
 * than the phone's default (38 vs 47 px on the 390 px reference: 0.81× its zoom) and neither the wheel nor the browser
 * zoom changes it. Only a LANDSCAPE screen goes that far (framing.ts followZoom caps a portrait window at the widest
 * phone camera), up to DESKTOP_MAX_ASPECT. It is one more rectangle in the union of legal cameras, for the spawn rule and the
 * pacing alike (the computer's zoom is fixed, so its default is its widest): the farthest off-screen point stays 48.7 u
 * (the portrait phone's long side), the nearest goes from 29.9 to 31.5 u (28.8 to 31.5 at the default zoom).
 */
export const HERO_DESKTOP_SCREEN_PX=38;
/** The computer's landscape camera, in world px (short side vertical, long side horizontal). */
export const DESKTOP_VISIBLE_SHORT_PX=HERO_WORLD_PX*REFERENCE_SHORT_SIDE_PX/HERO_DESKTOP_SCREEN_PX;
/**
 * The computer's widest aspect at the full 38 px: 2.1 (1920×970 is 1.98, a 1343×618 window 2.17). A wider window keeps
 * the long side at DESKTOP_VISIBLE_LONG_PX (1343×618: 0.84× the phone default's zoom instead of 0.81×). At 2.2 the
 * city's mouths fall on screen often enough that a first group misses its 12 s (city-avenues ACCEPTANCE).
 */
export const DESKTOP_MAX_ASPECT=2.1;
export const DESKTOP_VISIBLE_LONG_PX=DESKTOP_VISIBLE_SHORT_PX*DESKTOP_MAX_ASPECT;

const LAG_X=TILE_X*Math.SQRT2*CAMERA_LAG_UNITS,LAG_Y=TILE_Y*Math.SQRT2*CAMERA_LAG_UNITS;
/** [half width, bottom bound, top bound, landscape] of one camera, margins included (screen y grows downwards). */
type Rect=readonly [number,number,number,boolean];
const rectOf=(w:number,h:number,landscape:boolean):Rect=>[w+SPRITE_SIDE_PX+LAG_X,h+SPRITE_UP_PX+ELEVATION_PX+LAG_Y,h+SPRITE_DOWN_PX+ELEVATION_PX+LAG_Y,landscape];
/** The computer's landscape camera (HERO_DESKTOP_SCREEN_PX): fixed, so in every set of rectangles. */
const DESKTOP_RECT=rectOf(DESKTOP_VISIBLE_LONG_PX/2+CAMERA_OFFSET_LONG_PX,DESKTOP_VISIBLE_SHORT_PX/2+CAMERA_OFFSET_SHORT_PX,true);
/**
 * The phone's portrait and landscape cameras that draw the hero `heroPx` CSS px on the reference short side, and the
 * computer's landscape one (HERO_DESKTOP_SCREEN_PX, whatever `heroPx` says: its zoom never changes).
 */
function cameraRects(heroPx:number):readonly Rect[]{
  const short=HERO_WORLD_PX*REFERENCE_SHORT_SIDE_PX/heroPx,long=short*MAX_ASPECT;
  return [
    rectOf(short/2+CAMERA_OFFSET_SHORT_PX,long/2+CAMERA_OFFSET_LONG_PX,false),
    rectOf(long/2+CAMERA_OFFSET_LONG_PX,short/2+CAMERA_OFFSET_SHORT_PX,true),
    DESKTOP_RECT,
  ];
}
const RECTS=cameraRects(HERO_WIDEST_SCREEN_PX),DEFAULT_RECTS=cameraRects(HERO_DEFAULT_SCREEN_PX);
/** The widest camera's rectangles; the default zoom's ones (cached); any other hero size built on demand. */
const rectsAt=(heroPx:number)=>heroPx===HERO_WIDEST_SCREEN_PX?RECTS:heroPx===HERO_DEFAULT_SCREEN_PX?DEFAULT_RECTS:cameraRects(heroPx);

/**
 * What a client says about its camera (optional; 042b/camera-segue may send it with the input). Without it the
 * director assumes the union of all orientations and views, which is safe but spawns farther away.
 */
export interface CameraHint {landscape:boolean;view:number}
const views=(hint?:CameraHint)=>hint?[Number.isFinite(hint.view)?((Math.round(hint.view)%4)+4)%4:0]:[0,1,2,3];
const rects=(hint:CameraHint|undefined,all:readonly Rect[])=>hint?all.filter(r=>r[3]===hint.landscape):all;

/** The 4 views of projection.ts rotateVector, inlined so this module has no client imports. */
function rotated(dx:number,dy:number,view:number):[number,number]{
  switch(view){case 1:return [-dy,dx];case 2:return [-dx,-dy];case 3:return [dy,-dx];default:return [dx,dy];}
}

/**
 * True when a body `dx, dy` units from a player may show on that player's screen, for some legal camera (the widest
 * one, HERO_WIDEST_SCREEN_PX: the spawn, recycle and pop rule). `heroPx` asks about a closer camera instead (the
 * default zoom, HERO_DEFAULT_SCREEN_PX: pacing only, see there); a value under the widest one is never legal.
 */
export function visibleOffset(dx:number,dy:number,hint?:CameraHint,heroPx=HERO_WIDEST_SCREEN_PX):boolean{
  if(!(Number.isFinite(dx)&&Number.isFinite(dy)))return false;
  const all=rectsAt(Math.max(HERO_WIDEST_SCREEN_PX,heroPx));
  for(const view of views(hint)){
    const [x,y]=rotated(dx,dy,view),sx=TILE_X*(x-y),sy=TILE_Y*(x+y);
    for(const [w,bottom,top] of rects(hint,all))if(sx<w&&sx>-w&&sy<bottom&&sy>-top)return true;
  }
  return false;
}
export const visibleFrom=(viewer:Point,p:Point,hint?:CameraHint,heroPx=HERO_WIDEST_SCREEN_PX)=>visibleOffset(p.x-viewer.x,p.y-viewer.y,hint,heroPx);
/** Pacing only (HERO_DEFAULT_SCREEN_PX): true when `p` may show on `viewer`'s screen at the player's default zoom. */
export const visibleAtDefault=(viewer:Point,p:Point,hint?:CameraHint)=>visibleFrom(viewer,p,hint,HERO_DEFAULT_SCREEN_PX);

/** Distance along the unit direction (ux, uy) past which a body is off every legal screen (or the hinted one; `heroPx`: see visibleOffset). */
export function offscreenDistance(ux:number,uy:number,hint?:CameraHint,heroPx=HERO_WIDEST_SCREEN_PX):number{
  let far=0;const all=rectsAt(Math.max(HERO_WIDEST_SCREEN_PX,heroPx));
  for(const view of views(hint)){
    const [x,y]=rotated(ux,uy,view),a=TILE_X*(x-y),b=TILE_Y*(x+y);
    for(const [w,bottom,top] of rects(hint,all)){
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
 * Ring the director spawns on: `offscreenDistance` plus RING_INNER..RING_OUTER units. RING_INNER is at least what a
 * hero covers during the 1.5 s spawn warning (the 2× walk, world.ts heroSpeed: 6.2 u/s × 1.5 s = 9.3 u), so the warned
 * spot is still off screen when the group lands even if a player walks straight at it (director.ts hiddenAhead
 * rejects any closer spot); if not, the director warns elsewhere. A spot that fails (lake, tree, someone else's
 * screen) is retried up to RING_SLACK units farther out.
 * velocidade-heroi-e-projetil: was 5..8 + 3 for the 3.1 u/s walk (4.65 u); with the 2× walk that band made ~94% of the
 * tries fail the lead and ~2.6% of the ring calls find no spot. RING_OUTER + RING_SLACK is 11.4 (was 8 + 3): with
 * D-046's widest camera (48.9 u) INTEREST_RADIUS rounds to 62 u (61 on main) and RECYCLE_DISTANCE to 70 (69). A band
 * of 9.4..10 kept them but spawned late enough that endless round-2 bodies fled (fim-de-round) and a held seat's run
 * ended while the person was away (rede-3g).
 */
export const RING_INNER=9.4,RING_OUTER=10.4,RING_SLACK=1;
/**
 * Protocol 4 area of interest (rede-mapa-grande): a client gets enemies, pickups, projectiles and telegraphs
 * within this radius of its player, so everything that can walk onto its screen is already there.
 * It covers the farthest visible point (48.7 u) and the whole spawn ring with its slack: 62 u (61 before the 2× walk's ring).
 */
export const INTEREST_RADIUS=Math.ceil(MAX_OFFSCREEN_DISTANCE+RING_OUTER+RING_SLACK+1);
/** Hysteresis: once sent, an entity stays until it is this much farther, so edge walkers do not flicker. */
export const INTEREST_HYSTERESIS=4;
/**
 * D-051: at most this many sleeping bodies (EnemyView.asleep) per client, the nearest ones.
 * Card horda-visivel-capacidade (scripts/bench-horda-visivel.ts, seed 4242, 4 players, 4930 asleep; real screens: a
 * PC at 1920×1080 shows 954×537 world px, ±11 u around the hero; a phone in portrait at the default zoom 434×939): with
 * 48 the cap hid sleepers on screen at 19.7% of the city's walkable points on the PC and 31.6% on the phone (inside the
 * nests' rings, where a fight happens); with 300 at 0% and 1.5% (≤ 12 bodies). The phone pays for every body it holds,
 * drawn or culled (scripts/prova-horda-visivel.mjs, CPU 4×, the same walk: 48 → 55.5 fps, 300 → 53, no cap (≤ 1300
 * held) → 26); the room pays little (+0.1 KB/s and +0.2 ms of encode per client at 10 Hz).
 */
export const ASLEEP_PER_VIEWER=300;
/**
 * Card ninhos-perto-ataca-20x: at most this many awake enemies per client, the nearest ones (the boss always on top).
 * The phone draws and animates every body it holds (~30 µs each a frame, E1's measure 18/10: 300 on screen → 41 fps
 * at CPU 4×, 600 → 34, 1500 → 19), so this is the phone's budget, not the map's.
 */
export const AWAKE_PER_VIEWER=300;
/** An enemy farther than this from every player is recycled next to one of them (VS-style), beyond any interest area. */
export const RECYCLE_DISTANCE=INTEREST_RADIUS+INTEREST_HYSTERESIS+4;
