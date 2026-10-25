/**
 * Prints and times the minimap harness (entry.ts) with and without the ChatGPT art (the art's requests aborted =
 * the drawn shapes of before). No vite: esbuild bundles entry.ts, a small static server serves it with public/.
 * Takes a browser slot (tools/vaga.mjs, recursos-do-pc). Usage: node scripts/minimapa/harness/print.mjs <saída> [side=124]
 */
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {claimSlot} from '../../../tools/vaga.mjs';

// Playwright lives in the shared tools folder (as the board's print scripts load it).
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;

const out=process.argv[2]??'evidence/minimapa-arte-chatgpt/harness',side=Number(process.argv[3]??124);
mkdirSync(out,{recursive:true});
const bundle=(await build({entryPoints:['scripts/minimapa/harness/entry.ts'],bundle:true,format:'esm',write:false,target:'es2022',
  loader:{'.css':'empty'},logLevel:'error',define:{'import.meta.env.DEV':'false','import.meta.env':'{}'}})).outputFiles[0].text;
const html=`<!doctype html><meta charset=utf-8><body style="margin:0;background:#151320"><script type=module src="/entry.js"></script>`;
const types={'.json':'application/json','.webp':'image/webp','.png':'image/png','.js':'text/javascript'};
const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://x').pathname);
  if(path==='/'||path==='/index.html'){res.writeHead(200,{'content-type':'text/html'});return res.end(html);}
  if(path==='/entry.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(bundle);}
  const file=join('public',path);
  if(!existsSync(file)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'});res.end(readFileSync(file));
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 minimapa harness'});
let browser;
try{
  browser=await chromium.launch();
  const result={};
  for(const arte of [false,true]){
    const page=await browser.newPage({viewport:{width:393,height:873},deviceScaleFactor:2});
    page.on('pageerror',e=>console.error('pageerror',e.message));
    if(!arte)await page.route('**/art/minimapa/**',r=>r.abort());
    await page.goto(`${url}?side=${side}&bench=1`);
    await page.waitForFunction(()=>window.__pronto===true,null,{timeout:30000});
    const name=arte?'depois':'antes';
    await page.screenshot({path:`${out}/${name}-${side}.png`,clip:{x:0,y:0,width:side+20,height:side+20}});
    result[name]=await page.evaluate(()=>window.__bench);
    await page.close();
  }
  console.log(JSON.stringify({side,...result}));
}finally{await browser?.close();server.close();await release?.();}
