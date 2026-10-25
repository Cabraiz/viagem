/**
 * "Inimigo novo" as a dating-app profile (card nome-inimigo-rede-social): the first time a kind with a profile comes
 * near the hero (NEAR_M; the boss from anywhere), its card opens in the top band's right corner for PROFILE_MS, laid out
 * as the mockup the user chose (evidence etapa1 opção 8): the ChatGPT photo with its speech balloon, "Name, age", the
 * pin and how far it is, the bio, and the ✕ / ♥ buttons (ChatGPT pictures made from that mockup). The match never pauses. Several new kinds in a row pile up as a FAN, like
 * cards in a hand (at most FAN_MAX; the rest wait their turn). ✕ throws the card away, ✓ stamps "DEU MATCH" first.
 * Each kind shows once per phone (PERFIS_KEY in localStorage; this page's memory when storage is off). While a window
 * holds the screen (level-up offer, pause, result) the fan hides and its clock stands still.
 * ProfileDeck is the pure part (tests/client/perfis.test.ts); createProfiles draws it.
 */
import type {EnemyView} from '../../contract/index.ts';
import {ROSTER} from '../../rules/index.ts';
import {distanceText} from './edges.ts';
import type {HudContext,HudPart} from './model.ts';
import {PERFIS_TEXTO,type PerfilTexto} from './perfis-texto.ts';

export const PROFILE_MS=3000;
export const FAN_MAX=3;
/** A kind this close to the hero (m) gets its card; farther ones only load their photo. */
export const NEAR_M=14;
/** ✓: the "DEU MATCH" stamp stays this long before the card leaves; ✕ and the clock: the way out. */
export const MATCH_MS=700;
export const LEAVE_MS=320;
export const PERFIS_KEY='viagem:perfis-vistos';

export interface Perfil extends PerfilTexto {kind:string;name:string;foto:string;accent:number}
const NAMES=new Map(ROSTER.map(entry=>[entry.id,entry] as const));
export const perfilFoto=(kind:string)=>`/art/perfis/${kind}.webp`;
export const BOTAO_FOTO={curtir:'/art/perfis/botao-curtir.webp',passar:'/art/perfis/botao-passar.webp'} as const;
/** The profile of a kind, or undefined when it has no photo/text yet (later batches). */
export function perfilOf(kind:string):Perfil|undefined{
  const text=PERFIS_TEXTO[kind],entry=NAMES.get(kind);
  if(!text||!entry)return undefined;
  return {...text,kind,name:entry.name,foto:perfilFoto(kind),accent:entry.accent};
}

type Store=Pick<Storage,'getItem'|'setItem'>;
const sessionSeen=new Set<string>();
const defaultStore=():Store|undefined=>{try{return globalThis.localStorage;}catch{return undefined;}};
/** Kinds whose card this phone already showed (stored and this page's memory). Never throws. */
export function loadSeen(storage:Store|undefined=defaultStore()):Set<string>{
  const seen=new Set(sessionSeen);
  try{const raw=storage?.getItem(PERFIS_KEY),list=raw?JSON.parse(raw):[];if(Array.isArray(list))for(const k of list)if(typeof k==='string')seen.add(k);}
  catch{/* private tab or broken value */}
  return seen;
}
export function saveSeen(seen:ReadonlySet<string>,storage:Store|undefined=defaultStore()){
  for(const k of seen)sessionSeen.add(k);
  try{storage?.setItem(PERFIS_KEY,JSON.stringify([...seen]));}catch{/* memory only */}
}

export type Leave='tempo'|'passar'|'curtir';
export interface DeckCard {id:number;kind:string;
  /** Visible time so far (ms; it stands still while blocked). */
  shownMs:number;
  /** Metres to the nearest of its kind, while one is in the view. */
  distance?:number;
  leaving?:Leave;leftMs?:number}
export interface DeckInput {enemies:readonly Pick<EnemyView,'kind'|'x'|'y'|'asleep'|'boss'>[];hero?:{x:number;y:number}}
export interface DeckStep {
  /** Cards on screen, newest first (fan index 0 = in front). */
  cards:readonly DeckCard[];
  /** Kinds seen in the view for the first time that will want a card: load their photos now. */
  spotted:readonly string[];
}

export class ProfileDeck {
  private readonly seen:Set<string>;
  private readonly pending:string[]=[];
  private readonly spottedKinds=new Set<string>();
  private cards:DeckCard[]=[];
  private last?:number;
  private nextId=1;
  private readonly has:(kind:string)=>boolean;
  private readonly onSeen:(seen:ReadonlySet<string>)=>void;
  constructor(has:(kind:string)=>boolean,seen:Iterable<string>=[],onSeen:(seen:ReadonlySet<string>)=>void=()=>{}){
    this.has=has;this.onSeen=onSeen;this.seen=new Set(seen);
  }
  get shown(){return this.cards;}
  /** ✕ or ✓ on a card: it leaves now (✓ after its stamp). */
  dismiss(id:number,how:Exclude<Leave,'tempo'>){
    const card=this.cards.find(c=>c.id===id);
    if(card&&!card.leaving){card.leaving=how;card.leftMs=0;}
  }
  step(input:DeckInput,now:number,blocked=false):DeckStep{
    const dt=this.last===undefined?0:Math.max(0,now-this.last);this.last=now;
    const spotted:string[]=[],nearest=new Map<string,number>();
    for(const e of input.enemies){
      if(e.asleep||!this.has(e.kind))continue;
      const d=input.hero?Math.hypot(e.x-input.hero.x,e.y-input.hero.y):0;
      const prev=nearest.get(e.kind);
      if(input.hero&&(prev===undefined||d<prev))nearest.set(e.kind,d);
      if(this.seen.has(e.kind)||this.pending.includes(e.kind))continue;
      if(!this.spottedKinds.has(e.kind)){this.spottedKinds.add(e.kind);spotted.push(e.kind);}
      if(e.boss||!input.hero||d<=NEAR_M)this.pending.push(e.kind);
    }
    if(!blocked){
      for(const card of this.cards){
        if(card.leaving){card.leftMs=(card.leftMs??0)+dt;continue;}
        card.shownMs+=dt;
        if(card.shownMs>=PROFILE_MS){card.leaving='tempo';card.leftMs=0;}
      }
      this.cards=this.cards.filter(c=>!c.leaving||(c.leftMs??0)<(c.leaving==='curtir'?MATCH_MS+LEAVE_MS:LEAVE_MS));
      let added=false;
      while(this.pending.length&&this.cards.filter(c=>!c.leaving).length<FAN_MAX){
        const kind=this.pending.shift() as string;
        if(this.seen.has(kind))continue;
        this.seen.add(kind);added=true;
        this.cards.unshift({id:this.nextId++,kind,shownMs:0});
      }
      if(added)this.onSeen(this.seen);
    }
    for(const card of this.cards){const d=nearest.get(card.kind);if(d===undefined)delete card.distance;else card.distance=d;}
    return {cards:this.cards,spotted};
  }
}

/** The fan: card `index` (0 = newest, in front) of `count` staying cards, turned left around its bottom like a hand of cards. */
export function fanPose(index:number,count:number){
  if(count<=1||index<=0)return {rot:0,x:0,y:0};
  return {rot:-9*index,x:-14*index,y:4*index};
}

const el=<K extends keyof HTMLElementTagNameMap>(doc:Document,tag:K,className:string,parent?:HTMLElement)=>{
  const node=doc.createElement(tag);node.className=className;parent?.append(node);return node;
};
const hex=(n:number)=>`#${n.toString(16).padStart(6,'0')}`;
/** The map pin of the distance line (outline, as in the mockup). */
const PIN_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a7 7 0 0 0-7 7c0 5.2 7 12 7 12s7-6.8 7-12a7 7 0 0 0-7-7Z" fill="currentColor"/><circle cx="12" cy="9.5" r="2.6" fill="#fff"/></svg>';

export interface ProfilesOptions {
  /** Where the local hero stands (RunHud.setHero), for the distance; undefined: every kind counts as near. */
  hero():{x:number;y:number}|undefined;
  /** A window holds the screen (offer, pause, result): the fan hides and its clock stands still. */
  blocked():boolean;
  now?():number;
  storage?:Store;
  /** No cards at all (the HUD sandbox's other scenes: their prints never change with what the browser met before). */
  off?:boolean;
}
export interface ProfilesPart extends HudPart {readonly deck:ProfileDeck}

export function createProfiles(doc:Document,options:ProfilesOptions):ProfilesPart{
  const now=options.now??(()=>performance.now());
  const storage=options.storage??defaultStore();
  const deck=new ProfileDeck(kind=>!!perfilOf(kind),loadSeen(storage),seen=>saveSeen(seen,storage));
  const root=el(doc,'div','rh-perfis');root.setAttribute('role','status');root.setAttribute('aria-live','polite');root.hidden=true;
  const nodes=new Map<number,HTMLElement>();
  const preload=new Map<string,HTMLImageElement>();
  const load=(src:string)=>{let img=preload.get(src);if(!img&&typeof Image!=='undefined'){img=new Image();img.decoding='async';img.src=src;preload.set(src,img);}return img;};
  const build=(card:DeckCard)=>{
    const p=perfilOf(card.kind) as Perfil;
    const node=el(doc,'article','rh-perfil');node.dataset.kind=p.kind;node.style.setProperty('--perfil-cor',hex(p.accent));
    node.setAttribute('aria-label',`Perfil: ${p.name}, ${p.idade}`);
    const foto=el(doc,'div','rh-perfil-foto',node);
    const img=el(doc,'img','rh-perfil-img',foto);img.alt='';img.draggable=false;img.decoding='async';
    const ready=()=>{node.dataset.foto='ok';};
    img.onload=ready;img.src=p.foto;if(img.complete&&img.naturalWidth>0)ready();
    el(doc,'p','rh-perfil-balao',foto).textContent=p.recado;
    const info=el(doc,'div','rh-perfil-info',node);
    el(doc,'h3','rh-perfil-nome',info).textContent=`${p.name}, ${p.idade}`;
    const dist=el(doc,'p','rh-perfil-dist',info);dist.innerHTML=PIN_SVG;el(doc,'span','',dist);
    el(doc,'p','rh-perfil-bio',info).textContent=p.bio;
    const buttons=el(doc,'div','rh-perfil-botoes',node);
    for(const how of ['passar','curtir'] as const){
      const b=el(doc,'button',`rh-perfil-${how}`,buttons);b.type='button';b.setAttribute('aria-label',how==='curtir'?'Curtir':'Passar');
      const pic=el(doc,'img','',b);pic.alt='';pic.draggable=false;pic.src=BOTAO_FOTO[how];
      for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)b.addEventListener(type,e=>e.stopPropagation());
      b.addEventListener('click',e=>{e.stopPropagation();deck.dismiss(card.id,how);paint();});
    }
    el(doc,'span','rh-perfil-match',node).textContent='DEU MATCH!';
    return node;
  };
  let lastCards:readonly DeckCard[]=[];
  const paint=()=>{
    const cards=lastCards,live=new Set<number>();
    const staying=cards.filter(c=>!c.leaving);
    for(const card of cards){
      live.add(card.id);
      let node=nodes.get(card.id);
      if(!node){node=build(card);nodes.set(card.id,node);root.prepend(node);void node.offsetWidth;node.classList.add('rh-perfil-in');}
      const i=staying.indexOf(card),pose=fanPose(Math.max(0,i),staying.length);
      node.style.setProperty('--fan-rot',`${pose.rot}deg`);node.style.setProperty('--fan-x',`${pose.x}px`);node.style.setProperty('--fan-y',`${pose.y}px`);
      node.style.zIndex=String(i<0?FAN_MAX+1:FAN_MAX-i);
      if(card.leaving&&node.dataset.sai!==card.leaving)node.dataset.sai=card.leaving;
      if(card.leaving==='curtir'&&(card.leftMs??0)>=MATCH_MS)node.dataset.saindo='1';
      const dist=node.querySelector('.rh-perfil-dist span') as HTMLElement;
      const text=card.distance===undefined?'por perto':`a ${distanceText(card.distance)} de você`;
      if(dist.textContent!==text)dist.textContent=text;
    }
    for(const [id,node] of nodes)if(!live.has(id)){node.remove();nodes.delete(id);}
    root.hidden=cards.length===0;
  };
  return {
    el:root,deck,
    update(view,_ctx:HudContext){
      if(options.off)return;
      const blocked=options.blocked();
      const step=deck.step({enemies:view.enemies,hero:options.hero()},now(),blocked);
      for(const kind of step.spotted){const p=perfilOf(kind);if(p)load(p.foto);}
      lastCards=step.cards;
      root.classList.toggle('rh-perfis-espera',blocked);
      paint();
    },
    destroy(){root.remove();nodes.clear();},
  };
}
