/**
 * Quick emotes and speech balloons (VGM-053A).
 * Pure parts (catalog, EmoteGate, balloon placement) are shared by client and server; the DOM parts are mobile-only
 * (touch targets >= 44 px, no keyboard or hover requirement, D-009).
 */
export type EmoteId='kkkk'|'salva'|'vem'|'foimal';
export interface EmoteDef {id:EmoteId;label:string;icon:string;
  /** Balloon flavor: laugh shakes, help pulses red, come bounces, sorry droops. */
  tone:'laugh'|'help'|'come'|'sorry'}
export const EMOTES:readonly EmoteDef[]=Object.freeze([
  {id:'kkkk',label:'KKKK',icon:'😂',tone:'laugh'},
  {id:'salva',label:'Me salva',icon:'🆘',tone:'help'},
  {id:'vem',label:'Vem',icon:'👉',tone:'come'},
  {id:'foimal',label:'Foi mal',icon:'🙏',tone:'sorry'},
]);
export const EMOTE_COOLDOWN_MS=2000;
/** Balloon lifetime on screen. */
export const BALLOON_MS=2200;
export const isEmoteId=(value:unknown):value is EmoteId=>typeof value==='string'&&EMOTES.some(e=>e.id===value);
export const emoteDef=(id:EmoteId)=>EMOTES.find(e=>e.id===id)!;

/** Per-player anti-spam (2 s). The client greys the button; the room (VGM-043) can drop floods with the same rule. */
export class EmoteGate {
  readonly cooldownMs:number;
  private readonly last=new Map<string,number>();
  constructor(cooldownMs=EMOTE_COOLDOWN_MS){this.cooldownMs=Number.isFinite(cooldownMs)&&cooldownMs>=0?cooldownMs:EMOTE_COOLDOWN_MS;}
  /** Never more than one cooldown, even if the clock steps back (time base reset). NaN clocks read as blocked. */
  remaining(playerId:string,now:number){
    const at=this.last.get(playerId);
    if(at===undefined)return 0;
    if(!Number.isFinite(now))return this.cooldownMs;
    return Math.min(this.cooldownMs,Math.max(0,at+this.cooldownMs-now));
  }
  /** Returns true and starts the cooldown when allowed. */
  tryUse(playerId:string,now:number){
    if(!Number.isFinite(now))return false;
    const at=this.last.get(playerId);
    if(at!==undefined&&now<at)this.last.set(playerId,now-this.cooldownMs+this.remaining(playerId,now));
    if(this.remaining(playerId,now)>0)return false;
    this.last.set(playerId,now);return true;
  }
  forget(playerId:string){this.last.delete(playerId);}
}

export interface Box {width:number;height:number}
/**
 * Top-left corner for a balloon centered above (x,y) (the head of the character), kept inside the viewport
 * with `margin`. When there is no room above, the balloon flips below and `below` is true.
 */
export function placeBalloon(x:number,y:number,balloon:Box,viewport:Box,margin=8,lift=10){
  let left=Math.round(x-balloon.width/2),top=Math.round(y-lift-balloon.height),below=false;
  if(top<margin){top=Math.round(y+lift);below=true;}
  left=Math.max(margin,Math.min(viewport.width-margin-balloon.width,left));
  top=Math.max(margin,Math.min(viewport.height-margin-balloon.height,top));
  // Tail offset from the balloon's left edge, pointing at x even after clamping.
  const tail=Math.max(12,Math.min(balloon.width-12,x-left));
  return {left,top,below,tail};
}

// ---------- DOM (client only) ----------
export type BalloonKind='emote'|'line'|'help';
interface Balloon {el:HTMLElement;x:number;y:number;until:number;width:number;height:number}

/**
 * One balloon per speaker; a new one replaces the old. Call place() whenever the speaker moves and update() once per frame.
 * Balloon sizes are measured once (text never changes) and the viewport once per update(), so place() never forces layout.
 */
export class BalloonLayer {
  readonly root:HTMLElement;
  private readonly balloons=new Map<string,Balloon>();
  private readonly now:()=>number;
  private view={width:0,height:0};
  constructor(parent:HTMLElement,now:()=>number=()=>performance.now()){
    this.now=now;
    // Purely visual chatter: not announced, or six players would flood screen readers.
    this.root=document.createElement('div');this.root.className='fun-balloons';this.root.setAttribute('aria-hidden','true');
    parent.append(this.root);
  }
  show(speaker:string,text:string,x:number,y:number,options:{kind?:BalloonKind;tone?:EmoteDef['tone'];icon?:string;ms?:number}={}){
    this.remove(speaker);
    const el=document.createElement('div');
    el.className=`fun-balloon fun-balloon-${options.kind??'line'}${options.tone?` fun-tone-${options.tone}`:''}`;
    el.dataset.speaker=speaker;
    if(options.icon){const icon=document.createElement('span');icon.className='fun-balloon-icon';icon.textContent=options.icon;el.append(icon);}
    const label=document.createElement('span');label.className='fun-balloon-text';label.textContent=text;el.append(label);
    this.root.append(el);
    this.measureView();
    const balloon:Balloon={el,x,y,until:this.now()+(options.ms??BALLOON_MS),width:el.offsetWidth,height:el.offsetHeight};
    this.balloons.set(speaker,balloon);this.layout(balloon);
    return el;
  }
  place(speaker:string,x:number,y:number){const b=this.balloons.get(speaker);if(b){b.x=x;b.y=y;this.layout(b);}}
  /** Drops expired balloons and re-measures what was shown while the layer was hidden; call once per frame. */
  update(){
    const now=this.now();
    this.measureView();
    for(const [speaker,b] of this.balloons){
      if(now>=b.until){this.remove(speaker);continue;}
      if(!b.width&&b.el.offsetWidth){b.width=b.el.offsetWidth;b.height=b.el.offsetHeight;this.layout(b);}
    }
  }
  remove(speaker:string){const b=this.balloons.get(speaker);if(b){b.el.remove();this.balloons.delete(speaker);}}
  clear(){for(const speaker of [...this.balloons.keys()])this.remove(speaker);}
  get size(){return this.balloons.size;}
  private measureView(){this.view={width:this.root.clientWidth||innerWidth,height:this.root.clientHeight||innerHeight};}
  private layout(b:Balloon){
    const p=placeBalloon(b.x,b.y,b,this.view);
    b.el.style.transform=`translate(${p.left}px,${p.top}px)`;
    b.el.style.setProperty('--tail',`${p.tail}px`);
    b.el.classList.toggle('fun-below',p.below);
  }
}

export interface EmoteBarOptions {
  playerId:string;
  gate?:EmoteGate;
  onEmote(id:EmoteId):void;
  now?:()=>number;
}
/**
 * Emote button above the attack button: a tap opens a fan of 4 emotes, a tap on one sends it and closes.
 * Pointer events stop at the bar so the joystick and world taps never see them.
 */
export class EmoteBar {
  readonly root:HTMLElement;
  private readonly toggleButton:HTMLButtonElement;
  private readonly buttons:HTMLButtonElement[]=[];
  private readonly options:EmoteBarOptions;
  private readonly gate:EmoteGate;
  private readonly now:()=>number;
  private timer=0;
  private readonly fan:HTMLElement;
  private readonly outside=(e:PointerEvent)=>{if(!this.root.contains(e.target as Node))this.setOpen(false);};
  constructor(parent:HTMLElement,options:EmoteBarOptions){
    this.options=options;this.gate=options.gate??new EmoteGate();this.now=options.now??(()=>performance.now());
    this.root=document.createElement('div');this.root.className='fun-emotes';
    this.toggleButton=document.createElement('button');
    this.toggleButton.type='button';this.toggleButton.className='fun-emote-toggle';
    this.toggleButton.setAttribute('aria-label','Emotes');this.toggleButton.setAttribute('aria-expanded','false');
    this.toggleButton.textContent='💬';
    const fan=this.fan=document.createElement('div');fan.className='fun-emote-fan';fan.setAttribute('role','menu');fan.inert=true;
    EMOTES.forEach((emote,index)=>{
      const button=document.createElement('button');
      button.type='button';button.className=`fun-emote fun-tone-${emote.tone}`;button.style.setProperty('--i',String(index));
      // Quarter arc from straight up to straight left of the toggle (CSS trig is not on older phones).
      const angle=(90+index*30)*Math.PI/180;
      button.style.setProperty('--ux',Math.cos(angle).toFixed(3));button.style.setProperty('--uy',(-Math.sin(angle)).toFixed(3));
      button.dataset.emote=emote.id;button.setAttribute('role','menuitem');
      button.innerHTML=`<span aria-hidden="true">${emote.icon}</span><b>${emote.label}</b>`;
      button.addEventListener('click',()=>this.send(emote.id));
      fan.append(button);this.buttons.push(button);
    });
    this.toggleButton.addEventListener('click',()=>this.setOpen(!this.open));
    for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove'] as const)this.root.addEventListener(type,e=>e.stopPropagation());
    this.root.append(fan,this.toggleButton);
    parent.append(this.root);
  }
  get open(){return this.root.classList.contains('is-open');}
  /** Open fan closes on a tap anywhere else; closed buttons are inert (no focus, not read). */
  setOpen(open:boolean){
    this.root.classList.toggle('is-open',open);this.toggleButton.setAttribute('aria-expanded',String(open));this.fan.inert=!open;
    if(open)document.addEventListener('pointerdown',this.outside,true);else document.removeEventListener('pointerdown',this.outside,true);
  }
  send(id:EmoteId){
    if(!this.gate.tryUse(this.options.playerId,this.now()))return false;
    this.options.onEmote(id);this.setOpen(false);this.cooldown();
    return true;
  }
  private cooldown(){
    const tick=()=>{
      const left=this.gate.remaining(this.options.playerId,this.now());
      this.root.style.setProperty('--cooldown',String(left/this.gate.cooldownMs));
      this.root.classList.toggle('is-cooling',left>0);
      for(const b of this.buttons)b.disabled=left>0;
      if(left>0)this.timer=requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.timer);tick();
  }
  destroy(){cancelAnimationFrame(this.timer);document.removeEventListener('pointerdown',this.outside,true);this.root.remove();}
}
