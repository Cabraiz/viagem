/**
 * The lighting card's vignette (render/light.ts GRADES[world].vignette): a radial darkening of the screen corners drawn
 * as one camera-fixed image over the world (the HUD is DOM, above it). No post pass, so the canvas antialias stays.
 * Economy mode and `?luz=0` hide it.
 */
import Phaser from 'phaser';
import {CITY_PALETTE} from './city/palette.ts';
import {GRADES,VIGNETTE_RANGE,lightEnabled,type LightWorld} from './light.ts';

const KEY='luz-vinheta',SIZE=256;
export const VIGNETTE_DEPTH=9e8;

export class Vignette {
  private image?:Phaser.GameObjects.Image;
  constructor(private scene:Phaser.Scene,search?:string){
    if(!lightEnabled(search))return;
    if(!scene.textures.exists(KEY)){
      const tex=scene.textures.createCanvas(KEY,SIZE,SIZE)!,ctx=tex.getContext(),c=CITY_PALETTE.breu;
      // Alpha 0 inside VIGNETTE_RANGE[0] of the half diagonal, 1 at the corner (the image's alpha scales it per map).
      const half=Math.SQRT2*SIZE/2,g=ctx.createRadialGradient(SIZE/2,SIZE/2,half*VIGNETTE_RANGE[0],SIZE/2,SIZE/2,half*VIGNETTE_RANGE[1]);
      const rgb=`${c>>16&255},${c>>8&255},${c&255}`;
      g.addColorStop(0,`rgba(${rgb},0)`);g.addColorStop(1,`rgba(${rgb},1)`);
      ctx.fillStyle=g;ctx.fillRect(0,0,SIZE,SIZE);tex.refresh();
    }
    this.image=scene.add.image(0,0,KEY).setOrigin(.5).setScrollFactor(0).setDepth(VIGNETTE_DEPTH).setVisible(false);
  }
  /** The map's strength; hidden in economy mode. */
  set(world:LightWorld,economy:boolean){this.image?.setAlpha(GRADES[world].vignette).setVisible(!economy);}
  /** Every frame: covers the camera (scroll factor 0 still zooms around the centre, so undo the zoom). */
  update(){
    const img=this.image;if(!img?.visible)return;
    const cam=this.scene.cameras.main,z=cam.zoom||1;
    img.setPosition(cam.width/2,cam.height/2).setDisplaySize(cam.width/z,cam.height/z);
  }
}
