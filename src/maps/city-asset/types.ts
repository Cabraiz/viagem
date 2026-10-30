/** Format constants and the types of the city asset (see ../city-asset.ts for the format). */
import type {CityViaduct} from '../city/viaduct.ts';

export const CITY_FORMAT='viagem-city';
/** Version of the JSON layout; the map content version is `version` (it goes to the MapRef). */
export const CITY_FORMAT_VERSION=1;
export const MAX_JSON_CHARS=4_000_000;
/** Largest sample grid side; the cell grid is at most MAX_DIM/SAMPLES_PER_CELL per side. */
export const MAX_DIM=4096;
export const MAX_BLOCKS=20_000,MAX_PROPS=50_000,MAX_LOOT=5000,MAX_DECOR=50_000,MAX_VIADUCTS=16,MAX_PILLARS=256;
/** Turns a decor piece may take (degrees; see CityDecor.rot). */
export const DECOR_ROTS=[0,90,180,270] as const;
/** Total rectangles over all blocks (bounds an object handed to decode, where the text limit does not apply). */
export const MAX_RECTS=200_000;
export const SAMPLES_PER_CELL=4;
/** D-026: 1 cell = 0.88 u; the encoder uses it when the input leaves unitsPerCell out. */
export const UNITS_PER_CELL=0.88;
export const MAX_CELLS=MAX_DIM/SAMPLES_PER_CELL;
/** Largest |height| in units that fits Int16 centi-units. */
export const MAX_HEIGHT=327.67;
export const BLOCK_KINDS=['building','wall','cliff','rubble','edge'] as const;
export const BITS_ENCODING='bits-lsb-base64',HEIGHTS_ENCODING='i16le-centi-base64';
/** Slack for x+w / y+h of rectangles and the playable area at the far (E/S) map edge: 3-decimal roundings and double
 * sums (5.94+1.1 > 7.04) overshoot it slightly. The near (W/N) edge is strict: x,y >= 0. */
/** Added to x/step in walkableAt so exact sample edges do not fall into the previous sample. */
export const SAMPLE_NUDGE=1e-9;
export const EDGE_EPS=0.002;
export const MAX_ID=64,MAX_TEXT=1000;

export type CityBlockKind=typeof BLOCK_KINDS[number];
/** [x,y,w,h] in units. */
export type CityRect=readonly [number,number,number,number];
export interface CityPoint {readonly x:number; readonly y:number}
export interface CityArea {readonly x:number; readonly y:number; readonly w:number; readonly h:number}
export interface CityBlock {readonly id:string; readonly kind:CityBlockKind; readonly bbox:CityRect; readonly rects:readonly CityRect[]}
export interface CityProp {readonly x:number; readonly y:number; readonly r:number; readonly kind:string; readonly solid:boolean}
/**
 * A piece of the delivered scenery placed on the city (NEW-20261016-ORQ-cenario-no-mapa): art id without the view
 * (`posto-gasolina-1`, `muro-pichado-reto-intacto`…), its footprint in cells (c, r the top-left cell; w, h after the
 * turn) and its turn: `rot` is the art view that shows it with the camera at view 0 (0: front to +y, 90: +x, 180: −y,
 * 270: −x). Walls, fences and cliffs also carry `links`, the neighbours they join (N 1, E 2, S 4, W 8). Decor never
 * changes the walkable grid: pieces on blocks stand on unwalkable cells, the ones on sidewalks are walked through.
 */
export interface CityDecor {readonly id:string; readonly c:number; readonly r:number; readonly w:number; readonly h:number;
  readonly rot:typeof DECOR_ROTS[number]; readonly links?:number;
  /** Covers its cells and draws nothing: a wall cell beside its line (city-decor.ts wallLines), not a procedural box. */
  readonly cover?:true}
/** L = east (leste), O = west (oeste). All of them must be walkable. */
export interface CityPoints {
  readonly inicio:CityPoint; readonly praca:CityPoint;
  readonly spawnN:CityPoint; readonly spawnS:CityPoint; readonly spawnL:CityPoint; readonly spawnO:CityPoint;
  readonly bocas:{readonly N:CityPoint; readonly S:CityPoint; readonly L:CityPoint; readonly O:CityPoint};
}
/** sha256 (lowercase hex) of the source .w3x, as proof of origin; never the file itself. */
export interface CitySource {readonly sha256:string; readonly note:string}

/** Encoder input (the importer builds this). Grids: walkable/water (cells*4)^2 values 0/1, heights (cells+1)^2 in u. */
export interface CityAssetData {
  id:string; version:number; name:string;
  cells:{readonly w:number; readonly h:number}; unitsPerCell?:number;
  playable:CityArea;
  walkable:Uint8Array; water?:Uint8Array; heights:Float32Array;
  points:CityPoints; blocks:readonly CityBlock[]; props:readonly CityProp[]; loot:readonly CityPoint[];
  decor?:readonly CityDecor[];
  /** The viaducts (city/viaduct.ts; optional, an older reader ignores them). */
  viaducts?:readonly CityViaduct[];
  source?:CitySource;
}

export interface CityGrid {readonly w:number; readonly h:number; readonly step:number}

/** Decoded asset: read-only metadata plus O(1), allocation-free grid queries over the packed sections. */
export interface CityAsset {
  readonly id:string; readonly version:number; readonly name:string;
  readonly cells:{readonly w:number; readonly h:number}; readonly unitsPerCell:number;
  readonly size:{readonly w:number; readonly h:number};
  readonly playable:CityArea;
  readonly points:CityPoints; readonly blocks:readonly CityBlock[]; readonly props:readonly CityProp[];
  readonly loot:readonly CityPoint[]; readonly source?:CitySource;
  /** The placed scenery (empty when the asset has none). */
  readonly decor:readonly CityDecor[];
  /** The viaducts (city/viaduct.ts; empty when the asset has none). */
  readonly viaducts:readonly CityViaduct[];
  /** Walkable/water sample grid ((cells*4)^2, step = unitsPerCell/4). */
  readonly samples:CityGrid;
  /** Height corner grid ((cells+1)^2, step = unitsPerCell). */
  readonly heightGrid:CityGrid;
  readonly hasWater:boolean;
  /** Packed sections, shared and read-only (do not mutate). */
  readonly walkableBits:Uint8Array; readonly waterBits:Uint8Array|null; readonly heightsCenti:Int16Array;
  /** Sample walkability; outside the grid is false. */
  walkable(sx:number,sy:number):boolean;
  /** Sample water (shallow or deep); outside the grid or without a water section is false. */
  water(sx:number,sy:number):boolean;
  /** Walkability at a position in units. */
  walkableAt(x:number,y:number):boolean;
  /** Height in units at corner (hx,hy), clamped to the grid edge. */
  height(hx:number,hy:number):number;
  /** Bilinear height in units at a position in units, clamped to the grid edge. */
  heightAt(x:number,y:number):number;
}

export type CityAssetResult={ok:true; asset:CityAsset}|{ok:false; error:string};
