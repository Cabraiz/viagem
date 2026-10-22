// Folha do estudo de escala mapa × personagens (card NEW-20261022-ORQ-estudo-escala-mapa): the same city scene (plaza,
// cobbled street, a building, a lamp, 4 critters, the hero-height ruler) per variant (`?escala=`, render/estudo-escala.ts)
// on a PC (1280×720) and a phone (412×915), then the phone's FPS with the CPU 4× slower, and one numbered sheet.
//   node scripts/folha-escala.mjs --porta 4206 --saida <dir> [--hero 95,106] [--variantes E0,E1,E2,E2b,E3,E4]
// Takes the browser slot locks/browser-2 (or -1) of the board; one page at a time, DPR 1. Local tool, never in npm test.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('D:/Gits/viagem-tools/node_modules/playwright');
import sharp from 'sharp';

const arg=(name,def)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const PORT=arg('porta','4206'),OUT=arg('saida','folha-escala'),HERO=arg('hero','95,106');
const VARIANTS=arg('variantes','E0,E1,E2,E2b,E3,E4').split(',');
const EXTRA=arg('extra','');
const SCREENS=[{id:'pc',width:1280,height:720},{id:'cel',width:412,height:915}];
const LOCKS='D:/Gits/viagem-board/locks';
fs.mkdirSync(OUT,{recursive:true});

const ONLY_SHEET=process.argv.includes('--so-folha');
let lock;
for(const end=Date.now()+15*60e3;!ONLY_SHEET&&!lock&&Date.now()<end;){
  for(const n of [2,1]){try{fs.mkdirSync(`${LOCKS}/browser-${n}`);lock=`${LOCKS}/browser-${n}`;break;}catch{/* taken */}}
  if(!lock)await new Promise(r=>setTimeout(r,5000));
}
if(!lock&&!ONLY_SHEET)throw new Error('as duas vagas de navegador ficaram ocupadas por 15 min');
if(lock)fs.writeFileSync(`${lock}/owner.json`,JSON.stringify({dono:'Executor-6',card:'estudo-escala-mapa',em:new Date().toISOString()}));
const results=ONLY_SHEET?JSON.parse(fs.readFileSync(path.join(OUT,'folha-escala.json'),'utf8')):[];
let browser;
if(!ONLY_SHEET)try{
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  for(const v of VARIANTS)for(const s of SCREENS){
    const page=await browser.newPage({viewport:{width:s.width,height:s.height},deviceScaleFactor:1});
    const url=`http://127.0.0.1:${PORT}/?sandbox=cidade&mapa=real&tele=1&regua=1&hero=${HERO}&escala=${v}${EXTRA?`&${EXTRA}`:''}`;
    await page.goto(url,{waitUntil:'load',timeout:60000});
    await page.waitForFunction(()=>{const c=window.__cidade;return !!c&&(!c.ground||c.ground());},null,{timeout:60000});
    await page.waitForTimeout(1500);
    const file=path.join(OUT,`${v}-${s.id}.png`);
    await page.screenshot({path:file});
    const info=await page.evaluate(()=>{const c=window.__cidade;return {zoom:c.zoom,heroPx:c.heroPx,visibleCells:c.visibleCells,cell:c.cell};});
    let fps;
    if(s.id==='cel'){
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await page.waitForTimeout(1500);
      const t0=await page.evaluate(()=>window.__cidade.samples());
      await page.waitForTimeout(4000);
      fps=await page.evaluate(()=>({media:window.__cidade.fps(),pior:window.__cidade.worst(),quadros:window.__cidade.samples()}));
      fps.antes=t0;
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    }
    results.push({variante:v,tela:s.id,file,...info,...(fps?{fps}:{})});
    console.log(v,s.id,JSON.stringify(info),fps?`fps ${fps.media.toFixed(1)} (pior ${fps.pior.toFixed(1)})`:'');
    await page.close();
  }
}finally{
  await browser?.close();
  fs.rmSync(lock,{recursive:true,force:true});
}
if(!ONLY_SHEET)fs.writeFileSync(path.join(OUT,'folha-escala.json'),JSON.stringify(results,null,1));

// The sheet: one row per variant, number and label, the PC print at ½ and the phone print at ½.
const HALF=.5,PCW=Math.round(SCREENS[0].width*HALF),PCH=Math.round(SCREENS[0].height*HALF),CW=Math.round(SCREENS[1].width*HALF),CH=Math.round(SCREENS[1].height*HALF);
const LABEL=230,GAP=10,ROW=Math.max(PCH,CH)+GAP,W=LABEL+PCW+CW+GAP*3,H=VARIANTS.length*ROW+GAP;
const desc=JSON.parse(arg('descricoes','{}'));
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const parts=[];
for(const [i,v] of VARIANTS.entries()){
  const top=GAP+i*ROW,cel=results.find(r=>r.variante===v&&r.tela==='cel');
  const lines=[`${i+1}. ${v}`,...(desc[v]??'').split('|'),cel?.fps?`FPS cel. (CPU 4×): ${cel.fps.media.toFixed(0)}`:''].filter(Boolean);
  parts.push({input:Buffer.from(`<svg width="${LABEL}" height="${ROW-GAP}" xmlns="http://www.w3.org/2000/svg">${lines.map((t,k)=>`<text x="8" y="${28+k*22}" font-family="Arial" font-size="${k?15:22}" font-weight="${k?400:700}" fill="#1E1530">${esc(t)}</text>`).join('')}</svg>`),top,left:GAP});
  for(const [s,left,w,h] of [['pc',LABEL+GAP,PCW,PCH],['cel',LABEL+PCW+GAP*2,CW,CH]]){
    const file=path.join(OUT,`${v}-${s}.png`);
    parts.push({input:await sharp(file).resize(Math.round(w),Math.round(h)).toBuffer(),top,left:Math.round(left)});
  }
}
await sharp({create:{width:Math.round(W),height:Math.round(H),channels:4,background:'#EEDDB8'}}).composite(parts).png().toFile(path.join(OUT,'folha-escala.png'));
console.log(path.join(OUT,'folha-escala.png'));
