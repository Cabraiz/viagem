/**
 * Pure rules of the map labels (DSG-cenario-coerencia): when a ficha shows, what it says and its scale.
 * No Phaser here, so the tests run in Node.
 */
/** Text size on screen, in CSS px (A9: 13 is the minimum in a match). */
export const LABEL_CSS=13;
const MAX_NAME=16;

export type LabelKind='place'|'ally';
export interface AllyStatus {spectator?:boolean;eliminated?:boolean;downed?:boolean;online?:boolean}

/**
 * Whether a map label shows. Places: everywhere but a running wave ('combat'; the interval passes 'interval').
 * Allies: whoever is caído, always (someone has to go there); names only before the run (waiting room, countdown),
 * since in a run the team rail already names everyone and six fichas over the island cover the field.
 */
export function mapLabelVisible(kind:LabelKind,phase:string|undefined,downed=false){
  if(kind==='place')return phase!=='combat';
  return downed||phase===undefined||phase==='lobby'||phase==='countdown';
}
/** Long names get cut with an ellipsis so six fichas fit on a 390 px screen. */
export function shortName(name:string,max=MAX_NAME){
  const chars=[...name.trim()];
  return chars.length<=max?chars.join(''):chars.slice(0,max-1).join('').trimEnd()+'…';
}
/** Ally ficha text: name, plus one glossary word for the state ("caído", "fora", "assistindo", "voltando"). No "A · B". */
export function allyLabelText(name:string,s:AllyStatus){
  const state=s.spectator?'assistindo':s.eliminated?'fora':s.downed?'caído':s.online===false?'voltando':'';
  return state?`${shortName(name,12)}, ${state}`:shortName(name);
}
/** World units per CSS px at a camera zoom (never below the floor, so a zoomed-in camera keeps 13 px too). */
export const labelScale=(zoom:number)=>1/Math.max(.05,zoom);

