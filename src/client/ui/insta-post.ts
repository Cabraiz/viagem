/**
 * A grid photo of the Instagram profile opened as a post (BUG-20261023-ORQ-instagram-letreiro-do-perfil, the user 23/10:
 * "expande igualzinho ao Instagram"). The card grows out of the thumbnail; a swipe to the side passes to the other two
 * photos; it closes with the back arrow, the phone's back button, a tap outside or a swipe down, shrinking back into the
 * thumbnail of the photo on screen. A double tap on the photo (or the heart) likes it. The HTML is ui/insta.ts
 * postTelaHtml; the look is ui/insta.css (.insta-ver). Nothing runs at import: gestoOf is pure (node tests).
 */
import { postTelaHtml, type InstaPerfil } from './insta.ts';

/** When a drag becomes a gesture: a share of the card's width to the side, px down, or a flick (px/ms) past 24 px. */
export const SWIPE=Object.freeze({lado:.22,baixo:110,rapido:.5,minimo:24});
export type Gesto='anterior'|'proximo'|'fechar'|'ficar';
/** What a released drag does: `d` px along its axis (x: right is +, y: down is +), `v` its speed, photo `i` of `n`. */
export function gestoOf(eixo:'x'|'y',d:number,v:number,largura:number,i:number,n:number):Gesto{
  const flick=Math.abs(d)>SWIPE.minimo&&Math.abs(v)>SWIPE.rapido&&Math.sign(v)===Math.sign(d);
  if(eixo==='y') return d>SWIPE.baixo||(flick&&d>0)?'fechar':'ficar';
  if(Math.abs(d)<=largura*SWIPE.lado&&!flick) return 'ficar';
  if(d<0) return i<n-1?'proximo':'ficar';
  return i>0?'anterior':'ficar';
}

const ABRIR_MS=280,FECHAR_MS=220,DUPLO_MS=300;
let aberto:((instantaneo?:boolean)=>void)|undefined;
export const postAberto=()=>!!aberto;
/** Closes the open post (the phone turned on its side: at once). */
export const fecharPost=(instantaneo=false)=>aberto?.(instantaneo);

/** Opens photo `inicio` of `perfil`; `miniatura(i)` is the grid's button of photo i (where it grows from and returns to). */
export function abrirPost(perfil:InstaPerfil,inicio:number,miniatura:(i:number)=>HTMLElement|null):void{
  fecharPost(true);
  const molde=document.createElement('template');
  molde.innerHTML=postTelaHtml(perfil);
  const tela=molde.content.firstElementChild as HTMLElement;
  document.body.append(tela);
  const q=<T extends Element>(sel:string)=>tela.querySelector<T>(sel)!;
  const cartao=q<HTMLElement>('.insta-ver-cartao'),veu=q<HTMLElement>('.insta-ver-veu'),trilho=q<HTMLElement>('.insta-ver-trilho');
  const slides=[...tela.querySelectorAll<HTMLElement>('.insta-ver-slide')],pontos=[...tela.querySelectorAll<HTMLElement>('.insta-ver-pontos i')];
  const reduzido=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i=Math.max(0,Math.min(slides.length-1,inicio)),fechando=false;

  const mostrar=(arrasto=0,animar=true)=>{
    trilho.style.transition=animar&&!reduzido?'':'none';
    trilho.style.transform=`translateX(calc(${-i*100}% + ${arrasto}px))`;
    slides.forEach((slide,k)=>{slide.inert=k!==i;});
    pontos.forEach((ponto,k)=>ponto.classList.toggle('ativo',k===i));
  };
  mostrar(0,false);
  // The card's transform that puts photo k's square over its thumbnail (origin: the photo's centre in the card).
  const sobreMiniatura=(k:number)=>{
    const alvo=miniatura(k)?.getBoundingClientRect(),foto=slides[k]!.querySelector('.insta-ver-midia')!.getBoundingClientRect(),caixa=cartao.getBoundingClientRect();
    if(!alvo||!alvo.width) return undefined;
    // During a slide the photo is off to the side: measured where it will be, centred in the card.
    const fx=caixa.left+caixa.width/2,fy=foto.top+foto.height/2;
    cartao.style.transformOrigin=`${fx-caixa.left}px ${fy-caixa.top}px`;
    return `translate(${alvo.left+alvo.width/2-fx}px,${alvo.top+alvo.height/2-fy}px) scale(${Math.max(alvo.width,alvo.height)/foto.width})`;
  };
  const de=reduzido?undefined:sobreMiniatura(i);
  if(de){
    cartao.animate([{transform:de,opacity:.4},{transform:'none',opacity:1}],{duration:ABRIR_MS,easing:'cubic-bezier(.2,.8,.2,1)'});
    veu.animate([{opacity:0},{opacity:1}],{duration:ABRIR_MS,easing:'ease-out'});
  }

  const fechar=(instantaneo=false,pelaHistoria=false)=>{
    if(fechando) return;
    fechando=true;aberto=undefined;
    document.removeEventListener('keydown',tecla);removeEventListener('popstate',voltou);
    if(!pelaHistoria&&history.state?.instaPost) history.back();
    const fim=()=>{tela.remove();miniatura(i)?.focus({preventScroll:true});};
    // From where a pull down left the card: read first, then measured with the card back in place.
    const agora=getComputedStyle(cartao).transform,veuAgora=getComputedStyle(veu).opacity;
    cartao.style.transform='';
    const para=instantaneo||reduzido?undefined:sobreMiniatura(i);
    if(!para){fim();return;}
    const anim=cartao.animate([{transform:agora==='none'?'none':agora,opacity:1},{transform:para,opacity:.3}],{duration:FECHAR_MS,easing:'cubic-bezier(.4,0,.8,.6)',fill:'forwards'});
    veu.animate([{opacity:veuAgora},{opacity:0}],{duration:FECHAR_MS,fill:'forwards'});
    void anim.finished.then(fim,fim);
  };
  aberto=fechar;
  // The phone's back button closes the post, not the page.
  history.pushState({...(history.state as object|null),instaPost:true},'');
  const voltou=()=>{if(!history.state?.instaPost) fechar(false,true);};
  addEventListener('popstate',voltou);

  const ir=(k:number)=>{if(k>=0&&k<slides.length&&k!==i){i=k;}mostrar();};
  const tecla=(e:KeyboardEvent)=>{
    if(e.key==='Escape') fechar();
    else if(e.key==='ArrowLeft') ir(i-1);
    else if(e.key==='ArrowRight') ir(i+1);
  };
  document.addEventListener('keydown',tecla);
  q<HTMLButtonElement>('.insta-ver-voltar').addEventListener('click',()=>fechar());
  veu.addEventListener('click',()=>fechar());

  const curtir=(slide:HTMLElement,so=false)=>{
    const botao=slide.querySelector<HTMLButtonElement>('.insta-ver-curtir')!,on=so||botao.getAttribute('aria-pressed')!=='true';
    botao.setAttribute('aria-pressed',String(on));
    if(on&&!reduzido) botao.animate([{transform:'scale(1)'},{transform:'scale(1.25)'},{transform:'scale(1)'}],{duration:260,easing:'ease-out'});
  };
  for(const slide of slides) slide.querySelector('.insta-ver-curtir')!.addEventListener('click',()=>curtir(slide));

  // Drags: the first 8 px pick the axis; to the side moves the track (a third as far past the ends), down pulls the card.
  let toque:{id:number,x:number,y:number,eixo?:'x'|'y',d:number,v:number,px:number,pt:number}|undefined;
  let arrastou=false,ultimoToque=0;
  cartao.addEventListener('pointerdown',e=>{
    if(e.button>0||fechando) return;
    toque={id:e.pointerId,x:e.clientX,y:e.clientY,d:0,v:0,px:0,pt:e.timeStamp};arrastou=false;
  });
  cartao.addEventListener('pointermove',e=>{
    if(!toque||e.pointerId!==toque.id) return;
    const dx=e.clientX-toque.x,dy=e.clientY-toque.y;
    if(!toque.eixo){
      if(Math.hypot(dx,dy)<8) return;
      toque.eixo=Math.abs(dx)>Math.abs(dy)?'x':'y';
      arrastou=true;cartao.setPointerCapture(e.pointerId);
    }
    const d=toque.eixo==='x'?dx:Math.max(0,dy),dt=e.timeStamp-toque.pt;
    if(dt>0){toque.v=(d-toque.px)/dt;toque.px=d;toque.pt=e.timeStamp;}
    toque.d=d;
    if(toque.eixo==='x') mostrar((i===0&&d>0)||(i===slides.length-1&&d<0)?d/3:d,false);
    else {cartao.style.transform=`translateY(${d}px) scale(${Math.max(.85,1-d/2400)})`;veu.style.opacity=String(Math.max(0,1-d/500));}
  });
  const soltar=(e:PointerEvent)=>{
    if(!toque||e.pointerId!==toque.id) return;
    const {eixo,d,v,x,y}=toque;toque=undefined;
    if(!eixo){
      // A tap on the photo: two within DUPLO_MS like it, with the big heart.
      const midia=(e.target as Element|null)?.closest<HTMLElement>('.insta-ver-midia');
      if(midia&&e.type==='pointerup'&&Math.hypot(e.clientX-x,e.clientY-y)<8){
        if(e.timeStamp-ultimoToque<DUPLO_MS){
          curtir(slides[i]!,true);ultimoToque=0;
          if(!reduzido) midia.querySelector('.insta-ver-pop')!.animate([{opacity:0,transform:'scale(.4)'},{opacity:1,transform:'scale(1.1)',offset:.3},{opacity:1,transform:'scale(1)',offset:.7},{opacity:0,transform:'scale(1)'}],{duration:800,easing:'ease-out'});
        } else ultimoToque=e.timeStamp;
      }
      return;
    }
    const gesto=e.type==='pointercancel'?'ficar':gestoOf(eixo,d,v,trilho.clientWidth,i,slides.length);
    if(eixo==='x'){ir(gesto==='proximo'?i+1:gesto==='anterior'?i-1:i);return;}
    if(gesto==='fechar'){fechar();return;}
    cartao.style.transform='';veu.style.opacity='';
    if(!reduzido){cartao.animate([{transform:`translateY(${d}px)`},{transform:'none'}],{duration:180,easing:'ease-out'});}
  };
  cartao.addEventListener('pointerup',soltar);cartao.addEventListener('pointercancel',soltar);
  // A drag that started on the heart or the back arrow is not a tap on them.
  cartao.addEventListener('click',e=>{if(arrastou){e.stopPropagation();e.preventDefault();arrastou=false;}},true);

  q<HTMLButtonElement>('.insta-ver-voltar').focus({preventScroll:true});
}
