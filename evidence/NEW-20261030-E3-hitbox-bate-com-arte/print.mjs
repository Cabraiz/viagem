// Composite (not the live scene) of hitbox-bate-com-arte: 390×844 CSS at DPR 3, the city's zoom on that phone
// (rules zoomFor: 63.64 CSS px per unit), each idle frame at its game size with its body ellipse (2r wide, r tall).
// node evidence/NEW-20261030-E3-hitbox-bate-com-arte/print.mjs <art dir> <out.png>
import {createRequire} from 'node:module';
const sharp=createRequire(process.cwd()+'/package.json')('sharp');
const [art,out]=process.argv.slice(2),DPR=3,PPU=63.636*DPR,V=0.5445,U=42*Math.SQRT2;
const H=[['viciado','sprites/viciado-em-bet.idle16-s.ee01578e879c.webp'],['clt','sprites/clt-cansado.idle16-s.c6aba328d725.webp'],['gato','sprites/gato-nada-pra-comer.idle16-s.054f6df3e766.webp'],
  ['maromba','sprites/maromba.idle16-s.5d112d66dfd2.webp'],['vendedor','sprites/vendedor-praia.idle16-s.92f9ba81ef42.webp'],['aposentado','sprites/aposentado.idle16-s.f9f4da098fe1.webp']];
// [id, file, cell, figure cell px, radius u, world px of the figure at main / escala]
const rows=[
  ...H.map(([id,f])=>({id,f,cell:96,r:.22,px:s=>96*s.h})),
  {id:'mendigo',f:'enemies/mendigo/idle.webp',cell:192,fig:153,r:.368,px:s=>96*.9*s.e},
  {id:'saci',f:'enemies/saci/idle.webp',cell:256,fig:133,r:.759,row:1,px:s=>96*1.4*s.h},
];
const W=390*DPR,HT=844*DPR,layers=[];let svg='';
const bands=[{label:'main (heroi 0.8, inimigo 1.15)',s:{h:.8,e:1.15},y0:40},{label:'escala (1.5 / 1.5)',s:{h:1.5,e:1.5},y0:440}];
for(const b of bands){
  svg+=`<text x="${12*DPR}" y="${(b.y0+18)*DPR}" font-size="${14*DPR}" font-family="sans-serif" fill="#fff">${b.label}</text>`;
  for(const [i,r] of rows.entries()){
    const col=i%4,line=Math.floor(i/4),cx=(50+col*97)*DPR,feet=(b.y0+(line?300:150))*DPR;
    const src=sharp(`${art}/${r.f}`),meta=await src.metadata();
    const frame=await sharp(`${art}/${r.f}`).extract({left:0,top:(r.row??0)*r.cell,width:r.cell,height:r.cell}).png().toBuffer();
    const trim=await sharp(frame).trim({threshold:0}).toBuffer({resolveWithObject:true});
    const figCell=r.fig??r.cell,k=r.px(b.s)/figCell*V/U*PPU; // screen px per cell px
    const w=Math.max(1,Math.round(trim.info.width*k)),h=Math.max(1,Math.round(trim.info.height*k));
    const img=await sharp(trim.data).resize(w,h).toBuffer();
    layers.push({input:img,left:Math.round(cx-w/2),top:Math.round(feet-h)});
    const rx=r.r*PPU,ry=rx/2;
    svg+=`<ellipse cx="${cx}" cy="${feet}" rx="${rx}" ry="${ry}" fill="rgba(255,60,60,.25)" stroke="#ff4040" stroke-width="${DPR}"/>`;
    svg+=`<text x="${cx}" y="${feet+ry+16*DPR}" font-size="${11*DPR}" text-anchor="middle" font-family="sans-serif" fill="#ddd">${r.id}</text>`;
  }
}
svg+=`<text x="${12*DPR}" y="${830*DPR}" font-size="${10*DPR}" font-family="sans-serif" fill="#999">montagem fora do jogo · zoom da cidade em 390×844 · elipse = corpo (2r)</text>`;
const over=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HT}">${svg}</svg>`);
await sharp({create:{width:W,height:HT,channels:4,background:'#3a4048'}}).composite([...layers,{input:over,left:0,top:0}]).png().toFile(out);
console.log(out);
