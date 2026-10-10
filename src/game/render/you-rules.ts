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
/** Smallest on-screen ground ring, in CSS px; it grows with the sprite when the camera zooms in (D-019). */
export const RING_CSS={width:40,height:18,stroke:3,edge:1.5} as const;

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

/** Arrow state `age` ms after it was triggered: a slow bob (3 beats in 2 s) unless motion is reduced. */
export function arrowFrame(age:number,reduced:boolean){
  if(!(age>=0)||age>=ARROW_MS)return {visible:false,bob:0};
  return {visible:true,bob:reduced?0:Math.abs(Math.sin(age/ARROW_MS*Math.PI*3))};
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
