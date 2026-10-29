// Prints do card NEW-20261029-ORQ-solo-sem-sala-de-espera: "Jogar sozinho" até a partida, no celular e no PC.
// Um quadro a cada ~0,6 s do clique até a partida; a folha junta 6 deles + a partida.
//   node solo-prints.mjs <site> <worker> <pasta>
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';
const require=createRequire('D:/Gits/viagem-tools/package.json');const {chromium}=require('playwright');
const sharp=createRequire('D:/Gits/viagem/package.json')('sharp');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [SITE,WORKER,OUT]=process.argv.slice(2);fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E5 prints solo'});
const browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
  for(const [W,H,nome,mobile] of [[375,812,'cel',true],[1280,800,'pc',false]]){
    const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
    await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
    await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:WORKER,protocol:3}}));
    const page=await ctx.newPage();
    await page.goto(`${SITE}/`,{waitUntil:'domcontentloaded',timeout:300000});
    await page.waitForSelector('#confirm',{state:'attached',timeout:300000});
    await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('confirm').click();});
    await sleep(1500);const bora=page.getByRole('button',{name:/BORA/i});if(await bora.count()){await bora.first().click({timeout:8000}).catch(()=>{});await sleep(2000);}
    await page.screenshot({path:`${OUT}/${nome}-0-escolha.png`});
    await page.evaluate(()=>document.getElementById('enter-island').click());
    const quadros=[];
    for(let t0=Date.now();Date.now()-t0<120000;){
      quadros.push({buf:await page.screenshot(),t:Date.now()-t0});
      if(await page.evaluate(()=>!!window.__partidaPronta))break;
      await sleep(400);
    }
    await sleep(2500);quadros.push({buf:await page.screenshot(),t:-1});
    console.log(nome,quadros.length,'quadros');
    const pick=[...new Set([0,1,2,3,4,5].map(i=>Math.round(i*(quadros.length-2)/5)))].map(i=>quadros[i]).concat(quadros.at(-1));
    const s=W>H?0.4:0.5,w=Math.round(W*s),h=Math.round(H*s);
    const tiles=await Promise.all(pick.map(async(q,i)=>({input:await sharp(q.buf).resize(w,h).toBuffer(),left:i*w,top:0})));
    await sharp({create:{width:w*pick.length,height:h,channels:3,background:'#000'}}).composite(tiles).jpeg({quality:75}).toFile(`${OUT}/${nome}-solo-ate-a-partida.jpg`);
    await sharp(pick.at(-2).buf).toFile(`${OUT}/${nome}-carregando.png`);
    await ctx.close();
  }
}finally{await browser.close();release();}
