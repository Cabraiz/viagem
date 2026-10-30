/**
 * Base slope of a wall's straight piece (NEW-20261029-ORQ-cercas-nordeste-ligadas). A wall line runs along a cell axis,
 * which the city draws at exactly ±1/2 on screen (projection.ts: TILE_Y/TILE_X), and its pieces sit back to back, the
 * end post of one on the start post of the next. The delivered views draw that base at 0.38–0.71: every joint then
 * steps up or down (print 0 of the card: "one in front and the other behind"). levelWallBase shears the columns of a
 * view vertically about the drawing's middle until the post bases run at ±1/2; the posts stay upright and the middle
 * stays where it was drawn, so the piece keeps its place in the cell.
 *
 * Images are raw RGBA {data,width,height}; alpha > 128 counts as drawn.
 */

/** The screen slope of a wall line (projection.ts TILE_Y/TILE_X). */
export const WALL_SLOPE=.5;
/** Width of an end post's foot window, px: the lowest drawn row over the first / last POST columns of the drawing. */
const POST=12;
/** Below this distance from ±1/2 a view is left as delivered. */
export const WALL_SLOPE_TOLERANCE=.02;

/**
 * Base slope of one view, in image rows per column (y grows down: a view drawn "/" is negative): the lowest drawn row
 * under the last end post minus the one under the first, over the distance between them. Undefined when the view is
 * too narrow for two posts.
 */
export function wallBaseSlope(img){
  const {data,width,height}=img,bottom=new Int32Array(width).fill(-1);
  let x0=-1,x1=-1;
  for(let x=0;x<width;x++){
    for(let y=height-1;y>=0;y--)if(data[(y*width+x)*4+3]>128){bottom[x]=y;break;}
    if(bottom[x]>=0){if(x0<0)x0=x;x1=x;}
  }
  if(x0<0||x1-x0<3*POST)return undefined;
  const low=(a,b)=>{let m=-1;for(let x=a;x<b;x++)m=Math.max(m,bottom[x]);return m;};
  return {slope:(low(x1-POST+1,x1+1)-low(x0,x0+POST))/(x1-x0-POST),x0,x1};
}

/**
 * The view with its base at ±WALL_SLOPE (the sign it was drawn with): column x moves down by k·(x − middle), k the
 * slope's error, rows interpolated linearly (premultiplied). Returns the same image when it is already within
 * WALL_SLOPE_TOLERANCE. A drawn pixel that would leave the frame throws, unless `grow`: the frame then gains the rows
 * the shear needs at the top and the bottom (the adapter places the result by its own bounds).
 */
export function levelWallBase(img,{grow=false}={}){
  const m=wallBaseSlope(img);
  if(!m||Math.abs(Math.abs(m.slope)-WALL_SLOPE)<=WALL_SLOPE_TOLERANCE)return img;
  const k=Math.sign(m.slope)*WALL_SLOPE-m.slope,xc=(m.x0+m.x1)/2;
  if(grow){
    const pad=Math.ceil(Math.abs(k)*Math.max(xc-m.x0,m.x1-xc))+1,big=Buffer.alloc(img.width*(img.height+2*pad)*4);
    img.data.copy(big,pad*img.width*4);
    img={data:big,width:img.width,height:img.height+2*pad};
  }
  const {data,width,height}=img;
  const out=Buffer.alloc(data.length);
  for(let x=0;x<width;x++){
    const d=k*(x-xc),base=Math.floor(d),f=d-base;
    for(let y=0;y<height;y++){
      // out[y] = (1−f)·in[y − base] + f·in[y − base − 1]
      let r=0,g=0,b=0,a=0;
      for(const [sy,w] of [[y-base,1-f],[y-base-1,f]]){
        if(w===0||sy<0||sy>=height)continue;
        const i=(sy*width+x)*4,al=data[i+3]*w;
        r+=data[i]*al;g+=data[i+1]*al;b+=data[i+2]*al;a+=al;
      }
      if(a<=0)continue;
      const o=(y*width+x)*4;
      out[o]=Math.round(r/a);out[o+1]=Math.round(g/a);out[o+2]=Math.round(b/a);out[o+3]=Math.round(a);
    }
    for(let y=0;y<height;y++){
      const sy=y+d;if(sy>=0&&sy<height)continue;
      if(data[(y*width+x)*4+3]>0)throw new Error(`levelWallBase: column ${x} row ${y} would move out of the ${width}×${height} frame (slope ${m.slope.toFixed(3)})`);
    }
  }
  return {data:out,width,height};
}
