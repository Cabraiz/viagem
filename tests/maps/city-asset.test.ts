// Adversarial suite for src/maps/city-asset.ts (card NEW-20261012-ORQ-cidade-asset-01).
// Written against the contract in design/cidade-protocolo.md §5 (E1 proposal + "Resposta do E5").
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {
  CITY_FORMAT,CITY_FORMAT_VERSION,MAX_JSON_CHARS,MAX_DIM,MAX_BLOCKS,MAX_PROPS,MAX_LOOT,
  encodeCityAsset,decodeCityAsset,
} from '../../src/maps/city-asset.ts';
import type {CityAssetData,CityAsset} from '../../src/maps/city-asset.ts';
import * as cityAssetModule from '../../src/maps/city-asset.ts';

// ---------- Contract constants (spec §5) ----------
const UNITS_PER_CELL=0.88;
const STEP=0.22;             // 4 samples per cell
const SAMPLES_PER_CELL=4;
const HEIGHT_TOL=0.005;      // Int16 in hundredths of a unit

const r3=(v:number)=>Math.round(v*1000)/1000;

// Deep-normalize numbers to 3 decimals (metadata floats are written with 3 decimals).
function norm3(v:unknown):unknown{
  if(typeof v==='number')return r3(v);
  if(Array.isArray(v))return v.map(norm3);
  if(v&&typeof v==='object'){
    const out:Record<string,unknown>={};
    for(const k of Object.keys(v))out[k]=norm3((v as Record<string,unknown>)[k]);
    return out;
  }
  return v;
}
// Plain-JSON view (drops prototypes, typed arrays are not expected here).
const plain=(v:unknown)=>v===undefined?undefined:JSON.parse(JSON.stringify(v));

// ---------- Small synthetic city: 8×8 cells → 32×32 samples, 9×9 heights ----------
type Pt={x:number;y:number};
type Rect=[number,number,number,number];
type Block={id:string;kind:string;bbox:Rect;rects:Rect[]};

const SW=32,SH=32,HW=9,HH=9;
const SMALL_SIZE=r3(8*UNITS_PER_CELL); // 7.04

function sampleRect(sx:number,sy:number,w:number,h:number):Rect{
  return [r3(sx*STEP),r3(sy*STEP),r3(w*STEP),r3(h*STEP)];
}

function smallHeight(hx:number,hy:number):number{
  if(hx===0&&hy===8)return 7.04;
  if(hx===8&&hy===8)return -1.76;
  return 2.2+1.9*Math.sin(hx*0.7)+1.3*Math.cos(hy*0.9)-0.11*hx*hy/8;
}

function buildSmall():CityAssetData{
  const walk=new Uint8Array(SW*SH).fill(1);
  const water=new Uint8Array(SW*SH);
  const blockS=(x0:number,y0:number,w:number,h:number)=>{
    for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)walk[y*SW+x]=0;
  };
  blockS(4,4,8,8);    // building A
  blockS(20,4,8,8);   // building B (asymmetric: catches transposed grids)
  blockS(4,20,8,2);   // wall west
  blockS(20,20,8,2);  // wall east
  for(let i=0;i<12;i++){const x=(i*7)%8,y=24+((i*5)%8);walk[y*SW+x]=0;} // rubble, x 0..7 y 24..31
  // deep water (blocked) x 27..31, y 12..13 — its rect touches the east edge and 5.94+1.1 = 7.040000000000001 in doubles
  for(let y=12;y<=13;y++)for(let x=27;x<=31;x++){walk[y*SW+x]=0;water[y*SW+x]=1;}
  // shallow water (walkable) x 0..3, y 12..19
  for(let y=12;y<=19;y++)for(let x=0;x<=3;x++)water[y*SW+x]=1;
  walk[31*SW+31]=0;   // single blocked sample in the SE corner (edge)

  const heights=new Float32Array(HW*HH);
  for(let hy=0;hy<HH;hy++)for(let hx=0;hx<HW;hx++)heights[hy*HW+hx]=smallHeight(hx,hy);

  const blocks:Block[]=[
    {id:'b-0001',kind:'building',bbox:sampleRect(4,4,8,8),rects:[sampleRect(4,4,8,8)]},
    {id:'b-0002',kind:'building',bbox:sampleRect(20,4,8,8),rects:[sampleRect(20,4,4,8),sampleRect(24,4,4,8)]},
    {id:'b-0003',kind:'wall',bbox:sampleRect(4,20,24,2),rects:[sampleRect(4,20,8,2),sampleRect(20,20,8,2)]},
    {id:'b-0004',kind:'rubble',bbox:sampleRect(0,24,8,8),rects:[sampleRect(0,24,8,8)]},
    {id:'b-0005',kind:'cliff',bbox:sampleRect(27,12,5,2),rects:[sampleRect(27,12,5,2)]},
    {id:'b-0006',kind:'edge',bbox:sampleRect(31,31,1,1),rects:[sampleRect(31,31,1,1)]},
  ];
  const points={
    inicio:{x:3.5,y:3.5},praca:{x:3.7,y:3.3},
    spawnN:{x:3.5,y:0.3},spawnS:{x:3.5,y:6.9},spawnL:{x:6.9,y:3.5},spawnO:{x:0.1,y:3.5},
    bocas:{N:{x:3.6,y:0.05},S:{x:3.6,y:7.0},L:{x:7.0,y:3.6},O:{x:0.05,y:3.6}},
  };
  const props=[
    {x:1.23456,y:5.4321,r:0.3,kind:'tree',solid:true},
    {x:6.1,y:6.2,r:0.25,kind:'rock',solid:false},
    {x:2.0,y:2.0,r:0.5,kind:'ruin',solid:true},
    {x:3.0,y:6.5,r:0.125,kind:'light',solid:false},
  ];
  const loot=[{x:3.3,y:3.0},{x:0.5,y:0.5},{x:6.5,y:3.7}];
  return {
    id:'cidade-teste',version:3,name:'Cidade Teste',
    cells:{w:8,h:8},
    playable:{x:0.44,y:0.44,w:6.16,h:6.16},
    walkable:walk,water,heights,points,blocks,props,loot,
    source:{sha256:'0123456789abcdef'.repeat(4),note:'fixture sintética — não é o mapa real'},
  } as unknown as CityAssetData;
}

function cloneData(d:CityAssetData):any{return structuredClone(d) as any;}

// ---------- Full-size generator: 192×192 cells → 768² samples, 193² heights ----------
function lcg(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}

function buildFull():CityAssetData{
  const CW=192,FW=CW*SAMPLES_PER_CELL,FHW=CW+1;
  const rnd=lcg(20261012);
  const walk=new Uint8Array(FW*FW).fill(1);
  const water=new Uint8Array(FW*FW);
  const blocks:Block[]=[];
  let nid=0;
  const id=()=>`b-${String(++nid).padStart(4,'0')}`;
  const fill=(x0:number,y0:number,w:number,h:number)=>{
    for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)walk[y*FW+x]=0;
  };
  const isStreet=(s:number)=>s%32<6;
  // city blocks of 32 samples, streets 6 wide; 1–3 buildings per block + rubble in yards
  for(let by=0;by<FW/32;by++)for(let bx=0;bx<FW/32;bx++){
    const ox=bx*32+6,oy=by*32+6; // yard 26×26
    const n=1+Math.floor(rnd()*3);
    const rects:Rect[]=[];
    for(let k=0;k<n;k++){
      const w=4+Math.floor(rnd()*9),h=4+Math.floor(rnd()*9);
      const x=ox+1+Math.floor(rnd()*(24-w)),y=oy+1+Math.floor(rnd()*(24-h));
      fill(x,y,w,h);
      rects.push(sampleRect(x,y,w,h));
    }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const [x,y,w,h] of rects){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h);}
    blocks.push({id:id(),kind:'building',bbox:[r3(minX),r3(minY),r3(maxX-minX),r3(maxY-minY)],rects});
    for(let i=0;i<3;i++){
      const x=ox+Math.floor(rnd()*26),y=oy+Math.floor(rnd()*26);
      if(walk[y*FW+x]){walk[y*FW+x]=0;blocks.push({id:id(),kind:'rubble',bbox:sampleRect(x,y,1,1),rects:[sampleRect(x,y,1,1)]});}
    }
  }
  // river: shallow 300..330, deep 310..320 except bridges on streets
  for(let y=0;y<FW;y++)for(let x=300;x<=330;x++){
    water[y*FW+x]=1;
    if(isStreet(y))walk[y*FW+x]=1;
    else if(x>=310&&x<=320)walk[y*FW+x]=0;
    else walk[y*FW+x]=1;
  }
  for(let by=0;by<FW/32;by++){
    const y0=by*32+6;
    blocks.push({id:id(),kind:'cliff',bbox:sampleRect(310,y0,11,26),rects:[sampleRect(310,y0,11,26)]});
  }
  // blocked map edge (8 samples) touching the boundary
  fill(0,0,FW,8);fill(0,FW-8,FW,8);fill(0,0,8,FW);fill(FW-8,0,8,FW);
  for(const r of [sampleRect(0,0,FW,8),sampleRect(0,FW-8,FW,8),sampleRect(0,0,8,FW),sampleRect(FW-8,0,8,FW)]){
    blocks.push({id:id(),kind:'edge',bbox:r,rects:[r]});
  }
  const heights=new Float32Array(FHW*FHW);
  for(let hy=0;hy<FHW;hy++)for(let hx=0;hx<FHW;hx++){
    const h=2.64+3.4*Math.sin(hx/23)*Math.cos(hy/31)+0.9*Math.sin(hx*0.37+hy*0.11);
    heights[hy*FHW+hx]=Math.max(-1.76,Math.min(7.04,h));
  }
  const at=(sx:number,sy:number):Pt=>({x:r3((sx+0.5)*STEP),y:r3((sy+0.5)*STEP)});
  const points={
    inicio:at(386,386),praca:at(388,390),
    spawnN:at(386,12),spawnS:at(386,755),spawnL:at(755,386),spawnO:at(12,386),
    bocas:{N:at(388,9),S:at(388,758),L:at(758,388),O:at(9,388)},
  };
  const kinds=['tree','rock','ruin','prop','light'];
  const props:Array<{x:number;y:number;r:number;kind:string;solid:boolean}>=[];
  while(props.length<4000){
    const sx=8+Math.floor(rnd()*(FW-16)),sy=8+Math.floor(rnd()*(FW-16));
    if(!walk[sy*FW+sx]||isStreet(sx)||isStreet(sy))continue;
    props.push({x:r3((sx+rnd())*STEP),y:r3((sy+rnd())*STEP),r:r3(0.15+rnd()*0.5),kind:kinds[props.length%kinds.length],solid:rnd()<0.6});
  }
  const loot:Pt[]=[];
  for(let i=0;i<45;i++)loot.push(at(32*(1+(i%22))+2,32*(1+((i*7)%22))+2));
  for(const p of [points.inicio,points.praca,points.spawnN,points.spawnS,points.spawnL,points.spawnO,...Object.values(points.bocas),...loot]){
    if(!walk[Math.floor(p.y/STEP)*FW+Math.floor(p.x/STEP)])throw new Error(`fixture bug: point not walkable ${JSON.stringify(p)}`);
  }
  return {
    id:'cidade-nevada',version:1,name:'Cidade Nevada',
    cells:{w:CW,h:CW},playable:{x:r3(10*UNITS_PER_CELL),y:r3(10*UNITS_PER_CELL),w:r3(172*UNITS_PER_CELL),h:r3(172*UNITS_PER_CELL)},
    walkable:walk,water,heights,points,blocks,props,loot,
    source:{sha256:'f'.repeat(64),note:'gerado pelo teste (tamanho real)'},
  } as unknown as CityAssetData;
}

// ---------- Helpers ----------
const SMALL=buildSmall();
const SMALL_JSON=encodeCityAsset(SMALL);

type DecodeResult={ok:true;asset:CityAsset}|{ok:false;error:unknown};

function decode(input:unknown,label:string):DecodeResult{
  let r:DecodeResult|undefined;
  try{r=decodeCityAsset(input as any) as DecodeResult;}
  catch(e){assert.fail(`${label}: decodeCityAsset threw ${(e as Error)?.name}: ${(e as Error)?.message}`);}
  assert.ok(r&&typeof r==='object',`${label}: result is not an object`);
  return r!;
}
function refuse(input:unknown,label:string){
  const r=decode(input,label);
  assert.equal(r.ok,false,`${label}: should be refused`);
  assert.ok((r as {error:unknown}).error,`${label}: refused without an error`);
}
function accept(input:unknown,label:string):any{
  const r=decode(input,label);
  assert.equal(r.ok,true,`${label}: should be accepted, got ${String((r as {error?:unknown}).error)}`);
  return (r as {asset:CityAsset}).asset as any;
}
// Parse SMALL_JSON, mutate, re-serialize (decoder must accept any JSON whitespace).
function mutated(fn:(o:any)=>void,base=SMALL_JSON):string{const o=JSON.parse(base);fn(o);return JSON.stringify(o);}
// Same, but splice raw JSON text in place of a placeholder (for __proto__ keys, 1e999, etc.).
function withRaw(fn:(o:any)=>void,raw:string):string{
  return mutated(fn).replace('"__RAW__"',raw);
}

const CLEAR_ERROR_BLACKLIST=/Cannot read propert|is not a function|is not iterable|undefined is not|of undefined|of null|Maximum call stack|Invalid array length/;

function encodeThrows(mut:(d:any)=>void,label:string){
  const d=cloneData(SMALL);mut(d);
  let err:unknown;
  try{encodeCityAsset(d);}catch(e){err=e;}
  assert.ok(err instanceof Error,`${label}: encodeCityAsset should throw an Error`);
  const msg=(err as Error).message;
  assert.ok(typeof msg==='string'&&msg.length>=8,`${label}: error message too short: "${msg}"`);
  assert.doesNotMatch(msg,CLEAR_ERROR_BLACKLIST,`${label}: error is not a clear validation error: "${msg}"`);
}
// Weaker invariant for inputs the spec does not list explicitly: encode either throws a clear Error,
// or produces a string the decoder accepts (never a file the game would later refuse).
function encodeThrowsOrDecodes(mut:(d:any)=>void,label:string,check?:(a:any)=>void){
  const d=cloneData(SMALL);mut(d);
  let out:string|undefined;let err:unknown;
  try{out=encodeCityAsset(d);}catch(e){err=e;}
  if(err!==undefined){
    assert.ok(err instanceof Error,`${label}: threw a non-Error`);
    assert.doesNotMatch((err as Error).message,CLEAR_ERROR_BLACKLIST,`${label}: unclear error "${(err as Error).message}"`);
    return 'threw';
  }
  const a=accept(out,`${label} (encoder accepted it, so the decoder must too)`);
  check?.(a);
  return 'encoded';
}

// Rebuild CityAssetData from a decoded CityAsset using only its public surface.
function assetToData(a:any,withWater:boolean,withSource:boolean):any{
  const sw=a.cells.w*SAMPLES_PER_CELL,sh=a.cells.h*SAMPLES_PER_CELL,hw=a.cells.w+1,hh=a.cells.h+1;
  const walk=new Uint8Array(sw*sh),water=new Uint8Array(sw*sh),heights=new Float32Array(hw*hh);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){walk[y*sw+x]=a.walkable(x,y)?1:0;water[y*sw+x]=a.water(x,y)?1:0;}
  for(let y=0;y<hh;y++)for(let x=0;x<hw;x++)heights[y*hw+x]=a.height(x,y);
  const d:any={
    id:a.id,version:a.version,name:a.name,cells:plain(a.cells),playable:plain(a.playable),
    walkable:walk,heights,points:plain(a.points),blocks:plain(a.blocks),props:plain(a.props),loot:plain(a.loot),
  };
  if(withWater)d.water=water;
  if(withSource)d.source=plain(a.source);
  return d;
}

function b64bytes(s:string):Buffer{return Buffer.from(s,'base64');}

let FULL:{data:any;json:string;asset:any;encodeMs:number;decodeMs:number}|undefined;
function full(){
  if(!FULL){
    const data=buildFull();
    let t=performance.now();
    const json=encodeCityAsset(data);
    const encodeMs=performance.now()-t;
    t=performance.now();
    const asset=accept(json,'full-size city');
    const decodeMs=performance.now()-t;
    FULL={data,json,asset,encodeMs,decodeMs};
  }
  return FULL;
}

// =====================================================================
// Exports and constants
// =====================================================================
test('constants match the contract', ()=>{
  assert.equal(CITY_FORMAT,'viagem-city');
  assert.equal(CITY_FORMAT_VERSION,1);
  assert.equal(MAX_DIM,4096);
  assert.equal(MAX_BLOCKS,20000);
  assert.equal(MAX_PROPS,50000);
  assert.equal(MAX_LOOT,5000);
  assert.ok(MAX_JSON_CHARS>=4_000_000&&MAX_JSON_CHARS<=4*1024*1024,`MAX_JSON_CHARS=${MAX_JSON_CHARS} is not "4 MB"`);
  assert.equal(typeof encodeCityAsset,'function');
  assert.equal(typeof decodeCityAsset,'function');
});

// =====================================================================
// Output shape
// =====================================================================
test('output: format header, sections and encodings', ()=>{
  const o=JSON.parse(SMALL_JSON);
  assert.equal(o.format,CITY_FORMAT);
  assert.equal(o.formatVersion,CITY_FORMAT_VERSION);
  assert.deepEqual(Object.keys(o).slice(0,2),['format','formatVersion']);
  assert.equal(o.id,'cidade-teste');
  assert.equal(o.version,3);
  assert.equal(o.name,'Cidade Teste');
  assert.deepEqual(o.cells,{w:8,h:8});
  assert.equal(o.unitsPerCell,UNITS_PER_CELL);
  assert.deepEqual(o.size,{w:7.04,h:7.04});
  for(const k of ['walkable','water']){
    assert.equal(o[k].w,SW,k);assert.equal(o[k].h,SH,k);
    assert.equal(o[k].step,STEP,k);
    assert.equal(o[k].encoding,'bits-lsb-base64',k);
    assert.equal(typeof o[k].data,'string',k);
  }
  assert.equal(o.heights.w,HW);assert.equal(o.heights.h,HH);
  assert.equal(o.heights.step,UNITS_PER_CELL);
  assert.equal(o.heights.encoding,'i16le-centi-base64');
});

test('output: walkable/water bitsets are LSB-first base64 (checked independently)', ()=>{
  const o=JSON.parse(SMALL_JSON);
  const d=SMALL as any;
  for(const [k,src] of [['walkable',d.walkable],['water',d.water]] as const){
    const bytes=b64bytes(o[k].data);
    assert.equal(bytes.length,Math.ceil(SW*SH/8),`${k} byte length`);
    for(let i=0;i<SW*SH;i++)assert.equal((bytes[i>>3]>>(i&7))&1,src[i],`${k} bit ${i}`);
  }
});

test('output: heights are Int16 LE in hundredths of a unit (checked independently)', ()=>{
  const o=JSON.parse(SMALL_JSON);
  const bytes=b64bytes(o.heights.data);
  assert.equal(bytes.length,HW*HH*2);
  const h=(SMALL as any).heights as Float32Array;
  for(let i=0;i<HW*HH;i++)assert.equal(bytes.readInt16LE(i*2),Math.round(h[i]*100),`height ${i}`);
});

test('output: one top-level key per line', ()=>{
  const o=JSON.parse(SMALL_JSON);
  const keys=Object.keys(o);
  const lines=SMALL_JSON.split('\n').filter(l=>l.trim()!=='');
  for(const k of keys){
    const re=new RegExp(`^\\s*[{,]?\\s*${JSON.stringify(k)}\\s*:`);
    const starts=lines.filter(l=>re.test(l)).length;
    assert.equal(starts,1,`key ${k} should start exactly one line`);
  }
  assert.ok(lines.length>=keys.length&&lines.length<=keys.length+2,
    `${lines.length} lines for ${keys.length} top-level keys`);
});

test('output: metadata floats have at most 3 decimals, no exponent notation', ()=>{
  const noStrings=SMALL_JSON.replace(/"(?:[^"\\]|\\.)*"/g,'""');
  assert.doesNotMatch(noStrings,/\d\.\d{4,}/);
  assert.doesNotMatch(noStrings,/\d[eE][+-]?\d/);
  const walk=(v:unknown,path:string):void=>{
    if(typeof v==='number')assert.equal(r3(v),v,`${path}=${v}`);
    else if(Array.isArray(v))v.forEach((x,i)=>walk(x,`${path}[${i}]`));
    else if(v&&typeof v==='object')for(const k of Object.keys(v))walk((v as any)[k],`${path}.${k}`);
  };
  walk(JSON.parse(SMALL_JSON),'$');
  // 1.23456 must come out as 1.235, 5.4321 as 5.432
  const p=JSON.parse(SMALL_JSON).props[0];
  assert.equal(p.x,1.235);assert.equal(p.y,5.432);
});

// =====================================================================
// Round-trip
// =====================================================================
test('round-trip: every walkable/water sample identical', ()=>{
  const a=accept(SMALL_JSON,'small');
  const d=SMALL as any;
  for(let sy=0;sy<SH;sy++)for(let sx=0;sx<SW;sx++){
    const i=sy*SW+sx;
    assert.equal(!!a.walkable(sx,sy),d.walkable[i]===1,`walkable(${sx},${sy})`);
    assert.equal(!!a.water(sx,sy),d.water[i]===1,`water(${sx},${sy})`);
  }
});

test('round-trip: heights within 0.005 u at every corner', ()=>{
  const a=accept(SMALL_JSON,'small');
  const h=(SMALL as any).heights as Float32Array;
  let worst=0;
  for(let hy=0;hy<HH;hy++)for(let hx=0;hx<HW;hx++){
    const got=a.height(hx,hy);
    assert.equal(typeof got,'number');
    const err=Math.abs(got-h[hy*HW+hx]);
    worst=Math.max(worst,err);
    assert.ok(err<=HEIGHT_TOL,`height(${hx},${hy})=${got} vs ${h[hy*HW+hx]}`);
  }
  assert.ok(Math.abs(a.height(0,8)-7.04)<=HEIGHT_TOL);
  assert.ok(Math.abs(a.height(8,8)+1.76)<=HEIGHT_TOL);
});

test('round-trip: metadata (points, blocks, props, loot, source, playable, ids) equal to 3 decimals', ()=>{
  const a=accept(SMALL_JSON,'small');
  const d=SMALL as any;
  assert.equal(a.id,d.id);
  assert.equal(a.version,d.version);
  assert.equal(a.name,d.name);
  assert.deepEqual(plain(a.cells),d.cells);
  assert.equal(a.unitsPerCell,UNITS_PER_CELL);
  assert.deepEqual(plain(a.size),{w:7.04,h:7.04});
  assert.deepEqual(plain(a.playable),norm3(d.playable));
  assert.deepEqual(plain(a.points),norm3(d.points));
  assert.deepEqual(plain(a.blocks),norm3(d.blocks));
  assert.deepEqual(plain(a.props),norm3(d.props));
  assert.deepEqual(plain(a.loot),norm3(d.loot));
  assert.deepEqual(plain(a.source),d.source);
});

test('round-trip: encode → decode → re-encode gives the identical string', ()=>{
  const a=accept(SMALL_JSON,'small');
  const again=encodeCityAsset(assetToData(a,true,true));
  assert.equal(again,SMALL_JSON);
});

test('round-trip: cityAssetToData (optional helper export) re-encodes to the same bytes, as fresh copies', (t)=>{
  const toData=(cityAssetModule as any).cityAssetToData as ((a:CityAsset)=>CityAssetData)|undefined;
  if(typeof toData!=='function'){t.skip('cityAssetToData not exported');return;}
  for(const [label,json] of [['small',SMALL_JSON],['full',full().json]] as const){
    const a=accept(json,label);
    const d=toData(a) as any;
    assert.equal(encodeCityAsset(d),json,`${label}: cityAssetToData round-trip`);
    d.walkable.fill(0);d.points.inicio.x=-5;
    if(d.blocks.length)d.blocks[0].rects[0][0]=-5;
    assert.equal(encodeCityAsset(toData(a)),json,`${label}: mutating the copy changed the asset`);
  }
  const noWater=accept(mutated(o=>{delete o.water;delete o.source;}),'no water/source');
  const d=toData(noWater) as any;
  assert.equal(d.water,undefined);assert.equal(d.source,undefined);
});

test('round-trip: decode accepts the already-parsed object and does not mutate it', ()=>{
  const o=JSON.parse(SMALL_JSON);
  const before=JSON.stringify(o);
  const a=accept(o,'parsed object');
  assert.equal(JSON.stringify(o),before,'decode mutated its input');
  assert.equal(encodeCityAsset(assetToData(a,true,true)),SMALL_JSON);
});

test('determinism: same input → same bytes (clones, key order, repeated calls); input not mutated', ()=>{
  const d=cloneData(SMALL);
  const snapshot=JSON.stringify({...d,walkable:Array.from(d.walkable),water:Array.from(d.water),heights:Array.from(d.heights)});
  assert.equal(encodeCityAsset(d),SMALL_JSON);
  assert.equal(encodeCityAsset(d),SMALL_JSON);
  assert.equal(JSON.stringify({...d,walkable:Array.from(d.walkable),water:Array.from(d.water),heights:Array.from(d.heights)}),snapshot,'encode mutated its input');
  // same content, different key insertion order
  const r:any={};
  for(const k of Object.keys(d).reverse())r[k]=d[k];
  r.props=d.props.map((p:any)=>({solid:p.solid,kind:p.kind,r:p.r,y:p.y,x:p.x}));
  r.loot=d.loot.map((p:any)=>({y:p.y,x:p.x}));
  r.playable={h:d.playable.h,w:d.playable.w,y:d.playable.y,x:d.playable.x};
  r.blocks=d.blocks.map((b:any)=>({rects:b.rects,bbox:b.bbox,kind:b.kind,id:b.id}));
  r.source={note:d.source.note,sha256:d.source.sha256};
  assert.equal(encodeCityAsset(r),SMALL_JSON);
});

test('round-trip: water and source are optional on decode', ()=>{
  const noWater=accept(mutated(o=>{delete o.water;}),'no water');
  for(let sy=0;sy<SH;sy++)for(let sx=0;sx<SW;sx++){
    assert.equal(!!noWater.water(sx,sy),false);
    assert.equal(!!noWater.walkable(sx,sy),(SMALL as any).walkable[sy*SW+sx]===1);
  }
  const noSource=accept(mutated(o=>{delete o.source;}),'no source');
  assert.ok(noSource.source==null,'source should be absent');
  accept(mutated(o=>{delete o.source;delete o.water;}),'neither');
});

test('round-trip: full-size city (768² samples, 193² heights)', ()=>{
  const {data,json,asset}=full();
  const FW=768,FHW=193;
  for(let sy=0;sy<FW;sy++)for(let sx=0;sx<FW;sx++){
    const i=sy*FW+sx;
    if((!!asset.walkable(sx,sy))!==(data.walkable[i]===1))assert.fail(`walkable(${sx},${sy})`);
    if((!!asset.water(sx,sy))!==(data.water[i]===1))assert.fail(`water(${sx},${sy})`);
  }
  for(let hy=0;hy<FHW;hy++)for(let hx=0;hx<FHW;hx++){
    if(!(Math.abs(asset.height(hx,hy)-data.heights[hy*FHW+hx])<=HEIGHT_TOL))assert.fail(`height(${hx},${hy})`);
  }
  assert.deepEqual(plain(asset.size),{w:168.96,h:168.96});
  assert.equal(asset.blocks.length,data.blocks.length);
  assert.deepEqual(plain(asset.points),norm3(data.points));
  assert.equal(encodeCityAsset(assetToData(asset,true,true)),json,'full re-encode differs');
  assert.equal(encodeCityAsset(data),json,'full encode not deterministic');
});

test('size: full-size JSON stays under 600 KB gzip', (t)=>{
  const {json,encodeMs,decodeMs}=full();
  const gz=gzipSync(Buffer.from(json,'utf8'),{level:9}).length;
  t.diagnostic(`full city JSON: ${json.length} chars (${(json.length/1024).toFixed(1)} KiB), gzip -9: ${gz} bytes (${(gz/1024).toFixed(1)} KiB)`);
  t.diagnostic(`encode ${encodeMs.toFixed(1)} ms, decode ${decodeMs.toFixed(1)} ms`);
  assert.ok(json.length<=MAX_JSON_CHARS,'full city exceeds MAX_JSON_CHARS');
  assert.ok(gz<600_000,`gzip ${gz} ≥ 600 KB`);
});

// =====================================================================
// encodeCityAsset: loud, clear failures
// =====================================================================
test('encode throws: wrong array sizes', ()=>{
  encodeThrows(d=>{d.walkable=new Uint8Array(SW*SH-1);},'walkable short');
  encodeThrows(d=>{d.walkable=new Uint8Array(SW*SH+1);},'walkable long');
  encodeThrows(d=>{d.walkable=new Uint8Array(8*8).fill(1);},'walkable at cell resolution');
  encodeThrows(d=>{d.water=new Uint8Array(SW*SH-8);},'water short');
  encodeThrows(d=>{d.heights=new Float32Array(HW*HH-1);},'heights short');
  encodeThrows(d=>{d.heights=new Float32Array(8*8);},'heights w×h instead of (w+1)×(h+1)');
  encodeThrows(d=>{d.cells={w:8,h:9};},'cells disagree with arrays');
  encodeThrows(d=>{d.cells={w:0,h:0};d.walkable=new Uint8Array(0);d.water=new Uint8Array(0);d.heights=new Float32Array(1);},'zero cells');
});

test('encode: walkable/water values other than 0/1 throw or are treated as 1', ()=>{
  for(const v of [2,255]){
    encodeThrowsOrDecodes(d=>{d.walkable[16*SW+16]=v;},`walkable=${v}`,a=>assert.equal(!!a.walkable(16,16),true));
    encodeThrowsOrDecodes(d=>{d.water[16*SW+16]=v;},`water=${v}`,a=>assert.equal(!!a.water(16,16),true));
  }
});

test('encode throws: heights out of ±327.67 u, NaN, Infinity', ()=>{
  encodeThrows(d=>{d.heights[40]=327.7;},'327.7');
  encodeThrows(d=>{d.heights[40]=-327.7;},'-327.7');
  encodeThrows(d=>{d.heights[40]=1000;},'1000');
  encodeThrows(d=>{d.heights[40]=NaN;},'NaN');
  encodeThrows(d=>{d.heights[40]=Infinity;},'Infinity');
  encodeThrows(d=>{d.heights[0]=-Infinity;},'-Infinity at index 0');
});

test('encode: heights near the Int16 limits round-trip', ()=>{
  const d=cloneData(SMALL);
  d.heights[1]=327.6;d.heights[2]=-327.6;d.heights[3]=0;d.heights[4]=-0.004;d.heights[5]=0.005;
  const a=accept(encodeCityAsset(d),'extremes');
  assert.ok(Math.abs(a.height(1,0)-327.6)<=HEIGHT_TOL);
  assert.ok(Math.abs(a.height(2,0)+327.6)<=HEIGHT_TOL);
  assert.ok(Math.abs(a.height(4,0)+0.004)<=HEIGHT_TOL);
});

test('encode throws: points outside, on blocked samples, NaN', ()=>{
  encodeThrows(d=>{d.points.inicio={x:1.76,y:1.76};},'inicio inside building A');
  encodeThrows(d=>{d.points.praca={x:6.5,y:2.75};},'praca on deep water');
  encodeThrows(d=>{d.points.spawnS={x:6.83,y:6.83};},'spawnS on the single blocked SE sample');
  encodeThrows(d=>{d.points.bocas.L={x:-0.05,y:3.6};},'bocas.L west of the map');
  encodeThrows(d=>{d.points.bocas.S={x:3.6,y:SMALL_SIZE};},'bocas.S exactly at y=size (sample 32)');
  encodeThrows(d=>{d.points.spawnN={x:3.5,y:100};},'spawnN far outside');
  encodeThrows(d=>{d.points.spawnO={x:NaN,y:3.5};},'spawnO NaN');
  encodeThrows(d=>{delete d.points.bocas.N;},'bocas.N missing');
  encodeThrows(d=>{delete d.points.inicio;},'inicio missing');
});

test('encode throws: rects outside the area or with w/h ≤ 0', ()=>{
  encodeThrows(d=>{d.blocks[0].rects[0]=[6,6,2,2];},'rect past SE');
  encodeThrows(d=>{d.blocks[0].rects[0]=[-0.5,1,1,1];},'rect x<0');
  encodeThrows(d=>{d.blocks[0].rects[0]=[1,1,0,1];},'rect w=0');
  encodeThrows(d=>{d.blocks[0].rects[0]=[1,1,1,-0.22];},'rect h<0');
  encodeThrows(d=>{d.blocks[0].bbox=[0,0,8,8];},'bbox past SE');
  encodeThrows(d=>{d.blocks[1].rects.push([1,1,NaN,1]);},'rect NaN');
  encodeThrows(d=>{d.playable={x:0,y:0,w:8,h:8};},'playable larger than the map');
  encodeThrows(d=>{d.playable={x:1,y:1,w:0,h:3};},'playable w=0');
});

test('encode: rect touching the far edge is accepted despite float sums (5.94+1.1 > 7.04 in doubles)', ()=>{
  // SMALL already contains b-0005 = [5.94,2.64,1.1,0.44]; encoding it must not throw.
  assert.equal(5.94+1.1>7.04,true);
  const a=accept(SMALL_JSON,'small');
  assert.deepEqual(plain(a.blocks[4].rects[0]),[5.94,2.64,1.1,0.44]);
  const d=cloneData(SMALL);
  d.blocks[0].rects.push([r3(12*STEP),r3(12*STEP),r3(20*STEP),r3(20*STEP)]); // 2.64+4.4 > 7.04 too
  assert.doesNotThrow(()=>encodeCityAsset(d));
});

test('encode throws: duplicate block id', ()=>{
  encodeThrows(d=>{d.blocks[3].id=d.blocks[0].id;},'duplicate b-0001');
  encodeThrows(d=>{d.blocks.push(structuredClone(d.blocks[5]));},'duplicate last block');
});

test('encode: unlisted bad metadata never produces a file the decoder refuses', ()=>{
  encodeThrowsOrDecodes(d=>{d.props[0].x=NaN;},'prop x NaN');
  encodeThrowsOrDecodes(d=>{d.props[1].r=Infinity;},'prop r Infinity');
  encodeThrowsOrDecodes(d=>{d.props.push({x:50,y:50,r:1,kind:'tree',solid:true});},'prop outside');
  encodeThrowsOrDecodes(d=>{d.loot.push({x:-1,y:3});},'loot outside');
  encodeThrowsOrDecodes(d=>{d.loot.push({x:1.76,y:1.76});},'loot inside a building');
  encodeThrowsOrDecodes(d=>{d.blocks[0].kind='constructor';},'unknown block kind');
  encodeThrowsOrDecodes(d=>{d.name='Cidade "Nevada" \\   \n';},'name with quotes, backslash, U+2028, newline');
  encodeThrowsOrDecodes(d=>{d.source.note='linha1\nlinha2';},'note with newline');
  encodeThrowsOrDecodes(d=>{d.version=1.5;},'fractional content version');
  encodeThrowsOrDecodes(d=>{d.props=[];d.loot=[];d.blocks=[];},'empty lists');
});

test('encode: a newline inside a string does not break "one key per line"', ()=>{
  const d=cloneData(SMALL);d.source.note='a\nb';d.name='x\ny';
  let out:string;
  try{out=encodeCityAsset(d);}catch{return;}
  const keys=Object.keys(JSON.parse(out));
  const lines=out.split('\n').filter(l=>l.trim()!=='');
  assert.ok(lines.length<=keys.length+2,'raw newline leaked into the output');
});

// =====================================================================
// decodeCityAsset: never throws, refuses corrupt input
// =====================================================================
test('decode refuses null, primitives, arrays and garbage without throwing', ()=>{
  const throwingGetter={get format():string{throw new Error('boom');}};
  const throwingProxy=new Proxy({},{get(){throw new Error('trap');},has(){throw new Error('trap');},ownKeys(){throw new Error('trap');},getOwnPropertyDescriptor(){throw new Error('trap');}});
  const cases:Array<[string,unknown]>=[
    ['undefined',undefined],['null',null],['true',true],['0',0],['NaN',NaN],['42',42],['bigint',10n],['symbol',Symbol('x')],
    ['function',()=>1],['[]',[]],['[valid]',[JSON.parse(SMALL_JSON)]],['{}',{}],['Date',new Date()],['Map',new Map()],
    ['Uint8Array',new Uint8Array(10)],['Buffer of the JSON',Buffer.from(SMALL_JSON)],
    ["''",''],["' '",'   '],["'null'",'null'],["'[]'",'[]'],["'{}'",'{}'],["'42'",'42'],["'\"x\"'",'"x"'],
    ['garbage','garbage'],['NaN text','NaN'],['trailing junk',SMALL_JSON+'x'],['BOM? no — leading junk','x'+SMALL_JSON],
    ['deep nesting','['.repeat(200000)],['deep nesting closed','['.repeat(5000)+']'.repeat(5000)],
    ['throwing getter',throwingGetter],['throwing proxy',throwingProxy],
  ];
  for(const [label,v] of cases)refuse(v,label);
});

test('decode refuses truncated JSON at every offset (small) and at many offsets (full)', ()=>{
  const end=SMALL_JSON.lastIndexOf('}');
  for(let i=0;i<end;i++)refuse(SMALL_JSON.slice(0,i),`small cut at ${i}`);
  const {json}=full();
  const fend=json.lastIndexOf('}');
  const offs=new Set<number>();
  for(let k=0;k<40;k++)offs.add(Math.floor(k*fend/40));
  for(let k=1;k<=5;k++)offs.add(fend-k);
  for(const key of ['"walkable"','"water"','"heights"','"points"','"blocks"','"props"','"loot"']){
    const p=json.indexOf(key);offs.add(p);offs.add(p+key.length+40);
  }
  for(const i of offs)refuse(json.slice(0,i),`full cut at ${i}`);
});

test('decode refuses wrong format / formatVersion', ()=>{
  refuse(mutated(o=>{o.format='viagem-cidade';}),'format name');
  refuse(mutated(o=>{o.format='';}),'empty format');
  refuse(mutated(o=>{delete o.format;}),'no format');
  refuse(mutated(o=>{o.formatVersion=2;}),'formatVersion 2');
  refuse(mutated(o=>{o.formatVersion=0;}),'formatVersion 0');
  refuse(mutated(o=>{o.formatVersion='1';}),'formatVersion string');
  refuse(mutated(o=>{delete o.formatVersion;}),'no formatVersion');
  refuse(mutated(o=>{o.walkable.encoding='bits-msb-base64';}),'walkable encoding');
  refuse(mutated(o=>{o.heights.encoding='f32le-base64';}),'heights encoding');
});

for(const section of ['walkable','water','heights'] as const){
  test(`decode refuses corrupted base64 in ${section}`, ()=>{
    const data:string=JSON.parse(SMALL_JSON)[section].data;
    const mid=Math.floor(data.length/2);
    const set=(s:string)=>mutated(o=>{o[section].data=s;});
    refuse(set(data.slice(0,mid)+'!'+data.slice(mid+1)),'invalid char !');
    refuse(set(data.slice(0,mid)+'-'+data.slice(mid+1)),'base64url char -');
    refuse(set(data.slice(0,mid)+'_'+data.slice(mid+1)),'base64url char _');
    refuse(set(data.slice(0,mid)+'é'+data.slice(mid+1)),'non-ascii char');
    refuse(set(data.slice(0,-1)),'one char short');
    refuse(set(data.slice(0,-4)),'one quantum short (valid base64, wrong length)');
    refuse(set(data+'AAAA'),'one quantum long (valid base64, wrong length)');
    refuse(set(data.slice(0,mid)),'half');
    refuse(set(''),'empty');
    refuse(set('A=AA'+data.slice(4)),'padding in the middle');
    refuse(mutated(o=>{o[section].data=null;}),'data null');
    refuse(mutated(o=>{o[section].data=12345;}),'data number');
    refuse(mutated(o=>{o[section].data=[data];}),'data array');
    refuse(mutated(o=>{delete o[section].data;}),'data missing');
    if(section!=='water')refuse(mutated(o=>{delete o[section];}),'section missing');
    refuse(mutated(o=>{o[section]=data;}),'section is a bare string');
  });
}

test('decode refuses nonzero padding bits', ()=>{
  // walkable/water: 32·32 bits = 128 bytes → base64 ends "xyz=": the last data char carries 2 padding bits.
  const A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for(const section of ['walkable','water'] as const){
    const data:string=JSON.parse(SMALL_JSON)[section].data;
    assert.ok(data.endsWith('=')&&!data.endsWith('=='),'fixture expectation: 128 bytes → one "="');
    const c=data[data.length-2];
    const v=A.indexOf(c);
    assert.equal(v&3,0,'encoder must emit zero padding bits');
    const bad=data.slice(0,-2)+A[v|1]+'=';
    refuse(mutated(o=>{o[section].data=bad;}),`${section}: base64 padding bits set`);
  }
  // A bitset whose sample count is not a multiple of 8 cannot occur with 4 samples per cell; a section
  // claiming such dims (and carrying stray high bits in the last byte) must be refused anyway.
  refuse(mutated(o=>{o.walkable.w=33;o.walkable.h=31;}),'walkable 33×31 with garbage tail bits');
});

test('decode refuses bad dimensions', ()=>{
  const dims:unknown[]=[0,-8,8.5,'8',null,4097,1e9,MAX_DIM+1,Number.MAX_SAFE_INTEGER];
  for(const v of dims){
    refuse(mutated(o=>{o.cells.w=v;}),`cells.w=${String(v)}`);
    refuse(mutated(o=>{o.cells.h=v;}),`cells.h=${String(v)}`);
    refuse(mutated(o=>{o.walkable.w=v;}),`walkable.w=${String(v)}`);
    refuse(mutated(o=>{o.heights.h=v;}),`heights.h=${String(v)}`);
  }
  refuse(mutated(o=>{o.cells={w:4096,h:4096};}),'cells 4096² with small data (must not allocate/throw)');
  refuse(mutated(o=>{o.walkable.w=8;o.walkable.h=8;}),'walkable at cell resolution');
  refuse(mutated(o=>{o.heights.w=8;o.heights.h=8;}),'heights w×h instead of (w+1)×(h+1)');
  refuse(mutated(o=>{o.water.w=16;o.water.h=64;}),'water reshaped (same bit count)');
  refuse(mutated(o=>{delete o.cells;}),'no cells');
});

test('decode refuses non-finite numbers and strings in numeric fields', ()=>{
  refuse(withRaw(o=>{o.playable.x='__RAW__';},'1e999'),'playable.x = 1e999 (Infinity)');
  refuse(withRaw(o=>{o.points.inicio.y='__RAW__';},'-1e999'),'inicio.y = -1e999');
  refuse(withRaw(o=>{o.props[0].r='__RAW__';},'1e999'),'prop r = 1e999');
  refuse(withRaw(o=>{o.loot[0].x='__RAW__';},'1e999'),'loot x = 1e999');
  refuse(withRaw(o=>{o.blocks[0].rects[0][2]='__RAW__';},'1e999'),'rect w = 1e999');
  refuse(mutated(o=>{o.points.inicio.x='3.5';}),'inicio.x string');
  refuse(mutated(o=>{o.props[0].x='1';}),'prop x string');
  refuse(mutated(o=>{o.loot[0].y=null;}),'loot y null');
  refuse(mutated(o=>{o.blocks[0].bbox[0]='0.88';}),'bbox string');
  refuse(mutated(o=>{o.version='1';}),'content version string');
  // object input can carry real NaN/Infinity
  const nan=JSON.parse(SMALL_JSON);nan.points.praca.x=NaN;refuse(nan,'object: praca.x NaN');
  const inf=JSON.parse(SMALL_JSON);inf.props[0].y=Infinity;refuse(inf,'object: prop y Infinity');
  const ninf=JSON.parse(SMALL_JSON);ninf.playable.w=-Infinity;refuse(ninf,'object: playable.w -Infinity');
  const lnan=JSON.parse(SMALL_JSON);lnan.loot[1].x=NaN;refuse(lnan,'object: loot x NaN');
});

test('decode refuses rects outside the area or with w/h ≤ 0', ()=>{
  refuse(mutated(o=>{o.blocks[0].rects[0]=[6,6,2,2];}),'rect past SE');
  refuse(mutated(o=>{o.blocks[0].rects[0]=[-0.5,1,1,1];}),'rect x<0');
  refuse(mutated(o=>{o.blocks[0].rects[0]=[1,-0.001,1,1];}),'rect y<0');
  refuse(mutated(o=>{o.blocks[0].rects[0]=[1,1,0,1];}),'rect w=0');
  refuse(mutated(o=>{o.blocks[0].rects[0]=[1,1,1,-1];}),'rect h<0');
  refuse(mutated(o=>{o.blocks[0].rects[0]=[1,1,1];}),'rect with 3 numbers');
  refuse(mutated(o=>{o.blocks[0].rects[0]=[1,1,1,1,1];}),'rect with 5 numbers');
  refuse(mutated(o=>{o.blocks[0].rects[0]={x:1,y:1,w:1,h:1};}),'rect as object');
  refuse(mutated(o=>{o.blocks[0].rects=null;}),'rects null');
  refuse(mutated(o=>{o.blocks[0].bbox=[0,0,8,8];}),'bbox past SE');
  refuse(mutated(o=>{o.blocks[0].bbox=[1,1,0,0];}),'bbox empty');
  refuse(mutated(o=>{o.playable={x:0,y:0,w:8,h:8};}),'playable past SE');
  refuse(mutated(o=>{o.playable={x:-1,y:0,w:2,h:2};}),'playable x<0');
  refuse(mutated(o=>{o.playable={x:1,y:1,w:0,h:2};}),'playable w=0');
  refuse(mutated(o=>{o.blocks[2]=null;}),'block null');
  refuse(mutated(o=>{o.blocks='b-0001';}),'blocks not an array');
});

test('decode refuses points outside or on blocked samples', ()=>{
  refuse(mutated(o=>{o.points.inicio={x:-0.1,y:3.5};}),'inicio x<0');
  refuse(mutated(o=>{o.points.inicio={x:3.5,y:-0.001};}),'inicio y just below 0 (trunc would map to row 0)');
  refuse(mutated(o=>{o.points.inicio={x:SMALL_SIZE,y:3.5};}),'inicio at x=size');
  refuse(mutated(o=>{o.points.inicio={x:3.5,y:1000};}),'inicio far south');
  refuse(mutated(o=>{o.points.inicio={x:1.76,y:1.76};}),'inicio in building A');
  refuse(mutated(o=>{o.points.praca={x:5.39,y:1.43};}),'praca in building B, sample (24,6); transposed (6,24) is walkable');
  refuse(mutated(o=>{o.points.spawnL={x:6.5,y:2.75};}),'spawnL on deep water');
  refuse(mutated(o=>{o.points.bocas.S={x:6.83,y:6.83};}),'bocas.S on blocked SE sample');
  refuse(mutated(o=>{o.points.bocas.O={x:0.05,y:5.39};}),'bocas.O on rubble sample (0,24)');
  refuse(mutated(o=>{delete o.points.spawnN;}),'spawnN missing');
  refuse(mutated(o=>{delete o.points.bocas;}),'bocas missing');
  refuse(mutated(o=>{o.points.bocas.N=[3.6,0.05];}),'point as array');
  refuse(mutated(o=>{o.points=null;}),'points null');
  // a point on shallow water is walkable and must be accepted
  accept(mutated(o=>{o.points.spawnO={x:0.3,y:3.0};}),'spawnO on shallow water');
});

test('decode enforces MAX_BLOCKS / MAX_PROPS / MAX_LOOT (at limit ok, limit+1 refused)', ()=>{
  const block=(i:number)=>({id:`b-${i}`,kind:'rubble',bbox:[0,5.28,0.22,0.22],rects:[[0,5.28,0.22,0.22]]});
  const withBlocks=(n:number)=>{const o=JSON.parse(SMALL_JSON);o.blocks=Array.from({length:n},(_,i)=>block(i));return o;};
  const withProps=(n:number)=>{const o=JSON.parse(SMALL_JSON);o.props=Array.from({length:n},()=>({x:1,y:1,r:0.1,kind:'tree',solid:false}));return o;};
  const withLoot=(n:number)=>{const o=JSON.parse(SMALL_JSON);o.loot=Array.from({length:n},()=>({x:3.5,y:3.5}));return o;};
  accept(withBlocks(MAX_BLOCKS),'MAX_BLOCKS');
  refuse(withBlocks(MAX_BLOCKS+1),'MAX_BLOCKS+1');
  accept(withProps(MAX_PROPS),'MAX_PROPS');
  refuse(withProps(MAX_PROPS+1),'MAX_PROPS+1');
  accept(withLoot(MAX_LOOT),'MAX_LOOT');
  refuse(withLoot(MAX_LOOT+1),'MAX_LOOT+1');
  // sparse "length" tricks
  const sparse=JSON.parse(SMALL_JSON);sparse.props=new Array(MAX_PROPS+1);refuse(sparse,'sparse props array of MAX_PROPS+1 holes');
});

test('decode refuses text longer than MAX_JSON_CHARS (exactly at the limit is fine)', ()=>{
  refuse(SMALL_JSON+' '.repeat(MAX_JSON_CHARS),'whitespace-padded > limit');
  refuse(SMALL_JSON.replace('"note":"','"note":"'+'x'.repeat(MAX_JSON_CHARS)),'huge string field');
  accept(SMALL_JSON+' '.repeat(MAX_JSON_CHARS-SMALL_JSON.length),'exactly MAX_JSON_CHARS');
});

test('decode refuses missing required fields', ()=>{
  for(const k of ['id','version','name','cells','playable','walkable','heights','points','blocks','props','loot']){
    refuse(mutated(o=>{delete o[k];}),`missing ${k}`);
  }
  refuse(mutated(o=>{o.id=7;}),'id number');
  refuse(mutated(o=>{o.props[0].solid='yes';}),'prop solid string');
  refuse(mutated(o=>{o.props[0].kind=null;}),'prop kind null');
});

test('decode resists prototype tricks and never pollutes Object.prototype', ()=>{
  const before=Object.getOwnPropertyNames(Object.prototype).sort().join(',');
  const o=JSON.parse(SMALL_JSON);
  // 1. everything hidden behind "__proto__" at top level
  refuse(`{"__proto__":${SMALL_JSON}}`,'all fields behind top-level __proto__');
  // 2. required point only reachable through __proto__
  const pts=o.points;
  const rest=Object.keys(pts).filter(k=>k!=='inicio').map(k=>`${JSON.stringify(k)}:${JSON.stringify(pts[k])}`).join(',');
  refuse(withRaw(x=>{x.points='__RAW__';},`{"__proto__":{"inicio":${JSON.stringify(pts.inicio)}},${rest}}`),'inicio only via __proto__');
  // 3. bocas via __proto__
  refuse(withRaw(x=>{x.points.bocas='__RAW__';},`{"__proto__":${JSON.stringify(pts.bocas)}}`),'bocas only via __proto__');
  // 4. section fields via __proto__
  refuse(withRaw(x=>{x.walkable='__RAW__';},`{"__proto__":${JSON.stringify(o.walkable)}}`),'walkable section via __proto__');
  // 5. pollution attempts on an otherwise valid file must not leak
  for(const raw of ['{"polluted":1}','{"format":"x","walkable":1}']){
    const txt=SMALL_JSON.replace(/^\{/,`{"__proto__":${raw},`);
    decode(txt,'__proto__ pollution attempt');
  }
  decode(SMALL_JSON.replace(/^\{/,'{"constructor":{"prototype":{"polluted":1}},'),'constructor.prototype attempt');
  decode(mutated(x=>{x.points.constructor={prototype:{polluted:1}};}),'points.constructor attempt');
  decode(mutated(x=>{x.blocks[0].id='__proto__';x.blocks[1].id='constructor';x.blocks[2].id='hasOwnProperty';}),'magic block ids');
  assert.equal(({} as any).polluted,undefined,'Object.prototype polluted');
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(','),before,'Object.prototype changed');
});

test('decode: magic block ids round-trip as plain data', ()=>{
  const d=cloneData(SMALL);d.blocks[0].id='__proto__';d.blocks[1].id='constructor';
  let out:string;
  try{out=encodeCityAsset(d);}catch{return;} // refusing such ids is fine too
  const a=accept(out,'magic ids');
  assert.equal(a.blocks[0].id,'__proto__');
  assert.equal(a.blocks[1].id,'constructor');
});

// =====================================================================
// Access
// =====================================================================
const A=accept(SMALL_JSON,'small (access)');
const W=(SMALL as any).walkable as Uint8Array;
const WT=(SMALL as any).water as Uint8Array;

test('access: walkable/water out of the grid never throw and are false', ()=>{
  assert.ok(W[0]===1&&W[31]===1&&W[32]===1,'fixture: samples (0,0),(31,0),(0,1) walkable');
  assert.ok(WT[12*SW+31]===1,'fixture: (31,12) is water');
  const outs:Array<[number,number]>=[
    [-1,0],[0,-1],[-1,-1],[SW,0],[0,SH],[SW,SH],[1e9,0],[0,1e9],[-1e9,-1e9],
    [32,-1],      // flat index 0 → must not alias (0,0)
    [-1,1],       // flat index 31 → must not alias (31,0)
    [32,0],       // flat index 32 → must not alias (0,1)
    [-1,13],      // flat index 415 → must not alias water (31,12)
    [NaN,0],[0,NaN],[NaN,NaN],[Infinity,0],[0,-Infinity],[2**31,0],[0,2**32+1],[-(2**31),5],
  ];
  for(const [x,y] of outs){
    let w:unknown,wa:unknown;
    assert.doesNotThrow(()=>{w=A.walkable(x,y);wa=A.water(x,y);},`(${x},${y})`);
    assert.equal(!!w,false,`walkable(${x},${y}) should be false`);
    assert.equal(!!wa,false,`water(${x},${y}) should be false`);
  }
  for(const [x,y] of [[0.5,0.5],[31.9,0],[-0.5,0],[0,-0.5],[16.25,16.75]] as Array<[number,number]>){
    assert.doesNotThrow(()=>{A.walkable(x,y);A.water(x,y);},`float (${x},${y})`);
  }
  assert.equal(!!A.walkable(-0.5,0),false,'walkable(-0.5,0) must not truncate to column 0');
});

test('access: walkableAt maps world units to samples (step 0.22), boundaries included', ()=>{
  const eps=1e-4;
  for(let sy=0;sy<SH;sy++)for(let sx=0;sx<SW;sx++){
    const want=W[sy*SW+sx]===1;
    const x0=sx*STEP,y0=sy*STEP;
    for(const [x,y] of [[x0+STEP/2,y0+STEP/2],[x0+eps,y0+eps],[x0+STEP-eps,y0+eps],[x0+eps,y0+STEP-eps],[x0+STEP-eps,y0+STEP-eps]]){
      assert.equal(!!A.walkableAt(x,y),want,`walkableAt(${x},${y}) → sample (${sx},${sy})`);
    }
  }
  assert.equal(!!A.walkableAt(0,0),true,'origin');
  assert.equal(!!A.walkableAt(SMALL_SIZE-eps,0.1),true,'last column');
  assert.equal(!!A.walkableAt(SMALL_SIZE-eps,SMALL_SIZE-eps),false,'SE blocked sample');
  // out of the map — includes values that truncation (|0, Math.trunc) would map to sample 0
  const outs:Array<[number,number]>=[
    [-0.01,0.1],[0.1,-0.01],[-0.2,-0.2],[-STEP+eps,0.1],[SMALL_SIZE,0.1],[0.1,SMALL_SIZE],[SMALL_SIZE+0.5,3.5],
    [NaN,1],[1,NaN],[Infinity,1],[1,-Infinity],[1e12,1],[-1e12,1],
  ];
  for(const [x,y] of outs){
    let r:unknown;
    assert.doesNotThrow(()=>{r=A.walkableAt(x,y);},`walkableAt(${x},${y})`);
    assert.equal(!!r,false,`walkableAt(${x},${y}) should be false`);
  }
});

test('access: height(hx,hy) out of the grid never throws', (t)=>{
  const seen:string[]=[];
  for(const [x,y] of [[-1,0],[0,-1],[HW,0],[0,HH],[HW,HH],[NaN,0],[0,Infinity],[0.5,0.5],[1e9,1e9],[9,-1]] as Array<[number,number]>){
    let v:unknown;
    assert.doesNotThrow(()=>{v=A.height(x,y);},`height(${x},${y})`);
    assert.equal(typeof v,'number',`height(${x},${y}) type`);
    seen.push(`height(${x},${y})=${v}`);
  }
  t.diagnostic(seen.join('  '));
});

test('access: heightAt is bilinear — corners, edge midpoints, centres, quarter points', ()=>{
  const H=(hx:number,hy:number)=>A.height(hx,hy) as number;
  const near=(a:number,b:number,msg:string)=>assert.ok(Math.abs(a-b)<=1e-6,`${msg}: ${a} vs ${b}`);
  for(let hy=0;hy<HH;hy++)for(let hx=0;hx<HW;hx++){
    near(A.heightAt(hx*UNITS_PER_CELL,hy*UNITS_PER_CELL),H(hx,hy),`corner (${hx},${hy})`);
  }
  for(let hy=0;hy<HH-1;hy++)for(let hx=0;hx<HW-1;hx++){
    const x=(hx+0.5)*UNITS_PER_CELL,y=(hy+0.5)*UNITS_PER_CELL;
    near(A.heightAt(x,hy*UNITS_PER_CELL),(H(hx,hy)+H(hx+1,hy))/2,`top midpoint (${hx},${hy})`);
    near(A.heightAt(hx*UNITS_PER_CELL,y),(H(hx,hy)+H(hx,hy+1))/2,`left midpoint (${hx},${hy})`);
    near(A.heightAt(x,y),(H(hx,hy)+H(hx+1,hy)+H(hx,hy+1)+H(hx+1,hy+1))/4,`centre (${hx},${hy})`);
    const fx=0.25,fy=0.75;
    const want=H(hx,hy)*(1-fx)*(1-fy)+H(hx+1,hy)*fx*(1-fy)+H(hx,hy+1)*(1-fx)*fy+H(hx+1,hy+1)*fx*fy;
    near(A.heightAt((hx+fx)*UNITS_PER_CELL,(hy+fy)*UNITS_PER_CELL),want,`quarter (${hx},${hy})`);
  }
  // far edges: x = size must not read past the last corner
  near(A.heightAt(SMALL_SIZE,SMALL_SIZE),H(8,8),'SE corner at x=y=size');
  near(A.heightAt(0,SMALL_SIZE),H(0,8),'SW corner at y=size');
  near(A.heightAt(SMALL_SIZE,0.44),(H(8,0)+H(8,1))/2,'east edge midpoint');
  near(A.heightAt(3.52,SMALL_SIZE),H(4,8),'south edge corner');
});

test('access: heightAt outside the map never throws', (t)=>{
  const seen:string[]=[];
  for(const [x,y] of [[-1,1],[1,-1],[SMALL_SIZE+0.01,1],[1,SMALL_SIZE+5],[NaN,1],[1,NaN],[Infinity,1],[-Infinity,-Infinity],[1e12,1e12]] as Array<[number,number]>){
    let v:unknown;
    assert.doesNotThrow(()=>{v=A.heightAt(x,y);},`heightAt(${x},${y})`);
    assert.equal(typeof v,'number',`heightAt(${x},${y}) type`);
    seen.push(`heightAt(${x},${y})=${v}`);
  }
  t.diagnostic(seen.join('  '));
});

// =====================================================================
// Performance (≤ 50 ns per query in node)
// =====================================================================
// D-031: a wall-clock limit, so it only runs with BENCH=1 (it failed under 100% CPU with several executors):
//   BENCH=1 node --experimental-strip-types --test tests/maps/city-asset.test.ts
test('perf: walkable / walkableAt / height / heightAt ≤ 50 ns per query on the full city (BENCH=1 only)', {skip:process.env.BENCH!=='1'&&'bench: run with BENCH=1 (D-031)'}, (t)=>{
  const {asset}=full();
  const N=1<<20,MASK=N-1,PASSES=6;
  const rnd=lcg(7);
  const sx=new Int32Array(N),sy=new Int32Array(N),hx=new Int32Array(N),hy=new Int32Array(N);
  const ux=new Float64Array(N),uy=new Float64Array(N);
  for(let i=0;i<N;i++){
    sx[i]=Math.floor(rnd()*784)-8;sy[i]=Math.floor(rnd()*784)-8;   // ~2% out of the grid
    hx[i]=Math.floor(rnd()*193);hy[i]=Math.floor(rnd()*193);
    ux[i]=rnd()*170-0.5;uy[i]=rnd()*170-0.5;
  }
  const a=asset;
  let sink=0;
  const runs:Record<string,()=>void>={
    walkable:()=>{let c=0;for(let p=0;p<PASSES;p++)for(let i=0;i<N;i++)if(a.walkable(sx[i],sy[(i+p)&MASK]))c++;sink+=c;},
    walkableAt:()=>{let c=0;for(let p=0;p<PASSES;p++)for(let i=0;i<N;i++)if(a.walkableAt(ux[i],uy[(i+p)&MASK]))c++;sink+=c;},
    height:()=>{let s=0;for(let p=0;p<PASSES;p++)for(let i=0;i<N;i++)s+=a.height(hx[i],hy[(i+p)&MASK]);sink+=s;},
    heightAt:()=>{let s=0;for(let p=0;p<PASSES;p++)for(let i=0;i<N;i++)s+=a.heightAt(ux[i],uy[(i+p)&MASK]);sink+=s;},
  };
  const report:string[]=[];
  const results:Record<string,number>={};
  for(const [name,fn] of Object.entries(runs)){
    fn(); // warm-up
    let best=Infinity;
    for(let r=0;r<3;r++){
      const t0=process.hrtime.bigint();fn();const t1=process.hrtime.bigint();
      best=Math.min(best,Number(t1-t0)/(N*PASSES));
    }
    results[name]=best;
    report.push(`${name}: ${best.toFixed(2)} ns/query (best of 3 × ${N*PASSES/1e6}M)`);
  }
  t.diagnostic(report.join(' | ')+` (sink ${Number.isFinite(sink)?'ok':'nan'})`);
  console.log(`[bench] city-asset queries: ${report.join(' | ')}`);
  for(const [name,ns] of Object.entries(results))assert.ok(ns<=50,`${name}: ${ns.toFixed(2)} ns/query > 50`);
});

// ---------- Independent review fixes ----------
test('walkableAt: exact sample edges written with 3 decimals land in their own sample (5.06/0.22 = 22.999… in doubles)', ()=>{
  const fullAsset=full().asset;
  const a=fullAsset as CityAsset;
  let mismatches=0;
  for(let k=0;k<a.samples.w;k++){
    const x=Math.round(k*STEP*1000)/1000;
    for(const sy of [0,383,767])if(a.walkableAt(x,sy*STEP+STEP/2)!==a.walkable(k,sy))mismatches++;
  }
  assert.equal(mismatches,0,'every edge k·0.22 maps to sample k');
  assert.equal(a.walkableAt(-0.01,1),false,'small negative x stays outside');
});

test('decode refuses -32768 heights (encode accepts only ±327.67), so a decoded asset always re-encodes', ()=>{
  const o=JSON.parse(SMALL_JSON);
  const bytes=Buffer.from(o.heights.data,'base64');bytes[0]=0x00;bytes[1]=0x80; // -32768 LE
  o.heights.data=bytes.toString('base64');
  refuse(JSON.stringify(o),'height -32768');
});

test('decode refuses null for the optional water and source (absent is the only optional form)', ()=>{
  refuse(mutated(o=>{o.water=null;}),'water null');
  refuse(mutated(o=>{o.source=null;}),'source null');
});

test('a huge bogus format does not echo megabytes into the error', ()=>{
  const r=decode(mutated(o=>{o.format='x'.repeat(3_000_000);}),'huge format');
  assert.equal(r.ok,false);
  assert.ok(String((r as {error:unknown}).error).length<300,'error message stays short');
});

test('manifest: sha256 of the exact UTF-8 bytes (not characters), and the hash check never throws', async ()=>{
  const {createHash}=await import('node:crypto');
  const mod=cityAssetModule as any;
  assert.ok(/[^\x00-\x7f]/.test(SMALL_JSON),'fixture has non-ASCII text, so bytes ≠ characters');
  const m=await mod.cityManifest(SMALL_JSON);
  assert.equal(m.hash,createHash('sha256').update(Buffer.from(SMALL_JSON,'utf8')).digest('hex'));
  assert.equal(m.bytes,Buffer.byteLength(SMALL_JSON,'utf8'));
  assert.notEqual(m.bytes,SMALL_JSON.length);
  assert.equal(m.id,SMALL.id);assert.equal(m.version,SMALL.version);
  assert.deepEqual(await mod.checkCityHash(SMALL_JSON,m.hash),{ok:true});
  assert.equal((await mod.checkCityHash(SMALL_JSON+' ',m.hash)).ok,false,'one extra byte changes the hash');
  for(const [json,hash] of [[null,m.hash],[SMALL_JSON,null],[SMALL_JSON,m.hash.toUpperCase()],[SMALL_JSON,'abc'],[42,{}]] as [unknown,unknown][]){
    const r=await mod.checkCityHash(json,hash);
    assert.equal(r.ok,false);
  }
  await assert.rejects(mod.cityManifest('{"not":"an asset"}'),/city asset/);
});
