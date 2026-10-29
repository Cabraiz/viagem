const { chromium } = require('D:/Gits/viagem-tools/node_modules/playwright');
const fs=require('fs');
(async()=>{let lock;for(const n of [1,2]){try{fs.mkdirSync(`D:/Gits/viagem-board/locks/browser-${n}`);lock=`D:/Gits/viagem-board/locks/browser-${n}`;break;}catch{}}
if(!lock)throw new Error('sem vaga');
const b=await chromium.launch();try{
const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
await p.goto(process.argv[2],{waitUntil:'load'});await p.waitForTimeout(800);await p.evaluate(()=>document.fonts.ready);
console.log(await p.evaluate(()=>{const u=parseFloat(getComputedStyle(document.querySelector('.estadio-escolha')).getPropertyValue('--u'))||(390/734);
 const out=[];const span=document.createElement('b');span.style.cssText='position:absolute;white-space:nowrap;font:800 '+(20*390/734)+'px var(--f-sistema)';document.body.append(span);
 for(const t of ['Boné da sorte','Odd impossível','Quase ganhando','Social amassada','Hora extra','Em reunião','Roupão rosa','Miado de fome','Comeu há 5 min','Regata 365','Só mais uma','No pump','Drible e marra']){span.textContent=t;out.push(t+': '+Math.round(span.offsetWidth/(390/734))+'u');}
 return out.join('\n');}));
}finally{await b.close();fs.rmSync(lock,{recursive:true,force:true});}})();
