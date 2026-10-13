/**
 * Framing of the kill-cam (VGM-053B, design review D4): pure, so node tests can check that the critter and its line
 * stay inside the TV. The camera looks at the middle of the knock-out (between the feet and the top of the hop), with
 * a zoom that keeps the critter at least KILLCAM_MIN_CRITTER_CSS tall; the critter reels, hops spinning as high as the
 * picture allows, goes poof, and its death line takes the middle of the picture, scaled to fit.
 */
export const KILLCAM_MIN_CRITTER_CSS=40;
/** Margin kept inside the TV, CSS px. */
export const KILLCAM_SAFE_CSS=8;
/** Phases (share of the kill-cam): it reels until KO_HIT, hops until POOF_AT, then the poof and the line. */
export const KO_HIT=.3,POOF_AT=.62;

export interface Art {width:number;height:number;originY:number}
export interface KillcamInput {
  /** The TV's picture, CSS px. */
  tv:{width:number;height:number};
  mainZoom:number;art:Art;feet:{x:number;y:number};
  /**
   * World px multiplier of the critters in the main view (framing.ts CITY_VIEW_SCALE in the city, default 1). The
   * kill-cam's copy is drawn at its art size, so it measures the main zoom as mainZoom × actorScale: the same TV
   * framing and the same CSS size of the critter in the city as on the endless map.
   */
  actorScale?:number;
  /** 0..1 of the kill-cam. */
  t:number;reduced:boolean;
  /** Natural size of the death line (world px at scale 1). */
  pop:{width:number;height:number};
}
export interface KillcamFrame {
  zoom:number;center:{x:number;y:number};
  ghost:{x:number;y:number;rotation:number;scale:number;visible:boolean};
  pop:{x:number;y:number;scale:number;visible:boolean};
  puff:{visible:boolean;scale:number;alpha:number};
  /** How high the hop goes (world px), 0 when the picture has no room. */
  arc:number;
}

/** Half-size of the critter's box while it tilts (it hops tilted, never a full spin: the picture is small). */
export const TILT=.6;
const boxOf=(art:Art)=>Math.max(art.width,art.height)*1.05;

export function killcamFrame(i:KillcamInput):KillcamFrame{
  const {tv,art,feet,t,reduced}=i;
  const box=boxOf(art);
  // At least KILLCAM_MIN_CRITTER_CSS of critter, but never more than the picture holds (a tall TV in portrait gets a hop).
  const fit=(tv.height-2*KILLCAM_SAFE_CSS)/box;
  const zoom=Math.min(fit,Math.max(i.mainZoom*(i.actorScale??1),KILLCAM_MIN_CRITTER_CSS/art.height));
  const safe=KILLCAM_SAFE_CSS/zoom,visibleH=tv.height/zoom,visibleW=tv.width/zoom;
  const arc=reduced?0:Math.max(0,visibleH-2*safe-box);
  // The ghost is drawn from its middle (origin .5,.5): its rest centre, and the camera on the middle of the hop.
  const rest=feet.y-art.height*(art.originY-.5);
  const center={x:feet.x,y:rest-arc/2};
  let gy=rest,rotation=0,scale=1,visible=true;
  if(reduced){rotation=Math.PI/2;visible=t<.55;}
  else if(t<KO_HIT){const w=Math.sin(t/KO_HIT*Math.PI*3);scale=1+.06*w;rotation=.12*w;}
  else if(t<POOF_AT){const u=(t-KO_HIT)/(POOF_AT-KO_HIT);gy=rest-arc*Math.sin(u*Math.PI);rotation=TILT*Math.sin(u*Math.PI*2);scale=1-.15*u;}
  else visible=false;
  const popScale=Math.min(1,(visibleW-2*safe)/Math.max(1,i.pop.width),(visibleH-2*safe)/Math.max(1,i.pop.height));
  const poofAt=reduced?.55:POOF_AT;
  return {
    zoom,center,arc,
    ghost:{x:feet.x,y:gy,rotation,scale,visible},
    pop:{x:center.x,y:center.y,scale:popScale,visible:t>=poofAt},
    puff:{visible:t>=poofAt&&t<poofAt+.22,scale:reduced?1:1+2*(t-poofAt),alpha:reduced?.9:Math.max(0,1-(t-poofAt)*4.5)},
  };
}

/** The critter's and the line's boxes on the TV (CSS px), for the tests: both must stay inside the safe margin. */
export function killcamBoxes(i:KillcamInput,f:KillcamFrame){
  const toTv=(x:number,y:number)=>({x:(x-f.center.x)*f.zoom+i.tv.width/2,y:(y-f.center.y)*f.zoom+i.tv.height/2});
  const half=boxOf(i.art)/2*f.ghost.scale,g=toTv(f.ghost.x,f.ghost.y),p=toTv(f.pop.x,f.pop.y);
  return {
    ghost:{left:g.x-half*f.zoom,right:g.x+half*f.zoom,top:g.y-half*f.zoom,bottom:g.y+half*f.zoom},
    pop:{left:p.x-i.pop.width*f.pop.scale*f.zoom/2,right:p.x+i.pop.width*f.pop.scale*f.zoom/2,top:p.y-i.pop.height*f.pop.scale*f.zoom/2,bottom:p.y+i.pop.height*f.pop.scale*f.zoom/2},
  };
}
