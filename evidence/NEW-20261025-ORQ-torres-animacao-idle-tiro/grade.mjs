// Annotation aid: the 8 directions of a weapon idle sheet (frame 0) with a 10×10 grid (0..10 on each side, cell
// fractions ×10) to read the muzzle by eye. node grade.mjs <kind> <out.png>
import sharp from 'sharp';import {readFileSync} from 'node:fs';import {join} from 'node:path';
sharp.cache(false);
const [,,k,out]=process.argv;const f=JSON.parse(readFileSync('public/art/towers/manifest.json','utf8')).pieces[k].files.idle,pg=f.pages[0],[cw,ch]=f.cell,S=300;
const names=['S','SW','W','NW','N','NE','E','SE'],cells=[];
for(let d=0;d<8;d++){const i=d*f.frames;
  const b=await sharp(join('public/art/towers',pg.file)).extract({left:(i%pg.columns)*cw,top:Math.floor(i/pg.columns)*ch,width:cw,height:ch}).resize(S,S).png().toBuffer();
  let g='';for(let j=0;j<=10;j++){const p=j*S/10;g+=`<line x1="${p}" y1="0" x2="${p}" y2="${S}" stroke="#0aa" stroke-width="${j%5?0.6:1.4}"/><line x1="0" y1="${p}" x2="${S}" y2="${p}" stroke="#0aa" stroke-width="${j%5?0.6:1.4}"/>`;
    if(j<10)g+=`<text x="${p+2}" y="11" font-size="10" fill="#044">${j}</text><text x="2" y="${p+11}" font-size="10" fill="#044">${j}</text>`;}
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${g}<text x="${S-34}" y="${S-6}" font-size="18" font-weight="700" fill="#c00">${names[d]}</text></svg>`);
  cells.push(await sharp(await sharp({create:{width:S,height:S,channels:4,background:'#e0e0e0'}}).composite([{input:b},{input:svg}]).png().toBuffer()).png().toBuffer());}
await sharp({create:{width:4*S,height:2*S,channels:3,background:'#fff'}}).composite(cells.map((b,d)=>({input:b,left:(d%4)*S,top:Math.floor(d/4)*S}))).png().toFile(out);
