/**
 * Actors under the scene's sun (lighting card, render/light.ts): a light four-corner tint, warm on the sun side (upper
 * left), cold on the shade side. It multiplies, so the Breu outline stays Breu. `?luz=0`: no tint (today's look).
 */
import type Phaser from 'phaser';
import {ACTOR_TINT,lightEnabled} from './light.ts';
import {studyCorners} from './estudo-flutuando.ts';

const LIGHT=lightEnabled(),STUDY_CORNERS=studyCorners();
type Tintable=Phaser.GameObjects.Components.Tint&Phaser.GameObjects.GameObject;
/** Channel-wise multiply of two 0xRRGGBB colors (a tint over a tint). */
const mul=(a:number,b:number)=>((((a>>16&255)*(b>>16&255)/255)|0)<<16)|((((a>>8&255)*(b>>8&255)/255)|0)<<8)|(((a&255)*(b&255)/255)|0);
/**
 * `accent` (a roster entry's fallback color, papeis-de-inimigo) multiplies the light, so a tinted stand-in stays lit;
 * without the light it is the plain accent.
 */
export function sunlit<T extends Tintable>(o:T,accent?:number):T{
  // Phaser flips with a negative scale, so a flipped sprite's top-left corner is drawn on the right: swap the sides.
  const t=ACTOR_TINT,flipped=(o as Partial<Phaser.GameObjects.Components.Flip>).flipX===true;
  const c=(v:number)=>accent===undefined?v:mul(v,accent);
  // Study inimigos-flutuando (?estudo=amb / ps=a*): extra corner tints over the sun's (debug only).
  const s=STUDY_CORNERS;
  if(s){
    const k=(v:number,i:number)=>mul(c(LIGHT?v:0xffffff),s[i]);
    if(flipped)o.setTint(k(t.topRight,1),k(t.topLeft,0),k(t.bottomRight,3),k(t.bottomLeft,2));
    else o.setTint(k(t.topLeft,0),k(t.topRight,1),k(t.bottomLeft,2),k(t.bottomRight,3));
    return o;
  }
  if(!LIGHT){if(accent===undefined)o.clearTint();else o.setTint(accent);}
  else if(flipped)o.setTint(c(t.topRight),c(t.topLeft),c(t.bottomRight),c(t.bottomLeft));
  else o.setTint(c(t.topLeft),c(t.topRight),c(t.bottomLeft),c(t.bottomRight));
  return o;
}
