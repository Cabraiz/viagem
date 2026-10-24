/**
 * The viaduct's pieces (NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 4): the Codex sheets of the Brazilian viaduct the
 * user asked for (round 2, option D: toll plaza, bus stop, stop sign, crosswalk; potholes, double yellow line, speed camera,
 * green gantry). Each source is one or more rows of 4 views on flat green (#00FF00), the views turned 90° between
 * columns like the kombi's sheet (city views 0..3). Per view: keyed (green out, spill off the rim), cropped, scaled so
 * its drawn height is the piece's world height (HEIGHT u × HEIGHT_PX × ART_SCALE art px, the rule of the scenery
 * importer for loose objects), centred, its lowest point PROP_BOTTOM px above the frame's bottom (the anchor).
 * The faces (round 3, option C picked: more snow): t2-asfalto (top-down road, tiling along it); etapa 5, option B (old
 * Brazilian concrete): tb-parede (the ramp's wall, tiling both ways), tb-mureta and tb-viga (the barrier blocks and the
 * edge beam, bands on green: cropped and made seamless along) and tb-pilar (a pillar's face on green), packed into
 * public/art/city/viaduto/faces.webp for the layer's meshes (viaduct.ts FACES_*).
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
/** The faces' atlas and its regions (px, [x, y, w, h]: viaduct.ts FACES_*). */
export const FACES_SIZE=[1152,768],FACES_ROAD=[0,0,512,768],FACES_CONCRETE=[512,0,512,512],FACES_BARRIER=[512,512,512,128],
  FACES_BEAM=[512,640,512,128],FACES_PILLAR=[1024,0,128,512];
/** Texels a band's crossfade takes at its ends (of its width), so it tiles along. */
const SEAM=.06;

/** The box of a source's art on flat green: the rows more than 15 % not green and, in them, the columns more than half, `inset` px inside. */
async function artBox(sharp,file,inset=3){
  const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true}),{width:w,height:h}=info;
  const art=i=>!(data[i+1]>170&&data[i]<130&&data[i+2]<130);
  const rows=[];for(let y=0;y<h;y++){let n=0;for(let x=0;x<w;x++)if(art((y*w+x)*3))n++;if(n>w*.15)rows.push(y);}
  const y0=rows[0],y1=rows.at(-1),cols=[];
  for(let x=0;x<w;x++){let n=0;for(let y=y0;y<=y1;y++)if(art((y*w+x)*3))n++;if(n>(y1-y0+1)/2)cols.push(x);}
  const x0=cols[0],x1=cols.at(-1);
  return {left:x0+inset,top:y0+inset,width:x1-x0+1-2*inset,height:y1-y0+1-2*inset};
}
/** RGB raw `w`×`h` crossfaded at its ends into a band `w − k` wide that tiles along (its last column meets its first). */
function seamless(data,w,h,k){
  const out=Buffer.alloc((w-k)*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w-k;x++)for(let c=0;c<3;c++){
    const v=x<k?data[(y*w+x)*3+c]*(x/k)+data[(y*w+w-k+x)*3+c]*(1-x/k):data[(y*w+x)*3+c];
    out[(y*(w-k)+x)*3+c]=Math.round(v);
  }
  return out;
}
/** A band on green (tb-mureta, tb-viga): its art cropped, made seamless along, resized to region `r`. */
async function band(sharp,file,r){
  const box=await artBox(sharp,file),{data,info}=await sharp(file).removeAlpha().extract(box).raw().toBuffer({resolveWithObject:true});
  const k=Math.round(info.width*SEAM);
  return sharp(seamless(data,info.width,info.height,k),{raw:{width:info.width-k,height:info.height,channels:3}})
    .resize(r[2],r[3],{fit:'fill',kernel:'lanczos3'}).png().toBuffer();
}

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
  // The faces' atlas (render/city/viaduct.ts FACES_*): the deck's road (top-down, the road along v, tiling along it),
  // the ramp's wall (tiling both ways), the barrier's and the beam's bands (tiling along), a pillar's face.
  const fill=(file,r)=>sharp(file).resize(r[2],r[3],{fit:'fill',kernel:'lanczos3'}).png().toBuffer();
  const pillarBox=await artBox(sharp,join(SRC,'tb-pilar.png'));
  const parts=[
    [await fill(join(SRC,'t2-asfalto.png'),FACES_ROAD),FACES_ROAD],
    [await fill(join(SRC,'tb-parede.png'),FACES_CONCRETE),FACES_CONCRETE],
    [await band(sharp,join(SRC,'tb-mureta.png'),FACES_BARRIER),FACES_BARRIER],
    [await band(sharp,join(SRC,'tb-viga.png'),FACES_BEAM),FACES_BEAM],
    [await sharp(join(SRC,'tb-pilar.png')).extract(pillarBox).resize(FACES_PILLAR[2],FACES_PILLAR[3],{fit:'fill',kernel:'lanczos3'}).png().toBuffer(),FACES_PILLAR],
  ];
  const faces=await sharp({create:{width:FACES_SIZE[0],height:FACES_SIZE[1],channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(parts.map(([input,r])=>({input,left:r[0],top:r[1]}))).webp({quality:88,effort:6}).toBuffer();
  mkdirSync(join(ROOT,'public/art/city/viaduto'),{recursive:true});
  writeFileSync(join(ROOT,'public/art/city/viaduto/faces.webp'),faces);
  console.error(`viaduto/faces.webp: ${FACES_SIZE.join('×')}, ${Math.round(faces.length/1024)} KB`);
  manifest.pieces=Object.fromEntries(Object.keys(manifest.pieces).sort().map(k=>[k,manifest.pieces[k]]));
  writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
  await writeIndex({cenario:spec},{outRoot:ROOT});
  console.error('manifest e índice gravados; agora: node scripts/art-lite.mjs --kinds city');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
