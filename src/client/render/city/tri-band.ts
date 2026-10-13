/**
 * A Graphics frozen into triangles, for the city's static drawings: block bands, fountain glints and procedural props
 * (card cidade-03, performance). Phaser 3.90 replays a Graphics' commands every frame (earcut per fillPoints, a quad
 * per stroke segment, ~100-point arcs per circle) and draws it even off camera. A TriBand is drawn with the normal
 * Graphics API once, then, under WebGL, Phaser's own Graphics renderer is run ONE time against a recording pipeline
 * with an identity matrix (tris.ts MeshBuilder) and the commands are dropped. Each frame it only transforms the stored
 * triangles with the same matrix and writes them as MultiPipeline.batchTri does (same tint packing, tint effect 2,
 * texture unit), and skips itself when its bounds are off camera: the pixels match the Graphics path.
 * It stays a Graphics (depth, alpha, visibility, position, destroy, display-list sorting all unchanged); under Canvas
 * it simply keeps its commands and renders as a normal Graphics.
 */
import Phaser from 'phaser';
import {MeshBuilder,meshBytes,meshOnScreen,segmentOnScreen,type TriMesh} from './tris.ts';

/** Off-camera margin in px (antialiasing reaches past the vertices by under a pixel). */
const CULL_MARGIN=2;

type Matrix=Phaser.GameObjects.Components.TransformMatrix;
interface BatchPipeline {
  vertexViewF32:Float32Array;vertexViewU32:Uint32Array;vertexCount:number;vertexCapacity:number;
  currentBatch:{start:number;count:number}|null;currentUnit:number;currentShader:{vertexComponentCount:number};
  flush():void;setTexture2D():number;
}
type GraphicsRender=(renderer:unknown,src:Phaser.GameObjects.Graphics,camera:unknown,parentMatrix?:Matrix)=>void;

const tintOf=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha;

/**
 * Counters for measurements: renders skipped off camera / drawn and triangles written (running totals), and the
 * frozen meshes alive with their triangles and bytes.
 */
export const TRI_STATS={culled:0,drawn:0,triangles:0,meshes:0,meshTriangles:0,meshBytes:0};

/**
 * Runs Phaser's Graphics WebGL renderer once on `g` (at the origin, alpha 1) against a pipeline that records triangles
 * instead of batching them. getTintAppendFloatAlpha is swapped for the call so each triangle keeps its exact
 * (colour, alpha) style rather than a packed tint: the per-frame tint is then packed from style alpha × object alpha,
 * the same product the Graphics renderer packs.
 */
function capture(g:Phaser.GameObjects.Graphics,out:MeshBuilder){
  const Pipelines=Phaser.Renderer.WebGL.Pipelines as unknown as {MultiPipeline:{prototype:object}};
  const TM=Phaser.GameObjects.Components.TransformMatrix;
  const rec=Object.create(Pipelines.MultiPipeline.prototype) as Record<string,unknown>;
  const renderer={pipelines:{set:()=>rec,preBatch:()=>{},postBatch:()=>{}}};
  Object.assign(rec,{
    renderer,calcMatrix:new TM(),_tempMatrix1:new TM(),_tempMatrix2:new TM(),_tempMatrix3:new TM(),
    strokeTint:{TL:0,TR:0,BL:0,BR:0},fillTint:{TL:0,TR:0,BL:0,BR:0},currentFrame:{u0:0,v0:0,u1:1,v1:1},
    firstQuad:[0,0,0,0,0],prevQuad:[0,0,0,0,0],polygonCache:[],
    tempTriangle:[{x:0,y:0,width:0},{x:0,y:0,width:0},{x:0,y:0,width:0},{x:0,y:0,width:0}],
    batchTri:(_o:unknown,x0:number,y0:number,x1:number,y1:number,x2:number,y2:number,_u0:number,_v0:number,_u1:number,_v1:number,t:number)=>{
      out.tri(t,x0,y0,x1,y1,x2,y2);return false;
    },
    // batchQuad writes (0,1,2) and (0,2,3).
    batchQuad:(_o:unknown,x0:number,y0:number,x1:number,y1:number,x2:number,y2:number,x3:number,y3:number,_u0:number,_v0:number,_u1:number,_v1:number,t:number)=>{
      out.tri(t,x0,y0,x1,y1,x2,y2);out.tri(t,x0,y0,x2,y2,x3,y3);return false;
    },
  });
  const camera={alpha:1,matrix:new TM(),scrollX:0,scrollY:0,addToRenderList:()=>{}};
  const utils=Phaser.Renderer.WebGL.Utils as unknown as {getTintAppendFloatAlpha:(rgb:number,a:number)=>number};
  const pack=utils.getTintAppendFloatAlpha;
  const {x,y,alpha}=g;
  g.setPosition(0,0).setAlpha(1);
  utils.getTintAppendFloatAlpha=(rgb,a)=>out.style(rgb,a);
  try{(Phaser.GameObjects.Graphics.prototype as unknown as {renderWebGL:GraphicsRender}).renderWebGL(renderer,g,camera);}
  finally{utils.getTintAppendFloatAlpha=pack;g.setPosition(x,y).setAlpha(alpha);}
}

/**
 * The replay writes Phaser 3.90 MultiPipeline vertices by hand and records through private renderer internals
 * (tests/client/city-tris.test.ts checks them in the installed sources). Anywhere else (another Phaser version, a
 * pipeline with another vertex layout) bands stay plain Graphics: slower, never wrong.
 */
export const TRI_PHASER_VERSION='3.90.0';
function canFreeze(renderer:unknown):boolean{
  if(!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)||Phaser.VERSION!==TRI_PHASER_VERSION)return false;
  const multi=(renderer.pipelines as unknown as {MULTI_PIPELINE?:string;get(name:string):unknown}).get?.('MultiPipeline') as {currentShader?:{vertexComponentCount?:number}}|undefined;
  return !multi?.currentShader||multi.currentShader.vertexComponentCount===7;
}

export class TriBand extends Phaser.GameObjects.Graphics {
  private mesh:TriMesh|null=null;
  private tints:number[]=[];
  private tintAlpha=NaN;

  /**
   * A TriBand on the scene, drawn with the Graphics API (fillStyle/fillPoints, lineStyle/strokePoints, fillCircle, ...)
   * in its local space, then frozen under WebGL. Static: draw once. `draw` may be a list of parts, drawn in order; each
   * part is culled on its own (e.g. one unit column of a long band), so each part must set its own fill/line style.
   */
  static make(scene:Phaser.Scene,draw:((g:Phaser.GameObjects.Graphics)=>void)|((g:Phaser.GameObjects.Graphics)=>void)[],x=0,y=0):TriBand{
    const band=new TriBand(scene),parts=Array.isArray(draw)?draw:[draw];
    scene.add.existing(band);
    if(canFreeze(scene.sys.renderer)){
      const out=new MeshBuilder();
      for(const part of parts){
        part(band);
        if(band.commandBuffer.length)capture(band,out);
        band.clear();out.mark();
      }
      const m=band.mesh=out.freeze();
      TRI_STATS.meshes++;TRI_STATS.meshTriangles+=m.count;TRI_STATS.meshBytes+=meshBytes(m);
    }else for(const part of parts)part(band);
    return band.setPosition(x,y);
  }

  /** The frozen triangles (null under Canvas). */
  get triangles():TriMesh|null{return this.mesh;}

  /** Replaces Graphics' command replay (GraphicsWebGLRenderer) with the stored triangles. */
  renderWebGL(renderer:Phaser.Renderer.WebGL.WebGLRenderer,src:TriBand,camera:Phaser.Cameras.Scene2D.Camera,parentMatrix?:Matrix){
    const m=this.mesh;
    if(!m){
      // Not frozen (Canvas, or a Phaser/pipeline this replay was not written for): behave as a plain Graphics.
      // A frozen band ignores later drawing: TriBands are static, draw them in make().
      (Phaser.GameObjects.Graphics.prototype as unknown as {renderWebGL:GraphicsRender}).renderWebGL(renderer,src,camera,parentMatrix);
      return;
    }
    if(!m.count)return;
    // On the scene list, unscaled and unrotated with scroll factor 1, local + position = world: cull by the world view.
    // worldView ignores camera rotation and shake: never cull then (a band would pop at the screen edges).
    const shaking=(camera as unknown as {shakeEffect?:{isRunning?:boolean}}).shakeEffect?.isRunning;
    const cull=!parentMatrix&&this.scaleX===1&&this.scaleY===1&&this.rotation===0&&this.scrollFactorX===1&&this.scrollFactorY===1
      &&!((camera as unknown as {rotation?:number}).rotation)&&!shaking;
    const view=camera.worldView;
    if(cull&&!meshOnScreen(m,this.x,this.y,view,CULL_MARGIN)){TRI_STATS.culled++;return;}
    TRI_STATS.drawn++;
    camera.addToRenderList(src);
    const pipeline=renderer.pipelines.set(src.pipeline,src) as unknown as BatchPipeline;
    renderer.pipelines.preBatch(src);
    // GraphicsWebGLRenderer multiplies this by an identity current matrix, which is exact: use its terms as they are.
    const calc=Phaser.GameObjects.GetCalcMatrix(src,camera,parentMatrix).calc;
    const a=calc.a,b=calc.b,c=calc.c,d=calc.d,e=calc.e,f=calc.f;
    const alpha=camera.alpha*src.alpha;
    if(alpha!==this.tintAlpha){
      this.tintAlpha=alpha;
      // Reused array: the glints change alpha every frame.
      const tints=this.tints;tints.length=m.colors.length;
      for(let i=0;i<m.colors.length;i++)tints[i]=tintOf(m.colors[i],m.alphas[i]*alpha);
    }
    const tints=this.tints,xy=m.xy,style=m.style,ends=m.ends;
    for(let s=0;s<ends.length;s++){
      const n=ends[s];
      let t=s?ends[s-1]:0;
      if(cull&&ends.length>1&&!segmentOnScreen(m,s,this.x,this.y,view,CULL_MARGIN))continue;
      TRI_STATS.triangles+=n-t;
      while(t<n){
        // As batchTri: flush when the next triangle does not fit, and start a batch (white texture) when there is none.
        if(pipeline.vertexCount+3>pipeline.vertexCapacity)pipeline.flush();
        let unit=pipeline.currentUnit;
        if(!pipeline.currentBatch)unit=pipeline.setTexture2D();
        const end=Math.min(n,t+Math.floor((pipeline.vertexCapacity-pipeline.vertexCount)/3));
        const F=pipeline.vertexViewF32,U=pipeline.vertexViewU32,stride=pipeline.currentShader.vertexComponentCount;
        let o=pipeline.vertexCount*stride;
        const start=t;
        for(;t<end;t++){
          const k=t*6,tint=tints[style[t]];
          let x=xy[k],y=xy[k+1];
          F[o]=x*a+y*c+e;F[o+1]=x*b+y*d+f;F[o+2]=0;F[o+3]=0;F[o+4]=unit;F[o+5]=2;U[o+6]=tint;o+=stride;
          x=xy[k+2];y=xy[k+3];
          F[o]=x*a+y*c+e;F[o+1]=x*b+y*d+f;F[o+2]=0;F[o+3]=1;F[o+4]=unit;F[o+5]=2;U[o+6]=tint;o+=stride;
          x=xy[k+4];y=xy[k+5];
          F[o]=x*a+y*c+e;F[o+1]=x*b+y*d+f;F[o+2]=1;F[o+3]=1;F[o+4]=unit;F[o+5]=2;U[o+6]=tint;o+=stride;
        }
        pipeline.vertexCount+=(t-start)*3;
        const batch=pipeline.currentBatch!;
        batch.count=pipeline.vertexCount-batch.start;
      }
    }
    renderer.pipelines.postBatch(src);
  }

  destroy(fromScene?:boolean){
    const m=this.mesh;
    if(m){TRI_STATS.meshes--;TRI_STATS.meshTriangles-=m.count;TRI_STATS.meshBytes-=meshBytes(m);}
    this.mesh=null;this.tints=[];super.destroy(fromScene);
  }
}
