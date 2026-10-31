/**
 * NEW-20261031-ORQ-tiro-rapido-e-local (the user: "4 setas vermelhas girando em volta do inimigo focado"): the enemy
 * the hero's shot goes to (rules/front-assist.ts, picked by the scene every frame) wears 4 red arrows pointing in at
 * it, turning slowly, whether or not the button is held; nobody in the front cone, no arrows. The art is one painting
 * (public/art/fx/foco-setas.webp, scripts/import-foco-setas.mjs: ChatGPT via Codex); the code only turns and scales it.
 * Sized by the enemy's drawn body, never under FOCUS_MIN_PX (readable on a 390×844 phone). None until the texture is in.
 */
import type Phaser from 'phaser';

export const FOCUS_KEY='fx:foco-setas',FOCUS_URL='/art/fx/foco-setas.webp';
/** The arrows' span over the enemy's drawn width, and its floor (screen px at body scale 1). */
export const FOCUS_SPAN=1.9,FOCUS_MIN_PX=70;
/** One turn (ms). */
export const FOCUS_TURN_MS=2400;

/** The arrows' side (px) for an enemy drawn `width` px wide at body scale `body`. */
export const focusSide=(width:number,body:number)=>Math.max(width*FOCUS_SPAN,FOCUS_MIN_PX*body);
/** Their rotation (rad) at `now` (ms); still with reduced motion. */
export const focusTurn=(now:number,reduced:boolean)=>reduced?0:(now%FOCUS_TURN_MS)/FOCUS_TURN_MS*2*Math.PI;

export class FocusArrows{
  private image?:Phaser.GameObjects.Image;
  private asked=false;private drawn=false;
  constructor(private readonly scene:Phaser.Scene){}
  /** A frame starts: nothing drawn yet (end() hides the arrows if no focus was drawn). */
  begin(){this.drawn=false;}
  /** Around the screen point (x,y), the middle of an enemy drawn `width` px wide, at `depth`. */
  draw(x:number,y:number,width:number,body:number,depth:number,now:number,reduced:boolean){
    if(!this.ready())return;
    const im=this.image??=this.scene.add.image(0,0,FOCUS_KEY).setName('foco-setas');
    const side=focusSide(width,body);
    im.setVisible(true).setPosition(x,y).setDisplaySize(side,side).setRotation(focusTurn(now,reduced)).setDepth(depth);
    this.drawn=true;
  }
  end(){if(!this.drawn)this.image?.setVisible(false);}
  private ready(){
    const textures=this.scene.textures;
    if(textures.exists(FOCUS_KEY))return true;
    if(this.asked)return false;
    this.asked=true;
    const load=this.scene.load;
    load.image(FOCUS_KEY,FOCUS_URL);
    if(!load.isLoading())load.start();
    return false;
  }
  destroy(){this.image?.destroy();this.image=undefined;}
}
