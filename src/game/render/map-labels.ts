/**
 * Map labels as UI fichas (DSG-cenario-coerencia, D-022): place names and ally names were 13-16 px *world* text,
 * about 4 px on a phone at the whole-island zoom (~0.26). Now they are fichas from the tokens (Breu body at 88%,
 * Papel border 2 px, M PLUS 13 px CSS in Papel) at a constant screen size, and they leave the useful area in a run:
 * place names hide during a wave, ally names show only before the run or when that ally is caído (map-label-rules.ts).
 */
import Phaser from 'phaser';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';

import {LABEL_CSS,labelScale} from './map-label-rules.ts';
export {LABEL_CSS,allyLabelText,labelScale,mapLabelVisible,shortName} from './map-label-rules.ts';
export type {AllyStatus,LabelKind} from './map-label-rules.ts';

/** Rasterized at 2× and scaled down, so the glyphs stay crisp if the canvas ever renders above 1×. */
const RASTER=2;
const PAD_X=7,PAD_Y=3,BORDER=2,RADIUS=6;

export class MapLabel {
  readonly text:Phaser.GameObjects.Text;
  readonly plate:Phaser.GameObjects.Graphics;
  private drawn='';
  private x=0;private y=0;private depth=0;
  private readonly colors={breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel')};
  constructor(scene:Phaser.Scene,label:string){
    this.text=scene.add.text(0,0,label,{fontFamily:token('--f-sistema'),fontSize:`${LABEL_CSS*RASTER}px`,fontStyle:'700',color:token('--c-papel')}).setOrigin(.5,0);
    this.plate=scene.add.graphics();
    whenFontsReady(()=>{this.text.updateText();this.drawn='';});
  }
  setText(label:string){if(this.text.text!==label)this.text.setText(label);return this;}
  /** World anchor (top center of the ficha) and depth; the ficha hangs below the anchor. */
  anchor(x:number,y:number,depth:number){this.x=x;this.y=y;this.depth=depth;return this;}
  /** Per frame: constant screen size at this zoom, and hidden when the rule says so. */
  draw(zoom:number,visible:boolean){
    this.text.setVisible(visible);this.plate.setVisible(visible);
    if(!visible)return;
    const s=labelScale(zoom),k=s/RASTER;
    const w=this.text.width*k+2*PAD_X*s,h=this.text.height*k+2*PAD_Y*s;
    this.text.setScale(k).setPosition(this.x,this.y+PAD_Y*s).setDepth(this.depth+1);
    this.plate.setPosition(this.x,this.y).setDepth(this.depth);
    const key=`${this.text.text}|${w.toFixed(2)}|${h.toFixed(2)}`;
    if(key===this.drawn)return;
    this.drawn=key;
    const g=this.plate.clear();
    g.fillStyle(this.colors.breu,.88).fillRoundedRect(-w/2,0,w,h,RADIUS*s);
    g.lineStyle(BORDER*s,this.colors.papel,1).strokeRoundedRect(-w/2+BORDER*s/2,BORDER*s/2,w-BORDER*s,h-BORDER*s,(RADIUS-1)*s);
  }
  destroy(){this.text.destroy();this.plate.destroy();}
}
