/**
 * Card NEW-20261031-ORQ-torres-3-base-9-evolucoes-regras: the panel over a tapped bicho tower (model.ts has the rules).
 * A tap on a standing bicho opens it: the name and força, an initial's 3 evolution cards and the Força N→N+1 button,
 * each with its R$; a tap elsewhere on the map (or the ✕) closes it. Self-contained: explore.ts makes it, feeds it the
 * room's answers (answer) and calls update once a frame. Only tokens (ui/tokens.css); painel.css.
 */
import './painel.css';
import type {RunView} from '../../../../contract/index.ts';
import {FORCA_BRANCH} from '../../../../rules/index.ts';
import {BichoPick,bichoPanel,type BichoNet,type BuiltAnswer} from './model.ts';

type Pt={x:number;y:number};
export interface BichoHudOptions {
  net:BichoNet;view:()=>RunView|undefined;
  /** Client px → world point, world point → screen px (the scene's worldAt / locate().screen). */
  worldAt:(x:number,y:number)=>Pt|undefined;screen:(p:Pt)=>Pt|undefined;
  canvas:()=>HTMLCanvasElement|undefined;
  /** Other map modes (the build tray, a kit being placed) own the presses. */
  busy:()=>boolean;say:(text:string)=>void;
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};
const price=(n:number,missing:number)=>missing>0?`Falta R$ ${missing}`:`R$ ${n}`;

export class BichoHud {
  readonly el:HTMLDivElement;
  readonly pick=new BichoPick();
  private available=false;private key='';
  private readonly offs:(()=>void)[]=[];
  constructor(host:HTMLElement,private readonly o:BichoHudOptions){
    this.el=el('div','rh-bicho',host);this.el.hidden=true;this.el.setAttribute('role','dialog');
    for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)this.el.addEventListener(type,e=>e.stopPropagation());
    this.el.addEventListener('click',e=>{
      const b=(e.target as Element).closest<HTMLButtonElement>('button[data-branch]');
      if(!b||b.disabled)return;
      if(b.dataset.branch==='x'){this.pick.selected=undefined;return;}
      if(this.pick.order(b.dataset.branch!,this.o.net)==='offline')this.o.say('Agora não dá');
    });
    const down=(e:PointerEvent)=>{
      if(!this.available||this.o.busy()||e.button>0||!(e.target instanceof HTMLCanvasElement)||e.target!==this.o.canvas())return;
      const p=this.o.worldAt(e.clientX,e.clientY);
      if(p&&this.pick.tap(this.o.view()?.structures??[],p)){e.stopImmediatePropagation();e.preventDefault();}
    };
    window.addEventListener('pointerdown',down,{capture:true,passive:false});
    this.offs.push(()=>window.removeEventListener('pointerdown',down,{capture:true}));
  }
  /** The room's {t:'built'}: true when it answered one of the panel's orders (and said what it had to). */
  answer(a:BuiltAnswer):boolean{
    if(!this.pick.owns(a.req))return false;
    const text=this.pick.answer(a);if(text)this.o.say(text);
    return true;
  }
  update(available:boolean){
    this.available=available;
    const view=this.o.view(),structures=view?.structures??[];
    if(!available)this.pick.selected=undefined;else this.pick.sync(structures);
    const s=this.pick.selected===undefined?undefined:structures.find(x=>x.id===this.pick.selected);
    const at=s&&this.o.screen(s);
    this.el.hidden=!s||!at;
    if(!s||!at){this.key='';return;}
    const panel=bichoPanel(s,view?.camp?.grana??0),key=JSON.stringify(panel);
    if(key!==this.key){this.key=key;this.render(panel);}
    // Over the tower, kept inside the screen.
    const w=this.el.offsetWidth,h=this.el.offsetHeight,vw=innerWidth,vh=innerHeight;
    this.el.style.left=`${Math.round(Math.max(8,Math.min(vw-w-8,at.x-w/2)))}px`;
    this.el.style.top=`${Math.round(Math.max(8,Math.min(vh-h-8,at.y-h-48)))}px`;
  }
  private render(p:ReturnType<typeof bichoPanel>){
    const cards=p.cards.map(c=>`<button type="button" class="rh-bicho-carta" data-branch="${c.id}"${c.missing>0?' disabled':''}>`+
      `<strong>${c.name}</strong><small>${c.effect}</small><em>${price(c.price,c.missing)}</em></button>`).join('');
    const f=p.forca;
    this.el.innerHTML=`<header><strong>${p.name}</strong><span>Força ${p.level}</span><button type="button" class="rh-bicho-x" data-branch="x" aria-label="Fechar">✕</button></header>`+
      (p.building?'<p>Em obra…</p>':'')+(cards?`<div class="rh-bicho-cartas">${cards}</div>`:'')+
      (f&&!p.building?`<button type="button" class="rh-bicho-forca" data-branch="${FORCA_BRANCH}"${f.missing>0?' disabled':''}>Força ${p.level} → ${f.to} <em>${price(f.price,f.missing)}</em></button>`:'')+
      (!f?'<p>Força máxima</p>':'');
  }
  destroy(){for(const off of this.offs)off();this.offs.length=0;this.el.remove();}
}
