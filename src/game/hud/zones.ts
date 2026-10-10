/**
 * Screen zones contract (UX-zonas-tela). Every HUD piece lives in one zone, per orientation:
 * - top band: camera buttons, round chip, gear, XP, boss bar and the announcement slot (round/boss banner ≤ 2 lines
 *   for ≤ 1.8 s, fall/rescue/connection notices);
 * - team strip: left column (portrait) or bottom row between the thumbs (landscape);
 * - left thumb: joystick + THUMB_GAP; right thumb: skill + emote + THUMB_GAP;
 * - useful area: the rectangle left for play. Only the offer and the result may enter it. The follow camera
 *   (D-019, UX-camera-segue) centers the hero on it; today the scene only receives it (IslandScene.usefulArea).
 * Pure geometry plus one DOM reader (measureZones) and the audit the acceptance scripts run on the real scene.
 */

export interface Rect {x:number;y:number;width:number;height:number}
export type Orientation='portrait'|'landscape';

/** Minimum clearance between any touch target and the joystick or the skill button, in CSS px. */
export const THUMB_GAP=24;
/** Clearance kept around the hero's sprite (UX checklist B2). */
export const HERO_MARGIN=40;
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
  /** Safe-area insets (notch), CSS px. */
  safe?:{top:number;right:number;bottom:number;left:number};
}
export interface ScreenZones {
  orientation:Orientation;viewport:{width:number;height:number};
  top:Rect;announce:Rect;team?:Rect;leftThumb?:Rect;rightThumb?:Rect;useful:Rect;
}

/** The zones for one layout (all CSS px, viewport coordinates). */
export function computeZones(input:ZoneInput):ScreenZones{
  const {viewport}=input,orientation=orientationOf(viewport),safe=input.safe??{top:0,right:0,bottom:0,left:0};
  const status=union(input.status)??{x:0,y:0,width:viewport.width,height:safe.top};
  const announceTop=bottom(status)+4,announce={x:safe.left,y:announceTop,width:viewport.width-safe.left-safe.right,height:ANNOUNCE_HEIGHT[orientation]};
  const top={x:0,y:0,width:viewport.width,height:bottom(announce)};
  const leftThumb=input.joystick&&inflate(input.joystick,THUMB_GAP);
  const rightThumb=union([input.skill,input.emote]);
  const thumbR=rightThumb&&inflate(rightThumb,THUMB_GAP);
  // Useful area: the larger of two rectangles under the top band (team column excluded in portrait):
  // (a) full width, above both thumbs (and above a team row); (b) between the thumbs, down to the team row or the bottom.
  const team=input.team,column=!!team&&team.height>team.width;
  let left=safe.left,rightEdge=viewport.width-safe.right;
  if(team&&column){if(team.x<viewport.width/2)left=Math.max(left,right(team)+8);else rightEdge=Math.min(rightEdge,team.x-8);}
  const floor=Math.min(viewport.height-safe.bottom,team&&!column?team.y-8:Infinity);
  const yTop=bottom(top);
  let aBottom=floor;for(const thumb of [leftThumb,thumbR])if(thumb)aBottom=Math.min(aBottom,thumb.y);
  const a={x:left,y:yTop,width:Math.max(0,rightEdge-left),height:Math.max(0,aBottom-yTop)};
  const bLeft=Math.max(left,leftThumb?right(leftThumb):left),bRight=Math.min(rightEdge,thumbR?thumbR.x:rightEdge);
  const b={x:bLeft,y:yTop,width:Math.max(0,bRight-bLeft),height:Math.max(0,floor-yTop)};
  const useful=b.width*b.height>a.width*a.height?b:a;
  return {orientation,viewport,top,announce,team,leftThumb,rightThumb:thumbR,useful};
}

/**
 * Which announcement slot to use: the first one that stays clear of the hero (± margin), else the one that
 * overlaps it least. Slot 0 is the top band; slot 1 is the fallback above the thumbs, kept only while the camera
 * does not follow the hero (whole-island framing lets the hero walk under the top band).
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
   * counts as the right-thumb control the player just opened (it closes on any other tap), not as HUD over the field. */
  allowedInPlay?:boolean;
  /** Documented fallbacks while the camera does not follow the hero: the announcement in the low slot, and a status
   * readout veiled (30% opacity) because the hero walked under it. */
  fallback?:boolean;
  /** The joystick or the skill button itself. */
  thumb?:boolean;
  /** A status readout made see-through because the hero is under it (RunHud.veil): over the hero by design, not hiding it. */
  veiled?:boolean}
export interface AuditResult {
  heroCrossed:string[];thumbGaps:{a:string;b:string;gap:number}[];inPlay:string[];fallbackInPlay:string[];
  /** Offer/result over the hero: allowed by the contract, reported for the offer card (D-021). */
  allowedOverHero:string[];
  /** Veiled (30%) readouts over the hero: the fallback while the camera does not follow; reported, not failed. */
  veiledOverHero:string[];
  minThumbGap:number;ok:boolean}

/** The zones audit: fails on a HUD box over the hero (± margin), a target closer than THUMB_GAP to a thumb control, or a box in the useful area. */
export function auditBoxes(boxes:readonly AuditBox[],zones:ScreenZones,hero?:Rect,margin=HERO_MARGIN):AuditResult{
  const heroCrossed:string[]=[],allowedOverHero:string[]=[],veiledOverHero:string[]=[],inPlay:string[]=[],fallbackInPlay:string[]=[],thumbGaps:AuditResult['thumbGaps']=[];
  let minThumbGap=Infinity;
  for(const box of boxes){
    if(hero&&!box.thumb&&crosses(box.rect,hero,margin))(box.allowedInPlay?allowedOverHero:box.veiled?veiledOverHero:heroCrossed).push(box.name);
    if(!box.allowedInPlay&&!box.thumb&&crosses(box.rect,zones.useful))(box.fallback?fallbackInPlay:inPlay).push(box.name);
  }
  const thumbs=boxes.filter(b=>b.thumb);
  for(const box of boxes)if(box.target&&!box.thumb)for(const thumb of thumbs){
    const g=gap(box.rect,thumb.rect);minThumbGap=Math.min(minThumbGap,g);
    if(g<THUMB_GAP)thumbGaps.push({a:box.name,b:thumb.name,gap:Math.round(g)});
  }
  return {heroCrossed,thumbGaps,inPlay,fallbackInPlay,allowedOverHero,veiledOverHero,minThumbGap:Number.isFinite(minThumbGap)?Math.round(minThumbGap):-1,
    ok:!heroCrossed.length&&!thumbGaps.length&&!inPlay.length};
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

/** Zones read from the live layout (HUD under `.rh`, controls of the explore shell). */
export function measureZones(doc:Document=document):ScreenZones{
  const q=(s:string)=>doc.querySelector(s),all=(s:string)=>[...doc.querySelectorAll(s)].map(rectOf);
  const hud=q('.rh');
  return computeZones({
    viewport:{width:innerWidth,height:innerHeight},
    status:[...all('.explore-camera button'),rectOf(q('.explore-config')),...all('.rh-top>*')],
    team:union(all('.rh-member')),joystick:rectOf(q('.explore-stick')),skill:rectOf(q('#coop-attack')),
    emote:rectOf(q('.fun-emote-toggle')),safe:hud?safeInsets(hud):undefined,
  });
}

/** Every HUD box the audit looks at, as laid out now. */
export function auditBoxesFromDom(doc:Document=document):AuditBox[]{
  const boxes:AuditBox[]=[];
  const add=(selector:string,name:string,flags:Omit<AuditBox,'name'|'rect'>={})=>{
    doc.querySelectorAll(selector).forEach((el,i)=>{const rect=rectOf(el);if(rect)boxes.push({name:`${name}${i?`#${i+1}`:''}`,rect,...flags,...(el.classList.contains('rh-veiled')?{fallback:true,veiled:true}:{})});});
  };
  // The result covers the whole screen: what lies under it is neither over the hero nor next to a thumb.
  if(rectOf(doc.querySelector('.rh-result'))){add('.rh-result','resultado',{allowedInPlay:true});add('.rh-result-btn','resultado-botão',{allowedInPlay:true,target:true});return boxes;}
  add('.explore-stick','joystick',{thumb:true,target:true});
  add('#coop-attack','habilidade',{thumb:true,target:true});
  add('.explore-camera button','câmera',{target:true});add('.explore-camera span','câmera-vista');
  add('.explore-config','engrenagem',{target:true});
  add('.rh-round','round');add('.rh-xp','xp');add('.rh-boss','chefe');
  const low=!!doc.querySelector('.rh-stack.rh-stack-low');
  add('.rh-stack .rh-marquee','letreiro',{fallback:low});add('.rh-stack .rh-alert','aviso',{fallback:low});
  add('.rh-member','time');
  add('.rh-offer','oferta',{allowedInPlay:true});add('.rh-offer .rh-card','carta',{allowedInPlay:true,target:true});
  add('.fun-emote-toggle','emote',{target:true});add('.fun-emotes.is-open .fun-emote','emote-leque',{target:true,allowedInPlay:true});
  return boxes;
}

/** Debug overlay (dev, `?zonas` in the URL or __zones.overlay(true)): the zones drawn over the real scene. */
export function drawZoneOverlay(zones:ScreenZones,doc:Document=document){
  let layer=doc.querySelector<HTMLElement>('.rh-zones-debug');
  // Inside the open modal shell: a body child would sit under the dialog's top layer.
  if(!layer){layer=doc.createElement('div');layer.className='rh-zones-debug';layer.setAttribute('aria-hidden','true');(doc.querySelector('dialog[open]')??doc.body).append(layer);}
  const parts:[string,Rect|undefined,string][]=[['área útil',zones.useful,'cartolina'],['topo',zones.top,'lilas'],['anúncio',zones.announce,'amarelo'],
    ['time',zones.team,'papel'],['polegar esq.',zones.leftThumb,'cone'],['polegar dir.',zones.rightThumb,'cone']];
  layer.replaceChildren(...parts.filter(([,r])=>!!r).map(([label,r,tone])=>{
    const box=doc.createElement('div');box.className='rh-zone';box.dataset.tone=tone;box.textContent=label;
    Object.assign(box.style,{left:`${r!.x}px`,top:`${r!.y}px`,width:`${r!.width}px`,height:`${r!.height}px`});
    return box;
  }));
  return layer;
}
export function clearZoneOverlay(doc:Document=document){doc.querySelector('.rh-zones-debug')?.remove();}
