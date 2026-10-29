/**
 * The lighting card's vignette (render/light.ts GRADES[world].vignette): a radial darkening of the screen corners drawn
 * as one camera-fixed image over the world (the HUD is DOM, above it). No post pass, so the canvas antialias stays.
 * Economy mode and `?luz=0` hide it.
 */
import Phaser from 'phaser';
import {CITY_PALETTE} from './city/palette.ts';
import {GRADES,VIGNETTE_RANGE,exposureFor,lightEnabled,type LightWorld} from './light.ts';
import {setExposure} from './exposure-pipeline.ts';

const KEY='luz-vinheta',SIZE=256;
export const VIGNETTE_DEPTH=9e8;

export class Vignette {
  private image?:Phaser.GameObjects.Image;
  private shown=false;
  private covered=false;
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
  /** The image (screen space): a second camera (the Uno's live window, chaveiro/pip.ts) ignores it. */
  get object():Phaser.GameObjects.Image|undefined{return this.image;}
  /** The map's strength; hidden in economy mode. The map's exposure too (jogo-mais-escuro), economy or not. */
  set(world:LightWorld,economy:boolean){setExposure(exposureFor(world));this.shown=!economy;this.image?.setAlpha(GRADES[world].vignette).setVisible(this.shown&&!this.covered);}
  /** The fear's dark (render/fear-dark.ts) covers the screen: hidden under it (a full-screen layer nobody would see). */
  cover(covered:boolean){if(covered===this.covered)return;this.covered=covered;this.image?.setVisible(this.shown&&!covered);}
  /** Every frame: covers the camera (scroll factor 0 still zooms around the centre, so undo the zoom). */
  update(){
    const img=this.image;if(!img?.visible)return;
    const cam=this.scene.cameras.main,z=cam.zoom||1;
    img.setPosition(cam.width/2,cam.height/2).setDisplaySize(cam.width/z,cam.height/z);
  }
}
