// The standard print sheet (NEW-20261020-ORQ-prints-no-ci): every branch gets the same prints from GitHub Actions
// (.github/workflows/prints.yml), so an executor pushes and waits instead of opening a browser on the shared PC, and a
// visual fault (20/10: the standing hero trembling, idle↔walk at every reconcile, b837b93) shows on a sheet nobody had
// to ask for. On the BUILT site (dist/ under vite preview + the local rooms Worker, as scripts/smoke-prod.mjs):
//   1. the menu (character screen);
//   2. a solo match: the hero standing (3 frames in a row, and a sampled window: a standing hero whose texture flips
//      between an idle and a walk sheet = FAIL), walking by the keyboard (8 directions, 2 frames each), walking by the
//      mouse (a far click, 3 frames);
//   3. modo foto scenes (src/client/dev/foto.ts, no room): a box opening (arsenal), beside towers (torres=1), shadows,
//      the hero beside a house (silhouette);
// each at 1280×720 and 390×844 (DPR 1). Out: <out>/folha-<sha>.png (every frame with its caption), <out>/folha.json
// ({ok, fails, consoleErrors, frames, tremor}), the frames themselves, and the Step Summary when GITHUB_STEP_SUMMARY is set.
// node scripts/folha-prints.mjs [outDir=folha-out] [--dist dist] [--sha <sha>]: run from the checkout whose dist/ and
// rooms Worker it plays (its own scripts/local-worker.mjs). Exit 0 ok, 1 the sheet failed, 2 infrastructure.
// Waits by state (window.__partidaPronta, __fotoPronta, the hero's texture), never a fixed long sleep: swiftshader is slow.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const outDir=resolve(process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')))??'folha-out');
const dist=resolve(arg('dist','dist'));
const sha=String(arg('sha',process.env.GITHUB_SHA??'local')).slice(0,7);
const VIEWPORTS=[{w:1280,h:720},{w:390,h:844}];
/** Modo foto scenes (name, extra query, caption). Extras pass through to the sandbox (foto.ts fotoSearch). */
const FOTOS=[
  ['arsenal','','caixa abrindo (arsenal)'],
  ['cidade-praca','&torres=1&hero=100,124','ao lado das torres (A3 atrás do prédio)'],
  ['sombra','','sombras do elenco'],
  ['cidade-regua','','herói ao lado da casa (silhueta)'],
];
const KEYS={N:['KeyW'],NE:['KeyW','KeyD'],E:['KeyD'],SE:['KeyS','KeyD'],S:['KeyS'],SW:['KeyS','KeyA'],W:['KeyA'],NW:['KeyW','KeyA']};
/** A standing hero is sampled this long (ms) after this settle (ms): any idle↔walk texture flip in it fails. */
const STAND_SAMPLE_MS=4000,STAND_SETTLE_MS=1500;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Infra extends Error {}

const listen=port=>new Promise(ok=>{const s=createServer();s.once('error',()=>ok(0));s.listen(port,'127.0.0.1',()=>{const got=s.address().port;s.close(()=>ok(got));});});
/** The rooms Worker accepts local origins only on the executors' vite ports (multiplayer/origins.ts: 4200–4399). */
async function previewPort(){
  for(const port of [Number(process.env.SMOKE_PORT)||0,...Array.from({length:20},(_,i)=>4379-i)])if(port&&await listen(port))return port;
  throw new Infra('nenhuma porta livre em 4360–4379 para o preview');
}
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
async function startPreview(port){
  const posix=process.platform!=='win32';
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort','--outDir',dist],
    {windowsHide:true,shell:false,detached:posix,stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`,want=readFileSync(join(dist,'version.json'),'utf8').trim();
  let up=false,exited=false;child.once('exit',()=>{exited=true;});
  for(let i=0;i<120&&!up&&!exited;i++){try{const r=await fetch(`${url}/version.json`,{cache:'no-store'});up=r.ok&&(await r.text()).trim()===want;}catch{}if(!up)await sleep(250);}
  const stop=()=>{try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}};
  if(!up){stop();throw new Infra(`vite preview não subiu em ${url}`);}
  return {url,stop};
}
/** Waits for fn() in the page to be truthy, up to ms; false when it never was. */
async function until(p,fn,ms,arg){
  const end=Date.now()+ms;
  while(Date.now()<end){if(await p.evaluate(fn,arg).catch(()=>false))return true;await sleep(250);}
  return false;
}

/** What the hero shows now (?perf=1 publishes the scene as window.__perfScene; the meter's panel is hidden by CSS). */
const HERO=()=>{const s=window.__perfScene,a=s?.actor;return a?{key:String(a.texture?.key??''),frame:String(a.frame?.name??''),x:Math.round(a.x),y:Math.round(a.y)}:null;};
/** A walk sheet (the 128 cells `sprite128:<id>:walk:<dir>`, the legacy `…walk…`), else rest/attack. */
const isWalk=key=>/walk/i.test(key);
/** Samples the hero's texture every animation frame for ms (in the page): the keys seen in order and the flips. */
const SAMPLE=(ms)=>new Promise(done=>{
  const seen=[],end=performance.now()+ms;
  const step=()=>{const a=window.__perfScene?.actor;if(a)seen.push(String(a.texture?.key??''));if(performance.now()<end)requestAnimationFrame(step);else done(seen);};
  requestAnimationFrame(step);
});

const frames=[],fails=[],consoleErrors=[],tremor={};
async function shot(p,name,caption,vp){
  const file=`${String(frames.length).padStart(2,'0')}-${name}-${vp.w}x${vp.h}.png`;
  await p.screenshot({path:join(outDir,file),timeout:30000}).catch(e=>fails.push(`print ${file}: ${String(e).split('\n')[0]}`));
  const hero=await p.evaluate(HERO).catch(()=>null);
  frames.push({file,caption:`${caption} · ${vp.w}×${vp.h}`,hero});
}
async function releaseAll(p){for(const k of new Set(Object.values(KEYS).flat()))await p.keyboard.up(k).catch(()=>{});}

/** The hero standing: 3 prints in a row, then a sampled window (a flip between idle and walk sheets fails). */
async function standing(p,vp){
  await releaseAll(p);await sleep(STAND_SETTLE_MS);
  for(let i=1;i<=3;i++){await shot(p,`parado${i}`,`parado ${i}/3`,vp);await sleep(120);}
  const seen=await p.evaluate(SAMPLE,STAND_SAMPLE_MS).catch(()=>[]);
  let flips=0;for(let i=1;i<seen.length;i++)if(isWalk(seen[i])!==isWalk(seen[i-1]))flips++;
  const walks=seen.filter(isWalk).length,keys=[...new Set(seen)];
  tremor[`${vp.w}x${vp.h}`]={samples:seen.length,walkSamples:walks,flips,keys};
  if(!seen.length)fails.push(`${vp.w}×${vp.h}: herói não encontrado (window.__perfScene.actor)`);
  else if(flips)fails.push(`${vp.w}×${vp.h}: herói parado trocou idle↔walk ${flips}× em ${STAND_SAMPLE_MS/1000} s (tremor; ${walks}/${seen.length} quadros de walk)`);
  else if(walks)fails.push(`${vp.w}×${vp.h}: herói parado com textura de walk (${walks}/${seen.length} quadros)`);
}
async function keyboardWalk(p,vp){
  for(const [dir,keys] of Object.entries(KEYS)){
    for(const k of keys)await p.keyboard.down(k);
    await sleep(500);await shot(p,`tecla-${dir}-1`,`teclado ${dir} (1/2)`,vp);
    await sleep(250);await shot(p,`tecla-${dir}-2`,`teclado ${dir} (2/2)`,vp);
    for(const k of keys)await p.keyboard.up(k);
  }
  await releaseAll(p);
}
async function mouseWalk(p,vp){
  // A click far from the hero (who sits about mid-screen): toward the upper left, inside the canvas, away from the HUD.
  await p.mouse.click(Math.round(vp.w*.25),Math.round(vp.h*.4));
  for(let i=1;i<=3;i++){await sleep(400);await shot(p,`mouse${i}`,`mouse: clique longe ${i}/3`,vp);}
  await sleep(1500);
}

async function match(browser,base){
  const ctx=await browser.newContext({viewport:{width:VIEWPORTS[0].w,height:VIEWPORTS[0].h},deviceScaleFactor:1});
  const p=await ctx.newPage();
  p.on('pageerror',e=>consoleErrors.push(`pageerror: ${String(e).slice(0,300)}`));
  p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,300));});
  try{
    await p.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.perf-hud{display:none!important}';document.head.append(s);});});
    await p.goto(`${base}/?perf=1`,{waitUntil:'load',timeout:90000});
    await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
    for(const vp of [...VIEWPORTS].reverse()){await p.setViewportSize({width:vp.w,height:vp.h});await sleep(600);await shot(p,'menu','menu (personagem)',vp);}
    await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Folha';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
    await p.evaluate(()=>document.getElementById('enter-island').click());
    if(!await until(p,()=>window.__partidaPronta===true&&!!window.__perfScene?.actor,180000)){fails.push('a partida solo não começou em 180 s');await shot(p,'sem-partida','sem partida',VIEWPORTS[0]);return;}
    // The own walk clips load after the match starts (P0 since preload-heroi-primeiro): give them a moment, by state.
    await sleep(3000);
    for(const vp of VIEWPORTS){
      await p.setViewportSize({width:vp.w,height:vp.h});await sleep(800);
      await standing(p,vp);
      await keyboardWalk(p,vp);
      await mouseWalk(p,vp);
    }
  }finally{await ctx.close().catch(()=>{});}
}

async function fotos(browser,base){
  for(const vp of VIEWPORTS){
    const ctx=await browser.newContext({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:1});
    try{
      for(const [cena,extra,caption] of FOTOS){
        const p=await ctx.newPage();
        p.on('pageerror',e=>consoleErrors.push(`${cena}: pageerror: ${String(e).slice(0,300)}`));
        try{
          await p.goto(`${base}/?foto=${cena}${extra}`,{waitUntil:'load',timeout:90000});
          const ok=await until(p,()=>window.__fotoPronta===true||!!window.__fotoErro,90000);
          const erro=await p.evaluate(()=>window.__fotoErro??'').catch(()=>'');
          if(!ok||erro)fails.push(`foto ${cena} ${vp.w}×${vp.h}: ${erro||'não ficou pronta em 90 s'}`);
          await shot(p,`foto-${cena}`,caption,vp);
        }finally{await p.close().catch(()=>{});}
      }
    }finally{await ctx.close().catch(()=>{});}
  }
}

/** Every frame on one PNG: a grid of captioned cells, laid out and printed by the same browser. */
async function sheet(browser,file){
  const cells=frames.filter(f=>existsSync(join(outDir,f.file))).map(f=>{
    const src=`data:image/png;base64,${readFileSync(join(outDir,f.file)).toString('base64')}`;
    const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    return `<figure><img src="${src}"><figcaption>${esc(f.caption)}${f.hero?` <small>${esc(f.hero.key)}#${esc(f.hero.frame)}</small>`:''}</figcaption></figure>`;
  }).join('');
  const head=`folha ${sha} · ${fails.length?`FALHOU: ${fails.join(' | ')}`:'ok'}`;
  const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:13px system-ui}h1{font-size:15px;margin:8px;color:${fails.length?'#f66':'#6f6'}}
main{display:flex;flex-wrap:wrap;gap:6px;padding:6px}figure{margin:0;width:320px}img{width:320px;height:240px;object-fit:contain;background:#000;display:block}
figcaption{padding:2px 0}small{color:#999;word-break:break-all}</style><h1>${head.replace(/[&<>]/g,'')}</h1><main>${cells}</main>`;
  const ctx=await browser.newContext({viewport:{width:1662,height:600},deviceScaleFactor:1});
  try{const p=await ctx.newPage();await p.setContent(html,{waitUntil:'load',timeout:60000});await p.screenshot({path:file,fullPage:true,timeout:60000});}
  finally{await ctx.close().catch(()=>{});}
}

let worker,preview,code=0,original;
const mpFile=join(dist,'multiplayer.json');
const restore=()=>{if(original!==undefined){try{writeFileSync(mpFile,original);}catch{}original=undefined;}};
process.on('exit',restore);
mkdirSync(outDir,{recursive:true});
try{
  if(!existsSync(mpFile))throw new Infra(`${mpFile} não existe: rode npm run build antes`);
  const {chromium}=await playwright();
  const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts','local-worker.mjs')).href);
  const workerPort=await listen(0),port=await previewPort();
  worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-folha-worker-${workerPort}.log`)});
  original=readFileSync(mpFile,'utf8');
  writeFileSync(mpFile,JSON.stringify({...JSON.parse(original),endpoint:`http://127.0.0.1:${workerPort}`}));
  preview=await startPreview(port);
  let browser;
  try{browser=await chromium.launch();}catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  try{
    await match(browser,preview.url);
    await fotos(browser,preview.url);
    if(consoleErrors.some(e=>e.startsWith('pageerror')||/: pageerror/.test(e)))fails.push('pageerror no console (ver folha.json)');
    await sheet(browser,join(outDir,`folha-${sha}.png`));
  }finally{await browser.close().catch(()=>{});}
  code=fails.length?1:0;
}catch(e){
  if(!(e instanceof Infra)&&!/não subiu|ocupada|Porta|wrangler|health/i.test(String(e)))fails.push(`erro: ${String(e).split('\n')[0]}`);
  console.log(`folha: INFRA · ${String(e.message??e).split('\n')[0]}`);code=e instanceof Infra?2:1;
}finally{
  restore();preview?.stop();await Promise.resolve(worker?.stop()).catch(()=>{});
}
const result={sha,ok:code===0,infra:code===2,fails,consoleErrors:consoleErrors.slice(0,50),tremor,frames};
writeFileSync(join(outDir,'folha.json'),JSON.stringify(result,null,1));
const line=`folha ${sha}: ${code===0?'ok':code===2?'INFRA':'FALHOU'}${fails.length?` · ${fails.join(' | ')}`:''}`;
console.log(line);
if(process.env.GITHUB_STEP_SUMMARY){
  try{appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Folha de prints ${sha}: ${code===0?'ok':code===2?'INFRA':'**FALHOU**'}\n\n${fails.map(f=>`- ${f}`).join('\n')||'- sem falhas'}\n\nTremor (herói parado): \`${JSON.stringify(Object.fromEntries(Object.entries(tremor).map(([k,v])=>[k,{flips:v.flips,walk:v.walkSamples,n:v.samples}])))}\`\n\nArtefato: \`folha-${sha}\` (folha-${sha}.png + folha.json + quadros).\n`);}catch{}
}
process.exit(code);
