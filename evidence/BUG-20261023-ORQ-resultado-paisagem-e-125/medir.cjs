const {chromium}=require('D:/Gits/viagem-tools/node_modules/playwright');
const [,,tag='x',query='&dono=1&nomes=longos&lose=1&conta=time&calote=1',views='844x390']=process.argv;
const OUT='D:/Gits/viagem-wt/bug-20261023-orq-resultado-paisagem-e-125/evidence/BUG-20261023-ORQ-resultado-paisagem-e-125/';
require('fs').mkdirSync(OUT,{recursive:true});
(async()=>{
  const b=await chromium.launch();
  for(const vv of views.split(','))for(const t of ['100','125']){
    const [w,h]=vv.split('x').map(Number);
    const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const p=await ctx.newPage();
    await p.goto('http://127.0.0.1:4205/?sandbox=hud&players=6&state=result&frozen=1'+query);
    await p.waitForFunction(()=>document.body.dataset.hudReady==='1',null,{timeout:60000});
    await p.evaluate(t=>{if(t==='125')document.documentElement.dataset.texto='125';},t);
    await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(2000);
    const m=await p.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e||!e.getClientRects().length)return null;const b=e.getBoundingClientRect();return `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`};
      const c=document.querySelector('.rh-rcard');const parts=c?[...c.children].map(x=>x.className.split(' ')[0]+':'+Math.round(x.getBoundingClientRect().height)):[];
      const g=document.querySelector('.rh-result-grid');
      return {titles:r('.rh-result-titles'),actions:r('.rh-result-actions'),stats:r('.rh-result-stats'),vaq:r('.rh-result-vaquinha'),shame:r('.rh-result-shame'),grid:r('.rh-result-grid'),card:r('.rh-rcard'),parts,scroll:g&&g.scrollHeight-g.clientHeight,
        cls:document.querySelector(".rh-result").className+" "+g.className,award:[...document.querySelectorAll('.rh-award-title')].map(e=>{const a=e.closest('.rh-award').getBoundingClientRect();const rg=document.createRange();rg.selectNodeContents(e);const tr=rg.getBoundingClientRect();return `${e.textContent}:${Math.round(a.right-tr.right)}`;}).join(' | ')};});
    console.log(vv,t,JSON.stringify(m));
    await p.screenshot({path:`${OUT}${tag}-${vv}-${t}.png`});
    await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
