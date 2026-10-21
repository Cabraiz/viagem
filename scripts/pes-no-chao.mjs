// The heroes' feet on the floor of the menu (NEW-20261021-ORQ-heroi-esrgan-no-ar, the user, 21/10: "garantia de que o
// pé encosta no chão"). On the BUILT site, for the heroes drawn in place on the PC (stadium.ts RECORTES: the viciado on
// the stadium's bar, the CLT on his plateau) at 7 window sizes (DPR 1):
//   - the floor: the row where the hero's sole touches the floor in the approved 1920x1080 picture (CHAO), put on the
//     screen by the background as the page DRAWS it (the stage's computed background-size/position; frameArt must agree);
//   - the feet: the lowest row with an opaque pixel (alpha >= 128) of the hero alone (everything else hidden, a
//     transparent screenshot);
// |feet - floor| > 4 px fails. Out: <out>/pes.json ({ok, fails, rows}) and <out>/pes-<hero>-<w>x<h>.png.
// node scripts/pes-no-chao.mjs [outDir=folha-out] [--dist dist] [--url http://127.0.0.1:5173/]: run from the checkout
// whose dist/ it serves (or against a running server with --url). Exit 0 ok, 1 a hero floats or sinks, 2 infrastructure.
// --flutua <px>: lifts every hero by px (CSS) to see the check fail (a self-test; never in CI).
import {createServer} from 'node:http';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {extname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const outDir=resolve(process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')))??'folha-out');
const dist=resolve(arg('dist','dist'));
const flutua=Number(arg('flutua',0));
const VIEWPORTS=[[1920,1080],[1920,950],[1590,903],[1366,768],[1280,720],[2560,1080],[1024,768]];
/**
 * The floor under each hero in the approved 1920x1080 picture (px): the bottom edge of his sole's lowest row with
 * alpha >= 128, where the picture the user approved has him touching the bar / the plateau (tests/client/menu-estadio.test.ts re-measures
 * it on the art, so new art can't leave it stale).
 */
const CHAO={'viciado-em-bet':1073,'clt-cansado':935};
const TOLERANCIA=4,ALPHA=128;
class Infra extends Error {}

async function playwright(){
  for(const spec of [process.env.PLAYWRIGHT_MODULE,join(process.cwd(),'node_modules','playwright'),'playwright','D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{
      const url=spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href;
      const m=await import(url);return m.chromium?m:m.default;
    }catch{}
  }
  throw new Infra('Playwright não encontrado: npm install --no-save playwright@1.63.0 (ou PLAYWRIGHT_MODULE)');
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
/** dist/ on a free port (the menu needs no room). */
function serve(){
  if(!existsSync(join(dist,'index.html')))throw new Infra(`sem ${join(dist,'index.html')}: npm run build antes`);
  const server=createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
      const file=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
      const data=await readFile(file);
      res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
    }catch{res.writeHead(404).end('Not found');}
  });
  return new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>ok(server));});
}
/** The lowest row with alpha >= ALPHA in a PNG (decoded by the page's own canvas: no extra package in CI). */
async function lowestOpaque(page,png){
  return page.evaluate(async([b64,alpha])=>{
    const img=new Image();img.src=`data:image/png;base64,${b64}`;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
    const {data}=g.getImageData(0,0,c.width,c.height);
    for(let y=c.height-1;y>=0;y--)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3]>=alpha)return y;
    return -1;
  },[png.toString('base64'),ALPHA]);
}

async function main(){
  mkdirSync(outDir,{recursive:true});
  const {frameArt,STADIUM,RECORTES}=await import(pathToFileURL(resolve('src/client/ui/stadium.ts')).href);
  for(const id of Object.keys(RECORTES))if(!(id in CHAO))throw new Error(`${id}: um herói recortado sem CHAO em scripts/pes-no-chao.mjs`);
  const {chromium}=await playwright();
  const server=arg('url')?undefined:await serve(),url=arg('url')??`http://127.0.0.1:${server.address().port}/`;
  let browser;
  try{browser=await chromium.launch();}catch(e){server?.close();throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  const rows=[],fails=[];
  try{
    for(const [w,h] of VIEWPORTS){
      const page=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
      if(flutua)await page.addInitScript(px=>addEventListener('DOMContentLoaded',()=>document.head.append(Object.assign(document.createElement('style'),{textContent:`.estadio-recorte{translate:0 ${-px}px}`}))),flutua);
      try{
        await page.goto(url,{waitUntil:'load',timeout:60000});
        await page.waitForSelector('[data-hero="clt-cansado"]',{timeout:60000});
        for(const hero of Object.keys(RECORTES)){
          await page.click(`[data-hero="${hero}"]`);
          // The cutout placed, its file decoded, and (the CLT) his own background swapped in.
          await page.waitForFunction(([id,fundo])=>{
            const i=document.querySelector('.estadio-recorte'),stage=document.querySelector('.estadio-palco');
            return i&&!i.hidden&&i.complete&&i.naturalWidth>0&&i.dataset.box&&document.querySelector(`[data-hero="${id}"]`)?.getAttribute('aria-pressed')==='true'
              &&(!fundo||stage.style.backgroundImage.includes(fundo));
          },[hero,RECORTES[hero].fundo??''],{timeout:60000});
          await page.evaluate(()=>document.querySelector('.estadio-recorte').decode().catch(()=>{}));
          await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
          const drawn=await page.evaluate(()=>{
            const stage=document.querySelector('.estadio-palco'),r=stage.getBoundingClientRect(),cs=getComputedStyle(stage);
            const num=s=>s.split(',')[0].trim().split(/\s+/).map(parseFloat);
            const img=document.querySelector('.estadio-recorte');
            return {top:r.top,box:{w:stage.clientWidth,h:stage.clientHeight},size:num(cs.backgroundSize),at:num(cs.backgroundPosition),file:img.currentSrc||img.src};
          });
          const art=STADIUM.bleed,f=art.focal,frame=frameArt(drawn.box,art);
          // The floor where the page draws the background (its px size/position), and where frameArt says it is.
          const [,bh]=drawn.size,[,by]=drawn.at,s=bh/art.h;
          const floor=drawn.top+by+(f.y+CHAO[hero])*s,floorFrame=drawn.top+frame.oy+(f.y+CHAO[hero])*frame.s;
          const full=await page.screenshot();
          writeFileSync(join(outDir,`pes-${hero}-${w}x${h}.png`),full);
          // The hero alone: everything hidden but him, no page background.
          await page.addStyleTag({content:'html,body,body *{background:transparent!important;visibility:hidden!important}body .estadio-recorte{visibility:visible!important}'}).then(t=>t.evaluate(el=>el.id='pes-so-heroi'));
          const alone=await page.screenshot({omitBackground:true});
          await page.evaluate(()=>document.getElementById('pes-so-heroi')?.remove());
          const feet=await lowestOpaque(page,alone)+1; // the bottom edge of that row
          const row={hero,w,h,file:drawn.file.split('/').pop(),feet,floor:+floor.toFixed(1),floorFrame:+floorFrame.toFixed(1),diff:+(feet-floor).toFixed(1)};
          rows.push(row);
          const why=[];
          if(!(Number.isFinite(bh)&&bh>0))why.push(`fundo sem tamanho em px (${JSON.stringify(drawn.size)})`);
          if(Math.abs(floor-floorFrame)>1.5)why.push(`fundo desenhado fora do frameArt (${floor.toFixed(1)} × ${floorFrame.toFixed(1)})`);
          if(feet<=0)why.push('herói invisível');
          else if(Math.abs(feet-floor)>TOLERANCIA)why.push(`pé em ${feet}, chão em ${floor.toFixed(1)} (${feet<floor?'flutua':'afunda'} ${Math.abs(feet-floor).toFixed(1)} px)`);
          if(why.length)fails.push(`${hero} ${w}x${h}: ${why.join('; ')}`);
        }
      }finally{await page.close();}
    }
  }finally{await browser.close();server?.close();}
  const ok=!fails.length;
  writeFileSync(join(outDir,'pes.json'),JSON.stringify({ok,tolerancia:TOLERANCIA,fails,rows},null,1));
  for(const r of rows)console.log(`${r.hero.padEnd(15)} ${`${r.w}x${r.h}`.padEnd(10)} pé ${String(r.feet).padStart(5)}  chão ${String(r.floor).padStart(7)}  ${r.diff>=0?'+':''}${r.diff} px  (${r.file})`);
  for(const f of fails)console.log(`FALHOU: ${f}`);
  console.log(ok?`pés no chão: ok (${rows.length} telas, ±${TOLERANCIA} px)`:`pés no chão: ${fails.length} falha(s)`);
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Pés no chão do menu (±${TOLERANCIA} px): ${ok?'ok':'FALHOU'}\n\n| herói | tela | pé | chão | dif. |\n|---|---|---|---|---|\n${rows.map(r=>`| ${r.hero} | ${r.w}×${r.h} | ${r.feet} | ${r.floor} | ${r.diff} |`).join('\n')}\n`);
  }
  return ok?0:1;
}
main().then(code=>process.exit(code),e=>{console.error(e instanceof Infra?`infra: ${e.message}`:e);process.exit(e instanceof Infra?2:1);});
