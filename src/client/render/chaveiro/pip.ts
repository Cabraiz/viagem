/**
 * The Uno's live window (card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 3; rules in pip-rules.ts): a second Phaser
 * camera on the car, its viewport under a DOM frame of the HUD (`.rh-pip`, hud.css: under the minimap on the computer,
 * at the top right on the phone) with the car's life bar. The frame's middle is empty: the camera's pixels show
 * through it. Made on the first show; hidden, the camera is invisible (Phaser skips it, no cost).
 * A tap on the frame calls `onTap` (the scene swings the main camera to the car for a moment).
 */
import Phaser from 'phaser';
import {PIP_LIFT_PX,PIP_RECT_MS,pipViewport,pipZoom} from './pip-rules.ts';

export interface UnoPipOptions {
  onTap:()=>void;
  /** Screen-space objects the window must not draw (the vignette: it is drawn over the main camera only). */
  ignore?:()=>readonly Phaser.GameObjects.GameObject[];
}
export interface UnoPipFrame {
  /** Whether the window shows (pip-rules.ts pipWanted). */
  wanted:boolean;
  /** The car's centre in world px, the main camera's zoom, and the car's life (share left, low under CAR_LOW). */
  car?:{x:number;y:number};mainZoom:number;life?:{fraction:number;low:boolean};
  time:number;
}

export class UnoPip {
  readonly el:HTMLButtonElement;
  private readonly view:HTMLElement;
  private readonly fill:HTMLElement;
  private cam?:Phaser.Cameras.Scene2D.Camera;
  private shown=false;
  private rectAt=-Infinity;
  private life='';

  private readonly scene:Phaser.Scene;
  private readonly options:UnoPipOptions;
  constructor(scene:Phaser.Scene,options:UnoPipOptions){
    this.scene=scene;this.options=options;
    const doc=document;
    this.el=doc.createElement('button');this.el.type='button';this.el.className='rh-pip';this.el.hidden=true;
    this.el.setAttribute('aria-label','O Uno está apanhando. Toque para ver.');
    this.view=doc.createElement('span');this.view.className='rh-pip-view';
    const bar=doc.createElement('span');bar.className='rh-pip-bar';
    this.fill=doc.createElement('i');bar.append(this.fill);
    this.el.append(this.view,bar);
    this.el.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();this.options.onTap();});
  }

  /** Every frame, after the main camera moved. */
  update(frame:UnoPipFrame){
    const show=frame.wanted&&!!frame.car;
    if(show!==this.shown){
      this.shown=show;
      if(show&&!this.el.isConnected)(document.querySelector('.rh')??document.body).append(this.el);
      this.el.hidden=!show;
      if(show)this.rectAt=-Infinity;else this.cam?.setVisible(false);
    }
    if(!show||!frame.car)return;
    const life=frame.life?`${Math.round(frame.life.fraction*100)}|${frame.life.low?1:0}`:'';
    if(life!==this.life){
      this.life=life;
      this.fill.style.width=`${Math.round((frame.life?.fraction??0)*100)}%`;
      this.el.classList.toggle('rh-pip-low',!!frame.life?.low);
    }
    const cam=this.camera();
    if(frame.time-this.rectAt>=PIP_RECT_MS||frame.time<this.rectAt){
      this.rectAt=frame.time;
      const canvas=this.scene.game.canvas?.getBoundingClientRect(),inner=this.view.getBoundingClientRect();
      if(canvas&&inner.width>0){
        const v=pipViewport(inner,canvas,{width:this.scene.scale.width,height:this.scene.scale.height});
        cam.setViewport(v.x,v.y,v.width,v.height);
      }
    }
    cam.setBackgroundColor(this.scene.cameras.main.backgroundColor.color32);
    cam.setZoom(pipZoom(frame.mainZoom)).centerOn(frame.car.x,frame.car.y-PIP_LIFT_PX).setVisible(true);
  }

  /** The window camera's world view while it shows (the horde draws what stands in it too), else undefined. */
  viewRect():{x:number;y:number;right:number;bottom:number}|undefined{
    return this.shown&&this.cam?this.cam.worldView:undefined;
  }

  private camera():Phaser.Cameras.Scene2D.Camera{
    if(!this.cam){
      this.cam=this.scene.cameras.add(0,0,1,1,false,'uno-pip');
      const skip=this.options.ignore?.();
      if(skip?.length)this.cam.ignore([...skip]);
    }
    return this.cam;
  }

  destroy(){
    if(this.cam){this.scene.cameras.remove(this.cam);this.cam=undefined;}
    this.el.remove();this.shown=false;
  }
}
