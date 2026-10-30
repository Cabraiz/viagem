import {CITY_FORMAT,CITY_FORMAT_VERSION,MAX_JSON_CHARS,MAX_DIM,MAX_BLOCKS,MAX_PROPS,MAX_LOOT,MAX_DECOR,MAX_VIADUCTS,MAX_PILLARS,
  DECOR_ROTS,MAX_RECTS,SAMPLES_PER_CELL,MAX_CELLS,MAX_HEIGHT,BLOCK_KINDS,BITS_ENCODING,HEIGHTS_ENCODING,EDGE_EPS,MAX_ID,MAX_TEXT,
  type CityBlockKind,type CityRect,type CityBlock,type CityProp,type CityDecor,type CityPoints,type CitySource,type CityAsset,
  type CityAssetResult} from './types.ts';
import {decodeBase64,isObj,J,round3} from './codec.ts';
import {makeAsset} from './grid.ts';
import {viaductProblem,type ViaductRect,type CityViaduct,type RampUp} from '../city/viaduct.ts';

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
    if(q.cover!==undefined&&q.cover!==true)bad(`${at}.cover must be true when given`);
    return Object.freeze({id:str(q.id,`${at}.id`,MAX_ID),c,r,w,h,rot:q.rot as CityDecor['rot'],...(links!==undefined?{links}:{}),...(q.cover===true?{cover:true as const}:{})});
  }));
  const viaducts=o.viaducts===undefined?Object.freeze([]) as readonly CityViaduct[]:Object.freeze(each(arr(o.viaducts,'viaducts',MAX_VIADUCTS),(v,i):CityViaduct=>{
    const q=rec(v,`viaducts[${i}]`),at=`viaducts[${i}]`,ramp=rec(q.ramp,`${at}.ramp`);
    const cells=(r:unknown,path:string)=>{
      const a=arr(r,path,4);if(a.length!==4)bad(`${path} must be [c,r,w,h]`);
      return Object.freeze(each(a,(n,k)=>cellInt(n,`${path}[${k}]`,Math.max(cellsW,cellsH)))) as unknown as ViaductRect;
    };
    const pillars=Object.freeze(each(arr(q.pillars,`${at}.pillars`,MAX_PILLARS),(p,k)=>{
      const a=arr(p,`${at}.pillars[${k}]`,2);if(a.length!==2)bad(`${at}.pillars[${k}] must be [c,r]`);
      return Object.freeze([cellInt(a[0],`${at}.pillars[${k}][0]`,cellsW-1),cellInt(a[1],`${at}.pillars[${k}][1]`,cellsH-1)] as const);
    }));
    const out:CityViaduct={id:str(q.id,`${at}.id`,MAX_ID),deck:cells(q.deck,`${at}.deck`),
      ramp:Object.freeze({rect:cells(ramp.rect,`${at}.ramp.rect`),up:ramp.up as RampUp}),pillars,height:num(q.height,`${at}.height`)};
    const problem=viaductProblem(out,cellsW,cellsH);
    if(problem)bad(`${at}: ${problem}`);
    return Object.freeze(out);
  }));
  let source:CitySource|undefined;
  if(o.source!==undefined){
    const s=rec(o.source,'source'),sha=s.sha256;
    if(typeof sha!=='string'||!/^[0-9a-f]{64}$/.test(sha))bad('source.sha256 must be 64 lowercase hex characters');
    if(typeof s.note!=='string'||s.note.length>MAX_TEXT)bad(`source.note must be a string of at most ${MAX_TEXT} characters`);
    source=Object.freeze({sha256:sha as string,note:s.note as string});
  }
  const meta={id,version,name,cells:Object.freeze({w:cellsW,h:cellsH}),unitsPerCell:unit,size:Object.freeze(size),
    playable:Object.freeze(playable),points,blocks,props,loot,decor,viaducts};
  return Object.freeze(Object.assign(asset,meta,source?{source}:{})) as CityAsset;
}
