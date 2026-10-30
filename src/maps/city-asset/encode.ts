import {CITY_FORMAT,CITY_FORMAT_VERSION,MAX_DIM,MAX_HEIGHT,BITS_ENCODING,HEIGHTS_ENCODING,SAMPLES_PER_CELL,UNITS_PER_CELL,
  MAX_CELLS,type CityRect,type CityPoint,type CityAssetData,type CityAsset} from './types.ts';
import {encodeBase64,packBits,unpackBits,isObj,J,round3} from './codec.ts';
import {decodeCityAsset} from './decode.ts';
import type {ViaductRect} from '../city/viaduct.ts';

// ---- encode ----


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
      ...(q.links!==undefined?{links:int(q.links,`${at}.links`)}:{}),...(q.cover===true?{cover:true as const}:{})};
  });
  const viaducts=d.viaducts===undefined?undefined:list(d.viaducts,'viaducts').map((v,i)=>{
    const q=obj(v,`viaducts[${i}]`),at=`viaducts[${i}]`,ramp=obj(q.ramp,`${at}.ramp`);
    const cells=(r:unknown,path:string)=>{const a=list(r,path);if(a.length!==4)fail(`${path} must be [c,r,w,h]`);return a.map((n,k)=>int(n,`${path}[${k}]`));};
    return {id:text(q.id,`${at}.id`),deck:cells(q.deck,`${at}.deck`),ramp:{rect:cells(ramp.rect,`${at}.ramp.rect`),up:text(ramp.up,`${at}.ramp.up`)},
      pillars:list(q.pillars,`${at}.pillars`).map((p,k)=>{const a=list(p,`${at}.pillars[${k}]`);return a.map((n,j)=>int(n,`${at}.pillars[${k}][${j}]`));}),
      height:f3(q.height,`${at}.height`)};
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
  if(viaducts?.length)lines.push(`"viaducts":${J(viaducts)}`);
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
    ...(asset.viaducts.length?{viaducts:asset.viaducts.map(v=>({id:v.id,deck:[...v.deck] as unknown as ViaductRect,
      ramp:{rect:[...v.ramp.rect] as unknown as ViaductRect,up:v.ramp.up},pillars:v.pillars.map(([c,r])=>[c,r] as const),height:v.height}))}:{}),
  };
  if(asset.waterBits)data.water=unpackBits(asset.waterBits,count);
  if(asset.source)data.source={...asset.source};
  return data;
}
