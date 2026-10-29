/**
 * Screen-scale outlines for city mode (card NEW-20261012-E8-cidade-contorno-breu, art bible cidade-nevada-arte.md §6):
 * every critter, pickup and hero gets a Breu ring measured on SCREEN, after scaling, outside its own edge. A sheet drawn
 * at s screen px per texture px needs a ring of 2/s texture px: this module grows that ring on RGBA pixels once, at
 * load, so the GPU draws one ordinary sprite per figure.
 *
 * Pure (no DOM, no Phaser): an exact Euclidean distance transform (Felzenszwalb & Huttenlocher) per sheet cell gives
 * each transparent pixel its distance to the figure; the ring's coverage is clamp(radius − distance + 0.5, 0, 1) for a
 * soft, anti-aliased edge at fractional radii. Cells are processed one by one so frames never bleed into each other.
 */

/** Alpha at or above this counts as figure when measuring the distance to it. */
export const OUTLINE_ALPHA_CUTOFF=128;
const INF=1e20;

/** 1-D squared Euclidean distance transform of f (length n) into d; v, z are scratch arrays (n, n+1). */
function edt1d(f:Float64Array,n:number,d:Float64Array,v:Int32Array,z:Float64Array){
  let k=0;v[0]=0;z[0]=-INF;z[1]=INF;
  for(let q=1;q<n;q++){
    let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
    while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}
    k++;v[k]=q;z[k]=s;z[k+1]=INF;
  }
  k=0;
  for(let q=0;q<n;q++){while(z[k+1]<q)k++;const dq=q-v[k];d[q]=dq*dq+f[v[k]];}
}

/**
 * Squared distance (px²) from every pixel of a w×h alpha region to the nearest pixel with alpha ≥ cutoff (0 on them,
 * a huge number when the region has no figure at all).
 */
export function distanceToFigure(alpha:ArrayLike<number>,w:number,h:number,cutoff=OUTLINE_ALPHA_CUTOFF):Float64Array{
  const n=Math.max(w,h),grid=new Float64Array(w*h),f=new Float64Array(n),d=new Float64Array(n),v=new Int32Array(n),z=new Float64Array(n+1);
  for(let i=0;i<w*h;i++)grid[i]=alpha[i]>=cutoff?0:INF;
  for(let x=0;x<w;x++){
    for(let y=0;y<h;y++)f[y]=grid[y*w+x];
    edt1d(f,h,d,v,z);
    for(let y=0;y<h;y++)grid[y*w+x]=d[y];
  }
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++)f[x]=grid[y*w+x];
    edt1d(f,w,d,v,z);
    for(let x=0;x<w;x++)grid[y*w+x]=d[x];
  }
  return grid;
}

export interface OutlineSpec {
  /** Ring width in TEXTURE px (screen px / screen-px-per-texture-px). Fractional values give a soft ring. */
  radius:number;
  /** Ring colour 0xRRGGBB and opacity 0..1. */
  color:number;
  alpha:number;
  /** Sheet cell size in px; the whole image is one cell when omitted. */
  cellW?:number;
  cellH?:number;
}

/**
 * Returns a new RGBA buffer (same size) with a ring of `spec.color` grown `spec.radius` px outside every figure,
 * composited UNDER the original pixels (the figure and its own soft edge stay exactly as drawn). Transparent cells and
 * cells without a figure are copied unchanged.
 */
export function outlineRgba(src:Uint8ClampedArray|Uint8Array,w:number,h:number,spec:OutlineSpec):Uint8ClampedArray{
  const out=new Uint8ClampedArray(src.length);out.set(src);
  if(!(spec.radius>0)||!(spec.alpha>0))return out;
  const cw=Math.max(1,Math.min(w,Math.floor(spec.cellW??w))),ch=Math.max(1,Math.min(h,Math.floor(spec.cellH??h)));
  const cr=spec.color>>16&255,cg=spec.color>>8&255,cb=spec.color&255,ringAlpha=Math.max(0,Math.min(1,spec.alpha));
  const r=spec.radius,reach=(r+1)*(r+1);
  const alpha=new Uint8Array(cw*ch);
  for(let y0=0;y0+ch<=h;y0+=ch)for(let x0=0;x0+cw<=w;x0+=cw){
    let any=false;
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const a=src[((y0+y)*w+x0+x)*4+3];alpha[y*cw+x]=a;if(a>=OUTLINE_ALPHA_CUTOFF)any=true;}
    if(!any)continue;
    const dist=distanceToFigure(alpha,cw,ch);
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
      const d2=dist[y*cw+x];
      if(d2===0||d2>reach)continue;
      const cover=Math.max(0,Math.min(1,r-Math.sqrt(d2)+0.5));
      if(cover<=0)continue;
      // Ring under the original pixel: out = src over ring.
      const i=((y0+y)*w+x0+x)*4,sa=src[i+3]/255,ra=cover*ringAlpha,oa=sa+ra*(1-sa);
      if(oa<=0)continue;
      out[i]=Math.round((src[i]*sa+cr*ra*(1-sa))/oa);
      out[i+1]=Math.round((src[i+1]*sa+cg*ra*(1-sa))/oa);
      out[i+2]=Math.round((src[i+2]*sa+cb*ra*(1-sa))/oa);
      out[i+3]=Math.round(oa*255);
    }
  }
  return out;
}
