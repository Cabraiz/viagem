/**
 * Pure rules of the map labels (DSG-cenario-coerencia): when a ficha shows, what it says and its scale.
 * No Phaser here, so the tests run in Node.
 */
import {railName} from '../../rules/index.ts';
/** The rail name is a shared rule (src/rules/names.ts): the room's bots use it too. */
export {railName};
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
/**
 * Ally ficha text. Caído: rail name and the seconds left ("Tia, 18 s"); the SOS tag on the ficha already says caído.
 * Otherwise (waiting room) the name, plus one glossary word for the state ("fora", "assistindo", "voltando"). No "A · B".
 */
export function allyLabelText(name:string,s:AllyStatus,secondsLeft?:number){
  if(s.downed&&!s.eliminated&&!s.spectator)return secondsLeft===undefined?railName(name):`${railName(name)}, ${secondsLeft} s`; // same "27 s" as hud/model.ts secondsText
  const state=s.spectator?'assistindo':s.eliminated?'fora':s.online===false?'voltando':'';
  return state?`${shortName(name,12)}, ${state}`:shortName(name);
}
/** Place fichas this close (CSS px) to a caído ficha step aside, so the eye finds who fell in 200 ms (UX onda 4, D1). */
export const SOS_CLEAR_CSS=160;
/** Whether a place ficha at `place` (screen CSS px) must hide because some caído ficha is near. */
export function placeYieldsToSos(place:{x:number;y:number},sos:readonly {x:number;y:number}[],clear=SOS_CLEAR_CSS){
  for(const p of sos){const dx=p.x-place.x,dy=p.y-place.y;if(dx*dx+dy*dy<clear*clear)return true;}
  return false;
}
/** World units per CSS px at a camera zoom (never below the floor, so a zoomed-in camera keeps 13 px too). */
export const labelScale=(zoom:number)=>1/Math.max(.05,zoom);

