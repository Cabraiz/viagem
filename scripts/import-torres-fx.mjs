#!/usr/bin/env node
/**
 * NEW-20261029-ORQ-fx-torres-arte: the defenses' effects (render/towers/towers.ts) are paintings (ChatGPT via Codex),
 * not shapes drawn in code. This script packs one frame per effect cell of the towers' atlas (same name, same size as
 * the procedural bake, which stays as the loading fallback) into
 *   public/art/fx/torres-fx.webp  the frames, side by side;
 *   public/art/fx/torres-fx.json  {frames:{name:{x,y,w,h}}}.
 * Sources: the art v2 effects already in public/art/fx (flashes, explosions, radar pulse, searchlight cone, craters:
 * one frame picked from each strip) and one Codex sheet on chroma green, 3 × 3 slots: the tracers (yellow, white, red),
 * the heads (bullet, shell, rocket), the white puff, the smoke trail and the searchlight's pool of light.
 * Each piece is trimmed to what it painted, then fitted to its cell the way towers.ts anchors it: `contain` centred,
 * `bottom` (the explosions: the foot on the cell's ground line), `left` (the rifle flash: the muzzle at the left) or
 * `fill` (streaks, ring, cone, pool, craters: stretched to the cell). Already light for the phone (no lite copy).
 *
 *   node scripts/import-torres-fx.mjs folha-codex.png
 */
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const sharp=createRequire(import.meta.url)('sharp');
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const FX_DIR=join(ROOT,'public/art/fx');
const PAD=1;

/**
 * The frames: atlas name (towers.ts FX / crater frames), cell size, source (`sheet` slot [col,row] of the Codex sheet,
 * or an art v2 strip and which painted piece along it), fit, and `gray` (made white so towers.ts can tint it) or `foot`
 * (the bottom fit's ground line, px from the top).
 */
export const FRAMES=[
  {name:'fx:flash',w:64,h:64,strip:'clarao-artilharia',piece:1,fit:'contain'},
  {name:'fx:clarao-longo',w:96,h:40,strip:'clarao-metralhadora',piece:1,fit:'left'},
  {name:'fx:faisca',w:32,h:32,strip:'impacto-faisca',piece:1,fit:'contain'},
  {name:'fx:blast',w:104,h:60,strip:'explosao-p',piece:3,fit:'bottom',foot:54},
  {name:'fx:explosao-g',w:104,h:80,strip:'explosao-m',piece:3,fit:'bottom',foot:74},
  {name:'fx:anel',w:256,h:132,strip:'pulso-radar',piece:5,fit:'fill',gray:true},
  {name:'fx:cone',w:128,h:64,strip:'cone-holofote',piece:0,fit:'fill'},
  {name:'cratera',w:128,h:64,strip:'cratera-p',piece:0,fit:'fill'},
  {name:'cratera-g',w:512,h:256,strip:'cratera-gustavao',piece:0,fit:'fill'},
  {name:'fx:tracante',w:64,h:12,sheet:[0,0],fit:'fill'},
  {name:'fx:tracante-branco',w:64,h:12,sheet:[1,0],fit:'fill'},
  {name:'fx:tracante-vermelho',w:64,h:12,sheet:[2,0],fit:'fill'},
  {name:'fx:ponta-papel',w:32,h:32,sheet:[0,1],fit:'contain'},
  {name:'fx:ponta-granada',w:32,h:32,sheet:[1,1],fit:'contain'},
  {name:'fx:ponta-foguete',w:32,h:32,sheet:[2,1],fit:'contain'},
  {name:'fx:baforada',w:32,h:32,sheet:[0,2],fit:'contain',gray:true},
  {name:'fx:fumaca',w:64,h:12,sheet:[1,2],fit:'fill',gray:true},
  {name:'fx:foco',w:64,h:32,sheet:[2,2],fit:'fill'},
];
const SHEET_COLS=3,SHEET_ROWS=3;

/**
 * Green key for one RGBA buffer, in place: g − max(r,b) over 90 is background, under 30 is the piece, a ramp between,
 * and the green spill on the ramp is pulled down to max(r,b) (no green halo).
 */
export function keyGreen(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],k=g-Math.max(r,b);
    const a=k>=90?0:k<=30?1:(90-k)/60;
    if(k>0)data[i+1]=g-k;
    data[i+3]=Math.round(a*data[i+3]);
  }
  return data;
}

/** Bounding box of alpha > 16 inside [x0,x1)×[y0,y1) of a w-wide RGBA buffer, or undefined. */
export function bbox(data,w,x0,y0,x1,y1){
  let bx0=x1,by0=y1,bx1=-1,by1=-1;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(data[(y*w+x)*4+3]>16){if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;}
  return bx1<0?undefined:{x0:bx0,y0:by0,x1:bx1+1,y1:by1+1};
}

/** The painted pieces along a strip, left to right: runs of columns holding any alpha > 16, gaps under 3 px bridged. */
export function pieces(data,w,h){
  const runs=[];let start=-1,gap=0;
  for(let x=0;x<=w;x++){
    let any=false;if(x<w)for(let y=0;y<h&&!any;y++)any=data[(y*w+x)*4+3]>16;
    if(any){if(start<0)start=x;gap=0;}
    else if(start>=0&&++gap>=3){runs.push([start,x-gap+1]);start=-1;gap=0;}
  }
  if(start>=0)runs.push([start,w]);
  return runs;
}

/** Packs cells on shelves of one page `width` wide: {x,y} per cell and the page's height. */
export function pack(cells,width){
  let x=0,y=0,row=0;const at=[];
  for(const c of cells){
    if(x+c.w>width){x=0;y+=row;row=0;}
    at.push({x,y});x+=c.w;row=Math.max(row,c.h);
  }
  return {at,height:y+row};
}

async function raw(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,w:info.width,h:info.height};
}

async function fit(img,box,f){
  const bw=box.x1-box.x0,bh=box.y1-box.y0,cut=sharp(img.data,{raw:{width:img.w,height:img.h,channels:4}})
    .extract({left:box.x0,top:box.y0,width:bw,height:bh});
  const clear={r:0,g:0,b:0,alpha:0};
  let buf;
  if(f.fit==='fill')buf=await cut.resize(f.w,f.h,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer();
  else{
    const aw=f.w-2*PAD,ah=(f.fit==='bottom'?f.foot:f.h)-2*PAD,k=Math.min(aw/bw,ah/bh),rw=Math.max(1,Math.round(bw*k)),rh=Math.max(1,Math.round(bh*k));
    const left=f.fit==='left'?PAD:Math.round((f.w-rw)/2),top=f.fit==='bottom'?f.foot-PAD-rh:Math.round((f.h-rh)/2);
    buf=await cut.resize(rw,rh,{fit:'fill',kernel:'lanczos3'})
      .extend({left,top,right:f.w-rw-left,bottom:f.h-rh-top,background:clear}).raw().toBuffer();
  }
  if(f.gray)for(let i=0;i<buf.length;i+=4){ // white, keeping the painting's light and shade, so the tint gives the colour
    const l=Math.min(255,(.3*buf[i]+.59*buf[i+1]+.11*buf[i+2])*1.25);buf[i]=buf[i+1]=buf[i+2]=l;
  }
  return buf;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [file]=process.argv.slice(2);
  if(!file){console.error('uso: node scripts/import-torres-fx.mjs folha-codex.png');process.exit(2);}
  const sheet=await raw(file);keyGreen(sheet.data);
  const strips=new Map();
  const bufs=[];
  for(const f of FRAMES){
    let img,box;
    if(f.sheet){
      const [c,r]=f.sheet,sw=sheet.w/SHEET_COLS,sh=sheet.h/SHEET_ROWS;img=sheet;
      box=bbox(sheet.data,sheet.w,Math.round(c*sw),Math.round(r*sh),Math.round((c+1)*sw),Math.round((r+1)*sh));
      if(!box)throw new Error(`${f.name}: nada no lugar [${c},${r}] da folha`);
    }else{
      if(!strips.has(f.strip))strips.set(f.strip,await raw(join(FX_DIR,f.strip+'.webp')));
      img=strips.get(f.strip);
      const run=pieces(img.data,img.w,img.h)[f.piece];
      if(!run)throw new Error(`${f.name}: ${f.strip} não tem a peça ${f.piece}`);
      box=bbox(img.data,img.w,run[0],0,run[1],img.h);
    }
    bufs.push(await fit(img,box,f));
  }
  const WIDTH=1024,{at,height}=pack(FRAMES,WIDTH);
  const comp=FRAMES.map((f,i)=>({input:bufs[i],raw:{width:f.w,height:f.h,channels:4},left:at[i].x,top:at[i].y}));
  const out=join(FX_DIR,'torres-fx.webp');
  await sharp({create:{width:WIDTH,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(comp)
    .webp({quality:88,alphaQuality:95,effort:6}).toFile(out);
  const frames=Object.fromEntries(FRAMES.map((f,i)=>[f.name,{x:at[i].x,y:at[i].y,w:f.w,h:f.h}]));
  writeFileSync(join(FX_DIR,'torres-fx.json'),JSON.stringify({image:'torres-fx.webp',frames},null,1)+'\n');
  console.log(`${out}: ${FRAMES.length} quadros, ${WIDTH}×${height}`);
}
