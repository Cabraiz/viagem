// Pseudo-sombra (card NEW-20261022-ORQ-estudo-inimigos-flutuando, V6b): bakes the Myth-like self-shading into the enemy
// sheets that already exist, with no new art. Per cell: a normal guessed from the silhouette (distance to the alpha edge,
// smoothed, read as a dome), the map's fixed sun (render/light.ts SUN_VIEW: upper left) → the far side darker and the
// near side a touch lighter, and an occlusion gradient over the feet. Alpha is never changed; the outer edge (the rim)
// keeps its colour. Deterministic: same input, same output.
//
//   node scripts/pseudo-sombra.mjs --forca 1|2|3 [--ids a,b,c | --todos] [--fonte lite|cheia] [--saida public/art/estudo/<dir>]
//
// Reads public/art/manifest.json (group inimigos) for the cells; writes <saida>/<id>/<file> with the same names, so
// `?estudo=folha=<dir>` (render/estudo-flutuando.ts) draws them in place of the lite copies.
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import sharp from 'sharp';

/** Per strength: side shading (share of the light/flat difference kept), feet occlusion (darkest at the soles), top lift. */
export const FORCAS=Object.freeze({1:{side:.35,feet:.22,top:.04},2:{side:.6,feet:.36,top:.06},3:{side:.85,feet:.5,top:.08}});
/** render/light.ts SUN_VIEW, normalised (screen axes: x right, y down, z toward the viewer). */
const SUN=(()=>{const v=[-0.65,-0.32,0.62],l=Math.hypot(...v);return v.map(c=>c/l);})();
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Chamfer (3-4) distance to the nearest outside pixel, in px, for a w×h mask. */
function distance(mask,w,h){
  const INF=1e9,d=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)d[i]=mask[i]?INF:0;
  const at=(x,y)=>x<0||y<0||x>=w||y>=h?0:d[y*w+x];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!d[i])continue;
    d[i]=Math.min(d[i],at(x-1,y)+3,at(x,y-1)+3,at(x-1,y-1)+4,at(x+1,y-1)+4);}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(!d[i])continue;
    d[i]=Math.min(d[i],at(x+1,y)+3,at(x,y+1)+3,at(x+1,y+1)+4,at(x-1,y+1)+4);}
  for(let i=0;i<w*h;i++)d[i]/=3;
  return d;
}
/** Box blur of radius r (two passes), for the dome's slope. */
function blur(src,w,h,r){
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;for(let k=-r;k<=r;k++){const xx=x+k;if(xx>=0&&xx<w){s+=src[y*w+xx];n++;}}tmp[y*w+x]=s/n;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;for(let k=-r;k<=r;k++){const yy=y+k;if(yy>=0&&yy<h){s+=tmp[yy*w+x];n++;}}out[y*w+x]=s/n;}
  return out;
}

/** Shades one cell of an RGBA buffer in place (`stride`: the sheet's width in px). */
export function shadeCell(px,stride,cx,cy,cw,ch,forca){
  const f=FORCAS[forca],mask=new Uint8Array(cw*ch);
  let top=ch,bottom=-1;
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const a=px[((cy+y)*stride+cx+x)*4+3];if(a>=128){mask[y*cw+x]=1;if(y<top)top=y;if(y>bottom)bottom=y;}}
  if(bottom<0)return;
  const d=distance(mask,cw,ch);let max=0;for(const v of d)if(v>max)max=v;
  // The dome: height rises over the first R px from the edge (R: a quarter of the figure's height, at least the thickest).
  const R=Math.max(2,Math.min(max,(bottom-top+1)*.12)),hgt=new Float32Array(cw*ch);
  for(let i=0;i<cw*ch;i++){const t=Math.min(1,d[i]/R);hgt[i]=Math.sqrt(1-(1-t)*(1-t));}
  const hs=blur(hgt,cw,ch,Math.max(1,Math.round(R/3))),k=R*.9;
  const flat=SUN[2];
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    const i=y*cw+x;if(!mask[i]||d[i]<1.2)continue; // outside, or the outer edge (the rim) keeps its colour
    const gx=(hs[y*cw+Math.min(cw-1,x+1)]-hs[y*cw+Math.max(0,x-1)])/2,gy=(hs[Math.min(ch-1,y+1)*cw+x]-hs[Math.max(0,y-1)*cw+x])/2;
    let nx=-gx*k,ny=-gy*k,nz=1;const l=Math.hypot(nx,ny,nz);nx/=l;ny/=l;nz/=l;
    const lambert=Math.max(0,nx*SUN[0]+ny*SUN[1]+nz*SUN[2])/flat; // 1 = facing the viewer
    const side=1+(Math.min(1.25,lambert)-1)*f.side;
    const v=(y-top)/Math.max(1,bottom-top); // 0 head .. 1 soles
    const feet=1-f.feet*smooth(.62,1,v),lift=1+f.top*(1-smooth(0,.35,v));
    const m=side*feet*lift,p=((cy+y)*stride+cx+x)*4;
    for(let c=0;c<3;c++)px[p+c]=Math.max(0,Math.min(255,Math.round(px[p+c]*m)));
  }
}

export async function shadeSheet(src,dst,cell,forca){
  const {data,info}=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const [cw,ch]=cell,cols=Math.floor(info.width/cw),rows=Math.floor(info.height/ch);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)shadeCell(data,info.width,c*cw,r*ch,cw,ch,forca);
  mkdirSync(dirname(dst),{recursive:true});
  await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).webp({lossless:true}).toFile(dst);
}

async function main(){
  const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(`--${k}`);return i>=0?args[i+1]:d;};
  const forca=Number(opt('forca','2'));if(!FORCAS[forca])throw new Error('--forca 1|2|3');
  const fonte=opt('fonte','lite'),saida=opt('saida',`public/art/estudo/pseudo-b${forca}`);
  const manifest=JSON.parse(readFileSync('public/art/manifest.json','utf8')),pieces=manifest.groups.inimigos.pieces;
  const ids=args.includes('--todos')?Object.keys(pieces):(opt('ids','')||'').split(',').filter(Boolean);
  if(!ids.length)throw new Error('--ids a,b,c ou --todos');
  let n=0;const t0=Date.now();
  for(const id of ids){
    const piece=pieces[id];if(!piece){console.warn('sem peça',id);continue;}
    for(const file of Object.values(piece.files))for(const page of file.pages??[{file:file.file}]){
      const lite=fonte==='lite'&&Array.isArray(file.liteCell);
      const src=join(lite?'public/art/lite/enemies':'public/art/enemies',page.file);
      if(!existsSync(src))continue;
      await shadeSheet(src,join(saida,page.file),lite?file.liteCell:file.cell,forca);n++;
    }
  }
  console.log(`pseudo-sombra força ${forca} (${fonte}): ${n} folhas de ${ids.length} inimigos em ${((Date.now()-t0)/1000).toFixed(1)} s → ${saida}`);
}
if(import.meta.url===`file:///${process.argv[1].replace(/\\/g,'/')}`||process.argv[1]?.endsWith('pseudo-sombra.mjs'))await main();
