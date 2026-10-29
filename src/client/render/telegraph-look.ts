/**
 * D-036: each telegraph kind drawn its own way (arroto, molotov, fogo, cocô, explosão, and the Síndico's moves).
 * The danger edge (Breu | Papel | Cone bands inset on the server's zone, telegraph-shape.ts) is the same for every
 * kind; the kind changes the fill color and what is drawn inside, so a hazard reads by color AND by shape on a phone.
 * Pure module: the decoration is planned into a preallocated op buffer (no allocation per frame, one scratch point
 * for the projection) and HordeRenderer replays it on its two Graphics (ground under the horde, top above everything).
 */
import type {TelegraphKind} from '../../contract/index.ts';
import {coneApertureOf,lineWidthOf,type Pt,type TelegraphShape} from './telegraph-shape.ts';

const TAU=Math.PI*2;

/** What is drawn inside the zone. 'plain' = the generic look (boss slam and sweep, unknown or absent kind). */
export type DecorStyle='gas'|'bottle'|'flame'|'splat'|'burst'|'dash'|'stamp'|'plain';
export interface TelegraphLook {
  id:TelegraphKind|'generic';
  /** Zone fill and top wash color; undefined = the palette's Laranja Cone (the generic danger look). */
  fill?:number;
  /** Multiplier of the generic fill alphas (a gas cloud is thicker than the plain orange). */
  fillAlpha:number;
  decor:DecorStyle;
}

/**
 * Hazard colors (cartoon, hard edges; the outline bands stay Breu/Papel/Cone for every kind). Legibility audit 29/10:
 * the falling bottle is blue glass (the old green, 0x3f8a3a, vanished on the grass even for full color vision), and the
 * explosion's yellow is a lighter one so the gas (yellow-green) and the explosion do not merge for protan/deutan eyes.
 */
export const HAZARD={
  gas:0xb9cf34,gasLight:0xe4f08a,gasDark:0x55620f,
  fireRed:0xe0381a,fireOrange:0xff8a1f,fireYellow:0xffd84a,
  poop:0x7a4b24,poopDark:0x3f230e,poopWhite:0xf7f2e6,
  boomYellow:0xffe27a,boomRed:0xd2392f,boomWhite:0xfff6c8,
  ink:0xb3261e,wood:0x9b5a2a,glass:0x2a5fb0,glassLight:0x9cc4f0,
  breu:0x1e1530,papel:0xeeddb8,
} as const;

const GENERIC:TelegraphLook={id:'generic',fillAlpha:1,decor:'plain'};
export const TELEGRAPH_LOOKS:Readonly<Record<TelegraphKind|'generic',TelegraphLook>>=Object.freeze({
  generic:GENERIC,
  arroto:{id:'arroto',fill:HAZARD.gas,fillAlpha:1.5,decor:'gas'},
  molotov:{id:'molotov',fill:HAZARD.fireOrange,fillAlpha:1.1,decor:'bottle'},
  fogo:{id:'fogo',fill:HAZARD.fireRed,fillAlpha:1.4,decor:'flame'},
  coco:{id:'coco',fill:HAZARD.poop,fillAlpha:1.6,decor:'splat'},
  explosao:{id:'explosao',fill:HAZARD.boomYellow,fillAlpha:1.3,decor:'burst'},
  // The Síndico's moves keep the generic boss look; the charge gets its arrow and the stamp its mark.
  pancada:{id:'pancada',fillAlpha:1,decor:'plain'},
  investida:{id:'investida',fillAlpha:1,decor:'dash'},
  varredura:{id:'varredura',fillAlpha:1,decor:'plain'},
  carimbo:{id:'carimbo',fillAlpha:1,decor:'stamp'},
} satisfies Record<TelegraphKind|'generic',TelegraphLook>);

/** Look of a telegraph kind; absent or unknown (a newer server) = the generic look. */
export function telegraphLook(kind:string|undefined):TelegraphLook{
  return kind&&Object.prototype.hasOwnProperty.call(TELEGRAPH_LOOKS,kind)&&kind!=='generic'?TELEGRAPH_LOOKS[kind as TelegraphKind]:GENERIC;
}

/**
 * Explosion beat 0..1, faster near fireTick: the phase is 2π·c·√ticksLeft, so the rate (c/2√L per tick) goes from
 * ~2 Hz with 30 ticks left to ~11 Hz on the last tick. Reduced motion: steady 1.
 */
export const BURST_BEATS=1.1;
export function explosionBeat(ticksLeft:number,reduced:boolean){
  if(reduced)return 1;
  return .5+.5*Math.cos(TAU*BURST_BEATS*Math.sqrt(Math.max(0,ticksLeft)));
}

// ---------- op buffer ----------
export const OP_CIRCLE=1,OP_ELLIPSE=2,OP_POLY=3,OP_LINE=4,OP_RING=5;
/**
 * An imported decoration frame (art-d item 4): [code, layer, -1, alpha, slot, x, y, rotation, w, h, frame], the cell
 * centred on (x, y), stretched to w × h screen px and turned by `rotation` (rad, the art points to +x).
 */
export const OP_SPRITE=6;
/**
 * Imported decoration strips (`efeitos`), by slot: the charge's chevron (drawn pointing right, +x), the explosion's
 * target and the burp cloud (flowing right, +x, from the mouth on its left edge). Each replaces today's vector
 * decoration of its kind when the renderer says its texture is in (DecorFrame.art); the zone and its edge never change.
 */
export const DECOR_ART_IDS=['seta-investida','aviso-explosao','arroto'] as const;
export const DECOR_ART_ARROW=0,DECOR_ART_BURST=1,DECOR_ART_GAS=2;
/** Frames per second of a looping decoration strip. */
export const DECOR_ART_FPS=8;
/**
 * Both layers are drawn on the renderer's top Graphics (above the horde, so a hazard never hides behind a critter):
 * ZONE before the danger edge (the edge stays on top of it), AIR after it (what is in the air or sticks out of a
 * small zone: the bottle, the flames, the poop, the stamp, the charge arrow).
 */
export const LAYER_ZONE=0,LAYER_AIR=1;
/** Ops: [code, layer, color, alpha, ...args]; a polygon stores n then up to POLY_MAX points. */
export const DECOR_STRIDE=24,DECOR_MAX_OPS=128,POLY_MAX=9;

export class DecorBuffer {
  readonly data=new Float64Array(DECOR_MAX_OPS*DECOR_STRIDE);
  count=0;
  /** Ops dropped because the buffer was full (stays 0 with the shipped decorations; tests check it). */
  dropped=0;
  reset(){this.count=0;}
  private op(code:number,layer:number,color:number,alpha:number){
    if(this.count>=DECOR_MAX_OPS){this.dropped++;return -1;}
    const o=this.count++*DECOR_STRIDE,d=this.data;
    d[o]=code;d[o+1]=layer;d[o+2]=color;d[o+3]=Math.max(0,Math.min(1,alpha));return o+4;
  }
  circle(layer:number,color:number,alpha:number,x:number,y:number,r:number){
    const o=this.op(OP_CIRCLE,layer,color,alpha);if(o<0)return;const d=this.data;d[o]=x;d[o+1]=y;d[o+2]=r;
  }
  ellipse(layer:number,color:number,alpha:number,x:number,y:number,rx:number,ry:number){
    const o=this.op(OP_ELLIPSE,layer,color,alpha);if(o<0)return;const d=this.data;d[o]=x;d[o+1]=y;d[o+2]=rx;d[o+3]=ry;
  }
  ring(layer:number,color:number,alpha:number,x:number,y:number,rx:number,ry:number,width:number){
    const o=this.op(OP_RING,layer,color,alpha);if(o<0)return;const d=this.data;d[o]=x;d[o+1]=y;d[o+2]=rx;d[o+3]=ry;d[o+4]=width;
  }
  line(layer:number,color:number,alpha:number,x0:number,y0:number,x1:number,y1:number,width:number){
    const o=this.op(OP_LINE,layer,color,alpha);if(o<0)return;const d=this.data;d[o]=x0;d[o+1]=y0;d[o+2]=x1;d[o+3]=y1;d[o+4]=width;
  }
  sprite(layer:number,alpha:number,slot:number,x:number,y:number,rotation:number,w:number,h:number,frame:number){
    const o=this.op(OP_SPRITE,layer,-1,alpha);if(o<0)return;const d=this.data;
    d[o]=slot;d[o+1]=x;d[o+2]=y;d[o+3]=rotation;d[o+4]=w;d[o+5]=h;d[o+6]=frame;
  }
  /** Starts a polygon; add up to POLY_MAX points with point(). */
  poly(layer:number,color:number,alpha:number){
    const o=this.op(OP_POLY,layer,color,alpha);this.polyAt=o;if(o>=0)this.data[o]=0;
  }
  point(x:number,y:number){
    const o=this.polyAt;if(o<0)return;const d=this.data,n=d[o];if(n>=POLY_MAX)return;
    d[o+1+n*2]=x;d[o+2+n*2]=y;d[o]=n+1;
  }
  private polyAt=-1;
}

/** Per-frame input of the planner (the renderer fills one object and reuses it). */
export interface DecorFrame {
  /** Fill-up 0..1 (telegraphPulse). */
  u:number;
  /** Ticks until fireTick (fractional). */
  ticksLeft:number;
  now:number;reduced:boolean;
  /** 0..1 per telegraph id (hashPhase): every hazard wiggles on its own. */
  phase:number;
  /** Scene px per CSS px at the current zoom: minimum sizes on screen. */
  css:number;
  /**
   * Screen bounds of the drawn outline (minX, minY, maxX, maxY), when the caller has them: a circle's decoration then
   * fits the drawn ellipse exactly, terrain elevation included (the projector lifts each point by its own height).
   * maxX < minX = unknown (the planner projects the center and two radii instead).
   */
  bounds:{minX:number;minY:number;maxX:number;maxY:number};
  /**
   * Imported decorations whose texture is in, by DECOR_ART_IDS slot: `frames` (0 = absent: today's vector drawing) and
   * `aspect` (cell height / width). Omitted = none (the empty manifest).
   */
  art?:{frames:number[];aspect:number[]};
}
export type ProjectFn=(x:number,y:number,out:Pt)=>Pt;

// Module scratch (the planner is synchronous and not re-entrant).
const P:Pt={x:0,y:0};
let ox=0,oy=0,rx=1,ry=1;
let buf:DecorBuffer;

/** Projected zone frame of a circle: center (ox,oy) and the screen ellipse's semi-axes (rx,ry). */
function circleFrame(t:TelegraphShape,project:ProjectFn,bounds:DecorFrame['bounds']){
  if(bounds.maxX>bounds.minX&&bounds.maxY>bounds.minY){
    ox=(bounds.minX+bounds.maxX)/2;oy=(bounds.minY+bounds.maxY)/2;rx=(bounds.maxX-bounds.minX)/2;ry=(bounds.maxY-bounds.minY)/2;return;
  }
  project(t.x,t.y,P);ox=P.x;oy=P.y;
  const r=Math.max(1e-6,t.radius);
  project(t.x+r,t.y,P);const ax=P.x-ox,ay=P.y-oy;
  project(t.x,t.y+r,P);const bx=P.x-ox,by=P.y-oy;
  rx=Math.max(1e-3,Math.hypot(ax,bx));ry=Math.max(1e-3,Math.hypot(ay,by));
}
/** Unit-disk point (a,b) of the circle frame on screen. */
const sx=(a:number)=>ox+a*rx,sy=(b:number)=>oy+b*ry;

/**
 * Plans the decoration of one telegraph into `out` (reset first). Returns the op count. Same input, same ops: the
 * look is a pure function of (shape, kind, frame), never of call history.
 */
export function planDecor(t:TelegraphShape&{kind?:string},f:DecorFrame,project:ProjectFn,out:DecorBuffer):number{
  out.reset();buf=out;
  const look=telegraphLook(t.kind);
  switch(look.decor){
    case 'gas':gas(t,f,project);break;
    case 'bottle':if(t.shape==='circle'){circleFrame(t,project,f.bounds);bottle(f);}break;
    case 'flame':if(t.shape==='circle'){circleFrame(t,project,f.bounds);flames(f);}break;
    case 'splat':if(t.shape==='circle'){circleFrame(t,project,f.bounds);splat(f);}break;
    case 'burst':if(t.shape==='circle'){circleFrame(t,project,f.bounds);burst(f);}break;
    case 'stamp':if(t.shape==='circle'){circleFrame(t,project,f.bounds);stamp(f);}break;
    case 'dash':dash(t,f,project);break;
  }
  return out.count;
}

/** Projects the world point at distance d and angle a from the zone's origin into the scratch point. */
function polar(t:TelegraphShape,a:number,d:number,project:ProjectFn){return project(t.x+Math.cos(a)*d,t.y+Math.sin(a)*d,P);}
const fade=(f:number)=>Math.min(1,f/.15,(1-f)/.2);
/** Frames of decoration `slot` that are in (0 = draw today's vectors). */
const artFrames=(f:DecorFrame,slot:number)=>f.art?f.art.frames[slot]|0:0;
/** Looping frame of a strip of `frames` (offset by `shift` frames); reduced motion: still on frame 0. */
export const decorLoopFrame=(f:{now:number;reduced:boolean},frames:number,shift=0)=>
  f.reduced||frames<=1?0:(Math.floor(Math.max(0,f.now)/1000*DECOR_ART_FPS)+shift)%frames;

/** Arroto: a burp of gas puffs rolling from the drunk's mouth to the rim, bubbles and a burp swirl at the mouth. */
function gas(t:TelegraphShape,f:DecorFrame,project:ProjectFn){
  const b=buf,c=f.css,r=t.radius,phase=f.phase*TAU;
  const facing=Math.atan2(t.dy,t.dx),half=t.shape==='cone'?coneApertureOf(t)/2:t.shape==='line'?.2:Math.PI;
  project(t.x,t.y,P);const ax=P.x,ay=P.y;
  project(t.x+t.dx*r,t.y+t.dy*r,P);const len=Math.hypot(P.x-ax,P.y-ay);
  const spread=Math.min(.9,Math.sin(Math.min(half,Math.PI/2))),flow=f.reduced?0:f.now*.00032;
  const gasArt=artFrames(f,DECOR_ART_GAS);
  if(gasArt>0){
    // Imported burp cloud: from the mouth to the rim along the facing, as wide as the zone allows (cell aspect kept).
    const ex=P.x,ey=P.y,aspect=f.art?.aspect[DECOR_ART_GAS]||1;
    b.sprite(LAYER_ZONE,.95,DECOR_ART_GAS,(ax+ex)/2,(ay+ey)/2,Math.atan2(ey-ay,ex-ax),len,len*aspect,decorLoopFrame(f,gasArt));
    return;
  }
    // Puffs: olive edge, light body, a highlight; bigger toward the rim.
  for(let i=0;i<6;i++){
    const k=((i+.5)/6+flow)%1,side=half*.6*Math.sin(i*2.1+phase),q=polar(t,facing+side,k*.86*r+.08*r,project);
    const pr=Math.max(5*c,(.1+.32*k)*len*spread),a=fade(k);
    b.circle(LAYER_ZONE,HAZARD.gasDark,.75*a,q.x,q.y,pr+2*c);
    b.circle(LAYER_ZONE,HAZARD.gasLight,.9*a,q.x,q.y,pr);
    b.circle(LAYER_ZONE,0xffffff,.5*a,q.x-pr*.32,q.y-pr*.34,pr*.28);
  }
  // Bubbles: Papel rings with a gas body, drifting faster than the puffs.
  for(let j=0;j<4;j++){
    const k=((j+.25)/4+flow*1.7)%1,side=half*.8*Math.sin(j*3.3+phase*1.7),q=polar(t,facing+side,k*.9*r+.05*r,project),br=(3+2.5*k)*c,a=fade(k);
    b.circle(LAYER_ZONE,HAZARD.gas,.5*a,q.x,q.y,br);
    b.ring(LAYER_ZONE,HAZARD.papel,.95*a,q.x,q.y,br,br,1.6*c);
    b.circle(LAYER_ZONE,0xffffff,.9*a,q.x-br*.35,q.y-br*.35,Math.max(.8*c,br*.22));
  }
  // The burp swirl at the mouth: a 1.5-turn spiral of short strokes.
  const m=polar(t,facing,.16*r,project),mx=m.x,my=m.y,sr=Math.min(len*.12,14*c),spin=f.reduced?0:f.now*.006;
  let px=mx,py=my;
  for(let k=1;k<=10;k++){
    const a=k*.95+spin+phase,rad=sr*k/10,x=mx+Math.cos(a)*rad,y=my+Math.sin(a)*rad*.6;
    b.line(LAYER_ZONE,HAZARD.gasDark,.9,px,py,x,y,2.2*c);px=x;py=y;
  }
}

/** Molotov: target rings and an orange rim on the ground, the burning cachaça bottle falling onto the center. */
function bottle(f:DecorFrame){
  const b=buf,c=f.css;
  // Orange rim and the reticle.
  b.ring(LAYER_ZONE,HAZARD.fireOrange,.9,ox,oy,rx*.84,ry*.84,Math.max(3*c,ry*.1));
  b.ring(LAYER_ZONE,HAZARD.breu,.7,ox,oy,rx*.45,ry*.45,1.8*c);
  for(let k=0;k<4;k++){
    const a=k*Math.PI/2,ca=Math.cos(a),sa=Math.sin(a);
    b.line(LAYER_ZONE,HAZARD.breu,.75,sx(ca*.28),sy(sa*.28),sx(ca*.66),sy(sa*.66),2.2*c);
  }
  // Shadow of the bottle, growing as it comes down.
  b.ellipse(LAYER_ZONE,HAZARD.breu,.2+.3*f.u,ox,oy,Math.max(4*c,rx*(.12+.22*f.u)),Math.max(2*c,ry*(.12+.22*f.u)));
  // The falling bottle (in the air: top layer), its drop dots down to the target.
  const lift=(10+50*(1-f.u))*c,by=oy-lift,angle=f.reduced?.35:f.now*.009+f.phase*TAU;
  for(let k=1;k<=3;k++){const y=by+(oy-by)*k/4;if(lift>16*c)b.circle(LAYER_AIR,HAZARD.breu,.55,ox,y,1.8*c);}
  fallingBottle(ox,by,c*1.15,angle);
}
/** Rotated box (center cx,cy; local center lx,ly; size w×h) as a polygon. */
function box(layer:number,color:number,alpha:number,cx:number,cy:number,cos:number,sin:number,lx:number,ly:number,w:number,h:number){
  buf.poly(layer,color,alpha);
  for(let i=0;i<4;i++){const x=lx+(i===1||i===2?w/2:-w/2),y=ly+(i>=2?h/2:-h/2);buf.point(cx+x*cos-y*sin,cy+x*sin+y*cos);}
}
function fallingBottle(cx:number,cy:number,s:number,angle:number){
  const cos=Math.cos(angle),sin=Math.sin(angle),e=1.8;
  // Breu silhouette first (hard sticker edge), then glass, label and the burning rag.
  box(LAYER_AIR,HAZARD.breu,1,cx,cy,cos,sin,0,4*s,(11+2*e)*s,(16+2*e)*s);
  box(LAYER_AIR,HAZARD.breu,1,cx,cy,cos,sin,0,-7*s,(4.5+2*e)*s,(9+2*e)*s);
  box(LAYER_AIR,HAZARD.glass,1,cx,cy,cos,sin,0,4*s,11*s,16*s);
  box(LAYER_AIR,HAZARD.glass,1,cx,cy,cos,sin,0,-7*s,4.5*s,9*s);
  box(LAYER_AIR,HAZARD.papel,1,cx,cy,cos,sin,0,5*s,11*s,5*s);
  box(LAYER_AIR,HAZARD.glassLight,.8,cx,cy,cos,sin,-3*s,1*s,2*s,9*s);
  // Rag flame on the neck: orange tongue with a yellow core.
  rag(cx,cy,cos,sin,-11*s,9*s,13*s,HAZARD.fireOrange);
  rag(cx,cy,cos,sin,-11*s,4.5*s,7*s,HAZARD.fireYellow);
}
/** A flame tongue on the bottle's neck (local y = ly), rotated with the bottle. */
function rag(cx:number,cy:number,cos:number,sin:number,ly:number,w:number,h:number,color:number){
  buf.poly(LAYER_AIR,color,1);
  for(let i=0;i<TONGUE.length;i+=2){const qx=TONGUE[i]*w,qy=ly+TONGUE[i+1]*h;buf.point(cx+qx*cos-qy*sin,cy+qx*sin+qy*cos);}
}
/** A flame tongue, base at (0,0), tip at (0,-1), width 1. */
const TONGUE:readonly number[]=[-.5,0,-.56,-.34,-.3,-.7,0,-1,.3,-.7,.56,-.34,.5,0];

/**
 * Fogo: a red patch with a hot core on the zone, and upright flickering flames standing in it (AIR: they stick out of
 * a small zone and are what reads at a glance), embers going up.
 */
/** Flames as (x, y on the unit disk, size), back to front. */
const FLAMES:readonly number[]=[-.42,-.3,.85, .4,-.32,.9, 0,-.05,1.15, -.5,.3,.8, .48,.28,.85];
function flames(f:DecorFrame){
  const b=buf,c=f.css,phase=f.phase*TAU;
  b.ellipse(LAYER_ZONE,HAZARD.fireRed,.7,ox,oy,rx*.9,ry*.9);
  b.ellipse(LAYER_ZONE,HAZARD.fireOrange,.75,ox,oy,rx*.5,ry*.5);
  const w0=Math.max(9*c,rx*.36);
  for(let i=0;i*3<FLAMES.length;i++){
    const x=sx(FLAMES[i*3]*.78),y=sy(FLAMES[i*3+1]*.78),size=FLAMES[i*3+2],flick=f.reduced?0:Math.sin(f.now*.021+i*1.7+phase),sway=f.reduced?0:Math.sin(f.now*.013+i*2.3)*.14;
    const w=w0*size,h=w*1.8*(1+.18*flick);
    flame(x,y,w+3*c,h+3.4*c,sway,HAZARD.breu,1);
    flame(x,y,w,h,sway,HAZARD.fireRed,1);
    flame(x,y,w*.72,h*.8,sway,HAZARD.fireOrange,1);
    flame(x,y,w*.38,h*.45,sway,HAZARD.fireYellow,1);
  }
  if(!f.reduced)for(let k=0;k<3;k++){
    const age=(f.now*.0011+k/3+f.phase)%1,x=sx(Math.sin(k*2.4+phase)*.45),y=sy(.1*k)-age*w0*3.4;
    b.circle(LAYER_AIR,HAZARD.fireYellow,1-age,x,y,Math.max(1.5*c,2.4*c*(1-age)));
  }
}
function flame(x:number,y:number,w:number,h:number,sway:number,color:number,alpha:number){
  buf.poly(LAYER_AIR,color,alpha);
  for(let i=0;i<TONGUE.length;i+=2)buf.point(x+TONGUE[i]*w-TONGUE[i+1]*sway*w,y+TONGUE[i+1]*h);
}

/**
 * Cocô: a brown splat with drops around it, white blobs on top and a wet shine, and the next plop falling on it.
 * The pigeons' puddle is small (POOP.radius 0.5): the splat goes over the edge's inner band (AIR), the outer Breu and
 * Papel bands still show around it, and the falling plop reads at a glance.
 */
/** Drops around the splat as (angle, distance, size) on the unit disk. */
const DROPS:readonly number[]=[.3,.66,.11, 1.6,.68,.09, 2.7,.64,.12, 3.8,.68,.09, 5,.66,.1];
function splat(f:DecorFrame){
  const b=buf,c=f.css,rot=f.phase*TAU,e=1.6*c;
  for(let i=0;i<DROPS.length;i+=3){const a=DROPS[i]+rot,d=DROPS[i+1],s=DROPS[i+2],x=sx(Math.cos(a)*d),y=sy(Math.sin(a)*d);
    b.ellipse(LAYER_AIR,HAZARD.poopDark,1,x,y,rx*s+e,ry*s+e);
    b.ellipse(LAYER_AIR,HAZARD.poop,1,x,y,rx*s,ry*s);}
  b.ellipse(LAYER_AIR,HAZARD.poopDark,1,ox,oy,rx*.48+e,ry*.42+e);
  b.ellipse(LAYER_AIR,HAZARD.poop,1,ox,oy,rx*.48,ry*.42);
  // The white part (it is a pigeon's), with a dark dot, and the shine.
  b.ellipse(LAYER_AIR,HAZARD.poopWhite,1,sx(-.1),sy(-.06),rx*.26,ry*.24);
  b.ellipse(LAYER_AIR,HAZARD.poopWhite,1,sx(.2),sy(.1),rx*.15,ry*.15);
  b.circle(LAYER_AIR,HAZARD.poopDark,1,sx(-.1),sy(-.08),Math.max(1.2*c,ry*.1));
  const shine=f.reduced?1:.55+.45*Math.sin(f.now*.006+rot);
  b.ellipse(LAYER_AIR,0xffffff,.9*shine,sx(.24),sy(-.2),Math.max(1.6*c,rx*.08),Math.max(1*c,ry*.06));
  // The next plop on its way down (a white drop with a brown heart), its shadow growing on the puddle.
  if(f.u<.97){
    const lift=(6+26*(1-f.u))*c,s=c*1.5,cy=oy-lift;
    b.ellipse(LAYER_ZONE,HAZARD.breu,.25+.25*f.u,ox,oy,Math.max(3*c,rx*.25),Math.max(1.6*c,ry*.25));
    drop(ox,cy+1.6*c,9*s+3.2*c,13*s+3.6*c,HAZARD.breu);
    drop(ox,cy,9*s,13*s,HAZARD.poopWhite);
    b.ellipse(LAYER_AIR,HAZARD.poop,1,ox+.5*s,cy-3.6*s,2.8*s,2.6*s);
    b.circle(LAYER_AIR,0xffffff,1,ox-1.6*s,cy-8.5*s,1.1*s);
  }
}
/** A drop, tip up, width 1 and height 1, origin at the bottom: (x, y) pairs. */
const DROP:readonly number[]=[0,-1, .3,-.62, .5,-.3, .42,-.07, 0,0, -.42,-.07, -.5,-.3, -.3,-.62];
/** A falling drop with its bottom at (x,y): width w, height h. */
function drop(x:number,y:number,w:number,h:number,color:number){
  buf.poly(LAYER_AIR,color,1);
  for(let i=0;i<DROP.length;i+=2)buf.point(x+DROP[i]*w,y+DROP[i+1]*h);
}

/** Explosão: a red starburst ring on a yellow disk with a white-hot core, pulsing faster as fireTick nears. */
function burst(f:DecorFrame){
  const b=buf,beat=explosionBeat(f.ticksLeft,f.reduced),s=.84+.16*beat,rot=f.phase*TAU,n=12;
  const art=artFrames(f,DECOR_ART_BURST);
  // Imported target: on the zone's ellipse (inside the edge, today's .92), pulsing with the beat; its frames follow it.
  if(art>0){b.sprite(LAYER_ZONE,1,DECOR_ART_BURST,ox,oy,0,2*rx*.92*s,2*ry*.92*s,Math.min(art-1,Math.floor(beat*art)));return;}
  b.ellipse(LAYER_ZONE,HAZARD.boomRed,.35+.25*beat,ox,oy,rx*.92,ry*.92);
  for(let k=0;k<n;k++){
    const a=rot+k*TAU/n,w=TAU/n*.42,ro=(k%2?.8:.95)*s;
    b.poly(LAYER_ZONE,HAZARD.boomRed,.95);
    b.point(sx(Math.cos(a-w)*.4*s),sy(Math.sin(a-w)*.4*s));b.point(sx(Math.cos(a)*ro),sy(Math.sin(a)*ro));b.point(sx(Math.cos(a+w)*.4*s),sy(Math.sin(a+w)*.4*s));
  }
  b.ellipse(LAYER_ZONE,HAZARD.boomYellow,1,ox,oy,rx*.46*s,ry*.46*s);
  b.ellipse(LAYER_ZONE,HAZARD.boomWhite,.6+.4*beat,ox,oy,rx*.24*s,ry*.24*s);
}

/** Carimbo (boss): the stamp's ink mark on the ground and the stamp coming down on it. */
function stamp(f:DecorFrame){
  const b=buf,c=f.css;
  b.ring(LAYER_ZONE,HAZARD.ink,.85,ox,oy,rx*.6,ry*.6,Math.max(3*c,ry*.08));
  b.ring(LAYER_ZONE,HAZARD.ink,.85,ox,oy,rx*.46,ry*.46,1.8*c);
  for(let k=-1;k<=1;k++)b.line(LAYER_ZONE,HAZARD.ink,.85,sx(-.26+.06*Math.abs(k)),sy(k*.14),sx(.26-.06*Math.abs(k)),sy(k*.14),2.6*c);
  const lift=(8+48*(1-f.u))*c,s=c*1.3,cy=oy-lift;
  b.ellipse(LAYER_ZONE,HAZARD.breu,.18+.3*f.u,ox,oy,Math.max(6*c,rx*.3),Math.max(3*c,ry*.3));
  // Rubber stamp: ink pad, wooden block, neck and knob, all with a Breu edge.
  const e=1.8*s;
  b.circle(LAYER_AIR,HAZARD.breu,1,ox,cy-26*s,6*s+e);
  box(LAYER_AIR,HAZARD.breu,1,ox,cy,1,0,0,-14*s,5*s+2*e,12*s+2*e);
  box(LAYER_AIR,HAZARD.breu,1,ox,cy,1,0,0,-3*s,22*s+2*e,10*s+2*e);
  box(LAYER_AIR,HAZARD.wood,1,ox,cy,1,0,0,-14*s,5*s,12*s);
  box(LAYER_AIR,HAZARD.wood,1,ox,cy,1,0,0,-4*s,22*s,8*s);
  box(LAYER_AIR,HAZARD.ink,1,ox,cy,1,0,0,1*s,22*s,3*s);
  b.circle(LAYER_AIR,HAZARD.wood,1,ox,cy-26*s,6*s);
  b.circle(LAYER_AIR,0xffffff,.45,ox-2*s,cy-28*s,1.8*s);
}

/** Investida (boss charge): chevrons along the line, flowing toward where the charge goes. */
function dash(t:TelegraphShape,f:DecorFrame,project:ProjectFn){
  if(t.shape==='circle')return;
  const b=buf,c=f.css,r=t.radius,w=t.shape==='line'?lineWidthOf(t):Math.min(r*.5,2*r*Math.tan(coneApertureOf(t)/4));
  const nx=-t.dy,ny=t.dx,back=Math.min(w*.45,r*.12),side=w*.34,flow=f.reduced?0:f.now*.0007,art=artFrames(f,DECOR_ART_ARROW);
  for(let i=0;i<3;i++){
    const k=((i+.5)/3+flow)%1,d=back+k*(r-back*1.4),a=fade(k);
    project(t.x+t.dx*d,t.y+t.dy*d,P);const tx=P.x,ty=P.y;
    project(t.x+t.dx*(d-back)+nx*side,t.y+t.dy*(d-back)+ny*side,P);const lx=P.x,ly=P.y;
    project(t.x+t.dx*(d-back)-nx*side,t.y+t.dy*(d-back)-ny*side,P);const qx=P.x,qy=P.y;
    if(art>0){
      // Imported chevron over today's: from the arms' midpoint to the tip, as wide as the arms (+ today's 6 px stroke).
      const mx=(lx+qx)/2,my=(ly+qy)/2;
      b.sprite(LAYER_AIR,a,DECOR_ART_ARROW,(mx+tx)/2,(my+ty)/2,Math.atan2(ty-my,tx-mx),Math.hypot(tx-mx,ty-my)+6*c,Math.hypot(lx-qx,ly-qy)+6*c,decorLoopFrame(f,art,i));
      continue;
    }
    b.line(LAYER_AIR,HAZARD.breu,.9*a,lx,ly,tx,ty,6*c);b.line(LAYER_AIR,HAZARD.breu,.9*a,qx,qy,tx,ty,6*c);
    b.circle(LAYER_AIR,HAZARD.breu,.9*a,tx,ty,3*c);
    b.line(LAYER_AIR,HAZARD.papel,a,lx,ly,tx,ty,2.6*c);b.line(LAYER_AIR,HAZARD.papel,a,qx,qy,tx,ty,2.6*c);
    b.circle(LAYER_AIR,HAZARD.papel,a,tx,ty,1.3*c);
  }
}

/** The colors a plan uses (tests: every hazard kind draws with its own set). */
export function opColors(out:DecorBuffer){
  const colors=new Set<number>();
  for(let i=0;i<out.count;i++)colors.add(out.data[i*DECOR_STRIDE+2]);
  return colors;
}
