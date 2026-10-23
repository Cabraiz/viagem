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
  /**
   * What frameArt fits in the window (file px), when not just `focal`: the approved picture plus some of the bleed, so
   * the whole scene stands further back (estadio-folga-topo). Its bottom and right edges are focal's.
   */
  view?:{x:number;y:number;w:number;h:number};
  /**
   * The lowest sole of the heroes drawn on it, a row of the whole 1920x1080 picture (alpha > 0: RECORTES' box bottom,
   * `desce` included):
   * frameArt keeps it FEET_MARGIN px above the box's bottom (heroi-esrgan-no-ar: the viciado's back sneaker at 1077 of
   * 1080 touched the window's edge on every window wider than 16:9).
   */
  feet?:number;
}
/** The room under the lowest sole (px of the box), so no window cuts a sneaker. */
export const FEET_MARGIN=8;
/** The whole picture every crop and cutout is measured on (px). */
export const WHOLE={w:1920,h:1080};
export const STADIUM={
  wide:{w:1920,h:1080,crop:[0,0,1,1]} satisfies StadiumArt,
  tall:{w:768,h:1080,crop:[422/1920,0,1190/1920,1]} satisfies StadiumArt,
  // E6's stadium past every edge (NEW-20261021-ORQ-fundo-estadio-sangria): the approved picture intact at 320,313.
  // Framed by `view` (estadio-folga-topo, the user, 22/10: the viciado's cap ~15 px under the window's top): the approved
  // picture plus 10% of its size of the bleed above and to its left, so the scene stands ~9% further back and his cap gets
  // ~10% of the window over it. Bottom and right: the approved picture's (the bar, the feet). The hero then grows back to
  // headRoom under the top (heroi-grande-por-tela, frameHero): the view is where the zoom starts from.
  bleed:{w:2560,h:1707,crop:[-320/1920,-313/1080,2240/1920,1394/1080],focal:{x:320,y:313,w:1920,h:1080},
    view:{x:128,y:205,w:2112,h:1188},feet:1081} satisfies StadiumArt,
};
/**
 * Where the file lands in the box: scale `s` (box px per file px) and its top-left corner. A plain file: `cover` at
 * `pos` (CSS background-position, 0..1). A bleed file (menu-fundo-sangria): the approved picture whole on screen
 * (its `view` contained, the view's middle in the box's middle), never less than `cover` of the whole file, and the file
 * always covering the box (the offset clamped), so no window shows an edge or cuts the approved picture.
 */
export function frameArt(box:{w:number;h:number},art:StadiumArt,pos={x:.5,y:1}){
  const f=art.focal;
  if(!f){const s=Math.max(box.w/art.w,box.h/art.h);return {s,ox:(box.w-art.w*s)*pos.x,oy:(box.h-art.h*s)*pos.y};}
  const v=art.view??f,s=Math.max(Math.min(box.w/v.w,box.h/v.h),box.w/art.w,box.h/art.h);
  const clamp=(v:number,lo:number,hi=0)=>Math.min(hi,Math.max(lo,v));
  // Wider than the bleed (past ~2.4:1) the approved picture can't fit: its bottom (the bar, the feet) stays on screen.
  const feet=art.feet===undefined?0:box.h-(f.y+art.feet)*s-FEET_MARGIN;
  return {s,ox:clamp(box.w/2-(v.x+v.w/2)*s,box.w-art.w*s),oy:clamp(box.h/2-(v.y+v.h/2)*s,box.h-art.h*s,Math.min(0,box.h-(f.y+f.h)*s,feet))};
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
  /**
   * Width → file: the box at 2/3, 1x, 4/3 and 2x, all from the 2x Real-ESRGAN enlargement (heroi-esrgan-no-ar);
   * cutoutFile picks one by the shown width × DPR, so a 1x screen never loads the 2x one.
   */
  files:readonly (readonly [number,string])[];
  /**
   * The hero's own background (NEW-20261021-ORQ-tela-clt-pose2), drawn without him: a bleed with STADIUM.bleed's
   * geometry (2560x1707, his 1920x1080 picture at 320,313), so the same framing fits it. Absent: the stadium.
   */
  fundo?:string;
  /**
   * Px of the whole picture the hero is drawn lower than in the approved picture (mureta-camada-frente: the viciado's
   * front sole down onto the bar's padded top, its heel a few px behind the rounded edge, no gap under the arch).
   */
  desce?:number;
  /**
   * A piece of the background drawn OVER the hero (mureta-camada-frente, the user, 21/10: "o pé de trás deveria estar
   * escondido"): the stadium's bar under its top edge (MURETA_TOPO), so the back sneaker stands behind it. Its box in the
   * whole 1920x1080 picture, framed like the background (placeCutout), never fitted to the hero (fitCutout).
   */
  frente?:{x:number;y:number;w:number;h:number;file:string};
  /**
   * His face in the whole 1920x1080 picture he was cut out of (eyes to chin, cheek to cheek), px. The heroes' faces
   * stand in the same place on screen (clt-mesmo-lugar): scripts/pes-no-chao.mjs and the tests measure them by it.
   */
  rosto:{x:number;y:number;w:number;h:number};
  /**
   * Stands in another hero's place (clt-mesmo-lugar, the user, 21/10: "os rostos deles e corpo deles estejam meio que
   * quase no mesmo lugar"): his whole picture (the cutout AND his `fundo`, so his feet stay on his own floor) scaled
   * `k` and moved so his face's middle lands on `de`'s, `dx` px right of it and `dy` px lower. See moveOf.
   */
  lugar?:{de:string;k:number;dx?:number;dy:number};
}
/** A whole-picture point of a hero's own picture → the stage's whole picture: k*p + (dx,dy). */
export interface Move {k:number;dx:number;dy:number}
export const SEM_MOVE:Move=Object.freeze({k:1,dx:0,dy:0});
/**
 * The top edge of the stadium's bar (the padded top's silhouette) in the whole 1920x1080 picture: y at x, a cubic fit
 * (scripts/menu-arte.mjs --so mureta measures it on fundo-estadio-viciado: the top of the light band over the purple
 * pad, 0.7 px rms over x 900-1840). The bar falls to the right, ever faster.
 */
export const MURETA_TOPO={x0:1370,sx:470,coef:[997.463,94.02,38.785,-2.987]} as const;
export function muretaTopo(x:number){
  const t=(x-MURETA_TOPO.x0)/MURETA_TOPO.sx,[a,b,c,d]=MURETA_TOPO.coef;
  return a+b*t+c*t*t+d*t*t*t;
}
export const RECORTES:Readonly<Record<string,StadiumCutout>>=Object.freeze({
  'viciado-em-bet':{x:953,y:19,w:793,h:1058,files:[[529,'/art/menu/heroi/viciado-em-bet-529.webp'],[793,'/art/menu/heroi/viciado-em-bet-793.webp'],
    [1057,'/art/menu/heroi/viciado-em-bet-1057.webp'],[1586,'/art/menu/heroi/viciado-em-bet-1586.webp']],
    desce:4,frente:{x:940,y:940,w:820,h:170,file:'/art/menu/mureta-estadio.webp'},rosto:{x:1278,y:159,w:195,h:160}},
  // The user's pose 2 (21/10), cut out of its own scene (the sunset light already on him), on the paperwork mountain.
  // In the viciado's place (clt-mesmo-lugar), then bigger, to the right and lower (clt-direita-15-maior, the user, 22/10:
  // "e ponha ele mais para a direita e 15% maior", then "não curto ele ficar colado na parte de cima"): k 1.12 x 1.114,
  // the most the room lets with >= 8% of the window over his hair and FEET_MARGIN under his soles (1280x720; 15% would
  // leave ~5%), his face 100 px right of the viciado's (~4.7% of the window) and 33 px lower, so his box's bottom lands on
  // the viciado's lowest sole (1081) and his briefcase keeps ~5% of the window to the right edge. His own plateau moves
  // with him (frameMoved). Then both heroes grow to the window by the same rule (heroi-grande-por-tela, frameHero): the CLT
  // ~17% over the clt-mesmo-lugar one at 1080p, his hair 4% under the top.
  'clt-cansado':{x:792,y:73,w:635,h:865,files:[[423,'/art/menu/heroi/clt-cansado-423.webp'],[635,'/art/menu/heroi/clt-cansado-635.webp'],
    [847,'/art/menu/heroi/clt-cansado-847.webp'],[1270,'/art/menu/heroi/clt-cansado-1270.webp']],
    fundo:'/art/lite/menu/fundo-clt-cansado.webp',rosto:{x:1077,y:223,w:155,h:140},lugar:{de:'viciado-em-bet',k:1.248,dx:100,dy:33}},
});
type Placeable=Pick<StadiumCutout,'x'|'y'|'w'|'h'|'desce'>&Partial<Pick<StadiumCutout,'rosto'|'lugar'>>;
/** How a hero's own picture lands on the stage's (lugar): his face's middle on the other's, `dx` right and `dy` lower. */
export function moveOf(cut:Partial<Pick<StadiumCutout,'rosto'|'lugar'>>):Move{
  const l=cut.lugar,other=l&&RECORTES[l.de];
  if(!l||!other||!cut.rosto)return SEM_MOVE;
  const there=rostoNoPalco(other),mine=cut.rosto;
  return {k:l.k,dx:there.x+there.w/2+(l.dx??0)-l.k*(mine.x+mine.w/2),dy:there.y+there.h/2+l.dy-l.k*(mine.y+mine.h/2)};
}
/** His face on the stage's whole picture (px): moved (lugar), then `desce`; before any slide of frameMoved's clamp. */
export function rostoNoPalco(cut:Pick<StadiumCutout,'rosto'|'desce'>&Partial<Pick<StadiumCutout,'lugar'>>){
  const m=moveOf(cut),r=cut.rosto;
  return {x:m.k*r.x+m.dx,y:m.k*r.y+m.dy+(cut.desce??0),w:m.k*r.w,h:m.k*r.h};
}
/**
 * A hero's own background (`fundo`, a bleed with the stadium's geometry) where the stadium's framing (frameArt) and his
 * move put it, so his feet stay on his floor: scale `s` (box px per file px) and its top-left corner, always covering the box
 * (a window wider than his picture reaches slides it, and placeCutout slides him with it).
 */
export function frameMoved(box:{w:number;h:number},art:StadiumArt,move:Move=SEM_MOVE,pos={x:.5,y:1}){
  const {s,ox,oy}=frameArt(box,art,pos),f=art.focal??{x:0,y:0,w:art.w,h:art.h},kf=f.w/WHOLE.w,S=s*move.k;
  if(move===SEM_MOVE)return {s,ox,oy};
  const clamp=(v:number,lo:number)=>Math.min(0,Math.max(lo,v));
  return {s:S,ox:clamp(ox+(f.x*(1-move.k)+kf*move.dx)*s,box.w-art.w*S),oy:clamp(oy+(f.y*(1-move.k)+kf*move.dy)*s,box.h-art.h*S)};
}
/** A framing: scale `s` (box px per file px) and the file's top-left corner in the box. */
export interface Frame {s:number;ox:number;oy:number}
/**
 * The room over a hero's head on the PC (heroi-grande-por-tela): 9% of the window's height, at least 28 px
 * (menu-folga-topo, the user, 22/10: "o default está muito perto da borda em cima, pode aumentar o gap"; it was 4%).
 */
export const headRoom=(h:number)=>Math.max(28,h*.09);
/**
 * The right edge of the menu's column on the PC (estadio.css under CUTOUT_QUERY: left max(3vw, 16px) + 2vw, width
 * min(77vh, 60vw)) plus 2% of the width: no hero grows into it.
 */
export const columnRight=(box:{w:number;h:number})=>Math.max(.03*box.w,16)+.02*box.w+Math.min(.77*box.h,.6*box.w)+.02*box.w;
/** The cutout's box (px) for a framing of his own picture (frameMoved/frameHero). */
function boxIn(f:Frame,art:StadiumArt,cut:Placeable){
  const {s,ox,oy}=f,focal=art.focal??{x:0,y:0,w:art.w,h:art.h},k=focal.w/WHOLE.w;
  return {x:ox+(focal.x+cut.x*k)*s,y:oy+(focal.y+(cut.y+(cut.desce??0))*k)*s,w:cut.w*k*s,h:cut.h*k*s};
}
/**
 * The hero as big as the window lets (heroi-grande-por-tela, the user, 22/10: "tentar ser grande para chegar na borda de
 * cima, mas depende do tamanho da tela; 720 vai ser diferente de 1080"; before, "o chapéu não ficar tão colado"): his
 * picture's framing (frameMoved: the stadium, or his own background moved with him) zoomed about his soles, so they stay
 * on the floor where they were and the top of his head (his box's: its alpha fills it) lands headRoom under the window's
 * top. The same rule for every hero and window, no size per hero. Never wider than the room between the column on the
 * left and 2% of the width from the right edge: he grows about his soles' middle, then slides inside that room. Never
 * smaller (z >= 1, so the file still covers the box; fitCutout shrinks him on windows wider than the bleed): with 9%
 * (menu-folga-topo) the CLT, whose framing already leaves him 8.0-8.4%, keeps it.
 */
export function frameHero(box:{w:number;h:number},art:StadiumArt,cut:Placeable,pos={x:.5,y:1}):Frame{
  const base=frameMoved(box,art,moveOf(cut),pos),at=boxIn(base,art,cut),feet=at.y+at.h,lo=columnRight(box),hi=box.w*.98;
  const z=Math.max(1,Math.min((feet-headRoom(box.h))/at.h,(hi-lo)/at.w));
  if(z===1)return base;
  const ax=at.x+at.w/2,w=at.w*z,slide=Math.min(Math.max(ax-w/2,lo),hi-w)-(ax-w/2),s=base.s*z;
  return {s,ox:Math.min(0,Math.max(box.w-art.w*s,ax-(ax-base.ox)*z+slide)),oy:feet-(feet-base.oy)*z};
}
/** Where the cutout stands in for the dance: the PC (the wide picture, taller than a phone on its side). */
export const CUTOUT_QUERY='(orientation: landscape) and (min-height: 521px)';
export const cutoutOf=(id:string):StadiumCutout|undefined=>RECORTES[id];
/**
 * The cutout's box in the stage (px) for the same framing the background uses (frameHero: frameArt, `pos` for `cover`,
 * zoomed to the window); a hero in another's place (lugar) by his own background's (frameMoved), so he and his floor
 * never part. The whole picture's px → the file's px: the same for the plain wide file, shifted by the bleed for E6's.
 */
export function placeCutout(box:{w:number;h:number},art:StadiumArt,cut:Placeable,pos={x:.5,y:1}){
  if(!(box.w>0&&box.h>0))return;
  return boxIn(frameHero(box,art,cut,pos),art,cut);
}
/** The margin a hero's head gets from the stage's top (px) when it would leave the screen: 2% of its height, at least 8. */
export const cutoutMargin=(h:number)=>Math.max(8,h*.02);
/**
 * The whole hero on screen, standing on the picture's floor (menu-1080-720-menino-inteiro, then menu-pes-nitidez): his
 * soles stay exactly where the background's framing (frameArt, via placeCutout) puts them, never lifted (a bottom margin
 * left him floating over the bar, the user's 1590x903 print). Only when his head would leave the top (a window wider
 * than the bleed) he shrinks around his feet down to the margin, his middle where it was, kept inside the box's width.
 */
export function fitCutout(box:{w:number;h:number},spot:{x:number;y:number;w:number;h:number}){
  const feet=Math.min(spot.y+spot.h,box.h),top=spot.y>=0?spot.y:cutoutMargin(box.h);
  const k=Math.min(1,(feet-top)/spot.h,box.w/spot.w);
  const w=spot.w*k,h=spot.h*k;
  const x=Math.min(Math.max(0,spot.x+(spot.w-w)/2),box.w-w);
  return {x,y:k<1?feet-h:spot.y-Math.max(0,spot.y+spot.h-box.h),w,h};
}
/**
 * The cutout's file for a hero shown `shownW` CSS px wide on a `dpr` screen: the smallest one with at least as many
 * pixels as the screen shows (never stretched above 1x when one is big enough), else the biggest.
 */
export function cutoutFile(cut:Pick<StadiumCutout,'files'>,shownW:number,dpr:number):string{
  const need=shownW*(dpr>0?dpr:1),files=[...cut.files].sort(([a],[b])=>a-b);
  return (files.find(([w])=>w>=need-.5)??files[files.length-1])[1];
}
