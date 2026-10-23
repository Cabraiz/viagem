// Card BUG-20261022-ORQ-troca-de-perna: does a looping gait (walk or run) change the leading leg every half cycle?
// The image tool draws the same leg in front in both halves (it obeys the shoe colour markers, not the leg), so a run
// can stride with one leg only ("o mesmo pé à frente").
//
// S and N (the camera looks along the gait): the left and right legs are each other's mirror, so with the legs changing
// the pose half a cycle later is the first one mirrored about the body (pivotX). The meter compares the legs band of
// frame i with frame i+N/2 as drawn ("same") and mirrored ("mirror"): a gait that changes legs has mirror < same.
// Side and diagonal views have no such 2D test (swapping legs moves one leg behind the other in depth); those sheets are
// checked by eye on their marked sources and listed by file (the name carries the bytes' hash) in troca-de-perna.json.
//
//   node scripts/troca-de-perna.mjs [--ids viciado-em-bet,clt-cansado]     the S/N table of every looping gait
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SPRITES=path.join(ROOT,'public/art/sprites');
/** A looping gait: the M16 walk/run and the R06 walk (attack and idle don't stride). */
export const GAIT=/^(walk16|run16|walk128)-(\w+)$/;
/** mirror/same at most this: the run16 S/N that change legs read 0.09–0.14; a one-leg gait reads ≥ 1. */
export const MIRROR_MAX=.6;
/** The legs band: from this share of the figure's height (top 0) down to its feet. */
const LEGS=.55;

let sharpLib;
const sharp=()=>sharpLib??=require('sharp');

/** The sheet's cells as premultiplied RGBA (Float32, 0..1), cell × cell each, in reading order. */
export async function frames(file,count,cell){
  const {data,info}=await sharp()(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const cols=Math.round(info.width/cell),out=[];
  for(let i=0;i<count;i++){
    const x0=(i%cols)*cell,y0=Math.floor(i/cols)*cell,f=new Float32Array(cell*cell*4);
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
      const s=((y0+y)*info.width+x0+x)*4,t=(y*cell+x)*4,a=data[s+3]/255;
      f[t]=data[s]/255*a;f[t+1]=data[s+1]/255*a;f[t+2]=data[s+2]/255*a;f[t+3]=a;
    }
    out.push(f);
  }
  return out;
}

/**
 * Mean RGBA difference over the legs band between frame a and frame b (b mirrored about pivotX when `mirror`), counted
 * where either frame has the figure.
 */
export function legsDistance(a,b,cell,pivotX,mirror){
  let top=cell,bot=-1;
  for(const f of [a,b])for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)if(f[(y*cell+x)*4+3]>.25){if(y<top)top=y;if(y>bot)bot=y;}
  if(bot<0)return 0;
  const y0=Math.round(top+(bot-top)*LEGS);let sum=0,n=0;
  for(let y=y0;y<=bot;y++)for(let x=0;x<cell;x++){
    const xb=mirror?Math.round(2*pivotX-x):x,i=(y*cell+x)*4,j=(y*cell+xb)*4,inB=xb>=0&&xb<cell;
    const aa=a[i+3],ba=inB?b[j+3]:0;if(aa<=.25&&ba<=.25)continue;
    for(let k=0;k<4;k++)sum+=Math.abs(a[i+k]-(inB?b[j+k]:0));n++;
  }
  return n?sum/n/4:0;
}

/** same/mirror over 16 frame pairs (i, i+N/2) of a looping clip, and their ratio. */
export function mirrorTest(fr,cell,pivotX){
  const N=fr.length,step=Math.max(1,Math.round(N/16));let same=0,mirror=0,k=0;
  for(let i=0;i<N/2;i+=step){same+=legsDistance(fr[i],fr[i+N/2],cell,pivotX,false);mirror+=legsDistance(fr[i],fr[i+N/2],cell,pivotX,true);k++;}
  same/=k;mirror/=k;
  return {same:+same.toFixed(4),mirror:+mirror.toFixed(4),ratio:+(mirror/(same||1e-9)).toFixed(2)};
}

/** The S/N looping gaits of the manifest (or of `ids`), each with its file, cell and pivot. */
export function gaitClips(manifest,ids){
  const out=[];
  for(const [id,piece] of Object.entries(manifest.pieces??{})){
    if(ids&&!ids.includes(id))continue;
    for(const [key,f] of Object.entries(piece.files??{})){
      const m=GAIT.exec(key);if(!m||f.loop===false)continue;
      const page=f.pages?.[0],cell=f.cell?.[0];if(!page||!cell)continue;
      out.push({id,key,motion:m[1],direction:m[2],file:page.file,frames:f.frames,cell,pivotX:f.pivotX??cell/2});
    }
  }
  return out;
}

/** Measures one clip: the S/N mirror test (side and diagonal: undefined, they go by the reviewed list). */
export async function measureClip(clip){
  if(clip.direction!=='S'&&clip.direction!=='N')return undefined;
  const fr=await frames(path.join(SPRITES,clip.file),clip.frames,clip.cell);
  return {...mirrorTest(fr,clip.cell,clip.pivotX)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const i=process.argv.indexOf('--ids'),ids=i>0?process.argv[i+1].split(','):undefined;
  const manifest=JSON.parse(fs.readFileSync(path.join(SPRITES,'manifest.json'),'utf8'));
  for(const clip of gaitClips(manifest,ids)){
    const m=await measureClip(clip);if(!m)continue;
    console.log(`${clip.id} ${clip.key}`.padEnd(34),'same',String(m.same).padStart(7),'mirror',String(m.mirror).padStart(7),'ratio',String(m.ratio).padStart(5),m.ratio<=MIRROR_MAX?'alterna':'NÃO alterna');
  }
}
