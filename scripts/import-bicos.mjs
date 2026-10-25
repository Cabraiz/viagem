// Bicos (card NEW-20261024-ORQ-bancos-viram-bicos, etapa 2): the pixel-art shop fronts that replace the ATMs.
// Input: a folder with bico-<slug>.png (already cut and reduced to the pixel grid, RGBA) and portas.json
// {"bico-<slug>":[x,y,w,h]}: the door as a parallelogram on the shop front (bottom-left corner x,y in the sprite's px,
// width w along the front, which climbs 1 px down per 2 px right, and height h).
// Output: public/art/city/bicos/<id>.webp (lossless, every pixel kept), the group manifest next to them and the group
// `bicos` in the client index public/art/manifest.json (the art-v2 importer keeps groups it has no spec for).
// usage: node scripts/import-bicos.mjs --input <folder> [--write]   (dry-run by default)
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const args=process.argv.slice(2),arg=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
const input=arg('--input'),write=args.includes('--write');
if(!input)throw new Error('usage: node scripts/import-bicos.mjs --input <folder> [--write]');
const OUTPUT='public/art/city/bicos',INDEX='public/art/manifest.json';
const portas=JSON.parse(await readFile(path.join(input,'portas.json'),'utf8'));
const ids=(await readdir(input)).filter(f=>/^bico-[a-z0-9-]+\.png$/.test(f)).map(f=>f.slice(0,-4)).sort();
const round=n=>Math.round(n*1e6)/1e6;

const pieces={};
if(write)await mkdir(OUTPUT,{recursive:true});
for(const id of ids){
  const porta=portas[id];
  if(!Array.isArray(porta)||porta.length!==4)throw new Error(`${id}: no door in portas.json`);
  const img=sharp(path.join(input,`${id}.png`)).ensureAlpha();
  const {width,height}=await img.metadata();
  const webp=await img.webp({lossless:true,effort:6}).toBuffer();
  const file=`${id}.webp`,sha256=createHash('sha256').update(webp).digest('hex');
  const [x,y,w]=porta;
  // The foot of the door's middle: where the hero walks in; the renderer puts it right behind the interaction ring.
  const anchor=[round((x+w/2)/width),round((y+w/4)/height)];
  pieces[id]={kind:'views',files:{sheet:{file,cell:[width,height],views:1,rows:['1'],anchor,
    pages:[{file,columns:1,rows:1,firstFrame:0,frameCount:1,sha256}],sha256}},meta:{pixelArt:true,porta}};
  if(write)await writeFile(path.join(OUTPUT,file),webp);
  console.log(`${id}: ${width}x${height}, ${webp.length} B, door ${porta.join(',')}`);
}
const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sha256').map(([k,x])=>[k,strip(x)])):v;
if(write){
  await writeFile(path.join(OUTPUT,'manifest.json'),`${JSON.stringify({version:2,group:'bicos',pieces},null,2)}\n`);
  const index=JSON.parse(await readFile(INDEX,'utf8'));
  index.groups.bicos={output:OUTPUT,pieces:strip(pieces)};
  index.groups=Object.fromEntries(Object.keys(index.groups).sort().map(g=>[g,index.groups[g]]));
  await writeFile(INDEX,`${JSON.stringify(index)}\n`);
  console.log(`wrote ${ids.length} pieces to ${OUTPUT} and the group bicos to ${INDEX}`);
}else console.log('dry-run: pass --write to write');
