/**
 * Cenário vivo (card NEW-20261016-ORQ-cenario-vivo-render), the Phaser half: overlays, wires, lights and nests on top
 * of the scenery the city layer draws. All decisions live in rules.ts; this file only creates and moves objects.
 *
 * Lifecycle: CityLayer creates each decor base image and calls `attach(entry, image, artView)` (and `detach(key)` when
 * its chunk goes): the live parts of a piece exist exactly while its base does, so they follow the city's own chunk
 * culling. Per frame `update` only advances the loops and lights inside the camera (others are hidden, never stepped).
 * Wires are drawn once when both poles of a pair are attached, frozen into triangles (TriBand): no per-frame cost.
 */
import Phaser from 'phaser';
import type {ArtFile} from '../../../art/manifest.ts';
import {ART_SCALE} from '../materials.ts';
import {TriBand} from '../tri-band.ts';
import {
  LIGHT_LOOK,WIRE_LOOK,cellFrame,cellPoint,decorKey,isPole,lightHead,lightKind,lightLevel,liveMeta,loopFps,loopFrame,
  matchInsulators,NEST_SCALE,nestArtId,onCamera,polePairs,sagLine,viewIndex,
  type ArtView,type CellFrame,type DecorEntry,type LightKind,type LiveMeta,type Pt,type Rect,
} from './rules.ts';

/** A piece of art as the live layer needs it: its meta and its files, with the texture key each file loads under. */
export interface LivePiece {meta?:Record<string,unknown>;files:Record<string,ArtFile>;key:(file:string)=>string}
export interface CityLiveOptions {
  /** The imported piece of an id (decor ids and nest art ids), or undefined. */
  piece:(id:string)=>LivePiece|undefined;
  /** Depth just above the city ground (ground light pools). */
  groundDepth:number;
  /** prefers-reduced-motion (tests pass it; the default reads the browser). */
  reduced?:boolean;
}
/** A nest as the scene knows it (D-051 snapshot): world point, size letter, hp, asleep or not. */
export interface LiveNest {id:string;x:number;y:number;size:'P'|'M'|'G';hp:number;awake?:boolean}

const GLOW_KEY='city:live:glow';
const GLOW_PX=128;
/** Overlays sit just above their base, the head glow just above the overlays (depth keys are spaced ≥ 1). */
const OVERLAY_DEPTH=.25,HALO_DEPTH=.4;

interface Loop {sprite:Phaser.GameObjects.Sprite;key:string;fps:number;frames:number;first:number;flicker:boolean}
interface Light {kind:LightKind;key:string;halo:Phaser.GameObjects.Image;pool:Phaser.GameObjects.Image;alpha:number;poolAlpha:number;loop?:Loop}
interface Attached {entry:DecorEntry;key:string;rect:Rect;loops:Loop[];light?:Light;insulators?:Pt[];depth:number;visible:boolean}

function reducedMotion(){
  try{return typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}catch{return false;}
}

export class CityLive {
  private readonly attached=new Map<string,Attached>();
  private readonly wires=new Map<string,TriBand>();
  /** Every pole pair of the map (rules.polePairs), by pole key. */
  private readonly pairsOf=new Map<string,[string,string][]>();
  private readonly nests=new Map<string,{img:Phaser.GameObjects.Image;art:string}>();
  private readonly reduced:boolean;

  constructor(private readonly scene:Phaser.Scene,decor:readonly DecorEntry[],private readonly options:CityLiveOptions){
    this.reduced=options.reduced??reducedMotion();
    for(const pair of polePairs(decor))for(const k of pair){const l=this.pairsOf.get(k);if(l)l.push(pair);else this.pairsOf.set(k,[pair]);}
    this.makeGlow();
  }

  /** Live parts of a decor whose base image was just created (CityLayer). `artView` = the art view the frame shows. */
  attach(entry:DecorEntry,base:Phaser.GameObjects.Image,artView:ArtView){
    const key=decorKey(entry);
    this.detach(key);
    const piece=this.options.piece(entry.id),meta=liveMeta(piece?.meta),cell=meta.cell??[base.frame.realWidth,base.frame.realHeight] as [number,number];
    const f=cellFrame(base,cell),depth=base.depth;
    const a:Attached={entry,key,rect:{x:f.left,y:f.top,w:cell[0]*f.scale,h:cell[1]*f.scale},loops:[],depth,visible:true};
    if(piece)this.addLoops(a,piece,meta,f,artView);
    const kind=lightKind(entry.id);
    if(kind)a.light=this.addLight(kind,key,entry.id,f,artView,cell,base,a.loops[0]);
    if(isPole(entry.id)&&meta.wires?.[artView])a.insulators=meta.wires[artView]!.map(p=>cellPoint(f,p));
    this.attached.set(key,a);
    if(a.insulators)for(const pair of this.pairsOf.get(key)??[])this.drawWire(pair);
  }

  /** Drops what attach made for this decor (its chunk left, or the view changed). */
  detach(key:string){
    const a=this.attached.get(key);
    if(!a)return;
    for(const l of a.loops)l.sprite.destroy();
    if(a.light){a.light.halo.destroy();a.light.pool.destroy();}
    for(const pair of this.pairsOf.get(key)??[]){const k=pair.join('|');this.wires.get(k)?.destroy();this.wires.delete(k);}
    this.attached.delete(key);
  }

  /** Per frame: loops and lights inside the camera step; the rest hide. */
  update(camera:Rect,nowMs:number){
    for(const a of this.attached.values()){
      const on=onCamera(a.rect,camera);
      if(on!==a.visible){a.visible=on;for(const l of a.loops)l.sprite.setVisible(on);if(a.light){a.light.halo.setVisible(on);a.light.pool.setVisible(on);}}
      if(!on)continue;
      for(const l of a.loops)l.sprite.setFrame(l.first+loopFrame(nowMs,l.fps,l.frames,l.key,this.reduced));
      if(a.light){
        const L=a.light,frame=L.loop?loopFrame(nowMs,L.loop.fps,L.loop.frames,L.loop.key,this.reduced):0;
        const k=lightLevel(L.kind,nowMs,L.key,this.reduced,frame);
        L.halo.setAlpha(L.alpha*k);L.pool.setAlpha(L.poolAlpha*k);
      }
    }
  }

  /**
   * Nests (D-051) from the snapshot: one image per nest, its art following its state (rules.nestArtId); `place` gives
   * the screen point and depth key of a world point in the current view. Nests without loaded art are skipped.
   */
  setNests(list:readonly LiveNest[],view:number,place:(x:number,y:number)=>{x:number;y:number;depth:number}){
    const keep=new Set<string>();
    for(const n of list){
      const art=nestArtId(n),piece=this.options.piece(art),file=piece?.files.views;
      if(!piece||!file)continue;
      const tex=piece.key('views');
      if(!this.scene.textures.exists(tex))continue;
      keep.add(n.id);
      const at=place(n.x,n.y),anchor=(piece.meta?.anchor as [number,number]|undefined)??[.5,.88];
      const frame=(file.views??4)>=4?((Math.round(view)%4)+4)%4:0,scale=NEST_SCALE[n.size]/ART_SCALE;
      let e=this.nests.get(n.id);
      if(!e||e.art!==art){e?.img.destroy();e={img:this.scene.add.image(0,0,tex,frame).setOrigin(anchor[0],anchor[1]),art};this.nests.set(n.id,e);}
      e.img.setFrame(frame).setPosition(at.x,at.y).setScale(scale).setDepth(at.depth);
    }
    for(const [id,e] of this.nests)if(!keep.has(id)){e.img.destroy();this.nests.delete(id);}
  }

  destroy(){
    for(const k of [...this.attached.keys()])this.detach(k);
    for(const w of this.wires.values())w.destroy();
    this.wires.clear();
    for(const e of this.nests.values())e.img.destroy();
    this.nests.clear();
  }

  /** Counts for tests and the ?perf overlay. */
  stats(){
    let loops=0,lights=0;
    for(const a of this.attached.values()){loops+=a.loops.length;if(a.light)lights++;}
    return {attached:this.attached.size,loops,lights,wires:this.wires.size,nests:this.nests.size};
  }

  private addLoops(a:Attached,piece:LivePiece,meta:LiveMeta,f:CellFrame,view:ArtView){
    const vi=viewIndex(view),flicker=lightKind(a.entry.id)==='pisca';
    const add=(fileKey:string,at:[number,number],animKey:string,name?:string)=>{
      const file=piece.files[fileKey],tex=piece.key(fileKey);
      if(!file||!this.scene.textures.exists(tex))return;
      const frames=file.frames??meta.animFrames??1,views=file.views??file.directions??1,first=views>=4?vi*frames:0;
      const p=cellPoint(f,at),fps=loopFps(meta.fps,name,flicker);
      const sprite=this.scene.add.sprite(p.x,p.y,tex,first).setOrigin(0,0).setScale(f.scale).setDepth(a.depth+OVERLAY_DEPTH);
      a.loops.push({sprite,key:animKey,fps,frames,first,flicker});
    };
    for(const [name,views] of Object.entries(meta.anims??{})){const at=views[view];if(at)add(`anim-${name}`,at,`${a.key}:${name}`,name);}
    // Lit objects: the whole cell animates (frames the size of the base cell), drawn over the base.
    if(piece.files.anim)add('anim',[0,0],`${a.key}:anim`);
  }

  private addLight(kind:LightKind,key:string,id:string,f:CellFrame,view:ArtView,cell:[number,number],base:Phaser.GameObjects.Image,loop?:Loop):Light{
    const look=LIGHT_LOOK[kind],head=cellPoint(f,lightHead(id,view,cell));
    const add=(x:number,y:number)=>this.scene.add.image(x,y,GLOW_KEY).setTint(look.color).setBlendMode(Phaser.BlendModes.ADD);
    const halo=add(head.x,head.y).setScale(look.halo*2*f.scale/GLOW_PX).setDepth(base.depth+HALO_DEPTH).setAlpha(look.alpha);
    // The pool lies on the ground under the head (the base's feet line), flattened like the iso ground.
    const pool=add(head.x,base.y).setScale(look.pool*2*f.scale/GLOW_PX,look.pool*f.scale/GLOW_PX).setDepth(this.options.groundDepth).setAlpha(look.poolAlpha);
    return {kind,key,halo,pool,alpha:look.alpha,poolAlpha:look.poolAlpha,loop};
  }

  private drawWire(pair:[string,string]){
    const k=pair.join('|'),a=this.attached.get(pair[0]),b=this.attached.get(pair[1]);
    if(this.wires.has(k)||!a?.insulators||!b?.insulators)return;
    const lines=matchInsulators(a.insulators,b.insulators).map(([p,q])=>sagLine(p,q));
    const L=WIRE_LOOK;
    const band=TriBand.make(this.scene,g=>{
      for(const pts of lines){
        g.lineStyle(L.width,L.color,1).strokePoints(pts,false);
        g.lineStyle(L.snowWidth,L.snow,L.snowAlpha).strokePoints(pts.map(p=>({x:p.x,y:p.y-L.width/2})),false);
      }
    });
    this.wires.set(k,band.setDepth(Math.max(a.depth,b.depth)+OVERLAY_DEPTH));
  }

  /** One white radial gradient, tinted per light. */
  private makeGlow(){
    if(this.scene.textures.exists(GLOW_KEY))return;
    const t=this.scene.textures.createCanvas(GLOW_KEY,GLOW_PX,GLOW_PX);
    if(!t)return;
    const ctx=t.getContext(),r=GLOW_PX/2,grad=ctx.createRadialGradient(r,r,0,r,r,r);
    grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.35,'rgba(255,255,255,.45)');grad.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=grad;ctx.fillRect(0,0,GLOW_PX,GLOW_PX);t.refresh();
  }
}
