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
