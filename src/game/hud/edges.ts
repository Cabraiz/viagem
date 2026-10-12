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
/**
 * Sideways room (CSS px) an arrow on the top or bottom rim keeps from the hero when the field is short (landscape): the
 * ± HERO_MARGIN keep-out let it sit beside the hero's head, in the play (design/UX onda 6, §2.3).
 */
export const HEAD_ROOM=80;
/** Room a caído's tag takes above (or below) its ficha, so stacked arrows never cover the seconds. */
export const TAG_ROOM=16;
/**
 * Room a caído's first name takes under its ficha ("Concursei", design review janela-caido). The name is never wider
 * than the ficha (Londrina 13 px, at most 9 letters as the team strip cuts it), so it fits wherever the arrow fits.
 */
export const NAME_ROOM=16;

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
  /** Caído: its first name under the ficha (design review janela-caido), cut as the team strip cuts it. */
  label?:string;
}
export type Side='top'|'bottom'|'left'|'right';
export interface EdgeArrow extends EdgeTarget {
  /** Centre of the ficha (CSS px, viewport). */
  x:number;y:number;
  /** Where the beak points: radians on screen, 0 = right, y down. */
  angle:number;side:Side;
  /** Targets merged into this arrow (1 = only itself). */
  count:number;
  /** A caído squeezed next to the hero: the tag shows only the seconds (a lit ping keeps its ring on the ficha). */
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
  seen?:{viewport:Rect;covered:readonly (Rect|undefined)[];inset?:number};
  /**
   * The open windows (offer, forge). A target behind one gets its arrow glued to the window's edge, level with the
   * target, beak into the window (UX review janela-caido): it reads "behind this", never as a tag of what stands near.
   */
  windows?:readonly (Rect|undefined)[]}
/**
 * The HUD pieces that hide the map under them (readouts, base ficha, team, controls, minimap, the open offer or forge,
 * the announcement slot with the kill-cam), viewport CSS px: a target under them is not in plain view and gets an
 * arrow. The game (rescue.ts) and the arrows sandbox read the same list (a test pins the windows in it).
 */
export const COVERING='.rh-round,.rh-xp,.rh-boss,.rh-camp,.rh-member,.rh-stack>:not([hidden]),.explore-camera button,.explore-config,.explore-stick,#coop-attack,#coop-sos,.rh-minimap,.rh-offer-chip,.rh-offer:not([hidden]),.rh-forge:not([hidden])';
/** The open windows over the field (EdgeOptions.windows). */
export const WINDOWS='.rh-offer:not([hidden]),.rh-forge:not([hidden])';
/** Whether a target's screen point is in plain view (see EdgeOptions.seen). */
export function inView(p:Point,seen:NonNullable<EdgeOptions['seen']>){
  const v=seen.viewport,i=seen.inset??12;
  if(p.x<v.x+i||p.y<v.y+i||p.x>v.x+v.width-i||p.y>v.y+v.height-i)return false;
  return !seen.covered.some(r=>!!r&&p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height);
}
/**
 * The targets that need an arrow: outside the useful area and not in plain view (under the HUD, an open window or off
 * the viewport). A caído or the boss in this list must end up with an arrow of its own (MUST_POINT), whatever window
 * is open (NEW-20261011-UX-janela-esconde-caido); the audits read the list from the arrows' layer (data-need).
 */
export function pointedTargets(targets:readonly EdgeTarget[],area:Rect,seen?:EdgeOptions['seen']){
  return targets.filter(t=>Number.isFinite(t.screen.x)&&Number.isFinite(t.screen.y)&&!edgeOf(t.screen,area).inside&&!(seen&&inView(t.screen,seen)));
}
/** Kinds that never go without their own arrow when they need one (the zones audit fails otherwise). */
export const MUST_POINT:readonly EdgeKind[]=['caido','chefe'];
/** Half size of an arrow ficha at a text scale (100% or 125%): the CSS uses the same numbers. */
export const arrowHalf=(scale=1)=>({w:(44+32*scale)/2,h:18});

const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

/**
 * The arrows for the targets outside `area` (the useful area, viewport CSS px). `hero` is the hero's box on screen:
 * no arrow crosses it ± margin. A caído's "+N" holds only other caídos, and its tag reserves the room of the real "+N"
 * (laid out again with it when a merge happened, code review janela-caido).
 */
export function layoutEdges(targets:readonly EdgeTarget[],area:Rect,hero?:Rect,options:EdgeOptions={}):EdgeArrow[]{
  let extra=new Map<string,number>(),out=placeEdges(targets,area,hero,options,extra);
  for(let pass=0;pass<3;pass++){
    // The reserve only grows (max of what was seen), so this settles in a pass or two.
    const next=new Map(extra);let grew=false;
    for(const a of out)if(a.kind==='caido'&&a.count>1&&(next.get(a.key)??0)<a.count-1){next.set(a.key,a.count-1);grew=true;}
    if(!grew)break;
    extra=next;out=placeEdges(targets,area,hero,options,extra);
  }
  return out;
}

function placeEdges(targets:readonly EdgeTarget[],area:Rect,hero:Rect|undefined,options:EdgeOptions,extra:ReadonlyMap<string,number>):EdgeArrow[]{
  const half=options.half??arrowHalf(),max=options.max??MAX_ARROWS,merge=options.merge??MERGE_PX,margin=options.margin??HERO_MARGIN;
  if(area.width<=0||area.height<=0)return [];
  // The ficha's centre runs on the rim shrunk by its half size, so the whole ficha stays inside the useful area.
  // (plus RIM_PAD, so the ficha, its beak and its tag do not touch the HUD beyond the area's edge).
  // The caído's tag and the "+N" ride TAG_ROOM above the ficha: that room is kept inside the area too.
  const sorted=pointedTargets(targets,area,options.seen)
    .sort((a,b)=>EDGE_PRIORITY[a.kind]-EDGE_PRIORITY[b.kind]||(a.seconds??Infinity)-(b.seconds??Infinity)||a.distance-b.distance||(a.key<b.key?-1:1));
  // (Among caídos the one with fewer seconds left goes first: a "+1" never hides the most urgent clock.)
  // A named caído keeps NAME_ROOM under its ficha inside the area too.
  const named=sorted.some(t=>t.kind==='caido'&&!!t.label);
  const hw=Math.min(half.w+RIM_PAD,area.width/2),hh=Math.min(half.h+RIM_PAD,area.height/2),top=Math.min(TAG_ROOM,Math.max(0,area.height-2*hh));
  const under=named?Math.min(NAME_ROOM,Math.max(0,area.height-2*hh-top)):0;
  const inner={x:area.x+hw,y:area.y+hh+top,width:Math.max(0,area.width-2*hw),height:Math.max(0,area.height-2*hh-top-under)};
  const out:EdgeArrow[]=[];
  // The hero keep-out counts the caído's tag too (it rides above the ficha and can be wider: "Zé: Me salva, 24 s").
  const scale=Math.max(1,(2*half.w-44)/32);
  let current:EdgeTarget|undefined,compact=false;
  // On the right half of the area the tag grows leftwards, so a wide one never leaves the area.
  const tagFromRight=(x:number)=>x>area.x+area.width/2;
  const box=(x:number,y:number):Rect=>{
    const more=current?extra.get(current.key)??0:0;
    const tag=current?.kind==='caido'?caidoTag({...current,compact})+(more?` +${more}`:''):'';
    const name=current?.kind==='caido'&&current.label?NAME_ROOM:0;
    if(!tag)return {x:x-half.w,y:y-half.h,width:2*half.w,height:2*half.h+name};
    const w=Math.max(2*half.w,tagWidth(tag,scale)),left=tagFromRight(x)?x+half.w+4-w:x-half.w-4;
    return {x:left,y:y-half.h-TAG_ROOM,width:w+4,height:2*half.h+TAG_ROOM+name};
  };
  // On the top and bottom rims the keep-out is wider sideways (HEAD_ROOM): in a short field those rims are level with the
  // hero's head. A tall field (portrait) keeps them far above or below it, so this changes nothing there.
  let along=false;
  const head=hero&&{x:hero.x-Math.max(HEAD_ROOM,margin),y:hero.y-margin,width:hero.width+2*Math.max(HEAD_ROOM,margin),height:hero.height+2*margin};
  const clear=(x:number,y:number,wide=along)=>!hero||!crosses(box(x,y),hero,margin)&&!(wide&&crosses(box(x,y),head!));
  const onRim=(x:number,y:number)=>x>=inner.x-.5&&x<=inner.x+inner.width+.5&&y>=inner.y-.5&&y<=inner.y+inner.height+.5;
  // Crowded: the boxes (ficha, the caído's tag above and name below) would touch, 4 px apart at least. Arrows closer
  // than `merge` count as crowded too (one target seen twice, or two side by side that read as one).
  const boxes=new Map<EdgeArrow,Rect>();
  const crowded=(x:number,y:number)=>{const b=box(x,y),pad={x:b.x-4,y:b.y-4,width:b.width+8,height:b.height+8};
    return out.find(a=>crosses(pad,boxes.get(a)!)||Math.hypot(a.x-x,a.y-y)<merge);};
  const corners=()=>[{x:inner.x,y:inner.y},{x:inner.x+inner.width,y:inner.y},{x:inner.x,y:inner.y+inner.height},{x:inner.x+inner.width,y:inner.y+inner.height}];
  // The whole rim, every 12 px: the last resort of a caído or the boss before giving up its own arrow.
  const rim=()=>{const pts:Point[]=[],{x,y,width:w,height:h}=inner;
    for(let d=0;d<=w;d+=12)pts.push({x:x+d,y},{x:x+d,y:y+h});for(let d=0;d<=h;d+=12)pts.push({x,y:y+d},{x:x+w,y:y+d});return pts;};
  const windows=(options.windows??[]).filter((w):w is Rect=>!!w&&w.width>0&&w.height>0);
  for(const t of sorted){
    // Behind an open window: on the rim right beside it, level with the target (UX review janela-caido, item 11).
    const behind=windows.some(w=>t.screen.x>=w.x&&t.screen.x<=w.x+w.width&&t.screen.y>=w.y&&t.screen.y<=w.y+w.height);
    const e=edgeOf(t.screen,inner);
    let x=behind?clamp(t.screen.x,inner.x,inner.x+inner.width):e.edge.x,y=behind?clamp(t.screen.y,inner.y,inner.y+inner.height):e.edge.y;
    let side=sideOf(x,y,inner);along=side==='top'||side==='bottom';
    current=t;compact=false;let wide=along;
    if(!clear(x,y)){
      // Slide along the side, to whichever end of the hero's keep-out is nearer and still on the rim.
      // A few px past the keep-out, so a camera that eases by a pixel does not put the arrow back over the hero.
      // Measured from the whole box (ficha + tag), whose sides are not symmetric around the arrow's centre.
      const b=box(x,y),slide=(k:number)=>along?[hero!.x-k-(b.x+b.width-x),hero!.x+hero!.width+k+(x-b.x)]:[hero!.y-k-(b.y+b.height-y),hero!.y+hero!.height+k+(y-b.y)];
      const near=(list:Point[])=>list.sort((p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y));
      const spots=(k:number,wide:boolean)=>near(slide(k+SLIDE_SLACK).filter(v=>along?onRim(v,y):onRim(x,v)).map(v=>along?{x:v,y}:{x,y:v})).map(p=>({...p,wide}));
      // No room on its own side (a short area, a wide tag): the nearest corner of the rim that is clear. A caído's arrow
      // must never vanish because the hero stands in the way (UX onda 6). Corners keep the plain keep-out (they are the
      // farthest the rim goes), and only then the side with the plain keep-out, before the head room gives up an arrow.
      const ends=near(corners()).map(p=>({...p,wide:false}));
      const tries=along?[...spots(Math.max(HEAD_ROOM,margin),true),...ends,...spots(margin,false)]:[...spots(margin,false),...ends];
      let found=tries.find(p=>clear(p.x,p.y,p.wide));
      // Still no room: a caído keeps only its clock ("27 s", as wide as the ficha; a lit ping keeps its ring).
      if(!found&&t.kind==='caido'){compact=true;found=tries.find(p=>clear(p.x,p.y,p.wide));}
      if(!found&&MUST_POINT.includes(t.kind))found=near(rim()).map(p=>({...p,wide:false})).find(p=>clear(p.x,p.y,false)&&!crowded(p.x,p.y));
      if(!found)continue;
      x=found.x;y=found.y;wide=found.wide;side=sideOf(x,y,inner);along=side==='top'||side==='bottom';
    }
    // Another arrow already there: step along the side to the nearest free spot; merge ("+1") only when none is left,
    // and only into an arrow of the same kind (a caído's "+N" counts caídos; the boss is never anyone's "+1").
    if(crowded(x,y)){
      const step=along?Math.max(2*half.w,box(x,y).width)+6:2*half.h+TAG_ROOM+(named?NAME_ROOM:0)+2;
      // Steps from its own spot, then right next to the arrow in the way (a short field beside a window has room for
      // two arrows on a side, but not for a full step from where the second one wanted to be).
      const next:Point[]=[];
      for(let k=1;k<=3;k++)for(const sign of [1,-1])next.push(along?{x:x+sign*k*step,y}:{x,y:y+sign*k*step});
      const by=crowded(x,y)!;
      for(const sign of [1,-1])next.push(along?{x:by.x+sign*step,y}:{x,y:by.y+sign*step});
      // Right under or over the arrow in the way, as close as the boxes allow (a short side holds a ficha under a name).
      if(!along){const b=boxes.get(by)!;next.push({x,y:b.y+b.height+4+half.h+(current?.kind==='caido'?TAG_ROOM:0)},{x,y:b.y-4-half.h-(current?.kind==='caido'&&current.label?NAME_ROOM:0)});}
      next.sort((p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y));
      const own=MUST_POINT.includes(t.kind)&&by.kind!==t.kind;
      // The caído and the boss never hide inside another kind's arrow while the rim has a free spot.
      if(own)next.push(...corners().sort((p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y)),...rim().sort((p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y)));
      const spot=next.find(p=>onRim(p.x,p.y)&&clear(p.x,p.y,wide)&&!crowded(p.x,p.y));
      if(!spot){if(by.kind===t.kind)by.count++;else if(own)out.push(arrowAt(t,x,y));continue;}
      x=spot.x;y=spot.y;side=sideOf(x,y,inner);
    }
    // Past the limit, the target still counts in the nearest arrow of its own kind ("+N"), else the minimap has it.
    if(out.length>=max){
      const same=out.filter(a=>a.kind===t.kind);
      if(same.length)same.reduce((best,a)=>(a.side===side?0:1e6)+Math.hypot(a.x-x,a.y-y)<(best.side===side?0:1e6)+Math.hypot(best.x-x,best.y-y)?a:best).count++;
      continue;
    }
    out.push(arrowAt(t,x,y));
  }
  function arrowAt(t:EdgeTarget,x:number,y:number):EdgeArrow{
    const a:EdgeArrow={...t,...(compact?{compact}:{}),x,y,side:sideOf(x,y,inner),count:1,tagEnd:tagFromRight(x)?'right':'left',angle:Math.atan2(t.screen.y-y,t.screen.x-x)};
    boxes.set(a,box(x,y));return a;
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
interface Slot {el:HTMLElement;face:HTMLElement;num:HTMLElement;tag:HTMLElement;count:HTMLElement;name:HTMLElement;tip:HTMLElement;key:string;last:Map<string,string>}
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
      const name=document.createElement('span');name.className='rh-edge-name';name.hidden=true;
      el.append(tip,face,num,tag,count,name);this.el.append(el);
      this.slots.push({el,face,num,tag,count,name,tip,key:'',last:new Map()});
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
      // A caído's "+N" rides inside its tag ("6 s +1"): a separate badge sat on the tag's corner and hid the seconds.
      const tag=a.kind==='caido'?caidoTag(a):'',more=a.count>1?`+${a.count-1}`:'';
      put(slot,'tag',tag&&more?`${tag} ${more}`:tag,v=>{slot.tag.textContent=v;slot.tag.hidden=!v;});
      put(slot,'name',a.kind==='caido'?a.label??'':'',v=>{slot.name.textContent=v;slot.name.hidden=!v;});
      put(slot,'ping',String(!!a.ping),v=>{slot.el.classList.toggle('rh-edge-ping',v==='true');});
      put(slot,'danger',String(!!a.danger),v=>{slot.el.classList.toggle('rh-edge-danger',v==='true');});
      put(slot,'count',tag?'':more,v=>{slot.count.textContent=v;slot.count.hidden=!v;});
    }
  }
  /**
   * Which MUST_POINT kinds need an arrow right now (pointedTargets), on the layer as data-need: the zones audit fails
   * when one of them has no arrow of its own (NEW-20261011-UX-janela-esconde-caido). Written only when it changes.
   */
  need(targets:readonly EdgeTarget[]){
    const v=MUST_POINT.filter(k=>targets.some(t=>t.kind===k)).join(' ');
    if((this.el.dataset.need??'')!==v)this.el.dataset.need=v;
  }
  clear(){for(const s of this.slots){s.el.hidden=true;s.key='';}if(this.el.dataset.need)this.el.dataset.need='';}
  destroy(){removeEventListener('resize',this.invalidate);this.observer?.disconnect();this.el.remove();}
}
