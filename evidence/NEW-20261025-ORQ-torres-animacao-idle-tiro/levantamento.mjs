// Levantamento: per B/C tower, base "pronta" + idle (direction 2) + fire (direction 2), each cell trimmed to the
// union bbox of its row so the motion between frames stays visible.
import {createRequire} from 'node:module';const sharp=createRequire('D:/Gits/viagem/node_modules/')('sharp');
import {readFileSync} from 'node:fs';
const dir=process.argv[2],out=process.argv[3];const T=JSON.parse(readFileSync(dir+'/manifest.json','utf8')).groups.torres.pieces;
const kinds=[['rojao-de-festa','B2 Rojão'],['morteiro','B3 Morteiro'],['lanca-foguetes','B4 Lança-Foguetes'],['obuseiro','B5 Obuseiro'],
  ['holofote','C2 Holofote'],['arame-e-sirene','C3 Arame e Sirene'],['antiaerea-quadrupla','C4 Antiaérea'],['posto-de-radar','C5 Radar']];
const D=2,RH=130,GAP=6,LW=210;
const cellOf=async(file,c,cols,i,row)=>sharp(file).extract({left:(i%cols)*c[0],top:(row??Math.floor(i/cols))*c[1],width:c[0],height:c[1]}).png().toBuffer();
async function strip(k,name){const f=T[k].files[name],c=f.cell;const bufs=[];for(let i=0;i<f.frames;i++)bufs.push(await cellOf(`${dir}/${k}-${name}.webp`,c,f.frames,i,D));
  // union bbox
  let x0=1e9,y0=1e9,x1=0,y1=0;for(const b of bufs){const {info}=await sharp(b).trim({threshold:1}).toBuffer({resolveWithObject:true});const l=-info.trimOffsetLeft,t=-info.trimOffsetTop;x0=Math.min(x0,l);y0=Math.min(y0,t);x1=Math.max(x1,l+info.width);y1=Math.max(y1,t+info.height);}
  const w=x1-x0,h=y1-y0,k2=RH/h;return Promise.all(bufs.map(b=>sharp(b).extract({left:x0,top:y0,width:w,height:h}).resize({height:RH}).png().toBuffer())).then(a=>({imgs:a,w:Math.round(w*k2)}));}
const svg=(t,w,h,size=20,bold=true)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="4" y="${size+4}" font-family="Segoe UI,Arial" font-size="${size}" font-weight="${bold?700:400}" fill="#102027">${t}</text></svg>`);
const comp=[];let y=40,W=0;
comp.push({input:svg('Torres B/C hoje: base pronta · idle (4 quadros, 4 fps) · atirando (fire, 12 fps) — direção 2, quadro a quadro',1900,36,24),left:10,top:4});
for(const [k,lab] of kinds){const f=T[k].files.base;const i=f.rows.indexOf('pronta')*f.views;const pg=f.pages[0];
  const base=await sharp(await cellOf(`${dir}/${k}-base.webp`,f.cell,pg.columns,i)).trim({threshold:1}).resize({height:RH,width:RH*1.6,fit:'inside'}).png().toBuffer({resolveWithObject:true});
  comp.push({input:svg(lab,LW,60),left:10,top:y+10},{input:svg(`fire ${T[k].files.fire.frames} q · idle ${T[k].files.idle.frames} q`,LW,40,15,false),left:10,top:y+44});
  let x=LW;comp.push({input:base.data,left:x,top:y});x+=base.info.width+30;
  for(const name of ['idle','fire']){const s=await strip(k,name);for(const b of s.imgs){comp.push({input:b,left:x,top:y});x+=s.w+GAP;}x+=30;}
  W=Math.max(W,x);y+=RH+16;}
await sharp({create:{width:W,height:y,channels:3,background:'#cfd8dc'}}).composite(comp).png().toFile(out);console.log(W,y);
