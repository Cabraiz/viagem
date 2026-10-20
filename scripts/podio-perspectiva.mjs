// The character screen's podium seen from another camera height (danca-no-podio, 17/10): podio-600.webp re-projected
// as a cylinder, column by column around its top's ellipse, the top scaled by kb and the wall by kh (an orthographic
// tilt: kb < 1 lowers the camera, more of the wall; kb > 1 raises it). No new drawing, the same stones.
// Prints the new aspect and where the old --feet (0.42) and dancer sole (0.478) land in the new height.
//   node scripts/podio-perspectiva.mjs <top centre y> <top semi-axis> <wall px> <kb> <kh> <out.webp>
//   podio-lado-600.webp (approved by the user): node scripts/podio-perspectiva.mjs 122 121 127 .75 1.05 public/art/ui-extra/podio-lado-600.webp
import sharp from 'sharp';
const [yc,b,h,kb,kh,out]=[+process.argv[2],+process.argv[3],+process.argv[4],+process.argv[5],+process.argv[6],process.argv[7]];
const {data,info}=await sharp('public/art/ui-extra/podio-600.webp').ensureAlpha().raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height,cx=W/2,a=W/2,b2=b*kb,yc2=yc-b+b2;
const src=new Float32Array(W*H*4);for(let i=0;i<W*H;i++){const al=data[i*4+3]/255;src[i*4]=data[i*4]*al;src[i*4+1]=data[i*4+1]*al;src[i*4+2]=data[i*4+2]*al;src[i*4+3]=data[i*4+3];}
const H2=Math.ceil(yc2+b2+(H-(yc+b))*kh)+1;
const dst=Buffer.alloc(W*H2*4);
for(let x=0;x<W;x++){
  const q=Math.sqrt(Math.max(0,1-((x+.5-cx)/a)**2)),s0=yc-b*q,s1=yc+b*q,o0=yc2-b2*q,o1=yc2+b2*q;
  for(let y=0;y<H2;y++){
    const sy=y<o0?s0-(o0-y)/kb:y<=o1?s0+(y-o0)/kb:s1+(y-o1)/kh;
    if(sy<0||sy>H-1)continue;
    const y0=Math.floor(sy),y1=Math.min(H-1,y0+1),t=sy-y0,o=(y*W+x)*4;
    const A=src[(y0*W+x)*4+3]*(1-t)+src[(y1*W+x)*4+3]*t;if(A<1)continue;
    for(let c=0;c<3;c++)dst[o+c]=Math.min(255,Math.round((src[(y0*W+x)*4+c]*(1-t)+src[(y1*W+x)*4+c]*t)*255/A));
    dst[o+3]=Math.round(A);
  }
}
await sharp(dst,{raw:{width:W,height:H2,channels:4}}).webp({quality:92,alphaQuality:100,effort:6}).toFile(out);
const map=f=>{const s=f*H;const y=s<=yc+b?1+(s-1)*kb:yc2+b2+(s-(yc+b))*kh;return (y/H2).toFixed(4);};
console.log(JSON.stringify({W,H2,aspect:(H2/W).toFixed(4),feet042:map(.42),sole0478:map(.478)}));
