// node print.cjs <antes|depois> <url> [dpr] [hero to tap]: the menu at the PC, the phone on its side and upright.
const {chromium}=require('D:/Gits/viagem-tools/node_modules/playwright');
const path=require('path');
const [,,tag,url,dpr='2',hero]=process.argv;
const VIEWS=[['pc-1280x720',1280,720,false],['deitado-844x390',844,390,true],['em-pe-390x844',390,844,true]];
(async()=>{
  const browser=await chromium.launch();
  try{
    for(const [name,width,height,mobile] of VIEWS){
      const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:Number(dpr),isMobile:mobile,hasTouch:mobile});
      await page.goto(url,{waitUntil:'load',timeout:30000});
      await page.waitForTimeout(3500);
      if(hero&&!name.startsWith('em-pe')){await page.click(`.class-card[data-hero="${hero}"]`);await page.waitForTimeout(2500);}
      const tiles=await page.$$eval('.class-card',b=>b.map(x=>`${x.dataset.hero}:${x.querySelector('img')?.currentSrc?.split('/').pop()||x.textContent.trim()||'-'}`));
      console.log(name,tiles.join(' '));
      await page.screenshot({path:path.join(__dirname,'prints',`${tag}-${name}.png`)});
      await page.close();
    }
  }finally{await browser.close();}
})();
