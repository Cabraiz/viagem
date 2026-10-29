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
import {ART_SCALE,frameUv} from '../materials.ts';
import {TriBand} from '../tri-band.ts';
import type {LiveSheet} from './art.ts';
import {NEST_SCALE,nestArtId,type LiveNest} from './nests.ts';
import {CoverFader} from '../occlusion.ts';
import {LuzesLayer} from '../../luzes/layer.ts';
import {LUZ,LUZES_ATLAS,LUZ_CORE,luzesBudget,luzesEnabled} from '../../luzes/rules.ts';
import {
  LIGHT_LOOK,WIRE_LOOK,cellFrame,cellPoint,decalCorners,decorKey,isDecal,isPole,lightHead,lightKind,lightLevel,lightScale,liveMeta,loopFps,loopFrame,loopVisible,
  lineHitsRect,matchInsulators,onCamera,polePairs,sagLine,viewIndex,
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
  /** Muitas luzes (luzes/): halos of the ChatGPT atlas on windows, lanterns, signs and cars; default `?luzes` (on). */
  luzes?:boolean;
  /** A phone (coarse pointer): fewer halos at once (luzes/rules luzesBudget); the default reads the browser. */
  coarse?:boolean;
}
export type {LiveNest};

/** Queues the live sheets (art.ts liveSheets) not loaded yet; returns how many (the caller starts the loader). */
export function queueLiveArt(scene:Phaser.Scene,sheets:readonly LiveSheet[]):number{
  let n=0;
  for(const s of sheets)if(!scene.textures.exists(s.key)){scene.load.spritesheet(s.key,s.url,{frameWidth:s.frameWidth,frameHeight:s.frameHeight});n++;}
  return n;
}

/**
 * Ground decals of one chunk as Meshes (one per texture), for the city layer to draw into the chunk's baked ground
 * (after the cells, before the shadows) and destroy: no object stays alive, no per-frame cost. `corner(cx, cy)` is
 * the projected point (world px, on the ground) of a city-grid corner; decals without a loaded texture are skipped.
 */
export function decalMeshes(scene:Phaser.Scene,decals:readonly DecorEntry[],piece:(id:string)=>LivePiece|undefined,corner:(cx:number,cy:number)=>Pt):Phaser.GameObjects.Mesh[]{
  const byKey=new Map<string,DecorEntry[]>();
  for(const d of decals){
    if(!isDecal(d.id))continue;
    const p=piece(d.id),file=p&&Object.keys(p.files)[0],key=file&&p.key(file);
    if(!key||!scene.textures.exists(key))continue;
    const l=byKey.get(key);if(l)l.push(d);else byKey.set(key,[d]);
  }
  const out:Phaser.GameObjects.Mesh[]=[];
  for(const [key,list] of byKey){
    const frame=scene.textures.getFrame(key,0),verts:number[]=[],uvs:number[]=[],idx:number[]=[];
    for(const d of list){
      const n=verts.length/2;
      for(const c of decalCorners(d)){
        const p=corner(c.cx,c.cy);
        // Mesh vertices are y-up (Phaser's mesh space): negate y to stay in screen px (as city-layer groundMesh).
        verts.push(p.x,-p.y);uvs.push(...frameUv(c.u,c.v,frame));
      }
      idx.push(n,n+1,n+2,n,n+2,n+3);
    }
    const mesh=new Phaser.GameObjects.Mesh(scene,0,0,key,0);
    mesh.hideCCW=false;
    mesh.setOrtho(mesh.width,mesh.height);
    mesh.addVertices(verts,uvs,idx);
    (mesh as unknown as {preUpdate(time:number,delta:number):void}).preUpdate(0,0);
    out.push(mesh);
  }
  return out;
}

const GLOW_KEY='city:live:glow';
const GLOW_PX=128;
/** Overlays sit just above their base, the head glow just above the overlays (depth keys are spaced ≥ 1). */
const OVERLAY_DEPTH=.25,HALO_DEPTH=.4;

interface Loop {sprite:Phaser.GameObjects.Sprite;key:string;fps:number;frames:number;first:number;flicker:boolean}
interface Light {kind:LightKind;key:string;halo:Phaser.GameObjects.Image;pool:Phaser.GameObjects.Image;alpha:number;poolAlpha:number;loop?:Loop;
  /** Screen px per delivery px of LIGHT_LOOK (its radii), kept to restyle the glow when the atlas arrives. */
  px:number}
interface Attached {entry:DecorEntry;key:string;rect:Rect;loops:Loop[];light?:Light;insulators?:Pt[];depth:number;visible:boolean;
  /** Its first frame is on and nothing steps while the layer is held still. */
  still?:boolean}

function reducedMotion(){
  try{return typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}catch{return false;}
}
function coarsePointer(){
  try{return typeof window!=='undefined'&&!!window.matchMedia?.('(pointer: coarse)').matches;}catch{return false;}
}
const urlLuzes=()=>typeof location==='undefined'||luzesEnabled(location.search);

export class CityLive {
  private readonly attached=new Map<string,Attached>();
  private readonly wires=new Map<string,{band:TriBand;lines:Pt[][];box:Rect}>();
  /** Wires and nests drawn over the local hero fade like the buildings (auditoria-arte-mundo items 14 and 15). */
  private readonly fader=new CoverFader();
  private readonly covered=new Set<string>();
  /** Every pole pair of the map (rules.polePairs), by pole key. */
  private readonly pairsOf=new Map<string,[string,string][]>();
  private readonly nests=new Map<string,{img:Phaser.GameObjects.Image;art:string}>();
  /** prefers-reduced-motion. */
  private readonly motionReduced:boolean;
  /** Reduced motion or the Leve quality level (setStill): loops and lights hold their first frame, set once. */
  private reduced:boolean;
  /** Muitas luzes (luzes/layer.ts): the extra halos, and the lamps' glow from the atlas once it has loaded. */
  private readonly luzes?:LuzesLayer;
  private readonly coarse:boolean;

  constructor(private readonly scene:Phaser.Scene,decor:readonly DecorEntry[],private readonly options:CityLiveOptions){
    this.motionReduced=this.reduced=options.reduced??reducedMotion();
    this.coarse=options.coarse??coarsePointer();
    for(const pair of polePairs(decor))for(const k of pair){const l=this.pairsOf.get(k);if(l)l.push(pair);else this.pairsOf.set(k,[pair]);}
    this.makeGlow();
    if(options.luzes??urlLuzes())this.luzes=new LuzesLayer(scene,{budget:luzesBudget(false,this.coarse),reduced:this.reduced},()=>this.restyleLights());
  }

  /**
   * Live parts of a decor whose base image was just created (CityLayer). `artView` = the art view the frame shows;
   * `texel` = texture px per art px of that image (below 1 on a lite copy: the offsets of the meta are art px).
   */
  attach(entry:DecorEntry,base:Phaser.GameObjects.Image,artView:ArtView,texel=1){
    const key=decorKey(entry);
    this.detach(key);
    const piece=this.options.piece(entry.id),meta=liveMeta(piece?.meta),cell=meta.cell??[base.frame.realWidth/texel,base.frame.realHeight/texel] as [number,number];
    const f=cellFrame({x:base.x,y:base.y,originX:base.originX,originY:base.originY,scaleX:base.scaleX*texel},cell),depth=base.depth;
    const a:Attached={entry,key,rect:{x:f.left,y:f.top,w:cell[0]*f.scale,h:cell[1]*f.scale},loops:[],depth,visible:true};
    if(piece)this.addLoops(a,piece,meta,f,artView);
    const kind=lightKind(entry.id);
    if(kind)a.light=this.addLight(kind,key,entry.id,f,artView,cell,base,a.loops[0]);
    this.luzes?.attach(key,entry.id,artView,cell,f,depth);
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
    this.luzes?.detach(key);
    for(const pair of this.pairsOf.get(key)??[]){const k=pair.join('|');this.wires.get(k)?.band.destroy();this.wires.delete(k);}
    this.attached.delete(key);
  }

  /** Quality Leve (CityLayer.setStill): loops and lights go to their first frame and stay there; off, they step again. */
  setStill(on:boolean){
    const reduced=this.motionReduced||on;if(reduced===this.reduced)return;
    this.reduced=reduced;for(const a of this.attached.values())a.still=false;
    this.luzes?.setOptions({budget:luzesBudget(on,this.coarse),reduced});
  }

  /**
   * Per frame: loops and lights inside the camera step; the rest hide. `hero`: the local hero's box with its marks
   * (occlusion.ts marksRect) and its draw depth; a wire or a nest drawn above it and over that box fades.
   */
  update(camera:Rect,nowMs:number,hero?:{rect:Rect;depth:number},dtMs=16){
    this.fadeOver(hero,dtMs);
    for(const a of this.attached.values()){
      const on=onCamera(a.rect,camera);
      if(on!==a.visible){a.visible=on;for(const l of a.loops)l.sprite.setVisible(on);if(a.light){a.light.halo.setVisible(on);a.light.pool.setVisible(on);}}
      if(!on)continue;
      // Held still: the first frame once (attach, setStill), then nothing per frame.
      if(this.reduced){if(a.still)continue;a.still=true;}
      for(const l of a.loops)l.sprite.setFrame(l.first+loopFrame(nowMs,l.fps,l.frames,l.key,this.reduced));
      if(a.light){
        const L=a.light,frame=L.loop?loopFrame(nowMs,L.loop.fps,L.loop.frames,L.loop.key,this.reduced):0;
        const k=lightLevel(L.kind,nowMs,L.key,this.reduced,frame);
        L.halo.setAlpha(L.alpha*k);L.pool.setAlpha(L.poolAlpha*k);
        this.luzes?.setLevel(a.key,k);
      }
    }
    this.luzes?.update(camera,nowMs,dtMs);
  }

  /**
   * Nests (D-051) from the snapshot: one image per nest, its art following its state (rules.nestArtId); `place` gives
   * the screen point and depth key of a world point in the current view. Nests without loaded art are skipped.
   */
  setNests(list:readonly LiveNest[],view:number,place:(x:number,y:number)=>{x:number;y:number;depth:number}){
    const keep=new Set<string>();
    for(const n of list){
      // The base art is `files.sheet` (E8's `cenario` group, like props and buildings); `views` from older imports.
      const art=nestArtId(n,id=>!!this.nestTexture(id));
      const found=art?this.nestTexture(art):undefined;
      if(!art||!found)continue;
      const {piece,file,tex}=found;
      keep.add(n.id);
      const at=place(n.x,n.y),anchor=file.anchor??(piece.meta?.anchor as [number,number]|undefined)??[.5,.88];
      const frame=(file.views??4)>=4?((Math.round(view)%4)+4)%4:0;
      // Per texture px: a lite copy (liteCell, art.ts liveSheets) is smaller than the art cell.
      const scale=NEST_SCALE[n.size]/ART_SCALE/(file.liteCell?file.liteCell[0]/file.cell[0]:1);
      let e=this.nests.get(n.id);
      if(!e||e.art!==art){e?.img.destroy();e={img:this.scene.add.image(0,0,tex,frame).setOrigin(anchor[0],anchor[1]),art};this.nests.set(n.id,e);}
      e.img.setFrame(frame).setPosition(at.x,at.y).setScale(scale).setDepth(at.depth);
    }
    for(const [id,e] of this.nests)if(!keep.has(id)){e.img.destroy();this.nests.delete(id);}
  }

  destroy(){
    for(const k of [...this.attached.keys()])this.detach(k);
    this.luzes?.destroy();
    for(const w of this.wires.values())w.band.destroy();
    this.wires.clear();
    for(const e of this.nests.values())e.img.destroy();
    this.nests.clear();
  }

  /** A nest piece's base sheet when it is in the index and loaded: `sheet` (E8's cenario group), or `views`. */
  private nestTexture(id:string){
    const piece=this.options.piece(id),name=piece?.files.sheet?'sheet':'views',file=piece?.files[name];
    if(!piece||!file)return undefined;
    const tex=piece.key(name);
    return this.scene.textures.exists(tex)?{piece,file,tex}:undefined;
  }

  /** Counts for tests and the ?perf overlay. */
  stats(){
    let loops=0,lights=0;
    for(const a of this.attached.values()){loops+=a.loops.length;if(a.light)lights++;}
    return {attached:this.attached.size,loops,lights,wires:this.wires.size,nests:this.nests.size,luzes:this.luzes?.stats()};
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
    for(const [name,views] of Object.entries(meta.anims??{}))if(loopVisible(meta,name,view))add(`anim-${name}`,views[view]!,`${a.key}:${name}`,name);
    // Lit objects: the whole cell animates (frames the size of the base cell), drawn over the base.
    if(piece.files.anim)add('anim',[0,0],`${a.key}:anim`);
  }

  private addLight(kind:LightKind,key:string,id:string,f:CellFrame,view:ArtView,cell:[number,number],base:Phaser.GameObjects.Image,loop?:Loop):Light{
    // LIGHT_LOOK radii are delivery px: × lightScale to the imported cell, × f.scale to the screen.
    const look=LIGHT_LOOK[kind],head=cellPoint(f,lightHead(id,view,cell)),px=f.scale*lightScale(kind,cell);
    const add=(x:number,y:number)=>this.scene.add.image(x,y,GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD);
    const halo=add(head.x,head.y).setDepth(base.depth+HALO_DEPTH).setAlpha(look.alpha);
    // The pool lies on the ground under the head (the base's feet line), flattened like the iso ground.
    const pool=add(head.x,base.y).setDepth(this.options.groundDepth).setAlpha(look.poolAlpha);
    const light:Light={kind,key,halo,pool,alpha:look.alpha,poolAlpha:look.poolAlpha,loop,px};
    this.styleLight(light);
    return light;
  }

  /**
   * The head glow and the ground pool: the ChatGPT atlas (lamp or fire, and the bloom for the pool) once it has
   * loaded with luzes on, sized so its lit core matches the old radius; before that (or `?luzes=0`) the white
   * gradient tinted per kind.
   */
  private styleLight(L:Light){
    const look=LIGHT_LOOK[L.kind],px=L.px;
    if(this.luzes?.loaded){
      const head=L.kind==='fogueira'?LUZ.fire:LUZ.lamp,tint=L.kind==='pisca'?look.color:0xffffff,hc=LUZ_CORE[head],pc=LUZ_CORE[LUZ.bloom];
      L.halo.setTexture(LUZES_ATLAS.key,head).setTint(tint).setDisplaySize(look.halo*2*px/hc[0],look.halo*2*px/hc[1]);
      L.pool.setTexture(LUZES_ATLAS.key,LUZ.bloom).setTint(tint).setDisplaySize(look.pool*2*px/pc[0],look.pool*px/pc[1]);
      return;
    }
    L.halo.setTexture(GLOW_KEY).setTint(look.color).setScale(look.halo*2*px/GLOW_PX);
    L.pool.setTexture(GLOW_KEY).setTint(look.color).setScale(look.pool*2*px/GLOW_PX,look.pool*px/GLOW_PX);
  }

  /** The atlas arrived: the lamps already placed switch to it. */
  private restyleLights(){for(const a of this.attached.values())if(a.light)this.styleLight(a.light);}

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
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const pts of lines)for(const p of pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
    const m=L.width;
    this.wires.set(k,{band:band.setDepth(Math.max(a.depth,b.depth)+OVERLAY_DEPTH),lines,box:{x:x0-m,y:y0-m,w:x1-x0+2*m,h:y1-y0+2*m}});
  }

  private fadeOver(hero:{rect:Rect;depth:number}|undefined,dtMs:number){
    const covered=this.covered;covered.clear();
    if(hero){
      const r=hero.rect,hit=(b:Rect)=>b.x<r.x+r.w&&r.x<b.x+b.w&&b.y<r.y+r.h&&r.y<b.y+b.h;
      for(const [k,w] of this.wires)if(w.band.depth>hero.depth&&hit(w.box)&&w.lines.some(pts=>lineHitsRect(pts,r)))covered.add(`w:${k}`);
      for(const [id,e] of this.nests){
        const img=e.img,box={x:img.x-img.displayWidth*img.originX,y:img.y-img.displayHeight*img.originY,w:img.displayWidth,h:img.displayHeight};
        if(img.depth>hero.depth&&hit(box))covered.add(`n:${id}`);
      }
    }
    const alphas=this.fader.update(covered,dtMs);
    for(const [k,w] of this.wires)w.band.setAlpha(alphas.get(`w:${k}`)??1);
    for(const [id,e] of this.nests)e.img.setAlpha(alphas.get(`n:${id}`)??1);
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
