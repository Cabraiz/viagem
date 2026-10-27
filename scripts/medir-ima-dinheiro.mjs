// Medidor do ímã do dinheiro (BUG-20261025-ORQ-ima-dinheiro-demora; o usuário: "ao passar por cima ou chegar perto,
// ele demora a ser processado"). Roda da raiz do repo (o wrangler e o sim dela): um Worker local com LAB_HORDE (bichos
// em cima do herói), uma build DEV (window.__island) servida estática, um Chromium em swiftshader. O herói limpa a horda
// ({t:'lab',wipe:true}), as cédulas caem 1 s depois; para cada uma o herói é posto a 3 u dela e ANDA até ela
// (scene.goTo, a previsão do cliente como no jogo). Um laço em requestAnimationFrame na página mede, por cédula:
//   entrar  = 1º quadro em que o herói desenhado (net.predicted) fica a ≤ 1,6 u da cédula desenhada (o ímã da sala);
//   sumir   = 1º quadro em que a cédula não está mais desenhada (fora do pool ou invisível);
//   contar  = 1º quadro em que o R$ da barra de cima (.rh-camp-grana-valor) muda.
// --atraso N: N ms em cada sentido no WebSocket da página (a rede de um celular: 60 → ~120 ms de ida e volta).
//   npx vite build --mode development --outDir <dist>
//   node scripts/medir-ima-dinheiro.mjs --dist <dist> [--atraso 60] [--json out.json] [--port 8806] [--web-port 4216]
// Precisa da vaga pesada (board tools/pesado.mjs) e de uma vaga de navegador (locks/browser-1|2), pegas por quem chama.
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const DIST=arg('dist'),JSON_OUT=arg('json'),ATRASO=Number(arg('atraso','0')),PORT=Number(arg('port','8806')),WEB_PORT=Number(arg('web-port','4216'));
const NOTAS=Number(arg('notas','6'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts/local-worker.mjs')).href);

/** O WebSocket da página com `d` ms em cada sentido (envio e chegada), a ordem mantida. */
function atrasarSocket(d){
  if(!(d>0))return;
  const Orig=window.WebSocket;
  class Lento extends Orig{
    send(x){setTimeout(()=>{if(this.readyState===1)super.send(x);},d);}
    addEventListener(type,fn,o){
      if(type!=='message'||typeof fn!=='function')return super.addEventListener(type,fn,o);
      const w=e=>setTimeout(()=>fn.call(this,e),d);(this.__w??=new Map()).set(fn,w);return super.addEventListener(type,w,o);
    }
    removeEventListener(type,fn,o){return super.removeEventListener(type,this.__w?.get(fn)??fn,o);}
    set onmessage(fn){this.__om=fn;super.onmessage=fn?e=>setTimeout(()=>fn.call(this,e),d):null;}
    get onmessage(){return this.__om??null;}
  }
  window.WebSocket=Lento;
}

/** O laço de medida na página (requestAnimationFrame): uma linha por cédula vista. */
function sonda(raio){
  const w=window;w.__ima={linhas:{}};
  const passo=()=>{
    const s=w.__island?.scene,net=s?.hooks?.net,h=s?.horde;
    if(net&&h){
      const agora=performance.now(),eu=net.predicted,txt=document.querySelector('.rh-camp-grana-valor')?.textContent??'';
      const vistas=new Set(),linhas=w.__ima.linhas;
      h.pickups.forEach((a,id)=>{
        if(a.kind!=='grana')return;
        let l=linhas[id];if(!l)l=linhas[id]={id,valor:a.value,nasceu:agora};
        const desenhada=a.image.visible&&a.image.alpha>0;
        if(desenhada)vistas.add(id);
        if(l.entrar===undefined&&desenhada&&Math.hypot(a.x-eu.x,a.y-eu.y)<=raio){l.entrar=agora;l.txt0=txt;}
      });
      for(const l of Object.values(linhas)){
        if(l.entrar===undefined)continue;
        if(l.sumir===undefined&&!vistas.has(l.id))l.sumir=agora;
        if(l.contar===undefined&&txt!==l.txt0){l.contar=agora;l.txt1=txt;}
      }
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

let worker,browser,web;
try{
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-ima-${PORT}`),logPath:join(tmpdir(),`viagem-ima-worker-${PORT}.log`),
    vars:{LAB_HORDE:'14',LAB_SEED:'4242'}});
  web=spawn('python',['-m','http.server',String(WEB_PORT),'--bind','127.0.0.1','--directory',DIST],{stdio:'ignore',windowsHide:true});
  await sleep(1500);
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  await ctx.addInitScript(atrasarSocket,ATRASO);
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,300)));
  await p.goto(`http://127.0.0.1:${WEB_PORT}/`,{waitUntil:'load',timeout:120000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Prova';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:300000,polling:1000});
  await sleep(6000);
  await p.evaluate(sonda,1.6);
  const takeOffer=()=>p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/Levar os indicados/.test(x.textContent??''));b?.click();return !!b;});
  const send=m=>p.evaluate(m=>{const s=window.__island.scene.hooks.net.socket;if(s?.readyState===1)s.send(JSON.stringify(m));},m);
  const state=()=>p.evaluate(()=>{const net=window.__island.scene.hooks.net,view=net.feed.peek();
    const me=net.predicted;let near=0;for(const e of view.enemies)if(e.hp>0&&Math.hypot(e.x-me.x,e.y-me.y)<12)near++;
    const notes=view.pickups.filter(x=>x.kind==='grana').map(x=>({id:x.id,x:x.x,y:x.y,value:x.value}));
    return {me:{x:me.x,y:me.y},near,notes};});
  const medidas=[];
  // Rodadas: junta a horda, limpa, anda até cada cédula (antes que ela voe sozinha ao dono, CEDULA_WAIT_SECONDS = 10 s).
  for(let rodada=0;rodada<4&&medidas.filter(m=>m.contar!==undefined).length<NOTAS;rodada++){
    for(let i=0;i<120;i++){await takeOffer();const s=await state();if(s.near>=6)break;await sleep(500);}
    await send({t:'lab',wipe:true});
    let mid;for(let i=0;i<80;i++){await takeOffer();mid=await state();if(mid.notes.length)break;await sleep(250);}
    await sleep(300);mid=await state();
    for(const n of mid.notes.slice(0,3)){
      await takeOffer();
      // Ao lado (fora do ímã), a previsão assenta; então anda até a cédula como um toque no chão.
      await send({t:'lab',to:{x:n.x+3,y:n.y}});await sleep(700);
      await p.evaluate(n=>window.__island.scene.goTo({x:n.x,y:n.y}),n);await sleep(1300);
    }
    await sleep(800);
    const linhas=await p.evaluate(()=>Object.values(window.__ima.linhas));
    for(const l of linhas)if(l.entrar!==undefined&&!medidas.some(m=>m.id===l.id))medidas.push({...l,rodada});
  }
  const ms=v=>v===undefined?undefined:Math.round(v);
  const linhas=medidas.map(m=>({id:m.id,valor:m.valor,esperou:ms(m.entrar-m.nasceu),sumir:ms(m.sumir-m.entrar),contar:ms(m.contar-m.entrar),txt:`${m.txt0} → ${m.txt1??'?'}`}));
  const med=k=>{const v=linhas.map(l=>l[k]).filter(x=>x!==undefined).sort((a,b)=>a-b);return v.length?{n:v.length,mediana:v[v.length>>1],min:v[0],max:v[v.length-1]}:null;};
  const resumo={atraso:ATRASO,sumir:med('sumir'),contar:med('contar')};
  console.table(linhas);console.log(JSON.stringify(resumo));
  if(errors.length)console.log('erros',errors.slice(0,3));
  if(JSON_OUT)writeFileSync(JSON_OUT,JSON.stringify({resumo,linhas,errors},null,1));
}finally{
  try{await browser?.close();}catch{}
  try{web?.kill();}catch{}
  try{await worker?.stop();}catch{}
}
