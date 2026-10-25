/**
 * Igualdade do fundo gerado com o mapa real (card NEW-20261025-ORQ-minimapa-arte-chatgpt, etapa 4): IoU da máscara do
 * sólido (prédios, muros: onde não se anda) depois de alinhar. A imagem gerada vira cinza, o limiar é o de Otsu (o sólido
 * é o lado escuro), e procura-se a escala e o deslocamento (até ±6 %) que mais sobrepõem com referencia.ts mascara.png.
 * Grava <gerada>-mascara.png e <gerada>-sobreposicao.png (verde = acerto, vermelho = sólido que falta, azul = sobra).
 * Uso: node --experimental-strip-types scripts/minimapa/iou.ts <gerada.png> [mascara.png] [claro=0]
 *   claro=1 quando o sólido da arte é o lado CLARO (telhados de neve).
 */
import sharp from 'sharp';

const [gen,ref='evidence/minimapa-arte-chatgpt/ref/mascara.png',light='0']=process.argv.slice(2);
const N=220;
const grey=async(path:string)=>new Uint8Array((await sharp(path).flatten({background:'#000'}).greyscale().resize(N,N,{fit:'fill'}).raw().toBuffer()));
/** Otsu's threshold of a grey image. */
export function otsu(g:Uint8Array){
  const h=new Array(256).fill(0);for(const v of g)h[v]++;
  let sum=0;for(let i=0;i<256;i++)sum+=i*h[i];
  let sb=0,wb=0,best=0,t=128;
  for(let i=0;i<256;i++){wb+=h[i];if(!wb)continue;const wf=g.length-wb;if(!wf)break;sb+=i*h[i];
    const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)**2;if(v>best){best=v;t=i;}}
  return t;
}
const r=await grey(ref),g=await grey(gen),t=otsu(g);
const want=Uint8Array.from(r,v=>v<128?1:0),have=Uint8Array.from(g,v=>(light==='1'?v>t:v<=t)?1:0);
function iou(s:number,dx:number,dy:number){
  let inter=0,uni=0;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const u=Math.round((x-N/2)*s+N/2+dx),v=Math.round((y-N/2)*s+N/2+dy);
    const b=u>=0&&v>=0&&u<N&&v<N?have[v*N+u]:0,a=want[y*N+x];
    if(a&&b)inter++;if(a||b)uni++;
  }
  return inter/Math.max(1,uni);
}
let best={iou:iou(1,0,0),s:1,dx:0,dy:0};
const m=Math.round(N*.06);
for(let s=.9;s<=1.101;s+=.02)for(let dx=-m;dx<=m;dx+=2)for(let dy=-m;dy<=m;dy+=2){const v=iou(s,dx,dy);if(v>best.iou)best={iou:v,s,dx,dy};}
// Refine around the best at 1 px.
for(let s=best.s-.02;s<=best.s+.021;s+=.005)for(let dx=best.dx-2;dx<=best.dx+2;dx++)for(let dy=best.dy-2;dy<=best.dy+2;dy++){const v=iou(s,dx,dy);if(v>best.iou)best={iou:v,s,dx,dy};}
const img=Buffer.alloc(N*N*3),mk=Buffer.alloc(N*N);
for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const u=Math.round((x-N/2)*best.s+N/2+best.dx),v=Math.round((y-N/2)*best.s+N/2+best.dy);
  const b=u>=0&&v>=0&&u<N&&v<N?have[v*N+u]:0,a=want[y*N+x],i=y*N+x;
  mk[i]=b?0:255;const c=a&&b?[60,170,80]:a?[220,50,50]:b?[60,90,220]:[240,240,240];img.set(c,i*3);
}
const base=gen.replace(/\.(png|webp|jpe?g)$/i,'');
await sharp(mk,{raw:{width:N,height:N,channels:1}}).resize(660,660,{kernel:'nearest'}).png().toFile(`${base}-mascara.png`);
await sharp(img,{raw:{width:N,height:N,channels:3}}).resize(660,660,{kernel:'nearest'}).png().toFile(`${base}-sobreposicao.png`);
console.log(JSON.stringify({gen,threshold:t,iou:+best.iou.toFixed(3),scale:+best.s.toFixed(3),dx:best.dx,dy:best.dy}));
