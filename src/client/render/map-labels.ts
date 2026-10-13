/**
 * Map labels as UI fichas (DSG-cenario-coerencia, D-022): place names and ally names were 13-16 px *world* text,
 * about 4 px on a phone at the whole-island zoom (~0.26). Now they are fichas from the tokens (Breu body at 88%,
 * Papel border 2 px, M PLUS 13 px CSS in Papel) at a constant screen size, and they leave the useful area in a run:
 * place names hide during a wave, ally names show only before the run or when that ally is caído (map-label-rules.ts).
 */
import Phaser from 'phaser';
import {token,tokenColor,whenFontsReady} from '../ui/tokens.ts';

import {LABEL_CSS,labelScale} from './map-label-rules.ts';
import {dropSlice,hideSlice,placeSlice,sliceFor} from '../art/frames-art.ts';
import {labelPlaque} from '../art/hud-art.ts';
export {LABEL_CSS,allyLabelText,labelScale,mapLabelVisible,placeYieldsToSos,railName,shortName} from './map-label-rules.ts';
export type {AllyStatus,LabelKind} from './map-label-rules.ts';

/** Rasterized at 2× and scaled down, so the glyphs stay crisp if the canvas ever renders above 1×. */
const RASTER=2;
const PAD_X=7,PAD_Y=3,BORDER=2,RADIUS=6;
/** Caído: the boia sticker (16 px CSS) at the left of the ficha, as on the team strip and the "Me salva" button. */
const BOIA_CSS=16,TAG_GAP=5;

export class MapLabel {
  readonly text:Phaser.GameObjects.Text;
  readonly plate:Phaser.GameObjects.Graphics;
  private sos=false;
  private drawnText='';private drawnW=-1;private drawnH=-1;private drawnSos=false;
  private x=0;private y=0;private depth=0;
  /** Screen box of the last frame it showed (CSS px from the camera's top-left), for the place fichas to step aside. */
  readonly screen={x:0,y:0,shown:false,sos:false};
  private readonly colors={breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cone:tokenColor('--c-cone')};
  /**
   * `place`: a street or place name. Place and ally names are drawn on the imported plaque (art/frames-art.ts
   * `plaquinha`, 9-slice) when it is in (the inventory has no ally variant, so allies reuse it); the caído (SOS) ficha
   * keeps today's ficha, its boia and Cone ring.
   */
  constructor(private scene:Phaser.Scene,label:string,private readonly place=false){
    this.text=scene.add.text(0,0,label,{fontFamily:token('--f-sistema'),fontSize:`${LABEL_CSS*RASTER}px`,fontStyle:'700',color:token('--c-papel')}).setOrigin(.5,0);
    this.plate=scene.add.graphics();
    whenFontsReady(()=>{this.text.updateText();this.drawnW=-1;});
  }
  setText(label:string){if(this.text.text!==label)this.text.setText(label);return this;}
  /**
   * Caído variant (UX onda 4, D1; design onda 6 D6): the boia sticker at the left (no "SOS" in caps: the same boia as
   * the team strip and the "Me salva" button) and a 2 px Cone ring outside the Breu/Papel ficha, so it is told from the
   * place fichas by shape and color, not only by its words.
   */
  setSos(on:boolean){this.sos=on;return this;}
  /** World anchor (top center of the ficha) and depth; the ficha hangs below the anchor. */
  anchor(x:number,y:number,depth:number){this.x=x;this.y=y;this.depth=depth;return this;}
  /** Per frame: constant screen size at this zoom, and hidden when the rule says so. */
  draw(zoom:number,visible:boolean){
    const tag=this.sos;
    this.text.setVisible(visible);this.plate.setVisible(visible);
    const plaque=labelPlaque(this.place?'place':'ally',tag);
    if(!visible||!plaque)hideSlice(this);
    const cam=this.scene.cameras.main;
    this.screen.shown=visible;this.screen.sos=visible&&!!tag;this.screen.x=(this.x-cam.worldView.x)*zoom;this.screen.y=(this.y-cam.worldView.y)*zoom;
    if(!visible)return;
    const s=labelScale(zoom),k=s/RASTER;
    const tw=this.text.width*k,th=this.text.height*k,tagW=tag?BOIA_CSS*s:0,gap=tag?TAG_GAP*s:0;
    const w=tw+tagW+gap+2*PAD_X*s,h=th+2*PAD_Y*s,left=this.x-w/2;
    this.text.setScale(k).setPosition(left+PAD_X*s+tagW+gap+tw/2,this.y+PAD_Y*s).setDepth(this.depth+1);
    this.plate.setPosition(this.x,this.y).setDepth(this.depth);
    // Imported plaque: stretched to today's ficha box, its corners at the ficha's scale; the code plate is not drawn.
    const nine=plaque&&sliceFor(this.scene,this,plaque);
    if(nine&&plaque){this.plate.setVisible(false);this.drawnW=-1;placeSlice(nine,plaque,left,this.y,w,h,s).setDepth(this.depth);return;}
    // Repaint the plate only when the text or the size changes (no per-frame string or triangulation).
    if(this.text.text===this.drawnText&&this.sos===this.drawnSos&&Math.abs(w-this.drawnW)<.01&&Math.abs(h-this.drawnH)<.01)return;
    this.drawnText=this.text.text;this.drawnW=w;this.drawnH=h;this.drawnSos=this.sos;
    const g=this.plate.clear(),b=BORDER*s;
    if(tag)g.lineStyle(b,this.colors.cone,1).strokeRoundedRect(-w/2-b/2,-b/2,w+b,h+b,(RADIUS+1)*s);
    g.fillStyle(this.colors.breu,.88).fillRoundedRect(-w/2,0,w,h,RADIUS*s);
    g.lineStyle(b,this.colors.papel,1).strokeRoundedRect(-w/2+b/2,b/2,w-b,h-b,(RADIUS-1)*s);
    if(tag){
      // Boia: Papel ring with four Cone bands, Breu edge, the ficha's body showing through the hole.
      const cx=-w/2+PAD_X*s+tagW/2,cy=h/2,r=tagW/2;
      g.fillStyle(this.colors.breu,1).fillCircle(cx,cy,r+1.2*s).fillStyle(this.colors.papel,1).fillCircle(cx,cy,r);
      g.fillStyle(this.colors.cone,1);for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;g.slice(cx,cy,r,a-.38,a+.38,false).fillPath();}
      g.fillStyle(this.colors.breu,1).fillCircle(cx,cy,r*.46);
    }
  }
  destroy(){dropSlice(this);this.text.destroy();this.plate.destroy();}
}
