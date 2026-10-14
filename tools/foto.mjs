// Fotos do jogo com um navegador compartilhado (D-049, card NEW-20261014-ORQ-modo-foto-navegador-compartilhado).
// Um Chromium por PC fica aberto (`servidor`); cada executor conecta e pede cenas do modo foto (src/client/dev/foto.ts) ao
// SEU dev server: `?foto=<cena>` desenha a cena de dados falsos e avisa `window.__fotoPronta`. Fila: no máximo
// FOTO_PAGINAS páginas ao mesmo tempo no PC (mkdir atômico em <quadro>/locks/foto-pagina-N), no lugar de locks/browser-N.
//
//   node tools/foto.mjs servidor [--gpu d3d11|swiftshader|padrao]   abre o navegador (deixe rodando; Ctrl+C fecha)
//   node tools/foto.mjs <cena[,cena…]|todas|chaveiro> [--porta 42NN] [--telas 1335x620,390x844] [--saida dir]
//        [--extra "view=1&zoom=0.79"] [--folha arquivo.png]                tira as fotos (PNG por cena × tela)
//   node tools/foto.mjs lista                                          as cenas
//   node tools/foto.mjs parar                                          fecha o servidor
// Sem servidor aberto, a foto abre um navegador só para ela (reservando locks/browser-1|2, a regra antiga).
// Playwright: `import('playwright')`, senão PLAYWRIGHT_MODULE, senão D:/Gits/viagem-tools (o PC).
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {claimSlot} from './vaga.mjs';

const BOARD=process.env.VIAGEM_BOARD??'D:/Gits/viagem-board';
const LOCKS=join(BOARD,'locks');
const SERVER_FILE=join(LOCKS,'foto-servidor.json');
const PAGES=Number(process.env.FOTO_PAGINAS??2);
if(!(Number.isInteger(PAGES)&&PAGES>=1&&PAGES<=4))throw new Error(`FOTO_PAGINAS: 1 a 4, veio ${process.env.FOTO_PAGINAS}`);
/** A page slot whose client stopped beating this long ago (crashed, Ctrl+C) is taken back (tools/vaga.mjs). */
const PAGE_STALE_MS=20000;
/** GPU flags per mode (measured in the card: d3d11 is the default on this PC). */
const GPU={
  d3d11:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'],
  swiftshader:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  padrao:[],
  // d3d11 with fewer helper threads (raster, V8 compile/GC): the CPU peak of a page load is spread over fewer cores.
  'd3d11-enxuto':['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist','--num-raster-threads=1','--js-flags=--single-threaded'],
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:fallback;};

async function playwright(){
  for(const spec of ['playwright',process.env.PLAYWRIGHT_MODULE,'D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{
      const url=spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href;
      const m=await import(url);return m.chromium?m:m.default;
    }catch{}
  }
  throw new Error('Playwright não encontrado (PLAYWRIGHT_MODULE ou D:/Gits/viagem-tools)');
}

/** The scenes, read from the client's registry (the source of truth) without bundling it. */
function scenes(){
  const src=readFileSync(new URL('../src/client/dev/foto.ts',import.meta.url),'utf8');
  return [...src.matchAll(/^\s+'([a-z0-9-]+)':\{/gm)].map(m=>m[1]);
}

/** Slots held by this process: released on exit and on Ctrl+C / SIGTERM (a stuck slot would hold up every client). */
const held=new Set();
const hold=release=>{held.add(release);return ()=>{held.delete(release);release();};};
const releaseAll=()=>{for(const r of held)r();held.clear();};
process.on('exit',releaseAll);

async function servidor(){
  const {chromium}=await playwright();
  const gpu=opt('gpu','d3d11');
  if(!GPU[gpu])throw new Error(`--gpu ${gpu}: use ${Object.keys(GPU).join('|')}`);
  if(existsSync(SERVER_FILE)){
    const old=JSON.parse(readFileSync(SERVER_FILE,'utf8'));
    try{const b=await chromium.connect(old.wsEndpoint,{timeout:3000});await b.close();console.log(`já aberto: ${old.wsEndpoint} (pid ${old.pid})`);return;}catch{}
  }
  rmSync(`${SERVER_FILE}.parar`,{force:true}); // a stop asked while no server ran must not stop this one
  const server=await chromium.launchServer({headless:true,args:GPU[gpu]});
  mkdirSync(LOCKS,{recursive:true});
  writeFileSync(SERVER_FILE,JSON.stringify({wsEndpoint:server.wsEndpoint(),pid:process.pid,gpu,startedAt:new Date().toISOString()},null,1));
  console.log(`navegador compartilhado aberto (${gpu}): ${server.wsEndpoint()}\n${SERVER_FILE}`);
  const close=async()=>{
    // Only our own record: another `servidor` started meanwhile owns the file now.
    try{if(JSON.parse(readFileSync(SERVER_FILE,'utf8')).pid===process.pid)rmSync(SERVER_FILE,{force:true});}catch{}
    await server.close().catch(()=>{});process.exit(0);
  };
  process.on('SIGINT',close);process.on('SIGTERM',close);process.on('SIGHUP',close);
  // `parar` writes a stop file: polled, so it works without signals on Windows.
  for(;;){await sleep(1000);if(existsSync(`${SERVER_FILE}.parar`)){rmSync(`${SERVER_FILE}.parar`,{force:true});await close();}}
}

async function fotos(list){
  const {chromium}=await playwright();
  const port=opt('porta',process.env.FOTO_PORTA??'4208'),base=`http://127.0.0.1:${port}`;
  const telas=opt('telas','1335x620').split(',').map(t=>t.split('x').map(Number));
  const saida=resolve(opt('saida','.')),extra=opt('extra','');
  mkdirSync(saida,{recursive:true});
  let browser,release=()=>{},shared=false;
  for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>{releaseAll();process.exit(130);});
  if(existsSync(SERVER_FILE)){
    try{browser=await chromium.connect(JSON.parse(readFileSync(SERVER_FILE,'utf8')).wsEndpoint,{timeout:5000});shared=true;}
    catch(e){console.log(`navegador compartilhado não respondeu (${String(e.message??e).split('\n')[0]}): abrindo um próprio`);}
  }
  if(!browser){
    // No shared browser: the old rule (one of the 2 browser slots of the PC) for a browser of our own. Those slots are
    // never taken back (the queue and the old scripts do not beat): we only wait.
    release=hold(await claimSlot({locks:LOCKS,prefix:'browser',count:2,label:'tools/foto.mjs'}));
    browser=await chromium.launch({headless:true,args:GPU.d3d11});
  }
  const files=[],t0=performance.now();
  // One context per kind of screen (desktop / phone) for the whole run: its HTTP cache keeps the dev server's modules
  // and the city asset between photos (a fresh context parsed them all again, the CPU peak of every photo).
  const contexts=new Map();
  const contextFor=async mobile=>{let c=contexts.get(mobile);if(!c){c=await browser.newContext({deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,viewport:{width:mobile?390:1335,height:mobile?844:620}});contexts.set(mobile,c);}return c;};
  try{
    for(const cena of list)for(const [w,h] of telas){
      const free=shared?hold(await claimSlot({locks:LOCKS,prefix:'foto-pagina',count:PAGES,label:`foto ${cena}`,staleMs:PAGE_STALE_MS})):()=>{};
      const start=performance.now();
      const ctx=await contextFor(w<h);
      let page;
      try{
        const p=page=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
        await p.setViewportSize({width:w,height:h});
        await p.goto(`${base}/?foto=${cena}${extra?`&${extra}`:''}`,{waitUntil:'load',timeout:60000});
        await p.waitForFunction(()=>window.__fotoPronta===true||!!window.__fotoErro,null,{timeout:60000});
        const erro=await p.evaluate(()=>window.__fotoErro);
        if(erro)throw new Error(erro);
        const file=join(saida,`${cena}-${w}x${h}.png`);
        await p.screenshot({path:file});
        files.push(file);
        console.log(`${cena} ${w}x${h}: ${((performance.now()-start)/1000).toFixed(1)} s${errors.length?` · pageerror: ${errors.join(' | ')}`:''} → ${file}`);
      }catch(e){console.log(`${cena} ${w}x${h}: FALHOU · ${String(e.message??e).split('\n')[0]}`);process.exitCode=1;}
      finally{await page?.close().catch(()=>{});free();}
    }
  }finally{
    for(const c of contexts.values())await c.close().catch(()=>{});
    if(shared)await browser.close().catch(()=>{}); // disconnects only: the shared browser stays open
    else{await browser.close().catch(()=>{});release();}
  }
  console.log(`${files.length} foto(s) em ${((performance.now()-t0)/1000).toFixed(1)} s (${shared?'navegador compartilhado':'navegador próprio'})`);
  // The contact sheet: one per screen size (landscape 3 per row, portrait 5), `<folha>-<w>x<h>.png` when several.
  const folha=opt('folha');
  if(folha&&files.length)for(const [w,h] of telas){
    const mine=files.filter(f=>f.endsWith(`-${w}x${h}.png`));
    if(mine.length)await sheet(telas.length>1?folha.replace(/\.png$/,`-${w}x${h}.png`):folha,mine,w<h?5:3,w<h?360:640);
  }
}

/** A contact sheet: every print scaled to one width, in columns, the file name over each (sharp from the repo). */
async function sheet(out,files,maxCols=3,W=640){
  const sharp=(await import('sharp')).default;
  const cols=Math.min(maxCols,files.length),tiles=[];
  for(const f of files){const img=sharp(f).resize({width:W});const meta=await img.toBuffer({resolveWithObject:true});tiles.push({buf:meta.data,h:meta.info.height,name:f.split(/[\\/]/).pop().replace(/\.png$/,'')});}
  const rowH=[];for(let i=0;i<tiles.length;i+=cols)rowH.push(Math.max(...tiles.slice(i,i+cols).map(t=>t.h))+22);
  const comp=[];let y=0;
  rowH.forEach((h,r)=>{tiles.slice(r*cols,r*cols+cols).forEach((t,c)=>{
    comp.push({input:Buffer.from(`<svg width="${W}" height="22"><rect width="100%" height="22" fill="#1E1530"/><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#EEDDB8">${t.name}</text></svg>`),left:c*W,top:y});
    comp.push({input:t.buf,left:c*W,top:y+22});});y+=h;});
  await sharp({create:{width:cols*W,height:y,channels:3,background:'#1E1530'}}).composite(comp).png().toFile(out);
  console.log(`folha → ${out}`);
}

const cmd=args[0];
if(!cmd||cmd==='ajuda'){console.log(readFileSync(new URL(import.meta.url),'utf8').split('\n').filter(l=>l.startsWith('//')).map(l=>l.slice(3)).join('\n'));}
else if(cmd==='servidor')await servidor();
else if(cmd==='parar'){
  if(existsSync(SERVER_FILE)){writeFileSync(`${SERVER_FILE}.parar`,'');console.log('pedido de parada enviado');}
  else console.log('nenhum navegador compartilhado aberto');
}
else if(cmd==='lista')console.log(scenes().join('\n'));
else{
  const all=scenes();
  const list=cmd==='todas'?all:cmd==='chaveiro'?all.filter(s=>s.startsWith('chaveiro-')):cmd.split(',');
  const unknown=list.filter(s=>!all.includes(s));
  if(unknown.length){console.log(`cena desconhecida: ${unknown.join(', ')}\n${all.join(' ')}`);process.exit(2);}
  await fotos(list);
}
