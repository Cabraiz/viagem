/**
 * Scroll sign for a window's list (forge tags, intermission offer cards): while something is cut below, the list gets
 * data-more (the forge's CSS draws a Breu cut edge at its bottom: design review janela-caido, a cut tag with no sign of
 * scrolling looked broken). Read on scroll and on any resize of the list or its content; nothing animates.
 * `onRead` (the offer window, BUG-20261012-ORQ-oferta-cortada-retrato) also gets the items' and the list's extents on
 * screen, for its "Mais N" cue (cueLayout).
 */
export function watchOverflow(box:HTMLElement,onRead?:(state:{more:boolean;items:Span[];view:Span})=>void){
  const read=()=>{
    const more=box.scrollHeight-box.clientHeight-box.scrollTop>2;
    if((box.dataset.more==='true')!==more)box.dataset.more=String(more);
    if(onRead)onRead({more,items:childSpans(box),view:span(box)});
  };
  box.addEventListener('scroll',read,{passive:true});
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(read):undefined;
  observer?.observe(box);
  const children=typeof MutationObserver!=='undefined'?new MutationObserver(()=>{read();for(const c of box.children)observer?.observe(c);}):undefined;
  children?.observe(box,{childList:true});
  for(const c of box.children)observer?.observe(c);
  read();
  return {read,destroy(){box.removeEventListener('scroll',read);observer?.disconnect();children?.disconnect();}};
}

/** A vertical extent on screen (getBoundingClientRect's top and bottom). */
export interface Span {top:number;bottom:number}
/**
 * Rounding slack, in px, before a tag counts as cut. A tilted tag's box pokes ~2.5 px past its edge (±1° on a 290 px
 * tag), but the list's 4 px bottom padding holds that; past the padding the corner is really clipped, so it counts.
 */
export const CUT_TOLERANCE=1;
const span=(e:Element):Span=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};};
const childSpans=(box:Element)=>[...box.children].map(span);

/**
 * How many items of a scrolling list are not fully visible below its visible part: the "N" of "Mais N". Items hidden
 * by display:none (zero height) do not count; an item scrolled away above is already read, so it does not either.
 */
export function hiddenCards(items:readonly Span[],view:Span,tolerance=CUT_TOLERANCE){
  if(view.bottom-view.top<=0)return 0;
  return items.filter(item=>item.bottom-item.top>0&&item.bottom>view.bottom+tolerance).length;
}

/**
 * Pixels to scroll so the next row of items comes up by one: the first row whose top is below the view's top (past
 * the snap margin) goes to the top, as the list's scroll-snap (start, scroll-margin-top) would put it, so a row that
 * fits the view ends up whole. The tags of a row share their top (a 2x2), so one step is one row. Without such a
 * row, most of a view.
 */
export function nextCardScroll(items:readonly Span[],view:Span,margin=6,tolerance=CUT_TOLERANCE){
  const tops=items.filter(item=>item.bottom-item.top>0).map(item=>item.top-view.top-margin).filter(top=>top>tolerance);
  return tops.length?Math.min(...tops):Math.max(0,Math.round((view.bottom-view.top)*.8));
}

/** Tallest the fade over a list's bottom gets. */
export const FADE_MAX=36;
const fullyIn=(item:Span,view:Span,tolerance:number)=>item.bottom-item.top>0&&item.bottom>view.top&&item.bottom<=view.bottom+tolerance;
/**
 * Height of the fade over the list's bottom: the part under the last tag that is fully in view (the cut tag's visible
 * strip and the list's padding), at most FADE_MAX, rounded down, so the fade never lies on a whole tag.
 */
export function cutRoom(items:readonly Span[],view:Span,tolerance=CUT_TOLERANCE){
  return Math.min(FADE_MAX,Math.floor(strip(items,view,tolerance)));
}
/** The list's part under its last whole tag (uncapped). */
function strip(items:readonly Span[],view:Span,tolerance:number){
  if(view.bottom-view.top<=0)return 0;
  const whole=items.filter(item=>fullyIn(item,view,tolerance)).map(item=>item.bottom);
  return Math.max(0,view.bottom-(whole.length?Math.max(...whole):view.top));
}

/** The "Mais N" tap target: 48 px tall (design CHECKLIST A.11), whatever the pill (28 px) draws. */
export const CUE_TARGET=48;
/** Room kept between the cue's target and the buttons under the list (the portrait foot), CSS px. */
export const FOOT_GAP=8;
/** A tag cut by less than this still reads as whole: the cue does not lie on it when its own row costs no whole tag. */
export const MIN_CUT=8;
/**
 * Where "Mais N" goes (design review: the cue must cost as little of the list as it can and never lie on a whole tag):
 * - none: nothing is cut;
 * - over: inside the cut strip (the part under the last whole tag), when that strip plus the room under the list
 *   (`below`: + the window's padding and edge in landscape; - FOOT_GAP over the portrait foot, whose buttons keep
 *   8 px from the target) holds the 48 px target: it costs no height at all;
 * - row: else, its own row under the list (the target, plus FOOT_GAP over the foot: `row` px, which the list gives
 *   up); also when the tag it would lie on is cut by less than MIN_CUT (it reads as whole) and the row keeps as many
 *   whole tags.
 * `view0` is the list as tall as it is without the row, so the choice does not flip when the row comes or goes.
 * `target` is the tap target's extent on screen; `fade` the fade's height over the list's (final) bottom.
 */
export interface CueLayout {mode:'none'|'over'|'row';hidden:number;fade:number;row:number;target?:Span}
export function cueLayout(items:readonly Span[],view0:Span,below=0,size=CUE_TARGET,tolerance=CUT_TOLERANCE):CueLayout{
  const row=size+Math.max(0,-below);
  const hidden=hiddenCards(items,view0,tolerance);
  if(!hidden)return {mode:'none',hidden:0,fade:0,row};
  const room=strip(items,view0,tolerance);
  const rowView={top:view0.top,bottom:view0.bottom-row};
  const firstCut=Math.min(...items.filter(item=>item.bottom-item.top>0&&item.bottom>view0.bottom+tolerance).map(item=>item.bottom));
  const barely=firstCut-view0.bottom<MIN_CUT&&whole(items,rowView,tolerance)>=whole(items,view0,tolerance);
  if(room+below>=size&&!barely)return {mode:'over',hidden,fade:Math.min(FADE_MAX,Math.floor(room)),row,target:{top:view0.bottom+below-size,bottom:view0.bottom+below}};
  return {mode:'row',hidden:Math.max(1,hiddenCards(items,rowView,tolerance)),fade:cutRoom(items,rowView,tolerance),row,target:{top:rowView.bottom,bottom:rowView.bottom+size}};
}
const whole=(items:readonly Span[],view:Span,tolerance:number)=>items.filter(item=>fullyIn(item,view,tolerance)&&item.top>=view.top-tolerance).length;

export interface Box {top:number;bottom:number;left:number;right:number}
/**
 * The audit of the cue (design review: "Mais N" lay on the end of a visible effect line): true when `cue` (the "Mais N"
 * row or the fade) covers no part of a tag that is fully in view, inside the list's visible part.
 */
export function cueClear(cue:Box,items:readonly Box[],view:Span,tolerance=CUT_TOLERANCE){
  return items.filter(item=>fullyIn(item,view,tolerance)).every(item=>{
    const top=Math.max(item.top,view.top),bottom=Math.min(item.bottom,view.bottom);
    return !(cue.right>item.left&&cue.left<item.right&&cue.bottom>top&&cue.top<bottom);
  });
}

/** The cue a list shows while items are cut below: a soft fade plus "Mais N", which scrolls by one tag when tapped. */
export function moreCue(hidden:number){
  const n=Math.max(0,Math.floor(hidden));
  return {show:n>0,label:`Mais ${n}`,aria:`Mais ${n} ${n===1?'opção':'opções'} abaixo. Toca pra rolar.`};
}

/** Under prefers-reduced-motion the "Mais N" step jumps instead of gliding. */
export function scrollBehavior(reduced:boolean):ScrollBehavior{return reduced?'auto':'smooth';}
export const prefersReducedMotion=()=>{
  try{return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;}catch{return false;}
};
