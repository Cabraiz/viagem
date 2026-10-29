/**
 * "You in the world" rules (UX-voce-e-dano): when the local hero's marker, health bar and "Você" arrow show,
 * and when a tree canopy hides a hero. Pure module (no Phaser) so node tests pin the rules down.
 */
import {BURPEE_TICKS,ticks,type VehicleKind} from '../../contract/index.ts';
import {REVIVE_INVULNERABLE_TICKS,START_GRACE_S,VEICULO} from '../../rules/index.ts';

/** The "Você" arrow shows this long at the start of each round and when the hero gets back up. */
export const ARROW_MS=2000;
/** The mini health bar stays this long after the hero is back to full. */
export const HP_LINGER_MS=2000;
/** Below this fraction of max hp the hero is "low" (bar turns Laranja Cone, the screen keeps a static edge). */
export const LOW_HP=.3;
/** On-screen size of the mini health bar, in CSS px (card: ≥ 28×4), before the hero's draw scale (×0.8: 28.8×4.8). */
export const HP_BAR_CSS={width:36,height:6} as const;
/**
 * Smallest on-screen ground ring, in CSS px; it grows with the sprite when the camera zooms in (D-019).
 * Three hard layers (design onda 3 §0): Breu 2 inside, Lilás Janela ("você") 4, Papel 2 outside, plus an 8 px beak
 * toward where the hero faces, so it never reads as the thin plain rings of the allies.
 */
export const RING_CSS={width:52,height:26,breu:2,voce:4,papel:2,beak:8} as const;
/**
 * The ring's radius against today's (BUG-20261013-ORQ-anel-voce-atras: 30 % smaller, at the feet, behind the hero).
 * Band widths, the beak and the Breu edge keep their CSS px, so it reads the same on every ground.
 */
export const RING_SCALE=.7;
/** The ring sits this far under the sprite on top (its sticker contour is at −0.2/−0.1, its shadow at −1). */
export const RING_UNDER=.3;
/**
 * Ellipse (world px) of the ring for a drawn figure `figWidth` wide at `s` world px per CSS px. `k`: the hero's draw
 * scale (render/draw-scale.ts HERO_DRAW_SCALE) on the CSS floor too, so the ring shrinks with the sprite.
 */
export function ringSize(figWidth:number,s:number,k=1):{w:number;h:number}{
  const w=Math.max(RING_CSS.width*s*k,figWidth*.8);
  return {w:w*RING_SCALE,h:Math.max(RING_CSS.height*s*k,w*.5)*RING_SCALE};
}
/**
 * The local hero's own contour (card heroi-contorno-fino): ONE line, `HERO_LINE_CSS` outside the figure, of tint-filled
 * copies of the sprite in 8 directions. The old sticker (Breu + Papel 2 + Breu) read as a sticker pasted on the scene
 * and swallowed the cap and the hands; the ground ring and the "Você" arrow already say "you".
 * 'traco': a thin Breu line, the line every figure has in the city (CITY_RING, baked in the hero's city copy), so in the
 * city it adds nothing. 'brilho': a 1 px rim in Lilás Janela ("você"), outside the city copy's Breu ring.
 */
export type ContourStyle='traco'|'brilho';
export const HERO_CONTOUR:ContourStyle='traco';
export const HERO_LINE_CSS=1;
/** The contour copies sit this far under the sprite on top, over the ring on the ground (RING_UNDER). */
export const CONTOUR_DEPTH=-.2;
/**
 * The contour's line for `style`: its colour token and width in CSS px, or none. `ringed`: the sprite shows its city
 * copy, whose Breu ring is already the line (until the copy is built, and off the city, the copies draw it).
 */
export function contourLine(style:ContourStyle,ringed:boolean):{token:'--c-breu'|'--c-voce';css:number}|undefined{
  if(style==='brilho')return {token:'--c-voce',css:HERO_LINE_CSS};
  return ringed?undefined:{token:'--c-breu',css:HERO_LINE_CSS};
}
/** 8 directions for the contour copies (unit offsets). */
export const OUTLINE_DIRS:readonly {x:number;y:number}[]=Array.from({length:8},(_,i)=>({x:Math.round(Math.cos(i*Math.PI/4)*1e6)/1e6,y:Math.round(Math.sin(i*Math.PI/4)*1e6)/1e6}));

/** Outer Breu band of the ring in the Cidade Nevada, CSS px (card cidade-contorno-breu: Lilás and Papel vanish on snow). */
export const RING_CITY_BREU_CSS=2;
export interface RingBand {width:number;offset:number}
/**
 * Ring strokes, outer to inner: [width, radius offset from the ellipse] in CSS px, so each layer is a hard band.
 * City: plus `outer`, a Breu band of RING_CITY_BREU_CSS right outside the Papel (drawn first); elsewhere none.
 */
export function ringBands(city=false):{papel:RingBand;voce:RingBand;breu:RingBand;outer?:RingBand}{
  const {breu,voce,papel}=RING_CSS,total=breu+voce+papel;
  const bands={papel:{width:total,offset:0},voce:{width:voce,offset:(total-voce)/2-papel},breu:{width:breu,offset:-(total-breu)/2}};
  return city?{...bands,outer:{width:RING_CITY_BREU_CSS,offset:(total+RING_CITY_BREU_CSS)/2}}:bands;
}

/**
 * A beak (base half-width `half` on the ellipse, tip `length` out) grown by `edge` on its two slanted sides: the tip
 * moves out by edge/sin(α) and the base widens by edge/cos(α), α the tip's half-angle. The city's Breu beak, drawn
 * under the Papel one, so the beak keeps a Breu edge of `edge` like the ring.
 */
export function grownBeak(length:number,half:number,edge:number){
  const a=Math.atan2(half,length);
  return {length:length+edge/Math.sin(a),half:half+edge/Math.cos(a)};
}

/** Beak of the ring: a triangle on the ellipse (center x,y, radii a,b) pointing outward at screen angle `angle`. */
export function beakPoints(x:number,y:number,a:number,b:number,angle:number,length:number,half:number){
  const c=Math.cos(angle),s=Math.sin(angle),px=x+a*c,py=y+b*s;
  // Outward normal of the ellipse at that point, and its tangent.
  let nx=c/a,ny=s/b;const n=Math.hypot(nx,ny)||1;nx/=n;ny/=n;
  return [{x:px-ny*half,y:py+nx*half},{x:px+ny*half,y:py-nx*half},{x:px+nx*length,y:py+ny*length}];
}

/** Screen-space facing from the hero's last on-screen move (radians); keeps `previous` while standing still. */
export function facingFrom(dx:number,dy:number,previous:number){
  return Math.hypot(dx,dy)>.5?Math.atan2(dy,dx):previous;
}

export const clampFraction=(hp:number,maxHp:number)=>maxHp>0&&Number.isFinite(hp)?Math.min(1,Math.max(0,hp/maxHp)):0;

/**
 * Health bar visibility: shown while hp < max; once full again it lingers HP_LINGER_MS and hides.
 * Keep the returned `fullSince` and pass it back next frame (undefined = not full yet).
 */
export function hpBarStep(fraction:number,fullSince:number|undefined,now:number,downed=false){
  if(downed)return {visible:false,fullSince:undefined};
  if(fraction<1)return {visible:true,fullSince:undefined};
  const since=fullSince??now;
  return {visible:now-since<HP_LINGER_MS,fullSince:since};
}

/** Arrow state `age` ms after it was triggered: one bob in the first 500 ms (the show is the stamp), then still. */
export const ARROW_BOB_MS=500;
export function arrowFrame(age:number,reduced:boolean){
  if(!(age>=0)||age>=ARROW_MS)return {visible:false,bob:0};
  return {visible:true,bob:reduced||age>=ARROW_BOB_MS?0:Math.sin(age/ARROW_BOB_MS*Math.PI)};
}

/** Strength (0.35..1) of the screen-edge flash for one hit: a hit worth a quarter of max hp or more is full. */
export function hurtStrength(amount:number,maxHp:number){
  if(!(amount>0))return 0;
  const share=maxHp>0?amount/maxHp:1;
  return Math.min(1,Math.max(.35,share*4));
}

/** A tree on screen: its base point, half the canopy width and its height (screen px of the world camera). */
export interface CanopyBox {x:number;y:number;halfWidth:number;height:number;front:boolean}
/**
 * Whether a tree drawn in front of the hero covers their sprite (same test the scene uses to soften canopies):
 * the tree stands lower on screen than the hero's feet, within its canopy width and height.
 */
export function canopyCovers(hero:{x:number;y:number},tree:CanopyBox){
  return tree.front&&Math.abs(tree.x-hero.x)<tree.halfWidth&&tree.y>hero.y&&tree.y-hero.y<tree.height;
}

/** Events in a view that bring the arrow back: a round starting, or the local player getting back up. */
export function arrowTrigger(events:readonly {type:string;phase?:unknown;player?:unknown}[],selfId:string){
  return events.some(e=>(e.type==='round'&&e.phase==='wave')||(e.type==='revived'&&e.player===selfId));
}

/**
 * comeca-armado-e-levanta-seguro (itens 2 e 3): while the server keeps a hero untouchable his sprite blinks, hard (alpha
 * steps, no glow filter): REVIVE_INVULNERABLE_TICKS after a `revived`, and the start grace (the run's first
 * START_GRACE_S until his first crate). The state is server-only, so the client keeps the same clock from the events.
 */
export const SAFE_BLINK_MS=110,SAFE_ALPHA=.4,SAFE_ALPHA_REDUCED=.7;
export class SafeClock {
  private readonly revived=new Map<string,number>();
  private readonly opened=new Set<string>();
  private last=-1;private run=false;
  /** One run view: its tick, its events, and whether a run is on (the waiting room has no round). */
  push(tick:number,events:readonly {type:string;player?:unknown;kind?:unknown}[],run:boolean){
    // A rematch restarts the tick: the old run's clocks go.
    if(tick<this.last){this.revived.clear();this.opened.clear();}
    this.last=tick;this.run=run;
    for(const e of events){
      if(typeof e.player!=='string')continue;
      if(e.type==='revived')this.revived.set(e.player,tick+REVIVE_INVULNERABLE_TICKS);
      else if(e.type==='pickup'&&e.kind==='chest')this.opened.add(e.player);
    }
  }
  on(id:string,tick:number){
    return this.run&&(tick<(this.revived.get(id)??-1)||tick<ticks(START_GRACE_S)&&!this.opened.has(id));
  }
}
/** The sprite's alpha while safe: `base` (down, offline, in the shop) wins; reduced motion keeps a steady see-through. */
export function safeAlpha(base:number,on:boolean,now:number,reduced=false){
  if(!on||base<1)return base;
  return reduced?SAFE_ALPHA_REDUCED:Math.floor(now/SAFE_BLINK_MS)%2?SAFE_ALPHA:1;
}

/**
 * D-036 movement effects on the local hero: a chip per active effect to the right of the head (Papel disc, Breu edge,
 * hard sticker style): the bêbado's burp cloud while slowed, the pigeon-poop swirl while slipping. CSS px.
 */
export const STATUS_CSS={radius:11,edge:2,gap:4} as const;
/** Whether a timed player state (slowUntil, slipUntil) is still on at `tick` (the server's rule: tick < until). */
export const effectOn=(until:number|undefined,tick:number)=>typeof until==='number'&&tick<until;
/** Points of a spiral (center cx,cy; outer radius r; `turns` turns; rotated by rot) into out[0..n); returns n. */
export function spiralPoints(cx:number,cy:number,r:number,turns:number,rot:number,out:{x:number;y:number}[],n=out.length){
  for(let k=0;k<n;k++){const f=n>1?k/(n-1):0,a=rot+f*turns*Math.PI*2,p=out[k];p.x=cx+Math.cos(a)*r*f;p.y=cy+Math.sin(a)*r*f;}
  return n;
}
/**
 * Veículos: the self chip of a ride on `tick` (the vehicle and the share left, 0..1, of its whole ride; none for the
 * scooter, whose battery dies when it wants).
 */
export function rideChip(kind:VehicleKind,until:number,tick:number):{kind:VehicleKind;left?:number}{
  if(kind==='patinete')return {kind};
  const total=ticks(VEICULO.seconds[kind])+(kind==='crossfiteiro'?BURPEE_TICKS:0);
  return {kind,left:Math.max(0,Math.min(1,(until-tick)/total))};
}
