/**
 * The enemy's name in the world (card nome-inimigo-rede-social, etapa 7): the profile's name (the roster's, as on the
 * dating-app card, hud/perfis.ts) in a ficha over the hp bar of an elite or a boss, and "Te derrubou: X" under the
 * hero's own caído ficha. "Te derrubou" and not "Derrubado pelo X": the cast has women, plurals and swarms (the roster
 * has no gender), and the ficha says it right for all of them. Pure: render/layers.ts and scene.ts draw it.
 */
import {entryLines,waveBossById} from '../../rules/index.ts';
import {artPiece} from '../art/manifest.ts';
import {MENDIGO,keepsOwnArt} from '../art/mendigo.ts';

/** Safety cap (the longest roster name today is 36): a longer one is cut with an ellipsis. */
export const ENEMY_NAME_MAX=36;
/** Gap between the ficha's bottom and the hp bar's top, in CSS px (constant on screen, like the ficha). */
export const ENEMY_NAME_GAP_CSS=3;
/** Height of a 13 px CSS ficha (map-labels: text + 2 × 3 px padding), to hang it above the bar. */
export const ENEMY_NAME_H_CSS=23;

const clip=(name:string)=>name.length>ENEMY_NAME_MAX?`${name.slice(0,ENEMY_NAME_MAX-1).trimEnd()}…`:name;

/** One name for every plain enemy while they all wear the mendigo (art/mendigo.ts; ORQ 29/10). Not "Mendigo": a hero has it. */
export const MENDIGO_NAME='Morador de Rua';

/** The name of a kind: a wave chefão's bar name, else the roster's (the nine hand-tuned kinds are in it); undefined if
 * unknown. A plain enemy drawn as the mendigo goes by MENDIGO_NAME, the name follows the body on screen. */
export function enemyName(kind:string|undefined):string|undefined{
  if(!kind)return undefined;
  const boss=waveBossById(kind)?.bar,roster=entryLines(kind)?.name;
  if(!boss&&roster&&!keepsOwnArt(kind)&&artPiece('inimigos',MENDIGO))return MENDIGO_NAME;
  const name=boss??roster;
  return name?clip(name):undefined;
}

/** The ficha over an enemy: only an elite's or a boss's (a plain critter's name would bury the horde in fichas). */
export const enemyNameTag=(kind:string|undefined,elite:boolean,boss:boolean)=>elite||boss?enemyName(kind):undefined;

/** The line under the hero's caído ficha, from the kind of the fall (hud/cause.ts); none for the dark or an unknown hitter. */
export const fallenByText=(kind:string|undefined)=>{const name=enemyName(kind);return name?`Te derrubou: ${name}`:undefined;};
