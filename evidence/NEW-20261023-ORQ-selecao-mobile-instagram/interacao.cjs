// The profile screen played: a story tap, ≡, SELECIONAR → name → BORA!, a locked story, turning the phone and back.
const { chromium } = require('D:/Gits/viagem-tools/node_modules/playwright');
const fs=require('fs');
(async()=>{let lock;for(const n of [1,2]){try{fs.mkdirSync(`D:/Gits/viagem-board/locks/browser-${n}`);lock=`D:/Gits/viagem-board/locks/browser-${n}`;break;}catch{}}
if(!lock)throw new Error('sem vaga');
const b=await chromium.launch();const out=[];const ok=(c,m)=>out.push(`${c?'ok ':'FALHOU '}${m}`);try{
const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(process.argv[2],{waitUntil:'load'});await p.waitForTimeout(1500);
const handle=()=>p.$eval('.insta-arroba span',e=>e.textContent);
ok(await handle()==='@VICIADO','abre no viciado');
ok(await p.evaluate(()=>!document.querySelector('#portrait img')),'nenhum retrato baixado no perfil');
await p.tap('.insta-story[data-hero="gato-nada-pra-comer"]');await p.waitForTimeout(300);
ok(await handle()==='@GATO','story troca para o gato');
ok((await p.$$('.insta-post')).length===3,'3 fotos do gato');
await p.tap('.insta-story[data-hero="maromba"]');await p.waitForTimeout(300);
ok((await p.$$('.insta-post')).length===0&&await p.$('.insta-privada')!==null,'maromba: conta privada');
ok(await p.$eval('#confirm',e=>e.disabled&&e.textContent.includes('EM BREVE')),'maromba: EM BREVE desabilitado');
await p.tap('.insta-story[data-hero="clt-cansado"]');await p.waitForTimeout(300);
await p.tap('#confirm');await p.waitForTimeout(300);
ok(await p.$eval('#personagem',e=>e.dataset.etapa)==='nome','SELECIONAR → etapa do nome');
ok(await p.$eval('.estadio-nome',e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().bottom<=innerHeight),'campo de nome na tela');
await p.fill('#nickname','Tia Cleide');await p.tap('#confirm');await p.waitForTimeout(500);
ok(await p.$eval('#confirmation',e=>e.open),'BORA! abre a confirmação');
await p.evaluate(()=>document.getElementById('confirmation').close());
await p.tap('.insta-story[data-hero="viciado-em-bet"]');await p.waitForTimeout(300);
ok(await p.$eval('#personagem',e=>e.dataset.etapa)==='escolher'&&await handle()==='@VICIADO','story na etapa do nome volta a escolher');
await p.tap('.insta-menu');await p.waitForTimeout(1200);
ok(await p.evaluate(()=>!!document.querySelector('dialog[open]')),'≡ abre as configurações');
await p.keyboard.press('Escape');await p.waitForTimeout(300);
ok(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight),'sem rolagem');
await p.setViewportSize({width:844,height:390});await p.waitForTimeout(1500);
ok(await p.evaluate(()=>getComputedStyle(document.querySelector('.estadio-palco')).display!=='none'&&getComputedStyle(document.querySelector('.insta-topo')).display==='none'),'deitado: o estádio volta');
ok(await p.evaluate(()=>!!document.querySelector('#portrait canvas, #portrait img, #portrait .menu-dance')),'deitado: a dança/retrato volta');
await p.setViewportSize({width:390,height:844});await p.waitForTimeout(800);
ok(await handle()==='@VICIADO'&&(await p.$$('.insta-post')).length===3,'em pé de novo: perfil refeito');
ok(!errs.length,'sem erro no console '+errs.join(' | '));
console.log(out.join('\n'));
}finally{await b.close();fs.rmSync(lock,{recursive:true,force:true});}})();
