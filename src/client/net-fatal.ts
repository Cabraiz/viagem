/**
 * Terminal connection message (UX onda 4, VGM-042b): the reason the client stopped for good and an "Atualizar"
 * button that reloads the page. Inside the game there is no pull-to-refresh (explore.css overscroll), and in the
 * WhatsApp/Instagram browsers the reload lives in a menu, so the button is the way out.
 */
import './net-fatal.css';
import {needsUpdate} from '../protocol/index.ts';
export {needsUpdate};

/** The way back after a terminal drop in a room (LINK_LOST): the room's invite link, not a reload. */
export const BACK_TO_ROOM='Voltar pra sala';

/**
 * Shows (or updates) the panel in `host`; `inline` puts it in the flow (lobby window) instead of over the scene.
 * `action` replaces the reload (kicked from the room, D-025: reloading would knock on the same door); `title` goes
 * above the text in the poster voice (Londrina 21, left), and the window then reads left-aligned.
 */
export function showFatal(host:HTMLElement,message:string,{inline=false,action,title}:{inline?:boolean;action?:{label:string;run():void};title?:string}={}):HTMLElement{
  let panel=host.querySelector<HTMLElement>(':scope > .net-fatal');
  if(!panel){
    panel=document.createElement('div');panel.className='net-fatal';panel.setAttribute('role','alert');
    const heading=document.createElement('h2');heading.className='net-fatal-title';heading.hidden=true;
    const text=document.createElement('p');text.className='net-fatal-text';
    const reload=document.createElement('button');reload.type='button';reload.className='net-fatal-reload';reload.textContent='Atualizar';
    reload.addEventListener('click',()=>{const run=(panel as HTMLElement&{action?:()=>void}).action;if(run)run();else location.reload();});
    panel.append(heading,text,reload);host.append(panel);
  }
  (panel as HTMLElement&{action?:()=>void}).action=action?.run;
  panel.querySelector('.net-fatal-reload')!.textContent=action?.label??'Atualizar';
  panel.dataset.kind=action?'exit':'reload';
  panel.classList.toggle('net-fatal-inline',inline);
  const heading=panel.querySelector<HTMLElement>('.net-fatal-title')!;heading.hidden=!title;heading.textContent=title??'';
  panel.classList.toggle('net-fatal-titled',!!title);
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
