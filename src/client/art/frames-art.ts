/**
 * Imported art v2 for the frames and the ground marks (NEW-20261012-ORQ-importar-arte-c-completa, items 3 and 5).
 * - 9-slice frames (group `efeitos`, plus the name plaque of `props`): the speech balloon and the "DEVENDO" tag behind
 *   their code-drawn text, the critters' life bars (frame + fill, normal and elite) and the place-name plaque. The
 *   frame stretches to today's box; its corners keep their texture size × the element's UI scale.
 * - Ground marks (group `efeitos`, 1 view, frames played at the file's fps): target ring, skill ring, destination
 *   marker, the "Você" ring, the caído's rescue ring + light column and the spawn warning. Each is drawn at today's
 *   size (the cell's width = today's outer width; the art is drawn in the game camera, so the height follows the cell)
 *   and position (the file's anchor, or MARK_ANCHOR, on today's centre point).
 * A missing piece (always, with an empty manifest), a missing texture or a non-WebGL renderer keeps today's drawing
 * for that element only: nothing here creates a Game Object until the art for it is loaded.
 *
 * Pure helpers (SLICE_PIECES, MARK_PIECES, sliceArt, markArt, barArt, barFillWidth, markFrame, framesLoads) run in node
 * tests; the Phaser side imports Phaser as a type only, so this module loads without Phaser.
 */
import type Phaser from 'phaser';
import {artPages,artPiece,artUrl,type ArtFile,type ArtGroupId,type ArtPiece} from './manifest.ts';

type NineSlice=Phaser.GameObjects.NineSlice;
type Image=Phaser.GameObjects.Image;

// ---------- which element uses which piece ----------
export type SliceElement='balloon'|'tag'|'barFrame'|'barFill'|'barFrameElite'|'barFillElite'|'plaque';
/** 9-slice pieces (scripts/art-v2/spec.mjs EFEITOS and PROPS). */
export const SLICE_PIECES:Readonly<Record<SliceElement,{group:ArtGroupId;id:string}>>={
  balloon:{group:'efeitos',id:'balao-fala'},
  tag:{group:'efeitos',id:'etiqueta-devendo'},
  barFrame:{group:'efeitos',id:'barra-vida-moldura'},
  barFill:{group:'efeitos',id:'barra-vida-preenchimento'},
  barFrameElite:{group:'efeitos',id:'barra-vida-moldura-elite'},
  barFillElite:{group:'efeitos',id:'barra-vida-preenchimento-elite'},
  plaque:{group:'props',id:'plaquinha'},
};
export type MarkElement='target'|'skill'|'destination'|'you'|'rescue'|'spawn';
/** Ground marks, all in group `efeitos` (strips of 1 view). */
export const MARK_PIECES:Readonly<Record<MarkElement,string>>={
  target:'anel-alvo',skill:'anel-habilidade',destination:'marcador-destino',you:'heroi-voce',rescue:'caido-resgate',spawn:'aviso-spawn',
};
/**
 * Where today's centre point falls in the cell when the file has no `anchor`: the middle of the square rings; for the
 * 128×256 caído piece the middle of its bottom square (the ring), the light column rising above it.
 */
export const MARK_ANCHOR:Readonly<Record<MarkElement,readonly [number,number]>>={
  target:[.5,.5],skill:[.5,.5],destination:[.5,.5],you:[.5,.5],rescue:[.5,.75],spawn:[.5,.5],
};
/**
 * Effect strips drawn like marks but not on the ground (NEW-20261012-ORQ-importar-arte-d-restos item 5): the blackout's
 * eyes in the dark (`olhos-escuro`, 64×32, a pair of eyes, 4 blink frames). Loaded with the marks, never in MARK_PIECES.
 */
export type FxMarkElement='eyes'|'aura'|'reflect'|'sugar'|'crown'|'sparkGold'|'sparkPink'|'glint'|'headlight';
/**
 * Also the Elenco P1 state cues of layers.ts drawPhase (NEW-20261028-ORQ-efeitos-ataque-chatgpt): the coach's lecture
 * ring, the influencer's reflect ring, the açucarado halo, the Cliente Prime's crown, the buff / açucarado sparkles, the
 * reflect glint and the motoboy's headlight.
 */
export const FX_MARK_PIECES:Readonly<Record<FxMarkElement,string>>={eyes:'olhos-escuro',aura:'anel-fase-coach',reflect:'anel-fase-gelo',
  sugar:'anel-fase-acucar',crown:'coroa-prime',sparkGold:'brilho-dourado',sparkPink:'brilho-rosa',glint:'brilho-branco',headlight:'farol-moto'};
const ALL_MARKS:Readonly<Record<MarkElement|FxMarkElement,string>>={...MARK_PIECES,...FX_MARK_PIECES};
const ALL_ANCHORS:Readonly<Record<MarkElement|FxMarkElement,readonly [number,number]>>={...MARK_ANCHOR,eyes:[.5,.5],aura:[.5,.5],
  reflect:[.5,.5],sugar:[.5,.5],crown:[.5,.5],sparkGold:[.5,.5],sparkPink:[.5,.5],glint:[.5,.5],headlight:[.5,.5]};
/** Frames per second when the file says none. */
export const MARK_FPS=8;

export const sliceKey=(group:ArtGroupId,id:string)=>`art:slice:${group}:${id}`;
export const markKey=(id:string)=>`art:mark:${id}`;

const fileOf=(piece:ArtPiece):ArtFile|undefined=>piece.files.sheet??Object.values(piece.files)[0];
/** The single page of a file, or undefined (a paged sheet is not a frame or a mark: today's drawing stays). */
const onePage=(file:ArtFile)=>{const pages=artPages(file);return pages.length===1?pages[0]:undefined;};

export interface SliceArt {key:string;group:ArtGroupId;id:string;cell:readonly [number,number];left:number;top:number;right:number;bottom:number}
const sliceCache=new WeakMap<ArtPiece,SliceArt|null>();
/**
 * The 9-slice of `element` from the current manifest: texture key, cell and insets (the importer's `slice`
 * [left, top, right, bottom], passed through). Undefined without the piece, without a valid slice or with a paged file.
 * A slice with no top and bottom (or no left and right) inset is refused too: Phaser would make it a 3-slice of fixed
 * height (width), which cannot stretch to today's box, so that element keeps today's drawing.
 */
export function sliceArt(element:SliceElement):SliceArt|undefined{
  const {group,id}=SLICE_PIECES[element],piece=artPiece(group,id);
  if(!piece)return undefined;
  let art=sliceCache.get(piece);
  if(art===undefined){
    const file=fileOf(piece),s=file?.slice;
    const ok=!!file&&!!onePage(file)&&Array.isArray(s)&&s.length===4&&s.every(n=>Number.isInteger(n)&&n>=0)&&
      s[0]+s[2]>0&&s[1]+s[3]>0&&s[0]+s[2]<file.cell[0]&&s[1]+s[3]<file.cell[1];
    art=ok?{key:sliceKey(group,id),group,id,cell:[file!.cell[0],file!.cell[1]],left:s![0],top:s![1],right:s![2],bottom:s![3]}:null;
    sliceCache.set(piece,art);
  }
  return art??undefined;
}
export interface BarArt {frame:SliceArt;fill:SliceArt}
/** The last pair per variant (0 normal, 1 elite): the same object every frame until the manifest changes. */
const barCache:(BarArt|undefined)[]=[undefined,undefined];
/**
 * The life bar is a pair (frame + fill) of the variant: elite (not the boss) uses the elite pair, the rest the normal
 * pair. A variant with only one of its two pieces keeps today's bar (no mixing of art and procedural, nor of variants).
 * Allocation-free per frame: the pair is cached per variant (sliceArt itself is cached per piece).
 */
export function barArt(elite:boolean):BarArt|undefined{
  const frame=sliceArt(elite?'barFrameElite':'barFrame'),fill=sliceArt(elite?'barFillElite':'barFill');
  if(!frame||!fill)return undefined;
  const i=elite?1:0,cached=barCache[i];
  if(cached&&cached.frame===frame&&cached.fill===fill)return cached;
  return barCache[i]={frame,fill};
}
/**
 * Width of the bar's fill for `ratio` of hp over today's inner width `inner` (world px): 0 when empty, else at least
 * `min` (the fill's left + right insets on screen, so its 9-slice never folds), never more than `inner`.
 */
export function barFillWidth(inner:number,ratio:number,min=0):number{
  const r=Number.isFinite(ratio)?Math.max(0,Math.min(1,ratio)):0;
  if(r<=0||inner<=0)return 0;
  return Math.min(inner,Math.max(min,inner*r));
}

export interface MarkArt {key:string;id:string;cell:readonly [number,number];frames:number;fps:number;anchor:readonly [number,number]}
const markCache=new WeakMap<ArtPiece,Map<MarkElement|FxMarkElement,MarkArt|null>>();
/** The ground mark (or FX mark) of `element` from the current manifest (texture key, cell, frames, fps, anchor), or undefined. */
export function markArt(element:MarkElement|FxMarkElement):MarkArt|undefined{
  const id=ALL_MARKS[element],piece=artPiece('efeitos',id);
  if(!piece)return undefined;
  let byElement=markCache.get(piece);
  if(!byElement){byElement=new Map();markCache.set(piece,byElement);}
  let art=byElement.get(element);
  if(art===undefined){
    const file=fileOf(piece),page=file&&onePage(file);
    const fps=typeof file?.fps==='number'?file.fps:undefined;
    art=file&&page?{key:markKey(id),id,cell:[file.cell[0],file.cell[1]],frames:Math.max(1,page.frameCount),
      fps:fps&&fps>0?fps:MARK_FPS,anchor:file.anchor??ALL_ANCHORS[element]}:null;
    byElement.set(element,art);
  }
  return art??undefined;
}
/** Frame of a mark `timeMs` into its loop (reduced motion: the first frame, still). */
export function markFrame(art:MarkArt,timeMs:number,reduced=false):number{
  if(reduced||art.frames<=1)return 0;
  return Math.floor(Math.max(0,timeMs)/1000*art.fps)%art.frames;
}

export interface FramesLoad {key:string;url:string;cell:readonly [number,number];sheet:boolean}
/** Every texture this module needs, from the current manifest (empty manifest → []). */
export function framesLoads():FramesLoad[]{
  const out:FramesLoad[]=[];
  for(const element of Object.keys(SLICE_PIECES) as SliceElement[]){
    const art=sliceArt(element);if(!art)continue;
    const file=fileOf(artPiece(art.group,art.id) as ArtPiece) as ArtFile,url=artUrl(art.group,artPages(file)[0].file);
    if(url&&!out.some(l=>l.key===art.key))out.push({key:art.key,url,cell:art.cell,sheet:false});
  }
  for(const element of Object.keys(ALL_MARKS) as (MarkElement|FxMarkElement)[]){
    const art=markArt(element);if(!art)continue;
    const file=fileOf(artPiece('efeitos',art.id) as ArtPiece) as ArtFile,url=artUrl('efeitos',artPages(file)[0].file);
    if(url&&!out.some(l=>l.key===art.key))out.push({key:art.key,url,cell:art.cell,sheet:true});
  }
  return out;
}

// ---------- Phaser side ----------
/** Preload (called by horde-art queueHordeArt): queues every frame and mark texture; nothing with an empty manifest. */
export function queueFramesArt(scene:Phaser.Scene){
  for(const l of framesLoads()){
    if(scene.textures.exists(l.key))continue;
    if(l.sheet)scene.load.spritesheet(l.key,l.url,{frameWidth:l.cell[0],frameHeight:l.cell[1]});
    else scene.load.image(l.key,l.url);
  }
}
/** Phaser.WEBGL: NineSlice is WebGL only (Phaser 3.60+); under Canvas the frames keep today's drawing. */
const WEBGL=2;
const webgl=(scene:Phaser.Scene)=>(scene.sys.game.renderer as {type?:number}|undefined)?.type===WEBGL;

const ownSlices=new WeakMap<object,NineSlice>();
/**
 * The NineSlice owned by `owner` (one per owner, made on first use and kept), showing `art`; undefined when its texture
 * is not loaded or the renderer is not WebGL. Hidden until placed.
 */
export function sliceFor(scene:Phaser.Scene,owner:object,art:SliceArt):NineSlice|undefined{
  if(!scene.textures.exists(art.key)||!webgl(scene))return undefined;
  let s=ownSlices.get(owner);
  if(!s){
    s=scene.add.nineslice(0,0,art.key,undefined,art.cell[0],art.cell[1],art.left,art.right,art.top,art.bottom).setOrigin(0,0).setVisible(false);
    ownSlices.set(owner,s);
  }else if(s.texture.key!==art.key){
    s.setTexture(art.key);s.setSlices(art.cell[0],art.cell[1],art.left,art.right,art.top,art.bottom);
  }
  return s;
}
/** Hides the owner's NineSlice, if it has one. */
export function hideSlice(owner:object){ownSlices.get(owner)?.setVisible(false);}
/** Destroys the owner's NineSlice, if it has one. */
export function dropSlice(owner:object){const s=ownSlices.get(owner);if(s){s.destroy();ownSlices.delete(owner);}}
/**
 * Puts a NineSlice over the box (x, y, w, h) in world px, its corners drawn at `scale` × their texture size (the
 * element's UI scale), never folded (the box is at least the insets).
 */
export function placeSlice(s:NineSlice,art:SliceArt,x:number,y:number,w:number,h:number,scale=1):NineSlice{
  const k=scale>0?scale:1,sw=Math.max(art.left+art.right+1,w/k),sh=Math.max(art.top+art.bottom+1,h/k);
  if(Math.abs(s.width-sw)>.01||Math.abs(s.height-sh)>.01)s.setSize(sw,sh);
  return s.setPosition(x,y).setScale(k).setVisible(true);
}
/**
 * Shows mark `art` on `image` at frame `frame`, its anchor on (x, y), `width` world px wide (the cell scaled evenly).
 * Only touches the texture when it changes.
 */
export function placeMark(image:Image,art:MarkArt,frame:number,x:number,y:number,width:number):Image{
  if(image.texture.key!==art.key)image.setTexture(art.key,frame);else image.setFrame(frame);
  return image.setOrigin(art.anchor[0],art.anchor[1]).setPosition(x,y).setScale(width/art.cell[0]).setVisible(true);
}

/**
 * Per-renderer pool of the frames and marks it draws every frame: `begin()` at the start of the frame hides what was
 * shown last frame, `slice`/`mark` show what is drawn now. Owners are the renderer's own pooled objects (or a fixed
 * key), so the pool stops growing once every owner has its object: no Game Object is made or destroyed per frame.
 */
export class FramesPool {
  private readonly marks=new Map<unknown,Image>();
  private readonly owned:object[]=[];
  private readonly shown:(Image|NineSlice)[]=[];
  private readonly scene:Phaser.Scene;
  constructor(scene:Phaser.Scene){this.scene=scene;}
  /** Whether `art`'s texture is in (and, for a 9-slice, the renderer can draw it). */
  ready(art:SliceArt|MarkArt|undefined):boolean{return !!art&&this.scene.textures.exists(art.key)&&('left' in art?webgl(this.scene):true);}
  begin(){for(let i=0;i<this.shown.length;i++)this.shown[i].setVisible(false);this.shown.length=0;}
  /** The owner's NineSlice for `art` at `depth`, placed over (x, y, w, h); undefined when not ready (today's drawing). */
  slice(owner:object,art:SliceArt|undefined,depth:number,x:number,y:number,w:number,h:number,scale=1):NineSlice|undefined{
    if(!art)return undefined;
    const fresh=!ownSlices.has(owner),s=sliceFor(this.scene,owner,art);
    if(!s)return undefined;
    if(fresh)this.owned.push(owner);
    this.shown.push(s);
    return placeSlice(s,art,x,y,w,h,scale).setDepth(depth);
  }
  /** The owner's mark image for `art` at `depth` (frame, anchor on (x, y), `width` wide); undefined when not ready. */
  mark(owner:unknown,art:MarkArt|undefined,depth:number,frame:number,x:number,y:number,width:number):Image|undefined{
    if(!art||!this.scene.textures.exists(art.key))return undefined;
    let image=this.marks.get(owner);
    if(!image){image=this.scene.add.image(0,0,art.key,frame);this.marks.set(owner,image);}
    this.shown.push(image);
    return placeMark(image,art,frame,x,y,width).setDepth(depth).setAlpha(1);
  }
  /** Game Objects made so far (stats and tests of the empty manifest). */
  get created(){return this.marks.size+this.owned.length;}
  destroy(){
    for(const image of this.marks.values())image.destroy();
    this.marks.clear();for(const owner of this.owned)dropSlice(owner);this.owned.length=0;this.shown.length=0;
  }
}

type Pt={x:number;y:number};
/**
 * Scene marks of the island/city scene (scene.ts): the destination marker and the skill rings, drawn from the imported
 * frames when they are in. `begin()` once per frame before them; each call answers whether the art drew (else the scene
 * keeps today's Graphics).
 */
export class SceneMarks {
  private readonly pool:FramesPool;
  private readonly at:Pt={x:0,y:0};
  private readonly project:(p:Pt)=>Pt;
  constructor(scene:Phaser.Scene,project:(p:Pt)=>Pt){this.pool=new FramesPool(scene);this.project=project;}
  begin(){this.pool.begin();}
  /** Whether the destination marker comes from the imported art (then the scene draws nothing for it). */
  get destinationArt(){return this.pool.ready(markArt('destination'));}
  /**
   * Destination marker at world point `goal` (undefined = none), today's 28×14 ellipse with its 5 px edge, × `scale`
   * (the figures' scale), at today's depth.
   */
  destination(goal:Pt|undefined,scale:number,now:number,reduced:boolean,depth:number){
    const art=markArt('destination');
    if(!goal||!art)return false;
    const p=this.project(goal);
    return !!this.pool.mark('destination',art,depth,markFrame(art,now,reduced),p.x,p.y,(28+5)*scale);
  }
  /**
   * A skill ring of `owner` around world point (x, y), `radius` world units, `stroke` px edge, at `alpha` and today's
   * depth; true when the art drew it. Its width is the projected circle's.
   */
  skillRing(owner:string,x:number,y:number,radius:number,stroke:number,alpha:number,now:number,reduced:boolean,depth:number){
    const art=markArt('skill');
    if(!art||!this.pool.ready(art))return false;
    this.at.x=x;this.at.y=y;
    const c=this.project(this.at),cx=c.x,cy=c.y,d=radius*Math.SQRT1_2;
    // The projected circle's half width: its screen-x extreme is along a world diagonal (2:1 isometric, any view).
    this.at.x=x+d;this.at.y=y-d;let half=Math.abs(this.project(this.at).x-cx);
    this.at.x=x+d;this.at.y=y+d;half=Math.max(half,Math.abs(this.project(this.at).x-cx));
    const image=this.pool.mark(owner,art,depth,markFrame(art,now,reduced),cx,cy,2*half+stroke);
    image?.setAlpha(alpha);
    return !!image;
  }
  destroy(){this.pool.destroy();}
}
/** Projected screen half width of a ring of world points (the caído's rescue ring). */
export function ringHalfWidth(points:readonly Pt[],cx:number):number{
  let half=0;for(const p of points)half=Math.max(half,Math.abs(p.x-cx));
  return half;
}
