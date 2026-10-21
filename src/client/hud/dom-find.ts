/**
 * DOM lookups that do not walk the page every frame (NEW-20261021-ORQ-q6-micro-render). The exploration's position
 * callback runs once per frame and used to query ~10 selectors on the shell plus three `:not([hidden])` selectors on
 * the whole document (~2,000 elements): 2.2 % of the main thread on a 4× phone ("explore position" in
 * design/estudo-desempenho.md §3.2). The template's elements do not move out of the page, and the HUD's windows are
 * found through the browser's live class collections, which it keeps up to date for free.
 */

/** What the lookups need from a root (the shell, or a fake one in the tests). */
export interface QueryRoot {querySelector(selector:string):Element|null}

/**
 * `root.querySelector(selector)` once, then the same element while it is still in the page (a re-rendered part that
 * drops it is found again on the next call). Only for selectors that name one element for good: ids and the shell's
 * own template classes, never a state (`:not([hidden])`, `.is-open`).
 */
export function stickyQuery(root:QueryRoot){
  const seen=new Map<string,Element>();
  return <T extends Element=HTMLElement>(selector:string):T=>{
    const hit=seen.get(selector);
    if(hit?.isConnected)return hit as T;
    const found=root.querySelector(selector);
    if(found)seen.set(selector,found);else seen.delete(selector);
    return found as T;
  };
}

/** A live list of elements, as `document.getElementsByClassName` returns. */
export interface LiveList<T> {readonly length:number;[index:number]:T}
/** What the window checks read from an element (an HTMLElement, or a fake one in the tests). */
export interface Shown<T> {hasAttribute(name:string):boolean;compareDocumentPosition(other:T):number}
/** Node.DOCUMENT_POSITION_PRECEDING (the constant, so the module loads outside a browser). */
const PRECEDING=2;

/**
 * The first element in page order without the `hidden` attribute among these live lists: the same answer as
 * `querySelector('.a:not([hidden]),.b:not([hidden])')` with no walk over the page.
 */
export function firstShown<T extends Shown<T>>(lists:readonly LiveList<T>[]):T|null{
  let best:T|null=null;
  for(const list of lists)for(let i=0;i<list.length;i++){
    const el=list[i];if(el.hasAttribute('hidden'))continue;
    if(!best||best.compareDocumentPosition(el)&PRECEDING)best=el;
    break;
  }
  return best;
}

/** Whether a shown outer element holds an element of the inner class: `!!querySelector('.outer:not([hidden]) .inner')`. */
export function shownHolds<T extends Shown<T>&{getElementsByClassName(name:string):{readonly length:number}}>(outer:LiveList<T>,inner:string):boolean{
  for(let i=0;i<outer.length;i++){const el=outer[i];if(!el.hasAttribute('hidden')&&el.getElementsByClassName(inner).length)return true;}
  return false;
}
