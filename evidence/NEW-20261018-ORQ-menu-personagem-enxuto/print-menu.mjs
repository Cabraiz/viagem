// menu-personagem-enxuto evidence: the built menu (vite preview), PC 1280x800 and phone 390x844, Viciado em Bet
// selected (the user's print), after the dance is up; plus overflow checks (no scroll on the phone).
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const OUT=process.argv[2],TAG=process.argv[3]??'depois',PORT=4227;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(PORT),'--strictPort','--outDir',resolve('dist')],{stdio:'ignore',windowsHide:true});
const base=`http://127.0.0.1:${PORT}`,log={};
let browser;
try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/version.json')).ok)break;}catch{}await sleep(250);}
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const screens=[['pc',{viewport:{width:1280,height:800},deviceScaleFactor:1}],['celular',{viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true}],
    ['celular-deitado',{viewport:{width:844,height:390},deviceScaleFactor:1,isMobile:true,hasTouch:true}],['celular-pequeno',{viewport:{width:360,height:640},deviceScaleFactor:1,isMobile:true,hasTouch:true}]];
  for(const [name,opts] of screens){
    const ctx=await browser.newContext(opts),p=await ctx.newPage();
    await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:hero:v1',JSON.stringify({version:1,classId:'viciado-em-bet',name:'',color:'#75b8a6'}));}catch{}});
    await p.goto(base+'/',{waitUntil:'load',timeout:60000});
    await p.waitForSelector('#portrait.dancing',{timeout:30000}).catch(()=>{});
    await sleep(1500);
    await p.screenshot({path:join(OUT,`menu-${TAG}-${name}.png`)});
    log[name]=await p.evaluate(()=>{
      const over=[...document.querySelectorAll('#personagem, #personagem *')].filter(e=>{const s=getComputedStyle(e);return (s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+1;}).map(e=>e.id||e.className);
      const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return r.width?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:'oculto';};
      return {docScroll:document.documentElement.scrollHeight>innerHeight+1,scrollers:over,
        clipped:[...document.querySelectorAll('#personagem button, #personagem input, #class-name')].filter(e=>{const r=e.getBoundingClientRect(),w=document.getElementById('personagem').getBoundingClientRect();return r.bottom>w.bottom+1||r.top<w.top-1||r.right>w.right+1||r.left<w.left-1;}).map(e=>e.id||e.className),
        window:box('#personagem'),name:box('#class-name'),portrait:box('#portrait'),dance:box('#portrait canvas'),input:box('#nickname'),confirm:box('#confirm'),prev:box('#previous'),next:box('#next'),
        gone:['#portrait-role','#quote','.palette','.stats-and-story','.skill-box'].filter(s=>{const e=document.querySelector(s);return !e||!e.getBoundingClientRect().width;})};
    });
    await ctx.close();
  }
}finally{
  try{await browser?.close();}catch{}
  try{preview.kill();}catch{}
  writeFileSync(join(OUT,`menu-${TAG}.json`),JSON.stringify(log,null,1));
  console.log(JSON.stringify(log));
}
