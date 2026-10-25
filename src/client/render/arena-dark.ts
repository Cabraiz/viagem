/**
 * The chefão's arena in the dark (card NEW-20261023-ORQ-boss-fim-onda-1, etapa 7; what to draw: render/arena-rules.ts).
 * One small render texture (1/ARENA_RT_SCALE of the screen: the edges are soft, nothing is lost) filled with Breu; the
 * arena and each light (the hero, the allies, the Uno) erase a soft ellipse out of it. Own textures and depth: the
 * fear's dark (render/fear-dark.ts, card fear-escuridao-sozinho) draws over it and is not touched.
 * Only the main camera draws it (the Uno's live window and the kill-cam ignore it). Built on the first chefão.
 */
import Phaser from 'phaser';
import {CITY_PALETTE} from './city/palette.ts';
import {VIGNETTE_DEPTH} from './vignette.ts';

const LIGHT_KEY='arena-luz',LIGHT_SIZE=128;
/** Over the lighting vignette, under the fear's dark (VIGNETTE_DEPTH + 10). */
export const ARENA_DEPTH=VIGNETTE_DEPTH+9;
/** The dark is drawn at 1/this of the screen. */
export const ARENA_RT_SCALE=4;
/** The light's texture: fully clear inside this fraction of its radius, then a soft edge to nothing. */
export const LIGHT_CORE=.62;

/** A lit spot as drawn: centre in world px and the half axes (world px) of its clear edge's end. */
export interface ArenaSpotPx {x:number;y:number;rx:number;ry:number}
export interface ArenaDraw {alpha:number;spots:readonly ArenaSpotPx[]}

function makeTexture(scene:Phaser.Scene){
  if(scene.textures.exists(LIGHT_KEY))return;
  const t=scene.textures.createCanvas(LIGHT_KEY,LIGHT_SIZE,LIGHT_SIZE)!,ctx=t.getContext(),h=LIGHT_SIZE/2;
  const g=ctx.createRadialGradient(h,h,0,h,h,h);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(LIGHT_CORE,'rgba(255,255,255,1)');
  for(let i=1;i<=8;i++){const u=i/8,s=u*u*(3-2*u);g.addColorStop(LIGHT_CORE+(1-LIGHT_CORE)*u,`rgba(255,255,255,${1-s})`);}
  ctx.fillStyle=g;ctx.fillRect(0,0,LIGHT_SIZE,LIGHT_SIZE);t.refresh();
}

export class ArenaDark {
  private readonly rt:Phaser.GameObjects.RenderTexture;
  private shown=false;
  constructor(private readonly scene:Phaser.Scene){
    makeTexture(scene);
    const cam=scene.cameras.main;
    this.rt=scene.add.renderTexture(0,0,Math.max(1,Math.ceil(cam.width/ARENA_RT_SCALE)),Math.max(1,Math.ceil(cam.height/ARENA_RT_SCALE)))
      .setOrigin(.5).setScrollFactor(0).setDepth(ARENA_DEPTH).setVisible(false).setName('arena-escuro');
    this.rt.setTint(CITY_PALETTE.breu);
  }
  hide(){if(this.shown){this.shown=false;this.rt.setVisible(false);}}
  draw(d:ArenaDraw){
    if(d.alpha<=0){this.hide();return;}
    const cams=this.scene.cameras,cam=cams.main,z=cam.zoom||1,W=cam.width,H=cam.height;
    // A second camera made since (the Uno's live window, the kill-cam) never draws it.
    for(const other of cams.cameras)if(other!==cam)other.ignore(this.rt);
    const rw=Math.max(1,Math.ceil(W/ARENA_RT_SCALE)),rh=Math.max(1,Math.ceil(H/ARENA_RT_SCALE)),rt=this.rt;
    if(rt.width!==rw||rt.height!==rh)rt.resize(rw,rh);
    const sx=(x:number)=>(x-cam.worldView.x)*z/ARENA_RT_SCALE,sy=(y:number)=>(y-cam.worldView.y)*z/ARENA_RT_SCALE;
    rt.clear();rt.fill(0xffffff,d.alpha);
    for(const s of d.spots){
      const rx=s.rx*z/ARENA_RT_SCALE,ry=s.ry*z/ARENA_RT_SCALE;
      rt.stamp(LIGHT_KEY,undefined,sx(s.x),sy(s.y),{scaleX:2*rx/LIGHT_SIZE,scaleY:2*ry/LIGHT_SIZE,erase:true});
    }
    // Scroll factor 0 still zooms around the camera's centre: undo the zoom.
    rt.setPosition(W/2,H/2).setDisplaySize(W/z,H/z).setVisible(true);
    this.shown=true;
  }
  destroy(){this.rt.destroy();}
}
