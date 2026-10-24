// Prints of every hero's stories on the phone upright (BUG-20261024-ORQ-stories-texto-estilo-instagram): one PNG per story.
//   node print-stories.mjs <url> <out-dir> [width height]
// Takes the browser slot (viagem-board/locks/browser-N) itself; DPR 1, one page.
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('D:/Gits/viagem-tools/node_modules/playwright');

const [url,out,w='412',h='915']=process.argv.slice(2);
mkdirSync(out,{recursive:true});
const LOCKS='D:/Gits/viagem-board/locks/';
let vaga;
for(let t=0;!vaga;t++){
  for(const v of ['browser-1','browser-2']){
    try{mkdirSync(LOCKS+v);writeFileSync(LOCKS+v+'/dono.json',JSON.stringify({label:'E2 prints stories',pid:process.pid,at:new Date().toISOString()}));vaga=v;break;}catch{}
  }
  if(!vaga){if(t>120)throw new Error('sem vaga de navegador');await new Promise(r=>setTimeout(r,5000));}
}
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:+w,height:+h},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  for(const hero of ['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba']){
    await page.goto(url,{waitUntil:'load',timeout:60000});
    await page.waitForSelector('.insta-foto',{timeout:30000});
    await page.waitForTimeout(1200);
    const anel=page.locator(`.insta-story[data-hero="${hero}"]`);
    if(await anel.count()){await anel.first().click();await page.waitForTimeout(800);}
    await page.locator('.insta-foto-botao').click();
    const n=await page.locator('.insta-sv-story').count();
    for(let k=0;k<n;k++){
      await page.waitForFunction(i=>{const f=document.querySelectorAll('.insta-sv-story img')[i];return f&&f.complete&&f.naturalWidth>0;},k,{timeout:30000});
      await page.waitForTimeout(900);
      await page.screenshot({path:`${out}/${hero}-${k+1}.png`});
      await page.keyboard.press('ArrowRight');
    }
    console.log(hero,n);
  }
}finally{
  await browser.close();
  rmSync(LOCKS+vaga,{recursive:true,force:true});
}
