// Muzzle per direction of each weapon idle sheet (frame 0): the opaque pixel farthest from the anchor along the
// direction (dirVector) within the figure's upper UPPER part. Writes a contact sheet with the marks: node boca.mjs <out.png> [kinds…]
import sharp from 'sharp';import {readFileSync} from 'node:fs';import {join} from 'node:path';
sharp.cache(false);
const T=JSON.parse(readFileSync('public/art/towers/manifest.json','utf8')).pieces;
const KINDS=['rojao-de-festa','morteiro','lanca-foguetes','obuseiro','holofote','antiaerea-quadrupla'],UPPER=.65;
const out=process.argv[2],kinds=process.argv.slice(3).length?process.argv.slice(3):KINDS;
const dirV=d=>{const a=d*Math.PI/4+Math.PI/2;return {x:Math.cos(a),y:Math.sin(a)};};
export async function muzzles(k){
  const f=T[k].files.idle,pg=f.pages[0],[cw,ch]=f.cell,{data,info}=await sharp(join('public/art/towers',pg.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const ax=f.anchor[0]*cw,ay=f.anchor[1]*ch,res=[];
  for(let d=0;d<8;d++){const i=d*f.frames,ox=(i%pg.columns)*cw,oy=Math.floor(i/pg.columns)*ch,v=dirV(d);let best=-1e9,bx=0,by=0;
    // The figure's opaque box; only its upper UPPER part counts (the crew's legs and feet are not the barrel).
    const op=(x,y)=>data[((oy+y)*info.width+ox+x)*4+3]>=128;let y0=ch,y1=0;
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(op(x,y)){y0=Math.min(y0,y);y1=Math.max(y1,y);}
    const cut=y0+UPPER*(y1-y0);
    for(let y=y0;y<=cut;y++)for(let x=0;x<cw;x++){if(!op(x,y))continue;const s=(x-ax)*v.x+(y-ay)*v.y;if(s>best){best=s;bx=x;by=y;}}
    res.push([bx,by]);}
  return {res,f,pg,anchor:[ax,ay]};
}
if(out){
  const S=110,rows=[];
  for(const k of kinds){const {res,f,pg}=await muzzles(k);const [cw,ch]=f.cell;const cells=[];
    for(let d=0;d<8;d++){const i=d*f.frames;const b=await sharp(join('public/art/towers',pg.file)).extract({left:(i%pg.columns)*cw,top:Math.floor(i/pg.columns)*ch,width:cw,height:ch}).png().toBuffer();
      const r=Math.max(3,cw/40),[mx,my]=res[d];
      const mark=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><circle cx="${mx}" cy="${my}" r="${r}" fill="none" stroke="#f0f" stroke-width="${r/2}"/></svg>`);
      cells.push(await sharp(await sharp({create:{width:cw,height:ch,channels:4,background:"#cfd8dc"}}).composite([{input:b},{input:mark}]).png().toBuffer()).resize(S,S).png().toBuffer());}
    rows.push(cells);}
  await sharp({create:{width:8*S,height:rows.length*S,channels:3,background:'#fff'}}).composite(rows.flatMap((r,j)=>r.map((b,d)=>({input:b,left:d*S,top:j*S})))).png().toFile(out);
}
