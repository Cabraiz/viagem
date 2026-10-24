/**
 * Allocation-free twin of projection.ts for per-frame rendering of hundreds of entities.
 * Same math as projectView/viewDepth (tests keep them identical); writes into a caller-owned point.
 */
import type {TerrainField} from '../../maps/index.ts';
import {elevation} from '../../maps/index.ts';
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
  /**
   * City mode (card cidade-03): actors draw at the city layer's actor depth, placed exactly against the unit columns
   * of the buildings (render/city occlusion.ts actorDepth), instead of the plain ground depth. Unset elsewhere.
   */
  depthOverride?:(x:number,y:number)=>number;
  /**
   * The viaducts (render/city/viaduct.ts, city only): a body of floor 1 is lifted by the deck under it (px) and drawn
   * just above the deck strip it stands on. Unset elsewhere: projectOn/depthOn are project/depth.
   */
  deck?:{bodyLift(x:number,y:number,floor:number|undefined):number;bodyDepth(x:number,y:number):number|undefined};
  /** project() for a body on floor `floor` (andar): lifted onto a viaduct's deck when it is on one. */
  projectOn(x:number,y:number,floor:number|undefined,out:Pt):Pt{
    this.project(x,y,out);
    if(floor===1&&this.deck)out.y-=this.deck.bodyLift(x,y,1);
    return out;
  }
  /** depth() for a body on floor `floor`: above its deck strip on floor 1. */
  depthOn(x:number,y:number,floor:number|undefined){
    return (floor===1?this.deck?.bodyDepth(x,y):undefined)??this.depth(x,y);
  }
  depth(x:number,y:number){
    if(this.depthOverride)return this.depthOverride(x,y);
    const q=this.rotate(x,y,this.scratch);return (q.x+q.y-this.base)*100;
  }
}
