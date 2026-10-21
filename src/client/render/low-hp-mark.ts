/**
 * Low life by shape, not only by color (NEW-20261009-UX-acessibilidade, fatia 2): while the local hero's mini bar is
 * low (Cone fill), a cracked heart sits at its left and the hp number at its right, so deuteranopes and protanopes
 * read "low" without telling Cartolina from Cone. The heart is the HUD's i-coracao (ui/icons.svg) outline, Cone with
 * a Breu edge and a Breu zigzag crack; the number is Papel with a Breu stroke. Static (D-020 §2.5: no pulse).
 * Pure module (no Phaser) so node tests pin the shape and the layout down.
 */
import {LOW_HP} from './you-rules.ts';

export interface Pt {x:number;y:number}
/** Heart on screen, CSS px: width of the Cone body, the Breu edge around it and the crack's stroke. */
export const HEART_CSS={width:14,edge:2,crack:2} as const;
/** Hp number: font size and Breu stroke (CSS px), drawn from a raster this many times larger (crisp under zoom). */
export const LOW_NUMBER_CSS={size:14,stroke:3,raster:2} as const;
/** Space between the bar's Papel edge and the heart's edge / the number, CSS px. */
export const LOW_GAP_CSS=3;

/** i-coracao's path (viewBox 48): start point and four cubic segments [c1, c2, end]. */
const HEART_START:Pt={x:24,y:40};
const HEART_CURVES:readonly (readonly [Pt,Pt,Pt])[]=[
  [{x:10,y:30},{x:6,y:22},{x:10,y:15}],
  [{x:14,y:9},{x:21,y:10},{x:24,y:16}],
  [{x:27,y:10},{x:34,y:9},{x:38,y:15}],
  [{x:42,y:22},{x:38,y:30},{x:24,y:40}],
];
/** The icon's heart is ~32 units wide around (24, 26). */
const HEART_UNITS=32,HEART_CENTER:Pt={x:24,y:26};
/** Crack in icon units: from the top notch down to near the tip, three turns. */
const CRACK:readonly Pt[]=[{x:24,y:16},{x:21.5,y:22},{x:26,y:27},{x:22.5,y:32},{x:24,y:36}];

const place=(p:Pt,cx:number,cy:number,k:number):Pt=>({x:cx+(p.x-HEART_CENTER.x)*k,y:cy+(p.y-HEART_CENTER.y)*k});

/** Outline of a heart `width` wide centered at (cx, cy), closed polygon (last point = first), `steps` per curve. */
export function heartPoints(cx:number,cy:number,width:number,steps=6):Pt[]{
  const k=width/HEART_UNITS,out:Pt[]=[place(HEART_START,cx,cy,k)];
  let p0=HEART_START;
  for(const [c1,c2,end] of HEART_CURVES){
    for(let i=1;i<=steps;i++){
      const t=i/steps,u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;
      out.push(place({x:a*p0.x+b*c1.x+c*c2.x+d*end.x,y:a*p0.y+b*c1.y+c*c2.y+d*end.y},cx,cy,k));
    }
    p0=end;
  }
  return out;
}
/** The crack's polyline on the same heart. */
export function crackPoints(cx:number,cy:number,width:number):Pt[]{
  const k=width/HEART_UNITS;
  return CRACK.map(p=>place(p,cx,cy,k));
}

/** Whether the low mark shows: the bar is on screen, the hero is up and below LOW_HP (same rule as the Cone fill). */
export const lowMarkOn=(barVisible:boolean,fraction:number,downed=false)=>barVisible&&!downed&&fraction>0&&fraction<LOW_HP;
/** The number shown: whole hp, rounded up, so a living hero never reads "0". */
export const lowHpText=(hp:number)=>String(Math.max(1,Math.ceil(Number.isFinite(hp)?hp:1)));

/**
 * Where heart and number go around a bar (world px: its track's left/top/width/height, `s` world px per CSS px; the
 * Papel edge is 1 CSS px outside the track). Heart: centered at the bar's height, its edge LOW_GAP_CSS left of the
 * Papel edge. Number: left-aligned LOW_GAP_CSS right of the Papel edge, vertically centered on the bar.
 */
export function lowMarkLayout(left:number,top:number,width:number,height:number,s:number){
  const y=top+height/2,w=HEART_CSS.width*s;
  return {heart:{x:left-s-(LOW_GAP_CSS+HEART_CSS.edge)*s-w/2,y,width:w},number:{x:left+width+s+LOW_GAP_CSS*s,y}};
}
