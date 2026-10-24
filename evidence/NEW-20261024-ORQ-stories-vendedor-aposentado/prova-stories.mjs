// Proof of the Vendedor and Aposentado stories on the phone upright (NEW-20261024-ORQ-stories-vendedor-aposentado):
// one PNG per story plus a video of the profile opening each hero's stories.
//   node prova-stories.mjs <url> <out-dir> [width height]
// Takes the browser slot (viagem-board/locks/browser-N) itself; DPR 1, one page, swiftshader.
import {mkdirSync,rmSync,writeFileSync,renameSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('D:/Gits/viagem-tools/node_modules/playwright');

const [url,out,w='390',h='844']=process.argv.slice(2);
mkdirSync(out,{recursive:true});
const LOCKS='D:/Gits/viagem-board/locks/';
let vaga;
for(let t=0;!vaga;t++){
  for(const v of ['browser-2','browser-1']){
    try{mkdirSync(LOCKS+v);writeFileSync(LOCKS+v+'/dono.json',JSON.stringify({label:'E2 prova stories vendedor/aposentado',pid:process.pid,at:new Date().toISOString()}));vaga=v;break;}catch{}
  }
  if(!vaga){if(t>120)throw new Error('sem vaga de navegador');await new Promise(r=>setTimeout(r,5000));}
}
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const size={width:+w,height:+h};
  const ctx=await browser.newContext({viewport:size,deviceScaleFactor:1,isMobile:true,hasTouch:true,recordVideo:{dir:out,size}});
  const page=await ctx.newPage();
  await page.goto(url,{waitUntil:'load',timeout:120000});
  await page.waitForSelector('.insta-foto',{timeout:30000});
  await page.waitForTimeout(1500);
  for(const hero of ['vendedor-praia','aposentado']){
    // The rings row is an endless carousel moved by transform: tap the copy on screen, or click it directly.
    const tocou=await page.evaluate(h=>{
      const aneis=[...document.querySelectorAll(`.insta-story[data-hero="${h}"]`)];
      if(!aneis.length)throw new Error(`sem anel do ${h}`);
      const vw=innerWidth,dentro=aneis.find(a=>{const r=a.getBoundingClientRect();return r.left>=0&&r.right<=vw;});
      if(dentro){const r=dentro.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}
      aneis[0].click();return null;
    },hero);
    if(tocou)await page.mouse.click(tocou.x,tocou.y);
    await page.waitForTimeout(1500);
    await page.screenshot({path:`${out}/${hero}-perfil.png`});
    await page.locator('.insta-foto-botao').click();
    const n=await page.locator('.insta-sv-story').count();
    for(let k=0;k<n;k++){
      await page.waitForFunction(i=>{const f=document.querySelectorAll('.insta-sv-story img')[i];return f&&f.complete&&f.naturalWidth>0;},k,{timeout:30000});
      await page.waitForTimeout(1800);
      await page.screenshot({path:`${out}/${hero}-${k+1}.png`});
      await page.keyboard.press('ArrowRight');
    }
    await page.waitForTimeout(800);
    if(await page.locator('.insta-sv-story').count())await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    console.log(hero,n);
  }
  const video=page.video();
  await ctx.close();
  if(video)renameSync(await video.path(),`${out}/stories-vendedor-aposentado.webm`);
}finally{
  await browser.close();
  rmSync(LOCKS+vaga,{recursive:true,force:true});
}
