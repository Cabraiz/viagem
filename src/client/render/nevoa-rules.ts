/**
 * Card jogo-mais-escuro, the user's pick (29/10): the board's fog 3 (ash, cold sepia) without its strong border, in the
 * lighter colour and density of fog 4, with 4's wind bands running across but faint, never over the hero. Pure: the
 * levels, `?nevoa=`, the sepia grade's TS mirror and its GLSL (render/exposure-pipeline.ts draws it, render/nevoa.ts
 * the layers).
 */
import {lightEnabled,type LightWorld} from './light.ts';

/**
 * One fog level. `haze`/`bands` = alpha of the two scrolling layers, `ash` = falling flakes on screen, `sepia` = how far
 * the world's colours go to the cold sepia grey (luma kept). `clear` = the hole around the hero, as a share of the
 * screen's short side: no fog inside clear[0], full at clear[1]; `floor` = what is left of it at the hero.
 */
export interface NevoaLevel {readonly haze:number;readonly bands:number;readonly ash:number;readonly sepia:number;readonly clear:readonly [number,number];readonly floor:number}
const level=(l:NevoaLevel)=>Object.freeze({...l,clear:Object.freeze([...l.clear])}) as NevoaLevel;
export const NEVOA_LEVELS:readonly NevoaLevel[]=Object.freeze([
  level({haze:0,bands:0,ash:0,sepia:0,clear:[0,0],floor:1}),
  level({haze:.42,bands:.32,ash:30,sepia:.18,clear:[.09,.32],floor:.35}),
  level({haze:.58,bands:.44,ash:48,sepia:.28,clear:[.10,.34],floor:.3}),
  level({haze:.74,bands:.5,ash:70,sepia:.38,clear:[.11,.36],floor:.25}),
]);
/** The level each world gets with no `?nevoa=`: the city is the board's scene; the tropical maps stay clear. */
export const NEVOA_DEFAULT:Readonly<Record<LightWorld,number>>=Object.freeze({cidade:2,infinito:0,ilha:0});
/** Over the world (ground, buildings, the horde), under the blackout (94000), the hero (96500) and the telegraphs (99000). */
export const NEVOA_DEPTH=93900;
/** Light sources go over the fog (card muitas-luzes): their halos are not fogged. */
export const LUZES_DEPTH=NEVOA_DEPTH+50;

/** `?nevoa=0..3`; anything else (or none) leaves the world's own. */
export function nevoaParam(search:string=typeof location==='undefined'?'':location.search):number|undefined{
  const raw=new URLSearchParams(search).get('nevoa');if(raw===null||raw==='')return undefined;
  const v=Math.round(Number(raw));return Number.isFinite(v)?Math.max(0,Math.min(NEVOA_LEVELS.length-1,v)):undefined;
}
/** The world's fog level: `?luz=0` turns it off with the rest of the light. */
export function nevoaFor(world:LightWorld,search:string=typeof location==='undefined'?'':location.search):number{
  if(!lightEnabled(search))return 0;
  return nevoaParam(search)??NEVOA_DEFAULT[world];
}

/** The cold sepia grey: luma times this (its own luma is 1, so the grade keeps every colour's luma and the Breu 3:1). */
export const SEPIA_TINT=Object.freeze([1.04,1.0,0.93] as const);
const SEPIA_LUMA=SEPIA_TINT[0]*.299+SEPIA_TINT[1]*.587+SEPIA_TINT[2]*.114;
/** The sepia grade of one colour (r, g, b in 0..1) at strength s: the TS mirror of SEPIA_GLSL. */
export function sepiaColor(rgb:readonly [number,number,number],s:number):[number,number,number]{
  const L=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
  return [0,1,2].map(i=>Math.min(1,rgb[i]+(L*SEPIA_TINT[i]/SEPIA_LUMA-rgb[i])*s)) as [number,number,number];
}
const f=(x:number)=>(x/SEPIA_LUMA).toFixed(4);
/** The same on the pipeline's premultiplied `color` (luma of a premultiplied colour is premultiplied), `uSepia` = s. */
export const SEPIA_GLSL=`color.rgb=mix(color.rgb,dot(color.rgb,vec3(.299,.587,.114))*vec3(${f(SEPIA_TINT[0])},${f(SEPIA_TINT[1])},${f(SEPIA_TINT[2])}),uSepia);`;

/**
 * The fog's hole around the hero in the fog pipeline: `uFuro` = the hero in framebuffer pixels (gl_FragCoord), `uFuroRaio`
 * = clear[] in pixels, `uFuroFundo` = floor. Premultiplied, so scaling the whole colour fades the fog.
 */
export const FURO_GLSL='color*=mix(uFuroFundo,1.0,smoothstep(uFuroRaio.x,uFuroRaio.y,distance(gl_FragCoord.xy,uFuro)));';
/** The TS mirror of FURO_GLSL: what share of the fog is drawn at `d` px from the hero. */
export function furo(d:number,r0:number,r1:number,floor:number):number{
  const t=r1>r0?Math.max(0,Math.min(1,(d-r0)/(r1-r0))):1,s=t*t*(3-2*t);
  return floor+(1-floor)*s;
}

/**
 * Wind: the bands run toward the top right (the board's 4), the haze drifts slower, the ash falls with a slant.
 * px per second on screen; `?nevoa=` levels share them. Reduced motion: a fifth.
 */
export const WIND=Object.freeze({bands:Object.freeze([46,-20] as const),haze:Object.freeze([9,-3] as const),ashFall:Object.freeze([14,38] as const)});
export function windScale(reduced:boolean){return reduced?.2:1;}
