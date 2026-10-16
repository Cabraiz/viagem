/**
 * Phaser layer that draws the Cidade Nevada (cards cidade-03a/03): ground per chunk, blocks as cap + 2 walls with
 * screen-side light, props, and see-through pieces over the local hero and its allies. Only chunks near the camera exist.
 * The scene calls `update` once per frame after the camera moved.
 * Static ground (cells, ground decor, cast shadows) is baked once per chunk into one RenderTexture: Phaser re-tessellates
 * every Graphics every frame. What must stay a separate object (blocks, sorted per band against actors and faded
 * per group; breathing glints; procedural props) is a TriBand (tri-band.ts): drawn once with the Graphics API, frozen
 * into Phaser's own triangles, and per frame only transformed and skipped when off camera — the same pixels.
 * Materials (materials.ts) swap in painted art when its textures are loaded, and fall back to the procedural look.
 * All geometry and decisions live in the pure modules (chunks, faces, occlusion, materials); this file only draws.
 */
import Phaser from 'phaser';
import {cellOf,groundAt,groundZ,heightAt,type CityAsset,type CityBlock,type CityProp,type GroundKind} from './asset.ts';
import {ChunkTracker,RUIN_FLOOR,buildChunks,type BlockPiece,type ChunkIndex,type CityChunk,propDrawRadius,propExtentPx} from './chunks.ts';
import {GLINT,groundDecor,pieceDecor,shadowUnion,type DecorPrim,type PieceLook,type ShadowLook} from './decor.ts';
import {BUILDING_TINT,LIT_SHADOW,SHADOW_PER_HEIGHT,lightEnabled} from '../light.ts';

/**
 * Lighting card (render/light.ts): with the light on, cast shadows as long as the sun says (×0.75: the city's blocks are
 * tall; the sun is ~40° up) at its opacity, and building art tinted warm on the sun side, cold on the shade side.
 */
const LIGHT=lightEnabled();
const CAST_SHADOW:ShadowLook|undefined=LIGHT?Object.freeze({length:SHADOW_PER_HEIGHT*.75,color:LIT_SHADOW.color,alpha:LIT_SHADOW.alpha}):undefined;
const sunTint=(img:Phaser.GameObjects.Image)=>LIGHT?img.setTint(BUILDING_TINT.topLeft,BUILDING_TINT.topRight,BUILDING_TINT.bottomLeft,BUILDING_TINT.bottomRight):img;
import {groundQuads,pieceGeometry,type GroundQuad,type PieceGeometry} from './faces.ts';
import {CityMaterials,buildingAnchor,buildingFrame,cellUvPatches,frameUv,frontCorner,groundShadeOverlay,propAnchor,propFrame,type TextureLookup} from './materials.ts';
import {ART_CELL,blockArt,fountainLot,lotCells,moundPiece,planHasArt,planHasBuildingArt,propSheet,type CityArtPlan,type CityLot} from './art-plan.ts';
import {CoverFader,HERO_SCREEN,actorDepth,coveringColumns,occluderFor,outlineAlpha,propCovers,type ColumnRef,type Figure} from './occlusion.ts';
import {borderFog,drawFogRing} from './border-fog.ts';
import {BLOCK_COLORS,CITY_PALETTE,OUTLINE_PX,PROP_COLORS,SHADOW,groundColor} from './palette.ts';
import {VIEW_PIVOT,boundsOf,depth,normalizeView,project,type Pt,type Rect} from './projection.ts';
import {TriBand} from './tri-band.ts';
import {CityRelief,reliefEnabled} from './relevo/baker.ts';
import {cliffCells,withoutCliffs} from './relevo/field.ts';
import {artIndex} from '../../art/manifest.ts';
import {decorCentre,decorChunk,decorFade,decorSprite} from './decor-art.ts';
import {CityLive,decalMeshes,type LivePiece} from './live/layer.ts';
import {livePieces} from './live/art.ts';
import {decorKey,isDecal,type DecorEntry} from './live/rules.ts';
export {decorSprite} from './decor-art.ts';

/** Approved snowy tree sheet (4 views, 256×384, pivot (128,353)), loaded by the scene as `tree:<id>`. */
export const PINE_TEXTURE='tree:arvore-nevada';
const PINE_SHEET={pivotY:353/384,height:165,pixelHeight:340};
/**
 * Ground layer, far below every column/prop/actor key (a 192-cell city spans about ±34 000 in depth keys), so
 * nothing on the ground can sort under it whatever the view or the depthOf mapping. Glints sit just above.
 */
export const CITY_GROUND_DEPTH=-1e8;
const GLINT_DEPTH=CITY_GROUND_DEPTH+2;
/** Fog beyond the map edge: under the ground (the baked ground overlaps its inner edge). */
const FOG_DEPTH=CITY_GROUND_DEPTH-1;
/** Fountain glint: a slow breathing alpha (period ~4 s), the only looping animation (art bible §8.7). */
const GLINT_PERIOD_MS=4000;
/** Baked ground: texels per world px (shown scaled back up), and the largest texture side allowed. */
export const GROUND_RESOLUTION=0.75;
export const GROUND_RT_MAX_PX=2048;

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
const lerp=(a:Pt,b:Pt,t:number):Pt=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
/** The cell a lot is drawn from (its sheet belongs to the chunk holding this cell). */
const lotCentre=(lot:CityLot):[number,number]=>[lot.x+Math.floor((lot.w-1)/2),lot.y+Math.floor((lot.h-1)/2)];
/** Fade id of one unit column (a piece of a block): only the columns in front of a figure turn see-through. */
const columnFade=(pieceId:string)=>`c:${pieceId}`;

export interface CityFrame {
  /** Visible screen rect in projected pixels (camera worldView). */
  camera:Rect;
  view:number;
  /**
   * Local hero feet (world units) or undefined when there is none (spectating). In city mode the scene draws every
   * actor at `layer.actorDepth(x,y)` (not the island's fixed SELF_DEPTH): exact against the unit columns.
   */
  hero?:Figure;
  /** Allies' feet (world units, z their ground height): pieces in front of them turn see-through too. */
  allies?:readonly Figure[];
  dtMs:number;
}
export interface CityLayerOptions {
  /** Must equal the scene's projection pivot (VIEW_PIVOT), or the city drifts away from actors when the view turns. */
  pivot?:Pt;
  /** Maps a projection depth key to the scene's depth space (e.g. origin rebasing; must be increasing). Identity by default. */
  depthOf?:(key:number)=>number;
  /** Baked ground texels per world px (default GROUND_RESOLUTION); lower saves memory, higher is sharper when zoomed in. */
  groundResolution?:number;
  /**
   * Imported art (art-plan.ts): buildings and rubble cut into lots that each show a sheet, prop and fountain sheets.
   * A lot draws its sheet once the texture is loaded (queueCityArt); until then, and on the building cells no lot
   * covers (art-plan.ts fillLots), the cell is a low mound (moundPiece), never the procedural building.
   */
  art?:CityArtPlan;
}

/** Queues the plan's sheets not loaded yet (the caller starts the loader if it is idle). Returns how many. */
export function queueCityArt(scene:Phaser.Scene,plan:CityArtPlan|undefined):number{
  let n=0;
  for(const s of plan?.sheets??[]){
    if(scene.textures.exists(s.key))continue;
    if(s.key.startsWith('city:ground:'))scene.load.image(s.key,s.url);
    else scene.load.spritesheet(s.key,s.url,{frameWidth:s.frameWidth,frameHeight:s.frameHeight});
    n++;
  }
  return n;
}

/**
 * Unit columns of one block that share a depth key, drawn as one object pair: they never overlap each other on
 * screen (same qx+qy, side by side), so merging them keeps the exact order while cutting the object count.
 */
interface Band {blockId:string;key:number;body:TriBand;outline:TriBand;
  /** Fade id of each unit column, in part order. */
  ids:string[]}
/** A building drawn as one painted image (materials.ts building sheet) or a lot of imported art. */
interface BlockSprite {blockId:string;key:number;fade:string;obj:Phaser.GameObjects.Image}
/** A prop; `rect` is its drawn screen bounds (projected px) for the see-through test. */
interface LiveProp {key:number;fade:string;x:number;y:number;rect:Rect;obj:Phaser.GameObjects.Graphics|Phaser.GameObjects.Image}
/** One unit column of a band: its part index in the band's body and outline (TriBand.setPartAlpha). */
interface BandPart {band:Band;index:number}
/** Drawn objects of one fade id: one unit column, one painted building or art lot, or one prop. */
interface FadeObjects {parts:BandPart[];sprites:BlockSprite[];props:LiveProp[]}
interface LiveChunk {chunk:CityChunk;ground:Phaser.GameObjects.RenderTexture;glints:Phaser.GameObjects.Graphics;
  bands:Band[];sprites:BlockSprite[];props:LiveProp[];cells:number[];
  /** Decor pieces drawn by this chunk (decorKey), attached to the live layer. */
  decor:string[]}
/** Columns looked at around an actor for its depth: the sprite reaches ~2.3 u up, tall blocks ~4 u. */
const ACTOR_REACH_CELLS=5;

export class CityLayer {
  readonly asset:CityAsset;
  readonly index:ChunkIndex;
  readonly materials:CityMaterials;
  private readonly scene:Phaser.Scene;
  private readonly tracker:ChunkTracker;
  private readonly pivot:Pt;
  private readonly groundResolution:number;
  private depthOf:(key:number)=>number;
  /** Unit columns of the live chunks by cell index, in the current view (for actorDepth). */
  private readonly columns=new Map<number,ColumnRef>();
  /**
   * actorDepth runs per actor per frame: the columns an actor standing in a cell could overlap on screen depend only
   * on the cell, so they are gathered once per cell and cached until chunks change or the view turns.
   */
  private readonly cellColumns=new Map<number,ColumnRef[]>();
  /** Moves whenever the live columns change (a chunk built or dropped), so actorDepth answers may differ: other
   *  layers that cache an actor depth (the defenses, render/towers) re-sort when it moves. */
  columnsVersion=0;
  private query=0;
  private readonly fader=new CoverFader();
  /** Drawn objects by fade id, kept in step with the live chunks; the ids faded last frame. */
  private readonly fadeObjects=new Map<string,FadeObjects>();
  private readonly faded=new Set<string>();
  private readonly covered=new Set<string>();
  private readonly live=new Map<string,LiveChunk>();
  private readonly blocks=new Map<string,CityBlock>();
  /** Snow and Breu fog beyond the map edge (border-fog.ts), rebuilt per view. */
  private fog?:Phaser.GameObjects.Graphics;
  private readonly chunksByKey=new Map<string,CityChunk>();
  private view=-1;
  private clock=0;
  /** Imported art: the plan, each cell's lot, the fountain lot. */
  private readonly art?:CityArtPlan;
  private readonly lotAt=new Map<number,CityLot>();
  private readonly fountain?:CityLot;
  /** Building cells without art shown are low mounds (moundOf): only when the plan has building art at all. */
  private readonly mounds:boolean=false;
  private readonly still=reducedMotion();
  /** Relief ground (relevo/): the chunk ground is the baked relief shader instead of flat or painted quads. */
  private readonly relief?:CityRelief;
  /** Cells under a cliff block when the relief draws them (no snow specks on their rock). */
  private readonly cliffs?:Uint8Array;
  /** Piece decor look: snowy stone walls with the relief ground (muros-texturizados); `?relevo=0` keeps the plain walls. */
  private readonly pieceLook:PieceLook={};
  /**
   * The new scenery (asset `decor`, cenario-no-mapa) with a sheet in the plan: by drawing chunk (decorChunk), and the
   * standing pieces ('footprint' and 'wall') by cell, which hide the procedural piece of their cells once drawn.
   */
  private readonly decorOf=new Map<string,DecorEntry[]>();
  private readonly decorAt=new Map<number,DecorEntry>();
  /** Ground decals by chunk (every chunk whose baked ring they touch). */
  private readonly decalsOf=new Map<string,DecorEntry[]>();
  /** Cenário vivo (E3, live/layer.ts): overlays, wires, lights and nests over the decor; none without decor. */
  readonly vivo?:CityLive;
  private readonly livePiece:(id:string)=>LivePiece|undefined;
  private readonly webgl:boolean;

  constructor(scene:Phaser.Scene,asset:CityAsset,options:CityLayerOptions={}){
    this.scene=scene;this.asset=asset;
    this.pivot=options.pivot??VIEW_PIVOT;
    this.depthOf=options.depthOf??(k=>k);
    const res=options.groundResolution;
    this.groundResolution=res!==undefined&&Number.isFinite(res)&&res>0?Math.min(res,4):GROUND_RESOLUTION;
    // With the relief shader the WC3 cliff lines are rock slopes painted on the ground (relevo/shader.ts), not boxes:
    // they get no pieces, columns, fades or ground decor (cidade-caixas-de-cliff). The flat ground (?relevo=0, Canvas)
    // keeps them.
    const relief=reliefEnabled(scene);
    const drawn=relief?withoutCliffs(asset):asset;
    if(relief){this.cliffs=cliffCells(asset);this.pieceLook={stoneWalls:true};}
    this.index=buildChunks(drawn);
    this.tracker=new ChunkTracker(this.index,drawn,{pivot:this.pivot});
    for(const b of drawn.blocks)this.blocks.set(b.id,b);
    for(const c of this.index.chunks)this.chunksByKey.set(c.key,c);
    if(planHasArt(options.art)){
      const art=this.art=options.art!;
      this.mounds=planHasBuildingArt(art);
      // The fountain first: its cells are reserved, so no fill lot or mound lands on its basin.
      this.fountain=fountainLot(asset,art);
      const underFountain=lotCells(this.fountain);
      for(const b of drawn.blocks)for(const lot of blockArt(b,art,underFountain).lots){
        for(let j=lot.y;j<lot.y+lot.h;j++)for(let i=lot.x;i<lot.x+lot.w;i++)this.lotAt.set(j*asset.width+i,lot);
      }
      // Art can be taller than the procedural box: chunk bounds (ChunkTracker) reach the drawn top.
      for(const c of this.index.chunks){
        for(const p of c.pieces){const lot=this.lotAt.get(p.y*asset.width+p.x);if(lot)c.maxTop=Math.max(c.maxTop,p.base+lot.height);}
        for(const p of c.props){const s=propSheet(p,art);if(s)c.maxTop=Math.max(c.maxTop,c.minBase+s.height);}
      }
      const f=this.fountain,c=f&&this.chunkOfCell(...lotCentre(f));
      if(f&&c)c.maxTop=Math.max(c.maxTop,c.minBase+f.height);
    }
    this.livePiece=livePieces(artIndex());
    const decor=asset.decor??[];
    this.placeDecor(decor);
    if(decor.length)this.vivo=new CityLive(scene,decor,{piece:this.livePiece,groundDepth:CITY_GROUND_DEPTH+3});
    const textures=scene.textures;
    // Painted ground is drawn with a Mesh, which only renders in WebGL: under Canvas the ground stays flat.
    const webgl=this.webgl=scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
    const lookup:TextureLookup={
      has:key=>(webgl||!key.startsWith('city:ground:'))&&textures.exists(key),
      frames:key=>Math.max(1,textures.get(key).frameTotal-1),
    };
    this.materials=new CityMaterials(lookup);
    if(relief){
      this.relief=new CityRelief(scene,asset,this.pivot);
      // The ground albedo arrived (relevo/baker.ts): the live chunks bake again with it.
      this.relief.onAlbedo=()=>this.refresh();
    }
  }

  /**
   * Sorts the decor out (constructor): decals to the chunks whose baked ground they touch; the rest, when the plan has
   * its sheet, to its drawing chunk, the standing ones by cell. A building lot touching a standing decor gives way (the
   * decor replaces the procedural lots of its cells); chunk bounds reach the decor's drawn top.
   */
  private placeDecor(decor:readonly DecorEntry[]){
    const {width}=this.asset,size=this.index.size,push=(m:Map<string,DecorEntry[]>,k:string,e:DecorEntry)=>{const l=m.get(k);if(l)l.push(e);else m.set(k,[e]);};
    for(const e of decor){
      if(isDecal(e.id)){
        // The ring of one neighbour cell (bakeGround) reaches into the next chunk: a decal on the edge is baked by both.
        const i0=Math.floor((e.c-1)/size),i1=Math.floor((e.c+e.w)/size),j0=Math.floor((e.r-1)/size),j1=Math.floor((e.r+e.h)/size);
        for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)if(this.index.get(i,j))push(this.decalsOf,`${i},${j}`,e);
        continue;
      }
      const sheet=this.art?.decor[e.id];
      if(!sheet)continue;
      const key=decorChunk(e,size);
      push(this.decorOf,key,e);
      const c=this.chunksByKey.get(key);
      if(c)c.maxTop=Math.max(c.maxTop,c.minBase+sheet.height);
      if(sheet.rule!=='prop')for(let j=e.r;j<e.r+e.h;j++)for(let i=e.c;i<e.c+e.w;i++)this.decorAt.set(j*width+i,e);
    }
    if(!this.decorAt.size)return;
    for(const lot of new Set(this.lotAt.values())){
      const cells:number[]=[];
      for(let j=lot.y;j<lot.y+lot.h;j++)for(let i=lot.x;i<lot.x+lot.w;i++)cells.push(j*width+i);
      if(cells.some(i=>this.decorAt.has(i)))for(const i of cells)if(this.lotAt.get(i)===lot)this.lotAt.delete(i);
    }
  }
  /** A cell under a standing decor whose sheet is loaded: the decor draws it, not the procedural piece. */
  private underDecor(cellIndex:number){
    const e=this.decorAt.get(cellIndex),s=e&&this.art?.decor[e.id];
    return !!s&&this.scene.textures.exists(s.key);
  }

  private chunkOfCell(cx:number,cy:number):CityChunk|undefined{return this.index.chunks.find(c=>cx>=c.x0&&cx<c.x1&&cy>=c.y0&&cy<c.y1);}

  /** Economy mode (scene.setEconomy): the relief bakes with fewer shadow taps; live chunks are rebuilt to match. */
  setEconomy(on:boolean){if(this.relief?.setEconomy(on))this.refresh();}

  /** The ground drawn is final (no albedo still on its way): the modo foto waits for it. */
  groundSettled(){return !this.relief||this.relief.albedoSettled;}
  /** Relief bake numbers (relevo/baker.ts), undefined on the flat ground. */
  reliefStats(){return this.relief?{...this.relief.stats}:undefined;}

  /** Chunk keys currently drawn (for debugging and tests of the wiring). */
  liveChunks(){return [...this.live.keys()].sort();}

  /**
   * Draw depth for an actor (hero, enemy, pickup) standing at world (x, y, z): its world depth, nudged above or
   * below the nearby columns it overlaps on screen so walls never cover it wrongly (occlusion.ts actorDepth).
   */
  actorDepth(x:number,y:number,z=groundZ(this.asset,x,y)):number{
    const {cell,origin,width,height}=this.asset,cx=Math.floor((x-origin.x)/cell),cy=Math.floor((y-origin.y)/cell);
    const view=Math.max(0,this.view);
    if(cx<0||cy<0||cx>=width||cy>=height||!this.columns.size)return this.depthOf(depth(x,y,view,this.pivot));
    return this.depthOf(actorDepth(x,y,z,view,this.nearColumns(cx,cy,view),this.pivot,this.actorBox));
  }
  /**
   * Draw depth for an effect in the air over (x, y) (a defense's shot, blast or light): actorDepth, except that over a
   * building's footprint it stays below the building (inside counts as behind), so a shot from a defense hidden behind
   * a block is covered until it has crossed it.
   */
  effectDepth(x:number,y:number,z=groundZ(this.asset,x,y)):number{
    const {cell,origin,width,height}=this.asset,cx=Math.floor((x-origin.x)/cell),cy=Math.floor((y-origin.y)/cell);
    const view=Math.max(0,this.view);
    if(cx<0||cy<0||cx>=width||cy>=height||!this.columns.size)return this.depthOf(depth(x,y,view,this.pivot));
    return this.depthOf(actorDepth(x,y,z,view,this.nearColumns(cx,cy,view),this.pivot,this.actorBox,true));
  }
  /** The columns an actor standing in cell (cx, cy) could overlap on screen (cached per cell). */
  private nearColumns(cx:number,cy:number,view:number):ColumnRef[]{
    const index=cy*this.asset.width+cx;
    let near=this.cellColumns.get(index);
    if(!near){near=this.gatherColumns(cx,cy,view);this.cellColumns.set(index,near);}
    return near;
  }

  /**
   * Screen box of a standing figure (the scene's hero sprite): HERO_SCREEN at the endless map's size, times the figure
   * scale the scene draws with in the city (framing.ts CITY_VIEW_SCALE, cidade-04). Used by actorDepth and the fade.
   */
  private actorBox:{w:number;h:number}={...HERO_SCREEN};
  setActorScale(k:number){
    if(!(k>0))return;
    this.actorBox={w:HERO_SCREEN.w*k,h:HERO_SCREEN.h*k};
    this.cellColumns.clear();
  }

  /**
   * Columns within reach of a cell whose screen bounds can meet the box of an actor standing anywhere in it: the cell's
   * corners projected at their ground heights, widened by the actor box (HERO_SCREEN) and a margin. Each column once.
   */
  private gatherColumns(cx:number,cy:number,view:number):ColumnRef[]{
    const {cell,origin,width,height}=this.asset,out:ColumnRef[]=[],stamp=++this.query;
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const [i,j] of [[0,0],[1,0],[1,1],[0,1]]){
      const wx=origin.x+(cx+i)*cell,wy=origin.y+(cy+j)*cell,p=project(wx,wy,groundZ(this.asset,wx,wy),view,this.pivot);
      x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);
    }
    const m=4,box=this.actorBox;x0-=box.w/2+m;x1+=box.w/2+m;y0-=box.h+m;y1+=m;
    const i0=Math.max(0,cx-ACTOR_REACH_CELLS),i1=Math.min(width-1,cx+ACTOR_REACH_CELLS);
    const j0=Math.max(0,cy-ACTOR_REACH_CELLS),j1=Math.min(height-1,cy+ACTOR_REACH_CELLS);
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const c=this.columns.get(j*width+i);
      // A painted building registers one column on all its cells: count it once.
      if(!c||c.mark===stamp)continue;
      c.mark=stamp;
      const b=c.occ.box;
      if(b.x1<=x0||x1<=b.x0||b.y1<=y0||y1<=b.y0)continue;
      out.push(c);
    }
    return out;
  }

  /** Changes the depth mapping (e.g. the scene rebased its depth origin) and re-applies it to everything live. */
  setDepthOf(depthOf:(key:number)=>number){
    this.depthOf=depthOf;
    for(const live of this.live.values()){
      for(const b of live.bands){const d=depthOf(b.key);b.body.setDepth(d);b.outline.setDepth(d+0.01);}
      for(const s of live.sprites)s.obj.setDepth(depthOf(s.key));
      for(const p of live.props)p.obj.setDepth(depthOf(p.key));
    }
  }

  update(frame:CityFrame){
    const view=normalizeView(frame.view);
    if(view!==this.view){this.view=view;this.fader.reset();this.faded.clear();this.cellColumns.clear();this.drawFog(view);}
    const {show,hide}=this.tracker.update(frame.camera,view);
    for(const key of hide)this.dropChunk(key);
    for(const key of show)this.buildChunk(key,view);
    this.applyOcclusion(frame,view);
    this.vivo?.update(frame.camera,performance.now());
    if(!this.still&&Number.isFinite(frame.dtMs)&&frame.dtMs>0){
      this.clock=(this.clock+frame.dtMs)%GLINT_PERIOD_MS;
      const alpha=0.55+0.45*Math.sin(this.clock/GLINT_PERIOD_MS*Math.PI*2);
      for(const live of this.live.values())live.glints.setAlpha(alpha);
    }
  }

  /**
   * With building art on (planHasBuildingArt), a building or rubble piece whose cell shows no art (no lot, or the lot's texture not loaded yet)
   * as the low mound; its seams stay only toward the block's other mounds. Undefined for every other piece.
   */
  /** A building/rubble cell under the shown fountain: nothing of its own is drawn (the fountain covers it). */
  private underFountain(x:number,y:number){
    const f=this.fountain;
    return !!f&&x>=f.x&&x<f.x+f.w&&y>=f.y&&y<f.y+f.h&&this.scene.textures.exists(f.sheet.key);
  }
  private moundOf(piece:BlockPiece):BlockPiece|undefined{
    if(!this.mounds||(piece.kind!=='building'&&piece.kind!=='rubble'))return undefined;
    const {width}=this.asset,bare=(cx:number,cy:number)=>{
      const lot=this.lotAt.get(cy*width+cx);
      return !lot||!this.scene.textures.exists(lot.sheet.key);
    };
    if(!bare(piece.x,piece.y))return undefined;
    const s=piece.seams;
    return moundPiece(piece,{n:s.n&&bare(piece.x,piece.y-1),s:s.s&&bare(piece.x,piece.y+1),w:s.w&&bare(piece.x-1,piece.y),e:s.e&&bare(piece.x+1,piece.y)});
  }

  /** Rebuilds the live chunks now (e.g. art textures arrived after they were built with the procedural look). */
  refresh(){
    if(this.view<0)return;
    for(const key of [...this.live.keys()]){this.dropChunk(key);this.buildChunk(key,this.view);}
  }

  /** Drops every chunk; the layer can be updated again afterwards (it starts from an empty screen). */
  destroy(){
    for(const key of [...this.live.keys()])this.dropChunk(key);
    this.vivo?.destroy();
    this.tracker.reset();this.fader.reset();this.faded.clear();this.fog?.destroy();this.fog=undefined;this.view=-1;
    // Its GPU side too (made again by the next bake if the layer is updated again).
    this.relief?.release();
  }

  /** The snow and Breu fog beyond the map edge for this view, just under the ground layer (border-fog.ts). */
  private drawFog(view:number){
    this.fog?.destroy();
    const parts=borderFog(this.asset,view,this.pivot);
    this.fog=TriBand.make(this.scene,parts.map(part=>(g:Phaser.GameObjects.Graphics)=>{
      for(const ring of part)drawFogRing(g,ring);
    })).setDepth(FOG_DEPTH);
  }

  // ---------- Building and dropping chunks ----------
  private buildChunk(key:string,view:number){
    this.cellColumns.clear();this.columnsVersion++;
    const chunk=this.chunksByKey.get(key);
    if(!chunk||this.live.has(key))return;
    const {ground,glints}=this.bakeGround(chunk,view);
    const cells:number[]=[];
    // Buildings with a painted sheet: one image, drawn by the chunk that holds the block's centre cell.
    const sprites:BlockSprite[]=[],painted=new Set<string>(),paintedCells=new Set<number>();
    const inChunk=([cx,cy]:[number,number])=>cx>=chunk.x0&&cx<chunk.x1&&cy>=chunk.y0&&cy<chunk.y1;
    for(const piece of chunk.pieces){
      const at=piece.y*this.asset.width+piece.x;
      if(this.underDecor(at)){paintedCells.add(at);continue;}
      if(this.art){
        // Imported art: the piece's lot (art-plan.ts planLots), drawn once by the chunk holding the lot's centre cell.
        const cellIndex=piece.y*this.asset.width+piece.x,lot=this.lotAt.get(cellIndex);
        if(!lot||!this.scene.textures.exists(lot.sheet.key))continue;
        paintedCells.add(cellIndex);
        const [cx,cy]=lotCentre(lot);
        if(cx===piece.x&&cy===piece.y)sprites.push(this.drawLot(lot,piece.base,view,cells));
        continue;
      }
      if(painted.has(piece.blockId))continue;
      const block=this.blocks.get(piece.blockId);
      if(!block||!this.materials.building(block,view))continue;
      painted.add(block.id);
      if(inChunk([Math.floor(block.x+(block.w-1)/2),Math.floor(block.y+(block.h-1)/2)]))sprites.push(this.drawBuilding(block,piece.base,view,cells));
    }
    const f=this.fountain;
    if(f&&inChunk(lotCentre(f))&&this.scene.textures.exists(f.sheet.key)){
      let base=Infinity;
      for(let j=f.y;j<f.y+f.h;j++)for(let i=f.x;i<f.x+f.w;i++)base=Math.min(base,heightAt(this.asset,i,j));
      sprites.push(this.drawLot(f,base,view,cells));
    }
    // Group the chunk's procedural columns by (block, depth key); draw each band back-to-front.
    const groups=new Map<string,{blockId:string;key:number;items:{piece:BlockPiece;geo:PieceGeometry}[]}>();
    for(const raw of chunk.pieces){
      if(painted.has(raw.blockId)||paintedCells.has(raw.y*this.asset.width+raw.x))continue;
      if(this.art&&(raw.kind==='building'||raw.kind==='rubble')&&this.underFountain(raw.x,raw.y))continue;
      // With the art on, a building or rubble cell without its art shown is a low mound (art-plan.ts moundPiece).
      const piece=this.moundOf(raw)??raw;
      const geo=pieceGeometry(piece,this.asset,view,this.pivot),id=`${piece.blockId}|${geo.depthKey}`;
      const g=groups.get(id);
      if(g)g.items.push({piece,geo});else groups.set(id,{blockId:piece.blockId,key:geo.depthKey,items:[{piece,geo}]});
    }
    // Each band is two TriBands (tri-band.ts): drawn as Graphics and frozen into triangles once instead of replayed
    // every frame, one part per unit column so the columns off camera are skipped.
    const bands:Band[]=[];
    for(const g of groups.values()){
      const body=TriBand.make(this.scene,g.items.map(({piece,geo})=>(gr:Phaser.GameObjects.Graphics)=>{
        const colors=BLOCK_COLORS[piece.kind];
        for(const face of geo.faces)gr.fillStyle(colors[face.kind],1).fillPoints(face.points,true);
        // Icing, windows, plaster and icicles (with the relief: the walls' snowy stones) fade with the column (same part).
        for(const prim of pieceDecor(piece,this.asset,view,this.pivot,this.pieceLook))drawPrim(gr,prim);
      }));
      const outline=TriBand.make(this.scene,g.items.map(({geo})=>(gr:Phaser.GameObjects.Graphics)=>{
        gr.lineStyle(OUTLINE_PX.block,CITY_PALETTE.breu,1);
        for(const line of geo.outline)gr.strokePoints(line,false);
      }));
      const d=this.depthOf(g.key);
      body.setDepth(d);outline.setDepth(d+0.01);
      const band:Band={blockId:g.blockId,key:g.key,body,outline,ids:g.items.map(({piece})=>columnFade(piece.id))};
      bands.push(band);
      band.ids.forEach((id,index)=>this.fadeEntry(id).parts.push({band,index}));
    }
    const props:LiveProp[]=chunk.props.map(p=>{
      const obj=this.drawProp(p,view),prop={key:depth(p.x,p.y,view,this.pivot),fade:`p:${p.id}`,x:p.x,y:p.y,rect:this.propRect(p,obj,view),obj};
      this.fadeEntry(prop.fade).props.push(prop);
      return prop;
    });
    const decor=this.drawDecor(key,view,sprites,props,cells);
    for(const s of sprites)this.fadeEntry(s.fade).sprites.push(s);
    // Column cache for actorDepth: each unit column's key and occluder in this view.
    for(const g of groups.values())for(const {piece,geo} of g.items){
      const cellIndex=piece.y*this.asset.width+piece.x;
      // A column lowered by a whole-cell bite only reaches the bite floor.
      const top=(piece.bite??0)>=1?piece.height*RUIN_FLOOR:piece.height;
      const unit:CityBlock={id:piece.id,kind:piece.kind,x:piece.x,y:piece.y,w:1,h:1,height:top};
      this.columns.set(cellIndex,{key:geo.depthKey,occ:occluderFor(unit,this.asset,piece.base,view,this.pivot),fade:columnFade(piece.id)});
      cells.push(cellIndex);
    }
    this.live.set(key,{chunk,ground,glints,bands,sprites,props,cells,decor});
  }

  /**
   * The chunk's decor pieces with a loaded sheet (decor-art.ts decorSprite): standing ones ('footprint', 'wall') as
   * painted sprites with one column over their cells (actorDepth and see-through, like a lot); objects as props. Each
   * base image is handed to the live layer (attach), which adds its overlays, lights and wires.
   */
  private drawDecor(key:string,view:number,sprites:BlockSprite[],props:LiveProp[],cells:number[]):string[]{
    const out:string[]=[],{width}=this.asset;
    for(const e of this.decorOf.get(key)??[]){
      const sheet=this.art!.decor[e.id];
      if(!this.scene.textures.exists(sheet.key))continue;
      const d=decorSprite(e,sheet,view,this.asset,this.pivot),fade=decorFade(e);
      const img=this.scene.add.image(d.x,d.y,sheet.key,d.frame).setOrigin(d.originX,d.originY).setScale(d.scale).setDepth(this.depthOf(d.depth));
      if(sheet.rule==='prop'){
        const c=decorCentre(this.asset,e),b=img.getBounds();
        const prop:LiveProp={key:d.depth,fade,x:c.x,y:c.y,rect:{x:b.x+b.width*0.15,y:b.y,w:b.width*0.7,h:b.height},obj:img};
        this.fadeEntry(fade).props.push(prop);props.push(prop);
      }else{
        sunTint(img);
        const box:CityBlock={id:fade,kind:sheet.rule==='wall'?'wall':'building',x:e.c,y:e.r,w:e.w,h:e.h,height:sheet.height};
        const column:ColumnRef={key:d.depth,occ:occluderFor(box,this.asset,d.base,view,this.pivot),fade};
        for(let j=e.r;j<e.r+e.h;j++)for(let i=e.c;i<e.c+e.w;i++){this.columns.set(j*width+i,column);cells.push(j*width+i);}
        sprites.push({blockId:fade,key:d.depth,fade,obj:img});
      }
      this.vivo?.attach(e,img,d.artView);
      out.push(decorKey(e));
    }
    return out;
  }

  /**
   * A building drawn from its sheet: one image with its footprint's front-bottom corner on the anchor, sorted by that
   * corner, and ONE column covering the whole footprint registered on every footprint cell (for actorDepth).
   */
  private drawBuilding(block:CityBlock,base:number,view:number,cells:number[]):BlockSprite{
    const m=this.materials.building(block,view)!;
    const {cell,origin,width}=this.asset,fc=frontCorner(view);
    const wx=origin.x+(block.x+fc.i*block.w)*cell,wy=origin.y+(block.y+fc.j*block.h)*cell;
    const at=project(wx,wy,base,view,this.pivot),key=depth(wx,wy,view,this.pivot);
    const frame=this.scene.textures.getFrame(m.key,m.frame);
    const a=buildingAnchor(m.a,m.b,m.frame,frame.width,frame.height,cell);
    const obj=sunTint(this.scene.add.image(at.x,at.y,m.key,m.frame).setOrigin(a.originX,a.originY).setScale(a.scale).setDepth(this.depthOf(key)));
    const fade=`s:${block.id}`,column:ColumnRef={key,occ:occluderFor(block,this.asset,base,view,this.pivot),fade};
    for(let j=block.y;j<block.y+block.h;j++)for(let i=block.x;i<block.x+block.w;i++){this.columns.set(j*width+i,column);cells.push(j*width+i);}
    return {blockId:block.id,key,fade,obj};
  }

  /**
   * A lot of imported art (art-plan.ts): its sheet's view frame with the lot's front-bottom corner on the anchor (x from
   * the footprint convention, y from the sheet's anchor), at the plan's scale, sorted by that corner; one column covering
   * the lot at its drawn height, registered on every lot cell (for actorDepth).
   */
  private drawLot(lot:CityLot,base:number,view:number,cells:number[]):BlockSprite{
    const {cell,origin,width}=this.asset,fc=frontCorner(view),s=lot.sheet;
    const wx=origin.x+(lot.x+fc.i*lot.w)*cell,wy=origin.y+(lot.y+fc.j*lot.h)*cell;
    const at=project(wx,wy,base,view,this.pivot),key=depth(wx,wy,view,this.pivot);
    const frame=buildingFrame(view,lot.turns,this.materials.frames(s.key));
    const a=buildingAnchor(lot.a,lot.b,frame,s.frameWidth,s.frameHeight,ART_CELL);
    const obj=sunTint(this.scene.add.image(at.x,at.y,s.key,frame).setOrigin(a.originX,s.originY).setScale(s.scale).setDepth(this.depthOf(key)));
    const box:CityBlock={id:lot.id,kind:'building',x:lot.x,y:lot.y,w:lot.w,h:lot.h,height:lot.height};
    const fade=`l:${lot.id}`,column:ColumnRef={key,occ:occluderFor(box,this.asset,base,view,this.pivot),fade};
    // The see-through tests the sheet's own height (a ruin draws lower than its block).
    if(s.height<lot.height)column.cover=occluderFor({...box,height:s.height},this.asset,base,view,this.pivot);
    for(let j=lot.y;j<lot.y+lot.h;j++)for(let i=lot.x;i<lot.x+lot.w;i++){this.columns.set(j*width+i,column);cells.push(j*width+i);}
    return {blockId:lot.blockId,key,fade,obj};
  }

  /**
   * Bakes the chunk's static ground into one RenderTexture: cells (flat colour, or the painted tile through a Mesh),
   * slope shading over painted cells, ground decor (only over flat kinds) and the cast shadows landing here. Glints
   * stay a small live Graphics (they breathe).
   */
  private bakeGround(chunk:CityChunk,view:number):{ground:Phaser.GameObjects.RenderTexture;glints:Phaser.GameObjects.Graphics}{
    const {asset,pivot}=this;
    // The texture also holds a ring of one neighbour cell per side, with the same content the neighbour bakes: the
    // overlap hides the hairline a render texture (no multisampling, linear sampling) would leave at chunk edges.
    const ring={...chunk,x0:Math.max(0,chunk.x0-1),y0:Math.max(0,chunk.y0-1),x1:Math.min(asset.width,chunk.x1+1),y1:Math.min(asset.height,chunk.y1+1)};
    const quads=groundQuads(ring,asset,view,pivot);
    const own=(q:GroundQuad)=>q.cx>=chunk.x0&&q.cx<chunk.x1&&q.cy>=chunk.y0&&q.cy<chunk.y1;
    const painted=new Map<GroundKind,string>();
    for(const q of quads)if(!painted.has(q.kind)){const k=this.materials.ground(q.kind);if(k)painted.set(q.kind,k);}
    // Ring cells first (their glints belong to the neighbour), then this chunk's decor exactly as groundDecor draws it.
    const decor:DecorPrim[]=[];
    const bare=(cx:number,cy:number)=>!!this.cliffs?.[cy*asset.width+cx];
    for(const q of quads)if(!own(q)&&this.materials.decorOver(q.kind)&&!bare(q.cx,q.cy))
      for(const p of groundDecor({...chunk,x0:q.cx,y0:q.cy,x1:q.cx+1,y1:q.cy+1},asset,view,pivot))if(!p.shimmer)decor.push(p);
    decor.push(...(painted.size||this.cliffs?this.decorOverFlat(chunk,view,quads.filter(own)):groundDecor(chunk,asset,view,pivot)));
    // Shadows of this chunk's and its neighbours' columns that land here, as one disjoint union (no stacking).
    const casters:BlockPiece[]=[];
    // A mound (moundOf) casts its own low shadow, not the building's.
    for(let j=chunk.cy-1;j<=chunk.cy+1;j++)for(let i=chunk.cx-1;i<=chunk.cx+1;i++)for(const p of this.index.get(i,j)?.pieces??[]){
      if(this.art&&(p.kind==='building'||p.kind==='rubble')&&this.underFountain(p.x,p.y))continue;
      casters.push(this.moundOf(p)??p);
    }
    const shadows=shadowUnion(casters,asset,{x0:ring.x0,y0:ring.y0,x1:ring.x1,y1:ring.y1},view,pivot,CAST_SHADOW);

    const box=boundsOf(quads.flatMap(q=>q.points));
    let s=this.groundResolution;
    const pad=2/s;
    const bx=Math.floor(box.x-pad),by=Math.floor(box.y-pad),bw=box.w+2*pad+1,bh=box.h+2*pad+1;
    s=Math.min(s,GROUND_RT_MAX_PX/bw,GROUND_RT_MAX_PX/bh);
    const rt=this.scene.add.renderTexture(bx,by,Math.ceil(bw*s),Math.ceil(bh*s)).setOrigin(0,0).setScale(1/s).setDepth(CITY_GROUND_DEPTH);
    const place=<T extends Phaser.GameObjects.Components.Transform>(o:T)=>{o.setScale(s);o.setPosition(-bx*s,-by*s);return o;};

    // Relief (relevo/baker.ts): the shader bakes lit, textured ground for every cell of the ring, replacing passes 1-2.
    const relief=this.relief;
    if(relief){
      const key=relief.bake({x:bx,y:by},s,Math.ceil(bw*s),Math.ceil(bh*s),view,ring);
      const img=this.scene.make.image({key},false).setOrigin(0,0).setFlipY(true);
      rt.draw(img);img.destroy();
    }
    // Pass 1: flat cells.
    const flat=place(this.scene.make.graphics({},false));
    if(!relief)for(const q of quads)if(!painted.has(q.kind))flat.fillStyle(groundColor(q.kind,q.shade),1).fillPoints(q.points,true);
    // Pass 2: painted cells, one Mesh per texture.
    const meshes:Phaser.GameObjects.Mesh[]=[];
    if(!relief)for(const [kind,key] of painted)meshes.push(place(this.groundMesh(quads.filter(q=>q.kind===kind),key)));
    // Pass 3: slope shading over painted cells, decor, shadows.
    const over=place(this.scene.make.graphics({},false));
    for(const q of quads){
      if(relief||!painted.has(q.kind))continue;
      const o=groundShadeOverlay(q.kind,q.shade);
      if(o)over.fillStyle(o.color,o.alpha).fillPoints(q.points,true);
    }
    for(const prim of decor)if(!prim.shimmer)drawPrim(over,prim);
    const glints=TriBand.make(this.scene,gr=>{for(const prim of decor)if(prim.shimmer)drawPrim(gr,prim);}).setDepth(GLINT_DEPTH);
    for(const prim of shadows)drawPrim(over,prim);
    rt.draw(flat);
    for(const m of meshes)rt.draw(m);
    // Ground decals of the new scenery (live/layer.ts decalMeshes), under the decor and the cast shadows.
    const decals=this.decalsOf.get(chunk.key);
    if(decals&&this.webgl){
      const {cell,origin}=asset,corner=(cx:number,cy:number)=>{
        const wx=origin.x+cx*cell,wy=origin.y+cy*cell;
        return project(wx,wy,groundZ(asset,wx,wy),view,pivot);
      };
      for(const m of decalMeshes(this.scene,decals,this.livePiece,corner)){rt.draw(place(m));m.destroy();}
    }
    rt.draw(over);
    flat.destroy();over.destroy();for(const m of meshes)m.destroy();
    return {ground:rt,glints};
  }

  /**
   * Ground decor of a chunk with painted kinds: the procedural decor of each flat cell only (painted art has its own
   * detail), the same primitives and back-to-front order as groundDecor over the whole chunk, including its glint cap
   * (the first GLINT.perChunk glint cells in world row-major order).
   */
  private decorOverFlat(chunk:CityChunk,view:number,quads:readonly GroundQuad[]):DecorPrim[]{
    const byCell=new Map<string,DecorPrim[]>();
    let glintCells=0;
    for(let cy=chunk.y0;cy<chunk.y1;cy++)for(let cx=chunk.x0;cx<chunk.x1;cx++){
      const kind=groundAt(this.asset,cx,cy);
      if(!this.materials.decorOver(kind)||this.cliffs?.[cy*this.asset.width+cx])continue;
      let prims=groundDecor({...chunk,x0:cx,y0:cy,x1:cx+1,y1:cy+1},this.asset,view,this.pivot);
      if(prims.some(p=>p.shimmer)){
        if(glintCells>=GLINT.perChunk)prims=prims.filter(p=>!p.shimmer);
        else glintCells++;
      }
      byCell.set(`${cx},${cy}`,prims);
    }
    return quads.flatMap(q=>byCell.get(`${q.cx},${q.cy}`)??[]);
  }

  /** Painted ground cells of one texture as a Mesh: projected cell corners, UVs from world position (materials.ts). */
  private groundMesh(quads:readonly GroundQuad[],key:string):Phaser.GameObjects.Mesh{
    const {cell,origin}=this.asset,frame=this.scene.textures.getFrame(key);
    const verts:number[]=[],uvs:number[]=[],idx:number[]=[];
    for(const q of quads){
      const [nw,ne,se,sw]=q.points,x0=origin.x+q.cx*cell,y0=origin.y+q.cy*cell;
      const at=(s:number,t:number)=>lerp(lerp(nw,ne,s),lerp(sw,se,s),t);
      for(const p of cellUvPatches(x0,y0,x0+cell,y0+cell)){
        const n=verts.length/2;
        for(const [s,t,u,v] of [[p.s0,p.t0,p.u0,p.v0],[p.s1,p.t0,p.u1,p.v0],[p.s1,p.t1,p.u1,p.v1],[p.s0,p.t1,p.u0,p.v1]]){
          const pt=at(s,t);
          // Mesh vertices are y-up (Phaser's mesh space): negate y to stay in screen px.
          verts.push(pt.x,-pt.y);uvs.push(...frameUv(u,v,frame));
        }
        idx.push(n,n+1,n+2,n,n+2,n+3);
      }
    }
    const mesh=new Phaser.GameObjects.Mesh(this.scene,0,0,key);
    mesh.hideCCW=false;
    mesh.setOrtho(mesh.width,mesh.height);
    mesh.addVertices(verts,uvs,idx);
    // Not on the update list: compute the vertex positions now (Mesh.preUpdate is what the update list would call).
    (mesh as unknown as {preUpdate(time:number,delta:number):void}).preUpdate(0,0);
    return mesh;
  }

  private dropChunk(key:string){
    const live=this.live.get(key);
    if(!live)return;
    for(const k of live.decor)this.vivo?.detach(k);
    live.ground.destroy();live.glints.destroy();
    for(const b of live.bands){
      b.body.destroy();b.outline.destroy();
      for(const id of b.ids)this.fadeDrop(id,'parts',(e:BandPart)=>e.band===b);
    }
    for(const s of live.sprites){s.obj.destroy();this.fadeDrop(s.fade,'sprites',(e:BlockSprite)=>e===s);}
    for(const p of live.props){p.obj.destroy();this.fadeDrop(p.fade,'props',(e:LiveProp)=>e===p);}
    for(const c of live.cells)this.columns.delete(c);
    this.cellColumns.clear();this.columnsVersion++;
    this.live.delete(key);
  }

  /**
   * Props: a `city:prop:<kind>` sheet when loaded (frame = view); pines use the approved `arvore-nevada` sheet
   * (frame = view); the rest are small procedural shapes with a contact shadow and a 2 px Breu outline.
   */
  private drawProp(prop:CityProp,view:number):Phaser.GameObjects.Graphics|Phaser.GameObjects.Image{
    // Feet on the ground under the prop's own point (groundZ, like actors): on a slope a cell's mean floats or sinks.
    const z=groundZ(this.asset,prop.x,prop.y);
    const at=project(prop.x,prop.y,z,view,this.pivot);
    const order=this.depthOf(depth(prop.x,prop.y,view,this.pivot));
    const art=this.art&&propSheet(prop,this.art);
    if(art&&this.scene.textures.exists(art.key))
      return this.scene.add.image(at.x,at.y,art.key,propFrame(view,this.materials.frames(art.key))).setOrigin(.5,art.originY).setScale(art.scale).setDepth(order);
    const sheet=this.materials.prop(prop.kind,view);
    if(sheet){
      const a=propAnchor(this.scene.textures.getFrame(sheet.key,sheet.frame).height);
      return this.scene.add.image(at.x,at.y,sheet.key,sheet.frame).setOrigin(a.originX,a.originY).setScale(a.scale).setDepth(order);
    }
    if(prop.kind==='pine'&&this.scene.textures.exists(PINE_TEXTURE))
      return this.scene.add.image(at.x,at.y,PINE_TEXTURE,view).setOrigin(.5,PINE_SHEET.pivotY)
        .setScale(PINE_SHEET.height/PINE_SHEET.pixelHeight).setDepth(order);
    const c=PROP_COLORS[prop.kind],r=propDrawRadius(prop)*42;
    // Frozen into triangles like the bands (tri-band.ts): a lamp's two circles alone are ~200 earcut points a frame.
    return TriBand.make(this.scene,g=>{
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
    },at.x,at.y).setDepth(order);
  }

  // ---------- See-through ----------
  private fadeEntry(id:string):FadeObjects{
    let e=this.fadeObjects.get(id);
    if(!e){e={parts:[],sprites:[],props:[]};this.fadeObjects.set(id,e);}
    return e;
  }
  private fadeDrop<K extends keyof FadeObjects>(id:string,kind:K,match:(item:FadeObjects[K][number])=>boolean){
    const e=this.fadeObjects.get(id);if(!e)return;
    const list=e[kind] as FadeObjects[K][number][],i=list.findIndex(match);
    if(i>=0)list.splice(i,1);
    if(!e.parts.length&&!e.sprites.length&&!e.props.length)this.fadeObjects.delete(id);
  }
  /** Drawn screen bounds of a prop (projected px): the image's own bounds, else what chunks.ts reserves for it. */
  private propRect(prop:CityProp,obj:Phaser.GameObjects.Graphics|Phaser.GameObjects.Image,view:number):Rect{
    if(obj instanceof Phaser.GameObjects.Image){
      // Painted sheets have transparent margins: the middle 70% of the width.
      const b=obj.getBounds();
      return {x:b.x+b.width*0.15,y:b.y,w:b.width*0.7,h:b.height};
    }
    const at=project(prop.x,prop.y,groundZ(this.asset,prop.x,prop.y),view,this.pivot),e=propExtentPx(prop);
    return {x:at.x-e.side,y:at.y-e.up,w:e.side*2,h:e.up};
  }

  /**
   * See-through (cidade-borda-e-quadras): every drawn piece in front of the hero or an ally and over its screen box
   * (the columns actorDepth draws above that figure, and the props drawn in front of it) eases to FADE_ALPHA; the
   * rest of a long wall or a big block stays opaque. One fade id per drawn piece: a unit column (one part of its
   * band), a painted building or art lot, a prop. The figures' Breu outlines are drawn with the figures, so they show through.
   */
  private applyOcclusion(frame:CityFrame,view:number){
    const covered=this.covered;covered.clear();
    if(frame.hero)this.collectCovering(frame.hero,view,covered);
    for(const a of frame.allies??[])this.collectCovering(a,view,covered);
    const alphas=this.fader.update(covered,frame.dtMs);
    for(const id of this.faded)if(!alphas.has(id))this.setFade(id,1);
    this.faded.clear();
    for(const [id,a] of alphas){this.setFade(id,a);this.faded.add(id);}
  }
  private collectCovering(f:Figure,view:number,out:Set<string>){
    const {cx,cy}=cellOf(this.asset,f.x,f.y);
    if(!Number.isFinite(cx)||!Number.isFinite(cy)||cx<0||cy<0||cx>=this.asset.width||cy>=this.asset.height)return;
    coveringColumns(this.nearColumns(cx,cy,view),f,view,out,this.pivot,this.actorBox);
    // Props: the figure's chunk and its 8 neighbours (a pine reaches ~171 px up, well under a chunk).
    const kx=Math.floor(cx/this.index.size),ky=Math.floor(cy/this.index.size);
    for(let j=ky-1;j<=ky+1;j++)for(let i=kx-1;i<=kx+1;i++){
      const live=this.live.get(`${i},${j}`);
      if(live)for(const p of live.props)if(!out.has(p.fade)&&propCovers(p,f,view,this.pivot,this.actorBox))out.add(p.fade);
    }
  }
  private setFade(id:string,alpha:number){
    const e=this.fadeObjects.get(id);if(!e)return;
    // Frozen bands fade one unit column; under Canvas (not frozen) the whole band fades instead.
    for(const {band,index} of e.parts){
      if(!band.body.setPartAlpha(index,alpha))band.body.setAlpha(alpha);
      if(!band.outline.setPartAlpha(index,outlineAlpha(alpha)))band.outline.setAlpha(outlineAlpha(alpha));
    }
    for(const s of e.sprites)s.obj.setAlpha(alpha);
    for(const p of e.props)p.obj.setAlpha(alpha);
  }
}
