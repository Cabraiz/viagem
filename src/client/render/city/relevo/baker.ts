/**
 * Baked relief ground of the Cidade Nevada (card NEW-20261013-ORQ-cidade-relevo-pseudo-realista): the relief shader
 * (shader.ts) run once per chunk into a scratch framebuffer, which the city layer copies into the chunk's ground
 * RenderTexture right away (CityLayer.bakeGround). One draw per chunk build, nothing per frame (the mobile default).
 *
 * Scratch targets are shared by every chunk: a bake is consumed by the RenderTexture draw that follows it, so one
 * framebuffer per (rounded) size is enough. The field and mask textures (field.ts) are uploaded once.
 */
import Phaser from 'phaser';
import {Baker} from '../../../terrain/renderer.ts';
import type {CityAsset} from '../asset.ts';
import {CLIFF_LIP_HEIGHT} from '../from-maps.ts';
import type {Pt,Rect} from '../projection.ts';
import {reliefTextures,type ReliefTextures} from './field.ts';
import {RELIEF_RAY_STEPS,RELIEF_STEP_UNITS,reliefShader} from './shader.ts';
import {ALBEDO_URL} from './albedo-meta.ts';

/**
 * The ground albedo atlas (card NEW-20261014-ORQ-chao-albedo-cidade, scripts/chao-albedo.mjs): loaded at runtime the
 * first time a relief is made; until it is in (or when it fails, or with `?chao=0`) the relief binds a 1×1 grey stand-in
 * and draws the procedural ground of before (albedoOn 0). Mipmapped once in, so the bake minifies it cleanly.
 */
export const ALBEDO_KEY='city:albedo';
const ALBEDO_STAND_IN='city:albedo:vazio';
/** `?chao=0`: the procedural ground (before/after prints of the card). */
export const albedoEnabled=(search=typeof location!=='undefined'?location.search:'')=>new URLSearchParams(search).get('chao')!=='0';

const SAMPLING={wrapS:'clamp_to_edge',wrapT:'clamp_to_edge',minFilter:'linear',magFilter:'linear',flipY:false};
/** Scratch sizes are rounded up to this many texels, so chunks of nearly the same box share one target. */
const SIZE_STEP=64;
/** Shadow taps: the full six, or three in economy mode (as the Crônicas low quality). */
export const RELIEF_SHADOW_SAMPLES=6;
export const RELIEF_SHADOW_SAMPLES_LOW=3;

/** Cells a chunk bakes: [x0, x1) × [y0, y1), its overlap ring included. */
export interface CellRect {x0:number;y0:number;x1:number;y1:number}

let serial=0;
/** Lab numbers: bakes, texels and wall time per bake (GPU included only when window.__reliefTiming makes it wait). */
export interface ReliefStats {bakes:number;texels:number;lastMs:number;maxMs:number;totalMs:number}

export class CityRelief {
  readonly textures:ReliefTextures;
  private readonly baker:Baker;
  private readonly targets=new Map<string,{shader:Phaser.GameObjects.Shader;key:string}>();
  private readonly keys:[string,string,string];
  /** The albedo atlas is in and mipmapped (the shader's albedoOn). */
  private albedo=false;
  /** The ground is final: the atlas is in, or it will not come (failed, `?chao=0`): what the modo foto waits for. */
  albedoSettled=false;
  /** Called once the atlas arrives: the layer bakes its live chunks again. */
  onAlbedo?:()=>void;
  /** Textures uploaded and the restore listener on (released by release(), made again by the next bake). */
  private live=false;
  private readonly restore=()=>this.dropTargets();
  private readonly id=serial++;
  /** Highest corner (render units) per cell, for each chunk's ray ceiling. */
  private readonly cellTop:Float32Array;
  private shadowSamples=RELIEF_SHADOW_SAMPLES;
  readonly stats:ReliefStats={bakes:0,texels:0,lastMs:0,maxMs:0,totalMs:0};

  constructor(private readonly scene:Phaser.Scene,private readonly asset:CityAsset,private readonly pivot:Pt){
    this.baker=new Baker(scene);
    const t=this.textures=reliefTextures(asset);
    this.keys=[`city-relief-field-${this.id}`,`city-relief-kinds-${this.id}`,`city-relief-cover-${this.id}`];
    const W=t.fieldWidth;
    this.cellTop=new Float32Array(asset.width*asset.height);
    for(let cy=0;cy<asset.height;cy++)for(let cx=0;cx<asset.width;cx++){
      const at=(i:number,j:number)=>t.field[(j*W+i)*4];
      // A cliff ridge rises CLIFF_LIP_HEIGHT over its ground (shader.ts BERM).
      const ridge=t.cover[(cy*asset.width+cx)*4+2]?CLIFF_LIP_HEIGHT:0;
      this.cellTop[cy*asset.width+cx]=Math.max(at(cx,cy),at(cx+1,cy),at(cx,cy+1),at(cx+1,cy+1))/255*t.maxHeight+ridge;
    }
    // Uploaded now, before any bake: made inside the first chunk's bake, the new textures read back wrong in that
    // chunk (a lake of water, holes). release() frees them; a bake after it uploads them again, but the scene never
    // reuses a destroyed layer (scene.ts drops it), so that path is only a safety net.
    this.ensure();
    scene.events.once('shutdown',()=>this.release());
    this.loadAlbedo();
  }
  /** Starts the atlas download (once per game: the texture stays for the next city); done → mipmaps, new targets. */
  private loadAlbedo(){
    const tex=this.scene.textures;
    if(!albedoEnabled()){this.albedoSettled=true;return;}
    const ready=()=>{if(!tex.exists(ALBEDO_KEY)){this.albedoSettled=true;return;}mipmap(this.renderer,tex.get(ALBEDO_KEY));this.albedo=true;this.dropTargets();this.onAlbedo?.();this.albedoSettled=true;};
    if(tex.exists(ALBEDO_KEY)){ready();return;}
    const load=this.scene.load;
    load.image(ALBEDO_KEY,ALBEDO_URL);
    load.once(`filecomplete-image-${ALBEDO_KEY}`,ready);
    // A failed download keeps the procedural ground (never a black square).
    load.on('loaderror',(file:{key?:string})=>{if(file?.key===ALBEDO_KEY)this.albedoSettled=true;});
    if(!load.isLoading())load.start();
  }
  private get renderer(){return this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;}
  /** Uploads the textures and listens for a lost WebGL context (its scratch targets are made again on the next bake). */
  private ensure(){
    if(this.live)return;
    const t=this.textures,{width,height}=this.asset,tex=this.scene.textures;
    for(const k of this.keys)if(tex.exists(k))tex.remove(k);
    tex.addUint8Array(this.keys[0],t.field,t.fieldWidth,t.fieldHeight);
    tex.addUint8Array(this.keys[1],t.kinds,width,height);
    tex.addUint8Array(this.keys[2],t.cover,width,height);
    if(!tex.exists(ALBEDO_STAND_IN))tex.addUint8Array(ALBEDO_STAND_IN,new Uint8Array([128,128,128,255]),1,1);
    this.renderer.on?.(Phaser.Renderer.Events.RESTORE_WEBGL,this.restore);
    this.live=true;
  }

  /** Economy mode: fewer shadow taps. True when it changed (the layer then rebuilds its chunks, so no seam shows). */
  setEconomy(on:boolean){const n=on?RELIEF_SHADOW_SAMPLES_LOW:RELIEF_SHADOW_SAMPLES,changed=n!==this.shadowSamples;this.shadowSamples=n;return changed;}

  /**
   * Ray ceiling of a chunk: the highest corner of its cells and of the cells a ray through its pixels may cross
   * above them (terrain in front, up to maxHeight / cell cells away along each axis).
   */
  rayTop(cells:CellRect):number{
    const {width,height}=this.asset,reach=Math.ceil((this.textures.maxHeight+CLIFF_LIP_HEIGHT)/this.asset.cell)+1;
    let top=0;
    for(let cy=Math.max(0,cells.y0-reach);cy<Math.min(height,cells.y1+reach);cy++)
      for(let cx=Math.max(0,cells.x0-reach);cx<Math.min(width,cells.x1+reach);cx++)top=Math.max(top,this.cellTop[cy*width+cx]);
    return top;
  }

  /**
   * Bakes the relief of `cells` over the screen rect starting at `box` (projected px, z = 0 plane), `scale` texels per
   * px, into a scratch target of at least w×h texels. Returns the texture key: draw it right away (flipY, origin 0,
   * scale 1 at the RenderTexture's origin), the next bake reuses it.
   */
  bake(box:Pt,scale:number,w:number,h:number,view:number,cells:CellRect):string{
    const tw=Math.ceil(w/SIZE_STEP)*SIZE_STEP,th=Math.ceil(h/SIZE_STEP)*SIZE_STEP;
    const target=this.target(tw,th),shader=target.shader,{asset,pivot}=this;
    this.ensure();
    const top=this.rayTop(cells),t0=performance.now();
    this.baker.bake(shader,()=>{
      const set=(name:string,value:unknown)=>shader.setUniform(`${name}.value`,value);
      set('areaOrigin',{x:box.x,y:box.y});set('areaSize',{x:tw/scale,y:th/scale});
      set('view',view);set('pivot',{x:pivot.x,y:pivot.y});
      set('gridOrigin',{x:asset.origin.x,y:asset.origin.y});set('gridSize',{x:asset.width,y:asset.height});
      set('cellSize',asset.cell);set('maxHeight',this.textures.maxHeight);
      set('rayTop',top);set('raySteps',Math.max(1,Math.min(RELIEF_RAY_STEPS,Math.ceil(top/RELIEF_STEP_UNITS))));
      set('cellRect',{x:cells.x0,y:cells.y0,z:cells.x1,w:cells.y1});
      set('shadowSamples',this.shadowSamples);
      set('albedoOn',this.albedo?1:0);
    });
    // Dev lab only: wait for the GPU so the time is the bake's own (never in the game: it would stall the frame).
    if((globalThis as {__reliefTiming?:boolean}).__reliefTiming)(this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl.finish();
    const ms=performance.now()-t0,st=this.stats;
    st.bakes++;st.texels+=tw*th;st.lastMs=ms;st.maxMs=Math.max(st.maxMs,ms);st.totalMs+=ms;
    return target.key;
  }

  private target(w:number,h:number){
    const size=`${w}x${h}`;
    let t=this.targets.get(size);
    if(t)return t;
    const uniforms={areaOrigin:{type:'2f',value:{x:0,y:0}},areaSize:{type:'2f',value:{x:w,y:h}},view:{type:'1f',value:0},
      pivot:{type:'2f',value:{x:0,y:0}},gridOrigin:{type:'2f',value:{x:0,y:0}},gridSize:{type:'2f',value:{x:1,y:1}},
      cellSize:{type:'1f',value:1},maxHeight:{type:'1f',value:1},rayTop:{type:'1f',value:0},raySteps:{type:'1f',value:1},
      cellRect:{type:'4f',value:{x:0,y:0,z:0,w:0}},shadowSamples:{type:'1f',value:RELIEF_SHADOW_SAMPLES},detail:{type:'1f',value:1},
      albedoOn:{type:'1f',value:0}};
    const key=`city-relief-bake-${this.id}-${size}`;
    const shader=this.scene.add.shader(new Phaser.Display.BaseShader(`city-relief-${this.id}-${size}`,reliefShader,undefined,uniforms),
      0,0,w,h,[...this.keys,this.albedo?ALBEDO_KEY:ALBEDO_STAND_IN],SAMPLING).removeFromDisplayList();
    if(this.scene.textures.exists(key))this.scene.textures.remove(key);
    shader.setRenderToTexture(key);
    t={shader,key};this.targets.set(size,t);
    return t;
  }

  private dropTargets(){
    for(const t of this.targets.values()){t.shader.destroy();if(this.scene.textures.exists(t.key))this.scene.textures.remove(t.key);}
    this.targets.clear();
  }

  /** Frees the GPU side (scratch targets, textures, listener): the city layer's destroy, or the scene's shutdown. */
  release(){
    this.dropTargets();
    if(!this.live)return;
    for(const k of this.keys)if(this.scene.textures.exists(k))this.scene.textures.remove(k);
    this.renderer.off?.(Phaser.Renderer.Events.RESTORE_WEBGL,this.restore);
    this.live=false;
  }
}

/**
 * Mipmaps for a loaded texture (Phaser makes none): the bake draws the albedo at ~1 texel per 2–3 of the atlas, which
 * shimmers without them. The atlas is a power of two (scripts/chao-albedo.mjs), so WebGL1 can.
 */
function mipmap(renderer:Phaser.Renderer.WebGL.WebGLRenderer,texture:Phaser.Textures.Texture){
  const gl=renderer.gl,wrapper=texture.source[0]?.glTexture as unknown as {webGLTexture?:WebGLTexture}|undefined,t=wrapper?.webGLTexture;
  if(!gl||!t)return;
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.bindTexture(gl.TEXTURE_2D,null);
  // Phaser tracks the bound textures itself: let it bind again from scratch.
  (renderer as unknown as {resetTextures?:(all?:boolean)=>void}).resetTextures?.(true);
}

/** Whether a scene can bake relief (WebGL only; `?relevo=0` keeps the flat ground for comparisons). */
export function reliefEnabled(scene:Phaser.Scene,search=typeof location!=='undefined'?location.search:''):boolean{
  if(!(scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer))return false;
  return new URLSearchParams(search).get('relevo')!=='0';
}
export type {Rect};
