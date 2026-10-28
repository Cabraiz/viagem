/**
 * The dark of the fear (card NEW-20261023-ORQ-fear-escuridao-sozinho, etapa 3; what to draw: render/fear-rules.ts).
 * - The dark: one small render texture (1/FEAR_RT_SCALE of the screen; the gradients are soft, so nothing is lost and
 *   the phone fills a sixteenth of the pixels) holding a dark stamp with a clear circle at the hero; each safe spot
 *   (an ally on their feet, the Uno) erases its company radius out of it, so they stay lit in the dark.
 * - The warm light: the same spots get a soft warm glow, stamped in the same texture after the erase, "light = safe".
 * - The arrow: a warm chevron with two dots by the hero, pointing at the nearest safe spot.
 * - The countdown (card escuridao-justa, item 9): over the last seconds, a warm ring around the hero that empties
 *   clockwise and "Escuro: N s" under his feet (a whole second changes the text, the ring redraws each frame).
 * Over the lighting vignette (render/vignette.ts), under the DOM HUD. Built on the first fear, hidden while there is none.
 * One full-screen layer (etapa 4 bench, SwiftShader phone: each full-screen layer cost ~4 ms a frame, the RT's redraw
 * nothing): the glows live in the texture, and the scene hides the 3 % vignette while the dark covers it.
 * Shown in economy mode and with `?luz=0` too: it is the game telling the player something, not a look.
 */
import Phaser from 'phaser';
import {CITY_PALETTE,LAMP_LIGHT} from './city/palette.ts';
import {VIGNETTE_DEPTH} from './vignette.ts';
import {fearCountText} from './fear-rules.ts';
import {token} from '../ui/tokens.ts';

const DARK_KEY='medo-escuro',LIGHT_KEY='medo-luz',ARROW_KEY='medo-seta';
const DARK_SIZE=512,LIGHT_SIZE=128,ARROW_SIZE=64;
/** Over the lighting vignette, under nothing else in the world. */
export const FEAR_DEPTH=VIGNETTE_DEPTH+10;
/** The dark is drawn at 1/this of the screen. */
export const FEAR_RT_SCALE=4;
/** The dark texture: clear inside DARK_RAMP[0] of its half size, full from DARK_RAMP[1] out. */
export const DARK_RAMP=[.06,.13] as const;
/** How much a safe spot clears the dark (1 = fully) and how bright its warm glow is, at full dark. */
export const SPOT_CLEAR=.92,SPOT_WARM=.3;
/** The arrow's distance from the hero (camera px): a little outside the body, inside the clear circle when it is small. */
export const ARROW_RING_PX={min:58,max:120} as const;
const ARROW_PX=46;
/** The arrow's fill: the lamp's warm light, deeper so it reads on snow. */
const ARROW_FILL=0xFFB22E;

/** The countdown's ring: its radius (× the hero's drawn height, at least RING_MIN_PX camera px) and line (camera px). */
export const RING={share:.62,minPx:34,line:5,edge:3} as const;
/** The countdown's text (camera px): its size and its gap under the ring. */
const COUNT_PX=20,COUNT_GAP_PX=4;

/** A safe spot as drawn: centre in world px and its ground ellipse's half axes (world px). */
export interface FearSpotPx {x:number;y:number;rx:number;ry:number}
export interface FearDraw {
  alpha:number;
  /** The clear circle's radius, fraction of the screen's half diagonal (beat included). */
  hole:number;
  /** The hero's centre (world px). */
  hero:{x:number;y:number};
  /** The hero's drawn height (world px): the countdown's ring goes round him. */
  heroH?:number;
  spots:readonly FearSpotPx[];
  /** The nearest safe spot (world px), or undefined: no arrow. */
  arrow?:{x:number;y:number};
  /** The arrow's bob, 0..1 (time-based; 0 with reduced motion). */
  bob:number;
  /** The countdown (FearFrame.count): whole seconds left and the ring's share. Undefined: none. */
  count?:{seconds:number;share:number};
}

const smoothStops=(g:CanvasGradient,from:number,to:number,rgb:string,inner:number,outer:number)=>{
  for(let i=0;i<=8;i++){const t=i/8,s=t*t*(3-2*t);g.addColorStop(from+(to-from)*t,`rgba(${rgb},${inner+(outer-inner)*s})`);}
};
const rgbOf=(c:number)=>`${c>>16&255},${c>>8&255},${c&255}`;

function makeTextures(scene:Phaser.Scene){
  const tex=scene.textures;
  if(!tex.exists(DARK_KEY)){
    const t=tex.createCanvas(DARK_KEY,DARK_SIZE,DARK_SIZE)!,ctx=t.getContext(),h=DARK_SIZE/2;
    const g=ctx.createRadialGradient(h,h,0,h,h,h*Math.SQRT2);
    const a=DARK_RAMP[0]/Math.SQRT2,b=DARK_RAMP[1]/Math.SQRT2;
    // White: the render texture's Breu tint colours it.
    g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(a,'rgba(255,255,255,0)');
    smoothStops(g,a,b,'255,255,255',0,1);g.addColorStop(1,'rgba(255,255,255,1)');
    ctx.fillStyle=g;ctx.fillRect(0,0,DARK_SIZE,DARK_SIZE);t.refresh();
  }
  if(!tex.exists(LIGHT_KEY)){
    const t=tex.createCanvas(LIGHT_KEY,LIGHT_SIZE,LIGHT_SIZE)!,ctx=t.getContext(),h=LIGHT_SIZE/2;
    const g=ctx.createRadialGradient(h,h,0,h,h,h);
    g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.55,'rgba(255,255,255,1)');
    smoothStops(g,.55,1,'255,255,255',1,0);
    ctx.fillStyle=g;ctx.fillRect(0,0,LIGHT_SIZE,LIGHT_SIZE);t.refresh();
  }
  if(!tex.exists(ARROW_KEY)){
    // Pointing right (+x): two dots, then a notched chevron; warm lamp fill, Breu edge.
    const t=tex.createCanvas(ARROW_KEY,ARROW_SIZE,ARROW_SIZE)!,ctx=t.getContext(),k=ARROW_SIZE/48;
    ctx.lineJoin='round';ctx.lineWidth=3*k;ctx.strokeStyle=`rgb(${rgbOf(CITY_PALETTE.breu)})`;ctx.fillStyle=`rgb(${rgbOf(ARROW_FILL)})`;
    for(const [x,r] of [[7,3],[16,3.6]] as const){ctx.beginPath();ctx.arc(x*k,24*k,r*k,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.beginPath();ctx.moveTo(24*k,11*k);ctx.lineTo(44*k,24*k);ctx.lineTo(24*k,37*k);ctx.lineTo(29*k,24*k);ctx.closePath();ctx.fill();ctx.stroke();
    t.refresh();
  }
}

export class FearDark {
  private readonly rt:Phaser.GameObjects.RenderTexture;
  private readonly arrow:Phaser.GameObjects.Image;
  private readonly ring:Phaser.GameObjects.Graphics;
  private readonly countText:Phaser.GameObjects.Text;
  private countShown=0;
  private shown=false;
  constructor(private readonly scene:Phaser.Scene){
    makeTextures(scene);
    const cam=scene.cameras.main;
    this.rt=scene.add.renderTexture(0,0,Math.max(1,Math.ceil(cam.width/FEAR_RT_SCALE)),Math.max(1,Math.ceil(cam.height/FEAR_RT_SCALE)))
      .setOrigin(.5).setScrollFactor(0).setDepth(FEAR_DEPTH).setVisible(false).setName('medo-escuro');
    this.arrow=scene.add.image(0,0,ARROW_KEY).setDepth(FEAR_DEPTH+2).setVisible(false).setName('medo-seta');
    this.ring=scene.add.graphics().setDepth(FEAR_DEPTH+1).setVisible(false).setName('medo-anel');
    this.countText=scene.add.text(0,0,'',{fontFamily:token('--f-cartaz'),fontSize:`${COUNT_PX}px`,color:`#${ARROW_FILL.toString(16)}`,
      stroke:`rgb(${rgbOf(CITY_PALETTE.breu)})`,strokeThickness:5}).setOrigin(.5,0).setDepth(FEAR_DEPTH+2).setVisible(false).setName('medo-conta');
    this.mainOnly(this.rt);this.mainOnly(this.arrow);this.mainOnly(this.ring);this.mainOnly(this.countText);
  }
  /** Only the main camera draws it: a second one already made (the Uno's live window, the kill-cam) ignores it. */
  private mainOnly<T extends Phaser.GameObjects.GameObject>(object:T):T{
    const cams=this.scene.cameras;
    for(const cam of cams.cameras)if(cam!==cams.main)cam.ignore(object);
    return object;
  }
  /** Everything it draws (a second camera, the Uno's live window, ignores them). */
  get objects():Phaser.GameObjects.GameObject[]{return [this.rt,this.arrow,this.ring,this.countText];}
  /** True while the dark layer is on screen (the scene hides the vignette under it). */
  get covering(){return this.shown&&this.rt.visible;}
  hide(){
    if(!this.shown)return;
    this.shown=false;this.rt.setVisible(false);this.arrow.setVisible(false);this.drawCount(undefined,0,{x:0,y:0},0);
  }
  /** The countdown's ring and text around the hero (world px), or none. */
  private drawCount(count:FearDraw['count'],z:number,hero:{x:number;y:number},heroH:number){
    if(!count){
      if(this.countShown){this.countShown=0;this.ring.clear().setVisible(false);this.countText.setVisible(false);}
      return;
    }
    const r=Math.max(heroH*RING.share,RING.minPx/z),start=-Math.PI/2;
    // The empty track (Breu) then the warm share left, clockwise from the top.
    this.ring.clear().setVisible(true)
      .lineStyle((RING.line+2*RING.edge)/z,CITY_PALETTE.breu,.85).strokeCircle(hero.x,hero.y,r)
      .lineStyle(RING.line/z,ARROW_FILL,1);
    if(count.share>0){this.ring.beginPath();this.ring.arc(hero.x,hero.y,r,start,start+count.share*Math.PI*2,false);this.ring.strokePath();}
    if(this.countShown!==count.seconds){this.countShown=count.seconds;this.countText.setText(fearCountText(count.seconds));}
    this.countText.setPosition(hero.x,hero.y+r+(RING.line/2+RING.edge+COUNT_GAP_PX)/z).setScale(1/z).setVisible(true);
  }
  draw(d:FearDraw){
    if(d.alpha<=0&&!d.arrow){this.hide();return;}
    this.shown=true;
    const cam=this.scene.cameras.main,z=cam.zoom||1,W=cam.width,H=cam.height;
    const rw=Math.max(1,Math.ceil(W/FEAR_RT_SCALE)),rh=Math.max(1,Math.ceil(H/FEAR_RT_SCALE));
    const rt=this.rt;
    if(rt.width!==rw||rt.height!==rh)rt.resize(rw,rh);
    // Camera px of a world px point, then the render texture's px.
    const sx=(x:number)=>(x-cam.worldView.x)*z/FEAR_RT_SCALE,sy=(y:number)=>(y-cam.worldView.y)*z/FEAR_RT_SCALE;
    if(d.alpha>0){
      const halfDiag=Math.hypot(W,H)/2,holePx=d.hole*halfDiag/FEAR_RT_SCALE;
      const scale=holePx/(DARK_RAMP[0]*DARK_SIZE/2);
      rt.clear();
      rt.stamp(DARK_KEY,undefined,sx(d.hero.x),sy(d.hero.y),{scale,alpha:d.alpha,tint:CITY_PALETTE.breu});
      const spot=(s:FearSpotPx)=>({x:sx(s.x),y:sy(s.y),scaleX:2*s.rx*z/FEAR_RT_SCALE/LIGHT_SIZE,scaleY:2*s.ry*z/FEAR_RT_SCALE/LIGHT_SIZE});
      for(const s of d.spots){const p=spot(s);rt.stamp(LIGHT_KEY,undefined,p.x,p.y,{scaleX:p.scaleX,scaleY:p.scaleY,alpha:SPOT_CLEAR,erase:true});}
      // The warm glows over the cleared spots, in the same texture (no layer of their own).
      const warm=SPOT_WARM*Math.min(1,d.alpha/.8);
      for(const s of d.spots){const p=spot(s);rt.stamp(LIGHT_KEY,undefined,p.x,p.y,{scaleX:p.scaleX,scaleY:p.scaleY,alpha:warm,tint:LAMP_LIGHT.color});}
      // Scroll factor 0 still zooms around the camera's centre: undo the zoom.
      rt.setPosition(W/2,H/2).setDisplaySize(W/z,H/z).setVisible(true);
    }else rt.setVisible(false);
    this.drawCount(d.count,z,d.hero,d.heroH??0);
    const a=d.arrow;
    if(!a){this.arrow.setVisible(false);return;}
    const angle=Math.atan2(a.y-d.hero.y,a.x-d.hero.x);
    const ring=Math.max(ARROW_RING_PX.min,Math.min(ARROW_RING_PX.max,d.hole*Math.hypot(W,H)/2*.7))+6*d.bob;
    this.arrow.setPosition(d.hero.x+Math.cos(angle)*ring/z,d.hero.y+Math.sin(angle)*ring/z).setRotation(angle)
      .setDisplaySize(ARROW_PX/z*ARROW_SIZE/48,ARROW_PX/z*ARROW_SIZE/48).setVisible(true);
  }
  destroy(){this.rt.destroy();this.arrow.destroy();this.ring.destroy();this.countText.destroy();}
}
