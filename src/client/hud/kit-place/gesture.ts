/**
 * barricada-tocar-no-mapa: the map's presses while a kit is selected (hud/kit-place/model.ts), on the phone and the PC
 * alike. Capture on the window like the fortify tray (hud/fortify/fortify.ts listenMap): Phaser never sees them, so the
 * hero neither walks nor attacks. One finger at a time (the stick's own finger is on the DOM, never on the canvas).
 * - press: the ghost goes there; move while held: the drag turns it; release: build there.
 * - The mouse hovering (no button down) moves the ghost too.
 */
export interface KitGestureOptions {
  /** A kit is selected and its ghost may show (not watching, no card open). */
  active:()=>boolean;
  /** The game's canvas (only presses on it count). */
  canvas:()=>HTMLCanvasElement|undefined;
  onPress:(x:number,y:number)=>void;
  onMove:(x:number,y:number)=>void;
  /** The press let go; `cancelled` (pointercancel, or the mode ended meanwhile): forget it, build nothing. */
  onRelease:(cancelled:boolean)=>void;
}

export class KitGesture {
  private pointer:number|undefined;
  private readonly offs:(()=>void)[]=[];
  constructor(private options:KitGestureOptions){
    const onMap=(e:Event)=>this.options.active()&&e.target instanceof HTMLCanvasElement&&e.target===this.options.canvas();
    const block=(e:Event)=>{if(onMap(e)){e.stopImmediatePropagation();e.preventDefault();}};
    const down=(e:PointerEvent)=>{
      if(!onMap(e)||(e.pointerType==='mouse'&&e.button!==0))return;
      e.stopImmediatePropagation();e.preventDefault();
      if(this.pointer!==undefined)return;
      this.pointer=e.pointerId;
      this.options.onPress(e.clientX,e.clientY);
    };
    const move=(e:PointerEvent)=>{
      if(this.pointer!==undefined){
        if(e.pointerId!==this.pointer)return;
        e.stopImmediatePropagation();
        if(this.options.active())this.options.onMove(e.clientX,e.clientY);
        return;
      }
      if(e.pointerType==='mouse'&&onMap(e))this.options.onMove(e.clientX,e.clientY);
    };
    const up=(e:PointerEvent)=>{
      if(e.pointerId!==this.pointer)return;
      this.pointer=undefined;e.stopImmediatePropagation();
      this.options.onRelease(e.type!=='pointerup'||!this.options.active());
    };
    const on=<K extends keyof WindowEventMap>(type:K,fn:(e:WindowEventMap[K])=>void)=>{
      window.addEventListener(type,fn as EventListener,{capture:true,passive:false});
      this.offs.push(()=>window.removeEventListener(type,fn as EventListener,{capture:true}));
    };
    on('pointerdown',down);on('pointermove',move);on('pointerup',up);on('pointercancel',up);
    on('mousedown',block);on('touchstart',block);on('click',block);
  }
  /** A press is held. */
  get held(){return this.pointer!==undefined;}
  destroy(){for(const off of this.offs)off();this.offs.length=0;this.pointer=undefined;}
}
