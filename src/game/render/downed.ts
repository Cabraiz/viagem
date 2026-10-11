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
import {tokenColor} from '../../ui/tokens.ts';

import {ringPoints,progressPoints,COLUMN,type Pt,type DownedMark} from './downed-rules.ts';
export {ringPoints,progressPoints,COLUMN,type Pt,type DownedMark};

export class DownedLayer {
  private readonly ground:Phaser.GameObjects.Graphics;
  private readonly light:Phaser.GameObjects.Graphics;
  private readonly colors={breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cartolina:tokenColor('--c-cartolina')};
  private readonly project:(p:Pt)=>Pt;private readonly depth:(p:Pt)=>number;
  constructor(scene:Phaser.Scene,project:(p:Pt)=>Pt,depth:(p:Pt)=>number){
    this.project=project;this.depth=depth;
    this.ground=scene.add.graphics();this.light=scene.add.graphics();
  }
  /**
   * One frame with every caído (any view, any zoom): `css` = world px per CSS px, for edges that stay ≥ 2 px.
   * `lift`: a depth to draw at instead of the world's (the blackout, VGM-053B: a caído is never hidden by the dark).
   */
  update(marks:readonly DownedMark[],view:number,css:number,lift?:number){
    const g=this.ground.clear(),l=this.light.clear();
    if(!marks.length)return;
    let low=Infinity,high=-Infinity;
    for(const m of marks){
      const ring=ringPoints(m.at,view).map(p=>this.project(p));
      g.lineStyle(5*css,this.colors.breu,.85).strokePoints(ring,false);
      g.lineStyle(2.5*css,this.colors.papel,1).strokePoints(ring,false);
      const done=progressPoints(ring,m.progress);
      if(done.length>1)g.lineStyle(5*css,this.colors.breu,1).strokePoints(done,false).lineStyle(3.5*css,this.colors.cartolina,1).strokePoints(done,false);
      const feet=this.project(m.at),d=this.depth(m.at);low=Math.min(low,d);high=Math.max(high,d);
      // Static column: Papel fading upwards, edged in Breu at the foot so it reads on the light sand too.
      const w=COLUMN.width,h=COLUMN.height;
      l.fillGradientStyle(this.colors.papel,this.colors.papel,this.colors.papel,this.colors.papel,0,0,.5,.5).fillRect(feet.x-w/2,feet.y-h,w,h);
      l.fillStyle(this.colors.breu,.35).fillEllipse(feet.x,feet.y,w*1.6,w*.6);
    }
    // Ground ring under every body; the column in the world's depth order (behind what stands in front of it).
    if(lift!==undefined){g.setDepth(lift);l.setDepth(lift+.5);}else{g.setDepth(low-3);l.setDepth(high+.5);}
  }
  /** Depths now (blackout audit). */
  depths(){return {ring:this.ground.depth,column:this.light.depth};}
  destroy(){this.ground.destroy();this.light.destroy();}
}
