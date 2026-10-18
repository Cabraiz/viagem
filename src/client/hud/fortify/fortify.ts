/**
 * D-052 slice 3 (card NEW-20261016-ORQ-carro-e-fortificacao-livre, HUD): the car's rope and the free build.
 * - "Puxar" (.rh-fort-puxar): a right-thumb circle left of the skill button, only near the car (model pullState);
 *   "Soltar" while this player holds the rope. A tap sends {t:'puxar',on}; the room's refusal shows in the row slot.
 * - "Construir" (.rh-fort-construir): a circle above it with the wall counter ("12/40"). A tap opens the tray: the three
 *   pieces (Vigia, Muro, Barricada) with their price, Girar (the barricade and the 2×2 tower), the counter, Construir
 *   (touch: confirms the ghost) and Fechar.
 * - While the tray is open the map's presses aim the ghost instead of walking (capture on the canvas): the finger drags
 *   it, the mouse hovers it and a click builds (a held mouse lays walls cell by cell). The ghost itself is drawn by the
 *   scene (scene.setBuildGhost, render/fortify.ts).
 * Only tokens (ui/tokens.css) and the stickers (ui/icons.svg); fortify.css.
 */
import './fortify.css';
import {icon} from '../../ui/icon.ts';
import {PIECES,WALL_LIMIT,type FortPiece,type PullState} from './model.ts';
import {FORT_BUILD_BUTTON} from '../arrows.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export interface FortifyHudOptions {
  onPull:(on:boolean)=>void;
  onOpen:(open:boolean)=>void;
  onPick:(piece:FortPiece)=>void;
  onTurn:()=>void;
  /** The confirm button (touch) or a mouse click on the map. */
  onConfirm:()=>void;
  /** The pointer over the map at client point (x,y); `drag`: a held mouse (walls are laid cell by cell). */
  onAim:(x:number,y:number,drag:boolean)=>void;
  onAimEnd:()=>void;
  /** The game's canvas (the map's presses aim while the tray is open). */
  canvas:()=>HTMLCanvasElement|undefined;
}
export interface FortifyHudState {
  /** The car is in this run and this player may act (not watching, not paused). */
  available:boolean;
  pull:PullState;
  open:boolean;piece:FortPiece;rot:number;walls:number;
}

export class FortifyHud {
  readonly el:HTMLDivElement;
  private readonly pullBtn:HTMLButtonElement;
  private readonly buildBtn:HTMLButtonElement;
  private readonly buildCount:HTMLElement;
  private readonly tray:HTMLDivElement;
  private readonly count:HTMLElement;
  private readonly pieceBtns=new Map<FortPiece,HTMLButtonElement>();
  private readonly turnBtn:HTMLButtonElement;
  private key='';
  private state?:FortifyHudState;
  private aiming=false;private mouseHeld=false;
  private readonly offs:(()=>void)[]=[];
  constructor(parent:HTMLElement,private readonly options:FortifyHudOptions){
    this.el=el('div','rh-fort',parent);
    this.pullBtn=el('button','rh-fort-puxar',this.el);this.pullBtn.type='button';this.pullBtn.hidden=true;
    this.pullBtn.addEventListener('click',()=>{if(this.state)this.options.onPull(!this.state.pull.on);});
    this.buildBtn=el('button','rh-fort-construir',this.el);this.buildBtn.type='button';this.buildBtn.hidden=true;
    this.buildBtn.innerHTML=`${icon('torre',{size:32})}<span class="rh-fort-btn-text">Construir</span>`;
    this.buildCount=el('b','rh-fort-badge',this.buildBtn);
    this.buildBtn.addEventListener('click',()=>this.options.onOpen(true));
    this.tray=el('div','rh-fort-bandeja',this.el);this.tray.hidden=true;this.tray.setAttribute('role','dialog');this.tray.setAttribute('aria-label','Construir');
    const head=el('div','rh-fort-head',this.tray);
    el('h3','rh-fort-title',head).textContent='Construir';
    this.count=el('span','rh-fort-count',head);
    const close=el('button','rh-fort-close',head);close.type='button';close.setAttribute('aria-label','Fechar');close.innerHTML=icon('fechar',{size:32});
    close.addEventListener('click',()=>this.options.onOpen(false));
    const pieces=el('div','rh-fort-pecas',this.tray);
    for(const p of PIECES){
      const b=el('button','rh-fort-peca',pieces);b.type='button';b.dataset.piece=p.piece;
      b.innerHTML=`${icon(p.piece==='muro'?'muralha':p.piece==='barricada'?'material':'torre',{size:32})}<span>${p.name}</span><small>${p.price}</small>`;
      b.addEventListener('click',()=>this.options.onPick(p.piece));
      this.pieceBtns.set(p.piece,b);
    }
    const actions=el('div','rh-fort-acoes',this.tray);
    this.turnBtn=el('button','rh-fort-girar',actions);this.turnBtn.type='button';this.turnBtn.innerHTML=`${icon('girar',{size:24})}<span>Girar</span>`;
    this.turnBtn.addEventListener('click',()=>this.options.onTurn());
    const ok=el('button','rh-fort-ok',actions);ok.type='button';ok.innerHTML=`${icon('pronto',{size:24})}<span>Construir aqui</span>`;
    ok.addEventListener('click',()=>this.options.onConfirm());
    // The mouse aims and clicks (no confirm button: fortify.css); the finger drags the ghost, then Construir aqui.
    el('p','rh-fort-dica',this.tray).textContent=matchMedia('(hover:hover) and (pointer:fine)').matches?'Mire no mapa e clique pra construir.':'Arraste no mapa pra escolher o lugar.';
    this.el.addEventListener('keydown',e=>{if(e.key==='Escape')this.options.onOpen(false);});
    // Like the HUD panels: taps on the buttons and the tray never reach the game underneath.
    for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)this.el.addEventListener(type,event=>event.stopPropagation());
    this.listenMap();
  }
  /** The map's presses aim the ghost while the tray is open (capture: Phaser never sees them, the hero stays). */
  private listenMap(){
    const onMap=(e:Event)=>!!this.state?.open&&e.target instanceof HTMLCanvasElement&&e.target===this.options.canvas();
    const block=(e:Event)=>{if(onMap(e)){e.stopImmediatePropagation();e.preventDefault();}};
    const down=(e:PointerEvent)=>{
      if(!onMap(e))return;
      e.stopImmediatePropagation();e.preventDefault();
      this.aiming=true;this.mouseHeld=e.pointerType==='mouse';
      this.options.onAim(e.clientX,e.clientY,false);
      if(this.mouseHeld)this.options.onConfirm();
    };
    const move=(e:PointerEvent)=>{
      if(!this.state?.open)return;
      // The mouse hovers the ghost; a finger only while it is down on the map.
      if(e.pointerType==='mouse'?e.target===this.options.canvas()||this.mouseHeld:this.aiming){
        this.options.onAim(e.clientX,e.clientY,this.mouseHeld);
        if(this.aiming)e.stopImmediatePropagation();
      }
    };
    const up=(e:PointerEvent)=>{if(!this.aiming)return;this.aiming=false;this.mouseHeld=false;this.options.onAimEnd();e.stopImmediatePropagation();};
    const on=<K extends keyof WindowEventMap>(type:K,fn:(e:WindowEventMap[K])=>void)=>{
      window.addEventListener(type,fn as EventListener,{capture:true,passive:false});
      this.offs.push(()=>window.removeEventListener(type,fn as EventListener,{capture:true}));
    };
    on('pointerdown',down);on('pointermove',move);on('pointerup',up);on('pointercancel',up);
    on('mousedown',block);on('touchstart',block);
  }
  /** The state of this frame; the DOM changes only when what it shows changed. */
  update(state:FortifyHudState){
    this.state=state;
    const key=JSON.stringify(state);
    if(key===this.key)return;
    const wasOpen=!!this.key&&JSON.parse(this.key).open;
    this.key=key;
    const {available,pull,open,piece,rot,walls}=state;
    this.pullBtn.hidden=!available||!pull.show||open;
    this.pullBtn.classList.toggle('rh-fort-on',pull.on);
    this.pullBtn.setAttribute('aria-pressed',String(pull.on));
    this.pullBtn.innerHTML=`${icon('fita',{size:32})}<span class="rh-fort-btn-text">${pull.label}</span>`;
    // Off the HUD for now (arrows.ts FORT_BUILD_BUTTON, card setas-e-construir): no button, no counter, no tray.
    this.buildBtn.hidden=!FORT_BUILD_BUTTON||!available||open;
    this.buildCount.textContent=`${walls}/${WALL_LIMIT}`;
    this.tray.hidden=!available||!open;
    this.count.textContent=`Muros ${walls}/${WALL_LIMIT}`;
    for(const [p,b] of this.pieceBtns){b.setAttribute('aria-pressed',String(p===piece));b.classList.toggle('rh-fort-escolhida',p===piece);}
    this.turnBtn.disabled=piece==='muro';
    this.turnBtn.classList.toggle('rh-fort-girado',rot===1);
    this.el.classList.toggle('rh-fort-aberto',open&&available);
    if(open&&!wasOpen)this.pieceBtns.get(piece)?.focus({preventScroll:true});
  }
  destroy(){for(const off of this.offs)off();this.el.remove();}
}
