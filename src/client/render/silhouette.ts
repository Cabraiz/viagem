/**
 * The cast silhouette of a body (BUG-20261017-ORQ-sombra-longe-personagem-pequeno, shadow-rules.ts): an image that copies
 * the body's frame as drawn (texture, frame, origin, flip, scale) and lays it on the ground at the feet, away from the
 * sun. It follows the pose, and the weapon when the frame holds it, with no art of its own. One flat tint, set once.
 */
import Phaser from 'phaser';
import {LIT_SHADOW} from './light.ts';
import {SILHOUETTE,SILHOUETTE_ROTATION} from './shadow-rules.ts';

type Body=Phaser.GameObjects.Image|Phaser.GameObjects.Sprite;
export function silhouetteImage(scene:Phaser.Scene,key:string,depth:number){
  return scene.add.image(0,0,key).setDepth(depth).setTintFill(LIT_SHADOW.color).setAlpha(SILHOUETTE.alpha).setVisible(false).setActive(false);
}
/** Lays `sil` under `body` with its feet at (x, y); `on` false (economy, a flyer, a hidden body) hides it. */
export function castSilhouette(sil:Phaser.GameObjects.Image,body:Body,x:number,y:number,on:boolean,depth?:number){
  if(!on||!body.visible){if(sil.visible)sil.setVisible(false).setActive(false);return;}
  if(sil.texture.key!==body.texture.key||sil.frame.name!==body.frame.name)sil.setTexture(body.texture.key,body.frame.name);
  sil.setVisible(true).setActive(true).setOrigin(body.originX,body.originY).setFlipX(body.flipX)
    .setScale(body.scaleX,-body.scaleY*SILHOUETTE.flatten).setRotation(SILHOUETTE_ROTATION+body.rotation).setPosition(x,y);
  if(depth!==undefined)sil.setDepth(depth);
}
