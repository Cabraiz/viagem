/**
 * The city's viaducts on screen (NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 3; plans/mapa-175-viaduto.md §4), in flat
 * palette colours until the Codex art (etapa 4): the deck's slab and its parapets, the ramp on its embankment, the
 * pillars, and the deck's shadow on the street. Same camera, no new zoom.
 *
 * Draw order: the deck and the ramp go cell by cell (~120 pieces), each at the depth of its front corner, so a body on
 * the street under a cell is drawn before it (covered) and one beside it in front after it. A body on the deck (floor 1)
 * is lifted by the surface's height (HEIGHT_PX a unit, like the blocks) and drawn just above the cells it stands on
 * (bodyDepth). While the local hero is under the deck, the strips around it go
 * see-through (UNDER_ALPHA within UNDER_RADIUS) so the hero and the fight stay readable.
 *
 * The geometry (viaductPieces) is pure and tested; ViaductLayer is the Phaser side.
 */
import type {CityViaduct} from '../../../maps/index.ts';
import {overDeck,onRamp,rampCells,rampRun,surfaceHeight} from '../../../maps/index.ts';
import {CITY_PALETTE} from './palette.ts';
import {HEIGHT_PX,VIEW_PIVOT,depth as depthKey,project,rotate,type Pt} from './projection.ts';

/** Slab thickness and parapet height (u), plan §4. */
export const DECK_SLAB=.6,PARAPET=.6;
/** Parapet thickness (u) and pillar side (u). */
export const PARAPET_WIDTH=.22,PILLAR_SIDE=.8;
/** While the local hero is under the deck, the strips within this radius (u) draw at this alpha (plan §4: ~35 %). */
export const UNDER_RADIUS=4,UNDER_ALPHA=.35;
/** Depth keys a body on a deck strip sits above the strip (under the next strip in front: a strip is ~300 keys deep). */
export const ON_STRIP=1;

/** A box of the viaduct in world units: its footprint and its top/bottom height at the footprint's 4 corners. */
export interface ViaductPiece {
  kind:'deck'|'ramp'|'pillar'|'parapet'|'shadow'|'car';
  /** Which strip it belongs to (deck and ramp pieces and their parapets share their strip's index; pillars their own). */
  strip:number;
  x0:number;y0:number;x1:number;y1:number;
  /** Heights (u) at the corners (x0,y0), (x1,y0), (x1,y1), (x0,y1). */
  top:readonly [number,number,number,number];bottom:readonly [number,number,number,number];
}
const flat=(z:number)=>[z,z,z,z] as const;

/**
 * Every piece of viaduct `v` (cell `unit` u), one cell each so each sorts by its own front corner (a piece across the
 * deck's width sorted by its front corner covered what stood beside its back end): deck cells (slab DECK_SLAB thick under
 * the deck's height) and ramp cells (an embankment from the ground to the sloped surface), each with its parapet on the
 * viaduct's outer sides; the pillars (from the ground to the slab's underside); and the deck's shadow on the street.
 * `strip` numbers the pieces that draw together (a cell and its parapet; a pillar alone).
 */
export function viaductPieces(v:CityViaduct,unit:number):ViaductPiece[]{
  const out:ViaductPiece[]=[],h=v.height,along=v.ramp.up==='N'||v.ramp.up==='S';
  const [dc,dr,dw,dh]=v.deck,[rc,rr,rw,rh]=v.ramp.rect;
  let strip=0;
  const raise=(t:readonly number[])=>t.map(z=>z+PARAPET) as unknown as [number,number,number,number];
  /** The parapets of a cell on the viaduct's outer sides (c0/c1: the first and last column, or row, across it). */
  const parapets=(x0:number,y0:number,x1:number,y1:number,top:readonly [number,number,number,number],first:boolean,last:boolean)=>{
    if(along){
      if(first)out.push({kind:'parapet',strip,x0,y0,x1:x0+PARAPET_WIDTH,y1,top:raise([top[0],top[0],top[3],top[3]]),bottom:[top[0],top[0],top[3],top[3]]});
      if(last)out.push({kind:'parapet',strip,x0:x1-PARAPET_WIDTH,y0,x1,y1,top:raise([top[1],top[1],top[2],top[2]]),bottom:[top[1],top[1],top[2],top[2]]});
    }else{
      if(first)out.push({kind:'parapet',strip,x0,y0,x1,y1:y0+PARAPET_WIDTH,top:raise([top[0],top[1],top[1],top[0]]),bottom:[top[0],top[1],top[1],top[0]]});
      if(last)out.push({kind:'parapet',strip,x0,y0:y1-PARAPET_WIDTH,x1,y1,top:raise([top[3],top[2],top[2],top[3]]),bottom:[top[3],top[2],top[2],top[3]]});
    }
  };
  for(let r=dr;r<dr+dh;r++)for(let c=dc;c<dc+dw;c++,strip++){
    const x0=c*unit,y0=r*unit,x1=x0+unit,y1=y0+unit;
    out.push({kind:'deck',strip,x0,y0,x1,y1,top:flat(h),bottom:flat(h-DECK_SLAB)});
    parapets(x0,y0,x1,y1,flat(h),along?c===dc:r===dr,along?c===dc+dw-1:r===dr+dh-1);
  }
  // Ramp cells: the surface rises from the foot (0) to the top (h); an embankment down to the ground.
  const len=rampCells(v)*unit,zAt=(x:number,y:number)=>h*Math.max(0,Math.min(1,(rampRun(v,unit,Math.min(Math.max(x,rc*unit+1e-6),(rc+rw)*unit-1e-6),Math.min(Math.max(y,rr*unit+1e-6),(rr+rh)*unit-1e-6))??0)/len));
  for(let r=rr;r<rr+rh;r++)for(let c=rc;c<rc+rw;c++,strip++){
    const x0=c*unit,y0=r*unit,x1=x0+unit,y1=y0+unit;
    const top=[zAt(x0,y0),zAt(x1,y0),zAt(x1,y1),zAt(x0,y1)] as const;
    out.push({kind:'ramp',strip,x0,y0,x1,y1,top,bottom:flat(0)});
    parapets(x0,y0,x1,y1,top,along?c===rc:r===rr,along?c===rc+rw-1:r===rr+rh-1);
  }
  // Pillars, each its own strip.
  for(const [c,r] of v.pillars){
    const cx=(c+.5)*unit,cy=(r+.5)*unit,s=PILLAR_SIDE/2;
    out.push({kind:'pillar',strip:strip++,x0:cx-s,y0:cy-s,x1:cx+s,y1:cy+s,top:flat(h-DECK_SLAB),bottom:flat(0)});
  }
  // The deck's shadow on the street (a flat decal, drawn on the ground).
  out.push({kind:'shadow',strip:-1,x0:dc*unit,y0:dr*unit,x1:(dc+dw)*unit,y1:(dr+dh)*unit,top:flat(0),bottom:flat(0)});
  return out;
}

/** A car on a deck (u): the Uno where the run starts and the pile-up at the closed end (art of etapa 4; boxes until then). */
export interface DeckCar {x:number;y:number;w:number;h:number;tall:number;color:number}
/**
 * The deck's cars of viaduct `v`: the Uno at the run's start `start` when it is on the deck (2.4 × 1.3 u, along the deck),
 * and three cars piled across the deck's closed end (the end away from the ramp).
 */
export function deckCars(v:CityViaduct,unit:number,start?:Pt):DeckCar[]{
  const out:DeckCar[]=[],[dc,dr,dw,dh]=v.deck,along=v.ramp.up==='N'||v.ramp.up==='S';
  if(start&&overDeck(v,unit,start.x,start.y))out.push(along?{x:start.x+.9,y:start.y-1.4,w:1.3,h:2.4,tall:1.1,color:CAR_RED}:{x:start.x-1.4,y:start.y+.9,w:2.4,h:1.3,tall:1.1,color:CAR_RED});
  // The closed end: the deck's far end from the ramp (north for a ramp going up north: the deck's first row).
  const far=v.ramp.up==='N'?dr*unit+1.1:v.ramp.up==='S'?(dr+dh)*unit-1.1:v.ramp.up==='W'?dc*unit+1.1:(dc+dw)*unit-1.1;
  const span=(along?dw:dh)*unit,from=(along?dc:dr)*unit;
  for(let i=0;i<3;i++){
    const c=from+span*(i+.5)/3,tall=.9+.25*i,color=PILE[i];
    out.push(along?{x:c-1,y:far-.7,w:2,h:1.4,tall,color}:{x:far-.7,y:c-1,w:1.4,h:2,tall,color});
  }
  return out;
}
const CAR_RED=0xc0473a,PILE=[0x5b7fa8,0x8f8a7a,0xd6a23c] as const;

/** The faces of a box seen from the camera at `view`: each outward side normal that points toward the viewer. */
export function frontSides(view:number):('n'|'e'|'s'|'w')[]{
  const sides:[('n'|'e'|'s'|'w'),number,number][]=[['n',0,-1],['e',1,0],['s',0,1],['w',-1,0]];
  // Depth grows with q.x + q.y (projection.ts): a side faces the camera when its rotated normal has a positive sum.
  return sides.filter(([,nx,ny])=>{const q=rotate(nx,ny,view);return q.x+q.y>0;}).map(([s])=>s);
}
/** Footprint corner order: (x0,y0), (x1,y0), (x1,y1), (x0,y1); the two corners of each side. */
const SIDE_CORNERS={n:[0,1],e:[1,2],s:[2,3],w:[3,0]} as const;
const cornersOf=(p:ViaductPiece):Pt[]=>[{x:p.x0,y:p.y0},{x:p.x1,y:p.y0},{x:p.x1,y:p.y1},{x:p.x0,y:p.y1}];
/** Depth key of the piece's front-most footprint corner at `view`. */
export function pieceKey(p:ViaductPiece,view:number,pivot:Pt=VIEW_PIVOT):number{
  let best=-Infinity;
  for(const c of cornersOf(p))best=Math.max(best,depthKey(c.x,c.y,view,pivot));
  return best;
}

/** Drawing hooks from the scene: its depth space and the ground height under a point (px). */
export interface ViaductHooks {
  /** Maps a projection depth key to the scene's depth space (the city layer's depthOf). */
  depthOf:(key:number)=>number;
  /** The ground's screen lift at (x, y) in px (the relief: elevation), the same the actors stand on. */
  groundPx:(x:number,y:number)=>number;
}

/** A colour darkened to `k` of itself (the cars' sides). */
const shade=(c:number,k:number)=>(Math.round((c>>16&255)*k)<<16)|(Math.round((c>>8&255)*k)<<8)|Math.round((c&255)*k);
const TOP=CITY_PALETTE['neve-pisada'],SIDE_LIGHT=CITY_PALETTE['muro-clara'],SIDE_DARK=CITY_PALETTE['muro-escura'],
  CAP=CITY_PALETTE['muro-tampa'],BREU=CITY_PALETTE.breu;

/**
 * The Phaser side: one Graphics per strip (and pillar), redrawn when the view turns, re-sorted every frame (the scene's
 * depth origin moves with the hero). `bodyLift`/`bodyDepth` place a body of floor 1; `under` says the ground at (x, y)
 * is under a deck (the hero there gets its see-through copy, like behind a building).
 */
export class ViaductLayer {
  private readonly pieces:ViaductPiece[];
  private readonly strips:Phaser.GameObjects.Graphics[]=[];
  private shadow?:Phaser.GameObjects.Graphics;
  private view=-1;
  private readonly keys:number[]=[];
  /** Per strip, its main piece (the cell, the pillar or the car; not a parapet). */
  private bodyOf:ViaductPiece[]=[];
  private readonly scene:Phaser.Scene;
  private readonly viaducts:readonly CityViaduct[];
  private readonly unit:number;
  private readonly hooks:ViaductHooks;
  private readonly shadowDepth:number;
  /** `start`: the run's start (the Uno is drawn there when it is on a deck). */
  constructor(scene:Phaser.Scene,viaducts:readonly CityViaduct[],unit:number,hooks:ViaductHooks,shadowDepth:number,start?:Pt){
    this.scene=scene;this.viaducts=viaducts;this.unit=unit;this.hooks=hooks;this.shadowDepth=shadowDepth;
    this.pieces=viaducts.flatMap(v=>viaductPieces(v,unit));
    // The cars: each its own piece, drawn above every deck cell under it (draw).
    let next=1+Math.max(-1,...this.pieces.map(q=>q.strip));
    for(const v of viaducts)for(const c of deckCars(v,unit,start))
      this.pieces.push({kind:'car',strip:next++,x0:c.x,y0:c.y,x1:c.x+c.w,y1:c.y+c.h,top:flat(v.height+c.tall),bottom:flat(v.height),color:c.color} as ViaductPiece&{color:number});
    for(const p of this.pieces)if(p.kind!=='parapet'&&p.strip>=0)this.bodyOf[p.strip]=p;
  }
  /** Redraws the pieces for `view` (once per turn), re-sorts them, and fades the strips around a hero under a deck. */
  update(view:number,hero?:Pt&{andar?:number}){
    if(view!==this.view)this.draw(view);
    const under=hero&&hero.andar!==1&&this.under(hero.x,hero.y);
    for(let i=0;i<this.strips.length;i++){
      const g=this.strips[i];g.setDepth(this.hooks.depthOf(this.keys[i]));
      let alpha=1;
      if(under){
        const p=this.bodyOf[i];
        if(p&&p.kind!=='pillar'){
          const dx=Math.max(p.x0-hero.x,0,hero.x-p.x1),dy=Math.max(p.y0-hero.y,0,hero.y-p.y1);
          if(dx*dx+dy*dy<UNDER_RADIUS*UNDER_RADIUS)alpha=UNDER_ALPHA;
        }
      }
      if(g.alpha!==alpha)g.setAlpha(alpha);
    }
  }
  /** Screen lift (px) of a body of floor `floor` standing at (x, y): the deck's surface height, 0 on the ground. */
  bodyLift(x:number,y:number,floor:number|undefined):number{
    return floor===1?surfaceHeight(this.viaducts,this.unit,x,y,1)*HEIGHT_PX:0;
  }
  /** Draw depth of a body of floor 1 at (x, y): just above the strip under it; undefined when it is on no strip. */
  bodyDepth(x:number,y:number):number|undefined{
    if(this.stripAt(x,y)===undefined)return undefined;
    // Above every deck or ramp cell its body may overlap (a cell around): the cells in front of those draw lower on
    // screen than its feet, so nothing of the deck in front ever covers it.
    let key=-Infinity;
    for(const p of this.pieces){
      if(p.kind!=='deck'&&p.kind!=='ramp')continue;
      if(x>=p.x0-this.unit&&x<p.x1+this.unit&&y>=p.y0-this.unit&&y<p.y1+this.unit)key=Math.max(key,this.keys[p.strip]);
    }
    return this.hooks.depthOf(key)+ON_STRIP;
  }
  /** True when the ground at (x, y) is under a deck (or the ramp's foot, where its strips hang over). */
  under(x:number,y:number){return this.viaducts.some(v=>overDeck(v,this.unit,x,y));}
  destroy(){for(const g of this.strips)g.destroy();this.strips.length=0;this.shadow?.destroy();this.shadow=undefined;}

  /** The deck strip over a pillar (the one holding its centre). */
  private stripOver(p:ViaductPiece):number|undefined{
    const x=(p.x0+p.x1)/2,y=(p.y0+p.y1)/2;
    return this.pieces.find(q=>q.kind==='deck'&&x>=q.x0&&x<q.x1&&y>=q.y0&&y<q.y1)?.strip;
  }
  /** Depth key of strip `i` at `view`: its deck or ramp piece's front corner. */
  private stripKey(i:number,view:number):number{
    const q=this.pieces.find(r=>r.strip===i&&(r.kind==='deck'||r.kind==='ramp'));
    return q?pieceKey(q,view):Infinity;
  }
  private stripAt(x:number,y:number):number|undefined{
    for(const p of this.pieces)if((p.kind==='deck'||p.kind==='ramp')&&x>=p.x0&&x<p.x1&&y>=p.y0&&y<p.y1)return p.strip;
    for(const v of this.viaducts)if(overDeck(v,this.unit,x,y)||onRamp(v,this.unit,x,y)){
      // On the edge of a strip (float): the nearest one.
      let best:number|undefined,bd=Infinity;
      for(const p of this.pieces){if(p.kind!=='deck'&&p.kind!=='ramp')continue;const d=Math.hypot((p.x0+p.x1)/2-x,(p.y0+p.y1)/2-y);if(d<bd){bd=d;best=p.strip;}}
      return best;
    }
    return undefined;
  }
  private draw(view:number){
    this.view=view;
    const strips=1+Math.max(-1,...this.pieces.map(p=>p.strip));
    while(this.strips.length<strips)this.strips.push(this.scene.add.graphics());
    for(const g of this.strips)g.clear();
    this.shadow??=this.scene.add.graphics().setDepth(this.shadowDepth);
    this.shadow.clear();
    this.keys.length=0;
    for(let i=0;i<strips;i++)this.keys.push(-Infinity);
    const front=frontSides(view);
    // Pieces in back-to-front order inside a strip: the slab and the ramp first, then their parapets, then the cars.
    const rank=(p:ViaductPiece)=>p.kind==='car'?2:p.kind==='parapet'?1:0;
    const order=[...this.pieces].sort((a,b)=>rank(a)-rank(b));
    for(const p of order){
      const at=(c:Pt,z:number)=>{const q=project(c.x,c.y,z,view);return {x:q.x,y:q.y-this.hooks.groundPx(c.x,c.y)};};
      const corners=cornersOf(p);
      if(p.kind==='shadow'){
        this.shadow.fillStyle(BREU,.16).fillPoints(corners.map(c=>at(c,0)),true);
        continue;
      }
      const g=this.strips[p.strip];
      if(p.kind==='deck'||p.kind==='ramp')this.keys[p.strip]=Math.max(this.keys[p.strip],pieceKey(p,view));
      // A pillar stands under its strip: drawn just before it (its own front corner can be the strip's, which then put
      // it over the slab), and after the street behind it.
      else if(p.kind==='pillar'){const over=this.stripOver(p);this.keys[p.strip]=Math.min(pieceKey(p,view),over===undefined?Infinity:this.stripKey(over,view))-ON_STRIP;}
      // A car on the deck: above every cell under it (the cells were keyed first: the cars come last in `order`).
      else if(p.kind==='car'){
        let key=-Infinity;
        for(const q of this.pieces)if((q.kind==='deck'||q.kind==='ramp')&&q.x0<p.x1&&q.x1>p.x0&&q.y0<p.y1&&q.y1>p.y0)key=Math.max(key,this.keys[q.strip]);
        this.keys[p.strip]=key+ON_STRIP;
      }
      const tops=corners.map((c,k)=>at(c,p.top[k])),bottoms=corners.map((c,k)=>at(c,p.bottom[k]));
      const car=p.kind==='car'?(p as ViaductPiece&{color:number}).color:undefined;
      for(const side of front){
        const [a,b]=SIDE_CORNERS[side],dark=side==='e'||side==='s'?view%2===0:view%2===1;
        g.fillStyle(car!==undefined?shade(car,dark?.62:.8):dark?SIDE_DARK:SIDE_LIGHT,1).fillPoints([tops[a],tops[b],bottoms[b],bottoms[a]],true);
        g.lineStyle(1.5,BREU,.55).strokePoints([tops[a],tops[b],bottoms[b],bottoms[a]],true);
      }
      g.fillStyle(car??(p.kind==='parapet'?CAP:TOP),1).fillPoints(tops,true);
      g.lineStyle(p.kind==='parapet'?1.5:2,BREU,.7).strokePoints(tops,true);
    }
  }
}
