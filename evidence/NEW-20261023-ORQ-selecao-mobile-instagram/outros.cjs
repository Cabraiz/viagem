// Desktop and the phone on its side keep the stadium (no profile): prints + console errors.
const { chromium } = require('D:/Gits/viagem-tools/node_modules/playwright');
const fs=require('fs');
(async()=>{let lock;for(const n of [1,2]){try{fs.mkdirSync(`D:/Gits/viagem-board/locks/browser-${n}`);lock=`D:/Gits/viagem-board/locks/browser-${n}`;break;}catch{}}
if(!lock)throw new Error('sem vaga');
const b=await chromium.launch();try{
for(const [w,h,mobile] of [[1280,720,false],[844,390,true]]){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(process.argv[2],{waitUntil:'load'});await p.waitForTimeout(2500);
  const s=await p.evaluate(()=>({insta:getComputedStyle(document.querySelector('.insta-topo')).display,palco:getComputedStyle(document.querySelector('.estadio-palco')).display,instaImgs:document.querySelectorAll('.insta-topo img[src*="perfil"]').length,req:performance.getEntriesByType('resource').filter(r=>r.name.includes('/insta/')).length}));
  await p.screenshot({path:`${process.argv[3]}-${w}x${h}.png`});console.log(w,h,JSON.stringify(s),errs.join(' | '));await p.close();}
}finally{await b.close();fs.rmSync(lock,{recursive:true,force:true});}})();
