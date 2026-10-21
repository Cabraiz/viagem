/**
 * The stadium behind the menu (NEW-20261021-ORQ-menu-estadio). The hero stands on the bar in the front of the picture,
 * wherever `background-size: cover` puts it: `placeOnBar` turns the stage's box into the point (in the box's pixels)
 * where the bar's top is under a given screen x. The files come from scripts/estadio-fundo.mjs (same crop numbers).
 */
export interface StadiumArt {
  /** Pixel size of the file. */
  w:number;h:number;
  /** The file's part of the whole 1920x1080 picture, as fractions [x0,y0,x1,y1]. */
  crop:[number,number,number,number];
}
export const STADIUM={
  wide:{w:1920,h:1080,crop:[0,0,1,1]} satisfies StadiumArt,
  tall:{w:768,h:1080,crop:[422/1920,0,1190/1920,1]} satisfies StadiumArt,
};
/** Where the CSS shows the tall crop (estadio.css uses the same media query). */
export const STADIUM_TALL_QUERY='(orientation: portrait) and (max-width: 820px)';
/** The bar's top edge in the whole picture (x, y as fractions), measured on fundo-e1-1080p: it falls to the right. */
export const BAR_TOP:readonly (readonly [number,number])[]=[[0,.847],[.3,.862],[.55,.881],[.65,.896],[.72,.913],[.8,.939],[.86,.97]];
export function barTop(x:number){
  const [first]=BAR_TOP,last=BAR_TOP[BAR_TOP.length-1];
  if(x<=first[0])return first[1];
  if(x>=last[0])return last[1];
  const i=BAR_TOP.findIndex(([px])=>px>=x),[x0,y0]=BAR_TOP[i-1],[x1,y1]=BAR_TOP[i];
  return y0+(y1-y0)*(x-x0)/(x1-x0);
}
/** The bar under screen x `atX` (box pixels) for a `cover` background anchored at `pos` (CSS background-position, 0..1). */
export function placeOnBar(box:{w:number;h:number},art:StadiumArt,atX:number,pos={x:.5,y:1}){
  if(!(box.w>0&&box.h>0))return;
  const s=Math.max(box.w/art.w,box.h/art.h),dw=art.w*s,dh=art.h*s;
  const ox=(box.w-dw)*pos.x,oy=(box.h-dh)*pos.y;
  const [x0,y0,x1,y1]=art.crop;
  const whole=x0+(x1-x0)*Math.min(1,Math.max(0,(atX-ox)/dw));
  return {x:atX,y:oy+(barTop(whole)-y0)/(y1-y0)*dh};
}
