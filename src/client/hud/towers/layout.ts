/**
 * Build menu layout (torres-hud, D-009 mobile, D-020 Janela & Etiqueta): where the obra window and the ground markers
 * go, from the zone model (zones.ts). Pure, node-tested; the DOM (obra.ts) places its boxes at exactly these rects.
 * - The window never scrolls: its height is its content (the head card, up to 3 branch cards, the confirm row).
 *   Portrait: one column across the useful width, bottom-anchored right above the thumbs (the confirm row is the
 *   thumb's reach). Landscape: two columns at the right, bottom-anchored above the right thumb: the head and the
 *   confirm row on the left, the branch cards on the right.
 * - It clears both thumbs by ≥ THUMB_GAP (it stops at the inflated thumb zones), stays inside the safe area and under
 *   the status rows, and leaves the field a band that holds the hero ± HERO_MARGIN (computeZones with it as `offer`).
 * - Cards are ≥ 44 px targets; the confirm and close buttons 48 px. Heights follow the text scale (100 % or 125 %).
 * - Ground markers are 48 px targets centred on the sites' screen points, clamped into the useful area.
 */
import {MIN_PLAY_SIDE,bottom,computeZones,right,type Orientation,type Rect,type ScreenZones,type ZoneInput} from '../zones.ts';

export const OBRA_PAD=8,OBRA_GAP=6,OBRA_BUTTON=48,OBRA_TARGET=44,OBRA_MARKER=48,OBRA_EDGE=8;
/** Widest window (landscape); the left column's share there. */
export const OBRA_MAX_WIDTH=520,OBRA_LEFT_SHARE=.4;
/** Text lines of a card: the name (16 px × scale, line 1.15) and the effect (13 px × scale, line 1.2), 4 px above and below. */
export const cardHeight=(scale:number)=>Math.max(OBRA_TARGET,Math.ceil(8+16*scale*1.15+13*scale*1.2));
export const HERO_SIDE=56;

export interface ObraLayout {
  orientation:Orientation;
  panel:Rect;head:Rect;branches:Rect[];confirm:Rect;close:Rect;
  /** The zones with the window open (it is the `offer` that trims the field) and the hero the camera centres there. */
  zones:ScreenZones;hero:Rect;
  /** Content height against the window's: equal by construction (no scroll). */
  contentHeight:number;
  /** False when the window could not fit (it would cover the status rows or leave no field for the hero). */
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
  const statusBottom=base.announce.y;// the status rows end 4 px above the announcement band
  const floor=vh-safe.bottom;
  const thumbTops=[base.leftThumb,base.rightThumb].filter((r):r is Rect=>!!r);
  let panel:Rect,head:Rect,confirm:Rect,close:Rect,rows:Rect[]=[],contentHeight:number,minTop:number;
  if(base.orientation==='portrait'){
    // One column over the useful width (right of the team column), right above the higher thumb.
    const u=base.useful,x=u.x,w=Math.min(u.width,vw-safe.right-x);
    const yBottom=Math.min(floor,...thumbTops.map(t=>t.y));
    contentHeight=OBRA_PAD*2+card+(n?n*(card+OBRA_GAP):0)+OBRA_GAP+OBRA_BUTTON;
    panel={x,y:yBottom-contentHeight,width:w,height:contentHeight};
    const inner=w-OBRA_PAD*2;
    let y=panel.y+OBRA_PAD;
    head={x:x+OBRA_PAD,y,width:inner,height:card};y+=card+OBRA_GAP;
    for(let i=0;i<n;i++){rows.push({x:x+OBRA_PAD,y,width:inner,height:card});y+=card+OBRA_GAP;}
    close={x:x+OBRA_PAD,y,width:OBRA_BUTTON,height:OBRA_BUTTON};
    confirm={x:x+OBRA_PAD+OBRA_BUTTON+OBRA_GAP,y,width:inner-OBRA_BUTTON-OBRA_GAP,height:OBRA_BUTTON};
    minTop=bottom(base.top);
  }else{
    // Two columns at the right, above the right thumb (the joystick side keeps the field for the hero).
    const leftEdge=base.leftThumb?right(base.leftThumb):safe.left;
    let w=Math.max(0,Math.min(OBRA_MAX_WIDTH,vw-safe.right-leftEdge-MIN_PLAY_SIDE-OBRA_EDGE));
    const leftH=card+OBRA_GAP+OBRA_BUTTON,rightH=n?n*card+(n-1)*OBRA_GAP:0;
    contentHeight=OBRA_PAD*2+Math.max(leftH,rightH);
    const yBottomAt=(px:number,pw:number)=>{
      const team=input.team&&input.team.width>=input.team.height&&right(input.team)>px&&input.team.x<px+pw?input.team.y-8:Infinity;
      return Math.min(floor,team,...thumbTops.filter(t=>right(t)>px&&t.x<px+pw).map(t=>t.y));
    };
    // Right-aligned above the right thumb; when that is too short (a notch, 125 %), it moves left of the thumb, where
    // it may go down to the team row.
    let x=vw-safe.right-w,yBottom=yBottomAt(x,w);
    if(yBottom-contentHeight<statusBottom&&base.rightThumb){
      const xr=base.rightThumb.x,w2=Math.min(w,xr-(leftEdge+MIN_PLAY_SIDE+OBRA_EDGE));
      if(w2>0&&yBottomAt(xr-w2,w2)-contentHeight>=statusBottom){w=w2;x=xr-w2;yBottom=yBottomAt(x,w);}
    }
    panel={x,y:yBottom-contentHeight,width:w,height:contentHeight};
    const inner=w-OBRA_PAD*2,colL=Math.round(inner*OBRA_LEFT_SHARE),colR=inner-colL-OBRA_GAP;
    const top=panel.y+OBRA_PAD,foot=bottom(panel)-OBRA_PAD-OBRA_BUTTON;
    head={x:x+OBRA_PAD,y:top,width:n?colL:inner,height:card};
    close={x:x+OBRA_PAD,y:foot,width:OBRA_BUTTON,height:OBRA_BUTTON};
    confirm={x:x+OBRA_PAD+OBRA_BUTTON+OBRA_GAP,y:foot,width:(n?colL:inner)-OBRA_BUTTON-OBRA_GAP,height:OBRA_BUTTON};
    for(let i=0;i<n;i++)rows.push({x:x+OBRA_PAD+colL+OBRA_GAP,y:top+i*(card+OBRA_GAP),width:colR,height:card});
    minTop=statusBottom;
  }
  const zones=computeZones({...input,offer:panel}),hero=centredHero(zones.useful);
  const fieldFits=zones.useful.width>=MIN_PLAY_SIDE&&zones.useful.height>=MIN_PLAY_SIDE;
  const fits=panel.y>=minTop-.5&&panel.x>=safe.left-.5&&right(panel)<=vw-safe.right+.5&&fieldFits&&panel.width>0;
  return {orientation:base.orientation,panel,head,branches:rows,confirm,close,zones,hero,contentHeight,fits};
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
/** The one "+N obras" hint for the sites off screen: a small etiqueta, never a touch target. */
export const HINT_WIDTH=96,HINT_HEIGHT=28;
export interface MarkerPlan {
  /** The markers on screen, in DOM order (the last one is on top), at their final boxes. */
  shown:{id:string;rect:Rect}[];
  /** Sites whose point is off the useful area (no marker). */
  hidden:string[];
  /** One hint for the hidden sites: on the area's inner rim towards them, with their count. Absent when none hide. */
  hint?:{rect:Rect;count:number};
}

/**
 * The markers of one frame (pure): which sites show, where, and in which order.
 * - A site shows when its marker box sticks out of `area` by at most MARKER_SLACK; then it is clamped in. `keep` (the
 *   open site) always shows, clamped: the player is working on it.
 * - Markers closer than OBRA_MARKER on both axes are nudged apart symmetrically (a few passes over the pairs in id
 *   order, along the axis that needs the shorter move), then clamped back into `area`. Should two still cross (a
 *   crowd against an edge), the one nearest the area's centre is last, on top, so the tap there is deterministic.
 * - The hidden ones get at most one non-interactive hint ("+N obras") on the area's rim towards their mean point.
 */
export function planMarkers(points:readonly {id:string;x:number;y:number}[],area:Rect,options:{keep?:string;hint?:boolean}={}):MarkerPlan{
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
  const plan:MarkerPlan={shown,hidden:hiddenPts.map(p=>p.id)};
  if(options.hint!==false&&hiddenPts.length){
    const mx=hiddenPts.reduce((s,p)=>s+p.x,0)/hiddenPts.length,my=hiddenPts.reduce((s,p)=>s+p.y,0)/hiddenPts.length;
    // The mean point pushed onto the rim (inset by the hint's half size), like an edge arrow.
    const x0=area.x+HINT_WIDTH/2+4,x1=right(area)-HINT_WIDTH/2-4,y0=area.y+HINT_HEIGHT/2+4,y1=bottom(area)-HINT_HEIGHT/2-4;
    let hx=Math.min(Math.max(mx,x0),x1),hy=Math.min(Math.max(my,y0),y1);
    // Sites hidden on opposite sides average to a point inside: the hint still goes to the nearest rim, never mid-field.
    if(hx===mx&&hy===my){const d=[mx-x0,x1-mx,my-y0,y1-my],k=d.indexOf(Math.min(...d));if(k===0)hx=x0;else if(k===1)hx=x1;else if(k===2)hy=y0;else hy=y1;}
    plan.hint={count:hiddenPts.length,rect:{x:hx-HINT_WIDTH/2,y:hy-HINT_HEIGHT/2,width:HINT_WIDTH,height:HINT_HEIGHT}};
  }
  return plan;
}
