/**
 * Safe places of the city (card NEW-20261022-ORQ-monstros-espalhados, the user 22/10: "lugares que são safe places que
 * só têm uma aberturinha; lá não deveria ter inimigos"): pockets of open ground that join the rest of the city through
 * ONE narrow opening (a courtyard, a dead-end yard behind a gate). Found from the asset alone, once per asset:
 *  1. the open cells (a body of SLEEPER_CLEAR fits at the cell centre) and their Chebyshev clearance in cells;
 *  2. the "wide" cells (clearance ≥ SAFE_WIDE): narrow gaps (an opening, a door) fall out, so a pocket behind a narrow
 *     opening becomes its own component of wide cells; the open ground's biggest component is the city itself;
 *  3. every open cell joins its nearest wide component (a BFS over open cells from all of them at once): regions;
 *  4. a region other than the city's, of at least SAFE_MIN_CELLS cells, whose border with the other regions is ONE
 *     connected run of cells (one opening, at most SAFE_OPENING_CELLS long), is a safe place.
 * Data only: the nests' plan keeps every body out of them (maps/nests.ts) and the sono keeps the wanderers out.
 */
import type {CityTerrain} from './city/terrain.ts';
import type {Point} from '../contract/index.ts';

/** A cell is open when a disc this wide fits at its centre (u): the widest body of the roster (nests SLEEPER_CLEAR). */
export const SAFE_BODY=.5;
/*
 * Asset v4 (mapa-175-com-viaduto): the rooms and yards are 1.75× narrower on the same cell, so the three measures follow
 * (3, 40, 8 on the 1.7× city): 21 safe places there, 23 here.
 */
/** Clearance (cells, Chebyshev) of a "wide" cell: gaps narrower than ~2·SAFE_WIDE−1 cells split the open ground. */
export const SAFE_WIDE=2;
/** The smallest pocket that counts (cells; 1.496 u each side on the Cidade Nevada: ~34 u²). */
export const SAFE_MIN_CELLS=15;
/** An opening longer than this (cells) is no "aberturinha": the pocket is part of the street. */
export const SAFE_OPENING_CELLS=5;

export interface SafePlace {
  readonly id:string;
  /** Cell indices (cy·w + cx) of the pocket. */
  readonly cells:ReadonlySet<number>;
  /** Centre of the pocket and of its opening (u). */
  readonly x:number;readonly y:number;
  readonly opening:Point;
  /** Cells of the pocket (its area is cells × unitsPerCell²). */
  readonly area:number;
}

const memo=new WeakMap<object,readonly SafePlace[]>();

export function citySafePlaces(city:CityTerrain):readonly SafePlace[]{
  const known=memo.get(city.asset);if(known)return known;
  const a=city.asset,w=a.cells.w,h=a.cells.h,cs=a.unitsPerCell,n=w*h;
  const open=new Uint8Array(n);
  for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++)if(city.clearDisc((cx+.5)*cs,(cy+.5)*cs,SAFE_BODY))open[cy*w+cx]=1;
  // 1. Chebyshev clearance (cells) to the nearest closed cell or the grid's edge: two chamfer passes.
  const clear=new Uint16Array(n);
  for(let i=0;i<n;i++)clear[i]=open[i]?65535:0;
  const at=(x:number,y:number)=>x<0||y<0||x>=w||y>=h?0:clear[y*w+x];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!open[i])continue;clear[i]=Math.min(clear[i],at(x-1,y)+1,at(x-1,y-1)+1,at(x,y-1)+1,at(x+1,y-1)+1);}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(!open[i])continue;clear[i]=Math.min(clear[i],at(x+1,y)+1,at(x+1,y+1)+1,at(x,y+1)+1,at(x-1,y+1)+1);}
  // 2. Components of wide cells (4-neighbours).
  const comp=new Int32Array(n).fill(-1);
  const sizes:number[]=[];
  const N4=[[1,0],[-1,0],[0,1],[0,-1]] as const;
  for(let i=0;i<n;i++){
    if(comp[i]>=0||!open[i]||clear[i]<SAFE_WIDE)continue;
    const id=sizes.length,stack=[i];comp[i]=id;let size=0;
    while(stack.length){
      const j=stack.pop()!,x=j%w,y=(j-x)/w;size++;
      for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const k=Y*w+X;if(comp[k]<0&&open[k]&&clear[k]>=SAFE_WIDE){comp[k]=id;stack.push(k);}}
    }
    sizes.push(size);
  }
  // 3. Every open cell joins its nearest wide component (multi-source BFS, cells in index order: deterministic).
  const region=Int32Array.from(comp);
  let queue:number[]=[];for(let i=0;i<n;i++)if(region[i]>=0)queue.push(i);
  while(queue.length){
    const next:number[]=[];
    for(const j of queue){
      const x=j%w,y=(j-x)/w;
      for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const k=Y*w+X;if(open[k]&&region[k]<0){region[k]=region[j];next.push(k);}}
    }
    queue=next;
  }
  const area=new Array<number>(sizes.length).fill(0);
  for(let i=0;i<n;i++)if(region[i]>=0)area[region[i]]++;
  let city0=0;for(let r=1;r<area.length;r++)if(area[r]>area[city0])city0=r;
  // 4. Per region, its border cells (a 4-neighbour in another region) grouped into runs (8-connected).
  const out:SafePlace[]=[];
  for(let r=0;r<area.length;r++){
    if(r===city0||area[r]<SAFE_MIN_CELLS)continue;
    const border:number[]=[],cells=new Set<number>();
    let sx=0,sy=0;
    for(let i=0;i<n;i++){
      if(region[i]!==r)continue;
      cells.add(i);const x=i%w,y=(i-x)/w;sx+=x;sy+=y;
      for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const k=Y*w+X;if(region[k]>=0&&region[k]!==r){border.push(i);break;}}
    }
    if(!border.length)continue;
    const inBorder=new Set(border),seen=new Set<number>();let runs=0;
    for(const b of border){
      if(seen.has(b))continue;
      runs++;const stack=[b];seen.add(b);
      while(stack.length){
        const j=stack.pop()!,x=j%w,y=(j-x)/w;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const k=(y+dy)*w+(x+dx);if(inBorder.has(k)&&!seen.has(k)){seen.add(k);stack.push(k);}}
      }
    }
    if(runs!==1||border.length>SAFE_OPENING_CELLS)continue;
    let ox=0,oy=0;for(const b of border){ox+=b%w;oy+=Math.floor(b/w);}
    const round=(v:number)=>Math.round(v*100)/100;
    out.push(Object.freeze({id:`seguro-${out.length+1}`,cells,area:cells.size,x:round((sx/cells.size+.5)*cs),y:round((sy/cells.size+.5)*cs),
      opening:Object.freeze({x:round((ox/border.length+.5)*cs),y:round((oy/border.length+.5)*cs)})}));
  }
  const frozen=Object.freeze(out);memo.set(city.asset,frozen);return frozen;
}

/** The safe place (u) a point stands in, if any. */
export function safePlaceAt(city:CityTerrain,p:Point):SafePlace|undefined{
  const a=city.asset,cs=a.unitsPerCell,cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs);
  if(cx<0||cy<0||cx>=a.cells.w||cy>=a.cells.h)return undefined;
  const k=cy*a.cells.w+cx;
  for(const s of citySafePlaces(city))if(s.cells.has(k))return s;
  return undefined;
}
