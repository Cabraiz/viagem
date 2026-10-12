#!/usr/bin/env node
/**
 * Imports the LAYOUT of a Warcraft III map into our city asset (D-026: layout only, no names/art/text).
 * Usage: node scripts/import-w3x.mjs <map.w3x> [out.json] [--preview=<dir>]
 * The .w3x stays outside the repository; only the derived JSON and its manifest are committed.
 * Steps are separate: parse (w3x/formats) -> layout (w3x/layout) -> CityAssetData -> encodeCityAsset (D-027 schema owner).
 * Output is deterministic: the same input yields the same bytes.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {parseW3x} from './w3x/formats.mjs';
import {buildCityAsset,decodeAssetGrids,isWalkableClass,makeTransform,encodePng,renderCityPreview,CLASS,K} from './w3x/layout.mjs';
import {encodeCityAsset,cityManifest} from '../src/maps/city-asset.ts';

const MAX_GZIP_BYTES=600*1024;
export const SOURCE_NOTE='layout adaptado de um mapa de fã (D-026)';

/** Converts the layout step's output into the D-027 encoder input (walkable/water bitsets as 0/1, heights in u). */
export function toCityAssetData(parsed,built,sourceSha256){
  const {pathing}=decodeAssetGrids(built);
  // Heights straight from the source corners (row 0 = north), so they are quantized once, by the encoder.
  const T=parsed.terrain,heights=new Float32Array(T.w*T.h);
  for(let r=0;r<T.h;r++)for(let c=0;c<T.w;c++)heights[r*T.w+c]=T.height[(T.h-1-r)*T.w+c]*K;
  const walkable=new Uint8Array(pathing.length),water=new Uint8Array(pathing.length);
  for(let i=0;i<pathing.length;i++){
    walkable[i]=isWalkableClass(pathing[i])?1:0;
    water[i]=pathing[i]===CLASS.SHALLOW||pathing[i]===CLASS.DEEP?1:0;
  }
  return {
    id:built.id,version:built.version,name:built.name,
    cells:built.cells,unitsPerCell:built.units.perCell,playable:built.playable,
    walkable,water,heights,
    points:built.points,blocks:built.blocks,props:built.props,loot:built.loot,
    source:{sha256:sourceSha256,note:SOURCE_NOTE},
  };
}

export async function importW3x(buffer){
  const parsed=parseW3x(buffer);
  const built=buildCityAsset(parsed);
  const data=toCityAssetData(parsed,built,createHash('sha256').update(buffer).digest('hex'));
  const json=encodeCityAsset(data);
  const manifest=await cityManifest(json);
  return {parsed,built,data,json,manifest,manifestJson:JSON.stringify(manifest,null,2)+'\n'};
}

/** foo.json -> foo.manifest.json; any other name gets the suffix appended, never overwriting the asset. */
export const manifestPath=(out)=>/\.json$/i.test(out)?out.replace(/\.json$/i,'.manifest.json'):out+'.manifest.json';

const KEY_RECTS={rect19:[230,60,50],rect12:[230,60,50],rect15:[230,60,50],rect13:[230,60,50],rect10:[50,100,230]};

/** Conference image: snow-shaded heightmap, blocked samples dimmed, every source region outlined (spawns red, plaza blue), key points. */
export function renderHeightRegions(parsed,data,scale=1){
  const T=makeTransform(parsed.terrain),{w:HW}={w:193};
  const SW=768,W=SW*scale,H=SW*scale,rgba=new Uint8Array(W*H*4);
  let min=Infinity,max=-Infinity;for(const v of data.heights){if(v<min)min=v;if(v>max)max=v;}
  const put=(x,y,c,a=1)=>{if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;for(let k=0;k<3;k++)rgba[o+k]=Math.round(rgba[o+k]*(1-a)+c[k]*a);rgba[o+3]=255;};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const sx=Math.floor(x/scale),sy=Math.floor(y/scale);
    const t=(data.heights[Math.min(192,Math.round(sy/4))*HW+Math.min(192,Math.round(sx/4))]-min)/Math.max(1e-6,max-min);
    // Snow palette: low = blue-grey, high = white.
    put(x,y,[Math.round(120+135*t),Math.round(140+115*t),Math.round(170+85*t)]);
    if(data.water[sy*SW+sx])put(x,y,[90,150,220],.7);
    else if(!data.walkable[sy*SW+sx])put(x,y,[40,40,52],.55);
  }
  const px=(u)=>Math.round(u/0.22*scale);
  for(const [name,[x0,y0,x1,y1]] of Object.entries(parsed.rects)){
    const c=KEY_RECTS[name]??[255,200,0],a=KEY_RECTS[name]?1:.8;
    const L=px(T.toX(x0)),R=px(T.toX(x1)),Tp=px(T.toY(y1)),B=px(T.toY(y0));
    for(let t=0;t<2;t++){for(let x=L;x<=R;x++){put(x,Tp+t,c,a);put(x,B-t,c,a);}for(let y=Tp;y<=B;y++){put(L+t,y,c,a);put(R-t,y,c,a);}}
  }
  const dot=(p,c,r)=>{const cx=px(p.x),cy=px(p.y);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(dx*dx+dy*dy<=r*r)put(cx+dx,cy+dy,c);};
  for(const p of Object.values(data.points.bocas))dot(p,[40,170,90],4);
  for(const [k,p] of Object.entries(data.points))if(k!=='bocas')dot(p,k==='inicio'?[20,160,60]:k==='praca'?[200,40,200]:[230,60,50],6);
  return encodePng(W,H,rgba);
}

const isMain=!!process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(isMain){
  const args=process.argv.slice(2),flags=args.filter(a=>a.startsWith('--')),files=args.filter(a=>!a.startsWith('--'));
  const [input,out='public/maps/cidade-nevada.json']=files;
  if(!input){console.error('Uso: node scripts/import-w3x.mjs <mapa.w3x> [saida.json] [--preview=pasta]');process.exit(2);}
  const started=performance.now();
  const {parsed,built,data,json,manifest,manifestJson}=await importW3x(readFileSync(input));
  const gz=gzipSync(Buffer.from(json),{level:9}).length;
  if(gz>MAX_GZIP_BYTES)throw new Error(`Asset too large: ${gz} bytes gzip > ${MAX_GZIP_BYTES}`);
  mkdirSync(dirname(out),{recursive:true});
  writeFileSync(out,json);
  writeFileSync(manifestPath(out),manifestJson);
  const preview=flags.find(f=>f.startsWith('--preview='))?.slice(10);
  if(preview){
    mkdirSync(preview,{recursive:true});
    writeFileSync(join(preview,'cidade-alturas-regioes.png'),renderHeightRegions(parsed,data));
    const png=(img)=>encodePng(img.width,img.height,img.rgba);
    writeFileSync(join(preview,'cidade-layout.png'),png(renderCityPreview(built,{scale:2})));
    writeFileSync(join(preview,'cidade-praca.png'),png(renderCityPreview(built,{scale:8,crop:{x:66,y:70,w:38,h:30}})));
  }
  console.log(JSON.stringify({out,bytes:manifest.bytes,gzip:gz,hash:manifest.hash,blocks:data.blocks.length,props:data.props.length,loot:data.loot.length,ms:Math.round(performance.now()-started),preview:preview??null}));
}
