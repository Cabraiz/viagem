/**
 * DOM writes that compare first (NEW-20261021-E5-q1-hud-sem-escrita-repetida). The HUD repaints every frame; a write of
 * the same value still costs: `hidden=true` on a hidden element or `setAttribute` with the same string queues a mutation
 * and invalidates the element's style (on the shell's root, all ~720 nodes under it), and a `textContent` write replaces
 * the text node even when the text is equal. Measured on a 4× phone: 5.4 s of style recalculation in 40 s of walking.
 * These write only when the value changed; reading back is cheap (no layout).
 */
export const putText=(el:Node,text:string)=>{if(el.textContent!==text)el.textContent=text;};
export const putHidden=(el:HTMLElement,hidden:boolean)=>{if(el.hidden!==hidden)el.hidden=hidden;};
export const putAttr=(el:Element,name:string,value:string)=>{if(el.getAttribute(name)!==value)el.setAttribute(name,value);};
export const putData=(el:HTMLElement,key:string,value:string)=>{if(el.dataset[key]!==value)el.dataset[key]=value;};

/** Smallest turn (degrees) worth a style write for an arrow that follows a bearing: under it the eye sees no change. */
export const TURN_STEP_DEG=2;
/** Whether `next` differs from `last` by at least TURN_STEP_DEG around the circle (undefined: never written). */
export function turnMoved(last:number|undefined,next:number):boolean{
  if(last===undefined)return true;
  const d=Math.abs(((next-last)%360+540)%360-180);
  return d>=TURN_STEP_DEG;
}
