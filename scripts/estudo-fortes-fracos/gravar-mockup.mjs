// Prints do mockup fortes x fracos no jogo (sandbox cidade, `limpo=1`): o grandão e o da moto ao lado dos 3 fracos, em
// cada variante de preparar-mockup.mjs (folhas servidas no lugar das lite por page.route), PC 1280x720 e celular 390x844.
// "depois" = variante + os 3 fracos 1,15× (`escala=`, debug do estudo). Vaga de navegador: pega e solta na hora.
//   node scripts/estudo-fortes-fracos/gravar-mockup.mjs <porta> <folhas> <saida>
import {claimSlot} from 'file:///D:/Gits/viagem/tools/vaga.mjs';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const [porta='4205',folhas,saida='.']=process.argv.slice(2);
const ELENCO='seguranca-de-shopping,motoboy,bebado,tio-pave,cobrador-do-busao';
const ESCALA='bebado:1.15,tio-pave:1.15,cobrador-do-busao:1.15';
const CENAS=[['antes','antes',false],['escuro','escuro',true],['cor','cor',true]];
const TELAS=[['pc',{width:1280,height:720},false],['celular',{width:390,height:844},true]];
mkdirSync(saida,{recursive:true});
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E5 mockup fortes-x-fracos',maxWaitMs:600000});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  for(const [tela,vp,mobile] of TELAS)for(const [nome,variante,maior] of CENAS){
    const page=await browser.newPage({viewport:vp,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
    page.on('pageerror',e=>console.log('pageerror',e.message));
    await page.route('**/art/lite/enemies/**',route=>{
      const rel=new URL(route.request().url()).pathname.split('/art/lite/enemies/')[1];
      const f=join(folhas,variante,rel);
      return existsSync(f)?route.fulfill({body:readFileSync(f),contentType:'image/webp'}):route.continue();
    });
    const url=`http://127.0.0.1:${porta}/?sandbox=cidade&tele=1&foto=sombra&limpo=1&elenco=${ELENCO}&hero=85,108${maior?`&escala=${ESCALA}`:''}`;
    await page.goto(url,{waitUntil:'load',timeout:60000});
    await page.waitForTimeout(9000);
    await page.screenshot({path:join(saida,`${tela}-${nome}.png`),timeout:60000});
    await page.close();
  }
}finally{await browser.close();release();}
