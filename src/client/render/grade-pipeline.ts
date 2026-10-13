/**
 * The one-pass colour grade and vignette of the lighting card (render/light.ts GRADE_FRAG): a Phaser post pipeline on
 * the main camera, so it costs one full-screen draw. Only on WebGL and with the light on (`?luz=0` skips it).
 */
import Phaser from 'phaser';
import {GRADE_FRAG,GRADES,lightEnabled,type Grade,type LightWorld} from './light.ts';

export const GRADE_PIPELINE='viagem-grade';

export class GradePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  grade:Grade=GRADES.infinito;
  vignette=true;
  constructor(game:Phaser.Game){super({game,name:GRADE_PIPELINE,fragShader:GRADE_FRAG});}
  onPreRender(){
    const g=this.grade;
    this.set3f('uCool',g.cool[0],g.cool[1],g.cool[2]);
    this.set3f('uWarm',g.warm[0],g.warm[1],g.warm[2]);
    this.set1f('uContrast',g.contrast);
    this.set1f('uPivot',g.pivot);
    this.set1f('uVignette',this.vignette?g.vignette:0);
  }
}

/** Mounts the grade on the scene's main camera; undefined on canvas or with `?luz=0`. */
export function mountGrade(scene:Phaser.Scene,search?:string):{set(world:LightWorld,economy:boolean):void}|undefined{
  const renderer=scene.game.renderer;
  if(!lightEnabled(search)||!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer))return undefined;
  if(!renderer.pipelines.postPipelineClasses.has(GRADE_PIPELINE))renderer.pipelines.addPostPipeline(GRADE_PIPELINE,GradePipeline);
  scene.cameras.main.setPostPipeline(GRADE_PIPELINE);
  const pipe=()=>{const p=scene.cameras.main.getPostPipeline(GRADE_PIPELINE);return (Array.isArray(p)?p[0]:p) as GradePipeline|undefined;};
  return {set(world,economy){const p=pipe();if(p){p.grade=GRADES[world];p.vignette=!economy;}}};
}
