/**
 * Card jogo-mais-escuro: the world's exposure (render/light.ts EXPOSURE_BAND, exposeColor) drawn in Phaser's own sprite
 * pipeline, so every image, sprite, Graphics, text and particle of the canvas gets it per pixel, in the same draw: no
 * post pass (the canvas antialias stays) and no extra fill. Phaser's two default pipelines (Multi on the computer,
 * Mobile on phones, as its autoMobilePipeline picks) with one line before `gl_FragColor`. The HUD is DOM: untouched.
 */
import Phaser from 'phaser';
import {EXPOSURE_GLSL} from './light.ts';

export const EXPOSURE_PIPELINE='Exposicao';
let exposure=1;
/** The factor every exposure pipeline draws with from the next frame (Vignette.set, per map). */
export function setExposure(k:number){exposure=k;}
export const currentExposure=()=>exposure;

const patch=(frag:string)=>{
  const out=frag.replace('void main ()','uniform float uExposicao;\nvoid main ()').replace('gl_FragColor = color;',`${EXPOSURE_GLSL}\n    gl_FragColor = color;`);
  if(out===frag||!out.includes('uExposicao;')||!out.includes(EXPOSURE_GLSL))throw new Error('exposure: Phaser fragment shader changed');
  return out;
};
const Shaders=(Phaser.Renderer.WebGL as unknown as {Shaders:{MultiFrag:string;MobileFrag:string}}).Shaders;
const Pipelines=Phaser.Renderer.WebGL.Pipelines;

class ExposureMulti extends Pipelines.MultiPipeline {
  constructor(game:Phaser.Game){super({game,name:EXPOSURE_PIPELINE,fragShader:patch(Shaders.MultiFrag)} as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);}
  override onPreRender(){this.set1f('uExposicao',exposure);}
}
class ExposureMobile extends Pipelines.MobilePipeline {
  constructor(game:Phaser.Game){super({game,name:EXPOSURE_PIPELINE,fragShader:patch(Shaders.MobileFrag)} as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);}
  override onPreRender(){this.set1f('uExposicao',exposure);}
}

/**
 * Game config keys: the exposure pipeline as the default Game Object pipeline, Multi or Mobile as Phaser itself would
 * choose (autoMobilePipeline off, since it would replace the default with the plain Mobile one on phones).
 */
export function exposureGameConfig():Pick<Phaser.Types.Core.GameConfig,'pipeline'|'defaultPipeline'|'autoMobilePipeline'>{
  const desktop=(Phaser as unknown as {Device:{os:{desktop:boolean}}}).Device.os.desktop;
  return {pipeline:{[EXPOSURE_PIPELINE]:desktop?ExposureMulti:ExposureMobile} as unknown as Phaser.Types.Core.PipelineConfig,defaultPipeline:EXPOSURE_PIPELINE,autoMobilePipeline:false};
}
