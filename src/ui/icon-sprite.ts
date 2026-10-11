/** Puts the sticker sprite (src/ui/icons.svg) in the page once, so every `<use href="#i-…">` resolves (icon.ts). */
import sprite from './icons.svg?raw';
import './icons.css';
export function mountIcons(doc:Document=document){
  if(doc.getElementById('icon-sprite'))return;
  const host=doc.createElement('div');
  host.innerHTML=sprite;
  const svg=host.querySelector('svg');if(!svg)return;
  svg.id='icon-sprite';svg.classList.add('icon-sprite');svg.setAttribute('focusable','false');
  doc.body.prepend(svg);
}
