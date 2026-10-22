/**
 * The chaveiro's moto, painted (NEW-20261022-ORQ-trocar-procedurais-por-arte): the E3's Codex drawings
 * (arte-entrada/cenario/base/moto-chaveiro/, flat green background) → one base sheet the chaveiro renderer draws instead of
 * the provisional boxes (render/chaveiro/figures.ts):
 *   public/art/city/base/moto-chaveiro.webp
 * Rows (meta.states): the moto poses and the chaveiro standing (MOTO_ROWS). Columns (views): the screen direction the
 * figure faces, 0 down-right (the front view as drawn), 1 down-left (it mirrored), 2 up-right (the back view as drawn),
 * 3 up-left (mirrored); a pose drawn once (the fall) repeats its front view in the back columns.
 * Each source is keyed (green → alpha, the green spill taken off), split into its two views at the widest empty gap,
 * scaled so the figure is `height` world px tall (both views of one drawing by the same factor) at ART_DENSITY art px
 * per world px, and placed with its ground point (the bottom centre of its box, lifted by `foot` of its height) on the
 * cell's anchor. meta.escala: world px per art px (the renderer draws at that scale, like the procedural boxes).
 * The group manifest and the index are rewritten; then `node scripts/art-lite.mjs --kinds city` makes the lite copy.
 *   node scripts/import-moto-chaveiro.mjs [--src <folder>]
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

export const PIECE='moto-chaveiro';
/** Art px per world px (the city's projection: 42 px per unit across). */
export const ART_DENSITY=2.5;
/**
 * The rows: source drawing(s) (front, back: `[file, half]`, half 0 the left view, 1 the right, -1 the whole image),
 * the figure's height in world px (the procedural figures: the hero 1.245 u ≈ 52 px; the moto with its riders reaches
 * the tray on Cida's head and the near wheel runs lower on screen) and the ground point's lift (share of the height).
 */
export const MOTO_ROWS=[
  {state:'sentados',front:['sentados.png',0],back:['sentados.png',1],height:72,foot:.06},
  {state:'so-cida',front:['so-cida.png',0],back:['so-cida-costas.png',-1],height:72,foot:.06},
  {state:'tombo',front:['tombo.png',-1],back:null,height:46,foot:.12},
  {state:'em-pe-bolsa',front:['em-pe-bolsa.png',0],back:['em-pe-bolsa.png',1],height:54,foot:.03},
  {state:'em-pe-ferramenta',front:['em-pe-ferramenta.png',0],back:['em-pe-ferramenta.png',1],height:54,foot:.03},
];
const PAD=4;

/** Green background → alpha (spill = g − max(r, b): 25 keeps, 110 clears), the spill taken off the kept pixels. In place. */
export function keyGreen(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],m=Math.max(r,b),spill=g-m;
    data[i+3]=Math.round(255*Math.max(0,Math.min(1,1-(spill-25)/85))*(data[i+3]/255));
    if(spill>0)data[i+1]=m;
  }
  return data;
}
/** Alpha bounding box [x0, y0, x1, y1) of the columns x0..x1 of an RGBA buffer (alpha over 24), or undefined. */
export function bbox(data,width,height,x0=0,x1=width){
  let a=Infinity,b=Infinity,c=-1,d=-1;
  for(let y=0;y<height;y++)for(let x=x0;x<x1;x++)if(data[(y*width+x)*4+3]>24){if(x<a)a=x;if(x>c)c=x;if(y<b)b=y;if(y>d)d=y;}
  return c<0?undefined:[a,b,c+1,d+1];
}
/** The column splitting two views: the middle of the widest run of empty columns between the first and last figure column. */
export function splitColumn(data,width,height){
  const full=new Uint8Array(width);
  for(let x=0;x<width;x++){let n=0;for(let y=0;y<height;y++)if(data[(y*width+x)*4+3]>24&&++n>2){full[x]=1;break;}}
  const first=full.indexOf(1),last=full.lastIndexOf(1);
  let best=-1,bestW=0;
  for(let x=first;x<=last;){
    if(full[x]){x++;continue;}
    let e=x;while(e<=last&&!full[e])e++;
    if(e-x>bestW){bestW=e-x;best=(x+e)>>1;}
    x=e;
  }
  if(best<0)throw new Error('duas vistas sem vão entre elas');
  return best;
}

async function main(){
  const require=createRequire(join(ROOT,'package.json')),sharp=require('sharp');
  const {GROUPS}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/spec.mjs')).href);
  const {writeIndex}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/convert.mjs')).href);
  const args=process.argv.slice(2),srcAt=args.indexOf('--src');
  const SRC=srcAt>=0?args[srcAt+1]:'D:/Gits/viagem-board/arte-entrada/cenario/base/moto-chaveiro';
  const spec=GROUPS.base,dir=join(ROOT,spec.output),manifestFile=join(dir,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  const sources=new Map();
  const source=async file=>{
    if(!sources.has(file)){
      const {data,info}=await sharp(join(SRC,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      keyGreen(data);sources.set(file,{data,width:info.width,height:info.height});
    }
    return sources.get(file);
  };
  /** One view of a drawing, cropped to its figure: {buf, w, h} (RGBA). */
  const view=async([file,half])=>{
    const s=await source(file),cut=half<0?undefined:splitColumn(s.data,s.width,s.height);
    const box=bbox(s.data,s.width,s.height,half===1?cut:0,half===0?cut:s.width);
    if(!box)throw new Error(`${file}: nenhuma figura`);
    const [x0,y0,x1,y1]=box,w=x1-x0,h=y1-y0,buf=Buffer.alloc(w*h*4);
    for(let y=0;y<h;y++)s.data.copy(buf,y*w*4,((y0+y)*s.width+x0)*4,((y0+y)*s.width+x1)*4);
    return {buf,w,h};
  };
  // Each row: its views scaled to the row's height (the taller of the two drawn views sets the factor of a drawing).
  const rows=[];
  for(const row of MOTO_ROWS){
    const front=await view(row.front),back=row.back?await view(row.back):front;
    const same=row.back&&row.back[0]===row.front[0],tall=row.height*ART_DENSITY;
    const k1=tall/(same?Math.max(front.h,back.h):front.h),k2=tall/(same?Math.max(front.h,back.h):back.h);
    const scaled=async(v,k)=>{
      const w=Math.max(1,Math.round(v.w*k)),h=Math.max(1,Math.round(v.h*k));
      return {buf:await sharp(v.buf,{raw:{width:v.w,height:v.h,channels:4}}).resize(w,h,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer(),w,h};
    };
    const f=await scaled(front,k1),b=row.back?await scaled(back,k2):f;
    const flop=async v=>({...v,buf:await sharp(v.buf,{raw:{width:v.w,height:v.h,channels:4}}).flop().raw().toBuffer()});
    rows.push({row,frames:[f,await flop(f),b,await flop(b)]});
  }
  // One cell for all: the ground point at (cw/2, ch − PAD − lift); every frame fits around it.
  let left=0,right=0,up=0,down=0;
  for(const {row,frames} of rows)for(const v of frames){
    const lift=Math.round(row.foot*v.h);
    left=Math.max(left,Math.ceil(v.w/2));right=Math.max(right,v.w-Math.ceil(v.w/2));up=Math.max(up,v.h-lift);down=Math.max(down,lift);
  }
  const half=Math.max(left,right)+PAD,cw=2*half,ch=up+down+2*PAD,ax=half,ay=PAD+up,cols=4,sheet=Buffer.alloc(cols*cw*rows.length*ch*4);
  rows.forEach(({row,frames},r)=>frames.forEach((v,c)=>{
    const lift=Math.round(row.foot*v.h),ox=c*cw+ax-Math.ceil(v.w/2),oy=r*ch+ay-(v.h-lift);
    for(let y=0;y<v.h;y++)v.buf.copy(sheet,((oy+y)*cols*cw+ox)*4,y*v.w*4,(y+1)*v.w*4);
  }));
  const file=`${PIECE}.webp`,webp=await sharp(sheet,{raw:{width:cols*cw,height:rows.length*ch,channels:4}}).webp({lossless:true,effort:6}).toBuffer();
  writeFileSync(join(dir,file),webp);
  const hash=sha256(webp),states=MOTO_ROWS.map(r=>r.state);
  const entry={file,cell:[cw,ch],views:4,rows:states,anchor:[+(ax/cw).toFixed(6),+(ay/ch).toFixed(6)],
    pages:[{file,columns:cols,rows:rows.length,firstFrame:0,frameCount:cols*rows.length,sha256:hash}],sha256:hash};
  manifest.pieces[PIECE]={kind:'views',files:{sheet:entry},sha256:sha256(`sheet ${hash}`),
    meta:{states,direcoes:['baixo-direita','baixo-esquerda','cima-direita','cima-esquerda'],escala:+(1/ART_DENSITY).toFixed(4),
      origem:'arte-entrada/cenario/base/moto-chaveiro (Codex, E3, card trocar-procedurais-por-arte); recorte por scripts/import-moto-chaveiro.mjs'}};
  manifest.pieces=Object.fromEntries(Object.keys(manifest.pieces).sort().map(k=>[k,manifest.pieces[k]]));
  writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
  await writeIndex({base:spec},{outRoot:ROOT});
  console.error(`${PIECE}: ${cols}×${rows.length} frames ${cw}×${ch}, ${Math.round(webp.length/1024)} KB; agora: node scripts/art-lite.mjs --kinds city`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
