/**
 * Spectator bar (NEW-20261009-UX-espectador): out of the run (bled out) or watching (joined mid-run), the bottom band
 * where the thumbs were becomes the torcida's: ‹ who the camera follows › (cycles the teammates still in the run), the
 * "Chinelo" (a slipper flies to the watched friend and a line pops up: screen only, nothing reaches the room, so the
 * room's stateHash never sees it) and "Voltar pra sala" (two taps: the first one asks again, then it leaves the room).
 * The top banner keeps "Você tá fora. Volta na revanche." (hud/model.ts OUT_TEXT). After a fall the player walks the
 * map as a ghost (morto-anda-pelo-mapa, scene.ts): the bar then reads "Fantasma · Pelo mapa" and ‹ › pin a friend. spectatorView is pure (node tests);
 * the bar's CSS (spectator.css) is imported by explore.ts, so node can load this module.
 */
import {icon} from '../ui/icon.ts';
import type {RunPhase} from '../../contract/index.ts';
import {railName} from '../../rules/index.ts';

/** What the bar needs from the frame: the run phase, the local player's state and who the camera follows. */
export interface SpectatorInput {
  phase?:RunPhase;eliminated?:boolean;spectator?:boolean;
  /** scene.watching(): the followed teammate and how many teammates are still in the run (the ‹ › cycle). */
  watching?:{id:string;name:string;classId?:string;choices:number};
  /** scene.ghosting(): the ghost walks free; `choices` teammates in the run for ‹ › to pin. */
  ghost?:{choices:number};
}
export interface SpectatorView {show:boolean;name:string;classId?:string;arrows:boolean;ghost?:boolean}

/** The rail's short name (rules/names.ts railName): the same as the banner's "Assistindo: Tia" and the team rail, bot number kept. */
export const shortName=railName;
/** No one left standing to watch (everybody out): the bar still offers the way back to the room and the chinelo lands in the middle. */
export const NOBODY_TEXT='Ninguém em pé';
/** The ghost walking free (the bar's "Fantasma" label comes from spectator.css). */
export const GHOST_TEXT='Pelo mapa';

export function spectatorView(input:SpectatorInput):SpectatorView{
  const show=input.phase==='combat'&&(!!input.eliminated||!!input.spectator);
  if(!show)return {show:false,name:'',arrows:false};
  // Walking free: any friend still in the run is one ‹ › away.
  if(input.ghost)return {show,name:GHOST_TEXT,arrows:input.ghost.choices>0,ghost:true};
  const w=input.watching;
  return {show,name:w?shortName(w.name):NOBODY_TEXT,...(w?.classId?{classId:w.classId}:{}),arrows:(w?.choices??0)>1};
}

/** The torcida's lines when the slipper lands (zueira, no effect in the game). */
export const CHINELO_LINES:readonly string[]=Object.freeze([
  'Chinelada de incentivo!',
  'Vai, que a mãe tá vendo!',
  'Torcida organizada: 1 pessoa.',
  'Errou o bicho, acertou o amigo.',
  'Isso é apoio moral.',
  'Corre que o chinelo é seu!',
]);
/** One slipper at a time per tap rhythm: a tap inside this window is ignored. */
export const CHINELO_COOLDOWN_MS=900;
/** How long the slipper flies (ms) and how long its line stays after the landing. */
export const CHINELO_FLIGHT_MS=650;
export const CHINELO_LINE_MS=1400;
/** The second tap on "Voltar pra sala" must come within this window; past it, the button goes back to its label. */
export const LEAVE_CONFIRM_MS=3000;
export const LEAVE_TEXT='Voltar pra sala';
export const LEAVE_CONFIRM_TEXT='Sai da sala? Toca de novo';

/** The line for the n-th slipper (seeded, so the sandbox and the tests see the same order). */
export const chineloLine=(n:number)=>CHINELO_LINES[((n%CHINELO_LINES.length)+CHINELO_LINES.length)%CHINELO_LINES.length];

export interface SpectatorOptions {
  /** ‹ (-1) or › (1): the scene follows the previous/next teammate (scene.watchStep). */
  onStep(dir:1|-1):void;
  /** The confirmed "Voltar pra sala": leaves the room (explore.ts close). */
  onLeave():void;
  /** Where the slipper lands (CSS px, viewport): the watched teammate on screen; undefined: the middle of the screen. */
  target():{x:number;y:number}|undefined;
  /** Portrait URL of a class (the team strip's thumbs). */
  portrait?(classId:string):string;
  now?():number;
}

export class SpectatorBar {
  readonly root:HTMLElement;
  private readonly nameEl:HTMLElement;private readonly face:HTMLImageElement;
  private readonly prev:HTMLButtonElement;private readonly next:HTMLButtonElement;
  private readonly leave:HTMLButtonElement;private readonly leaveLabel:HTMLElement;
  private readonly fx:HTMLElement;
  private key='';private thrown=0;private lastThrow=-Infinity;private confirmUntil=-Infinity;
  private confirmTimer?:ReturnType<typeof setTimeout>;
  private readonly timers=new Set<ReturnType<typeof setTimeout>>();
  private readonly now:()=>number;
  private readonly options:SpectatorOptions;
  constructor(parent:HTMLElement,options:SpectatorOptions){
    this.options=options;
    this.now=options.now??(()=>performance.now());
    const root=this.root=document.createElement('div');root.className='spect';root.hidden=true;
    root.setAttribute('role','group');root.setAttribute('aria-label','Torcida');
    root.innerHTML=`<div class="spect-alvo">
<button type="button" class="spect-seta" data-dir="-1" aria-label="Assistir o amigo anterior">‹</button>
<span class="spect-quem" aria-live="polite"><img class="spect-rosto" alt="" hidden><span class="spect-nome"></span></span>
<button type="button" class="spect-seta" data-dir="1" aria-label="Assistir o próximo amigo">›</button>
</div><div class="spect-acoes">
<button type="button" class="spect-chinelo" aria-label="Jogar chinelo de torcida (só aparece na sua tela)">${icon('chinelo',{size:32})}<span>Chinelo</span></button>
<button type="button" class="spect-sair">${icon('voltar',{size:24})}<span class="spect-sair-texto">${LEAVE_TEXT}</span></button>
</div>`;
    this.nameEl=root.querySelector('.spect-nome')!;this.face=root.querySelector('.spect-rosto')!;
    [this.prev,this.next]=[...root.querySelectorAll<HTMLButtonElement>('.spect-seta')] as [HTMLButtonElement,HTMLButtonElement];
    this.leave=root.querySelector('.spect-sair')!;this.leaveLabel=root.querySelector('.spect-sair-texto')!;
    // The flying slippers and their lines live outside the bar (over the field), never catching a finger.
    this.fx=document.createElement('div');this.fx.className='spect-fx';this.fx.setAttribute('aria-hidden','true');
    // The bar's taps never reach the joystick, the map or the HUD's own capture listeners below it.
    for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove','click'] as const)root.addEventListener(type,e=>e.stopPropagation());
    for(const b of [this.prev,this.next])b.addEventListener('click',()=>{if(!b.disabled)this.options.onStep(Number(b.dataset.dir) as 1|-1);});
    root.querySelector('.spect-chinelo')!.addEventListener('click',()=>this.throwChinelo());
    this.leave.addEventListener('click',()=>this.tapLeave());
    // A mouse click leaves no focus behind: the desktop's Space (the skill key) must never press "Voltar pra sala".
    root.addEventListener('click',e=>{if(e.detail>0)(e.target as HTMLElement).closest('button')?.blur();});
    parent.append(root,this.fx);
  }

  /** Per frame (cheap: writes only when what it shows changes). */
  update(input:SpectatorInput){
    const v=spectatorView(input);
    const key=v.show?`${v.name}|${v.classId??''}|${v.arrows}|${!!v.ghost}`:'';
    if(key===this.key)return;
    this.key=key;
    this.root.hidden=!v.show;
    if(!v.show){this.resetLeave();return;}
    this.nameEl.textContent=v.name;
    this.root.toggleAttribute('data-ghost',!!v.ghost);
    const src=v.classId&&this.options.portrait?this.options.portrait(v.classId):'';
    if(src){if(this.face.getAttribute('src')!==src)this.face.src=src;this.face.hidden=false;}else this.face.hidden=true;
    this.prev.disabled=this.next.disabled=!v.arrows;
  }

  /** Screen-only zueira: a slipper flies from the button to the watched friend; returns false inside the cooldown. */
  throwChinelo(){
    const now=this.now();
    if(now-this.lastThrow<CHINELO_COOLDOWN_MS)return false;
    this.lastThrow=now;
    const from=this.root.querySelector('.spect-chinelo')!.getBoundingClientRect();
    const to=this.options.target()??{x:innerWidth/2,y:innerHeight/2};
    const n=this.thrown++,side=n%2?1:-1;
    const shoe=document.createElement('div');shoe.className='spect-voo';shoe.innerHTML=icon('chinelo',{size:48});
    const x0=from.left+from.width/2,y0=from.top+from.height/2;
    shoe.style.left=`${x0}px`;shoe.style.top=`${y0}px`;
    this.fx.append(shoe);
    const dx=to.x-x0,dy=to.y-y0,arc=Math.min(160,Math.max(60,Math.hypot(dx,dy)*.35));
    const frames:Keyframe[]=[
      {transform:'translate(-50%,-50%) translate(0,0) rotate(0deg) scale(.7)'},
      {transform:`translate(-50%,-50%) translate(${dx*.5+side*24}px,${dy*.5-arc}px) rotate(${side*360}deg) scale(1)`,offset:.5},
      {transform:`translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${side*720}deg) scale(.9)`},
    ];
    const reduced=matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    shoe.animate?.(reduced?[frames[2],frames[2]]:frames,{duration:reduced?1:CHINELO_FLIGHT_MS,easing:'cubic-bezier(.3,.1,.6,1)',fill:'forwards'});
    this.later(()=>{
      shoe.classList.add('is-landed');
      const line=document.createElement('div');line.className='spect-linha';line.textContent=chineloLine(n);
      line.style.left=`${to.x}px`;line.style.top=`${to.y}px`;this.fx.append(line);
      this.later(()=>{shoe.remove();line.remove();},CHINELO_LINE_MS);
    },CHINELO_FLIGHT_MS);
    return true;
  }

  /** First tap: the button asks again; a second one within LEAVE_CONFIRM_MS leaves the room. */
  private tapLeave(){
    const now=this.now();
    if(now<this.confirmUntil){this.resetLeave();this.options.onLeave();return;}
    this.confirmUntil=now+LEAVE_CONFIRM_MS;
    this.leave.classList.add('is-confirm');this.leaveLabel.textContent=LEAVE_CONFIRM_TEXT;
    if(this.confirmTimer)clearTimeout(this.confirmTimer);
    this.confirmTimer=setTimeout(()=>this.resetLeave(),LEAVE_CONFIRM_MS);
  }
  private resetLeave(){
    this.confirmUntil=-Infinity;if(this.confirmTimer)clearTimeout(this.confirmTimer);this.confirmTimer=undefined;
    this.leave.classList.remove('is-confirm');this.leaveLabel.textContent=LEAVE_TEXT;
  }
  private later(fn:()=>void,ms:number){const t=setTimeout(()=>{this.timers.delete(t);fn();},ms);this.timers.add(t);}

  destroy(){
    this.resetLeave();for(const t of this.timers)clearTimeout(t);this.timers.clear();
    this.root.remove();this.fx.remove();
  }
}
