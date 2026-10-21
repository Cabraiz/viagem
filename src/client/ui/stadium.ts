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

/**
 * A hero drawn in place on the wide picture (NEW-20261021-ORQ-menu-arte-viciado): the file is only the hero's box of the
 * 1920x1080 picture (scripts/menu-arte.mjs, same numbers), so the page puts it back where it was. PC only
 * (CUTOUT_QUERY); the phone, upright or on its side, keeps the dance.
 */
export interface StadiumCutout {
  /** The box in the whole 1920x1080 picture, px. */
  x:number;y:number;w:number;h:number;
  /** Width → file (the full one and a 2/3 copy). */
  files:readonly (readonly [number,string])[];
}
export const RECORTES:Readonly<Record<string,StadiumCutout>>=Object.freeze({
  'viciado-em-bet':{x:955,y:21,w:788,h:1053,files:[[525,'/art/menu/heroi/viciado-em-bet-525.webp'],[788,'/art/menu/heroi/viciado-em-bet-788.webp']]},
});
/** Where the cutout stands in for the dance: the PC (the wide picture, taller than a phone on its side). */
export const CUTOUT_QUERY='(orientation: landscape) and (min-height: 521px)';
export const cutoutOf=(id:string):StadiumCutout|undefined=>RECORTES[id];
/** The cutout's box in the stage (px) for the same `cover` the background uses (position `pos`, 0..1). */
export function placeCutout(box:{w:number;h:number},art:StadiumArt,cut:Pick<StadiumCutout,'x'|'y'|'w'|'h'>,pos={x:.5,y:1}){
  if(!(box.w>0&&box.h>0))return;
  const s=Math.max(box.w/art.w,box.h/art.h);
  const ox=(box.w-art.w*s)*pos.x,oy=(box.h-art.h*s)*pos.y;
  return {x:ox+cut.x*s,y:oy+cut.y*s,w:cut.w*s,h:cut.h*s};
}
/** The margin the whole hero keeps from the stage's edges (px): 2% of its height, at least 8. */
export const cutoutMargin=(h:number)=>Math.max(8,h*.02);
/**
 * The whole hero on screen (NEW-20261021-ORQ-menu-1080-720-menino-inteiro): `cover` cuts the picture's top on a window
 * wider than 16:9 (1920x950, a browser's bar) and puts his sneaker on the bottom edge at 1080p, so the cutout scales down
 * (contain) to the stage's height minus the margins, his feet where the picture has them (or lifted to the margin) and
 * his middle where it was; never bigger than `cover` made him.
 */
export function fitCutout(box:{w:number;h:number},spot:{x:number;y:number;w:number;h:number}){
  const m=cutoutMargin(box.h),k=Math.min(1,(box.h-2*m)/spot.h,(box.w-2*m)/spot.w);
  const w=spot.w*k,h=spot.h*k;
  const y=Math.max(m,Math.min(spot.y+spot.h,box.h-m)-h);
  const x=Math.min(Math.max(m,spot.x+(spot.w-w)/2),box.w-m-w);
  return {x,y,w,h};
}
