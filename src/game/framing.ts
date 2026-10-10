import type {TerrainField} from './terrain/field.ts';
import {SPEED,isLand,landmarks,obstacles,project,type Point} from './world.ts';
import {projectView,normalizeView} from './projection.ts';
import {HERO_MARGIN} from './hud/zones.ts';
import {CAMERA_LAG_UNITS,CAMERA_OFFSET_LONG_PX,CAMERA_OFFSET_SHORT_PX,HERO_MIN_SCREEN_PX,HERO_WORLD_PX,TILE_X,TILE_Y,VISIBLE_LONG_PX,VISIBLE_SHORT_PX} from './sim/offscreen.ts';

const center=project({x:12,y:12});
export const SHORE={x:center.x,y:center.y+40,width:1290,height:710};

// ---------- Overview framing (the whole island) ----------
// No longer the in-game camera (D-019 revoked docs/whole-island-contract.md): only ?sandbox=horda&camera=ilha uses
// it, as a debug overview. The game camera is FollowCamera below.

// Include the coast, tile cliffs, scenery and character silhouettes at the
// edges. The render texture also has decorative ocean ripples outside the map.
function islandBounds(view=0,terrain?:TerrainField){
  let left=SHORE.x-SHORE.width/2,right=SHORE.x+SHORE.width/2;
  let top=SHORE.y-SHORE.height/2,bottom=SHORE.y+SHORE.height/2;
  const include=(x:number,y:number)=>{left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);};
  for(let y=1;y<24;y++)for(let x=1;x<24;x++)if(isLand({x:x+.5,y:y+.5},0,terrain)){
    for(const corner of [{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}]){
      const p=projectView(corner,view,terrain);include(p.x-56,p.y-100);include(p.x+56,p.y+30);
    }
  }
  for(const prop of [...obstacles,...landmarks]){
    const p=projectView(prop,view,terrain);include(p.x-160,p.y-250);include(p.x+160,p.y+65);
  }
  return {left,right,top,bottom};
}
export const ISLAND_BOUNDS=islandBounds();
export const ISLAND_VIEWS=[ISLAND_BOUNDS,islandBounds(1),islandBounds(2),islandBounds(3)];

export function fitIsland(width:number,height:number,view=0,terrain?:TerrainField){
  const bounds=terrain?islandBounds(normalizeView(view),terrain):ISLAND_VIEWS[normalizeView(view)];
  const zoom=Math.min(Math.max(1,width-32)/(bounds.right-bounds.left),Math.max(1,height-32)/(bounds.bottom-bounds.top));
  return {zoom,x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
}

// ---------- Follow camera (D-019, NEW-20261009-ORQ-camera-segue + UX-camera-segue) ----------

export interface Rect {x:number;y:number;width:number;height:number}
export interface Viewport {width:number;height:number}

/**
 * Vampire Survivors reference (measured on the 6 Steam store screenshots, 1280×800, Steam Deck size): the hero is
 * 56 px tall on an 800 px short side (Antonio-like knight and the purple rogue: 56 px; the hunched old man: 51 px),
 * i.e. 7.0% of the short side; a bat is 22-31 px (2.8-3.9%). On a 390 px phone that ratio gives a 27 px hero, under
 * the D-009 floor, so the floor wins: the hero is HERO_MIN_SCREEN_PX (56 CSS px) on a 390 px short side (14.4%).
 */
export const VS_HERO_SHORT_RATIO=56/800;
/** Hero share of the short side the camera keeps on any phone (the floor's ratio; at least HERO_MIN_SCREEN_PX). */
export const HERO_SHORT_RATIO=HERO_MIN_SCREEN_PX/390;

/**
 * Fixed zoom for one viewport (UX-camera-segue 1: one zoom per orientation, never animated). The hero is the larger
 * of the VS ratio and the floor ratio of the short side, never under 56 CSS px, and the camera never shows more world
 * than the off-screen contract allows (offscreen.ts: VISIBLE_SHORT_PX × VISIBLE_LONG_PX world px), so nothing the
 * director spawns "off screen" can pop up on this phone.
 */
export function followZoom(viewport:Viewport){
  const short=Math.max(1,Math.min(viewport.width,viewport.height)),long=Math.max(1,viewport.width,viewport.height);
  const hero=Math.max(HERO_MIN_SCREEN_PX,short*Math.max(VS_HERO_SHORT_RATIO,HERO_SHORT_RATIO));
  return Math.max(hero/HERO_WORLD_PX,short/VISIBLE_SHORT_PX,long/VISIBLE_LONG_PX);
}

/** Smoothing time constant of the follow (UX-camera-segue 3: 120-200 ms). */
export const FOLLOW_TAU_S=.16;
/** Look-ahead: this share of the useful area's half extent, in the direction the hero walks on screen (UX: ~15%). */
export const LOOK_AHEAD=.15;
/** The look-ahead eases in and out over this time constant, so stopping never jerks the view. */
export const LOOK_TAU_S=.4;
/** Hero screen speed (world px/s) when walking at SPEED along the screen's x and y axes: the look-ahead is full there. */
const WALK_PX_X=SPEED*TILE_X*Math.SQRT2,WALK_PX_Y=SPEED*TILE_Y*Math.SQRT2;
/** Where the hero's body sits over its feet (the figure is 96 world px tall, feet at the sprite origin): its middle. */
export const HERO_BODY_UP_PX=HERO_WORLD_PX/2;
/** Hero figure size on screen (CSS px) when the scene does not say: 96 world px tall, about as wide. */
export interface Size {width:number;height:number}
/** The farthest the camera may trail the hero, in world px along the screen axes (offscreen.ts CAMERA_LAG_UNITS). */
export const LAG_X_PX=TILE_X*Math.SQRT2*CAMERA_LAG_UNITS,LAG_Y_PX=TILE_Y*Math.SQRT2*CAMERA_LAG_UNITS;

const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

/** Offset budget (world px) of the hero's feet from the camera centre along screen x and y, for this viewport. */
export function offsetBudget(viewport:Viewport){
  const portrait=viewport.height>=viewport.width;
  return portrait?{x:CAMERA_OFFSET_SHORT_PX,y:CAMERA_OFFSET_LONG_PX}:{x:CAMERA_OFFSET_LONG_PX,y:CAMERA_OFFSET_SHORT_PX};
}

/**
 * Where the hero's feet should sit on screen (CSS px, canvas coordinates): the body centred in the useful area
 * (UX-zonas-tela), or the screen centre when there is no HUD (solo exploration, waiting room).
 */
export function anchorOf(viewport:Viewport,zoom:number,useful?:Rect,hero?:Size):Point{
  const area=areaOf(viewport,useful);
  return {x:area.x+area.width/2,y:area.y+area.height/2+(hero?hero.height/2:HERO_BODY_UP_PX*zoom)};
}
const areaOf=(viewport:Viewport,useful?:Rect):Rect=>useful&&useful.width>0&&useful.height>0?useful:{x:0,y:0,width:viewport.width,height:viewport.height};
/**
 * Largest look-ahead (world px per screen axis): LOOK_AHEAD of the useful area's half extent, but never so much that
 * the hero's box ± HERO_MARGIN leaves the useful area (landscape: the area is ~155 px tall, so it is ~8 px there).
 */
export function lookLimit(viewport:Viewport,zoom:number,useful?:Rect,hero?:Size):Point{
  const area=areaOf(viewport,useful),h=hero??{width:HERO_WORLD_PX*zoom,height:HERO_WORLD_PX*zoom};
  const axis=(half:number,heroHalf:number)=>Math.max(0,Math.min(LOOK_AHEAD*half,half-heroHalf-HERO_MARGIN))/zoom;
  return {x:axis(area.width/2,h.width/2),y:axis(area.height/2,h.height/2)};
}

/**
 * Camera centre (world px, Phaser camera.centerOn) that puts the hero's feet (`hero`, projected world px) at the
 * anchor, shifted by the look-ahead (world px, towards where the hero walks), with the hero-to-centre offset kept
 * inside the off-screen contract budget.
 */
export function followTarget(hero:Point,viewport:Viewport,zoom:number,useful?:Rect,look:Point={x:0,y:0},size?:Size):Point{
  const anchor=anchorOf(viewport,zoom,useful,size),budget=offsetBudget(viewport);
  // Feet minus centre, in world px: positive x means the hero sits right of the screen centre.
  const dx=clamp((anchor.x-viewport.width/2)/zoom-look.x,-budget.x,budget.x);
  const dy=clamp((anchor.y-viewport.height/2)/zoom-look.y,-budget.y,budget.y);
  return {x:hero.x-dx,y:hero.y-dy};
}

/**
 * The follow camera's state machine, pure (no Phaser) so node tests pin it down: exponential follow of the target
 * (frame-rate independent), hero-to-centre offset capped at the budget plus CAMERA_LAG_UNITS, look-ahead eased from
 * the hero's screen velocity.
 * `snap` jumps straight to the target (first frame, view rotation, resize, teleport).
 */
export class FollowCamera {
  center:Point={x:0,y:0};
  look:Point={x:0,y:0};
  private last?:Point;
  private ready=false;
  get placed(){return this.ready;}
  snap(hero:Point,viewport:Viewport,zoom:number,useful?:Rect,size?:Size){
    this.look={x:0,y:0};this.last={...hero};this.ready=true;
    this.center=followTarget(hero,viewport,zoom,useful,this.look,size);
    return this.center;
  }
  /** Moves the whole frame by (dx, dy) world px (a re-based projection): no visible change on screen. */
  shift(dx:number,dy:number){this.center.x+=dx;this.center.y+=dy;if(this.last){this.last.x+=dx;this.last.y+=dy;}}
  step(hero:Point,seconds:number,viewport:Viewport,zoom:number,useful?:Rect,size?:Size){
    if(!this.ready||!this.last)return this.snap(hero,viewport,zoom,useful,size);
    const dt=clamp(seconds,0,.25);
    const limit=lookLimit(viewport,zoom,useful,size);
    if(dt>0){
      // Look-ahead from the hero's screen velocity; a jump (teleport, respawn) does not count as walking.
      // Speed as a share of walking speed per screen axis (isometric: 1 u is 59.4 px across, 29.7 px down).
      const nx=(hero.x-this.last.x)/dt/WALK_PX_X,ny=(hero.y-this.last.y)/dt/WALK_PX_Y,speed=Math.hypot(nx,ny);
      const k=speed>.05&&speed<3?Math.min(1,speed)/speed:0;
      const want={x:nx*k*limit.x,y:ny*k*limit.y};
      const ease=1-Math.exp(-dt/LOOK_TAU_S);
      this.look.x+=(want.x-this.look.x)*ease;this.look.y+=(want.y-this.look.y)*ease;
    }
    // A smaller useful area (offer opened, rotation) shrinks the limit at once, the easing only applies inside it.
    this.look.x=clamp(this.look.x,-limit.x,limit.x);this.look.y=clamp(this.look.y,-limit.y,limit.y);
    this.last={...hero};
    const target=followTarget(hero,viewport,zoom,useful,this.look,size);
    const blend=1-Math.exp(-dt/FOLLOW_TAU_S);
    let x=this.center.x+(target.x-this.center.x)*blend,y=this.center.y+(target.y-this.center.y)*blend;
    // The off-screen contract: the hero is never farther from the camera centre than the offset budget plus
    // CAMERA_LAG_UNITS of trailing. A target that moves inside the budget (useful area changed) is still eased.
    const budget=offsetBudget(viewport);
    x=clamp(x,hero.x-budget.x-LAG_X_PX,hero.x+budget.x+LAG_X_PX);y=clamp(y,hero.y-budget.y-LAG_Y_PX,hero.y+budget.y+LAG_Y_PX);
    this.center={x,y};
    return this.center;
  }
}

/** Screen point (CSS px, canvas) of a projected world point under a camera centred at `center`. */
export function toScreen(p:Point,center:Point,viewport:Viewport,zoom:number):Point{
  return {x:(p.x-center.x)*zoom+viewport.width/2,y:(p.y-center.y)*zoom+viewport.height/2};
}

/**
 * Off-screen API for the edge arrows and the minimap (UX-bordas-fora-da-tela, ORQ-minimapa; not drawn here):
 * whether a screen point is inside the useful area, and if not, where the ray from the area's centre towards it
 * leaves the area (`edge`, CSS px), with the screen angle (radians, 0 = right, y down) and the screen distance.
 */
export function edgeOf(point:Point,area:Rect,inset=0){
  const cx=area.x+area.width/2,cy=area.y+area.height/2;
  const hw=Math.max(0,area.width/2-inset),hh=Math.max(0,area.height/2-inset);
  const dx=point.x-cx,dy=point.y-cy;
  const inside=Math.abs(dx)<=area.width/2&&Math.abs(dy)<=area.height/2;
  const angle=Math.atan2(dy,dx);
  const t=Math.min(Math.abs(dx)>1e-9?hw/Math.abs(dx):Infinity,Math.abs(dy)>1e-9?hh/Math.abs(dy):Infinity);
  const s=Number.isFinite(t)?Math.min(1,t):0;
  return {inside,angle,distance:Math.hypot(dx,dy),edge:{x:cx+dx*s,y:cy+dy*s}};
}
