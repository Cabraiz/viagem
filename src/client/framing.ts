import type {TerrainField} from '../maps/index.ts';
import {SPEED,heroSpeed,isLand,landmarks,obstacles,project,type Point} from '../maps/index.ts';
import {SCALE_PROFILES,zoomFor} from '../rules/index.ts';
import {projectView,normalizeView} from './projection.ts';
import {HERO_MARGIN} from './hud/zones.ts';
import {CAMERA_LAG_UNITS,CAMERA_OFFSET_LONG_PX,CAMERA_OFFSET_SHORT_PX,HERO_MIN_SCREEN_PX,HERO_WORLD_PX,MAX_ASPECT,REFERENCE_SHORT_SIDE_PX,TILE_X,TILE_Y,VISIBLE_LONG_PX,VISIBLE_SHORT_PX} from '../contract/index.ts';

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
 * Zoom for one viewport (UX-camera-segue 1: one zoom per orientation). At the player's zoom `k` = 1 (the closest,
 * camera-zoom.ts) the hero is the larger of the VS ratio and the floor ratio of the short side, never under 56 CSS px,
 * and the camera shows at most today's world (TODAY_SHORT_PX × MAX_ASPECT): the zoom of before D-046 on every screen.
 * A smaller `k` (D-046: the wheel or a pinch, eased by the scene) scales that whole zoom, caps included, so a wide
 * desktop window keeps its whole range and at the default `k` never shows more than the default camera the director
 * paces by (offscreen.ts HERO_DEFAULT_SCREEN_PX). Never more world than the off-screen contract (the widest camera,
 * VISIBLE_SHORT_PX × VISIBLE_LONG_PX world px), so nothing the director spawns "off screen" can pop up on this phone.
 */
export function followZoom(viewport:Viewport,k=1){
  const short=Math.max(1,Math.min(viewport.width,viewport.height)),long=Math.max(1,viewport.width,viewport.height);
  const hero=Math.max(HERO_MIN_SCREEN_PX,short*Math.max(VS_HERO_SHORT_RATIO,HERO_SHORT_RATIO));
  const today=Math.max(hero/HERO_WORLD_PX,short/TODAY_SHORT_PX,long/(TODAY_SHORT_PX*MAX_ASPECT));
  return Math.max(today*k,short/VISIBLE_SHORT_PX,long/VISIBLE_LONG_PX);
}
/** The widest short side (world px) of the camera before D-046: the hero at the 56 px floor on a 390 px short side. */
export const TODAY_SHORT_PX=HERO_WORLD_PX*REFERENCE_SHORT_SIDE_PX/HERO_MIN_SCREEN_PX;

/** Smoothing time constant of the follow (UX-camera-segue 3: 120-200 ms). */
export const FOLLOW_TAU_S=.16;
/** Look-ahead: this share of the useful area's half extent, in the direction the hero walks on screen (UX: ~15%). */
export const LOOK_AHEAD=.15;
/** The look-ahead eases in and out over this time constant, so stopping never jerks the view. */
export const LOOK_TAU_S=.4;
/** Where the hero's body sits over its feet (the figure is 96 world px tall, feet at the sprite origin): its middle. */
export const HERO_BODY_UP_PX=HERO_WORLD_PX/2;
/** Hero figure size on screen (CSS px) when the scene does not say: 96 world px tall, about as wide. */
export interface Size {width:number;height:number}
/** The farthest the camera may trail the hero, in world px along the screen axes (offscreen.ts CAMERA_LAG_UNITS). */
export const LAG_X_PX=TILE_X*Math.SQRT2*CAMERA_LAG_UNITS,LAG_Y_PX=TILE_Y*Math.SQRT2*CAMERA_LAG_UNITS;

const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

// ---------- City camera (cidade-04: D-026 world proportions, D-030 hero floor) ----------

const CITY_PROFILE=SCALE_PROFILES['cidade-nevada'];
/**
 * City world px per endless-map world px for everything drawn at the endless map's size (hero and ally sheets, enemy
 * art, the camera's world-px offsets): the city's drawn hero (1 cell, 0.88 u) over the endless map's (96 world px =
 * 1.616 u), ≈0.5445. The city zoom is 1/CITY_VIEW_SCALE times the endless one, so a figure scaled by it keeps its CSS
 * size (hero ≈56 px on 390×844 and 844×390) while the ground shows the city's faithful proportions.
 * Same expression as sim/city/avenues.ts CITY_VIEW_SCALE (the client may not import the sim; tests/client/city-camera.test.ts keeps them equal).
 */
export const CITY_VIEW_SCALE=CITY_PROFILE.hero.drawnSize/SCALE_PROFILES.infinito.hero.drawnSize;

/**
 * How the follow camera reads one world: `scale` multiplies its world-px constants (offset budget, lag, body height,
 * default hero box), `speed` is the hero's walking speed (u/s) that gives a full look-ahead. Island and endless map: 1 and SPEED.
 */
export interface FollowWorld {readonly scale:number;readonly speed:number}
export const ENDLESS_FOLLOW:FollowWorld=Object.freeze({scale:1,speed:SPEED});
/** A terrain as the scene or the net has it (TerrainField; CityTerrain says world 'cidade'). */
type WorldOf=Parameters<typeof heroSpeed>[0];
export const isCityWorld=(terrain:WorldOf)=>terrain?.world==='cidade';
/** The follow camera's world for a terrain: CITY_VIEW_SCALE and the city hero speed (maps heroSpeed) in the city. */
export function followWorld(terrain:WorldOf):FollowWorld{
  return isCityWorld(terrain)?Object.freeze({scale:CITY_VIEW_SCALE,speed:heroSpeed(terrain)}):ENDLESS_FOLLOW;
}

/**
 * City zoom (D-030, D-046): at the player's zoom k = 1, rules zoomFor (the faithful 18 / 10.5 cells, narrowed so the drawn
 * hero is never under 56 CSS px: ≈15.07 cells on 844×390, ≈6.96 on 390×844) in Phaser terms; a smaller k scales it, as
 * followZoom does, pixelsPerUnit over the 42·√2 world px of one unit along
 * screen x: ≈1.0713 on both reference phones. zoomFor is width-only, so followZoom's caps apply too, in city world px:
 * never more world than the off-screen contract scaled by CITY_VIEW_SCALE (what sim/city/avenues.ts cityVisible
 * assumes). On a wider phone that keeps the hero at the endless map's share of the short side.
 */
export function cityZoom(viewport:Viewport,k=1){
  const w=Math.max(1,viewport.width),h=Math.max(1,viewport.height),short=Math.min(w,h),long=Math.max(w,h);
  const floor=zoomFor(CITY_PROFILE,w,h).pixelsPerUnit/(TILE_X*Math.SQRT2);
  // Never more world than the endless map shows at the same factor (its hero share of the short side), scaled to the
  // city: with the widest-camera contract (D-046) the caps alone no longer pin a wider phone to that share.
  return Math.max(floor*k,followZoom(viewport,k)/CITY_VIEW_SCALE);
}
/** The follow zoom of a terrain at the player's zoom `k`: cityZoom in the city, followZoom on the island and the endless map. */
export function worldZoom(viewport:Viewport,terrain:WorldOf,k=1){return isCityWorld(terrain)?cityZoom(viewport,k):followZoom(viewport,k);}
/**
 * The horde's legibility multiplier for text, balloons and markers (HordeRendererOptions.uiScale): ≥ 1 under ~0.55 of
 * the endless-map-equivalent zoom (zoom × scale), times `scale`, so a city number or balloon reads at the same CSS size.
 */
export function hordeUiScale(zoom:number,scale=1){return Math.max(1,Math.min(2.5,.55/(zoom*scale)))*scale;}

/** Offset budget (world px) of the hero's feet from the camera centre along screen x and y, for this viewport. */
export function offsetBudget(viewport:Viewport,scale=1){
  const portrait=viewport.height>=viewport.width;
  return portrait?{x:CAMERA_OFFSET_SHORT_PX*scale,y:CAMERA_OFFSET_LONG_PX*scale}:{x:CAMERA_OFFSET_LONG_PX*scale,y:CAMERA_OFFSET_SHORT_PX*scale};
}

/**
 * Where the hero's feet should sit on screen (CSS px, canvas coordinates): the body centred in the useful area
 * (UX-zonas-tela), or the screen centre when there is no HUD (solo exploration, waiting room).
 */
export function anchorOf(viewport:Viewport,zoom:number,useful?:Rect,hero?:Size,scale=1):Point{
  const area=areaOf(viewport,useful);
  return {x:area.x+area.width/2,y:area.y+area.height/2+(hero?hero.height/2:HERO_BODY_UP_PX*scale*zoom)};
}
const areaOf=(viewport:Viewport,useful?:Rect):Rect=>useful&&useful.width>0&&useful.height>0?useful:{x:0,y:0,width:viewport.width,height:viewport.height};
/**
 * Largest look-ahead (world px per screen axis): LOOK_AHEAD of the useful area's half extent, but never so much that
 * the hero's box ± HERO_MARGIN leaves the useful area (landscape: the area is ~155 px tall, so it is ~8 px there).
 */
export function lookLimit(viewport:Viewport,zoom:number,useful?:Rect,hero?:Size,scale=1):Point{
  const area=areaOf(viewport,useful),h=hero??{width:HERO_WORLD_PX*scale*zoom,height:HERO_WORLD_PX*scale*zoom};
  const axis=(half:number,heroHalf:number)=>Math.max(0,Math.min(LOOK_AHEAD*half,half-heroHalf-HERO_MARGIN))/zoom;
  return {x:axis(area.width/2,h.width/2),y:axis(area.height/2,h.height/2)};
}

/**
 * Camera centre (world px, Phaser camera.centerOn) that puts the hero's feet (`hero`, projected world px) at the
 * anchor, shifted by the look-ahead (world px, towards where the hero walks), with the hero-to-centre offset kept
 * inside the off-screen contract budget. `scale`: FollowWorld.scale (CITY_VIEW_SCALE in the city).
 */
export function followTarget(hero:Point,viewport:Viewport,zoom:number,useful?:Rect,look:Point={x:0,y:0},size?:Size,free=false,scale=1):Point{
  const anchor=anchorOf(viewport,zoom,useful,size,scale),budget=free?{x:Infinity,y:Infinity}:offsetBudget(viewport,scale);
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
  /** Off with prefers-reduced-motion: the camera still follows, without the extra sway of looking ahead. */
  lookAhead=true;
  /**
   * Out of the round (waiting room, result) nothing spawns, so the off-screen budget does not apply and the hero can go
   * to a band far from the screen centre (beside the waiting panel). Back in the round the camera cuts into the budget.
   */
  free=false;
  /** The world's scale and hero speed (followWorld): set by the scene on every fit (first frame, resize, map switch). */
  world:FollowWorld=ENDLESS_FOLLOW;
  private last?:Point;
  private ready=false;
  get placed(){return this.ready;}
  snap(hero:Point,viewport:Viewport,zoom:number,useful?:Rect,size?:Size){
    this.look={x:0,y:0};this.last={...hero};this.ready=true;
    this.center=followTarget(hero,viewport,zoom,useful,this.look,size,this.free,this.world.scale);
    return this.center;
  }
  /** Moves the whole frame by (dx, dy) world px (a re-based projection): no visible change on screen. */
  shift(dx:number,dy:number){this.center.x+=dx;this.center.y+=dy;if(this.last){this.last.x+=dx;this.last.y+=dy;}}
  step(hero:Point,seconds:number,viewport:Viewport,zoom:number,useful?:Rect,size?:Size){
    if(!this.ready||!this.last)return this.snap(hero,viewport,zoom,useful,size);
    const dt=clamp(seconds,0,.25);
    const scale=this.world.scale,limit=this.lookAhead?lookLimit(viewport,zoom,useful,size,scale):{x:0,y:0};
    if(dt>0){
      // Look-ahead from the hero's screen velocity; a jump (teleport, respawn) does not count as walking.
      // Speed as a share of walking speed per screen axis (isometric: 1 u is 59.4 px across, 29.7 px down): the hero
      // screen speed (world px/s) walking at the world's hero speed along the screen's x and y axes is a full look-ahead.
      const walkX=this.world.speed*TILE_X*Math.SQRT2,walkY=this.world.speed*TILE_Y*Math.SQRT2;
      const nx=(hero.x-this.last.x)/dt/walkX,ny=(hero.y-this.last.y)/dt/walkY,speed=Math.hypot(nx,ny);
      const k=speed>.05&&speed<3?Math.min(1,speed)/speed:0;
      const want={x:nx*k*limit.x,y:ny*k*limit.y};
      const ease=1-Math.exp(-dt/LOOK_TAU_S);
      this.look.x+=(want.x-this.look.x)*ease;this.look.y+=(want.y-this.look.y)*ease;
    }
    // A smaller useful area (offer opened, rotation) shrinks the limit at once, the easing only applies inside it.
    this.look.x=clamp(this.look.x,-limit.x,limit.x);this.look.y=clamp(this.look.y,-limit.y,limit.y);
    this.last={...hero};
    const target=followTarget(hero,viewport,zoom,useful,this.look,size,this.free,scale);
    const blend=1-Math.exp(-dt/FOLLOW_TAU_S);
    let x=this.center.x+(target.x-this.center.x)*blend,y=this.center.y+(target.y-this.center.y)*blend;
    // The off-screen contract: the hero is never farther from the camera centre than the offset budget plus
    // CAMERA_LAG_UNITS of trailing (both × the world's scale). A target that moves inside the budget is still eased.
    const budget=this.free?{x:Infinity,y:Infinity}:offsetBudget(viewport,scale),lagX=LAG_X_PX*scale,lagY=LAG_Y_PX*scale;
    x=clamp(x,hero.x-budget.x-lagX,hero.x+budget.x+lagX);y=clamp(y,hero.y-budget.y-lagY,hero.y+budget.y+lagY);
    this.center={x,y};
    return this.center;
  }
}

/**
 * Out of the round (waiting room, between runs) the waiting panel covers the middle of the screen: the hero goes to
 * the roomiest free band around it (above, below, left or right), so the player still sees the hero turning the view.
 */
export function freeAround(viewport:Viewport,blocker:Rect,floor=viewport.height):Rect{
  // `floor`: the top of the thumb zones, so the hero never stands on the joystick (UX onda 4 D2).
  const h=Math.max(0,Math.min(viewport.height,floor));
  const bands:Rect[]=[
    {x:0,y:0,width:viewport.width,height:Math.max(0,Math.min(blocker.y,h))},
    {x:0,y:blocker.y+blocker.height,width:viewport.width,height:Math.max(0,h-blocker.y-blocker.height)},
    {x:0,y:0,width:Math.max(0,blocker.x),height:h},
    {x:blocker.x+blocker.width,y:0,width:Math.max(0,viewport.width-blocker.x-blocker.width),height:h},
  ];
  // The roomiest band for a standing hero: the largest smaller side (a thin full-width strip loses to a side column).
  const fit=(r:Rect)=>Math.min(r.width,r.height);
  return bands.reduce((a,b)=>fit(b)>fit(a)?b:a);
}

/**
 * The local prediction moves in 20 Hz steps (net.input every STEP). Drawing it as is makes the follow camera step
 * too (1.7-2.4 px per frame at 30 fps). The scene pushes each new predicted point and draws the point between the
 * last two at the accumulator's fraction: one step (50 ms) behind, and smooth at any frame rate.
 */
export class StepLerp {
  private prev?:Point;private cur?:Point;
  /** A new simulated step (after net.input). */
  push(p:Point){this.prev=this.cur?{...this.cur}:{...p};this.cur={...p};}
  /** The prediction moved outside a step (server reconcile, respawn): a jump over `snap` units is not interpolated. */
  sync(p:Point,snap=3){
    if(!this.cur||!this.prev){this.prev={...p};this.cur={...p};return;}
    if(p.x===this.cur.x&&p.y===this.cur.y)return;
    if(Math.hypot(p.x-this.cur.x,p.y-this.cur.y)>snap)this.prev={...p};
    this.cur={...p};
  }
  /** The prediction was reconciled by (dx, dy): both points move with it, so the step in progress stays smooth. */
  shift(dx:number,dy:number){
    if(this.prev){this.prev.x+=dx;this.prev.y+=dy;}
    if(this.cur){this.cur.x+=dx;this.cur.y+=dy;}
  }
  at(fraction:number):Point{
    if(!this.cur||!this.prev)return {x:0,y:0};
    const t=clamp(fraction,0,1);
    return {x:this.prev.x+(this.cur.x-this.prev.x)*t,y:this.prev.y+(this.cur.y-this.prev.y)*t};
  }
}

/** A teammate as the spectator camera sees it. */
export interface Watchable {id:string;x:number;y:number;standing:boolean;inRun:boolean}
/**
 * Who the camera follows when the local player is out (eliminated) or watching (joined mid-run) (UX onda 4): the
 * current pick while it is still standing; else the nearest standing teammate to where the camera is; else the
 * nearest one still in the run (downed); else nobody (the camera stays where it was until the result).
 */
export function chooseWatched(players:readonly Watchable[],from:Point,current?:string):string|undefined{
  const cur=players.find(p=>p.id===current);
  if(cur?.standing)return cur.id;
  const pick=(list:readonly Watchable[])=>list.reduce<Watchable|undefined>((best,p)=>!best||Math.hypot(p.x-from.x,p.y-from.y)<Math.hypot(best.x-from.x,best.y-from.y)?p:best,undefined)?.id;
  return pick(players.filter(p=>p.standing))??pick(players.filter(p=>p.inRun));
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
