// Card torres-animacao-idle-tiro: erases loose specks (< MIN_PX alpha components besides the figure; bleed of a
// neighbour cell at a cell's top or bottom edge) from the delivered weapon sheets; a separate crew member or a rocket in
// flight (> 1000 px) stays. Rewrites only the sheets with >= 20 px erased (a re-encode costs a little). node limpar-ilhas.mjs <kind…> [--check]
import sharp from 'sharp';import {readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
sharp.cache(false);import {join} from 'node:path';
const MIN_PX=200,ALPHA=40;
const args=process.argv.slice(2),check=args.includes('--check'),kinds=args.filter(a=>!a.startsWith('--'));
const T=JSON.parse(readFileSync('public/art/towers/manifest.json','utf8')).pieces;
for(const k of kinds)for(const name of ['idle','fire']){
  const f=T[k]?.files[name];if(!f)continue;
  const pages=f.pages?.length?f.pages:[{file:f.file,columns:f.frames,rows:f.directions,firstFrame:0,frameCount:f.frames*f.directions}];
  for(const pg of pages){
    const file=join('public/art/towers',pg.file),{data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const [cw,ch]=f.cell,W=info.width;let erased=0,specks=0;
    for(let i=0;i<pg.frameCount;i++){
      const ox=(i%pg.columns)*cw,oy=Math.floor(i/pg.columns)*ch,idx=(x,y)=>((oy+y)*W+ox+x)*4;
      const seen=new Uint8Array(cw*ch),comps=[];
      for(let s=0;s<cw*ch;s++){
        if(seen[s]||data[idx(s%cw,(s/cw)|0)+3]<=ALPHA)continue;
        const px=[],st=[s];seen[s]=1;
        while(st.length){const p=st.pop();px.push(p);const x=p%cw,y=(p/cw)|0;
          for(const q of [x>0?p-1:-1,x<cw-1?p+1:-1,y>0?p-cw:-1,y<ch-1?p+cw:-1])if(q>=0&&!seen[q]&&data[idx(q%cw,(q/cw)|0)+3]>ALPHA){seen[q]=1;st.push(q);}}
        comps.push(px);
      }
      comps.sort((a,b)=>b.length-a.length);
      for(const c of comps.slice(1))if(c.length<MIN_PX){specks++;for(const p of c){const j=idx(p%cw,(p/cw)|0);data[j+3]=0;erased++;}
        // the faint rim around it (alpha <= ALPHA) goes too: a 1 px ring
        for(const p of c){const x=p%cw,y=(p/cw)|0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<cw&&Y<ch){const j=idx(X,Y);if(data[j+3]<=ALPHA)data[j+3]=0;}}}}
    }
    console.log(`${pg.file}: ${specks} ilhas, ${erased} px`);
    if(erased>=20&&!check)writeFileSync(file,await sharp(data,{raw:info}).webp({quality:92,alphaQuality:100,effort:6}).toBuffer());
    if(existsSync(file+'.tmp'))rmSync(file+'.tmp');
  }
}
