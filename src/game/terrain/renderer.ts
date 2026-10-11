import Phaser from 'phaser';
import {FIELD_SIZE,TerrainField,clamp} from './field.ts';
import {landShader,waterShader} from './shaders.ts';
import {waterCacheSize} from './water-size.ts';

const LAND={x:-1100,y:-240,width:2200,height:1650};
export class TerrainRenderer {
  private land:Phaser.GameObjects.Shader;
  private sea:Phaser.GameObjects.Shader;
  private ground:Phaser.GameObjects.Image;
  private water:Phaser.GameObjects.Image;
  private lastWater=-Infinity;
  private angle=0;
  private area={x:0,y:0,w:1,h:1};
  private seaKey='';
  private readonly textures=['terrain-height','terrain-soil','terrain-bed'];
  private readonly sampling={wrapS:'clamp_to_edge',wrapT:'clamp_to_edge',minFilter:'linear',magFilter:'linear',flipY:false};
  private readonly uniforms={angle:{type:'1f',value:0},elapsed:{type:'1f',value:0},areaOrigin:{type:'2f',value:{x:LAND.x,y:LAND.y}},areaSize:{type:'2f',value:{x:LAND.width,y:LAND.height}}};
  constructor(private scene:Phaser.Scene,field:TerrainField){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=FIELD_SIZE;
    const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(FIELD_SIZE,FIELD_SIZE);
    for(let i=0;i<field.heights.length;i++){pixels.data[i*4]=Math.round(clamp((field.heights[i]+32)/160)*255);pixels.data[i*4+1]=Math.round(field.moisture[i]*255);pixels.data[i*4+3]=255;}
    ctx.putImageData(pixels,0,0);scene.textures.addCanvas('terrain-height',canvas);
    const {uniforms,textures,sampling}=this;
    this.land=scene.add.shader(new Phaser.Display.BaseShader('terrain-land',landShader,undefined,uniforms),0,0,1024,768,textures,sampling).removeFromDisplayList();
    this.land.setRenderToTexture('terrain-land-cache');
    this.ground=scene.add.image(LAND.x,LAND.y,'terrain-land-cache').setFlipY(true).setOrigin(0).setDisplaySize(LAND.width,LAND.height).setDepth(-10000);
    const size=waterCacheSize(scene.scale.width,scene.scale.height);
    this.sea=this.makeSea(size.width,size.height);
    this.water=scene.add.image(0,0,this.seaKey).setFlipY(true).setOrigin(0).setDepth(-11000);
    // A lost WebGL context comes back with empty render targets: bake the ground and the water again.
    const renderer=scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer,restore=()=>this.view(this.angle);
    renderer.on?.(Phaser.Renderer.Events.RESTORE_WEBGL,restore);
    scene.events.once('shutdown',()=>{renderer.off?.(Phaser.Renderer.Events.RESTORE_WEBGL,restore);this.land.destroy();this.sea.destroy();this.ground.destroy();this.water.destroy();scene.textures.remove('terrain-height');});
  }
  /** Water cache shader (render target) of w×h texels, with the current uniforms. */
  private makeSea(w:number,h:number){
    const sea=this.scene.add.shader(new Phaser.Display.BaseShader('terrain-water',waterShader,undefined,this.uniforms),0,0,w,h,this.textures,this.sampling).removeFromDisplayList();
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
  private bake(shader:Phaser.GameObjects.Shader){
    // Phaser 3.90 renders framebuffer shaders even when visible=false.
    // Keep them outside the display list and repaint only when requested.
    const renderer=this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    renderer.pipelines.clear();shader.load();
    // Phaser binds a shader's own framebuffer with the *canvas* viewport (that framebuffer has no renderTexture), so on
    // a phone canvas smaller than the 1024×768 cache only a corner of the island was painted and the rest showed sea.
    // Bind it first with the cache's viewport; flush() then finds it bound and keeps the viewport.
    // The canvas-sized scissor box clips it the same way, so the scissor test is off for this one draw.
    const gl=renderer.gl,scissor=gl.isEnabled(gl.SCISSOR_TEST);
    renderer.setFramebuffer(shader.framebuffer);gl.viewport(0,0,shader.width,shader.height);gl.disable(gl.SCISSOR_TEST);
    shader.flush();
    gl.viewport(0,0,renderer.width,renderer.height);if(scissor)gl.enable(gl.SCISSOR_TEST);
    renderer.pipelines.rebind();
  }
  view(angle:number){this.angle=angle;this.land.setUniform('angle.value',angle);this.sea.setUniform('angle.value',angle);this.bake(this.land);this.lastWater=-Infinity;}
  private margin=0;
  private view_(){
    const camera=this.scene.cameras.main,w=camera.width/camera.zoom,h=camera.height/camera.zoom;
    return {x:camera.scrollX+(camera.width-w)/2,y:camera.scrollY+(camera.height-h)/2,w,h};
  }
  /**
   * Bakes the water over the camera view. The follow camera (camera-segue) passes a margin so it can move before a new
   * bake; the cache grows with it (same texel per CSS px, no blur from the margin).
   */
  fit(margin=0){
    const v=this.view_(),mx=v.w*margin,my=v.h*margin,x=v.x-mx,y=v.y-my,w=v.w+2*mx,h=v.h+2*my;
    this.margin=margin;this.area={x,y,w,h};this.resizeSea();
    this.water.setPosition(x,y).setDisplaySize(w,h);
    this.sea.setUniform('areaOrigin.value',{x,y});this.sea.setUniform('areaSize.value',{x:w,y:h});this.lastWater=-Infinity;
  }
  /** Whether the last water bake still covers the whole camera view. */
  covers(){const v=this.view_(),a=this.area;return v.x>=a.x&&v.y>=a.y&&v.x+v.w<=a.x+a.w&&v.y+v.h<=a.y+a.h;}
  update(time:number,reduced:boolean){if(Number.isFinite(this.lastWater)&&(reduced||time-this.lastWater<160))return;this.lastWater=time;this.sea.setUniform('elapsed.value',reduced?0:time/1000);this.bake(this.sea);}
}
