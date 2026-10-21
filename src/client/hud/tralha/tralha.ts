/**
 * NEW-20261021-ORQ-barricada-construir part 2: the barricadas de tralha on the map (model.ts has the rules).
 * - A tap (a click) on a barricada square on the map selects it: two circles over it, COLETAR and DESTRUIR, and the
 *   square wears the gold outline (the scene draws it). The tap is ours (the hero does not walk there); a tap elsewhere
 *   clears it and goes on as usual. The mouse over a square: the outline and a hand cursor.
 * - While a coleta runs, its bar sits over the hero.
 * Only tokens (ui/tokens.css); tralha.css.
 */
import './tralha.css';
import {icon} from '../../ui/icon.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export interface TralhaHudOptions {
  /** A press on the map at client (x,y): true when it hit a square (the HUD keeps it from the game). */
  onTap:(x:number,y:number)=>boolean;
  /** The mouse over the map (undefined: it left): true over a square (the hand cursor). */
  onHover:(x:number|undefined,y:number|undefined)=>boolean;
  onAct:(kind:'coletar'|'destruir')=>void;
  canvas:()=>HTMLCanvasElement|undefined;
  /** Other map modes (the build tray, a kit being placed) own the presses. */
  busy:()=>boolean;
}
/** Screen points (viewport px) of the selected square and of the hero; the bar's 0..1. */
export interface TralhaHudState {available:boolean;at?:{x:number;y:number};hero?:{x:number;y:number};progress?:number}

export class TralhaHud {
  readonly el:HTMLDivElement;
  private readonly coletar:HTMLButtonElement;
  private readonly destruir:HTMLButtonElement;
  private readonly barra:HTMLDivElement;
  private readonly fill:HTMLElement;
  private available=false;
  private readonly offs:(()=>void)[]=[];
  constructor(host:HTMLElement,private readonly options:TralhaHudOptions){
    this.el=el('div','rh-tralha',host);this.el.hidden=true;
    this.coletar=el('button','rh-tralha-bola rh-tralha-coletar',this.el);this.coletar.type='button';
    this.coletar.innerHTML=`${icon('material',{size:24})}<span>Coletar</span>`;this.coletar.setAttribute('aria-label','Coletar a tralha');
    this.destruir=el('button','rh-tralha-bola rh-tralha-destruir',this.el);this.destruir.type='button';
    this.destruir.innerHTML='<span>Destruir</span>';this.destruir.setAttribute('aria-label','Destruir a tralha');
    this.barra=el('div','rh-tralha-barra',this.el);this.fill=el('i','',this.barra);
    for(const [b,kind] of [[this.coletar,'coletar'],[this.destruir,'destruir']] as const){
      b.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();this.options.onAct(kind);});
      for(const type of ['pointerup','touchstart','mousedown','click'] as const)b.addEventListener(type,e=>e.stopPropagation());
    }
    this.listenMap();
  }
  private listenMap(){
    const onMap=(e:Event)=>this.available&&!this.options.busy()&&e.target instanceof HTMLCanvasElement&&e.target===this.options.canvas();
    let mine=false;
    const down=(e:PointerEvent)=>{
      mine=false;
      if(!onMap(e)||e.button>0)return;
      if(this.options.onTap(e.clientX,e.clientY)){mine=true;e.stopImmediatePropagation();e.preventDefault();}
    };
    const block=(e:Event)=>{if(mine){e.stopImmediatePropagation();e.preventDefault();}};
    const move=(e:PointerEvent)=>{
      if(e.pointerType!=='mouse')return;
      const canvas=this.options.canvas();
      const over=onMap(e)&&this.options.onHover(e.clientX,e.clientY);
      if(!onMap(e))this.options.onHover(undefined,undefined);
      if(canvas)canvas.style.cursor=over?'pointer':'';
    };
    const on=<K extends keyof WindowEventMap>(type:K,fn:(e:WindowEventMap[K])=>void)=>{
      window.addEventListener(type,fn as EventListener,{capture:true,passive:false});
      this.offs.push(()=>window.removeEventListener(type,fn as EventListener,{capture:true}));
    };
    on('pointerdown',down);on('pointermove',move);on('pointerup',block);on('mousedown',block);on('touchstart',block);
  }
  update(state:TralhaHudState){
    this.available=state.available;
    const show=state.available&&(!!state.at||state.progress!==undefined);
    this.el.hidden=!show;
    if(!show)return;
    for(const [b,dx] of [[this.coletar,-36],[this.destruir,36]] as const){
      b.hidden=!state.at;
      if(state.at){b.style.left=`${state.at.x+dx}px`;b.style.top=`${state.at.y-52}px`;}
    }
    this.barra.hidden=state.progress===undefined||!state.hero;
    if(state.progress!==undefined&&state.hero){
      this.barra.style.left=`${state.hero.x}px`;this.barra.style.top=`${state.hero.y-64}px`;
      this.fill.style.width=`${Math.round(state.progress*100)}%`;
    }
  }
  destroy(){for(const off of this.offs)off();this.offs.length=0;const c=this.options.canvas();if(c)c.style.cursor='';this.el.remove();}
}
