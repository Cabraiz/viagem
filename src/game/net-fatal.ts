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
