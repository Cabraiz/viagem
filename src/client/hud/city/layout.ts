/**
 * City HUD layout (NEW-20261012-ORQ-cidade-ux-01, design/cidade-hud.md §0–§5): where the city minimap goes (collapsed and
 * big), the rail of the edge arrows' centres and the lobby map selector, per orientation, text scale (100/125%), notch
 * and an open offer/forge window. Mobile only (D-009). Pure geometry over the measured controls: the zones come from
 * computeZones with the collapsed minimap in them, every other number from the CSS rules the doc quotes.
 */
import {computeZones,crosses,gap,inflate,orientationOf,right,bottom,arrowHalf,RIM_PAD,TAG_ROOM,NAME_ROOM,THUMB_GAP,EDGE_COLUMN,
  type Rect,type ZoneInput,type ScreenZones} from './deps.ts';

export type Orientation='portrait'|'landscape';
export interface Insets {top:number;right:number;bottom:number;left:number}
export type CityControls=Omit<ZoneInput,'viewport'|'safe'|'minimap'>;
export interface CityLayoutInput {
  viewport:{width:number;height:number};
  /** Raw safe-area insets (notch); the HUD's own 8 px floor (--sa-*, --rh-*) is applied here. Default 0. */
  safe?:Insets;
  /** --t-escala (UX-acessibilidade). */
  textScale?:1|1.25;
  /** The offer or the forge is open: in landscape the minimap moves to the left column (janela-esconde-caido). */
  windowOpen?:boolean;
  /** Measured rects (status rows with the camera buttons and the gear, team, joystick, skill, emote, chip, offer). */
  controls:CityControls;
}
export interface CityLayout {
  orientation:Orientation;
  /** computeZones with the collapsed minimap included. */
  zones:ScreenZones;
  /** Collapsed minimap (76×76), the `.rh-minimap` slot. */
  minimap:Rect;
  /** Big minimap, anchored on the collapsed one's outer corner; undefined when its side would be < BIG_MIN_SIDE. */
  minimapBig?:Rect;
  /**
   * The announcement slot as hud.css draws it (.rh-stack): portrait right of the team column under the top band,
   * landscape between the camera buttons and the gear's column. The big minimap stays clear of it when it can.
   */
  announce:Rect;
  /**
   * No big minimap of BIG_MIN_SIDE or more fits beside the slot (portrait: the slot spans the width right under the
   * collapsed one), so `minimapBig` covers it: it never opens while a notice is up and closes when one comes in
   * (minimap.ts blockReason / bigShouldClose with coversAnnounce).
   */
  bigCoversAnnounce:boolean;
  /** Where the edge arrows' centres may run (useful area minus the ficha, its pad, the tag and the caído's name). */
  arrowRail:Rect;
  /** Lobby selector box (portrait: the control in the waiting window; landscape: the small Lilás window). */
  selector:Rect;
  /** [cidade, infinito] touch targets. */
  segments:[Rect,Rect];
  /** Hero sprite (56 px) at the centre of the useful area, where the follow camera keeps it (doc §0). */
  hero:Rect;
  /** Portrait only: the selector's hint line under it ("Quem escolhe o mapa é o dono da sala."). */
  selectorHint?:Rect;
}

export const MINIMAP_SIDE=76,BIG_MIN_SIDE=120;
/**
 * The WC3 minimap's side in CSS px (hud.css .rh-mm: clamp(124px, 30vmin, 210px)), the box the slot really takes now;
 * MINIMAP_SIDE stays the old diamond drawing's unit (city/minimap.ts).
 */
export function wcMinimapSide(viewport:{width:number;height:number}){return Math.round(Math.min(210,Math.max(124,.3*Math.min(viewport.width,viewport.height))));}
/** Largest side of the big minimap (doc §2): portrait, landscape, landscape with the offer/forge open. */
export const BIG_MAX_SIDE={portrait:232,landscape:176,window:164} as const;
/** The hero's sprite at the follow zoom (zones.ts MIN_PLAY_SIDE), and what the big minimap keeps from its zone (± 40). */
export const HERO_SIDE=56,BIG_HERO_GAP=8;
/** The HUD's own safe-area floor (tokens.css --sa-*: max(8px, env())). */
export const HUD_FLOOR=8;
/** Room the big minimap keeps from the announcement slot (the same 4 px the slot keeps from the top band). */
export const ANNOUNCE_GAP=4;
/** Lobby selector (doc §4): control height per text scale, the landscape window and its stacked segments. */
export const SELECTOR={height:{1:64,1.25:84},hint:{1:20,1.25:44},window:{width:112,height:144,pad:6,gap:4,segment:64}} as const;

const NO_INSETS:Insets={top:0,right:0,bottom:0,left:0};
const floor8=(v:number)=>Math.max(HUD_FLOOR,v);

/**
 * Collapsed minimap (hud.css .rh-minimap): portrait under the gear, top --rh-t + 64, right --rh-r; landscape top
 * --rh-t + 52, right max(14, safe); with a window open in landscape, the left column 24 px under the camera buttons
 * (48 px at max(12, safe top)), left max(14, safe).
 */
export function minimapRect(viewport:{width:number;height:number},safe:Insets=NO_INSETS,windowOpen=false):Rect{
  const s=wcMinimapSide(viewport);
  // Portrait under the gear, or under the top band's two rows on a narrow phone (hud.css .rh-mm, hud-topo-uma-linha).
  if(orientationOf(viewport)==='portrait')return {x:viewport.width-floor8(safe.right)-s,y:floor8(safe.top)+(viewport.width<600?94:64),width:s,height:s};
  if(windowOpen)return {x:Math.max(14,safe.left),y:Math.max(12,safe.top)+48+24,width:s,height:s};
  return {x:viewport.width-Math.max(14,safe.right)-s,y:floor8(safe.top)+52,width:s,height:s};
}

/**
 * The announcement slot (hud.css .rh-stack): portrait at the zones' announce y (--rh-anuncio), from --rh-l + max(70,
 * team column + 16) to --rh-r + 8; landscape at --rh-t + 82, from --rh-l + 150 to --rh-r + 290. Height: the zones' slot.
 */
export function announceSlot(zones:ScreenZones,safe:Insets=NO_INSETS,team?:Rect):Rect{
  const {viewport}=zones,h=zones.announce.height;
  if(zones.orientation==='portrait'){
    const x=floor8(safe.left)+Math.max(70,(team&&team.height>team.width?team.width:54)+16);
    return {x,y:zones.announce.y,width:Math.max(0,viewport.width-floor8(safe.right)-8-x),height:h};
  }
  const x=floor8(safe.left)+150;
  return {x,y:floor8(safe.top)+82,width:Math.max(0,viewport.width-floor8(safe.right)-290-x),height:h};
}

/** The hero's box at the centre of the useful area (whole px, as the follow camera rounds it). */
export function heroRect(useful:Rect):Rect{
  return {x:Math.floor(useful.x+(useful.width-HERO_SIDE)/2),y:Math.floor(useful.y+(useful.height-HERO_SIDE)/2),width:HERO_SIDE,height:HERO_SIDE};
}

export interface BigSideInput {
  /** The collapsed minimap's outer top corner, where the big one is anchored. */
  corner:{x:number;y:number};
  /** Which way the square grows from the corner (it always grows down). */
  toward:'left'|'right';
  /** Smax for this case (BIG_MAX_SIDE). */
  max:number;
  /** Hero ± HERO_MARGIN. */
  heroZone:Rect;
  viewport:{width:number;height:number};
  safe?:Insets;
  /** Joystick, skill, emote, chip: the big minimap keeps THUMB_GAP from each. */
  controls:readonly (Rect|undefined)[];
  /** Team strip: the big minimap keeps 8 px from it (right of the column + 8). */
  team?:Rect;
  /** Boxes the square must not cross, ANNOUNCE_GAP apart (the announcement slot). */
  avoid?:readonly Rect[];
}
/** The square of side `s` hanging from the corner. */
export const bigSquare=(corner:{x:number;y:number},toward:'left'|'right',s:number):Rect=>({x:toward==='left'?corner.x-s:corner.x,y:corner.y,width:s,height:s});
/**
 * Doc §2: S = min(Smax, max(heroZone.y − 8 − top, edge − heroZone's near side − 8)), then shrunk until it keeps 24 px
 * from the joystick, the skill, the emote and the chip, 8 px from the team strip, ANNOUNCE_GAP from what `avoid` lists
 * and stays in the viewport. Whole px.
 * A result < BIG_MIN_SIDE means the big minimap does not open.
 */
export function bigMinimapSide(input:BigSideInput):number{
  const {corner,toward,heroZone:hz,viewport}=input,safe=input.safe??NO_INSETS;
  const below=hz.y-BIG_HERO_GAP-corner.y;
  const beside=toward==='left'?corner.x-right(hz)-BIG_HERO_GAP:hz.x-BIG_HERO_GAP-corner.x;
  const controls=input.controls.filter((r):r is Rect=>!!r&&r.width>0&&r.height>0);
  const fits=(r:Rect)=>r.x>=safe.left&&r.y>=safe.top&&right(r)<=viewport.width-safe.right&&bottom(r)<=viewport.height-safe.bottom
    &&!crosses(r,hz,BIG_HERO_GAP)&&controls.every(c=>gap(r,c)>=THUMB_GAP)&&!(input.team&&crosses(r,input.team,8))
    &&(input.avoid??[]).every(a=>!crosses(r,a,ANNOUNCE_GAP));
  let s=Math.floor(Math.min(input.max,Math.max(below,beside)));
  while(s>0&&!fits(bigSquare(corner,toward,s)))s--;
  return Math.max(0,s);
}

/** Centres of the edge arrows (edges.ts placeEdges): the useful area shrunk by the ficha + RIM_PAD, TAG_ROOM on top and NAME_ROOM under. */
export function arrowRailOf(useful:Rect,textScale=1):Rect{
  const half=arrowHalf(textScale),hw=Math.min(half.w+RIM_PAD,useful.width/2),hh=Math.min(half.h+RIM_PAD,useful.height/2);
  const top=Math.min(TAG_ROOM,Math.max(0,useful.height-2*hh)),under=Math.min(NAME_ROOM,Math.max(0,useful.height-2*hh-top));
  return {x:useful.x+hw,y:useful.y+hh+top,width:Math.max(0,useful.width-2*hw),height:Math.max(0,useful.height-2*hh-top-under)};
}

/**
 * Lobby selector (doc §4). Portrait: in the waiting window (coop.css .coop-wait: width min(360, 100% − 32) centred, top
 * max(122, safe + 114)), under the code row (border + padding 16, row 48, gap 8). Landscape: a small window in the column
 * opposite the notch (tie: right), 24 px under the gear (48 px at max(12, safe top)).
 */
export function selectorRects(viewport:{width:number;height:number},safe:Insets=NO_INSETS,textScale:1|1.25=1):{selector:Rect;segments:[Rect,Rect];hint?:Rect}{
  if(orientationOf(viewport)==='portrait'){
    const w=Math.min(360,viewport.width-32),wx=(viewport.width-w)/2,wy=Math.max(122,safe.top+114);
    const x=wx+16,y=wy+16+48+8,width=w-32,height=SELECTOR.height[textScale],half=width/2;
    return {selector:{x,y,width,height},segments:[{x,y,width:half,height},{x:x+half,y,width:half,height}],hint:{x,y:y+height+8,width,height:SELECTOR.hint[textScale]}};
  }
  const k=SELECTOR.window,onLeft=safe.right>safe.left;
  const x=onLeft?Math.max(14,safe.left):viewport.width-Math.max(14,safe.right)-k.width,y=Math.max(12,safe.top)+48+24;
  const seg=(i:number):Rect=>({x:x+k.pad,y:y+k.pad+i*(k.segment+k.gap),width:k.width-2*k.pad,height:k.segment});
  return {selector:{x,y,width:k.width,height:k.height},segments:[seg(0),seg(1)]};
}

/** The whole city HUD layout for one screen. */
export function cityHudLayout(input:CityLayoutInput):CityLayout{
  const {viewport,controls}=input,safe=input.safe??NO_INSETS,scale=input.textScale??1;
  const orientation=orientationOf(viewport),windowOpen=orientation==='landscape'&&!!input.windowOpen;
  const minimap=minimapRect(viewport,safe,windowOpen);
  const zones=computeZones({...controls,viewport,safe,minimap});
  const hero=heroRect(zones.useful),heroZone=inflate(hero,40);
  // Anchored on the collapsed one's outer corner: the right one grows left, the left-column one grows right.
  const toward=minimap.x+minimap.width/2>viewport.width/2?'left':'right';
  const corner={x:toward==='left'?right(minimap):minimap.x,y:minimap.y};
  const max=orientation==='portrait'?BIG_MAX_SIDE.portrait:windowOpen?BIG_MAX_SIDE.window:BIG_MAX_SIDE.landscape;
  const announce=announceSlot(zones,safe,controls.team);
  const big:BigSideInput={corner,toward,max,heroZone,viewport,safe,controls:[controls.joystick,controls.skill,controls.emote,controls.chip],team:controls.team};
  // Clear of the announcement slot when a big enough square fits so; else the doc's square over it, ruled by the notices.
  const clear=bigMinimapSide({...big,avoid:[announce]}),side=clear>=BIG_MIN_SIDE?clear:bigMinimapSide(big);
  const {selector,segments,hint}=selectorRects(viewport,safe,scale);
  return {orientation,zones,minimap,...(side>=BIG_MIN_SIDE?{minimapBig:bigSquare(corner,toward,side)}:{}),
    announce,bigCoversAnnounce:clear<BIG_MIN_SIDE&&side>=BIG_MIN_SIDE,
    arrowRail:arrowRailOf(zones.useful,scale),selector,segments,hero,...(hint?{selectorHint:hint}:{})};
}

// ---------- Reference controls (doc §0, tests/zones.test.ts) ----------
const r=(x:number,y:number,width:number,height:number):Rect=>({x,y,width,height});
/** The gear (explore.css .explore-config) per orientation; it is also the last status row of REFERENCE_CONTROLS. */
export const REFERENCE_GEAR={portrait:r(324,18,48,48),landscape:r(782,12,48,48)} as const;
export const REFERENCE_VIEWPORT={portrait:{width:390,height:844},landscape:{width:844,height:390}} as const;
/** The notch of the doc's cases: 47 px on top in portrait, on the left in landscape. */
export const REFERENCE_NOTCH={portrait:{top:47,right:0,bottom:0,left:0},landscape:{top:0,right:0,bottom:0,left:47}} as const;
/** Controls at 100% without a notch: status = camera button, round chip, XP, gear. */
export const REFERENCE_CONTROLS:{readonly portrait:CityControls;readonly landscape:CityControls}={
  portrait:{status:[r(14,12,44,44),r(166,8,142,46),r(8,72,292,26),REFERENCE_GEAR.portrait],team:r(8,120,54,380),
    joystick:r(24,708,112,112),skill:r(284,738,82,82),emote:r(301,666,48,48)},
  landscape:{status:[r(14,12,44,44),r(330,8,180,40),r(212,52,420,20),REFERENCE_GEAR.landscape],team:r(258,318,328,64),
    joystick:r(18,278,96,96),skill:r(746,292,82,82)},
};
/** --botao-habilidade (tokens.css): 14 + 80 × --t-escala. */
export const skillSide=(scale:number)=>14+80*scale;
/**
 * Controls at a text scale (doc §0): the skill button grows to --botao-habilidade keeping its bottom-right corner, the
 * emote keeps its gap above it and its centre line, the chip its gap to the left and its middle. Scale 1 is unchanged.
 */
export function scaled(controls:CityControls,scale:number):CityControls{
  const skill=controls.skill;
  if(scale===1||!skill)return controls;
  const s=skillSide(scale),next:Rect={x:right(skill)-s,y:bottom(skill)-s,width:s,height:s};
  const cx=next.x+s/2,cy=next.y+s/2,e=controls.emote,c=controls.chip;
  return {...controls,skill:next,
    ...(e?{emote:{...e,x:cx-(skill.x+skill.width/2-e.x),y:next.y-(skill.y-e.y)}}:{}),
    ...(c?{chip:{...c,x:next.x-(skill.x-c.x),y:cy-(skill.y+skill.height/2-c.y)}}:{})};
}
/**
 * Controls under a notch (doc §0), for the reference cases (live rects are measured already in place). Portrait: the
 * top band's rows go down by max(8, top) − 8. Landscape: what hugs the left edge (camera buttons, joystick) starts at
 * the inset at least, and what hugs the right edge (gear, skill, emote, chip) ends before it.
 */
export function notched(controls:CityControls,safe:Insets,viewport:{width:number;height:number}):CityControls{
  if(orientationOf(viewport)==='portrait'){
    const dy=floor8(safe.top)-HUD_FLOOR;
    return dy?{...controls,status:controls.status.map(s=>s&&{...s,y:s.y+dy})}:controls;
  }
  const edge=viewport.width-safe.right;
  const fit=(s:Rect|undefined):Rect|undefined=>{
    if(!s)return s;
    if(s.x<EDGE_COLUMN)return {...s,x:Math.max(s.x,safe.left)};
    if(right(s)>viewport.width-EDGE_COLUMN)return {...s,x:Math.min(s.x,edge-s.width)};
    return s;
  };
  return {...controls,status:controls.status.map(fit),joystick:fit(controls.joystick),skill:fit(controls.skill),emote:fit(controls.emote),chip:fit(controls.chip)};
}
/** A full reference input (doc §5 cases): orientation × 100/125% × notch × window open. */
export function referenceInput(orientation:Orientation,options:{textScale?:1|1.25;notch?:boolean;windowOpen?:boolean}={}):CityLayoutInput{
  const viewport=REFERENCE_VIEWPORT[orientation],textScale=options.textScale??1;
  const safe:Insets=options.notch?{...REFERENCE_NOTCH[orientation]}:{...NO_INSETS};
  return {viewport:{...viewport},safe,textScale,windowOpen:!!options.windowOpen,controls:notched(scaled(REFERENCE_CONTROLS[orientation],textScale),safe,viewport)};
}
