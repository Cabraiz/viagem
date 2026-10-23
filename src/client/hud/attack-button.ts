/**
 * D-051 manual combat, step 2: the attack button's press, hold and drag on #coop-attack.
 * - pointerdown on the button: attacks (AttackPress: a tap is one attack, holding attacks on every input step); the
 *   server fires where the hero looks, with a light aim assist (BUG-20261023-ORQ-tiro-na-direcao-mobile);
 * - the aim stick (same card, the user: "joystick de mira que fica por cima do atirar"): a finger on the button shows a
 *   ring the size of the left stick around it and a knob under the finger. Dragging past AIM_DEAD_ZONE_PX aims: every
 *   input step sends that direction (aim(), PlayerInput.aim) with the attack held, so the hero fires in sequence that
 *   way at the weapon's cadence and turns to it, and an arrow on the ground runs from the hero that way, as far as the
 *   weapon reaches. Letting go hides the ring and stops.
 * A DOM <svg> over the layout. Only in the manual combat; the button stays the class skill otherwise (explore.ts wires
 * one or the other).
 */
import type {EnemyView,Point} from '../../contract/index.ts';
import {AttackPress,LastHit,autoAim,rayEnd,worldDirection,type AimEnemy} from './attack-aim.ts';

/** A drag shorter than this (CSS px from the button's centre) is a tap or a hold along the facing. */
export const AIM_DEAD_ZONE_PX=12;
/** The ring's radius without a left stick to copy (CSS px). */
export const RING_PX=64;

/** What the button needs of the scene and the room (explore.ts). */
export interface AttackDeps {
  /** The hero (world u), undefined before the scene is up. */
  hero():Point|undefined;
  /** Viewport CSS px of a world point (scene.locate). */
  toScreen(p:Point):Point;
  enemies():Iterable<EnemyView>;
  tick():number;
  /** The target the player chose (scene's attackTarget), and setting it (undefined: back to the auto aim). */
  chosen():string|undefined;
  choose(id:string|undefined):void;
  /** Leaves a "Controles pausados" pause (a press is input, like the skill's tap). */
  wake():void;
  setHeld(held:boolean):void;
  /** The equipped weapon's reach (u), the arrow's length; undefined: no arrow. */
  reach?():number|undefined;
  /** The ring's radius (CSS px): the left stick's. */
  ringRadius?():number;
}

const SVG='http://www.w3.org/2000/svg';
const node=<K extends keyof SVGElementTagNameMap>(tag:K,cls:string)=>{const e=document.createElementNS(SVG,tag);e.setAttribute('class',cls);return e;};
const f1=(n:number)=>n.toFixed(1);

export class AttackButton {
  readonly press=new AttackPress();
  readonly lastHit=new LastHit();
  private readonly svg:SVGSVGElement;
  private readonly knob:SVGCircleElement;
  private readonly ring:SVGCircleElement;
  private readonly arrow:SVGPathElement;
  private pointer?:number;private centre?:Point;private drag:Point={x:0,y:0};private radius=RING_PX;
  private current?:string;
  private on=false;
  constructor(private readonly button:HTMLButtonElement,host:HTMLElement,private readonly deps:AttackDeps,signal?:AbortSignal){
    this.svg=node('svg','atk-aim');this.svg.setAttribute('aria-hidden','true');this.hide(true);
    this.ring=node('circle','atk-aim-ring');this.arrow=node('path','atk-aim-arrow');
    this.knob=node('circle','atk-aim-knob');this.knob.setAttribute('r','23');
    this.svg.append(this.arrow,this.ring,this.knob);host.append(this.svg);
    const opts=signal?{signal}:{};
    button.addEventListener('pointerdown',e=>{
      if(!this.on||e.button!==0||button.disabled||this.pointer!==undefined)return;
      e.preventDefault();deps.wake();
      this.pointer=e.pointerId;try{button.setPointerCapture?.(e.pointerId);}catch{/* a synthetic pointer (prints) */}
      const r=button.getBoundingClientRect();this.centre={x:r.left+r.width/2,y:r.top+r.height/2};this.drag={x:0,y:0};
      this.radius=deps.ringRadius?.()||RING_PX;
      this.ring.setAttribute('cx',f1(this.centre.x));this.ring.setAttribute('cy',f1(this.centre.y));this.ring.setAttribute('r',f1(this.radius));
      this.press.press();deps.setHeld(true);this.frame();
    },opts);
    button.addEventListener('pointermove',e=>{
      if(e.pointerId!==this.pointer||!this.centre)return;
      this.drag={x:e.clientX-this.centre.x,y:e.clientY-this.centre.y};
    },opts);
    const up=(e:PointerEvent)=>{if(e.pointerId===this.pointer)this.end();};
    button.addEventListener('pointerup',up,opts);
    button.addEventListener('pointercancel',up,opts);
    // A keyboard click (detail 0) is one attack, the debug fallback like the skill's (D-009).
    button.addEventListener('click',e=>{if(this.on&&e.detail===0&&!button.disabled){deps.wake();this.press.press();this.press.release();}},opts);
  }
  private hide(hidden:boolean){this.svg.style.display=hidden?'none':'';}
  /** The room's CombatMode turned manual (or back): off lets go of everything and hides the ring. */
  setOn(on:boolean){if(on===this.on)return;this.on=on;if(!on)this.clear();}
  get active(){return this.on;}
  /**
   * Space or the right mouse button on the desktop (`source`): held down / let go. The press is the button's, held while
   * any key holds it; letting go of one key never leaves it held by nobody, and repeated presses never pile up.
   */
  key(down:boolean,source='espaco'){
    if(!this.on)return;
    if(down)this.deps.wake();
    this.press.key(source,down);
    this.deps.setHeld(this.press.held);
  }
  /** One quick attack (a click on an enemy on the desktop). */
  once(){if(!this.on)return;this.press.press();this.press.release();}
  /** One input step (scene, every 50 ms): whether it attacks. */
  take(){return this.on&&this.press.take();}
  /** Pause, focus lost, button greyed, run reset: nothing stays pressed, no ring. */
  clear(){
    if(this.pointer!==undefined)try{this.button.releasePointerCapture?.(this.pointer);}catch{/* never captured */}
    this.press.clear();this.pointer=undefined;this.centre=undefined;this.deps.setHeld(false);this.hide(true);
  }
  private end(){this.pointer=undefined;this.centre=undefined;this.press.release();this.deps.setHeld(false);this.hide(true);}
  /** The aim stick's screen direction (unit, CSS px axes) while a finger drags it past the dead zone, else undefined. */
  aimScreen():Point|undefined{
    if(!this.on||this.pointer===undefined||!this.press.held)return undefined;
    const len=Math.hypot(this.drag.x,this.drag.y);
    return len>=AIM_DEAD_ZONE_PX?{x:this.drag.x/len,y:this.drag.y/len}:undefined;
  }
  /** The aim stick's world direction (unit, PlayerInput.aim) while it aims, else undefined (the server uses the facing). */
  aim():Point|undefined{
    const dir=this.aimScreen(),hero=dir&&this.deps.hero();
    return dir&&hero?worldDirection(hero,dir,p=>this.deps.toScreen(p)):undefined;
  }
  /** Every frame: the ring, the knob and the arrow while a finger holds the button; the auto aim's memory always. */
  frame(){
    const hero=this.deps.hero();
    if(hero)this.track(hero);
    if(!this.on||!hero||!this.press.held||!this.centre||this.pointer===undefined){this.hide(true);return;}
    const dir=this.aimScreen(),len=Math.hypot(this.drag.x,this.drag.y),k=len>this.radius?this.radius/len:1;
    this.knob.setAttribute('cx',f1(this.centre.x+this.drag.x*k));this.knob.setAttribute('cy',f1(this.centre.y+this.drag.y*k));
    const reach=dir?this.deps.reach?.():undefined;
    if(dir&&reach){
      const from=this.deps.toScreen(hero),to=rayEnd(hero,dir,reach,p=>this.deps.toScreen(p));
      // A shaft from the hero and a head at the reach's end, pointing the way it shoots.
      const head=Math.min(18,Math.hypot(to.x-from.x,to.y-from.y)/3),bx=to.x-dir.x*head,by=to.y-dir.y*head,nx=-dir.y*head*.6,ny=dir.x*head*.6;
      this.arrow.setAttribute('d',`M${f1(from.x)} ${f1(from.y)}L${f1(bx)} ${f1(by)}M${f1(bx+nx)} ${f1(by+ny)}L${f1(to.x)} ${f1(to.y)}L${f1(bx-nx)} ${f1(by-ny)}Z`);
      this.arrow.style.display='';
    }else this.arrow.style.display='none';
    this.hide(false);
  }
  /** The auto aim, keeping its hysteresis memory every frame like the server's SimPlayer.autoTarget. */
  private track(hero:Point,enemies:AimEnemy[]=[...this.deps.enemies()]){
    const tick=this.deps.tick(),chosen=this.deps.chosen(),lastHit=this.lastHit.at(tick);
    const {pick,auto}=autoAim(hero,enemies,{tick,...(chosen!==undefined?{chosen}:{}),...(lastHit?{lastHit}:{}),...(this.current!==undefined?{current:this.current}:{})});
    this.current=auto;
    return pick;
  }
  destroy(){this.clear();this.svg.remove();}
}
