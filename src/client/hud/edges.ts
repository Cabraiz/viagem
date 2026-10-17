/**
 * Edge arrows (NEW-20261009-UX-bordas-fora-da-tela, D-019): what matters and left the screen gets an arrow on the
 * inner rim of the useful area (UX-zonas-tela), never on the screen edge, so it never lands on the HUD, the thumbs or
 * the team strip. Each arrow is a ficha (Breu body, Papel edge) with a sticker and the distance; a beak points at the
 * target. Priority when it fills up: caído > chefe > grupo > spawn > base (> aliado > baú, which the game leaves to the
 * minimap, design onda 6 D4; grupo only in the city, design/cidade-hud.md §3), at most MAX_ARROWS; arrows that would overlap step aside, and what does not fit joins a "+N". An arrow never covers the hero (± HERO_MARGIN): it slides along
 * its side out of the way. Pure layout (node tests) plus a small DOM part with a fixed pool of elements.
 */
import {crosses,HERO_MARGIN,type Rect} from './zones.ts';
import {edgeOf} from '../framing.ts';
import {icon,type IconName} from '../ui/icon.ts';
import {stickerOrIcon} from '../ui/sticker.ts';
import {faceHtml,portraitClass} from '../ui/face-crop.ts';
import {secondsText} from './model.ts';

export interface Point {x:number;y:number}
/**
 * `grupo`: a group of critters off screen in the city (design/cidade-hud.md §3): its count in the body, the distance on the tag.
 * `moto`: the chaveiro's moto off screen in the city (D-047): Cone when it needs the team (dead, fallen).
 * `obra`: a build site off screen in the intermission (card E4-obras-visiveis-da-base): the obra HUD lays it out on top of
 * the arrows already drawn (EdgeOptions.placed) and draws it itself, as a button that opens the site's tree.
 */
export type EdgeKind='caido'|'chefe'|'grupo'|'spawn'|'base'|'aliado'|'bau'|'obra'|'moto'|'banco';
/** Lower is more urgent (UX card: caído > chefe > spawn > aliado; base and baú are the Stonewards and loot extras; the city's grupo goes before spawn). */
/**
 * moto and banco: only the city points at them, and the city ranks them itself (hud/city/edges.ts cityEdgeRank 3.5 and
 * 3.8); 8 and 9 here on purpose.
 */
export const EDGE_PRIORITY:Readonly<Record<EdgeKind,number>>={caido:0,chefe:1,grupo:2,spawn:3,base:4,aliado:5,bau:6,obra:7,moto:8,banco:9};
/**
 * The ficha's sticker. grupo: the doc's new `bichos` sticker (a gosma silhouette, design/cidade-hud.md §3) has no art yet,
 * so it wears `onda` ("Bichos chegando") until the art lane draws it; its count in the body tells it from a mouth.
 */
export const EDGE_ICON:Readonly<Record<EdgeKind,IconName|undefined>>={caido:'boia',chefe:'chefe',grupo:'onda',spawn:'onda',base:'base',aliado:undefined,bau:'bau',obra:undefined,moto:'moto',banco:'caixa-eletronico'};
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
/** Room a tag (a caído's clock, a group's distance, the base's horn seconds) takes above its ficha, so stacked arrows never cover it. */
export const TAG_ROOM=16;
/**
 * Room a caído's first name takes under its ficha ("Concursei", design review janela-caido). The name is never wider
 * than the ficha (Londrina 13 px, at most 9 letters as the team strip cuts it), so it fits wherever the arrow fits.
 */
export const NAME_ROOM=16;
/**
 * How far the beak's triangle reaches past the ficha's border (hud.css .rh-edge-tip::before: 13 px, from -1 px), and
 * the gap it keeps from the viewport's edge: a useful area that ends at the screen edge (portrait's right rim) must not
 * cut the tip off (card cidade-04, visual review).
 */
export const BEAK_REACH=12,BEAK_GAP=2;
/** Half the beak's base (hud.css: 9 px each side of its axis): a beak on the tag's edge keeps this clear of the tag. */
export const BEAK_HALF=9;
/** A crowded arrow of another kind may move this far (CSS px) along the rim, round a corner, before giving up. */
export const NEAR_RIM=120;

export interface EdgeTarget {
  /** Stable id (player id, 'base', enemy id, 'spawn:<tick>'), so a DOM arrow keeps following the same target. */
  key:string;kind:EdgeKind;
  /** Where the target is on screen (CSS px, viewport coordinates), possibly far outside it. */
  screen:Point;
  /** World distance from the followed hero, in units (1 u ≈ 1 m on the ficha). */
  distance:number;
  /** Caído: seconds left before bleeding out. Base (city, after the horn): seconds left to get back (the tag shows them). */
  seconds?:number;
  /** Caído: a "Me salva" ping is lit (UX-resgate-e-ping). */
  ping?:boolean;
  /** Chefe: a telegraph is about to go off; caído: being rescued is not danger. */
  danger?:boolean;
  /** Aliado and caído: portrait for the face (pessoa = círculo). */
  portrait?:string;
  /** Short name for screen readers. */
  name?:string;
  /** Caído: its first name under the ficha (design review janela-caido), cut as the team strip cuts it. Grupo: its count ("99+"), in the body. */
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
  /** The city's beak (EdgeOptions.city): it slides along the ficha's edge, clear of the tag (beakSpot); else centred. */
  slideBeak?:boolean;
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
  windows?:readonly (Rect|undefined)[];
  /**
   * The city's rim rules (card cidade-04, visual review), opt-in so the island's arrows stay as on main (golden test
   * tests/client/edges-ilha-golden.test.ts): the rim keeps every beak BEAK_GAP inside `bounds`; the beak slides along
   * the ficha's edge (slideBeak); a tie between two ends of a side goes to the one nearer the target; a crowded arrow of
   * another kind may go round the corner (NEAR_RIM); a must-point arrow rather touches a neighbour than leaves its side.
   */
  city?:boolean;
  /**
   * City only: the (safe) viewport the beaks must stay inside, BEAK_REACH + BEAK_GAP from its edge (the rim shrinks so
   * no beak can leave it); `seen.viewport` when not given. Without either, only the useful area bounds the fichas.
   */
  bounds?:Rect;
  /**
   * Which targets must never go without an arrow of their own while they need one (the rim's last resort, never
   * dropped when crowded). Default: the MUST_POINT kinds. The city adds the base after the horn (cidade-hud.md §3).
   */
  mustPoint?:(t:EdgeTarget)=>boolean;
  /** The order the targets are placed in (lower first): EDGE_PRIORITY of the kind unless given. */
  rank?:(t:EdgeTarget)=>number;
  /**
   * Arrows another layer already drew this frame (EdgeArrows.shown: the base's ficha, a caído…). They stay where they are
   * and the new ones step aside from them as from each other; they are never in the result, never merged into and do
   * not count towards `max`. Default none (every existing layout is unchanged).
   */
  placed?:readonly EdgeArrow[];
  /**
   * Boxes of another layer no arrow may touch (the obra HUD's on-screen markers, inflated by the arrows' hit area): the
   * arrows step aside from them as from a placed arrow, never fold into them. Default none.
   */
  avoid?:readonly Rect[]}
/**
 * The HUD pieces that hide the map under them (readouts, base ficha, team, controls, minimap, the open offer or forge,
 * the announcement slot with the kill-cam), viewport CSS px: a target under them is not in plain view and gets an
 * arrow. The game (rescue.ts) and the arrows sandbox read the same list (a test pins the windows in it).
 */
export const COVERING='.rh-round,.rh-xp,.rh-boss,.rh-camp,.rh-member,.rh-stack>:not([hidden]),.explore-camera button,.explore-config,.explore-stick,#coop-attack,#coop-sos,.rh-minimap,.rh-offer-chip,.rh-offer:not([hidden]),.rh-forge:not([hidden]),.rh-cida:not([hidden]),.rh-cida-btn:not([hidden]),.rh-fort-puxar:not([hidden]),.rh-fort-construir:not([hidden]),.rh-fort-bandeja:not([hidden])';
/**
 * The panels over the field the arrows keep clear of (EdgeOptions.windows; a caído under one keeps an arrow beside it):
 * the open offer, forge and Dona Cida's tray (D-047), and the WC3 minimap, which floats over a corner of the field
 * (minimapa-wc3).
 */
export const WINDOWS='.rh-offer:not([hidden]),.rh-forge:not([hidden]),.rh-cida:not([hidden]),.rh-minimap,.rh-fort-puxar:not([hidden]),.rh-fort-construir:not([hidden]),.rh-fort-bandeja:not([hidden])';
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
/**
 * The kinds the zones audit must find an arrow of (EdgeArrows.need → data-need): those of the targets that need an
 * arrow (pointedTargets) and must point (`must`, MUST_POINT kinds by default), once each, in EDGE_PRIORITY order.
 */
export function needKinds(targets:readonly EdgeTarget[],must:(t:EdgeTarget)=>boolean=t=>MUST_POINT.includes(t.kind)):EdgeKind[]{
  const kinds=new Set<EdgeKind>();
  for(const t of targets)if(must(t))kinds.add(t.kind);
  return [...kinds].sort((a,b)=>EDGE_PRIORITY[a]-EDGE_PRIORITY[b]);
}
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
  const rank=options.rank??((t:EdgeTarget)=>EDGE_PRIORITY[t.kind]);
  const half=options.half??arrowHalf(),max=options.max??MAX_ARROWS,merge=options.merge??MERGE_PX,margin=options.margin??HERO_MARGIN;
  if(area.width<=0||area.height<=0)return [];
  // The ficha's centre runs on the rim shrunk by its half size, so the whole ficha stays inside the useful area.
  // (plus RIM_PAD, so the ficha, its beak and its tag do not touch the HUD beyond the area's edge).
  // The caído's tag and the "+N" ride TAG_ROOM above the ficha: that room is kept inside the area too.
  const sorted=pointedTargets(targets,area,options.seen)
    .sort((a,b)=>rank(a)-rank(b)||(a.seconds??Infinity)-(b.seconds??Infinity)||a.distance-b.distance||(a.key<b.key?-1:1));
  // (Among caídos the one with fewer seconds left goes first: a "+1" never hides the most urgent clock.)
  // A named caído keeps NAME_ROOM under its ficha inside the area too.
  const named=sorted.some(t=>t.kind==='caido'&&!!t.label);
  const hw=Math.min(half.w+RIM_PAD,area.width/2),hh=Math.min(half.h+RIM_PAD,area.height/2),top=Math.min(TAG_ROOM,Math.max(0,area.height-2*hh));
  const under=named?Math.min(NAME_ROOM,Math.max(0,area.height-2*hh-top)):0;
  let inner={x:area.x+hw,y:area.y+hh+top,width:Math.max(0,area.width-2*hw),height:Math.max(0,area.height-2*hh-top-under)};
  const city=!!options.city;
  // City: the beak reaches BEAK_REACH past the ficha (half size + BEAK_REACH from its centre at most, beakSpot), so where
  // the area runs to the viewport's edge (portrait's right rim) the rim shrinks until no beak can leave the screen. The
  // spots are chosen on that rim, so the hero's keep-out is checked where the arrow really goes (no clamp afterwards).
  const bounds=city?options.bounds??options.seen?.viewport:undefined;
  if(bounds){
    const rx=half.w+BEAK_REACH+BEAK_GAP,ry=half.h+BEAK_REACH+BEAK_GAP;
    const x0=Math.max(inner.x,bounds.x+rx),y0=Math.max(inner.y,bounds.y+ry);
    const x1=Math.min(inner.x+inner.width,bounds.x+bounds.width-rx),y1=Math.min(inner.y+inner.height,bounds.y+bounds.height-ry);
    inner={x:x0,y:y0,width:Math.max(0,x1-x0),height:Math.max(0,y1-y0)};
  }
  const must=options.mustPoint??((t:EdgeTarget)=>MUST_POINT.includes(t.kind));
  const out:EdgeArrow[]=[];
  // Arrows of another layer (EdgeOptions.placed): their boxes are taken as they are; never merged into, never returned.
  const seeded=(options.placed?.length??0)+(options.avoid?.length??0);
  // The avoided boxes ride in `out` as obstacles: no kind of theirs ever matches a target's (no merge, rim search on).
  const obstacles=new Set<EdgeArrow>();
  const sameKind=(a:EdgeArrow,t:EdgeTarget)=>!obstacles.has(a)&&a.kind===t.kind;
  // The hero keep-out counts the caído's tag too (it rides above the ficha and can be wider: "Zé: Me salva, 24 s").
  const scale=Math.max(1,(2*half.w-44)/32);
  let current:EdgeTarget|undefined,compact=false;
  // On the right half of the area the tag grows leftwards, so a wide one never leaves the area.
  const tagFromRight=(kind:EdgeKind,x:number)=>tagEndOf(kind,x,area)==='right';
  const box=(x:number,y:number):Rect=>{
    const more=current?extra.get(current.key)??0:0;
    const tag=current?edgeTag({...current,compact})+(more?` +${more}`:''):'';
    const name=current?.kind==='caido'&&current.label?NAME_ROOM:0;
    if(!tag)return {x:x-half.w,y:y-half.h,width:2*half.w,height:2*half.h+name};
    // A caído's tag hangs 4 px past one end of the ficha (the box takes those 4 px); the others' sit flush with the
    // right end (tagSpan), so they never widen the box.
    const w=Math.max(2*half.w,tagWidth(tag,scale));
    if(current!.kind!=='caido')return {x:x+half.w-w,y:y-half.h-TAG_ROOM,width:w,height:2*half.h+TAG_ROOM+name};
    // The island keeps main's box (its spacing between arrows, golden test): a tag hung from the right end started 4 px
    // right of the ficha's left edge. The hero's keep-out reads the whole ficha anyway (keep, below).
    const left=tagFromRight(current!.kind,x)?x+half.w-w+(city?0:4):x-half.w-4;
    return {x:left,y:y-half.h-TAG_ROOM,width:w+4,height:2*half.h+TAG_ROOM+name};
  };
  // What must stay clear of the hero: the box and the whole ficha. Main's island box left the ficha's left 4 px out when
  // the tag hangs from the right end, which let a caído sit 2-3 px into the keep-out: the one change to the island's
  // layout (golden test).
  const keep=(x:number,y:number):Rect=>{const b=box(x,y),l=Math.min(b.x,x-half.w),t=Math.min(b.y,y-half.h);
    return {x:l,y:t,width:Math.max(b.x+b.width,x+half.w)-l,height:Math.max(b.y+b.height,y+half.h)-t};};
  // On the top and bottom rims the keep-out is wider sideways (HEAD_ROOM): in a short field those rims are level with the
  // hero's head. A tall field (portrait) keeps them far above or below it, so this changes nothing there.
  let along=false;
  const head=hero&&{x:hero.x-Math.max(HEAD_ROOM,margin),y:hero.y-margin,width:hero.width+2*Math.max(HEAD_ROOM,margin),height:hero.height+2*margin};
  const clear=(x:number,y:number,wide=along)=>!hero||!crosses(keep(x,y),hero,margin)&&!(wide&&crosses(keep(x,y),head!));
  const onRim=(x:number,y:number)=>x>=inner.x-.5&&x<=inner.x+inner.width+.5&&y>=inner.y-.5&&y<=inner.y+inner.height+.5;
  // Crowded: the boxes (ficha, the caído's tag above and name below) would touch, 4 px apart at least. Arrows closer
  // than `merge` count as crowded too (one target seen twice, or two side by side that read as one).
  const boxes=new Map<EdgeArrow,Rect>();
  const crowded=(x:number,y:number,gap=4)=>{const b=box(x,y),pad={x:b.x-gap,y:b.y-gap,width:b.width+2*gap,height:b.height+2*gap};
    return out.find(a=>crosses(pad,boxes.get(a)!)||Math.hypot(a.x-x,a.y-y)<merge);};
  const corners=()=>[{x:inner.x,y:inner.y},{x:inner.x+inner.width,y:inner.y},{x:inner.x,y:inner.y+inner.height},{x:inner.x+inner.width,y:inner.y+inner.height}];
  // The whole rim, every 12 px: the last resort of a caído or the boss before giving up its own arrow.
  const rim=()=>{const pts:Point[]=[],{x,y,width:w,height:h}=inner;
    for(let d=0;d<=w;d+=12)pts.push({x:x+d,y},{x:x+d,y:y+h});for(let d=0;d<=h;d+=12)pts.push({x,y:y+d},{x:x+w,y:y+d});return pts;};
  const windows=(options.windows??[]).filter((w):w is Rect=>!!w&&w.width>0&&w.height>0);
  for(const p of options.placed??[]){
    current=p;compact=!!p.compact;
    const a:EdgeArrow={...p};out.push(a);boxes.set(a,box(p.x,p.y));
  }
  current=undefined;compact=false;
  (options.avoid??[]).forEach((r,i)=>{
    const a:EdgeArrow={key:`avoid:${i}`,kind:'aliado',screen:{x:r.x+r.width/2,y:r.y+r.height/2},distance:0,x:r.x+r.width/2,y:r.y+r.height/2,
      angle:0,side:'top',count:1,tagEnd:'left'};
    obstacles.add(a);out.push(a);boxes.set(a,{...r});
  });
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
      // Nearest first; a tie (to the px: both ends of a side, the hero in its middle) goes to the end nearer the target,
      // so a group straight up and the base up-right do not swap corners (visual review cidade-04).
      const near=(list:Point[])=>list.sort(city?(p,q)=>Math.round(Math.hypot(p.x-x,p.y-y))-Math.round(Math.hypot(q.x-x,q.y-y))
        ||Math.hypot(p.x-t.screen.x,p.y-t.screen.y)-Math.hypot(q.x-t.screen.x,q.y-t.screen.y)
        :(p,q)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y));
      const spots=(k:number,wide:boolean)=>near(slide(k+SLIDE_SLACK).filter(v=>along?onRim(v,y):onRim(x,v)).map(v=>along?{x:v,y}:{x,y:v})).map(p=>({...p,wide}));
      // No room on its own side (a short area, a wide tag): the nearest corner of the rim that is clear. A caído's arrow
      // must never vanish because the hero stands in the way (UX onda 6). Corners keep the plain keep-out (they are the
      // farthest the rim goes), and only then the side with the plain keep-out, before the head room gives up an arrow.
      const ends=near(corners()).map(p=>({...p,wide:false}));
      const tries=along?[...spots(Math.max(HEAD_ROOM,margin),true),...ends,...spots(margin,false)]:[...spots(margin,false),...ends];
      let found=tries.find(p=>clear(p.x,p.y,p.wide));
      // Still no room: a caído keeps only its clock ("27 s", as wide as the ficha; a lit ping keeps its ring).
      if(!found&&t.kind==='caido'){compact=true;found=tries.find(p=>clear(p.x,p.y,p.wide));}
      if(!found&&must(t))found=near(rim()).map(p=>({...p,wide:false})).find(p=>clear(p.x,p.y,false)&&!crowded(p.x,p.y));
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
      if(!along){const b=boxes.get(by)!;next.push({x,y:b.y+b.height+4+half.h+(current&&(current.kind==='caido'||edgeTag(current))?TAG_ROOM:0)},{x,y:b.y-4-half.h-(current?.kind==='caido'&&current.label?NAME_ROOM:0)});}
      const byDist=(p:Point,q:Point)=>Math.hypot(p.x-x,p.y-y)-Math.hypot(q.x-x,q.y-y);
      next.sort(byDist);
      // Another kind in the way and no step left on this side: the rim nearby, round the corner (a short landscape
      // field dropped the east mouth while the next side had room, visual review cidade-04). The same kind folds instead.
      if(city&&!sameKind(by,t))next.push(...rim().filter(p=>Math.hypot(p.x-x,p.y-y)<=NEAR_RIM).sort(byDist));
      const own=must(t)&&!sameKind(by,t),fits=(p:Point,pad?:number)=>onRim(p.x,p.y)&&clear(p.x,p.y,wide)&&!crowded(p.x,p.y,pad);
      let spot=next.find(p=>fits(p));
      // A caído, the boss (or the city's base) rather touches a neighbour's box than goes to the far side of the field.
      if(!spot&&own&&city)spot=[{x,y},...next].find(p=>fits(p,0));
      // The caído and the boss never hide inside another kind's arrow while the rim has a free spot.
      if(!spot&&own)spot=[...corners().sort(byDist),...rim().sort(byDist)].find(p=>fits(p));
      if(!spot){if(sameKind(by,t)&&out.indexOf(by)>=seeded)by.count++;else if(own)out.push(arrowAt(t,x,y));continue;}
      x=spot.x;y=spot.y;side=sideOf(x,y,inner);
    }
    // Past the limit, the target still counts in the nearest arrow of its own kind ("+N"), else the minimap has it.
    if(out.length-seeded>=max){
      const same=out.slice(seeded).filter(a=>a.kind===t.kind);
      if(same.length)same.reduce((best,a)=>(a.side===side?0:1e6)+Math.hypot(a.x-x,a.y-y)<(best.side===side?0:1e6)+Math.hypot(best.x-x,best.y-y)?a:best).count++;
      continue;
    }
    out.push(arrowAt(t,x,y));
  }
  function arrowAt(t:EdgeTarget,x:number,y:number):EdgeArrow{
    // The island's arrows without a tag keep main's tagEnd (by the area's half); a tag of the city hangs as tagEndOf says.
    const tagEnd=t.kind==='caido'||edgeTag(t)?tagEndOf(t.kind,x,area):x>area.x+area.width/2?'right':'left';
    const a:EdgeArrow={...t,...(compact?{compact}:{}),x,y,side:sideOf(x,y,inner),count:1,tagEnd,angle:Math.atan2(t.screen.y-y,t.screen.x-x),...(city?{slideBeak:true}:{})};
    boxes.set(a,box(x,y));return a;
  }
  return seeded?out.slice(seeded):out;
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
/**
 * The tag over a ficha: a caído's clock (caidoTag), a group's distance ("34 m", doc §3) and the base's horn seconds
 * ("5 s", city intermission); nothing for the other kinds (the island's arrows stay as they were).
 */
export function edgeTag(t:Pick<EdgeTarget,'kind'|'seconds'|'ping'|'distance'>&{compact?:boolean}):string{
  if(t.kind==='caido')return caidoTag(t);
  if(t.kind==='grupo')return distanceText(t.distance);
  if(t.kind==='base'&&t.seconds!==undefined)return secondsText(t.seconds);
  return '';
}
/** Width (CSS px) of a caído's tag at a text scale: M PLUS 800 at 13 px ≈ 0.62 em per character, plus its padding. */
export const tagWidth=(text:string,scale=1)=>Math.ceil(text.length*13*.62*scale+12);
/** Where the beak sits: on the ficha's border along the pointing direction (radius from the centre, CSS px). */
export function beakRadius(angle:number,half:{w:number;h:number}){
  const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  return Math.min(c>1e-6?half.w/c:Infinity,s>1e-6?half.h/s:Infinity);
}
/**
 * Which end of the ficha its tag hangs from. A group's distance and the base's seconds are never wider than the ficha:
 * they hang from the right end, away from the sticker on the left (visual review cidade-04: "4 s" hid the tent's flag).
 * A caído's tag can be wider: on the area's right half it grows leftwards, so it never leaves the area.
 */
export function tagEndOf(kind:EdgeKind,x:number,area:Rect):'left'|'right'{
  return kind!=='caido'||x>area.x+area.width/2?'right':'left';
}
/**
 * The x span (CSS px from the ficha's centre) of a tag on top of the ficha. A caído's hangs 4 px past its end, minus its
 * 2 px border (hud.css); a group's distance and the base's seconds sit flush with the right end (`flush`, city-hud.css).
 */
export function tagSpan(tag:{end:'left'|'right';width:number;flush?:boolean},half:{w:number}):[number,number]{
  const out=tag.flush?0:2;
  return tag.end==='left'?[-half.w-out,-half.w-out+tag.width]:[half.w+out-tag.width,half.w+out];
}
/**
 * Where the beak leaves the ficha: its axis starts at (ox, oy) (CSS px from the centre) and runs `r` along `angle` to
 * the border. Centred by default (beakRadius), but the beak's base (± BEAK_HALF) always sits whole on one edge: a beak
 * that would leave by a corner slides along that edge, so it never floats beside the ficha (visual review cidade-04).
 * One that would leave through the tag riding on top (a group's "56 m" over an arrow pointing up) moves to the free part
 * of the top edge; with no free part (a caído's tag as wide as the ficha) it stays where it was. `tag`: its end and width.
 */
export function beakSpot(angle:number,half:{w:number;h:number},tag?:{end:'left'|'right';width:number;flush?:boolean}):{ox:number;oy:number;r:number}{
  const c=Math.cos(angle),s=Math.sin(angle),r0=beakRadius(angle,half),ex=c*r0,ey=s*r0;
  const clampTo=(v:number,lo:number,hi:number)=>hi<lo?(lo+hi)/2:Math.min(hi,Math.max(lo,v));
  // Through the left or right edge: slide along it (vertically) so the base stays on the ficha.
  if(Math.abs(Math.abs(ex)-half.w)<=.5&&Math.abs(Math.abs(ey)-half.h)>.5||Math.abs(s)<1e-6){
    const oy=clampTo(ey,-half.h+BEAK_HALF,half.h-BEAK_HALF)-ey;
    return {ox:0,oy,r:half.w/Math.abs(c)};
  }
  // Through the top or bottom edge: slide along it (horizontally), clear of the tag on top when there is room.
  let lo=-half.w+BEAK_HALF,hi=half.w-BEAK_HALF,target=clampTo(ex,lo,hi);
  if(tag&&tag.width>0&&s<0){
    const [t0,t1]=tagSpan(tag,half);
    if(target+BEAK_HALF>t0&&target-BEAK_HALF<t1){
      // A shallow beak (≤ 60° above the horizon) under the tag leaves by the top of its side: moved along the top edge
      // it would point across the tag (the base's "4 s" in landscape).
      if(Math.abs(c)>.5)return {ox:Math.sign(c)*half.w,oy:-half.h+BEAK_HALF,r:0};
      if(tag.end==='left')lo=Math.max(lo,t1+BEAK_HALF);else hi=Math.min(hi,t0-BEAK_HALF);
      if(lo<=hi)target=clampTo(ex,lo,hi);
      // The tag covers the whole top (a caído's "Me salva: 14 s"): a slanted beak leaves by the top of its side instead.
      else if(Math.abs(c)>.2)return {ox:Math.sign(c)*half.w,oy:-half.h+BEAK_HALF,r:0};
    }
  }
  return {ox:target-ex,oy:0,r:half.h/Math.abs(s)};
}
/**
 * The beak's CSS transform: the city's slides along the ficha's edge (beakSpot, `tagText` the tag as drawn, "+N"
 * included); the island's stays centred on the pointing direction, as on main (golden test).
 */
export function beakTransform(a:Pick<EdgeArrow,'angle'|'kind'|'tagEnd'|'slideBeak'>,half:{w:number;h:number},tagText:string){
  const turn=`rotate(${a.angle.toFixed(2)}rad)`;
  if(!a.slideBeak)return `${turn} translateX(${Math.round(beakRadius(a.angle,half))}px)`;
  const beak=beakSpot(a.angle,half,tagText?{end:a.tagEnd,width:tagWidth(tagText,Math.max(1,(2*half.w-44)/32)),flush:a.kind!=='caido'}:undefined);
  return `translate(${Math.round(beak.ox)}px,${Math.round(beak.oy)}px) ${turn} translateX(${Math.round(beak.r)}px)`;
}

// ---------- DOM (browser only) ----------
interface Slot {el:HTMLElement;face:HTMLElement;num:HTMLElement;tag:HTMLElement;count:HTMLElement;name:HTMLElement;tip:HTMLElement;key:string;last:Map<string,string>}
const put=(slot:Slot,key:string,value:string,write:(v:string)=>void)=>{if(slot.last.get(key)===value)return;slot.last.set(key,value);write(value);};

/** The pool of arrow fichas inside the HUD root (read-only overlay: no pointer events, aria-hidden). */
export class EdgeArrows {
  readonly el:HTMLElement;
  private readonly slots:Slot[]=[];
  /** The arrows drawn by the last render (none after clear): another layer lays its own out around them (EdgeOptions.placed). */
  shown:readonly EdgeArrow[]=[];
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
    this.shown=arrows;
    // Keep each target in the slot it had, so a ping's one-shot bump does not jump to another arrow.
    const free=this.slots.filter(s=>!arrows.some(a=>a.key===s.key));
    const assigned=new Map<EdgeArrow,Slot>();
    for(const a of arrows){const own=this.slots.find(s=>s.key===a.key);assigned.set(a,own??free.shift()!);}
    for(const slot of this.slots)if(![...assigned.values()].includes(slot)){if(!slot.el.hidden){slot.el.hidden=true;slot.key='';}}
    for(const [a,slot] of assigned){
      if(!slot)continue;
      slot.key=a.key;slot.el.hidden=false;
      put(slot,'at',`translate(${Math.round(a.x-half.w)}px,${Math.round(a.y-half.h)}px)`,v=>{slot.el.style.transform=v;});
      // A caído's "+N" rides inside its tag ("6 s +1"): a separate badge sat on the tag's corner and hid the seconds.
      const tag=edgeTag(a),more=a.count>1?`+${a.count-1}`:'',tagText=tag&&more?`${tag} ${more}`:tag;
      put(slot,'tip',beakTransform(a,half,tagText),v=>{slot.tip.style.transform=v;});
      put(slot,'kind',a.kind,v=>{slot.el.dataset.kind=v;});
      put(slot,'side',a.side,v=>{slot.el.dataset.side=v;});
      put(slot,'tagEnd',a.tagEnd,v=>{slot.el.dataset.tag=v;});
      put(slot,'face',`${a.kind}:${a.portrait??''}`,()=>{
        const sticker=EDGE_ICON[a.kind];
        // An ally is a face in a circle (rostos-hud): the class's crop of the portrait it was handed (ui/face-crop.ts).
        const id=portraitClass(a.portrait)??(a.portrait?'':undefined);
        // The moto's arrow wears the chaveiro riding it (ui/chaveiro), else the moto icon.
        slot.face.innerHTML=a.kind==='aliado'?faceHtml(id,a.portrait?{src:a.portrait}:{}):a.kind==='moto'?stickerOrIcon('chaveiro','moto'):sticker?icon(sticker):'';
      });
      // A group's body holds its count ("99+" at the ceiling); its distance goes up to the tag (doc §3).
      put(slot,'num',a.kind==='grupo'?a.label??'':distanceText(a.distance),v=>{slot.num.textContent=v;});
      put(slot,'tag',tagText,v=>{slot.tag.textContent=v;slot.tag.hidden=!v;});
      put(slot,'name',a.kind==='caido'?a.label??'':'',v=>{slot.name.textContent=v;slot.name.hidden=!v;});
      put(slot,'ping',String(!!a.ping),v=>{slot.el.classList.toggle('rh-edge-ping',v==='true');});
      put(slot,'danger',String(!!a.danger),v=>{slot.el.classList.toggle('rh-edge-danger',v==='true');});
      put(slot,'count',tag?'':more,v=>{slot.count.textContent=v;slot.count.hidden=!v;});
    }
  }
  /**
   * Which must-point kinds need an arrow right now (pointedTargets), on the layer as data-need: the zones audit fails
   * when one of them has no arrow of its own (NEW-20261011-UX-janela-esconde-caido). `must` is the layout's
   * (EdgeOptions.mustPoint): the city passes cityMustPoint, so the base after the horn is audited too. Written only when
   * it changes.
   */
  need(targets:readonly EdgeTarget[],must?:(t:EdgeTarget)=>boolean){
    const v=needKinds(targets,must).join(' ');
    if((this.el.dataset.need??'')!==v)this.el.dataset.need=v;
  }
  clear(){this.shown=[];for(const s of this.slots){s.el.hidden=true;s.key='';}if(this.el.dataset.need)this.el.dataset.need='';}
  destroy(){removeEventListener('resize',this.invalidate);this.observer?.disconnect();this.el.remove();}
}
