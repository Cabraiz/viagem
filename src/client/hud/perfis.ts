/**
 * "Matches" (card nome-inimigo-rede-social, the user's option D of 25/10): an enemy the LOCAL hero killed may become a
 * match of a dating app, rarely (MATCH_CHANCE per eligible kill, MATCH_CAP per match, never the same kind twice).
 * During the match only a small flame under the gear counts them (a hop at each new one); a tap on it opens the last
 * match as a compact card (COMPACT_MS, or a tap), placed off the hero, the Uno, the allies and the mission band
 * (placeProfiles). The result screen shows them all as stickers, a little crooked ("Seus matches", fillResult): the
 * ChatGPT photo with its speech balloon, "Name, age", the pin and how far away it died, the bio and the ✕ / ♥ (just for
 * fun). Nothing updates per frame and the photos load only on the tap or on the result (the user's phone stuttered).
 * MatchBook and the formats are the pure part (tests/client/perfis.test.ts); createProfiles draws them.
 */
import type {SimEvent} from '../../contract/index.ts';
import {ROSTER} from '../../rules/index.ts';
import type {HudContext,HudPart} from './model.ts';
import {PERFIS_TEXTO,type PerfilTexto} from './perfis-texto.ts';

/** An eligible kill (the local hero's, a kind with a profile not matched yet, under the cap) becomes a match this often. */
export const MATCH_CHANCE=1/6;
/** At most this many matches in one match. */
export const MATCH_CAP=12;
/** World units to metres: the game's map already reads its units as metres (edges.ts distanceText, NEAR in metres). */
export const METROS_POR_UNIDADE=1;
/** The compact card (a tap on the flame) closes by itself after this long. */
export const COMPACT_MS=3000;
/** The result's stickers lean a random angle in ±TILT_DEG. */
export const TILT_DEG=4;

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

/** "a 12 m" under a kilometre (whole metres), "a 1,2 km" from there (one decimal, Brazilian comma). */
export function distanciaTexto(units:number):string{
  const m=Math.round(Math.max(0,units)*METROS_POR_UNIDADE);
  return m<1000?`a ${m} m`:`a ${(m/1000).toFixed(1).replace('.',',')} km`;
}

type KillEvent=Extract<SimEvent,{type:'kill'}>;
export interface Match {kind:string;
  /** World units between the hero and the enemy when it died. */
  distance:number;
  /** The sticker's lean on the result, degrees in ±TILT_DEG. */
  tilt:number}
/** The matches of one match: which kills count and the dice (rng injected for the tests). */
export class MatchBook {
  private list:Match[]=[];
  private readonly kinds=new Set<string>();
  constructor(private readonly has:(kind:string)=>boolean=kind=>!!perfilOf(kind),private readonly rng:()=>number=Math.random){}
  get matches():readonly Match[]{return this.list;}
  /** A kill: a new match, or undefined (someone else's kill, no profile, already matched, the cap, or the dice said no). */
  kill(e:Pick<KillEvent,'kind'|'by'|'x'|'y'>,localId:string,hero?:{x:number;y:number}):Match|undefined{
    if(!localId||e.by!==localId||!this.has(e.kind)||this.kinds.has(e.kind)||this.list.length>=MATCH_CAP)return undefined;
    if(this.rng()>=MATCH_CHANCE)return undefined;
    const match={kind:e.kind,distance:hero?Math.hypot(e.x-hero.x,e.y-hero.y):0,tilt:Math.round((this.rng()*2-1)*TILT_DEG*10)/10};
    this.kinds.add(e.kind);this.list.push(match);
    return match;
  }
  /** A match given as is (the HUD sandbox's scenes). */
  add(m:Match){this.kinds.add(m.kind);this.list.push(m);}
  reset(){this.list=[];this.kinds.clear();}
}

/** Clearance (CSS px) kept between the card and what it must not cover. */
export const GUARD_MARGIN_PX=12;
/** The card's size when no corner fits it whole: the same corners again at this scale, then no card. */
export const SMALL_SCALE=.72;
/** Gap (CSS px) between a moved card and the useful area's edge. */
const EDGE_PX=8;
/** Where the compact card goes (perfil-nao-cobre): offset from its CSS place and scale (transform-origin top left). */
export interface ProfilePlace {spot:'canto'|'esquerda'|'baixo'|'baixo-esquerda';dx:number;dy:number;scale:number}
type Box={x:number;y:number;width:number;height:number};
const hits=(a:Box,b:Box,m:number)=>a.x<b.x+b.width+m&&b.x-m<a.x+a.width&&a.y<b.y+b.height+m&&b.y-m<a.y+a.height;
/**
 * The first place whose box crosses none of `guards` (the hero, the Uno, the allies, the mission band): the CSS place
 * (`home`, under the flame), then the useful area's other corners (top left, bottom right, bottom left), then the same
 * at SMALL_SCALE; undefined when none fits (no card). `prefer` (the last place) is tried first, so the card does not
 * hop between corners while it still fits where it is.
 */
export function placeProfiles(home:Box,useful:Box,guards:readonly Box[],prefer?:ProfilePlace['spot'],margin=GUARD_MARGIN_PX):ProfilePlace|undefined{
  const spots:ProfilePlace['spot'][]=['canto','esquerda','baixo','baixo-esquerda'];
  if(prefer)spots.sort((a,b)=>(b===prefer?1:0)-(a===prefer?1:0));
  for(const scale of [1,SMALL_SCALE])for(const spot of spots){
    const w=home.width*scale,h=home.height*scale,right=spot==='canto'||spot==='baixo',low=spot==='baixo'||spot==='baixo-esquerda';
    const x=right?home.x+home.width-w:useful.x+EDGE_PX;
    const y=low?useful.y+useful.height-EDGE_PX-h:home.y;
    const box={x,y,width:w,height:h};
    if(!guards.some(g=>hits(box,g,margin)))return {spot,dx:x-home.x,dy:y-home.y,scale};
  }
  return undefined;
}

const el=<K extends keyof HTMLElementTagNameMap>(doc:Document,tag:K,className:string,parent?:HTMLElement)=>{
  const node=doc.createElement(tag);node.className=className;parent?.append(node);return node;
};
const hex=(n:number)=>`#${n.toString(16).padStart(6,'0')}`;
/** The map pin of the distance line (outline, as in the mockup). */
const PIN_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a7 7 0 0 0-7 7c0 5.2 7 12 7 12s7-6.8 7-12a7 7 0 0 0-7-7Z" fill="currentColor"/><circle cx="12" cy="9.5" r="2.6" fill="#fff"/></svg>';
/** The flame of the match counter (the app's logo-like fire, no brand): outer flame and its lighter core. */
const FOGO_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path class="rh-matches-fogo" d="M12.4 1.8c.6 3.3-1.2 5-2.9 6.8C7.8 10.4 6 12.3 6 15.3A6 6 0 0 0 12 21.5a6 6 0 0 0 6-6.2c0-2.5-1.2-4.3-2.3-5.6-.2 1.4-.9 2.4-2 2.9.7-3.8-.4-7.6-1.3-10.8Z"/><path class="rh-matches-miolo" d="M12.2 12.6c.2 1.6-.6 2.4-1.3 3.2-.5.6-.9 1.2-.9 2a2 2 0 0 0 2 2.1 2.2 2.2 0 0 0 2.2-2.3c0-1.4-.9-2.8-2-5Z"/></svg>';

/** One profile card (the compact one on the flame's tap, the stickers on the result); the photo loads when it is built. */
function profileCard(doc:Document,m:Match,className:string,onButton:(how:'passar'|'curtir',node:HTMLElement)=>void){
  const p=perfilOf(m.kind) as Perfil;
  const node=el(doc,'article',`rh-perfil ${className}`);node.dataset.kind=p.kind;node.style.setProperty('--perfil-cor',hex(p.accent));
  node.setAttribute('aria-label',`Match: ${p.name}, ${p.idade}`);
  const foto=el(doc,'div','rh-perfil-foto',node);
  const img=el(doc,'img','rh-perfil-img',foto);img.alt='';img.draggable=false;img.decoding='async';
  img.onload=()=>{node.dataset.foto='ok';};img.src=p.foto;if(img.complete&&img.naturalWidth>0)node.dataset.foto='ok';
  el(doc,'p','rh-perfil-balao',foto).textContent=p.recado;
  const info=el(doc,'div','rh-perfil-info',node);
  el(doc,'h3','rh-perfil-nome',info).textContent=`${p.name}, ${p.idade}`;
  const dist=el(doc,'p','rh-perfil-dist',info);dist.innerHTML=PIN_SVG;el(doc,'span','',dist).textContent=distanciaTexto(m.distance);
  el(doc,'p','rh-perfil-bio',info).textContent=p.bio;
  const buttons=el(doc,'div','rh-perfil-botoes',node);
  for(const how of ['passar','curtir'] as const){
    const b=el(doc,'button',`rh-perfil-${how}`,buttons);b.type='button';b.setAttribute('aria-label',how==='curtir'?'Curtir':'Passar');
    const pic=el(doc,'img','',b);pic.alt='';pic.draggable=false;pic.src=BOTAO_FOTO[how];
    for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)b.addEventListener(type,e=>e.stopPropagation());
    b.addEventListener('click',e=>{e.stopPropagation();onButton(how,node);});
  }
  el(doc,'span','rh-perfil-match',node).textContent='DEU MATCH!';
  return node;
}

export interface ProfilesOptions {
  /** Where the local hero stands (RunHud.setHero), for the distance at the kill. */
  hero():{x:number;y:number}|undefined;
  /** A window holds the screen (offer, pause, result): the flame hides and an open card closes. */
  blocked():boolean;
  now?():number;
  /** The dice (tests and the sandbox); Math.random by default. */
  rng?():number;
  /** No matches at all (the HUD sandbox's other scenes). */
  off?:boolean;
  /**
   * What the compact card and the flame must never cover (perfil-nao-cobre: the hero, the Uno, the allies, the mission
   * band) and the useful area whose corners the card may move to (zones.ts), CSS px; without them it stays in place.
   */
  guards?():readonly Box[]|undefined;
  useful?():Box|undefined;
}
export interface ProfilesPart extends HudPart {
  readonly book:MatchBook;
  /** The result's "Seus matches" (hidden with none); the photos load here. */
  fillResult(section:HTMLElement):void;
  /** A new match (rematch): no matches, no flame. */
  reset():void;
  /** The sandbox: matches without kills. */
  add(match:Match):void;
}

export function createProfiles(doc:Document,options:ProfilesOptions):ProfilesPart{
  const now=options.now??(()=>performance.now());
  const book=new MatchBook(undefined,options.rng);
  const root=el(doc,'div','rh-perfis');
  const flame=el(doc,'button','rh-matches',root);flame.type='button';flame.hidden=true;
  flame.innerHTML=FOGO_SVG;const count=el(doc,'span','rh-matches-n',flame);
  for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)flame.addEventListener(type,e=>e.stopPropagation());
  const live=el(doc,'p','rh-matches-aviso',root);live.setAttribute('role','status');live.setAttribute('aria-live','polite');
  const slot=el(doc,'div','rh-perfil-slot',root);
  let card:HTMLElement|undefined,openedAt=0,closeTimer:ReturnType<typeof setTimeout>|undefined,place:ProfilePlace|undefined,lastEvent=-1;
  const close=()=>{clearTimeout(closeTimer);closeTimer=undefined;card?.remove();card=undefined;place=undefined;slot.style.transform='';};
  /** Moves the open card off what it would cover (placeProfiles); no place: it closes. */
  const settle=()=>{
    if(!card&&flame.hidden)return;
    const parent=slot.offsetParent as HTMLElement|null,guards=options.guards?.(),useful=options.useful?.();
    const guardedFlame=!!guards&&!flame.hidden&&guards.some(g=>{const r=flame.getBoundingClientRect();return hits({x:r.left,y:r.top,width:r.width,height:r.height},g,0);});
    flame.classList.toggle('rh-matches-veu',guardedFlame);
    if(!card||!parent||!guards||!useful)return;
    const p=parent.getBoundingClientRect(),home={x:p.left+slot.offsetLeft,y:p.top+slot.offsetTop,width:slot.offsetWidth,height:card.offsetHeight};
    place=placeProfiles(home,useful,guards,place?.spot);
    if(!place){close();return;}
    const transform=place.dx||place.dy||place.scale!==1?`translate(${Math.round(place.dx)}px,${Math.round(place.dy)}px) scale(${place.scale})`:'';
    if(slot.style.transform!==transform)slot.style.transform=transform;
  };
  const open=()=>{
    const last=book.matches.at(-1);if(!last)return;
    close();
    card=profileCard(doc,last,'rh-perfil-compacto',(how,node)=>{
      if(how==='curtir'){node.dataset.sai='curtir';closeTimer=setTimeout(close,700);}else close();
    });
    card.addEventListener('click',close);
    slot.append(card);openedAt=now();
    void card.offsetWidth;card.classList.add('rh-perfil-in');
    settle();
  };
  flame.addEventListener('click',e=>{e.stopPropagation();if(card)close();else open();});
  const paintCount=()=>{
    const n=book.matches.length;flame.hidden=n===0;count.textContent=String(n);
    flame.setAttribute('aria-label',`${n} ${n===1?'match':'matches'}: ver o último`);
  };
  const hop=(m:Match)=>{
    paintCount();
    flame.classList.remove('rh-matches-pulo');void flame.offsetWidth;flame.classList.add('rh-matches-pulo');
    live.textContent=`Deu match com ${perfilOf(m.kind)?.name??m.kind}`;
  };
  return {
    el:root,book,
    update(view,ctx:HudContext){
      if(options.off)return;
      for(const e of view.events??[]){
        if(e.eventId<=lastEvent)continue;
        lastEvent=e.eventId;
        if(e.type!=='kill')continue;
        const m=book.kill(e,ctx.localId,options.hero());
        if(m)hop(m);
      }
      const blocked=options.blocked();
      root.classList.toggle('rh-perfis-espera',blocked);
      if(blocked||(card&&now()-openedAt>=COMPACT_MS))close();
      settle();
    },
    fillResult(section){
      section.replaceChildren();
      const list=book.matches;section.hidden=list.length===0;
      if(!list.length)return;
      el(doc,'h3','rh-result-matches-titulo',section).textContent=list.length===1?'Seu match':`Seus ${list.length} matches`;
      const row=el(doc,'div','rh-result-matches-lista',section);
      for(const m of list){
        const node=profileCard(doc,m,'rh-perfil-figurinha',(how,n)=>{n.dataset.sai=n.dataset.sai===how?'':how;});
        node.style.setProperty('--tilt',`${m.tilt}deg`);row.append(node);
      }
    },
    reset(){book.reset();close();paintCount();flame.classList.remove('rh-matches-pulo');lastEvent=-1;},
    add(m){book.add(m);hop(m);},
    destroy(){close();root.remove();},
  };
}
