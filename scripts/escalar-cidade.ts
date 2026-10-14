// NEW-20261013-ORQ-cidade-escala-1-7 (opção D): re-exports the Cidade Nevada asset from the current JSON at the map
// scale CITY_MAP_SCALE (rules/scale.ts), with no .w3x: every horizontal length (unitsPerCell, size, playable, points,
// blocks, loot, prop positions) and the terrain heights × the scale; the grids keep their cells (192², 768² samples,
// only their step grows); props keep their radius (drawn at today's absolute size, the poste ~1.9× the hero).
// The result is a new asset version with a new hash (manifest), checked by decodeCityAsset before it is written.
//   node --experimental-strip-types scripts/escalar-cidade.ts [--from v1.json] [--check]
// --from: the version-1 JSON (default public/maps/cidade-nevada.json when it is still version 1); --check: only
// verify that the JSON in public/ is the scaled version 1 (byte for byte), write nothing.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decodeCityAsset,HEIGHTS_ENCODING,SAMPLES_PER_CELL,decodeBase64,encodeBase64} from '../src/maps/city-asset.ts';
import {CITY_MAP_SCALE} from '../src/rules/scale.ts';

const root=(path:string)=>fileURLToPath(new URL(`../${path}`,import.meta.url));
const JSON_PATH=root('public/maps/cidade-nevada.json'),MANIFEST_PATH=root('public/maps/cidade-nevada.manifest.json');
const args=process.argv.slice(2),flag=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const r3=(v:number)=>Math.round(v*1000)/1000;

type Json=Record<string,any>;
/** The version-1 asset scaled by `k` (a new version: `version + 1`). */
export function scaleCity(v1:Json,k:number):Json{
  if(v1.version!==1)throw new Error(`expected the version-1 asset, got version ${v1.version}`);
  const unit=r3(v1.unitsPerCell*k),from=v1.unitsPerCell/SAMPLES_PER_CELL,to=unit/SAMPLES_PER_CELL;
  const s=(v:number)=>r3(v*k);
  // A point keeps its walkability sample: rounding to 3 decimals may push one sitting on a sample's edge into the next.
  const keep=(v:number)=>{const want=Math.floor(v/from+1e-9);let o=s(v);
    while(Math.floor(o/to+1e-9)>want)o=r3(o-.001);
    while(Math.floor(o/to+1e-9)<want)o=r3(o+.001);
    return o;};
  const pt=(p:{x:number;y:number})=>({...p,x:keep(p.x),y:keep(p.y)});
  const grid=(g:Json,step:number)=>({...g,step:r3(step)});
  // Heights: i16 little-endian centi-units, × k (a hill keeps its slope next to buildings drawn ×k).
  const h=v1.heights,count=h.w*h.h,raw=decodeBase64(h.data,count*2);
  if(!raw)throw new Error('heights: bad base64');
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),out=new Uint8Array(count*2),ov=new DataView(out.buffer);
  for(let i=0;i<count;i++){
    const v=Math.round(view.getInt16(i*2,true)*k);
    if(v>32767||v<-32768)throw new Error(`height ${v/100} out of the i16 range`);
    ov.setInt16(i*2,v,true);
  }
  const points:Json={};
  // A point is {x,y}; a group (bocas: {N,S,L,O}) holds points by name.
  const anyPoint=(v:Json):Json=>typeof v.x==='number'&&typeof v.y==='number'?pt(v as {x:number;y:number}):Array.isArray(v)?v.map(anyPoint):Object.fromEntries(Object.entries(v).map(([k2,v2])=>[k2,anyPoint(v2 as Json)]));
  for(const [key,value] of Object.entries(v1.points as Json))points[key]=anyPoint(value);
  return {
    ...v1,
    version:v1.version+1,
    unitsPerCell:unit,
    size:{w:r3(v1.cells.w*unit),h:r3(v1.cells.h*unit)},
    playable:{x:s(v1.playable.x),y:s(v1.playable.y),w:s(v1.playable.w),h:s(v1.playable.h)},
    walkable:grid(v1.walkable,unit/SAMPLES_PER_CELL),
    water:grid(v1.water,unit/SAMPLES_PER_CELL),
    heights:{...grid(h,unit),encoding:HEIGHTS_ENCODING,data:encodeBase64(out)},
    points,
    blocks:(v1.blocks as Json[]).map(b=>({...b,bbox:b.bbox.map(s),rects:b.rects.map((r:number[])=>r.map(s))})),
    props:(v1.props as Json[]).map(pt),
    loot:(v1.loot as Json[]).map(pt),
    source:{...v1.source,note:`${v1.source?.note??''}; escala ${k}× (NEW-20261013-ORQ-cidade-escala-1-7, scripts/escalar-cidade.ts)`.replace(/^; /,'')},
  };
}

if(import.meta.url===`file:///${process.argv[1]?.replace(/\\/g,'/').replace(/^\//,'')}`||process.argv[1]?.endsWith('escalar-cidade.ts')){
  const from=flag('--from')??JSON_PATH;
  const v1=JSON.parse(readFileSync(from,'utf8'));
  const text=JSON.stringify(scaleCity(v1,CITY_MAP_SCALE));
  const decoded=decodeCityAsset(text);
  if(!decoded.ok)throw new Error(`the scaled asset does not decode: ${decoded.error}`);
  const hash=createHash('sha256').update(text).digest('hex'),bytes=Buffer.byteLength(text);
  if(args.includes('--check')){
    const now=readFileSync(JSON_PATH,'utf8');
    if(now!==text){console.error('public/maps/cidade-nevada.json is not the scaled version 1');process.exit(1);}
    console.log(`ok: version ${decoded.asset.version}, ${hash}`);
  }else{
    writeFileSync(JSON_PATH,text);
    writeFileSync(MANIFEST_PATH,JSON.stringify({id:v1.id,version:v1.version+1,hash,bytes},null,2)+'\n');
    console.log(`written: version ${v1.version+1}, unitsPerCell ${decoded.asset.unitsPerCell}, size ${JSON.stringify(decoded.asset.size)}, ${bytes} bytes, ${hash}`);
  }
}
