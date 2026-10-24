/**
 * The Cidade Nevada as the city HUD reads it (doc §1, §3): its size, the plaza, the 4 avenue mouths and the start, for
 * the edge arrows (edges.ts), the active mouths (wiring.ts) and the barricades (barricade.ts). Pure data, no DOM. The
 * minimap itself is the WC3 one (hud/wc-minimap/*), on every map.
 */
import {CIDADE_NEVADA_WC3,CITY_COMPACT,CITY_DISTANCE_SCALE,SCALE_PROFILES} from './deps.ts';

/**
 * World units: the city spans [0, CITY_SIZE] on x and y (row 0 = north, x west to east), the plaza at its centre. The
 * asset's size: 110 cells (the .w3x's 192 ÷ CITY_COMPACT, asset v4, NEW-20261023-ORQ-mapa-175-com-viaduto) × the map
 * cell (1.496 u since the 1.7× map, NEW-20261013-ORQ-cidade-escala-1-7) = 164.56 u.
 */
export const CITY_SIZE=Math.round(Math.round(CIDADE_NEVADA_WC3.mapCells/CITY_COMPACT)*SCALE_PROFILES['cidade-nevada'].cell*1000)/1000;
export type MouthId='N'|'S'|'L'|'O';
/**
 * A mouth is its avenue's far end (x, y: where the critters come in); `gate`, when known, is that avenue's entrance on
 * the plaza wall (the asset's `bocas`), which tells an avenue spawn from one inside the plaza (wiring.ts mouthOfWarning).
 */
export interface CityMapInfo {size:number;plaza:{x:number;y:number;radius:number};mouths:{id:MouthId;x:number;y:number;gate?:{x:number;y:number}}[];start:{x:number;y:number}}
const C=CITY_SIZE/2;
/**
 * Until the importer's asset exists: plaza in the centre, the 4 avenue ends, the start in the south district. Plaza
 * radius and start offset are map lengths (10 and 14 u on the .w3x map) × CITY_DISTANCE_SCALE (CITY_MAP_SCALE ÷ CITY_COMPACT, mapa-175-com-viaduto).
 */
export const DEFAULT_CITY:CityMapInfo={size:CITY_SIZE,plaza:{x:C,y:C,radius:10*CITY_DISTANCE_SCALE},
  mouths:[{id:'N',x:C,y:0},{id:'S',x:C,y:CITY_SIZE},{id:'L',x:CITY_SIZE,y:C},{id:'O',x:0,y:C}],start:{x:C,y:CITY_SIZE-14*CITY_DISTANCE_SCALE}};
