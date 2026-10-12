#!/usr/bin/env node
/**
 * N27 · art the game downloads: lossy WebP copies of the approved sheets (trees and class sprites), next to them under
 * public/art/lite/. The approved files (lossless WebP) are never touched; the game loads the copies.
 *
 *   node scripts/art-lite.mjs            make or refresh the copies whose source changed (the manifest keeps hashes)
 *   node scripts/art-lite.mjs --check    exit 1 when a source has no copy or changed since its copy was made
 *   node scripts/art-lite.mjs --all      remake every copy
 *
 * Quality, measured per file and kept in scripts/art-lite.json:
 *   - `psnr`: the whole sheet, premultiplied colour and alpha (what the GPU blends), at full size;
 *   - `shownPsnr`: at the size a phone draws it (SHOWN_SCALE of the sheet: a 210-world-px tree from a 340 px drawing
 *     at the follow camera's zoom, D-019; heroes the same), both scaled the same way. Above 40 dB nobody tells them apart.
 * The tests (tests/art-lite.test.ts) fail when a tree or a class has no copy, or its copy is older than its source.
 */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const ROOT=new URL('..',import.meta.url).pathname;
const MANIFEST=join(ROOT,'scripts/art-lite.json');
/** libwebp settings: lossy colour at 90, exact alpha (cut-outs keep their edge); effort 6 saves ~2% for 3× the time. */
export const WEBP={quality:90,alphaQuality:100,effort:4,smartSubsample:true};
/** What a phone draws of a sheet (see the header): 0.35 of its pixels on each side. */
const SHOWN_SCALE=.35;
const KINDS=['trees','sprites'];

const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function rgba(input,w,h){
  let img=sharp(input).ensureAlpha();
  if(w)img=img.resize(w,h,{kernel:'linear',fit:'fill'});
  return (await img.raw().toBuffer({resolveWithObject:true})).data;
}
/** PSNR over premultiplied RGB and alpha. */
function psnr(a,b){
  let se=0,n=0;
  for(let i=0;i<a.length;i+=4){
    const x=a[i+3]/255,y=b[i+3]/255;
    for(let k=0;k<3;k++){const d=a[i+k]*x-b[i+k]*y;se+=d*d;}
    const da=a[i+3]-b[i+3];se+=da*da;n+=4;
  }
  return se===0?99:Math.round(10*Math.log10(255*255/(se/n))*10)/10;
}

const args=new Set(process.argv.slice(2));
const manifest=existsSync(MANIFEST)?JSON.parse(readFileSync(MANIFEST,'utf8')):{webp:WEBP,files:{}};
const stale=[];
for(const kind of KINDS){
  const dir=join(ROOT,'public/art',kind);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.webp')).sort()){
    const source=readFileSync(join(dir,name)),key=`${kind}/${name}`,entry=manifest.files[key];
    const out=join(ROOT,'public/art/lite',kind,name);
    if(!args.has('--all')&&entry?.source===sha(source)&&existsSync(out)&&sha(readFileSync(out))===entry.lite&&JSON.stringify(manifest.webp)===JSON.stringify(WEBP))continue;
    stale.push(key);
    if(args.has('--check'))continue;
    const lite=await sharp(source).webp(WEBP).toBuffer();
    const meta=await sharp(source).metadata(),w=Math.round(meta.width*SHOWN_SCALE),h=Math.round(meta.height*SHOWN_SCALE);
    mkdirSync(join(ROOT,'public/art/lite',kind),{recursive:true});writeFileSync(out,lite);
    manifest.files[key]={source:sha(source),lite:sha(lite),bytes:source.length,liteBytes:lite.length,
      psnr:psnr(await rgba(source),await rgba(lite)),shownPsnr:psnr(await rgba(source,w,h),await rgba(lite,w,h))};
    const e=manifest.files[key];
    console.error(key,`${Math.round(e.bytes/1024)} → ${Math.round(e.liteBytes/1024)} KB`,`psnr ${e.psnr} dB, shown ${e.shownPsnr} dB`);
    save();
  }
}
function save(){
  manifest.webp=WEBP;
  const files=Object.values(manifest.files),sum=k=>files.reduce((a,f)=>a+f[k],0);
  manifest.summary={files:files.length,bytes:sum('bytes'),liteBytes:sum('liteBytes'),
    worstPsnr:Math.min(...files.map(f=>f.psnr)),worstShownPsnr:Math.min(...files.map(f=>f.shownPsnr))};
  manifest.files=Object.fromEntries(Object.entries(manifest.files).sort(([a],[b])=>a.localeCompare(b)));
  writeFileSync(MANIFEST,JSON.stringify(manifest,null,1)+'\n');
}
if(args.has('--check')){
  if(stale.length){console.error('art-lite: copies missing or older than their source:',stale.join(', '));process.exit(1);}
  console.error('art-lite: every copy matches its source');process.exit(0);
}
save();
console.error('art-lite:',stale.length,'made;',JSON.stringify(manifest.summary));
