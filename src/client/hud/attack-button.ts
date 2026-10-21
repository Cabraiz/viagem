/**
 * D-051 manual combat, step 2: the attack button's press, hold and drag on #coop-attack, and the reticle over the map.
 * - pointerdown on the button: attacks (AttackPress: a tap is one attack, holding attacks on every input step);
 * - dragging past DEAD_ZONE_PX: a yellow line from the hero and a reticle on the enemy in the thumb's cone
 *   (hud/attack-aim.ts dragAim); letting go there chooses it (PlayerInput.target), with an empty cone it chooses nothing;
 * - inside the dead zone the reticle follows the auto aim (the server's order, attackTargets), so a tap shows what it hit.
 * The reticle is a DOM <svg> over the layout, above the canvas and under the HUD; it is only a guess, the server decides.
 * Only in the manual combat; the button stays the class skill otherwise (explore.ts wires one or the other).
 */
import type {EnemyView,Point} from '../../contract/index.ts';
import {AttackPress,LastHit,autoAim,dragAim,type AimEnemy} from './attack-aim.ts';

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
}

const SVG='http://www.w3.org/2000/svg';
const node=<K extends keyof SVGElementTagNameMap>(tag:K,cls:string)=>{const e=document.createElementNS(SVG,tag);e.setAttribute('class',cls);return e;};

export class AttackButton {
  readonly press=new AttackPress();
  readonly lastHit=new LastHit();
  private readonly svg:SVGSVGElement;
  private readonly line:SVGLineElement;private readonly ring:SVGCircleElement;private readonly knob:SVGCircleElement;
  private pointer?:number;private centre?:Point;private drag:Point={x:0,y:0};
  private dragPick?:string;private dragging=false;
  private current?:string;
  private on=false;
  /** The button's own press is a finger's (or pen's): only then the yellow reticle and its line show (desktop: the cone). */
  private touchAim=false;
  constructor(private readonly button:HTMLButtonElement,host:HTMLElement,private readonly deps:AttackDeps,signal?:AbortSignal){
    this.svg=node('svg','atk-aim');this.svg.setAttribute('aria-hidden','true');this.hide(true);
    this.line=node('line','atk-aim-line');this.ring=node('circle','atk-aim-ring');this.knob=node('circle','atk-aim-knob');
    this.ring.setAttribute('r','22');this.knob.setAttribute('r','14');
    this.svg.append(this.line,this.ring,this.knob);host.append(this.svg);
    const opts=signal?{signal}:{};
    button.addEventListener('pointerdown',e=>{
      if(!this.on||e.button!==0||button.disabled||this.pointer!==undefined)return;
      e.preventDefault();deps.wake();
      this.pointer=e.pointerId;this.touchAim=e.pointerType!=='mouse';try{button.setPointerCapture?.(e.pointerId);}catch{/* a synthetic pointer (prints) */}
      const r=button.getBoundingClientRect();this.centre={x:r.left+r.width/2,y:r.top+r.height/2};this.drag={x:0,y:0};this.dragPick=undefined;this.dragging=false;
      this.press.press();deps.setHeld(true);
    },opts);
    button.addEventListener('pointermove',e=>{
      if(e.pointerId!==this.pointer||!this.centre)return;
      this.drag={x:e.clientX-this.centre.x,y:e.clientY-this.centre.y};
    },opts);
    const up=(e:PointerEvent,cancel:boolean)=>{
      if(e.pointerId!==this.pointer)return;
      // A release out of the dead zone confirms the drag's pick; an empty cone confirms nothing (the auto aim stays).
      if(!cancel&&this.dragging&&this.dragPick)deps.choose(this.dragPick);
      this.end();
    };
    button.addEventListener('pointerup',e=>up(e,false),opts);
    button.addEventListener('pointercancel',e=>up(e,true),opts);
    // A keyboard click (detail 0) is one attack, the debug fallback like the skill's (D-009).
    button.addEventListener('click',e=>{if(this.on&&e.detail===0&&!button.disabled){deps.wake();this.press.press();this.press.release();}},opts);
  }
  private hide(hidden:boolean){this.svg.style.display=hidden?'none':'';}
  /** The room's CombatMode turned manual (or back): off lets go of everything and hides the reticle. */
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
  /** Pause, focus lost, button greyed, run reset: nothing stays pressed, no reticle. */
  clear(){
    if(this.pointer!==undefined)try{this.button.releasePointerCapture?.(this.pointer);}catch{/* never captured */}
    this.press.clear();this.touchAim=false;this.pointer=undefined;this.centre=undefined;this.dragging=false;this.dragPick=undefined;this.deps.setHeld(false);this.hide(true);
  }
  private end(){this.touchAim=false;this.pointer=undefined;this.centre=undefined;this.dragging=false;this.dragPick=undefined;this.press.release();this.deps.setHeld(false);this.hide(true);}
  /** Every frame: the reticle while the button is held (the auto aim's pick, or the drag's). */
  frame(){
    const hero=this.deps.hero();
    // Desktop (Space, the right button, the mouse on the button): no yellow reticle nor line, the melee cone shows the aim.
    if(!this.on||!hero||!this.press.held||!this.touchAim){this.hide(true);if(hero)this.track(hero);return;}
    const enemies=[...this.deps.enemies()] as (EnemyView&AimEnemy)[],toScreen=(p:Point)=>this.deps.toScreen(p);
    let reticle:Point|undefined,knob:Point|undefined,locked=false;
    if(this.centre){
      const d=dragAim(this.centre,this.drag,hero,enemies,toScreen,this.dragPick);
      knob=d.knob;
      if(d.mode==='arrasto'){this.dragging=true;this.dragPick=d.pick?.id;reticle=d.reticle;locked=!!d.pick;}
      else this.dragging=false;
    }
    if(!this.dragging){const pick=this.track(hero,enemies);if(pick){reticle=toScreen(pick);locked=true;}}
    this.hide(!reticle);
    if(!reticle)return;
    const h=toScreen(hero);
    this.line.setAttribute('x1',String(h.x));this.line.setAttribute('y1',String(h.y));this.line.setAttribute('x2',String(reticle.x));this.line.setAttribute('y2',String(reticle.y));
    this.ring.setAttribute('cx',String(reticle.x));this.ring.setAttribute('cy',String(reticle.y));
    this.svg.dataset.lock=locked?'alvo':'vazio';this.svg.dataset.mode=this.dragging?'arrasto':'auto';
    this.knob.style.display=knob&&this.dragging?'':'none';
    if(knob){this.knob.setAttribute('cx',String(knob.x));this.knob.setAttribute('cy',String(knob.y));}
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
