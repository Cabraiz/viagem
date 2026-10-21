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

/** What liveSelector reads from a document (a Document, or a fake one in the tests). */
export interface LiveRoot {
  getElementsByClassName(name:string):LiveList<Element>;getElementById(id:string):Element|null;querySelectorAll(selector:string):Iterable<Element>;
}
type Part=(out:Set<Element>)=>void;
const CLASS=/^\.([\w-]+)(?::not\(\[hidden\]\))?$/,ID=/^#([\w-]+)$/,CHILDREN=/^\.([\w-]+)>:not\(\[hidden\]\)$/,TAG=/^\.([\w-]+) ([a-z]+)$/;
/**
 * The elements of a selector list made of `.class`, `.class:not([hidden])`, `#id`, `.class>:not([hidden])` and
 * `.class tag` parts, from the browser's live lists instead of a querySelectorAll over the page (Q6: RescueBoard's
 * COVERING/WINDOWS boxes, 0.8 % of a 4× phone's main thread). Hidden ones are kept in: the caller skips everything
 * under a `[hidden]` (closest), which covers the `:not([hidden])`. Unique, in no particular order. Any other part
 * makes the whole list fall back to querySelectorAll.
 */
export function liveSelector(root:LiveRoot,selector:string):()=>Iterable<Element>{
  const parts:Part[]=[];
  for(const raw of selector.split(',')){
    const s=raw.trim();let m:RegExpExecArray|null;
    if((m=CLASS.exec(s))){const list=root.getElementsByClassName(m[1]);parts.push(out=>{for(let i=0;i<list.length;i++)out.add(list[i]);});}
    else if((m=ID.exec(s))){const id=m[1];parts.push(out=>{const el=root.getElementById(id);if(el)out.add(el);});}
    else if((m=CHILDREN.exec(s))){const list=root.getElementsByClassName(m[1]);parts.push(out=>{for(let i=0;i<list.length;i++)for(const el of list[i].children)out.add(el);});}
    else if((m=TAG.exec(s))){const list=root.getElementsByClassName(m[1]),tag=m[2];parts.push(out=>{for(let i=0;i<list.length;i++)for(const el of list[i].getElementsByTagName(tag))out.add(el);});}
    else return ()=>root.querySelectorAll(selector);
  }
  const out=new Set<Element>();
  return ()=>{out.clear();for(const part of parts)part(out);return out;};
}
