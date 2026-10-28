import {createRequire} from 'node:module';const sharp=createRequire('D:/Gits/viagem/node_modules/')('sharp');
import {readFileSync} from 'node:fs';
const dir=process.argv[2];const T=JSON.parse(readFileSync(dir+'/manifest.json','utf8')).groups.torres.pieces;
const kinds=['rojao-de-festa','morteiro','lanca-foguetes','obuseiro','holofote','arame-e-sirene','antiaerea-quadrupla','posto-de-radar'];
// Alpha masks per frame; for consecutive frames: best integer shift (|d|<=4) by alpha IoU, IoU before/after.
async function load(k,name){const f=T[k].files[name],c=f.cell[0];const {data,info}=await sharp(`${dir}/${k}-${name}.webp`).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {c,n:f.frames,W:info.width,data};}
const A=(s,d,i,x,y)=>{if(x<0||y<0||x>=s.c||y>=s.c)return 0;return s.data[((d*s.c+y)*s.W+i*s.c+x)*4+3]>40?1:0;};
function iou(s,d,i,j,dx,dy){let I=0,U=0;for(let y=0;y<s.c;y+=1)for(let x=0;x<s.c;x+=1){const a=A(s,d,i,x,y),b=A(s,d,j,x+dx,y+dy);I+=a&b;U+=a|b;}return U?I/U:1;}
console.log('torre | folha | IoU silhueta entre quadros (média/mín) | tremor (desloc. médio px) ');
for(const k of kinds)for(const name of ['idle','fire']){const s=await load(k,name);let sum=0,mn=1,sh=0,cnt=0;
  for(const d of [0,2,5]){for(let i=0;i<s.n;i++){const j=(i+1)%s.n;const v=iou(s,d,i,j,0,0);sum+=v;mn=Math.min(mn,v);
    let best=[v,0,0];for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){if(!dx&&!dy)continue;const w=iou(s,d,i,j,dx,dy);if(w>best[0]+.01)best=[w,dx,dy];}
    sh+=Math.hypot(best[1],best[2]);cnt++;}}
  console.log(`${k} | ${name} | ${(sum/cnt).toFixed(3)} / ${mn.toFixed(3)} | ${(sh/cnt).toFixed(2)}`);}
