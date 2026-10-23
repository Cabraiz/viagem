// node gif.mjs <outdir> <WxH> <cena[?extra]> [x,y,w,h] → <outdir>/f00..f19.png (2 s do pulso, 100 ms por quadro)
import {claimSlot} from 'file:///D:/Gits/viagem-wt/contorno-usavel-wc3/tools/vaga.mjs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const [out,size,cena,clipS]=process.argv.slice(2);const [w,h]=size.split('x').map(Number);
const clip=clipS?(([x,y,cw,ch])=>({x,y,width:cw,height:ch}))(clipS.split(',').map(Number)):undefined;
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 gif.mjs'});
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const p=await (await b.newContext({deviceScaleFactor:1,viewport:{width:w,height:h}})).newPage();
  const [name,extra]=cena.split('?');
  await p.goto(`http://127.0.0.1:4207/?foto=${name}${extra?'&'+extra:''}`,{waitUntil:'load',timeout:90000});
  await p.waitForFunction(()=>window.__fotoPronta===true,null,{timeout:120000});
  for(let i=0;i<20;i++){
    await p.evaluate(()=>window.__cidade.step(100));
    await p.screenshot({path:`${out}/f${String(i).padStart(2,'0')}.png`,clip});
  }
  console.log('ok');
}finally{await b.close();release();}
