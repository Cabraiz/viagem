/**
 * Card jogo-mais-escuro: the world's exposure (render/light.ts EXPOSURE_BAND, exposeColor) and the fog's cold sepia
 * grade (render/nevoa-rules.ts SEPIA_GLSL) drawn in Phaser's own sprite pipeline, so every image, sprite, Graphics,
 * text and particle of the canvas gets them per pixel, in the same draw: no post pass (the canvas antialias stays) and
 * no extra fill. Phaser's two default pipelines (Multi on the computer, Mobile on phones, as its autoMobilePipeline
 * picks) with two lines before `gl_FragColor`. The HUD is DOM: untouched.
 * The fog's own layers (render/nevoa.ts) draw with a second pipeline: the same shader plus the hole around the hero.
 */
import Phaser from 'phaser';
import {EXPOSURE_GLSL} from './light.ts';
import {FURO_GLSL,SEPIA_GLSL} from './nevoa-rules.ts';

export const EXPOSURE_PIPELINE='Exposicao',NEVOA_PIPELINE='Nevoa';
let exposure=1,sepia=0;
/** The factor every exposure pipeline draws with from the next frame (Vignette.set, per map). */
export function setExposure(k:number){exposure=k;}
export const currentExposure=()=>exposure;
/** The fog's sepia strength (render/nevoa.ts, per map and level). */
export function setSepia(s:number){sepia=s;}
export const currentSepia=()=>sepia;
const furo={x:-1e4,y:-1e4,r0:0,r1:0,floor:1};
/** The hole around the hero, in framebuffer pixels (gl_FragCoord: origin bottom left). */
export function setFuro(x:number,y:number,r0:number,r1:number,floor:number){furo.x=x;furo.y=y;furo.r0=r0;furo.r1=r1;furo.floor=floor;}

const insert=(frag:string,uniforms:string,glsl:string)=>{
  const out=frag.replace('void main ()',`${uniforms}\nvoid main ()`).replace('gl_FragColor = color;',`${glsl}\n    gl_FragColor = color;`);
  if(out===frag||!out.includes(uniforms)||!out.includes(glsl))throw new Error('exposure: Phaser fragment shader changed');
  return out;
};
const patch=(frag:string)=>insert(frag,'uniform float uExposicao;\nuniform float uSepia;',`${EXPOSURE_GLSL}\n    ${SEPIA_GLSL}`);
const patchFog=(frag:string)=>insert(patch(frag),'uniform vec2 uFuro;\nuniform vec2 uFuroRaio;\nuniform float uFuroFundo;',FURO_GLSL);
const Pipelines=Phaser.Renderer.WebGL.Pipelines;

/** Phaser's own fragment source of a default pipeline (built before the config ones; the Shaders are not exported). */
const fragOf=(game:Phaser.Game,name:string)=>((game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.get(name) as unknown as {shaders:{fragSrc:string}[]}).shaders[0]!.fragSrc;
type Uniforms={set1f(n:string,v:number):unknown;set2f(n:string,x:number,y:number):unknown};
const grade=(p:Uniforms)=>{p.set1f('uExposicao',exposure);p.set1f('uSepia',sepia);};
const hole=(p:Uniforms)=>{grade(p);p.set2f('uFuro',furo.x,furo.y);p.set2f('uFuroRaio',furo.r0,furo.r1);p.set1f('uFuroFundo',furo.floor);};
const config=(game:Phaser.Game,name:string,frag:string)=>({game,name,fragShader:frag} as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);

class ExposureMulti extends Pipelines.MultiPipeline {
  constructor(game:Phaser.Game){super(config(game,EXPOSURE_PIPELINE,patch(fragOf(game,'MultiPipeline'))));}
  override onPreRender(){grade(this);}
}
class ExposureMobile extends Pipelines.MobilePipeline {
  constructor(game:Phaser.Game){super(config(game,EXPOSURE_PIPELINE,patch(fragOf(game,'MobilePipeline'))));}
  override onPreRender(){grade(this);}
}
class NevoaMulti extends Pipelines.MultiPipeline {
  constructor(game:Phaser.Game){super(config(game,NEVOA_PIPELINE,patchFog(fragOf(game,'MultiPipeline'))));}
  override onPreRender(){hole(this);}
}
class NevoaMobile extends Pipelines.MobilePipeline {
  constructor(game:Phaser.Game){super(config(game,NEVOA_PIPELINE,patchFog(fragOf(game,'MobilePipeline'))));}
  override onPreRender(){hole(this);}
}

/**
 * Game config keys: the exposure pipeline as the default Game Object pipeline, Multi or Mobile as Phaser itself would
 * choose (autoMobilePipeline off, since it would replace the default with the plain Mobile one on phones), and the fog's.
 * Phaser runs `new Class(game)` at boot; the constructor returns the right one (the Device module is not on the Phaser
 * namespace).
 */
function ExposurePipeline(game:Phaser.Game){return game.device.os.desktop?new ExposureMulti(game):new ExposureMobile(game);}
function NevoaPipeline(game:Phaser.Game){return game.device.os.desktop?new NevoaMulti(game):new NevoaMobile(game);}
export function exposureGameConfig():Pick<Phaser.Types.Core.GameConfig,'pipeline'|'defaultPipeline'|'autoMobilePipeline'>{
  return {pipeline:{[EXPOSURE_PIPELINE]:ExposurePipeline,[NEVOA_PIPELINE]:NevoaPipeline} as unknown as Phaser.Types.Core.PipelineConfig,defaultPipeline:EXPOSURE_PIPELINE,autoMobilePipeline:false};
}
