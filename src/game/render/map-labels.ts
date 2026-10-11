/**
 * Map labels as UI fichas (DSG-cenario-coerencia, D-022): place names and ally names were 13-16 px *world* text,
 * about 4 px on a phone at the whole-island zoom (~0.26). Now they are fichas from the tokens (Breu body at 88%,
 * Papel border 2 px, M PLUS 13 px CSS in Papel) at a constant screen size, and they leave the useful area in a run:
 * place names hide during a wave, ally names show only before the run or when that ally is caído (map-label-rules.ts).
 */
import Phaser from 'phaser';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';

import {LABEL_CSS,labelScale} from './map-label-rules.ts';
export {LABEL_CSS,allyLabelText,labelScale,mapLabelVisible,placeYieldsToSos,railName,shortName} from './map-label-rules.ts';
export type {AllyStatus,LabelKind} from './map-label-rules.ts';

/** Rasterized at 2× and scaled down, so the glyphs stay crisp if the canvas ever renders above 1×. */
const RASTER=2;
const PAD_X=7,PAD_Y=3,BORDER=2,RADIUS=6;
/** SOS tag: etiqueta (radius 4) inside the ficha. */
const TAG_PAD=4,TAG_GAP=5,TAG_RADIUS=4;

export class MapLabel {
  readonly text:Phaser.GameObjects.Text;
  readonly plate:Phaser.GameObjects.Graphics;
  /** "SOS" tag of a caído ficha (made on first use). */
  private tag?:Phaser.GameObjects.Text;
  private sos=false;
  private drawnText='';private drawnW=-1;private drawnH=-1;private drawnSos=false;
  private x=0;private y=0;private depth=0;
  /** Screen box of the last frame it showed (CSS px from the camera's top-left), for the place fichas to step aside. */
  readonly screen={x:0,y:0,shown:false,sos:false};
  private readonly colors={breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cone:tokenColor('--c-cone')};
  constructor(private scene:Phaser.Scene,label:string){
    this.text=scene.add.text(0,0,label,{fontFamily:token('--f-sistema'),fontSize:`${LABEL_CSS*RASTER}px`,fontStyle:'700',color:token('--c-papel')}).setOrigin(.5,0);
    this.plate=scene.add.graphics();
    whenFontsReady(()=>{this.text.updateText();this.tag?.updateText();this.drawnW=-1;});
  }
  setText(label:string){if(this.text.text!==label)this.text.setText(label);return this;}
  /**
   * Caído variant (UX onda 4, D1): a Laranja Cone "SOS" tag at the left and a 2 px Cone ring outside the Breu/Papel
   * ficha, so it is told from the place fichas by shape and color, not only by its words.
   */
  setSos(on:boolean){
    this.sos=on;
    if(on&&!this.tag)this.tag=this.scene.add.text(0,0,'SOS',{fontFamily:token('--f-sistema'),fontSize:`${LABEL_CSS*RASTER}px`,fontStyle:'800',color:token('--c-breu')}).setOrigin(.5,0);
    return this;
  }
  /** World anchor (top center of the ficha) and depth; the ficha hangs below the anchor. */
  anchor(x:number,y:number,depth:number){this.x=x;this.y=y;this.depth=depth;return this;}
  /** Per frame: constant screen size at this zoom, and hidden when the rule says so. */
  draw(zoom:number,visible:boolean){
    const tag=this.sos?this.tag:undefined;
    this.text.setVisible(visible);this.plate.setVisible(visible);this.tag?.setVisible(visible&&!!tag);
    const cam=this.scene.cameras.main;
    this.screen.shown=visible;this.screen.sos=visible&&!!tag;this.screen.x=(this.x-cam.worldView.x)*zoom;this.screen.y=(this.y-cam.worldView.y)*zoom;
    if(!visible)return;
    const s=labelScale(zoom),k=s/RASTER;
    const tw=this.text.width*k,th=this.text.height*k,tagW=tag?tag.width*k+2*TAG_PAD*s:0,gap=tag?TAG_GAP*s:0;
    const w=tw+tagW+gap+2*PAD_X*s,h=th+2*PAD_Y*s,left=this.x-w/2;
    this.text.setScale(k).setPosition(left+PAD_X*s+tagW+gap+tw/2,this.y+PAD_Y*s).setDepth(this.depth+1);
    tag?.setScale(k).setPosition(left+PAD_X*s+tagW/2,this.y+PAD_Y*s).setDepth(this.depth+2);
    this.plate.setPosition(this.x,this.y).setDepth(this.depth);
    // Repaint the plate only when the text or the size changes (no per-frame string or triangulation).
    if(this.text.text===this.drawnText&&this.sos===this.drawnSos&&Math.abs(w-this.drawnW)<.01&&Math.abs(h-this.drawnH)<.01)return;
    this.drawnText=this.text.text;this.drawnW=w;this.drawnH=h;this.drawnSos=this.sos;
    const g=this.plate.clear(),b=BORDER*s;
    if(tag)g.lineStyle(b,this.colors.cone,1).strokeRoundedRect(-w/2-b/2,-b/2,w+b,h+b,(RADIUS+1)*s);
    g.fillStyle(this.colors.breu,.88).fillRoundedRect(-w/2,0,w,h,RADIUS*s);
    g.lineStyle(b,this.colors.papel,1).strokeRoundedRect(-w/2+b/2,b/2,w-b,h-b,(RADIUS-1)*s);
    if(tag)g.fillStyle(this.colors.cone,1).fillRoundedRect(-w/2+PAD_X*s,b+s,tagW,h-2*b-2*s,TAG_RADIUS*s);
  }
  destroy(){this.text.destroy();this.plate.destroy();this.tag?.destroy();}
}
