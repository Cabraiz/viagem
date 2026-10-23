// Card NEW-20261022-ORQ-corrida-proporcao-contorno: does a movement sheet draw the hero at the same size as standing?
// For each drawn direction, the rest pose (idle16-<dir>, or an R06 class's idle8 column: corrida-clt) is the reference, and every pose of the walk (walk16) and the
// run (run16) and the push of the Uno (push16, card empurrar-uno) is compared at the same game scale (each clip draws its
// cell at 96/height):
//   - head: the rest pose's head (cap included, top down to the neck) fitted on the pose's head over scales 0.6–1.4
//     (soft alpha, IoU); `head` is that scale (1 = same head), robust to arms passing by and to the lean;
//   - height: the figure's height (alpha > 128) over the rest pose's; only the stance poses of a run (its phase table
//     moves the sprite: v ≠ 0) and all of a walk and a push (one foot always down), since the flight and the crouch change it;
//   - torso: the widest solid stretch of the rows under the neck (shoulders and chest, arms touching included), median
//     over that band, over the rest pose's;
//   - area: √(opaque area ratio), the whole figure's size whatever the pose ("magro" shows here first).
// It also measures the loop seam of every looping clip (card item D): the pose distance from the last frame to the first
// against the distances between neighbouring frames (1 − soft IoU of the figures at their best fit).
//
//   node scripts/proporcao.mjs [--ids viciado-em-bet] [--json out.json] [--sheet out-dir]
//
// Without arguments: the table for every class with an M16 rest pose or a run. --sheet writes, per direction, rest × walk × run
// side by side at the same scale (the game's), for the eye.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SPRITES=path.join(ROOT,'public/art/sprites');
export const DIRS=['S','N','W','NW','SE','E','NE','SW'];
/** Tolerances of the card: head ±4 %, torso ±6 %, height ±4 % (out of flight), and the area like the torso. */
export const TOL={head:.04,height:.04,torso:.06,area:.06};
/**
 * The loop seam may be at most this many times the median distance between neighbouring frames, or SEAM_FLOOR (a rest
 * that barely moves has tiny steps: a seam under it is no jump on screen).
 */
export const SEAM_MAX=1.2,SEAM_FLOOR=.08;
const CELL=96,SOLID=128;

let sharpLib;
const sharp=()=>sharpLib??=require('sharp');

/** The sheet's cells as soft alpha (0..1), CELL × CELL each, in reading order. */
export async function cells(file,frames){
  const {data,info}=await sharp()(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const cell=CELL,cols=Math.round(info.width/cell),out=[];
  for(let i=0;i<frames;i++){
    const x0=(i%cols)*cell,y0=Math.floor(i/cols)*cell,a=new Float32Array(cell*cell);
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)a[y*cell+x]=data[((y0+y)*info.width+x0+x)*4+3]/255;
    out.push(a);
  }
  return out;
}

/** Box, row widths and the neck of one soft-alpha cell. */
export function shape(a,n=CELL){
  let top=-1,bot=-1,left=n,right=-1,area=0;const rows=new Array(n).fill(0),seg=new Array(n).fill(0);
  for(let y=0;y<n;y++){
    let run=0,best=0;
    for(let x=0;x<n;x++){
      const v=a[y*n+x];area+=v;
      if(v*255>SOLID){rows[y]++;run++;if(run>best)best=run;if(top<0)top=y;bot=y;if(x<left)left=x;if(x>right)right=x;}else run=0;
    }
    seg[y]=best;
  }
  if(top<0)return undefined;
  const H=bot-top+1;
  // The neck: the narrowest row between 18 % and 45 % of the height (the head above it, the shoulders below).
  let neck=top+Math.round(H*.3),min=Infinity;
  for(let y=top+Math.round(H*.18);y<=top+Math.round(H*.45);y++)if(rows[y]<min){min=rows[y];neck=y;}
  return {top,bot,left,right,H,area,rows,seg,neck};
}

/** Bilinear sample of a soft-alpha cell (0 outside). */
function sample(a,n,x,y){
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  const at=(i,j)=>i<0||j<0||i>=n||j>=n?0:a[j*n+i];
  return at(x0,y0)*(1-fx)*(1-fy)+at(x0+1,y0)*fx*(1-fy)+at(x0,y0+1)*(1-fx)*fy+at(x0+1,y0+1)*fx*fy;
}

/**
 * The head of `ref` (rows top..neck, its own columns, padded by 3 px of nothing) fitted on `img` over scales 0.6–1.4:
 * the scale and IoU of the best fit. The template's top goes near the pose's top (±5 px), its centre near the centre
 * of the pose's top rows (±8 px).
 */
export function headScale(ref,refShape,img,imgShape,n=CELL){
  // Only the cap and the hair (the top 75 % of the head): the chin, the neck and the shoulders under it move with the
  // pose and the arms pass there; the top of the head never hides. Padded by PAD px of nothing above and at the sides.
  const r=refShape,top=r.top,neck=top+Math.round((r.neck-r.top)*.75);
  let l=n,rt=-1;
  for(let y=top;y<=neck;y++)for(let x=0;x<n;x++)if(ref[y*n+x]*255>SOLID){if(x<l)l=x;if(x>rt)rt=x;}
  const PAD=3,tw=rt-l+1,th=neck-top+1;
  const s0=imgShape;let sx=0,sw=0;
  for(let y=s0.top;y<s0.top+Math.max(4,Math.round(th*.6));y++)for(let x=0;x<n;x++){const v=img[y*n+x];sx+=x*v;sw+=v;}
  const cx=sw?sx/sw:n/2;
  let best={scale:1,iou:-1,dx:0,dy:0};
  const fit=(s,dxs,dys)=>{
    const w=tw*s,h=th*s,W=Math.ceil(w)+2*PAD,Hh=Math.round(h)+PAD;
    // template on the window grid: window px (i, j) ↔ ref px l + (i − PAD)/s, top + (j − PAD)/s
    const t=new Float32Array(W*Hh);
    for(let j=0;j<Hh;j++)for(let i=0;i<W;i++){
      const rx=l+(i-PAD+.5)/s-.5,ry=top+(j-PAD+.5)/s-.5;
      t[j*W+i]=rx<l-.5||rx>rt+.5||ry<top-.5?0:sample(ref,n,rx,ry);
    }
    for(const dy of dys)for(const dx of dxs){
      const ox=Math.round(cx-w/2)-PAD+dx,oy=s0.top-PAD+dy;let mn=0,mx=0;
      for(let j=0;j<Hh;j++){const y=oy+j;for(let i=0;i<W;i++){const x=ox+i;const b=x<0||y<0||x>=n||y>=n?0:img[y*n+x],a=t[j*W+i];mn+=a<b?a:b;mx+=a<b?b:a;}}
      const iou=mx?mn/mx:0;if(iou>best.iou)best={scale:s,iou,dx,dy};
    }
  };
  const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
  for(let s=.6;s<=1.4001;s+=.04)fit(+s.toFixed(3),range(-8,8),range(-4,3));
  const c=best.scale;
  for(let s=c-.04;s<=c+.0401;s+=.005)fit(+s.toFixed(4),range(best.dx-2,best.dx+2),range(best.dy-2,best.dy+2));
  return {scale:+best.scale.toFixed(3),iou:+best.iou.toFixed(3)};
}

/** Median widest solid stretch of the rows under the neck (shoulders and chest), at most `band` rows. */
export function torsoWidth(sh,band){
  const w=[];for(let y=sh.neck+1;y<=Math.min(sh.bot,sh.neck+band);y++)w.push(sh.seg[y]);
  return median(w);
}
export const median=a=>{if(!a.length)return NaN;const s=[...a].sort((p,q)=>p-q),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

/**
 * Pose distance between two cells: 1 − soft IoU of the figures, their feet lines and body columns aligned and then the
 * best fit within ±SHIFT px (the shape changes, not where the clip puts it: the foot meter checks the placement).
 */
const SHIFT=3;
export function poseDistance(a,b,sa,sb,n=CELL){
  const cxa=(sa.left+sa.right)/2,cxb=(sb.left+sb.right)/2,ox=Math.round(cxb-cxa),oy=sb.bot-sa.bot;
  let best=0;
  for(let dy=oy-SHIFT;dy<=oy+SHIFT;dy++)for(let dx=ox-SHIFT;dx<=ox+SHIFT;dx++){
    let mn=0,mx=0;
    for(let y=sa.top;y<=sa.bot;y++)for(let x=sa.left;x<=sa.right;x++){
      const p=a[y*n+x],xx=x+dx,yy=y+dy,q=xx<0||yy<0||xx>=n||yy>=n?0:b[yy*n+xx];mn+=p<q?p:q;mx+=p<q?q:p;
    }
    // b outside a's box counts too
    for(let y=sb.top;y<=sb.bot;y++)for(let x=sb.left;x<=sb.right;x++){
      const xa=x-dx,ya=y-dy;if(xa>=sa.left&&xa<=sa.right&&ya>=sa.top&&ya<=sa.bot)continue;mx+=b[y*n+x];
    }
    const iou=mx?mn/mx:0;if(iou>best)best=iou;
  }
  return 1-best;
}

/** The loop seam of a looping clip: every neighbouring distance, the seam's (last → first) and its ratio to the median. */
export function seam(frames,shapes){
  const d=[];for(let i=0;i<frames.length;i++){const j=(i+1)%frames.length;d.push(poseDistance(frames[i],frames[j],shapes[i],shapes[j]));}
  const inner=d.slice(0,-1),med=median(inner),last=d.at(-1),ratio=med>0?last/med:last>0?Infinity:0;
  return {seam:+last.toFixed(3),median:+med.toFixed(3),max:+Math.max(...inner).toFixed(3),ratio:+ratio.toFixed(2),steps:d.map(x=>+x.toFixed(3))};
}

/** The sprite manifest's M16 clips of class `id`, by key. */
export function clipsOf(manifest,id){return manifest.pieces?.[id]?.files??{};}
/** R06's idle8: one rest pose per direction, in this column order (sprite-motion.ts HERO_DIRECTIONS). */
const IDLE8=['S','SW','W','NW','N','NE','E','SE'];
/**
 * The rest pose of direction `d`: M16's idle16-<d>, else (an R06 class that runs, card corrida-clt) its idle8 column.
 * {clip, frames: the cell indices of the rest} or undefined.
 */
export function restOf(files,d){
  if(files[`idle16-${d}`])return {clip:files[`idle16-${d}`],frames:Array.from({length:files[`idle16-${d}`].frames},(_,i)=>i)};
  if(files.idle8&&(files[`run16-${d}`]||files[`push16-${d}`]))return {clip:files.idle8,frames:[IDLE8.indexOf(d)]};
}
/** The classes the meter covers: every one with an M16 rest or a run. */
export const measuredClasses=manifest=>Object.keys(manifest.pieces).filter(id=>Object.keys(clipsOf(manifest,id)).some(k=>k.startsWith('idle16-')||k.startsWith('run16-')||k.startsWith('push16-')));

/**
 * Measures class `id`, every drawn direction: rest × each walk and run pose. Sizes are compared at the game's scale
 * (96/height per clip). Returns rows {dir, clip, frame, stance, head, headIou, height, torso, area} and per-clip summaries.
 */
export async function measureClass(manifest,id,dir=SPRITES){
  const files=clipsOf(manifest,id),out={id,dirs:{}};
  for(const d of DIRS){
    const r=restOf(files,d);if(!r)continue;
    const idle=r.clip,all=await cells(path.join(dir,idle.file),Math.max(...r.frames)+1),rest=r.frames.map(i=>all[i]),restShapes=rest.map(a=>shape(a));
    const r0=restShapes[0],restH=median(restShapes.map(s=>s.H)),restArea=median(restShapes.map(s=>s.area));
    const band=Math.round(restH*.25),restTorso=median(restShapes.map(s=>torsoWidth(s,band)));
    const entry={rest:{H:restH,head:r0.neck-r0.top+1,torso:restTorso,area:+restArea.toFixed(1)},restKey:files[`idle16-${d}`]?'idle16':'idle8',clips:{}};
    for(const motion of ['idle','walk','run','push']){
      const clip=motion==='idle'?idle:files[`${motion}16-${d}`];if(!clip)continue;
      const k=idle.height/clip.height; // this clip's px in rest px at the game's scale
      const frames=motion==='idle'?rest:await cells(path.join(dir,clip.file),clip.frames),shapes=motion==='idle'?restShapes:frames.map(a=>shape(a));
      const rows=frames.map((a,i)=>{
        const sh=shapes[i],head=headScale(rest[0],r0,a,sh);
        const stance=motion!=='run'||!clip.phase||clip.phase.v[i].some(v=>v!==0);
        return {frame:i,stance,head:+(head.scale*k).toFixed(3),headIou:head.iou,height:+(sh.H*k/restH).toFixed(3),
          torso:+(torsoWidth(sh,Math.round(band/k))*k/restTorso).toFixed(3),area:+(Math.sqrt(sh.area/restArea)*k).toFixed(3)};
      });
      const pick=(key,only)=>median(rows.filter(r=>!only||r.stance).map(r=>r[key]));
      entry.clips[motion]={scale:+k.toFixed(3),frames:rows,head:+pick('head').toFixed(3),height:+pick('height',true).toFixed(3),
        torso:+pick('torso').toFixed(3),area:+pick('area').toFixed(3),...(clip.loop&&frames.length>1?{loop:seam(frames,shapes)}:{})};
    }
    out.dirs[d]=entry;
  }
  return out;
}

/**
 * Failures of a measured class against TOL and SEAM_MAX (empty = passes). `keys`: the sizes checked. The card's gate is
 * head and height (the user saw a smaller head and a thinner body); torso and area are pose-dependent (arms across the
 * chest, legs folded) and are reported, not gated.
 */
export const GATED=['head','height'];
/**
 * The push (empurrar-uno, ORQ 23/10): leaning 15° on the car with the knees bent, the figure is lower by design; the head
 * never changes. Its height only has to stay at least PUSH_MIN_HEIGHT of the rest's (the same rule as a crouched run).
 */
export const PUSH_MIN_HEIGHT=.88;
/**
 * Pushing away from the camera (push16-N) the palms rise beside the head on the screen and the head template locks on
 * hands and hair together (it reads 1.24–1.26 on heads drawn the rest's size: evidence/NEW-20261022-ORQ-empurrar-uno/
 * remontar/n-cabeca-x-parado.png). There the size goes by the height alone, both ways: PUSH_MIN_HEIGHT .. 1 + TOL.height.
 */
export const PUSH_HEAD_UNREAD=['N'];
export function verdict(m,keys=GATED){
  const bad=[];
  for(const [d,e] of Object.entries(m.dirs))for(const [motion,c] of Object.entries(e.clips)){
    if(motion==='push'){
      const unread=PUSH_HEAD_UNREAD.includes(d);
      if(keys.includes('head')&&!unread&&Math.abs(c.head-1)>TOL.head+1e-9)bad.push(`${m.id} push16-${d} head ${c.head} (±${TOL.head*100}%)`);
      if(keys.includes('height')&&c.height<PUSH_MIN_HEIGHT-1e-9)bad.push(`${m.id} push16-${d} height ${c.height} (≥ ${PUSH_MIN_HEIGHT})`);
      if(unread&&c.height>1+TOL.height+1e-9)bad.push(`${m.id} push16-${d} height ${c.height} (≤ ${1+TOL.height}, the head unread)`);
    }else if(motion!=='idle')for(const key of keys)if(Math.abs(c[key]-1)>TOL[key]+1e-9)bad.push(`${m.id} ${motion}16-${d} ${key} ${c[key]} (±${TOL[key]*100}%)`);
    if(c.loop&&c.loop.ratio>SEAM_MAX&&c.loop.seam>SEAM_FLOOR)bad.push(`${m.id} ${motion}16-${d} loop seam ${c.loop.seam} = ${c.loop.ratio}× the median step ${c.loop.median} (≤ ${SEAM_MAX}×)`);
  }
  return bad;
}

/** Markdown table of a measured class. */
export function table(m){
  const lines=[`### ${m.id}`,'','| direção | clipe | cabeça | altura (apoio) | tronco | área | emenda 16→1 |','|---|---|---|---|---|---|---|'];
  const pc=x=>`${x>=1?'+':''}${((x-1)*100).toFixed(1)} %`;
  for(const [d,e] of Object.entries(m.dirs))for(const [motion,c] of Object.entries(e.clips)){
    lines.push(`| ${d} | ${motion==='idle'?e.restKey??'idle16':`${motion}16`} | ${motion==='idle'?'—':pc(c.head)} | ${motion==='idle'?'—':pc(c.height)} | ${motion==='idle'?'—':pc(c.torso)} | ${motion==='idle'?'—':pc(c.area)} | ${c.loop?`${c.loop.ratio}× (${c.loop.seam} / ${c.loop.median})`:'—'} |`);
  }
  return lines.join('\n');
}

/** Rest, walk frame 0 and every run frame side by side at the game's scale (4×, nearest), one PNG per direction. */
/** The lowest opaque row (alpha > 128) over the cells `frames` of a sheet. */
async function feetRow(file,frames,cols){
  const a=await cells(file,Math.max(...frames)+1);
  return Math.max(...frames.map(f=>shape(a[f]).bot+1));
}
export async function sheet(manifest,id,outDir,dir=SPRITES){
  const files=clipsOf(manifest,id),Z=3,S=CELL*Z,feetOf={};fs.mkdirSync(outDir,{recursive:true});
  for(const d of DIRS){
    const r=restOf(files,d);if(!r)continue;
    const idle=r.clip,list=[['idle',r.frames[0]],['walk',0],...['run','push'].flatMap(m=>Array.from({length:files[`${m}16-${d}`]?.frames??0},(_,i)=>[m,i]))].filter(([m])=>m==='idle'||files[`${m}16-${d}`]);
    const comps=[];
    for(let k=0;k<list.length;k++){
      const [motion,i]=list[k],clip=motion==='idle'?idle:files[`${motion}16-${d}`],cols=clip.pages?.[0]?.columns??4,size=Math.round(S*idle.height/clip.height);
      const buf=await sharp()(path.join(dir,clip.file)).extract({left:(i%cols)*CELL,top:Math.floor(i/cols)*CELL,width:CELL,height:CELL}).resize(size,size,{kernel:'nearest'}).png().toBuffer();
      // same feet line: the clip's feet row (its lowest opaque row; a run's lowest over its poses, as hero-feet.mjs) on
      // the slot's 0.875 (an R06 rest stands above its anchor row)
      const feet=(feetOf[clip.file]??=await feetRow(path.join(dir,clip.file),motion==='idle'?[i]:Array.from({length:clip.frames},(_,f)=>f),cols));
      const slot=S,left=(k%6)*slot+Math.round((slot-size)/2),top=Math.floor(k/6)*slot+Math.round(slot*.875-feet*size/CELL);
      comps.push({input:buf,left:Math.max(0,left),top:Math.max(0,top)});
    }
    const rows=Math.ceil(list.length/6);
    await sharp()({create:{width:6*S,height:rows*S,channels:4,background:'#c8d0c0'}}).composite(comps).png().toFile(path.join(outDir,`${id}-${d}.png`));
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=k=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:undefined;};
  const manifest=JSON.parse(fs.readFileSync(path.join(SPRITES,'manifest.json'),'utf8'));
  const ids=arg('--ids')?.split(',')??measuredClasses(manifest);
  const all=[];
  for(const id of ids){
    const m=await measureClass(manifest,id);all.push(m);
    console.log(table(m));console.log();
    const bad=verdict(m);console.log(bad.length?`REPROVADO:\n- ${bad.join('\n- ')}`:'APROVADO');console.log();
    if(arg('--sheet'))await sheet(manifest,id,arg('--sheet'));
  }
  if(arg('--json'))fs.writeFileSync(arg('--json'),JSON.stringify(all,null,1));
}
