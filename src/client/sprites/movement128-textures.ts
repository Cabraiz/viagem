import type Phaser from 'phaser';
import type {CityOutlines} from '../render/city-outline.ts';
import type {Movement128Plan} from './movement128.ts';
import {queueUpload} from '../preload/upload-queue.ts';

export const MOVEMENT128_TEXTURE_LIMIT=8;
interface Owner {active?:boolean;visible?:boolean;scene?:unknown;once?(event:string,fn:()=>void):unknown}
interface LoadedTexture {dispose():void}
interface Entry {plan:Movement128Plan;state:'queued'|'loading'|'ready'|'failed';used:number;loaded?:LoadedTexture}

/** Shared soft LRU: a texture in use by a visible sprite is never evicted. At most two decodes are in flight. */
export class Movement128Textures<T extends Owner=Owner> {
  private entries=new Map<string,Entry>();
  private wanted=new Map<T,string>();
  private leases=new Map<T,string>();
  private tracked=new WeakSet<T>();
  private serial=0;
  private loading=0;
  private load:(plan:Movement128Plan)=>Promise<LoadedTexture>;
  readonly limit:number;
  private parallel:number;
  private available?:(plan:Movement128Plan)=>LoadedTexture|undefined;
  constructor(load:(plan:Movement128Plan)=>Promise<LoadedTexture>,limit=MOVEMENT128_TEXTURE_LIMIT,parallel=2,available?:(plan:Movement128Plan)=>LoadedTexture|undefined){
    this.load=load;this.limit=limit;this.parallel=parallel;this.available=available;
  }
  request(owner:T,plan:Movement128Plan):boolean{
    if(!this.tracked.has(owner)){this.tracked.add(owner);owner.once?.('destroy',()=>this.release(owner));}
    this.wanted.set(owner,plan.key);
    let entry=this.entries.get(plan.key);
    if(!entry){const loaded=this.available?.(plan);entry={plan,state:loaded?'ready':'queued',used:++this.serial,...(loaded?{loaded}:{})};this.entries.set(plan.key,entry);}
    else entry.used=++this.serial;
    this.pump();return entry.state==='ready';
  }
  status(key:string){return this.entries.get(key)?.state;}
  /** Bind only AFTER the sprite has switched: its old texture stays leased until it is no longer displayed. */
  bind(owner:T,key:string){
    if(this.entries.get(key)?.state!=='ready')return;
    this.leases.set(owner,key);this.trim();
  }
  /** Legacy is temporarily displayed while this owner's requested detailed page is still decoding. */
  unbind(owner:T){this.leases.delete(owner);this.trim();}
  /** Call after switching back to a legacy/idle texture, or when hidden/destroyed. */
  release(owner:T){this.wanted.delete(owner);this.leases.delete(owner);this.trim();this.pump();}
  releaseWhere(test:(owner:T)=>boolean){
    for(const owner of this.wanted.keys())if(test(owner)){this.wanted.delete(owner);this.leases.delete(owner);}
    this.trim();this.pump();
  }
  clearUnused(){
    const wanted=new Set(this.wanted.values()),held=new Set(this.leases.values());
    for(const [key,e] of this.entries)if(e.state==='ready'&&!wanted.has(key)&&!held.has(key)){e.loaded?.dispose();this.entries.delete(key);}
  }
  stats(){
    const entries=[...this.entries.values()];
    return {ready:entries.filter(e=>e.state==='ready').length,loading:this.loading,queued:entries.filter(e=>e.state==='queued').length,
      leasedTextures:new Set(this.leases.values()).size,owners:this.leases.size,limit:this.limit,
      keys:entries.filter(e=>e.state==='ready').map(e=>e.plan.key)};
  }
  private trim(){
    const wanted=new Set(this.wanted.values()),held=new Set(this.leases.values());
    for(const [key,e] of this.entries)if(e.state==='queued'&&!wanted.has(key))this.entries.delete(key);
    const ready=[...this.entries.values()].filter(e=>e.state==='ready');let count=ready.length;
    // Keep the just-loaded requested page until the next animate binds it. This can briefly exceed the target.
    const candidates=ready.filter(e=>!held.has(e.plan.key)&&!wanted.has(e.plan.key)).sort((a,b)=>a.used-b.used);
    for(const e of candidates){if(count<=this.limit)break;e.loaded?.dispose();this.entries.delete(e.plan.key);count--;}
  }
  private pump(){
    this.trim();if(this.loading>=this.parallel)return;
    const wanted=new Set(this.wanted.values());
    const next=[...this.entries.values()].filter(e=>e.state==='queued'&&wanted.has(e.plan.key)).sort((a,b)=>b.used-a.used);
    for(const e of next){
      if(this.loading>=this.parallel)break;
      e.state='loading';this.loading++;
      void Promise.resolve().then(()=>this.load(e.plan)).then(loaded=>{
        if(![...this.wanted.values()].includes(e.plan.key)&&![...this.leases.values()].includes(e.plan.key)){
          loaded.dispose();this.entries.delete(e.plan.key);
        }else{e.loaded=loaded;e.state='ready';}
      }).catch(()=>{e.state='failed';}).finally(()=>{this.loading--;this.trim();this.pump();});
    }
  }
}

interface Shared {cache:Movement128Textures<Phaser.GameObjects.Sprite>;scenes:Map<Phaser.Scene,Set<CityOutlines>>}
type Sheet=HTMLImageElement|ImageBitmap;

/**
 * createImageBitmap decodes off the main thread and its bitmap uploads in a few ms; an <img> uploads through a
 * main-thread conversion of ~100 ms per 1536×768 clip on a 4× phone (card pior-quadro-2s). Without it, the <img> path.
 */
const bitmaps=()=>typeof createImageBitmap==='function'&&typeof fetch==='function';
async function decodeSheet(url:string,w:number,h:number):Promise<Sheet>{
  if(bitmaps()){
    const res=await fetch(url);if(!res.ok)throw new Error(`movement128 ${res.status}`);
    // premultiply: Phaser uploads with UNPACK_PREMULTIPLY_ALPHA, which WebGL ignores for an ImageBitmap (as the queue).
    const bitmap=await createImageBitmap(await res.blob(),{premultiplyAlpha:'premultiply'});
    if(bitmap.width!==w||bitmap.height!==h){bitmap.close();throw new Error('movement128 dimensions');}
    return bitmap;
  }
  const image=new Image();image.decoding='async';image.src=url;
  try{await image.decode();if(image.naturalWidth!==w||image.naturalHeight!==h)throw new Error('movement128 dimensions');return image;}
  catch(error){image.src='';throw error;}
}
/**
 * An <img> the scene's loader preloaded still has Phaser's onerror on it: clearing its src fires it, and Phaser's handler
 * throws (File.revokeObjectURL on a finished file). The M16 rests (5 preloaded sheets) are evicted by the LRU and hit it.
 */
export function freeSheet(image:Sheet){if('close' in image)image.close();else{image.onload=image.onerror=null;image.src='';}}
const free=freeSheet;
const shared=new WeakMap<object,Shared>();

/** Uses real Image decoding plus Phaser textures; nothing is added to the preload list. */
export function movement128Textures(scene:Phaser.Scene,city?:CityOutlines):Movement128Textures<Phaser.GameObjects.Sprite>{
  let state=shared.get(scene.textures);
  if(!state){
    const scenes=new Map<Phaser.Scene,Set<CityOutlines>>(),textures=scene.textures;
    const managed=(plan:Movement128Plan,image:Sheet):LoadedTexture=>({dispose(){
      try{
        if(textures.exists(plan.key)&&(!textures.get||textures.get(plan.key).getSourceImage()===image)){
          for(const outlines of scenes.values())for(const outline of outlines)outline.releaseBase(plan.key);
          textures.remove(plan.key);
        }
      }catch{/* Texture managers may already be gone during game shutdown. */}
      finally{free(image);}
    }});
    const available=(plan:Movement128Plan):LoadedTexture|undefined=>{
      if(!textures.exists(plan.key)||!textures.get)return;
      const image=textures.get(plan.key).getSourceImage() as Sheet;
      if(image.width!==plan.columns*96||image.height!==plan.rows*96)return;
      return managed(plan,image);
    };
    const cache=new Movement128Textures<Phaser.GameObjects.Sprite>(async plan=>{
      const preloaded=available(plan);if(preloaded)return preloaded;
      const w=plan.columns*96,h=plan.rows*96;
      let image:Sheet|undefined;
      for(const url of [plan.url,plan.original]){
        try{image=await decodeSheet(url,w,h);break;}catch{/* next url */}
      }
      if(!image)throw new Error('movement128 unavailable');
      // The GPU upload goes inside the upload queue's frame budget (a 1536×768 clip is one big sheet).
      if(bitmaps())await new Promise<void>(resolve=>queueUpload(w*h,resolve));
      const completedPreload=available(plan);if(completedPreload){free(image);return completedPreload;}
      try{textures.addSpriteSheet(plan.key,image as HTMLImageElement,{frameWidth:96,frameHeight:96,endFrame:plan.frameCount-1});}
      catch(error){free(image);throw error;}
      if(!textures.exists(plan.key)){free(image);throw new Error('movement128 texture unavailable');}
      return managed(plan,image);
    },MOVEMENT128_TEXTURE_LIMIT,2,available);
    state={cache,scenes};shared.set(scene.textures,state);
  }
  if(!state.scenes.has(scene)){
    const current=state;current.scenes.set(scene,new Set());
    const sweep=()=>current.cache.releaseWhere(owner=>owner.scene===scene&&(owner.active===false||owner.visible===false));
    const finish=()=>{
      current.cache.releaseWhere(owner=>owner.scene===scene);
      for(const outlines of current.scenes.get(scene)??[])for(const key of current.cache.stats().keys)outlines.releaseBase(key);
      current.scenes.delete(scene);if(!current.scenes.size)current.cache.clearUnused();
      scene.events.off('postupdate',sweep);scene.events.off('shutdown',finish);scene.events.off('destroy',finish);
    };
    scene.events?.on('postupdate',sweep);scene.events?.once('shutdown',finish);scene.events?.once('destroy',finish);
  }
  if(city)state.scenes.get(scene)!.add(city);
  return state.cache;
}

/** Avoid downloading detailed clips for hidden/inactive or camera-distant teammates. */
export function movement128Visible(sprite:Phaser.GameObjects.Sprite,scene:Phaser.Scene){
  if(sprite.visible===false||sprite.active===false||sprite.alpha===0)return false;
  const view=scene.cameras?.main?.worldView;
  if(!view||!sprite.getBounds)return true;
  const b=sprite.getBounds(),pad=96;
  return b.right>=view.left-pad&&b.left<=view.right+pad&&b.bottom>=view.top-pad&&b.top<=view.bottom+pad;
}
