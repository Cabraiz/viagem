/**
 * City-mode outlines, Phaser side (card NEW-20261012-E8-cidade-contorno-breu; rules in city-outline-rules.ts).
 *
 * One CityOutlines per scene, built once and kept across world swaps: it answers "the city copy of this texture" for
 * the draw sites (HordeRenderer enemies and pickups, art/horde-art.ts applyEnemyArt, CharacterSprites.animate) only
 * while the host says the city is on. A copy is built lazily the first time a texture is asked for at a draw scale
 * no copy of it serves (city-outline-rules.ts MAX_COPIES_PER_BASE: plain and elite, small and big gems each keep their
 * own copy, so alternating requests never rebuild), at most one per frame (a 192 px hero sheet takes a few ms): every
 * cell is resampled to its drawn size on the canvas, padded, and render/outline.ts grows the Breu ring around it. When the
 * city zoom moves by more than 10% (orientation change) all copies are rebuilt under new keys and the old ones are
 * destroyed a few frames later, once every draw site has switched.
 */
import type Phaser from 'phaser';
import {bandsRgba,outlineRgba} from './outline.ts';
import type {OutlineJob,OutlineReply} from './outline-worker.ts';
import {queueUpload} from '../preload/upload-queue.ts';
import {CITY_RING,CITY_STICKER,CITY_STICKER_CSS,MAX_COPIES_PER_BASE,changedEnough,copyResolution,cityKey,isCityKey,rimForGround,slotOf,textureBytes,variantGeometry,variantOrigin,
  type CellCrop,type Rim,type VariantGeometry} from './city-outline-rules.ts';

export interface CityOutlineHost {
  /** True only in city mode (isCityWorld / scene.city); false on the island and the endless map. */
  active():boolean;
  /** The world camera zoom (CSS px per world px). */
  zoom():number;
  /** WCAG luminance of the ground under a world point (city-outline-rules.ts cityGroundLuminance); undefined = unknown. */
  groundLuminance?(x:number,y:number):number|undefined;
}
/** A city copy of texture `base`, built for draw scale `drawScale`. */
export interface CityVariant {key:string;base:string;drawScale:number;geom:VariantGeometry;width:number;height:number;bytes:number}

/** Frames a retired copy survives before it is destroyed (every visible draw site switches on its next frame). */
const RETIRE_FRAMES=3;
/** Copies built per frame (each is a few ms; a frame budget, not a loop over every texture at once). */
const BUILDS_PER_FRAME=1;

type Img=Phaser.GameObjects.Image|Phaser.GameObjects.Sprite;
/** A copy being painted in the worker: registered on arrival unless a rebuild, releaseBase or destroy dropped it. */
interface Job {base:string;drawScale:number;geom:VariantGeometry;width:number;height:number;slots:{name:string;x:number;y:number}[];sticker?:string}

/**
 * One worker for the page (outline-worker.ts); undefined without Worker/OffscreenCanvas/createImageBitmap (tests, old
 * browsers) or after it failed: copies are then painted on the main thread as before.
 */
let worker:Worker|undefined,workerBroken=false;
const listeners=new Set<(reply:OutlineReply)=>void>(),brokenListeners=new Set<()=>void>();
function outlineWorker():Worker|undefined{
  if(worker||workerBroken)return worker;
  if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap!=='function')return undefined;
  try{
    worker=new Worker(new URL('./outline-worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=(e:MessageEvent<OutlineReply>)=>{for(const l of listeners)l(e.data);};
    worker.onerror=()=>{workerBroken=true;worker?.terminate();worker=undefined;for(const l of brokenListeners)l();};
  }catch{workerBroken=true;worker=undefined;}
  return worker;
}

export class CityOutlines {
  /** The current copies of each base key (one per draw-scale window, at most MAX_COPIES_PER_BASE). */
  private variants=new Map<string,CityVariant[]>();
  /** Copies built since the scene started (rebuilds included), for tests and the dev probes. */
  built=0;
  /** The "você" stickers (CITY_STICKER bands) of current copies, by the copy's key. */
  private stickers=new Map<string,CityVariant>();
  /** Every copy alive (current and retiring) by its own key. */
  private byKey=new Map<string,CityVariant>();
  private failed=new Set<string>();
  private retired:{key:string;at:number}[]=[];
  /** Copies in the worker, by job id; the bases (and stickers' copy keys) that have one, so a job is never doubled. */
  private jobs=new Map<number,Job>();
  private painting=new Set<string>();
  private jobSerial=0;
  private onReply=(reply:OutlineReply)=>this.arrive(reply);
  private onBroken=()=>{this.jobs.clear();this.painting.clear();};
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
  /** Copies painting in the worker now (dev probes, tests). */
  get pending(){return this.jobs.size;}

  /** City mode now (read once per frame). */
  active():boolean{this.tick();return this.on;}
  /** Rim an imported style-A enemy needs at this world point: umber (its own) on light ground, Breu below the switch. */
  rimAt(x:number,y:number):Rim{
    const lum=this.host.groundLuminance?.(x,y);
    return lum===undefined?'breu':rimForGround(lum);
  }
  /**
   * The city copy of texture `base` drawn at `drawScale` world px per texture px (only the `crop` of each cell, when
   * given: a figure box measured over every frame), or undefined: not in the city, the base texture is missing, or the
   * copy is not built yet (it is, within the frame budget; draw the base meanwhile). Any copy of `base` built for a
   * scale within REBUILD_CHANGE/REBUILD_GROWTH of drawScale is answered; else a new one is built at drawScale, up to
   * MAX_COPIES_PER_BASE (past it, the nearest larger copy, else the largest). No allocation once built.
   */
  variant(base:string,drawScale:number,crop?:CellCrop):CityVariant|undefined{
    this.tick();
    if(!this.on||!(drawScale>0)||!Number.isFinite(drawScale))return undefined;
    let copies=this.variants.get(base);
    if(copies)for(let i=0;i<copies.length;i++)if(!changedEnough(copies[i].drawScale,drawScale))return copies[i];
    // Full, or the build waits for the budget: the closest copy meanwhile (no ringless frame on a chest's pulse).
    if(copies&&(copies.length>=MAX_COPIES_PER_BASE||this.builds>=BUILDS_PER_FRAME||this.painting.has(base)))return nearest(copies,drawScale);
    if(this.failed.has(base)||this.builds>=BUILDS_PER_FRAME||this.painting.has(base)||!this.scene.textures.exists(base))return undefined;
    this.builds++;
    const next=this.build(base,drawScale,crop);
    if(next==='painting')return copies?nearest(copies,drawScale):undefined;
    if(!next){this.failed.add(base);return undefined;}
    if(!copies){copies=[];this.variants.set(base,copies);}
    copies.push(next);this.byKey.set(next.key,next);
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
  /**
   * The local hero's city "você" sticker for the copy shown under texture key `copyKey` (render/you.ts): the same
   * sheet, crop and draw scale (so the same kx, ky and figure px) with CITY_STICKER's bands baked around the figure
   * instead of the ring, or undefined (not in the city, not a current copy, or not built yet: one build per frame).
   */
  sticker(copyKey:string):CityVariant|undefined{
    this.tick();
    if(!this.on)return undefined;
    const done=this.stickers.get(copyKey);if(done)return done;
    const copy=this.byKey.get(copyKey);
    if(!copy||!this.variants.get(copy.base)?.includes(copy)||this.failed.has(copyKey)||this.painting.has(copyKey)||this.builds>=BUILDS_PER_FRAME)return undefined;
    this.builds++;
    const next=this.build(copy.base,copy.drawScale,copy.geom.crop,copyKey);
    if(next==='painting')return undefined;
    if(!next){this.failed.add(copyKey);return undefined;}
    this.stickers.set(copyKey,next);this.byKey.set(next.key,next);
    return next;
  }
  /** The copy registered under texture key `key` (a city key), if alive. */
  copyOf(key:string):CityVariant|undefined{return this.byKey.get(key);}
  /** Copies alive and their texture memory (bytes), for the report and the dev probes. */
  stats(){
    let bytes=0,count=0;const list:{key:string;width:number;height:number;mb:number}[]=[];
    const add=(v:CityVariant)=>{count++;bytes+=v.bytes;list.push({key:v.key,width:v.width,height:v.height,mb:+(v.bytes/1048576).toFixed(3)});};
    for(const copies of this.variants.values())copies.forEach(add);
    this.stickers.forEach(add);
    return {count,built:this.built,mb:+(bytes/1048576).toFixed(3),zoom:this.builtZoom,res:this.builtRes,retiring:this.retired.length,list};
  }
  /** Drops derivatives of an unleased streamed atlas, including retired copies and the local hero's sticker. */
  releaseBase(base:string){
    const gone=new Set<string>();
    for(const [key,v] of this.byKey)if(v.base===base){gone.add(key);this.drop(key);}
    this.variants.delete(base);this.failed.delete(base);
    for(const [key,v] of this.stickers)if(v.base===base){this.stickers.delete(key);this.failed.delete(key);}
    for(const [id,job] of this.jobs)if(job.base===base)this.cancel(id);
    this.retired=this.retired.filter(r=>!gone.has(r.key));
  }
  /** Drops every copy now (scene shutdown). */
  destroy(){
    // A game teardown may have destroyed the texture and animation managers already: nothing left to free then.
    try{
      for(const copies of this.variants.values())for(const v of copies)this.drop(v.key);
      for(const v of this.stickers.values())this.drop(v.key);
      for(const r of this.retired)this.drop(r.key);
    }catch{/* managers gone with the game */}
    this.variants.clear();this.stickers.clear();this.byKey.clear();this.retired.length=0;this.failed.clear();
    for(const id of [...this.jobs.keys()])this.cancel(id);
    listeners.delete(this.onReply);brokenListeners.delete(this.onBroken);
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
      for(const copies of this.variants.values())for(const v of copies)this.retire(v.key);
      for(const v of this.stickers.values())this.retire(v.key);
      this.variants.clear();this.stickers.clear();this.failed.clear();
      for(const id of [...this.jobs.keys()])this.cancel(id);
    }
    if(!this.variants.size){this.builtZoom=zoom;this.builtRes=res;}
  }
  private retire(key:string){this.retired.push({key,at:this.frameStamp});}
  /** Destroys a copy's texture and the animations made on it (CharacterSprites' city animations). */
  private drop(key:string){
    const anims=this.scene.anims;
    if(anims)for(const name of anims.getAnimsFromTexture(key))anims.remove(name);
    this.byKey.delete(key);
    if(!this.scene.textures.exists(key))return;
    // A worker copy's bitmap is freed with its texture (a canvas copy goes back to Phaser's pool on remove).
    const source=typeof ImageBitmap!=='undefined'?this.scene.textures.get(key).getSourceImage():undefined;
    this.scene.textures.remove(key);
    if(source&&source instanceof ImageBitmap)source.close();
  }
  private cancel(id:number){const job=this.jobs.get(id);if(!job)return;this.jobs.delete(id);this.painting.delete(job.sticker??job.base);}
  /** A worker copy is back: uploaded within the upload queue's budget, then registered like a sync build. */
  private arrive(reply:OutlineReply){
    const job=this.jobs.get(reply.id);
    if(!job){if('bitmap' in reply)reply.bitmap.close();return;}
    if('error' in reply){this.cancel(reply.id);this.failed.add(job.sticker??job.base);return;}
    const bitmap=reply.bitmap;
    queueUpload(job.width*job.height,()=>{
      if(this.jobs.get(reply.id)!==job){bitmap.close();return;}
      this.cancel(reply.id);
      const textures=this.scene.textures,key=cityKey(job.base,++this.serial);
      const tex=textures.addImage(key,bitmap as unknown as HTMLImageElement);
      if(!tex){bitmap.close();this.failed.add(job.sticker??job.base);return;}
      for(const s of job.slots)tex.add(s.name,0,s.x,s.y,job.geom.slotW,job.geom.slotH);
      this.built++;
      const next:CityVariant={key,base:job.base,drawScale:job.drawScale,geom:job.geom,width:job.width,height:job.height,bytes:textureBytes(job.width,job.height)};
      this.byKey.set(key,next);
      if(job.sticker){
        const copy=this.byKey.get(job.sticker);
        // The copy it was made for went away meanwhile: nothing will ask for this sticker.
        if(!copy||!this.variants.get(copy.base)?.includes(copy)){this.drop(key);return;}
        this.stickers.set(job.sticker,next);
      }else{
        let copies=this.variants.get(job.base);
        if(!copies){copies=[];this.variants.set(job.base,copies);}
        copies.push(next);
      }
    });
  }
  /** A copy of `base` at `drawScale`: the CITY_RING around each figure, or with `sticker`, CITY_STICKER's bands. */
  /**
   * `sticker`: the copy key the "você" sticker is for. 'painting' when the worker took the job (the copy arrives in a
   * later frame through arrive()); else the copy painted here, or undefined when it cannot be made.
   */
  private build(base:string,drawScale:number,crop?:CellCrop,sticker?:string):CityVariant|undefined|'painting'{
    const textures=this.scene.textures,tex=textures.get(base);
    const names=tex.getFrameNames(),single=!names.length;
    const first=tex.get(single?'__BASE':names[0]);
    const geom=variantGeometry(first.cutWidth,first.cutHeight,drawScale,this.builtZoom,this.builtRes,crop,sticker?CITY_STICKER_CSS:CITY_RING.cssPx);
    if(!geom)return undefined;
    const frames=(single?['__BASE']:names).map(name=>{const f=tex.get(name);return {name,f,...slotOf(geom,f.cutX,f.cutY)};});
    let cols=1,rows=1;for(const s of frames){cols=Math.max(cols,s.col+1);rows=Math.max(rows,s.row+1);}
    const width=cols*geom.slotW,height=rows*geom.slotH;
    const w=outlineWorker();
    if(w){
      const src=tex.getSourceImage() as ImageBitmapSource,k=geom.crop,id=++this.jobSerial;
      const job:Job={base,drawScale,geom,width,height,slots:single?[]:frames.map(s=>({name:s.name,x:s.col*geom.slotW,y:s.row*geom.slotH})),sticker};
      this.jobs.set(id,job);this.painting.add(sticker??base);
      listeners.add(this.onReply);brokenListeners.add(this.onBroken);
      const cells=frames.map(s=>({sx:s.f.cutX+k.x,sy:s.f.cutY+k.y,sw:k.w,sh:k.h,dx:s.col*geom.slotW+geom.pad,dy:s.row*geom.slotH+geom.pad,dw:geom.cw,dh:geom.ch}));
      createImageBitmap(src).then(source=>{
        if(this.jobs.get(id)!==job){source.close();return;}
        const msg:OutlineJob={id,source,width,height,cells,slotW:geom.slotW,slotH:geom.slotH,
          ...(sticker?{bands:CITY_STICKER.map(b=>({width:b.css*geom.perCss,color:b.color}))}:{ring:{radius:geom.ring,color:CITY_RING.color,alpha:CITY_RING.alpha}})};
        w.postMessage(msg,[source]);
      },()=>{if(this.jobs.get(id)===job){this.cancel(id);this.failed.add(sticker??base);}});
      return 'painting';
    }
    const key=cityKey(base,++this.serial);
    const ct=textures.createCanvas(key,width,height);if(!ct)return undefined;
    try{
      const c=ct.getContext(),src=tex.getSourceImage() as CanvasImageSource;
      c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
      const k=geom.crop;
      for(const s of frames)c.drawImage(src,s.f.cutX+k.x,s.f.cutY+k.y,k.w,k.h,s.col*geom.slotW+geom.pad,s.row*geom.slotH+geom.pad,geom.cw,geom.ch);
      const img=c.getImageData(0,0,width,height);
      img.data.set(sticker?bandsRgba(img.data,width,height,CITY_STICKER.map(b=>({width:b.css*geom.perCss,color:b.color})),geom.slotW,geom.slotH)
        :outlineRgba(img.data,width,height,{radius:geom.ring,color:CITY_RING.color,alpha:CITY_RING.alpha,cellW:geom.slotW,cellH:geom.slotH}));
      c.putImageData(img,0,0);
      if(!single)for(const s of frames)ct.add(s.name,0,s.col*geom.slotW,s.row*geom.slotH,geom.slotW,geom.slotH);
      ct.refresh();
    }catch{
      textures.remove(key);return undefined;
    }
    this.built++;
    return {key,base,drawScale,geom,width,height,bytes:textureBytes(width,height)};
  }
}

/** The copy built for the nearest scale above `drawScale` (shown smaller, never enlarged), else the largest one. */
function nearest(copies:readonly CityVariant[],drawScale:number):CityVariant|undefined{
  let above:CityVariant|undefined,top:CityVariant|undefined;
  for(const v of copies){
    if(v.drawScale>drawScale&&(!above||v.drawScale<above.drawScale))above=v;
    if(!top||v.drawScale>top.drawScale)top=v;
  }
  return above??top;
}
