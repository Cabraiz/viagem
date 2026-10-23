// NEW-20261016-ORQ-cenario-no-mapa: places the delivered scenery on Cidade Nevada (src/maps/city-decor.ts) and writes
// the asset with its `decor` list and the cells the new places with life take off the walkable grid, as a new version
// (manifest).
//   node --experimental-strip-types scripts/cenario-cidade.ts [--seed N] [--check]
// Re-running first undoes the previous run (undecorate), so the result depends only on the seed.
// --check: only verify that public/ holds exactly what this script writes, write nothing.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SAMPLES_PER_CELL,cityAssetToData,decodeCityAsset,encodeCityAsset} from '../src/maps/city-asset.ts';
import {CityTerrain} from '../src/maps/city/terrain.ts';
import {CITY_SITE_CELL,buildPlanFor,footprint,railRect} from '../src/maps/build-sites.ts';
import {CITY_NEST_POOL,NEST_YARD_RADIUS} from '../src/maps/nests.ts';
import {LUGARES,placeCityDecor,type DecorKeepOut} from '../src/maps/city-decor.ts';

const root=(path:string)=>fileURLToPath(new URL(`../${path}`,import.meta.url));
const JSON_PATH=root('public/maps/cidade-nevada.json'),MANIFEST_PATH=root('public/maps/cidade-nevada.manifest.json');
const args=process.argv.slice(2),flag=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
export const DECOR_SEED=20261016;
/** Keep-out radii (u): the base and plaza, the start, the spawns and mouths, the nests' yards (+ margin), loot. */
export const KEEP={praca:22,inicio:10,spawn:8,boca:6,yard:3,loot:1.5,nestBlock:1.5} as const;

/** The asset with the scenery placed on `base` (an asset without decor). Returns the JSON text. */
export function decorate(baseText:string,seed=DECOR_SEED):string{
  const decoded=decodeCityAsset(baseText);
  if(!decoded.ok)throw new Error(decoded.error);
  const asset=decoded.asset;
  if(asset.decor.length)throw new Error('the base asset already has decor');
  const city=new CityTerrain(asset,'decor-base'),plan=buildPlanFor(city),p=asset.points;
  const keepOut:DecorKeepOut[]=[
    {...p.praca,r:KEEP.praca,all:true},{...p.inicio,r:KEEP.inicio},
    ...[p.spawnN,p.spawnS,p.spawnL,p.spawnO].map(q=>({...q,r:KEEP.spawn})),
    ...Object.values(p.bocas).map(q=>({...q,r:KEEP.boca})),
    ...asset.loot.map(q=>({...q,r:KEEP.loot})),
    ...CITY_NEST_POOL.filter(n=>n.kind==='terreno').map(n=>({x:n.x,y:n.y,r:NEST_YARD_RADIUS[n.maxSize]+KEEP.yard})),
  ];
  const keepOutRects=[
    ...plan.sites.map(s=>footprint(s,s.maxSize,CITY_SITE_CELL)),
    ...(plan.rail?[railRect(plan.rail,CITY_SITE_CELL)]:[]),
    // The viaducts (deck and ramp, a cell around): the street under the deck keeps its sidewalk, no place stands there.
    ...asset.viaducts.flatMap(v=>[v.deck,v.ramp.rect]).map(([c,r,w,h])=>({x:(c-1)*asset.unitsPerCell,y:(r-1)*asset.unitsPerCell,w:(w+2)*asset.unitsPerCell,h:(h+2)*asset.unitsPerCell})),

    // A nest in a building keeps its whole block (and a margin) for the nest's own art.
    ...CITY_NEST_POOL.filter(n=>n.block).map(n=>{
      const b=asset.blocks.find(x=>x.id===n.block)!.bbox,m=KEEP.nestBlock;
      return {x:b[0]-m,y:b[1]-m,w:b[2]+2*m,h:b[3]+2*m};
    }),
  ];
  const {decor,blocked}=placeCityDecor(asset,seed,{keepOut,keepOutRects});
  const data=cityAssetToData(asset),sw=asset.samples.w;
  for(const [c,r] of blocked)for(let j=0;j<SAMPLES_PER_CELL;j++)for(let i=0;i<SAMPLES_PER_CELL;i++)data.walkable[(r*SAMPLES_PER_CELL+j)*sw+c*SAMPLES_PER_CELL+i]=0;
  data.decor=decor;data.version=asset.version+1;
  return encodeCityAsset(data);
}

/**
 * The asset as it was before decorate: no decor, and the cells the open-ground places took walkable again (decorate
 * blocks no other cell: a place on a block stands on cells that were never walkable).
 */
export function undecorate(text:string):string{
  const decoded=decodeCityAsset(text);
  if(!decoded.ok)throw new Error(decoded.error);
  const asset=decoded.asset,data=cityAssetToData(asset),sw=asset.samples.w,u=asset.unitsPerCell;
  if(!asset.decor.length)return text;
  const inBlock=(c:number,r:number)=>asset.blocks.some(b=>b.rects.some(([x,y,w,h])=>c*u>=x-1e-3&&(c+1)*u<=x+w+1e-3&&r*u>=y-1e-3&&(r+1)*u<=y+h+1e-3));
  for(const d of asset.decor){
    if(!LUGARES.some(([l])=>d.id.startsWith(`${l}-`)))continue;
    for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)if(!inBlock(c,r))
      for(let j=0;j<SAMPLES_PER_CELL;j++)for(let i=0;i<SAMPLES_PER_CELL;i++)data.walkable[(r*SAMPLES_PER_CELL+j)*sw+c*SAMPLES_PER_CELL+i]=1;
  }
  delete data.decor;data.version=asset.version-1;
  return encodeCityAsset(data);
}

if(process.argv[1]?.replace(/\\/g,'/').endsWith('scripts/cenario-cidade.ts')){
  const now=readFileSync(JSON_PATH,'utf8');
  const out=decorate(undecorate(now),Number(flag('--seed')??DECOR_SEED));
  const decoded=decodeCityAsset(out);
  if(!decoded.ok)throw new Error(`the decorated asset does not decode: ${decoded.error}`);
  const hash=createHash('sha256').update(out).digest('hex'),bytes=Buffer.byteLength(out);
  if(args.includes('--check')){
    if(now!==out){console.error('public/maps/cidade-nevada.json is not what scripts/cenario-cidade.ts writes');process.exit(1);}
    console.log(`ok: version ${decoded.asset.version}, ${decoded.asset.decor.length} pieces, ${hash}`);
  }else{
    writeFileSync(JSON_PATH,out);
    writeFileSync(MANIFEST_PATH,JSON.stringify({id:decoded.asset.id,version:decoded.asset.version,hash,bytes},null,2)+'\n');
    const byKind=new Map<string,number>();
    for(const d of decoded.asset.decor){const k=d.id.replace(/-(\d|intacto|quebrado).*$/,'').replace(/-(reto|quina|t|ponta)$/,'');byKind.set(k,(byKind.get(k)??0)+1);}
    console.log(`written: version ${decoded.asset.version}, ${decoded.asset.decor.length} pieces, ${bytes} bytes, ${hash}`);
    console.log([...byKind].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(', '));
  }
}
