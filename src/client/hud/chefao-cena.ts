/**
 * The chefão's arrival on the HUD (card NEW-20261023-ORQ-boss-fim-onda-1): his name big and a one-line subtitle while
 * the camera holds on him (render/chefao-cena.ts CenaClock, the scene's own clock), a dim veil like the level-up pause's
 * (nobody moves: the room holds the sim) and, from the 2nd scene this browser saw, "Toque para pular" with the whole
 * screen as the button. The arrival sound is the boss's 'chefe' (audio/events.ts: the boss-phase event of his tick).
 * Painted on its own timer while a scene runs (the views stop with the tick).
 */
import {waveBossById} from '../../rules/index.ts';
import type {CenaClock} from '../render/chefao-cena.ts';
import type {HudPart} from './model.ts';

/** Repaint period while a scene runs (the title's in/out is CSS). */
export const CENA_TICK_MS=50;

/** Name and subtitle of a scene's chefão (rules WAVE_BOSSES); undefined for an id the rules do not know. */
export function cenaTitle(who:string){const b=waveBossById(who);return b&&{name:b.name,subtitle:b.subtitle};}

export interface CenaPartHost {
  clock:CenaClock;
  /** The phone layout (the skip says "Toque", the computer's "Clique"). */
  phone():boolean;
  now?():number;
}

export function createCenaPart(doc:Document,host:CenaPartHost):HudPart&{veil:HTMLElement;live:HTMLElement}{
  const now=()=>host.now?.()??performance.now();
  const veil=doc.createElement('div');veil.className='rh-cena-veu';veil.hidden=true;veil.setAttribute('aria-hidden','true');
  const box=doc.createElement('button');box.type='button';box.className='rh-cena';box.hidden=true;box.lang='pt-BR';box.tabIndex=-1;
  const name=doc.createElement('strong');name.className='rh-cena-nome';
  const subtitle=doc.createElement('span');subtitle.className='rh-cena-sub';
  const skip=doc.createElement('small');skip.className='rh-cena-pular';skip.hidden=true;
  box.append(name,subtitle,skip);
  const live=doc.createElement('span');live.className='rh-sr';live.setAttribute('aria-live','assertive');
  let timer:ReturnType<typeof setInterval>|undefined,who='',destroyed=false;
  const stop=()=>{if(timer!==undefined){clearInterval(timer);timer=undefined;}};
  const paint=()=>{
    const f=host.clock.frame(now());
    if(!f){stop();if(!veil.hidden){veil.hidden=true;box.hidden=true;box.classList.remove('rh-cena-on');who='';}return;}
    if(f.cena.who!==who){
      who=f.cena.who;const t=cenaTitle(who);
      name.textContent=t?.name??'CHEFÃO';subtitle.textContent=t?.subtitle??'';
      live.textContent=t?`Chegou ${t.name}! ${t.subtitle}`:'Chegou o chefão!';
    }
    veil.hidden=false;box.hidden=false;
    // The veil follows the camera (on him: dim), the title its own window.
    veil.style.opacity=(f.weight*.55).toFixed(2);
    box.classList.toggle('rh-cena-on',f.title);
    const text=host.phone()?'Toque para pular':'Clique para pular';
    if(skip.hidden!==!f.skippable)skip.hidden=!f.skippable;
    if(f.skippable&&skip.textContent!==text)skip.textContent=text;
    box.classList.toggle('rh-cena-pulavel',f.skippable);
  };
  const tap=(e:Event)=>{if(host.clock.skip(now())){e.preventDefault();e.stopPropagation();paint();}};
  box.addEventListener('pointerdown',tap);
  return {el:box,veil,live,update(){
    if(destroyed)return;
    if(host.clock.frame(now())&&timer===undefined)timer=setInterval(paint,CENA_TICK_MS);
    paint();
  },destroy(){destroyed=true;stop();}};
}
