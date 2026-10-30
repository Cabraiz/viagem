// NEW-20261016-ORQ-cenario-no-mapa: places the delivered scenery on Cidade Nevada (src/maps/city-decor.ts) and writes
// the asset with its `decor` list and the cells the new places with life take off the walkable grid, as a new version
// (manifest).
//   node --experimental-strip-types scripts/cenario-cidade.ts [--seed N] [--check]
//   node --experimental-strip-types scripts/cenario-cidade.ts --bocas   (only chaoLivreNasBocas, on the asset as it is)
// Re-running first undoes the previous run (undecorate), so the result depends only on the seed.
// --check: only verify that public/ holds exactly what this script writes, write nothing.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SAMPLES_PER_CELL,cityAssetToData,decodeCityAsset,encodeCityAsset,type CityAssetData,type CityDecor} from '../src/maps/city-asset.ts';
import {CityTerrain} from '../src/maps/city/terrain.ts';
import {CITY_SITE_CELL,buildPlanFor,footprint,railRect} from '../src/maps/build-sites.ts';
import {CITY_NEST_POOL,NEST_YARD_RADIUS} from '../src/maps/nests.ts';
import {LUGARES,OBJETOS_1,OBJETOS_2,placeCityDecor,type DecorKeepOut} from '../src/maps/city-decor.ts';
import {bocaChao,entradasEstreitas,estreitaBoca} from '../src/maps/city/entradas.ts';
import {semPropsNasBocas} from './becos-cidade.ts';

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
  // Nothing of the ground's scenery under or beside a viaduct (deck and ramp, a cell around): a lamp, a wire or a car
  // there stood through the deck on screen (the deck is drawn over the ground, the scenery by its own cells).
  const near=asset.viaducts.flatMap(v=>[v.deck,v.ramp.rect]).map(([c,r,w,h])=>[c-1,r-1,c+w+1,r+h+1] as const);
  data.decor=decor.filter(q=>!near.some(([c0,r0,c1,r1])=>q.c<c1&&q.c+q.w>c0&&q.r<r1&&q.r+q.h>r0));data.version=asset.version+1;
  return encodeCityAsset(data);
}

const CALCADA=new Set([...OBJETOS_1,...OBJETOS_2].map(id=>id.replace(/-\d$/,'')));
/** A sidewalk object (OBJETOS_1/OBJETOS_2 of city-decor.ts), by its placed id. */
export const isCalcada=(id:string)=>CALCADA.has(id.replace(/-\d$/,''));
/** How far (u, from its footprint) from an entrance a sidewalk object is checked. */
export const BOCA_DECOR_RAIO=6;
/**
 * NEW-20261029-ORQ-sem-tralha-nas-entradas (the user, 29/10: the mouths read narrower than they are): the sidewalk
 * objects in the middle of an entrance (maps/city/entradas.ts estreitaBoca) go; nothing takes their place and every other
 * piece stays. The objects block nothing, so the entrances are those of the grid as it is. Changes `data`, returns the
 * pieces taken.
 */
export function semDecorNasBocas(data:CityAssetData):CityDecor[]{
  const d=decodeCityAsset(encodeCityAsset(data));
  if(!d.ok)throw new Error(d.error);
  const a=d.asset,u=a.unitsPerCell,bocas=entradasEstreitas(a);
  const gap=(q:CityDecor,e:{x:number;y:number})=>Math.hypot(Math.max(q.c*u-e.x,0,e.x-(q.c+q.w)*u),Math.max(q.r*u-e.y,0,e.y-(q.r+q.h)*u));
  const inMouth=(q:CityDecor)=>isCalcada(q.id)&&bocas.some(e=>gap(q,e)<=BOCA_DECOR_RAIO&&estreitaBoca(a,e,q));
  const taken=(data.decor??[]).filter(inMouth);
  data.decor=(data.decor??[]).filter(q=>!inMouth(q));
  return taken;
}

/**
 * NEW-20261030-ORQ-bocas-sem-muro-pedra-decor (the user, 30/10: "obstáculos em entradas são horríveis", a poste, a
 * cacamba or a ruin standing in a mouth): no scenery on the ground of an entrance, of any width (maps/city/entradas.ts
 * bocaChao): every drawn piece with a cell there goes (postes and sidewalk objects: the walls and cliffs stand on solid
 * cells only), and the props there go as PROP_REMOVED (becos-cidade.ts semPropsNasBocas). Nothing there is solid, so
 * the walkable grid stays as it is. Changes `data`, returns what it took.
 */
export function chaoLivreNasBocas(data:CityAssetData):{decor:CityDecor[];props:number[]}{
  const d=decodeCityAsset(encodeCityAsset(data));
  if(!d.ok)throw new Error(d.error);
  const a=d.asset,W=a.cells.w,chao=bocaChao(a);
  const onIt=(q:CityDecor)=>{
    if(q.cover)return false;
    for(let r=q.r;r<q.r+q.h;r++)for(let c=q.c;c<q.c+q.w;c++)if(chao.has(r*W+c))return true;
    return false;
  };
  const decor=(data.decor??[]).filter(onIt);
  data.decor=(data.decor??[]).filter(q=>!onIt(q));
  return {decor,props:semPropsNasBocas(data)};
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

const isMain=process.argv[1]?.replace(/\\/g,'/').endsWith('scripts/cenario-cidade.ts');
if(isMain&&args.includes('--bocas')){
  const now=decodeCityAsset(readFileSync(JSON_PATH,'utf8'));
  if(!now.ok)throw new Error(now.error);
  const data=cityAssetToData(now.asset),taken=chaoLivreNasBocas(data);data.version++;
  const out=encodeCityAsset(data),hash=createHash('sha256').update(out).digest('hex'),bytes=Buffer.byteLength(out);
  writeFileSync(JSON_PATH,out);
  writeFileSync(MANIFEST_PATH,JSON.stringify({id:now.asset.id,version:data.version,hash,bytes},null,2)+'\n');
  const byKind=new Map<string,number>();
  for(const q of taken.decor){const k=q.id.replace(/-\d$/,'');byKind.set(k,(byKind.get(k)??0)+1);}
  console.log(`written: version ${data.version}, ${taken.decor.length} pieces and ${taken.props.length} props off the entrances, ${bytes} bytes, ${hash}`);
  console.log([...byKind].sort((x,y)=>y[1]-x[1]).map(([k,n])=>`${k} ${n}`).join(', '));
}else if(isMain){
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
