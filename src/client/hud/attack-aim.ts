/**
 * D-051 manual combat, step 2 (NEW-20261014-E4-ataque-manual-passo2): the attack button's aim on the client, pure (no
 * Phaser, no DOM). The server decides every shot (src/sim/weapons/system.ts); this is only the reticle's best guess,
 * and it orders the candidates with the very same function as the server (rules/attack-target.ts attackTargets).
 *
 * - autoAim: the server's auto pick, from the enemies the client knows within AIM_RANGE: the chosen one, whoever hit
 *   me in the last 2 s (LastHit, from the `damage` events with target = me), then the nearest with the boss 30 % closer
 *   and the hysteresis (`current`).
 * - dragAim: dragging the button from its centre aims a ray from the hero in screen space (the way the thumb moved).
 *   The pick is the enemy within AIM_RANGE whose screen bearing is within ±CONE_HALF of the ray, angle first and
 *   distance second; a drag inside DEAD_ZONE_PX is the auto aim. With an empty cone the reticle sits at the ray's end
 *   and a release chooses nothing (the auto aim goes on; nothing fires "no ar").
 * - AttackPress: the button's press (tap, hold, drag), latched so a tap shorter than one 50 ms input step still goes
 *   out as one attack (the room's input track keeps the press, segment bit 1).
 * Prototype: vgm/ataque-manual 0a72bd2 (attack/targeting.ts, attack/proto.ts).
 */
import type {Point} from '../../contract/index.ts';
import {AGGRO_TICKS,attackTargets} from '../../rules/index.ts';

/**
 * How far the reticle looks (u). The client has no weapon catalog (that lives in the sim), so this is the usual reach
 * of the starting weapons (6–9 u); an enemy past the real reach is shown but the server just does not fire at it.
 */
export const AIM_RANGE=7;
/** A drag shorter than this (CSS px from the button's centre) is a tap or a hold: the auto aim. */
export const DEAD_ZONE_PX=22;
/** The drag knob never leaves this ring around the button's centre (CSS px). */
export const KNOB_MAX_PX=70;
/** Drag cone half-angle around the thumb's direction (±20°). */
export const CONE_HALF=20*Math.PI/180;
/** Drag score: angle / CONE_HALF + DRAG_DISTANCE_WEIGHT × distance / range (lower wins). */
export const DRAG_DISTANCE_WEIGHT=.35;
/** While dragging, the current pick stays unless another scores this much lower (no flicker on the cone's edge). */
export const DRAG_KEEP_MARGIN=.12;

/** What the aim needs of an enemy (EnemyView fits). */
export interface AimEnemy extends Point {id:string;hp:number;boss?:boolean}
/** World ground point (u) to screen (CSS px), the same px as the button. Linear around the hero is enough (iso is affine). */
export type ToScreen=(p:Point)=>Point;

/** "Who hit me": the newest `damage` event on the local player from an enemy (the server's SimPlayer.lastHitBy). */
export class LastHit {
  private seen=-1;
  last?:{id:string;tick:number};
  /** New events only (eventId above the last read); `isEnemy` drops players, `env:` hazards and gone critters. */
  note(events:readonly {type:string;eventId:number;target?:string;source?:string}[],localId:string,tick:number,isEnemy:(id:string)=>boolean){
    for(const e of events){
      if(e.eventId<=this.seen)continue;
      this.seen=e.eventId;
      if(e.type==='damage'&&e.target===localId&&e.source&&isEnemy(e.source))this.last={id:e.source,tick};
    }
  }
  /** The memory, while it still counts (AGGRO_TICKS). */
  at(tick:number){return this.last&&tick-this.last.tick<=AGGRO_TICKS?this.last:undefined;}
  /** New run: forget the attacker; event ids go on growing (D-011). */
  reset(){this.last=undefined;}
}

export interface AimContext {
  tick:number;
  /** The target the player chose (PlayerInput.target). */
  chosen?:string;
  /** LastHit.at(tick). */
  lastHit?:{id:string;tick:number};
  /** The previous auto pick (the hysteresis' memory, like SimPlayer.autoTarget). */
  current?:string;
  range?:number;
}
const alive=(e:AimEnemy)=>e.hp>0;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

/** The enemy the server would shoot now (the chosen one first), or undefined when none is in range; `auto` is the next `current`. */
export function autoAim<T extends AimEnemy>(hero:Point,enemies:Iterable<T>,ctx:AimContext):{pick?:T;auto?:string}{
  const range=ctx.range??AIM_RANGE,inRange:T[]=[];
  for(const e of enemies)if(alive(e)&&dist(hero,e)<=range)inRange.push(e);
  const {order,auto}=attackTargets(hero,inRange,{tick:ctx.tick,...(ctx.chosen!==undefined?{chosen:ctx.chosen}:{}),...(ctx.lastHit?{lastHit:ctx.lastHit}:{}),...(ctx.current!==undefined?{current:ctx.current}:{})});
  return {...(order[0]?{pick:order[0]}:{}),...(auto!==undefined?{auto}:{})};
}

export interface DragAim<T> {
  /** 'arrasto' past the dead zone, 'auto' inside it. */
  mode:'arrasto'|'auto';
  /** The drag's pick (mode 'arrasto'); undefined with an empty cone. */
  pick?:T;
  /** The reticle (screen px): on the pick, else at the ray's end at the range. Undefined in 'auto' (the auto reticle shows). */
  reticle?:Point;
  /** Where the knob draws (screen px): the button's centre plus the drag, clamped to KNOB_MAX_PX. */
  knob:Point;
}
/**
 * The drag's pick (see the header). `drag` = pointer − button centre (CSS px, y down); `held`: the previous frame's
 * pick, kept unless another scores DRAG_KEEP_MARGIN better.
 */
export function dragAim<T extends AimEnemy>(centre:Point,drag:Point,hero:Point,enemies:Iterable<T>,toScreen:ToScreen,held?:string,range=AIM_RANGE):DragAim<T>{
  const len=Math.hypot(drag.x,drag.y),k=len>KNOB_MAX_PX?KNOB_MAX_PX/len:1;
  const knob={x:centre.x+drag.x*k,y:centre.y+drag.y*k};
  if(len<DEAD_ZONE_PX)return {mode:'auto',knob};
  const dir={x:drag.x/len,y:drag.y/len},h=toScreen(hero);
  const scoreOf=(e:T)=>{
    if(!alive(e))return Infinity;
    const d=dist(hero,e);if(d>range)return Infinity;
    const s=toScreen(e),sx=s.x-h.x,sy=s.y-h.y,sl=Math.hypot(sx,sy);
    // Standing on the hero: any direction reaches it.
    const angle=sl<1e-6?0:Math.acos(Math.max(-1,Math.min(1,(sx*dir.x+sy*dir.y)/sl)));
    return angle>CONE_HALF?Infinity:angle/CONE_HALF+DRAG_DISTANCE_WEIGHT*d/range;
  };
  let best:T|undefined,bestScore=Infinity,kept:T|undefined;
  for(const e of enemies){
    if(e.id===held)kept=e;
    const s=scoreOf(e);
    if(s<bestScore||(s===bestScore&&s<Infinity&&best&&e.id<best.id)){best=e;bestScore=s;}
  }
  if(kept&&best&&kept!==best){const ks=scoreOf(kept);if(ks<Infinity&&ks<=bestScore+DRAG_KEEP_MARGIN)best=kept;}
  if(best)return {mode:'arrasto',knob,pick:best,reticle:toScreen(best)};
  return {mode:'arrasto',knob,reticle:rayEnd(hero,dir,range,toScreen)};
}

/**
 * The screen point of the ground spot `range` away from the hero along the screen bearing `dir`: the projection is
 * affine around the hero (a, b = screen of one unit along world x, y), so world = M⁻¹ · (t · dir).
 */
export function rayEnd(hero:Point,dir:Point,range:number,toScreen:ToScreen):Point{
  const h=toScreen(hero),ax=toScreen({x:hero.x+1,y:hero.y}),by=toScreen({x:hero.x,y:hero.y+1});
  const a={x:ax.x-h.x,y:ax.y-h.y},b={x:by.x-h.x,y:by.y-h.y},det=a.x*b.y-a.y*b.x;
  if(Math.abs(det)<1e-9)return h;
  const wx=(b.y*dir.x-b.x*dir.y)/det,wy=(a.x*dir.y-a.y*dir.x)/det,t=range/(Math.hypot(wx,wy)||1);
  return {x:h.x+dir.x*t,y:h.y+dir.y*t};
}

/**
 * World direction (unit) of a screen direction from the hero (BUG-20261023-ORQ-tiro-na-direcao-mobile: the aim stick),
 * the inverse of the projection around the hero like rayEnd; undefined for a degenerate projection or a zero direction.
 */
export function worldDirection(hero:Point,dir:Point,toScreen:ToScreen):Point|undefined{
  const h=toScreen(hero),ax=toScreen({x:hero.x+1,y:hero.y}),by=toScreen({x:hero.x,y:hero.y+1});
  const a={x:ax.x-h.x,y:ax.y-h.y},b={x:by.x-h.x,y:by.y-h.y},det=a.x*b.y-a.y*b.x;
  if(Math.abs(det)<1e-9)return undefined;
  const wx=(b.y*dir.x-b.x*dir.y)/det,wy=(a.x*dir.y-a.y*dir.x)/det,len=Math.hypot(wx,wy);
  return len>1e-9?{x:wx/len,y:wy/len}:undefined;
}

/**
 * The attack button's press: down → held (every input step attacks while it stays down); a press and release between
 * two steps still attacks on the next one (`take` latches it), so a quick tap is one attack, never lost.
 */
export class AttackPress {
  private down=false;private latched=false;
  /** Keys holding it on the desktop (Space, the right mouse button): it lets go when the last one does. */
  private readonly keys=new Set<string>();
  /** Whether the last press() started a press (it was not held): the scene predicts that one (tiro-delay-1s-predicao). */
  fresh=false;
  press(){this.fresh=!this.down;this.down=true;this.latched=true;}
  release(){this.down=false;}
  /**
   * A desktop key (`source`) held down or let go (cone-por-cima-e-clique-em-loop): held while any key holds it; a key let
   * go that never pressed releases nothing, and repeated presses never pile up (one latch, one step).
   */
  key(source:string,down:boolean){
    if(down){this.keys.add(source);this.press();}
    else if(this.keys.delete(source)&&!this.keys.size)this.release();
  }
  get held(){return this.down;}
  /** One input step: whether it attacks (held now, or pressed since the last step). */
  take(){const on=this.down||this.latched;this.latched=false;return on;}
  /** Pause, focus lost, run reset: nothing stays pressed. */
  clear(){this.down=false;this.latched=false;this.keys.clear();}
}
