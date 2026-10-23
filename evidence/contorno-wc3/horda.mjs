import {claimSlot} from 'file:///D:/Gits/viagem-wt/contorno-usavel-wc3/tools/vaga.mjs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 horda bala'});
const b=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const p=await (await b.newContext({deviceScaleFactor:1,viewport:{width:1335,height:620}})).newPage();
p.on('pageerror',e=>console.log('pageerror',e.message));
await p.goto('http://127.0.0.1:4207/?sandbox=horda&n=30&hud=0',{waitUntil:'load',timeout:90000});
await p.waitForTimeout(12000);
for(const i of [1,2]){await p.screenshot({path:`depois/horda-bala-${i}.png`});await p.waitForTimeout(700);}
}finally{await b.close();release();}
