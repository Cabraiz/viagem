/**
 * Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa): the bar of the "pôr torre" mode (model.ts has the rules).
 * - .rh-kit: a small system window low on the right, over the inventory: the kit's sticker and name, Girar (the
 *   barricade only), ✓ "Pôr aqui" (touch) and ✕ Cancelar, plus a one-line hint.
 * - While it is open the map's presses aim the ghost instead of walking (capture on the canvas): a finger moves it, the
 *   mouse hovers it and a click puts it there; the right button or Esc cancels. The ghost itself is the scene's
 *   (scene.setBuildGhost, render/fortify.ts).
 * Only tokens (ui/tokens.css) and the stickers; kit-place.css.
 */
import './kit-place.css';
import {icon} from '../../ui/icon.ts';
import {sticker} from '../../ui/sticker.ts';
import {itemDisplay} from '../items.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};
/** A fine pointer (a mouse): the click on the map confirms, so there is no ✓ button. */
const mouseFirst=()=>typeof matchMedia==='function'&&matchMedia('(hover:hover) and (pointer:fine)').matches;

export interface KitPlaceHudOptions {
  onConfirm:()=>void;
  onCancel:()=>void;
  onTurn:()=>void;
  /** The pointer over the map at client point (x,y). */
  onAim:(x:number,y:number)=>void;
  canvas:()=>HTMLCanvasElement|undefined;
}
export interface KitPlaceHudState {open:boolean;id?:string;canTurn:boolean;rot:number;charges?:number}

export class KitPlaceHud {
  readonly el:HTMLDivElement;
  private readonly face:HTMLElement;
  private readonly name:HTMLElement;
  private readonly turnBtn:HTMLButtonElement;
  private readonly okBtn:HTMLButtonElement;
  private key='';
  private open=false;
  private aiming=false;
  private readonly offs:(()=>void)[]=[];
  constructor(parent:HTMLElement,private readonly options:KitPlaceHudOptions){
    this.el=el('div','rh-kit',parent);this.el.hidden=true;this.el.setAttribute('role','dialog');this.el.setAttribute('aria-label','Pôr torre');
    const head=el('div','rh-kit-head',this.el);
    this.face=el('span','rh-kit-face',head);
    this.name=el('b','rh-kit-name',head);
    const close=el('button','rh-kit-cancel',head);close.type='button';close.setAttribute('aria-label','Cancelar');close.innerHTML=icon('fechar',{size:24});
    close.addEventListener('click',()=>this.options.onCancel());
    const actions=el('div','rh-kit-acoes',this.el);
    this.turnBtn=el('button','rh-kit-girar',actions);this.turnBtn.type='button';this.turnBtn.innerHTML=`${icon('girar',{size:24})}<span>Girar</span>`;
    this.turnBtn.addEventListener('click',()=>this.options.onTurn());
    this.okBtn=el('button','rh-kit-ok',actions);this.okBtn.type='button';this.okBtn.innerHTML=`${icon('pronto',{size:24})}<span>Pôr aqui</span>`;
    this.okBtn.addEventListener('click',()=>this.options.onConfirm());
    el('p','rh-kit-dica',this.el).textContent=mouseFirst()?'Clique no chão pra pôr. Esc cancela.':'Toque no chão pra escolher o lugar.';
    // Like the HUD panels: taps on the bar never reach the game underneath.
    for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)this.el.addEventListener(type,event=>event.stopPropagation());
    this.listenMap();
  }
  private listenMap(){
    const onMap=(e:Event)=>this.open&&e.target instanceof HTMLCanvasElement&&e.target===this.options.canvas();
    const block=(e:Event)=>{if(onMap(e)){e.stopImmediatePropagation();e.preventDefault();}};
    const down=(e:PointerEvent)=>{
      if(!onMap(e))return;
      e.stopImmediatePropagation();e.preventDefault();
      if(e.button===2){this.options.onCancel();return;}
      this.options.onAim(e.clientX,e.clientY);
      if(e.pointerType==='mouse')this.options.onConfirm();
      else this.aiming=true;
    };
    const move=(e:PointerEvent)=>{
      if(!this.open)return;
      if(e.pointerType==='mouse'?e.target===this.options.canvas():this.aiming){
        this.options.onAim(e.clientX,e.clientY);
        if(this.aiming)e.stopImmediatePropagation();
      }
    };
    const up=(e:PointerEvent)=>{if(!this.aiming)return;this.aiming=false;e.stopImmediatePropagation();};
    const key=(e:KeyboardEvent)=>{if(this.open&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.options.onCancel();}};
    const menu=(e:Event)=>{if(onMap(e))e.preventDefault();};
    const on=<K extends keyof WindowEventMap>(type:K,fn:(e:WindowEventMap[K])=>void)=>{
      window.addEventListener(type,fn as EventListener,{capture:true,passive:false});
      this.offs.push(()=>window.removeEventListener(type,fn as EventListener,{capture:true}));
    };
    on('pointerdown',down);on('pointermove',move);on('pointerup',up);on('pointercancel',up);
    on('mousedown',block);on('touchstart',block);on('keydown',key);on('contextmenu',menu);
  }
  /** The state of this frame; the DOM changes only when what it shows changed. */
  update(state:KitPlaceHudState){
    this.open=state.open;
    if(!state.open)this.aiming=false;
    const key=JSON.stringify(state);
    if(key===this.key)return;
    this.key=key;
    this.el.hidden=!state.open;
    if(!state.open||!state.id)return;
    const d=itemDisplay(state.id);
    this.face.innerHTML=sticker(d.icon,{size:32});
    this.name.textContent=state.charges&&state.charges>1?`${d.name} ×${state.charges}`:d.name;
    this.turnBtn.hidden=!state.canTurn;
    this.turnBtn.classList.toggle('rh-kit-girado',state.rot===1);
  }
  destroy(){for(const off of this.offs)off();this.el.remove();}
}
