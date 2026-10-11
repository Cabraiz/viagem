/**
 * Terminal connection message (UX onda 4, VGM-042b): the reason the client stopped for good and an "Atualizar"
 * button that reloads the page. Inside the game there is no pull-to-refresh (explore.css overscroll), and in the
 * WhatsApp/Instagram browsers the reload lives in a menu, so the button is the way out.
 */
import './net-fatal.css';
import {needsUpdate} from './net/shared.ts';
export {needsUpdate};

/** Shows (or updates) the panel in `host`; `inline` puts it in the flow (lobby window) instead of over the scene. */
export function showFatal(host:HTMLElement,message:string,{inline=false}:{inline?:boolean}={}):HTMLElement{
  let panel=host.querySelector<HTMLElement>(':scope > .net-fatal');
  if(!panel){
    panel=document.createElement('div');panel.className='net-fatal';panel.setAttribute('role','alert');
    const text=document.createElement('p');text.className='net-fatal-text';
    const reload=document.createElement('button');reload.type='button';reload.className='net-fatal-reload';reload.textContent='Atualizar';
    reload.addEventListener('click',()=>location.reload());
    panel.append(text,reload);host.append(panel);
  }
  panel.classList.toggle('net-fatal-inline',inline);
  panel.dataset.update=String(needsUpdate(message));
  panel.querySelector('.net-fatal-text')!.textContent=message;
  return panel;
}

/** After this long trying to get back, the reconnect banner gets a second line and a way out (UX onda 5, B13). */
export const SLOW_LINK_MS=10_000;
export const SLOW_LINK_TEXT='A conexão tá fraca. Seguimos tentando.';
/**
 * The second line under "Reconectando à turma…" and the "Tentar de novo" button, shown while `visible`. Not terminal:
 * the client keeps trying by itself; the button only tries now, with the backoff reset.
 */
export function showSlowLink(host:HTMLElement,visible:boolean,retry:()=>void):HTMLElement|undefined{
  let panel=host.querySelector<HTMLElement>(':scope > .net-slow');
  if(!visible){if(panel)panel.hidden=true;return panel??undefined;}
  if(!panel){
    panel=document.createElement('div');panel.className='net-slow';panel.setAttribute('role','status');
    const text=document.createElement('p');text.className='net-slow-text';text.textContent=SLOW_LINK_TEXT;
    const button=document.createElement('button');button.type='button';button.className='net-slow-retry';button.textContent='Tentar de novo';
    button.addEventListener('click',event=>{event.stopPropagation();retry();button.disabled=true;setTimeout(()=>{button.disabled=false;},1500);});
    for(const type of ['pointerdown','touchstart'])panel.addEventListener(type,event=>event.stopPropagation());
    panel.append(text,button);host.append(panel);
  }
  panel.hidden=false;
  return panel;
}
