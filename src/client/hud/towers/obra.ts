/**
 * Build menu in the intermission (torres-hud, D-041, D-009, D-020): mobile, touch only.
 * - The build sites show on the ground as 48 px markers at their screen points (clamped into the useful field); a site
 *   with a tower that can grow right now wears the Amarelo evolve arrow.
 * - A tap on a site opens the tree as a Janela: the head card (the Vigia to build, or what stands there) and its
 *   branches as etiquetas (suit sticker, name, price, one line). The price (D-048): "1 🗼" for the Vigia and "3 🗼" for
 *   the Gustavão (fichas de torre, the tower sticker), the rail "Grátis", an evolution "🗼⬆ R$ N" from my wallet (price.ts
 *   evolvePriceLabel). A blocked branch is dashed with a lock and its reason in words ("Falta 1 ficha", "Falta R$ 3",
 *   "Sem trilho"). The thumb confirms in the 48 px button at the bottom; an evolution in Grana reads only its price there
 *   ("🗼⬆ R$ N", spoken "Evoluir por N reais").
 * - Geometry comes from layout.ts (no scroll, clear of both thumbs and the hero); the view-model from model.ts.
 * Hidden outside the intermission. The host injects the view and gets the action: the sandbox, and the real match
 * (torres-ligar, explore.ts with wiring.ts: the view from the snapshot, build/upgrade to the room, the answer's stamp
 * or refusal). A sent request spins on its marker until the room answers; an accepted one stamps it (100 ms beat).
 * With `drawnInWorld` (the scene draws the towers) a built site's marker is only its suit and the evolve arrow.
 * Sites off screen (card E4-obras-visiveis-da-base): the 1–3 nearest get edge arrows (fichas like the caído's, with the
 * distance) laid out around the arrows already on the rim (layout.ts obraArrows). A tap opens that site's tree right
 * there, with no camera move: the open site's marker always shows (clamped to the field's edge, towards the site) and
 * the camera keeps following the hero, whose field the window already leaves free.
 */
import './obra.css';
import {icon} from '../../ui/icon.ts';
import {FREE_PRICE,evolvePriceLabel,fichasText,granaText,tokenPriceLabel,type PriceLabel} from '../price.ts';
import {tokensOf,unitsOf} from '../../../rules/index.ts';
import {computeZones,type ZoneInput,type Rect} from '../zones.ts';
import {layoutObra,obraArrows,planMarkers,type MarkerPlan,type ObraPoint} from './layout.ts';
import {arrowHalf,beakTransform,distanceText,type EdgeArrow} from '../edges.ts';
import {BRANCH_NAME,RAIL_SITE_ID,blockSpeech,blockText,canEvolve,cardsOf,defaultPick,selectable,towerSticker,treeFor,treeToOpen,type ObraAction,type ObraCard,type ObraTree,type ObraView} from './model.ts';

const SUIT:Record<'A'|'B'|'C'|'root'|'rail',string>={
  // Paus (people standing together), ouros (a blast), espadas (a beam); the root a plain guard post; the rail its sleepers.
  A:'<circle cx="12" cy="7" r="4.5"/><circle cx="6.8" cy="14" r="4.5"/><circle cx="17.2" cy="14" r="4.5"/><path d="M10.6 14h2.8l1.6 8H9z"/>',
  B:'<path d="M12 1.5 20 12 12 22.5 4 12z"/>',
  C:'<path d="M12 1.5C9 7 3.8 9.6 3.8 14.2a4.2 4.2 0 0 0 7.2 2.9L9.8 22h4.4L13 17.1a4.2 4.2 0 0 0 7.2-2.9C20.2 9.6 15 7 12 1.5z"/>',
  root:'<path d="M5 22V9l7-6 7 6v13h-5v-6h-4v6z"/>',
  rail:'<path d="M3 5h18v2.5H3zM3 16.5h18V19H3zM5 3h2.5v18H5zM10.75 3h2.5v18h-2.5zM16.5 3H19v18h-2.5z"/>',
};
const suitOf=(c:ObraCard)=>c.rail&&!c.label?'rail':c.branch??'root';
/** The card's face: the defense's imported sticker (ui/torre-<id>, ringed in its suit's colour), else the suit. */
const face=(key:string|undefined,n:keyof typeof SUIT)=>{
  const art=key?towerSticker(key):undefined;
  return art?`<img class="rh-obra-naipe rh-obra-adesivo" data-naipe="${n}" data-torre="${key}" src="${art}" alt="" aria-hidden="true" draggable="false" decoding="async">`:naipe(n);
};
const suit=(c:ObraCard)=>face(c.rail?undefined:c.key,suitOf(c));
const ARROW='<svg class="rh-obra-seta" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 21 12h-5.5v10h-7V12H3z"/></svg>';
/** A card's price: fichas for a build (the Vigia, the Gustavão), R$ for an evolution, free for the rail. */
const priceOf=(c:ObraCard):PriceLabel=>c.tokens!==undefined?tokenPriceLabel(c.tokens):c.grana!==undefined?evolvePriceLabel(c.grana):FREE_PRICE;
/** The price in a card's aria-label: "Grátis.", "Evoluir por 10 reais." (the phrase says it all), else "Custa 1 ficha de torre.". */
const priceSentence=(c:ObraCard)=>{const p=priceOf(c);return p===FREE_PRICE?'Grátis.':c.grana!==undefined?`${p.speech}.`:`Custa ${p.speech}.`;};

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
  /** The hero's box on screen (scene.heroScreenRect): the edge arrows of off-screen sites never cover it. */
  heroRect?:()=>Rect|undefined;
  /** The edge arrows the HUD drew this frame (EdgeArrows.shown): the obra arrows step aside from them (the base's ficha). */
  edgeArrows?:()=>readonly EdgeArrow[]|undefined;
}
/** One pooled edge arrow (a button): the site it opens, its parts and what it last wrote (no DOM write when unchanged). */
interface ArrowSlot {b:HTMLButtonElement;tip:HTMLElement;face:HTMLElement;num:HTMLElement;id?:string;last:Map<string,string>}
/** At most this many arrows (layout.ts OBRA_ARROWS): the pool's size. */
const ARROW_POOL=3;
/** An arrow key no frame produces: the next arrows() lays out (or hides) for sure. */
const STALE='!stale';

type Mark={id:string;x:number;y:number;kind:'vazio'|'torre'|'obra'|'trilho';evolve:boolean;label:string;branch?:string;head?:ObraCard;light:boolean;pending:boolean;done:boolean};
/** The markers a plan shows. */
const shownKey=(plan:MarkerPlan)=>plan.shown.map(m=>m.id).sort().join(',');
/** The view without the screen points and distances: what decides the DOM (those only move the markers and arrows). */
const shape=(v:ObraView)=>({...v,sites:v.sites.map(({x:_x,y:_y,distance:_d,...s})=>s),rail:v.rail&&{laid:v.rail.laid,ready:v.rail.ready}});
/** The sites (and the rail) at their screen points, with their distances from the hero. */
const pointsOf=(v:ObraView):ObraPoint[]=>[...v.sites.map(s=>({id:s.id,x:s.x,y:s.y,distance:s.distance})),
  ...(v.rail?[{id:RAIL_SITE_ID,x:v.rail.x,y:v.rail.y,distance:v.rail.distance}]:[])];
const rectKey=(r:Rect|undefined)=>r?`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`:'';
const put=(slot:ArrowSlot,key:string,value:string,write:(v:string)=>void)=>{if(slot.last.get(key)===value)return;slot.last.set(key,value);write(value);};
const naipe=(n:keyof typeof SUIT)=>`<svg class="rh-obra-naipe" data-naipe="${n}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SUIT[n]}</svg>`;

export class ObraHud {
  readonly el:HTMLDivElement;
  private view?:ObraView;
  private openSite?:string;
  private pick?:string;
  /** The last full render's key (shape, open site, pick, zones, text scale) and the field its markers were clamped into. */
  private key='';
  private area?:Rect;
  private readonly markers=new Map<string,HTMLButtonElement>();
  /** Which markers show at the last full render: a change there rebuilds (move() only moves). */
  private shown='';
  /** The edge arrows of the off-screen sites: a fixed pool kept across rebuilds (a tap never loses its button). */
  private readonly arrowLayer:HTMLDivElement;
  private readonly arrowSlots:ArrowSlot[]=[];
  /** The marks of the last full render by id (the arrows' stickers and labels). */
  private byId=new Map<string,Mark>();
  /** The sites off screen at the last plan (the arrows point at the nearest of them); none while the window is open. */
  private hidden:string[]=[];
  /** The on-screen markers' boxes at the last plan: the arrows keep off them (a tap there is the marker's). */
  private markerRects:Rect[]=[];
  /** Move the focus into the window at the next full render (a site was just opened). */
  private focusWindow=false;
  /** What the arrows were last laid out for (points, distances, hero, the HUD's arrows, field): unchanged, no layout. */
  private arrowKey=STALE;
  private windowOpen=false;
  /** The zone input of the last full render (the host caches it per layout: a new object means a new layout). */
  private lastInput?:ZoneInput;
  /** The screen points the markers were last placed for (x, y per point): unchanged, nothing moves. */
  private lastPoints:number[]=[];
  /** Sites whose accept stamp already played: while they stay in view.done a rebuild shows the stamp still (no beat). */
  private readonly stamped=new Set<string>();
  constructor(parent:HTMLElement,private readonly options:ObraHudOptions){
    this.el=el('div','rh-obra',parent);this.el.hidden=true;
    this.arrowLayer=el('div','rh-obra-bordas');
    for(let i=0;i<ARROW_POOL;i++){
      const b=el('button','rh-edge rh-obra-borda',this.arrowLayer);b.type='button';b.hidden=true;b.dataset.kind='obra';
      const tip=el('i','rh-edge-tip',b),face=el('span','rh-edge-face',b),num=el('b','rh-edge-num',b);
      const slot:ArrowSlot={b,tip,face,num,last:new Map()};
      // The tap opens that site's tree where it is (the open site's marker always shows, clamped into the field).
      b.addEventListener('click',()=>{if(slot.id)this.open(slot.id);});
      this.arrowSlots.push(slot);
    }
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
    const tree=treeToOpen(siteId,this.view);if(!tree)return;
    this.openSite=siteId;this.pick=defaultPick(tree);this.focusWindow=true;this.render();
  }
  close(){this.openSite=undefined;this.pick=undefined;this.render();}
  get isOpen(){return this.openSite!==undefined;}
  destroy(){this.el.remove();}

  /** The open site's tree (a pending one stays open, waiting: only a new open is refused). */
  private tree(siteId:string):ObraTree|undefined{
    const v=this.view;if(!v)return undefined;
    return treeToOpen(siteId,v.pending?.includes(siteId)?{...v,pending:[]}:v);
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
      if(!this.el.hidden||this.key){this.el.replaceChildren();this.el.hidden=true;this.markers.clear();this.key='';this.area=undefined;this.hideArrows();}
      return;
    }
    this.el.hidden=false;
    const input=this.options.zoneInput(),scale=textScale();
    // The match gives a revision (wiring.ts): no per-frame comparison of the whole view. The sandbox does not.
    const key=v.revision!==undefined?`${v.revision}|${this.openSite??''}|${this.pick??''}|${scale}`:JSON.stringify([shape(v),this.openSite??null,this.pick??null,input,scale]);
    if(key===this.key&&input===this.lastInput&&this.area){this.move(v);return;}
    // A rebuild drops the focused node (the arrow, the marker or the card just tapped): it goes to the window, so Escape
    // still closes it (the key listener is on this.el).
    const active=document.activeElement,hadFocus=!!active&&active!==this.el&&this.el.contains(active);
    this.key=key;this.lastInput=input;this.lastPoints=[];this.el.replaceChildren(this.arrowLayer);this.markers.clear();this.arrowKey=STALE;
    const layout=tree&&layoutObra(input,scale,tree.branches.length);
    // Closed: the markers live in the whole field (no window trims it).
    const area=this.area=layout?layout.zones.useful:computeZones(input).useful;
    // Markers: the sites on screen while the menu is closed (in the field without a window), only the open one while it
    // is open. Off-screen sites hide (no pile on the field's edge) and the nearest get edge arrows; crowded ones are nudged.
    const all=this.marks(v),byId=this.byId=new Map(all.map(m=>[m.id,m]));
    const marks=all.filter(m=>!layout||m.id===this.openSite);
    const plan=planMarkers(marks,area,{keep:this.openSite});
    this.shown=shownKey(plan);this.hidden=layout?[]:plan.hidden;this.markerRects=plan.shown.map(m=>m.rect);
    this.arrows(v,input.viewport,scale);
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
      b.insertAdjacentHTML('beforeend',`<span class="rh-obra-chao" aria-hidden="true">${m.head?suit(m.head):m.kind==='vazio'?naipe('root'):''}</span>`);
      if(m.evolve)b.insertAdjacentHTML('beforeend',`<span class="rh-obra-evoluir">${ARROW}</span>`);
      b.addEventListener('click',()=>{if(m.pending)return;if(m.id===this.openSite)this.close();else this.open(m.id);});
      this.markers.set(m.id,b);
    });
    if(!tree||!layout){this.focusWindow=false;return;}
    const panel=el('section','rh-obra-janela',this.el);place(panel,layout.panel);panel.style.zIndex=String(plan.shown.length+2);
    panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`Obra: ${tree.head.name}`);panel.tabIndex=-1;
    panel.dataset.orientation=layout.orientation;panel.dataset.forma=layout.form;
    // What pays here, where it is spent (hud-mobile-minimo: the phone's top shows no R$ nor fichas): my wallet
    // (carteira-e-pix) and the team's fichas, a small ficha riding the window's top edge, "R$ 120 · 2 [torre]"
    // (obra.css .rh-obra-carteira). Not a target.
    {const tokens=tokensOf(unitsOf(v.balance)),grana=granaText(v.grana);
      const wallet=el('span','rh-obra-carteira',panel);wallet.setAttribute('role','img');wallet.setAttribute('aria-label',`Você tem ${grana}; a turma tem ${fichasText(tokens)}`);
      wallet.innerHTML=`<b>${grana}</b><span class="rh-obra-carteira-fichas">${tokenPriceLabel(tokens).html}</span>`;}
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
    const price=chosen&&priceOf(chosen);
    // An evolution in Grana reads "🗼⬆ R$ N" (the sticker and the arrow are the verb); a build or the Gustavão keep the word.
    const bare=!!price&&!v.readOnly&&chosen?.grana!==undefined;
    ok.innerHTML=`${bare?'':`<span>${verb}</span>`}${price&&!v.readOnly?`<span class="rh-obra-preco">${price.html}</span>`:''}`;
    ok.setAttribute('aria-label',v.readOnly?'Assistindo: só quem joga constrói':chosen&&price?bare?`${price.speech}, ${chosen.name}`:`${verb} ${chosen.name}, ${price.speech}`:'Escolha uma opção');
    ok.addEventListener('click',()=>{
      if(!chosen?.action||this.view?.readOnly)return;
      this.options.onConfirm(chosen.action);this.close();
    });
    if(this.focusWindow||hadFocus){this.focusWindow=false;panel.focus({preventScroll:true});}
  }
  /**
   * Same DOM, new screen points: each marker moves to its planned box in the field of the last full render and takes
   * its new z-index. Nothing to do when no point moved. A site coming on or going off screen rebuilds instead. The
   * edge arrows are laid out again whenever their inputs changed (arrows()).
   */
  private move(v:ObraView){
    const points=pointsOf(v).filter(p=>!this.openSite||p.id===this.openSite);
    const last=this.lastPoints;
    if(!(last.length===points.length*2&&points.every((p,i)=>last[2*i]===p.x&&last[2*i+1]===p.y))){
      this.lastPoints=points.flatMap(p=>[p.x,p.y]);
      const plan=planMarkers(points,this.area!,{keep:this.openSite});
      if(shownKey(plan)!==this.shown){this.key='';this.render();return;}
      this.hidden=this.openSite?[]:plan.hidden;this.markerRects=plan.shown.map(m=>m.rect);
      plan.shown.forEach((m,i)=>{
        const b=this.markers.get(m.id)!,z=String(i+1);place(b,m.rect);
        if(b.style.zIndex!==z)b.style.zIndex=z;
      });
    }
    // The arrows also follow the distances, the hero and the HUD's own arrows (a key first: no layout when unchanged).
    this.arrows(v,this.lastInput!.viewport,textScale());
  }
  /**
   * The edge arrows of this frame: the nearest hidden sites on the rim around the HUD's arrows (layout.ts obraArrows),
   * written into the pool only where something changed. None while the window is open (`hidden` is empty then).
   */
  private arrows(v:ObraView,viewport:{width:number;height:number},scale:number){
    const hero=this.hidden.length?this.options.heroRect?.():undefined,placed=this.hidden.length?this.options.edgeArrows?.()??[]:[];
    const pts=this.hidden.length?pointsOf(v).filter(p=>this.hidden.includes(p.id)):[];
    const key=pts.length?`${pts.map(p=>`${p.id}:${Math.round(p.x)},${Math.round(p.y)},${p.distance===undefined?'':Math.round(p.distance)}`).join(';')}`
      +`|${rectKey(hero)}|${placed.map(a=>`${a.key}@${Math.round(a.x)},${Math.round(a.y)}`).join(';')}|${rectKey(this.area)}|${scale}|${this.markerRects.map(rectKey).join(';')}`:'';
    if(key===this.arrowKey)return;
    this.arrowKey=key;
    const laid=key?obraArrows(pts,this.hidden,this.area!,{hero,placed,viewport,scale,markers:this.markerRects}):[];
    const half=arrowHalf(scale),dist=new Map(pts.map(p=>[p.id,p.distance]));
    // Each site keeps the slot it had (no button swaps under a finger).
    const free=this.arrowSlots.filter(s=>!laid.some(a=>a.key===s.id));
    const slots=new Map(laid.map(a=>[a,this.arrowSlots.find(s=>s.id===a.key)??free.shift()!] as const)),used=new Set(slots.values());
    for(const s of this.arrowSlots)if(!used.has(s)&&!s.b.hidden){s.b.hidden=true;s.id=undefined;}
    for(const [a,slot] of slots)this.arrow(slot,a,half,dist.get(a.key));
  }
  private arrow(slot:ArrowSlot,a:EdgeArrow,half:{w:number;h:number},distance:number|undefined){
    const m=this.byId.get(a.key);
    slot.id=a.key;slot.b.hidden=false;
    put(slot,'site',a.key,v=>{slot.b.dataset.site=v;});
    put(slot,'at',`translate(${Math.round(a.x-half.w)}px,${Math.round(a.y-half.h)}px)`,v=>{slot.b.style.transform=v;});
    put(slot,'tip',beakTransform(a,half,''),v=>{slot.tip.style.transform=v;});
    put(slot,'side',a.side,v=>{slot.b.dataset.side=v;});
    put(slot,'face',m?.head?`${suitOf(m.head)}|${m.head.rail?'':m.head.key}`:m?.kind==='trilho'?'rail|':'root|',v=>{
      const [n,key]=v.split('|') as [keyof typeof SUIT,string];slot.face.innerHTML=face(key||undefined,n);});
    put(slot,'num',distance===undefined?'':distanceText(distance),v=>{slot.num.textContent=v;});
    put(slot,'pending',String(!!m?.pending),v=>{if(v==='true')slot.b.setAttribute('aria-disabled','true');else slot.b.removeAttribute('aria-disabled');});
    const where=distance===undefined?'fora da vista':`a ${Math.min(999,Math.max(0,Math.round(distance)))} metros`;
    put(slot,'label',`${m?.label??'Ponto de obra'}, ${where}. Toque para abrir`,v=>{slot.b.setAttribute('aria-label',v);});
  }
  private hideArrows(){this.arrowKey=STALE;this.hidden=[];for(const s of this.arrowSlots){s.b.hidden=true;s.id=undefined;}}

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
      :c.status==='buy'?`<span class="rh-obra-cost">${priceOf(c).html}</span>`:c.status==='obra'?`<span class="rh-obra-why rh-obra-tem">${why}</span>`:'';
    b.innerHTML=`${suit(c)}<span class="rh-obra-nome">${c.name}</span>${side}<span class="rh-obra-efeito">${c.effect}</span>`;
    const branch=c.branch&&!c.rail?`, ramo ${c.branch}: ${BRANCH_NAME[c.branch]}`:'';
    b.setAttribute('aria-label',`${c.name}${branch}. ${c.effect}. ${c.status==='buy'?priceSentence(c):''} ${c.block?blockSpeech(c):why}`.trim());
    b.addEventListener('click',()=>{if(!open)return;this.pick=c.key;this.render();});
  }
}
