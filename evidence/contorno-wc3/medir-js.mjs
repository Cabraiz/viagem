// A/B do custo do contorno: ms de JS por quadro em HordeLayers.update (onde a bala e os itens ganham o brilho),
// sandbox da horda com 300 bichos, celular emulado (390x844, toque) e CPU 4x mais lenta (CDP), com e sem ?brilho=0.
import {claimSlot} from 'file:///D:/Gits/viagem-wt/contorno-usavel-wc3/tools/vaga.mjs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 medir brilho'});
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const res={};
try{
  for(const round of [1,2,3])for(const [name,q] of [['com',''],['sem','&brilho=0']]){
    const ctx=await b.newContext({deviceScaleFactor:1,isMobile:true,hasTouch:true,viewport:{width:390,height:844}});
    const p=await ctx.newPage();const cdp=await ctx.newCDPSession(p);
    await p.goto(`http://127.0.0.1:4207/?sandbox=horda&hud=0&seed=7${q}`,{waitUntil:'load',timeout:90000});
    await p.waitForFunction(()=>window.__horde?.ready?.(),null,{timeout:120000});
    await p.waitForTimeout(5000);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const r=await p.evaluate(async()=>{
      const L=window.__horde.scene.layers,orig=L.update.bind(L),t=[];
      L.update=(a,b)=>{const s=performance.now();orig(a,b);t.push(performance.now()-s);};
      window.__horde.resetWorst();
      await new Promise(r=>setTimeout(r,12000));
      L.update=orig;t.sort((a,b)=>a-b);
      const q=f=>+t[Math.floor(f*(t.length-1))].toFixed(2),st=L.stats();
      const shots=window.__horde.scene.children.list.filter(o=>o.name==='brilho-usavel'&&o.visible).length;
      return {frames:t.length,mean:+(t.reduce((a,b)=>a+b,0)/t.length).toFixed(2),p50:q(.5),p95:q(.95),fps:window.__horde.fps(),copiasVisiveis:shots,proj:st?.projectiles,pickups:st?.pickups};
    });
    (res[name]??=[]).push(r);console.log(round,name,JSON.stringify(r));
    await ctx.close();
  }
}finally{await b.close();release();}
