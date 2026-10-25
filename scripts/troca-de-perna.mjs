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
/**
 * A looping gait: the M16 walk/run, the R06 walk and the push and pull of the Uno (two steps each; card
 * auditoria-troca-perna). Attack and idle don't stride.
 */
export const GAIT=/^(walk16|run16|walk128|push16|pull16)-(\w+)$/;
/** mirror/same at most this: the run16 S/N that change legs read 0.09–0.14; a one-leg gait reads ≥ 1. */
export const MIRROR_MAX=.6;
/** The legs band: from this share of the figure's height (top 0) down to its feet. */
const LEGS=.55;
/**
 * The legs band per class, where the default one catches what does not mirror on purpose. vendedor-praia (card
 * vendedor-aposentado-arte-8-direcoes, 24/10): the cooler box hangs on the LEFT hip only, at 55–74 % of the figure, so
 * mirrored it jumps sides (0.83–0.9 at 55 %); below the shorts' hem (74 %) only the legs remain (S 0.41–0.42, N 0.36–0.45).
 */
export const LEGS_BY_CLASS={'vendedor-praia':.74};

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
export function legsDistance(a,b,cell,pivotX,mirror,legs=LEGS){
  let top=cell,bot=-1;
  for(const f of [a,b])for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)if(f[(y*cell+x)*4+3]>.25){if(y<top)top=y;if(y>bot)bot=y;}
  if(bot<0)return 0;
  const y0=Math.round(top+(bot-top)*legs);let sum=0,n=0;
  for(let y=y0;y<=bot;y++)for(let x=0;x<cell;x++){
    const xb=mirror?Math.round(2*pivotX-x):x,i=(y*cell+x)*4,j=(y*cell+xb)*4,inB=xb>=0&&xb<cell;
    const aa=a[i+3],ba=inB?b[j+3]:0;if(aa<=.25&&ba<=.25)continue;
    for(let k=0;k<4;k++)sum+=Math.abs(a[i+k]-(inB?b[j+k]:0));n++;
  }
  return n?sum/n/4:0;
}

/** same/mirror over 16 frame pairs (i, i+N/2) of a looping clip, and their ratio. */
export function mirrorTest(fr,cell,pivotX,legs=LEGS){
  const N=fr.length,step=Math.max(1,Math.round(N/16));let same=0,mirror=0,k=0;
  for(let i=0;i<N/2;i+=step){same+=legsDistance(fr[i],fr[i+N/2],cell,pivotX,false,legs);mirror+=legsDistance(fr[i],fr[i+N/2],cell,pivotX,true,legs);k++;}
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
  const fr=await frames(path.join(SPRITES,clip.file),clip.frames,clip.cell),legs=LEGS_BY_CLASS[clip.id]??LEGS;
  // Half a pixel either way (card auditoria-troca-perna): a 2nd half made by mirroring the 1st across the cell (the S/N
  // push and pull, "meia passada + espelho") turns about column 47.5, which round(2·48 − x) never hits (0.93 → 0).
  return [0,-.5,.5].map(o=>mirrorTest(fr,clip.cell,clip.pivotX+o,legs)).reduce((a,b)=>b.ratio<a.ratio?b:a);
}

/**
 * Card BUG-20261025-ORQ-auditoria-troca-perna (the user, 25/10: the gato running right "sem a troca de perna, parece
 * deslizando"): a phase table picks the pose by the ground walked, so a pose's share of the stride is its share of the
 * time on screen. The gato's five run16 tables came from its first assembler, which gave 0.02 to every pose on the
 * ground without a receding foot and threw the rest of the cycle into the few airborne ones: on the W run 6 airborne
 * poses held 91 % of the stride (0.57 figure heights each, frozen while the body glided) and the 10 on the ground, where
 * the legs change, flashed by. The maromba's assembler already splits the rest evenly between every pose without a
 * planted foot, as every other class's table does. Planted poses keep d = foot travel / height (the foot stays put).
 */
/** The poses without a planted foot (v [0, 0]): their d must be equal. */
export const flightPoses=phase=>phase.v.flatMap(([x,y],i)=>x||y?[]:[i]);
/** max/min of the d of the poses without a planted foot (1 = shared evenly; the gato's W run read 28.6). */
export function flightSpread(phase){
  const d=flightPoses(phase).map(i=>phase.d[i]);
  return d.length?+(Math.max(...d)/Math.min(...d)).toFixed(2):1;
}
/** At most this flight spread (rounding of the 5-decimal d). */
export const FLIGHT_SPREAD_MAX=1.01;
/** The table with the stride's rest (stride − planted d) split evenly between the poses without a planted foot. */
export function evenFlights(phase){
  const flights=flightPoses(phase);if(!flights.length)return phase;
  const stride=phase.d.reduce((a,b)=>a+b,0),stance=phase.d.reduce((a,x,i)=>flights.includes(i)?a:a+x,0);
  const each=+((stride-stance)/flights.length).toFixed(5);
  return {...phase,d:phase.d.map((x,i)=>flights.includes(i)?each:x)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const i=process.argv.indexOf('--ids'),ids=i>0?process.argv[i+1].split(','):undefined;
  const manifest=JSON.parse(fs.readFileSync(path.join(SPRITES,'manifest.json'),'utf8'));
  // --fase: rewrites the run16 phase tables whose poses without a planted foot do not share the stride evenly.
  if(process.argv.includes('--fase')){
    const {GROUPS}=await import('./art-v2/spec.mjs'),{writeIndex}=await import('./art-v2/convert.mjs');let fixed=0;
    for(const [id,piece] of Object.entries(manifest.pieces))for(const [key,f] of Object.entries(piece.files)){
      if(!/^run16-/.test(key)||!f.phase||(ids&&!ids.includes(id))||flightSpread(f.phase)<=FLIGHT_SPREAD_MAX)continue;
      console.log(`${id} ${key}`.padEnd(34),'voo max/min',flightSpread(f.phase),'→',flightSpread(f.phase=evenFlights(f.phase)));fixed++;
    }
    if(fixed){fs.writeFileSync(path.join(SPRITES,'manifest.json'),`${JSON.stringify(manifest,null,2)}
`);await writeIndex({personagens:GROUPS.personagens},{outRoot:ROOT});}
    process.exit(0);
  }
  for(const clip of gaitClips(manifest,ids)){
    const m=await measureClip(clip);if(!m)continue;
    console.log(`${clip.id} ${clip.key}`.padEnd(34),'same',String(m.same).padStart(7),'mirror',String(m.mirror).padStart(7),'ratio',String(m.ratio).padStart(5),m.ratio<=MIRROR_MAX?'alterna':'NÃO alterna');
  }
}
