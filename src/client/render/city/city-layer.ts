/**
 * Phaser layer that draws the Cidade Nevada (card cidade-03a): ground per chunk, blocks as cap + 2 walls with
 * screen-side light, props, and translucent buildings over the local hero. Only chunks near the camera exist.
 * Not wired into the scene yet (code freeze): the wiring card calls `update` once per frame after the camera moved.
 * All geometry and decisions live in the pure modules (chunks, faces, occlusion); this file only draws.
 */
import Phaser from 'phaser';
import {heightAt,type CityAsset,type CityBlock,type CityProp} from './asset.ts';
import {ChunkTracker,RUIN_FLOOR,buildChunks,type BlockPiece,type ChunkIndex,type CityChunk} from './chunks.ts';
import {groundDecor,pieceDecor,shadowUnion,type DecorPrim} from './decor.ts';
import {groundQuads,pieceGeometry,type PieceGeometry} from './faces.ts';
import {OcclusionFader,actorDepth,occluderFor,outlineAlpha,type ColumnRef,type Occluder} from './occlusion.ts';
import {BLOCK_COLORS,CITY_PALETTE,OUTLINE_PX,PROP_COLORS,SHADOW,groundColor} from './palette.ts';
import {VIEW_PIVOT,depth,normalizeView,project,type Pt,type Rect} from './projection.ts';

/** Approved snowy tree sheet (4 views, 256×384, pivot (128,353)), loaded by the scene as `tree:<id>`. */
export const PINE_TEXTURE='tree:arvore-nevada';
const PINE_SHEET={pivotY:353/384,height:165,pixelHeight:340};
/**
 * Ground layer, far below every column/prop/actor key (a 192-cell city spans about ±34 000 in depth keys), so
 * nothing on the ground can sort under it whatever the view or the depthOf mapping. Shadows and glints sit just above.
 */
export const CITY_GROUND_DEPTH=-1e8;
const SHADOW_DEPTH=CITY_GROUND_DEPTH+1,GLINT_DEPTH=CITY_GROUND_DEPTH+2;
/** Fountain glint: a slow breathing alpha (period ~4 s), the only looping animation (art bible §8.7). */
const GLINT_PERIOD_MS=4000;

/** Draws one decor primitive into a Graphics. */
function drawPrim(g:Phaser.GameObjects.Graphics,p:DecorPrim){
  if(p.shape==='circle'&&p.cx!==undefined&&p.cy!==undefined&&p.r!==undefined){g.fillStyle(p.color,p.alpha).fillCircle(p.cx,p.cy,p.r);return;}
  if(!p.points||p.points.length<2)return;
  if(p.shape==='line')g.lineStyle(p.width??1,p.color,p.alpha).strokePoints(p.points,false);
  else g.fillStyle(p.color,p.alpha).fillPoints(p.points,true);
}
/** prefers-reduced-motion, read once (false outside a browser). */
function reducedMotion(){
  try{return typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}catch{return false;}
}

export interface CityFrame {
  /** Visible screen rect in projected pixels (camera worldView). */
  camera:Rect;
  view:number;
  /**
   * Local hero feet (world units) or undefined when there is none (spectating). In city mode the scene draws every
   * actor at `layer.actorDepth(x,y)` (not the island's fixed SELF_DEPTH): exact against the unit columns.
   */
  hero?:{x:number;y:number;z:number};
  dtMs:number;
}
export interface CityLayerOptions {
  /** Must equal the scene's projection pivot (VIEW_PIVOT), or the city drifts away from actors when the view turns. */
  pivot?:Pt;
  /** Maps a projection depth key to the scene's depth space (e.g. origin rebasing; must be increasing). Identity by default. */
  depthOf?:(key:number)=>number;
}

/**
 * Unit columns of one block that share a depth key, drawn as one object pair: they never overlap each other on
 * screen (same qx+qy, side by side), so merging them keeps the exact order while cutting the object count.
 */
interface Band {blockId:string;key:number;body:Phaser.GameObjects.Graphics;outline:Phaser.GameObjects.Graphics}
interface LiveProp {key:number;obj:Phaser.GameObjects.Graphics|Phaser.GameObjects.Image}
interface LiveChunk {chunk:CityChunk;ground:Phaser.GameObjects.Graphics;shadows:Phaser.GameObjects.Graphics;
  glints:Phaser.GameObjects.Graphics;bands:Band[];props:LiveProp[];cells:number[]}
/** Columns looked at around an actor for its depth: the sprite reaches ~2.3 u up, tall blocks ~4 u. */
const ACTOR_REACH_CELLS=5;

export class CityLayer {
  readonly asset:CityAsset;
  readonly index:ChunkIndex;
  private readonly scene:Phaser.Scene;
  private readonly tracker:ChunkTracker;
  private readonly pivot:Pt;
  private depthOf:(key:number)=>number;
  /** Unit columns of the live chunks by cell index, in the current view (for actorDepth). */
  private readonly columns=new Map<number,ColumnRef>();
  private readonly fader=new OcclusionFader();
  private readonly live=new Map<string,LiveChunk>();
  private readonly blocks=new Map<string,CityBlock>();
  private readonly occluders=new Map<string,Occluder>();
  private readonly chunksByKey=new Map<string,CityChunk>();
  private view=-1;
  private clock=0;
  private readonly still=reducedMotion();

  constructor(scene:Phaser.Scene,asset:CityAsset,options:CityLayerOptions={}){
    this.scene=scene;this.asset=asset;
    this.pivot=options.pivot??VIEW_PIVOT;
    this.depthOf=options.depthOf??(k=>k);
    this.index=buildChunks(asset);
    this.tracker=new ChunkTracker(this.index,asset,{pivot:this.pivot});
    for(const b of asset.blocks)this.blocks.set(b.id,b);
    for(const c of this.index.chunks)this.chunksByKey.set(c.key,c);
  }

  /** Chunk keys currently drawn (for debugging and tests of the wiring). */
  liveChunks(){return [...this.live.keys()].sort();}

  /**
   * Draw depth for an actor (hero, enemy, pickup) standing at world (x, y, z): its world depth, nudged above or
   * below the nearby columns it overlaps on screen so walls never cover it wrongly (occlusion.ts actorDepth).
   */
  actorDepth(x:number,y:number,z=0):number{
    const {cell,origin,width}=this.asset,cx=Math.floor((x-origin.x)/cell),cy=Math.floor((y-origin.y)/cell),near:ColumnRef[]=[];
    for(let j=cy-ACTOR_REACH_CELLS;j<=cy+ACTOR_REACH_CELLS;j++)for(let i=cx-ACTOR_REACH_CELLS;i<=cx+ACTOR_REACH_CELLS;i++){
      if(i<0||j<0||i>=width)continue;
      const c=this.columns.get(j*width+i);if(c)near.push(c);
    }
    return this.depthOf(actorDepth(x,y,z,Math.max(0,this.view),near,this.pivot));
  }

  /** Changes the depth mapping (e.g. the scene rebased its depth origin) and re-applies it to everything live. */
  setDepthOf(depthOf:(key:number)=>number){
    this.depthOf=depthOf;
    for(const live of this.live.values()){
      for(const b of live.bands){const d=depthOf(b.key);b.body.setDepth(d);b.outline.setDepth(d+0.01);}
      for(const p of live.props)p.obj.setDepth(depthOf(p.key));
    }
  }

  update(frame:CityFrame){
    const view=normalizeView(frame.view);
    if(view!==this.view){this.view=view;this.fader.reset();}
    const {show,hide}=this.tracker.update(frame.camera,view);
    for(const key of hide)this.dropChunk(key);
    for(const key of show)this.buildChunk(key,view);
    this.applyOcclusion(frame,view);
    if(!this.still&&Number.isFinite(frame.dtMs)&&frame.dtMs>0){
      this.clock=(this.clock+frame.dtMs)%GLINT_PERIOD_MS;
      const alpha=0.55+0.45*Math.sin(this.clock/GLINT_PERIOD_MS*Math.PI*2);
      for(const live of this.live.values())live.glints.setAlpha(alpha);
    }
  }

  /** Drops every chunk; the layer can be updated again afterwards (it starts from an empty screen). */
  destroy(){for(const key of [...this.live.keys()])this.dropChunk(key);this.tracker.reset();this.fader.reset();this.view=-1;}

  // ---------- Building and dropping chunks ----------
  private buildChunk(key:string,view:number){
    const chunk=this.chunksByKey.get(key);
    if(!chunk||this.live.has(key))return;
    const ground=this.scene.add.graphics().setDepth(CITY_GROUND_DEPTH);
    for(const quad of groundQuads(chunk,this.asset,view,this.pivot))
      ground.fillStyle(groundColor(quad.kind,quad.shade),1).fillPoints(quad.points,true);
    // Ground details (specks, tracks, joints, water rim); shimmering glints go to their own object.
    const glints=this.scene.add.graphics().setDepth(GLINT_DEPTH);
    for(const prim of groundDecor(chunk,this.asset,view,this.pivot))drawPrim(prim.shimmer?glints:ground,prim);
    // Shadows of this chunk's and its neighbours' columns that land here, as one disjoint union (no stacking).
    const shadows=this.scene.add.graphics().setDepth(SHADOW_DEPTH),casters:BlockPiece[]=[];
    for(let j=chunk.cy-1;j<=chunk.cy+1;j++)for(let i=chunk.cx-1;i<=chunk.cx+1;i++)casters.push(...(this.index.get(i,j)?.pieces??[]));
    for(const prim of shadowUnion(casters,this.asset,{x0:chunk.x0,y0:chunk.y0,x1:chunk.x1,y1:chunk.y1},view,this.pivot))drawPrim(shadows,prim);
    // Group the chunk's columns by (block, depth key); draw each band back-to-front.
    const groups=new Map<string,{blockId:string;key:number;items:{piece:BlockPiece;geo:PieceGeometry}[]}>();
    for(const piece of chunk.pieces){
      const geo=pieceGeometry(piece,this.asset,view,this.pivot),id=`${piece.blockId}|${geo.depthKey}`;
      const g=groups.get(id);
      if(g)g.items.push({piece,geo});else groups.set(id,{blockId:piece.blockId,key:geo.depthKey,items:[{piece,geo}]});
    }
    const bands:Band[]=[];
    for(const g of groups.values()){
      const body=this.scene.add.graphics(),outline=this.scene.add.graphics();
      outline.lineStyle(OUTLINE_PX.block,CITY_PALETTE.breu,1);
      for(const {piece,geo} of g.items){
        const colors=BLOCK_COLORS[piece.kind];
        for(const face of geo.faces)body.fillStyle(colors[face.kind],1).fillPoints(face.points,true);
        // Icing, windows, plaster and icicles fade with the block (same object).
        for(const prim of pieceDecor(piece,this.asset,view,this.pivot))drawPrim(body,prim);
        outline.lineStyle(OUTLINE_PX.block,CITY_PALETTE.breu,1);
        for(const line of geo.outline)outline.strokePoints(line,false);
      }
      const d=this.depthOf(g.key);
      body.setDepth(d);outline.setDepth(d+0.01);
      bands.push({blockId:g.blockId,key:g.key,body,outline});
    }
    const props=chunk.props.map(p=>({key:depth(p.x,p.y,view,this.pivot),obj:this.drawProp(p,view)}));
    // Column cache for actorDepth: each unit column's key and occluder in this view.
    const cells:number[]=[];
    for(const g of groups.values())for(const {piece,geo} of g.items){
      const cellIndex=piece.y*this.asset.width+piece.x;
      // A column lowered by a whole-cell bite only reaches the bite floor.
      const top=(piece.bite??0)>=1?piece.height*RUIN_FLOOR:piece.height;
      const unit:CityBlock={id:piece.id,kind:piece.kind,x:piece.x,y:piece.y,w:1,h:1,height:top};
      this.columns.set(cellIndex,{key:geo.depthKey,occ:occluderFor(unit,this.asset,piece.base,view,this.pivot)});
      cells.push(cellIndex);
    }
    this.live.set(key,{chunk,ground,shadows,glints,bands,props,cells});
  }

  private dropChunk(key:string){
    const live=this.live.get(key);
    if(!live)return;
    live.ground.destroy();live.shadows.destroy();live.glints.destroy();
    for(const b of live.bands){b.body.destroy();b.outline.destroy();}
    for(const p of live.props)p.obj.destroy();
    for(const c of live.cells)this.columns.delete(c);
    this.live.delete(key);
  }

  /**
   * Props: pines use the approved `arvore-nevada` sheet (frame = view) when the scene has loaded it; the rest are
   * small procedural shapes with a contact shadow and a 2 px Breu outline.
   */
  private drawProp(prop:CityProp,view:number):Phaser.GameObjects.Graphics|Phaser.GameObjects.Image{
    const {cx,cy}={cx:Math.floor((prop.x-this.asset.origin.x)/this.asset.cell),cy:Math.floor((prop.y-this.asset.origin.y)/this.asset.cell)};
    const z=heightAt(this.asset,cx,cy);
    const at=project(prop.x,prop.y,z,view,this.pivot);
    const order=this.depthOf(depth(prop.x,prop.y,view,this.pivot));
    if(prop.kind==='pine'&&this.scene.textures.exists(PINE_TEXTURE))
      return this.scene.add.image(at.x,at.y,PINE_TEXTURE,view).setOrigin(.5,PINE_SHEET.pivotY)
        .setScale(PINE_SHEET.height/PINE_SHEET.pixelHeight).setDepth(order);
    const c=PROP_COLORS[prop.kind],r=prop.r*42,g=this.scene.add.graphics({x:at.x,y:at.y});
    g.fillStyle(SHADOW.color,SHADOW.alpha).fillEllipse(0,0,r*2.2,r*1.1);
    g.lineStyle(OUTLINE_PX.prop,CITY_PALETTE.breu,1);
    switch(prop.kind){
      case 'pine':
        g.fillStyle(c.dark,1).fillTriangle(-r,-r*0.6,r,-r*0.6,0,-r*3.2).strokeTriangle(-r,-r*0.6,r,-r*0.6,0,-r*3.2);
        g.fillStyle(c.accent,1).fillTriangle(-r*0.45,-r*2.2,r*0.45,-r*2.2,0,-r*3.2);break;
      case 'lamp':
        g.fillStyle(c.dark,1).fillRect(-2,-r*14,4,r*14).strokeRect(-2,-r*14,4,r*14);
        g.fillStyle(c.accent,1).fillCircle(0,-r*14,r*3).strokeCircle(0,-r*14,r*3);break;
      case 'car':
        g.fillStyle(c.dark,1).fillRoundedRect(-r*1.4,-r*1.2,r*2.8,r*1.2,6).strokeRoundedRect(-r*1.4,-r*1.2,r*2.8,r*1.2,6);
        g.fillStyle(c.light,1).fillRoundedRect(-r*0.8,-r*1.9,r*1.6,r*0.8,5).strokeRoundedRect(-r*0.8,-r*1.9,r*1.6,r*0.8,5);
        g.fillStyle(c.accent,1).fillRoundedRect(-r*0.7,-r*2.05,r*1.4,r*0.25,3);break;
      case 'barrel':
        g.fillStyle(c.light,1).fillRect(-r,-r*2.2,r*2,r*2.2).strokeRect(-r,-r*2.2,r*2,r*2.2);
        g.fillStyle(c.accent,1).fillEllipse(0,-r*2.2,r*2,r*0.8);break;
      default:
        g.fillStyle(c.light,1).fillRect(-r,-r*1.6,r*2,r*1.6).strokeRect(-r,-r*1.6,r*2,r*1.6);
        g.fillStyle(c.accent,1).fillRect(-r,-r*1.8,r*2,r*0.35);
    }
    return g.setDepth(order);
  }

  // ---------- Occlusion ----------
  /** Buildings over the local hero fade as a whole block (all its bands, every live chunk). */
  private applyOcclusion(frame:CityFrame,view:number){
    const bands=new Map<string,Band[]>(),bases=new Map<string,number>();
    for(const live of this.live.values()){
      for(const b of live.bands){const list=bands.get(b.blockId);if(list)list.push(b);else bands.set(b.blockId,[b]);}
      for(const p of live.chunk.pieces)if(!bases.has(p.blockId))bases.set(p.blockId,p.base);
    }
    const occluders:Occluder[]=[];
    for(const id of [...bands.keys()].sort()){
      const block=this.blocks.get(id);
      if(block&&block.kind==='building')occluders.push(this.occluder(block,bases.get(id)??0,view));
    }
    const alphas=this.fader.update(occluders,frame.hero,view,frame.dtMs,this.pivot);
    for(const [id,list] of bands){
      const alpha=alphas.get(id)??1;
      for(const b of list){b.body.setAlpha(alpha);b.outline.setAlpha(outlineAlpha(alpha));}
    }
  }

  /** Occluder per (block, view), cached: blocks never move. */
  private occluder(block:CityBlock,base:number,view:number):Occluder{
    const key=`${block.id}|${view}`;
    let occ=this.occluders.get(key);
    if(!occ){occ=occluderFor(block,this.asset,base,view,this.pivot);this.occluders.set(key,occ);}
    return occ;
  }
}
