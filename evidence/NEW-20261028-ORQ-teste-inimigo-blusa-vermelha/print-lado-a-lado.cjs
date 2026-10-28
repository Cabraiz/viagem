// Prints: the original bêbado and the red one side by side around the hero (city sandbox, as the game draws).
// The red piece exists only in this test: /art/manifest.json is routed with a copy of bebado's entry.
const {chromium}=require('D:/Gits/viagem-tools/node_modules/playwright');
const fs=require('fs');
const OUT=process.argv[2];
const BASE='http://127.0.0.1:4207';
const CAST='bebado,bebado-vermelho,bebado,bebado-vermelho,bebado,bebado-vermelho';

async function routeManifest(page){
  await page.route('**/art/manifest.json',async route=>{
    const r=await route.fetch();const m=await r.json();
    const g=m.groups.inimigos,b=g.pieces.bebado;
    const files={};
    for(const [k,f] of Object.entries(b.files)){
      if(k.startsWith('elite/'))continue;
      const re=s=>s.replace('bebado/','bebado-vermelho/');
      files[k]={...f,file:re(f.file),pages:f.pages.map(p=>({...p,file:re(p.file)}))};
    }
    g.pieces['bebado-vermelho']={...b,files};
    await route.fulfill({response:r,json:m});
  });
}

async function shot(browser,name,viewport,mobile,extra){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  const page=await ctx.newPage();
  page.on('pageerror',e=>console.log('pageerror',name,String(e).slice(0,200)));
  await routeManifest(page);
  await page.goto(`${BASE}/?foto=sombra&elenco=${CAST}&limpo=1${extra}`,{waitUntil:'commit',timeout:300000});
  await page.waitForFunction(()=>window.__fotoPronta||window.__fotoErro,null,{timeout:400000});
  const err=await page.evaluate(()=>window.__fotoErro);
  if(err)console.log('fotoErro',name,err);
  await page.screenshot({path:`${OUT}/${name}.png`});
  console.log('ok',name);
  await ctx.close();
}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch();
  try{
    await shot(browser,'celular-retrato',{width:390,height:844},true,'');
    await shot(browser,'celular-paisagem',{width:844,height:390},true,'');
    await shot(browser,'pc',{width:1280,height:800},false,'&zoom=pc');
  }finally{await browser.close();}
})();
