// Prints e GIF da aura do Defumador (card NEW-20261029-ORQ-aura-defumador-fumaca) no sandbox da cidade, celular retrato.
//   node prints.mjs <porta> <rótulo antes|depois> [x,y da calçada] [x,y da neve]
// Saída: <rótulo>-parado-<lugar>.png, <rótulo>-andando-<lugar>.png e, com quadros, <rótulo>-quadros/ (o GIF sai do ffmpeg).
import {mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
import {createRequire} from 'node:module';
const sharp=createRequire('D:/Gits/viagem-wt/aura-defumador-fumaca/package.json')('sharp');
const OUT=dirname(fileURLToPath(import.meta.url));
const [porta,rot,...lugares]=process.argv.slice(2);
const url=`http://localhost:${porta}/?sandbox=cidade&mapa=real&tele=1&arsenal=1&aura=2&limpo=1&n=0&arma=pistola`;
const browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  page.on('pageerror',e=>console.error('pageerror',e.message));
  await page.goto(url,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.__cidade?.ground?.(),null,{timeout:90000});
  await page.waitForTimeout(2500);
  const start=await page.evaluate(()=>({x:window.__cidade.at.x,y:window.__cidade.at.y}));
  await page.evaluate(()=>window.__cidade.freeze());
  const run=(n,from,dx,dy)=>page.evaluate(({n,x,y,dx,dy})=>{const c=window.__cidade;for(let i=0;i<n;i++){c.move(x+i*dx,y+i*dy);c.step(1000/60);}},{n,...from,dx,dy});
  // Sem pontos dados: procura em volta do início um chão de calçada (#B5ADA7) e um de neve (claro e frio), pela cor
  // média de uma faixa abaixo do herói, fora da aura.
  let spots=lugares.length?lugares.map(s=>{const [x,y]=s.split(',').map(Number);return {x,y};}):undefined;
  if(!spots){
    const found={};
    const ground=async()=>{const vp=page.viewportSize(),buf=await page.screenshot({clip:{x:vp.width/2-150,y:vp.height/2+95,width:300,height:40}});
      const {data,info}=await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject:true});let r=0,g=0,b=0,n=info.width*info.height,sd=0;
      for(let i=0;i<data.length;i+=3){r+=data[i];g+=data[i+1];b+=data[i+2];}r/=n;g/=n;b/=n;
      for(let i=0;i<data.length;i+=3)sd+=Math.abs(data[i]-r);return {r,g,b,sd:sd/n};};
    outer:for(let d=0;d<=24;d+=3)for(let a=0;a<8;a++){
      const s={x:start.x+Math.cos(a*Math.PI/4)*d,y:start.y+Math.sin(a*Math.PI/4)*d};
      await run(6,s,0,0);const c=await ground(),lum=(c.r+c.g+c.b)/3;
      if(!found.calcada&&Math.abs(c.r-181)<22&&Math.abs(c.g-173)<22&&Math.abs(c.b-167)<22&&c.sd<30)found.calcada=s;
      if(!found.neve&&lum>205&&c.b>=c.r-4&&c.sd<20)found.neve=s;
      console.log(JSON.stringify({d,a,c:[c.r,c.g,c.b].map(Math.round),sd:Math.round(c.sd)}));
      if(found.calcada&&found.neve)break outer;
      if(d===0)break;
    }
    console.log('pontos',JSON.stringify(found));
    spots=[found.calcada??start,found.neve??start];
  }
  for(const [k,s] of spots.entries()){
    const name=`${rot}-${k===0?'calcada':'neve'}`;
    await run(90,s,0,0);
    await page.screenshot({path:join(OUT,`${name}-parado.png`)});
    // 3 s a 15 quadros/s: 1,5 s parado e 1,5 s andando em linha reta (relógio exato: freeze + step de 1/60 s).
    const dir=join(OUT,`${name}-quadros`);if(k===0)mkdirSync(dir,{recursive:true});
    for(let f=0;f<45;f++){
      const walking=f>=22,from=walking?{x:s.x+(f-22)*4*.025,y:s.y+(f-22)*4*.012}:s;
      await run(4,from,walking?.025:0,walking?.012:0);
      if(k===0)await page.screenshot({path:join(dir,`${String(f).padStart(3,'0')}.png`)});
      if(f===40)await page.screenshot({path:join(OUT,`${name}-andando.png`)});
    }
  }
}finally{await browser.close();}
