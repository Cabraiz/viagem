/**
 * Screen zones contract (UX-zonas-tela). Every HUD piece lives in one zone, per orientation:
 * - top band: camera buttons, round chip, gear, XP, boss bar and the announcement slot (round/boss banner ≤ 2 lines
 *   for ≤ 1.8 s, fall/rescue/connection notices);
 * - team strip: left column (portrait) or bottom row between the thumbs (landscape);
 * - left thumb: joystick + THUMB_GAP; right thumb: skill + emote + offer chip (D-021) + Dona Cida (D-047) + THUMB_GAP;
 * - useful area: the rectangle left for play. Only the offer and the result may enter it. In the round the follow
 *   camera (D-019, framing.ts FollowCamera) does not centre the hero on it: the hero's body sits at the viewport centre
 *   (BUG-20261013-ORQ-camera-centro-heroi), so it may stand outside this area and the HUD clears the hero's real box
 *   (scene.heroScreenRect: the veil, the edge arrows). Only the lobby (the free band beside the waiting panel), an
 *   open obra window and, in portrait, the forge or Dona Cida's tray when it would cover the centred hero centre it on
 *   this area, or on a short screen on the band above the window (IslandScene.usefulArea / frameArea, framing.ts
 *   framesBeside and besideFrom, besideArea below).
 * - minimap (ORQ-minimapa): portrait, a status readout of the top band under the gear (the band grows by it);
 *   landscape, under the gear beside the right thumb, outside the useful area (never part of the band there); while the
 *   offer or the forge holds the right column, under the camera buttons, still outside the useful area.
 * - edge arrows (UX-bordas-fora-da-tela): the only HUD besides the offer and the result allowed inside the useful area,
 *   on its inner rim and never over the hero (± HERO_MARGIN); not touch targets.
 * - the phone (touch input, `.rh[data-hud=fone]`, card NEW-20261014-ORQ-hud-mobile-minimo, fone.css): no camera buttons,
 *   no round chip, no Grana nor fichas on screen. The top band is the minimap (top-left), the team's bar with the level
 *   and, under it, the team as a fan of small portraits (top centre), and the gear (top-right). The fan is a status row
 *   of the band (never the team column/floor); in portrait the minimap is part of the band too (the announcement slot
 *   starts under it); in landscape it floats in the left EDGE_COLUMN, over the joystick's column, as before.
 * Pure geometry plus one DOM reader (measureZones) and the audit the acceptance scripts run on the real scene.
 */

export interface Rect {x:number;y:number;width:number;height:number}
export type Orientation='portrait'|'landscape';

/** Minimum clearance between any touch target and the joystick or the skill button, in CSS px. */
export const THUMB_GAP=24;
/** Landscape: the minimap lives in a column this wide at the left or right edge, never over the field (janela-caido). */
export const EDGE_COLUMN=120;
/** Clearance kept around the hero's sprite (UX checklist B2). */
export const HERO_MARGIN=40;
/** Smallest useful-area side that holds the hero (56 px at the follow zoom) with HERO_MARGIN on both sides. */
export const MIN_PLAY_SIDE=56+2*HERO_MARGIN;
/** Height reserved under the status rows for the announcement slot: the two-line round banner, or one notice with its optional second line. */
export const ANNOUNCE_HEIGHT={portrait:88,landscape:72} as const;
/** The round/boss banner shows this long in the top band, then shrinks into the round chip. */
export const MARQUEE_MS=1800;
/** Landscape is any viewport up to 500 px tall (same breakpoint as the HUD CSS). */
export const orientationOf=(viewport:{width:number;height:number}):Orientation=>viewport.height<=500?'landscape':'portrait';

export const right=(r:Rect)=>r.x+r.width;
export const bottom=(r:Rect)=>r.y+r.height;
export function inflate(r:Rect,by:number):Rect{return {x:r.x-by,y:r.y-by,width:r.width+2*by,height:r.height+2*by};}
export function union(rects:readonly (Rect|undefined)[]):Rect|undefined{
  const list=rects.filter((r):r is Rect=>!!r&&r.width>0&&r.height>0);
  if(!list.length)return undefined;
  const x=Math.min(...list.map(r=>r.x)),y=Math.min(...list.map(r=>r.y));
  return {x,y,width:Math.max(...list.map(right))-x,height:Math.max(...list.map(bottom))-y};
}
/** Overlap test with an optional margin around `b` (strict: touching edges do not cross). */
export function crosses(a:Rect,b:Rect,margin=0){
  return right(a)>b.x-margin&&a.x<right(b)+margin&&bottom(a)>b.y-margin&&a.y<bottom(b)+margin;
}
/** Edge-to-edge distance (0 when they overlap). */
export function gap(a:Rect,b:Rect){
  return Math.max(0,Math.max(a.x,b.x)-Math.min(right(a),right(b)),Math.max(a.y,b.y)-Math.min(bottom(a),bottom(b)));
}

export interface ZoneInput {
  viewport:{width:number;height:number};
  /** Status rows of the top band (camera buttons, round chip, gear, XP, boss bar). */
  status:readonly (Rect|undefined)[];
  team?:Rect;joystick?:Rect;skill?:Rect;emote?:Rect;
  /** The "+N" offer chip (D-021): a right-thumb control, 24 px left of the skill button. */
  chip?:Rect;
  /** Dona Cida's button (D-047, hud/cida.ts): a right-thumb control 24 px above the skill button, while the hero is by the moto. */
  cida?:Rect;
  /** Safe-area insets (notch), CSS px. */
  safe?:{top:number;right:number;bottom:number;left:number};
  /**
   * The minimap (ORQ-minimapa, then minimapa-wc3): it FLOATS over a corner of the field (Orquestrador, 13/10): it never
   * joins the top band nor trims the useful area; the edge arrows and the buttons keep clear of it (edges.ts COVERING)
   * and the follow camera keeps the hero in the middle, away from the corner. Kept here for the audits.
   */
  minimap?:Rect;
  /** The open offer window (round offer in the intermission, or a level offer opened from the chip). */
  offer?:Rect;
}
export interface ScreenZones {
  orientation:Orientation;viewport:{width:number;height:number};
  top:Rect;announce:Rect;team?:Rect;leftThumb?:Rect;rightThumb?:Rect;useful:Rect;
}

/**
 * The team strip is a bottom row (landscape phone, between the thumbs) or a side column (portrait; desktop's top-left
 * list). A lone member is taller than wide either way, so a strip whose top is in the lower half is a row too: a solo
 * "Você" ficha at the bottom of 844×390 must stay a floor, not a column that pushes the field right of it. The top, not
 * the centre: a long column from the top (6 players on 1343×618 reaches y 564) is still a column.
 */
export const teamIsRow=(team:Rect,viewport:{width:number;height:number}):boolean=>
  team.width>=team.height||team.y>viewport.height/2;

/** The zones for one layout (all CSS px, viewport coordinates). */
export function computeZones(input:ZoneInput):ScreenZones{
  const {viewport}=input,orientation=orientationOf(viewport),safe=input.safe??{top:0,right:0,bottom:0,left:0};
  const portrait=orientation==='portrait';
  const status=union(input.status)??{x:0,y:0,width:viewport.width,height:safe.top};
  const announceTop=bottom(status)+4,announce={x:safe.left,y:announceTop,width:viewport.width-safe.left-safe.right,height:ANNOUNCE_HEIGHT[orientation]};
  const top={x:0,y:0,width:viewport.width,height:bottom(announce)};
  const leftThumb=input.joystick&&inflate(input.joystick,THUMB_GAP);
  const rightThumb=union([input.skill,input.emote,input.chip,input.cida]);
  const thumbR=rightThumb&&inflate(rightThumb,THUMB_GAP);
  // Useful area: the larger of two rectangles under the top band (team column excluded in portrait):
  // (a) full width, above both thumbs (and above a team row); (b) between the thumbs, down to the team row or the bottom.
  const team=input.team,column=!!team&&!teamIsRow(team,viewport);
  let left=safe.left,rightEdge=viewport.width-safe.right;
  if(team&&column){if(team.x<viewport.width/2)left=Math.max(left,right(team)+8);else rightEdge=Math.min(rightEdge,team.x-8);}
  // The minimap floats over a corner of the field (see ZoneInput.minimap): it trims nothing.
  const floor=Math.min(viewport.height-safe.bottom,team&&!column?team.y-8:Infinity);
  const yTop=bottom(top);
  let aBottom=floor;for(const thumb of [leftThumb,thumbR])if(thumb)aBottom=Math.min(aBottom,thumb.y);
  const a={x:left,y:yTop,width:Math.max(0,rightEdge-left),height:Math.max(0,aBottom-yTop)};
  const bLeft=Math.max(left,leftThumb?right(leftThumb):left),bRight=Math.min(rightEdge,thumbR?thumbR.x:rightEdge);
  const b={x:bLeft,y:yTop,width:Math.max(0,bRight-bLeft),height:Math.max(0,floor-yTop)};
  // The follow camera centres the hero (~56 px) ± HERO_MARGIN in it: a rectangle shorter than that cannot hold the hero
  // (landscape with the offer chip: the full-width band above the thumbs is ~98 px), so one that fits wins, then area.
  const fits=(r:Rect)=>r.height>=MIN_PLAY_SIDE&&r.width>=MIN_PLAY_SIDE;
  const playable=fits(a)!==fits(b)?(fits(a)?a:b):b.width*b.height>a.width*a.height?b:a;
  // An open offer window takes its part of the field: the camera centres the hero in what is left (UX onda 4).
  const useful=input.offer?besideOffer(playable,input.offer,fits):playable;
  return {orientation,viewport,top,announce,team,leftThumb,rightThumb:thumbR,useful};
}

/**
 * Where the follow camera frames the hero beside an open window (framing.ts framesBeside): the useful area, which
 * already leaves the window out; when that is too short for the hero ± HERO_MARGIN (MIN_PLAY_SIDE) and it ends on the
 * window's top (the portrait forge or Dona Cida's tray on a short screen: 390x664 leaves ~100 px under the
 * announcement slot), the band from the top band's status rows down to the window, which holds it. The announcement
 * rows then avoid the hero as they do anywhere (RunHud.avoidHero: the other slot, the hint and the objective step
 * aside). BUG-20261014-ORQ-forja-cobre-heroi-retrato.
 */
export function besideArea(zones:Pick<ScreenZones,'useful'|'announce'>,window:Rect|undefined):Rect{
  const u=zones.useful;
  if(!window||u.height>=MIN_PLAY_SIDE||Math.abs(bottom(u)-window.y)>.5)return u;
  const up={x:u.x,y:zones.announce.y,width:u.width,height:Math.max(0,window.y-zones.announce.y)};
  return up.height>u.height?up:u;
}

/** The largest part of `area` left beside an open window (above, below, left or right of it), preferring one that fits. */
function besideOffer(area:Rect,offer:Rect,fits:(r:Rect)=>boolean):Rect{
  if(!crosses(area,offer))return area;
  const bands:Rect[]=[
    {x:area.x,y:area.y,width:area.width,height:Math.max(0,offer.y-area.y)},
    {x:area.x,y:bottom(offer),width:area.width,height:Math.max(0,bottom(area)-bottom(offer))},
    {x:area.x,y:area.y,width:Math.max(0,offer.x-area.x),height:area.height},
    {x:right(offer),y:area.y,width:Math.max(0,right(area)-right(offer)),height:area.height},
  ];
  return bands.reduce((best,r)=>fits(r)!==fits(best)?(fits(r)?r:best):r.width*r.height>best.width*best.height?r:best);
}

/**
 * Which announcement slot to use: the first one that stays clear of the hero (± margin), else the one that
 * overlaps it least. Slot 0 is the top band; slot 1 is the fallback above the thumbs. Since the follow camera
 * (camera-segue) keeps the hero in the useful area, slot 1 is only a safety net (it should never trigger).
 */
/** Status readouts the hero walked under (± margin): they go see-through instead of covering the hero (fallback). */
export function veiled(boxes:readonly {rect:Rect}[],hero:Rect|undefined,margin=HERO_MARGIN){
  return boxes.map(box=>!!hero&&crosses(box.rect,hero,margin));
}

export function chooseSlot(slots:readonly Rect[],hero:Rect|undefined,margin=HERO_MARGIN){
  if(!hero)return 0;
  const zone=inflate(hero,margin);
  let best=0,bestArea=Infinity;
  for(let i=0;i<slots.length;i++){
    const s=slots[i];
    if(!crosses(s,zone))return i;
    const w=Math.min(right(s),right(zone))-Math.max(s.x,zone.x),h=Math.min(bottom(s),bottom(zone))-Math.max(s.y,zone.y),area=Math.max(0,w)*Math.max(0,h);
    if(area<bestArea){bestArea=area;best=i;}
  }
  return best;
}

export interface AuditBox {name:string;rect:Rect;
  /** A touch target (≥ THUMB_GAP from the joystick and the skill button). */
  target?:boolean;
  /** Offer and result: the only ones allowed in the useful area (D-021 moves the level offer to a chip). The open emote fan
   * counts as the right-thumb control the player just opened (it closes on any other tap), not as HUD over the field.
   * First-time hints are not here: they are rows of the announcement slot (hud/coach.ts, VGM-056) and audited as such. */
  allowedInPlay?:boolean;
  /** Documented fallbacks while the camera does not follow the hero: the announcement in the low slot, and a status
   * readout veiled (30% opacity) because the hero walked under it. */
  fallback?:boolean;
  /** The joystick or the skill button itself. */
  thumb?:boolean;
  /** Allowed in the field, but over the hero (± margin) it still fails (the offer window). */
  overHeroFails?:boolean;
  /** A status readout made see-through because the hero is under it (RunHud.veil): over the hero by design, not hiding it. */
  veiled?:boolean;
  /** Must stay inside the useful area (the edge arrows, their tag and their "+N"): poking into the top band or a thumb fails. */
  withinUseful?:boolean;
  /** A ficha of the top band (round, XP, boss, base, minimap): two of them crossing fails (soma N15 + 046B). */
  topReadout?:boolean;
  /** Not a box: a caído or the boss off the field with no arrow of its own (NEW-20261011-UX-janela-esconde-caido). Fails. */
  unpointed?:boolean;
  /** Landscape: must sit in an EDGE_COLUMN (the minimap); anywhere else fails. */
  edgeColumn?:boolean;
  /** A short balloon (the "Gira fora da briga" answer): crossing a top ficha other than the XP bar fails. */
  balloon?:boolean}
export interface AuditResult {
  heroCrossed:string[];thumbGaps:{a:string;b:string;gap:number}[];inPlay:string[];fallbackInPlay:string[];
  /** Offer/result over the hero: allowed by the contract, reported for the offer card (D-021). */
  allowedOverHero:string[];
  /** Veiled (30%) readouts over the hero: a safety net (the follow camera keeps the hero clear); reported, not failed. */
  veiledOverHero:string[];
  /** Boxes that must stay in the useful area and left it (an arrow's tag in the top band, code review onda 6). */
  escaped:string[];
  /** Top-band fichas that cross each other ("round×base"). */
  topCrossed:string[];
  /** Kinds off the field that must keep an arrow and have none (a window open over the caído, janela-esconde-caido). */
  unpointed:string[];
  /** Landscape boxes that must sit in an edge column and do not (the minimap over the field). */
  offColumn:string[];
  minThumbGap:number;ok:boolean}

/** The zones audit: fails on a HUD box over the hero (± margin), a target closer than THUMB_GAP to a thumb control, or a box in the useful area. */
export function auditBoxes(boxes:readonly AuditBox[],zones:ScreenZones,hero?:Rect,margin=HERO_MARGIN):AuditResult{
  const heroCrossed:string[]=[],allowedOverHero:string[]=[],veiledOverHero:string[]=[],inPlay:string[]=[],fallbackInPlay:string[]=[],escaped:string[]=[],thumbGaps:AuditResult['thumbGaps']=[];
  let minThumbGap=Infinity;
  const unpointed=boxes.filter(b=>b.unpointed).map(b=>b.name);
  const offColumn=zones.orientation==='landscape'?boxes.filter(b=>b.edgeColumn&&b.rect.x>EDGE_COLUMN&&right(b.rect)<zones.viewport.width-EDGE_COLUMN).map(b=>b.name):[];
  for(const box of boxes){
    if(box.unpointed)continue;
    if(hero&&!box.thumb&&crosses(box.rect,hero,margin))(box.allowedInPlay&&!box.overHeroFails?allowedOverHero:box.veiled?veiledOverHero:heroCrossed).push(box.name);
    if(!box.allowedInPlay&&!box.thumb&&crosses(box.rect,zones.useful))(box.fallback?fallbackInPlay:inPlay).push(box.name);
    const u=zones.useful;
    if(box.withinUseful&&(box.rect.x<u.x-1||box.rect.y<u.y-1||right(box.rect)>right(u)+1||bottom(box.rect)>bottom(u)+1))escaped.push(box.name);
  }
  const tops=boxes.filter(b=>b.topReadout),topCrossed:string[]=[];
  for(let i=0;i<tops.length;i++)for(let j=i+1;j<tops.length;j++)if(crosses(tops[i].rect,tops[j].rect,-.5))topCrossed.push(`${tops[i].name}×${tops[j].name}`);
  for(const b of boxes.filter(x=>x.balloon))for(const top of tops)if(top.name!=='xp'&&crosses(b.rect,top.rect,-.5))topCrossed.push(`${b.name}×${top.name}`);
  const thumbs=boxes.filter(b=>b.thumb);
  for(const box of boxes)if(box.target&&!box.thumb)for(const thumb of thumbs){
    const g=gap(box.rect,thumb.rect);minThumbGap=Math.min(minThumbGap,g);
    if(g<THUMB_GAP)thumbGaps.push({a:box.name,b:thumb.name,gap:Math.round(g)});
  }
  return {heroCrossed,thumbGaps,inPlay,fallbackInPlay,allowedOverHero,veiledOverHero,escaped,minThumbGap:Number.isFinite(minThumbGap)?Math.round(minThumbGap):-1,
    topCrossed,unpointed,offColumn,ok:!heroCrossed.length&&!thumbGaps.length&&!inPlay.length&&!escaped.length&&!topCrossed.length&&!unpointed.length&&!offColumn.length};
}

// ---------- DOM (browser only) ----------
const rectOf=(el:Element|null|undefined):Rect|undefined=>{
  if(!el||(el as HTMLElement).closest?.('[hidden]'))return undefined;
  const r=el.getBoundingClientRect();
  if(!(r.width>0&&r.height>0)||getComputedStyle(el).visibility==='hidden')return undefined;
  return {x:r.left,y:r.top,width:r.width,height:r.height};
};
const safeInsets=(root:Element)=>{
  const style=getComputedStyle(root),px=(name:string)=>parseFloat(style.getPropertyValue(name))||0;
  return {top:px('--rh-t'),right:px('--rh-r'),bottom:px('--rh-b'),left:px('--rh-l')};
};

/**
 * The intermission windows that trim the useful area, first shown wins (they are never open together): the offer, the
 * forge (VGM-046B, in the offer's place) and the obra window (torres-ligar: the forge yields to it while it is open, and
 * an open offer closes it, explore.ts), and Dona Cida's tray (D-047, hud/cida.ts: in the forge's place, which yields to it).
 */
export const ZONE_WINDOWS=['.rh-offer','.rh-forge','.rh-obra-janela','.rh-cida'] as const;
/** The same without the obra window: the obra HUD lays its own window out from this input (never from itself). */
export const ZONE_WINDOWS_BESIDE_OBRA=['.rh-offer','.rh-forge','.rh-cida'] as const;

/** The zone input read from the live layout (HUD under `.rh`, controls of the explore shell); `windows` as ZONE_WINDOWS. */
export function measureZoneInput(doc:Document=document,windows:readonly string[]=ZONE_WINDOWS):ZoneInput{
  const q=(s:string)=>doc.querySelector(s),all=(s:string)=>[...doc.querySelectorAll(s)].map(rectOf);
  const hud=q('.rh');
  let offer:Rect|undefined;
  for(const selector of windows){offer=rectOf(q(selector));if(offer)break;}
  const viewport={width:innerWidth,height:innerHeight},minimap=rectOf(q('.rh-minimap'));
  // The phone (hud-mobile-minimo): in portrait the minimap is the band's top-left corner, so the band ends under it.
  const phonePortrait=(hud as HTMLElement|null)?.dataset.hud==='fone'&&orientationOf(viewport)==='portrait';
  return {
    viewport,
    // The matches' flame (hud/perfis.ts) sits under the gear on the phone: the announcement slot starts below it.
    status:[...all('.explore-camera button'),rectOf(q('.explore-config')),rectOf(q('.rh-matches')),...all('.rh-top>*'),...(phonePortrait?[minimap]:[])],
    // The phone's fan lives in the band (.rh-top>.rh-team, a status row above): it is not the team column nor its floor.
    team:union(all('.rh-member:not(.rh-top .rh-member)')),joystick:rectOf(q('.explore-stick')),skill:rectOf(q('#coop-attack'))??rectOf(q('#coop-sos')),
    emote:rectOf(q('.fun-emote-toggle')),chip:rectOf(q('.rh-offer-chip')),cida:rectOf(q('.rh-cida-btn')),safe:hud?safeInsets(hud):undefined,
    offer,minimap,
  };
}
/** Zones read from the live layout (measureZoneInput, every intermission window included). */
export function measureZones(doc:Document=document):ScreenZones{return computeZones(measureZoneInput(doc));}

/** Every HUD box the audit looks at, as laid out now. */
export function auditBoxesFromDom(doc:Document=document):AuditBox[]{
  const boxes:AuditBox[]=[];
  // A box inside a scroll box (the intermission offer list or the forge's tags, capped in height) counts only for its visible
  // part: what is scrolled out is clipped, neither drawn nor tappable.
  const clipped=(el:Element,rect:Rect|undefined):Rect|undefined=>{
    const box=rect&&el.parentElement?.closest('.rh-offer-cards,.rh-forge-tags');if(!rect||!box||getComputedStyle(box).overflowY==='visible')return rect;
    const c=box.getBoundingClientRect(),x=Math.max(rect.x,c.left),y=Math.max(rect.y,c.top),r=Math.min(right(rect),c.right),b=Math.min(bottom(rect),c.bottom);
    return r>x&&b>y?{x,y,width:r-x,height:b-y}:undefined;
  };
  const add=(selector:string,name:string,flags:Omit<AuditBox,'name'|'rect'>={})=>{
    doc.querySelectorAll(selector).forEach((el,i)=>{const rect=clipped(el,rectOf(el));if(rect)boxes.push({name:`${name}${i?`#${i+1}`:''}`,rect,...flags,...(el.classList.contains('rh-veiled')?{fallback:true,veiled:true}:{})});});
  };
  // The result covers the whole screen: what lies under it is neither over the hero nor next to a thumb.
  if(rectOf(doc.querySelector('.rh-result'))){add('.rh-result','resultado',{allowedInPlay:true});add('.rh-result-btn','resultado-botão',{allowedInPlay:true,target:true});return boxes;}
  add('.explore-stick','joystick',{thumb:true,target:true});
  add('#coop-attack','habilidade',{thumb:true,target:true});
  add('.explore-camera button','câmera',{target:true});add('.explore-camera span','câmera-vista');
  add('.explore-config','engrenagem',{target:true});
  const top={topReadout:true};
  add('.rh-round','round',top);add('.rh-xp','xp',top);add('.rh-boss','chefe',top);add('.rh-camp','base',top);
  const low=!!doc.querySelector('.rh-stack.rh-stack-low');
  add('.rh-stack .rh-marquee','letreiro',{fallback:low});add('.rh-stack .rh-alert','aviso',{fallback:low});
  // The first-run coach's hint (VGM-056): a row of the same slot, so it may not touch the useful area, the hero or a thumb.
  add('.rh-stack .rh-coach','dica',{fallback:low});
  // The city's round-1 walk to the plaza (card cidade-08): a row of the same slot, under the same rules.
  add('.rh-stack .rh-objetivo','objetivo',{fallback:low});
  add('.rh-member','time');
  // The open window may sit in the field but never on the hero: the camera moves the hero beside it (UX onda 4).
  add('.rh-offer','oferta',{allowedInPlay:true,overHeroFails:true});add('.rh-offer .rh-card','carta',{allowedInPlay:true,target:true,overHeroFails:true});
  // The forge window (VGM-046B): an intermission window like the offer, in the field but never on the hero.
  add('.rh-forge','forja',{allowedInPlay:true,overHeroFails:true});add('.rh-forge .rh-forge-tag','forja-etiqueta',{allowedInPlay:true,target:true,overHeroFails:true});
  add('.rh-forge .rh-forge-close','forja-fechar',{allowedInPlay:true,target:true,overHeroFails:true});
  // The obra window (torres-ligar): an intermission window like the forge, in the field but never on the hero.
  add('.rh-obra-janela','obra',{allowedInPlay:true,overHeroFails:true});
  add('.rh-obra-janela .rh-obra-card,.rh-obra-janela .rh-obra-ok,.rh-obra-janela .rh-obra-fechar','obra-alvo',{allowedInPlay:true,target:true,overHeroFails:true});
  // Dona Cida's tray (D-047): a window like the forge, in the field but never on the hero; her button is a right-thumb control.
  add('.rh-cida','cida',{allowedInPlay:true,overHeroFails:true});
  add('.rh-cida .rh-cida-doce,.rh-cida .rh-cida-close','cida-alvo',{allowedInPlay:true,target:true,overHeroFails:true});
  add('.rh-cida-btn','cida-botão',{target:true});
  add('.rh-offer-chip','chip',{target:true});
  add('.fun-emote-toggle','emote',{target:true});
  // "Me salva" takes the skill button's place while caído: the same right-thumb control (UX-resgate-e-ping).
  add('#coop-sos','me-salva',{thumb:true,target:true});
  add('.rh-minimap','minimapa',{target:true,topReadout:true,edgeColumn:true});
  // The "Gira fora da briga" balloon (explore.css) never opens over the minimap or a top ficha (UX review janela-caido).
  add('.explore-camera-hint','dica-girar',{balloon:true});
  // Edge arrows ride the useful area's inner rim by contract, never over the hero.
  const arrow={allowedInPlay:true,overHeroFails:true,withinUseful:true};
  add('.rh-edge:not([hidden])','seta',arrow);add('.rh-edge:not([hidden]) .rh-edge-tag:not([hidden])','seta-etiqueta',arrow);
  add('.rh-edge:not([hidden]) .rh-edge-count:not([hidden])','seta-mais',arrow);add('.rh-edge:not([hidden]) .rh-edge-name:not([hidden])','seta-nome',arrow);
  // The arrows' layer lists the kinds that need an arrow now (edges.ts need): each one keeps an arrow of its own.
  for(const kind of ((doc.querySelector('.rh-edges') as HTMLElement|null)?.dataset.need??'').split(' ').filter(Boolean))
    if(![...doc.querySelectorAll(`.rh-edge[data-kind="${kind}"]`)].some(el=>rectOf(el)))boxes.push({name:`sem-seta-${kind}`,rect:{x:0,y:0,width:0,height:0},unpointed:true});add('.fun-emotes.is-open .fun-emote','emote-leque',{target:true,allowedInPlay:true});
  return boxes;
}
