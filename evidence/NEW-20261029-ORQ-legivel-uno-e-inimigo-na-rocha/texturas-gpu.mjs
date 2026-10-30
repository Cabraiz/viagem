// Texturas WebGL vivas (criadas − apagadas) numa cena do modo foto, 390x844: o anel do Uno não pode criar textura.
//   node texturas-gpu.mjs <site> <cena[,cena]>
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const {chromium}=createRequire('D:/Gits/viagem-tools/package.json')('playwright');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [SITE,CENAS]=process.argv.slice(2);
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E5 texturas anel'});
const browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
  for(const cena of CENAS.split(',')){
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
    await page.addInitScript(()=>{const c={vivas:0,bytes:0};window.__tex=c;
      for(const P of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
        const cr=P.createTexture,de=P.deleteTexture;P.createTexture=function(){c.vivas++;return cr.call(this);};P.deleteTexture=function(t){if(t)c.vivas--;return de.call(this,t);};}});
    await page.goto(`${SITE}/?foto=${cena}`,{waitUntil:'domcontentloaded',timeout:300000});
    await page.waitForFunction(()=>window.__fotoPronta||window.__fotoErro,null,{timeout:120000});
    await page.waitForTimeout(1500);
    console.log(cena,JSON.stringify(await page.evaluate(()=>({...window.__tex,erro:window.__fotoErro??null}))));
    await page.close();
  }
}finally{await browser.close();release();}
