// node shot.mjs <outdir> <WxH> <cena[?extra]>...
import {claimSlot} from 'file:///D:/Gits/viagem-wt/contorno-usavel-wc3/tools/vaga.mjs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const [out,size,...cenas]=process.argv.slice(2);const [w,h]=size.split('x').map(Number);
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 shot.mjs'});
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const mobile=Math.min(w,h)<=600;
  const ctx=await b.newContext({deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,viewport:{width:w,height:h}});
  for(const c of cenas){
    const [name,extra]=c.split('?');const p=await ctx.newPage();
    p.on('pageerror',e=>console.log('pageerror',name,e.message));
    await p.goto(`http://127.0.0.1:4207/?foto=${name}${extra?'&'+extra:''}`,{waitUntil:'load',timeout:90000});
    await p.waitForFunction(()=>window.__fotoPronta===true,null,{timeout:120000}).catch(()=>console.log('nao ficou pronta',name));
    const f=`${out}/${name}${extra?'-'+extra.replace(/[^a-z0-9]+/gi,'_'):''}-${w}x${h}.png`;
    await p.screenshot({path:f});console.log(f);await p.close();
  }
}finally{await b.close();release();}
