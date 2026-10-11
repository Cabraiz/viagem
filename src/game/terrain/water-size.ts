// Pure sizing of the water cache (no Phaser here, so it is tested in Node).
/**
 * Texel budget of the water cache: the same ~49k texels as the old fixed 256×192, but shaped like the view, so a texel
 * is square on screen (the fixed 4:3 cache stretched over a portrait view made 2,4 × 7 px CSS texels: vertical stripes).
 */
export const WATER_TEXELS=256*192,WATER_MAX_SIDE=512;
/** Water cache size for a view of w×h CSS px: same aspect, ~WATER_TEXELS texels, no side above WATER_MAX_SIDE. */
export function waterCacheSize(w:number,h:number){
  const aspect=Math.max(.1,Math.min(10,(w||1)/(h||1)));
  let cw=Math.sqrt(WATER_TEXELS*aspect),ch=cw/aspect;
  const over=Math.max(cw,ch)/WATER_MAX_SIDE;if(over>1){cw/=over;ch/=over;}
  // Even sizes, and only a few steps, so a resize does not rebuild the cache for a pixel of difference.
  const snap=(v:number)=>Math.max(32,Math.round(v/16)*16);
  return {width:snap(cw),height:snap(ch)};
}
