/**
 * The DOM part of the first-time gesture tips (dicas.ts): reads from the shell what the round looks like (a pause or
 * the level-up on screen, the joystick's walk light, the manual combat, an item in the backpack), watches the shell's
 * pointers for the gestures themselves and answers applyControls (controls-phase.ts) with the tip for the etiqueta.
 * Everything is read from the root it is given: explore.ts keeps calling applyControls(shell, controls) as before.
 * The listeners are passive and in the capture phase: they only watch, never stop or claim a finger.
 */
import type {Controls} from '../../controls-phase.ts';
import type {InputKind} from '../../desktop-input.ts';
import {TIPS,TipCoach,type Tip} from './dicas.ts';

/** The gestures' own thresholds, copied (attack-button.ts and inventory.ts do not load in node; a test keeps them equal):
 * Atacar aims past its dead zone, a slot drops after its hold unless the finger moved like a drag. */
export const AIM_DEAD_ZONE_PX=12,HOLD_DROP_MS=500,DRAG_PX=24;
/** The shell is read at most this often (ms): applyControls runs every view, the selectors need not. */
export const SENSE_MS=200;
/** What hides the tip and stops its clock: the paused controls, the team's level-up pause, the offer, the result, the boss scene. */
export const BLOCKERS='.explore-paused,.rh-pausa:not([hidden]),.rh-offer:not([hidden]),.rh-ended,.rh-cena-veu:not([hidden])';
/** The joystick's "andar" light of round 1 (hud/coach.ts): the tips wait for it to go. */
export const WALK_LIGHT='.rh[data-coach-stick]';
const SLOT_FILLED='.rh-inv-slot[data-empty=false]';
export const FILLED_SLOT=`.rh-inv:not([hidden]) ${SLOT_FILLED}`;

export interface DicaShown {tip:Tip;text:string}
type Root=Pick<HTMLElement,'dataset'|'querySelector'>&Partial<Pick<HTMLElement,'addEventListener'>>;
interface State {coach:TipCoach;at:number;blocked:boolean;ready:boolean;filled:boolean}
const states=new WeakMap<object,State>();
const now=()=>globalThis.performance?.now()??Date.now();

/** Watches the gestures on the shell; each one teaches its tip at once (TipCoach.done). */
function listen(root:Root,coach:TipCoach){
  if(typeof root.addEventListener!=='function')return;
  const canvasTouches=new Set<number>();
  let aim:{id:number;x:number;y:number}|undefined;
  let hold:{id:number;x:number;y:number;timer:ReturnType<typeof setTimeout>}|undefined;
  const endHold=(id?:number)=>{if(hold&&(id===undefined||hold.id===id)){clearTimeout(hold.timer);hold=undefined;}};
  const opts={capture:true,passive:true};
  root.addEventListener('pointerdown',e=>{
    const target=e.target instanceof Element?e.target:undefined;
    if(!target)return;
    if(target.closest('#coop-attack'))aim={id:e.pointerId,x:e.clientX,y:e.clientY};
    if(e.pointerType==='touch'&&target.closest('canvas')){canvasTouches.add(e.pointerId);if(canvasTouches.size>=2)coach.done('zoom',now());}
    if(target.closest(SLOT_FILLED)){
      endHold();
      const id=e.pointerId;
      hold={id,x:e.clientX,y:e.clientY,timer:setTimeout(()=>{if(hold?.id===id){hold=undefined;coach.done('drop',now());}},HOLD_DROP_MS)};
    }
  },opts);
  root.addEventListener('pointermove',e=>{
    if(aim?.id===e.pointerId&&Math.hypot(e.clientX-aim.x,e.clientY-aim.y)>=AIM_DEAD_ZONE_PX){aim=undefined;coach.done('aim',now());}
    if(hold?.id===e.pointerId&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>=DRAG_PX)endHold();
  },opts);
  const up=(e:PointerEvent)=>{canvasTouches.delete(e.pointerId);if(aim?.id===e.pointerId)aim=undefined;endHold(e.pointerId);};
  root.addEventListener('pointerup',up,opts);
  root.addEventListener('pointercancel',up,opts);
}

/**
 * The tip for the etiqueta in this view, or undefined. Only in the round with the thumbs live; any other controls
 * (waiting room, countdown, out, result) show none, and the result closes the first match (TipCoach.endRun).
 */
export function dicaFor(root:Root,controls:Controls,at=now()):DicaShown|undefined{
  let state=states.get(root);
  if(controls.stick!=='live'){
    if(state?.coach.started&&root.querySelector('.rh-ended'))state.coach.endRun();
    return undefined;
  }
  if(!state){
    const coach=new TipCoach();
    if(coach.over)return undefined;
    state={coach,at:-Infinity,blocked:true,ready:false,filled:false};
    states.set(root,state);
    listen(root,coach);
  }
  if(state.coach.over)return undefined;
  if(at-state.at>=SENSE_MS){
    state.at=at;
    state.blocked=root.dataset.out==='true'||!!root.querySelector(BLOCKERS);
    state.ready=!root.querySelector(WALK_LIGHT);
    state.filled=!!root.querySelector(FILLED_SLOT);
  }
  const kind:InputKind=root.dataset.input==='mouse'?'mouse':'touch';
  const can=new Set<Tip>();
  if(root.dataset.combat==='manual'&&controls.skill==='live')can.add('aim');
  can.add('zoom');
  if(state.filled)can.add('drop');
  const tip=state.coach.step({now:at,kind,blocked:state.blocked,ready:state.ready,can});
  const text=tip&&TIPS[kind][tip];
  return tip&&text?{tip,text}:undefined;
}
