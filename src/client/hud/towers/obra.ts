/**
 * Build menu in the intermission (torres-hud, D-041, D-009, D-020): mobile, touch only.
 * - The build sites show on the ground as 48 px markers at their screen points (clamped into the useful field); a site
 *   with a tower that can grow right now wears the Amarelo evolve arrow.
 * - A tap on a site opens the tree as a Janela: the head card (the Vigia to build, or what stands there) and its
 *   branches as etiquetas (suit sticker, name, cost with the material icons, one line). A blocked branch is dashed with a
 *   lock and its reason in words ("Falta 4", "Falta o trilho"). The thumb confirms in the 48 px button at the bottom.
 * - Geometry comes from layout.ts (no scroll, clear of both thumbs and the hero); the view-model from model.ts.
 * Hidden outside the intermission. The host injects the view (sandbox now; torres-fio's wire later) and gets the action.
 */
import './obra.css';
import {icon} from '../../ui/icon.ts';
import {computeZones,type ZoneInput,type Rect} from '../zones.ts';
import {layoutObra,markerRect} from './layout.ts';
import {BRANCH_NAME,RAIL_SITE_ID,blockSpeech,blockText,canEvolve,cardsOf,defaultPick,railTree,selectable,treeFor,type ObraAction,type ObraCard,type ObraTree,type ObraView} from './model.ts';

const SUIT:Record<'A'|'B'|'C'|'root'|'rail',string>={
  // Paus (people standing together), ouros (a blast), espadas (a beam); the root a plain guard post; the rail its sleepers.
  A:'<circle cx="12" cy="7" r="4.5"/><circle cx="6.8" cy="14" r="4.5"/><circle cx="17.2" cy="14" r="4.5"/><path d="M10.6 14h2.8l1.6 8H9z"/>',
  B:'<path d="M12 1.5 20 12 12 22.5 4 12z"/>',
  C:'<path d="M12 1.5C9 7 3.8 9.6 3.8 14.2a4.2 4.2 0 0 0 7.2 2.9L9.8 22h4.4L13 17.1a4.2 4.2 0 0 0 7.2-2.9C20.2 9.6 15 7 12 1.5z"/>',
  root:'<path d="M5 22V9l7-6 7 6v13h-5v-6h-4v6z"/>',
  rail:'<path d="M3 5h18v2.5H3zM3 16.5h18V19H3zM5 3h2.5v18H5zM10.75 3h2.5v18h-2.5zM16.5 3H19v18h-2.5z"/>',
};
const suitOf=(c:ObraCard)=>c.rail&&!c.label?'rail':c.branch??'root';
const suit=(c:ObraCard)=>`<svg class="rh-obra-naipe" data-naipe="${suitOf(c)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SUIT[suitOf(c)]}</svg>`;
const ARROW='<svg class="rh-obra-seta" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 21 12h-5.5v10h-7V12H3z"/></svg>';
const mat=`<span class="rh-obra-mat" aria-hidden="true">${icon('coco')}${icon('pedra')}</span>`;

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};
const place=(node:HTMLElement,r:Rect,o:{x:number;y:number}={x:0,y:0})=>{node.style.left=`${r.x-o.x}px`;node.style.top=`${r.y-o.y}px`;node.style.width=`${r.width}px`;node.style.height=`${r.height}px`;};
const textScale=()=>document.documentElement.dataset.texto==='125'?1.25:1;

export interface ObraHudOptions {
  /** The current zone input (viewport, controls, safe area), measured or injected by the host. */
  zoneInput:()=>ZoneInput;
  /** A confirmed choice: the host sends the sim's build/upgrade (the menu does not wait for the answer). */
  onConfirm:(action:ObraAction)=>void;
}

export class ObraHud {
  readonly el:HTMLDivElement;
  private view?:ObraView;
  private openSite?:string;
  private pick?:string;
  constructor(parent:HTMLElement,private readonly options:ObraHudOptions){
    this.el=el('div','rh-obra',parent);
    this.el.addEventListener('keydown',e=>{if(e.key==='Escape')this.close();});
  }
  update(view:ObraView){this.view=view;if(!view.prepare)this.openSite=undefined;this.render();}
  open(siteId:string){
    const tree=this.tree(siteId);if(!tree)return;
    this.openSite=siteId;this.pick=defaultPick(tree);this.render();
  }
  close(){this.openSite=undefined;this.pick=undefined;this.render();}
  get isOpen(){return this.openSite!==undefined;}
  destroy(){this.el.remove();}

  private tree(siteId:string):ObraTree|undefined{
    const v=this.view;if(!v)return undefined;
    if(siteId===RAIL_SITE_ID)return v.rail?railTree(v):undefined;
    const site=v.sites.find(s=>s.id===siteId);
    return site&&treeFor(site,v);
  }

  private render(){
    const v=this.view;this.el.replaceChildren();
    this.el.hidden=!v?.prepare;
    if(!v?.prepare)return;
    const input=this.options.zoneInput(),scale=textScale();
    const tree=this.openSite?this.tree(this.openSite):undefined;
    const layout=tree&&layoutObra(input,scale,tree.branches.length);
    // Closed: the markers live in the whole field (no window trims it).
    const base=computeZones(input).useful;
    // Markers: all of them while the menu is closed (in the field without a window), only the open one while it is open.
    const marks:{id:string;x:number;y:number;kind:'vazio'|'torre'|'obra'|'trilho';evolve:boolean;label:string;branch?:string;head?:ObraCard}[]=[];
    for(const s of v.sites){
      const t=s.tower&&!s.tower.ruined?s.tower:undefined;
      const evolve=canEvolve(s,v);
      const head=t?treeFor(s,v).head:undefined;
      marks.push({id:s.id,x:s.x,y:s.y,kind:t?(t.building?'obra':'torre'):'vazio',evolve,branch:head?head.branch??'root':undefined,head,
        label:head?`${head.name}${t?.building?', em obra':''}${evolve?'. Dá pra evoluir':''}`:'Ponto de obra vazio'});
    }
    if(v.rail)marks.push({id:RAIL_SITE_ID,x:v.rail.x,y:v.rail.y,kind:'trilho',evolve:false,label:v.rail.laid?'Trilho do Gustavão':'Ponto do trilho'});
    for(const m of marks){
      if(layout&&m.id!==this.openSite)continue;
      const r=markerRect(m,layout?layout.zones.useful:base);
      const b=el('button','rh-obra-site',this.el);b.type='button';place(b,r);
      b.dataset.kind=m.kind;b.dataset.site=m.id;if(m.branch)b.dataset.branch=m.branch;
      if(m.id===this.openSite)b.setAttribute('aria-expanded','true');
      b.setAttribute('aria-label',m.label);
      b.insertAdjacentHTML('beforeend',`<span class="rh-obra-chao" aria-hidden="true">${m.head?suit(m.head):''}</span>`);
      if(m.evolve)b.insertAdjacentHTML('beforeend',`<span class="rh-obra-evoluir">${ARROW}</span>`);
      b.addEventListener('click',()=>{m.id===this.openSite?this.close():this.open(m.id);});
    }
    if(!tree||!layout)return;
    const panel=el('section','rh-obra-janela',this.el);place(panel,layout.panel);
    panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`Obra: ${tree.head.name}`);
    panel.dataset.orientation=layout.orientation;
    const cards=cardsOf(tree),rects=[layout.head,...layout.branches];
    cards.forEach((c,i)=>this.card(panel,c,rects[i],i===0,layout.panel));
    const close=el('button','rh-obra-fechar',panel);close.type='button';place(close,layout.close,layout.panel);
    close.setAttribute('aria-label','Fechar');close.insertAdjacentHTML('beforeend',icon('fechar'));
    close.addEventListener('click',()=>this.close());
    const chosen=cards.find(c=>c.key===this.pick&&selectable(c));
    const ok=el('button','rh-obra-ok',panel);ok.type='button';place(ok,layout.confirm,layout.panel);
    ok.disabled=!chosen;
    const verb=!chosen?'Escolha':chosen.action?.type==='upgrade'?'Evoluir':'Construir';
    ok.innerHTML=`<span>${verb}</span>${chosen?`${mat}<b>${chosen.cost}</b>`:''}`;
    ok.setAttribute('aria-label',chosen?`${verb} ${chosen.name} por ${chosen.cost} de material`:'Escolha uma opção');
    ok.addEventListener('click',()=>{
      if(!chosen?.action)return;
      this.options.onConfirm(chosen.action);this.close();
    });
  }

  private card(panel:HTMLElement,c:ObraCard,r:Rect,head:boolean,origin:Rect){
    const b=el('button','rh-obra-card',panel);b.type='button';place(b,r,origin);
    b.dataset.status=c.status;if(c.branch)b.dataset.branch=c.branch;
    if(head)b.dataset.head='1';
    const open=selectable(c),picked=open&&c.key===this.pick;
    b.setAttribute('aria-disabled',String(!open));
    if(picked)b.setAttribute('aria-pressed','true');
    const why=c.block?blockText(c):c.status==='obra'?'Em obra':c.status==='have'?'Pronta':'';
    const side=c.block
      ?`<span class="rh-obra-why">${icon('cadeado')}<span>${why}</span></span>`
      :c.status==='buy'?`<span class="rh-obra-cost">${mat}<b>${c.cost}</b></span>`:c.status==='obra'?`<span class="rh-obra-why rh-obra-tem">${why}</span>`:'';
    b.innerHTML=`${suit(c)}<span class="rh-obra-nome">${c.name}</span>${side}<span class="rh-obra-efeito">${c.effect}</span>`;
    const branch=c.branch&&!c.rail?`, ramo ${c.branch}: ${BRANCH_NAME[c.branch]}`:'';
    b.setAttribute('aria-label',`${c.name}${branch}. ${c.effect}. ${c.status==='buy'?`Custa ${c.cost}.`:''} ${c.block?blockSpeech(c):why}`.trim());
    b.addEventListener('click',()=>{if(!open)return;this.pick=c.key;this.render();});
  }
}
