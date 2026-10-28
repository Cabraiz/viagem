import {createRequire} from 'node:module';const sharp=createRequire('D:/Gits/viagem/node_modules/')('sharp');
import {readFileSync} from 'node:fs';
const dir=process.argv[2];const T=JSON.parse(readFileSync(dir+'/manifest.json','utf8')).groups.torres.pieces;
const kinds=['rojao-de-festa','morteiro','lanca-foguetes','obuseiro','holofote','arame-e-sirene','antiaerea-quadrupla','posto-de-radar'];
async function frames(k,name){const f=T[k].files[name],c=f.cell[0],n=f.frames;const {data,info}=await sharp(`${dir}/${k}-${name}.webp`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const W=info.width;const out=[];for(let d=0;d<8;d++){const row=[];for(let i=0;i<n;i++){const a=new Uint8Array(c*c*4);for(let y=0;y<c;y++)a.set(data.subarray(((d*c+y)*W+i*c)*4,((d*c+y)*W+i*c+c)*4),y*c*4);row.push(a);}out.push(row);}return {c,n,out};}
function stats(a,b,c){let diff=0,px=0;for(let i=0;i<a.length;i+=4){const A=a[i+3]>40,B=b[i+3]>40;if(A||B){px++;if(A!==B||Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>60)diff++;}}return px?diff/px:0;}
function bbox(a,c){let x0=c,y0=c,x1=-1,y1=-1;for(let y=0;y<c;y++)for(let x=0;x<c;x++)if(a[(y*c+x)*4+3]>40){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return [x0,y0,x1,y1];}
// islands: connected components (4-neigh) of alpha>40 bigger than 3 px, besides the largest
function islands(a,c){const seen=new Uint8Array(c*c);let comps=[];for(let s=0;s<c*c;s++){if(seen[s]||a[s*4+3]<=40)continue;let n=0;const st=[s];seen[s]=1;while(st.length){const p=st.pop();n++;const x=p%c,y=(p/c)|0;for(const q of [x>0?p-1:-1,x<c-1?p+1:-1,y>0?p-c:-1,y<c-1?p+c:-1])if(q>=0&&!seen[q]&&a[q*4+3]>40){seen[q]=1;st.push(q);}}comps.push(n);}comps.sort((x,y)=>y-x);return comps.slice(1).filter(n=>n>3).length;}
console.log('torre | folha | quadros | troca média entre quadros (%) | máx | base anda (px, pé do bbox) | ilhas máx');
for(const k of kinds)for(const name of ['idle','fire']){const {c,n,out}=await frames(k,name);let sum=0,cnt=0,mx=0,move=0,isl=0;
  for(const row of out){const b0=bbox(row[0],c);for(let i=0;i<n;i++){const j=(i+1)%n;const s=stats(row[i],row[j],c);sum+=s;cnt++;mx=Math.max(mx,s);const b=bbox(row[i],c);move=Math.max(move,Math.abs(b[3]-b0[3]));isl=Math.max(isl,islands(row[i],c));}}
  console.log(`${k} | ${name} | ${n} | ${(100*sum/cnt).toFixed(1)} | ${(100*mx).toFixed(1)} | ${move} | ${isl}`);}
