/**
 * Muitas luzes: the Uno's headlights (chaveiro/renderer.ts places them). Two lamp points at its nose, drawn with the car
 * when the nose faces the screen, and the long cone over the fog toward where it points. Frames of the luzes atlas
 * (CityLive's LuzesLayer loads it); nothing until it is in, nothing with `?luzes=0`.
 */
import Phaser from 'phaser';
import {LUZ,LUZES_ATLAS,LUZES_DEPTH,faroisPose,luzesEnabled,type FaroisAt} from './rules.ts';

export class UnoFarois {
  private readonly on=luzesEnabled(typeof location==='undefined'?'':location.search);
  private imgs?:{left:Phaser.GameObjects.Image;right:Phaser.GameObjects.Image;cone:Phaser.GameObjects.Image};

  private readonly scene:Phaser.Scene;
  constructor(scene:Phaser.Scene){this.scene=scene;}

  /** The car this frame: its screen points, its depth and its alpha (it fades while covering the hero). */
  show(at:FaroisAt,depth:number,alpha:number){
    const imgs=this.images();
    if(!imgs)return;
    const p=faroisPose(at);
    for(const [img,pt] of [[imgs.left,at.left],[imgs.right,at.right]] as const)
      img.setPosition(pt.x,pt.y).setDisplaySize(p.lamp,p.lamp).setDepth(depth+.03).setAlpha(.9*alpha).setVisible(p.facing);
    imgs.cone.setPosition(at.nose.x,at.nose.y).setRotation(p.angle).setDisplaySize(p.length,p.width).setAlpha(.5).setVisible(true);
  }

  hide(){if(this.imgs)for(const img of Object.values(this.imgs))img.setVisible(false);}
  destroy(){if(this.imgs)for(const img of Object.values(this.imgs))img.destroy();this.imgs=undefined;}

  private images(){
    if(!this.on||!this.scene.textures.exists(LUZES_ATLAS.key))return undefined;
    const add=(frame:number)=>this.scene.add.image(0,0,LUZES_ATLAS.key,frame).setBlendMode(Phaser.BlendModes.ADD).setName('uno-farol');
    // The cone frame points right with its lamp at 12 % of its width.
    return this.imgs??={left:add(LUZ.lamp),right:add(LUZ.lamp),cone:add(LUZ.cone).setOrigin(.12,.5).setDepth(LUZES_DEPTH)};
  }
}
