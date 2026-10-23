import {claimSlot} from 'file:///D:/Gits/viagem-wt/contorno-usavel-wc3/tools/vaga.mjs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 probe'});
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const p=await (await b.newContext({deviceScaleFactor:1,viewport:{width:1335,height:620}})).newPage();
await p.goto('http://127.0.0.1:4207/?foto=arsenal&arma=pistola',{waitUntil:'load',timeout:90000});
await p.waitForFunction(()=>window.__fotoPronta===true,null,{timeout:120000});
console.log(await p.evaluate(()=>{const g=window.Phaser?Object.values(window).find(v=>v&&v.scene&&v.scene.scenes):null;
 const game=g??(window.__game||window.game);const out={};const scenes=game?game.scene.scenes:[];
 for(const s of scenes)for(const o of s.children.list){const k=(o.name||'?')+'|'+(o.texture?.key??'');if(!/brilho|proj|fx:/.test(k))continue;out[k]=(out[k]||0)+(o.visible?1:0);}
 return JSON.stringify({found:!!game,out},null,1);}));
}finally{await b.close();release();}
