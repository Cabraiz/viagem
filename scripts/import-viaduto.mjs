/**
 * The viaduct's pieces (NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 4): the Codex sheets of the Brazilian viaduct the
 * user asked for (round 2, option D: toll plaza, bus stop, stop sign, crosswalk; potholes, double yellow line, speed camera,
 * green gantry). Each source is one or more rows of 4 views on flat green (#00FF00), the views turned 90° between
 * columns like the kombi's sheet (city views 0..3). Per view: keyed (green out, spill off the rim), cropped, scaled so
 * its drawn height is the piece's world height (HEIGHT u × HEIGHT_PX × ART_SCALE art px, the rule of the scenery
 * importer for loose objects), centred, its lowest point PROP_BOTTOM px above the frame's bottom (the anchor).
 * The faces (round 3, option C picked: more snow): t2-asfalto (top-down road, tiling along it) and t2-concreto (tiling
 * both ways), packed side by side into public/art/city/viaduto/faces.webp for the layer's meshes.
 * Written as group `cenario` pieces (public/art/city/decor/<id>/sheet.webp + manifest); then
 * `node scripts/art-lite.mjs --kinds city` makes the lite copies.
 *   node scripts/import-viaduto.mjs [--src <folder>]
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {keyGreen} from './import-rochas-grandes.mjs';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
/** render/city: HEIGHT_PX game px per world unit up, ART_SCALE art px per game px; props' feet PROP_BOTTOM px up. */
const PX_PER_UNIT=42*2,PROP_BOTTOM=8,PAD=4;
/** The faces' atlas regions (px): the road tile and the concrete tile, side by side (viaduct.ts FACES_ROAD/CONCRETE). */
export const FACES_ROAD=[512,768],FACES_CONCRETE=[512,512];

/**
 * The pieces: source file, its row (several pieces share the signs' sheet), world height (u, hero ≈ 2.3) and footprint.
 * A car is ~1.6 m tall next to a ~1.75 m hero; the gantry spans the deck (6 u) at ~5.5 m.
 */
export const PIECES=[
  {id:'carro-batido-1',src:'p-batido-a.png',row:0,rows:1,height:2.3,footprint:[2,1]},
  {id:'carro-batido-2',src:'p-batido-b.png',row:0,rows:1,height:2.5,footprint:[2,1]},
  {id:'pedagio',src:'p-pedagio.png',row:0,rows:1,height:4.4,footprint:[3,2]},
  {id:'ponto-onibus',src:'p-ponto-onibus.png',row:0,rows:1,height:3.3,footprint:[2,1]},
  {id:'portico-placa',src:'p-portico.png',row:0,rows:1,height:7.2,footprint:[4,1]},
  {id:'placa-pare',src:'p-placas.png',row:0,rows:3,height:3.1,footprint:[1,1]},
  {id:'placa-60',src:'p-placas.png',row:1,rows:3,height:3.1,footprint:[1,1]},
  {id:'radar-lombada',src:'p-placas.png',row:2,rows:3,height:3.8,footprint:[1,1]},
];

/** The 4 views of row `row` of a keyed sheet: the 4 widest runs of opaque columns, each with its opaque box. */
export function viewBoxes(data,width,height,row,rows,min=60){
  const rh=Math.floor(height/rows),y0=row*rh,occ=new Array(width).fill(0);
  for(let y=y0;y<y0+rh;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>min)occ[x]++;
  const runs=[];let st=-1;
  for(let x=0;x<=width;x++){const on=x<width&&occ[x]>2;if(on&&st<0)st=x;if(!on&&st>=0){runs.push([st,x-1]);st=-1;}}
  const merged=[];for(const r of runs){if(merged.length&&r[0]-merged[merged.length-1][1]<14)merged[merged.length-1][1]=r[1];else merged.push([...r]);}
  const big=merged.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0])).slice(0,4).sort((a,b)=>a[0]-b[0]);
  if(big.length<4)throw new Error(`linha ${row}: ${big.length} vistas`);
  return big.map(([l,r])=>{
    let t=rh,b=-1;
    for(let y=y0;y<y0+rh;y++)for(let x=l;x<=r;x++)if(data[(y*width+x)*4+3]>min){if(y-y0<t)t=y-y0;if(y-y0>b)b=y-y0;}
    return {left:l,top:y0+t,width:r-l+1,height:b-t+1};
  });
}

async function main(){
  const require=createRequire(join(ROOT,'package.json')),sharp=require('sharp');
  const {GROUPS}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/spec.mjs')).href);
  const {writeIndex}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/convert.mjs')).href);
  const args=process.argv.slice(2),srcAt=args.indexOf('--src');
  const SRC=srcAt>=0?args[srcAt+1]:'D:/Gits/viagem-board/arte-entrada/cenario/decor/viaduto';
  const spec=GROUPS.cenario,dir=join(ROOT,spec.output),manifestFile=join(dir,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  const keyed=new Map();
  for(const piece of PIECES){
    if(!keyed.has(piece.src)){
      const s=await sharp(join(SRC,piece.src)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      keyed.set(piece.src,{data:keyGreen(Buffer.from(s.data)),width:s.info.width,height:s.info.height});
    }
    const {data,width,height}=keyed.get(piece.src),boxes=viewBoxes(data,width,height,piece.row,piece.rows);
    // One scale for the 4 views: the tallest view is the piece's world height.
    const scale=piece.height*PX_PER_UNIT/Math.max(...boxes.map(b=>b.height));
    const frames=[];
    for(const b of boxes){
      const w=Math.round(b.width*scale),h=Math.round(b.height*scale);
      frames.push({w,h,png:await sharp(data,{raw:{width,height,channels:4}}).extract(b).resize(w,h,{fit:'fill',kernel:'lanczos3'}).png().toBuffer()});
    }
    const fw=2*Math.ceil((Math.max(...frames.map(f=>f.w))+2*PAD)/2),fh=Math.max(...frames.map(f=>f.h))+PAD+PROP_BOTTOM;
    const sheet=await sharp({create:{width:fw*4,height:fh,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(frames.map((f,i)=>({input:f.png,left:i*fw+Math.round((fw-f.w)/2),top:fh-PROP_BOTTOM-f.h}))).webp({quality:90,alphaQuality:100,effort:6}).toBuffer();
    mkdirSync(join(dir,piece.id),{recursive:true});
    const file=`${piece.id}/sheet.webp`;writeFileSync(join(dir,file),sheet);
    const hash=sha256(sheet),anchor=[.5,+((fh-PROP_BOTTOM)/fh).toFixed(6)];
    manifest.pieces[piece.id]={kind:'decor',files:{sheet:{file,cell:[fw,fh],views:4,rows:['1'],anchor,
      pages:[{file,columns:4,rows:1,firstFrame:0,frameCount:4,sha256:hash}],sha256:hash}},
      sha256:sha256(`sheet ${hash}`),
      meta:{cell:[fw,fh],footprint:piece.footprint,origem:`arte-entrada/cenario/decor/viaduto/${piece.src} (Codex, E6, card mapa-175-com-viaduto)`}};
    console.error(`${piece.id}: ${fw}×${fh}, ×${scale.toFixed(3)}, ${Math.round(sheet.length/1024)} KB`);
  }
  // The faces' atlas (render/city/viaduct.ts FACES_*): the deck's road (top-down, the road along v, tiling along it) on
  // the left, the concrete (sides, barriers, pillars; tiling both ways) on the right.
  const [rw,rh]=FACES_ROAD,[cw,ch]=FACES_CONCRETE;
  const road=await sharp(join(SRC,'t2-asfalto.png')).resize(rw,rh,{fit:'fill',kernel:'lanczos3'}).png().toBuffer();
  const concrete=await sharp(join(SRC,'t2-concreto.png')).resize(cw,ch,{fit:'fill',kernel:'lanczos3'}).png().toBuffer();
  const faces=await sharp({create:{width:rw+cw,height:Math.max(rh,ch),channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite([{input:road,left:0,top:0},{input:concrete,left:rw,top:0}]).webp({quality:88,effort:6}).toBuffer();
  mkdirSync(join(ROOT,'public/art/city/viaduto'),{recursive:true});
  writeFileSync(join(ROOT,'public/art/city/viaduto/faces.webp'),faces);
  console.error(`viaduto/faces.webp: ${rw+cw}×${Math.max(rh,ch)}, ${Math.round(faces.length/1024)} KB`);
  manifest.pieces=Object.fromEntries(Object.keys(manifest.pieces).sort().map(k=>[k,manifest.pieces[k]]));
  writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
  await writeIndex({cenario:spec},{outRoot:ROOT});
  console.error('manifest e índice gravados; agora: node scripts/art-lite.mjs --kinds city');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
