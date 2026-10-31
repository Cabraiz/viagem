/**
 * The menu's side of preload/menu-art-preload.ts (menu-imagens-sem-buraco), kept out of main.ts: the preloader wired to
 * the browser (idle time, Save-Data, the match's hold, the previews' lazy chunk), the popup's picture on top and the
 * profile's blurred stand-ins.
 */
import {backgroundHeld,onBackgroundFree} from '../preload/background-hold.ts';
import {browserLoad,chosenArtUrl,createMenuArtPreload,DEITADO,type MenuArtPreload} from '../preload/menu-art-preload.ts';

/** The phone asked for light pages (Save-Data): nothing downloads in the background. */
export const saveData=()=>!!(navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData;

/** The preloader; once the page is in, the popup of `chosen()` comes down in idle time, so BORA! opens it whole. */
export function menuArtNoNavegador(idle:(fn:()=>void)=>unknown,chosen:()=>string):MenuArtPreload{
  const art=createMenuArtPreload({saveData,held:backgroundHeld,onFree:onBackgroundFree,idle,load:browserLoad,
    deitado:()=>matchMedia(DEITADO).matches,dpr:()=>devicePixelRatio||1,
    // A lazy chunk: the previews never ride in the menu's first download (tests/tools/menu-previas.test.ts).
    previas:()=>import('./menu-previas.ts').then(m=>m.PREVIAS)});
  addEventListener('load',()=>art.start(chosen()),{once:true}); // main.ts is a module: it always runs before load
  return art;
}

/**
 * The hero's picture on top of the popup (a background): the file the portrait already shows when it is his (768 or
 * 1024), so confirming never downloads a second copy; else the small file for its box (the 1024 one was ~150 KB for a
 * 190 px box), its preview first while it comes.
 */
export function fotoEscolhida(element:HTMLElement,heroId:string,art:MenuArtPreload):void{
  const shown=document.querySelector<HTMLImageElement>('#portrait img');
  const put=(url:string)=>{element.style.cssText=`background-image:url('${url}')`;};
  if(shown?.complete&&shown.currentSrc.includes(`/${heroId}`))put(shown.currentSrc);
  else art.progressivo(element,chosenArtUrl(heroId,devicePixelRatio||1),put);
}

/** A profile picture still on the way shows its blurred preview behind it until it is in. */
export function previaAte(img:HTMLImageElement,art:MenuArtPreload):void{
  const previa=img.complete?undefined:art.previa(new URL(img.src,location.href).pathname);
  if(!previa)return;
  img.style.background=`url('${previa}') 50% 50% / cover`;
  const tirar=()=>img.style.removeProperty('background');
  img.addEventListener('load',tirar,{once:true});img.addEventListener('error',tirar,{once:true});
}
