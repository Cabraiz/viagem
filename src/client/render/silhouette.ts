/**
 * The cast silhouette of a body (BUG-20261017-ORQ-sombra-longe-personagem-pequeno, shadow-rules.ts): an image that copies
 * the body's frame as drawn (texture, frame, origin, flip, scale) and lays it on the ground at the feet, away from the
 * sun. It follows the pose, and the weapon when the frame holds it, with no art of its own. One flat tint, set once.
 */
import type Phaser from 'phaser';
import {LIT_SHADOW} from './light.ts';
import {SILHOUETTE,SILHOUETTE_ROTATION} from './shadow-rules.ts';

type Body=Phaser.GameObjects.Image|Phaser.GameObjects.Sprite;
/** A body's frame without the city's rims (contorno-breu copies): its sheet, origin and scale. */
export interface BareFrame {key:string;ox:number;oy:number;sx:number;sy:number}
/**
 * The bare frame of each body drawn from a city copy (sprites/character-sprites.ts sets it): the copy carries the Papel
 * and Breu rims, and a silhouette of them was a dark outline wider than the figure (20/10). Same frame names as the copy.
 */
const bare=new WeakMap<Body,BareFrame>();
export function setBareFrame(body:Body,frame:BareFrame|undefined){if(frame)bare.set(body,frame);else bare.delete(body);}
export function bareFrameOf(body:Body){return bare.get(body);}
export function silhouetteImage(scene:Phaser.Scene,key:string,depth:number){
  return scene.add.image(0,0,key).setDepth(depth).setTintFill(LIT_SHADOW.color).setAlpha(SILHOUETTE.alpha).setVisible(false).setActive(false);
}
/**
 * Lays `sil` under `body` with its feet at (x, y); `on` false (a hidden body) hides it. Its opacity follows the body's,
 * so it fades with it (death, a downed or spectating hero).
 */
/** `length`: × the shadow's length on the ground (1: the figure's own; a giant's is shorter, render/layers.ts). */
export function castSilhouette(sil:Phaser.GameObjects.Image,body:Body,x:number,y:number,on:boolean,depth?:number,length=1){
  if(!on||!body.visible){if(sil.visible)sil.setVisible(false).setActive(false);return;}
  const b=bare.get(body),name=body.frame.name;
  const plain=b&&b.key!==body.texture.key&&body.scene.textures.exists(b.key)&&body.scene.textures.get(b.key).has(name)?b:undefined;
  const key=plain?plain.key:body.texture.key;
  if(sil.texture.key!==key||sil.frame.name!==name)sil.setTexture(key,name);
  sil.setVisible(true).setActive(true).setOrigin(plain?plain.ox:body.originX,plain?plain.oy:body.originY).setFlipX(body.flipX)
    .setScale(plain?plain.sx:body.scaleX,-(plain?plain.sy:body.scaleY)*SILHOUETTE.flatten*length).setRotation(SILHOUETTE_ROTATION+body.rotation).setPosition(x,y)
    .setAlpha(SILHOUETTE.alpha*body.alpha);
  if(depth!==undefined)sil.setDepth(depth);
}
