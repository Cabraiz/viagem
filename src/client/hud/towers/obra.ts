/**
 * Build menu in the intermission (torres-hud, D-041, D-009, D-020): mobile, touch only.
 * - The build sites show on the ground as 48 px markers at their screen points (clamped into the useful field); a site
 *   with a tower that can grow right now wears the Amarelo evolve arrow.
 * - A tap on a site opens the tree as a Janela: the head card (the Vigia to build, or what stands there) and its
 *   branches as etiquetas (suit sticker, name, cost with the material icons, one line). A blocked branch is dashed with a
 *   lock and its reason in words ("Falta 4", "Falta o trilho"). The thumb confirms in the 48 px button at the bottom.
 * - Geometry comes from layout.ts (no scroll, clear of both thumbs and the hero); the view-model from model.ts.
 * Hidden outside the intermission. The host injects the view and gets the action: the sandbox, and the real match
 * (torres-ligar, explore.ts with wiring.ts: the view from the snapshot, build/upgrade to the room, the answer's stamp
 * or refusal). A sent request spins on its marker until the room answers; an accepted one stamps it (100 ms beat).
 * With `drawnInWorld` (the scene draws the towers) a built site's marker is only its suit and the evolve arrow.
 */
import './obra.css';
import {icon} from '../../ui/icon.ts';
import {computeZones,type ZoneInput,type Rect} from '../zones.ts';
import {layoutObra,planMarkers,type MarkerPlan} from './layout.ts';
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
  /** The current zone input (viewport, controls, safe area), measured or injected by the host, without this HUD's own window. */
  zoneInput:()=>ZoneInput;
  /** A confirmed choice: the host sends the sim's build/upgrade (the menu does not wait for the answer). */
  onConfirm:(action:ObraAction)=>void;
  /**
   * The window opens or closes (torres-ligar): the host lets the forge yield and re-measures the zones. Called before
   * the window is laid out, so the zone input it reads already reflects what the host changed.
   */
  onWindow?:(open:boolean)=>void;
}

type Mark={id:string;x:number;y:number;kind:'vazio'|'torre'|'obra'|'trilho';evolve:boolean;label:string;branch?:string;head?:ObraCard;light:boolean;pending:boolean;done:boolean};
/** The markers a plan shows and its hint's count. */
const shownKey=(plan:MarkerPlan)=>`${plan.shown.map(m=>m.id).sort().join(',')}|${plan.hint?.count??0}`;
/** The view without the screen points: what decides the DOM (points only move the markers). */
const shape=(v:ObraView)=>({...v,sites:v.sites.map(({x:_x,y:_y,...s})=>s),rail:v.rail&&{laid:v.rail.laid,ready:v.rail.ready}});

export class ObraHud {
  readonly el:HTMLDivElement;
  private view?:ObraView;
  private openSite?:string;
  private pick?:string;
  /** The last full render's key (shape, open site, pick, zones, text scale) and the field its markers were clamped into. */
  private key='';
  private area?:Rect;
  private readonly markers=new Map<string,HTMLButtonElement>();
  /** Which markers show and the hint's count at the last full render: a change there rebuilds (move() only moves). */
  private shown='';
  private hintEl?:HTMLElement;
  private windowOpen=false;
  /** The zone input of the last full render (the host caches it per layout: a new object means a new layout). */
  private lastInput?:ZoneInput;
  /** The screen points the markers were last placed for (x, y per point): unchanged, nothing moves. */
  private lastPoints:number[]=[];
  /** Sites whose accept stamp already played: while they stay in view.done a rebuild shows the stamp still (no beat). */
  private readonly stamped=new Set<string>();
  constructor(parent:HTMLElement,private readonly options:ObraHudOptions){
    this.el=el('div','rh-obra',parent);this.el.hidden=true;
    this.el.addEventListener('keydown',e=>{if(e.key==='Escape')this.close();});
    // Like the HUD panels (VGM-040): taps on the markers and the window never reach the game underneath.
    for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)this.el.addEventListener(type,event=>event.stopPropagation());
  }
  /**
   * The view of this frame. Cheap when only the screen points moved (the camera follows the hero): the markers move
   * in place; the DOM is rebuilt only when what it shows changed (a rebuild between a finger's down and up would
   * swallow the tap).
   */
  update(view:ObraView){
    this.view=view;if(!view.prepare){this.openSite=undefined;this.pick=undefined;}
    if(this.stamped.size)for(const site of this.stamped)if(!view.done?.includes(site))this.stamped.delete(site);
    this.render();
  }
  open(siteId:string){
    const tree=this.tree(siteId);if(!tree||this.view?.pending?.includes(siteId))return;
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
  private notifyWindow(open:boolean){if(open!==this.windowOpen){this.windowOpen=open;this.options.onWindow?.(open);}}

  private marks(v:ObraView):Mark[]{
    const marks:Mark[]=[],pending=new Set(v.pending??[]),done=new Set(v.done??[]);
    for(const s of v.sites){
      const t=s.tower&&!s.tower.ruined?s.tower:undefined;
      const evolve=canEvolve(s,v);
      const head=t?treeFor(s,v).head:undefined;
      const wait=pending.has(s.id);
      marks.push({id:s.id,x:s.x,y:s.y,kind:t?(t.building?'obra':'torre'):'vazio',evolve,branch:head?head.branch??'root':undefined,head,
        light:!!t&&!!v.drawnInWorld,pending:wait,done:done.has(s.id),
        label:`${head?`${head.name}${t?.building?', em obra':''}${evolve?'. Dá pra evoluir':''}`:'Ponto de obra vazio'}${wait?'. Obra pedida…':''}`});
    }
    if(v.rail){
      const wait=pending.has(RAIL_SITE_ID);
      marks.push({id:RAIL_SITE_ID,x:v.rail.x,y:v.rail.y,kind:'trilho',evolve:false,light:false,pending:wait,done:done.has(RAIL_SITE_ID),
        label:`${v.rail.laid?'Trilho do Gustavão':'Ponto do trilho'}${wait?'. Obra pedida…':''}`});
    }
    return marks;
  }

  private render(){
    const v=this.view;
    const tree=v?.prepare&&this.openSite?this.tree(this.openSite):undefined;
    // The open site left the plan (the room switched maps): the window closes.
    if(!tree&&this.openSite){this.openSite=undefined;this.pick=undefined;}
    this.notifyWindow(!!tree);
    if(!v?.prepare){
      if(!this.el.hidden||this.key){this.el.replaceChildren();this.el.hidden=true;this.markers.clear();this.key='';this.area=undefined;this.hintEl=undefined;}
      return;
    }
    this.el.hidden=false;
    const input=this.options.zoneInput(),scale=textScale();
    // The match gives a revision (wiring.ts): no per-frame comparison of the whole view. The sandbox does not.
    const key=v.revision!==undefined?`${v.revision}|${this.openSite??''}|${this.pick??''}|${scale}`:JSON.stringify([shape(v),this.openSite??null,this.pick??null,input,scale]);
    if(key===this.key&&input===this.lastInput&&this.area){this.move(v);return;}
    this.key=key;this.lastInput=input;this.lastPoints=[];this.el.replaceChildren();this.markers.clear();this.hintEl=undefined;
    const layout=tree&&layoutObra(input,scale,tree.branches.length);
    // Closed: the markers live in the whole field (no window trims it).
    const area=this.area=layout?layout.zones.useful:computeZones(input).useful;
    // Markers: the sites on screen while the menu is closed (in the field without a window), only the open one while it
    // is open. Off-screen sites hide (no pile on the field's edge) behind one "+N obras" hint; crowded ones are nudged.
    const marks=this.marks(v).filter(m=>!layout||m.id===this.openSite),byId=new Map(marks.map(m=>[m.id,m]));
    const plan=planMarkers(marks,area,{keep:this.openSite,hint:!layout});
    this.shown=shownKey(plan);
    if(plan.hint)this.hint(plan.hint);
    plan.shown.forEach(({id,rect},i)=>{
      const m=byId.get(id)!;
      // Stacking by z-index (the plan's order: the nearest the field's centre on top), never by moving nodes around.
      const b=el('button','rh-obra-site',this.el);b.type='button';place(b,rect);b.style.zIndex=String(i+1);
      b.dataset.kind=m.kind;b.dataset.site=m.id;if(m.branch)b.dataset.branch=m.branch;
      if(m.light)b.dataset.light='true';
      // The stamp's beat plays once per acceptance; a rebuild inside its window keeps the stamp without the beat.
      if(m.done){b.dataset.feito=this.stamped.has(m.id)?'still':'true';this.stamped.add(m.id);}
      if(m.pending){b.dataset.pending='true';b.setAttribute('aria-busy','true');b.setAttribute('aria-disabled','true');}
      if(m.id===this.openSite)b.setAttribute('aria-expanded','true');
      b.setAttribute('aria-label',m.label);
      b.insertAdjacentHTML('beforeend',`<span class="rh-obra-chao" aria-hidden="true">${m.head?suit(m.head):''}</span>`);
      if(m.evolve)b.insertAdjacentHTML('beforeend',`<span class="rh-obra-evoluir">${ARROW}</span>`);
      b.addEventListener('click',()=>{if(m.pending)return;if(m.id===this.openSite)this.close();else this.open(m.id);});
      this.markers.set(m.id,b);
    });
    if(!tree||!layout)return;
    const panel=el('section','rh-obra-janela',this.el);place(panel,layout.panel);panel.style.zIndex=String(plan.shown.length+2);
    panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`Obra: ${tree.head.name}`);
    panel.dataset.orientation=layout.orientation;
    const cards=cardsOf(tree),rects=[layout.head,...layout.branches];
    cards.forEach((c,i)=>this.card(panel,c,rects[i],i===0,layout.panel));
    const close=el('button','rh-obra-fechar',panel);close.type='button';place(close,layout.close,layout.panel);
    close.setAttribute('aria-label','Fechar');close.insertAdjacentHTML('beforeend',icon('fechar'));
    close.addEventListener('click',()=>this.close());
    const chosen=cards.find(c=>c.key===this.pick&&selectable(c));
    const ok=el('button','rh-obra-ok',panel);ok.type='button';place(ok,layout.confirm,layout.panel);
    // Watching: the tree reads as usual, the confirm stays off and says why.
    ok.disabled=!chosen||!!v.readOnly;
    const verb=v.readOnly?'Assistindo':!chosen?'Escolha':chosen.action?.type==='upgrade'?'Evoluir':'Construir';
    ok.innerHTML=`<span>${verb}</span>${chosen&&!v.readOnly?`${mat}<b>${chosen.cost}</b>`:''}`;
    ok.setAttribute('aria-label',v.readOnly?'Assistindo: só quem joga constrói':chosen?`${verb} ${chosen.name} por ${chosen.cost} de material`:'Escolha uma opção');
    ok.addEventListener('click',()=>{
      if(!chosen?.action||this.view?.readOnly)return;
      this.options.onConfirm(chosen.action);this.close();
    });
  }
  /**
   * Same DOM, new screen points: each marker moves to its planned box in the field of the last full render and takes
   * its new z-index. Nothing to do when no point moved. A site coming on or going off screen (or the hint's count
   * changing) rebuilds instead.
   */
  private move(v:ObraView){
    const points=[...v.sites.map(s=>({id:s.id,x:s.x,y:s.y})),...(v.rail?[{id:RAIL_SITE_ID,x:v.rail.x,y:v.rail.y}]:[])]
      .filter(p=>!this.openSite||p.id===this.openSite);
    const last=this.lastPoints;
    if(last.length===points.length*2&&points.every((p,i)=>last[2*i]===p.x&&last[2*i+1]===p.y))return;
    this.lastPoints=points.flatMap(p=>[p.x,p.y]);
    const plan=planMarkers(points,this.area!,{keep:this.openSite,hint:!this.openSite});
    if(shownKey(plan)!==this.shown){this.key='';this.render();return;}
    if(plan.hint&&this.hintEl)place(this.hintEl,plan.hint.rect);
    plan.shown.forEach((m,i)=>{
      const b=this.markers.get(m.id)!,z=String(i+1);place(b,m.rect);
      if(b.style.zIndex!==z)b.style.zIndex=z;
    });
  }
  private hint(h:NonNullable<MarkerPlan['hint']>){
    const tag=this.hintEl=el('div','rh-obra-fora',this.el);place(tag,h.rect);
    tag.textContent=`+${h.count} ${h.count===1?'obra':'obras'}`;
    tag.setAttribute('aria-label',`${h.count} ${h.count===1?'ponto de obra':'pontos de obra'} fora da vista`);
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
