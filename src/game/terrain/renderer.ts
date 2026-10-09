import Phaser from 'phaser';
import {FIELD_SIZE,TerrainField,clamp} from './field.ts';
import {landShader,waterShader} from './shaders.ts';

const LAND={x:-1100,y:-240,width:2200,height:1650};
export class TerrainRenderer {
  private land:Phaser.GameObjects.Shader;
  private sea:Phaser.GameObjects.Shader;
  private ground:Phaser.GameObjects.Image;
  private water:Phaser.GameObjects.Image;
  private lastWater=-Infinity;
  constructor(private scene:Phaser.Scene,field:TerrainField){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=FIELD_SIZE;
    const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(FIELD_SIZE,FIELD_SIZE);
    for(let i=0;i<field.heights.length;i++){pixels.data[i*4]=Math.round(clamp((field.heights[i]+32)/160)*255);pixels.data[i*4+1]=Math.round(field.moisture[i]*255);pixels.data[i*4+3]=255;}
    ctx.putImageData(pixels,0,0);scene.textures.addCanvas('terrain-height',canvas);
    const uniforms={angle:{type:'1f',value:0},elapsed:{type:'1f',value:0},areaOrigin:{type:'2f',value:{x:LAND.x,y:LAND.y}},areaSize:{type:'2f',value:{x:LAND.width,y:LAND.height}}};
    const textures=['terrain-height','terrain-soil','terrain-bed'];
    const sampling={wrapS:'clamp_to_edge',wrapT:'clamp_to_edge',minFilter:'linear',magFilter:'linear',flipY:false};
    this.land=scene.add.shader(new Phaser.Display.BaseShader('terrain-land',landShader,undefined,uniforms),0,0,1024,768,textures,sampling).removeFromDisplayList();
    this.land.setRenderToTexture('terrain-land-cache');
    this.ground=scene.add.image(LAND.x,LAND.y,'terrain-land-cache').setFlipY(true).setOrigin(0).setDisplaySize(LAND.width,LAND.height).setDepth(-10000);
    this.sea=scene.add.shader(new Phaser.Display.BaseShader('terrain-water',waterShader,undefined,uniforms),0,0,256,192,textures,sampling).removeFromDisplayList();
    this.sea.setRenderToTexture('terrain-water-cache');
    this.water=scene.add.image(0,0,'terrain-water-cache').setFlipY(true).setOrigin(0).setDepth(-11000);
    scene.events.once('shutdown',()=>{this.land.destroy();this.sea.destroy();this.ground.destroy();this.water.destroy();scene.textures.remove('terrain-height');});
  }
  private bake(shader:Phaser.GameObjects.Shader){
    // Phaser 3.90 renders framebuffer shaders even when visible=false.
    // Keep them outside the display list and repaint only when requested.
    const renderer=this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    renderer.pipelines.clear();shader.load();shader.flush();renderer.pipelines.rebind();
  }
  view(angle:number){this.land.setUniform('angle.value',angle);this.sea.setUniform('angle.value',angle);this.bake(this.land);this.lastWater=-Infinity;}
  fit(){
    const camera=this.scene.cameras.main,w=camera.width/camera.zoom,h=camera.height/camera.zoom;
    const x=camera.scrollX+(camera.width-w)/2,y=camera.scrollY+(camera.height-h)/2;
    this.water.setPosition(x,y).setDisplaySize(w,h);
    this.sea.setUniform('areaOrigin.value',{x,y});this.sea.setUniform('areaSize.value',{x:w,y:h});this.lastWater=-Infinity;
  }
  update(time:number,reduced:boolean){if(Number.isFinite(this.lastWater)&&(reduced||time-this.lastWater<160))return;this.lastWater=time;this.sea.setUniform('elapsed.value',reduced?0:time/1000);this.bake(this.sea);}
}
