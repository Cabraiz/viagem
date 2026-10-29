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
const Pipelines=Phaser.Renderer.WebGL.Pipelines;

/** Phaser's own fragment source of a default pipeline (built before the config ones; the Shaders are not exported). */
const fragOf=(game:Phaser.Game,name:string)=>((game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.get(name) as unknown as {shaders:{fragSrc:string}[]}).shaders[0]!.fragSrc;

class ExposureMulti extends Pipelines.MultiPipeline {
  constructor(game:Phaser.Game){super({game,name:EXPOSURE_PIPELINE,fragShader:patch(fragOf(game,'MultiPipeline'))} as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);}
  override onPreRender(){this.set1f('uExposicao',exposure);}
}
class ExposureMobile extends Pipelines.MobilePipeline {
  constructor(game:Phaser.Game){super({game,name:EXPOSURE_PIPELINE,fragShader:patch(fragOf(game,'MobilePipeline'))} as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);}
  override onPreRender(){this.set1f('uExposicao',exposure);}
}

/**
 * Game config keys: the exposure pipeline as the default Game Object pipeline, Multi or Mobile as Phaser itself would
 * choose (autoMobilePipeline off, since it would replace the default with the plain Mobile one on phones). Phaser runs
 * `new Class(game)` at boot; the constructor returns the right one (the Device module is not on the Phaser namespace).
 */
function ExposurePipeline(game:Phaser.Game){return game.device.os.desktop?new ExposureMulti(game):new ExposureMobile(game);}
export function exposureGameConfig():Pick<Phaser.Types.Core.GameConfig,'pipeline'|'defaultPipeline'|'autoMobilePipeline'>{
  return {pipeline:{[EXPOSURE_PIPELINE]:ExposurePipeline} as unknown as Phaser.Types.Core.PipelineConfig,defaultPipeline:EXPOSURE_PIPELINE,autoMobilePipeline:false};
}
