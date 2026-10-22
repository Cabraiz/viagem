/**
 * Weapon in the hand (card NEW-20261021-ORQ-arma-na-mao-viciado, 21/10): where the weapon hand is in each M16 pose
 * (hand-points-data.ts, measured offline by scripts/hand-points.mjs) and how each arsenal sticker is held (its grip and
 * barrel). render/arsenal-fx.ts puts the sticker's grip on the hand of the pose the hero shows, the barrel towards where
 * the hero faces, mirrored with the drawing: E/NE/SW are W/NW/SE flipped, so the weapon changes hands with them.
 * Only sheets in the table (the viciado's M16 and, card NEW-20261022-ORQ-arma-na-mao, the CLT's R06); any other clip
 * keeps the sticker at the hero's side.
 */
import type {HeroDirection} from './sprite-motion.ts';
import type {VariantGeometry} from '../render/city-outline-rules.ts';
import {HAND_POINTS} from './hand-points-data.ts';

/**
 * One measured sheet: the weapon hand's side (none for idle8, a direction per frame), whether the weapon goes behind the
 * body, the hand per frame (96 px cell; a third element 1: behind in that pose).
 */
export interface HandSheet {side?:1|-1;behind:boolean;points:readonly (readonly number[])[]}
/** The hand of one pose, in the drawn (unmirrored) 96 px cell. */
export interface HandPoint {x:number;y:number;behind:boolean}

/** The table's key: the sheet's file name (it carries its sha12, so a reimported sheet has no entry). */
export const handSheetKey=(url:string)=>url.slice(url.lastIndexOf('/')+1).split('?')[0];
export function handPoint(url:string,frame:number,table:Readonly<Record<string,HandSheet>>=HAND_POINTS):HandPoint|undefined{
  const sheet=table[handSheetKey(url)],p=sheet?.points[frame];
  if(!sheet||!p)return undefined;
  return {x:p[0],y:p[1],behind:p[2]===1?true:sheet.behind};
}

/**
 * Where the hero's hand is on screen, from the frame it shows: `ox`/`oy` the drawn frame's origin (0..1, unmirrored),
 * `scale` its scale, `flip` whether it is mirrored (Phaser mirrors inside the frame's box: the hand goes to 96 − x).
 */
export function handOnScreen(hand:HandPoint,at:{x:number;y:number},ox:number,oy:number,scale:number,flip:boolean,out:{x:number;y:number}){
  const dx=(hand.x-ox*96)*scale;
  out.x=at.x+(flip?-dx:dx);out.y=at.y+(hand.y-oy*96)*scale;
  return out;
}

/**
 * A hero's weapon hand this frame: screen point, the barrel's screen angle, whether the hand is behind the body, and the
 * hero sprite's depth (render/arsenal-fx.ts puts the weapon just over or under it).
 */
export interface HeldHand {x:number;y:number;aim:number;behind:boolean;depth:number;patch?:HandPatch}
/**
 * The fingers over the handle (card NEW-20261022-ORQ-arma-na-mao, 22/10: "a mão fica POR CIMA do cabo"): the hero
 * sprite's own frame, cropped to a square of HAND_PATCH cell px around the hand, drawn again just over the weapon. It
 * shows what the sprite shows (its texture, frame, origin, scale and mirror: the city copy with its ring included), so
 * the fist and its outline close over the handle pixel for pixel. `crop` is in the shown frame's px, mirrored with it.
 */
export interface HandPatch {key:string;frame:string|number;x:number;y:number;ox:number;oy:number;sx:number;sy:number;flip:boolean;crop:[number,number,number,number]}
/** Half the side of the hand's patch, in 96 px cell px: the fist (~5 px) and a pixel of its rim. */
export const HAND_PATCH=3.5;
/** What heldHand reads of a hero sprite and of CharacterSprites (structural: no Phaser here). */
interface HandSprite {x:number;y:number;depth:number;rotation:number;visible:boolean;
  texture:{key:string};frame:{name:string|number};originX:number;originY:number;scaleX:number;scaleY:number;flipX:boolean}
interface HandPoses<S> {handPose(sprite:S):{point:HandPoint;ox:number;oy:number;scale:number;flip:boolean;direction:HeroDirection;geom?:VariantGeometry}|undefined}
/**
 * The patch's crop for the hand at `hand` (cell px, unmirrored) in the frame the sprite shows: the cell itself, or a
 * city copy (`geom`: the cell's crop resampled by kx/ky and padded). Phaser crops a mirrored sprite in its shown
 * (mirrored) coordinates, so the square goes to the frame's width − x.
 */
export function patchCrop(hand:{x:number;y:number},flip:boolean,geom?:VariantGeometry):[number,number,number,number]{
  const x=geom?geom.pad+(hand.x-geom.crop.x)/geom.kx:hand.x,y=geom?geom.pad+(hand.y-geom.crop.y)/geom.ky:hand.y;
  const rx=HAND_PATCH/(geom?.kx??1),ry=HAND_PATCH/(geom?.ky??1),w=geom?geom.slotW:96;
  return [(flip?w-x:x)-rx,y-ry,2*rx,2*ry];
}
/**
 * How far right (screen px) the patch must sit from the sprite so its fist lands on the sprite's (BUG-20261022-ORQ-quadro-
 * sangra-vizinho, 22/10: "uma mão flutuando atrás de mim"). Phaser 3.90 samples a mirrored crop from the right texels
 * (Frame.setCropUVs) but places the quad at the crop's unmirrored spot (MultiPipeline.batchSprite): the fist showed at
 * the mirror of the hand, on the far side of the body, `frameW − 2·x` px away. Measured in a headless WebGL Phaser.
 */
export const patchShiftX=(crop:readonly number[],frameW:number,scaleX:number,flip:boolean)=>flip?(2*crop[0]+crop[2]-frameW)*scaleX:0;
/**
 * The weapon hand of a hero sprite on screen (scene.ts and the city sandbox feed render/arsenal-fx.ts with it), when the
 * pose it shows has one measured. A downed hero lies turned (−90°): the measured hand no longer fits, none.
 */
export function heldHand<S extends HandSprite>(sprites:HandPoses<S>,sprite:S|undefined):HeldHand|undefined{
  const pose=sprite?.visible&&sprite.rotation===0?sprites.handPose(sprite):undefined;
  if(!sprite||!pose)return undefined;
  const at=handOnScreen(pose.point,sprite,pose.ox,pose.oy,pose.scale,pose.flip,{x:0,y:0});
  const held:HeldHand={x:at.x,y:at.y,aim:AIM_ANGLE[pose.direction],behind:pose.point.behind,depth:sprite.depth};
  // Behind the body the sprite already covers the weapon: no patch.
  if(!held.behind){
    const crop=patchCrop(pose.point,sprite.flipX,pose.geom);
    held.patch={key:sprite.texture.key,frame:sprite.frame.name,x:sprite.x+patchShiftX(crop,pose.geom?.slotW??96,sprite.scaleX,sprite.flipX),y:sprite.y,
      ox:sprite.originX,oy:sprite.originY,sx:sprite.scaleX,sy:sprite.scaleY,flip:sprite.flipX,crop};
  }
  return held;
}

/** Screen angle (radians, y down) the barrel points to for each facing: the oblique camera flattens the diagonals. */
export const AIM_ANGLE:Readonly<Record<HeroDirection,number>>={
  E:0,SE:.6,S:Math.PI*.56,SW:Math.PI-.6,W:Math.PI,NW:-Math.PI+.6,N:-Math.PI*.44,NE:-.6,
};

/**
 * How a sticker (128 px `ui` art) is held: `grip` its handle (0..1 of the image), `barrel` the angle its barrel or
 * blade points to in the art, `px` its drawn size (CSS px at body 1, as the old side sticker's 36), `upright` a weapon
 * carried standing (the maçarico: it only mirrors, never turns).
 */
export interface WeaponHold {grip:readonly [number,number];barrel:number;px:number;upright?:boolean}
const deg=(d:number)=>d*Math.PI/180;
export const WEAPON_HOLD:Readonly<Record<string,WeaponHold>>={
  faca:{grip:[24/128,100/128],barrel:deg(-42),px:34},
  pistola:{grip:[33/128,87/128],barrel:deg(-15),px:32},
  escopeta:{grip:[102/128,85/128],barrel:deg(-154),px:44},
  submetralhadora:{grip:[79/128,87/128],barrel:deg(-8),px:38},
  rifle:{grip:[38/128,83/128],barrel:deg(-41),px:50},
  macarico:{grip:[55/128,75/128],barrel:deg(-90),px:36,upright:true},
  rojao:{grip:[37/128,95/128],barrel:deg(-54),px:44},
};
/** A sticker without a hold (a legendary, a tool): held by its lower-left corner, pointing up-right. */
export const DEFAULT_HOLD:WeaponHold={grip:[.25,.8],barrel:deg(-45),px:36};

/**
 * The held weapon's look (card arma-na-mao item 4, 22/10: "a arma não deveria estar tão brilhosa, já que ela pega
 * sombra"): the HUD sticker is a lit, glossy icon; in the hand it takes the figure's matte light. Per pixel: a quarter
 * of the way to its grey, the highlights pressed down (a gamma), a little darker overall. render/arsenal-fx.ts bakes
 * it once per weapon (the ground pickup and the HUD keep the icon) and adds the city ring the heroes wear.
 */
export const HELD_LOOK={desaturate:.25,gamma:1.25,gain:.88};
export function heldLook(rgba:Uint8ClampedArray){
  const {desaturate,gamma,gain}=HELD_LOOK;
  for(let i=0;i<rgba.length;i+=4){
    const r=rgba[i],g=rgba[i+1],b=rgba[i+2],grey=.299*r+.587*g+.114*b;
    for(let c=0;c<3;c++){const v=rgba[i+c]+(grey-rgba[i+c])*desaturate;rgba[i+c]=255*Math.pow(v/255,gamma)*gain;}
  }
  return rgba;
}
/** Tint on the held weapon: in front, the figure's light; behind the body, its shade. */
export const HELD_TINT={front:0xffffff,behind:0xa49c94};

/**
 * The sticker's placement for an aim: rotation, mirror and origin (the grip, mirrored with the image: Phaser mirrors a
 * frame inside its own box). A barrel pointing left is drawn upside-down mirrored (flipY), so the weapon stays upright.
 */
export function holdPose(hold:WeaponHold,aim:number){
  const left=Math.cos(aim)<-1e-6;
  if(hold.upright)return {rotation:0,flipX:left,flipY:false,ox:left?1-hold.grip[0]:hold.grip[0],oy:hold.grip[1]};
  if(left)return {rotation:aim+hold.barrel,flipX:false,flipY:true,ox:hold.grip[0],oy:1-hold.grip[1]};
  return {rotation:aim-hold.barrel,flipX:false,flipY:false,ox:hold.grip[0],oy:hold.grip[1]};
}
