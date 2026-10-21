/**
 * The stadium behind the menu (NEW-20261021-ORQ-menu-estadio). The hero stands on the bar in the front of the picture,
 * wherever `background-size: cover` puts it: `placeOnBar` turns the stage's box into the point (in the box's pixels)
 * where the bar's top is under a given screen x. The files come from scripts/estadio-fundo.mjs (same crop numbers).
 */
export interface StadiumArt {
  /** Pixel size of the file. */
  w:number;h:number;
  /** The file's part of the whole 1920x1080 picture, as fractions [x0,y0,x1,y1] (below 0 / above 1: a bleed). */
  crop:[number,number,number,number];
  /** A bleed file: the approved 1920x1080 inside it (file px). Framed by it (frameArt), not by `cover`. */
  focal?:{x:number;y:number;w:number;h:number};
}
/** The whole picture every crop and cutout is measured on (px). */
export const WHOLE={w:1920,h:1080};
export const STADIUM={
  wide:{w:1920,h:1080,crop:[0,0,1,1]} satisfies StadiumArt,
  tall:{w:768,h:1080,crop:[422/1920,0,1190/1920,1]} satisfies StadiumArt,
  // E6's stadium past every edge (NEW-20261021-ORQ-fundo-estadio-sangria): the approved picture intact at 320,313.
  bleed:{w:2560,h:1707,crop:[-320/1920,-313/1080,2240/1920,1394/1080],focal:{x:320,y:313,w:1920,h:1080}} satisfies StadiumArt,
};
/**
 * Where the file lands in the box: scale `s` (box px per file px) and its top-left corner. A plain file: `cover` at
 * `pos` (CSS background-position, 0..1). A bleed file (menu-fundo-sangria): the approved picture whole on screen
 * (contain, its middle in the box's middle), never less than `cover` of the whole file, and the file always covering
 * the box (the offset clamped), so no window shows an edge or cuts the approved picture.
 */
export function frameArt(box:{w:number;h:number},art:StadiumArt,pos={x:.5,y:1}){
  const f=art.focal;
  if(!f){const s=Math.max(box.w/art.w,box.h/art.h);return {s,ox:(box.w-art.w*s)*pos.x,oy:(box.h-art.h*s)*pos.y};}
  const s=Math.max(Math.min(box.w/f.w,box.h/f.h),box.w/art.w,box.h/art.h);
  const clamp=(v:number,lo:number,hi=0)=>Math.min(hi,Math.max(lo,v));
  // Wider than the bleed (past ~2.4:1) the approved picture can't fit: its bottom (the bar, the feet) stays on screen.
  return {s,ox:clamp(box.w/2-(f.x+f.w/2)*s,box.w-art.w*s),oy:clamp(box.h/2-(f.y+f.h/2)*s,box.h-art.h*s,Math.min(0,box.h-(f.y+f.h)*s))};
}
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
  const {s,ox,oy}=frameArt(box,art,pos),dw=art.w*s,dh=art.h*s;
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
/** The cutout's box in the stage (px) for the same framing the background uses (frameArt; `pos` for `cover`). */
export function placeCutout(box:{w:number;h:number},art:StadiumArt,cut:Pick<StadiumCutout,'x'|'y'|'w'|'h'>,pos={x:.5,y:1}){
  if(!(box.w>0&&box.h>0))return;
  const {s,ox,oy}=frameArt(box,art,pos);
  // The whole picture's px → the file's px: the same for the plain wide file, shifted by the bleed for E6's.
  const f=art.focal??{x:0,y:0,w:art.w,h:art.h},k=f.w/WHOLE.w;
  return {x:ox+(f.x+cut.x*k)*s,y:oy+(f.y+cut.y*k)*s,w:cut.w*k*s,h:cut.h*k*s};
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
