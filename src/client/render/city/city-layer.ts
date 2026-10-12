/**
 * Phaser layer that draws the Cidade Nevada (card cidade-03a): ground per chunk, blocks as cap + 2 walls with
 * screen-side light, props, and translucent buildings over the local hero. Only chunks near the camera exist.
 * Not wired into the scene yet (code freeze): the wiring card calls `update` once per frame after the camera moved.
 * All geometry and decisions live in the pure modules (chunks, faces, occlusion); this file only draws.
 */
import Phaser from 'phaser';
import {heightAt,type CityAsset,type CityProp} from './asset.ts';
import {ChunkTracker,buildChunks,type BlockPiece,type ChunkIndex,type CityChunk} from './chunks.ts';
import {groundQuads,pieceGeometry,type PieceGeometry} from './faces.ts';
import {OcclusionFader,heroRelativeDepth,occluderFor,outlineAlpha,type Occluder} from './occlusion.ts';
import {BLOCK_COLORS,CITY_PALETTE,OUTLINE_PX,PROP_COLORS,SHADOW,groundColor} from './palette.ts';
import {VIEW_PIVOT,depth,normalizeView,project,type Pt,type Rect} from './projection.ts';

/** Approved snowy tree sheet (4 views, 256×384, pivot (128,353)), loaded by the scene as `tree:<id>`. */
export const PINE_TEXTURE='tree:arvore-nevada';
const PINE_SHEET={pivotY:353/384,height:165,pixelHeight:340};
/** Same layer as the island ground bake (src/game/terrain/renderer.ts). */
export const CITY_GROUND_DEPTH=-10000;

export interface CityFrame {
  /** Visible screen rect in projected pixels (camera worldView). */
  camera:Rect;
  view:number;
  /** Local hero feet (world units) or undefined when there is none (spectating). */
  hero?:{x:number;y:number;z:number};
  /** Draw depth the scene gives the local hero, to keep blocks on the correct side of it. */
  heroDepth?:number;
  dtMs:number;
}
export interface CityLayerOptions {
  pivot?:Pt;
  /** Maps a projection depth key to the scene's depth space (e.g. origin rebasing). Identity by default. */
  depthOf?:(key:number)=>number;
}

interface LivePiece {piece:BlockPiece;geo:PieceGeometry;body:Phaser.GameObjects.Graphics;outline:Phaser.GameObjects.Graphics}
interface LiveChunk {chunk:CityChunk;ground:Phaser.GameObjects.Graphics;pieces:LivePiece[];props:(Phaser.GameObjects.Graphics|Phaser.GameObjects.Image)[]}

export class CityLayer {
  readonly asset:CityAsset;
  readonly index:ChunkIndex;
  private readonly scene:Phaser.Scene;
  private readonly tracker:ChunkTracker;
  private readonly pivot:Pt;
  private readonly depthOf:(key:number)=>number;
  private readonly fader=new OcclusionFader();
  private readonly live=new Map<string,LiveChunk>();
  private view=-1;

  constructor(scene:Phaser.Scene,asset:CityAsset,options:CityLayerOptions={}){
    this.scene=scene;this.asset=asset;
    this.pivot=options.pivot??VIEW_PIVOT;
    this.depthOf=options.depthOf??(k=>k);
    this.index=buildChunks(asset);
    this.tracker=new ChunkTracker(this.index,asset,{pivot:this.pivot});
  }

  /** Chunk keys currently drawn (for debugging and tests of the wiring). */
  liveChunks(){return [...this.live.keys()].sort();}

  update(frame:CityFrame){
    const view=normalizeView(frame.view);
    if(view!==this.view){this.view=view;this.fader.reset();}
    const {show,hide}=this.tracker.update(frame.camera,view);
    for(const key of hide)this.dropChunk(key);
    for(const key of show)this.buildChunk(key,view);
    this.applyOcclusion(frame,view);
  }

  destroy(){for(const key of [...this.live.keys()])this.dropChunk(key);}

  // ---------- Building and dropping chunks ----------
  private buildChunk(key:string,view:number){
    const chunk=this.index.chunks.find(c=>c.key===key);
    if(!chunk||this.live.has(key))return;
    const ground=this.scene.add.graphics().setDepth(CITY_GROUND_DEPTH);
    for(const quad of groundQuads(chunk,this.asset,view,this.pivot))
      ground.fillStyle(groundColor(quad.kind,quad.shade),1).fillPoints(quad.points,true);
    const pieces:LivePiece[]=[];
    for(const piece of chunk.pieces){
      const geo=pieceGeometry(piece,this.asset,view,this.pivot);
      const body=this.scene.add.graphics(),outline=this.scene.add.graphics();
      const colors=BLOCK_COLORS[piece.kind];
      for(const face of geo.faces)body.fillStyle(colors[face.kind],1).fillPoints(face.points,true);
      outline.lineStyle(OUTLINE_PX.block,CITY_PALETTE.breu,1);
      for(const line of geo.outline)outline.strokePoints(line,false);
      const d=this.depthOf(geo.depthKey);
      body.setDepth(d);outline.setDepth(d+0.01);
      pieces.push({piece,geo,body,outline});
    }
    const props=chunk.props.map(p=>this.drawProp(p,view));
    this.live.set(key,{chunk,ground,pieces,props});
  }

  private dropChunk(key:string){
    const live=this.live.get(key);
    if(!live)return;
    live.ground.destroy();
    for(const p of live.pieces){p.body.destroy();p.outline.destroy();}
    for(const g of live.props)g.destroy();
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
  private applyOcclusion(frame:CityFrame,view:number){
    const occluders:Occluder[]=[];
    const byBlock=new Map<string,LivePiece[]>();
    for(const live of this.live.values())for(const p of live.pieces){
      const list=byBlock.get(p.piece.blockId);
      if(list)list.push(p);else byBlock.set(p.piece.blockId,[p]);
    }
    for(const block of this.asset.blocks){
      const pieces=byBlock.get(block.id);
      if(!pieces)continue;
      occluders.push(occluderFor(block,this.asset,Math.max(...pieces.map(p=>p.piece.base)),view,this.pivot));
    }
    const alphas=this.fader.update(occluders,frame.hero,view,frame.dtMs,this.pivot);
    for(const occ of occluders){
      const alpha=alphas.get(occ.id)??1;
      for(const p of byBlock.get(occ.id)!){
        p.body.setAlpha(alpha);p.outline.setAlpha(outlineAlpha(alpha));
        if(frame.hero&&frame.heroDepth!==undefined){
          const d=heroRelativeDepth(occ,this.depthOf(p.geo.depthKey),frame.heroDepth,frame.hero.x,frame.hero.y,view,this.pivot);
          p.body.setDepth(d);p.outline.setDepth(d+0.01);
        }
      }
    }
  }
}
