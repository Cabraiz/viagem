/**
 * A hero's stories, opened from his profile photo (NEW-20261023-ORQ-insta-stories-4-herois, the user 23/10: "eu clico no
 * perfil e tem as animações de fade in e fade out ... igual ao Instagram ao clicar ele abre"). Full screen: one bar per
 * story fills in STORY_MS and passes to the next; a tap on the left third goes back, anywhere else forward; holding
 * pauses; a pull down, the X, Escape or the phone's back button closes. It fades in and out, and each story fades in
 * over the last. The HTML is ui/insta.ts storiesTelaHtml; the look is ui/insta.css (.insta-sv).
 * Nothing runs at import: toqueOf is pure (node tests).
 */
import { storiesDe, storiesTelaHtml, storyUrl, type InstaPerfil } from './insta.ts';
import { SWIPE } from './insta-post.ts';

/** How long a story stays, as Instagram's photos. */
export const STORY_MS=5000;
/** A press longer than this is a hold (pause), not a tap. */
export const SEGURAR_MS=220;
/** The share of the width, from the left, where a tap goes back. */
export const VOLTAR_LADO=.3;
const ABRIR_MS=240,FECHAR_MS=200;
/** The letters of the stories' texts and stickers (tokens.css, BUG-20261024-ORQ-stories-texto-estilo-instagram). */
export const LETRAS_STORIES=['400 1em Inter','800 1em Inter','800 1em "Archivo Expanded"','1em "Bebas Neue"','700 1em "Courier Prime"'] as const;

/** What a tap at `x` px of a `largura` px wide screen does on story `i` of `n`. */
export function toqueOf(x:number,largura:number,i:number,n:number):{ir:number}|'fechar'{
  if(x<largura*VOLTAR_LADO) return {ir:Math.max(0,i-1)};
  return i<n-1?{ir:i+1}:'fechar';
}

let aberto:((instantaneo?:boolean)=>void)|undefined;
export const storiesAbertos=()=>!!aberto;
/** Closes the open stories (the phone turned on its side: at once). */
export const fecharStories=(instantaneo=false)=>aberto?.(instantaneo);

/** Opens `perfil`'s stories from the start; `origem` gets the focus back; `fim` runs once they close. */
export function abrirStories(perfil:InstaPerfil,origem:HTMLElement|null,fim?:()=>void):void{
  const lista=storiesDe(perfil.id);
  if(!lista.length) return;
  fecharStories(true);
  const molde=document.createElement('template');
  molde.innerHTML=storiesTelaHtml(perfil);
  const tela=molde.content.firstElementChild as HTMLElement;
  document.body.append(tela);
  const q=<T extends Element>(sel:string)=>tela.querySelector<T>(sel)!;
  const palco=q<HTMLElement>('.insta-sv-palco'),quando=q<HTMLElement>('.insta-sv-quando');
  const stories=[...tela.querySelectorAll<HTMLElement>('.insta-sv-story')],barras=[...tela.querySelectorAll<HTMLElement>('.insta-sv-barra b')];
  const reduzido=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i=0,tempo=0,ultimo=0,pausa=false,fechando=false,quadro=0,letras=false;
  // The texts' letters are asked for on opening, with the first picture; the texts show and the clock runs once they came
  // (or failed: then the fallback letters, never a story stuck).
  const chegaram=()=>{letras=true;tela.classList.add('letras');};
  void Promise.all(LETRAS_STORIES.map(f=>document.fonts.load(f))).then(chegaram,chegaram);

  // The pictures load as they come near: the one on screen and the next.
  const carregar=(k:number)=>{const foto=stories[k]?.querySelector('img');if(foto&&!foto.src)foto.src=storyUrl(perfil.id,k);};
  const pintar=()=>barras.forEach((b,k)=>{b.style.transform=`scaleX(${k<i?1:k>i?0:Math.min(1,tempo/STORY_MS)})`;});
  const mostrar=(k:number)=>{
    i=k;tempo=0;
    stories.forEach((s,j)=>{s.classList.toggle('ativo',j===i);s.setAttribute('aria-hidden',String(j!==i));});
    quando.textContent=lista[i]!.quando;
    carregar(i);carregar(i+1);pintar();
  };
  // The clock only runs while the picture on screen is in: a slow network never skips a story it has not shown.
  const passo=(agora:number)=>{
    quadro=requestAnimationFrame(passo);
    const dt=ultimo?Math.min(100,agora-ultimo):0;ultimo=agora;
    const foto=stories[i]!.querySelector('img')!;
    if(pausa||document.hidden||!letras||!foto.complete||!foto.naturalWidth) return;
    tempo+=dt;
    if(tempo>=STORY_MS){if(i<stories.length-1)mostrar(i+1);else fechar();return;}
    pintar();
  };

  const fechar=(instantaneo=false,pelaHistoria=false)=>{
    if(fechando) return;
    fechando=true;aberto=undefined;cancelAnimationFrame(quadro);
    document.removeEventListener('keydown',tecla);removeEventListener('popstate',voltou);
    if(!pelaHistoria&&history.state?.instaStory) history.back();
    const acabou=()=>{tela.remove();origem?.focus({preventScroll:true});fim?.();};
    if(instantaneo||reduzido){acabou();return;}
    const agora=getComputedStyle(palco).transform;
    const anim=tela.animate([{opacity:1},{opacity:0}],{duration:FECHAR_MS,easing:'ease-in',fill:'forwards'});
    palco.animate([{transform:agora==='none'?'none':agora},{transform:'scale(.94)'}],{duration:FECHAR_MS,easing:'ease-in',fill:'forwards'});
    void anim.finished.then(acabou,acabou);
  };
  aberto=fechar;
  // The phone's back button closes the stories, not the page.
  history.pushState({...(history.state as object|null),instaStory:true},'');
  const voltou=()=>{if(!history.state?.instaStory) fechar(false,true);};
  addEventListener('popstate',voltou);
  const ir=(destino:{ir:number}|'fechar')=>{if(destino==='fechar')fechar();else mostrar(destino.ir);};
  const tecla=(e:KeyboardEvent)=>{
    if(e.key==='Escape') fechar();
    else if(e.key==='ArrowLeft') ir({ir:Math.max(0,i-1)});
    else if(e.key==='ArrowRight') ir(toqueOf(1,1,i,stories.length));
  };
  document.addEventListener('keydown',tecla);
  q<HTMLButtonElement>('.insta-sv-fechar').addEventListener('click',()=>fechar());

  // A press pauses at once; let go quickly where it began, it was a tap (back or forward); pulled down, it closes.
  let toque:{id:number,x:number,y:number,t:number,d:number,v:number,py:number,pt:number,puxou:boolean}|undefined;
  palco.addEventListener('pointerdown',e=>{
    if(e.button>0||fechando||(e.target as Element).closest('.insta-sv-fechar')) return;
    toque={id:e.pointerId,x:e.clientX,y:e.clientY,t:e.timeStamp,d:0,v:0,py:0,pt:e.timeStamp,puxou:false};pausa=true;
    tela.classList.add('pausado');
  });
  palco.addEventListener('pointermove',e=>{
    if(!toque||e.pointerId!==toque.id) return;
    const dy=e.clientY-toque.y;
    if(!toque.puxou&&dy>12&&dy>Math.abs(e.clientX-toque.x)){toque.puxou=true;palco.setPointerCapture(e.pointerId);}
    if(!toque.puxou) return;
    const d=Math.max(0,dy),dt=e.timeStamp-toque.pt;
    if(dt>0){toque.v=(d-toque.py)/dt;toque.py=d;toque.pt=e.timeStamp;}
    toque.d=d;
    palco.style.transform=`translateY(${d}px) scale(${Math.max(.85,1-d/2400)})`;
    tela.style.setProperty('--sv-veu',String(Math.max(0,1-d/500)));
  });
  const soltar=(e:PointerEvent)=>{
    if(!toque||e.pointerId!==toque.id) return;
    const {x,y,t,d,v,puxou}=toque;toque=undefined;pausa=false;tela.classList.remove('pausado');
    if(puxou){
      if(e.type!=='pointercancel'&&(d>SWIPE.baixo||(d>SWIPE.minimo&&v>SWIPE.rapido))){fechar();return;}
      palco.style.transform='';tela.style.removeProperty('--sv-veu');
      if(!reduzido) palco.animate([{transform:`translateY(${d}px)`},{transform:'none'}],{duration:180,easing:'ease-out'});
      return;
    }
    if(e.type!=='pointerup'||e.timeStamp-t>SEGURAR_MS||Math.hypot(e.clientX-x,e.clientY-y)>10) return;
    const caixa=palco.getBoundingClientRect();
    ir(toqueOf(e.clientX-caixa.left,caixa.width,i,stories.length));
  };
  palco.addEventListener('pointerup',soltar);palco.addEventListener('pointercancel',soltar);
  palco.addEventListener('contextmenu',e=>e.preventDefault());

  mostrar(0);
  if(!reduzido){
    tela.animate([{opacity:0},{opacity:1}],{duration:ABRIR_MS,easing:'ease-out'});
    palco.animate([{transform:'scale(.94)'},{transform:'none'}],{duration:ABRIR_MS,easing:'cubic-bezier(.2,.8,.2,1)'});
  }
  quadro=requestAnimationFrame(passo);
  q<HTMLButtonElement>('.insta-sv-fechar').focus({preventScroll:true});
}
