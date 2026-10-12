/**
 * Minimap (NEW-20261009-ORQ-minimapa): a small ficha in a corner that is not a thumb, centred on the followed hero and
 * turned with the camera's view (D-019: 4 views of 90°), so "up" on it is "up" on the screen. It shows the team, who is
 * caído, the base, the boss, chests and where critters are about to come in; what is beyond the range sits on the rim.
 * A tap toggles the range (near / far), never the layout, so it never grows over the field. Shapes carry the meaning
 * together with the colour (UX B8): você = filled Lilás disc, aliado = Papel dot, caído = boia ring, base = little
 * house, chefe = Cone diamond, spawn = Cone triangle, baú = Papel square. Pure geometry + one DOM part.
 */
import {rotateVector} from '../projection.ts';

export interface Point {x:number;y:number}
export type MinimapKind='voce'|'aliado'|'caido'|'base'|'chefe'|'spawn'|'bau'|'coco'|'pedra';
export interface MinimapItem {key:string;kind:MinimapKind;x:number;y:number;ping?:boolean}
/** Half side of the drawing in SVG units (the ficha's inside is 2 × MINIMAP_RADIUS). */
export const MINIMAP_RADIUS=36;
/** World units from the centre to the rim, near and far (a tap toggles), island and endless world. */
export const MINIMAP_RANGE={ilha:[14,26],infinito:[22,48]} as const;

/**
 * Minimap point (SVG units, y down, centre 0,0) of a world offset `d` (world units) from the followed hero, under the
 * current view: the same direction the offset has on screen, without the isometric squash (projection.ts: screen
 * x ∝ q.x − q.y, screen y ∝ (q.x + q.y)/2 after rotating by the view). `rim`: the point was clamped to the edge.
 */
export function minimapPoint(d:Point,view:number,range:number,radius=MINIMAP_RADIUS,inset=4){
  const q=rotateVector(d,view);
  const sx=(q.x-q.y)/Math.SQRT2,sy=(q.x+q.y)/Math.SQRT2;
  const k=radius/Math.max(1e-6,range);
  let x=sx*k,y=sy*k;
  const limit=radius-inset,len=Math.hypot(x,y),rim=len>limit;
  if(rim){x*=limit/len;y*=limit/len;}
  return {x,y,rim};
}

/** Island outline (world units), for the drawing's land: the island's ellipse (world.ts isLand). */
export function islandOutline(steps=28):Point[]{
  return Array.from({length:steps},(_,i)=>{const a=i/steps*Math.PI*2;return {x:12+Math.cos(a)*10.6,y:12+Math.sin(a)*10.3};});
}

// ---------- DOM (browser only) ----------
const SVG='http://www.w3.org/2000/svg';
// The base sits above the allies (design soma: a dot hid the tent); você stays on top, it is the centre of the drawing.
export const DRAW_ORDER:Readonly<Record<MinimapKind,number>>={coco:0,pedra:0,bau:1,spawn:2,aliado:3,base:4,chefe:5,caido:6,voce:7};
/**
 * Each mark is the arrow's sticker simplified to its silhouette (design onda 6 D5: one symbol per thing): base = the tent
 * with its flag, chefe = the skull, spawn = the three-crest wave, caído = the boia; allies are people (dots), you the Lilás disc.
 */
const shape=(kind:MinimapKind)=>{
  switch(kind){
    case 'base':return '<path class="mm-flag" d="M0 -7L5 -5.6L0 -4.2Z"/><path d="M-5.5 4.5L0 -4.5L5.5 4.5Z"/>';
    case 'chefe':return '<circle cy="-1" r="4.6"/><rect x="-2.8" y="1.6" width="5.6" height="4" rx="1"/><circle class="mm-eye" cx="-1.7" cy="-1.2" r="1.2"/><circle class="mm-eye" cx="1.7" cy="-1.2" r="1.2"/>';
    case 'spawn':return '<path d="M-6 3.5L-6 1Q-4.5 -3.5 -2.3 -.6Q-1 -4.5 1.2 -1Q2.6 -5 5 -1.3Q6.3 .5 6 1.5L6 3.5Z"/>';
    case 'bau':return '<rect x="-3.5" y="-3" width="7" height="6" rx="1"/>';
    // Gather nodes (VGM-046B), the nearest one per resource, smaller than a person (Ø 6, design soma S2): the coco is
    // half a shell seen from the side (a dome with its white flesh line), never the disc of an ally; the pedra a chip.
    case 'coco':return '<path d="M-3.2 1.2A3.2 3.2 0 0 1 3.2 1.2Z"/><path class="mm-polpa" d="M-2.3 1.2H2.3"/>';
    case 'pedra':return '<path d="M-3 1.2L-2.1 -1.3L.4 -2.4L3 -.9L2.6 1.5L-.4 2.2Z"/>';
    case 'caido':return '<circle r="5"/><circle class="mm-dot" r="1.6"/>';
    case 'voce':return '<circle r="4.5"/>';
    default:return '<circle r="3.5"/>';
  }
};
export class Minimap {
  readonly el:HTMLButtonElement;
  private readonly land:SVGPolygonElement;
  private readonly marks:SVGGElement;
  private readonly nodes=new Map<string,SVGGElement>();
  far=false;
  constructor(parent:HTMLElement){
    const el=this.el=document.createElement('button');el.type='button';el.className='rh-minimap';
    el.setAttribute('aria-label','Minimapa. Toque para ver mais longe');el.setAttribute('aria-pressed','false');
    const r=MINIMAP_RADIUS;
    el.innerHTML=`<svg viewBox="${-r} ${-r} ${2*r} ${2*r}" aria-hidden="true" focusable="false"><polygon class="mm-land"/><circle class="mm-range" r="${r/2}"/><g class="mm-marks"></g></svg>`;
    this.land=el.querySelector('.mm-land')!;this.marks=el.querySelector('.mm-marks')!;
    el.addEventListener('click',()=>{this.far=!this.far;el.setAttribute('aria-pressed',String(this.far));el.classList.toggle('rh-minimap-far',this.far);});
    // A HUD control: its taps never walk the hero (VGM-040).
    for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)el.addEventListener(type,e=>e.stopPropagation());
    parent.append(el);
  }
  /** One frame: `center` = followed hero (world units), items in world units, island outline or none (endless world). */
  render(center:Point,view:number,range:number,items:readonly MinimapItem[],outline?:readonly Point[]){
    const at=(p:Point)=>minimapPoint({x:p.x-center.x,y:p.y-center.y},view,range,MINIMAP_RADIUS,0);
    this.land.setAttribute('points',outline?outline.map(p=>{const q=at(p);return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;}).join(' '):'');
    const live=new Set<string>();
    for(const item of items){
      live.add(item.key);
      let g=this.nodes.get(item.key);
      if(!g||g.dataset.kind!==item.kind){g?.remove();g=document.createElementNS(SVG,'g');g.dataset.kind=item.kind;g.setAttribute('class',`mm mm-${item.kind}`);g.innerHTML=shape(item.kind);this.nodes.set(item.key,g);this.layer(item.kind).append(g);}
      const p=minimapPoint({x:item.x-center.x,y:item.y-center.y},view,range);
      g.setAttribute('transform',`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      g.classList.toggle('mm-rim',p.rim);g.classList.toggle('mm-ping',!!item.ping);
    }
    for(const [key,g] of this.nodes)if(!live.has(key)){g.remove();this.nodes.delete(key);}
  }
  private layers=new Map<MinimapKind,SVGGElement>();
  /** One layer per kind in DRAW_ORDER: você on top, then caído, chefe, base, aliados, spawn, baú, gather nodes. */
  private layer(kind:MinimapKind){
    let g=this.layers.get(kind);
    if(!g){
      if(!this.layers.size)for(const k of (Object.keys(DRAW_ORDER) as MinimapKind[]).sort((a,b)=>DRAW_ORDER[a]-DRAW_ORDER[b])){const l=document.createElementNS(SVG,'g');this.marks.append(l);this.layers.set(k,l);}
      g=this.layers.get(kind)!;
    }
    return g;
  }
  destroy(){this.el.remove();}
}
