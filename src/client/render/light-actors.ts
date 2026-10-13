/**
 * Actors under the scene's sun (lighting card, render/light.ts): a light four-corner tint, warm on the sun side (upper
 * left), cold on the shade side. It multiplies, so the Breu outline stays Breu. `?luz=0`: no tint (today's look).
 */
import type Phaser from 'phaser';
import {ACTOR_TINT,lightEnabled} from './light.ts';

const LIGHT=lightEnabled();
type Tintable=Phaser.GameObjects.Components.Tint&Phaser.GameObjects.GameObject;
export function sunlit<T extends Tintable>(o:T):T{
  if(LIGHT)o.setTint(ACTOR_TINT.topLeft,ACTOR_TINT.topRight,ACTOR_TINT.bottomLeft,ACTOR_TINT.bottomRight);else o.clearTint();
  return o;
}
