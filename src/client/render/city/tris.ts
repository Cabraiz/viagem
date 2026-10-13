/**
 * Frozen triangle lists for the city layer (card cidade-03, performance). Phaser 3.90 Graphics keep a command list and
 * replay it every frame: earcut on every fillPoints, a quad per stroke segment, ~100-point arcs per circle. The
 * city's blocks, glints and props never change shape, so tri-band.ts runs that replay ONCE (Phaser's own code, with
 * an identity matrix) into a MeshBuilder and afterwards only transforms the stored triangles. Pure logic (no Phaser).
 */

/** Frozen triangle list: 6 numbers (3 local vertices) per triangle, a style per triangle, and local bounds. */
export interface TriMesh {
  /** Triangles. */
  readonly count:number;
  /** x0,y0,x1,y1,x2,y2 per triangle, in local px; float64 so they transform exactly as Phaser's own numbers. */
  readonly xy:Float64Array;
  /** Style index per triangle. */
  readonly style:Uint16Array;
  /** Colour (0xRRGGBB) and alpha (the fillStyle/lineStyle alpha, before the object's alpha) per style. */
  readonly colors:readonly number[];
  readonly alphas:readonly number[];
  /** Local bounds of every vertex (empty mesh: x0 > x1). */
  readonly x0:number;readonly y0:number;readonly x1:number;readonly y1:number;
  /**
   * Segments (e.g. one per unit column of a band), culled one by one: segment i holds the triangles
   * [ends[i-1] (0 for the first), ends[i]) and has the local bounds bounds[4i..4i+3] = x0, y0, x1, y1.
   */
  readonly ends:Uint32Array;
  readonly bounds:Float64Array;
}

/** Collects triangles in draw order with a (colour, alpha) style each; freeze() once at the end. */
export class MeshBuilder {
  private readonly xy:number[]=[];
  private readonly styleOf:number[]=[];
  private readonly colors:number[]=[];
  private readonly alphas:number[]=[];
  private readonly styles=new Map<string,number>();
  private readonly ends:number[]=[];

  /** Triangles recorded so far. */
  get count(){return this.styleOf.length;}

  /** Index of a (colour, alpha) style, created on first use. */
  style(color:number,alpha:number):number{
    const key=`${color}|${alpha}`;
    let s=this.styles.get(key);
    if(s===undefined){
      s=this.colors.length;
      if(s>0xffff)throw new Error('MeshBuilder: too many styles');
      this.colors.push(color);this.alphas.push(alpha);this.styles.set(key,s);
    }
    return s;
  }
  tri(style:number,x0:number,y0:number,x1:number,y1:number,x2:number,y2:number){
    this.xy.push(x0,y0,x1,y1,x2,y2);this.styleOf.push(style);
  }

  /** Closes the current segment (no-op when it is empty). */
  mark(){
    const last=this.ends.length?this.ends[this.ends.length-1]:0;
    if(this.count>last)this.ends.push(this.count);
  }

  freeze():TriMesh{
    this.mark();
    const xy=Float64Array.from(this.xy),style=Uint16Array.from(this.styleOf),ends=Uint32Array.from(this.ends);
    const bounds=new Float64Array(ends.length*4);
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,t=0;
    for(let s=0;s<ends.length;s++){
      let sx0=Infinity,sy0=Infinity,sx1=-Infinity,sy1=-Infinity;
      for(;t<ends[s];t++)for(let k=t*6;k<t*6+6;k+=2){
        const x=xy[k],y=xy[k+1];
        if(x<sx0)sx0=x;if(x>sx1)sx1=x;if(y<sy0)sy0=y;if(y>sy1)sy1=y;
      }
      bounds[s*4]=sx0;bounds[s*4+1]=sy0;bounds[s*4+2]=sx1;bounds[s*4+3]=sy1;
      if(sx0<x0)x0=sx0;if(sy0<y0)y0=sy0;if(sx1>x1)x1=sx1;if(sy1>y1)y1=sy1;
    }
    return {count:style.length,xy,style,colors:[...this.colors],alphas:[...this.alphas],x0,y0,x1,y1,ends,bounds};
  }
}

/**
 * Whether a mesh drawn at offset (ox, oy), unscaled and unrotated, can touch the visible world rect (camera
 * worldView) widened by `margin` px. False only when it certainly draws no pixel there.
 */
export function meshOnScreen(m:TriMesh,ox:number,oy:number,view:{x:number;y:number;width:number;height:number},margin:number){
  if(!m.count)return false;
  return !(m.x1+ox<view.x-margin||m.x0+ox>view.x+view.width+margin||m.y1+oy<view.y-margin||m.y0+oy>view.y+view.height+margin);
}

/** Same test for segment `s` of the mesh. */
export function segmentOnScreen(m:TriMesh,s:number,ox:number,oy:number,view:{x:number;y:number;width:number;height:number},margin:number){
  const b=m.bounds,i=s*4;
  return !(b[i+2]+ox<view.x-margin||b[i]+ox>view.x+view.width+margin||b[i+3]+oy<view.y-margin||b[i+1]+oy>view.y+view.height+margin);
}

/** Bytes held by a frozen mesh (positions, styles, segments), for memory estimates. */
export function meshBytes(m:TriMesh){return m.xy.byteLength+m.style.byteLength+m.ends.byteLength+m.bounds.byteLength+m.colors.length*16;}
