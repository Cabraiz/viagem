/**
 * City map asset (D-027, contract in design/cidade-protocolo.md §5): the single source of the `viagem-city` JSON
 * format written by the importer (E1) and read by the simulation, the renderer and the rooms Worker.
 * Pure and self-contained (no imports, no Node-only APIs): runs in browsers, Node and Cloudflare Workers.
 * Conventions: units of the game (1 cell = unitsPerCell u), origin at the NW corner of the whole cell grid,
 * x grows east and y grows south; grids are row-major, row 0 = north. Walkable/water samples are 4 per cell
 * (sample (sx,sy) covers [sx*step,(sx+1)*step) on x), stored as LSB-first bitsets (bit i = byte[i>>3]>>(i&7)&1);
 * heights sit on the (cells+1)^2 cell corners as Int16 little-endian centi-units. Binary sections travel in base64.
 */

export const CITY_FORMAT='viagem-city';
/** Version of the JSON layout; the map content version is `version` (it goes to the MapRef). */
export const CITY_FORMAT_VERSION=1;
export const MAX_JSON_CHARS=4_000_000;
/** Largest sample grid side; the cell grid is at most MAX_DIM/SAMPLES_PER_CELL per side. */
export const MAX_DIM=4096;
export const MAX_BLOCKS=20_000,MAX_PROPS=50_000,MAX_LOOT=5000,MAX_DECOR=50_000;
/** Turns a decor piece may take (degrees; see CityDecor.rot). */
export const DECOR_ROTS=[0,90,180,270] as const;
/** Total rectangles over all blocks (bounds an object handed to decode, where the text limit does not apply). */
export const MAX_RECTS=200_000;
export const SAMPLES_PER_CELL=4;
/** D-026: 1 cell = 0.88 u; the encoder uses it when the input leaves unitsPerCell out. */
export const UNITS_PER_CELL=0.88;
export const MAX_CELLS=MAX_DIM/SAMPLES_PER_CELL;
/** Largest |height| in units that fits Int16 centi-units. */
export const MAX_HEIGHT=327.67;
export const BLOCK_KINDS=['building','wall','cliff','rubble','edge'] as const;
export const BITS_ENCODING='bits-lsb-base64',HEIGHTS_ENCODING='i16le-centi-base64';
/** Slack for x+w / y+h of rectangles and the playable area at the far (E/S) map edge: 3-decimal roundings and double
 * sums (5.94+1.1 > 7.04) overshoot it slightly. The near (W/N) edge is strict: x,y >= 0. */
/** Added to x/step in walkableAt so exact sample edges do not fall into the previous sample. */
export const SAMPLE_NUDGE=1e-9;
export const EDGE_EPS=0.002;
const MAX_ID=64,MAX_TEXT=1000;

export type CityBlockKind=typeof BLOCK_KINDS[number];
/** [x,y,w,h] in units. */
export type CityRect=readonly [number,number,number,number];
export interface CityPoint {readonly x:number; readonly y:number}
export interface CityArea {readonly x:number; readonly y:number; readonly w:number; readonly h:number}
export interface CityBlock {readonly id:string; readonly kind:CityBlockKind; readonly bbox:CityRect; readonly rects:readonly CityRect[]}
export interface CityProp {readonly x:number; readonly y:number; readonly r:number; readonly kind:string; readonly solid:boolean}
/**
 * A piece of the delivered scenery placed on the city (NEW-20261016-ORQ-cenario-no-mapa): art id without the view
 * (`posto-gasolina-1`, `muro-pichado-reto-intacto`…), its footprint in cells (c, r the top-left cell; w, h after the
 * turn) and its turn: `rot` is the art view that shows it with the camera at view 0 (0: front to +y, 90: +x, 180: −y,
 * 270: −x). Walls, fences and cliffs also carry `links`, the neighbours they join (N 1, E 2, S 4, W 8). Decor never
 * changes the walkable grid: pieces on blocks stand on unwalkable cells, the ones on sidewalks are walked through.
 */
export interface CityDecor {readonly id:string; readonly c:number; readonly r:number; readonly w:number; readonly h:number;
  readonly rot:typeof DECOR_ROTS[number]; readonly links?:number}
/** L = east (leste), O = west (oeste). All of them must be walkable. */
export interface CityPoints {
  readonly inicio:CityPoint; readonly praca:CityPoint;
  readonly spawnN:CityPoint; readonly spawnS:CityPoint; readonly spawnL:CityPoint; readonly spawnO:CityPoint;
  readonly bocas:{readonly N:CityPoint; readonly S:CityPoint; readonly L:CityPoint; readonly O:CityPoint};
}
/** sha256 (lowercase hex) of the source .w3x, as proof of origin; never the file itself. */
export interface CitySource {readonly sha256:string; readonly note:string}

/** Encoder input (the importer builds this). Grids: walkable/water (cells*4)^2 values 0/1, heights (cells+1)^2 in u. */
export interface CityAssetData {
  id:string; version:number; name:string;
  cells:{readonly w:number; readonly h:number}; unitsPerCell?:number;
  playable:CityArea;
  walkable:Uint8Array; water?:Uint8Array; heights:Float32Array;
  points:CityPoints; blocks:readonly CityBlock[]; props:readonly CityProp[]; loot:readonly CityPoint[];
  decor?:readonly CityDecor[];
  source?:CitySource;
}

export interface CityGrid {readonly w:number; readonly h:number; readonly step:number}

/** Decoded asset: read-only metadata plus O(1), allocation-free grid queries over the packed sections. */
export interface CityAsset {
  readonly id:string; readonly version:number; readonly name:string;
  readonly cells:{readonly w:number; readonly h:number}; readonly unitsPerCell:number;
  readonly size:{readonly w:number; readonly h:number};
  readonly playable:CityArea;
  readonly points:CityPoints; readonly blocks:readonly CityBlock[]; readonly props:readonly CityProp[];
  readonly loot:readonly CityPoint[]; readonly source?:CitySource;
  /** The placed scenery (empty when the asset has none). */
  readonly decor:readonly CityDecor[];
  /** Walkable/water sample grid ((cells*4)^2, step = unitsPerCell/4). */
  readonly samples:CityGrid;
  /** Height corner grid ((cells+1)^2, step = unitsPerCell). */
  readonly heightGrid:CityGrid;
  readonly hasWater:boolean;
  /** Packed sections, shared and read-only (do not mutate). */
  readonly walkableBits:Uint8Array; readonly waterBits:Uint8Array|null; readonly heightsCenti:Int16Array;
  /** Sample walkability; outside the grid is false. */
  walkable(sx:number,sy:number):boolean;
  /** Sample water (shallow or deep); outside the grid or without a water section is false. */
  water(sx:number,sy:number):boolean;
  /** Walkability at a position in units. */
  walkableAt(x:number,y:number):boolean;
  /** Height in units at corner (hx,hy), clamped to the grid edge. */
  height(hx:number,hy:number):number;
  /** Bilinear height in units at a position in units, clamped to the grid edge. */
  heightAt(x:number,y:number):number;
}

export type CityAssetResult={ok:true; asset:CityAsset}|{ok:false; error:string};

// ---- base64 and bitsets ----

const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_CODES=Uint8Array.from(B64,ch=>ch.charCodeAt(0));
const B64_INDEX=(()=>{const t=new Uint8Array(256).fill(255);for(let i=0;i<64;i++)t[B64_CODES[i]]=i;return t})();
const PAD=61;

/** Standard base64 with padding. */
export function encodeBase64(bytes:Uint8Array):string{
  const n=bytes.length,out=new Uint8Array(Math.ceil(n/3)*4),C=B64_CODES;
  let o=0,i=0;
  for(;i+2<n;i+=3){
    const v=bytes[i]<<16|bytes[i+1]<<8|bytes[i+2];
    out[o++]=C[v>>18];out[o++]=C[v>>12&63];out[o++]=C[v>>6&63];out[o++]=C[v&63];
  }
  if(i<n){
    const two=i+1<n,v=bytes[i]<<16|(two?bytes[i+1]<<8:0);
    out[o++]=C[v>>18];out[o++]=C[v>>12&63];out[o++]=two?C[v>>6&63]:PAD;out[o++]=PAD;
  }
  let s='';
  for(let k=0;k<out.length;k+=0x8000)s+=String.fromCharCode.apply(null,out.subarray(k,k+0x8000) as unknown as number[]);
  return s;
}

/** Strict base64 to exactly `size` bytes (canonical length and padding, zero pad bits); null when anything is off. */
export function decodeBase64(text:string,size:number):Uint8Array|null{
  if(typeof text!=='string'||!(size>=0)||text.length!==Math.ceil(size/3)*4)return null;
  const T=B64_INDEX,at=(i:number)=>{const c=text.charCodeAt(i);return c<256?T[c]:255};
  const out=new Uint8Array(size),full=Math.floor(size/3),rest=size-full*3;
  let o=0,i=0;
  for(let g=0;g<full;g++,i+=4){
    const a=at(i),b=at(i+1),c=at(i+2),d=at(i+3);
    if((a|b|c|d)>63)return null;
    const v=a<<18|b<<12|c<<6|d;
    out[o++]=v>>16;out[o++]=v>>8&255;out[o++]=v&255;
  }
  if(rest){
    const a=at(i),b=at(i+1);
    if((a|b)>63||text.charCodeAt(i+3)!==PAD)return null;
    if(rest===1){
      if(text.charCodeAt(i+2)!==PAD||b&15)return null;
      out[o]=a<<2|b>>4;
    }else{
      const c=at(i+2);
      if(c>63||c&3)return null;
      out[o++]=a<<2|b>>4;out[o]=(b&15)<<4|c>>2;
    }
  }
  return out;
}

/** 0/1 values to an LSB-first bitset (any truthy value sets the bit). */
export function packBits(values:ArrayLike<number>):Uint8Array{
  const n=values.length,out=new Uint8Array((n+7)>>3);
  for(let i=0;i<n;i++)if(values[i])out[i>>3]|=1<<(i&7);
  return out;
}

/** LSB-first bitset to `count` values 0/1. */
export function unpackBits(bits:Uint8Array,count:number):Uint8Array{
  const out=new Uint8Array(count);
  for(let i=0;i<count;i++)out[i]=bits[i>>3]>>(i&7)&1;
  return out;
}

// ---- encode ----

const round3=(v:number)=>{const r=Math.round(v*1000)/1000;return r===0?0:r};
const isObj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const J=JSON.stringify;

/**
 * Deterministic JSON text of the asset (one top-level key per line, floats rounded to 3 decimals): the same input
 * always gives the same bytes. Build-time only: throws an Error with a clear message on invalid input, and the
 * output is checked by decodeCityAsset, so anything it writes decodes.
 */
export function encodeCityAsset(data:CityAssetData):string{
  const fail=(msg:string):never=>{throw new Error(`city asset: ${msg}`)};
  if(!isObj(data))fail('input must be an object');
  const d=data as unknown as Record<string,unknown>;
  const f3=(v:unknown,path:string)=>typeof v==='number'&&Number.isFinite(v)?round3(v):fail(`${path} must be a finite number`);
  const text=(v:unknown,path:string)=>typeof v==='string'?v:fail(`${path} must be a string`);
  const list=(v:unknown,path:string)=>Array.isArray(v)?v:fail(`${path} must be an array`);
  const obj=(v:unknown,path:string)=>isObj(v)?v:fail(`${path} must be an object`);
  const point=(v:unknown,path:string)=>{const p=obj(v,path);return {x:f3(p.x,`${path}.x`),y:f3(p.y,`${path}.y`)}};
  const rect=(v:unknown,path:string)=>{
    const r=list(v,path);
    if(r.length!==4)fail(`${path} must be [x,y,w,h]`);
    return r.map((n,k)=>f3(n,`${path}[${k}]`));
  };
  if(!Number.isSafeInteger(d.version)||(d.version as number)<1)fail('version must be an integer >= 1');
  const cells=obj(d.cells,'cells');
  const cw=cells.w,ch=cells.h;
  if(!Number.isInteger(cw)||!Number.isInteger(ch)||(cw as number)<1||(ch as number)<1||(cw as number)>MAX_CELLS||(ch as number)>MAX_CELLS)
    fail(`cells.w/h must be integers in 1..${MAX_CELLS} (sample grid 1..${MAX_DIM})`);
  const cellsW=cw as number,cellsH=ch as number,sw=cellsW*SAMPLES_PER_CELL,sh=cellsH*SAMPLES_PER_CELL,hw=cellsW+1,hh=cellsH+1;
  const unit=f3(d.unitsPerCell===undefined?UNITS_PER_CELL:d.unitsPerCell,'unitsPerCell');
  if(!(unit>0))fail('unitsPerCell must be > 0 (after rounding to 3 decimals)');
  const bits=(v:unknown,path:string)=>{
    const a=v as ArrayLike<unknown>|null;
    if(!a||typeof a!=='object'||typeof a.length!=='number')fail(`${path} must be a Uint8Array`);
    if(a!.length!==sw*sh)fail(`${path} must have ${sw}x${sh}=${sw*sh} samples, got ${a!.length}`);
    for(let i=0;i<sw*sh;i++){const b=a![i];if(b!==0&&b!==1)fail(`${path}[${i}] must be 0 or 1, got ${String(b)}`)}
    return encodeBase64(packBits(a as ArrayLike<number>));
  };
  const walkable=bits(d.walkable,'walkable');
  const water=d.water===undefined?undefined:bits(d.water,'water');
  const hs=d.heights as ArrayLike<unknown>|null;
  if(!hs||typeof hs!=='object'||typeof hs.length!=='number')fail('heights must be a Float32Array');
  if(hs!.length!==hw*hh)fail(`heights must have ${hw}x${hh}=${hw*hh} corners, got ${hs!.length}`);
  const heightBytes=new Uint8Array(hw*hh*2);
  for(let i=0;i<hw*hh;i++){
    const h=hs![i];
    if(typeof h!=='number'||!Number.isFinite(h))fail(`heights[${i}] must be a finite number`);
    const c=Math.round((h as number)*100);
    if(c<-32767||c>32767)fail(`heights[${i}]=${String(h)} is outside ±${MAX_HEIGHT} u`);
    heightBytes[i*2]=c&255;heightBytes[i*2+1]=c>>8&255;
  }
  const pl=obj(d.playable,'playable'),pts=obj(d.points,'points'),bocas=obj(pts.bocas,'points.bocas');
  const blocks=list(d.blocks,'blocks').map((v,i)=>{
    const b=obj(v,`blocks[${i}]`);
    return {id:text(b.id,`blocks[${i}].id`),kind:text(b.kind,`blocks[${i}].kind`),bbox:rect(b.bbox,`blocks[${i}].bbox`),
      rects:list(b.rects,`blocks[${i}].rects`).map((r,k)=>rect(r,`blocks[${i}].rects[${k}]`))};
  });
  const props=list(d.props,'props').map((v,i)=>{
    const p=obj(v,`props[${i}]`);
    if(typeof p.solid!=='boolean')fail(`props[${i}].solid must be a boolean`);
    return {x:f3(p.x,`props[${i}].x`),y:f3(p.y,`props[${i}].y`),r:f3(p.r,`props[${i}].r`),kind:text(p.kind,`props[${i}].kind`),solid:p.solid};
  });
  const loot=list(d.loot,'loot').map((v,i)=>point(v,`loot[${i}]`));
  const int=(v:unknown,path:string)=>Number.isSafeInteger(v)?v as number:fail(`${path} must be an integer`);
  const decor=d.decor===undefined?undefined:list(d.decor,'decor').map((v,i)=>{
    const q=obj(v,`decor[${i}]`),at=`decor[${i}]`;
    return {id:text(q.id,`${at}.id`),c:int(q.c,`${at}.c`),r:int(q.r,`${at}.r`),w:int(q.w,`${at}.w`),h:int(q.h,`${at}.h`),rot:int(q.rot,`${at}.rot`),
      ...(q.links!==undefined?{links:int(q.links,`${at}.links`)}:{})};
  });
  const lines=[
    `"format":${J(CITY_FORMAT)}`,
    `"formatVersion":${CITY_FORMAT_VERSION}`,
    `"id":${J(text(d.id,'id'))}`,
    `"version":${J(d.version)}`,
    `"name":${J(text(d.name,'name'))}`,
    `"cells":${J({w:cellsW,h:cellsH})}`,
    `"unitsPerCell":${J(unit)}`,
    `"size":${J({w:round3(cellsW*unit),h:round3(cellsH*unit)})}`,
    `"playable":${J({x:f3(pl.x,'playable.x'),y:f3(pl.y,'playable.y'),w:f3(pl.w,'playable.w'),h:f3(pl.h,'playable.h')})}`,
    `"walkable":${J({w:sw,h:sh,step:round3(unit/SAMPLES_PER_CELL),encoding:BITS_ENCODING,data:walkable})}`,
  ];
  if(water!==undefined)lines.push(`"water":${J({w:sw,h:sh,step:round3(unit/SAMPLES_PER_CELL),encoding:BITS_ENCODING,data:water})}`);
  lines.push(
    `"heights":${J({w:hw,h:hh,step:unit,encoding:HEIGHTS_ENCODING,data:encodeBase64(heightBytes)})}`,
    `"points":${J({inicio:point(pts.inicio,'points.inicio'),praca:point(pts.praca,'points.praca'),
      spawnN:point(pts.spawnN,'points.spawnN'),spawnS:point(pts.spawnS,'points.spawnS'),
      spawnL:point(pts.spawnL,'points.spawnL'),spawnO:point(pts.spawnO,'points.spawnO'),
      bocas:{N:point(bocas.N,'points.bocas.N'),S:point(bocas.S,'points.bocas.S'),L:point(bocas.L,'points.bocas.L'),O:point(bocas.O,'points.bocas.O')}})}`,
    `"blocks":${J(blocks)}`,
    `"props":${J(props)}`,
    `"loot":${J(loot)}`,
  );
  // One piece per line: the file stays diffable and the decor never shifts the bytes of the sections above.
  if(decor?.length)lines.push(`"decor":[\n${decor.map(q=>J(q)).join(',\n')}\n]`);
  if(d.source!==undefined){
    const s=obj(d.source,'source');
    lines.push(`"source":${J({sha256:text(s.sha256,'source.sha256'),note:text(s.note,'source.note')})}`);
  }
  const out=`{\n${lines.join(',\n')}\n}\n`;
  const check=decodeCityAsset(out);
  if(!check.ok)throw new Error(check.error);
  return out;
}

// ---- decode ----

class AssetError extends Error {}
const bad=(msg:string):never=>{throw new AssetError(`city asset: ${msg}`)};
const num=(v:unknown,path:string)=>typeof v==='number'&&Number.isFinite(v)?v:bad(`${path} must be a finite number`);
const intIn=(v:unknown,path:string,min:number,max:number)=>
  typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max?v:bad(`${path} must be an integer in ${min}..${max}`);
const str=(v:unknown,path:string,max:number)=>
  typeof v==='string'&&v.length>0&&v.length<=max?v:bad(`${path} must be a non-empty string of at most ${max} characters`);
/** Own enumerable fields only (inherited ones are ignored), on a null-prototype copy. */
const rec=(v:unknown,path:string)=>{
  if(!isObj(v))bad(`${path} must be an object`);
  const out:Record<string,unknown>=Object.create(null);
  for(const k of Object.keys(v as object))out[k]=(v as Record<string,unknown>)[k];
  return out;
};
/** Array.map that also visits holes (a sparse array from an object input must not skip validation). */
const each=<T>(a:readonly unknown[],fn:(v:unknown,i:number)=>T):T[]=>{
  const out:T[]=new Array(a.length);
  for(let i=0;i<a.length;i++)out[i]=fn(a[i],i);
  return out;
};
const arr=(v:unknown,path:string,max:number)=>
  Array.isArray(v)?(v.length<=max?v:bad(`${path} has ${v.length} items, limit ${max}`)):bad(`${path} must be an array`);
const same=(a:number,b:number)=>Math.abs(a-b)<1e-9;

/**
 * Validates and decodes an asset (the JSON text, or the value JSON.parse would give). Never throws: returns
 * {ok:false,error} on anything unknown, malformed, truncated, out of range or inconsistent.
 */
export function decodeCityAsset(json:string|unknown):CityAssetResult{
  try{
    let root:unknown=json;
    if(typeof json==='string'){
      if(json.length>MAX_JSON_CHARS)return {ok:false,error:`city asset: text has ${json.length} characters, limit ${MAX_JSON_CHARS}`};
      try{root=JSON.parse(json)}catch{return {ok:false,error:'city asset: invalid JSON'}}
    }
    return {ok:true,asset:decodeRoot(root)};
  }catch(e){
    if(e instanceof AssetError)return {ok:false,error:e.message};
    return {ok:false,error:`city asset: unreadable asset (${e instanceof Error?e.message:String(e)})`};
  }
}

function decodeRoot(root:unknown):CityAsset{
  const o=rec(root,'asset');
  if(o.format!==CITY_FORMAT)bad(`unknown format ${(J(o.format)??'undefined').slice(0,64)} (expected ${J(CITY_FORMAT)})`);
  if(o.formatVersion!==CITY_FORMAT_VERSION)bad(`unsupported formatVersion ${J(o.formatVersion)??'undefined'} (expected ${CITY_FORMAT_VERSION})`);
  const id=str(o.id,'id',MAX_ID),name=str(o.name,'name',MAX_TEXT),version=intIn(o.version,'version',1,Number.MAX_SAFE_INTEGER);
  const cellsIn=rec(o.cells,'cells');
  const cellsW=intIn(cellsIn.w,'cells.w',1,MAX_CELLS),cellsH=intIn(cellsIn.h,'cells.h',1,MAX_CELLS);
  const unit=num(o.unitsPerCell,'unitsPerCell');
  if(!(unit>0))bad('unitsPerCell must be > 0');
  const sizeIn=rec(o.size,'size'),size={w:num(sizeIn.w,'size.w'),h:num(sizeIn.h,'size.h')};
  if(!same(size.w,round3(cellsW*unit))||!same(size.h,round3(cellsH*unit)))bad('size does not match cells × unitsPerCell');
  const sw=cellsW*SAMPLES_PER_CELL,sh=cellsH*SAMPLES_PER_CELL,hw=cellsW+1,hh=cellsH+1,step=unit/SAMPLES_PER_CELL;
  const grid=(v:unknown,path:string,w:number,h:number,gridStep:number,encoding:string,bytes:number)=>{
    const g=rec(v,path);
    if(intIn(g.w,`${path}.w`,1,MAX_DIM+1)!==w||intIn(g.h,`${path}.h`,1,MAX_DIM+1)!==h)bad(`${path} must be ${w}x${h}`);
    if(!same(num(g.step,`${path}.step`),round3(gridStep)))bad(`${path}.step must be ${round3(gridStep)}`);
    if(g.encoding!==encoding)bad(`${path}.encoding must be ${J(encoding)}`);
    if(typeof g.data!=='string')bad(`${path}.data must be a base64 string`);
    const out=decodeBase64(g.data as string,bytes);
    if(!out)bad(`${path}.data is not valid base64 of ${bytes} bytes (corrupt or truncated)`);
    return out!;
  };
  const count=sw*sh,bitBytes=(count+7)>>3;
  const bitset=(v:unknown,path:string)=>{
    const b=grid(v,path,sw,sh,step,BITS_ENCODING,bitBytes);
    if(count&7&&b[bitBytes-1]>>(count&7))bad(`${path} has non-zero padding bits`);
    return b;
  };
  const walkBits=bitset(o.walkable,'walkable');
  // Optional means absent: the encoder never writes null, so null is a second, non-canonical form and is refused.
  const waterBits=o.water===undefined?null:bitset(o.water,'water');
  const hb=grid(o.heights,'heights',hw,hh,unit,HEIGHTS_ENCODING,hw*hh*2);
  const heights=new Int16Array(hw*hh);
  for(let i=0;i<heights.length;i++){
    heights[i]=(hb[i*2]|hb[i*2+1]<<8)<<16>>16;
    // -32768 (-327.68 u) is outside what encode accepts (±327.67), so a decoded asset always re-encodes.
    if(heights[i]===-32768)bad(`heights[${i}] is outside ±${MAX_HEIGHT} u`);
  }

  const inside=(x:number,y:number,w:number,h:number)=>x>=0&&y>=0&&x+w<=size.w+EDGE_EPS&&y+h<=size.h+EDGE_EPS;
  const pl=rec(o.playable,'playable');
  const playable={x:num(pl.x,'playable.x'),y:num(pl.y,'playable.y'),w:num(pl.w,'playable.w'),h:num(pl.h,'playable.h')};
  if(!(playable.w>0&&playable.h>0)||!inside(playable.x,playable.y,playable.w,playable.h))bad('playable must have w,h > 0 and lie inside the map');

  const asset=makeAsset({cellsW,cellsH,unit,walkBits,waterBits,heights});
  const pointIn=(v:unknown,path:string,walk:boolean)=>{
    const p=rec(v,path),x=num(p.x,`${path}.x`),y=num(p.y,`${path}.y`);
    if(!(x>=0&&y>=0&&x<=size.w&&y<=size.h))bad(`${path} (${x},${y}) is outside the map`);
    if(walk&&!asset.walkableAt(x,y))bad(`${path} (${x},${y}) is not walkable`);
    return Object.freeze({x,y});
  };
  const pts=rec(o.points,'points'),bocasIn=rec(pts.bocas,'points.bocas');
  const P=(k:string)=>pointIn(pts[k],`points.${k}`,true),B=(k:string)=>pointIn(bocasIn[k],`points.bocas.${k}`,true);
  const points:CityPoints=Object.freeze({inicio:P('inicio'),praca:P('praca'),spawnN:P('spawnN'),spawnS:P('spawnS'),spawnL:P('spawnL'),spawnO:P('spawnO'),
    bocas:Object.freeze({N:B('N'),S:B('S'),L:B('L'),O:B('O')})});

  const rectIn=(v:unknown,path:string):CityRect=>{
    const r=arr(v,path,4);
    if(r.length!==4)bad(`${path} must be [x,y,w,h]`);
    const x=num(r[0],`${path}[0]`),y=num(r[1],`${path}[1]`),w=num(r[2],`${path}[2]`),h=num(r[3],`${path}[3]`);
    if(!(w>0&&h>0))bad(`${path} must have w,h > 0`);
    if(!inside(x,y,w,h))bad(`${path} [${x},${y},${w},${h}] is outside the map`);
    return Object.freeze([x,y,w,h] as const);
  };
  const ids=new Set<string>();
  let rectTotal=0;
  const blocks=Object.freeze(each(arr(o.blocks,'blocks',MAX_BLOCKS),(v,i):CityBlock=>{
    const b=rec(v,`blocks[${i}]`),bid=str(b.id,`blocks[${i}].id`,MAX_ID);
    if(ids.has(bid))bad(`blocks[${i}].id ${J(bid)} is repeated`);
    ids.add(bid);
    if(!(BLOCK_KINDS as readonly unknown[]).includes(b.kind))bad(`blocks[${i}].kind must be one of ${BLOCK_KINDS.join(', ')}`);
    const bbox=rectIn(b.bbox,`blocks[${i}].bbox`),rl=arr(b.rects,`blocks[${i}].rects`,MAX_RECTS);
    if(!rl.length)bad(`blocks[${i}].rects must not be empty`);
    if((rectTotal+=rl.length)>MAX_RECTS)bad(`more than ${MAX_RECTS} rects in total`);
    const rects=Object.freeze(each(rl,(r,k)=>rectIn(r,`blocks[${i}].rects[${k}]`)));
    return Object.freeze({id:bid,kind:b.kind as CityBlockKind,bbox,rects});
  }));
  const props=Object.freeze(each(arr(o.props,'props',MAX_PROPS),(v,i):CityProp=>{
    const p=pointIn(v,`props[${i}]`,false),q=rec(v,`props[${i}]`),r=num(q.r,`props[${i}].r`);
    if(!(r>=0))bad(`props[${i}].r must be >= 0`);
    if(typeof q.solid!=='boolean')bad(`props[${i}].solid must be a boolean`);
    return Object.freeze({x:p.x,y:p.y,r,kind:str(q.kind,`props[${i}].kind`,MAX_ID),solid:q.solid as boolean});
  }));
  const loot=Object.freeze(each(arr(o.loot,'loot',MAX_LOOT),(v,i)=>pointIn(v,`loot[${i}]`,false)));
  const cellInt=(v:unknown,path:string,max:number,min=0)=>{
    if(!Number.isSafeInteger(v)||(v as number)<min||(v as number)>max)bad(`${path} must be an integer in ${min}..${max}`);
    return v as number;
  };
  const decor=o.decor===undefined?Object.freeze([]) as readonly CityDecor[]:Object.freeze(each(arr(o.decor,'decor',MAX_DECOR),(v,i):CityDecor=>{
    const q=rec(v,`decor[${i}]`),at=`decor[${i}]`;
    const c=cellInt(q.c,`${at}.c`,cellsW-1),r=cellInt(q.r,`${at}.r`,cellsH-1);
    const w=cellInt(q.w,`${at}.w`,cellsW-c,1),h=cellInt(q.h,`${at}.h`,cellsH-r,1);
    if(!(DECOR_ROTS as readonly unknown[]).includes(q.rot))bad(`${at}.rot must be one of ${DECOR_ROTS.join(', ')}`);
    const links=q.links===undefined?undefined:cellInt(q.links,`${at}.links`,15);
    return Object.freeze({id:str(q.id,`${at}.id`,MAX_ID),c,r,w,h,rot:q.rot as CityDecor['rot'],...(links!==undefined?{links}:{})});
  }));
  let source:CitySource|undefined;
  if(o.source!==undefined){
    const s=rec(o.source,'source'),sha=s.sha256;
    if(typeof sha!=='string'||!/^[0-9a-f]{64}$/.test(sha))bad('source.sha256 must be 64 lowercase hex characters');
    if(typeof s.note!=='string'||s.note.length>MAX_TEXT)bad(`source.note must be a string of at most ${MAX_TEXT} characters`);
    source=Object.freeze({sha256:sha as string,note:s.note as string});
  }
  const meta={id,version,name,cells:Object.freeze({w:cellsW,h:cellsH}),unitsPerCell:unit,size:Object.freeze(size),
    playable:Object.freeze(playable),points,blocks,props,loot,decor};
  return Object.freeze(Object.assign(asset,meta,source?{source}:{})) as CityAsset;
}

interface GridParts {cellsW:number; cellsH:number; unit:number; walkBits:Uint8Array; waterBits:Uint8Array|null; heights:Int16Array}

/** Grid part of a CityAsset. Queries are closures (safe to pass around unbound), O(1) and allocation-free. */
function makeAsset(g:GridParts){
  const {unit,walkBits,waterBits,heights}=g;
  const sw=g.cellsW*SAMPLES_PER_CELL,sh=g.cellsH*SAMPLES_PER_CELL,hw=g.cellsW+1,hh=g.cellsH+1,step=unit/SAMPLES_PER_CELL;
  const W=walkBits,Wa=waterBits??new Uint8Array(0),H=heights,hasWater=waterBits!==null;
  const walkable=(sx:number,sy:number)=>{
    if(!(sx>=0&&sx<sw&&sy>=0&&sy<sh))return false;
    const i=(sy|0)*sw+(sx|0);
    return (W[i>>3]>>(i&7)&1)===1;
  };
  const water=(sx:number,sy:number)=>{
    if(!hasWater||!(sx>=0&&sx<sw&&sy>=0&&sy<sh))return false;
    const i=(sy|0)*sw+(sx|0);
    return (Wa[i>>3]>>(i&7)&1)===1;
  };
  // x/step lands a hair below an exact sample edge in floating point (5.06/0.22 = 22.999…); the nudge keeps
  // [sx·step, (sx+1)·step) exact for coordinates written with 3 decimals, as the encoder does.
  const walkableAt=(x:number,y:number)=>walkable(x/step+SAMPLE_NUDGE,y/step+SAMPLE_NUDGE);
  const height=(hx:number,hy:number)=>{
    const x=hx>0?(hx<hw-1?hx|0:hw-1):0,y=hy>0?(hy<hh-1?hy|0:hh-1):0;
    return H[y*hw+x]/100;
  };
  const heightAt=(x:number,y:number)=>{
    let fx=x/unit,fy=y/unit;
    if(!(fx>0))fx=0;else if(fx>hw-1)fx=hw-1;
    if(!(fy>0))fy=0;else if(fy>hh-1)fy=hh-1;
    let ix=fx|0,iy=fy|0;
    if(ix>hw-2)ix=hw-2;
    if(iy>hh-2)iy=hh-2;
    const tx=fx-ix,ty=fy-iy,i=iy*hw+ix;
    const top=H[i]+(H[i+1]-H[i])*tx,bottom=H[i+hw]+(H[i+hw+1]-H[i+hw])*tx;
    return (top+(bottom-top)*ty)/100;
  };
  return {
    samples:Object.freeze({w:sw,h:sh,step}),heightGrid:Object.freeze({w:hw,h:hh,step:unit}),hasWater,
    walkableBits:walkBits,waterBits,heightsCenti:heights,walkable,water,walkableAt,height,heightAt,
  };
}

/** Back to encoder input (fresh, mutable copies): encodeCityAsset(cityAssetToData(decoded)) gives the same bytes. */
export function cityAssetToData(asset:CityAsset):CityAssetData{
  const pt=(p:CityPoint)=>({x:p.x,y:p.y}),rc=(r:CityRect):CityRect=>[r[0],r[1],r[2],r[3]];
  const {points:p}=asset,count=asset.samples.w*asset.samples.h;
  const heights=new Float32Array(asset.heightsCenti.length);
  for(let i=0;i<heights.length;i++)heights[i]=asset.heightsCenti[i]/100;
  const data:CityAssetData={
    id:asset.id,version:asset.version,name:asset.name,cells:{w:asset.cells.w,h:asset.cells.h},unitsPerCell:asset.unitsPerCell,
    playable:{...asset.playable},walkable:unpackBits(asset.walkableBits,count),heights,
    points:{inicio:pt(p.inicio),praca:pt(p.praca),spawnN:pt(p.spawnN),spawnS:pt(p.spawnS),spawnL:pt(p.spawnL),spawnO:pt(p.spawnO),
      bocas:{N:pt(p.bocas.N),S:pt(p.bocas.S),L:pt(p.bocas.L),O:pt(p.bocas.O)}},
    blocks:asset.blocks.map(b=>({id:b.id,kind:b.kind,bbox:rc(b.bbox),rects:b.rects.map(rc)})),
    props:asset.props.map(q=>({...q})),loot:asset.loot.map(pt),
    ...(asset.decor.length?{decor:asset.decor.map(q=>({...q}))}:{}),
  };
  if(asset.waterBits)data.water=unpackBits(asset.waterBits,count);
  if(asset.source)data.source={...asset.source};
  return data;
}

/** Manifest entry for an encoded asset: sha256 of the exact UTF-8 bytes (D-027), never of the character count. */
export interface CityManifest {id:string;version:number;hash:string;bytes:number}
const hex=(bytes:Uint8Array)=>{let out='';for(let i=0;i<bytes.length;i++)out+=(bytes[i]<16?'0':'')+bytes[i].toString(16);return out;};
/** Hash of the asset text as UTF-8 bytes, with Web Crypto (Node, browser and Workers alike). */
export async function cityAssetHash(json:string):Promise<string>{
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json))));
}
/** Builds {id,version,hash,bytes} for the importer's manifest file; throws if the text is not a valid asset. */
export async function cityManifest(json:string):Promise<CityManifest>{
  const decoded=decodeCityAsset(json);
  if(!decoded.ok)throw new Error(`city asset: cannot build a manifest: ${decoded.error}`);
  return {id:decoded.asset.id,version:decoded.asset.version,hash:await cityAssetHash(json),bytes:new TextEncoder().encode(json).length};
}
/** Client/Worker check of downloaded or bundled text against the manifest (or the room's MapRef hash). Never throws. */
export async function checkCityHash(json:unknown,expected:unknown):Promise<{ok:true}|{ok:false;error:string}>{
  try{
    if(typeof json!=='string')return {ok:false,error:'asset text must be a string'};
    if(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected))return {ok:false,error:'expected hash must be 64 lowercase hex characters'};
    const actual=await cityAssetHash(json);
    return actual===expected?{ok:true}:{ok:false,error:'asset hash does not match'};
  }catch(error){return {ok:false,error:`hash check failed: ${error instanceof Error?error.message:String(error)}`};}
}
