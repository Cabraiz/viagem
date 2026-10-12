/**
 * Person × terrain scale per map (D-026; measurements in viagem-board design/mvp-mapa-snow.md, section
 * "Proporção pessoa × terreno"; D-030 for the 56 px hero floor). Pure rules: no DOM, Phaser or network; only the
 * contract is imported (camera constants), as src/rules may depend on nothing else.
 *
 * - 'cidade-nevada' copies the world proportions of the .w3x (hero : street : block : map, speed × crossing time)
 *   through 1 WC3 unit = WC3_UNIT world units, with a zoom per orientation instead of the WC3 camera (D-009: phone only).
 * - 'infinito' is the current endless map, its values copied from the maps and sim sectors (rules may not import them; source lines next to each constant).
 *
 * Nothing is wired yet: the game still reads maps/world.ts, sim/enemies/catalog.ts and client/framing.ts; the camera
 * card (cidade-04) and the director wire it.
 */
import {HERO_MIN_SCREEN_PX,HERO_WORLD_PX,REFERENCE_SHORT_SIDE_PX,TILE_X} from '../contract/index.ts';

/** Our world units per WC3 unit. */
export const WC3_UNIT=0.006875;
/** WC3 units per map cell. */
export const WC3_CELL=128;

export type MapId='infinito'|'cidade-nevada';
export type Orientation='portrait'|'landscape';

export interface ScaleProfile {
  id:MapId;
  /** World units per map cell. */
  cell:number;
  /**
   * radius: collision radius (u). speed: u/s. drawnSize: on-screen size of the drawn figure (u), the measure
   * the camera's legibility floor uses (offscreen.ts HERO_WORLD_PX); bodies are smaller than their sprites.
   */
  readonly hero:{readonly radius:number;readonly speed:number;readonly drawnSize:number};
  /** Common enemy speed as a fraction of hero speed. */
  enemySpeedRatio:number;
  /** Radii relative to the hero radius. */
  readonly sizes:{readonly enemy:number;readonly boss:{readonly min:number;readonly max:number}};
  /** Target visible world width, in cells, per orientation ([min,max], equal when fixed). */
  zoom:Readonly<Record<Orientation,readonly [number,number]>>;
}

/** Source measurements of the city map (WC3 units, scales relative to the hero; design/mvp-mapa-snow.md). */
export const CIDADE_NEVADA_WC3=Object.freeze({
  /** Collision radius of the hero (Blood Mage default). */
  heroRadius:32,
  /** Hero speed, WC3 units/second. */
  heroSpeed:290,
  /** Common zombie speed, WC3 units/second (≈0.9× the hero). */
  enemySpeed:260,
  /** Common zombie model scale. */
  enemyScale:1.3,
  /** Boss model scales [min,max]. */
  bossScale:Object.freeze([2,3.5]) as readonly [number,number],
  /** Whole map side, in cells (= 24,576 WC3 units, ~85 s to cross). */
  mapCells:192,
  /** Start (crashed helicopter, S) to the fountain plaza, WC3 units (~33 s). */
  startToPlaza:9600,
  /** Plaza to each of the 4 spawns, WC3 units (~36 s). */
  plazaToSpawn:10500,
  /** Default WC3 game camera width, in cells (4:3 estimate). */
  cameraCells:18,
  /**
   * The drawn hero reads as about one cell on screen (the doc's ~45 px landscape / ~36–40 px portrait / ~22 px
   * literal-WC3-portrait figures are all screen width ÷ visible cells), while its collision is ½ cell.
   */
  heroDrawnCells:1,
});

// ---------- Current endless map ("o atual"): maps/sim values copied (rules may only import the contract) ----------
/** src/maps/world.ts:8 RADIUS. */
const INF_HERO_RADIUS=.22;
/** src/maps/world.ts:7 SPEED. */
const INF_HERO_SPEED=3.1;
/** src/sim/enemies/catalog.ts:39 gosma speed and radius. */
const INF_GOSMA_SPEED=1.4,INF_GOSMA_RADIUS=.32;
/** src/sim/enemies/catalog.ts:67 chefe radius (the only boss kind). */
const INF_BOSS_RADIUS=.9;
/** One terrain tile is 1 world unit: src/maps/world.ts:29 project (42 px per unit on x−y, 21 on x+y). */
const INF_CELL=1;
/** Camera constants from the contract (src/contract/offscreen.ts): tile width, drawn hero, 56 px floor, reference phone. */
const INF_TILE_X=TILE_X,INF_HERO_WORLD_PX=HERO_WORLD_PX,INF_SHORT_PX=REFERENCE_SHORT_SIDE_PX;
/** D-009 reference phone long side (390×844). */
const INF_LONG_PX=844;
/**
 * src/client/framing.ts:60-64 followZoom: on the reference phones the floor wins, zoom = 56/96 CSS px per world px
 * in both orientations, so the screen shows viewport width × 96/56 world px. One world unit along the screen's x
 * axis is 42·√2 px (offscreen.ts:26-27), so the visible width is ≈11.26 u in portrait and ≈24.36 u in landscape.
 * Landscape width grows with the aspect ratio there (the zoom follows the short side); this is the 844×390 value.
 */
/** Drawn hero size in units: HERO_WORLD_PX over the world px of one unit along screen x (≈1.62 u, 56 CSS px at the floor zoom). */
const INF_HERO_DRAWN=INF_HERO_WORLD_PX/(INF_TILE_X*Math.SQRT2);
const infWidth=(screenPx:number)=>screenPx*INF_HERO_WORLD_PX/HERO_MIN_SCREEN_PX/(INF_TILE_X*Math.SQRT2)/INF_CELL;

const freezeProfile=(p:ScaleProfile):Readonly<ScaleProfile>=>{
  Object.freeze(p.hero);Object.freeze(p.sizes.boss);Object.freeze(p.sizes);
  Object.freeze(p.zoom.portrait);Object.freeze(p.zoom.landscape);Object.freeze(p.zoom);
  return Object.freeze(p);
};
const fixed=(cells:number)=>[cells,cells] as const;

export const SCALE_PROFILES:Readonly<Record<MapId,Readonly<ScaleProfile>>>=Object.freeze({
  infinito:freezeProfile({
    id:'infinito',cell:INF_CELL,
    hero:{radius:INF_HERO_RADIUS,speed:INF_HERO_SPEED,drawnSize:INF_HERO_DRAWN},
    enemySpeedRatio:INF_GOSMA_SPEED/INF_HERO_SPEED,
    sizes:{enemy:INF_GOSMA_RADIUS/INF_HERO_RADIUS,boss:{min:INF_BOSS_RADIUS/INF_HERO_RADIUS,max:INF_BOSS_RADIUS/INF_HERO_RADIUS}},
    zoom:{portrait:fixed(infWidth(INF_SHORT_PX)),landscape:fixed(infWidth(INF_LONG_PX))},
  }),
  'cidade-nevada':freezeProfile({
    id:'cidade-nevada',cell:WC3_CELL*WC3_UNIT,
    hero:{radius:CIDADE_NEVADA_WC3.heroRadius*WC3_UNIT,speed:CIDADE_NEVADA_WC3.heroSpeed*WC3_UNIT,drawnSize:CIDADE_NEVADA_WC3.heroDrawnCells*WC3_CELL*WC3_UNIT},
    enemySpeedRatio:CIDADE_NEVADA_WC3.enemySpeed/CIDADE_NEVADA_WC3.heroSpeed,
    sizes:{enemy:CIDADE_NEVADA_WC3.enemyScale,boss:{min:CIDADE_NEVADA_WC3.bossScale[0],max:CIDADE_NEVADA_WC3.bossScale[1]}},
    // Landscape copies the WC3 camera (~18 cells); portrait shows ~10–11 cells so the hero stays legible (D-009).
    zoom:{landscape:fixed(CIDADE_NEVADA_WC3.cameraCells),portrait:[10,11]},
  }),
});

// ---------- Validation ----------
const finite=(name:string,v:number)=>{
  if(typeof v!=='number'||!Number.isFinite(v))throw new RangeError(`${name} must be a finite number, got ${String(v)}`);
  return v;
};
const nonNegative=(name:string,v:number)=>{
  if(finite(name,v)<0)throw new RangeError(`${name} must not be negative, got ${v}`);
  return v;
};
const positive=(name:string,v:number)=>{
  if(finite(name,v)<=0)throw new RangeError(`${name} must be greater than zero, got ${v}`);
  return v;
};
const checked=(p:ScaleProfile)=>{
  if(!p||typeof p!=='object'||!p.hero||!p.sizes||!p.zoom)throw new RangeError('profile must be a ScaleProfile');
  positive('profile.cell',p.cell);positive('profile.hero.radius',p.hero.radius);positive('profile.hero.speed',p.hero.speed);positive('profile.hero.drawnSize',p.hero.drawnSize);
  return p;
};

// ---------- Lookups ----------
export function isMapId(value:unknown):value is MapId{
  return typeof value==='string'&&Object.prototype.hasOwnProperty.call(SCALE_PROFILES,value);
}
export function scaleProfile(id:MapId):Readonly<ScaleProfile>{
  if(!isMapId(id))throw new RangeError(`unknown map id: ${String(id)}`);
  return SCALE_PROFILES[id];
}

// ---------- Conversions (lengths, not coordinates: translate WC3 coordinates to a corner origin first) ----------
export function wc3ToUnits(wc3:number):number{return nonNegative('wc3 length',wc3)*WC3_UNIT;}
export function unitsToWc3(units:number):number{return nonNegative('units',units)/WC3_UNIT;}
export function cellsToUnits(cells:number,profile:ScaleProfile):number{return nonNegative('cells',cells)*checked(profile).cell;}
export function unitsToCells(units:number,profile:ScaleProfile):number{return nonNegative('units',units)/checked(profile).cell;}

// ---------- Bodies and speeds ----------
/** Hero diameter in cells (cidade-nevada ≈ 0.5). */
export function heroWidthCells(profile:ScaleProfile):number{const p=checked(profile);return 2*p.hero.radius/p.cell;}
/** Common enemy speed in u/s; `multiplier` scales per enemy kind (1 = common). */
export function enemySpeed(profile:ScaleProfile,multiplier=1):number{
  const p=checked(profile);
  return p.hero.speed*nonNegative('profile.enemySpeedRatio',p.enemySpeedRatio)*nonNegative('multiplier',multiplier);
}
/** Radius for a size relative to the hero (1 = hero, profile.sizes.enemy = common enemy). */
export function relativeRadius(profile:ScaleProfile,relative:number):number{
  return checked(profile).hero.radius*nonNegative('relative size',relative);
}
/** Seconds to walk `distance` world units at `speed` (default hero speed). */
export function traversalSeconds(distance:number,profile:ScaleProfile,speed?:number):number{
  const p=checked(profile);
  return nonNegative('distance',distance)/positive('speed',speed===undefined?p.hero.speed:speed);
}
/**
 * Converts a speed authored for one profile to another, keeping its fraction of the hero speed
 * (gosma at 1.4 of a 3.1 hero → same share of the 1.99 city hero). Both heroes are 0.22 wide, so
 * a widths-per-second rule would be a no-op between them.
 */
export function convertSpeed(speed:number,from:ScaleProfile,to:ScaleProfile):number{
  return nonNegative('speed',speed)/checked(from).hero.speed*checked(to).hero.speed;
}

// ---------- Camera ----------
/** Square counts as portrait, like framing.ts (`height>=width`) and the CSS orientation query. */
export function cameraOrientation(width:number,height:number):Orientation{
  return positive('width',width)>positive('height',height)?'landscape':'portrait';
}
/** Target visible world width in units for an orientation (midpoint of the zoom range). */
export function visibleWidthUnits(profile:ScaleProfile,orientation:Orientation):number{
  const p=checked(profile);
  if(orientation!=='portrait'&&orientation!=='landscape')throw new RangeError(`unknown orientation: ${String(orientation)}`);
  const range=p.zoom[orientation];
  const lo=positive(`zoom.${orientation}[0]`,range[0]),hi=positive(`zoom.${orientation}[1]`,range[1]);
  if(hi<lo)throw new RangeError(`zoom.${orientation} must be [min,max], got [${lo},${hi}]`);
  return (lo+hi)/2*p.cell;
}
/** Widest view (world units) that still draws the hero at `minHeroPixels` on a viewport this wide. */
export function floorWidthUnits(profile:ScaleProfile,viewportWidth:number,minHeroPixels=HERO_MIN_SCREEN_PX):number{
  return positive('viewportWidth',viewportWidth)*checked(profile).hero.drawnSize/positive('minHeroPixels',minHeroPixels);
}
/**
 * Camera target for a CSS viewport (D-030): the faithful D-026 width (visibleWidthUnits), narrowed when needed so the
 * drawn hero never falls under the 56 px floor. On 844×390 that is ≈15.1 cells (not 18) and on 390×844 ≈7.0 (not
 * 10.5); `floored` says the floor won. pixelsPerUnit is along screen x (screen y is half, TILE_Y); Phaser zoom =
 * pixelsPerUnit / (42·√2). heroPixels is the drawn figure, bodyPixels the collision diameter. Width-only: the camera
 * card (cidade-04) adds a height cap for near-square screens. The 'infinito' widths are snapshots of framing.ts
 * followZoom on the D-009 phones only; the endless map keeps using followZoom.
 */
export function zoomFor(profile:ScaleProfile,viewportWidth:number,viewportHeight:number,minHeroPixels=HERO_MIN_SCREEN_PX):{orientation:Orientation;pixelsPerUnit:number;visibleWidth:number;visibleCells:number;floored:boolean;heroPixels:number;bodyPixels:number}{
  const p=checked(profile),orientation=cameraOrientation(viewportWidth,viewportHeight);
  const faithful=visibleWidthUnits(p,orientation),floor=floorWidthUnits(p,viewportWidth,minHeroPixels);
  // Small tolerance so a profile tuned exactly at the floor (infinito) does not flip to `floored` by rounding.
  const floored=floor<faithful-1e-9,visibleWidth=floored?floor:faithful,pixelsPerUnit=viewportWidth/visibleWidth;
  return {orientation,pixelsPerUnit,visibleWidth,visibleCells:visibleWidth/p.cell,floored,
    heroPixels:p.hero.drawnSize*pixelsPerUnit,bodyPixels:2*p.hero.radius*pixelsPerUnit};
}
