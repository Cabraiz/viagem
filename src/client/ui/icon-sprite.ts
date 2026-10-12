/**
 * Puts the sticker sprites in the page once, so every `<use href="#i-…">` (icon.ts: system and status) and
 * `<use href="#a-…">` (sticker.ts: items, awards and sounds) resolves.
 */
import sprite from './icons.svg?raw';
import stickers from './stickers.svg?raw';
import './icons.css';
function mount(doc:Document,id:string,markup:string){
  if(doc.getElementById(id))return;
  const host=doc.createElement('div');
  host.innerHTML=markup;
  const svg=host.querySelector('svg');if(!svg)return;
  svg.id=id;svg.classList.add('icon-sprite');svg.setAttribute('focusable','false');
  doc.body.prepend(svg);
}
export function mountIcons(doc:Document=document){
  mount(doc,'sticker-sprite',stickers);
  mount(doc,'icon-sprite',sprite);
}
