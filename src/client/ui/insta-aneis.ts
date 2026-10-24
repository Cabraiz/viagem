/**
 * The heroes' rings on the profile as Instagram's stories row (BUG-20261024-ORQ-aneis-herois-carrossel-infinito, the user
 * 24/10: "drag infinito e com looping e sempre mostrar metade do rosto para dizer que existe mais, igual o Instagram").
 * One line a finger drags with inertia, endless both ways, that always comes to rest on 3 whole rings and half of the
 * 4th at the right edge. The row holds the rings twice (ui/insta.ts aneisHtml: the copy is aria-hidden and out of the tab
 * order) and the track moves by its position modulo one set. A tap still picks (main.ts); a drag never does.
 * With no more rings than fit (ANEIS_VISIVEIS) the row stands still, centred. The position is in rings, not px, so a
 * resize keeps it. The row takes every touch that starts on it (touch-action: none: the page never scrolls, and a
 * browser fling after a drag would swallow the next tap). Pure parts for the node tests: voltaDe, pousoDe, emLoop.
 */

/** Rings in view at rest: 3 and half of the 4th (insta.css .insta-stories --passo: the 730 px over this). */
export const ANEIS_VISIVEIS=3.5;
/** A press that moves more than this (px, sideways) is a drag, not a tap. */
export const ARRASTO_PX=8;
/** How far a throw carries: the release speed (rings/ms) times this, at most LANCE_MAX rings (a hard flick never spins
 *  a whole set round to the same faces). */
export const INERCIA_MS=260,LANCE_MAX=3;
const POUSO_MIN_MS=180,POUSO_MAX_MS=700,AMOSTRA_MS=100,CLIQUE_MS=800;

/** Whether `n` rings loop (more than fit) or stand still. */
export const emLoop=(n:number)=>n>ANEIS_VISIVEIS;
/** Position `p` (rings) folded into one set of `n`. */
export const voltaDe=(p:number,n:number)=>((p%n)+n)%n;
/** Where a release at `p` with speed `v` (rings/ms, + = the rings move left) comes to rest: a whole ring, so the 4th
 *  ring is always cut in half by the edge. */
export function pousoDe(p:number,v:number):number{
  const lance=Math.max(-LANCE_MAX,Math.min(LANCE_MAX,v*INERCIA_MS));
  return Math.round(p+lance)||0;
}

export interface Aneis{
  /** The rings were (re)drawn: `n` of them, `escolhido` (index in the set) shown first the first time. */
  montou(n:number,escolhido:number):void;
  /** Brings ring `k` fully into view (a pick from elsewhere, or the half one tapped); still if it already is. */
  mostrar(k:number):void;
}

export function montarAneis(nav:HTMLElement):Aneis{
  const reduzido=matchMedia('(prefers-reduced-motion: reduce)');
  let n=0,p=0,primeira=true,quadro=0;
  const trilho=()=>nav.firstElementChild as HTMLElement|null;
  const passo=()=>(trilho()?.firstElementChild as HTMLElement|null)?.offsetWidth||1;
  const aplicar=()=>{
    const t=trilho();
    if(!t) return;
    t.style.transform=emLoop(n)?`translate3d(${(-voltaDe(p,n)*passo()).toFixed(2)}px,0,0)`:'';
  };
  // A glide to `alvo`: ease-out, as long as it takes to leave at the release speed `v` (rings/ms).
  let anim:{de:number,alvo:number,t0:number,ms:number}|undefined;
  const parar=()=>{cancelAnimationFrame(quadro);anim=undefined;};
  const deslizar=(alvo:number,v=0)=>{
    parar();
    const d=alvo-p;
    if(Math.abs(d)<1e-3||reduzido.matches){p=alvo;aplicar();return;}
    const ms=Math.max(POUSO_MIN_MS,Math.min(POUSO_MAX_MS,Math.abs(v)>1e-4?3*Math.abs(d/v):180+140*Math.abs(d)));
    anim={de:p,alvo,t0:performance.now(),ms};
    const passoAnim=(agora:number)=>{
      if(!anim) return;
      const k=Math.min(1,(agora-anim.t0)/anim.ms),e=1-(1-k)**3;
      p=anim.de+(anim.alvo-anim.de)*e;aplicar();
      if(k<1) quadro=requestAnimationFrame(passoAnim); else anim=undefined;
    };
    quadro=requestAnimationFrame(passoAnim);
  };

  // Every press on the row is read here: a drag moves it, a tap picks, a press that only stopped a glide does neither.
  // The pick is the ring's own click (main.ts listens), sent on the tap's pointerup; the browser's click of a press is
  // swallowed: Chrome drops the first tap after a fast flick (its tap suppression), and it would pick after a drag.
  // Keyboard and screen-reader clicks (no press on the row just before) pass untouched.
  let toque:{id:number,x:number,y:number,p0:number,arrasta:boolean,parou:boolean,anel:HTMLElement|null,amostras:{t:number,p:number}[]}|undefined;
  let pressEm=-Infinity;
  nav.addEventListener('pointerdown',e=>{
    if(!emLoop(n)||e.button>0) return;
    pressEm=performance.now();
    const parou=!!anim&&Math.abs(anim.alvo-p)>.05;
    parar();
    toque={id:e.pointerId,x:e.clientX,y:e.clientY,p0:p,arrasta:false,parou,anel:(e.target as Element).closest<HTMLElement>('[data-hero]'),amostras:[{t:e.timeStamp,p}]};
  });
  nav.addEventListener('pointermove',e=>{
    if(!toque||e.pointerId!==toque.id) return;
    const dx=e.clientX-toque.x;
    if(!toque.arrasta){
      if(Math.abs(e.clientY-toque.y)>ARRASTO_PX&&Math.abs(e.clientY-toque.y)>Math.abs(dx)){toque=undefined;deslizar(Math.round(p));return;}
      if(Math.abs(dx)<=ARRASTO_PX) return;
      toque.arrasta=true;nav.setPointerCapture(e.pointerId);nav.classList.add('arrastando');
    }
    p=toque.p0-dx/passo();aplicar();
    toque.amostras.push({t:e.timeStamp,p});
    while(toque.amostras.length>2&&e.timeStamp-toque.amostras[0]!.t>AMOSTRA_MS) toque.amostras.shift();
  });
  const soltar=(e:PointerEvent)=>{
    if(!toque||e.pointerId!==toque.id) return;
    const {arrasta,parou,anel,amostras}=toque;toque=undefined;pressEm=performance.now();
    if(!arrasta){
      deslizar(Math.round(p));
      if(e.type==='pointerup'&&!parou&&anel&&document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-hero]')===anel) anel.click();
      return;
    }
    nav.classList.remove('arrastando');
    const a=amostras[0]!,dt=e.timeStamp-a.t,v=e.type==='pointerup'&&dt>0&&e.timeStamp-amostras.at(-1)!.t<AMOSTRA_MS?(p-a.p)/dt:0;
    deslizar(pousoDe(p,v),v);
  };
  nav.addEventListener('pointerup',soltar);nav.addEventListener('pointercancel',soltar);
  nav.addEventListener('click',e=>{if(e.isTrusted&&e.detail>0&&performance.now()-pressEm<CLIQUE_MS){e.stopImmediatePropagation();e.preventDefault();}},true);
  nav.addEventListener('dragstart',e=>e.preventDefault());

  const anelDe=(el:Element|null)=>{
    const anel=el?.closest<HTMLElement>('[data-hero]');
    return anel?[...trilho()?.children??[]].indexOf(anel)%Math.max(1,n):-1;
  };
  const mostrar=(k:number)=>{
    if(!emLoop(n)||k<0) return;
    // Where ring k sits from the left edge, in rings: 0..2 is whole; past that it is cut or off to one side.
    const base=anim?anim.alvo:p,d=voltaDe(k-base,n);
    if(d<=2.001) return;
    deslizar(d>n/2+1?base-(n-d):base+d-2);
  };
  // The keyboard walks the rings (Tab, or ← → around the loop) and the row follows the focus; the browser never
  // scrolls the clipped row itself.
  nav.addEventListener('focusin',e=>{nav.scrollLeft=0;mostrar(anelDe(e.target as Element));});
  nav.addEventListener('keydown',e=>{
    if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft') return;
    const k=anelDe(document.activeElement);
    if(k<0) return;
    e.preventDefault();
    (trilho()?.children[voltaDe(k+(e.key==='ArrowRight'?1:-1),n)] as HTMLElement|undefined)?.focus({preventScroll:true});
  });
  new ResizeObserver(aplicar).observe(nav);

  return {
    montou(total,escolhido){
      n=total;nav.toggleAttribute('data-loop',emLoop(n));
      if(primeira&&emLoop(n)){p=Math.max(0,escolhido);primeira=false;}
      parar();p=Math.round(p);aplicar();
    },
    mostrar,
  };
}
