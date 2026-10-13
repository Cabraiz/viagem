/**
 * Thumb controls by run phase (BUG-20261006-ORQ-lobby-dead-controls). Outside the round the room drops every move and
 * cast (net/client.ts, room.ts), so the joystick and the skill button are not shown there: in the waiting room and the
 * countdown a small Papel etiqueta takes the joystick's corner and says what the thumbs will do once the round starts.
 * The round itself keeps its rules: the stick dims when out or watching (data-out), the skill greys when it cannot answer.
 * controlsFor is pure (node tests); applyControls only touches the root it is given.
 */
import type {RunPhase} from '../contract/index.ts';

export type StickMode='live'|'dimmed'|'off';
export type SkillMode='live'|'disabled'|'off';
export type ControlsHint='lobby'|'countdown';
export interface ControlsInput {phase:RunPhase;spectator?:boolean;eliminated?:boolean;downed?:boolean;offline?:boolean}
/** live: answers the finger; dimmed/disabled: shown, quiet (the round's own states); off: not shown, no input. */
export interface Controls {stick:StickMode;skill:SkillMode;hint?:ControlsHint}

/** The etiqueta's lines, one per row (≤ 2 short ones at 390 px; the landscape corner may wrap them). */
export const CONTROLS_HINTS:Readonly<Record<ControlsHint,readonly string[]>>={
  lobby:['Na partida, arrasta aqui pra andar.','A arma atira sozinha.'],
  countdown:['Prepara o dedão!'],
};

export function controlsFor(input:ControlsInput):Controls{
  const {phase}=input;
  if(phase==='lobby'||phase==='countdown')return {stick:'off',skill:'off',hint:phase};
  if(phase!=='combat')return {stick:'off',skill:'off'};
  // The round, as before: out (bled out) or watching dims the stick; any of these greys the skill.
  const out=!!input.eliminated||!!input.spectator;
  return {stick:out?'dimmed':'live',skill:out||!!input.downed||!!input.offline?'disabled':'live'};
}

/** The shared markup of the explore shell's thumb controls (explore.ts) and the waiting-room sandbox. */
export const STICK_HTML='<div class="explore-stick" role="group" tabindex="0" aria-label="Joystick de movimento. Arraste para andar ou use WASD e as setas."><span aria-hidden="true"></span></div>';
export const CONTROLS_HINT_HTML='<p class="explore-stick-hint" role="note" hidden></p>';
export const SKILL_HTML='<button id="coop-attack" data-slot="skill">Habilidade</button>';

/**
 * Writes the phase's controls on the shell: data-controls="off" hides the stick and the skill (visibility, so the layout
 * and the zones keep their boxes and the round starts with nothing moving) and the etiqueta shows the phase's lines.
 * Returns true when the thumbs just went off (the caller lets go of a finger still on the stick).
 */
export function applyControls(root:HTMLElement,controls:Controls):boolean{
  const next=controls.stick==='off'?'off':'live',wasOff=root.dataset.controls==='off';
  if(root.dataset.controls!==next)root.dataset.controls=next;
  const hint=root.querySelector<HTMLElement>('.explore-stick-hint');
  if(hint){
    const key=controls.hint??'';
    if(hint.dataset.hint!==key){
      hint.dataset.hint=key;
      hint.replaceChildren(...(controls.hint?CONTROLS_HINTS[controls.hint]:[]).map(line=>{const row=hint.ownerDocument.createElement('span');row.textContent=line;return row;}));
    }
    if(hint.hidden!==!controls.hint)hint.hidden=!controls.hint;
  }
  return next==='off'&&!wasOff;
}
