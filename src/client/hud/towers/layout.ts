/**
 * Build menu layout (torres-hud, D-009 mobile, D-020 Janela & Etiqueta): where the obra window and the ground markers
 * go, from the zone model (zones.ts). Pure, node-tested; the DOM (obra.ts) places its boxes at exactly these rects.
 * - The window never scrolls: its height is its content (the head card, up to 3 branch cards, the confirm row).
 *   Portrait: one column across the useful width, bottom-anchored right above the thumbs (the confirm row is the
 *   thumb's reach). Landscape: two columns at the right, bottom-anchored above the right thumb (or left of it, down to
 *   the team row): the head and the confirm row on the left, the branch cards on the right; when that is taller than
 *   the room under the top band (125 %, a notch), the compact form: the head row over the branches side by side.
 *   Portrait's compact form (a notch: the field above the window would be too short) puts the branches two by two.
 * - It clears both thumbs by ≥ THUMB_GAP (it stops at the inflated thumb zones), stays inside the safe area and under
 *   the whole top band (zones `top`: status rows and the announcement slot; BUG-20261013-E4-obra-janela-sob-anuncio-
 *   paisagem), off the minimap (± OBRA_MINIMAP_GAP), and leaves the field a band that holds the hero ± HERO_MARGIN
 *   (computeZones with it as `offer`).
 * - Cards are ≥ 44 px targets; the confirm and close buttons 48 px. Heights follow the text scale (100 % or 125 %).
 * - Ground markers are 48 px targets centred on the sites' screen points, clamped into the useful area.
 * - Sites off screen get edge arrows (obraArrows, card E4-obras-visiveis-da-base): the 1–3 nearest, laid out by the edge
 *   arrows' layoutEdges around the arrows already on the rim (the base's ficha), so they never cover it nor each other.
 */
import {MIN_PLAY_SIDE,bottom,computeZones,crosses,right,teamIsRow,type Orientation,type Rect,type ScreenZones,type ZoneInput} from '../zones.ts';
import {arrowHalf,layoutEdges,type EdgeArrow,type EdgeTarget} from '../edges.ts';

export const OBRA_PAD=8,OBRA_GAP=6,OBRA_BUTTON=48,OBRA_TARGET=44,OBRA_MARKER=48,OBRA_EDGE=8;
/** Widest window (landscape); the left column's share there. */
export const OBRA_MAX_WIDTH=520,OBRA_LEFT_SHARE=.4;
/** Clearance between the window and the minimap ficha (the band's own spacing, zones.ts: announce = band end + 4). */
export const OBRA_MINIMAP_GAP=4;
/** Text lines of a card: the name (16 px × scale, line 1.15) and the effect (13 px × scale, line 1.2), 4 px above and below. */
export const cardHeight=(scale:number)=>Math.max(OBRA_TARGET,Math.ceil(8+16*scale*1.15+13*scale*1.2));
export const HERO_SIDE=56;

/**
 * The window's arrangement: one column (portrait); two columns (landscape: head and buttons left, branches right); or
 * compact, when those are too tall under the top band (landscape: the head row over the branches side by side;
 * portrait: the branches two by two). obra.css draws compact branch cards narrower (data-forma).
 */
export type ObraForm='coluna'|'duas'|'compacta';
export interface ObraLayout {
  orientation:Orientation;form:ObraForm;
  panel:Rect;head:Rect;branches:Rect[];confirm:Rect;close:Rect;
  /** The zones with the window open (it is the `offer` that trims the field) and the hero the camera centres there. */
  zones:ScreenZones;hero:Rect;
  /** Content height against the window's: equal by construction (no scroll). */
  contentHeight:number;
  /** False when the window could not fit (it would cover the top band or the minimap, or leave no field for the hero). */
  fits:boolean;
}
const insets=(input:ZoneInput)=>{
  const s=input.safe??{top:0,right:0,bottom:0,left:0};
  return {top:Math.max(OBRA_EDGE,s.top),right:Math.max(OBRA_EDGE,s.right),bottom:Math.max(OBRA_EDGE,s.bottom),left:Math.max(OBRA_EDGE,s.left)};
};
export const centredHero=(u:Rect):Rect=>({x:u.x+(u.width-HERO_SIDE)/2,y:u.y+(u.height-HERO_SIDE)/2,width:HERO_SIDE,height:HERO_SIDE});

/** The window for a tree with `branches` cards (0..3) at text `scale` (1 or 1.25). */
export function layoutObra(input:ZoneInput,scale:number,branches:number):ObraLayout{
  const base=computeZones(input),vw=input.viewport.width,vh=input.viewport.height,safe=insets(input);
  const n=Math.max(0,Math.min(3,branches)),card=cardHeight(scale);
  const floor=vh-safe.bottom;
  const thumbTops=[base.leftThumb,base.rightThumb].filter((r):r is Rect=>!!r);
  let tries:Boxes[];
  if(base.orientation==='portrait'){
    // One column over the useful width (right of the team column), right above the higher thumb; when that leaves the
    // hero no field under the top band (a notch, 125 %), the compact form: the branches two by two.
    const u=base.useful,x=u.x,w=Math.min(u.width,vw-safe.right-x);
    const yBottom=Math.min(floor,...thumbTops.map(t=>t.y));
    tries=(['coluna','compacta'] as const).map(form=>{const height=portraitHeight(form,card,n);return portraitBoxes(form,{x,y:yBottom-height,width:w,height},card,n);});
  }else{
    // Landscape: two columns right-aligned above the right thumb, then left of the thumb (down to the team row); then
    // the same two places in the compact form (the head row over the branches side by side, two cards shorter).
    const leftEdge=base.leftThumb?right(base.leftThumb):safe.left;
    const w=Math.max(0,Math.min(OBRA_MAX_WIDTH,vw-safe.right-leftEdge-MIN_PLAY_SIDE-OBRA_EDGE));
    const yBottomAt=(px:number,pw:number)=>{
      const team=input.team&&teamIsRow(input.team,input.viewport)&&right(input.team)>px&&input.team.x<px+pw?input.team.y-8:Infinity;
      return Math.min(floor,team,...thumbTops.filter(t=>right(t)>px&&t.x<px+pw).map(t=>t.y));
    };
    const places:{x:number;w:number}[]=[{x:vw-safe.right-w,w}];
    if(base.rightThumb){const xr=base.rightThumb.x,w2=Math.min(w,xr-(leftEdge+MIN_PLAY_SIDE+OBRA_EDGE));if(w2>0)places.push({x:xr-w2,w:w2});}
    tries=(['duas','compacta'] as const).flatMap(form=>places.map(p=>{
      const height=landscapeHeight(form,card,n);
      return landscapeBoxes(form,{x:p.x,y:yBottomAt(p.x,p.w)-height,width:p.w,height},card,n);
    }));
  }
  // The first that fits under the whole top band (status rows + announcement slot), clear of the minimap and with a
  // field left for the hero; none (a phone shorter than the HUD allows): the one reaching least into the band.
  const ok=(b:Boxes)=>clearOfTop(b.panel,base.top,input.minimap)&&b.panel.x>=safe.left-.5&&right(b.panel)<=vw-safe.right+.5&&fieldLeft(input,b.panel)&&b.panel.width>0;
  const best=tries.find(ok)??tries.reduce((a,b)=>b.panel.y>a.panel.y?b:a);
  const {panel}=best,zones=computeZones({...input,offer:panel}),hero=centredHero(zones.useful);
  return {orientation:base.orientation,form:best.form,panel,head:best.head,branches:best.rows,confirm:best.confirm,close:best.close,zones,hero,
    contentHeight:panel.height,fits:ok(best)};
}

/**
 * Under the whole top band (zones `top`: the status rows, the minimap in portrait and the announcement slot under them,
 * so "Bichos chegando" never covers the window) and off the minimap wherever it is (landscape: the edge column).
 */
function clearOfTop(panel:Rect,top:Rect,minimap:Rect|undefined){
  return panel.y>=bottom(top)-.5&&!(minimap&&crosses(panel,minimap,OBRA_MINIMAP_GAP));
}
/** The field left beside the window still holds the hero ± HERO_MARGIN (computeZones with it as the offer). */
function fieldLeft(input:ZoneInput,panel:Rect){
  const u=computeZones({...input,offer:panel}).useful;
  return u.width>=MIN_PLAY_SIDE&&u.height>=MIN_PLAY_SIDE;
}
interface Boxes {form:ObraForm;panel:Rect;head:Rect;rows:Rect[];confirm:Rect;close:Rect}
/** Portrait window height: head, the branches (one per row, or two per row compact), the button row. */
export function portraitHeight(form:'coluna'|'compacta',card:number,n:number){
  const lines=form==='compacta'?Math.ceil(n/2):n;
  return OBRA_PAD*2+card+lines*(card+OBRA_GAP)+OBRA_GAP+OBRA_BUTTON;
}
/** The boxes of a portrait window at `panel`: the head on top, the branches (two per row compact), close and confirm last. */
function portraitBoxes(form:'coluna'|'compacta',panel:Rect,card:number,n:number):Boxes{
  const x=panel.x+OBRA_PAD,inner=panel.width-OBRA_PAD*2,per=form==='compacta'?2:1,cw=(inner-(per-1)*OBRA_GAP)/per,rows:Rect[]=[];
  let y=panel.y+OBRA_PAD;
  const head={x,y,width:inner,height:card};y+=card+OBRA_GAP;
  for(let i=0;i<n;i++){rows.push({x:x+(i%per)*(cw+OBRA_GAP),y,width:cw,height:card});if(i%per===per-1||i===n-1)y+=card+OBRA_GAP;}
  const close={x,y,width:OBRA_BUTTON,height:OBRA_BUTTON};
  const confirm={x:x+OBRA_BUTTON+OBRA_GAP,y,width:inner-OBRA_BUTTON-OBRA_GAP,height:OBRA_BUTTON};
  return {form,panel,head,rows,confirm,close};
}
/** Landscape window height: the left column (head over the buttons) beside the stacked branches, or the compact rows. */
export function landscapeHeight(form:'duas'|'compacta',card:number,n:number){
  if(form==='compacta')return OBRA_PAD*2+Math.max(card,OBRA_BUTTON)+(n?OBRA_GAP+card:0);
  return OBRA_PAD*2+Math.max(card+OBRA_GAP+OBRA_BUTTON,n?n*card+(n-1)*OBRA_GAP:0);
}
/**
 * The boxes of a landscape window at `panel`. Both forms give the buttons the left share (OBRA_LEFT_SHARE):
 * - duas: head on top and the buttons at the foot of the left column, the branches stacked in the right one;
 * - compacta: the head, then close and confirm, in one row; the branches side by side under it (obra.css moves their
 *   cost under the name and drops the effect line there; it stays in the aria-label).
 */
function landscapeBoxes(form:'duas'|'compacta',panel:Rect,card:number,n:number):Boxes{
  const {x}=panel,inner=panel.width-OBRA_PAD*2,colL=Math.round(inner*OBRA_LEFT_SHARE),colR=inner-colL-OBRA_GAP;
  const top=panel.y+OBRA_PAD,rows:Rect[]=[];
  if(form==='compacta'){
    const head={x:x+OBRA_PAD,y:top,width:colR,height:card};
    const close={x:right(head)+OBRA_GAP,y:top,width:OBRA_BUTTON,height:OBRA_BUTTON};
    const confirm={x:right(close)+OBRA_GAP,y:top,width:colL-OBRA_BUTTON-OBRA_GAP,height:OBRA_BUTTON};
    const y=top+Math.max(card,OBRA_BUTTON)+OBRA_GAP,cw=n?(inner-(n-1)*OBRA_GAP)/n:0;
    for(let i=0;i<n;i++)rows.push({x:x+OBRA_PAD+i*(cw+OBRA_GAP),y,width:cw,height:card});
    return {form,panel,head,rows,confirm,close};
  }
  const foot=bottom(panel)-OBRA_PAD-OBRA_BUTTON;
  const head={x:x+OBRA_PAD,y:top,width:n?colL:inner,height:card};
  const close={x:x+OBRA_PAD,y:foot,width:OBRA_BUTTON,height:OBRA_BUTTON};
  const confirm={x:x+OBRA_PAD+OBRA_BUTTON+OBRA_GAP,y:foot,width:(n?colL:inner)-OBRA_BUTTON-OBRA_GAP,height:OBRA_BUTTON};
  for(let i=0;i<n;i++)rows.push({x:x+OBRA_PAD+colL+OBRA_GAP,y:top+i*(card+OBRA_GAP),width:colR,height:card});
  return {form,panel,head,rows,confirm,close};
}

/** A ground marker's 48 px box centred on its screen point, clamped into `area` (the useful field). */
export function markerRect(point:{x:number;y:number},area:Rect,size=OBRA_MARKER):Rect&{clamped:boolean}{
  const half=size/2;
  const cx=Math.min(Math.max(point.x,area.x+half),right(area)-half),cy=Math.min(Math.max(point.y,area.y+half),bottom(area)-half);
  return {x:cx-half,y:cy-half,width:size,height:size,clamped:cx!==point.x||cy!==point.y};
}

/**
 * How far (px) a marker's 48 px box may stick out of the useful area and still show (clamped those few px back in).
 * Farther out its site is off screen: the marker hides instead of piling up on the area's edge with the others (the
 * live test had six sites and the rail on one point, only the top one tappable).
 */
export const MARKER_SLACK=8;
export interface MarkerPlan {
  /** The markers on screen, in DOM order (the last one is on top), at their final boxes. */
  shown:{id:string;rect:Rect}[];
  /** Sites whose point is off the useful area (no marker): the nearest of them get edge arrows (obraArrows). */
  hidden:string[];
}

/**
 * The markers of one frame (pure): which sites show, where, and in which order.
 * - A site shows when its marker box sticks out of `area` by at most MARKER_SLACK; then it is clamped in. `keep` (the
 *   open site) always shows, clamped: the player is working on it.
 * - Markers closer than OBRA_MARKER on both axes are nudged apart symmetrically (a few passes over the pairs in id
 *   order, along the axis that needs the shorter move), then clamped back into `area`. Should two still cross (a
 *   crowd against an edge), the one nearest the area's centre is last, on top, so the tap there is deterministic.
 * - The hidden ones are listed (no marker): obraArrows points at the nearest of them from the rim.
 */
export function planMarkers(points:readonly {id:string;x:number;y:number}[],area:Rect,options:{keep?:string}={}):MarkerPlan{
  const S=OBRA_MARKER,half=S/2,slack=MARKER_SLACK;
  const fits=(p:{x:number;y:number})=>p.x-half>=area.x-slack&&p.x+half<=right(area)+slack&&p.y-half>=area.y-slack&&p.y+half<=bottom(area)+slack;
  const visible=points.filter(p=>p.id===options.keep||fits(p)),hiddenPts=points.filter(p=>!visible.includes(p));
  const clampX=(x:number)=>Math.min(Math.max(x,area.x+half),right(area)-half),clampY=(y:number)=>Math.min(Math.max(y,area.y+half),bottom(area)-half);
  const order=[...visible].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const c=order.map(p=>({id:p.id,x:clampX(p.x),y:clampY(p.y)}));
  for(let pass=0;pass<4;pass++){
    let moved=false;
    for(let i=0;i<c.length;i++)for(let j=i+1;j<c.length;j++){
      const dx=c[j].x-c[i].x,dy=c[j].y-c[i].y,ox=S-Math.abs(dx),oy=S-Math.abs(dy);
      if(ox<=0||oy<=0)continue;
      moved=true;
      // Same point: the lower id goes left (deterministic).
      if(ox<=oy){const s=dx<0?-1:1;c[i].x-=s*ox/2;c[j].x+=s*ox/2;}
      else{const s=dy<0?-1:1;c[i].y-=s*oy/2;c[j].y+=s*oy/2;}
    }
    for(const m of c){m.x=clampX(m.x);m.y=clampY(m.y);}
    if(!moved)break;
  }
  const mid={x:area.x+area.width/2,y:area.y+area.height/2},far=(m:{x:number;y:number})=>Math.hypot(m.x-mid.x,m.y-mid.y);
  // Farthest from the centre first: the nearest is drawn last (on top). Ties by id.
  const shown=[...c].sort((a,b)=>far(b)-far(a)||(a.id<b.id?-1:a.id>b.id?1:0)).map(m=>({id:m.id,rect:{x:m.x-half,y:m.y-half,width:S,height:S}}));
  return {shown,hidden:hiddenPts.map(p=>p.id)};
}

/** At most this many edge arrows for the sites off screen (the card: the 1–3 nearest). */
export const OBRA_ARROWS=3;
/** A site's screen point and, when the host knows it, its world distance from the hero. */
export interface ObraPoint {id:string;x:number;y:number;distance?:number}
/**
 * The `max` nearest of the `hidden` sites: by world distance from the hero when every one has it, else (the sandbox) by
 * screen distance from the field's centre. Ties by id, so the pick never flickers between equals.
 */
export function nearestHidden(points:readonly ObraPoint[],hidden:readonly string[],area:Rect,max=OBRA_ARROWS):ObraPoint[]{
  const set=new Set(hidden),list=points.filter(p=>set.has(p.id));
  const world=list.every(p=>p.distance!==undefined&&Number.isFinite(p.distance));
  const mid={x:area.x+area.width/2,y:area.y+area.height/2};
  const d=(p:ObraPoint)=>world?p.distance!:Math.hypot(p.x-mid.x,p.y-mid.y);
  return list.sort((a,b)=>d(a)-d(b)||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,Math.max(0,max));
}
export interface ObraArrowOptions {
  /** The hero's box on screen: no arrow covers it (layoutEdges' keep-out). */
  hero?:Rect;
  /** The edge arrows already drawn (EdgeArrows.shown: the base's ficha, a caído…): the obra arrows step aside from them. */
  placed?:readonly EdgeArrow[];
  /** The viewport: every beak stays inside it (the city's rim rules). */
  viewport?:{width:number;height:number};
  /** Text scale (1 or 1.25): the ficha's width grows with it. */
  scale?:number;
  max?:number;
  /**
   * The on-screen markers' 48 px boxes (MarkerPlan.shown): no arrow (nor its hit area, OBRA_ARROW_HIT) may touch one, or
   * a tap there would open the arrow's site instead of the marker's. A marker may stick MARKER_SLACK past the field's
   * edge, right where the arrows run.
   */
  markers?:readonly Rect[];
}
/** How far an obra arrow's hit area reaches past its ficha (obra.css .rh-obra-borda::after: 8 px above and below). */
export const OBRA_ARROW_HIT=8;
/**
 * Where an arrow aims for a hidden site: its screen point, or, when that point is still inside the field (a marker less
 * than 16 px inside the edge does not fit, planMarkers hides it), the field's nearest edge 1 px outside, level with it.
 * layoutEdges only points at targets outside the field, and such a site must not end up with no marker and no arrow.
 */
export function aimOf(p:{x:number;y:number},area:Rect):{x:number;y:number}{
  const x0=area.x,x1=right(area),y0=area.y,y1=bottom(area);
  if(p.x<x0||p.x>x1||p.y<y0||p.y>y1)return {x:p.x,y:p.y};
  const d=[p.x-x0,x1-p.x,p.y-y0,y1-p.y],k=d.indexOf(Math.min(...d));
  return k===0?{x:x0-1,y:p.y}:k===1?{x:x1+1,y:p.y}:k===2?{x:p.x,y:y0-1}:{x:p.x,y:y1+1};
}
/** How many of the nearest hidden sites are tried for the `max` arrows (a short landscape rim may refuse some). */
export const OBRA_ARROW_TRIES=8;
/**
 * The hero's keep-out for the obra arrows (CSS px): beside the hero, never on it. The HUD's HERO_MARGIN (40) plus the
 * top and bottom rims' HEAD_ROOM left no rim at all at the camp: the forge takes the lower half and the live field was
 * 310 x 169 px around a 103 x 59 hero (portrait), so no arrow could show. The intermission has no danger to read
 * around the hero, and these arrows are where the player looks next.
 */
export const OBRA_HERO_MARGIN=12;
/**
 * The edge arrows of the off-screen sites (pure): the nearest hidden ones (nearestHidden), as kind 'obra' with the site
 * id as key, placed one by one by layoutEdges on the useful area's rim around the arrows already there (the HUD's, then
 * the obra ones before). Never covers the hero, a placed arrow, an on-screen marker or another obra arrow, and never folds two sites into
 * one "+1" (each arrow opens exactly the site it points at): a site with no free spot left is skipped for the next
 * nearest, up to `max` arrows out of OBRA_ARROW_TRIES tries.
 */
export function obraArrows(points:readonly ObraPoint[],hidden:readonly string[],area:Rect,options:ObraArrowOptions={}):EdgeArrow[]{
  const max=options.max??OBRA_ARROWS,v=options.viewport,out:EdgeArrow[]=[];
  if(max<=0)return out;
  const h=OBRA_ARROW_HIT,avoid=(options.markers??[]).map(r=>({x:r.x-h,y:r.y-h,width:r.width+2*h,height:r.height+2*h}));
  const base={city:true,max:1,margin:OBRA_HERO_MARGIN,mustPoint:()=>false,half:arrowHalf(options.scale??1),...(v?{bounds:{x:0,y:0,width:v.width,height:v.height}}:{}),
    ...(avoid.length?{avoid}:{})};
  for(const p of nearestHidden(points,hidden,area,Math.max(max,OBRA_ARROW_TRIES))){
    const t:EdgeTarget={key:p.id,kind:'obra',screen:aimOf(p,area),distance:p.distance??0};
    const [a]=layoutEdges([t],area,options.hero,{...base,placed:[...options.placed??[],...out]});
    if(a)out.push(a);
    if(out.length>=max)break;
  }
  return out;
}

