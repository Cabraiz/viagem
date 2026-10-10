/**
 * Allocation-free twin of projection.ts for per-frame rendering of hundreds of entities.
 * Same math as projectView/viewDepth (tests keep them identical); writes into a caller-owned point.
 */
import type {TerrainField} from '../terrain/field.ts';
import {elevation} from '../world.ts';
import {normalizeView} from '../projection.ts';

export interface Pt {x:number;y:number}

export class Projector {
  private turn=0;
  terrain?:TerrainField;
  constructor(view=0,terrain?:TerrainField){this.view=view;this.terrain=terrain;}
  get view(){return this.turn;}
  set view(value:number){this.turn=normalizeView(value);this.rebase();}
  /** Rotated world coordinates around the island center (12,12), written into out. */
  private rotate(x:number,y:number,out:Pt){
    const dx=x-12,dy=y-12;
    switch(this.turn){
      case 1:out.x=12-dy;out.y=12+dx;break;
      case 2:out.x=12-dx;out.y=12-dy;break;
      case 3:out.x=12+dy;out.y=12-dx;break;
      default:out.x=x;out.y=y;
    }
    return out;
  }
  /** Screen position of world point (x,y), written into out and returned. */
  project(x:number,y:number,out:Pt):Pt{
    const q=this.rotate(x,y,out),qx=q.x,qy=q.y;
    out.x=(qx-qy)*42;out.y=(qx+qy)*21-elevation(x,y,this.terrain);
    return out;
  }
  private scratch:Pt={x:0,y:0};
  private base=0;
  private anchor?:Pt;
  /** Depth origin (projection.ts viewDepth): undefined on the island; the endless world re-bases it near the hero. */
  get origin(){return this.anchor;}
  set origin(value:Pt|undefined){this.anchor=value&&{...value};this.rebase();}
  private rebase(){
    if(!this.anchor){this.base=0;return;}
    const o=this.rotate(this.anchor.x,this.anchor.y,{x:0,y:0});this.base=o.x+o.y-24;
  }
  depth(x:number,y:number){const q=this.rotate(x,y,this.scratch);return (q.x+q.y-this.base)*100;}
}
