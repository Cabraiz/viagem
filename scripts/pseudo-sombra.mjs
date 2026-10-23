// Pseudo-sombra V6b3 (cards NEW-20261022-ORQ-estudo-inimigos-flutuando, NEW-20261023-ORQ-sombra-v6b3-sem-circulo): bakes a
// Myth-like self-shading into the enemy sheets that already exist, with no new art. Per cell: a normal guessed from the
// silhouette (distance to the alpha edge, smoothed, read as a dome), the map's fixed sun (render/light.ts SUN_VIEW: upper
// left) → the far side darker and the near side a touch lighter, and an occlusion gradient over the feet. Alpha is never
// changed (contour and islands stay as approved); the outer edge (the rim) keeps its colour. Deterministic.
//
//   node scripts/pseudo-sombra.mjs --forca 1|2|3 [--ids a,b,c | --todos]
//   node scripts/art-lite.mjs --kinds enemies      (then: the lite copies come from the shaded sheets)
//
// Shades public/art/enemies/<page> in place (lossless WebP, as the art-v2 import writes them) and updates the sha256 of
// page, file and piece in public/art/enemies/manifest.json. public/art/enemies/pseudo-sombra.json stamps every shaded
// page with its new sha256, so running it again skips them (shading twice would darken twice).
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
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

/** The art-v2 import's encoding for approved sheets (scripts/art-v2/convert.mjs WEBP). */
const LOSSLESS=Object.freeze({lossless:true,effort:6});
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const DIR='public/art/enemies',MANIFEST=join(DIR,'manifest.json'),STAMP=join(DIR,'pseudo-sombra.json');

/** Shades a whole sheet (cells of `cell` px) and returns the lossless WebP. */
export async function shadeSheet(src,cell,forca){
  const {data,info}=await sharp(readFileSync(src)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const [cw,ch]=cell,cols=Math.floor(info.width/cw),rows=Math.floor(info.height/ch);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)shadeCell(data,info.width,c*cw,r*ch,cw,ch,forca);
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).webp(LOSSLESS).toBuffer();
}

async function main(){
  const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(`--${k}`);return i>=0?args[i+1]:d;};
  const forca=Number(opt('forca','3'));if(!FORCAS[forca])throw new Error('--forca 1|2|3');
  const manifest=JSON.parse(readFileSync(MANIFEST,'utf8')),pieces=manifest.pieces;
  const stamp=existsSync(STAMP)?JSON.parse(readFileSync(STAMP,'utf8')):{forca,files:{}};
  if(Object.keys(stamp.files).length&&stamp.forca!==forca)throw new Error(`as folhas já têm a força ${stamp.forca}; reimporte a arte antes de trocar`);
  const ids=args.includes('--todos')?Object.keys(pieces):(opt('ids','')||'').split(',').filter(Boolean);
  if(!ids.length)throw new Error('--ids a,b,c ou --todos');
  let n=0,skipped=0;const t0=Date.now();
  for(const id of ids){
    const piece=pieces[id];if(!piece){console.warn('sem peça',id);continue;}
    for(const file of Object.values(piece.files)){
      const pages=file.pages??[{file:file.file}];
      for(const page of pages){
        const src=join(DIR,page.file);if(!existsSync(src))continue;
        // Already shaded: the manifest takes the stamp's hash back (a merge may have brought the unshaded one).
        if(stamp.files[page.file]===sha256(readFileSync(src))){page.sha256=stamp.files[page.file];skipped++;continue;}
        const out=await shadeSheet(src,file.cell,forca);
        writeFileSync(src,out);page.sha256=stamp.files[page.file]=sha256(out);n++;
      }
      // Same rules as scripts/art-v2/convert.mjs: one page → its hash; more → the hash of "<file> <sha256>" lines.
      if(pages.every(p=>p.sha256))file.sha256=pages.length===1?pages[0].sha256:sha256(pages.map(p=>`${p.file} ${p.sha256}`).join('\n'));
    }
    piece.sha256=sha256(Object.entries(piece.files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'));
    writeFileSync(MANIFEST,`${JSON.stringify(manifest,null,2)}\n`);
    writeFileSync(STAMP,`${JSON.stringify({forca,files:Object.fromEntries(Object.entries(stamp.files).sort())},null,1)}\n`);
  }
  console.log(`pseudo-sombra força ${forca}: ${n} folhas sombreadas, ${skipped} já estavam, ${ids.length} inimigos em ${((Date.now()-t0)/1000).toFixed(1)} s`);
}
if(import.meta.url===`file:///${process.argv[1].replace(/\\/g,'/')}`||process.argv[1]?.endsWith('pseudo-sombra.mjs'))await main();
