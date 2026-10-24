/**
 * The phone's keyboard over the menu's name step (BUG-20261024-ORQ-teclado-cobre-nome-bora, the user, 24/10: "o 'bora' e o
 * input text deveriam ficar cima do teclado"). Chrome on Android keeps the layout when the keyboard comes up and only
 * shrinks the visual viewport, so the name field and BORA!, at the bottom of the profile, end up under the keys.
 * While the field has the focus and the keyboard is up, the choice column becomes the box the keyboard leaves
 * (data-teclado + --tec-top / --tec-h, estadio.css / insta.css): its bottom (the field, then BORA!) sits right above the
 * keys and the top of the profile slides up out of it. A browser that resizes the layout instead (resizes-content) is
 * caught by comparing with the height the page had before the field took the focus.
 * Pure rule + a small wiring; main.ts is its only importer (no shared chunk, see vite codeSplitting).
 */

/** The keyboard is up: what is left is short, or much shorter than the page without the keyboard (URL bar alone: no). */
export const tecladoAberto=(visivel:number,cheia:number):boolean=>visivel<=260||visivel<cheia*.75;

export interface TecladoMedida {
  /** The name field has the focus. */
  focado:boolean;
  /** visualViewport.height and offsetTop (the part of the layout viewport left by the keyboard). */
  vvAltura:number;vvTopo:number;
  /** The page's height without the keyboard (innerHeight before the focus). */
  cheia:number;
  /** The choice column's offset parent, its top in the layout viewport (getBoundingClientRect().top). */
  hostTopo:number;
}

/** The box (in the host's px) the column must take, or undefined: the keyboard is down or the field is not focused. */
export function caixaTeclado(m:TecladoMedida):{top:number;height:number}|undefined{
  if(!m.focado||!(m.vvAltura>0)||!tecladoAberto(m.vvAltura,m.cheia))return undefined;
  return {top:Math.round(m.vvTopo-m.hostTopo),height:Math.floor(m.vvAltura)};
}

/**
 * Keeps `coluna` (the choice section) above the keyboard while `campo` has the focus. Taps on the column's buttons do
 * not take the focus away first: the field losing it would drop the box mid-tap and the click would land elsewhere
 * (BORA! lost). Returns the cleanup.
 */
export function manterAcimaDoTeclado(coluna:HTMLElement,campo:HTMLInputElement,win:Window=window):()=>void{
  const vv=win.visualViewport;
  let cheia=win.innerHeight,largura=win.innerWidth;
  const atualizar=()=>{
    const focado=win.document.activeElement===campo;
    // A new width is a new page (the phone turned); without the field the layout height is the keyboard-free one.
    if(win.innerWidth!==largura||!focado){largura=win.innerWidth;cheia=win.innerHeight;}
    const host=(coluna.offsetParent as HTMLElement|null)??win.document.documentElement;
    const caixa=caixaTeclado({focado,vvAltura:vv?.height??win.innerHeight,vvTopo:vv?.offsetTop??0,cheia,
      hostTopo:host.getBoundingClientRect().top});
    if(caixa){
      coluna.dataset.teclado='';
      coluna.style.setProperty('--tec-top',`${caixa.top}px`);coluna.style.setProperty('--tec-h',`${caixa.height}px`);
      coluna.style.setProperty('--tec-cheia',`${cheia}px`);
    }else if(coluna.dataset.teclado!==undefined){
      delete coluna.dataset.teclado;
      for(const p of ['--tec-top','--tec-h','--tec-cheia'])coluna.style.removeProperty(p);
    }
  };
  const segurarFoco=(e:MouseEvent)=>{
    if(coluna.dataset.teclado!==undefined&&(e.target as Element|null)?.closest?.('button'))e.preventDefault();
  };
  const depois=()=>setTimeout(atualizar,0);
  vv?.addEventListener('resize',atualizar);vv?.addEventListener('scroll',atualizar);
  win.addEventListener('resize',atualizar);
  campo.addEventListener('focus',atualizar);campo.addEventListener('blur',depois);
  coluna.addEventListener('mousedown',segurarFoco);
  return ()=>{
    vv?.removeEventListener('resize',atualizar);vv?.removeEventListener('scroll',atualizar);
    win.removeEventListener('resize',atualizar);
    campo.removeEventListener('focus',atualizar);campo.removeEventListener('blur',depois);
    coluna.removeEventListener('mousedown',segurarFoco);
  };
}
