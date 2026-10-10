/**
 * Damage taken, on the screen edge (UX-voce-e-dano d/e): a Laranja Cone frame flashes for 150 ms on every hit to the
 * local player (strength by the share of max hp lost), and stays as a thin static edge while hp is below 30%.
 * Static on purpose (D-020 §2.5: urgency is a static switch to Cone, no infinite pulse). With reduced motion the
 * flash is a static edge for 400 ms (no fade). Never takes taps.
 */
import type {RunView} from '../sim/view.ts';
import {LOW_HP,hurtStrength} from '../render/you-rules.ts';
import {hpFraction,type HudContext,type HudPart} from './model.ts';

export const HURT_FLASH_MS=150;
export const HURT_STATIC_MS=400;

const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Sum of the hits on `localId` among new events (eventId above `seen`), and the last eventId read. */
export function hitsOn(view:Pick<RunView,'events'>,localId:string,seen:number){
  let amount=0,last=seen;
  for(const event of view.events){
    if(event.eventId<=seen)continue;
    last=Math.max(last,event.eventId);
    if(event.type==='damage'&&event.target===localId)amount+=event.amount;
  }
  return {amount,last};
}

export function createHurtFrame(options:{reduced?:()=>boolean}={}):HudPart&{readonly flashes:number}{
  const root=document.createElement('div');root.className='rh-hurt';root.setAttribute('aria-hidden','true');
  for(const part of ['rh-hurt-flash','rh-hurt-low']){const edge=document.createElement('i');edge.className=part;root.append(edge);}
  let seen=-1,timer:ReturnType<typeof setTimeout>|undefined,flashes=0;
  const reduced=options.reduced??reducedMotion;
  return {el:root,get flashes(){return flashes;},update(view:RunView,ctx:HudContext){
    const me=view.players.find(p=>p.id===ctx.localId);
    const hits=hitsOn(view,ctx.localId,seen);seen=hits.last;
    const fraction=me?hpFraction(me):1,down=!me||!!me.downed||!!me.eliminated||me.spectator;
    const low=!down&&fraction>0&&fraction<LOW_HP;
    if(root.hasAttribute('data-low')!==low)root.toggleAttribute('data-low',low);
    if(hits.amount>0&&me&&!me.spectator){
      flashes++;
      root.style.setProperty('--hurt',hurtStrength(hits.amount,me.maxHp).toFixed(2));
      // Restart the flash: drop the attribute, force style, put it back.
      root.removeAttribute('data-flash');void root.offsetWidth;root.setAttribute('data-flash',reduced()?'static':'flash');
      clearTimeout(timer);timer=setTimeout(()=>root.removeAttribute('data-flash'),reduced()?HURT_STATIC_MS:HURT_FLASH_MS+40);
    }
  },destroy(){clearTimeout(timer);}};
}
