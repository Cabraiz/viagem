/**
 * The Uno's live window (card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 3): while the car takes hits out of view
 * (or far from the hero), a small second camera shows it being beaten, in a frame with its life bar, on the right on
 * the computer (under the minimap) and at the top right on the phone; it goes PIP_HIDE_MS after the last hit. A tap
 * on it swings the main camera to the car for PEEK_MS. Pure rules (tested); pip.ts draws.
 */

/** The window goes this long after the car's last hit (card: ~3 s). */
export const PIP_HIDE_MS=3000;
/** On screen but this far from the hero (world units) still counts as far: the player cannot see who is hitting it. */
export const PIP_FAR_U=16;
/** The window's camera zoom against the main camera's: a little wider, so the car and the critters around it fit. */
export const PIP_ZOOM_K=.5;
/** The window looks this far (world px) above the car's ground point: the body, its bar and the numbers are centred. */
export const PIP_LIFT_PX=46;
/** A tap on the window: the main camera looks at the car this long, then comes back to the hero. */
export const PEEK_MS=1600;
/** Half side (world px) of the square around the car whose city chunks stay built while the objective runs. */
export const PIP_KEEP_PX=420;
/** How often (ms) the window re-reads its frame's place on the screen while shown (a resize, the HUD moving). */
export const PIP_RECT_MS=500;

export interface PipInput {
  /** The objective runs (not ended, the car exists). */
  live:boolean;
  /** When the car last took a hit and now (the same clock), undefined before any hit. */
  lastHitAt?:number;now:number;
  /** The car's point is in the main camera's view, and how far it is from the hero (world units). */
  carOnScreen:boolean;distance:number;
  /** The camera is already peeking at the car (a tap): the window would only show the same. */
  peeking?:boolean;
}
/** Whether the window shows now. */
export function pipWanted(input:PipInput):boolean{
  if(!input.live||input.lastHitAt===undefined||input.peeking)return false;
  const since=input.now-input.lastHitAt;
  return since>=0&&since<PIP_HIDE_MS&&(!input.carOnScreen||input.distance>PIP_FAR_U);
}
/** The window camera's zoom for the main camera's (never under 0.05). */
export const pipZoom=(mainZoom:number)=>Math.max(.05,(Number.isFinite(mainZoom)?mainZoom:1)*PIP_ZOOM_K);

/**
 * The window camera's viewport in game px from its frame's inner box (CSS px, viewport) and the canvas' box (CSS px)
 * and size (game px): the game canvas may be scaled against the CSS. Rounded, at least 1 px each side.
 */
export function pipViewport(inner:{left:number;top:number;width:number;height:number},canvas:{left:number;top:number;width:number;height:number},
  game:{width:number;height:number}):{x:number;y:number;width:number;height:number}{
  const sx=canvas.width>0?game.width/canvas.width:1,sy=canvas.height>0?game.height/canvas.height:1;
  return {x:Math.round((inner.left-canvas.left)*sx),y:Math.round((inner.top-canvas.top)*sy),
    width:Math.max(1,Math.round(inner.width*sx)),height:Math.max(1,Math.round(inner.height*sy))};
}

/** Whether the main camera is peeking at the car at `now` (a tap at `since`). */
export const peeking=(since:number|undefined,now:number)=>since!==undefined&&now-since>=0&&now-since<PEEK_MS;
