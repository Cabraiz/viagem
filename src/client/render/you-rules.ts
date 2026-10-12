/**
 * "You in the world" rules (UX-voce-e-dano): when the local hero's marker, health bar and "Você" arrow show,
 * and when a tree canopy hides a hero. Pure module (no Phaser) so node tests pin the rules down.
 */

/** The "Você" arrow shows this long at the start of each round and when the hero gets back up. */
export const ARROW_MS=2000;
/** The mini health bar stays this long after the hero is back to full. */
export const HP_LINGER_MS=2000;
/** Below this fraction of max hp the hero is "low" (bar turns Laranja Cone, the screen keeps a static edge). */
export const LOW_HP=.3;
/** Smallest on-screen size of the mini health bar, in CSS px (card: ≥ 28×4). */
export const HP_BAR_CSS={width:36,height:6} as const;
/**
 * Smallest on-screen ground ring, in CSS px; it grows with the sprite when the camera zooms in (D-019).
 * Three hard layers (design onda 3 §0): Breu 2 inside, Lilás Janela ("você") 4, Papel 2 outside, plus an 8 px beak
 * toward where the hero faces, so it never reads as the thin plain rings of the allies.
 */
export const RING_CSS={width:52,height:26,breu:2,voce:4,papel:2,beak:8} as const;
/** Sticker contour on the hero's sprite (§2.4): Papel 2 px, then Breu 1 px outside, hard (no blur). */
export const STICKER_CSS={papel:2,breu:3} as const;
/** 8 directions for the sticker contour copies (unit offsets). */
export const OUTLINE_DIRS:readonly {x:number;y:number}[]=Array.from({length:8},(_,i)=>({x:Math.round(Math.cos(i*Math.PI/4)*1e6)/1e6,y:Math.round(Math.sin(i*Math.PI/4)*1e6)/1e6}));

/** Ring strokes, outer to inner: [width, radius offset from the ellipse] in CSS px, so each layer is a hard band. */
export function ringBands(){
  const {breu,voce,papel}=RING_CSS,total=breu+voce+papel;
  return {papel:{width:total,offset:0},voce:{width:voce,offset:(total-voce)/2-papel},breu:{width:breu,offset:-(total-breu)/2}};
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
