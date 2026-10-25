/**
 * Minimap WC3 (card NEW-20261013-ORQ-minimapa-wc3): a square, never turned against the screen (geometry.ts), in the
 * `.rh-minimap` slot. One canvas: the terrain image (terrain.ts, one drawImage), then the marks — structures as small
 * squares, critters red (the boss bigger, pulsing), allies in their colour, you bigger with an arrow — and the white
 * camera rectangle. The owner calls render at ≤ 10 Hz; the marks' buffers are reused (no allocation per draw).
 *
 * Input: a mouse click moves the hero there (as a click on the ground; onMove), Alt+click or a touch pings (onPing,
 * a pulsing ring on the minimap). Alerts blink: the base under attack, a fallen ally, the boss.
 */
import {fromMini,imageTransform,insideMini,toMini,type MiniFrame,type Pt} from './geometry.ts';
import {MM_COLORS,type TerrainImage} from './terrain.ts';
import {MM_CELL,faceCell,iconCell,marksAtlas,type MmIcon} from './art.ts';

/** Player colours by join order: the dot on the minimap and the outer ring of the portrait in the team strip (team.ts). */
/**
 * The bank's "$", drawn once per size in its own canvas (BUG-20261025-ORQ-celular-travando): setting the minimap
 * canvas's `font` made the page recompute its styles (the HUD writes some every frame) for every bank of every paint,
 * ~1 s a minute on a phone (Chrome trace, 25/10). An OffscreenCanvas has no page styles to wait for.
 */
const glyphs=new Map<string,{image:CanvasImageSource;size:number}|null>();
/** The glyph for a `px` font under the canvas's scale `k` (drawn at k× so it lands 1:1 on the device pixels); size in px. */
export function dollarGlyph(px:number,k=1){
  const scale=Math.max(.25,Math.round(k*100)/100),key=`${px}@${scale}`;
  let glyph=glyphs.get(key);
  if(glyph===undefined){
    glyph=null;
    const side=Math.ceil(px*1.4*scale),canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(side,side):undefined;
    const g=canvas?.getContext('2d');
    if(canvas&&g){g.fillStyle='#1d1830';g.font=`bold ${px*scale}px sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText('$',side/2,side/2);glyph={image:canvas,size:side/scale};}
    glyphs.set(key,glyph);
  }
  return glyph;
}
export const ALLY_COLORS=Object.freeze(['#ffd23f','#3ec1d3','#ff7aa2','#8be04e','#b38cff','#ff9f43']);
/** A player's colour: by their place in the run's player list (join order), the same on the minimap and the strip. */
export function teamColor(players:readonly {id:string}[],id:string):string{
  const i=players.findIndex(p=>p.id===id);
  return ALLY_COLORS[(i<0?0:i)%ALLY_COLORS.length];
}
export interface MmUnit {x:number;y:number}
/** `classId`: their face (art.ts) in a ring of `color`; without art or a face, a dot of `color`. */
export interface MmAlly extends MmUnit {color:string;downed?:boolean;classId?:string}
export interface MmEnemy extends MmUnit {boss?:boolean}
/** `nest` (D-051): an enemy nest someone has seen, its roof sized by `size`. */
export interface MmStructure extends MmUnit {kind:'base'|'tower'|'site'|'barricade'|'nest';hit?:boolean;size?:'P'|'M'|'G'}
/** Extra marks of other cards (the keymaker's moto, car and route, D-047): a dot, or a dashed line through `points`. */
/**
 * `state`: how the icon shows it (art.ts) — a bank `vazio` dims, `bicho` (robbed) and a moto's `ajuda` blink a ring
 * of `color`.
 */
export interface MmExtra {kind:string;x:number;y:number;color?:string;points?:readonly Pt[];state?:'cheio'|'bicho'|'vazio'|'ajuda'}
export interface MmInput {
  frame:MiniFrame;terrain:TerrainImage;
  /** The map's edge (the city's playable square): a light line around it. */
  border?:{x:number;y:number;w:number;h:number};
  /** The camera's view (geometry.ts cameraQuad), in minimap px. */
  camera?:readonly Pt[];
  self?:MmUnit&{dx:number;dy:number;classId?:string};allies:readonly MmAlly[];enemies:readonly MmEnemy[];structures:readonly MmStructure[];
  extras?:readonly MmExtra[];nowMs:number;
}

const PING_MS=1600;
/** A nest's mark half-size (minimap px) by its size. */
const NEST_MARK={P:3.2,M:4,G:5} as const;
/** The icons of the structures and extras (art.ts), and their half-size in marks' units. */
const STRUCTURE_ICON={base:['base',6.4],tower:['torre',4.6],site:['obra',3.8],barricade:['barricada',4.6]} as const satisfies Record<string,readonly [MmIcon,number]>;
const EXTRA_ICON:Readonly<Record<string,readonly [MmIcon,number]>>={banco:['banco',5.4],carro:['uno',5.4],moto:['moto',5],entrega:['entrega',5]};
/** Faces' radius (marks' units): ~12.5 CSS px across on a phone's 124 px minimap; yours a little bigger. */
const ALLY_R=5,SELF_R=5.6;

export class WcMinimap {
  readonly el:HTMLDivElement;
  private readonly canvas:HTMLCanvasElement;
  private readonly ctx:CanvasRenderingContext2D;
  private frame?:MiniFrame;
  private readonly pt:Pt={x:0,y:0};
  /**
   * The element's CSS width, kept by a ResizeObserver (its callback runs with the layout fresh): reading clientWidth in
   * render() forced a layout 10 times a second in the middle of the frame's DOM writes (estudo-desempenho §3.2, F3).
   */
  private cssWidth?:number;
  /** Mouse click (not Alt): walk there, as a click on the ground. */
  onMove?:(world:Pt)=>void;
  /** Touch or Alt+click: a ping at that world point. */
  onPing?:(world:Pt)=>void;
  constructor(doc:Document){
    this.el=doc.createElement('div');this.el.className='rh-minimap rh-mm';
    this.el.setAttribute('role','img');this.el.setAttribute('aria-label','Mapa: clique para ir, toque para marcar');
    this.canvas=doc.createElement('canvas');this.canvas.className='rh-mm-canvas';this.el.append(this.canvas);
    this.ctx=this.canvas.getContext('2d')!;
    if(typeof ResizeObserver==='function')new ResizeObserver(()=>{this.cssWidth=this.el.clientWidth;}).observe(this.el);
    for(const type of ['pointerup','touchstart','mousedown','click'] as const)this.el.addEventListener(type,e=>e.stopPropagation());
    this.el.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();this.press(e);});
    this.el.addEventListener('contextmenu',e=>e.preventDefault());
  }
  private press(e:PointerEvent){
    const f=this.frame;if(!f)return;
    const r=this.canvas.getBoundingClientRect();if(!(r.width>0))return;
    const m={x:(e.clientX-r.left)/r.width*f.side,y:(e.clientY-r.top)/r.height*f.side};
    if(!insideMini(m,f))return;
    const world=fromMini(m,f);
    if(e.pointerType==='mouse'&&!e.altKey&&e.button===0)this.onMove?.(world);
    else{this.ping(m);this.onPing?.(world);}
  }
  /** A teammate's ping (relayed by the room): a ring in their colour, when the point is on the minimap now. */
  pingWorld(world:Pt,color?:string){
    const f=this.frame;if(!f)return;
    const m=toMini(world,f);if(insideMini(m,f))this.ping(m,color);
  }
  /** A pulsing ring at a minimap point (CSS animation: smooth whatever the draw rate). */
  ping(m:Pt,color?:string){
    const f=this.frame;if(!f)return;
    const ring=this.el.ownerDocument.createElement('i');ring.className='rh-mm-ping';
    if(color)ring.style.borderColor=color;
    ring.style.left=`${m.x/f.side*100}%`;ring.style.top=`${m.y/f.side*100}%`;
    this.el.append(ring);setTimeout(()=>ring.remove(),PING_MS);
  }
  /** Draws a frame (call at ≤ 10 Hz). The canvas follows the element's size × device pixels. */
  render(input:MmInput){
    const f=this.frame=input.frame,dpr=Math.min(2,globalThis.devicePixelRatio||1);
    const css=(this.cssWidth??this.el.clientWidth)||f.side,px=Math.round(css*dpr);
    if(this.canvas.width!==px){this.canvas.width=px;this.canvas.height=px;}
    const ctx=this.ctx,k=px/f.side,blink=Math.floor(input.nowMs/350)%2===0;
    // Marks grow a little on a small minimap (a phone): legible dots before a faithful scale.
    const p=this.pt,unit=f.side/120*Math.min(1.35,Math.max(1,150/css));
    // The ground (terrain and edge) as one unturned blit: it changes only with the size, the view or the window.
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(this.ground(input,px,unit) as CanvasImageSource,0,0);
    ctx.setTransform(k,0,0,k,0,0);
    // The marks' art (art.ts) scaled down smoothly; until it loads, the drawn shapes below.
    const atlas=marksAtlas();
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='medium';
    // Extras' lines (the keymaker's route) under the marks.
    for(const x of input.extras??[])if(x.points&&x.points.length>1){
      ctx.beginPath();x.points.forEach((q,i)=>{toMini(q,f,p);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});
      ctx.setLineDash([3*unit,2*unit]);ctx.lineWidth=1.6*unit;ctx.strokeStyle=x.color??'#fff4d6';ctx.stroke();ctx.setLineDash([]);
    }
    // Nests (D-051): an enemy building's red roof (WC3), under the other marks.
    for(const s of input.structures)if(s.kind==='nest'){
      toMini(s,f,p);if(!insideMini(p,f))continue;
      const r=NEST_MARK[s.size??'M']*unit;
      if(atlas){this.icon(atlas,iconCell('ninho'),p.x,p.y,r*1.25);continue;}
      ctx.beginPath();ctx.moveTo(p.x,p.y-r);ctx.lineTo(p.x+r,p.y-r*.15);ctx.lineTo(p.x+r*.75,p.y+r*.8);ctx.lineTo(p.x-r*.75,p.y+r*.8);ctx.lineTo(p.x-r,p.y-r*.15);ctx.closePath();
      ctx.fillStyle='#b3261e';ctx.fill();ctx.lineWidth=1.2*unit;ctx.strokeStyle='#fff4d6';ctx.stroke();
    }
    for(const s of input.structures){
      if(s.kind==='nest')continue;
      toMini(s,f,p);if(!insideMini(p,f))continue;
      if(atlas){
        const [name,h]=STRUCTURE_ICON[s.kind],r=h*unit;
        if(s.kind==='site')ctx.globalAlpha=.75;
        this.icon(atlas,iconCell(name),p.x,p.y,r);ctx.globalAlpha=1;
        if(s.hit&&blink){ctx.lineWidth=1.6*unit;ctx.strokeStyle='#ff3b30';ctx.strokeRect(p.x-r-unit,p.y-r-unit,2*r+2*unit,2*r+2*unit);}
        continue;
      }
      const r=(s.kind==='base'?4.5:s.kind==='site'?1.6:2.4)*unit;
      ctx.fillStyle=s.kind==='base'?'#fff4d6':s.kind==='site'?'rgba(255,244,214,.55)':s.kind==='barricade'?'#c9a46a':'#7fd1ff';
      ctx.fillRect(p.x-r,p.y-r,2*r,2*r);ctx.lineWidth=1*unit;ctx.strokeStyle='#1d1830';ctx.strokeRect(p.x-r,p.y-r,2*r,2*r);
      if(s.hit&&blink){ctx.lineWidth=1.6*unit;ctx.strokeStyle='#ff3b30';ctx.strokeRect(p.x-r-2*unit,p.y-r-2*unit,2*r+4*unit,2*r+4*unit);}
    }
    ctx.fillStyle='#ff3b30';
    for(const en of input.enemies){
      toMini(en,f,p);if(!insideMini(p,f))continue;
      if(en.boss)continue;
      ctx.fillRect(p.x-1.3*unit,p.y-1.3*unit,2.6*unit,2.6*unit);
    }
    for(const en of input.enemies)if(en.boss){
      toMini(en,f,p);if(!insideMini(p,f))continue;
      if(atlas){this.icon(atlas,iconCell('chefao'),p.x,p.y,(blink?6.2:5.4)*unit);continue;}
      const r=(blink?4.6:3.8)*unit;
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle='#ff3b30';ctx.fill();ctx.lineWidth=1.4*unit;ctx.strokeStyle='#fff4d6';ctx.stroke();
    }
    for(const x of input.extras??[])if(!x.points){
      toMini(x,f,p);if(!insideMini(p,f))continue;
      const art=atlas&&EXTRA_ICON[x.kind];
      if(atlas&&art){
        const h=art[1]*unit;
        if((x.state==='bicho'||x.state==='ajuda')&&blink){ctx.beginPath();ctx.arc(p.x,p.y,h+1.4*unit,0,Math.PI*2);ctx.lineWidth=1.6*unit;ctx.strokeStyle=x.color??'#ff9f43';ctx.stroke();}
        if(x.state==='vazio')ctx.globalAlpha=.45;
        this.icon(atlas,iconCell(art[0]),p.x,p.y,h);ctx.globalAlpha=1;
        continue;
      }
      if(x.kind==='banco'){
        // Bancos (hud/bancos.ts): a "$" square in the bank's colour, a Breu edge.
        const h=4*unit;
        ctx.fillStyle=x.color??'#7ED957';ctx.fillRect(p.x-h,p.y-h,2*h,2*h);ctx.lineWidth=1*unit;ctx.strokeStyle='#1d1830';ctx.strokeRect(p.x-h,p.y-h,2*h,2*h);
        const px=Math.round(7*unit),glyph=dollarGlyph(px,k);
        if(glyph)ctx.drawImage(glyph.image,p.x-glyph.size/2,p.y+.5*unit-glyph.size/2,glyph.size,glyph.size);
        continue;
      }
      if(x.kind==='caixa'){
        // Caixas (hud/crate-extras.ts): a small square in the rarity's colour, a Breu edge (under the allies and the hero).
        const h=2.2*unit;
        ctx.fillStyle=x.color??'#3EAA4F';ctx.fillRect(p.x-h,p.y-h,2*h,2*h);ctx.lineWidth=1*unit;ctx.strokeStyle='#1d1830';ctx.strokeRect(p.x-h,p.y-h,2*h,2*h);
        continue;
      }
      ctx.beginPath();ctx.arc(p.x,p.y,3*unit,0,Math.PI*2);ctx.fillStyle=x.color??'#ff9f43';ctx.fill();ctx.lineWidth=1*unit;ctx.strokeStyle='#1d1830';ctx.stroke();
    }
    for(const al of input.allies){
      toMini(al,f,p);if(!insideMini(p,f))continue;
      const face=atlas?faceCell(al.classId):-1;
      if(face>=0){this.face(atlas!,face,p.x,p.y,ALLY_R*unit,al.downed&&blink?'#ff3b30':al.color,unit);continue;}
      if(al.downed&&!blink)continue;
      ctx.beginPath();ctx.arc(p.x,p.y,3*unit,0,Math.PI*2);ctx.fillStyle=al.downed?'#ff3b30':al.color;ctx.fill();ctx.lineWidth=1.2*unit;ctx.strokeStyle='#1d1830';ctx.stroke();
    }
    const me=input.self;
    if(me){
      toMini(me,f,p);const x=p.x,y=p.y;
      // The direction on the minimap: the world step taken through the same map.
      toMini({x:me.x+me.dx,y:me.y+me.dy},f,p);let dx=p.x-x,dy=p.y-y;const l=Math.hypot(dx,dy);
      const face=atlas?faceCell(me.classId):-1;
      if(face>=0){
        // Your face in a white ring, the heading's arrow out of it (under the face).
        const r=SELF_R*unit;
        if(l>1e-6){dx/=l;dy/=l;const tip=r+4.6*unit,base=r-.6*unit,w=3*unit;
          ctx.beginPath();ctx.moveTo(x+dx*tip,y+dy*tip);ctx.lineTo(x+dx*base-dy*w,y+dy*base+dx*w);ctx.lineTo(x+dx*base+dy*w,y+dy*base-dx*w);ctx.closePath();
          ctx.fillStyle='#ffffff';ctx.fill();ctx.lineWidth=1*unit;ctx.strokeStyle='#1d1830';ctx.stroke();}
        this.face(atlas!,face,x,y,r,'#ffffff',unit);
      }else{
      ctx.beginPath();ctx.arc(x,y,4*unit,0,Math.PI*2);ctx.fillStyle='#ffffff';ctx.fill();ctx.lineWidth=1.6*unit;ctx.strokeStyle='#1d1830';ctx.stroke();
      if(l>1e-6){dx/=l;dy/=l;const tip=9*unit,w=3.2*unit;
        ctx.beginPath();ctx.moveTo(x+dx*tip,y+dy*tip);ctx.lineTo(x+dx*4*unit-dy*w,y+dy*4*unit+dx*w);ctx.lineTo(x+dx*4*unit+dy*w,y+dy*4*unit-dx*w);ctx.closePath();
        ctx.fillStyle='#ffffff';ctx.fill();ctx.lineWidth=1*unit;ctx.strokeStyle='#1d1830';ctx.stroke();}
      }
    }
    const cam=input.camera;
    if(cam&&cam.length===4){
      // White on a Breu shadow: it reads on the snow as on the grass. Thin and see-through (minimapa-arte-chatgpt: the
      // player took the bold one for the Uno).
      ctx.beginPath();for(let i=0;i<4;i++){const q=cam[i];if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);}ctx.closePath();
      ctx.lineWidth=2.2*unit;ctx.strokeStyle='rgba(29,24,48,.55)';ctx.stroke();
      ctx.lineWidth=1*unit;ctx.strokeStyle='rgba(255,255,255,.7)';ctx.stroke();
    }
  }
  /**
   * The outside, the terrain (one image, one transform; nearest for the per-cell images, smooth for painted art) and
   * the map's edge, drawn into a canvas of their own and kept while nothing they depend on changed: the city's painted
   * 512 px image turned and filtered every paint cost more than all the marks (minimapa-arte-chatgpt, harness bench).
   */
  private ground(input:MmInput,px:number,unit:number){
    const f=input.frame,t=input.terrain,edge=input.border,g=this.groundCache;
    if(g&&g.terrain===t&&g.px===px&&g.view===f.view&&g.cx===f.center.x&&g.cy===f.center.y&&g.span===f.span&&g.edge===edge&&g.unit===unit)return g.canvas;
    const canvas=g?.canvas.width===px?g.canvas:typeof OffscreenCanvas==='function'?new OffscreenCanvas(px,px):Object.assign(this.el.ownerDocument.createElement('canvas'),{width:px,height:px});
    const ctx=canvas.getContext('2d') as CanvasRenderingContext2D,k=px/f.side,p=this.pt;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=MM_COLORS.outside;ctx.fillRect(0,0,px,px);
    const [a,b,c,d,e,h]=imageTransform(f,t.origin,t.unit);
    ctx.imageSmoothingEnabled=!!t.smooth;if(t.smooth)ctx.imageSmoothingQuality='high';
    ctx.setTransform(a*k,b*k,c*k,d*k,e*k,h*k);
    ctx.drawImage(t.canvas as CanvasImageSource,0,0);
    ctx.setTransform(k,0,0,k,0,0);
    if(edge){
      ctx.beginPath();
      for(let i=0;i<4;i++){toMini({x:edge.x+(i===1||i===2?edge.w:0),y:edge.y+(i>=2?edge.h:0)},f,p);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}
      ctx.closePath();ctx.lineWidth=1.2*unit;ctx.strokeStyle='rgba(255,244,214,.75)';ctx.stroke();
    }
    this.groundCache={canvas,terrain:t,px,view:f.view,cx:f.center.x,cy:f.center.y,span:f.span,edge,unit};
    return canvas;
  }
  private groundCache?:{canvas:HTMLCanvasElement|OffscreenCanvas;terrain:TerrainImage;px:number;view:number;cx:number;cy:number;span:number;edge?:MmInput['border'];unit:number};
  /** One atlas cell centred at (x, y), `h` its half-size. */
  private icon(atlas:CanvasImageSource,cell:number,x:number,y:number,h:number){
    this.ctx.drawImage(atlas,cell*MM_CELL,0,MM_CELL,MM_CELL,x-h,y-h,2*h,2*h);
  }
  /** A face: a disc of `ring` (it shows round the head), the face inside, a Breu edge. */
  private face(atlas:CanvasImageSource,cell:number,x:number,y:number,r:number,ring:string,unit:number){
    const ctx=this.ctx;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=ring;ctx.fill();
    this.icon(atlas,cell,x,y,r-1.1*unit);
    ctx.lineWidth=.9*unit;ctx.strokeStyle='#1d1830';ctx.stroke();
  }
}
