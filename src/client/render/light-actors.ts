/**
 * Actors under the scene's sun (lighting card, render/light.ts): a light four-corner tint, warm on the sun side (upper
 * left), cold on the shade side. It multiplies, so the Breu outline stays Breu. `?luz=0`: no tint (today's look).
 */
import type Phaser from 'phaser';
import {ACTOR_TINT,lightEnabled} from './light.ts';

const LIGHT=lightEnabled();
type Tintable=Phaser.GameObjects.Components.Tint&Phaser.GameObjects.GameObject;
export function sunlit<T extends Tintable>(o:T):T{
  // Phaser flips with a negative scale, so a flipped sprite's top-left corner is drawn on the right: swap the sides.
  const t=ACTOR_TINT,flipped=(o as Partial<Phaser.GameObjects.Components.Flip>).flipX===true;
  if(!LIGHT)o.clearTint();
  else if(flipped)o.setTint(t.topRight,t.topLeft,t.bottomRight,t.bottomLeft);
  else o.setTint(t.topLeft,t.topRight,t.bottomLeft,t.bottomRight);
  return o;
}
