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

/**
 * Text in place (BUG-20261025-ORQ-celular-travando): an element holding one text node gets the node's data changed, no
 * node is replaced. A node inserted anywhere makes Chrome check the page's :has() rules up to <html> (html:has(.estadio),
 * .rh:has(…)…) and restyle the whole document, the menu under the match included: the HUD's clocks did it every second.
 */
export function putTextData(el:Node,text:string){
  const only=el.firstChild;
  if(only&&only===el.lastChild&&only.nodeType===3){if(only.nodeValue!==text)only.nodeValue=text;return;}
  if(el.textContent!==text)el.textContent=text;
}
const iconOf=new WeakMap<HTMLElement,string>();
/**
 * `${prefix}${iconMarkup}<b>text</b>` in `host`: the markup is rebuilt only when the prefix or the icon changes; a new
 * number (a clock's second) changes the <b>'s text in place (putTextData).
 */
export function putIconNumber(host:HTMLElement,iconMarkup:string,text:string,prefix=''){
  const markup=prefix+iconMarkup;
  let b=host.lastElementChild;
  if(iconOf.get(host)!==markup||!b||b.tagName!=='B'){host.innerHTML=`${markup}<b>${text}</b>`;iconOf.set(host,markup);return;}
  putTextData(b,text);
}

/** Smallest turn (degrees) worth a style write for an arrow that follows a bearing: under it the eye sees no change. */
export const TURN_STEP_DEG=2;
/** Whether `next` differs from `last` by at least TURN_STEP_DEG around the circle (undefined: never written). */
export function turnMoved(last:number|undefined,next:number):boolean{
  if(last===undefined)return true;
  const d=Math.abs(((next-last)%360+540)%360-180);
  return d>=TURN_STEP_DEG;
}
