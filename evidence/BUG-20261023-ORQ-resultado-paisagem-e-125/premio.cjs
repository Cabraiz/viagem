const {chromium}=require('D:/Gits/viagem-tools/node_modules/playwright');
const src=require('fs').readFileSync('D:/Gits/viagem-wt/bug-20261023-orq-resultado-paisagem-e-125/src/client/hud/awards.ts','utf8');
const titles=[...new Set([...src.matchAll(/(?:title|vice):'([^']+)'/g)].map(m=>m[1]))].concat(['Momento mais vergonhoso']);
(async()=>{const b=await chromium.launch();
 for(const [w,h] of [[390,844],[844,390]])for(const t of ['100','125']){
  const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true});const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:4205/?sandbox=hud&players=6&state=result&frozen=1&nomes=longos');await p.waitForFunction(()=>document.body.dataset.hudReady==='1',null,{timeout:60000});
  await p.evaluate(t=>{if(t==='125')document.documentElement.dataset.texto='125';},t);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(500);
  const r=await p.evaluate(titles=>{
    const a=[...document.querySelectorAll('.rh-rcard .rh-award:not(.rh-award-shame)')].find(x=>x.getBoundingClientRect().width>2);
    const ti=a.querySelector('.rh-award-title');const old=ti.textContent;const out=[];
    for(const tt of titles){ti.textContent=tt;const box=a.getBoundingClientRect();const cs=getComputedStyle(a);const inner=box.right-parseFloat(cs.borderRightWidth);
      const rg=document.createRange();rg.selectNodeContents(ti);const right=Math.max(...[...rg.getClientRects()].map(q=>q.right));
      out.push([tt,Math.round((inner-right)*10)/10]);}
    ti.textContent=old;return out.sort((x,y)=>x[1]-y[1]).slice(0,5).map(x=>x.join(': ')).join(' | ');
  },titles);
  console.log(w+'x'+h,t,r);await ctx.close();}
 await b.close();})();
