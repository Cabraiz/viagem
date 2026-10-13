/**
 * Cidade Nevada legibility rules for what is drawn over the snow (card NEW-20261012-E8-cidade-contorno-breu,
 * cidade-nevada-arte.md §6–§7, cidade-nevada/contraste.md): only Breu passes 3:1 on every city ground, so in the city
 * every colored mark on the ground gets an outer Breu edge of 2 CSS px, and contact shadows are Breu at 38%.
 * Pure module (no Phaser): the island and the endless map keep their exact values (tests/client/city-edge.test.ts).
 */

/** Breu (#1E1530, tokens.css --c-breu): the color for code paths that cannot read the token (pure rules, tests). */
export const BREU=0x1e1530;
/** Outer Breu edge of a mark on the city ground, CSS px (screen-constant at any zoom). */
export const CITY_BREU_EDGE_CSS=2;

/** Contact shadow under a figure: color and alpha. */
export interface ContactShadow {color:number;alpha:number}
/** The hero's contact shadow on the island and the endless map (scene.ts, unchanged). */
export const ISLAND_HERO_SHADOW:ContactShadow=Object.freeze({color:0x3d756a,alpha:.2});
/** City contact shadow (§6, luz.sombra-contato): Breu at 38%, under heroes, allies, critters and pickups. */
export const CITY_CONTACT_SHADOW:ContactShadow=Object.freeze({color:BREU,alpha:.38});
/** The hero's (and in the city, each ally's) shadow ellipse, world px at actor scale 1. */
export const HERO_SHADOW_SIZE={width:42,height:17} as const;
export const heroShadow=(city:boolean):ContactShadow=>city?CITY_CONTACT_SHADOW:ISLAND_HERO_SHADOW;

/**
 * Texture of the horde's contact shadow in the city (critters, pickups, projectiles): same 48×18 frame and 46×16
 * ellipse as FX.shadow, flat Breu 38%. It replaces FX.shadow (procedural, or the imported 'sombra') in the city only.
 */
export const CITY_SHADOW_KEY='horde:fx:shadow-city';
export const CITY_SHADOW_TEXTURE={width:48,height:18,ellipse:{x:24,y:9,width:46,height:16}} as const;
/** Shadow texture key of the horde's actors: the city's own, or the shared FX.shadow (`islandKey`) elsewhere. */
export const hordeShadowKey=(city:boolean,islandKey:string)=>city?CITY_SHADOW_KEY:islandKey;

/** Destination marker (scene.ts goTo): ellipse size and stroke widths in scene px. */
export interface DestinationMark {
  /** Full ellipse width and height. */
  width:number;height:number;
  /** Breu stroke (under) and Papel stroke (over), centered on the ellipse; the Breu's alpha (ring and dot). */
  breu:number;papel:number;breuAlpha:number;
  /** Center dot: Breu disc radius, Papel disc radius. */
  dotBreu:number;dotPapel:number;
}
/**
 * The destination mark for actor scale k and `css` scene px per CSS px. Island and endless map: main's sizes, all
 * × k. City: the same ellipse and dot size (× k: they keep their CSS size with the figures), but a Papel line of
 * 2 CSS px with Breu 2 CSS px on both sides, and a Breu ring 2 CSS px around the dot: screen-constant edges.
 */
export function destinationMark(k:number,css:number,city:boolean):DestinationMark{
  if(!city)return {width:28*k,height:14*k,breu:5*k,papel:2*k,breuAlpha:.9,dotBreu:4.5*k,dotPapel:3*k};
  const papel=2*css,edge=CITY_BREU_EDGE_CSS*css;
  return {width:28*k,height:14*k,breu:papel+2*edge,papel,breuAlpha:1,dotBreu:3*k+edge,dotPapel:3*k};
}
/**
 * City Breu ring around the imported destination marker (art/frames-art.ts SceneMarks.destination, drawn at
 * (28+5)×k wide, ~2:1): one Breu stroke of CITY_BREU_EDGE_CSS whose inner edge sits on the art's outer width.
 * Only in the city (off the city the art is drawn alone, as main draws it).
 */
export function destinationArtRim(k:number,css:number):{width:number;height:number;breu:number}{
  const breu=CITY_BREU_EDGE_CSS*css,w=(28+5)*k;
  return {width:w+breu,height:w/2+breu,breu};
}
