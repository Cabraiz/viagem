/**
 * Estudo de escala mapa × personagens (card NEW-20261022-ORQ-estudo-escala-mapa): the user finds the city "2× too big, or
 * us too small". `?escala=E0|E1|E2|E2b|E3|E4` draws the same scene with one candidate fix, for a numbered sheet
 * (scripts/folha-escala.mjs). A study only: the game never reads it but through the ground shader's detail (E1), and
 * nothing in the sim, the rules or the wire changes.
 *
 * - `chao`: frequency of the ground's small detail (albedo photo, grain, sparkles, the drawn stone bond): 2 = every
 *   stone and snow grain half as big, repeated twice as often. Read by render/city/relevo/shader.ts.
 * - `gente`: drawn size of every figure (heroes, enemies, their shadows and weapons) over today's; world unchanged.
 * - `mundo`: the world's size against the figures (streets, lots, buildings, props). Drawn as figures × 1/mundo under a
 *   camera zoom × mundo: on screen that is exactly a world `mundo` times as big around figures of today's size (the
 *   figures keep their CSS size, the ground detail shrinks with the world). Only the drawing: what it costs the game
 *   to really do it is listed in the study's report.
 * Pure: no Phaser, no DOM.
 */
export interface EscalaEstudo {
  id:EscalaId;
  chao:number;
  gente:number;
  mundo:number;
  descricao:string;
}
export type EscalaId='E0'|'E1'|'E2'|'E2b'|'E3'|'E4';

export const ESCALAS:Readonly<Record<EscalaId,Readonly<EscalaEstudo>>>=Object.freeze({
  E0:{id:'E0',chao:1,gente:1,mundo:1,descricao:'hoje'},
  E1:{id:'E1',chao:2,gente:1,mundo:1,descricao:'chão com detalhe na metade (pedras e grão 2× menores)'},
  E2:{id:'E2',chao:1,gente:1.5,mundo:1,descricao:'personagens 1,5×, mundo igual'},
  E2b:{id:'E2b',chao:1,gente:2,mundo:1,descricao:'personagens 2×, mundo igual'},
  E3:{id:'E3',chao:1,gente:1,mundo:.5,descricao:'mundo 0,5× (ruas, lotes, prédios), personagens iguais'},
  E4:{id:'E4',chao:2,gente:1.3,mundo:1,descricao:'chão 2× mais fino + personagens 1,3×'},
} satisfies Record<EscalaId,EscalaEstudo>);

const isId=(v:string|null):v is EscalaId=>v!==null&&Object.prototype.hasOwnProperty.call(ESCALAS,v);

/** The study variant of a page address (`?escala=…`, case-insensitive); E0 (today) without it or with an unknown one. */
export function escalaEstudo(search=typeof location!=='undefined'?location.search:''):Readonly<EscalaEstudo>{
  let raw:string|null=null;
  try{raw=new URLSearchParams(search).get('escala');}catch{/* bad address: today */}
  const id=raw?Object.keys(ESCALAS).find(k=>k.toLowerCase()===raw!.toLowerCase())??null:null;
  return isId(id)?ESCALAS[id]:ESCALAS.E0;
}

/** Figures' draw multiplier in the city sandbox: `gente` over `mundo` (a smaller world = bigger figures, zoomed out). */
export const figuras=(e:EscalaEstudo)=>e.gente/e.mundo;
