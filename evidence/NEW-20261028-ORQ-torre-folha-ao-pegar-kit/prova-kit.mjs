// Prova do card torre-folha-ao-pegar-kit: partida solo local (dist com o patch "começa com kit"), CPU 4× e rede 4G.
// Duas rodadas no mesmo build: "antes" (localStorage semKitArt=1 desliga o gancho) e "depois" (gancho ligado).
// Em cada uma: linha do tempo da folha base do kit desde a entrada; aos 3 s, tecla 1 (o kit) + mouse no mapa →
// prints do 1º fantasma a +150 ms, +1 s e +2,5 s.
// uso (na worktree): node <este> <outDir>
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';

const out=process.argv[2];mkdirSync(out,{recursive:true});
const KIND='vigia-do-predio',KEY=`art:torres:${KIND}:base`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
const {claimSlot}=await import(pathToFileURL(join(process.cwd(),'tools/vaga.mjs')).href);
const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts/local-worker.mjs')).href);
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E1 prova torre-folha-ao-pegar-kit'});
const file='dist/multiplayer.json',saved=readFileSync(file,'utf8');
let worker,preview,browser;
const resumo=[];
try{
  worker=await startLocalWorker({port:8799,logPath:join(tmpdir(),'viagem-e1-kit-worker.log')});
  writeFileSync(file,JSON.stringify({...JSON.parse(saved),endpoint:worker.endpoint}));
  preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4361','--strictPort','--outDir','dist'],{windowsHide:true,stdio:'ignore'});
  const base='http://127.0.0.1:4361';
  for(let i=0;i<120;i++){try{if((await fetch(`${base}/version.json`)).ok)break;}catch{}await sleep(250);}
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  for(const rodada of ['antes','depois']){
    const ctx=await browser.newContext({viewport:{width:1335,height:620},deviceScaleFactor:1});
    const p=await ctx.newPage();const erros=[];
    p.on('pageerror',e=>erros.push(`pageerror ${e.message}`));p.on('console',m=>{if(m.type()==='error')erros.push(m.text());});
    const cdp=await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:60,downloadThroughput:9e6/8,uploadThroughput:4e6/8});
    await p.addInitScript(r=>{try{if(r==='antes')localStorage.setItem('semKitArt','1');else localStorage.removeItem('semKitArt');}catch{}},rodada);
    await p.goto(`${base}/?perf=1`,{waitUntil:'load',timeout:120000});
    await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
    await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Prova';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
    await p.evaluate(()=>document.getElementById('enter-island').click());
    const t0=Date.now();
    await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:240000,polling:250});
    const entrou=Date.now()-t0;
    // Dicas do treinador fora do caminho (as rodadas do gravar-partida as marcam como vistas; aqui só Esc).
    const linha=[];const t1=Date.now();
    const has=()=>p.evaluate(k=>{const s=window.__perfScene;return !!s&&s.textures.exists(k);},KEY).catch(()=>false);
    while(Date.now()-t1<3000){linha.push({ms:Date.now()-t1,base:await has()});await sleep(200);}
    // O 1º fantasma: tecla 1 seleciona o kit, o mouse sobre o mapa ao lado do herói mostra o fantasma.
    await p.keyboard.press('1');
    await p.mouse.move(667+150,310+40);await sleep(30);await p.mouse.move(667+160,310+45);
    const tKit=Date.now();
    const prints=[];
    for(const at of [150,1000,2500]){
      await sleep(Math.max(0,at-(Date.now()-tKit)));
      const st=await p.evaluate(k=>{const s=window.__perfScene;const g=s?.children.list.find(o=>o.name==='torre-fantasma');return {base:!!s&&s.textures.exists(k),fantasmaArte:!!g&&g.visible};},KEY).catch(()=>({}));
      const path=join(out,`${rodada}-fantasma-${at}ms.png`);await p.screenshot({path});prints.push({at,...st,path});
    }
    const primeiraBase=linha.find(x=>x.base)?.ms;
    resumo.push({rodada,entrouMs:entrou,baseAntesDoKitMs:primeiraBase??null,prints,erros:erros.slice(0,10)});
    console.log(rodada,JSON.stringify(resumo.at(-1)));
    await ctx.close();
  }
}finally{
  writeFileSync(file,saved);
  await browser?.close().catch(()=>{});
  try{preview?.kill();}catch{}
  await worker?.stop?.().catch?.(()=>{});
  release?.();
  writeFileSync(join(out,'resumo.json'),JSON.stringify(resumo,null,2));
}
process.exit(0);
