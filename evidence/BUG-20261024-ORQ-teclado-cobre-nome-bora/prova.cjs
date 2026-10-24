// Prova do BUG-20261024-ORQ-teclado-cobre-nome-bora: o perfil no passo do nome com o teclado do celular aberto.
// Playwright não abre teclado: o visualViewport é trocado por um falso (Chrome no Android só encolhe ele) e um bloco
// escuro desenha o teclado na parte que ele cobre. "antes" = o visualViewport fica do tamanho da tela (o código velho
// não olha para ele); "depois" = o visualViewport encolhe. Também roda com a tela inteira encolhida (resizes-content).
// Uso: BASE=http://127.0.0.1:4202 node prova.cjs <saida>
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'D:/Gits/viagem-tools/node_modules/playwright');
const path=require('node:path');
const BASE=process.env.BASE||'http://127.0.0.1:4202';
const OUT=process.argv[2]||__dirname;
const TELAS=[
  {nome:'retrato',w:390,h:844,teclado:414},
  {nome:'paisagem',w:844,h:390,teclado:170},
];

const FAKE_VV=()=>{
  const alvo=new EventTarget();
  window.__vvH=undefined;
  const vv=Object.assign(alvo,{});
  for(const [k,f] of Object.entries({height:()=>window.__vvH??innerHeight,width:()=>innerWidth,offsetTop:()=>0,offsetLeft:()=>0,
    pageTop:()=>scrollY,pageLeft:()=>scrollX,scale:()=>1}))Object.defineProperty(vv,k,{get:f});
  Object.defineProperty(window,'visualViewport',{get:()=>vv,configurable:true});
  window.__teclado=h=>{window.__vvH=h;vv.dispatchEvent(new Event('resize'));
    let k=document.getElementById('__teclado');
    if(h==null){k?.remove();return;}
    if(!k){k=document.createElement('div');k.id='__teclado';document.documentElement.append(k);}
    k.style.cssText=`position:fixed;left:0;right:0;bottom:0;height:${innerHeight-h}px;z-index:2147483647;pointer-events:none;
      background:repeating-linear-gradient(90deg,#c62828 0 34px,#7f1010 34px 38px),#1b1b1b;background-size:100% 60%;background-position:0 100%;background-repeat:no-repeat;
      border-top:44px solid #1b1b1b;font:700 15px sans-serif;color:#fff;`;
    k.textContent='  TECLADO (simulado)';
  };
};

(async()=>{
  const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const out=[];
  try{
    for(const t of TELAS){
      for(const modo of ['antes','depois']){
        const ctx=await browser.newContext({viewport:{width:t.w,height:t.h},deviceScaleFactor:2,isMobile:true,hasTouch:true});
        await ctx.addInitScript(FAKE_VV);
        await ctx.addInitScript(()=>{try{localStorage.clear();}catch{}});
        const page=await ctx.newPage();
        const erros=[];page.on('pageerror',e=>erros.push(String(e)));
        await page.goto(BASE+'/',{waitUntil:'load',timeout:60000});
        await page.waitForSelector('#confirm',{timeout:30000});
        await page.waitForTimeout(2500);
        await page.locator('#confirm').tap();
        await page.waitForSelector('.estadio-nome:not([hidden])',{timeout:10000});
        await page.locator('#nickname').tap();
        await page.keyboard.type('Cabraiz');
        // antes: what the old code sees (it never reads the visual viewport); depois: the real shrink.
        await page.evaluate(([h,modo])=>{window.__teclado(h);if(modo==='antes'){const s=document.getElementById('personagem');
          delete s.dataset.teclado;for(const p of ['--tec-top','--tec-h','--tec-cheia'])s.style.removeProperty(p);}},[t.teclado,modo]);
        await page.waitForTimeout(600);
        const m=await page.evaluate(h=>{
          const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height)};};
          return {visivel:h,campo:r('#nickname'),bora:r('#confirm'),foco:document.activeElement?.id,teclado:document.getElementById('personagem').dataset.teclado!==undefined};
        },t.teclado);
        m.campoVisivel=!!m.campo&&m.campo.top>=0&&m.campo.bottom<=t.teclado;
        m.boraVisivel=!!m.bora&&m.bora.top>=0&&m.bora.bottom<=t.teclado;
        const arq=path.join(OUT,`${t.nome}-${t.w}x${t.h}-${modo}.png`);
        await page.screenshot({path:arq});
        // Enter on the keyboard = BORA upright; a tap on BORA! with the keyboard up on its side (depois only: the dialog opens).
        if(modo==='depois'){if(t.nome==='retrato')await page.keyboard.press('Enter');else await page.locator('#confirm').tap();await page.waitForTimeout(500);
          m.boraAbreDialogo=await page.evaluate(()=>document.getElementById('confirmation').open);}
        out.push({tela:t.nome,modo,...m,erros});
        await ctx.close();
      }
    }
    // resizes-content browsers: the whole viewport shrinks with the keyboard.
    {
      const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
      await ctx.addInitScript(()=>{try{localStorage.clear();}catch{}});
      const page=await ctx.newPage();
      await page.goto(BASE+'/',{waitUntil:'load',timeout:60000});
      await page.waitForSelector('#confirm');await page.waitForTimeout(2500);
      await page.locator('#confirm').tap();await page.waitForSelector('.estadio-nome:not([hidden])');
      await page.locator('#nickname').tap();
      // The tap asked for fullscreen (main.ts autoFullscreen); a window in fullscreen cannot be resized here.
      await page.evaluate(()=>document.fullscreenElement&&document.exitFullscreen());await page.waitForTimeout(300);
      await page.setViewportSize({width:390,height:414});await page.waitForTimeout(600);
      const m=await page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom)};};
        return {campo:r('#nickname'),bora:r('#confirm'),teclado:document.getElementById('personagem').dataset.teclado!==undefined};});
      await page.screenshot({path:path.join(OUT,'retrato-resizes-content-390x414.png')});
      // keyboard closes: no jump left behind
      await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);
      m.depoisDeFechar=await page.evaluate(()=>document.getElementById('personagem').dataset.teclado!==undefined);
      out.push({tela:'retrato-resizes-content',...m});
      await ctx.close();
    }
  }finally{await browser.close();}
  console.log(JSON.stringify(out,null,1));
})().catch(e=>{console.error(e);process.exit(1);});
