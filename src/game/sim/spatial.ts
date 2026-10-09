/**
 * Spatial indexes for the horde simulation (VGM-032).
 *
 * Semantics shared by both implementations (SpatialHash must match NaiveIndex exactly):
 * - Positions are snapshotted at rebuild(). Moving an item afterwards does not move it in the index;
 *   rebuild after a system moves entities and before the next system queries them.
 * - query() returns items with squared distance <= radius^2 (inclusive), in unspecified but deterministic order.
 *   When `out` is given it is cleared, filled and returned, so steady-state queries allocate nothing.
 * - nearest() returns the closest item within radius that passes `filter`; ties go to the smaller id
 *   (string comparison), so the result never depends on insertion or bucket order.
 * - Negative or NaN radius, or non-finite query points, match nothing. Items with non-finite positions are skipped at rebuild.
 * - The index does not know about deaths: consumers skip items that were removed after the rebuild (e.g. hp <= 0).
 */
import type {Point} from '../world.ts';
import type {SpatialIndex} from './types.ts';

type Entry=Point&{id:string};

export const DEFAULT_CELL_SIZE=2;

const MIN_TABLE=16;
/** Cell coordinates beyond this use the linear path, so cell loops never run on imprecise doubles. */
const CELL_LIMIT=2**30;

function hashCell(cx:number,cy:number,mask:number){
  let h=Math.imul(cx,0x9e3779b1)^Math.imul(cy,0x85ebca77);
  h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);h^=h>>>12;
  return h&mask;
}

/** Strict improvement order for nearest(): smaller distance, then smaller id. */
function closer(d2:number,id:string,bestD2:number,bestId:string|undefined){
  return d2<bestD2||(d2===bestD2&&bestId!==undefined&&id<bestId);
}

/**
 * Uniform grid hashed into a power-of-two bucket table and stored as flat, bucket-sorted arrays
 * (counting sort on rebuild). Each slot keeps its cell coordinates, so cells that collide in the
 * same bucket are told apart and an item is never reported twice. Ranges that would visit more
 * cells than there are items fall back to a linear scan, which bounds the cost of huge radii.
 */
export class SpatialHash<T extends Entry> implements SpatialIndex<T> {
  readonly cellSize:number;
  private readonly inv:number;
  private n=0;
  private mask=MIN_TABLE-1;
  // Bucket-sorted storage.
  private items:(T|undefined)[]=[];
  private xs=new Float64Array(0);
  private ys=new Float64Array(0);
  private cxs=new Int32Array(0);
  private cys=new Int32Array(0);
  // Insertion-order staging for the counting sort.
  private staged:(T|undefined)[]=[];
  private sx=new Float64Array(0);
  private sy=new Float64Array(0);
  private scx=new Int32Array(0);
  private scy=new Int32Array(0);
  private sb=new Int32Array(0);
  /** start[b]..start[b+1] is bucket b in the sorted arrays. */
  private start=new Int32Array(MIN_TABLE+1);
  private cursor=new Int32Array(MIN_TABLE);

  constructor(cellSize=DEFAULT_CELL_SIZE){
    if(!(cellSize>0&&Number.isFinite(cellSize)))throw new Error('cellSize must be a positive finite number');
    this.cellSize=cellSize;
    this.inv=1/cellSize;
  }

  get size(){return this.n;}

  rebuild(source:Iterable<T>):void{
    const inv=this.inv,previous=this.n;
    let n=0;
    for(const item of source){
      if(n===this.sx.length)this.grow(Math.max(64,n*2));
      const x=+item.x,y=+item.y;
      if(!Number.isFinite(x)||!Number.isFinite(y))continue;
      this.staged[n]=item;this.sx[n]=x;this.sy[n]=y;
      this.scx[n]=Math.floor(x*inv)|0;this.scy[n]=Math.floor(y*inv)|0;
      n++;
    }
    let table=MIN_TABLE;while(table<n*2)table<<=1;
    if(table!==this.cursor.length){this.start=new Int32Array(table+1);this.cursor=new Int32Array(table);}
    else this.start.fill(0);
    const mask=this.mask=table-1,start=this.start,cursor=this.cursor,sb=this.sb;
    for(let i=0;i<n;i++){const b=hashCell(this.scx[i],this.scy[i],mask);sb[i]=b;start[b+1]++;}
    for(let b=0;b<table;b++){start[b+1]+=start[b];cursor[b]=start[b];}
    for(let i=0;i<n;i++){
      const k=cursor[sb[i]]++;
      this.items[k]=this.staged[i];this.xs[k]=this.sx[i];this.ys[k]=this.sy[i];this.cxs[k]=this.scx[i];this.cys[k]=this.scy[i];
    }
    // Drop references beyond the live range so removed entities can be collected.
    for(let i=n;i<previous;i++){this.items[i]=undefined;this.staged[i]=undefined;}
    for(let i=0;i<n;i++)this.staged[i]=undefined;
    this.n=n;
  }

  // Cell range of the last setRange() call; fields instead of a tuple to keep queries allocation-free.
  private minCx=0;private maxCx=0;private minCy=0;private maxCy=0;

  /** Computes the padded cell range; false when the linear path is cheaper or the hash path is unsafe. */
  private setRange(x:number,y:number,radius:number,pad:number){
    const inv=this.inv;
    const minCx=this.minCx=Math.floor((x-radius-pad)*inv),maxCx=this.maxCx=Math.floor((x+radius+pad)*inv);
    const minCy=this.minCy=Math.floor((y-radius-pad)*inv),maxCy=this.maxCy=Math.floor((y+radius+pad)*inv);
    if(!(minCx>-CELL_LIMIT&&maxCx<CELL_LIMIT&&minCy>-CELL_LIMIT&&maxCy<CELL_LIMIT))return false;
    return (maxCx-minCx+1)*(maxCy-minCy+1)<=this.n;
  }

  query(x:number,y:number,radius:number,out:T[]=[]):T[]{
    out.length=0;
    if(!(radius>=0)||!Number.isFinite(x)||!Number.isFinite(y)||this.n===0)return out;
    const r2=radius*radius,pad=1e-9*(1+Math.abs(x)+Math.abs(y)+radius);
    const {cxs,cys,xs,ys,items}=this;
    if(!this.setRange(x,y,radius,pad)){
      for(let k=0;k<this.n;k++){const dx=xs[k]-x,dy=ys[k]-y;if(dx*dx+dy*dy<=r2)out.push(items[k]!);}
      return out;
    }
    const {start,mask,minCx,maxCx,minCy,maxCy}=this;
    for(let cy=minCy;cy<=maxCy;cy++){
      for(let cx=minCx;cx<=maxCx;cx++){
        const b=hashCell(cx,cy,mask);
        for(let k=start[b],end=start[b+1];k<end;k++){
          if(cxs[k]!==cx||cys[k]!==cy)continue;
          const dx=xs[k]-x,dy=ys[k]-y;
          if(dx*dx+dy*dy<=r2)out.push(items[k]!);
        }
      }
    }
    return out;
  }

  nearest(x:number,y:number,radius:number,filter?:(item:T)=>boolean):T|undefined{
    if(!(radius>=0)||!Number.isFinite(x)||!Number.isFinite(y)||this.n===0)return undefined;
    const r2=radius*radius,pad=1e-9*(1+Math.abs(x)+Math.abs(y)+radius);
    const {cxs,cys,xs,ys,items}=this;
    let best:T|undefined,bestD2=Infinity;
    if(!this.setRange(x,y,radius,pad)){
      for(let k=0;k<this.n;k++){
        const dx=xs[k]-x,dy=ys[k]-y,d2=dx*dx+dy*dy,item=items[k]!;
        if(d2<=r2&&(best===undefined||closer(d2,item.id,bestD2,best.id))&&(!filter||filter(item))){best=item;bestD2=d2;}
      }
      return best;
    }
    const {start,mask,cellSize,minCx,maxCx,minCy,maxCy}=this;
    const cx0=Math.floor(x*this.inv),cy0=Math.floor(y*this.inv);
    const kMax=Math.max(cx0-minCx,maxCx-cx0,cy0-minCy,maxCy-cy0);
    // Visit square rings of cells around the query cell, nearest ring first.
    for(let ring=0;ring<=kMax;ring++){
      if(best!==undefined&&ring>=2){
        // Every cell of this ring is at least (ring-1) whole cells away along one axis.
        const gap=(ring-1)*cellSize*(1-1e-9)-pad;
        if(gap>0&&gap*gap>bestD2)break;
      }
      const top=cy0-ring,bottom=cy0+ring,left=cx0-ring,right=cx0+ring;
      for(let cy=Math.max(top,minCy),cyEnd=Math.min(bottom,maxCy);cy<=cyEnd;cy++){
        // Edge rows are scanned whole; middle rows only at the left and right columns.
        const step=cy===top||cy===bottom?1:right-left;
        for(let cx=left;cx<=right;cx+=step){
          if(cx<minCx||cx>maxCx)continue;
          const b=hashCell(cx,cy,mask);
          for(let k=start[b],end=start[b+1];k<end;k++){
            if(cxs[k]!==cx||cys[k]!==cy)continue;
            const dx=xs[k]-x,dy=ys[k]-y,d2=dx*dx+dy*dy;
            if(d2>r2)continue;
            const item=items[k]!;
            if(best!==undefined&&!closer(d2,item.id,bestD2,best.id))continue;
            if(filter&&!filter(item))continue;
            best=item;bestD2=d2;
          }
        }
      }
    }
    return best;
  }

  private grow(capacity:number){
    const copyF=(a:Float64Array)=>{const b=new Float64Array(capacity);b.set(a);return b;};
    const copyI=(a:Int32Array)=>{const b=new Int32Array(capacity);b.set(a);return b;};
    this.xs=copyF(this.xs);this.ys=copyF(this.ys);this.cxs=copyI(this.cxs);this.cys=copyI(this.cys);
    this.sx=copyF(this.sx);this.sy=copyF(this.sy);this.scx=copyI(this.scx);this.scy=copyI(this.scy);this.sb=copyI(this.sb);
  }
}

/** Reference implementation: linear scans with the exact same semantics. For tests and tiny sets. */
export class NaiveIndex<T extends Entry> implements SpatialIndex<T> {
  private items:T[]=[];
  private xs:number[]=[];
  private ys:number[]=[];

  get size(){return this.items.length;}

  rebuild(source:Iterable<T>):void{
    this.items.length=0;this.xs.length=0;this.ys.length=0;
    for(const item of source){
      const x=+item.x,y=+item.y;
      if(Number.isFinite(x)&&Number.isFinite(y)){this.items.push(item);this.xs.push(x);this.ys.push(y);}
    }
  }

  query(x:number,y:number,radius:number,out:T[]=[]):T[]{
    out.length=0;
    if(!(radius>=0)||!Number.isFinite(x)||!Number.isFinite(y))return out;
    const r2=radius*radius;
    for(let i=0;i<this.items.length;i++){const dx=this.xs[i]-x,dy=this.ys[i]-y;if(dx*dx+dy*dy<=r2)out.push(this.items[i]);}
    return out;
  }

  nearest(x:number,y:number,radius:number,filter?:(item:T)=>boolean):T|undefined{
    if(!(radius>=0)||!Number.isFinite(x)||!Number.isFinite(y))return undefined;
    const r2=radius*radius;
    let best:T|undefined,bestD2=Infinity;
    for(let i=0;i<this.items.length;i++){
      const dx=this.xs[i]-x,dy=this.ys[i]-y,d2=dx*dx+dy*dy,item=this.items[i];
      if(d2<=r2&&(best===undefined||closer(d2,item.id,bestD2,best.id))&&(!filter||filter(item))){best=item;bestD2=d2;}
    }
    return best;
  }
}
