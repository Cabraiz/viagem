/**
 * Scroll sign for a window's list (forge tags, intermission offer cards): while something is cut below, the list gets
 * data-more and the CSS draws a Breu cut edge at its bottom (design review janela-caido: a cut tag with no sign of
 * scrolling looked broken). Read on scroll and on any resize of the list or its content; nothing animates.
 */
export function watchOverflow(box:HTMLElement){
  const read=()=>{
    const more=box.scrollHeight-box.clientHeight-box.scrollTop>2;
    if((box.dataset.more==='true')!==more)box.dataset.more=String(more);
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
