/**
 * City minimap (doc §1–§2): the whole Cidade Nevada as a diamond turned with the camera's view (D-019: 4 views of 90°),
 * so "up" on it is "up" on the screen, like the arrows and the compass. Centred on the plaza (not on the hero): the city
 * corners are the diamond's vertices, ±(r − 2) px from the centre, and the 4 mouths sit mid-side. Collapsed it is the
 * `.rh-minimap` slot (76×76); a tap opens the big one over it (anchored on its outer corner), a tap closes it. Shapes
 * carry the meaning with the colour (UX B8): clover = group, disc = person, ring = caído, tent = base, wave = active
 * mouth, skull = boss. Pure geometry and marks first, one DOM class below.
 */
import {minimapPoint,crosses,icon,type Rect} from './deps.ts';
import {clusterEnemies,GROUP_SHOW,groupCountText,type EnemyPoint} from './clusters.ts';
import {MINIMAP_SIDE} from './layout.ts';

/** World units: the city spans [0, CITY_SIZE] on x and y (row 0 = north, x west to east), the plaza at its centre. */
export const CITY_SIZE=169;
/** Camera view (90° steps), the convention of src/client/projection.ts. */
export type CityView=0|1|2|3;
export type MouthId='N'|'S'|'L'|'O';
export interface CityMapInfo {size:number;plaza:{x:number;y:number;radius:number};mouths:{id:MouthId;x:number;y:number}[];start:{x:number;y:number}}
const C=CITY_SIZE/2;
/** Until the importer's asset exists: plaza in the centre, the 4 avenue ends, the start in the south district. */
export const DEFAULT_CITY:CityMapInfo={size:CITY_SIZE,plaza:{x:C,y:C,radius:10},
  mouths:[{id:'N',x:C,y:0},{id:'S',x:C,y:CITY_SIZE},{id:'L',x:CITY_SIZE,y:C},{id:'O',x:0,y:C}],start:{x:C,y:CITY_SIZE-14}};

/** Half the inside of a minimap box of side `side` (2 px border): r. */
export const innerRadius=(side=MINIMAP_SIDE)=>side/2-2;
/** World units from the plaza to the rim of the drawing: the city's half diagonal lands 2 px inside r (doc §1). */
export const cityRange=(side=MINIMAP_SIDE)=>{const r=innerRadius(side);return CITY_SIZE/Math.SQRT2*r/(r-2);};

/**
 * Minimap px of a world point, relative to the box centre (y down), in a box of side `side` under `view`. City corners
 * land at ±34 px in the collapsed box (±(side/2 − 4) in general); what lies past the rim is clamped onto it.
 */
export function cityMinimapPoint(p:{x:number;y:number},view:CityView,side=MINIMAP_SIDE):{x:number;y:number}{
  const q=minimapPoint({x:p.x-C,y:p.y-C},view,cityRange(side),innerRadius(side),0);
  return {x:q.x,y:q.y};
}

export type CityMarkKind='voce'|'aliado'|'caido'|'base'|'boca'|'boca-ativa'|'grupo'|'chefe'|'inicio';
export interface CityMark {key:string;kind:CityMarkKind;
  /** Minimap px from the box centre. */
  x:number;y:number;
  /** Outer size in px, stroke included. */
  size:number;
  /** Grupo: how many critters. */
  count?:number;
  /** Base: the wall's life, 0..1. */
  hp?:number;
  /** Caído: a "Me salva" ping is lit (Papel halo). */
  ping?:boolean;
  /** Boca: the avenue's direction at the mouth (radians on the minimap), so its tick crosses the avenue. */
  angle?:number}
export interface CityMinimapInput {
  map:CityMapInfo;view:CityView;
  /** Box side in px (76 collapsed; the big one's side when open). */
  side?:number;
  selfId:string;
  players:{id:string;x:number;y:number;downed?:boolean;ping?:boolean}[];
  enemies:readonly EnemyPoint[];
  activeMouths?:readonly MouthId[];
  baseHp?:{hp:number;maxHp:number};
  /** Big only: the 8 nearest closed chests, shown in the intermission. */
  chests?:readonly {x:number;y:number}[];
  /** Big only: the world corners of what the screen shows (the view rectangle, Papel 60%). */
  screen?:readonly {x:number;y:number}[];
  /** Reconnecting (B13): marks stay still at 50% with `sem-linha` in a corner. */
  offline?:boolean;
}

/** Bottom to top (doc §1 table); você always on top. */
export const CITY_DRAW_ORDER:Readonly<Record<CityMarkKind,number>>={inicio:0,boca:1,grupo:2,aliado:3,base:4,'boca-ativa':5,chefe:6,caido:7,voce:8};
/** Smallest outer size per mark in the collapsed box (px, stroke included); the big box draws them 1.5× (not to map scale). */
export const CITY_MARK_SIZE:Readonly<Record<Exclude<CityMarkKind,'grupo'>,number>>={inicio:5,boca:5,aliado:6,base:16,'boca-ativa':12,chefe:11,caido:11,voce:9};
/** Clover size by count: 8 (3–9), 10 (10–24), 12 (25+); below 8 px the three dots read as one dot in the 76 px box. */
export const groupMarkSize=(count:number)=>count>=25?12:count>=10?10:8;
/** Marks scale in the big box. */
export const BIG_MARK_SCALE=1.5;
/** Base ring: below this life the arc turns Cone. */
export const BASE_LOW=.3;

/** Every mark of one frame, bottom to top (stable inside a layer by key). Groups of 3+ only; the boss has its skull. */
export function cityMinimapMarks(input:CityMinimapInput):CityMark[]{
  const side=input.side??MINIMAP_SIDE,k=side>MINIMAP_SIDE?BIG_MARK_SCALE:1,at=(p:{x:number;y:number})=>cityMinimapPoint(p,input.view,side);
  const out:CityMark[]=[];
  const add=(key:string,kind:CityMarkKind,p:{x:number;y:number},size:number,extra:Partial<CityMark>={})=>{const q=at(p);out.push({key,kind,x:q.x,y:q.y,size:size*k,...extra});};
  const {map}=input,active=new Set(input.activeMouths??[]),centre=at(map.plaza);
  add('inicio','inicio',map.start,CITY_MARK_SIZE.inicio);
  for(const m of map.mouths){
    const q=at(m);
    add(`boca:${m.id}`,active.has(m.id)?'boca-ativa':'boca',m,CITY_MARK_SIZE[active.has(m.id)?'boca-ativa':'boca'],{angle:Math.atan2(centre.y-q.y,centre.x-q.x)});
  }
  for(const g of clusterEnemies(input.enemies.filter(e=>!e.boss)))if(g.count>=GROUP_SHOW)add(`grupo:${g.key}`,'grupo',g,groupMarkSize(g.count),{count:g.count});
  for(const p of input.players)if(p.id!==input.selfId&&!p.downed)add(`p:${p.id}`,'aliado',p,CITY_MARK_SIZE.aliado);
  const hp=input.baseHp?Math.min(1,Math.max(0,input.baseHp.hp/Math.max(1,input.baseHp.maxHp))):undefined;
  add('base','base',map.plaza,CITY_MARK_SIZE.base,hp===undefined?{}:{hp});
  for(const e of input.enemies)if(e.boss)add(`chefe:${e.id}`,'chefe',e,CITY_MARK_SIZE.chefe);
  for(const p of input.players)if(p.id!==input.selfId&&p.downed)add(`p:${p.id}`,'caido',p,CITY_MARK_SIZE.caido,p.ping?{ping:true}:{});
  const self=input.players.find(p=>p.id===input.selfId);
  if(self)add('voce','voce',self,CITY_MARK_SIZE.voce);
  return out.sort((a,b)=>CITY_DRAW_ORDER[a.kind]-CITY_DRAW_ORDER[b.kind]||(a.key<b.key?-1:a.key>b.key?1:0));
}

/** Groups this big get their count beside the clover in the big minimap. */
export const LABEL_MIN=10;
/** Count text: M PLUS 800 13 px (≈ 0.62 em a character, tnum). */
export const LABEL_PX=13;
export const labelWidth=(text:string)=>Math.ceil(text.length*LABEL_PX*.62)+2;
export interface CityLabel {key:string;text:string;
  /** Text anchor point (minimap px from the centre; y is the text's middle line). */
  x:number;y:number;anchor:'start'|'middle'|'end';
  /** The label's box, for overlap checks. */
  box:Rect}
/**
 * Counts of the groups of LABEL_MIN or more, drawn after every mark (a final layer): beside the clover on the right,
 * else left, above or below, the first spot that crosses no other mark nor an earlier label and stays in the drawing.
 */
export function cityMinimapLabels(marks:readonly CityMark[],side=MINIMAP_SIDE):CityLabel[]{
  const r=innerRadius(side),boxOf=(m:CityMark):Rect=>({x:m.x-m.size/2,y:m.y-m.size/2,width:m.size,height:m.size});
  const inside=(b:Rect)=>b.x>=-r&&b.y>=-r&&b.x+b.width<=r&&b.y+b.height<=r;
  const out:CityLabel[]=[];
  for(const m of marks){
    if(m.kind!=='grupo'||(m.count??0)<LABEL_MIN)continue;
    const text=groupCountText(m.count!),w=labelWidth(text),h=LABEL_PX,tries:Omit<CityLabel,'key'|'text'>[]=[];
    // Right beside it first, then a step further out (a crowded plaza), each time right, left, above, below.
    for(const d of [m.size/2+2,m.size/2+10,m.size/2+18])tries.push(
      {x:m.x+d,y:m.y,anchor:'start',box:{x:m.x+d,y:m.y-h/2,width:w,height:h}},
      {x:m.x-d,y:m.y,anchor:'end',box:{x:m.x-d-w,y:m.y-h/2,width:w,height:h}},
      {x:m.x,y:m.y-d-h/2,anchor:'middle',box:{x:m.x-w/2,y:m.y-d-h,width:w,height:h}},
      {x:m.x,y:m.y+d+h/2,anchor:'middle',box:{x:m.x-w/2,y:m.y+d,width:w,height:h}});
    const free=(b:Rect)=>inside(b)&&!marks.some(o=>o!==m&&crosses(b,boxOf(o)))&&!out.some(l=>crosses(b,l.box));
    const pick=tries.find(t=>free(t.box))??tries.find(t=>inside(t.box))??tries[0];
    out.push({key:m.key,text,...pick});
  }
  return out;
}

/** The letra-n sticker of the big minimap (box px; the glyph is 18/48 of it, so ≈ 9 px tall), as on the compass. */
export const NORTH_STICKER=24;
/** The fixed layer (redrawn only when the view or the side changes): the diamond, the avenues in X and where the N goes. */
export function cityFixedLayer(map:CityMapInfo,view:CityView,side=MINIMAP_SIDE){
  const at=(x:number,y:number)=>cityMinimapPoint({x,y},view,side),s=map.size;
  // The N sits outward of the north mouth, past the active-mouth wave (half its size there) and half its own glyph.
  const mouth=map.mouths.find(m=>m.id==='N'),k=side>MINIMAP_SIDE?BIG_MARK_SCALE:1;
  let north:{x:number;y:number;size:number}|undefined;
  if(mouth){
    const p=at(mouth.x,mouth.y),len=Math.hypot(p.x,p.y)||1,out=CITY_MARK_SIZE['boca-ativa']*k/2+NORTH_STICKER*9/48+2;
    north={x:p.x*(1+out/len),y:p.y*(1+out/len),size:NORTH_STICKER};
  }
  return {diamond:[at(0,0),at(s,0),at(s,s),at(0,s)],
    avenues:[[at(map.plaza.x,0),at(map.plaza.x,s)],[at(0,map.plaza.y),at(s,map.plaza.y)]] as [{x:number;y:number},{x:number;y:number}][],north};
}

/** The big minimap closes by itself (doc §2): this long open in a wave or in the intermission. */
export const BIG_OPEN_MS={wave:4000,prepare:8000} as const;
/** A critter this close to the hero (world units) closes the big minimap and blocks the tap that would open it. */
export const NEAR_BLOCK=2.5;
/** What the announcement slot shows now ('outro': any other notice, e.g. the Round banner or a connection line). */
export type NoticeKind='caido'|'chefe'|'corneta'|'outro';
/** Notices about danger: while one is up the big minimap never opens (it would hide where to look). */
export const DANGER_NOTICES:readonly NoticeKind[]=['caido','chefe','corneta'];
export type BlockReason='bicho'|'aviso';
/**
 * Why a tap must not open the big minimap now: a critter within NEAR_BLOCK of the hero ('bicho'); a danger notice in
 * the slot, or any notice when the big one would cover the slot (layout bigCoversAnnounce) ('aviso'). Undefined: free.
 */
export function blockReason(nearestEnemy?:number,notice?:NoticeKind,coversAnnounce=false):BlockReason|undefined{
  if(nearestEnemy!==undefined&&nearestEnemy<=NEAR_BLOCK)return 'bicho';
  if(notice&&(DANGER_NOTICES.includes(notice)||coversAnnounce))return 'aviso';
  return undefined;
}
/** The tap does not open the big minimap (the collapsed one's border turns Cone and dashed). */
export const tapBlocked=(nearestEnemy?:number,notice?:NoticeKind,coversAnnounce=false)=>!!blockReason(nearestEnemy,notice,coversAnnounce);
export const BLOCKED_LABEL='Bicho perto. O mapa grande abre quando sair.';
export const NOTICE_BLOCKED_LABEL='Aviso na tela. O mapa grande abre quando sair.';
export interface BigCloseInput {openedAtMs:number;nowMs:number;phase:'wave'|'prepare';
  /** A new notice entered the announcement slot (Round, boss, caído, horn). */
  announced?:boolean;
  /** The notice up in the slot now, if any. */
  notice?:NoticeKind;
  /** Layout bigCoversAnnounce: then any notice closes it. */
  coversAnnounce?:boolean;
  hurt?:boolean;
  /** A telegraph touches the hero's zone. */
  telegraphOnHero?:boolean;
  /** World distance to the nearest critter. */
  nearestEnemy?:number}
export function bigShouldClose(i:BigCloseInput):boolean{
  return i.nowMs-i.openedAtMs>=BIG_OPEN_MS[i.phase]||!!i.announced||!!i.hurt||!!i.telegraphOnHero||tapBlocked(i.nearestEnemy,i.notice,i.coversAnnounce);
}

// ---------- DOM (browser only) ----------
const SVG='http://www.w3.org/2000/svg';
const f=(n:number)=>n.toFixed(1);
/** One mark's markup, centred at 0,0, at its outer size `s`. */
function markShape(m:CityMark):string{
  const s=m.size;
  switch(m.kind){
    case 'voce':return `<circle r="${f(s/2-.8)}"/>`;
    case 'aliado':return `<circle r="${f(s/2-.6)}"/>`;
    case 'caido':return `${m.ping?`<circle class="ch-mm-halo" r="${f(s*7/11)}"/>`:''}<circle r="${f(s/2-1.2)}"/><circle class="ch-mm-dot" r="${f(s*1.6/11)}"/>`;
    case 'grupo':{const d=s*.27,r=s*.23;return [-90,30,150].map(a=>{const t=a*Math.PI/180;return `<circle cx="${f(Math.cos(t)*d)}" cy="${f(Math.sin(t)*d)}" r="${f(r)}"/>`;}).join('');}
    case 'base':{
      const r=(s-2.5)/2,hp=m.hp,k=s/16;
      const ring=hp===undefined?'':`<circle class="ch-mm-track" r="${f(r)}"/><circle class="ch-mm-life${hp<BASE_LOW?' ch-mm-low':''}" r="${f(r)}" pathLength="100" stroke-dasharray="${f(hp*100)} 100" transform="rotate(-90)"/>`;
      return `${ring}<g transform="scale(${f(k)})"><path class="ch-mm-flag" d="M0 -6L4 -4.8L0 -3.6Z"/><path d="M-5.5 4.5L0 -4.5L5.5 4.5Z"/></g>`;
    }
    case 'boca-ativa':return `<path transform="scale(${(s/12).toFixed(2)})" d="M-6 3.5L-6 1Q-4.5 -3.5 -2.3 -.6Q-1 -4.5 1.2 -1Q2.6 -5 5 -1.3Q6.3 .5 6 1.5L6 3.5Z"/>`;
    case 'chefe':return `<g transform="scale(${(s/11).toFixed(2)})"><circle cy="-1" r="4.6"/><rect x="-2.8" y="1.6" width="5.6" height="4" rx="1"/><circle class="ch-mm-eye" cx="-1.7" cy="-1.2" r="1.2"/><circle class="ch-mm-eye" cx="1.7" cy="-1.2" r="1.2"/></g>`;
    case 'boca':{const a=(m.angle??0)+Math.PI/2,dx=Math.cos(a)*s/2,dy=Math.sin(a)*s/2;return `<path d="M${f(-dx)} ${f(-dy)}L${f(dx)} ${f(dy)}"/>`;}
    case 'inicio':return `<rect x="${f(-s/2+.5)}" y="${f(-s/2+.5)}" width="${f(s-1)}" height="${f(s-1)}" transform="rotate(45)"/>`;
  }
}

interface Face {svg:SVGSVGElement;fixed:SVGGElement;marks:SVGGElement;fixedKey:string}
let css:Promise<void>|undefined;
/**
 * Loads city-hud.css once (a failed load is swallowed, as in dev/ux-metrics.ts). Nothing shows unstyled meanwhile: the
 * collapsed minimap is styled by hud.css (.rh-minimap), the big one is hidden until opened, the selector stays hidden
 * until this settles.
 */
export const cityHudCss=()=>css??=import('./city-hud.css').then(()=>undefined,()=>undefined);

/**
 * The collapsed minimap (`element`, the `.rh-minimap` slot) and the big one (`big`, a sibling inserted right after it
 * on the first open). Both are buttons: a tap calls `onTap` (the owner flips `expanded` and calls render again); taps
 * never walk the hero. While `setBlocked(true)` the tap does nothing and the collapsed border is Cone (no blinking).
 */
export class CityMinimap {
  readonly element:HTMLButtonElement;
  readonly big:HTMLButtonElement;
  onTap?:()=>void;
  private readonly doc:Document;
  private readonly small:Face;
  private readonly large:Face;
  private blocked=false;
  constructor(doc:Document){
    this.doc=doc;
    void cityHudCss();
    const button=(className:string,label:string)=>{
      const b=doc.createElement('button');b.type='button';b.className=className;b.setAttribute('aria-label',label);
      b.addEventListener('click',e=>{e.stopPropagation();if(!this.blocked||b===this.big)this.onTap?.();});
      // A HUD control: its taps never walk the hero (VGM-040).
      for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)b.addEventListener(type,e=>e.stopPropagation());
      return b;
    };
    this.element=button('rh-minimap rh-minimap-cidade ch-minimap','Mapa da cidade. Toque para abrir o mapa grande');
    this.element.setAttribute('aria-expanded','false');
    this.big=button('rh-minimap-grande ch-minimap ch-minimap-grande','Mapa grande da cidade. Toque para fechar');
    this.big.setAttribute('aria-expanded','true');this.big.hidden=true;
    this.small=this.face(this.element);this.large=this.face(this.big);
    // The sem-linha sticker in a corner while reconnecting (B13), on both boxes.
    for(const host of [this.element,this.big]){const off=doc.createElement('span');off.className='ch-mm-offline';off.innerHTML=icon('sem-linha');host.append(off);}
  }
  private face(host:HTMLElement):Face{
    const svg=this.doc.createElementNS(SVG,'svg');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    const fixed=this.doc.createElementNS(SVG,'g'),marks=this.doc.createElementNS(SVG,'g');
    fixed.setAttribute('class','ch-mm-fixed');marks.setAttribute('class','ch-mm-marks');
    svg.append(fixed,marks);host.append(svg);
    return {svg,fixed,marks,fixedKey:''};
  }
  private reason:BlockReason|undefined;
  /** Blocks the tap (blockReason): dashed Cone border, and the label says why. `true` means 'bicho'. */
  setBlocked(reason:BlockReason|boolean|undefined){
    const next:BlockReason|undefined=reason===true?'bicho':reason||undefined;
    if(this.reason===next)return;
    this.reason=next;this.blocked=!!next;this.element.classList.toggle('ch-minimap-bloqueado',!!next);
    this.element.setAttribute('aria-label',next==='bicho'?BLOCKED_LABEL:next==='aviso'?NOTICE_BLOCKED_LABEL:'Mapa da cidade. Toque para abrir o mapa grande');
  }
  /** One frame (5 Hz is enough): the collapsed box, or the big one at `input.side` when `expanded`. */
  render(input:CityMinimapInput,expanded:boolean){
    this.element.setAttribute('aria-expanded',String(expanded));
    this.element.classList.toggle('ch-minimap-offline',!!input.offline);
    // While open, the collapsed drawing under the big one is hidden: nothing shows through.
    this.element.classList.toggle('ch-minimap-aberto',expanded);
    if(!expanded){this.big.hidden=true;this.draw(this.small,{...input,side:MINIMAP_SIDE},false);return;}
    const side=Math.max(MINIMAP_SIDE,input.side??MINIMAP_SIDE);
    if(!this.big.isConnected)this.element.after(this.big);
    this.big.hidden=false;this.big.classList.toggle('ch-minimap-offline',!!input.offline);
    // Anchored on the collapsed one's outer corner, in the same offset parent (both are siblings).
    const e=this.element,parentWidth=(e.offsetParent as HTMLElement|null)?.clientWidth??innerWidth;
    const toLeft=e.offsetLeft+e.offsetWidth/2>parentWidth/2;
    Object.assign(this.big.style,{width:`${side}px`,height:`${side}px`,top:`${e.offsetTop}px`,left:`${toLeft?e.offsetLeft+e.offsetWidth-side:e.offsetLeft}px`});
    this.draw(this.large,{...input,side},true);
  }
  private draw(face:Face,input:CityMinimapInput&{side:number},big:boolean){
    const side=input.side,r=innerRadius(side);
    const key=`${input.view}:${side}:${input.map.size}`;
    if(face.fixedKey!==key){
      face.fixedKey=key;face.svg.setAttribute('viewBox',`${-r} ${-r} ${2*r} ${2*r}`);
      const {diamond,avenues,north}=cityFixedLayer(input.map,input.view,side);
      // The letra-n sticker outward of the north mouth, past its wave, as on the compass.
      const n=big&&north?`<svg class="ch-mm-n" x="${f(north.x-north.size/2)}" y="${f(north.y-north.size/2)}" width="${north.size}" height="${north.size}" viewBox="0 0 48 48"><use href="#i-letra-n"/></svg>`:'';
      face.fixed.innerHTML=`<polygon class="ch-mm-city" points="${diamond.map(p=>`${f(p.x)},${f(p.y)}`).join(' ')}"/>`+
        avenues.map(([a,b])=>`<path class="ch-mm-avenue" d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}"/>`).join('')+n;
    }
    const at=(p:{x:number;y:number})=>cityMinimapPoint(p,input.view,side);
    let html='';
    if(big&&input.screen&&input.screen.length>2)html+=`<polygon class="ch-mm-screen" points="${input.screen.map(p=>{const q=at(p);return `${f(q.x)},${f(q.y)}`;}).join(' ')}"/>`;
    if(big)for(const c of (input.chests??[]).slice(0,8)){const q=at(c);html+=`<rect class="ch-mm-bau" x="${f(q.x-3)}" y="${f(q.y-3)}" width="6" height="6"/>`;}
    const marks=cityMinimapMarks(input);
    for(const m of marks)html+=`<g class="ch-mm ch-mm-${m.kind}${m.ping?' ch-mm-ping':''}" transform="translate(${f(m.x)} ${f(m.y)})">${markShape(m)}</g>`;
    // The big one writes the counts of groups of 10 or more (13 px, tnum) in a last layer, over every mark.
    if(big)for(const l of cityMinimapLabels(marks,side))html+=`<text class="ch-mm-num" x="${f(l.x)}" y="${f(l.y)}" text-anchor="${l.anchor}" dominant-baseline="central">${l.text}</text>`;
    face.marks.innerHTML=html;
  }
  /** Closes the big one without drawing (the run left the wave: no frame comes to redraw it). */
  collapse(){
    this.big.hidden=true;this.element.classList.remove('ch-minimap-aberto');this.element.setAttribute('aria-expanded','false');
  }
  destroy(){this.element.remove();this.big.remove();}
}
