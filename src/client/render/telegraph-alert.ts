/**
 * The "!" in the middle of every telegraph (NEW-20261009-UX-acessibilidade, fatia 1): a danger cue by SHAPE, so a
 * player who cannot tell the Laranja Cone from the grass or the snow (deuteranopia, protanopia) still reads the zone.
 * Papel glyph with a thick Breu outline, the same on every kind and on every ground; screen-constant size (CSS px),
 * shrunk to fit a small zone, never outside it. Pure module: it appends ops to the decoration buffer (telegraph-look.ts)
 * on the air layer, after the kind's own drawing, so nothing covers it.
 */
import {DECOR_ART_ALERT,HAZARD,LAYER_AIR,type DecorBuffer,type DecorFrame,type ProjectFn} from './telegraph-look.ts';
import {coneApertureOf,type Pt,type TelegraphShape} from './telegraph-shape.ts';

/** Glyph height and outline in CSS px, and the smallest height still drawn (a tinier zone gets no mark). */
export const ALERT_CSS={height:18,outline:2.5,min:7} as const;
/** Each try shrinks the glyph by this much until its box fits inside the drawn zone (at most ALERT_FIT_TRIES). */
export const ALERT_SHRINK=.85,ALERT_FIT_TRIES=8;
/**
 * Imported "!" plate (`alerta-perigo`, card efeitos-ataque-chatgpt): the painted badge is ALERT_ART_SCALE × the glyph
 * height wide (the plate around the "!"), drawn in place of the vector glyph; the same fit-inside-the-zone rule.
 */
export const ALERT_ART_SCALE=1.5;

const P:Pt={x:0,y:0};

/**
 * World point where the mark sits: the circle's center, the line's midpoint, the cone sector's centroid (2r·sin α/3α
 * from the apex, α = half aperture). Written into out.
 */
export function alertAnchor(t:TelegraphShape,out:Pt):Pt{
  if(t.shape==='circle'){out.x=t.x;out.y=t.y;return out;}
  let d=t.radius/2;
  if(t.shape==='cone'){const a=coneApertureOf(t)/2;d=a>1e-6?2*t.radius*Math.sin(a)/(3*a):2*t.radius/3;}
  out.x=t.x+t.dx*d;out.y=t.y+t.dy*d;return out;
}

/**
 * Plans the mark into `out` (no reset: it goes after planDecor's ops). pts[0..n) = the drawn outline at k = 1, in
 * scene px: the glyph shrinks until its box (outline included) is inside it. A circle uses the drawn ellipse's center
 * (f.bounds, terrain lift included) when known. Returns the buffer's op count.
 */
export function planAlert(t:TelegraphShape,f:DecorFrame,pts:readonly Pt[],n:number,project:ProjectFn,out:DecorBuffer):number{
  const b=f.bounds;
  if(t.shape==='circle'&&b.maxX>b.minX&&b.maxY>b.minY){P.x=(b.minX+b.maxX)/2;P.y=(b.minY+b.maxY)/2;}
  else{alertAnchor(t,P);project(P.x,P.y,P);}
  const cx=P.x,cy=P.y,min=ALERT_CSS.min*f.css,art=f.art?f.art.frames[DECOR_ART_ALERT]|0:0;
  const aspect=art?f.art!.aspect[DECOR_ART_ALERT]||1:1;
  let h=ALERT_CSS.height*f.css,o=0;
  for(let i=0;;i++){
    if(!(h>=min)||i>=ALERT_FIT_TRIES)return out.count;
    o=Math.min(ALERT_CSS.outline*f.css,h*.16);
    const w=h*ALERT_ART_SCALE;
    if(art?boxInside(pts,n,cx,cy,w/2,w*aspect/2):boxInside(pts,n,cx,cy,h*.17+o,h/2+o))break;
    h*=ALERT_SHRINK;
  }
  if(art){const w=h*ALERT_ART_SCALE;out.sprite(LAYER_AIR,1,DECOR_ART_ALERT,cx,cy,0,w,w*aspect,0);return out.count;}
  // Bar: a trapezoid from the top down to 64% of the height, wide on top; the dot under it.
  const top=cy-h/2,barEnd=cy+h*.14,wTop=h*.17,wEnd=h*.11,dotY=cy+h*.37,dotR=h*.13;
  // Breu outline first (the same shapes grown by o), then the Papel glyph.
  bar(out,HAZARD.breu,cx,top-o,barEnd+o,wTop+o,wEnd+o);
  out.circle(LAYER_AIR,HAZARD.breu,1,cx,dotY,dotR+o);
  bar(out,HAZARD.papel,cx,top,barEnd,wTop,wEnd);
  out.circle(LAYER_AIR,HAZARD.papel,1,cx,dotY,dotR);
  return out.count;
}

/** Whether the box (cx±hw, cy±hh) has its corners and edge midpoints inside the closed polygon pts[0..n) (even-odd). */
export function boxInside(pts:readonly Pt[],n:number,cx:number,cy:number,hw:number,hh:number){
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)if((i||j)&&!pointIn(pts,n,cx+i*hw,cy+j*hh))return false;
  return true;
}
function pointIn(pts:readonly Pt[],n:number,x:number,y:number){
  let c=false;
  for(let i=0,j=n-1;i<n;j=i++){const a=pts[i],b=pts[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)c=!c;}
  return c;
}

/** Vertical trapezoid centred on x: half width wTop at y0, wEnd at y1. */
function bar(out:DecorBuffer,color:number,x:number,y0:number,y1:number,wTop:number,wEnd:number){
  out.poly(LAYER_AIR,color,1);
  out.point(x-wTop,y0);out.point(x+wTop,y0);out.point(x+wEnd,y1);out.point(x-wEnd,y1);
}
