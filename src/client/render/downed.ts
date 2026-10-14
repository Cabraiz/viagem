/**
 * Caído in the world (NEW-20261009-UX-resgate-e-ping): where someone fell is read on the ground, not on a banner.
 * - a ring of the real rescue range (REVIVE_RADIUS = 1.2 u) projected on the ground, with the double edge (Breu
 *   outside, Papel inside, D-022) so it reads on sand, grass and water;
 * - the rescue progress fills that same ring in Verde Cartolina ("a favor"), clockwise from the top of the screen;
 * - a short Papel light column over the body, static (no pulse: one show moment only, design §2.5), so the spot is
 *   found among trees and critters;
 * - the body lies down (the scene turns the sprite) and the ficha "Tia, 18 s" (map-labels) carries the counter.
 * Pure geometry in downed-rules.ts (tests), one Graphics for every caído.
 */
import Phaser from 'phaser';
import {tokenColor} from '../ui/tokens.ts';
import {FramesPool,markArt,markFrame,ringHalfWidth} from '../art/frames-art.ts';

import {ringPoints,progressPoints,columnSize,COLUMN,type Pt,type DownedMark} from './downed-rules.ts';
export {ringPoints,progressPoints,columnSize,COLUMN,type Pt,type DownedMark};

export class DownedLayer {
  private readonly ground:Phaser.GameObjects.Graphics;
  private readonly light:Phaser.GameObjects.Graphics;
  private readonly colors={breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cartolina:tokenColor('--c-cartolina')};
  private readonly project:(p:Pt)=>Pt;private readonly depth:(p:Pt)=>number;
  /** The figures' world px multiplier (framing.ts CITY_VIEW_SCALE in the city, 1 elsewhere): the column follows the body. */
  private readonly scale:()=>number;
  /** Imported ring + light column (art/frames-art.ts caido-resgate), one image per caído slot; none without the art. */
  private readonly art:FramesPool;
  private readonly scene:Phaser.Scene;
  constructor(scene:Phaser.Scene,project:(p:Pt)=>Pt,depth:(p:Pt)=>number,scale:()=>number=()=>1){
    this.project=project;this.depth=depth;this.scale=scale;this.scene=scene;this.art=new FramesPool(scene);
    this.ground=scene.add.graphics().setName('caido-chao');this.light=scene.add.graphics().setName('caido-luz');
  }
  /**
   * One frame with every caído (any view, any zoom): `css` = world px per CSS px, for edges that stay ≥ 2 px.
   * `lift`: a depth to draw at instead of the world's (the blackout, VGM-053B: a caído is never hidden by the dark).
   */
  update(marks:readonly DownedMark[],view:number,css:number,lift?:number){
    const g=this.ground.clear(),l=this.light.clear();
    this.art.begin();
    if(!marks.length)return;
    let low=Infinity,high=-Infinity;
    const {width:w,height:h}=columnSize(this.scale());
    const art=markArt('rescue'),now=this.scene.time.now;
    for(let i=0;i<marks.length;i++){
      const m=marks[i],ring=ringPoints(m.at,view).map(p=>this.project(p));
      // Imported ring + column: today's ring width (edge included), under the code progress arc; the body lies on it.
      const feet=this.project(m.at),d=this.depth(m.at);
      if(art&&this.art.mark(i,art,(lift??d-3)-.1,markFrame(art,now,false),feet.x,feet.y,2*ringHalfWidth(ring,feet.x)+5*css)){
        const done=progressPoints(ring,m.progress);
        if(done.length>1)g.lineStyle(5*css,this.colors.breu,1).strokePoints(done,false).lineStyle(3.5*css,this.colors.cartolina,1).strokePoints(done,false);
        low=Math.min(low,d);high=Math.max(high,d);
        continue;
      }
      g.lineStyle(5*css,this.colors.breu,.85).strokePoints(ring,false);
      g.lineStyle(2.5*css,this.colors.papel,1).strokePoints(ring,false);
      const done=progressPoints(ring,m.progress);
      if(done.length>1)g.lineStyle(5*css,this.colors.breu,1).strokePoints(done,false).lineStyle(3.5*css,this.colors.cartolina,1).strokePoints(done,false);
      low=Math.min(low,d);high=Math.max(high,d);
      // Static column: Papel fading upwards, edged in Breu at the foot so it reads on the light sand too.
      l.fillGradientStyle(this.colors.papel,this.colors.papel,this.colors.papel,this.colors.papel,0,0,.5,.5).fillRect(feet.x-w/2,feet.y-h,w,h);
      l.fillStyle(this.colors.breu,.35).fillEllipse(feet.x,feet.y,w*1.6,w*.6);
    }
    // Ground ring under every body; the column in the world's depth order (behind what stands in front of it).
    if(lift!==undefined){g.setDepth(lift);l.setDepth(lift+.5);}else{g.setDepth(low-3);l.setDepth(high+.5);}
  }
  /** Depths now (blackout audit). */
  depths(){return {ring:this.ground.depth,column:this.light.depth};}
  destroy(){this.art.destroy();this.ground.destroy();this.light.destroy();}
}
