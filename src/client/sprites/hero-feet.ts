/**
 * Where a detailed hero clip (movement128 walk/attack, idle8) stands (BUG sombra/silhueta, 20/10). Pure (no Phaser).
 * The manifest's anchor is 0.875 for every clip, but the art's feet sit at 0.66–0.79 of the 96 px cell: drawn on that
 * anchor the hero floated over its ring, its contact shadow and its silhouette (8–18 cell px). The figure's bottom (the
 * lowest opaque row of the clip, over all its frames) is where the feet touch the ground. One line per class (the
 * median over its idle and walk clips): a clip's own bottom moves with a swing or a stray pixel (maromba attack128-W
 * 84 against 74), and the hero would jump when it turns.
 */
import type {FigureBox} from './sprite-catalog.ts';
import {HERO_FEET} from './hero-feet-data.ts';

/** The cell of a detailed clip (movement128.ts: 96×96). */
export const DETAILED_CELL=96;
/** The y origin (0..1 of the cell) of one clip: its figure's bottom, else its anchor. */
export function detailedFeetY(plan:{anchor:[number,number];figure?:FigureBox}):number{
  const b=plan.figure?.bottom;
  return typeof b==='number'&&Number.isFinite(b)&&b>DETAILED_CELL/2&&b<=DETAILED_CELL?b/DETAILED_CELL:plan.anchor[1];
}
/** A class's feet line (0..1 of the cell): the median of its clips' detailedFeetY; undefined without clips. */
export function heroFeetY(plans:readonly ({anchor:[number,number];figure?:FigureBox}|undefined)[]):number|undefined{
  const ys=plans.filter(p=>!!p).map(p=>detailedFeetY(p!)).sort((a,b)=>a-b);
  if(!ys.length)return undefined;
  const m=ys.length>>1;return ys.length%2?ys[m]:(ys[m-1]+ys[m])/2;
}
/**
 * The feet line (0..1 of the cell) of one clip, measured from its own pixels (scripts/hero-feet.mjs, card
 * passo-sem-deslizar): the class-wide line left a clip whose feet sit higher (the viciado walks 3–4 px over its rest
 * line) floating over its shadow, and dropping onto it when it stopped. Undefined for a sheet the table does not know
 * (a reimport): the caller falls back to heroFeetY.
 */
export function clipFeetY(url:string,table:Readonly<Record<string,number>>=HERO_FEET):number|undefined{
  const row=table[url.slice(url.lastIndexOf('/')+1).split('?')[0]];
  return typeof row==='number'&&row>DETAILED_CELL/2&&row<=DETAILED_CELL?row/DETAILED_CELL:undefined;
}
