/**
 * Minimap art made with ChatGPT (card NEW-20261025-ORQ-minimapa-arte-chatgpt; sources and prompts in
 * evidence/minimapa-arte-chatgpt/, built by scripts/minimapa/atlas.mjs):
 * - `marcas.webp`: one row of MM_CELL px cells, the playable heroes' faces (round, transparent around the head, so the
 *   team colour drawn under them shows) then the icons that replace the drawn squares and dots;
 * - `cidade-nevada.webp`: the city seen from above, world-aligned (the minimap turns it to its diamond like the old
 *   per-cell image), painted over the real plan (IoU of the solid mask 0.964, scripts/minimapa/iou.ts). It is only
 *   used for the asset it was painted from (MM_CITY_ART): another map, or a new version of this one, keeps the
 *   procedural image until the art is painted again.
 *
 * Both load once, lazily, on the first paint; until they arrive (or with no DOM: the node tests) the minimap draws its
 * old shapes. Each mark is then one drawImage from the atlas: no path, font or style per mark.
 */
import type {TerrainImage} from './terrain.ts';

/** The faces' order in the atlas (class ids): every playable class (rules PLAYABLE_CLASS_IDS), the bots' too. */
export const MM_FACES=Object.freeze(['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','aposentado','vendedor-praia',
  'coach','concurseira','faxineira','feirante','mendigo','passageira','pedreiro','streamer','universitario','vizinha-fofoqueira'] as const);
/** The icons' order in the atlas, after the faces. */
export const MM_ICONS=Object.freeze(['barricada','torre','banco','ninho','uno','moto','entrega','chefao','base','obra','inimigo','bau'] as const);
export type MmIcon=typeof MM_ICONS[number];
export const MM_CELL=64;
export const MM_MARKS_URL='/art/minimapa/marcas.webp',MM_CITY_URL='/art/minimapa/cidade-nevada.webp';
/** The asset the city art was painted from, and the art's side in px. */
export const MM_CITY_ART=Object.freeze({id:'cidade-nevada',version:5,side:512});

/** The atlas cell of a class's face, or -1 (no face: the mark stays a dot in the team colour). */
export const faceCell=(classId:string|undefined)=>classId?MM_FACES.indexOf(classId as typeof MM_FACES[number]):-1;
export const iconCell=(icon:MmIcon)=>MM_FACES.length+MM_ICONS.indexOf(icon);

type Img={readonly complete:boolean;readonly naturalWidth:number};
const images=new Map<string,HTMLImageElement|null>();
/** The image at `url` once decoded; undefined while it loads, or always without a DOM. */
function loaded(url:string):HTMLImageElement|undefined{
  let img=images.get(url);
  if(img===undefined){
    img=typeof Image==='function'?Object.assign(new Image(),{decoding:'async' as const}):null;
    if(img)img.src=url;
    images.set(url,img);
  }
  return img&&ready(img)?img:undefined;
}
const ready=(img:Img)=>img.complete&&img.naturalWidth>0;

/** The marks' atlas, when loaded. */
export const marksAtlas=()=>loaded(MM_MARKS_URL);

/** The painted city as a terrain image (smooth), when this asset is the one it was painted from and it has loaded. */
export function cityArtTerrain(asset:{id:string;version:number;cells:{w:number;h:number};unitsPerCell:number}):TerrainImage|undefined{
  if(asset.id!==MM_CITY_ART.id||asset.version!==MM_CITY_ART.version)return undefined;
  const img=loaded(MM_CITY_URL);if(!img)return undefined;
  const side=MM_CITY_ART.side;
  return cityArt??={canvas:img,origin:{x:0,y:0},unit:asset.cells.w*asset.unitsPerCell/side,width:side,height:side,smooth:true};
}
let cityArt:TerrainImage|undefined;
