/**
 * Rochas grandes (NEW-20261022-ORQ-rochas-grandes): the Codex pieces that draw a thick cliff as a few big massifs
 * instead of rows of 1-cell walls (maps/city-decor.ts bigCliffRocks). Two looks were generated (`a` columnar granite,
 * `b` fused cold boulders); the user picked `b` (22/10), the only one imported (LOOK):
 *   penhasco3-bloco-1|2   2×2 massif     frames: the piece, mirrored, the piece, mirrored
 *   penhasco3-reto        2×1 straight   drawn lower-left → upper-right (view 1); view 0 is it mirrored
 * Each source is 1536×1024 on flat green (#00FF00): keyed (green out, spill off the rim), cropped to the piece, scaled so
 * its width is the footprint's projected diamond (FIT × (a+b)·ART_CELL·TILE_X·ART_SCALE art px: neighbours overlap a
 * little, no gap), the lowest point PAD px above the frame's bottom (the anchor: the footprint's front corner).
 * The group manifest and the index are rewritten; then `node scripts/art-lite.mjs --kinds city` makes the lite copies.
 *   node scripts/import-rochas-grandes.mjs [--src <folder>]
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

/** render/city: ART_CELL 0.88 u, TILE_X 42 px per u, ART_SCALE 2 art px per game px. */
const DIAMOND_PX_PER_CELL=.88*42*2;
/** Piece width over its footprint's diamond, and the rim (px) kept around it in the frame. */
export const FIT=1.06,PAD=8;
/** The look imported: the sources are `<LOOK>-<piece>.png`. */
export const LOOK='b';
export const PIECES=[
  {name:'bloco-1',footprint:[2,2],mirror:'square'},
  {name:'bloco-2',footprint:[2,2],mirror:'square'},
  {name:'reto',footprint:[2,1],mirror:'diagonal'},
];
export const rockId=name=>`penhasco3-${name}`;

/** Green screen → alpha, in place (RGBA): how much greener than red/blue a pixel is; the spill on the rim is cut to grey. */
export function keyGreen(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],m=Math.max(r,b),excess=g-m;
    const a=excess>=70?0:excess<=20?255:Math.round(255*(70-excess)/50);
    data[i+3]=Math.min(data[i+3],a);
    if(excess>0)data[i+1]=m+Math.round(excess*.25);
  }
  return data;
}
/** Bounding box of the pixels with alpha over `min`, and the mean x of the lowest rows (the front corner). */
export function boundsOf(data,width,height,min=24){
  let x0=width,y0=height,x1=-1,y1=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>min){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  if(x1<0)throw new Error('peça vazia depois da chave verde');
  let sx=0,n=0;
  for(let y=Math.max(y0,y1-6);y<=y1;y++)for(let x=x0;x<=x1;x++)if(data[(y*width+x)*4+3]>min){sx+=x;n++;}
  return {x0,y0,x1,y1,tip:sx/n};
}

async function main(){
  const require=createRequire(join(ROOT,'package.json')),sharp=require('sharp');
  const {GROUPS}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/spec.mjs')).href);
  const {writeIndex}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/convert.mjs')).href);
  const args=process.argv.slice(2),srcAt=args.indexOf('--src');
  const SRC=srcAt>=0?args[srcAt+1]:'D:/Gits/viagem-board/arte-entrada/cenario/decor/rochas-grandes';
  const spec=GROUPS.cenario,dir=join(ROOT,spec.output),manifestFile=join(dir,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  for(const piece of PIECES){
    const id=rockId(piece.name),look=LOOK;
    const src=await sharp(join(SRC,`${look}-${piece.name}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const {width,height}=src.info,data=keyGreen(Buffer.from(src.data));
    const box=boundsOf(data,width,height);
    // Square pieces centre on the front corner (originX 0.5); the 2×1 on its box (the renderer offsets the corner).
    const cx=piece.mirror==='square'?box.tip:(box.x0+box.x1)/2,half=Math.max(cx-box.x0,box.x1-cx);
    const left=Math.max(0,Math.floor(cx-half)),right=Math.min(width,Math.ceil(cx+half)+1);
    const cut=await sharp(data,{raw:{width,height,channels:4}})
      .extract({left,top:box.y0,width:right-left,height:box.y1-box.y0+1}).png().toBuffer();
    const target=FIT*(piece.footprint[0]+piece.footprint[1])*DIAMOND_PX_PER_CELL,scale=target/(right-left);
    const pw=Math.round((right-left)*scale),ph=Math.round((box.y1-box.y0+1)*scale);
    const fw=pw+2*PAD,fh=ph+2*PAD;
    const frame=await sharp(cut).resize(pw,ph,{fit:'fill',kernel:'lanczos3'})
      .extend({top:PAD,bottom:PAD,left:PAD,right:PAD,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    const flopped=await sharp(frame).flop().png().toBuffer();
    // View 0 shows the 2×1 running upper-left → lower-right (frameExtents: a along view x), the source's mirror.
    const frames=piece.mirror==='square'?[frame,flopped,frame,flopped]:[flopped,frame,flopped,frame];
    const sheet=await sharp({create:{width:fw*4,height:fh,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(frames.map((input,i)=>({input,left:i*fw,top:0}))).webp({lossless:true,effort:6}).toBuffer();
    mkdirSync(join(dir,id),{recursive:true});
    const file=`${id}/sheet.webp`;writeFileSync(join(dir,file),sheet);
    const hash=sha256(sheet),anchor=[.5,+((fh-PAD)/fh).toFixed(6)];
    manifest.pieces[id]={kind:'decor',files:{sheet:{file,cell:[fw,fh],views:4,rows:['1'],anchor,
      pages:[{file,columns:4,rows:1,firstFrame:0,frameCount:4,sha256:hash}],sha256:hash}},
      sha256:sha256(`sheet ${hash}`),
      meta:{cell:[fw,fh],footprint:piece.footprint,origem:`arte-entrada/cenario/decor/rochas-grandes/${look}-${piece.name}.png (Codex, E3, card rochas-grandes)`}};
    console.error(`${id}: ${fw}×${fh}, ${Math.round(sheet.length/1024)} KB`);
  }
  // The trial ids of both looks (penhasco3-a-*, penhasco3-b-*) are gone.
  for(const id of Object.keys(manifest.pieces))if(/^penhasco3-[ab]-/.test(id))delete manifest.pieces[id];
  manifest.pieces=Object.fromEntries(Object.keys(manifest.pieces).sort().map(k=>[k,manifest.pieces[k]]));
  writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
  await writeIndex({cenario:spec},{outRoot:ROOT});
  console.error('manifest e índice gravados; agora: node scripts/art-lite.mjs --kinds city');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
