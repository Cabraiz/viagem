/**
 * City-mode outlines, Phaser side (card NEW-20261012-E8-cidade-contorno-breu; rules in city-outline-rules.ts).
 *
 * One CityOutlines per scene, built once and kept across world swaps: it answers "the city copy of this texture" for
 * the draw sites (HordeRenderer enemies and pickups, art/horde-art.ts applyEnemyArt, CharacterSprites.animate) only
 * while the host says the city is on. A copy is built lazily the first time a texture is asked for, at most one per
 * frame (a 192 px hero sheet takes a few ms): every cell is resampled to its drawn size on the canvas, padded, and
 * render/outline.ts grows the Breu ring around it. When the city zoom moves by more than 10% (orientation change) all
 * copies are rebuilt under new keys and the old ones are destroyed a few frames later, once every draw site has
 * switched; only the newest copy of each texture is kept.
 */
import type Phaser from 'phaser';
import {outlineRgba} from './outline.ts';
import {CITY_RING,changedEnough,copyResolution,cityKey,isCityKey,rimForGround,slotOf,textureBytes,variantGeometry,variantOrigin,
  type CellCrop,type Rim,type VariantGeometry} from './city-outline-rules.ts';

export interface CityOutlineHost {
  /** True only in city mode (isCityWorld / scene.city); false on the island and the endless map. */
  active():boolean;
  /** The world camera zoom (CSS px per world px). */
  zoom():number;
  /** WCAG luminance of the ground under a world point (city-outline-rules.ts cityGroundLuminance); undefined = unknown. */
  groundLuminance?(x:number,y:number):number|undefined;
}
export interface CityVariant {key:string;base:string;drawScale:number;geom:VariantGeometry;width:number;height:number;bytes:number}

/** Frames a retired copy survives before it is destroyed (every visible draw site switches on its next frame). */
const RETIRE_FRAMES=3;
/** Copies built per frame (each is a few ms; a frame budget, not a loop over every texture at once). */
const BUILDS_PER_FRAME=1;

type Img=Phaser.GameObjects.Image|Phaser.GameObjects.Sprite;

export class CityOutlines {
  private variants=new Map<string,CityVariant>();
  /** Every copy alive (current and retiring) by its own key. */
  private byKey=new Map<string,CityVariant>();
  private failed=new Set<string>();
  private retired:{key:string;at:number}[]=[];
  private serial=0;
  private frameStamp=-1;
  private builds=0;
  private builtZoom=0;
  private builtRes=1;
  private on=false;
  private origin={x:0,y:0};
  private scene:Phaser.Scene;
  private host:CityOutlineHost;
  constructor(scene:Phaser.Scene,host:CityOutlineHost){this.scene=scene;this.host=host;}

  /** City mode now (read once per frame). */
  active():boolean{this.tick();return this.on;}
  /** Rim an imported style-A enemy needs at this world point: umber (its own) on light ground, Breu below the switch. */
  rimAt(x:number,y:number):Rim{
    const lum=this.host.groundLuminance?.(x,y);
    return lum===undefined?'breu':rimForGround(lum);
  }
  /**
   * The city copy of texture `base` drawn at `drawScale` world px per texture px (only the `crop` of each cell, when
   * given: a figure box measured over every frame), or undefined: not in the city, the
   * base texture is missing, or the copy is not built yet (it is, within the frame budget; draw the base meanwhile).
   */
  variant(base:string,drawScale:number,crop?:CellCrop):CityVariant|undefined{
    this.tick();
    if(!this.on)return undefined;
    const v=this.variants.get(base);
    if(v&&!changedEnough(v.drawScale,drawScale))return v;
    if(this.failed.has(base)||this.builds>=BUILDS_PER_FRAME||!this.scene.textures.exists(base))return v;
    this.builds++;
    const next=this.build(base,drawScale,crop);
    if(!next){this.failed.add(base);return v;}
    if(v)this.retire(v.key);
    this.variants.set(base,next);this.byKey.set(next.key,next);
    return next;
  }
  /**
   * Shows `v` (the copy of the image's base texture) on `image` with the base's origin and scale mapped onto the
   * padded copy, so the figure stays exactly where the base drew it; without `v`, puts the base texture back if the
   * image still shows a city copy (a copy rebuilt, or the world left the city). `frame`: the base frame name (undefined
   * for a single-image texture). Returns whether the copy is shown.
   */
  show(image:Img,v:CityVariant|undefined,base:string,frame:string|number|undefined,ox:number,oy:number,sx:number,sy:number):boolean{
    if(!v){
      if(image.texture.key!==base&&isCityKey(image.texture.key))image.setTexture(base,frame).setOrigin(ox,oy).setScale(sx,sy);
      return false;
    }
    if(image.texture.key!==v.key)image.setTexture(v.key,frame);
    else if(frame!==undefined&&image.frame.name!==String(frame))image.setFrame(frame);
    const o=variantOrigin(v.geom,ox,oy,this.origin);
    image.setOrigin(o.x,o.y).setScale(sx*v.geom.kx,sy*v.geom.ky);
    return true;
  }
  /** The copy registered under texture key `key` (a city key), if alive. */
  copyOf(key:string):CityVariant|undefined{return this.byKey.get(key);}
  /** Copies alive and their texture memory (bytes), for the report and the dev probes. */
  stats(){
    let bytes=0;const list:{key:string;width:number;height:number;mb:number}[]=[];
    for(const v of this.variants.values()){bytes+=v.bytes;list.push({key:v.key,width:v.width,height:v.height,mb:+(v.bytes/1048576).toFixed(3)});}
    return {count:this.variants.size,mb:+(bytes/1048576).toFixed(3),zoom:this.builtZoom,res:this.builtRes,retiring:this.retired.length,list};
  }
  /** Drops every copy now (scene shutdown). */
  destroy(){
    // A game teardown may have destroyed the texture and animation managers already: nothing left to free then.
    try{
      for(const v of this.variants.values())this.drop(v.key);
      for(const r of this.retired)this.drop(r.key);
    }catch{/* managers gone with the game */}
    this.variants.clear();this.byKey.clear();this.retired.length=0;this.failed.clear();
  }

  /** Once per game frame: city on/off, zoom and canvas resolution checks, retired copies destroyed, build budget reset. */
  private tick(){
    const loop=this.scene.game?.loop,frame=loop?loop.frame:0;
    if(frame===this.frameStamp)return;
    this.frameStamp=frame;this.builds=0;
    this.on=this.host.active();
    for(let i=this.retired.length-1;i>=0;i--)if(frame-this.retired[i].at>=RETIRE_FRAMES){this.drop(this.retired[i].key);this.retired.splice(i,1);}
    if(!this.on)return;
    const zoom=this.host.zoom(),res=copyResolution(globalThis.devicePixelRatio);
    if(this.variants.size&&(changedEnough(this.builtZoom,zoom)||res!==this.builtRes)){
      for(const v of this.variants.values())this.retire(v.key);
      this.variants.clear();this.failed.clear();
    }
    if(!this.variants.size){this.builtZoom=zoom;this.builtRes=res;}
  }
  private retire(key:string){this.retired.push({key,at:this.frameStamp});}
  /** Destroys a copy's texture and the animations made on it (CharacterSprites' city animations). */
  private drop(key:string){
    const anims=this.scene.anims;
    if(anims)for(const name of anims.getAnimsFromTexture(key))anims.remove(name);
    this.byKey.delete(key);
    if(this.scene.textures.exists(key))this.scene.textures.remove(key);
  }
  private build(base:string,drawScale:number,crop?:CellCrop):CityVariant|undefined{
    const textures=this.scene.textures,tex=textures.get(base);
    const names=tex.getFrameNames(),single=!names.length;
    const first=tex.get(single?'__BASE':names[0]);
    const geom=variantGeometry(first.cutWidth,first.cutHeight,drawScale,this.builtZoom,this.builtRes,crop);
    if(!geom)return undefined;
    const frames=(single?['__BASE']:names).map(name=>{const f=tex.get(name);return {name,f,...slotOf(geom,f.cutX,f.cutY)};});
    let cols=1,rows=1;for(const s of frames){cols=Math.max(cols,s.col+1);rows=Math.max(rows,s.row+1);}
    const width=cols*geom.slotW,height=rows*geom.slotH,key=cityKey(base,++this.serial);
    const ct=textures.createCanvas(key,width,height);if(!ct)return undefined;
    try{
      const c=ct.getContext(),src=tex.getSourceImage() as CanvasImageSource;
      c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
      const k=geom.crop;
      for(const s of frames)c.drawImage(src,s.f.cutX+k.x,s.f.cutY+k.y,k.w,k.h,s.col*geom.slotW+geom.pad,s.row*geom.slotH+geom.pad,geom.cw,geom.ch);
      const img=c.getImageData(0,0,width,height);
      img.data.set(outlineRgba(img.data,width,height,{radius:geom.ring,color:CITY_RING.color,alpha:CITY_RING.alpha,cellW:geom.slotW,cellH:geom.slotH}));
      c.putImageData(img,0,0);
      if(!single)for(const s of frames)ct.add(s.name,0,s.col*geom.slotW,s.row*geom.slotH,geom.slotW,geom.slotH);
      ct.refresh();
    }catch{
      textures.remove(key);return undefined;
    }
    return {key,base,drawScale,geom,width,height,bytes:textureBytes(width,height)};
  }
}
