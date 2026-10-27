/**
 * Minimap art (card NEW-20261025-ORQ-minimapa-arte-chatgpt): builds the shipped files from the ChatGPT sheets kept in
 * evidence/minimapa-arte-chatgpt/ (rostos/rostos-t1.png 3×2 and rostos-2-t1.png 5×2, icones/icones-t1.png 4×3,
 * fundo/fundo-m1-t1.png; for asset v5 fundo/fundo-m2-v5.png, that painting with the opened ground repainted: fundo-v5.ts).
 *   public/art/minimapa/marcas.webp   one row of CELL px cells: the 16 playable heroes' faces (masked to a circle; transparent
 *                                     where the sheet was green, so the team colour drawn under shows), then the 12 icons;
 *   public/art/minimapa/cidade-nevada.webp   the city seen from above, world-aligned, BG px (the minimap turns it),
 *                                     darkened.
 * The order is the one in src/client/hud/wc-minimap/art.ts (MM_FACES, MM_ICONS). Usage: node scripts/minimapa/atlas.mjs
 */
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';

const EV='evidence/minimapa-arte-chatgpt',OUT='public/art/minimapa',CELL=64,BG=512;
mkdirSync(OUT,{recursive:true});

/** Chroma key on the green background: alpha from the green's dominance, the green spill pulled out of the edge. */
async function keyed(path){
  const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],d=g-Math.max(r,b);
    const a=d>90?0:d>30?Math.round(255*(90-d)/60):255;
    data[i+3]=a;if(d>0)data[i+1]=Math.max(r,b)+Math.round(d*(a/255)*.2);
  }
  return {data,w:info.width,h:info.height};
}
/** The alpha's bounding box inside a sheet cell. */
function bbox(img,x0,y0,w,h){
  let x1=x0+w,y1=y0+h,minx=x1,miny=y1,maxx=x0,maxy=y0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(img.data[(y*img.w+x)*4+3]>40){if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}
  return {x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1};
}
const raw=img=>sharp(img.data,{raw:{width:img.w,height:img.h,channels:4}});
/** A sticker's edge: Papel (#fff4d6) `r` px round the figure, under it, so a dark-outlined icon reads on the night map. */
async function sticker(png,r=3){
  const {data}=await sharp(png).raw().toBuffer({resolveWithObject:true}),out=Buffer.alloc(data.length);
  for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
    let a=0;
    for(let dy=-r;dy<=r&&a<255;dy++)for(let dx=-r;dx<=r;dx++){
      const u=x+dx,v=y+dy;if(u<0||v<0||u>=CELL||v>=CELL||dx*dx+dy*dy>r*r+r)continue;
      const k=data[(v*CELL+u)*4+3];if(k>a)a=k;
    }
    const i=(y*CELL+x)*4;out[i]=0xff;out[i+1]=0xf4;out[i+2]=0xd6;out[i+3]=a;
  }
  return sharp(out,{raw:{width:CELL,height:CELL,channels:4}}).composite([{input:png}]).png().toBuffer();
}
/** `part`: per cell index, the share of the figure's box kept from its top (the bank: only its "$" sign reads at 10 px). */
async function cells(path,cols,rows,face,part={}){
  const img=await keyed(path),cw=Math.floor(img.w/cols),ch=Math.floor(img.h/rows),out=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const b=bbox(img,c*cw,r*ch,cw,ch),keep=part[r*cols+c];
    if(keep)b.h=Math.round(b.h*keep);
    let crop;
    if(face){
      // The head and a sliver of shoulders: a square as wide as the figure, from its top.
      const s=Math.min(b.w,b.h),x=Math.max(0,Math.round(b.x+b.w/2-s/2));
      crop={left:x,top:b.y,width:s,height:Math.min(s,img.h-b.y)};
    }else{const s=Math.max(b.w,b.h);crop={left:Math.max(0,Math.round(b.x+b.w/2-s/2)),top:Math.max(0,Math.round(b.y+b.h/2-s/2)),width:s,height:s};
      crop.width=Math.min(crop.width,img.w-crop.left);crop.height=Math.min(crop.height,img.h-crop.top);}
    // Icons leave room for their sticker edge.
    const fit=face?CELL:CELL-8;
    let buf=await raw(img).extract(crop).resize(fit,fit,{fit:'contain',background:{r:0,g:0,b:0,alpha:0},kernel:'lanczos3'})
      .extend({top:(CELL-fit)/2,bottom:(CELL-fit)/2,left:(CELL-fit)/2,right:(CELL-fit)/2,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    if(!face)buf=await sticker(buf);
    if(face){
      const mask=Buffer.from(`<svg width="${CELL}" height="${CELL}"><circle cx="${CELL/2}" cy="${CELL/2}" r="${CELL/2}" fill="#fff"/></svg>`);
      buf=await sharp(buf).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
    }
    out.push(buf);
  }
  return out;
}
const all=[...await cells(`${EV}/rostos/rostos-t1.png`,3,2,true),...await cells(`${EV}/rostos/rostos-2-t1.png`,5,2,true),...await cells(`${EV}/icones/icones-t1.png`,4,3,false,{2:.6})];
await sharp({create:{width:CELL*all.length,height:CELL,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
  .composite(all.map((input,i)=>({input,left:i*CELL,top:0}))).webp({quality:85,alphaQuality:90,effort:6}).toFile(`${OUT}/marcas.webp`);
// Night: darker and a little greyer than the painting, so the marks on top stand out at 124 px.
await sharp(`${EV}/fundo/fundo-m2-v5.png`).resize(BG,BG,{kernel:'lanczos3'}).modulate({brightness:.72,saturation:.8}).webp({quality:82,effort:6}).toFile(`${OUT}/cidade-nevada.webp`);
console.log(JSON.stringify({cells:all.length,cell:CELL,bg:BG}));
