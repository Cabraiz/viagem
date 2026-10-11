/**
 * Edge arrows (NEW-20261009-UX-bordas-fora-da-tela, D-019): what matters and left the screen gets an arrow on the
 * inner rim of the useful area (UX-zonas-tela), never on the screen edge, so it never lands on the HUD, the thumbs or
 * the team strip. Each arrow is a ficha (Breu body, Papel edge) with a sticker and the distance; a beak points at the
 * target. Priority when it fills up: caído > chefe > spawn > base (> aliado > baú, which the game leaves to the minimap,
 * design onda 6 D4), at most MAX_ARROWS; arrows that would overlap step aside, and what does not fit joins a "+N". An arrow never covers the hero (± HERO_MARGIN): it slides along
 * its side out of the way. Pure layout (node tests) plus a small DOM part with a fixed pool of elements.
 */
import {crosses,HERO_MARGIN,type Rect} from './zones.ts';
import {edgeOf} from '../framing.ts';
import {icon,type IconName} from '../../ui/icon.ts';
import {secondsText} from './model.ts';

export interface Point {x:number;y:number}
export type EdgeKind='caido'|'chefe'|'spawn'|'base'|'aliado'|'bau';
/** Lower is more urgent (UX card: caído > chefe > spawn > aliado; base and baú are the Stonewards and loot extras). */
export const EDGE_PRIORITY:Readonly<Record<EdgeKind,number>>={caido:0,chefe:1,spawn:2,base:3,aliado:4,bau:5};
export const EDGE_ICON:Readonly<Record<EdgeKind,IconName|undefined>>={caido:'boia',chefe:'chefe',spawn:'onda',base:'base',aliado:undefined,bau:'bau'};
/** At most this many arrows on screen (UX card). */
export const MAX_ARROWS=6;
/** Arrows closer than this (CSS px) step aside along their side; when no spot is left they become one ("+N"). */
export const MERGE_PX=52;
/** Gap (CSS px) between an arrow ficha and the useful area's edge. */
export const RIM_PAD=8;
/** Extra gap (CSS px) past the hero's keep-out when an arrow slides out of its way. */
export const SLIDE_SLACK=8;
/** Room a caído's tag takes above (or below) its ficha, so stacked arrows never cover the seconds. */
export const TAG_ROOM=16;

export interface EdgeTarget {
  /** Stable id (player id, 'base', enemy id, 'spawn:<tick>'), so a DOM arrow keeps following the same target. */
  key:string;kind:EdgeKind;
  /** Where the target is on screen (CSS px, viewport coordinates), possibly far outside it. */
  screen:Point;
  /** World distance from the followed hero, in units (1 u ≈ 1 m on the ficha). */
  distance:number;
  /** Caído: seconds left before bleeding out. */
  seconds?:number;
  /** Caído: a "Me salva" ping is lit (UX-resgate-e-ping). */
  ping?:boolean;
  /** Chefe: a telegraph is about to go off; caído: being rescued is not danger. */
  danger?:boolean;
  /** Aliado and caído: portrait for the face (pessoa = círculo). */
  portrait?:string;
  /** Short name for screen readers. */
  name?:string;
}
export type Side='top'|'bottom'|'left'|'right';
export interface EdgeArrow extends EdgeTarget {
  /** Centre of the ficha (CSS px, viewport). */
  x:number;y:number;
  /** Where the beak points: radians on screen, 0 = right, y down. */
  angle:number;side:Side;
  /** Targets merged into this arrow (1 = only itself). */
  count:number;
  /** A lit ping squeezed next to the hero: the tag shows only the seconds (the ping ring stays on the ficha). */
  compact?:boolean;
  /** Which edge of the ficha the caído's tag hangs from (right: it grows leftwards, on the area's right half). */
  tagEnd:'left'|'right';
}
export interface EdgeOptions {half?:{w:number;h:number};max?:number;merge?:number;margin?:number;
  /**
   * What the player actually sees: the viewport minus the HUD boxes over it (top band, team strip, thumbs, minimap).
   * A target there needs no arrow (it is on screen, with its own world ficha); one under the HUD or off the viewport
   * gets one. Without it, anything outside the useful area gets an arrow.
   */
  seen?:{viewport:Rect;covered:readonly (Rect|undefined)[];inset?:number}}
/** Whether a target's screen point is in plain view (see EdgeOptions.seen). */
export function inView(p:Point,seen:NonNullable<EdgeOptions['seen']>){
  const v=seen.viewport,i=seen.inset??12;
  if(p.x<v.x+i||p.y<v.y+i||p.x>v.x+v.width-i||p.y>v.y+v.height-i)return false;
  return !seen.covered.some(r=>!!r&&p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height);
}
/** Half size of an arrow ficha at a text scale (100% or 125%): the CSS uses the same numbers. */
export const arrowHalf=(scale=1)=>({w:(44+32*scale)/2,h:18});

const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

/**
 * The arrows for the targets outside `area` (the useful area, viewport CSS px). `hero` is the hero's box on screen:
 * no arrow crosses it ± margin.
 */
export function layoutEdges(targets:readonly EdgeTarget[],area:Rect,hero?:Rect,options:EdgeOptions={}):EdgeArrow[]{
  const half=options.half??arrowHalf(),max=options.max??MAX_ARROWS,merge=options.merge??MERGE_PX,margin=options.margin??HERO_MARGIN;
  if(area.width<=0||area.height<=0)return [];
  // The ficha's centre runs on the rim shrunk by its half size, so the whole ficha stays inside the useful area.
  // (plus RIM_PAD, so the ficha, its beak and its tag do not touch the HUD beyond the area's edge).
  // The caído's tag and the "+N" ride TAG_ROOM above the ficha: that room is kept inside the area too.
  const hw=Math.min(half.w+RIM_PAD,area.width/2),hh=Math.min(half.h+RIM_PAD,area.height/2),top=Math.min(TAG_ROOM,Math.max(0,area.height-2*hh));
  const inner={x:area.x+hw,y:area.y+hh+top,width:Math.max(0,area.width-2*hw),height:Math.max(0,area.height-2*hh-top)};
  const sorted=[...targets].filter(t=>Number.isFinite(t.screen.x)&&Number.isFinite(t.screen.y)&&!edgeOf(t.screen,area).inside&&!(options.seen&&inView(t.screen,options.seen)))
    .sort((a,b)=>EDGE_PRIORITY[a.kind]-EDGE_PRIORITY[b.kind]||a.distance-b.distance||(a.key<b.key?-1:1));
  const out:EdgeArrow[]=[];
  // The hero keep-out counts the caído's tag too (it rides above the ficha and can be wider: "Me salva: 24 s").
  const scale=Math.max(1,(2*half.w-44)/32);
  let current:EdgeTarget|undefined,compact=false;
  // On the right half of the area the tag grows leftwards, so a wide one never leaves the area.
  const tagFromRight=(x:number)=>x>area.x+area.width/2;
  const box=(x:number,y:number):Rect=>{
    const tag=current?.kind==='caido'?caidoTag({...current,compact}):'';
    if(!tag)return {x:x-half.w,y:y-half.h,width:2*half.w,height:2*half.h};
    const w=Math.max(2*half.w,tagWidth(tag,scale)),left=tagFromRight(x)?x+half.w+4-w:x-half.w-4;
    return {x:left,y:y-half.h-TAG_ROOM,width:w+4,height:2*half.h+TAG_ROOM};
  };
  const clear=(x:number,y:number)=>!hero||!crosses(box(x,y),hero,margin);
  const onRim=(x:number,y:number)=>x>=inner.x-.5&&x<=inner.x+inner.width+.5&&y>=inner.y-.5&&y<=inner.y+inner.height+.5;
  const crowded=(x:number,y:number)=>out.find(a=>Math.abs(a.x-x)<2*half.w+4&&Math.abs(a.y-y)<2*half.h+TAG_ROOM&&Math.hypot(a.x-x,a.y-y)<Math.max(merge,2*half.w+4));
  for(const t of sorted){
    const e=edgeOf(t.screen,inner);
    let x=e.edge.x,y=e.edge.y;
    const side=sideOf(x,y,inner),along=side==='top'||side==='bottom';
    current=t;compact=false;
    if(!clear(x,y)){
      // Slide along the side, to whichever end of the hero's keep-out is nearer and still on the rim.
      // A few px past the keep-out, so a camera that eases by a pixel does not put the arrow back over the hero.
      // Measured from the whole box (ficha + tag), whose sides are not symmetric around the arrow's centre.
      const b=box(x,y),k=margin+SLIDE_SLACK,ends=along?[hero!.x-k-(b.x+b.width-x),hero!.x+hero!.width+k+(x-b.x)]:[hero!.y-k-(b.y+b.height-y),hero!.y+hero!.height+k+(y-b.y)];
      const options=ends.filter(v=>along?onRim(v,y):onRim(x,v)).map(v=>along?{x:v,y}:{x,y:v});
      // No room on its own side (a short area, a wide tag): the nearest corner of the rim that is clear. A caído's arrow
      // must never vanish because the hero stands in the way (UX onda 6).
      const corners=[{x:inner.x,y:inner.y},{x:inner.x+inner.width,y:inner.y},{x:inner.x,y:inner.y+inner.height},{x:inner.x+inner.width,y:inner.y+inner.height}];
      const spot=[...options.sort((p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y)),...corners.sort((p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y))]
        .find(p=>clear(p.x,p.y));
      let found=spot;
      // Still no room: the lit ping keeps only its clock ("27 s", as wide as the ficha) and the arrow keeps its ring.
      if(!found&&t.kind==='caido'&&t.ping){compact=true;found=[...options,...corners].find(p=>clear(p.x,p.y));}
      if(!found)continue;
      x=found.x;y=found.y;
    }
    // Another arrow already there: step along the side to the nearest free spot; merge ("+1") only when none is left.
    if(crowded(x,y)){
      const step=along?Math.max(2*half.w,box(x,y).width)+6:2*half.h+TAG_ROOM+2;let placed=false;
      for(let k=1;k<=3&&!placed;k++)for(const sign of [1,-1]){
        const nx=along?x+sign*k*step:x,ny=along?y:y+sign*k*step;
        if(onRim(nx,ny)&&clear(nx,ny)&&!crowded(nx,ny)){x=nx;y=ny;placed=true;break;}
      }
      if(!placed){crowded(x,y)!.count++;continue;}
    }
    // Past the limit, the target still counts: it joins the nearest arrow's "+N" (same side first).
    if(out.length>=max){out.reduce((best,a)=>(a.side===side?0:1e6)+Math.hypot(a.x-x,a.y-y)<(best.side===side?0:1e6)+Math.hypot(best.x-x,best.y-y)?a:best).count++;continue;}
    out.push({...t,...(compact?{compact}:{}),x,y,side,count:1,tagEnd:tagFromRight(x)?'right':'left',angle:Math.atan2(t.screen.y-y,t.screen.x-x)});
  }
  return out;
}

function sideOf(x:number,y:number,r:Rect):Side{
  const d=[[Math.abs(y-r.y),'top'],[Math.abs(y-(r.y+r.height)),'bottom'],[Math.abs(x-r.x),'left'],[Math.abs(x-(r.x+r.width)),'right']] as const;
  return d.reduce((a,b)=>b[0]<a[0]?b:a)[1];
}

/** Distance on the ficha: whole metres, capped so the ficha never grows ("999 m"). */
export const distanceText=(units:number)=>`${Math.min(999,Math.max(0,Math.round(units)))} m`;
/** The caído's tag: the seconds left, always (the most urgent number never hides); a lit ping adds "Me salva:" before them. */
export const caidoTag=(a:Pick<EdgeTarget,'seconds'|'ping'>&{compact?:boolean})=>{
  const s=a.seconds!==undefined?secondsText(a.seconds):'';
  return a.ping&&!(a.compact&&s)?(s?`Me salva: ${s}`:'Me salva'):s;
};
/** Width (CSS px) of a caído's tag at a text scale: M PLUS 800 at 13 px ≈ 0.62 em per character, plus its padding. */
export const tagWidth=(text:string,scale=1)=>Math.ceil(text.length*13*.62*scale+12);
/** Where the beak sits: on the ficha's border along the pointing direction (radius from the centre, CSS px). */
export function beakRadius(angle:number,half:{w:number;h:number}){
  const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  return Math.min(c>1e-6?half.w/c:Infinity,s>1e-6?half.h/s:Infinity);
}

// ---------- DOM (browser only) ----------
interface Slot {el:HTMLElement;face:HTMLElement;num:HTMLElement;tag:HTMLElement;count:HTMLElement;tip:HTMLElement;key:string;last:Map<string,string>}
const put=(slot:Slot,key:string,value:string,write:(v:string)=>void)=>{if(slot.last.get(key)===value)return;slot.last.set(key,value);write(value);};

/** The pool of arrow fichas inside the HUD root (read-only overlay: no pointer events, aria-hidden). */
export class EdgeArrows {
  readonly el:HTMLElement;
  private readonly slots:Slot[]=[];
  constructor(parent:HTMLElement){
    this.el=document.createElement('div');this.el.className='rh-edges';this.el.setAttribute('aria-hidden','true');
    for(let i=0;i<MAX_ARROWS;i++){
      const el=document.createElement('div');el.className='rh-edge';el.hidden=true;
      const tip=document.createElement('i');tip.className='rh-edge-tip';
      const face=document.createElement('span');face.className='rh-edge-face';
      const num=document.createElement('b');num.className='rh-edge-num';
      const tag=document.createElement('span');tag.className='rh-edge-tag';tag.hidden=true;
      const count=document.createElement('span');count.className='rh-edge-count';count.hidden=true;
      el.append(tip,face,num,tag,count);this.el.append(el);
      this.slots.push({el,face,num,tag,count,tip,key:'',last:new Map()});
    }
    parent.append(this.el);
    // The text scale (100/125%, <html data-texto>) is read once and again only when the layout can have changed.
    addEventListener('resize',this.invalidate);
    if(typeof MutationObserver!=='undefined'){this.observer=new MutationObserver(this.invalidate);this.observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-texto']});}
  }
  private scaleCache?:number;
  private observer?:MutationObserver;
  readonly invalidate=()=>{this.scaleCache=undefined;};
  /** Text scale of the page (100% or 125%), for the layout's half size; cached until a resize or a text-size change. */
  scale(){return this.scaleCache??=parseFloat(getComputedStyle(this.el).getPropertyValue('--t-escala'))||1;}
  render(arrows:readonly EdgeArrow[],half=arrowHalf(this.scale())){
    // Keep each target in the slot it had, so a ping's one-shot bump does not jump to another arrow.
    const free=this.slots.filter(s=>!arrows.some(a=>a.key===s.key));
    const assigned=new Map<EdgeArrow,Slot>();
    for(const a of arrows){const own=this.slots.find(s=>s.key===a.key);assigned.set(a,own??free.shift()!);}
    for(const slot of this.slots)if(![...assigned.values()].includes(slot)){if(!slot.el.hidden){slot.el.hidden=true;slot.key='';}}
    for(const [a,slot] of assigned){
      if(!slot)continue;
      slot.key=a.key;slot.el.hidden=false;
      put(slot,'at',`translate(${Math.round(a.x-half.w)}px,${Math.round(a.y-half.h)}px)`,v=>{slot.el.style.transform=v;});
      put(slot,'tip',`rotate(${a.angle.toFixed(2)}rad) translateX(${Math.round(beakRadius(a.angle,half))}px)`,v=>{slot.tip.style.transform=v;});
      put(slot,'kind',a.kind,v=>{slot.el.dataset.kind=v;});
      put(slot,'side',a.side,v=>{slot.el.dataset.side=v;});
      put(slot,'tagEnd',a.tagEnd,v=>{slot.el.dataset.tag=v;});
      put(slot,'face',`${a.kind}:${a.portrait??''}`,()=>{
        const sticker=EDGE_ICON[a.kind];
        slot.face.innerHTML=a.kind==='aliado'?`<img alt="" decoding="async" draggable="false" src="${(a.portrait??'').replace(/"/g,'&quot;')}">`:sticker?icon(sticker):'';
      });
      put(slot,'num',distanceText(a.distance),v=>{slot.num.textContent=v;});
      const tag=a.kind==='caido'?caidoTag(a):'';
      put(slot,'tag',tag,v=>{slot.tag.textContent=v;slot.tag.hidden=!v;});
      put(slot,'ping',String(!!a.ping),v=>{slot.el.classList.toggle('rh-edge-ping',v==='true');});
      put(slot,'danger',String(!!a.danger),v=>{slot.el.classList.toggle('rh-edge-danger',v==='true');});
      put(slot,'count',a.count>1?`+${a.count-1}`:'',v=>{slot.count.textContent=v;slot.count.hidden=!v;});
    }
  }
  clear(){for(const s of this.slots){s.el.hidden=true;s.key='';}}
  destroy(){removeEventListener('resize',this.invalidate);this.observer?.disconnect();this.el.remove();}
}
