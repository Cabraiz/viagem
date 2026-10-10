/**
 * Debug overlay of the screen zones (UX-zonas-tela), dev only: loaded on demand by explore.ts with `?zonas` in the URL or
 * window.__zones.overlay(true). Never imported by the game code, so neither it nor its CSS reach the build.
 */
import './zones-debug.css';
import type {Rect,ScreenZones} from './zones.ts';

/** Debug overlay (dev, `?zonas` in the URL or __zones.overlay(true)): the zones drawn over the real scene. */
export function drawZoneOverlay(zones:ScreenZones,doc:Document=document){
  let layer=doc.querySelector<HTMLElement>('.rh-zones-debug');
  // Inside the open modal shell: a body child would sit under the dialog's top layer.
  if(!layer){layer=doc.createElement('div');layer.className='rh-zones-debug';layer.setAttribute('aria-hidden','true');(doc.querySelector('dialog[open]')??doc.body).append(layer);}
  const parts:[string,Rect|undefined,string][]=[['área útil',zones.useful,'cartolina'],['topo',zones.top,'lilas'],['anúncio',zones.announce,'amarelo'],
    ['time',zones.team,'papel'],['polegar esq.',zones.leftThumb,'cone'],['polegar dir.',zones.rightThumb,'cone']];
  layer.replaceChildren(...parts.filter(([,r])=>!!r).map(([label,r,tone])=>{
    const box=doc.createElement('div');box.className='rh-zone';box.dataset.tone=tone;box.textContent=label;
    Object.assign(box.style,{left:`${r!.x}px`,top:`${r!.y}px`,width:`${r!.width}px`,height:`${r!.height}px`});
    return box;
  }));
  return layer;
}
export function clearZoneOverlay(doc:Document=document){doc.querySelector('.rh-zones-debug')?.remove();}
