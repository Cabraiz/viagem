import Phaser from 'phaser';
import {FIELD_MIN,FIELD_SIZE,FIELD_STEP,TerrainField,clamp} from '../../maps/terrain/field.ts';
import {landShader,waterShader} from './shaders.ts';
import {waterCacheSize} from './water-size.ts';
import type {ChunkWorld} from '../../maps/terrain/chunks.ts';
import {ENDLESS_MAX_HEIGHT,FIELD_STEP as TILE_FIELD_STEP,FIELD_TEXELS,TILE_PX,TILE_TEXELS,WATER_TEXELS,
  fieldChunks,fieldOrigin,fillField,inRange,tileRange,type Rect,type TileId} from './tiles.ts';
import {BANDS,TilePool,type PoolBackend,type PoolSlot,type PoolStats} from './tile-pool.ts';

type Renderer=Phaser.Renderer.WebGL.WebGLRenderer;
type GLTexture=Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;
type GLFramebuffer=Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper;

/** What the scene asks of the ground, island or endless world. */
export interface TerrainLayer {
  /** A view turn (90° steps): everything is baked again. */
  view(angle:number):void;
  /** After a resize or a turn: cover the camera now. `margin`: share of the view baked around it (island water). */
  fit(margin?:number):void;
  /**
   * Every frame after the camera moved: keep the camera covered (cheap when nothing changes). `focus`: where the hero
   * (or the followed teammate) stands, in world px: its ground is never left for a later frame.
   */
  follow(margin?:number,focus?:{x:number;y:number}):void;
  /** Every frame: the water animation. */
  update(time:number,reduced:boolean):void;
}
export function createTerrain(scene:Phaser.Scene,field:TerrainField):TerrainLayer{
  return field.chunks?new ChunkTerrainRenderer(scene,field.chunks):new TerrainRenderer(scene,field);
}

const SAMPLING={wrapS:'clamp_to_edge',wrapT:'clamp_to_edge',minFilter:'linear',magFilter:'linear',flipY:false};
/** Water animation step (ms): the shader is baked again at most this often (it never runs per frame). */
const WATER_MS=160;
/** Camera view in world px (the follow camera zooms around its centre). */
function cameraView(scene:Phaser.Scene):Rect{
  const camera=scene.cameras.main,w=camera.width/camera.zoom,h=camera.height/camera.zoom;
  return {x:camera.scrollX+(camera.width-w)/2,y:camera.scrollY+(camera.height-h)/2,w,h};
}
/**
 * Renders a framebuffer shader once, outside the display list. `prepare` runs with the pipelines cleared (uniforms,
 * texture uploads). Several bakes in one frame go through one clear/rebind (`batch`).
 */
class Baker {
  private depth=0;
  constructor(private scene:Phaser.Scene){}
  private get renderer(){return this.scene.game.renderer as Renderer;}
  batch(run:()=>void){
    const renderer=this.renderer;
    if(!this.depth++)renderer.pipelines.clear();
    try{run();}finally{if(!--this.depth)renderer.pipelines.rebind();}
  }
  /** `rows`: only these framebuffer rows [from, to) are drawn (scissor), so a big bake can be spread over frames. */
  bake(shader:Phaser.GameObjects.Shader,prepare?:()=>void,rows?:{from:number;to:number}){
    this.batch(()=>{
      // Phaser 3.90 renders framebuffer shaders even when visible=false: they stay outside the display list and are
      // drawn only when asked. Phaser binds a shader's own framebuffer with the *canvas* viewport (that framebuffer has
      // no renderTexture), so on a phone canvas smaller than the cache only a corner was painted: bind it first with
      // the cache's viewport (flush() then finds it bound and keeps it). The canvas-sized scissor box clips it the same
      // way, so the scissor test is off for this one draw.
      const renderer=this.renderer,gl=renderer.gl;
      prepare?.();shader.load();
      const scissor=gl.isEnabled(gl.SCISSOR_TEST);
      renderer.setFramebuffer(shader.framebuffer);gl.viewport(0,0,shader.width,shader.height);
      // flush() clears before it draws, and the clear obeys the scissor too: the other rows keep what they had.
      if(rows){gl.enable(gl.SCISSOR_TEST);gl.scissor(0,rows.from,shader.width,rows.to-rows.from);}else gl.disable(gl.SCISSOR_TEST);
      shader.flush();
      gl.viewport(0,0,renderer.width,renderer.height);
      if(scissor)renderer.resetScissor();else gl.disable(gl.SCISSOR_TEST);
    });
  }
}

const LAND={x:-1100,y:-240,width:2200,height:1650};
/** The island: one bake of the whole map (1024×768) and the water over the camera view. */
export class TerrainRenderer implements TerrainLayer {
  private land:Phaser.GameObjects.Shader;
  private sea:Phaser.GameObjects.Shader;
  private ground:Phaser.GameObjects.Image;
  private water:Phaser.GameObjects.Image;
  private lastWater=-Infinity;
  private angle=0;
  private area={x:0,y:0,w:1,h:1};
  private seaKey='';
  private baker:Baker;
  private readonly textures=['terrain-height','terrain-soil','terrain-bed'];
  private readonly uniforms={angle:{type:'1f',value:0},elapsed:{type:'1f',value:0},areaOrigin:{type:'2f',value:{x:LAND.x,y:LAND.y}},areaSize:{type:'2f',value:{x:LAND.width,y:LAND.height}},
    fieldOrigin:{type:'2f',value:{x:FIELD_MIN,y:FIELD_MIN}},fieldStep:{type:'1f',value:FIELD_STEP},fieldSize:{type:'1f',value:FIELD_SIZE},maxHeight:{type:'1f',value:128},endless:{type:'1f',value:0},steps:{type:'1f',value:18}};
  constructor(private scene:Phaser.Scene,field:TerrainField){
    this.baker=new Baker(scene);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=FIELD_SIZE;
    const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(FIELD_SIZE,FIELD_SIZE);
    for(let i=0;i<field.heights.length;i++){pixels.data[i*4]=Math.round(clamp((field.heights[i]+32)/160)*255);pixels.data[i*4+1]=Math.round(field.moisture[i]*255);pixels.data[i*4+3]=255;}
    ctx.putImageData(pixels,0,0);scene.textures.addCanvas('terrain-height',canvas);
    const {uniforms,textures}=this;
    this.land=scene.add.shader(new Phaser.Display.BaseShader('terrain-land',landShader,undefined,uniforms),0,0,1024,768,textures,SAMPLING).removeFromDisplayList();
    this.land.setRenderToTexture('terrain-land-cache');
    this.ground=scene.add.image(LAND.x,LAND.y,'terrain-land-cache').setFlipY(true).setOrigin(0).setDisplaySize(LAND.width,LAND.height).setDepth(-10000);
    const size=waterCacheSize(scene.scale.width,scene.scale.height);
    this.sea=this.makeSea(size.width,size.height);
    this.water=scene.add.image(0,0,this.seaKey).setFlipY(true).setOrigin(0).setDepth(-11000);
    // A lost WebGL context comes back with empty render targets: bake the ground and the water again.
    const renderer=scene.game.renderer as Renderer,restore=()=>this.view(this.angle);
    renderer.on?.(Phaser.Renderer.Events.RESTORE_WEBGL,restore);
    scene.events.once('shutdown',()=>{renderer.off?.(Phaser.Renderer.Events.RESTORE_WEBGL,restore);this.land.destroy();this.sea.destroy();this.ground.destroy();this.water.destroy();scene.textures.remove('terrain-height');});
  }
  /** Water cache shader (render target) of w×h texels, with the current uniforms. */
  private makeSea(w:number,h:number){
    const sea=this.scene.add.shader(new Phaser.Display.BaseShader('terrain-water',waterShader,undefined,this.uniforms),0,0,w,h,this.textures,SAMPLING).removeFromDisplayList();
    this.seaKey=`terrain-water-cache-${w}x${h}`;
    if(this.scene.textures.exists(this.seaKey))this.scene.textures.remove(this.seaKey);
    sea.setRenderToTexture(this.seaKey);
    sea.setUniform('angle.value',this.angle);sea.setUniform('areaOrigin.value',{x:this.area.x,y:this.area.y});sea.setUniform('areaSize.value',{x:this.area.w,y:this.area.h});
    return sea;
  }
  /** Rebuilds the water cache when the view's shape asks for another size (phone turned, window resized). */
  private resizeSea(){
    const size=waterCacheSize(this.scene.scale.width,this.scene.scale.height,1+2*this.margin);
    if(size.width===this.sea.width&&size.height===this.sea.height)return;
    const old=this.sea;this.sea=this.makeSea(size.width,size.height);this.water.setTexture(this.seaKey);old.destroy();
  }
  view(angle:number){this.angle=angle;this.land.setUniform('angle.value',angle);this.sea.setUniform('angle.value',angle);this.baker.bake(this.land);this.lastWater=-Infinity;}
  private margin=0;
  /**
   * Bakes the water over the camera view. The follow camera (camera-segue) passes a margin so it can move before a new
   * bake; the cache grows with it (same texel per CSS px, no blur from the margin).
   */
  fit(margin=0){
    const v=cameraView(this.scene),mx=v.w*margin,my=v.h*margin,x=v.x-mx,y=v.y-my,w=v.w+2*mx,h=v.h+2*my;
    this.margin=margin;this.area={x,y,w,h};this.resizeSea();
    this.water.setPosition(x,y).setDisplaySize(w,h);
    this.sea.setUniform('areaOrigin.value',{x,y});this.sea.setUniform('areaSize.value',{x:w,y:h});this.lastWater=-Infinity;
  }
  /** Whether the last water bake still covers the whole camera view. */
  covers(){const v=cameraView(this.scene),a=this.area;return v.x>=a.x&&v.y>=a.y&&v.x+v.w<=a.x+a.w&&v.y+v.h<=a.y+a.h;}
  follow(margin=0){if(!this.covers())this.fit(margin);}
  update(time:number,reduced:boolean){if(Number.isFinite(this.lastWater)&&(reduced||time-this.lastWater<WATER_MS))return;this.lastWater=time;this.sea.setUniform('elapsed.value',reduced?0:time/1000);this.baker.bake(this.sea);}
}

/** A render target: its texture (in the Texture Manager under `key`), framebuffer and image. */
interface Target {key:string;texture:GLTexture;framebuffer:GLFramebuffer;image:Phaser.GameObjects.Image}
interface Slot extends Target,PoolSlot {
  /** Height texture of the tile (kept for the water re-bakes), its origin on the global lattice, whether it holds a lake. */
  field:Uint8Array;origin:{x:number;y:number};wet:boolean;
  water?:Target;
}
/**
 * Render targets made with the scene: making one later means a framebuffer status check, a full round trip to the GPU
 * process that waits for everything queued (hundreds of ms on a busy phone, measured in the lab). 60 covers the ring
 * of a 390×844 or 844×390 phone at the follow zoom (6×9 tiles) with room to spare, and 24 water layers (a lake spans 2-4
 * tiles; lab seeds showed up to 20 in the ring); a bigger screen or a lake district grows the pool once.
 */
const POOL_TILES=60,POOL_WATER=24;
/** Bisection steps over ENDLESS_MAX_HEIGHT: 40/2¹² ≈ 0.01 px of height, the island's 128/2¹⁸ is 0.0005. */
const ENDLESS_STEPS=12;
/** Measurements for the lab and the done/ report (probe in dev). */
export interface TerrainStats extends PoolStats {water:number;waterBakes:number;followMs:number;maxFollowMs:number;maxFillMs:number;maxBakeMs:number;maxLatticeMs:number}

/**
 * Endless world (D-019, terreno-em-blocos): the ground in TILE_PX tiles of screen around the camera, each baked once into
 * a TILE_TEXELS² render target from a pool (tile-pool.ts decides which tile, when and how many bands), with a water layer
 * (WATER_TEXELS²) only under the tiles that hold a lake.
 */
export class ChunkTerrainRenderer implements TerrainLayer,PoolBackend<Slot> {
  private land:Phaser.GameObjects.Shader;
  private sea:Phaser.GameObjects.Shader;
  private baker:Baker;
  private pool:TilePool<Slot>;
  private spareWater:Target[]=[];
  private waterCount=0;
  private lastWater=-Infinity;
  /** `elapsed` of the last water bake (0 with reduced motion): every water layer on screen shows the same instant. */
  private waterElapsed=0;
  private fieldData=new Uint8Array(FIELD_TEXELS*FIELD_TEXELS*4);
  private ownLand:GLFramebuffer;
  private ownSea:GLFramebuffer;
  private counter=0;
  private timing={followMs:0,maxFollowMs:0,maxFillMs:0,maxBakeMs:0,maxLatticeMs:0,waterBakes:0};
  private readonly textures=['terrain-tile-field','terrain-soil','terrain-bed'];
  get stats():TerrainStats{return {...this.pool.stats,...this.timing,water:this.waterCount};}
  private uniforms(){
    return {angle:{type:'1f',value:0},elapsed:{type:'1f',value:0},areaOrigin:{type:'2f',value:{x:0,y:0}},areaSize:{type:'2f',value:{x:TILE_PX,y:TILE_PX}},
      fieldOrigin:{type:'2f',value:{x:0,y:0}},fieldStep:{type:'1f',value:TILE_FIELD_STEP},fieldSize:{type:'1f',value:FIELD_TEXELS},maxHeight:{type:'1f',value:ENDLESS_MAX_HEIGHT},endless:{type:'1f',value:1},steps:{type:'1f',value:ENDLESS_STEPS}};
  }
  constructor(private scene:Phaser.Scene,private world:ChunkWorld){
    this.baker=new Baker(scene);
    scene.textures.addUint8Array('terrain-tile-field',this.fieldData,FIELD_TEXELS,FIELD_TEXELS);
    this.land=scene.add.shader(new Phaser.Display.BaseShader('terrain-tile-land',landShader,undefined,this.uniforms()),0,0,TILE_TEXELS,TILE_TEXELS,this.textures,SAMPLING).removeFromDisplayList();
    this.land.setRenderToTexture('terrain-tile-land-own');
    this.sea=scene.add.shader(new Phaser.Display.BaseShader('terrain-tile-water',waterShader,undefined,this.uniforms()),0,0,WATER_TEXELS,WATER_TEXELS,this.textures,SAMPLING).removeFromDisplayList();
    this.sea.setRenderToTexture('terrain-tile-water-own');
    // The shaders' own framebuffers are only swapped out while a tile is baked; they go back before destroy().
    this.ownLand=this.land.framebuffer!;this.ownSea=this.sea.framebuffer!;
    this.pool=new TilePool<Slot>(this,POOL_TILES);
    for(let i=0;i<POOL_WATER;i++)this.spareWater.push(this.target(WATER_TEXELS,-11000,'terrain-tile-water'));
    const renderer=scene.game.renderer as Renderer,restore=()=>{this.pool.invalidate();this.lastWater=-Infinity;};
    renderer.on?.(Phaser.Renderer.Events.RESTORE_WEBGL,restore);
    scene.events.once('shutdown',()=>{
      renderer.off?.(Phaser.Renderer.Events.RESTORE_WEBGL,restore);
      for(const s of this.pool.destroy())this.dropTarget(s);
      for(const t of this.spareWater)this.dropTarget(t);
      this.spareWater=[];
      this.land.framebuffer=this.ownLand;this.sea.framebuffer=this.ownSea;
      this.land.destroy();this.sea.destroy();scene.textures.remove('terrain-tile-field');
    });
  }
  private target(size:number,depth:number,prefix:string):Target{
    const renderer=this.scene.game.renderer as Renderer,key=`${prefix}-${this.counter++}`;
    // Clamped (a POT texture would REPEAT and bleed the far edge into the near one: a seam on every tile border).
    const texture=renderer.createTextureFromSource(null as unknown as object,size,size,Phaser.ScaleModes.LINEAR,true)!;
    const framebuffer=renderer.createFramebuffer(size,size,texture,false);
    this.scene.textures.addGLTexture(key,texture);
    const image=this.scene.add.image(0,0,key).setOrigin(0).setFlipY(true).setDisplaySize(TILE_PX,TILE_PX).setDepth(depth).setVisible(false);
    return {key,texture,framebuffer,image};
  }
  private dropTarget(t:Target){
    t.image.destroy();(this.scene.game.renderer as Renderer).deleteFramebuffer(t.framebuffer);this.scene.textures.remove(t.key);
  }
  // ---- PoolBackend ----
  create():Slot{return {...this.target(TILE_TEXELS,-10000,'terrain-tile'),baked:-1,pending:-1,band:0,shown:false,field:new Uint8Array(FIELD_TEXELS*FIELD_TEXELS*4),origin:{x:0,y:0},wet:false};}
  ready(t:TileId,angle:number,urgent:boolean){
    for(const c of fieldChunks(fieldOrigin(t,angle)))if(!this.world.hasLattice(c.ix,c.iy)){
      const t0=performance.now();this.world.lattice(c.ix,c.iy);this.timing.maxLatticeMs=Math.max(this.timing.maxLatticeMs,performance.now()-t0);
      if(!urgent)return false;
    }
    return true;
  }
  start(s:Slot,t:TileId,angle:number){
    const o=fieldOrigin(t,angle),t0=performance.now();
    s.origin={x:o.x,y:o.y};s.wet=fillField(this.world,s.origin,s.field);
    this.timing.maxFillMs=Math.max(this.timing.maxFillMs,performance.now()-t0);
  }
  bands(s:Slot,from:number,to:number){
    const t=s.tile!,rows=TILE_TEXELS/BANDS,t0=performance.now();
    this.baker.bake(this.land,()=>this.prepare(this.land,s,t.ix*TILE_PX,t.iy*TILE_PX),from===0&&to===BANDS?undefined:{from:from*rows,to:to*rows});
    this.land.framebuffer=this.ownLand;
    this.timing.maxBakeMs=Math.max(this.timing.maxBakeMs,performance.now()-t0);
  }
  finish(s:Slot){
    const x=s.tile!.ix*TILE_PX,y=s.tile!.iy*TILE_PX;
    s.image.setPosition(x,y);
    if(s.wet){
      if(!s.water){s.water=this.spareWater.pop()??this.target(WATER_TEXELS,-11000,'terrain-tile-water');this.waterCount++;}
      s.water.image.setPosition(x,y).setVisible(s.shown);
      this.bakeWater(s,this.waterElapsed);
    }else this.dropWater(s);
  }
  release(s:Slot){this.dropWater(s);}
  show(s:Slot,on:boolean){
    s.image.setVisible(on);
    if(!s.water)return;
    s.water.image.setVisible(on);
    // A ring tile baked a while ago comes into view: its water joins the neighbours' instant now, not 160 ms later.
    if(on)this.bakeWater(s,this.waterElapsed);
  }
  private dropWater(s:Slot){if(s.water){s.water.image.setVisible(false);this.spareWater.push(s.water);s.water=undefined;this.waterCount--;}}
  // ---- TerrainLayer ----
  /** A turn: every tile is stale; the scene's fit() right after (camera back on the hero) bakes the new view. */
  view(angle:number){this.pool.invalidate(angle);this.land.setUniform('angle.value',angle);this.sea.setUniform('angle.value',angle);this.lastWater=-Infinity;}
  /** First frame, resize, turn: every visible tile now. */
  fit(){this.run(true);}
  follow(_margin?:number,focus?:{x:number;y:number}){this.run(false,focus);}
  private run(whole:boolean,focus?:{x:number;y:number}){
    const start=performance.now();
    this.pool.update(cameraView(this.scene),{whole,focus});
    const ms=performance.now()-start;this.timing.followMs=ms;this.timing.maxFollowMs=Math.max(this.timing.maxFollowMs,ms);
  }
  /** Uniforms and height texture of one tile, with the pipelines cleared (Baker.bake). */
  private prepare(shader:Phaser.GameObjects.Shader,s:Slot,x:number,y:number){
    this.fieldData.set(s.field);
    shader.setUniform('areaOrigin.value',{x,y});shader.setUniform('fieldOrigin.value',s.origin);
    // Uploads fieldData (the texture's own pixels) again: one 4 KB texture shared by every bake.
    shader.setChannel0('terrain-tile-field',SAMPLING);
    shader.framebuffer=shader===this.land?s.framebuffer:s.water!.framebuffer;
  }
  private bakeWater(s:Slot,elapsed:number){
    if(!s.water||!s.tile)return;
    this.sea.setUniform('elapsed.value',elapsed);
    this.baker.bake(this.sea,()=>this.prepare(this.sea,s,s.tile!.ix*TILE_PX,s.tile!.iy*TILE_PX));
    this.sea.framebuffer=this.ownSea;this.timing.waterBakes++;
  }
  /** Water animation: only the tiles on screen with a lake, every WATER_MS (once with reduced motion). */
  update(time:number,reduced:boolean){
    if(!this.waterCount||(Number.isFinite(this.lastWater)&&(reduced||time-this.lastWater<WATER_MS)))return;
    this.lastWater=time;
    const visible=tileRange(cameraView(this.scene)),at=this.waterElapsed=reduced?0:time/1000;
    this.baker.batch(()=>{for(const s of this.pool.slots)if(s.water&&s.tile&&s.baked===this.pool.angle&&inRange(s.tile,visible))this.bakeWater(s,at);});
  }
}
