// Mede, por folha, a altura da figura e a largura do contorno no tronco e nos pés (alpha >= 128), mediana dos quadros.
import {createRequire} from 'node:module';const sharp=createRequire('D:/Gits/viagem/package.json')('sharp');
const [file,cell,maxRows]=[process.argv[2],+process.argv[3],+(process.argv[4]||99)];
const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const cols=info.width/cell,rows=Math.min(info.height/cell,maxRows),med=a=>{a=[...a].sort((x,y)=>x-y);return a[a.length>>1]};
const out=[];
for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const span=y=>{let l=-1,rr=-1;for(let x=0;x<cell;x++){const i=((r*cell+y)*info.width+c*cell+x)*4+3;if(data[i]>=128){if(l<0)l=x;rr=x;}}return l<0?0:rr-l+1;};
  let top=-1,bot=-1;for(let y=0;y<cell;y++)if(span(y)){if(top<0)top=y;bot=y;}
  if(top<0)continue;const H=bot-top+1;
  const torso=[];for(let y=Math.round(bot-.6*H);y<=Math.round(bot-.45*H);y++)torso.push(span(y));
  let foot=0;for(let y=Math.round(bot-.12*H);y<=bot;y++)foot=Math.max(foot,span(y));
  out.push({H,torso:med(torso),foot});
}
const H=med(out.map(o=>o.H)),T=med(out.map(o=>o.torso)),F=med(out.map(o=>o.foot));
console.log(JSON.stringify({file:file.split(/[\/]/).pop(),frames:out.length,H,torso:T,foot:F,torsoH:+(T/H).toFixed(3),footH:+(F/H).toFixed(3)}));
